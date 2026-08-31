// The ONLY per-site file under api/. Every other file in this tree is
// byte-identical across the site repos; see the sha256sum contract in README.
// Site facts live in source, not in env, so they roll back with the image and
// are reviewable in a diff. Env carries the four secrets and nothing else.

import type { SiteConfig } from "./catalog.ts";

export const SITE: SiteConfig = {
  id: "transvase",
  origin: "https://transvase.devanchor.company",
  notifyTo: "astowny+transvase@gmail.com",
  fromName: "Transvase",
  statementSuffix: "TRANSVASE",
  plans: {
    // Amounts in minor units. Monthly offers are sold as a one-off first
    // month: no Subscription is created anywhere in this service, so no
    // recurring obligation and no cancellation route is owed.
    migration: {
      amount: 4900,
      currency: "eur",
      label: { fr: "Migration", en: "Migration" },
    },
    flow_first_month: {
      amount: 7900,
      currency: "eur",
      label: { fr: "Flux continu — premier mois", en: "Continuous flow — first month" },
    },
  },
};
