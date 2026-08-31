// `return-url-is-derived-server-side`: the client never supplies a return URL.
import { describe, expect, test } from "bun:test";
import { formatAmount, returnUrlFor } from "../src/catalog.ts";
import { SITE } from "../src/site.ts";

const ORIGIN = "https://example.test";

describe("returnUrlFor", () => {
  test("sends a French buyer back to the site root", () => {
    expect(returnUrlFor(ORIGIN, "fr")).toBe("https://example.test/");
  });

  test("sends an English buyer back to /en/", () => {
    expect(returnUrlFor(ORIGIN, "en")).toBe("https://example.test/en/");
  });

  test("tolerates a trailing slash on the configured origin", () => {
    expect(returnUrlFor("https://example.test/", "fr")).toBe("https://example.test/");
    expect(returnUrlFor("https://example.test/", "en")).toBe("https://example.test/en/");
  });

  test("is always anchored on this site's own origin", () => {
    for (const locale of ["fr", "en"] as const) {
      const url = returnUrlFor(SITE.origin, locale);
      expect(url.startsWith(SITE.origin)).toBe(true);
      expect(new URL(url).origin).toBe(new URL(SITE.origin).origin);
    }
  });

  test("takes no input other than the origin and the locale", () => {
    expect(returnUrlFor.length).toBe(2);
  });
});

describe("formatAmount", () => {
  // Intl emits U+202F (narrow no-break space) as the French group separator on
  // current ICU; normalise every space class before comparing.
  const flatten = (value: string): string => value.replace(/[\s\u00a0\u202f\u2009]/g, " ");

  test("formats a French amount from minor units", () => {
    expect(flatten(formatAmount(149000, "eur", "fr"))).toBe("1 490,00 €");
  });

  test("formats an English amount from minor units", () => {
    expect(flatten(formatAmount(149000, "eur", "en"))).toBe("€1,490.00");
  });

  test("formats a small amount", () => {
    expect(flatten(formatAmount(4900, "eur", "fr"))).toBe("49,00 €");
  });

  test("formats zero", () => {
    expect(flatten(formatAmount(0, "eur", "fr"))).toBe("0,00 €");
  });

  test("accepts an uppercase currency code from a Stripe event", () => {
    expect(flatten(formatAmount(39000, "EUR", "fr"))).toBe("390,00 €");
  });

  test("falls back to a plain rendering for an unknown currency code", () => {
    const rendered = formatAmount(1000, "zzz", "fr");
    expect(rendered).toContain("10");
    expect(rendered.toLowerCase()).toContain("zzz");
  });
});
