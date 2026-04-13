import { NextRequest, NextResponse } from 'next/server';

const UNSPLASH_API_HOST = 'api.unsplash.com';

export async function POST(request: NextRequest) {
  try {
    const { downloadLocation } = await request.json();

    if (!downloadLocation || typeof downloadLocation !== 'string') {
      return NextResponse.json({ error: 'downloadLocation is required' }, { status: 400 });
    }

    // Validate it's an Unsplash API URL to prevent SSRF
    let parsed: URL;
    try {
      parsed = new URL(downloadLocation);
    } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
    }

    if (parsed.hostname !== UNSPLASH_API_HOST) {
      return NextResponse.json({ error: 'Invalid download location host' }, { status: 400 });
    }

    const res = await fetch(downloadLocation, {
      headers: {
        Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}`,
        'Accept-Version': 'v1',
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      console.warn(`[/api/download] trigger returned ${res.status}`);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[/api/download]', err);
    // Non-critical — don't surface errors to the client
    return NextResponse.json({ ok: false });
  }
}
