## Splashboard

Visual discovery tool powered by Gemini + Unsplash. Describe a vibe or upload a photo — get a curated grid of images that match the mood, lighting, and aesthetic.

### Setup

Create `.env.local`:

```
NEXT_PUBLIC_GEMINI_API_KEY=...
NEXT_PUBLIC_UNSPLASH_ACCESS_KEY=...

# Optional
# GEMINI_API_KEY=... # preferred for server-only deployments
# MONTHLY_ACTION_LIMIT=4
# RATE_LIMIT_WINDOW_SECONDS=60
# RATE_LIMIT_MAX_REQUESTS=8
# NEXT_PUBLIC_BASE_PATH=/splashboard
# GEMINI_MODEL=gemini-2.5-flash
```

```bash
npm install
npm run dev
```

App runs at `http://localhost:3000/splashboard`.
`npm run dev` opens this URL automatically when possible.

### Stack

- **Next.js 16** (App Router)
- **Gemini 2.5 Flash** — vision analysis, structured descriptor extraction
- **Unsplash API** — image search, EXIF data, download tracking
- **Tailwind CSS v4**

### Architecture

```
Input (text or image)
  → Server Gemini call   → Extracts { locationType, lighting, palette, mood, framing, searchTerms }
                         → server-enforced free tier (default 4 actions/month) + machine-level rate limiting
  → Browser Unsplash calls → 3 parallel queries, results merged + ranked
  → Results grid with masonry layout
  → Browser download trigger → Unsplash download endpoint called on photo interaction
```

### Unsplash compliance

- Every photo attributed: `Photo by [Name] on Unsplash` — both linked with UTM params
- Images served directly from Unsplash CDN (no proxying via `<img>` tags)
- Unsplash download tracking request triggered on every photo click (required by Unsplash guidelines)
- No Unsplash logo used anywhere
- App name does not imply official Unsplash affiliation
