# Payments API

Bun 1.3, one container per site, no runtime dependencies, no database.

Every file in this directory is **byte-identical across the site repos except
`src/site.ts`**, which is the only place a site differs in code. Verify with:

```
sha256sum Dockerfile package.json tsconfig.json .dockerignore \
  src/{index,config,catalog,stripe,resend,webhook,escape,limits,log}.ts test/*.ts
```

run in each repo: identical basenames must produce identical hashes.
`src/site.ts` is deliberately excluded.

## Environment — four variables, all secret

```
STRIPE_SECRET_KEY=sk_test_…        # or rk_test_
STRIPE_PUBLISHABLE_KEY=pk_test_…
STRIPE_WEBHOOK_SECRET=whsec_…      # per site: two endpoints, two secrets
RESEND_API_KEY=re_…                # restricted, sending-only
```

All four are asserted at boot; any missing or malformed one exits 1 before the
port is bound. There is **no mode variable and no live branch anywhere in this
service**: a key that is not `sk_test_`/`rk_test_` refuses the boot outright.

## Named caveat, 31/08/2026 — the Stripe account this ships against

The spec decisions `use-a-dedicated-stripe-sandbox-not-the-regie-account` and
`no-cli-issued-key-on-a-server` are **not satisfied by this build**, and that is
a deliberate, dated exception rather than an oversight:

- Provisioning a Stripe sandbox needs a browser, and a non-expiring key can only
  be minted from the Dashboard. Neither is possible from this headless host.
- The build therefore targets the **existing account's TEST mode**, verified
  empty on 31/08/2026 (0 products, 0 prices, 0 webhooks, 0 customers) and fully
  isolated from live data.
- The `sk_test_` key currently available on this host is **Stripe-CLI-issued and
  expires 2026-11-25**. On that date every Stripe call 401s while the CLI on
  this host keeps refreshing its own session — so the first diagnostic would
  report that Stripe is fine while the site is dead.

**Recommendation, unchanged:** create a dedicated Stripe sandbox and use its
Dashboard-issued keys before this is left running unattended. Nothing in the
code changes; the keys arrive through the env vars either way.

## What is deliberately absent

No live code path. No subscriptions (monthly offers are sold as a one-off first
month, so no recurring obligation and no cancellation route is owed). No
database: Stripe is the system of record and the owner email is a notification,
not a record. The in-memory rate counters and the webhook dedupe cache do not
survive a restart and are not meant to.
