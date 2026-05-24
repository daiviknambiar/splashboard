# Splashboard

Splashboard is a visual-search tool for photographers, designers, and mood-board builders. Describe a mood or upload an image, and the app extracts visual descriptors with Gemini, searches Unsplash for matching photos, and displays the results as either a mood board or a shot-reference grid with camera metadata when Unsplash provides it.

The project is split into:

- A static Next.js frontend, exported under `/splashboard`
- A small Express backend that talks to Gemini and returns structured descriptors
- Direct Unsplash API calls from the frontend, with Unsplash CDN images and attribution links preserved

## What You Can Do

- Search by plain-language mood, scene, lighting, color, location, or framing
- Upload a JPEG, PNG, WebP, or static GIF for visual analysis
- View ranked Unsplash results in mood-board mode
- Use "Steal the Shot" mode to inspect camera settings when EXIF data is available
- Export a generated mood board image from the browser
- Use the hosted backend's limited free quota, or bring your own Gemini key for your own analysis requests
- Self-host the frontend and backend with your own Gemini and Unsplash API keys

## Requirements

- Node.js 20 or newer
- npm
- An Unsplash API Access Key from [Unsplash Developers](https://unsplash.com/developers)
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey)

Node 20 is recommended for both the frontend and backend because the backend package declares `node >=20` and uses modern Node APIs.

## Quick Start

Clone the repository:

```bash
git clone https://github.com/daiviknambiar/splashboard.git
cd splashboard
```

Install frontend and backend dependencies:

```bash
npm install
npm run backend:install
```

Create the frontend environment file:

```bash
touch .env.local
```

Add your local frontend values to `.env.local`:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
NEXT_PUBLIC_UNSPLASH_ACCESS_KEY=your_unsplash_access_key_here
```

Create the backend environment file:

```bash
cp backend/.env.example backend/.env
```

Set your Gemini key in `backend/.env`:

```bash
GEMINI_API_KEY=your_gemini_api_key_here
```

Run the backend in one terminal:

```bash
npm run backend:dev
```

Run the frontend in another terminal:

```bash
npm run dev
```

Open:

```text
http://localhost:3000/splashboard
```

## Environment Variables

### Frontend

Create `.env.local` in the repository root.

| Variable | Required | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | Yes for deployed/static frontend | Backend origin, for example `http://localhost:4000` or `https://your-backend.example.com` |
| `NEXT_PUBLIC_UNSPLASH_ACCESS_KEY` | Yes | Unsplash Access Key used by the browser for search, details, and download-trigger requests |

Important: variables prefixed with `NEXT_PUBLIC_` are included in the browser bundle. Use an Unsplash Access Key, not any private server-side secret. Gemini keys should stay on the backend unless a user explicitly enters their own key in the app for their own request.

### Backend

Create `backend/.env` from `backend/.env.example`.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `4000` | Backend port |
| `GEMINI_API_KEY` | empty | Backend-owned Gemini key. Required unless every request supplies its own key |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Gemini model used for descriptor extraction |
| `GEMINI_API_BASE_URL` | Google Generative Language API | Optional override for compatible Gemini API hosts |
| `CORS_ORIGINS` | `*` | Comma-separated frontend origins allowed to call the backend |
| `MONTHLY_ACTION_LIMIT` | `4` | Free monthly analyses allowed for the backend-owned Gemini key. Set `0` for unlimited |
| `MAX_BODY_MB` | `5` in code, `12` in example | JSON request body limit, useful because images are sent as base64 |
| `MAX_TEXT_INPUT_CHARS` | `1000` | Maximum text prompt length |
| `REQUEST_TIMEOUT_MS` | `30000` | Gemini request timeout |
| `RATE_LIMIT_PER_MINUTE` | `10` | Per-minute API rate limit |
| `IMAGE_LONG_EDGE_MAX` | `1568` | Maximum long edge after server-side image normalization |

For production, set `CORS_ORIGINS` to your actual frontend origin instead of `*`, for example:

