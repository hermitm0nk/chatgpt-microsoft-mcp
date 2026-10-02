import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { resolveOwner, requireWrite } from "./auth";
import { baseUrl, settingsUrl } from "./config";
import { AppError, failure } from "./errors";
import { Graph } from "./graph";
import { readJson } from "./http";
import { Store } from "./store";
import { graphFields } from "./task-fields";
import { TOOL_DESCRIPTIONS, pageFields, resourceId, createSchema, updateSchema } from "./tool-schemas";
import type { Dependencies, Owner } from "./types";

const writes = new Set(["todo_create_task", "todo_update_task", "todo_complete_task", "todo_delete_task"]);
const rpcSchema = z.object({ jsonrpc: z.literal("2.0"), id: z.union([z.string().max(200), z.number().finite()]).optional(), method: z.string().max(100), params: z.unknown().optional() }).strict();
export async function mcp(request: Request, store: Store, deps: Dependencies): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  const origin = request.headers.get("Origin");
  if (new URL(request.url).origin !== baseUrl(store.env) || (origin && origin !== baseUrl(store.env))) throw new AppError("invalid_origin", 403, "Requests from this origin are not permitted.");
  const message = await readJson(request, rpcSchema);
  let owner: Owner | undefined;
  if (message.method === "tools/call" || request.headers.has("X-MCP-API-Key")) {
    owner = await resolveOwner(request, store.env, store);
    await store.limit(`mcp:owner:${owner.id}`, 120);
    if (owner.tokenId) await store.limit(`mcp:token:${owner.tokenId}`, 60);
    const name = z.object({ name: z.string() }).safeParse(message.params);
    if (name.success && writes.has(name.data.name)) requireWrite(owner);
  }
  const server = new McpServer({ name: "microsoft-todo", version: "0.1.0" }, { capabilities: { tools: {} } });
  const run = async (action: (owner: Owner, graph: Graph) => Promise<unknown>) => {
    try {
      if (!owner) throw new AppError("authentication_required", 401, "Connect using ChatGPT or a personal API token.");
      const data = await action(owner, new Graph(store, owner, deps.fetch));
      const structured = data as Record<string, unknown>;
      const text = JSON.stringify(data);
      if (new TextEncoder().encode(text).byteLength > 2_097_152) throw new AppError("result_too_large", 413, "Request fewer tasks per page.");
      return { content: [{ type: "text" as const, text }], structuredContent: structured };
    } catch (error) {
      const safe = failure(error);
      const data = { error: { code: safe.code, message: safe.message, ...(safe.retryAfter ? { retryAfter: safe.retryAfter } : {}) }, settingsUrl: settingsUrl(store.env) };
      return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(data) }], structuredContent: data };
    }
  };
  const annotations = (write: boolean, destructive = false) => ({ readOnlyHint: !write, destructiveHint: destructive,
    idempotentHint: !write || destructive, openWorldHint: true });
  server.registerTool("todo_connection_status", { description: TOOL_DESCRIPTIONS.todo_connection_status, inputSchema: z.object({}).strict(), annotations: annotations(false) },
    () => run(async o => {
      const connection = await store.connection(o.id);
      return { state: connection?.status || "not_connected", accountLabel: connection?.label, permission: o.permission, settingsUrl: settingsUrl(store.env) };
    }));
  server.registerTool("todo_list_lists", { description: TOOL_DESCRIPTIONS.todo_list_lists, inputSchema: z.object(pageFields).strict(), annotations: annotations(false) },
    args => run(async (_o, graph) => graph.listLists(args.limit, args.cursor)));
  server.registerTool("todo_list_tasks", { description: TOOL_DESCRIPTIONS.todo_list_tasks, inputSchema: z.object({ listId: resourceId, ...pageFields }).strict(), annotations: annotations(false) },
    args => run(async (_o, graph) => graph.listTasks(args.listId, args.limit, args.cursor)));
  server.registerTool("todo_get_task", { description: TOOL_DESCRIPTIONS.todo_get_task, inputSchema: z.object({ listId: resourceId, taskId: resourceId }).strict(), annotations: annotations(false) },
    args => run(async (_o, graph) => graph.getTask(args.listId, args.taskId)));
  server.registerTool("todo_create_task", { description: TOOL_DESCRIPTIONS.todo_create_task, inputSchema: z.object({ listId: resourceId, task: createSchema }).strict(), annotations: annotations(true) },
    args => run(async (_o, graph) => graph.createTask(args.listId, graphFields(args.task))));
  server.registerTool("todo_update_task", { description: TOOL_DESCRIPTIONS.todo_update_task, inputSchema: z.object({ listId: resourceId, taskId: resourceId, updates: updateSchema }).strict(), annotations: annotations(true) },
    args => run(async (_o, graph) => graph.updateTask(args.listId, args.taskId, graphFields(args.updates))));
  server.registerTool("todo_complete_task", { description: TOOL_DESCRIPTIONS.todo_complete_task, inputSchema: z.object({ listId: resourceId, taskId: resourceId }).strict(), annotations: annotations(true) },
    args => run(async (_o, graph) => graph.updateTask(args.listId, args.taskId, { status: "completed" })));
  server.registerTool("todo_delete_task", { description: TOOL_DESCRIPTIONS.todo_delete_task, inputSchema: z.object({ listId: resourceId, taskId: resourceId }).strict(), annotations: annotations(true, true) },
    args => run(async (_o, graph) => graph.deleteTask(args.listId, args.taskId)));

  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 32_768 });
  await server.connect(transport);
  try {
    const response = await transport.handleRequest(request, { parsedBody: message });
    // JSON responses are complete before cleanup; there is no long-lived session/SSE stream.
    return new Response(response.body, { status: response.status, headers: response.headers });
  } finally { await server.close(); }
}
