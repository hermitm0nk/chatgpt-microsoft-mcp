// Fixed, low-cardinality fields only. Never include owners, URLs, headers,
// provider descriptions, account labels, task data or credential values.
type Measurement =
  | { event: "microsoft_token_exchange"; grant: "code" | "refresh" | "other"; outcome: "success" | "failure"; durationMs: number }
  | { event: "graph_request"; method: "GET" | "POST" | "PATCH" | "DELETE"; status: number; durationMs: number }
  | { event: "microsoft_authorization"; outcome: "connected" | "cancelled" | "confirm_replacement" };

export function measure(value: Measurement): void {
  console.info(JSON.stringify(value));
}
export const elapsed = (start: number) => Math.max(0, Math.round(performance.now() - start));
