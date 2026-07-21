# Splashboard

Describe a mood, drop a reference photo, or point at a photographer's profile - Splashboard finds matching images from Unsplash, shows the camera settings behind them, and lets you deep-search a 1,000+ photo portfolio.

---

## The three tools

1. **Mood Board** - describe a vibe in plain words.
AI turns it into weighted Unsplash queries (with color and orientation filters) and pins a downloadable board.
2. **Steal This Shot** - upload a photo or paste an Unsplash photo link, optionally pinpointing what to match ("keep the fog, ignore the person").
You get ranked lookalikes plus the camera bodies, focal lengths, and exposure settings behind them.
3. **Profile Explorer** - paste a profile URL, type a username, or search a photographer's name.
Splashboard indexes their whole portfolio into browsable topic clusters, date histograms, and places, and answers plain-language questions like "misty coastline shots from winter".

## What you need before starting

- [Node.js](https://nodejs.org/) v22.5 or later (the backend uses the built-in `node:sqlite` cache)
- An **Unsplash API key** → [create one here](https://unsplash.com/developers)
- An **AI provider key** - the backend is model-agnostic:
  - **OpenAI** (recommended default): any key, defaults to the cheap vision-capable `gpt-4.1-mini`.
  Also works with any OpenAI-compatible endpoint (OpenRouter, Ollama, vLLM) via `OPENAI_BASE_URL`.
  - **Gemini**: free tier works but is heavily throttled during demand spikes; recent keys only have access to 3.x models.

Providers are tried in order (`LLM_PROVIDER_ORDER`, default `openai,gemini,zen`) until one succeeds - configure one or several.

---

## Setup (step by step)

### 1. Install dependencies

```bash
npm install
npm run backend:install
```

### 2. Configure keys

Create a `.env` file in the project root with your Unsplash key and at least one AI provider:

```bash
UNSPLASH_ACCESS_KEY=your_unsplash_key_here
OPENAI_API_KEY=your_openai_key_here      # and/or:
GEMINI_API_KEY=your_gemini_key_here
```

See `backend/.env.example` for every knob (models, provider order, custom OpenAI-compatible endpoints).

Create `.env.local` in the project root for the frontend:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
```

The backend loads the root `.env`, root `.env.local`, and `backend/.env` automatically (existing shell variables win).
`backend/.env` holds server tuning: port, CORS, model overrides, and the monthly limit.

### 3. Run the app

Two terminals:

```bash
npm run backend:dev   # terminal 1
npm run dev           # terminal 2
```

The app opens at **http://localhost:3001/splashboard** (the backend runs on port 4000).

---

## How it works

1. Your input goes to the Express backend, which asks the configured AI model for a weighted query plan (descriptors, search terms, color/orientation hints).
2. If a provider is rate-limited or down, the backend retries, degrades to its cheaper model, then moves to the next configured provider.
3. The backend fans the plan out across Unsplash searches, merges and ranks the results, and enriches top hits with EXIF data.
4. Profile indexing pages through a photographer's portfolio within a rate budget, caches everything in SQLite (`backend/data/`), and builds AI topic clusters once.
Locations and EXIF are fetched lazily for the photos your filters surface, since Unsplash only exposes them per photo.

The Unsplash access key lives only on the backend - the browser never sees it.

## Usage limits (hosted demo economics)

The hosted demo runs on the maintainer's API keys, so AI runs are metered:

- **Per visitor:** `USER_MONTHLY_LIMIT` free runs per month (default 5), tracked by hashed IP in SQLite - no accounts, no cookies, raw IPs never stored.
Failed searches are not charged.
- **Global backstop:** `GLOBAL_MONTHLY_LIMIT` (default 300) caps the total monthly spend across all visitors.
- **Escape hatches:** visitors paste their own Gemini key in the UI (bypasses limits), or self-host with their own keys.
- The UI shows a small "N of 5 free runs left" meter with a "Why?" explainer; the cached sample board and browsing already-indexed profiles never cost runs.
- **Unsplash demo keys allow 50 requests/hour** - the backend tracks the budget from response headers and pauses profile indexing before exhausting it.
Apply for production access (1,000/hour) to index large portfolios faster.

---

## Deploying

- **Frontend:** pushed commits to `main` build a static export and deploy it to GitHub Pages via `.github/workflows/nextjs.yml`.
The only build variable it needs is the repo variable `NEXT_PUBLIC_API_BASE_URL`, pointing at your deployed backend origin.
- **Backend:** GitHub Pages cannot host the Express service - deploy `backend/` to any Node 22.5+ host (Render, Railway, Fly.io, a VPS).
See [backend/README.md](backend/README.md) for the checklist (env vars, CORS, persistent cache dir).

---

## Tech stack

- **Next.js 16** (App Router, static export)
- **Express.js** backend with a model-agnostic AI layer (native Gemini driver + generic OpenAI-compatible driver)
- **node:sqlite** for profile index and EXIF caching
- **Unsplash API** for image search, profiles, and EXIF data
- **Tailwind CSS v4**

---

## Unsplash attribution

This project follows the [Unsplash API guidelines](https://help.unsplash.com/en/articles/2511245-unsplash-api-guidelines):

- **Hotlinking.** Every image - including the cached sample boards - is loaded from the URLs under `photo.urls`, straight from the Unsplash CDN. Nothing is stored, resized, or proxied.
- **Attribution.** Every displayed photo carries an always-visible credit naming the photographer and Unsplash, linking to both with `?utm_source=splashboard&utm_medium=referral`. The credit is never hover-only, so it is present on touch devices and to screen readers. Decorative preview thumbnails on the home screen carry the same credit beside them, and the exported mood board PNG prints the credit into each frame.
- **Download triggers.** `photo.links.download_location` is pinged whenever a photo is actually used: opening a photo, exporting a mood board, and server-side when a reference photo is fetched for AI analysis.
- **Key confidentiality.** The Unsplash access key lives only on the backend, which proxies every API call. It is never shipped in the client bundle, and users are never asked for an Unsplash key of their own.
- **Cache retention.** Indexed profile metadata is a cache, not a source of truth, so it expires. Profile indexes are dropped and rebuilt from the API after 30 days (`PROFILE_CACHE_TTL_MS`), per-photo detail after 24 hours. The backend sweeps expired rows on boot and daily after that, so nothing lingers for profiles nobody revisits.
