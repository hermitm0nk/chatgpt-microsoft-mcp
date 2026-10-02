import type { Env } from "./types";
import { AppError } from "./errors";

const encoder = new TextEncoder();
export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unbase64url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid encoding");
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
}
export const random = (length = 32): string => base64url(crypto.getRandomValues(new Uint8Array(length)));
export async function hash(value: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}
export function constantEqual(a: string, b: string): boolean {
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return difference === 0;
}
async function key(env: Env, id: string): Promise<CryptoKey> {
  const keys = JSON.parse(env.TOKEN_ENCRYPTION_KEYS || "{}");
  if (!Object.hasOwn(keys, id) || typeof keys[id] !== "string") throw new Error("Missing key");
  const bytes = unbase64url(keys[id]);
  if (bytes.length !== 32) throw new Error("Invalid key");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function encrypt(env: Env, binding: string, value: unknown): Promise<string> {
  try {
    const kid = env.TOKEN_ENCRYPTION_KEY_ID;
    if (!kid) throw new Error("Missing active key");
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aad = encoder.encode(`todo:v1:${kid}:${binding}`);
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, await key(env, kid), encoder.encode(JSON.stringify(value)));
    return JSON.stringify({ v: 1, kid, iv: base64url(iv), data: base64url(new Uint8Array(ciphertext)) });
  } catch { throw new AppError("encryption_unavailable", 503, "Credential storage is unavailable. Contact the operator."); }
}
export async function decrypt<T>(env: Env, binding: string, ciphertext: string): Promise<T> {
  try {
    const envelope = JSON.parse(ciphertext);
    if (envelope.v !== 1 || typeof envelope.kid !== "string") throw new Error("Invalid envelope");
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unbase64url(envelope.iv),
      additionalData: encoder.encode(`todo:v1:${envelope.kid}:${binding}`) }, await key(env, envelope.kid), unbase64url(envelope.data));
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  } catch { throw new AppError("encryption_unavailable", 503, "Credential storage is unavailable. Contact the operator."); }
}
