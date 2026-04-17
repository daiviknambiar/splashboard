import type { NextRequest } from 'next/server';

const ALLOWED_SEC_FETCH_SITE = new Set(['same-origin', 'same-site', 'none']);

export function isTrustedBrowserRequest(request: NextRequest): boolean {
  const secFetchSite = request.headers.get('sec-fetch-site');
  if (secFetchSite && !ALLOWED_SEC_FETCH_SITE.has(secFetchSite)) {
    return false;
  }

  const origin = request.headers.get('origin');
  if (!origin) {
    return true;
  }

  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!host) {
    return false;
  }

  try {
    const originHost = new URL(origin).host;
    return originHost === host;
  } catch {
    return false;
  }
}
