import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  platform: "node",
  // engines.node 하한(24.18)에 맞춘다.
  target: "node24",
  dts: false,
  fixedExtension: false,
  clean: true,
});
