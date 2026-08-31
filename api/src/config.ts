// Environment reading and the boot guardrail.
//
// Nothing here runs at import time. The spec sketches the process.exit(1) at
// module scope, which would kill `bun test` the moment a test file imported
// this module; the assertion therefore lives in loadSecretsOrExit(), called
// once from index.ts. Same failure, same exit code, testable.

export class MissingEnvError extends Error {
  constructor(names: string[]) {
    super(`missing required environment variable(s): ${names.join(", ")}`);
    this.name = "MissingEnvError";
  }
}

export interface Secrets {
  stripeSecretKey: string;
  stripePublishableKey: string;
  stripeWebhookSecret: string;
  resendApiKey: string;
}

/**
 * `refuse-to-boot-on-a-non-test-key`. There is no mode variable and no live
 * branch anywhere in this service: going live means editing this file, which is
 * a commit and a review.
 */
export function isTestSecretKey(key: string): boolean {
  return /^(sk|rk)_test_[A-Za-z0-9_]{8,}$/.test(key);
}

export function isTestPublishableKey(key: string): boolean {
  return /^pk_test_[A-Za-z0-9_]{8,}$/.test(key);
}

export function last4(value: string): string {
  return value.slice(-4);
}

const REQUIRED = [
  "STRIPE_SECRET_KEY",
  "STRIPE_PUBLISHABLE_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "RESEND_API_KEY",
] as const;

export function readSecrets(env: Record<string, string | undefined>): Secrets {
  const missing = REQUIRED.filter((name) => {
    const value = env[name];
    return typeof value !== "string" || value.length === 0;
  });
  if (missing.length > 0) throw new MissingEnvError(missing);

  const stripeSecretKey = env.STRIPE_SECRET_KEY as string;
  const stripePublishableKey = env.STRIPE_PUBLISHABLE_KEY as string;
  const stripeWebhookSecret = env.STRIPE_WEBHOOK_SECRET as string;
  const resendApiKey = env.RESEND_API_KEY as string;

  if (!isTestSecretKey(stripeSecretKey)) {
    throw new Error("STRIPE_SECRET_KEY is not a test key");
  }
  if (!isTestPublishableKey(stripePublishableKey)) {
    throw new Error("STRIPE_PUBLISHABLE_KEY is not a test key");
  }
  if (!stripeWebhookSecret.startsWith("whsec_")) {
    throw new Error("STRIPE_WEBHOOK_SECRET does not look like a webhook signing secret");
  }
  if (!resendApiKey.startsWith("re_")) {
    throw new Error("RESEND_API_KEY does not look like a Resend key");
  }

  return { stripeSecretKey, stripePublishableKey, stripeWebhookSecret, resendApiKey };
}

/** Boot path. Refuses to start rather than starting in a state nobody wanted. */
export function loadSecretsOrExit(env: Record<string, string | undefined>): Secrets {
  try {
    return readSecrets(env);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unreadable configuration";
    console.error(`boot refused: ${reason}`);
    process.exit(1);
  }
}
