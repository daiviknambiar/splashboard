import { NextRequest, NextResponse } from 'next/server';
import { analyzeText, analyzeImage } from '@/lib/gemini';
import { consumeMonthlyAction, getUsageSummary } from '@/lib/usage';
import type { UsageSummary } from '@/types';

function extractApiKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function resolveUsage(
  request: NextRequest,
  customGeminiApiKey?: string
): Promise<{ allowed: boolean; usage: UsageSummary }> {
  if (customGeminiApiKey) {
    return {
      allowed: true,
      usage: {
        ...(await getUsageSummary(request)),
        usingOwnApiKey: true,
      },
    };
  }

  return consumeMonthlyAction(request);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const customGeminiApiKey = extractApiKey(body?.geminiApiKey);

    if (body.type === 'text') {
      if (!body.description || typeof body.description !== 'string') {
        return NextResponse.json({ error: 'description is required' }, { status: 400 });
      }
      const trimmed = body.description.trim();
      if (trimmed.length < 3 || trimmed.length > 1000) {
        return NextResponse.json({ error: 'description must be 3–1000 characters' }, { status: 400 });
      }

      const quota = await resolveUsage(request, customGeminiApiKey);
      if (!quota.allowed) {
        return NextResponse.json(
          {
            error:
              `You have reached the free monthly limit (${quota.usage.limit} actions). ` +
              'Add your own Gemini API key or contact us for self-hosting.',
            usage: quota.usage,
          },
          { status: 429 }
        );
      }

      try {
        const descriptors = await analyzeText(trimmed, { apiKey: customGeminiApiKey });
        return NextResponse.json({ descriptors, usage: quota.usage });
      } catch (err) {
        const message = err instanceof Error ? err.message.toLowerCase() : '';
        if (customGeminiApiKey && message.includes('api key')) {
          return NextResponse.json(
            { error: 'Your Gemini API key was rejected. Double-check it and try again.' },
            { status: 401 }
          );
        }
        throw err;
      }
    }

    if (body.type === 'image') {
      if (!body.image || typeof body.image !== 'string') {
        return NextResponse.json({ error: 'base64 image is required' }, { status: 400 });
      }
      const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      if (!allowed.includes(body.mimeType)) {
        return NextResponse.json({ error: 'Unsupported image type' }, { status: 400 });
      }

      const quota = await resolveUsage(request, customGeminiApiKey);
      if (!quota.allowed) {
        return NextResponse.json(
          {
            error:
              `You have reached the free monthly limit (${quota.usage.limit} actions). ` +
              'Add your own Gemini API key or contact us for self-hosting.',
            usage: quota.usage,
          },
          { status: 429 }
        );
      }

      try {
        const descriptors = await analyzeImage(body.image, body.mimeType, {
          apiKey: customGeminiApiKey,
        });
        return NextResponse.json({ descriptors, usage: quota.usage });
      } catch (err) {
        const message = err instanceof Error ? err.message.toLowerCase() : '';
        if (customGeminiApiKey && message.includes('api key')) {
          return NextResponse.json(
            { error: 'Your Gemini API key was rejected. Double-check it and try again.' },
            { status: 401 }
          );
        }
        throw err;
      }
    }

    return NextResponse.json({ error: 'type must be "text" or "image"' }, { status: 400 });
  } catch (err) {
    console.error('[/api/analyze]', err);
    return NextResponse.json(
      { error: 'Analysis failed', detail: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
