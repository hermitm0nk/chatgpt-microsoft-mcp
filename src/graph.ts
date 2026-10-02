import { z } from "zod";
import { decrypt, encrypt } from "./crypto";
import { AppError } from "./errors";
import { boundedText } from "./http";
import { now, Store } from "./store";
import { accessToken } from "./token-manager";
import type { Fetcher, Owner } from "./types";
import { requireWrite } from "./auth";

const ORIGIN = "https://graph.microsoft.com";
const ROOT = "/v1.0/me/todo/lists";
const cursorSchema = z.object({ url: z.string().max(4096), path: z.string(), connectionId: z.string(), expiresAt: z.number() });
const listSchema = z.object({ id: z.string().max(1024), displayName: z.string(), isOwner: z.boolean().optional(), isShared: z.boolean().optional(), wellknownListName: z.string().optional() });
const dateSchema = z.object({ dateTime: z.string().max(80), timeZone: z.string().max(80) }).nullable().optional();
const taskSchema = z.object({ id: z.string().max(1024), title: z.string(), status: z.string().max(80), importance: z.string().max(80),
  body: z.object({ content: z.string(), contentType: z.string().max(80) }).optional(),
  dueDateTime: dateSchema, startDateTime: dateSchema, reminderDateTime: dateSchema, completedDateTime: dateSchema,
  isReminderOn: z.boolean().optional(), createdDateTime: z.string().max(80).optional(), lastModifiedDateTime: z.string().max(80).optional() });

