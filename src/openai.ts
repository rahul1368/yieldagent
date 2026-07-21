/**
 * A tiny OpenAI-compatible adapter. Works with OpenAI, Anthropic's
 * OpenAI-compatible endpoint, Groq, Together, Ollama, OpenRouter, or any
 * server that speaks the /chat/completions shape.
 *
 * Bring your own `fetch` if you need a custom one; defaults to global fetch.
 */
import type {
  Message,
  ModelCall,
  ModelCallOptions,
  ModelStreamCall,
  ToolCall,
  ToolSpec,
} from "./index.js";

/** The subset of an OpenAI streaming chunk this adapter reads. */
interface StreamDelta {
  content?: string;
  tool_calls?: Array<{
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
}
interface StreamEvent {
  choices?: Array<{ delta?: StreamDelta }>;
}

export interface OpenAICompatibleOptions {
  /** API key (sent as `Authorization: Bearer <key>`). */
  apiKey: string;
  /** Model id, e.g. "gpt-4o-mini". */
  model: string;
  /** Base URL. Defaults to OpenAI. Point it at any compatible server. */
  baseURL?: string;
  /** Sampling temperature. */
  temperature?: number;
  /** Custom fetch (e.g. for proxies/timeouts). Defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
}

/**
 * Build a `ModelCall` you can pass to `agent({ call, ... })`.
 *
 * @example
 * import { agent } from "yieldagent";
 * import { openaiCompatible } from "yieldagent/openai";
 *
 * const call = openaiCompatible({ apiKey: process.env.OPENAI_API_KEY!, model: "gpt-4o-mini" });
 * for await (const step of agent({ call, tools, messages })) { ... }
 */
export function openaiCompatible(opts: OpenAICompatibleOptions): ModelCall {
  const {
    apiKey,
    model,
    baseURL = "https://api.openai.com/v1",
    temperature,
    fetch: fetchImpl = globalThis.fetch,
  } = opts;

  return async function call(
    messages: Message[],
    tools: ToolSpec[],
    options?: ModelCallOptions,
  ): Promise<Message> {
    const res = await fetchImpl(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        ...(tools.length ? { tools, tool_choice: "auto" } : {}),
        ...(temperature != null ? { temperature } : {}),
      }),
      signal: options?.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Model call failed (${res.status}): ${body.slice(0, 500)}`);
    }

    const data = (await res.json()) as {
      choices?: { message?: Message }[];
    };
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error("Model returned no message");
    return message;
  };
}

/**
 * Streaming version of {@link openaiCompatible}. Yields `token` chunks as text
 * arrives, assembles any tool calls from the deltas, and ends with the complete
 * message. Pass it as `stream` to `agent({ stream, ... })`.
 */
export function openaiCompatibleStream(opts: OpenAICompatibleOptions): ModelStreamCall {
  const {
    apiKey,
    model,
    baseURL = "https://api.openai.com/v1",
    temperature,
    fetch: fetchImpl = globalThis.fetch,
  } = opts;

  return async function* stream(messages, tools, options?: ModelCallOptions) {
    const res = await fetchImpl(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        ...(tools.length ? { tools, tool_choice: "auto" } : {}),
        ...(temperature != null ? { temperature } : {}),
      }),
      signal: options?.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Model call failed (${res.status}): ${body.slice(0, 500)}`);
    }
    if (!res.body) throw new Error("Model returned no response body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    const toolCalls: ToolCall[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Server-Sent Events are newline-delimited; keep the trailing partial line.
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;

        let event: StreamEvent;
        try {
          event = JSON.parse(payload) as StreamEvent;
        } catch {
          continue;
        }
        const delta = event.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          content += delta.content;
          yield { type: "token", text: delta.content };
        }
        if (delta.tool_calls) {
          for (const d of delta.tool_calls) {
            const idx: number = d.index ?? 0;
            let tc = toolCalls[idx];
            if (!tc) {
              tc = { id: "", function: { name: "", arguments: "" } };
              toolCalls[idx] = tc;
            }
            if (d.id) tc.id = d.id;
            if (d.function?.name) tc.function.name = d.function.name;
            if (d.function?.arguments) tc.function.arguments += d.function.arguments;
          }
        }
      }
    }

    const assembled = toolCalls.filter(Boolean);
    yield {
      type: "message",
      message: {
        role: "assistant",
        content: content || null,
        ...(assembled.length ? { tool_calls: assembled } : {}),
      },
    };
  };
}
