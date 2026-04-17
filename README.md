## Splashboard

Visual discovery tool powered by a backend AI API + Unsplash. Describe a vibe or upload a photo to get a curated grid of images that match mood, lighting, and composition.

### Setup

Create `.env.local`:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
NEXT_PUBLIC_UNSPLASH_ACCESS_KEY=...

# Optional
# NEXT_PUBLIC_MONTHLY_ACTION_LIMIT=4
```

```bash
npm install
npm run dev
```

App runs at `http://localhost:3000/splashboard`.
`npm run dev` opens this URL automatically when possible.

### Stack

- **Next.js 16** (App Router, static export)
- **Backend AI API (Railway)** - analysis and descriptor generation
- **Unsplash API** - image search, EXIF data, download tracking
- **Tailwind CSS v4**

### Frontend-Backend Contract

Frontend sends analysis requests to:

`POST {NEXT_PUBLIC_API_BASE_URL}/api/analyze`

If `NEXT_PUBLIC_API_BASE_URL` is empty, frontend falls back to same-origin `/api/analyze`.

Request body:

```json
{
  "input": "user prompt here",
  "context": {
    "type": "text",
    "mode": "moodboard"
  }
}
```

Image requests use:

```json
{
  "input": "<base64 image payload>",
  "context": {
    "type": "image",
    "mimeType": "image/jpeg",
    "mode": "stealthisshot"
  }
}
```

Response body:

```json
{
  "output": "model response text",
  "meta": {
    "usage": {
      "month": "2026-04",
      "used": 1,
      "limit": 4,
      "remaining": 3,
      "isLimited": false
    }
  },
  "error": null
}
```

Failure response:

```json
{
  "output": null,
  "meta": null,
  "error": "Human-readable error message"
}
```

`output` must contain JSON text that can be parsed into:

```json
{
  "locationType": "...",
  "lightingConditions": "...",
  "colorPalette": "...",
  "mood": "...",
  "framing": "...",
  "architectureStyle": null,
  "searchTerms": ["...", "..."]
}
```

### Architecture

```txt
Input (text or image)
  -> Backend API analyze call
  -> Extracts { locationType, lighting, palette, mood, framing, searchTerms }
  -> Browser Unsplash calls -> 3 parallel queries, results merged + ranked
  -> Results grid with masonry layout
  -> Browser download trigger -> Unsplash download endpoint called on photo interaction
```

### Unsplash compliance

- Every photo attributed: `Photo by [Name] on Unsplash` (both linked with UTM params)
- Images served directly from Unsplash CDN (no proxying via `<img>`)
- Unsplash download tracking request triggered on photo click
- No Unsplash logo used anywhere
- App name does not imply official Unsplash affiliation
