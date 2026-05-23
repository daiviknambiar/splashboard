import type { UsageSummary, VisualDescriptors } from '@/types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ?? '';
const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const ANALYZE_TIMEOUT_MS = 25000;

interface BackendAnalyzeResponse {
  output: string | null;
  meta: Record<string, unknown> | null;
  error: string | null;
}

export interface AnalyzeRequestPayload {
  input: string;
  context?: Record<string, unknown>;
  geminiApiKey?: string;
}

export interface AnalyzeResponse {
  descriptors: VisualDescriptors;
  usage?: UsageSummary;
  meta: Record<string, unknown> | null;
}

export class AnalyzeApiError extends Error {
  status: number;
  usage?: UsageSummary;
  meta: Record<string, unknown> | null;

  constructor(message: string, status: number, meta: Record<string, unknown> | null) {
    super(message);
    this.name = 'AnalyzeApiError';
    this.status = status;
    this.meta = meta;
    this.usage = parseUsageSummary((meta as { usage?: unknown } | null)?.usage) ?? parseUsageSummary(meta);
  }
}

function buildApiUrl(pathname: string): string {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const trimmedBase = API_BASE_URL.replace(/\/+$/, '');
  if (trimmedBase.length > 0) {
    return `${trimmedBase}${normalizedPath}`;
  }

  if (typeof window !== 'undefined' && LOCALHOST_HOSTNAMES.has(window.location.hostname)) {
    return normalizedPath;
  }

  throw new Error(
    'Missing NEXT_PUBLIC_API_BASE_URL. Set it to your backend origin for non-local deployments.'
  );
}

function getCurrentOrigin(): string {
  if (typeof window === 'undefined') {
    return 'this origin';
  }
  return window.location.origin;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function buildNetworkErrorMessage(error: unknown): string {
  const backendLabel = API_BASE_URL || '(unset)';
  if (isAbortError(error)) {
    return `The backend at ${backendLabel} did not respond within ${Math.round(
      ANALYZE_TIMEOUT_MS / 1000
    )} seconds. It may be waking up or unavailable.`;
  }

  return `Could not reach the backend at ${backendLabel}. Check that it is online and that CORS allows ${getCurrentOrigin()}.`;
}

function cleanJsonText(value: string): string {
  return value
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();
}

function parseUsageSummary(value: unknown): UsageSummary | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const maybe = value as Partial<UsageSummary>;
  if (
    typeof maybe.month !== 'string' ||
    typeof maybe.used !== 'number' ||
    typeof maybe.limit !== 'number' ||
    typeof maybe.remaining !== 'number' ||
    typeof maybe.isLimited !== 'boolean'
  ) {
    return undefined;
  }
  return {
    month: maybe.month,
    used: maybe.used,
    limit: maybe.limit,
    remaining: maybe.remaining,
    isLimited: maybe.isLimited,
    usingOwnApiKey: maybe.usingOwnApiKey,
  };
}

function isVisualDescriptors(value: unknown): value is VisualDescriptors {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const maybe = value as Partial<VisualDescriptors>;
  return (
    typeof maybe.locationType === 'string' &&
    typeof maybe.lightingConditions === 'string' &&
    typeof maybe.colorPalette === 'string' &&
    typeof maybe.mood === 'string' &&
    typeof maybe.framing === 'string' &&
    Array.isArray(maybe.searchTerms)
  );
}

function parseDescriptors(output: string): VisualDescriptors {
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanJsonText(output));
  } catch {
    throw new Error('Backend returned malformed descriptor JSON.');
  }
  if (!isVisualDescriptors(parsed)) {
    throw new Error('Invalid analysis response format from backend.');
  }

  const filteredSearchTerms = parsed.searchTerms.filter((term): term is string => typeof term === 'string');
  if (filteredSearchTerms.length === 0) {
    throw new Error('Backend response did not include searchable terms.');
  }

  return {
    ...parsed,
    architectureStyle:
      typeof parsed.architectureStyle === 'string' || parsed.architectureStyle === null
        ? parsed.architectureStyle
        : null,
    searchTerms: filteredSearchTerms,
  };
}

function parseBackendResponse(value: unknown): BackendAnalyzeResponse | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const maybe = value as Partial<BackendAnalyzeResponse>;
  return {
    output: typeof maybe.output === 'string' || maybe.output === null ? maybe.output : null,
    meta:
      maybe.meta && typeof maybe.meta === 'object' && !Array.isArray(maybe.meta)
        ? (maybe.meta as Record<string, unknown>)
        : null,
    error: typeof maybe.error === 'string' || maybe.error === null ? maybe.error : null,
  };
}

export async function analyzeInput(payload: AnalyzeRequestPayload): Promise<AnalyzeResponse> {
  const input = payload.input.trim();
  if (input.length === 0) {
    throw new Error('Input is required.');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const userGeminiKey = payload.geminiApiKey?.trim();
  if (userGeminiKey) {
    headers['x-gemini-api-key'] = userGeminiKey;
  }

  const apiUrl = buildApiUrl('/api/analyze');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ANALYZE_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        input,
        context: payload.context,
      }),
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (error) {
    throw new AnalyzeApiError(buildNetworkErrorMessage(error), 0, null);
  } finally {
    clearTimeout(timeoutId);
  }

  const responseData = parseBackendResponse(await response.json().catch(() => null));
  const meta = responseData?.meta ?? null;
  const usage = parseUsageSummary((meta as { usage?: unknown } | null)?.usage) ?? parseUsageSummary(meta);

  if (!response.ok || responseData?.error) {
    throw new AnalyzeApiError(
      responseData?.error || `Analysis request failed (${response.status}).`,
      response.status,
      meta
    );
  }

  if (!responseData?.output) {
    throw new AnalyzeApiError('Backend did not return analysis output.', response.status, meta);
  }

  return {
    descriptors: parseDescriptors(responseData.output),
    usage,
    meta,
  };
}
