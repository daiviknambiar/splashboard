import { loadEnv } from './env.js';
loadEnv();

import crypto from 'node:crypto';
import cors from 'cors';
import express from 'express';
import { getUsage, incrementUsage } from './db.js';
import { LlmError, describeProviders } from './llm.js';
import {
  advanceProfileIndex,
  enrichProfilePhotos,
  getProfileStatus,
  queryProfilePhotos,
  resolveProfile,
  smartAsk,
} from './profile.js';
import {
  buildQueryPlan,
  enrichWithExif,
  executeQueryPlan,
  loadReferencePhoto,
} from './search.js';
import { rateBudget, searchPhotos, triggerDownload, UnsplashError } from './unsplash.js';

const PORT = parsePositiveInt(process.env.PORT, 4000);
// Per-visitor free AI runs per month (identified by hashed IP; 0 = unlimited).
const USER_MONTHLY_LIMIT = parsePositiveInt(process.env.USER_MONTHLY_LIMIT, 5);
// Backstop across ALL visitors so the owner's bill has a hard ceiling.
// MONTHLY_ACTION_LIMIT kept as a legacy alias.
const GLOBAL_MONTHLY_LIMIT = parsePositiveInt(
  process.env.GLOBAL_MONTHLY_LIMIT ?? process.env.MONTHLY_ACTION_LIMIT,
  300
);
const TRUST_PROXY = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true';
const MAX_BODY_MB = parsePositiveInt(process.env.MAX_BODY_MB, 12);
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const GLOBAL_KEY = '*';

const app = express();

const c = buildCorsConfig(process.env.CORS_ORIGINS);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || c.allowAny || c.allowed.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin not allowed by CORS.'));
    },
    methods: ['POST', 'OPTIONS', 'GET'],
    allowedHeaders: ['Content-Type', 'x-gemini-api-key', 'x-openai-api-key'],
    maxAge: 86400,
  })
);
app.use(express.json({ limit: `${MAX_BODY_MB}mb` }));

app.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
    month: currentMonthKey(),
    globalUsed: getUsage(currentMonthKey(), GLOBAL_KEY),
    globalLimit: GLOBAL_MONTHLY_LIMIT,
    userLimit: USER_MONTHLY_LIMIT,
    unsplashRate: rateBudget(),
    providers: describeProviders(),
  });
});

/** Current caller's remaining free runs — costs nothing, powers the UI meter. */
app.get('/api/usage', (req, res) => {
  res.status(200).json({ usage: usageSummary(req, false) });
});

/** Wrap an async handler so thrown errors become honest JSON responses. */
function route(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      const status =
        error instanceof LlmError || error instanceof UnsplashError
          ? error.status >= 400 && error.status < 600
            ? error.status
            : 502
          : 500;
      const message = error instanceof Error ? error.message : 'Unexpected server error.';
      if (status >= 500) console.error('[backend]', message);
      res.status(status).json({ error: message, usage: usageSummary(req, false) });
    }
  };
}

function aiGate(req, res) {
  const headerKeys = {
    gemini: readHeader(req.headers['x-gemini-api-key']),
    openai: readHeader(req.headers['x-openai-api-key']),
  };
  const usingOwnApiKey = Boolean(headerKeys.gemini || headerKeys.openai);
  if (!usingOwnApiKey) {
    const month = currentMonthKey();
    if (USER_MONTHLY_LIMIT > 0 && getUsage(month, clientKey(req)) >= USER_MONTHLY_LIMIT) {
      res.status(429).json({
        error: `You've used all ${USER_MONTHLY_LIMIT} free runs for this month. Splashboard is open source and the maintainer covers the AI bill — add your own Gemini key to keep going, or run it yourself for free.`,
        usage: usageSummary(req, usingOwnApiKey),
      });
      return null;
    }
    if (GLOBAL_MONTHLY_LIMIT > 0 && getUsage(month, GLOBAL_KEY) >= GLOBAL_MONTHLY_LIMIT) {
      res.status(429).json({
        error: 'The shared free pool for this month is fully used across all visitors. Add your own Gemini key, or run Splashboard yourself — it is open source.',
        usage: usageSummary(req, usingOwnApiKey),
      });
      return null;
    }
  }
  return { headerKeys, usingOwnApiKey };
}

function countAiAction(req, usingOwnApiKey) {
  if (usingOwnApiKey) return;
  const month = currentMonthKey();
  incrementUsage(month, clientKey(req));
  incrementUsage(month, GLOBAL_KEY);
}

function parseImagePayload(body) {
  const base64 = typeof body.image === 'string' ? body.image.trim() : '';
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType.trim() : '';
  if (!base64) return null;
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
    throw Object.assign(new Error('Unsupported image type. Use JPEG, PNG, WebP, or GIF.'), { status: 400 });
  }
  return { base64, mimeType };
}

/**
 * Legacy contract kept for old frontends: returns descriptors as a JSON
 * string in `output`. New frontends use /api/search instead.
 */
