// Retry only on 429, 5xx, concurrent_idempotent_requests and resource_locked;
// everything else is terminal. Resend keeps an idempotency key for 24 h, so the
// whole retry window must stay far inside it or a "retry" becomes a duplicate.
import { describe, expect, test } from "bun:test";
import {
  MAX_RESEND_RETRIES,
  RESEND_REQUEST_TIMEOUT_MS,
  RESEND_RETRY_DELAYS_MS,
  classifyResendFailure,
} from "../src/resend.ts";

describe("classifyResendFailure", () => {
  test("retries a rate-limited response", () => {
    expect(classifyResendFailure(429, "rate_limit_exceeded")).toBe("retry");
  });

  test("retries every server error", () => {
    for (const status of [500, 501, 502, 503, 504, 599]) {
      expect(classifyResendFailure(status, null)).toBe("retry");
    }
  });

  test("retries a concurrent idempotent request", () => {
    expect(classifyResendFailure(409, "concurrent_idempotent_requests")).toBe("retry");
  });

  test("retries a locked resource", () => {
    expect(classifyResendFailure(422, "resource_locked")).toBe("retry");
  });

  test("retries a transport failure, which has no HTTP status", () => {
    expect(classifyResendFailure(0, "network_error")).toBe("retry");
  });

  test("gives up on an authentication failure", () => {
    expect(classifyResendFailure(401, "restricted_api_key")).toBe("terminal");
  });

  test("gives up on a missing User-Agent, which no retry will fix", () => {
    expect(classifyResendFailure(403, "security_error")).toBe("terminal");
  });

  test("gives up on a validation error", () => {
    expect(classifyResendFailure(422, "validation_error")).toBe("terminal");
  });

  test("gives up on a plain 400, 404 and 409", () => {
    for (const status of [400, 404, 409]) {
      expect(classifyResendFailure(status, "invalid_parameter")).toBe("terminal");
    }
  });

  test("gives up on an unexpected 3xx", () => {
    expect(classifyResendFailure(302, null)).toBe("terminal");
  });

  test("classifies on the error name even when the status is unfamiliar", () => {
    expect(classifyResendFailure(418, "resource_locked")).toBe("retry");
    expect(classifyResendFailure(418, "teapot")).toBe("terminal");
  });
});

describe("retry budget", () => {
  test("makes at most two retries", () => {
    expect(MAX_RESEND_RETRIES).toBe(2);
    expect(RESEND_RETRY_DELAYS_MS.length).toBe(MAX_RESEND_RETRIES);
  });

  test("keeps the whole window well inside Resend's 24 h idempotency retention", () => {
    const attempts = MAX_RESEND_RETRIES + 1;
    const worstCase =
      attempts * RESEND_REQUEST_TIMEOUT_MS + RESEND_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
    expect(worstCase).toBeLessThanOrEqual(60_000);
  });

  test("uses the 8 s per-request timeout the spec fixes", () => {
    expect(RESEND_REQUEST_TIMEOUT_MS).toBe(8000);
  });

  test("backs off between attempts", () => {
    for (const delay of RESEND_RETRY_DELAYS_MS) {
      expect(delay).toBeGreaterThan(0);
    }
    expect(RESEND_RETRY_DELAYS_MS[1]!).toBeGreaterThan(RESEND_RETRY_DELAYS_MS[0]!);
  });
});
