// Owner notifications, sent with a raw fetch. No SDK: three headers and a JSON
// body do not justify a dependency, and every header below is one that has
// actually bitten someone.

import { formatAmount, type Locale, type SiteConfig } from "./catalog.ts";
import { capField, defangUrls, escapeHtml, isSingleEmailAddress, sanitizeTagValue } from "./escape.ts";
import { errorCode, log, logError } from "./log.ts";

/** The only verified sending domain on the Resend account. Not per-site. */
export const SENDING_DOMAIN = "send.devanchor.company";
const FROM_ADDRESS = `no-reply@${SENDING_DOMAIN}`;
const RESEND_ENDPOINT = "https://api.resend.com/emails";
/** Resend answers 403 (code 1010) to a request with no User-Agent. */
const USER_AGENT = "devanchor-sites/1.0";

/** Bun's fetch has no default timeout; without this a hung POST hangs forever. */
export const RESEND_REQUEST_TIMEOUT_MS = 8000;
export const MAX_RESEND_RETRIES = 2;
/**
 * Resend keeps an idempotency key for 24 h. The whole window here is well under
 * a minute, so a retry is always a retry and never a genuine duplicate.
 */
export const RESEND_RETRY_DELAYS_MS: readonly number[] = [2000, 6000];

/** Every subject carries this, because there is no live code path in this service. */
const TEST_PREFIX = "[TEST]";

export interface ResendEmailPayload {
  from: string;
  to: string;
  reply_to?: string;
  subject: string;
  html: string;
  text: string;
  tags: { name: string; value: string }[];
}

export interface OwnerEmailInput {
  site: SiteConfig;
  kind: "purchase" | "failure";
  locale: Locale;
  planId: string;
  planLabel: string;
  amountMinor: number;
  currency: string;
  buyerEmail: string | null;
  buyerName: string | null;
  paymentIntentId: string;
  eventId: string;
  failureCode: string | null;
  failureMessage: string | null;
}

export interface LeadEmailInput {
  site: SiteConfig;
  locale: Locale;
  fields: Record<string, string>;
  ipHash: string;
}

type Row = [label: string, value: string];

function subjectLine(parts: string[]): string {
  return capField(parts.filter((part) => part.length > 0).join(" "), 200);
}

