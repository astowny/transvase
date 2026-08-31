// `escape-every-interpolated-value`: everything a buyer can type reaches the
// owner's inbox from the owner's own verified sending domain. It must arrive as
// inert text — never as an anchor, never as an image, never as a header.
import { describe, expect, test } from "bun:test";
import { buildAlertEmail, buildLeadEmail, buildOwnerEmail, type OwnerEmailInput } from "../src/resend.ts";
import { capField, defangUrls, escapeHtml, isSingleEmailAddress, sanitizeTagValue } from "../src/escape.ts";
import type { SiteConfig } from "../src/catalog.ts";

const SITE_FIXTURE: SiteConfig = {
  id: "example-site",
  origin: "https://example.test",
  notifyTo: "owner@example.test",
  fromName: "Example Site",
  statementSuffix: "EXAMPLE",
  plans: {
    overhaul: { amount: 149000, currency: "eur", label: { fr: "Remise à niveau", en: "Overhaul" } },
  },
};

function input(overrides: Partial<OwnerEmailInput> = {}): OwnerEmailInput {
  return {
    site: SITE_FIXTURE,
    kind: "purchase",
    locale: "fr",
    planId: "overhaul",
    planLabel: "Remise à niveau",
    amountMinor: 149000,
    currency: "eur",
    buyerEmail: "buyer@example.com",
    buyerName: null,
    paymentIntentId: "pi_123",
    eventId: "evt_123",
    failureCode: null,
    failureMessage: null,
    ...overrides,
  };
}

const PHISH = '<a href="https://evil.example/facture">Voir la facture</a>';
const PIXEL = '<img src="https://evil.example/px.gif">';

