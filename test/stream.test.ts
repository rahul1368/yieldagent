import { describe, it, expect } from "vitest";
import { agent, type Message, type StreamChunk, type ToolSet } from "../src/index.js";

const tools: ToolSet = {
  getWeather: {
    description: "weather",
    parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
    run: ({ city }: { city: string }) => ({ city, tempC: 31 }),
  },
};

/** Turn scripted chunk-lists into a streaming model call (no network). */
function scriptedStream(turns: StreamChunk[][]) {
  let i = 0;
  return async function* () {
    const chunks = turns[i++];
    if (!chunks) throw new Error("scriptedStream ran out of turns");
    for (const c of chunks) yield c;
  };
}

const userMsg: Message[] = [{ role: "user", content: "hi" }];

describe("streaming", () => {
  it("emits token steps and a final answer", async () => {
    const stream = scriptedStream([
      [
        { type: "token", text: "It's " },
        { type: "token", text: "31°C." },
        { type: "message", message: { role: "assistant", content: "It's 31°C.", tool_calls: [] } },
      ],
    ]);

    const tokens: string[] = [];
    let final = "";
    for await (const s of agent({ stream, tools, messages: userMsg })) {
      if (s.type === "token") tokens.push(s.text);
      if (s.type === "final") final = s.text ?? "";
    }

    expect(tokens).toEqual(["It's ", "31°C."]);
    expect(final).toBe("It's 31°C.");
  });

  it("streams a tool call, runs it, then streams the answer", async () => {
    const stream = scriptedStream([
      // turn 1: model streams nothing but a tool call
      [
        {
          type: "message",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{ id: "c1", function: { name: "getWeather", arguments: '{"city":"Delhi"}' } }],
          },
        },
      ],
      // turn 2: model streams the final text
      [
        { type: "token", text: "Delhi is 31°C." },
        { type: "message", message: { role: "assistant", content: "Delhi is 31°C.", tool_calls: [] } },
      ],
    ]);

    const steps = [];
    for await (const s of agent({ stream, tools, messages: userMsg })) steps.push(s);

    expect(steps.map((s) => s.type)).toEqual(["tool-start", "tool-end", "token", "final"]);
    const end = steps.find((s) => s.type === "tool-end") as any;
    expect(end.result).toEqual({ city: "Delhi", tempC: 31 });
    expect((steps.at(-1) as any).text).toBe("Delhi is 31°C.");
  });

  it("throws if neither call nor stream is provided", async () => {
    await expect(async () => {
      for await (const _ of agent({ tools, messages: userMsg })) { /* */ }
    }).rejects.toThrow(/provide either/);
  });

  it("throws if a stream ends without a final message", async () => {
    const stream = scriptedStream([[{ type: "token", text: "oops" }]]);
    await expect(async () => {
      for await (const _ of agent({ stream, tools, messages: userMsg })) { /* */ }
    }).rejects.toThrow(/without a final message/);
  });
});
