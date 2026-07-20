// Model-agnostic LLM layer.
//
// Two driver types cover every provider:
//   - "gemini":            Google's native generateContent API
//   - "openai-compatible": any /chat/completions endpoint (OpenAI, OpenRouter,
//                          Ollama, OpenCode Zen, vLLM, ...)
//
// Providers are configured entirely through env vars and tried in
// LLM_PROVIDER_ORDER until one succeeds. Adding a new provider means adding
// env vars, not code.

const REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.REQUEST_TIMEOUT_MS, 60000);

function env(name) {
  return process.env[name]?.trim() || '';
}

function buildProviders() {
  const providers = {
    gemini: {
      type: 'gemini',
      key: env('GEMINI_API_KEY') || env('NEXT_PUBLIC_GEMINI_API_KEY'),
      baseUrl: env('GEMINI_API_BASE_URL').replace(/\/+$/, '') || 'https://generativelanguage.googleapis.com',
      models: {
        fast: env('GEMINI_MODEL') || 'gemini-3.5-flash',
        deep: env('GEMINI_DEEP_MODEL') || 'gemini-3-pro-preview',
      },
    },
    openai: {
      type: 'openai-compatible',
      key: env('OPENAI_API_KEY'),
      baseUrl: env('OPENAI_BASE_URL').replace(/\/+$/, '') || 'https://api.openai.com/v1',
      models: {
        fast: env('OPENAI_MODEL') || 'gpt-4.1-mini',
        deep: env('OPENAI_DEEP_MODEL') || env('OPENAI_MODEL') || 'gpt-4.1-mini',
      },
    },
    zen: {
      type: 'openai-compatible',
      key: env('OPENCODE_ZEN_API_KEY'),
      baseUrl: env('OPENCODE_ZEN_BASE_URL').replace(/\/+$/, '') || 'https://opencode.ai/zen/v1',
      models: {
        fast: env('OPENCODE_ZEN_MODEL') || 'gemini-3.5-flash',
        deep: env('OPENCODE_ZEN_DEEP_MODEL') || 'claude-sonnet-5',
      },
    },
  };

  const order = (env('LLM_PROVIDER_ORDER') || 'openai,gemini,zen')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);

  return order
    .filter((name) => providers[name])
    .map((name) => ({ name, ...providers[name] }));
}

export function describeProviders() {
  return buildProviders().map(({ name, type, models, key }) => ({
    name,
    type,
    configured: Boolean(key),
    fastModel: models.fast,
    deepModel: models.deep,
  }));
}

export class LlmError extends Error {
  constructor(message, { status = 502, retryable = false, provider = null } = {}) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
    this.retryable = retryable;
    this.provider = provider;
  }
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const payload = await response.json().catch(() => null);
    return { response, payload };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new LlmError('AI request timed out.', { status: 504, retryable: true });
    }
    throw new LlmError(`AI provider unreachable: ${error.message}`, { status: 502, retryable: true });
  } finally {
    clearTimeout(timer);
  }
}

// ---- Gemini driver ----

function classifyGeminiFailure(status, payload, name) {
  const message = payload?.error?.message || `Gemini request failed (${status}).`;
  const grpcStatus = payload?.error?.status || '';

  if (status === 429 || grpcStatus === 'RESOURCE_EXHAUSTED') {
    const depleted = /prepayment|credit|billing/i.test(message);
    return new LlmError(
      depleted
        ? 'Gemini credits are depleted for this API key. Manage billing at https://ai.studio/projects.'
        : 'Gemini free-tier rate limit hit.',
      { status: 429, retryable: !depleted, provider: name }
    );
  }
  if (status === 404) {
    return new LlmError(`Gemini model unavailable for this key: ${message}`, {
      status: 502,
      retryable: false,
      provider: name,
    });
  }
  if (status === 400 || status === 401 || status === 403) {
    return new LlmError(`Gemini rejected the request: ${message}`, {
      status: 502,
      retryable: false,
      provider: name,
    });
  }
  return new LlmError(message, { status: 502, retryable: status >= 500, provider: name });
}

