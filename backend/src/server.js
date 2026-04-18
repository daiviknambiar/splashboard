import cors from 'cors';
import express from 'express';

const PORT = parsePositiveInt(process.env.PORT, 4000);
const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim() || '';
const GEMINI_API_BASE_URL =
  process.env.GEMINI_API_BASE_URL?.trim().replace(/\/+$/, '') || 'https://generativelanguage.googleapis.com';
const MONTHLY_ACTION_LIMIT = parsePositiveInt(process.env.MONTHLY_ACTION_LIMIT, 4);
const MAX_BODY_MB = parsePositiveInt(process.env.MAX_BODY_MB, 12);
const REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.REQUEST_TIMEOUT_MS, 30000);

const app = express();
const usageState = {
  month: currentMonthKey(),
  used: 0,
};

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
    allowedHeaders: ['Content-Type', 'x-gemini-api-key'],
    maxAge: 86400,
  })
);

app.use(express.json({ limit: `${MAX_BODY_MB}mb` }));

app.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    model: GEMINI_MODEL,
    month: usageState.month,
    used: usageState.used,
    limit: MONTHLY_ACTION_LIMIT,
  });
});

app.post('/api/analyze', async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    sendContractError(res, 400, 'Request body must be a JSON object.', null);
    return;
  }

  const input = typeof body.input === 'string' ? body.input.trim() : '';
  if (!input) {
    sendContractError(res, 400, 'Request body requires a non-empty `input` string.', null);
    return;
  }

  const context = sanitizeContext(body.context);
  const type = context.type === 'image' ? 'image' : 'text';
  const mimeType = typeof context.mimeType === 'string' ? context.mimeType.trim() : '';
  if (type === 'image' && !mimeType.startsWith('image/')) {
    sendContractError(res, 400, 'Image analysis requires context.mimeType, e.g. image/jpeg.', null);
    return;
  }

  const userGeminiKey = readHeader(req.headers['x-gemini-api-key']);
  const usingOwnApiKey = userGeminiKey.length > 0;
  const apiKey = usingOwnApiKey ? userGeminiKey : GEMINI_API_KEY;

  if (!apiKey) {
    sendContractError(
      res,
      500,
      'Missing GEMINI_API_KEY on backend and no x-gemini-api-key header was provided.',
      {
        usage: buildUsageSummary(usingOwnApiKey),
      }
    );
    return;
  }

  if (!usingOwnApiKey && isOverLimit()) {
    sendContractError(
      res,
      429,
      'Free monthly limit reached for this backend. Provide x-gemini-api-key or wait for next month.',
      {
        usage: buildUsageSummary(usingOwnApiKey),
      }
    );
    return;
  }

  try {
    const geminiResponse = await generateDescriptors({
      apiKey,
      model: GEMINI_MODEL,
      input,
      type,
      mimeType,
      context,
    });

    if (!usingOwnApiKey) {
      incrementUsage();
    }

    const output = extractModelText(geminiResponse);
    if (!output) {
      sendContractError(res, 502, 'Gemini returned an empty response.', {
        usage: buildUsageSummary(usingOwnApiKey),
        gemini: pickGeminiMeta(geminiResponse),
      });
      return;
    }

    res.status(200).json({
      output,
      meta: {
        usage: buildUsageSummary(usingOwnApiKey),
        gemini: pickGeminiMeta(geminiResponse),
      },
      error: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Analysis failed.';
    sendContractError(res, 502, message, {
      usage: buildUsageSummary(usingOwnApiKey),
    });
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof SyntaxError && 'body' in error) {
    sendContractError(res, 400, 'Invalid JSON body.', null);
    return;
  }
  if (error instanceof Error && error.message.includes('CORS')) {
    sendContractError(res, 403, error.message, null);
    return;
  }
  sendContractError(res, 500, 'Unexpected server error.', null);
});

app.listen(PORT, () => {
  const corsDisplay = c.allowAny ? '*' : Array.from(c.allowed).join(', ');
  console.log(`[backend] listening on http://localhost:${PORT}`);
  console.log(`[backend] model=${GEMINI_MODEL} cors=${corsDisplay || '(none)'}`);
});

