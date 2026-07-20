# Splashboard Backend

Express service that owns every external call: AI analysis and all Unsplash API access (search, profiles, EXIF, download triggers).
The frontend is a static export and talks only to this service.

## AI providers (model-agnostic)

The LLM layer has two drivers - Google's native Gemini API and a generic OpenAI-compatible driver - and tries configured providers in `LLM_PROVIDER_ORDER` (default `openai,gemini,zen`) until one succeeds.
Within each provider, the deep model degrades to the fast model before moving to the next provider, and transient rate limits get one retry.

To use **any** model, point the `openai` provider at any `/chat/completions` endpoint:

```bash
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.openai.com/v1   # or OpenRouter, Ollama, vLLM, ...
OPENAI_MODEL=gpt-4.1-mini                   # query planning (text)
OPENAI_DEEP_MODEL=gpt-4.1-mini              # image analysis (must support vision)
```

The default (`gpt-4.1-mini` for both) is cheap, vision-capable, and fast.
`GET /health` reports the active chain and which providers have keys.

## Requirements

- Node.js **22.5+** (uses the built-in `node:sqlite` for caching)

## Routes

- `GET /health` - status, monthly usage, and remaining Unsplash rate budget
- `POST /api/analyze` - legacy contract (`{ input, context }` → `{ output, meta, error }`), kept for old frontends
- `POST /api/search` - full pipeline: `{ mode, text | image + mimeType, focus? }` → ranked photos + descriptors
- `POST /api/similar` - deep similar search: `{ photoUrl | image + mimeType, focus? }` → ranked lookalikes + EXIF
- `GET /api/unsplash/search` - proxied Unsplash keyword search
- `POST /api/unsplash/download` - Unsplash download trigger (compliance)
- `GET /api/profile/resolve?input=` - profile URL / username / name search → user or candidates
- `POST /api/profile/:username/index` - advance the portfolio index by one budgeted slice (frontend polls this)
- `GET /api/profile/:username` - index status + topic clusters
- `GET /api/profile/:username/photos` - filtered query (text, topic, from/to, location, order_by, page)
- `POST /api/profile/:username/enrich` - fetch real locations/EXIF for specific photo ids
- `POST /api/profile/:username/ask` - natural-language question → filters + results

All AI routes accept an optional `x-gemini-api-key` header; requests with it bypass `MONTHLY_ACTION_LIMIT`.

## Run locally

```bash
npm install
npm run dev
```

Env is loaded from the repo root `.env`, root `.env.local`, and `backend/.env` (shell variables win).
See `.env.example` for every knob.

## Deploying

GitHub Pages hosts only the static frontend - this service needs any Node host (Render, Railway, Fly.io, a VPS).
Checklist:

1. Deploy this `backend/` directory with `npm start` as the run command and Node 22.5+.
2. Set env vars on the host: `UNSPLASH_ACCESS_KEY`, at least one AI key (`OPENAI_API_KEY` and/or `GEMINI_API_KEY`), `CORS_ORIGINS=https://daiviknambiar.github.io`, `TRUST_PROXY=1`, and the run limits (`USER_MONTHLY_LIMIT=5`, `GLOBAL_MONTHLY_LIMIT=300`).
Most hosts inject `PORT` automatically; the server respects it.
3. Optionally point `DATA_DIR` at a persistent disk so profile indexes survive deploys.
Losing it is safe - it is a cache and rebuilds on demand.
4. Set the repo variable `NEXT_PUBLIC_API_BASE_URL` (GitHub → Settings → Secrets and variables → Actions → Variables) to the deployed backend origin, then re-run the Pages workflow so the frontend bakes it in.

## Notes

- Errors are surfaced verbatim: Gemini quota/rate problems, unavailable models, and Unsplash rate exhaustion each return their real cause instead of a generic failure.
- Usage tracking is in-memory (resets on restart and at UTC month rollover).
- The service keeps a reserve of the Unsplash hourly budget so profile indexing can never starve regular searches.
