// Payments API — Bun 1.3, one container per site.
//
// EVERY FILE IN THIS TREE IS BYTE-IDENTICAL ACROSS THE SITE REPOS EXCEPT
// site.ts. Nothing site-specific belongs in this file or in any of its
// siblings: read it from SITE. The contract is verified with
//   sha256sum api/src/*.ts api/test/*.ts   (site.ts deliberately excluded)
// run in each repo; identical basenames must produce identical hashes.
//
// Test mode only, by construction. There is no mode variable, no live branch
// and no disabled live code: config.ts refuses to boot on anything that is not
// a Stripe test key, so going live means editing a file, which is a commit and
// a review.
//
// No database anywhere. Stripe is the system of record and the owner email is
// a notification, not a record; the in-memory caches below do not survive a
// restart and are not meant to.

import { formatAmount, isLocale, resolvePlan, returnUrlFor, type Locale } from "./catalog.ts";
import { loadSecretsOrExit, last4 } from "./config.ts";
import { capField, isSingleEmailAddress } from "./escape.ts";
import {
  EVENT_CACHE_CAPACITY,
  EventIdCache,
  INTENT_LIMIT_PER_IP_PER_HOUR,
  LEAD_LIMIT_PER_IP_PER_HOUR,
  OUTBOUND_EMAIL_LIMIT_PER_HOUR,
  RollingHourCounter,
} from "./limits.ts";
import { errorCode, log, logError } from "./log.ts";
import {
  LEAD_FIELDS,
  buildAlertEmail,
  buildLeadEmail,
  buildOwnerEmail,
  sendEmail,
  type ResendEmailPayload,
} from "./resend.ts";
import { SITE } from "./site.ts";
import {
  createCustomer,
  createPaymentIntent,
  hashIp,
  idempotencyFingerprint,
  paymentIntentIdempotencyKey,
} from "./stripe.ts";
import { parseEvent, verifySignature, type StripeEvent } from "./webhook.ts";

const PORT = 3000;
/** `content-length-precheck-then-bytes-once`: the webhook ceiling. */
const MAX_WEBHOOK_BYTES = 65_536;
/** JSON routes are far smaller; nginx caps them at 8k as well. */
const MAX_JSON_BYTES = 8_192;

const SECRETS = loadSecretsOrExit(process.env as Record<string, string | undefined>);

const intentLimiter = new RollingHourCounter(INTENT_LIMIT_PER_IP_PER_HOUR);
const leadLimiter = new RollingHourCounter(LEAD_LIMIT_PER_IP_PER_HOUR);
const outboundEmailLimiter = new RollingHourCounter(OUTBOUND_EMAIL_LIMIT_PER_HOUR);
const seenEvents = new EventIdCache(EVENT_CACHE_CAPACITY);

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" } as const;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** No echo of the offending value: a 400 must not become a reflection sink. */
function badRequest(): Response {
  return json(400, { error: "invalid_request" });
}

function rateLimited(): Response {
  return json(429, { error: "rate_limited" });
}

/**
 * nginx sets X-Real-IP from the visitor's address (set_real_ip_from pins the
 * trust to the Docker overlay range, so a client-supplied X-Forwarded-For
 * cannot move it). The socket peer is the nginx container and is useless here.
 */
function clientIp(request: Request): string {
  const real = request.headers.get("x-real-ip");
  if (real !== null && real.length > 0 && real.length <= 64) return real;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded !== null) {
    const first = forwarded.split(",")[0]?.trim();
    if (first !== undefined && first.length > 0 && first.length <= 64) return first;
  }
  return "unknown";
}

function declaredTooLarge(request: Request, max: number): boolean {
  const declared = request.headers.get("content-length");
  if (declared === null) return false;
  const length = Number(declared);
  return Number.isFinite(length) && length > max;
}