```bash
CORS_ORIGINS=https://your-username.github.io
```

## Available Scripts

From the repository root:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js development server |
| `npm run build` | Build the static frontend export |
| `npm run lint` | Run ESLint |
| `npm run backend:install` | Install backend dependencies |
| `npm run backend:dev` | Start the backend with Node watch mode |
| `npm run backend:start` | Start the backend without watch mode |

## How It Works

1. The user enters a text prompt or uploads an image.
2. The frontend sends the input to `POST /api/analyze` on the backend.
3. The backend wraps the user input as untrusted content, asks Gemini for structured visual descriptors, and validates the response.
4. The frontend turns the descriptors into Unsplash search queries.
5. Unsplash results are deduplicated, lightly ranked against the descriptors, and shown in the selected view.
6. In shot-reference mode, the frontend requests photo details for top results so it can show camera metadata when available.

The backend response contract is intentionally stable:

```json
{
  "output": "{\"locationType\":\"...\",\"searchTerms\":[\"...\"]}",
  "meta": {},
  "error": null
}
```

Keeping this shape lets the frontend handle success, usage, and error states consistently.

## Backend API

### Health Check

```http
GET /health
```

Returns backend status, configured model name, and current in-memory usage counters.

### Analyze

```http
POST /api/analyze
Content-Type: application/json
```

Text request:

```json
{
  "input": "warm golden-hour street scene with film grain",
  "context": {
    "type": "text",
    "mode": "moodboard"
  }
}
```

Image request:

```json
{
  "input": "base64_encoded_image_data",
  "context": {
    "type": "image",
    "mimeType": "image/jpeg",
    "mode": "stealthisshot"
  }
}
```

Optional header:

```http
x-gemini-api-key: user_owned_gemini_key
```

When this header is present, the backend uses that key for the request and does not count the request against the backend-owned free monthly quota. In production, user-provided keys require HTTPS.

## Usage Limits

The backend includes a simple in-memory monthly quota for requests that use the backend-owned Gemini key. The default is 4 analyses per UTC month.

- Set `MONTHLY_ACTION_LIMIT=0` to disable the monthly limit
- Set `MONTHLY_ACTION_LIMIT=20` or another number to choose a different cap
- Requests that include `x-gemini-api-key` are treated as bring-your-own-key requests and are not charged to the backend-owned quota
- Usage state resets when the backend restarts or when the UTC month changes

The frontend stores a small usage notice record in browser local storage under:

```text
splashboard.usage.v1
```

That record is only used for displaying the user's last known quota state and the free-plan reminder. The backend remains the source of truth after each analysis request.

## Image Handling

Uploaded images are sent to the backend as base64 JSON payloads. Before Gemini receives an image, the backend:

- Verifies the declared MIME type against the file signature
- Accepts JPEG, PNG, WebP, and GIF inputs
- Rejects animated images
- Rotates according to image metadata, resizes to a bounded long edge, and strips metadata through re-encoding
- Keeps JPEG inputs as JPEG
- Converts PNG, WebP, and GIF inputs to PNG

This makes model input more predictable and avoids sending embedded image metadata to Gemini.

## Safety and Privacy

Splashboard is designed as a public-facing demo that can also be self-hosted. The current backend includes several defensive layers:

- User text is wrapped as untrusted input before being sent to Gemini
- Image prompts tell the model to analyze visible visual content and ignore text rendered inside the image
- Gemini is asked for a JSON response with a response schema
- The backend validates and sanitizes descriptor fields before returning them to the frontend
- Descriptor output is checked for key-shaped sensitive strings before it is returned
- Gemini safety settings block medium-and-above harassment, hate speech, sexually explicit, and dangerous content
- API rate-limit identifiers are SHA-256 hashes of either the user-provided Gemini key or the normalized request IP
- Analysis failures are logged with a short incident hash instead of raw user input or raw model output
- The backend startup check refuses to run if the configured prompt accidentally includes the configured Gemini key

