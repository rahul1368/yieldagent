/**
 * Optional Zod integration. Define a tool from a Zod schema and get two things
 * for free: a JSON Schema for the model, and runtime validation of the
 * arguments the model sends back. Invalid arguments are reported to the model
 * (as a tool error) so it can correct itself instead of your `run` crashing.
 *
 * Zod is a peer dependency, install it yourself: `npm install zod`.
 */
import type { ZodTypeAny, infer as Infer } from "zod";
import type { Tool } from "./index.js";

export interface ZodToolDef<Schema extends ZodTypeAny, Result> {
  description: string;
  /** A Zod schema for the tool's arguments (usually a `z.object({...})`). */
  schema: Schema;
  run: (args: Infer<Schema>) => Result | Promise<Result>;
}

/**
 * Build a `Tool` from a Zod schema.
 *
 * @example
 * import { z } from "zod";
 * import { zodTool } from "yieldagent/zod";
 *
 * const getWeather = zodTool({
 *   description: "Get the weather for a city",
 *   schema: z.object({ city: z.string() }),
 *   run: ({ city }) => ({ city, tempC: 31 }), // `city` is typed as string
 * });
 */
export function zodTool<Schema extends ZodTypeAny, Result = unknown>(
  def: ZodToolDef<Schema, Result>,
): Tool<Infer<Schema>, Result> {
  return {
    description: def.description,
    parameters: zodToJsonSchema(def.schema),
    run: (args: unknown) => {
      const parsed = def.schema.safeParse(args);
      if (!parsed.success) {
        const detail = parsed.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ");
        throw new Error(`Invalid arguments: ${detail}`);
      }
      return def.run(parsed.data);
    },
  };
}

/**
 * A small Zod -> JSON Schema converter covering the subset used by tool args:
 * objects, strings, numbers, booleans, enums, arrays, literals, and the
 * optional/nullable/default wrappers. Unknown types fall back to permissive.
 * For exotic schemas, pass `parameters` manually via the base `tool()` instead.
 */
/** The subset of Zod's internal `_def` this converter reads. */
interface ZodDef {
  typeName?: string;
  description?: string;
  shape?: (() => Record<string, ZodTypeAny>) | Record<string, ZodTypeAny>;
  values?: readonly string[] | Record<string, string>;
  type?: ZodTypeAny;
  innerType?: ZodTypeAny;
  value?: unknown;
}

function defOf(schema: ZodTypeAny): ZodDef | undefined {
  return (schema as { _def?: ZodDef })._def;
}

export function zodToJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  const def = defOf(schema);
  const typeName = def?.typeName;
  const description = (schema as { description?: string }).description ?? def?.description;
  const withDesc = (obj: Record<string, unknown>) =>
    description ? { description, ...obj } : obj;

  switch (typeName) {
    case "ZodObject": {
      const shape = typeof def!.shape === "function" ? def!.shape() : def!.shape ?? {};
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(value);
        if (!isOptional(value)) required.push(key);
      }
      return withDesc({
        type: "object",
        properties,
        ...(required.length ? { required } : {}),
      });
    }
    case "ZodString":
      return withDesc({ type: "string" });
    case "ZodNumber":
      return withDesc({ type: "number" });
    case "ZodBoolean":
      return withDesc({ type: "boolean" });
    case "ZodEnum":
      return withDesc({ type: "string", enum: def!.values });
    case "ZodNativeEnum":
      return withDesc({ type: "string", enum: Object.values(def!.values ?? {}) });
    case "ZodArray":
      return withDesc({ type: "array", items: zodToJsonSchema(def!.type as ZodTypeAny) });
    case "ZodLiteral":
      return withDesc({ const: def!.value });
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
      return zodToJsonSchema(def!.innerType as ZodTypeAny);
    default:
      return withDesc({});
  }
}

function isOptional(schema: ZodTypeAny): boolean {
  const typeName = defOf(schema)?.typeName;
  return typeName === "ZodOptional" || typeName === "ZodDefault";
}
