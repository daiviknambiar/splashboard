import { UnsplashPhoto } from '@/types';

const UNSPLASH_BASE = 'https://api.unsplash.com';

function resolveAccessKey(): string {
  const key =
    process.env.NEXT_PUBLIC_UNSPLASH_ACCESS_KEY?.trim() ||
    process.env.UNSPLASH_ACCESS_KEY?.trim();
  if (!key) {
    throw new Error(
      'Unsplash access key is not configured. Set NEXT_PUBLIC_UNSPLASH_ACCESS_KEY for static deployments.'
    );
  }
  return key;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Client-ID ${resolveAccessKey()}`,
    'Accept-Version': 'v1',
  };
}

export async function searchPhotos(
  query: string,
  perPage = 10
): Promise<UnsplashPhoto[]> {
  const params = new URLSearchParams({
    query,
    per_page: String(perPage),
    order_by: 'relevant',
    content_filter: 'high',
  });

  const res = await fetch(`${UNSPLASH_BASE}/search/photos?${params}`, {
    headers: headers(),
    // No caching — respect Unsplash rate limits and always fresh results
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Unsplash search failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return (data.results ?? []) as UnsplashPhoto[];
}

export async function getPhotoDetails(photoId: string): Promise<UnsplashPhoto> {
  const res = await fetch(`${UNSPLASH_BASE}/photos/${photoId}`, {
    headers: headers(),
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Unsplash photo details failed (${res.status}): ${body}`);
  }

  return (await res.json()) as UnsplashPhoto;
}

export async function triggerDownload(downloadLocation: string): Promise<void> {
  const res = await fetch(downloadLocation, {
    headers: headers(),
    cache: 'no-store',
  });

  if (!res.ok) {
    console.warn(`Unsplash download trigger failed: ${res.status}`);
  }
}