Do not commit real API keys. Keep `.env.local` and `backend/.env` local to your machine or your deployment provider's secret store.

## Unsplash Compliance

Splashboard uses Unsplash in the browser and keeps the current Unsplash behavior visible:

- Photos are loaded directly from Unsplash CDN URLs
- In-app photo cards include photographer attribution and links back to Unsplash
- Search requests use Unsplash `content_filter=high`
- Individual photo download actions trigger Unsplash's required download endpoint when available
- The app does not store, proxy, or rehost Unsplash images

Because the frontend is statically exported, the Unsplash Access Key is currently public in the client bundle. This is acceptable only for Unsplash Access Keys intended for public client use. Review Unsplash's current API guidelines and rate limits before deploying a high-traffic copy.

## Deployment

The frontend is configured for static export:

- `output: "export"`
- `basePath: "/splashboard"`
- `assetPrefix: "/splashboard/"`
- `images.unoptimized: true`

Build the frontend:

```bash
npm run build
```

The generated static site can be hosted on GitHub Pages or another static hosting provider. Make sure `NEXT_PUBLIC_API_BASE_URL` points to a reachable backend origin before building.

The backend can be deployed anywhere that supports a Node.js HTTP service, such as Render, Railway, Fly.io, a VPS, or a container platform.

Recommended production backend settings:

```bash
NODE_ENV=production
PORT=4000
GEMINI_API_KEY=your_backend_gemini_key
CORS_ORIGINS=https://your-frontend-origin.example
MONTHLY_ACTION_LIMIT=4
RATE_LIMIT_PER_MINUTE=10
```

After deployment, verify:

```bash
curl https://your-backend.example.com/health
```

Then build or redeploy the frontend with:

```bash
NEXT_PUBLIC_API_BASE_URL=https://your-backend.example.com \
NEXT_PUBLIC_UNSPLASH_ACCESS_KEY=your_unsplash_access_key \
npm run build
```

## Project Structure

```text
app/                    Next.js app, UI components, and main page
lib/api.ts              Frontend backend client and response validation
lib/unsplash.ts         Unsplash search, details, and download-trigger calls
lib/ranker.ts           Lightweight result dedupe and ranking
types/index.ts          Shared frontend TypeScript types
backend/src/server.js   Express backend, Gemini integration, rate limits, image normalization
backend/src/output-guard.js
                        Descriptor validation and sensitive-output guardrails
scripts/                Local helper scripts
```

## Troubleshooting

### The app cannot reach the backend

Check that the backend is running and that `NEXT_PUBLIC_API_BASE_URL` matches its origin. For deployed frontends, also make sure the backend `CORS_ORIGINS` includes the frontend origin.

### Unsplash requests fail

Confirm that `NEXT_PUBLIC_UNSPLASH_ACCESS_KEY` is set before building or running the frontend. Also check your Unsplash app's rate limits and allowed use.

### Gemini analysis fails

Confirm that `GEMINI_API_KEY` is set in `backend/.env`, or enter your own Gemini key in the app if that UI is available in your deployment. If the backend is deployed, make sure requests use HTTPS when passing a user-provided Gemini key.

### Image upload is rejected

Use a non-animated JPEG, PNG, WebP, or GIF. The backend rejects unsupported formats, mismatched MIME types, invalid base64 data, and animated images.

### The free quota looks stale

The frontend stores only a display snapshot in local storage. The backend's next response refreshes the actual quota state. Backend usage tracking is in memory, so it resets on restart and at UTC month rollover.

## Development Notes

- Keep the frontend and backend response contract aligned: `{ output, meta, error }`
- Keep Gemini descriptors concise and practical for Unsplash queries
- Do not put raw secrets, user prompts, or model outputs into logs
- Prefer server-side validation even when the frontend already validates input
- If you move Unsplash calls server-side, preserve Unsplash attribution, CDN image delivery, content filtering, and download-trigger behavior
