// `resolve-plan-must-not-be-a-bare-index`: a bare CATALOG[body.plan] answers
// something truthy for "__proto__", "constructor" and "toString".
import { describe, expect, test } from "bun:test";
import { isLocale, resolvePlan, type Plan } from "../src/catalog.ts";
import { SITE } from "../src/site.ts";

const PLANS: Record<string, Plan> = {
  overhaul: { amount: 149000, currency: "eur", label: { fr: "Remise à niveau", en: "Overhaul" } },
  retainer_first_month: {
    amount: 39000,
    currency: "eur",
    label: { fr: "Accompagnement — premier mois", en: "Retainer — first month" },
  },
};

describe("resolvePlan", () => {
  test("resolves a declared plan id to its plan", () => {
    expect(resolvePlan(PLANS, "overhaul")).toBe(PLANS.overhaul!);
  });

  test("resolves the second declared plan id", () => {
    expect(resolvePlan(PLANS, "retainer_first_month")).toBe(PLANS.retainer_first_month!);
  });

  const inherited = [
    "__proto__",
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toLocaleString",
    "__defineGetter__",
    "__lookupGetter__",
  ];

  for (const key of inherited) {
    test(`returns null for the inherited property "${key}"`, () => {
      expect(resolvePlan(PLANS, key)).toBeNull();
    });
  }

  test("returns null for an unknown plan id", () => {
    expect(resolvePlan(PLANS, "audit")).toBeNull();
  });

  test("returns null for a non-string plan id", () => {
    expect(resolvePlan(PLANS, 0)).toBeNull();
    expect(resolvePlan(PLANS, null)).toBeNull();
    expect(resolvePlan(PLANS, undefined)).toBeNull();
    expect(resolvePlan(PLANS, { toString: () => "overhaul" })).toBeNull();
    expect(resolvePlan(PLANS, ["overhaul"])).toBeNull();
  });

  test("resolves every plan id declared by this site's own catalog", () => {
    const ids = Object.keys(SITE.plans);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const plan = resolvePlan(SITE.plans, id);
      expect(plan).not.toBeNull();
      expect(plan!.amount).toBeGreaterThan(0);
      expect(plan!.currency).toBe("eur");
      expect(plan!.label.fr.length).toBeGreaterThan(0);
      expect(plan!.label.en.length).toBeGreaterThan(0);
    }
  });

  test("rejects the prototype chain of this site's own catalog too", () => {
    expect(resolvePlan(SITE.plans, "__proto__")).toBeNull();
    expect(resolvePlan(SITE.plans, "constructor")).toBeNull();
  });
});

describe("isLocale", () => {
  test("accepts the two supported locales", () => {
    expect(isLocale("fr")).toBe(true);
    expect(isLocale("en")).toBe(true);
  });

  test("rejects anything else", () => {
    for (const value of ["FR", "en-GB", "de", "", null, undefined, 1, ["fr"], { locale: "fr" }]) {
      expect(isLocale(value)).toBe(false);
    }
  });
});