/**
 * `content-length-precheck-then-bytes-once`. Content-Length is checked first so
 * a 100 MB body never lands in the heap, then the body is read exactly once as
 * BYTES. Never req.text() — the lossy UTF-8 decode breaks the webhook HMAC —
 * and never req.json() plus a re-stringify, which is not the payload Stripe
 * signed. Reading twice throws "Body already used".
 */
async function readBody(request: Request, max: number): Promise<Uint8Array | null> {
  if (declaredTooLarge(request, max)) return null;
  const raw = await request.bytes();
  if (raw.byteLength > max) return null;
  return raw;
}

function parseJsonObject(raw: Uint8Array): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Outbound mail
// ---------------------------------------------------------------------------

/**
 * `outbound-email-cap-per-site-per-hour`. In test mode a payment costs the
 * attacker nothing, so a confirm loop would otherwise generate unbounded mail
 * from the only verified sending domain on the account. Dedupe collapses the
 * loop; this cap bounds whatever dedupe misses. Beyond it: log and drop.
 */
function maySendEmail(): boolean {
  if (outboundEmailLimiter.allow(SITE.id)) return true;
  logError("email_capped", { site: SITE.id });
  return false;
}

async function deliver(payload: ResendEmailPayload, idempotencyKey: string, eventId: string): Promise<void> {
  if (!maySendEmail()) return;
  const result = await sendEmail(SECRETS.resendApiKey, payload, idempotencyKey);
  if (result.ok) return;

  logError("email_failed", { event_id: eventId, status: result.status, error_code: result.errorName ?? "unknown" });
  if (!maySendEmail()) return;
  const alert = buildAlertEmail(SITE, `notification failed: ${result.errorName ?? "unknown"}`, eventId);
  const alertResult = await sendEmail(SECRETS.resendApiKey, alert, `alert:${idempotencyKey}`);
  if (!alertResult.ok) logError("alert_failed", { event_id: eventId, status: alertResult.status });
}

// ---------------------------------------------------------------------------
// Handlers. Every one of them declares Promise<Response> explicitly:
// `every-handler-is-typed-promise-response`. A Bun route that falls through
// answers 200 "Welcome to Bun!", which would make Stripe record the event as
// delivered, stop retrying, and leave a captured payment with no notification
// and no error in any log.
// ---------------------------------------------------------------------------

