# TryFit — Shopify App

AI-powered virtual try-on for Shopify stores. Customers upload their photo, see how clothes look on them.

## Setup

### 1. Prerequisites
- Node.js 18+
- Shopify Partner account (free)
- Replicate API token (replicate.com)

### 2. Install
```bash
npm install
```

### 3. Environment
```bash
cp .env.example .env
```
Edit `.env` and add your Replicate API token.

### 4. Database
```bash
npx prisma generate
npx prisma migrate dev --name init
```

### 5. Run locally
```bash
npm run dev
```
Shopify CLI will create a tunnel and open the app in your dev store.

### 6. Add to product page
1. Go to your Shopify admin → Online Store → Customize
2. Navigate to a product page template
3. Add the "Virtual Try-On" block
4. Configure button text, colors, etc.
5. Save

### 7. Deploy
```bash
npm run deploy
```

## Architecture

```
Customer clicks "Try The Look"
  → Modal opens, uploads photo
  → POST /apps/tryon (app proxy)
  → Backend calls Replicate API (fashn-ai/tryon)
  → Result image returned
  → Shown in modal
```

## Cost
- Replicate: ~$0.05-0.10 per try-on
- Hosting: Free tier on Railway/Fly.io
- Shopify: Free to develop, $0 until published to App Store

## Files
```
├── app/
│   ├── routes/
│   │   ├── app.jsx              # Admin layout
│   │   ├── app._index.jsx       # Dashboard
│   │   ├── app.settings.jsx     # Merchant settings
│   │   ├── app.proxy.tryon.jsx  # Try-on API endpoint
│   │   ├── auth.$.jsx           # Auth callback
│   │   ├── auth.login.jsx       # Login
│   │   └── webhooks.jsx         # Webhooks
│   ├── root.jsx
│   └── shopify.server.js
├── extensions/
│   └── try-on-block/
│       ├── blocks/
│       │   └── try-on.liquid    # Frontend UI (button + modal)
│       └── shopify.extension.toml
├── prisma/
│   └── schema.prisma
├── .env.example
├── shopify.app.toml
└── package.json
```
