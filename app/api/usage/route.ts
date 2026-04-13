import { NextRequest, NextResponse } from 'next/server';
import { getUsageSummary } from '@/lib/usage';

export async function GET(request: NextRequest) {
  try {
    const usage = await getUsageSummary(request);
    return NextResponse.json({ usage });
  } catch (err) {
    console.error('[/api/usage]', err);
    return NextResponse.json({ error: 'Failed to load usage' }, { status: 500 });
  }
}
