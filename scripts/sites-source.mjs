import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline";

// Fallback for environments that do not include the Sites workflow helper.
// Credentials arrive over stdin and exist only in the child-process environment.
// Never put them in Git remotes, arguments, files, or console output.
const action = process.argv[2];
if (!["inspect", "push"].includes(action)) throw new Error("Expected inspect or push.");
if (process.stdin.isTTY) process.stdin.setRawMode(true);
const input = createInterface({ input: process.stdin, terminal: false });
console.log("Ready for Sites source credential JSON on stdin (input is hidden).");
const [line] = await new Promise(resolve => input.once("line", value => resolve([value])));
input.close();
if (process.stdin.isTTY) process.stdin.setRawMode(false);
const credential = JSON.parse(line);
const remote = new URL(credential.remote_url);
if (remote.protocol !== "https:" || remote.username || remote.password || credential.auth_mode !== "http_extra_header" || !credential.token || !credential.branch)
  throw new Error("Unsupported source credential.");
const childEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_COUNT: "2",
  GIT_CONFIG_KEY_0: `http.${credential.remote_url}.extraHeader`, GIT_CONFIG_VALUE_0: `Authorization: Bearer ${credential.token}`,
  GIT_CONFIG_KEY_1: "http.followRedirects", GIT_CONFIG_VALUE_1: "false" };
const git = promisify(execFile);
try {
  if (action === "inspect") {
    const { stdout } = await git("git", ["ls-remote", credential.remote_url, `refs/heads/${credential.branch}`], { env: childEnv });
    console.log(JSON.stringify({ branch: credential.branch, refs: stdout.trim() }));
    if (stdout.trim()) {
      await git("git", ["fetch", credential.remote_url, `refs/heads/${credential.branch}:refs/remotes/sites/${credential.branch}`], { env: childEnv });
      console.log("Fetched the existing Sites source branch for inspection.");
    }
  } else {
    await git("git", ["diff", "--exit-code"], { env: childEnv });
    await git("git", ["diff", "--cached", "--exit-code"], { env: childEnv });
    const { stdout: sha } = await git("git", ["rev-parse", "HEAD"], { env: childEnv });
    await git("git", ["push", credential.remote_url, `HEAD:refs/heads/${credential.branch}`], { env: childEnv });
    console.log(JSON.stringify({ commit_sha: sha.trim(), branch: credential.branch, pushed: true }));
  }
} catch (error) {
  // Avoid echoing the credential-bearing environment or untrusted Git diagnostics.
  const diagnostic = String(error.stderr || "").replaceAll(credential.token, "[redacted]")
    .replace(/(?:authorization|token|password)[^\r\n]*/gi, "[redacted]").slice(0, 2000);
  console.error(JSON.stringify({ error: "Sites source operation failed", action, exitCode: error.code || null, diagnostic }));
  process.exitCode = 1;
}
