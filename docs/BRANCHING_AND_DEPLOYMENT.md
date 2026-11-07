# Sankalp (`mockexamonline.com`) — Dual-Branch Workflow & Production Deployment Guide

## 1. Two-Track Branch Architecture

Work in this repository is cleanly separated into two parallel Git branches that merge into `main` (production `https://mockexamonline.com`):

| Branch | Scope & Primary Ownership | Key Files Owned (Zero-Conflict Boundary) |
| :--- | :--- | :--- |
| **`feature-development`** | Core adaptive learning engine, Test Cockpit (`/app`), FSRS flashcards, syllabus tree, question bank harvesters, analytics, and mobile UX | `src/client/views/*` (except `PublicMarketingApp.tsx`), `src/client/components/*`, `src/db/*`, `harvester/*` |
| **`sales-and-marketing`** | Public marketing website (`/`), Flow & Pomelli campaign media, Freemium conversion funnels, Pricing, Daily Current Affairs, Strategy Blogs, and Edge SEO | `src/client/views/PublicMarketingApp.tsx`, `src/server/seo.ts`, `public/media/*`, `scripts/seed-seo-content.ts` |
| **`main`** | Production release branch deployed to `https://mockexamonline.com` & `https://www.mockexamonline.com` |Receives tested PRs / merges from both branches |

### Everyday Git Commands

```powershell
# Switch to Feature Development track
git checkout feature-development
git pull origin main

# Switch to Sales & Marketing track (Flow/Pomelli, Blogs, Current Affairs, SEO, Pricing)
git checkout sales-and-marketing
git pull origin main

# Release tested changes from either track to mockexamonline.com
git checkout main
git merge sales-and-marketing   # or: git merge feature-development
npm run test:e2e
git push origin main
npm run deploy:prod
```

---

## 2. Dropping In Google Labs Flow & Pomelli Media Assets (`sales-and-marketing`)

The public landing page (`src/client/views/PublicMarketingApp.tsx`) automatically renders your **Flow** motion reels and **Pomelli** campaign cards as soon as files are placed in `public/media/`:

- `public/media/flow-hero.mp4` — Hero product reel / adaptive 50-50 cockpit showcase (`16:9`, `< 6 MB` H.264/WebM)
- `public/media/flow-hero-poster.webp` — Instant LCP poster thumbnail (`1280x720`)
- `public/media/pomelli-campaign-1.webp` — Brand campaign visual #1 (`4:5` or `1:1`)
- `public/media/pomelli-campaign-2.webp` — Brand campaign visual #2 (`4:5` or `1:1`)
- `public/media/og-cover.jpg` — Social WhatsApp/Telegram/X OpenGraph share card (`1200x630`)

See `public/media/README-FLOW-POMELLI.md` for aspect ratios and prompt tips.

---

## 3. Publishing Daily Current Affairs & SEO Blogs

1. Add or update articles in `scripts/seed-seo-content.ts` (supports bilingual `EN`/`HI`, `linkedTopicId` for instant 1-click Targeted Drill conversion, tags, and exam silos).
2. Push to Neon Postgres:
   ```powershell
   npm run db:seed-seo
   ```
3. Every published post immediately:
   - Appears on `/current-affairs` or `/blog` and the `/` homepage feed,
   - Receives server-injected `<title>`, `<meta name="description">`, `<link rel="canonical">`, `NewsArticle` / `BlogPosting` Schema.org JSON-LD, and `<noscript>` semantic HTML via `src/server/seo.ts`,
   - Automatically registers in `https://mockexamonline.com/sitemap.xml` for Google Search Console indexing.

---

## 4. Public Deployment on `uppcs.mockexamonline.com`

`uppcs.mockexamonline.com` is bound in `wrangler.toml` with `custom_domain = true` (automatic Cloudflare DNS + SSL + global Edge caching, leaving root `mockexamonline.com` and `testing.mockexamonline.com` completely untouched) and whitelisted in Firebase Auth (`sankalp-uppcs-app`).

### First-Time 1-Click Cloudflare Login (Once per Machine)
```powershell
npx wrangler login
```

### Deploy Build + Encrypted Secrets + Custom Domain
```powershell
npm run deploy:prod
```
`scripts/deploy-production.mjs` builds the Vite + Worker bundle, deploys `uppcs.mockexamonline.com`, syncs encrypted secrets (`DATABASE_URL`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`) over stdin without exposing them in logs, and verifies `https://uppcs.mockexamonline.com/api/v1/health`.