export function validateGraphUrl(raw: string, path: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new AppError("invalid_cursor", 400, "This pagination cursor is invalid. Start a new list request."); }
  if (url.origin !== ORIGIN || url.username || url.password || url.hash || url.pathname !== path || raw.length > 4096)
    throw new AppError("invalid_cursor", 400, "This pagination cursor is invalid for this operation.");
  return url;
}
function normalizeTask(raw: unknown) {
  const task = taskSchema.safeParse(raw);
  if (!task.success) throw new AppError("graph_unavailable", 503, "Microsoft To Do returned an unusable task.");
  const value = task.data;
  const truncated = value.title.length > 1024 || (value.body?.content.length || 0) > 16_384;
  return { ...value, title: value.title.slice(0, 1024), body: value.body ? { ...value.body, content: value.body.content.slice(0, 16_384) } : undefined, ...(truncated ? { truncated: true } : {}) };
}
export class Graph {
  constructor(private store: Store, private owner: Owner, private fetcher: Fetcher) {}
  private path(listId?: string, taskId?: string): string {
    return ROOT + (listId ? `/${encodeURIComponent(listId)}/tasks` : "") + (taskId ? `/${encodeURIComponent(taskId)}` : "");
  }
  private async request(url: URL, method: string, body?: unknown) {
    if (method !== "GET") requireWrite(this.owner);
    const access = await accessToken(this.store, this.owner.id, this.fetcher);
    const attempts = method === "GET" ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      let response: Response;
      try {
        response = await this.fetcher(url.toString(), { method, redirect: "error", signal: AbortSignal.timeout(15_000),
          headers: { Authorization: `Bearer ${access.token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
          body: body ? JSON.stringify(body) : undefined });
      } catch {
        if (method !== "GET") throw new AppError("write_outcome_unknown", 503, "Microsoft did not confirm this change. Check the task/list before retrying; repeating creation may duplicate it.");
        if (attempt + 1 < attempts) continue;
        throw new AppError("graph_unavailable", 503, "Microsoft To Do is temporarily unavailable. Try again.");
      }
      if (response.status === 401) {
        await response.body?.cancel();
        await this.store.db.prepare("UPDATE microsoft_connections SET status = 'reconnect_required' WHERE owner_id = ? AND id = ? AND status = 'connected'")
          .bind(this.owner.id, access.connectionId).run();
        throw new AppError("reconnect_required", 409, "Microsoft authorization is no longer usable. Reconnect from Settings.");
      }
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = retrySeconds(response.headers.get("Retry-After"));
        await response.body?.cancel();
        if (method === "GET" && attempt + 1 < attempts && retryAfter <= 1) {
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
          continue;
        }
        if (method !== "GET" && response.status >= 500) throw new AppError("write_outcome_unknown", 503, "Microsoft did not confirm this change. Check its outcome before retrying.");
        throw new AppError(response.status === 429 ? "graph_rate_limited" : "graph_unavailable", response.status === 429 ? 429 : 503,
          "Microsoft To Do is busy. Try again after the indicated delay.", retryAfter);
      }
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 404) throw new AppError("resource_not_found", 404, "The requested To Do list or task is unavailable to your Microsoft account.");
        if (response.status === 403) throw new AppError("graph_access_denied", 403, "Microsoft denied access to this To Do resource. Check your permissions or reconnect.");
        throw new AppError("graph_invalid_request", 400, "Microsoft rejected the task fields or resource identifiers.");
      }
      if (response.status === 204) return { data: null, connectionId: access.connectionId };
      let data: unknown;
      try { data = JSON.parse(await boundedText(response.body, 1_048_576)); }
      catch {
        throw new AppError(method === "GET" ? "graph_unavailable" : "write_outcome_unknown", 503,
          method === "GET" ? "Microsoft To Do returned an unusable response." : "Microsoft may have saved the change, but its response was unusable. Check before retrying.");
      }
      return { data, connectionId: access.connectionId };
    }
    throw new AppError("graph_unavailable", 503, "Microsoft To Do is temporarily unavailable.");
  }
  private async page(path: string, limit: number, cursor: string | undefined, tasks: boolean) {
    let url = new URL(`${ORIGIN}${path}`);
    url.searchParams.set("$top", String(limit));
    if (cursor) {
      let value: z.infer<typeof cursorSchema>;
      try { value = cursorSchema.parse(await decrypt(this.store.env, `cursor:${this.owner.id}:${path}`, cursor)); }
      catch { throw new AppError("invalid_cursor", 400, "The cursor is invalid for this user/operation. Start a new list request."); }
      const current = await this.store.connection(this.owner.id);
      if (value.expiresAt <= now() || value.path !== path || value.connectionId !== current?.id) throw new AppError("invalid_cursor", 400, "The cursor expired or your connection changed. Start a new list request.");
      url = validateGraphUrl(value.url, path);
      url.searchParams.set("$top", String(limit));
    }
    const response = await this.request(url, "GET");
    const page = z.object({ value: z.array(z.unknown()).max(100), "@odata.nextLink": z.string().max(4096).optional() }).safeParse(response.data);
    if (!page.success || page.data.value.length > limit) throw new AppError("graph_unavailable", 503, "Microsoft To Do returned an unusable page.");
    const items = page.data.value.map(value => {
      if (tasks) return normalizeTask(value);
      const list = listSchema.safeParse(value);
      if (!list.success) throw new AppError("graph_unavailable", 503, "Microsoft To Do returned an unusable list.");
      return { ...list.data, displayName: list.data.displayName.slice(0, 1024) };
    });
    const nextLink = page.data["@odata.nextLink"];
    const nextCursor = nextLink ? await encrypt(this.store.env, `cursor:${this.owner.id}:${path}`, {
      url: validateGraphUrl(nextLink, path).toString(), path, connectionId: response.connectionId, expiresAt: now() + 600_000 }) : undefined;
    return { items, nextCursor, untrustedContent: true };
  }
  listLists(limit: number, cursor?: string) { return this.page(this.path(), limit, cursor, false); }
  listTasks(listId: string, limit: number, cursor?: string) { return this.page(this.path(listId), limit, cursor, true); }
  async getTask(listId: string, taskId: string) { return { task: normalizeTask((await this.request(new URL(`${ORIGIN}${this.path(listId, taskId)}`), "GET")).data), untrustedContent: true }; }
  async createTask(listId: string, fields: unknown) { return { task: normalizeTask((await this.request(new URL(`${ORIGIN}${this.path(listId)}`), "POST", fields)).data), untrustedContent: true }; }
  async updateTask(listId: string, taskId: string, fields: unknown) { return { task: normalizeTask((await this.request(new URL(`${ORIGIN}${this.path(listId, taskId)}`), "PATCH", fields)).data), untrustedContent: true }; }
  async deleteTask(listId: string, taskId: string) { await this.request(new URL(`${ORIGIN}${this.path(listId, taskId)}`), "DELETE"); return { deleted: true, listId, taskId }; }
}
function retrySeconds(value: string | null): number {
  if (!value) return 1;
  const numeric = Number(value);
  const seconds = Number.isFinite(numeric) ? numeric : (Date.parse(value) - now()) / 1000;
  return Number.isFinite(seconds) ? Math.max(1, Math.min(3600, Math.ceil(seconds))) : 1;
}
