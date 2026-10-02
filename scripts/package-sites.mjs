import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const run = promisify(execFile);
await run("git", ["diff", "--exit-code"]);
await run("git", ["diff", "--cached", "--exit-code"]);
const { stdout } = await run("git", ["rev-parse", "HEAD"]);
const commit = stdout.trim();
const hosting = JSON.parse(await readFile(".openai/hosting.json", "utf8"));
if (!hosting.project_id || hosting.static || hosting.d1 !== "DB" || !hosting.capabilities?.includes("mcp"))
  throw new Error("Unexpected Site configuration.");
await access("dist/server/index.js");
await access("dist/server/wrangler.json");
const archive = resolve(`/tmp/todo-bridge-${commit}.tar.gz`);
await run("tar", ["-czf", archive, ".openai/hosting.json", "dist/server", "drizzle"]);
const { stdout: members } = await run("tar", ["-tzf", archive]);
if (!members.includes("dist/server/index.js") || members.includes(".dev.vars") || members.includes("node_modules"))
  throw new Error("Invalid deployment archive.");
console.log(JSON.stringify({ project_id: hosting.project_id, commit_sha: commit, archive }));
