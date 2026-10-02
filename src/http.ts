import { z } from "zod";
import { AppError } from "./errors";
import { baseUrl } from "./config";
import type { Env } from "./types";

export async function boundedText(body: ReadableStream<Uint8Array> | null, limit: number): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new AppError("body_too_large", 413, "The response or request exceeds the allowed size.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const data = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(data);
}
export async function readJson<S extends z.ZodTypeAny>(request: Request, schema: S): Promise<z.output<S>> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") || "")) throw new AppError("invalid_content_type", 415, "Send JSON in the request body.");
  let value: unknown;
  try { value = JSON.parse(await boundedText(request.body, 32_768)); }
  catch (error) { if (error instanceof AppError) throw error; throw new AppError("invalid_request", 400, "The request body must contain valid JSON."); }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError("invalid_request", 400, "The request fields are invalid or unsupported.");
  return parsed.data;
}
export function protectBrowserWrite(request: Request, env: Env): void {
  if (request.headers.get("Origin") !== baseUrl(env) || request.headers.get("Sec-Fetch-Site") === "cross-site")
    throw new AppError("invalid_origin", 403, "This action must be started from this Site's Settings page.");
}
export const noRedirect = (url: string): Response => new Response(null, { status: 303, headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