function renderHtml(title: string, rows: Row[]): string {
  const body = rows
    .map(([label, value]) => `<tr><th align="left">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join("");
  // No anchor and no image anywhere in this template. A buyer-supplied string
  // must never be able to become a branded phishing link or a tracking pixel
  // delivered from the owner's own verified domain.
  return `<div><h1>${escapeHtml(title)}</h1><table>${body}</table></div>`;
}

function renderText(title: string, rows: Row[]): string {
  const body = rows.map(([label, value]) => `${label}: ${defangUrls(value)}`).join("\n");
  return `${title}\n\n${body}\n`;
}

function tagsFor(site: SiteConfig, kind: string): { name: string; value: string }[] {
  return [
    { name: "site", value: sanitizeTagValue(site.id) },
    { name: "kind", value: sanitizeTagValue(kind) },
  ];
}

function withReplyTo(payload: ResendEmailPayload, address: string | null): ResendEmailPayload {
  if (address === null || !isSingleEmailAddress(address)) return payload;
  return { ...payload, reply_to: address };
}

/**
 * `email-content-comes-from-the-event-never-from-the-catalog`. Amount, currency,
 * label and buyer address are whatever the event carried; a rollback to an image
 * whose catalog predates a plan id must never silence a notification.
 */
export function buildOwnerEmail(input: OwnerEmailInput): ResendEmailPayload {
  const label = capField(input.planLabel);
  const amountLabel = formatAmount(input.amountMinor, input.currency, input.locale);
  const declined = input.kind === "failure";
  const title = declined ? "Payment declined" : "Payment succeeded";

  const candidates: Row[] = [
    ["Plan", `${label} (${capField(input.planId, 100)})`],
    ["Amount", amountLabel],
    ["Buyer", capField(input.buyerEmail)],
    ["Buyer name", capField(input.buyerName)],
    ["PaymentIntent", capField(input.paymentIntentId, 100)],
    ["Event", capField(input.eventId, 100)],
    ["Mode", "test"],
  ];
  const rows: Row[] = candidates.filter(([, value]) => value.length > 0);

  if (declined) {
    rows.push(["Decline code", capField(input.failureCode, 100) || "unknown"]);
    const message = capField(input.failureMessage);
    if (message.length > 0) rows.push(["Decline message", message]);
  }

  const payload: ResendEmailPayload = {
    from: `${input.site.fromName} <${FROM_ADDRESS}>`,
    to: input.site.notifyTo,
    subject: subjectLine([TEST_PREFIX + (declined ? "[DECLINED]" : ""), input.site.fromName, "—", label, "—", amountLabel]),
    html: renderHtml(title, rows),
    text: renderText(title, rows),
    tags: tagsFor(input.site, declined ? "failure" : "purchase"),
  };
  return withReplyTo(payload, input.buyerEmail);
}

/** Field order is fixed here so the mail reads the same for both sites. */
export const LEAD_FIELDS = [
  "email",
  "name",
  "website",
  "trade",
  "goal",
  "source",
  "destination",
  "volume",
] as const;

export function buildLeadEmail(input: LeadEmailInput): ResendEmailPayload {
  const rows: Row[] = [];
  for (const field of LEAD_FIELDS) {
    const value = capField(input.fields[field]);
    if (value.length > 0) rows.push([field, value]);
  }
  rows.push(["Locale", input.locale]);
  rows.push(["Client", capField(input.ipHash, 64)]);
  rows.push(["Mode", "test"]);

  const address = typeof input.fields.email === "string" ? input.fields.email : null;
  const payload: ResendEmailPayload = {
    from: `${input.site.fromName} <${FROM_ADDRESS}>`,
    to: input.site.notifyTo,
    subject: subjectLine([`${TEST_PREFIX}[LEAD]`, input.site.fromName, "—", capField(address, 254) || "no address"]),
    html: renderHtml("New lead", rows),
    text: renderText("New lead", rows),
    tags: tagsFor(input.site, "lead"),
  };
  return withReplyTo(payload, address);
}

/** The one mail a terminal Resend failure is allowed to send. Nobody replies to it. */
export function buildAlertEmail(site: SiteConfig, reason: string, eventId: string): ResendEmailPayload {
  const rows: Row[] = [
    ["Reason", capField(reason)],
    ["Event", capField(eventId, 100)],
    ["Mode", "test"],
  ];
  return {
    from: `${site.fromName} <${FROM_ADDRESS}>`,
    to: site.notifyTo,
    subject: subjectLine([`${TEST_PREFIX}[FAIL]`, site.fromName, "—", capField(reason, 120)]),
    html: renderHtml("Notification failed", rows),
    text: renderText("Notification failed", rows),
    tags: tagsFor(site, "alert"),
  };
}

/**
 * Retry only what a retry can fix. Everything else is terminal, because a
 * second identical POST to Resend for a 422 is a second identical failure.
 */
const RETRYABLE_ERROR_NAMES = new Set([
  "concurrent_idempotent_requests",
  "resource_locked",
  "rate_limit_exceeded",
  "network_error",
  "internal_server_error",
]);

export function classifyResendFailure(status: number, errorName: string | null): "retry" | "terminal" {
  if (errorName !== null && RETRYABLE_ERROR_NAMES.has(errorName)) return "retry";
  if (status === 0) return "retry"; // transport failure or timeout: no HTTP status
  if (status === 429) return "retry";
  if (status >= 500 && status <= 599) return "retry";
  return "terminal";
}

/** The subset of Resend's error body this service reads. */
interface ResendErrorBody {
  name?: unknown;
  message?: unknown;
}

function errorNameOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const name = (body as ResendErrorBody).name;
  return typeof name === "string" ? name : null;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface SendResult {
  ok: boolean;
  status: number;
  errorName: string | null;
}

/**
 * One POST, with retries. `idempotencyKey` is the Stripe event id, so a Stripe
 * redelivery that slips past the in-process dedupe still cannot produce a
 * second mail within Resend's 24 h retention.
 */
export async function sendEmail(
  apiKey: string,
  payload: ResendEmailPayload,
  idempotencyKey: string,
): Promise<SendResult> {
  let last: SendResult = { ok: false, status: 0, errorName: "not_attempted" };

  for (let attempt = 0; attempt <= MAX_RESEND_RETRIES; attempt += 1) {
    last = await postOnce(apiKey, payload, idempotencyKey);
    if (last.ok) return last;
    if (classifyResendFailure(last.status, last.errorName) === "terminal") return last;
    const delay = RESEND_RETRY_DELAYS_MS[attempt];
    if (delay === undefined) break;
    await sleep(delay);
  }
  return last;
}

async function postOnce(
  apiKey: string,
  payload: ResendEmailPayload,
  idempotencyKey: string,
): Promise<SendResult> {
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        // Bun sends no Content-Type for a string body; Resend needs it stated.
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        Authorization: `Bearer ${apiKey}`,
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(RESEND_REQUEST_TIMEOUT_MS),
    });

    if (response.ok) {
      log("resend_sent", { status: response.status, event_id: idempotencyKey });
      return { ok: true, status: response.status, errorName: null };
    }

    let name: string | null = null;
    try {
      name = errorNameOf(await response.json());
    } catch {
      name = null;
    }
    logError("resend_rejected", { status: response.status, error_code: name ?? "unknown", event_id: idempotencyKey });
    return { ok: false, status: response.status, errorName: name };
  } catch (error) {
    // Only the class name reaches the log; the message can carry recipient data.
    logError("resend_transport_error", { error_code: errorCode(error), event_id: idempotencyKey });
    return { ok: false, status: 0, errorName: "network_error" };
  }
}
