// `escape-every-interpolated-value`. Everything a buyer types reaches the
// owner's inbox from the owner's own verified sending domain, which is the most
// trusted From: address that inbox will ever see. It arrives as inert text.

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] as string);
}

export const FIELD_MAX_LENGTH = 500;

/**
 * Coerces an untrusted value to a bounded single-line string. Non-strings
 * become "" rather than "[object Object]" or "undefined"; CR and LF are removed
 * so no value can forge a mail header or a second log line.
 */
export function capField(value: unknown, max: number = FIELD_MAX_LENGTH): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\r\n\u2028\u2029]+/g, " ").slice(0, max);
}

/**
 * A single address, in the narrowest form we are willing to hand to Resend as
 * reply_to. Anything with whitespace, a comma, a semicolon or angle brackets is
 * refused: those are the shapes that smuggle a second recipient.
 */
export function isSingleEmailAddress(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (value.length > 254) return false;
  return /^[^\s@,;<>"]+@[^\s@,;<>".]+\.[^\s@,;<>"]+$/.test(value);
}

/** Resend tag values accept ASCII letters, digits, "_" and "-" only. */
export function sanitizeTagValue(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 256);
}

/**
 * Escaping makes a URL inert in the HTML part; the text/plain part is a second
 * surface, because most mail clients autolink a bare scheme. Defanged, so a
 * buyer-supplied address is never one click away in either part.
 */
export function defangUrls(value: string): string {
  return value.replace(/https?(?=:\/\/)/gi, (scheme) => (scheme.length === 5 ? "hxxps" : "hxxp"));
}
