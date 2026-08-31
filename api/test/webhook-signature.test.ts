// Stripe webhook signature verification. Four controls are load-bearing here:
// every v1 is accepted (rotation) while v0 and unknown schemes are ignored, the
// 300 s tolerance, the HMAC over raw BYTES, and the length guard that keeps
// node:crypto's timingSafeEqual from throwing on a truncated hex signature.
import { describe, expect, test } from "bun:test";
import { computeSignature, parseEvent, parseSignatureHeader, verifySignature } from "../src/webhook.ts";
import { OTHER_WEBHOOK_SECRET, TEST_WEBHOOK_SECRET } from "./fixtures.ts";

const SECRET = TEST_WEBHOOK_SECRET;
const NOW = 1_756_000_000;
const RAW = new TextEncoder().encode('{"id":"evt_1","type":"payment_intent.succeeded"}');

function header(timestamp: number, parts: string[]): string {
  return [`t=${timestamp}`, ...parts].join(",");
}

function validV1(timestamp: number, raw: Uint8Array = RAW): string {
  return `v1=${computeSignature(timestamp, raw, SECRET)}`;
}

describe("parseSignatureHeader", () => {
  test("extracts the timestamp and every v1 signature", () => {
    const parsed = parseSignatureHeader("t=1756000000,v1=aaaa,v1=bbbb");
    expect(parsed.timestamp).toBe(1756000000);
    expect(parsed.v1).toEqual(["aaaa", "bbbb"]);
  });

  test("ignores the v0 scheme", () => {
    const parsed = parseSignatureHeader("t=1756000000,v0=deadbeef,v1=aaaa");
    expect(parsed.v1).toEqual(["aaaa"]);
  });

  test("ignores an unknown future scheme", () => {
    const parsed = parseSignatureHeader("t=1756000000,v2=deadbeef,v1=aaaa");
    expect(parsed.v1).toEqual(["aaaa"]);
  });

  test("tolerates whitespace around the separators", () => {
    const parsed = parseSignatureHeader(" t=1756000000 , v1=aaaa ");
    expect(parsed.timestamp).toBe(1756000000);
    expect(parsed.v1).toEqual(["aaaa"]);
  });

  test("returns a null timestamp when t is absent", () => {
    expect(parseSignatureHeader("v1=aaaa").timestamp).toBeNull();
  });

  test("returns a null timestamp when t is not an integer", () => {
    expect(parseSignatureHeader("t=not-a-number,v1=aaaa").timestamp).toBeNull();
  });
});

