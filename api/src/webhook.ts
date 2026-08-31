// Stripe webhook signature verification and event parsing.
//
// Four controls carry this file. Every v1 signature is checked so a secret
// rotation works, while v0 and any future scheme are ignored (the documented
// downgrade defence). The 300 s tolerance is what stops a captured signature
// replaying forever. The HMAC is computed over the raw BYTES: req.text() would
// replace every invalid UTF-8 byte with U+FFFD and the signature would then
// silently never match on a fraction of requests. And a length guard runs
// before timingSafeEqual, which throws ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH on
// unequal buffers and would turn `Stripe-Signature: t=1,v1=aa` into a 500.

import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_TOLERANCE_SECONDS = 300;

export interface StripeSignatureHeader {
  timestamp: number | null;
  v1: string[];
}

/**
 * Only the fields this service reads. A Stripe event object carries dozens more
 * (payment_method_details, charges, review, …) and modelling them is neither
 * possible nor desirable here — the unmodelled remainder is dropped by
 * parseEvent rather than typed as `any`.
 */
export interface StripeEventObject {
  id: string;
  object: string;
  amount: number | null;
  currency: string | null;
  description: string | null;
  receipt_email: string | null;
  metadata: Record<string, string>;
  last_payment_error: {
    code: string | null;
    decline_code: string | null;
    message: string | null;
  } | null;
}

export interface StripeEvent {
  id: string;
  type: string;
  created: number;
  data: { object: StripeEventObject };
}

export function computeSignature(timestamp: number, raw: Uint8Array, secret: string): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(`${timestamp}.`);
  hmac.update(raw);
  return hmac.digest("hex");
}

export function parseSignatureHeader(header: string): StripeSignatureHeader {
  let timestamp: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const scheme = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (scheme === "t") {
      if (/^\d{1,15}$/.test(value)) timestamp = Number(value);
    } else if (scheme === "v1") {
      v1.push(value);
    }
    // v0 and every unknown scheme are dropped here, on purpose.
  }
  return { timestamp, v1 };
}

export function verifySignature(
  raw: Uint8Array,
  header: string,
  secret: string,
  nowSeconds: number,
  toleranceSeconds: number = SIGNATURE_TOLERANCE_SECONDS,
): boolean {
  const { timestamp, v1 } = parseSignatureHeader(header);
  if (timestamp === null || v1.length === 0) return false;
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;

  const expected = Buffer.from(computeSignature(timestamp, raw, secret), "hex");
  let matched = false;
  for (const candidate of v1) {
    // Length guard. Without it a truncated or non-hex signature reaches
    // timingSafeEqual, which throws rather than returning false.
    if (!/^[0-9a-fA-F]{64}$/.test(candidate)) continue;
    const given = Buffer.from(candidate, "hex");
    if (given.length !== expected.length) continue;
    // No early return: every candidate is compared, so the answer does not leak
    // which position matched.
    if (timingSafeEqual(given, expected)) matched = true;
  }
  return matched;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses the verified bytes into the narrow shape above, or null. Never `any`. */
export function parseEvent(raw: Uint8Array): StripeEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;

  const id = parsed.id;
  const type = parsed.type;
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof type !== "string" || type.length === 0) return null;
  if (!isPlainObject(parsed.data)) return null;
  const object = parsed.data.object;
  if (!isPlainObject(object)) return null;

  // Object.fromEntries defines own properties, so a metadata key literally
  // named "__proto__" cannot reach Object.prototype.
  const rawMetadata = isPlainObject(object.metadata) ? object.metadata : {};
  const metadata = Object.fromEntries(
    Object.entries(rawMetadata).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );

  const rawError = isPlainObject(object.last_payment_error) ? object.last_payment_error : null;

  return {
    id,
    type,
    created: optionalNumber(parsed.created) ?? 0,
    data: {
      object: {
        id: typeof object.id === "string" ? object.id : "",
        object: typeof object.object === "string" ? object.object : "",
        amount: optionalNumber(object.amount),
        currency: optionalString(object.currency),
        description: optionalString(object.description),
        receipt_email: optionalString(object.receipt_email),
        metadata,
        last_payment_error:
          rawError === null
            ? null
            : {
                code: optionalString(rawError.code),
                decline_code: optionalString(rawError.decline_code),
                message: optionalString(rawError.message),
              },
      },
    },
  };
}
