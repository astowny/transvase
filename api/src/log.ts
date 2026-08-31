// `allowlisted-logging`. One helper, one allowlist. Never a whole object and
// never JSON.stringify(err): a Stripe error object carries the full
// PaymentIntent, including payment_method_details — brand, last4, country.
// Never fetch(..., { verbose: true }) either; it prints Authorization headers.

const ALLOWED_FIELDS = [
  "site",
  "plan",
  "pi_id",
  "event_id",
  "status",
  "error_code",
  "ip_hash",
] as const;

export type LogField = (typeof ALLOWED_FIELDS)[number];
export type LogFields = Partial<Record<LogField, string | number>>;

function line(level: "info" | "error", event: string, fields: LogFields): string {
  const parts = [`level=${level}`, `event=${sanitize(event)}`];
  for (const name of ALLOWED_FIELDS) {
    const value = fields[name];
    if (value === undefined) continue;
    parts.push(`${name}=${sanitize(String(value))}`);
  }
  return parts.join(" ");
}

function sanitize(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, "_").slice(0, 200);
}

export function log(event: string, fields: LogFields = {}): void {
  console.log(line("info", event, fields));
}

export function logError(event: string, fields: LogFields = {}): void {
  console.error(line("error", event, fields));
}

/**
 * The only thing an unknown error is ever allowed to contribute to a log line:
 * its class name. Not its message, which for a Stripe error can carry buyer and
 * card detail.
 */
export function errorCode(error: unknown): string {
  if (error instanceof Error) return sanitize(error.name).slice(0, 64);
  return "non_error_throw";
}