describe("verifySignature", () => {
  test("accepts a signature this process just computed", () => {
    expect(verifySignature(RAW, header(NOW, [validV1(NOW)]), SECRET, NOW)).toBe(true);
  });

  test("accepts when one of several v1 signatures matches (secret rotation)", () => {
    const head = header(NOW, ["v1=" + "0".repeat(64), validV1(NOW), "v1=" + "f".repeat(64)]);
    expect(verifySignature(RAW, head, SECRET, NOW)).toBe(true);
  });

  test("rejects a payload signed with a different secret", () => {
    const other = `v1=${computeSignature(NOW, RAW, OTHER_WEBHOOK_SECRET)}`;
    expect(verifySignature(RAW, header(NOW, [other]), SECRET, NOW)).toBe(false);
  });

  test("rejects when the body was altered after signing", () => {
    const head = header(NOW, [validV1(NOW)]);
    const tampered = new TextEncoder().encode('{"id":"evt_2","type":"payment_intent.succeeded"}');
    expect(verifySignature(tampered, head, SECRET, NOW)).toBe(false);
  });

  test("ignores a v0 signature even when the v0 value is the correct HMAC", () => {
    const correct = computeSignature(NOW, RAW, SECRET);
    expect(verifySignature(RAW, header(NOW, [`v0=${correct}`]), SECRET, NOW)).toBe(false);
  });

  test("ignores an unknown scheme carrying the correct HMAC", () => {
    const correct = computeSignature(NOW, RAW, SECRET);
    expect(verifySignature(RAW, header(NOW, [`v2=${correct}`]), SECRET, NOW)).toBe(false);
  });

  test("accepts a signature exactly at the 300 s tolerance", () => {
    const t = NOW - 300;
    expect(verifySignature(RAW, header(t, [validV1(t)]), SECRET, NOW)).toBe(true);
  });

  test("rejects a signature one second beyond the tolerance", () => {
    const t = NOW - 301;
    expect(verifySignature(RAW, header(t, [validV1(t)]), SECRET, NOW)).toBe(false);
  });

  test("rejects a replay from an hour ago even though the HMAC is correct", () => {
    const t = NOW - 3600;
    expect(verifySignature(RAW, header(t, [validV1(t)]), SECRET, NOW)).toBe(false);
  });

  test("rejects a timestamp too far in the future", () => {
    const t = NOW + 301;
    expect(verifySignature(RAW, header(t, [validV1(t)]), SECRET, NOW)).toBe(false);
  });

  test("rejects when the timestamp is missing", () => {
    expect(verifySignature(RAW, validV1(NOW), SECRET, NOW)).toBe(false);
  });

  test("rejects when no v1 signature is present", () => {
    expect(verifySignature(RAW, header(NOW, []), SECRET, NOW)).toBe(false);
  });

  test("rejects an empty header without throwing", () => {
    expect(verifySignature(RAW, "", SECRET, NOW)).toBe(false);
  });

  // Length guard. node:crypto timingSafeEqual throws
  // ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH on buffers of unequal length, which
  // would turn each of these hostile requests into a 500.
  const malformed = [
    ["a truncated hex signature", "aa"],
    ["a single hex character", "a"],
    ["an odd-length hex signature", "abc"],
    ["an over-long hex signature", "a".repeat(128)],
    ["an empty v1 value", ""],
    ["a non-hex signature of the right length", "z".repeat(64)],
    ["a mixed hex and non-hex signature", "a".repeat(63) + "z"],
  ] as const;

  for (const [label, value] of malformed) {
    test(`rejects ${label} without throwing`, () => {
      const head = header(NOW, [`v1=${value}`]);
      expect(() => verifySignature(RAW, head, SECRET, NOW)).not.toThrow();
      expect(verifySignature(RAW, head, SECRET, NOW)).toBe(false);
    });
  }

  test("rejects a malformed signature even when a valid one follows it", () => {
    const head = header(NOW, ["v1=aa", validV1(NOW)]);
    expect(() => verifySignature(RAW, head, SECRET, NOW)).not.toThrow();
    expect(verifySignature(RAW, head, SECRET, NOW)).toBe(true);
  });

  // The HMAC is computed over the bytes Stripe sent. A req.text() round trip
  // replaces every invalid UTF-8 byte with U+FFFD, which changes the payload
  // and makes the signature silently never match.
  test("verifies a body that is not valid UTF-8", () => {
    const rawBytes = new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0xff, 0x22, 0x7d]);
    const head = header(NOW, [validV1(NOW, rawBytes)]);
    expect(verifySignature(rawBytes, head, SECRET, NOW)).toBe(true);

    const lossy = new TextEncoder().encode(new TextDecoder().decode(rawBytes));
    expect(Array.from(lossy)).not.toEqual(Array.from(rawBytes));
    expect(verifySignature(lossy, head, SECRET, NOW)).toBe(false);
  });
});

describe("parseEvent", () => {
  const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

  test("parses a well-formed payment_intent.succeeded event", () => {
    const event = parseEvent(
      encode({
        id: "evt_1",
        type: "payment_intent.succeeded",
        created: NOW,
        data: { object: { id: "pi_1", object: "payment_intent", amount: 149000, currency: "eur" } },
      }),
    );
    expect(event).not.toBeNull();
    expect(event!.id).toBe("evt_1");
    expect(event!.type).toBe("payment_intent.succeeded");
    expect(event!.data.object.amount).toBe(149000);
  });

  test("returns null for invalid JSON", () => {
    expect(parseEvent(new TextEncoder().encode("{not json"))).toBeNull();
  });

  test("returns null for a JSON array", () => {
    expect(parseEvent(encode([1, 2, 3]))).toBeNull();
  });

  test("returns null for a JSON string", () => {
    expect(parseEvent(encode("evt_1"))).toBeNull();
  });

  test("returns null when the event id is missing", () => {
    expect(parseEvent(encode({ type: "payment_intent.succeeded", data: { object: {} } }))).toBeNull();
  });

  test("returns null when data.object is missing", () => {
    expect(parseEvent(encode({ id: "evt_1", type: "payment_intent.succeeded" }))).toBeNull();
  });

  test("normalises a missing metadata bag to an empty object", () => {
    const event = parseEvent(encode({ id: "evt_1", type: "x", data: { object: { id: "pi_1" } } }));
    expect(event!.data.object.metadata).toEqual({});
  });

  test("keeps only string metadata values", () => {
    const event = parseEvent(
      encode({
        id: "evt_1",
        type: "x",
        data: { object: { id: "pi_1", metadata: { site: "cadran-seo", n: 3, deep: { a: 1 } } } },
      }),
    );
    expect(event!.data.object.metadata).toEqual({ site: "cadran-seo" });
  });

  test("does not let a payload named __proto__ pollute the prototype", () => {
    parseEvent(new TextEncoder().encode('{"id":"evt_1","type":"x","data":{"object":{"id":"pi_1","__proto__":{"polluted":true}}}}'));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
