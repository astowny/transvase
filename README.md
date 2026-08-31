# Transvase

Landing page for a **fictional** service: importing and migrating email contact
lists between platforms (CSV, Mailchimp, Gmail, Google Sheets, CRMs → Brevo,
Mailchimp, Klaviyo, HubSpot), with address verification, column mapping and a
seven-day undo. Written as a conversion-copywriting sample — value proposition,
PAS problem framing, a pipeline the page itself imitates, a mapping console with
ok/fix/out badges, proof block with figures, three-tier pricing, objection
handling, and a lead form that now actually posts somewhere.

Two locales: `/` (French, canonical) and `/en/` (English). `/en` 301s to `/en/`.

---

## Test mode only, and there is no live path

Every payment on this site is a **Stripe test-mode payment**. No card is ever
charged, and there is no environment variable, feature flag or disabled branch
that would make it live: `api/src/config.ts` refuses to boot on anything that is
not an `sk_test_` / `rk_test_` key, and going live means editing that file — a
commit and a review.

That is not caution, it is the only defensible setting. The service does not
exist. The footer says "Exemple de page de vente", there is no legal entity, no
mentions légales, no CGV, no VAT number and no seller identity. Taking real money
through this page would be a deceptive commercial practice, not a risk decision.

The owner notification email therefore fires on **simulated** purchases.

---

## Architecture

Two containers, one compose project.

| Container | Image | Role |
|---|---|---|
| `transvase` | `nginx:alpine` | serves `index.html`, `en/index.html`, `checkout.js`; proxies `/api/` |
| `transvase-api` | Bun 1.3 | `POST /api/checkout`, `POST /api/lead`, `POST /api/stripe-webhook`, `GET /api/healthz` |

- nginx is a **hop, not a security boundary**. `/api/*` is public by necessity:
  a Stripe webhook is delivered from the public internet. nginx does rate
  limiting, body caps and header hygiene; authorisation lives in the api.
- The api joins only the project-local `site` network. It carries no Traefik
  labels, publishes no port, and is not on `dokploy-network` — that network
  carries 17 other containers, two of which run arbitrary user code. Read the
  comment block at the bottom of `docker-compose.yml` before changing this:
  there is a named reason the network is *not* declared `internal: true`, and it
  is that an internal network has no route to `api.stripe.com`.
- No database. Stripe is the system of record; the email is a notification, not
  a record. Stripe's Dashboard can resend a webhook event for 15 days.

### Files

```
index.html          FR page
en/index.html       EN page
checkout.js         the whole checkout UI: modal, Payment Element, lead form
nginx.conf          static serving + /api/ proxy          (byte-identical across repos)
Dockerfile          the web image                          (byte-identical across repos)
docker-compose.yml  per-site names, labels and networks
api/                the Bun service; api/src/site.ts is the only per-site source file
```

---

## The byte-identity contract

`transvase` and `cadran-seo` share no package and will not get one. Sharing is
enforced by hashes instead: every file below must be **byte-for-byte identical**
in both repos. Run this in each repo and compare:

```
sha256sum checkout.js nginx.conf Dockerfile api/Dockerfile api/package.json \
  api/tsconfig.json api/src/{index,config,catalog,stripe,resend,webhook,escape,limits,log}.ts \
  api/test/*.ts
```

Identical basenames must produce identical hashes. `api/src/site.ts` is
deliberately excluded — it is the only place the two sites differ in code, and
it holds site facts (id, origin, notification address, sender display name,
statement-descriptor suffix, plan catalog), never secrets.

This is why the compose *service* name of the second container is `api` in both
projects even though its `container_name` is `transvase-api`: `nginx.conf`
proxies to the DNS name `api`, so it can stay identical.

---

## Environment

Four variables, all secret, set on the Dokploy app and materialised as a `.env`
in the project directory:

```
STRIPE_SECRET_KEY=sk_test_…        test-mode secret key
STRIPE_PUBLISHABLE_KEY=pk_test_…   served to the page by the api, never in the HTML
STRIPE_WEBHOOK_SECRET=whsec_…      per site: two endpoints, two secrets
RESEND_API_KEY=re_…                restricted, sending-only, scoped to send.devanchor.company
```

All four are asserted at boot; any missing one exits 1. The api logs one
fingerprint line on start (site, mode, key prefix and last 4 of each secret,
notification address, origin, plan ids) — that line is the answer to most future
incidents. Last-4 only, stdout only, never in an HTTP response.

### Who can read these

**Anyone with docker-group access on this host can read all four values** with
`docker inspect transvase-api`. That is unavoidable with compose — environment
variables are visible to the daemon and to anyone who can talk to it — and
pretending otherwise is the mistake. The blast radius is bounded by *scope*
instead: a test-mode Stripe key that cannot move money, and a Resend key that can
only send from one domain.

`/etc/dokploy` is `0777` on this host and materialised `.env` files are `0644`.
`chmod 755 /etc/dokploy` is an owner action and is still outstanding.

### Key caveat — dated, and it will bite

**25/11/2026.** The Stripe test key currently available on this host was issued
by the Stripe CLI and **expires on 2026-11-25**. On that date every Stripe call
starts returning 401 while the CLI on this host keeps refreshing its own session
happily — so the first diagnostic anyone runs will say Stripe is fine while the
site is dead.

