# Transvase

Landing page (single static HTML file) for a fictional SaaS: importing and migrating
e-mail contacts between platforms (CSV/Excel/Outlook → Brevo, Mailchimp, HubSpot…).

Built as a conversion-copywriting sample: hero showing the product's core moment
(a column-mapping table), PAS problem framing costed in deliverability, three-step
pipeline, feature grid, proof with figures, usage-based pricing, objection handling,
and a qualifying sign-up form.

## Contents

- `index.html` — the whole page. No build step, no external asset except Google Fonts.

## Serving

Any static host. On Dokploy: application type `static`, publish directory `/`.

## Design notes

- Data-flow visual world: mapping table, status badges, monospace figures.
- Fonts: IBM Plex Sans (UI), IBM Plex Mono (data), IBM Plex Serif (pull quote).
- Light and dark palettes are both defined at token level on `:root`,
  `prefers-color-scheme`, and `[data-theme]`, so the page holds on any ground.

## Licence

MIT. Copy is a demonstration sample; the figures quoted are illustrative, not
customer data.
