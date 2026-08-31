// Guardrail: the process must refuse to boot on anything that is not a Stripe
// test key. See spec decision `refuse-to-boot-on-a-non-test-key`.
import { describe, expect, test } from "bun:test";
import { isTestSecretKey, readSecrets, MissingEnvError, last4 } from "../src/config.ts";
import {
  HYPHENATED_SECRET_KEY,
  LIVE_KEY_CONTAINING_TEST_MARKER,
  LIVE_PUBLISHABLE_KEY,
  LIVE_RESTRICTED_KEY,
  LIVE_SECRET_KEY,
  SECRET_KEY_PREFIX_ONLY,
  SHORT_SECRET_KEY,
  TEST_PUBLISHABLE_KEY,
  TEST_RESEND_KEY,
  TEST_RESTRICTED_KEY,
  TEST_SECRET_KEY,
  TEST_WEBHOOK_SECRET,
} from "./fixtures.ts";

describe("isTestSecretKey", () => {
  test("accepts a well-formed sk_test_ key", () => {
    expect(isTestSecretKey(TEST_SECRET_KEY)).toBe(true);
  });

  test("accepts a well-formed restricted rk_test_ key", () => {
    expect(isTestSecretKey(TEST_RESTRICTED_KEY)).toBe(true);
  });

  test("rejects a live secret key", () => {
    expect(isTestSecretKey(LIVE_SECRET_KEY)).toBe(false);
  });

  test("rejects a live restricted key", () => {
    expect(isTestSecretKey(LIVE_RESTRICTED_KEY)).toBe(false);
  });

  test("rejects an empty string", () => {
    expect(isTestSecretKey("")).toBe(false);
  });

  test("rejects a prefix with no body", () => {
    expect(isTestSecretKey(SECRET_KEY_PREFIX_ONLY)).toBe(false);
  });

  test("rejects a body shorter than eight characters", () => {
    expect(isTestSecretKey(SHORT_SECRET_KEY)).toBe(false);
  });

  test("rejects a publishable key", () => {
    expect(isTestSecretKey(TEST_PUBLISHABLE_KEY)).toBe(false);
  });

  test("rejects a live key that merely contains the test marker", () => {
    expect(isTestSecretKey(LIVE_KEY_CONTAINING_TEST_MARKER)).toBe(false);
  });

  test("rejects a key with a leading space", () => {
    expect(isTestSecretKey(` ${TEST_SECRET_KEY}`)).toBe(false);
  });

  test("rejects a key with a trailing newline", () => {
    expect(isTestSecretKey(`${TEST_SECRET_KEY}\n`)).toBe(false);
  });

  test("rejects a key with a hyphen in the body", () => {
    expect(isTestSecretKey(HYPHENATED_SECRET_KEY)).toBe(false);
  });
});

describe("readSecrets", () => {
  const complete = {
    STRIPE_SECRET_KEY: TEST_SECRET_KEY,
    STRIPE_PUBLISHABLE_KEY: TEST_PUBLISHABLE_KEY,
    STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
    RESEND_API_KEY: TEST_RESEND_KEY,
  };

  test("returns the four secrets when all are present", () => {
    const secrets = readSecrets(complete);
    expect(secrets.stripeSecretKey).toBe(complete.STRIPE_SECRET_KEY);
    expect(secrets.stripePublishableKey).toBe(complete.STRIPE_PUBLISHABLE_KEY);
    expect(secrets.stripeWebhookSecret).toBe(complete.STRIPE_WEBHOOK_SECRET);
    expect(secrets.resendApiKey).toBe(complete.RESEND_API_KEY);
  });

  test("throws MissingEnvError naming each absent variable", () => {
    for (const name of Object.keys(complete)) {
      const partial: Record<string, string | undefined> = { ...complete };
      delete partial[name];
      expect(() => readSecrets(partial)).toThrow(MissingEnvError);
      try {
        readSecrets(partial);
      } catch (error) {
        expect((error as MissingEnvError).message).toContain(name);
      }
    }
  });

  test("treats an empty string as absent", () => {
    expect(() => readSecrets({ ...complete, RESEND_API_KEY: "" })).toThrow(MissingEnvError);
  });

  test("rejects a non-test Stripe secret key", () => {
    expect(() => readSecrets({ ...complete, STRIPE_SECRET_KEY: LIVE_SECRET_KEY })).toThrow(
      /not a test key/,
    );
  });

  test("rejects a publishable key that is not a test key", () => {
    expect(() => readSecrets({ ...complete, STRIPE_PUBLISHABLE_KEY: LIVE_PUBLISHABLE_KEY })).toThrow(
      /not a test key/,
    );
  });
});

describe("last4", () => {
  test("returns only the final four characters", () => {
    expect(last4("an-arbitrary-value-mnop")).toBe("mnop");
  });

  test("never returns more characters than the input holds", () => {
    expect(last4("ab")).toBe("ab");
  });

  test("returns an empty string for an empty input", () => {
    expect(last4("")).toBe("");
  });
});