app.post('/api/analyze', route(async (req, res) => {
  const body = req.body ?? {};
  const input = typeof body.input === 'string' ? body.input.trim() : '';
  if (!input) {
    res.status(400).json({ output: null, meta: null, error: 'Request body requires a non-empty `input` string.' });
    return;
  }
  const gate = aiGate(req, res);
  if (!gate) return;

  const context = body.context && typeof body.context === 'object' ? body.context : {};
  const isImage = context.type === 'image';
  const image = isImage ? parseImagePayload({ image: input, mimeType: context.mimeType }) : null;

  const plan = await buildQueryPlan({
    mode: typeof context.mode === 'string' ? context.mode : 'moodboard',
    text: isImage ? null : input,
    image,
    headerKeys: gate.headerKeys,
  });
  countAiAction(req, gate.usingOwnApiKey);

  res.status(200).json({
    output: JSON.stringify(plan.descriptors),
    meta: { usage: usageSummary(req, gate.usingOwnApiKey), ai: plan.meta },
    error: null,
  });
}));

/**
 * Full search pipeline: AI query plan -> Unsplash fan-out -> ranked photos.
 * body: { mode, text? , image?, mimeType?, focus? }
 */
app.post('/api/search', route(async (req, res) => {
  const body = req.body ?? {};
  const mode = body.mode === 'stealthisshot' ? 'stealthisshot' : 'moodboard';
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const focus = typeof body.focus === 'string' ? body.focus.trim() : '';
  const image = parseImagePayload(body);

  if (!text && !image) {
    res.status(400).json({ error: 'Provide `text` or `image` + `mimeType`.', usage: usageSummary(req, false) });
    return;
  }
  if (text && (text.length < 3 || text.length > 1000)) {
    res.status(400).json({ error: 'Description must be 3-1000 characters.', usage: usageSummary(req, false) });
    return;
  }
  const gate = aiGate(req, res);
  if (!gate) return;

  const plan = await buildQueryPlan({
    mode,
    text: image ? null : text,
    image,
    focus: focus || null,
    headerKeys: gate.headerKeys,
  });
  let photos = await executeQueryPlan({ ...plan, focus: focus || null });
  if (mode === 'stealthisshot') {
    photos = await enrichWithExif(photos);
  }
  // Only charge a run once the user actually got results.
  countAiAction(req, gate.usingOwnApiKey);

  res.status(200).json({
    photos,
    descriptors: plan.descriptors,
    queries: plan.queries,
    usage: usageSummary(req, gate.usingOwnApiKey),
    meta: plan.meta,
    error: null,
  });
}));

/**
 * Deep similar search from a pasted Unsplash photo URL or uploaded image,
 * with an optional pinpoint focus ("match the fog, ignore the subject").
 * body: { photoUrl? , image?, mimeType?, focus? }
 */
app.post('/api/similar', route(async (req, res) => {
  const body = req.body ?? {};
  const photoUrl = typeof body.photoUrl === 'string' ? body.photoUrl.trim() : '';
  const focus = typeof body.focus === 'string' ? body.focus.trim() : '';
  let image = parseImagePayload(body);
  let hints = null;
  let reference = null;

  if (!image && !photoUrl) {
    res.status(400).json({ error: 'Provide `photoUrl` or `image` + `mimeType`.', usage: usageSummary(req, false) });
    return;
  }
  const gate = aiGate(req, res);
  if (!gate) return;

  if (!image) {
    const loaded = await loadReferencePhoto(photoUrl);
    image = loaded.image;
    hints = loaded.hints;
    reference = loaded.reference;
  }

  const plan = await buildQueryPlan({
    mode: 'similar',
    image,
    focus: focus || null,
    hints,
    headerKeys: gate.headerKeys,
  });
  let photos = await executeQueryPlan({ ...plan, focus: focus || null });
  if (reference) {
    photos = photos.filter((photo) => photo.id !== reference.id);
  }
  photos = await enrichWithExif(photos);
  // Only charge a run once the user actually got results.
  countAiAction(req, gate.usingOwnApiKey);

  res.status(200).json({
    photos,
    descriptors: plan.descriptors,
    queries: plan.queries,
    reference,
    usage: usageSummary(req, gate.usingOwnApiKey),
    meta: plan.meta,
    error: null,
  });
}));

// ---- Unsplash proxy (keeps the access key off the client) ----

app.get('/api/unsplash/search', route(async (req, res) => {
  const query = typeof req.query.query === 'string' ? req.query.query.trim() : '';
  if (!query) {
    res.status(400).json({ error: 'query is required.' });
    return;
  }
  const photos = await searchPhotos({
    query,
    perPage: clampInt(req.query.per_page, 1, 30, 10),
    color: typeof req.query.color === 'string' ? req.query.color : undefined,
    orientation: typeof req.query.orientation === 'string' ? req.query.orientation : undefined,
  });
  res.status(200).json({ photos });
}));

app.post('/api/unsplash/download', route(async (req, res) => {
  const location = typeof req.body?.downloadLocation === 'string' ? req.body.downloadLocation : '';
  if (!location) {
    res.status(400).json({ error: 'downloadLocation is required.' });
    return;
  }
  await triggerDownload(location);
  res.status(200).json({ ok: true });
}));

