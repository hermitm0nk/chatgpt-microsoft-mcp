import { build } from "esbuild";
import { mkdir, writeFile, copyFile } from "node:fs/promises";

// Framework-independent Worker output for Sites' supported server artifact shape.
await build({ entryPoints: ["src/worker.ts"], outfile: "dist/worker.js", bundle: true,
  format: "esm", platform: "browser", target: "es2022", external: ["cloudflare:workers"],
  conditions: ["workerd", "worker", "browser"], sourcemap: false });
await mkdir("dist/server", { recursive: true });
await copyFile("dist/worker.js", "dist/server/index.js");
await writeFile("dist/server/wrangler.json", JSON.stringify({
  name: "todo-bridge", main: "index.js", compatibility_date: "2026-08-06", compatibility_flags: ["nodejs_compat"],
  d1_databases: [{ binding: "DB", database_name: "todo-bridge", migrations_dir: "../../drizzle" }],
}, null, 2) + "\n");
