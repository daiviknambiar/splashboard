import { getCachedDetail, savePhotoDetail } from './db.js';

const UNSPLASH_BASE = 'https://api.unsplash.com';
export const DETAIL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Tracks the hourly budget from Unsplash's own response headers so we can
// refuse expensive work (profile scans) before hitting a hard 403.
const rateState = {
  limit: null,
  remaining: null,
  updatedAt: 0,
};

export class UnsplashError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'UnsplashError';
    this.status = status;
  }
}

function accessKey() {
  const key =
    process.env.UNSPLASH_ACCESS_KEY?.trim() || process.env.NEXT_PUBLIC_UNSPLASH_ACCESS_KEY?.trim();
  if (!key) {
    throw new UnsplashError('Unsplash access key is not configured on the backend.', 500);
  }
  return key;
}

function noteRateHeaders(response) {
  const limit = Number.parseInt(response.headers.get('x-ratelimit-limit') ?? '', 10);
  const remaining = Number.parseInt(response.headers.get('x-ratelimit-remaining') ?? '', 10);
  if (Number.isFinite(limit)) rateState.limit = limit;
  if (Number.isFinite(remaining)) rateState.remaining = remaining;
  rateState.updatedAt = Date.now();
}

export function rateBudget() {
  return { ...rateState };
}

async function unsplashFetch(pathname, params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const qs = search.toString();
  const response = await fetch(`${UNSPLASH_BASE}${pathname}${qs ? `?${qs}` : ''}`, {
    headers: {
      Authorization: `Client-ID ${accessKey()}`,
      'Accept-Version': 'v1',
    },
  });
  noteRateHeaders(response);

  if (response.status === 403 && rateState.remaining === 0) {
    throw new UnsplashError(
      'Unsplash hourly rate limit exhausted. It resets on the hour.',
      429
    );
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new UnsplashError(`Unsplash request failed (${response.status}): ${body.slice(0, 300)}`, response.status);
  }
  return response.json();
}

export async function searchPhotos({ query, perPage = 10, page = 1, color, orientation, contentFilter }) {
  const data = await unsplashFetch('/search/photos', {
    query,
    per_page: perPage,
    page,
    order_by: 'relevant',
    color,
    orientation,
    content_filter: contentFilter,
  });
  return data.results ?? [];
}

export async function searchUsers(query, perPage = 5) {
  const data = await unsplashFetch('/search/users', { query, per_page: perPage });
  return data.results ?? [];
}

export async function getUser(username) {
  return unsplashFetch(`/users/${encodeURIComponent(username)}`);
}

export async function getUserPhotos(username, { page = 1, perPage = 30, orderBy = 'latest' } = {}) {
  return unsplashFetch(`/users/${encodeURIComponent(username)}/photos`, {
    page,
    per_page: perPage,
    order_by: orderBy,
  });
}

export async function getPhotoDetails(photoId, { allowCache = true } = {}) {
  if (allowCache) {
    const cached = getCachedDetail(photoId, DETAIL_CACHE_TTL_MS);
    if (cached) return { detail: cached, fromCache: true };
  }
  const detail = await unsplashFetch(`/photos/${encodeURIComponent(photoId)}`);
  savePhotoDetail(photoId, detail);
  return { detail, fromCache: false };
}

export async function triggerDownload(downloadLocation) {
  const url = new URL(downloadLocation);
  if (url.hostname !== 'api.unsplash.com') {
    throw new UnsplashError('Invalid download location.', 400);
  }
  const response = await fetch(url, {
    headers: { Authorization: `Client-ID ${accessKey()}`, 'Accept-Version': 'v1' },
  });
  noteRateHeaders(response);
  return response.ok;
}