// ---- Profile explorer ----

app.get('/api/profile/resolve', route(async (req, res) => {
  const input = typeof req.query.input === 'string' ? req.query.input.trim() : '';
  if (!input) {
    res.status(400).json({ error: 'input is required.' });
    return;
  }
  const result = await resolveProfile(input);
  res.status(200).json(result);
}));

app.post('/api/profile/:username/index', route(async (req, res) => {
  const status = await advanceProfileIndex(req.params.username, {
    maxRequests: clampInt(req.body?.maxRequests, 1, 15, 8),
  });
  res.status(200).json(status);
}));

app.get('/api/profile/:username', route(async (req, res) => {
  const status = getProfileStatus(req.params.username);
  if (!status) {
    res.status(404).json({ error: 'Profile not indexed yet. POST to /api/profile/:username/index first.' });
    return;
  }
  res.status(200).json(status);
}));

app.get('/api/profile/:username/photos', route(async (req, res) => {
  const q = req.query;
  const result = queryProfilePhotos(req.params.username, {
    text: typeof q.text === 'string' ? q.text : '',
    topic: typeof q.topic === 'string' && q.topic ? q.topic : null,
    from: typeof q.from === 'string' && q.from ? q.from : null,
    to: typeof q.to === 'string' && q.to ? q.to : null,
    location: typeof q.location === 'string' && q.location ? q.location : null,
    orderBy: typeof q.order_by === 'string' ? q.order_by : 'latest',
    page: clampInt(q.page, 1, 1000, 1),
    perPage: clampInt(q.per_page, 1, 60, 30),
  });
  res.status(200).json(result);
}));

app.post('/api/profile/:username/enrich', route(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((id) => typeof id === 'string') : [];
  const result = await enrichProfilePhotos(req.params.username, ids, {
    maxRequests: clampInt(req.body?.maxRequests, 1, 20, 10),
  });
  res.status(200).json(result);
}));

app.post('/api/profile/:username/ask', route(async (req, res) => {
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  if (!question) {
    res.status(400).json({ error: 'question is required.' });
    return;
  }
  const gate = aiGate(req, res);
  if (!gate) return;

  const { filters, note, meta } = await smartAsk(req.params.username, question);
  countAiAction(req, gate.usingOwnApiKey);
  const result = queryProfilePhotos(req.params.username, filters);
  res.status(200).json({ ...result, filters, note, usage: usageSummary(req, gate.usingOwnApiKey), meta });
}));

app.use((error, _req, res, _next) => {
  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({ error: 'Invalid JSON body.' });
    return;
  }
  if (error instanceof Error && error.message.includes('CORS')) {
    res.status(403).json({ error: error.message });
    return;
  }
  console.error('[backend]', error);
  res.status(500).json({ error: 'Unexpected server error.' });
});

app.listen(PORT, () => {
  const corsDisplay = c.allowAny ? '*' : Array.from(c.allowed).join(', ');
  const chain = describeProviders()
    .map((p) => `${p.name}${p.configured ? '' : ' (no key)'} → ${p.fastModel}`)
    .join(', ');
  console.log(`[backend] listening on http://localhost:${PORT}`);
  console.log(`[backend] ai chain: ${chain} | cors=${corsDisplay || '(none)'}`);
});

// ---- helpers ----

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function readHeader(headerValue) {
  if (Array.isArray(headerValue)) return headerValue[0]?.trim() || '';
  return typeof headerValue === 'string' ? headerValue.trim() : '';
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Identify a visitor without accounts: hash of their IP. Imperfect (VPNs,
 * shared networks) but the standard no-login approach. The raw IP is never
 * stored. Set TRUST_PROXY=1 when deployed behind a reverse proxy.
 */
function clientKey(req) {
  const forwarded = readHeader(req.headers['x-forwarded-for']).split(',')[0].trim();
  const ip = (TRUST_PROXY && forwarded) || req.socket?.remoteAddress || 'unknown';
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

function usageSummary(req, usingOwnApiKey) {
  const month = currentMonthKey();
  const used = getUsage(month, clientKey(req));
  const globalUsed = getUsage(month, GLOBAL_KEY);
  const userLimited = USER_MONTHLY_LIMIT > 0 && used >= USER_MONTHLY_LIMIT;
  const globalLimited = GLOBAL_MONTHLY_LIMIT > 0 && globalUsed >= GLOBAL_MONTHLY_LIMIT;
  return {
    month,
    used,
    limit: USER_MONTHLY_LIMIT,
    remaining: USER_MONTHLY_LIMIT > 0 ? Math.max(USER_MONTHLY_LIMIT - used, 0) : 0,
    isLimited: !usingOwnApiKey && (userLimited || globalLimited),
    globalLimited,
    usingOwnApiKey,
  };
}

function buildCorsConfig(originsValue) {
  const raw = typeof originsValue === 'string' ? originsValue.trim() : '';
  if (!raw || raw === '*') return { allowAny: true, allowed: new Set() };
  const allowed = new Set(raw.split(',').map((item) => item.trim()).filter(Boolean));
  return { allowAny: allowed.has('*'), allowed };
}
