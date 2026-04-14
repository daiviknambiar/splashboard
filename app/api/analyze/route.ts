import { NextResponse } from 'next/server';
import { analyzeImage, analyzeText } from '@/lib/gemini';
import type { VisualDescriptors } from '@/types';

type AnalyzeRequest =
  | { type: 'text'; description: string; apiKey?: string }
  | { type: 'image'; image: string; mimeType: string; apiKey?: string };

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function readServerGeminiApiKey(): string | null {
  const preferred = process.env.GEMINI_API_KEY?.trim();
  if (preferred) return preferred;

  const fallback = process.env.NEXT_PUBLIC_GEMINI_API_KEY?.trim();
  return fallback && fallback.length > 0 ? fallback : null;
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function resolveApiKey(payload: AnalyzeRequest): string | null {
  const provided = typeof payload.apiKey === 'string' ? payload.apiKey.trim() : '';
  if (provided.length > 0) {
    return provided;
  }
  return readServerGeminiApiKey();
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

export async function POST(request: Request) {
  let payload: AnalyzeRequest;

  try {
    payload = (await request.json()) as AnalyzeRequest;
  } catch {
    return jsonError('Invalid JSON request body.');
  }

  const apiKey = resolveApiKey(payload);
  if (!apiKey) {
    return jsonError(
      'Gemini API key not configured. Set GEMINI_API_KEY (preferred) or NEXT_PUBLIC_GEMINI_API_KEY.',
      500
    );
  }

  try {
    let descriptors: VisualDescriptors;

    if (payload.type === 'text') {
      const description = typeof payload.description === 'string' ? payload.description.trim() : '';
      if (description.length < 3 || description.length > 1000) {
        return jsonError('description must be 3–1000 characters');
      }
      descriptors = await analyzeText(description, { apiKey });
    } else if (payload.type === 'image') {
      if (!payload.image || typeof payload.image !== 'string') {
        return jsonError('base64 image is required');
      }
      if (!ALLOWED_IMAGE_TYPES.has(payload.mimeType)) {
        return jsonError('Unsupported image type');
      }
      descriptors = await analyzeImage(payload.image, payload.mimeType, { apiKey });
    } else {
      return jsonError('Unsupported analyze payload type');
    }

    if (!isVisualDescriptors(descriptors)) {
      return jsonError('Incomplete descriptor structure returned by model', 500);
    }

    return NextResponse.json({ descriptors });
  } catch (error) {
    console.error('[api/analyze] request failed:', error);
    return jsonError(parseErrorMessage(error), 500);
  }
}
