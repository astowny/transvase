// Form-encoded POSTs to the Stripe API. No SDK: this service touches two
// endpoints and the SDK would bring a dependency tree into an image that
// currently has none.

import { createHash } from "node:crypto";
import { errorCode, logError } from "./log.ts";

const STRIPE_API = "https://api.stripe.com";
const STRIPE_TIMEOUT_MS = 10_000;

export class StripeApiError extends Error {
  constructor(
    readonly status: number,
    readonly stripeCode: string,
  ) {
    // The message is a code, never Stripe's own prose: a Stripe error message
    // can carry buyer and card detail and this string reaches logs.
    super(`stripe_error status=${status} code=${stripeCode}`);
    this.name = "StripeApiError";
  }
}

/** Only the fields this service reads off a Stripe object. */
export interface StripeCustomer {
  id: string;
}

export interface StripePaymentIntent {
  id: string;
  client_secret: string | null;
}

/**
 * A 5-minute bucket keyed on the buyer and the client IP. A double-click, a
 * Traefik retry or a page reload replays the same Intent instead of creating a
 * second one.
 */
export function idempotencyFingerprint(email: string, ip: string, nowMs: number): string {
  const bucket = Math.floor(nowMs / 1000 / 300);
  return createHash("sha256").update(`${email}|${ip}|${bucket}`).digest("hex").slice(0, 32);
}

/**
 * Idempotency key for the PaymentIntent creation call.
 *
 * Every value that varies the REQUEST BODY must appear here. Stripe rejects a
 * key replayed with different parameters (400 idempotency_error), and the body
 * carries `description` (the plan label, per locale) and `metadata[locale]`.
 */
export function paymentIntentIdempotencyKey(
  siteId: string,
  planId: string,
  locale: string,
  fingerprint: string,
): string {
  return `pi:${siteId}:${planId}:${locale}:${fingerprint}`;
}

export function hashIp(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}|${ip}`).digest("hex").slice(0, 16);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripeErrorCode(body: unknown): string {
  if (!isPlainObject(body)) return "unknown";
  const error = body.error;
  if (!isPlainObject(error)) return "unknown";
  const code = error.code ?? error.type;
  return typeof code === "string" ? code : "unknown";
}

async function stripePost(
  secretKey: string,
  path: string,
  form: Record<string, string>,
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`${STRIPE_API}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": idempotencyKey,
      },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
    });
  } catch (error) {
    logError("stripe_transport_error", { error_code: errorCode(error) });
    throw new StripeApiError(0, "network_error");
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const code = stripeErrorCode(body);
    logError("stripe_rejected", { status: response.status, error_code: code });
    throw new StripeApiError(response.status, code);
  }
  if (!isPlainObject(body)) throw new StripeApiError(response.status, "unparseable_response");
  return body;
}

export async function createCustomer(
  secretKey: string,
  params: { email: string; siteId: string; idempotencyKey: string },
): Promise<StripeCustomer> {
  const body = await stripePost(
    secretKey,
    "/v1/customers",
    { email: params.email, "metadata[site]": params.siteId },
    params.idempotencyKey,
  );
  const id = body.id;
  if (typeof id !== "string") throw new StripeApiError(200, "customer_without_id");
  return { id };
}

export interface CreatePaymentIntentParams {
  amount: number;
  currency: string;
  customerId: string;
  receiptEmail: string;
  description: string;
  statementSuffix: string;
  siteId: string;
  planId: string;
  locale: string;
  clientIp: string;
  idempotencyKey: string;
}

export async function createPaymentIntent(
  secretKey: string,
  params: CreatePaymentIntentParams,
): Promise<StripePaymentIntent> {
  const body = await stripePost(
    secretKey,
    "/v1/payment_intents",
    {
      amount: String(params.amount),
      currency: params.currency,
      customer: params.customerId,
      // The card is genuinely registered against the Customer, which is what
      // makes a returning buyer's saved card work across devices via Link.
      setup_future_usage: "off_session",
      receipt_email: params.receiptEmail,
      description: params.description,
      statement_descriptor_suffix: params.statementSuffix,
      // `no-payment-method-types-parameter`: writable payment_method_types is
      // gone (400 payment_method_types_no_longer_supported). allow_redirects
      // =never is what keeps card-only and keeps every success in-page.
      "automatic_payment_methods[enabled]": "true",
      "automatic_payment_methods[allow_redirects]": "never",
      "metadata[site]": params.siteId,
      "metadata[plan]": params.planId,
      "metadata[locale]": params.locale,
      // Informational only. The Payment Intents API has no documented
      // client-IP parameter; the real anti-carding signal is Stripe.js loaded
      // early in <head>, not this field.
      "metadata[client_ip]": params.clientIp,
    },
    params.idempotencyKey,
  );
  const id = body.id;
  const clientSecret = body.client_secret;
  if (typeof id !== "string") throw new StripeApiError(200, "intent_without_id");
  return { id, client_secret: typeof clientSecret === "string" ? clientSecret : null };
}
