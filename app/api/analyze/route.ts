import { NextResponse, type NextRequest } from 'next/server';
import { analyzeImage, analyzeText } from '@/lib/gemini';
import { isTrustedBrowserRequest } from '@/lib/api-security';
import { consumeBurstRequest, consumeMonthlyAction, getUsageSummary } from '@/lib/usage';
import type { UsageSummary, VisualDescriptors } from '@/types';

type AnalyzeRequest =
  | { type: 'text'; description: string; apiKey?: string }
  | { type: 'image'; image: string; mimeType: string; apiKey?: string };

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_REQUEST_BYTES = 15 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_BASE64_LENGTH = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 16;
const MIN_API_KEY_LENGTH = 20;
const MAX_API_KEY_LENGTH = 200;

function readServerGeminiApiKey(): string | null {
  const preferred = process.env.GEMINI_API_KEY?.trim();
  if (preferred) return preferred;

  const fallback = process.env.NEXT_PUBLIC_GEMINI_API_KEY?.trim();
  return fallback && fallback.length > 0 ? fallback : null;
}

function jsonError(message: string, status = 400, usage?: UsageSummary, retryAfterSeconds?: number) {
  const body = usage ? { error: message, usage } : { error: message };
  const headers =
    typeof retryAfterSeconds === 'number' && retryAfterSeconds > 0
      ? { 'Retry-After': String(retryAfterSeconds) }
      : undefined;
  return NextResponse.json(body, { status, headers });
}

function resolveApiKey(payload: Partial<AnalyzeRequest>): {
  apiKey: string | null;
  usingOwnApiKey: boolean;
  invalidApiKey: boolean;
} {
  const provided = typeof payload.apiKey === 'string' ? payload.apiKey.trim() : '';
  if (provided.length > 0) {
    if (provided.length < MIN_API_KEY_LENGTH || provided.length > MAX_API_KEY_LENGTH) {
      return {
        apiKey: null,
        usingOwnApiKey: false,
        invalidApiKey: true,
      };
    }
    return {
      apiKey: provided,
      usingOwnApiKey: true,
      invalidApiKey: false,
    };
  }
  return {
    apiKey: readServerGeminiApiKey(),
    usingOwnApiKey: false,
    invalidApiKey: false,
  };
}

function parseErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return 'Something went wrong while analyzing the input.';
}

function isVisualDescriptors(value: unknown): value is VisualDescriptors {
  if (!value || typeof value !== 'object') return false;
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

export async function POST(request: NextRequest) {
  let payload: Partial<AnalyzeRequest>;
  let usage: UsageSummary | undefined;

  if (!isTrustedBrowserRequest(request)) {
    return jsonError('Forbidden origin.', 403);
  }

  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) {
    return jsonError('Expected application/json request body.', 415);
  }

  const contentLength = request.headers.get('content-length');
  const parsedContentLength = contentLength ? Number.parseInt(contentLength, 10) : Number.NaN;
  if (Number.isFinite(parsedContentLength) && parsedContentLength > MAX_REQUEST_BYTES) {
    return jsonError('Request body too large.', 413);
  }

  const burst = await consumeBurstRequest(request);
  if (!burst.allowed) {
    return jsonError(
      `Too many requests. Try again in ${burst.retryAfterSeconds} seconds.`,
      429,
      undefined,
      burst.retryAfterSeconds
    );
  }

  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_REQUEST_BYTES) {
      return jsonError('Request body too large.', 413);
    }

    payload = JSON.parse(rawBody) as Partial<AnalyzeRequest>;
  } catch {
    return jsonError('Invalid JSON request body.');
  }

  if (!payload || typeof payload !== 'object') {
    return jsonError('Invalid request payload.');
  }

  const resolvedKey = resolveApiKey(payload);
  if (resolvedKey.invalidApiKey) {
    return jsonError('Invalid Gemini API key format.');
  }

  if (!resolvedKey.apiKey) {
    return jsonError(
      'Gemini API key not configured. Set GEMINI_API_KEY (preferred) or NEXT_PUBLIC_GEMINI_API_KEY.',
      500
    );
  }

  if (resolvedKey.usingOwnApiKey) {
    const summary = await getUsageSummary(request);
    usage = {
      ...summary,
      usingOwnApiKey: true,
    };
  } else {
    const quota = await consumeMonthlyAction(request);
    usage = quota.usage;
    if (!quota.allowed) {
      return jsonError(
        `You have reached the free monthly limit (${quota.usage.limit} actions). Add your own Gemini API key or use the GitHub setup guide.`,
        429,
        quota.usage
      );
    }
  }

  try {
    let descriptors: VisualDescriptors;

    if (payload.type === 'text') {
      const description = typeof payload.description === 'string' ? payload.description.trim() : '';
      if (description.length < 3 || description.length > 1000) {
        return jsonError('description must be 3–1000 characters');
      }
      descriptors = await analyzeText(description, { apiKey: resolvedKey.apiKey });
    } else if (payload.type === 'image') {
      if (!payload.image || typeof payload.image !== 'string') {
        return jsonError('base64 image is required');
      }
      const mimeType = typeof payload.mimeType === 'string' ? payload.mimeType : '';
      if (payload.image.length > MAX_IMAGE_BASE64_LENGTH) {
        return jsonError('Image payload exceeds 10 MB limit');
      }
      if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
        return jsonError('Unsupported image type');
      }
      descriptors = await analyzeImage(payload.image, mimeType, { apiKey: resolvedKey.apiKey });
    } else {
      return jsonError('Unsupported analyze payload type');
    }

    if (!isVisualDescriptors(descriptors)) {
      return jsonError('Incomplete descriptor structure returned by model', 500, usage);
    }

    return NextResponse.json({ descriptors, usage });
  } catch (error) {
    console.error('[api/analyze] request failed:', error);
    return jsonError(parseErrorMessage(error), 500, usage);
  }
}
