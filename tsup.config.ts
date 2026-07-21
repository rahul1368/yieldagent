import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/openai.ts", "src/zod.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  minify: false,
  treeshake: true,
  target: "es2022",
});
