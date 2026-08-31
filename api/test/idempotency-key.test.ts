import { describe, expect, test } from "bun:test";
import { paymentIntentIdempotencyKey } from "../src/stripe.ts";

const FP = "0123456789abcdef0123456789abcdef";

describe("paymentIntentIdempotencyKey", () => {
  test("is stable for identical inputs, so a double-click replays one intent", () => {
    expect(paymentIntentIdempotencyKey("cadran-seo", "overhaul", "fr", FP))
      .toBe(paymentIntentIdempotencyKey("cadran-seo", "overhaul", "fr", FP));
  });

  test("differs per locale: locale changes description and metadata in the body", () => {
    // A buyer who opens checkout on / , switches to /en/ with the language
    // switch and clicks the same plan inside the 5-minute fingerprint bucket
    // otherwise reuses one key with two different bodies, and Stripe answers
    // 400 idempotency_error. Reproduced against the live test API.
    expect(paymentIntentIdempotencyKey("cadran-seo", "overhaul", "fr", FP))
      .not.toBe(paymentIntentIdempotencyKey("cadran-seo", "overhaul", "en", FP));
  });

  test("differs per plan", () => {
    expect(paymentIntentIdempotencyKey("cadran-seo", "overhaul", "fr", FP))
      .not.toBe(paymentIntentIdempotencyKey("cadran-seo", "retainer_first_month", "fr", FP));
  });

  test("differs per site", () => {
    expect(paymentIntentIdempotencyKey("cadran-seo", "overhaul", "fr", FP))
      .not.toBe(paymentIntentIdempotencyKey("transvase", "overhaul", "fr", FP));
  });

  test("differs per fingerprint", () => {
    expect(paymentIntentIdempotencyKey("cadran-seo", "overhaul", "fr", FP))
      .not.toBe(paymentIntentIdempotencyKey("cadran-seo", "overhaul", "fr", "f".repeat(32)));
  });
});
