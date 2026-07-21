# yieldagent

**The smallest agent loop that's actually useful.** Zero dependencies. ~200 lines you can read in one sitting. With **human-in-the-loop pause/resume** built in — the thing every other tiny agent skips.

```bash
npm install yieldagent
```

- 🧠 **You own the loop.** No framework, no magic, no lock-in. Read the whole thing.
- ⏸️ **Pause & resume.** Stop before any sensitive tool runs, get human approval, resume exactly where you left off — state is a plain, serializable object.
- 🔍 **Inspectable & testable.** Every step is yielded as a plain object. Unit-test your agent with a scripted model — no API key, no network, no flakiness.
- 🔌 **Any model.** Works with any OpenAI-compatible endpoint (OpenAI, Anthropic, Groq, Together, Ollama, OpenRouter…).
- 📦 **Zero dependencies.** Nothing to audit, nothing to bloat your bundle.

---

## Quick start

```ts
import { agent, type Tool } from "yieldagent";
import { openaiCompatible } from "yieldagent/openai";

const tools: Record<string, Tool> = {
  getWeather: {
    description: "Get the current weather for a city",
    parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
    run: async ({ city }) => ({ city, tempC: 31, sky: "clear" }),
  },
};

const call = openaiCompatible({ apiKey: process.env.OPENAI_API_KEY!, model: "gpt-4o-mini" });

for await (const step of agent({
  call,
  tools,
  messages: [{ role: "user", content: "What's the weather in Delhi?" }],
})) {
  if (step.type === "tool-start") console.log(`→ ${step.tool}`, step.args);
  if (step.type === "final") console.log("🤖", step.text);
}
```

That's the whole thing. `agent()` is an async generator: it calls the model, runs any tools the model asks for, feeds the results back, and loops until the model gives a final answer.

---

## The feature nobody else makes easy: pause & resume

Real agents do risky things — send emails, spend money, delete files. You want a human in the loop **before** that happens, and you want to pause a run and continue it later (across a request, a queue, even a server restart).

Pass `approve()`. Return `false` and the loop **pauses** and hands you a serializable `resumeState`:

```ts
const cfg = {
  call,
  tools, // includes a `sendEmail` tool
  messages: [{ role: "user", content: "Email the Delhi weather to my boss" }],
  approve: (tool) => tool !== "sendEmail", // pause before sending
};

let paused;
for await (const step of agent(cfg)) {
  if (step.type === "paused") {
    console.log(`⏸ needs approval: ${step.tool}`, step.args);
    paused = step.resumeState; // <- plain object. Save it to a DB, a queue, anywhere.
  }
  if (step.type === "final") console.log("🤖", step.text);
}

// ...later, after a human clicks "Approve" (even in a different process)...
import { resume } from "yieldagent";
for await (const step of resume(cfg, paused)) {
  if (step.type === "final") console.log("🤖", step.text);
}
```

Because `resumeState` is just data, you can serialize it, store it, and resume from anywhere.

---

## Testable by design — no LLM required

`agent()` takes *any* function shaped like `(messages, tools) => Promise<Message>`. In tests, pass a scripted one and assert on the steps. **Deterministic, instant, free.**

```ts
import { agent } from "yieldagent";

const scripted = (() => {
  let i = 0;
  const replies = [
    { role: "assistant", content: null, tool_calls: [{ id: "1", function: { name: "getWeather", arguments: '{"city":"Delhi"}' } }] },
    { role: "assistant", content: "It's 31°C.", tool_calls: [] },
  ];
  return async () => replies[i++];
})();

const steps = [];
for await (const s of agent({ call: scripted, tools, messages })) steps.push(s);

expect(steps.map((s) => s.type)).toEqual(["tool-start", "tool-end", "final"]);
```

---

## API

### `agent(config)` → `AsyncGenerator<Step>`

| Config field | Type | Default | Description |
| --- | --- | --- | --- |
| `call` | `(messages, tools) => Promise<Message>` | — | Your model call. See `yieldagent/openai`. |
| `tools` | `Record<string, Tool>` | — | Tools the agent may use, keyed by name. |
| `messages` | `Message[]` | — | The conversation so far. |
| `maxSteps` | `number` | `10` | Safety cap on model round-trips. |
| `approve` | `(tool, args) => boolean` | — | Return `false` to pause before a tool runs. |

### `resume(config, resumeState)` → `AsyncGenerator<Step>`

Runs the pending tool call from a paused run, then continues the loop.

### `Step` types

- `{ type: "tool-start", tool, args, step }`
- `{ type: "tool-end", tool, args, result?, error?, step }`
- `{ type: "paused", reason, tool, args, resumeState }`
- `{ type: "final", text, messages }`

### Any OpenAI-compatible provider

```ts
openaiCompatible({
  apiKey: "...",
  model: "gpt-4o-mini",
  baseURL: "https://api.openai.com/v1", // or Groq, Together, Ollama, OpenRouter, ...
});
```

---

## Why not just use the Vercel AI SDK / LangGraph?

Use them! They're great. Reach for `yieldagent` when you want:

- **To understand and own your agent loop** instead of configuring a framework.
- **First-class pause/resume** with plain serializable state (no checkpointer setup).
- **Zero dependencies** and a footprint you can read end-to-end.
- **Trivially testable** agent logic with no mocking machinery.

It's small on purpose. If you outgrow it, you'll understand exactly what to reach for next — because you can read every line of what you're leaving.

---

## License

MIT © Rahul Choudhary