Recommended, and not done in this build because it needs a browser and this host
is headless: create a dedicated Stripe **sandbox** and use its Dashboard-issued,
non-expiring `sk_test_` / `pk_test_`. A sandbox also keeps the webhook endpoint
off the main account's event stream. Until then this app runs against the
existing account's TEST mode, which was verified empty on 31/08/2026 (0 products,
0 prices, 0 webhooks, 0 customers) and is fully isolated from live data.

---

## Registering the webhook endpoint

One endpoint per site, narrowed to the two events the handler dispatches on.
Run with `STRIPE_SECRET_KEY` exported; the trailing colon stops curl prompting
for a password:

```
curl https://api.stripe.com/v1/webhook_endpoints \
  -u "$STRIPE_SECRET_KEY:" \
  --data-urlencode "url=https://transvase.devanchor.company/api/stripe-webhook" \
  -d "enabled_events[]=payment_intent.succeeded" \
  -d "enabled_events[]=payment_intent.payment_failed" \
  -d "description=transvase test-mode purchase notifications"
```

The response's `secret` field is the `whsec_…` for this site. Paste it into this
app's `STRIPE_WEBHOOK_SECRET` and nowhere else. The webhook is the **only** thing
that sends the owner email; the page never triggers one.

Test-mode deliveries are retried only three times over a few hours (live mode
retries for three days), so the uptime monitor on `/api/healthz` must run well
inside that — 60 s.

---

## Stripe.js

```
<script src="https://js.stripe.com/dahlia/stripe.js"></script>
```

In `<head>` of all four pages, **not** deferred and not lazy-loaded. Stripe's
advanced fraud detection accumulates signals across the visit; a script loaded
200 ms before confirmation collects almost nothing, which silently weakens the
strongest anti-card-testing control in the integration.

`dahlia` is a pinned release train, verified to return HTTP 200 on 31/08/2026.
`js.stripe.com/v3` still works but floats and is no longer the recommendation.

---

## Serving

Dokploy application type **Compose**, not `static`: the site is built into an
image (`Dockerfile`) rather than bind-mounted, because Dokploy re-clones its code
directory on every deploy and a bind mount would end up pointing at a deleted
inode and serving an empty document root.

Local sanity checks, neither of which starts a service:

```
docker compose -f docker-compose.yml config
docker run --rm -v "$PWD/nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine nginx -t
```

After deploy, check effects rather than exit codes:

```
curl -sI https://transvase.devanchor.company/en      # 301 -> /en/
curl -sI https://transvase.devanchor.company/        # 200 + Cache-Control: no-cache
curl -s  https://transvase.devanchor.company/api/healthz   # ok
docker logs transvase-api | head -1                  # fingerprint line
```

---

## Go-live gate

None of the following is built, and each is mandatory before a live key is
issued. This list is the gate, not a backlog.

- A real legal entity behind the offer, with mentions légales, CGV, TTC prices,
  seller identity and a consumer-mediator link.
- A Dashboard-issued `sk_live_`, and a fresh adversarial review of the whole flow
  against the live threat model — in live mode a payment costs the attacker
  money, which changes every rate-limit assumption in the opposite direction.
- **A buyer confirmation email.** `receipt_email` is already set on every
  PaymentIntent, so this is one Dashboard switch — but it must be verified on,
  because in test mode Stripe sends nothing and the in-page receipt panel is the
  only record the buyer gets today.
- **Server-validated CAPTCHA (Turnstile) on every card-touching route.** Stripe
  names this explicitly. Test mode does not need it — a confirmation never
  reaches the card networks, so carding wins nothing — and the email flood is
  closed instead by an outbound cap, event dedupe and `limit_req`.
- If subscriptions ever ship: an online cancellation function. France has
  required one since 01/06/2023, penalty €15,000. Today nothing recurring
  exists — the monthly plans are sold as a **one-off first month**, labelled as
  such on the button, in the modal and in the email, which creates no recurring
  obligation.
- Deliberately absent and to stay absent unless re-argued: Checkout Sessions
  (and with them Adaptive Pricing, Stripe Tax and the Tax ID Element), the
  Express Checkout Element, instalments and BNPL, any database, any device
  cookie or custom saved-card list.

---

## Design notes

- Data-flow visual world: a bento grid, a three-node pipeline line, a column
  mapping console with ok/fix/out status badges, a gradient headline.
- Fonts actually loaded (`fonts.googleapis.com`, verified 31/08/2026):
  **Space Grotesk** (display and headings), **Inter** (UI and body), **DM Mono**
  (data, field names, badges). An earlier version of this README named IBM Plex
  Sans, IBM Plex Mono and IBM Plex Serif; the page has never loaded any of the
  three.
- Light and dark palettes are defined at token level on `:root` and under
  `prefers-color-scheme`. The `[data-theme]` selectors are also present but are
  **inert**: nothing in the page or in `checkout.js` ever sets that attribute, so
  they can never match. They are kept as the hook a future toggle would use, and
  are documented here as dead rather than described as working.
  `checkout.js` reads those same custom properties and maps them into the Stripe
  Element's `appearance`, which is why the card form matches the page without a
  second palette existing anywhere.
- External assets: the Google Fonts stylesheet, Stripe.js, and nothing else. The
  favicon is an inline `data:` SVG. The Content-Security-Policy in `nginx.conf`
  is written against exactly that list.

## Licence

MIT. Copy is a demonstration sample; the figures quoted are illustrative, not
customer data.
