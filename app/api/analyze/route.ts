import { NextRequest, NextResponse } from 'next/server';
import { analyzeText, analyzeImage } from '@/lib/gemini';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (body.type === 'text') {
      if (!body.description || typeof body.description !== 'string') {
        return NextResponse.json({ error: 'description is required' }, { status: 400 });
      }
      const trimmed = body.description.trim();
      if (trimmed.length < 3 || trimmed.length > 1000) {
        return NextResponse.json({ error: 'description must be 3–1000 characters' }, { status: 400 });
      }
      const descriptors = await analyzeText(trimmed);
      return NextResponse.json(descriptors);
    }

    if (body.type === 'image') {
      if (!body.image || typeof body.image !== 'string') {
        return NextResponse.json({ error: 'base64 image is required' }, { status: 400 });
      }
      const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      if (!allowed.includes(body.mimeType)) {
        return NextResponse.json({ error: 'Unsupported image type' }, { status: 400 });
      }
      const descriptors = await analyzeImage(body.image, body.mimeType);
      return NextResponse.json(descriptors);
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
