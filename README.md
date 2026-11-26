# TryFit (Wearoom) — AI virtual try-on for Shopify

Open-source Shopify app that lets shoppers see a product on themselves, or in their own room, before buying. Live on the Shopify App Store: https://apps.shopify.com/tryfit-2

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## What it does

- **Clothing try-on** — shopper uploads a photo, sees the garment on themselves.
- **Home decor room view** — bedsheets, curtains, rugs, cushions, wall art placed in the shopper's room photo.
- **Jewellery and shoes** modes with their own photo guides.
- **Theme app extension** — product-page block (button + modal) and a product-card badge. No theme code edits.
- **Merchant dashboard** — try-ons, unique users, add-to-cart rate, top products, plan usage.
- **Plans and usage limits** via Shopify Managed Pricing.

## Why this repo exists

Virtual try-on on Shopify is mostly closed and expensive. This is a complete, production-running reference for building one: theme app extension, app proxy, embedded admin, managed pricing, usage metering, result caching and storefront analytics.

## Stack

Remix · Shopify App Remix · Polaris · Prisma · Postgres · fal (image models) · Railway

## Architecture

```
Storefront (theme app extension)
  -> POST /apps/tryon            Shopify app proxy
  -> app/routes/proxy-tryon.jsx  usage check, cache lookup, mode detection
  -> image model via fal         selected by TRYON_MODEL
  -> result returned to the modal
  -> /log-tryon                  try-on and add-to-cart events
```

```
app/
  routes/         admin pages, app proxy, webhooks, logging endpoints
  lib/            plans, usage, analytics, guides
  shopify.server.js
extensions/try-on-block/
  blocks/try-on.liquid      product page button + modal
  blocks/card-badge.liquid  product card badge
prisma/schema.prisma        Session, ShopSettings, TryOnLog, TryOnCache
```

## Self-hosting

Requirements: Node.js 18+, a Shopify Partner account, a fal API key, a Postgres database.

```bash
npm install
cp .env.example .env        # fill in your own values
npm run setup               # prisma generate + db push
npm run dev                 # Shopify CLI tunnel + dev store
```

Create your own app in the Partner Dashboard and run `npm run config:link` so `shopify.app.toml` points at your app, not the production one.

Then in the theme editor, add the **Virtual Try-On** block to the product template.

Deploy the extension with `npm run deploy`; host the server anywhere that runs Node (Railway is used in production).

### Model selection

| Variable | Purpose |
| --- | --- |
| `TRYON_MODEL` | `kolors` (default), `fashn`, `nano-banana`, `nano-banana-pro` |
| `TRYON_MODEL_HOME` / `TRYON_MODEL_JEWELRY` / `TRYON_MODEL_SHOES` | Optional per-category override |

## Contributing

Issues and pull requests are welcome. Keep PRs small and focused, and describe how you tested the change on a dev store. Never commit `.env` or any API key.

## Support

support@futuretechiez.in

## License

[MIT](LICENSE) © Ashif Iqbal / [FutureTechiez](https://futuretechiez.in)
