## Splashboard

Visual discovery tool powered by Gemini + Unsplash. Describe a vibe or upload a photo — get a curated grid of images that match the mood, lighting, and aesthetic.

### Setup

Create `.env.local`:

```
GEMINI_API_KEY=...
UNSPLASH_ACCESS_KEY=...
UNSPLASH_SECRET_KEY=...
```

```bash
npm install
npm run dev
```

App runs at `http://localhost:3000`.

### Stack

- **Next.js 16** (App Router)
- **Gemini 2.0 Flash** — vision analysis, structured descriptor extraction
- **Unsplash API** — image search, EXIF data, download tracking
- **Tailwind CSS v4**

### Architecture

```
Input (text or image)
  → POST /api/analyze  → Gemini extracts { locationType, lighting, palette, mood, framing, searchTerms }
  → POST /api/search   → 3 parallel Unsplash queries, results merged + ranked
  → Results grid with masonry layout
  → POST /api/download → download trigger called on photo interaction (Unsplash requirement)
```

### Unsplash compliance

- Every photo attributed: `Photo by [Name] on Unsplash` — both linked with UTM params
- Images served directly from Unsplash CDN (no proxying via `<img>` tags)
- Download endpoint triggered on every photo click (required by Unsplash guidelines)
- No Unsplash logo used anywhere
- App name does not imply official Unsplash affiliation
