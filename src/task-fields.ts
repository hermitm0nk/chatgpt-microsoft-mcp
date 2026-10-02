import { AppError } from "./errors";

// Graph documents HTML-only To Do bodies. Plain text is escaped before conversion.
const htmlEscape = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
export function graphFields(fields: Record<string, unknown>): Record<string, unknown> {
  const result = { ...fields };
  if (result.body) {
    const body = result.body as { content: string; contentType: string };
    if (body.contentType === "text") result.body = { contentType: "html", content: htmlEscape(body.content).replace(/\n/g, "<br>") };
  }
  for (const field of ["dueDateTime", "startDateTime", "reminderDateTime"]) {
    if (result[field]) result[field] = toUTC(result[field] as { dateTime: string; timeZone: string });
  }
  return result;
}
export function toUTC(value: { dateTime: string; timeZone: string }) {
  if (value.timeZone === "UTC") return value;
  const wall = Date.parse(value.dateTime.slice(0, 19) + "Z");
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: value.timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const localTimestamp = (instant: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(p => [p.type, p.value]));
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  };
  // Gather offsets on both sides of a possible transition, then round-trip candidates.
  const offsets = new Set<number>();
  for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
    const sample = wall + hours * 3_600_000;
    offsets.add(localTimestamp(sample) - sample);
  }
  const candidates = [...offsets].map(offset => wall - offset).filter(instant => localTimestamp(instant) === wall);
  if (candidates.length !== 1) throw new AppError("ambiguous_date_time", 400, "This local time is ambiguous or does not exist because of a clock change. Provide an explicit UTC time.");
  return { dateTime: new Date(candidates[0]).toISOString().slice(0, 19) + value.dateTime.slice(19), timeZone: "UTC" };
}
