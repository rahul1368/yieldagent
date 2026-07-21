/**
 * A tiny OpenAI-compatible adapter. Works with OpenAI, Anthropic's
 * OpenAI-compatible endpoint, Groq, Together, Ollama, OpenRouter, or any
 * server that speaks the /chat/completions shape.
 *
 * Bring your own `fetch` if you need a custom one; defaults to global fetch.
 */
import type { Message, ModelCall, ModelCallOptions, ToolSpec } from "./index.js";

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
