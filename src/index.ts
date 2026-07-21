/**
 * yieldagent — a small agent loop with no dependencies.
 *
 * The loop is an async generator: it yields every step so you can inspect and
 * test it, and it can pause before a tool runs (see `approve`) so a human can
 * sign off before the agent does anything you'd rather supervise.
 */

/** A single tool the agent is allowed to call. */
export interface Tool<Args = any, Result = any> {
  /** Human-readable description the model uses to decide when to call it. */
  description: string;
  /** JSON Schema describing the tool's arguments object. */
  parameters: Record<string, unknown>;
  /** The implementation. May be async. Throwing is caught and reported to the model. */
  run: (args: Args) => Result | Promise<Result>;
}

/** A chat message in the OpenAI-compatible shape. */
export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

/** A tool call requested by the model. */
export interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}

/** The OpenAI-compatible tool specification passed to the model. */
export interface ToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Extra options passed to a model call, e.g. an abort signal to forward. */
export interface ModelCallOptions {
  signal?: AbortSignal;
}

/**
 * Your model call. Given the running conversation and the tool specs, return
 * the assistant's next message (optionally containing `tool_calls`). The third
 * argument is optional — forward `options.signal` to your request if you want
 * in-flight calls to cancel. See `yieldagent/openai` for a ready-made adapter.
 */
export type ModelCall = (
  messages: Message[],
  tools: ToolSpec[],
  options?: ModelCallOptions,
) => Promise<Message>;

/**
 * Define a tool with a typed `run`. Purely a typing convenience — it returns
 * its argument unchanged, but lets you write `tool<{ city: string }>({ ... })`
 * so `run`'s parameter is checked instead of `any`.
 */
export function tool<Args = any, Result = any>(
  def: Tool<Args, Result>,
): Tool<Args, Result> {
  return def;
}

/** Everything needed to resume a paused run. Plain and serializable. */
export interface ResumeState {
  messages: Message[];
  pendingCall: ToolCall;
}

/** A single observable step emitted by the loop. */
export type Step =
  | { type: "tool-start"; tool: string; args: any; step: number; resumed?: boolean }
  | {
      type: "tool-end";
      tool: string;
      args: any;
      result?: any;
      error?: string;
      step: number;
      resumed?: boolean;
    }
  | {
      type: "paused";
      reason: "approval-required";
      tool: string;
      args: any;
      resumeState: ResumeState;
    }
  | { type: "final"; text: string | null; messages: Message[] };

/** Configuration for an agent run. */
export interface AgentConfig {
  /** Your model call (bring your own provider). */
  call: ModelCall;
  /** The tools the agent may use, keyed by name. */
  tools: Record<string, Tool>;
  /** The conversation so far (system + user messages). */
  messages: Message[];
  /** Safety cap on model round-trips. Default 10. */
  maxSteps?: number;
  /**
   * Called before each tool runs. Return `false` to pause the run for approval
   * (the loop yields a `paused` step with a serializable `resumeState`).
   */
  approve?: (tool: string, args: any) => boolean;
  /**
   * Cancel the run. When aborted, the loop throws at the next checkpoint (before
   * a model call or a tool run) and forwards the signal to the model call.
   * Cancelling is not the same as pausing — it stops without a resumeState.
   */
  signal?: AbortSignal;
}

function toSpecs(tools: Record<string, Tool>): ToolSpec[] {
  return Object.entries(tools).map(([name, t]) => ({
    type: "function",
    function: { name, description: t.description, parameters: t.parameters },
  }));
}

async function runTool(
  tool: Tool,
  args: any,
): Promise<{ result?: any; error?: string }> {
  try {
    return { result: await tool.run(args) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Run an agent as an async generator of steps. You drive it — iterate with
 * `for await`, inspect every step, and stop whenever you like.
 *
 * @example
 * for await (const step of agent({ call, tools, messages })) {
 *   if (step.type === "final") console.log(step.text);
 * }
 */
export async function* agent(
  cfg: AgentConfig,
): AsyncGenerator<Step, void, unknown> {
  const { call, tools, maxSteps = 10, approve, signal } = cfg;
  const messages: Message[] = [...cfg.messages];
  const specs = toSpecs(tools);

  for (let step = 0; step < maxSteps; step++) {
    signal?.throwIfAborted();
    const reply = await call(messages, specs, { signal });
    messages.push(reply);

    // Model answered without asking for a tool -> we're done.
    if (!reply.tool_calls || reply.tool_calls.length === 0) {
      yield { type: "final", text: reply.content, messages };
      return;
    }

    for (const tc of reply.tool_calls) {
      const name = tc.function.name;
      const args = parseArgs(tc.function.arguments);
      const tool = tools[name];

      // Unknown tool: report back to the model instead of crashing.
      if (!tool) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({ error: `Unknown tool: ${name}` }),
        });
        continue;
      }

      signal?.throwIfAborted();

      // Let the caller stop us before the tool actually runs.
      if (approve && approve(name, args) === false) {
        yield {
          type: "paused",
          reason: "approval-required",
          tool: name,
          args,
          resumeState: { messages, pendingCall: tc },
        };
        return;
      }

      yield { type: "tool-start", tool: name, args, step };
      const { result, error } = await runTool(tool, args);
      yield { type: "tool-end", tool: name, args, result, error, step };

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(error ? { error } : (result ?? null)),
      });
    }
  }

  yield { type: "final", text: null, messages };
}

/**
 * Resume a paused run after approval. Executes the pending tool call, then
 * continues the loop exactly where it left off.
 *
 * @example
 * for await (const step of resume(cfg, paused.resumeState)) { ... }
 */
export async function* resume(
  cfg: AgentConfig,
  state: ResumeState,
): AsyncGenerator<Step, void, unknown> {
  const { tools, signal } = cfg;
  const messages: Message[] = [...state.messages];
  const tc = state.pendingCall;
  const name = tc.function.name;
  const args = parseArgs(tc.function.arguments);
  const tool = tools[name];

  signal?.throwIfAborted();

  if (!tool) {
    messages.push({
      role: "tool",
      tool_call_id: tc.id,
      content: JSON.stringify({ error: `Unknown tool: ${name}` }),
    });
  } else {
    yield { type: "tool-start", tool: name, args, step: -1, resumed: true };
    const { result, error } = await runTool(tool, args);
    yield { type: "tool-end", tool: name, args, result, error, step: -1, resumed: true };
    messages.push({
      role: "tool",
      tool_call_id: tc.id,
      content: JSON.stringify(error ? { error } : (result ?? null)),
    });
  }

  yield* agent({ ...cfg, messages });
}

function parseArgs(raw: string | undefined): any {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
