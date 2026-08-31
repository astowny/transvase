// Plan catalog types and the pure lookups the request handlers depend on.
// Site-agnostic on purpose: this file is byte-identical in every site repo and
// the only per-site file is site.ts.

export type Locale = "fr" | "en";

export interface Plan {
  /** Amount in the currency's minor unit, as Stripe wants it (149000 = 1 490,00 €). */
  amount: number;
  currency: string;
  /** User-visible prose, therefore the one place per-locale French is allowed. */
  label: Record<Locale, string>;
}

export interface SiteConfig {
  id: string;
  origin: string;
  notifyTo: string;
  fromName: string;
  statementSuffix: string;
  plans: Record<string, Plan>;
}

/**
 * `resolve-plan-must-not-be-a-bare-index`. A bare `plans[id]` answers something
 * truthy for "__proto__", "constructor" and "toString"; `p.amount` is then
 * undefined and the PaymentIntent is created with a NaN amount or the handler
 * throws. Object.hasOwn is what makes the lookup a lookup.
 */
export function resolvePlan(plans: Record<string, Plan>, id: unknown): Plan | null {
  if (typeof id !== "string") return null;
  if (!Object.hasOwn(plans, id)) return null;
  const plan = plans[id];
  return plan === undefined ? null : plan;
}

export function isLocale(value: unknown): value is Locale {
  return value === "fr" || value === "en";
}

/**
 * `return-url-is-derived-server-side`. The client never sends a return URL:
 * accepting one would be an open redirect on a payment domain, handing the
 * attacker's page `payment_intent_client_secret` after the buyer authenticates
 * with their bank. Only the locale is client-supplied, and it is a two-value
 * union by the time it gets here.
 */
export function returnUrlFor(origin: string, locale: Locale): string {
  const base = origin.replace(/\/+$/, "");
  return locale === "en" ? `${base}/en/` : `${base}/`;
}

/**
 * Money is formatted server-side so no page ever does arithmetic on an amount.
 * The /100 divisor is correct for EUR (two-decimal currency); this service
 * sells in EUR only, and a zero-decimal currency would need a real exponent
 * table before that assumption could be reused.
 */
export function formatAmount(amountMinor: number, currency: string, locale: Locale): string {
  const code = currency.toUpperCase();
  const major = amountMinor / 100;
  try {
    return new Intl.NumberFormat(locale === "en" ? "en-GB" : "fr-FR", {
      style: "currency",
      currency: code,
    }).format(major);
  } catch {
    // An ill-formed currency code from a rolled-back event must not throw away
    // the whole notification.
    return `${major.toFixed(2)} ${code}`;
  }
}