async function callGemini({ provider, apiKey, model, prompt, image, schema }) {
  const parts = [{ text: prompt }];
  if (image) {
    parts.push({ inline_data: { mime_type: image.mimeType, data: image.base64 } });
  }

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      // Query planning does not need deep reasoning; low thinking cuts
      // seconds off every request on Gemini 3 models.
      thinkingConfig: { thinkingLevel: 'low' },
      ...(schema ? { responseJsonSchema: schema } : {}),
    },
  };

  const url = `${provider.baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  let { response, payload } = await fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  // Some models reject responseJsonSchema or thinkingConfig; retry once
  // without the optional config.
  if (!response.ok && response.status === 400) {
    delete body.generationConfig.responseJsonSchema;
    delete body.generationConfig.thinkingConfig;
    ({ response, payload } = await fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));
  }

  if (!response.ok) {
    throw classifyGeminiFailure(response.status, payload, provider.name);
  }

  const partsOut = payload?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(partsOut)
    ? partsOut
        .map((part) => (typeof part?.text === 'string' ? part.text : ''))
        .filter(Boolean)
        .join('\n')
        .trim()
    : '';
  if (!text) {
    throw new LlmError('Gemini returned an empty response.', {
      status: 502,
      retryable: true,
      provider: provider.name,
    });
  }
  return {
    text,
    meta: {
      provider: provider.name,
      model: payload?.modelVersion || model,
      usage: payload?.usageMetadata ?? null,
    },
  };
}

// ---- OpenAI-compatible driver ----

function classifyOpenAiFailure(status, payload, name) {
  const message =
    payload?.error?.message || payload?.message || `${name} request failed (${status}).`;
  const code = payload?.error?.code || payload?.error?.type || payload?.type || '';

  if (status === 401 || status === 403) {
    return new LlmError(`${name}: invalid or unauthorized API key. ${message}`, {
      status: 502,
      retryable: false,
      provider: name,
    });
  }
  if (status === 429 || /insufficient_quota|CreditsError|billing|payment/i.test(`${code} ${message}`)) {
    const quota = /insufficient_quota|CreditsError|billing|payment/i.test(`${code} ${message}`);
    return new LlmError(
      quota ? `${name}: out of credits or no billing set up. ${message}` : `${name}: rate limit hit.`,
      { status: 429, retryable: !quota, provider: name }
    );
  }
  if (status === 404) {
    return new LlmError(`${name}: model not found. ${message}`, {
      status: 502,
      retryable: false,
      provider: name,
    });
  }
  return new LlmError(`${name}: ${message}`, { status: 502, retryable: status >= 500, provider: name });
}

async function callOpenAiCompatible({ provider, model, prompt, image }) {
  const content = image
    ? [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.base64}` } },
      ]
    : prompt;

  const { response, payload } = await fetchJson(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.key}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content }],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok || payload?.error) {
    throw classifyOpenAiFailure(response.status, payload, provider.name);
  }

  const text = payload?.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new LlmError(`${provider.name} returned an empty response.`, {
      status: 502,
      retryable: false,
      provider: provider.name,
    });
  }
  return {
    text,
    meta: { provider: provider.name, model: payload?.model || model, usage: payload?.usage ?? null },
  };
}

// ---- Orchestration ----

function cleanJsonText(text) {
  return text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();
}

function finalize({ text, meta }) {
  let parsed;
  try {
    parsed = JSON.parse(cleanJsonText(text));
  } catch {
    throw new LlmError('AI returned malformed JSON.', {
      status: 502,
      retryable: true,
      provider: meta.provider,
    });
  }
  return { data: parsed, meta };
}

/**
 * Generate a JSON object from the configured provider chain.
 *
 * headerKeys: API keys supplied by the end user via request headers
 * ({ gemini, openai }). A user-supplied key overrides that provider's key
 * and promotes it to the front of the chain (the user explicitly chose it).
 */
export async function generateJson({ tier = 'fast', prompt, image = null, schema = null, headerKeys = {} }) {
  let chain = buildProviders();

  const promote = (name, key) => {
    const base = chain.find((p) => p.name === name);
    if (!base) return;
    chain = [{ ...base, key }, ...chain.filter((p) => p.name !== name)];
  };
  if (headerKeys.openai) promote('openai', headerKeys.openai);
  else if (headerKeys.gemini) promote('gemini', headerKeys.gemini);

  const configured = chain.filter((p) => p.key);
  if (configured.length === 0) {
    throw new LlmError(
      'No AI provider is configured. Set OPENAI_API_KEY or GEMINI_API_KEY on the backend.',
      { status: 500 }
    );
  }

  const attempts = [];
  for (const provider of configured) {
    // Deep tier degrades to the provider's fast model before moving on —
    // deep models are often paid-only or capacity-constrained.
    const models =
      tier === 'deep' && provider.models.deep !== provider.models.fast
        ? [provider.models.deep, provider.models.fast]
        : [provider.models[tier] ?? provider.models.fast];

    for (const model of models) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const call = provider.type === 'gemini' ? callGemini : callOpenAiCompatible;
          const result = await call({
            provider,
            apiKey: provider.key,
            model,
            prompt,
            image,
            schema,
          });
          return finalize(result);
        } catch (error) {
          attempts.push(error);
          if (error instanceof LlmError && error.retryable && attempt === 0) {
            await sleep(1500);
            continue;
          }
          break;
        }
      }
    }
  }

  const primary = attempts.find((e) => e instanceof LlmError) ?? attempts[0];
  const summary = [...new Set(attempts.map((e) => `${e.provider ?? 'unknown'}: ${e.message}`))].join(' | ');
  throw new LlmError(summary || 'All AI providers failed.', {
    status: primary instanceof LlmError ? primary.status : 502,
    retryable: false,
  });
}