async function handleHealthz(): Promise<Response> {
  return new Response("ok", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

async function handleCheckout(request: Request): Promise<Response> {
  const raw = await readBody(request, MAX_JSON_BYTES);
  if (raw === null) return json(413, { error: "payload_too_large" });

  const body = parseJsonObject(raw);
  if (body === null) return badRequest();

  const plan = resolvePlan(SITE.plans, body.plan);
  if (plan === null) return badRequest();
  const planId = body.plan as string;

  if (!isLocale(body.locale)) return badRequest();
  const locale: Locale = body.locale;

  // The buyer's address is required: it is what makes the Customer, the
  // receipt_email and the Reply-To on the owner's notification real.
  if (!isSingleEmailAddress(body.email)) return badRequest();
  const email = body.email as string;

  const ip = clientIp(request);
  if (!intentLimiter.allow(ip)) {
    log("checkout_rate_limited", { site: SITE.id, plan: planId, ip_hash: hashIp(ip, SITE.id) });
    return rateLimited();
  }

  const fingerprint = idempotencyFingerprint(email, ip, Date.now());
  try {
    // `customer-created-at-checkout-and-capped`: setup_future_usage needs a
    // customer at confirm time, so it cannot wait for the webhook. The per-IP
    // cap above is what bounds the pollution.
    const customer = await createCustomer(SECRETS.stripeSecretKey, {
      email,
      siteId: SITE.id,
      idempotencyKey: `cust:${SITE.id}:${fingerprint}`,
    });

    const intent = await createPaymentIntent(SECRETS.stripeSecretKey, {
      amount: plan.amount,
      currency: plan.currency,
      customerId: customer.id,
      receiptEmail: email,
      description: plan.label[locale],
      statementSuffix: SITE.statementSuffix,
      siteId: SITE.id,
      planId,
      locale,
      clientIp: ip,
      idempotencyKey: paymentIntentIdempotencyKey(SITE.id, planId, locale, fingerprint),
    });

    if (intent.client_secret === null) {
      logError("intent_without_client_secret", { site: SITE.id, plan: planId, pi_id: intent.id });
      return json(502, { error: "upstream_error" });
    }

    log("checkout_created", { site: SITE.id, plan: planId, pi_id: intent.id, ip_hash: hashIp(ip, SITE.id) });
    return json(200, {
      clientSecret: intent.client_secret,
      publishableKey: SECRETS.stripePublishableKey,
      amount: plan.amount,
      currency: plan.currency,
      amountLabel: formatAmount(plan.amount, plan.currency, locale),
      planLabel: plan.label[locale],
      // `return-url-is-derived-server-side`. Never from the client: that would
      // be an open redirect handing the attacker's page the client secret
      // right after the buyer authenticates with their bank.
      returnUrl: returnUrlFor(SITE.origin, locale),
      mode: "test",
    });
  } catch (error) {
    logError("checkout_failed", { site: SITE.id, plan: planId, error_code: errorCode(error) });
    return json(502, { error: "upstream_error" });
  }
}

async function handleLead(request: Request): Promise<Response> {
  const raw = await readBody(request, MAX_JSON_BYTES);
  if (raw === null) return json(413, { error: "payload_too_large" });

  const body = parseJsonObject(raw);
  if (body === null) return badRequest();
  if (!isLocale(body.locale)) return badRequest();
  const locale: Locale = body.locale;
  if (!isSingleEmailAddress(body.email)) return badRequest();

  const fields: Record<string, string> = {};
  for (const name of LEAD_FIELDS) {
    const value = capField(body[name]);
    if (value.length > 0) fields[name] = value;
  }

  const ip = clientIp(request);
  const ipHash = hashIp(ip, SITE.id);
  if (!leadLimiter.allow(ip)) {
    log("lead_rate_limited", { site: SITE.id, ip_hash: ipHash });
    return rateLimited();
  }

  const payload = buildLeadEmail({ site: SITE, locale, fields, ipHash });
  const key = `lead:${SITE.id}:${idempotencyFingerprint(fields.email ?? "", ip, Date.now())}`;
  log("lead_received", { site: SITE.id, ip_hash: ipHash });
  // Acknowledge first, send detached with its own catch: an unawaited
  // rejection would take the whole Bun process down.
  queueMicrotask(() => {
    deliver(payload, key, key).catch((error: unknown) => {
      logError("lead_send_crashed", { site: SITE.id, error_code: errorCode(error) });
    });
  });
  return json(200, { ok: true });
}

const HANDLED_EVENT_TYPES = new Set(["payment_intent.succeeded", "payment_intent.payment_failed"]);

async function handleWebhook(request: Request): Promise<Response> {
  const raw = await readBody(request, MAX_WEBHOOK_BYTES);
  if (raw === null) return new Response(null, { status: 413 });

  const signature = request.headers.get("stripe-signature");
  if (signature === null) return new Response(null, { status: 400 });
  if (!verifySignature(raw, signature, SECRETS.stripeWebhookSecret, Math.floor(Date.now() / 1000))) {
    logError("webhook_bad_signature", { site: SITE.id });
    return new Response(null, { status: 400 });
  }

  const event = parseEvent(raw);
  if (event === null) {
    logError("webhook_unparseable", { site: SITE.id });
    return new Response(null, { status: 400 });
  }

  // Accepted and ignored: another site's endpoint, or an event type this
  // service does not act on. 204 so Stripe stops retrying something correct.
  if (event.data.object.metadata.site !== SITE.id) return new Response(null, { status: 204 });
  if (seenEvents.seen(event.id)) {
    log("webhook_duplicate", { site: SITE.id, event_id: event.id });
    return new Response(null, { status: 204 });
  }
  if (!HANDLED_EVENT_TYPES.has(event.type)) return new Response(null, { status: 204 });

  // `ack-204-then-send-detached-with-its-own-catch`.
  queueMicrotask(() => {
    notify(event).catch((error: unknown) => {
      logError("webhook_send_crashed", { site: SITE.id, event_id: event.id, error_code: errorCode(error) });
    });
  });
  return new Response(null, { status: 204 });
}

/**
 * `email-content-comes-from-the-event-never-from-the-catalog`. The catalog is
 * consulted only for a label the event did not carry; a rollback to an image
 * whose catalog predates a plan id must never silence a notification.
 */
async function notify(event: StripeEvent): Promise<void> {
  const object = event.data.object;
  const planId = object.metadata.plan ?? "unknown";
  const locale: Locale = isLocale(object.metadata.locale) ? object.metadata.locale : "fr";
  const catalogPlan = resolvePlan(SITE.plans, planId);
  const planLabel = object.description ?? catalogPlan?.label[locale] ?? planId;

  const payload = buildOwnerEmail({
    site: SITE,
    kind: event.type === "payment_intent.payment_failed" ? "failure" : "purchase",
    locale,
    planId,
    planLabel,
    amountMinor: object.amount ?? 0,
    currency: object.currency ?? "eur",
    buyerEmail: object.receipt_email,
    buyerName: null,
    paymentIntentId: object.id,
    eventId: event.id,
    failureCode: object.last_payment_error?.decline_code ?? object.last_payment_error?.code ?? null,
    failureMessage: object.last_payment_error?.message ?? null,
  });

  log("webhook_accepted", { site: SITE.id, plan: planId, pi_id: object.id, event_id: event.id, status: event.type });
  await deliver(payload, event.id, event.id);
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  idleTimeout: 30,
  // Explicit, because NODE_ENV is what goes missing in a compose refactor: with
  // development on, an unhandled throw returns a page whose embedded block
  // decodes to the exception message and the server's own source text.
  development: false,
  routes: {
    "/api/healthz": { GET: handleHealthz },
    "/api/checkout": { POST: handleCheckout },
    "/api/lead": { POST: handleLead },
    "/api/stripe-webhook": { POST: handleWebhook },
  },
  // Nothing falls through to Bun's default 200 "Welcome to Bun!".
  fetch(): Response {
    return json(404, { error: "not_found" });
  },
  error(error: Error): Response {
    logError("unhandled_route_error", { site: SITE.id, error_code: errorCode(error) });
    return json(500, { error: "internal_error" });
  },
});

/** The literal prefix of the key in use, so rk_test_ is not reported as sk_test_. */
function keyPrefix(key: string): string {
  return key.slice(0, key.indexOf("_", key.indexOf("_") + 1) + 1);
}

// `boot-fingerprint-line` — last 4 only, stdout only, never in a response.
console.log(
  `boot site=${SITE.id} mode=test key=${keyPrefix(SECRETS.stripeSecretKey)}…${last4(SECRETS.stripeSecretKey)} ` +
    `whsec=…${last4(SECRETS.stripeWebhookSecret)} resend=re_…${last4(SECRETS.resendApiKey)} ` +
    `notify=${SITE.notifyTo} origin=${SITE.origin} plans=${Object.keys(SITE.plans).join(",")} ` +
    `port=${server.port}`,
);

// Log and keep serving. A silent swallow is what turns a lost notification
// into an incident nobody can reconstruct.
process.on("unhandledRejection", (reason: unknown) => {
  logError("unhandled_rejection", { site: SITE.id, error_code: errorCode(reason) });
});
process.on("uncaughtException", (error: unknown) => {
  logError("uncaught_exception", { site: SITE.id, error_code: errorCode(error) });
});

async function shutdown(signal: string): Promise<void> {
  log("shutdown", { site: SITE.id, status: signal });
  await server.stop(); // Bun drains in-flight requests.
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
