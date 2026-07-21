# Changelog

All notable changes to this project are documented here. The format is loosely
based on [Keep a Changelog](https://keepachangelog.com), and the project follows
semantic versioning.

## 0.3.0

### Added
- **Streaming**: pass `stream` instead of `call` to receive `token` steps as the
  model produces text. New `openaiCompatibleStream` adapter assembles streamed
  tool-call deltas. Tools, pause/resume, and cancellation all still work.
- **Zod integration** (`yieldagent/zod`): `zodTool` derives a JSON Schema from a
  Zod schema and validates the model's arguments, reporting invalid arguments
  back to the model so it can correct itself. Zod is an optional peer dependency.
- **Visual demo** of the human-in-the-loop flow in `examples/demo` (runs in the
  browser, no API key).

### Changed
- Replaced every `any` in the library with precise types (`unknown` for
  model-supplied data, typed interfaces for streaming and Zod internals). New
  `ToolSet` type for the tools map.

## 0.2.0

### Added
- **Cancellation** via an optional `AbortSignal` (`agent`/`resume` accept
  `signal`). The loop aborts at the next checkpoint and forwards the signal to
  the model call.
- **`tool<Args>()`** helper to type a tool's `run` argument.
- `ModelCall` gained an optional third `options` argument (backward compatible).

## 0.1.0

- Initial release: a zero-dependency async-generator agent loop with
  human-in-the-loop pause/resume, an OpenAI-compatible adapter, and full types.