describe("escapeHtml", () => {
  test("escapes the five characters that change HTML meaning", () => {
    expect(escapeHtml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &#39;");
  });

  test("escapes an ampersand before the other replacements", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  test("leaves ordinary text and accents untouched", () => {
    expect(escapeHtml("Remise à niveau — 1 490 €")).toBe("Remise à niveau — 1 490 €");
  });

  test("neutralises an anchor", () => {
    expect(escapeHtml(PHISH)).not.toContain("<a ");
    expect(escapeHtml(PHISH)).toContain("&lt;a href=");
  });
});

describe("capField", () => {
  test("returns short input unchanged", () => {
    expect(capField("hello")).toBe("hello");
  });

  test("caps at 500 characters by default", () => {
    expect(capField("A".repeat(5000)).length).toBe(500);
  });

  test("returns an empty string for a non-string value", () => {
    for (const value of [null, undefined, 42, {}, []]) {
      expect(capField(value)).toBe("");
    }
  });

  test("strips CR and LF so no value can forge a header or a log line", () => {
    expect(capField("a\r\nbcc: victim@example.com")).not.toContain("\n");
    expect(capField("a\r\nbcc: victim@example.com")).not.toContain("\r");
  });
});

describe("isSingleEmailAddress", () => {
  test("accepts one ordinary address", () => {
    expect(isSingleEmailAddress("buyer@example.com")).toBe(true);
  });

  test("rejects two addresses", () => {
    expect(isSingleEmailAddress("a@b.co, c@d.co")).toBe(false);
  });

  test("rejects a display-name form that could carry a second recipient", () => {
    expect(isSingleEmailAddress('"a" <a@b.co>')).toBe(false);
  });

  test("rejects an address bearing CR or LF", () => {
    expect(isSingleEmailAddress("a@b.co\r\nbcc: c@d.co")).toBe(false);
    expect(isSingleEmailAddress("a@b.co\nbcc: c@d.co")).toBe(false);
  });

  test("rejects an address longer than 254 characters", () => {
    expect(isSingleEmailAddress("a".repeat(250) + "@b.co")).toBe(false);
  });

  test("rejects an address with no @, two @, or an empty side", () => {
    for (const value of ["nobody", "a@@b.co", "a@b@c.co", "@b.co", "a@", "", " a@b.co"]) {
      expect(isSingleEmailAddress(value)).toBe(false);
    }
  });

  test("rejects a non-string", () => {
    expect(isSingleEmailAddress(null)).toBe(false);
    expect(isSingleEmailAddress(42)).toBe(false);
  });
});

describe("sanitizeTagValue", () => {
  test("passes a legal Resend tag value through", () => {
    expect(sanitizeTagValue("cadran-seo")).toBe("cadran-seo");
  });

  test("replaces the characters Resend rejects", () => {
    expect(sanitizeTagValue("cadran-seo.devanchor.company")).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("never emits an illegal character whatever the input", () => {
    expect(sanitizeTagValue("é à — <a>")).toMatch(/^[A-Za-z0-9_-]*$/);
  });
});

describe("buildOwnerEmail", () => {
  test("addresses the owner from the site's display name", () => {
    const mail = buildOwnerEmail(input());
    expect(mail.to).toBe("owner@example.test");
    expect(mail.from).toBe("Example Site <no-reply@send.devanchor.company>");
  });

  test("marks every subject as test mode and names the plan and the amount", () => {
    const mail = buildOwnerEmail(input());
    expect(mail.subject.startsWith("[TEST] ")).toBe(true);
    expect(mail.subject).toContain("Remise à niveau");
    expect(mail.subject.replace(/[\s\u00a0\u202f\u2009]/g, " ")).toContain("1 490,00 €");
  });

  test("distinguishes a declined payment in the subject", () => {
    const mail = buildOwnerEmail(input({ kind: "failure", failureCode: "card_declined" }));
    expect(mail.subject).toContain("[TEST]");
    expect(mail.subject).toContain("DECLINED");
  });

  test("carries no CR or LF in the subject", () => {
    const mail = buildOwnerEmail(input({ planLabel: "Plan\r\nbcc: victim@example.com" }));
    expect(mail.subject).not.toContain("\n");
    expect(mail.subject).not.toContain("\r");
  });

  test("sets Reply-To to a valid buyer address", () => {
    expect(buildOwnerEmail(input()).reply_to).toBe("buyer@example.com");
  });

  test("omits Reply-To when the buyer address is absent or malformed", () => {
    expect(buildOwnerEmail(input({ buyerEmail: null })).reply_to).toBeUndefined();
    expect(buildOwnerEmail(input({ buyerEmail: "a@b.co\r\nbcc: c@d.co" })).reply_to).toBeUndefined();
    expect(buildOwnerEmail(input({ buyerEmail: "a@b.co, c@d.co" })).reply_to).toBeUndefined();
  });

  test("renders a buyer-supplied anchor as inert text", () => {
    const mail = buildOwnerEmail(input({ buyerName: PHISH }));
    expect(mail.html).not.toContain("<a ");
    expect(mail.html).not.toMatch(/href\s*=\s*"/);
    expect(mail.html).toContain("&lt;a href=");
  });

  test("renders a buyer-supplied tracking pixel as inert text", () => {
    const mail = buildOwnerEmail(input({ buyerName: PIXEL }));
    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("&lt;img");
  });

  test("escapes a buyer-supplied plan label too", () => {
    const mail = buildOwnerEmail(input({ planLabel: PHISH }));
    expect(mail.html).not.toContain("<a ");
  });

  test("escapes the buyer email in the body", () => {
    const mail = buildOwnerEmail(input({ buyerEmail: null, buyerName: '"><script>alert(1)</script>' }));
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });

  test("contains no anchor at all, so no link can be phished into it", () => {
    const mail = buildOwnerEmail(input({ buyerName: PHISH, planLabel: PHISH }));
    expect(mail.html.toLowerCase()).not.toContain("<a href");
  });

  test("caps every interpolated buyer field at 500 characters", () => {
    const mail = buildOwnerEmail(input({ buyerName: "A".repeat(500) + "OVERFLOWMARKER" }));
    expect(mail.html).not.toContain("OVERFLOWMARKER");
    expect(mail.text).not.toContain("OVERFLOWMARKER");
  });

  test("supplies an authored text part naming the plan and the payment intent", () => {
    const mail = buildOwnerEmail(input());
    expect(mail.text.length).toBeGreaterThan(0);
    expect(mail.text).toContain("Remise à niveau");
    expect(mail.text).toContain("pi_123");
    expect(mail.text).toContain("buyer@example.com");
  });

  test("tags the mail with a legal site and kind value", () => {
    const mail = buildOwnerEmail(input());
    expect(mail.tags).toEqual([
      { name: "site", value: "example-site" },
      { name: "kind", value: "purchase" },
    ]);
    for (const tag of mail.tags) {
      expect(tag.value).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  test("takes the amount from the event, not from the catalog", () => {
    const mail = buildOwnerEmail(input({ amountMinor: 4900, planId: "not_in_catalog", planLabel: "Unknown plan" }));
    expect(mail.subject.replace(/[\s\u00a0\u202f\u2009]/g, " ")).toContain("49,00 €");
    expect(mail.subject).toContain("Unknown plan");
  });

  test("formats the amount in the buyer's locale", () => {
    const mail = buildOwnerEmail(input({ locale: "en" }));
    expect(mail.subject.replace(/[\s\u00a0\u202f\u2009]/g, " ")).toContain("€1,490.00");
  });

  test("names the decline reason when the payment failed", () => {
    const mail = buildOwnerEmail(input({ kind: "failure", failureCode: "card_declined", failureMessage: "Your card was declined." }));
    expect(mail.html).toContain("card_declined");
    expect(mail.text).toContain("Your card was declined.");
  });

  test("escapes a decline message forged into the event", () => {
    const mail = buildOwnerEmail(input({ kind: "failure", failureMessage: PHISH }));
    expect(mail.html).not.toContain("<a ");
  });
});

describe("buildAlertEmail", () => {
  test("prefixes the subject with FAIL and goes to the same owner address", () => {
    const mail = buildAlertEmail(SITE_FIXTURE, "resend_terminal_failure", "evt_123");
    expect(mail.subject.startsWith("[TEST][FAIL] ")).toBe(true);
    expect(mail.to).toBe("owner@example.test");
    expect(mail.tags).toEqual([
      { name: "site", value: "example-site" },
      { name: "kind", value: "alert" },
    ]);
  });

  test("escapes the reason it is handed", () => {
    const mail = buildAlertEmail(SITE_FIXTURE, PHISH, "evt_123");
    expect(mail.html).not.toContain("<a ");
  });

  test("carries no Reply-To, because nobody replies to an alert", () => {
    expect(buildAlertEmail(SITE_FIXTURE, "boom", "evt_1").reply_to).toBeUndefined();
  });
});

describe("buildLeadEmail", () => {
  const fields = {
    email: "lead@example.com",
    name: "Ada Lovelace",
    website: "https://example.org/shop",
    trade: "Boulangerie",
    goal: "Plus de visites",
  };

  test("goes to the owner and is tagged as a lead", () => {
    const mail = buildLeadEmail({ site: SITE_FIXTURE, locale: "fr", fields, ipHash: "abcd1234" });
    expect(mail.to).toBe("owner@example.test");
    expect(mail.subject.startsWith("[TEST][LEAD] ")).toBe(true);
    expect(mail.tags).toEqual([
      { name: "site", value: "example-site" },
      { name: "kind", value: "lead" },
    ]);
  });

  test("sets Reply-To to the lead's address when it is a single valid address", () => {
    const mail = buildLeadEmail({ site: SITE_FIXTURE, locale: "fr", fields, ipHash: "abcd1234" });
    expect(mail.reply_to).toBe("lead@example.com");
  });

  test("renders the submitted website as inert text, never as a link", () => {
    const mail = buildLeadEmail({
      site: SITE_FIXTURE, locale: "fr", ipHash: "abcd1234",
      fields: { ...fields, website: PHISH },
    });
    expect(mail.html).not.toContain("<a ");
    expect(mail.html).not.toMatch(/href\s*=\s*"/);
    expect(mail.html).toContain("&lt;a href=");
  });

  test("defangs a submitted URL in the text part so no client autolinks it", () => {
    const mail = buildLeadEmail({ site: SITE_FIXTURE, locale: "fr", fields, ipHash: "abcd1234" });
    expect(mail.text).not.toContain("https://example.org/shop");
    expect(mail.text).toContain("hxxps://example.org/shop");
  });

  test("caps every submitted field", () => {
    const mail = buildLeadEmail({
      site: SITE_FIXTURE, locale: "fr", ipHash: "abcd1234",
      fields: { ...fields, goal: "A".repeat(500) + "OVERFLOWMARKER" },
    });
    expect(mail.html).not.toContain("OVERFLOWMARKER");
    expect(mail.text).not.toContain("OVERFLOWMARKER");
  });

  test("omits a field that was not submitted rather than printing undefined", () => {
    const mail = buildLeadEmail({
      site: SITE_FIXTURE, locale: "fr", ipHash: "abcd1234",
      fields: { email: "lead@example.com" },
    });
    expect(mail.html.toLowerCase()).not.toContain("undefined");
    expect(mail.text.toLowerCase()).not.toContain("undefined");
  });

  test("records the hashed client IP, never the address itself", () => {
    const mail = buildLeadEmail({ site: SITE_FIXTURE, locale: "fr", ipHash: "abcd1234", fields });
    expect(mail.text).toContain("abcd1234");
  });
});

describe("defangUrls", () => {
  test("neutralises an http and an https scheme", () => {
    expect(defangUrls("see http://a.test and https://b.test")).toBe("see hxxp://a.test and hxxps://b.test");
  });

  test("is case-insensitive", () => {
    expect(defangUrls("HTTPS://A.TEST")).toBe("hxxps://A.TEST");
  });

  test("leaves text without a scheme alone", () => {
    expect(defangUrls("a.test/path")).toBe("a.test/path");
  });
});
