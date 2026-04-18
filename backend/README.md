# Splashboard Backend

Minimal Express service that implements the frontend contract:

- `POST /api/analyze`
- Request: `{ input, context }` plus optional `x-gemini-api-key` header
- Response shape: `{ output, meta, error }`

## 1) Install

```bash
cd backend
npm install
```

## 2) Configure env

```bash
cp .env.example .env
```

Set at least:

- `GEMINI_API_KEY` (required unless caller always sends `x-gemini-api-key`)
- `CORS_ORIGINS` (set your frontend origins for production)

## 3) Run locally

```bash
npm run dev
```

Backend runs on `http://localhost:4000` by default.

## 4) Connect frontend

In frontend `.env.local`:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
```

## Routes

- `GET /health` health/status check
- `POST /api/analyze` analyzes text or image prompts through Gemini

## Notes

- `MONTHLY_ACTION_LIMIT` applies only when using backend-owned `GEMINI_API_KEY`.
- If caller sends `x-gemini-api-key`, that key is used for the request instead.
- Usage tracking is in-memory (resets on restart/deploy and at UTC month rollover).
