import { describe, it, expect } from "vitest";
import { z } from "zod";
import { zodTool, zodToJsonSchema } from "../src/zod.js";
import { agent, type Message } from "../src/index.js";

describe("zodTool", () => {
  it("derives a JSON Schema from a Zod object", () => {
    const schema = z.object({
      city: z.string().describe("the city name"),
      units: z.enum(["c", "f"]).optional(),
      days: z.number(),
    });
    expect(zodToJsonSchema(schema)).toEqual({
      type: "object",
      properties: {
        city: { description: "the city name", type: "string" },
        units: { type: "string", enum: ["c", "f"] },
        days: { type: "number" },
      },
      required: ["city", "days"], // `units` is optional
    });
  });

  it("validates good args and returns the run result", async () => {
    const t = zodTool({
      description: "weather",
      schema: z.object({ city: z.string() }),
      run: ({ city }) => ({ city, tempC: city.length }),
    });
    expect(await t.run({ city: "Delhi" })).toEqual({ city: "Delhi", tempC: 5 });
  });

  it("throws a descriptive error on invalid args", async () => {
    const t = zodTool({
      description: "weather",
      schema: z.object({ city: z.string() }),
      run: ({ city }) => ({ city }),
    });
    await expect(async () => t.run({ city: 123 } as any)).rejects.toThrow(/Invalid arguments: city/);
  });

  it("reports validation errors back to the model inside the loop", async () => {
    const t = {
      lookup: zodTool({
        description: "lookup",
        schema: z.object({ id: z.number() }),
        run: ({ id }) => ({ id }),
      }),
    };
    // Model first sends a bad arg (string), then recovers with a final answer.
    const replies: Message[] = [
      { role: "assistant", content: null, tool_calls: [{ id: "1", function: { name: "lookup", arguments: '{"id":"oops"}' } }] },
      { role: "assistant", content: "fixed", tool_calls: [] },
    ];
    let i = 0;
    const call = async () => replies[i++]!;

    const steps = [];
    for await (const s of agent({ call, tools: t, messages: [{ role: "user", content: "go" }] })) steps.push(s);

    const end = steps.find((s) => s.type === "tool-end") as any;
    expect(end.error).toMatch(/Invalid arguments: id/);
    expect((steps.at(-1) as any).text).toBe("fixed");
  });
});
