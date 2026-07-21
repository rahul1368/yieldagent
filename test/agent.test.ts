import { describe, it, expect, vi } from "vitest";
import { agent, resume, tool, type Message, type ModelCall, type ToolSet } from "../src/index.js";

/**
 * A scripted, deterministic model — no API key, no network. This is the whole
 * point of yieldagent's design: agent logic is unit-testable without an LLM.
 */
function scriptedModel(replies: Message[]): ModelCall {
  let i = 0;
  return async () => {
    const reply = replies[i++];
    if (!reply) throw new Error("scriptedModel ran out of replies");
    return reply;
  };
}

const tools: ToolSet = {
  getWeather: {
    description: "Get weather for a city",
    parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
    run: ({ city }: { city: string }) => ({ city, tempC: 31 }),
  },
  sendEmail: {
    description: "Send an email",
    parameters: { type: "object", properties: { to: { type: "string" } }, required: ["to"] },
    run: ({ to }: { to: string }) => ({ sent: true, to }),
  },
};

const userMsg: Message[] = [{ role: "user", content: "weather + email" }];

function toolCall(id: string, name: string, args: object): Message {
  return {
    role: "assistant",
    content: null,
    tool_calls: [{ id, function: { name, arguments: JSON.stringify(args) } }],
  };
}

describe("agent", () => {
  it("calls a tool then returns a final answer", async () => {
    const call = scriptedModel([
      toolCall("c1", "getWeather", { city: "Delhi" }),
      { role: "assistant", content: "It is 31C in Delhi.", tool_calls: [] },
    ]);

    const steps = [];
    for await (const s of agent({ call, tools, messages: userMsg })) steps.push(s);

    expect(steps.map((s) => s.type)).toEqual(["tool-start", "tool-end", "final"]);
    const end = steps.find((s) => s.type === "tool-end") as any;
    expect(end.result).toEqual({ city: "Delhi", tempC: 31 });
    const final = steps.at(-1) as any;
    expect(final.text).toBe("It is 31C in Delhi.");
  });

  it("pauses before a tool when approve() returns false", async () => {
    const call = scriptedModel([toolCall("c1", "sendEmail", { to: "boss@x.com" })]);
    const approve = vi.fn((name: string) => name !== "sendEmail");

    const steps = [];
    for await (const s of agent({ call, tools, messages: userMsg, approve })) steps.push(s);

    const paused = steps.at(-1) as any;
    expect(paused.type).toBe("paused");
    expect(paused.tool).toBe("sendEmail");
    expect(paused.resumeState.pendingCall.id).toBe("c1");
    expect(approve).toHaveBeenCalledOnce();
  });

  it("resumes a paused run and completes it", async () => {
    // First run pauses on sendEmail.
    const pauseCall = scriptedModel([toolCall("c1", "sendEmail", { to: "boss@x.com" })]);
    const cfg = { call: pauseCall, tools, messages: userMsg, approve: (n: string) => n !== "sendEmail" };

    let resumeState: any;
    for await (const s of agent(cfg)) if (s.type === "paused") resumeState = s.resumeState;
    expect(resumeState).toBeDefined();

    // Resume: run the pending tool, then the model gives its final answer.
    const resumeCfg = {
      ...cfg,
      call: scriptedModel([{ role: "assistant", content: "Email sent.", tool_calls: [] }]),
    };
    const steps = [];
    for await (const s of resume(resumeCfg, resumeState)) steps.push(s);

    expect(steps.map((s) => s.type)).toEqual(["tool-start", "tool-end", "final"]);
    const end = steps.find((s) => s.type === "tool-end") as any;
    expect(end.result).toEqual({ sent: true, to: "boss@x.com" });
    expect((steps.at(-1) as any).text).toBe("Email sent.");
  });

  it("reports tool errors back to the model instead of crashing", async () => {
    const boom: ToolSet = {
      boom: {
        description: "always throws",
        parameters: { type: "object", properties: {} },
        run: () => {
          throw new Error("kaboom");
        },
      },
    };
    const call = scriptedModel([
      toolCall("c1", "boom", {}),
      { role: "assistant", content: "recovered", tool_calls: [] },
    ]);

    const steps = [];
    for await (const s of agent({ call, tools: boom, messages: userMsg })) steps.push(s);
    const end = steps.find((s) => s.type === "tool-end") as any;
    expect(end.error).toBe("kaboom");
    expect((steps.at(-1) as any).text).toBe("recovered");
  });

  it("handles an unknown tool gracefully", async () => {
    const call = scriptedModel([
      toolCall("c1", "doesNotExist", {}),
      { role: "assistant", content: "ok", tool_calls: [] },
    ]);
    const steps = [];
    for await (const s of agent({ call, tools, messages: userMsg })) steps.push(s);
    // No tool-start/tool-end for unknown tools; loop keeps going.
    expect(steps.map((s) => s.type)).toEqual(["final"]);
  });

  it("stops at maxSteps to prevent infinite loops", async () => {
    // Model always asks for a tool -> would loop forever without the cap.
    const call: ModelCall = async () => toolCall("c" + Math.random(), "getWeather", { city: "X" });
    const steps = [];
    for await (const s of agent({ call, tools, messages: userMsg, maxSteps: 3 })) steps.push(s);
    const toolStarts = steps.filter((s) => s.type === "tool-start");
    expect(toolStarts).toHaveLength(3);
    expect((steps.at(-1) as any).type).toBe("final");
  });

  it("throws when the signal is already aborted", async () => {
    const call = scriptedModel([{ role: "assistant", content: "hi", tool_calls: [] }]);
    const signal = AbortSignal.abort(new Error("stop"));
    await expect(async () => {
      for await (const _ of agent({ call, tools, messages: userMsg, signal })) {
        /* drain */
      }
    }).rejects.toThrow("stop");
  });

  it("aborts mid-run before the next tool runs", async () => {
    const controller = new AbortController();
    const sendEmail = vi.fn(() => ({ sent: true }));
    const t: ToolSet = {
      ...tools,
      sendEmail: { description: "send", parameters: { type: "object", properties: {} }, run: sendEmail },
    };
    // Model wants getWeather, then sendEmail. We abort after the first tool ends.
    const call = scriptedModel([
      toolCall("c1", "getWeather", { city: "Delhi" }),
      toolCall("c2", "sendEmail", {}),
    ]);

    const seen: string[] = [];
    await expect(async () => {
      for await (const s of agent({ call, tools: t, messages: userMsg, signal: controller.signal })) {
        seen.push(s.type);
        if (s.type === "tool-end") controller.abort(new Error("cancelled"));
      }
    }).rejects.toThrow("cancelled");

    // getWeather ran; sendEmail was never reached.
    expect(seen).toEqual(["tool-start", "tool-end"]);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("tool() is a typed pass-through", () => {
    const t = tool<{ city: string }, { tempC: number }>({
      description: "weather",
      parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
      run: ({ city }) => ({ tempC: city.length }),
    });
    expect(t.run({ city: "Delhi" })).toEqual({ tempC: 5 });
  });
});