function buildAnalyzePrompt(type, context) {
  const mode = typeof context.mode === 'string' ? context.mode : 'unknown';
  const contextJson = JSON.stringify(context);
  const schema = [
    '{',
    '  "locationType": "string",',
    '  "lightingConditions": "string",',
    '  "colorPalette": "string",',
    '  "mood": "string",',
    '  "framing": "string",',
    '  "architectureStyle": "string | null",',
    '  "searchTerms": ["string", "string", "string"]',
    '}',
  ].join('\n');

  return [
    'You extract visual-search descriptors for photography inspiration.',
    'Return exactly one valid JSON object and no markdown.',
    'Keep values concise and practical for Unsplash queries.',
    `Requested mode: ${mode}.`,
    `Payload type: ${type}.`,
    `Client context: ${contextJson}.`,
    'Required JSON shape:',
    schema,
    'Rules:',
    '- Always include all keys.',
    '- architectureStyle must be null when not applicable.',
    '- searchTerms must include 3 to 6 short phrases.',
    '- No explanation, no code fences, no extra keys.',
  ].join('\n');
}

async function generateDescriptors({ apiKey, model, input, type, mimeType, context }) {
  const prompt = buildAnalyzePrompt(type, context);
  const parts = [{ text: prompt }];
  if (type === 'image') {
    parts.push({ text: 'Analyze the attached image and provide descriptors.' });
    parts.push({
      inline_data: {
        mime_type: mimeType,
        data: input,
      },
    });
  } else {
    parts.push({ text: `Analyze this text description:\n${input}` });
  }

  const url = `${GEMINI_API_BASE_URL}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const timeout = new AbortController();
  const timeoutId = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      }),
      signal: timeout.signal,
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(parseGeminiError(payload, response.status));
    }

    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Gemini request timed out.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function pickGeminiMeta(responsePayload) {
  if (!responsePayload || typeof responsePayload !== 'object' || Array.isArray(responsePayload)) {
    return null;
  }
  const candidate = Array.isArray(responsePayload.candidates) ? responsePayload.candidates[0] : null;
  return {
    modelVersion:
      typeof responsePayload.modelVersion === 'string' ? responsePayload.modelVersion : GEMINI_MODEL,
    finishReason:
      candidate && typeof candidate.finishReason === 'string' ? candidate.finishReason : null,
    usageMetadata:
      responsePayload.usageMetadata &&
      typeof responsePayload.usageMetadata === 'object' &&
      !Array.isArray(responsePayload.usageMetadata)
        ? responsePayload.usageMetadata
        : null,
  };
}

function parseGeminiError(payload, status) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const maybeError = payload.error;
    if (maybeError && typeof maybeError === 'object' && !Array.isArray(maybeError)) {
      const message = typeof maybeError.message === 'string' ? maybeError.message : null;
      if (message) return message;
    }
  }
  return `Gemini request failed (${status}).`;
}

function extractModelText(responsePayload) {
  if (!responsePayload || typeof responsePayload !== 'object' || Array.isArray(responsePayload)) {
    return null;
  }

  const candidates = responsePayload.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  const first = candidates[0];
  if (!first || typeof first !== 'object' || Array.isArray(first)) {
    return null;
  }

  const content = first.content;
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return null;
  }

  const parts = content.parts;
  if (!Array.isArray(parts)) {
    return null;
  }

  const text = parts
    .map((part) => (part && typeof part === 'object' && typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();

  return text || null;
}

function sanitizeContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value;
}

function sendContractError(res, status, error, meta) {
  res.status(status).json({
    output: null,
    meta: meta ?? null,
    error,
  });
}

function readHeader(headerValue) {
  if (Array.isArray(headerValue)) {
    return headerValue[0]?.trim() || '';
  }
  return typeof headerValue === 'string' ? headerValue.trim() : '';
}

function currentMonthKey() {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function syncUsageMonth() {
  const month = currentMonthKey();
  if (usageState.month !== month) {
    usageState.month = month;
    usageState.used = 0;
  }
}

function isOverLimit() {
  syncUsageMonth();
  if (MONTHLY_ACTION_LIMIT <= 0) return false;
  return usageState.used >= MONTHLY_ACTION_LIMIT;
}

function incrementUsage() {
  syncUsageMonth();
  usageState.used += 1;
}

function buildUsageSummary(usingOwnApiKey) {
  syncUsageMonth();
  const isLimited = MONTHLY_ACTION_LIMIT > 0 && usageState.used >= MONTHLY_ACTION_LIMIT;
  return {
    month: usageState.month,
    used: usageState.used,
    limit: MONTHLY_ACTION_LIMIT,
    remaining: MONTHLY_ACTION_LIMIT > 0 ? Math.max(MONTHLY_ACTION_LIMIT - usageState.used, 0) : 0,
    isLimited,
    usingOwnApiKey,
  };
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function buildCorsConfig(originsValue) {
  const raw = typeof originsValue === 'string' ? originsValue.trim() : '';
  if (!raw || raw === '*') {
    return { allowAny: true, allowed: new Set() };
  }

  const allowed = new Set(
    raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );
  return {
    allowAny: allowed.has('*'),
    allowed,
  };
}
