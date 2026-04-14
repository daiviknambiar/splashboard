## Splashboard

Visual discovery tool powered by Gemini + Unsplash. Describe a vibe or upload a photo — get a curated grid of images that match the mood, lighting, and aesthetic.

### Setup

Create `.env.local`:

```
NEXT_PUBLIC_GEMINI_API_KEY=...
NEXT_PUBLIC_UNSPLASH_ACCESS_KEY=...
NEXT_PUBLIC_CONTACT_EMAIL=you@example.com

# Optional
# NEXT_PUBLIC_MONTHLY_ACTION_LIMIT=15
```

```bash
npm install
npm run dev
```

App runs at `http://localhost:3000`.

### Stack

- **Next.js 16** (App Router)
- **Gemini 2.5 Flash** — vision analysis, structured descriptor extraction
- **Unsplash API** — image search, EXIF data, download tracking
- **Tailwind CSS v4**

### Architecture

```
Input (text or image)
  → Browser Gemini call  → Extracts { locationType, lighting, palette, mood, framing, searchTerms }
                         → free tier is tracked in localStorage (default 15 actions/month) unless user supplies their own Gemini key
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
