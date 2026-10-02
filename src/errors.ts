export interface TokenDiagnostic {
  stage: "token_fetch" | "token_body" | "token_rejected" | "token_schema";
  status?: number;
  reason?: "timeout" | "network";
  providerError?: "invalid_grant" | "interaction_required" | "consent_required" | "invalid_client" | "unauthorized_client" | "invalid_scope" | "other";
  invalidFields?: string[];
}
export class AppError extends Error {
  constructor(public code: string, public status: number, message: string, public retryAfter?: number, public diagnostic?: TokenDiagnostic) { super(message); }
}

export const failure = (error: unknown): AppError => error instanceof AppError ? error
  : new AppError("temporarily_unavailable", 503, "The service is temporarily unavailable. Please try again.");

export function json(value: unknown, status = 200, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra } });
}

export function errorResponse(error: unknown, correlationId: string): Response {
  const safe = failure(error);
  // Diagnostics contain fixed stages/field names and HTTP status, never response values or descriptions.
  console.warn(JSON.stringify({ event: "request_failed", code: safe.code, correlationId, ...(safe.diagnostic ? { diagnostic: safe.diagnostic } : {}) }));
  return json({ error: { code: safe.code, message: safe.message, correlationId } }, safe.status,
    safe.retryAfter ? { "Retry-After": String(safe.retryAfter) } : {});
}
