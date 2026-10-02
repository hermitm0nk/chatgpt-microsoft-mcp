import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";

// This verifies the Worker bundle, not Sites publication readiness.
await build({ entryPoints: ["src/worker.ts"], outfile: "dist/worker.js", bundle: true,
  format: "esm", platform: "browser", target: "es2022", external: ["cloudflare:workers"],
  conditions: ["workerd", "worker", "browser"], sourcemap: false });
await mkdir("dist", { recursive: true });
await writeFile("dist/README.txt", "Development Worker bundle. Sites build integration and live identity/callback verification are required before publication.\n");
