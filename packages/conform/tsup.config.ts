import { defineConfig } from "tsup";

export default defineConfig([
  // Main library entry
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    dts: false, // Use tsc for declarations instead
    clean: true,
    sourcemap: true,
    external: ["@standards-kit/core"],
  },
  // CLI entry (shebang preserved from source)
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    dts: false,
    sourcemap: true,
    external: ["@standards-kit/core"],
  },
]);
