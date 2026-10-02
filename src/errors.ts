export class AppError extends Error {
  constructor(public code: string, public status: number, message: string, public retryAfter?: number) { super(message); }
}

export const failure = (error: unknown): AppError => error instanceof AppError ? error
  : new AppError("temporarily_unavailable", 503, "The service is temporarily unavailable. Please try again.");

export function json(value: unknown, status = 200, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra } });
}

export function errorResponse(error: unknown, correlationId: string): Response {
  const safe = failure(error);
  // Only fixed codes and random correlation IDs are logged, never provider/request content.
  console.warn(JSON.stringify({ event: "request_failed", code: safe.code, correlationId }));
  return json({ error: { code: safe.code, message: safe.message, correlationId } }, safe.status,
    safe.retryAfter ? { "Retry-After": String(safe.retryAfter) } : {});
}
