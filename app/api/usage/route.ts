import { NextResponse, type NextRequest } from 'next/server';
import { isTrustedBrowserRequest } from '@/lib/api-security';
import { getUsageSummary } from '@/lib/usage';

export async function POST(request: NextRequest) {
  if (!isTrustedBrowserRequest(request)) {
    return NextResponse.json({ error: 'Forbidden origin.' }, { status: 403 });
  }

  const usage = await getUsageSummary(request);
  return NextResponse.json({ usage });
}
