/**
 * Real usage against a live model. Run with:
 *   OPENAI_API_KEY=sk-... npx tsx examples/basic.ts
 */
import { agent, resume, type Tool, type ResumeState } from "../src/index.js";
import { openaiCompatible } from "../src/openai.js";

const tools: Record<string, Tool> = {
  getWeather: {
    description: "Get the current weather for a city",
    parameters: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
    run: async ({ city }: { city: string }) => ({ city, tempC: 31, sky: "clear" }),
  },
  sendEmail: {
    description: "Send an email to a recipient",
    parameters: {
      type: "object",
      properties: { to: { type: "string" }, body: { type: "string" } },
      required: ["to", "body"],
    },
    run: async ({ to }: { to: string; body: string }) => ({ sent: true, to }),
  },
};

const call = openaiCompatible({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-4o-mini",
});

const cfg = {
  call,
  tools,
  messages: [{ role: "user" as const, content: "Check the weather in Delhi and email it to boss@acme.com" }],
  // Pause before anything sensitive runs.
  approve: (tool: string) => tool !== "sendEmail",
};

let paused: ResumeState | undefined;
for await (const step of agent(cfg)) {
  if (step.type === "tool-start") console.log(`→ ${step.tool}(${JSON.stringify(step.args)})`);
  if (step.type === "tool-end") console.log(`✓ ${step.tool} →`, step.result ?? step.error);
  if (step.type === "paused") {
    console.log(`⏸  needs approval to run ${step.tool}(${JSON.stringify(step.args)})`);
    paused = step.resumeState;
  }
  if (step.type === "final") console.log("🤖", step.text);
}

// ...ask a human here... then resume:
if (paused) {
  console.log("\n(human approved)\n");
  for await (const step of resume(cfg, paused)) {
    if (step.type === "tool-end") console.log(`✓ ${step.tool} →`, step.result ?? step.error);
    if (step.type === "final") console.log("🤖", step.text);
  }
}
