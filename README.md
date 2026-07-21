# yieldagent

A small agent loop you can actually read. No dependencies, works with any
OpenAI-compatible API, and — unlike most minimal agent libraries — it lets you
pause before a tool runs, get a human's approval, and resume later.

```bash
npm install yieldagent
```

## Why

I wanted an agent loop I could understand end to end instead of a framework I
had to configure. The tiny ones I found were fine until I needed the agent to
do something I didn't want it doing unsupervised — sending an email, spending
money, deleting a file. None of them made "stop and ask a human first" easy,
and the big frameworks made it a whole subsystem.

So this is the loop, kept deliberately small, with pause/resume as a first-class
thing rather than an afterthought.

## Basic use

```ts
import { agent, type Tool } from "yieldagent";
import { openaiCompatible } from "yieldagent/openai";

const tools: Record<string, Tool> = {
  getWeather: {
    description: "Get the current weather for a city",
    parameters: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
    run: async ({ city }) => ({ city, tempC: 31, sky: "clear" }),
  },
};

const call = openaiCompatible({ apiKey: process.env.OPENAI_API_KEY!, model: "gpt-4o-mini" });

for await (const step of agent({
  call,
  tools,
  messages: [{ role: "user", content: "What's the weather in Delhi?" }],
})) {
  if (step.type === "tool-start") console.log("→", step.tool, step.args);
  if (step.type === "final") console.log(step.text);
}
```

`agent()` is an async generator. It calls the model, runs whatever tools the
model asks for, feeds the results back, and repeats until the model stops asking
for tools. Every step is yielded, so nothing is hidden from you.

## Pause and resume

Pass an `approve` function. Return `false` for a given tool and the loop stops
before running it, handing back a `resumeState` that's just a plain object:

```ts
const cfg = {
  call,
  tools, // includes a sendEmail tool
  messages: [{ role: "user", content: "Email the Delhi weather to my boss" }],
  approve: (tool) => tool !== "sendEmail",
};

let paused;
for await (const step of agent(cfg)) {
  if (step.type === "paused") paused = step.resumeState;
  if (step.type === "final") console.log(step.text);
}
```

`resumeState` is serializable, so you can write it to a database or a job queue,
wait for a human to click approve (in another request, another process, after a
restart — doesn't matter), then continue:

```ts
import { resume } from "yieldagent";

for await (const step of resume(cfg, paused)) {
  if (step.type === "final") console.log(step.text);
}
```

## Testing without an LLM

`call` is just a function `(messages, tools) => Promise<Message>`. In tests, pass
one that returns canned replies. No API key, no network, and the results are
deterministic:

```ts
const replies = [
  { role: "assistant", content: null, tool_calls: [{ id: "1", function: { name: "getWeather", arguments: '{"city":"Delhi"}' } }] },
  { role: "assistant", content: "It's 31°C.", tool_calls: [] },
];
let i = 0;
const call = async () => replies[i++];

const steps = [];
for await (const s of agent({ call, tools, messages })) steps.push(s);
// assert on steps.map(s => s.type), the tool results, the final text, etc.
```

This is how the library tests itself — see [`test/agent.test.ts`](test/agent.test.ts).

## API

**`agent(config)`** returns an async generator of steps.

- `call` — your model function, `(messages, tools) => Promise<Message>`
- `tools` — a map of name → `{ description, parameters, run }`
- `messages` — the conversation so far
- `maxSteps` — cap on model round-trips (default 10)
- `approve` — optional `(tool, args) => boolean`; return `false` to pause

**`resume(config, resumeState)`** runs the pending tool from a paused run, then
continues the loop.

**Step** is one of:

- `tool-start` — `{ tool, args, step }`
- `tool-end` — `{ tool, args, result?, error?, step }`
- `paused` — `{ tool, args, resumeState }`
- `final` — `{ text, messages }`

**Providers.** `openaiCompatible` talks to anything speaking the
`/chat/completions` shape — OpenAI, Anthropic's compatible endpoint, Groq,
Together, Ollama, OpenRouter:

```ts
openaiCompatible({
  apiKey: "...",
  model: "gpt-4o-mini",
  baseURL: "https://api.openai.com/v1", // point elsewhere as needed
});
```

Or skip it and write your own `call` — it's a dozen lines.

## When to use something else

If you need streaming UI helpers, a big tool ecosystem, multi-agent
orchestration, or persistence adapters out of the box, use the
[Vercel AI SDK](https://sdk.vercel.ai) or [LangGraph](https://langchain-ai.github.io/langgraphjs/).
yieldagent is for when you'd rather own a loop you can read in a few minutes than
adopt a framework. If you outgrow it, you'll know exactly what you're replacing.

## License

MIT
