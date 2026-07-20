import type {
  ProfileFacets,
  ProfileStatus,
  ProfileUser,
  QueryPlanItem,
  RankedPhoto,
  UnsplashPhoto,
  UsageSummary,
  VisualDescriptors,
} from '@/types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ?? '';
const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

export class ApiError extends Error {
  status: number;
  usage?: UsageSummary;

  constructor(message: string, status: number, usage?: UsageSummary) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.usage = usage;
  }
}

// Kept as an alias — older components referenced this name.
export { ApiError as AnalyzeApiError };

function buildApiUrl(pathname: string): string {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const trimmedBase = API_BASE_URL.replace(/\/+$/, '');
  if (trimmedBase.length > 0) {
    return `${trimmedBase}${normalizedPath}`;
  }
  if (typeof window !== 'undefined' && LOCALHOST_HOSTNAMES.has(window.location.hostname)) {
    return normalizedPath;
  }
  throw new ApiError(
    'Missing NEXT_PUBLIC_API_BASE_URL. Set it to your backend origin for non-local deployments.',
    500
  );
}

function parseUsage(value: unknown): UsageSummary | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const maybe = value as Partial<UsageSummary>;
  if (typeof maybe.month !== 'string' || typeof maybe.used !== 'number') return undefined;
  return maybe as UsageSummary;
}

async function request<T>(
  pathname: string,
  init: RequestInit & { userApiKey?: string } = {}
): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.body) headers['Content-Type'] = 'application/json';
  const key = init.userApiKey?.trim();
  if (key) {
    // OpenAI keys start with sk-; anything else is treated as a Gemini key.
    headers[key.startsWith('sk-') ? 'x-openai-api-key' : 'x-gemini-api-key'] = key;
  }

  let response: Response;
  try {
    response = await fetch(buildApiUrl(pathname), { ...init, headers, cache: 'no-store' });
  } catch {
    throw new ApiError(
      'Could not reach the Splashboard backend. Is it running? (npm run backend:dev)',
      0
    );
  }

  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const usage = parseUsage(data?.usage);

  if (!response.ok || (data && typeof data.error === 'string' && data.error)) {
    const message =
      (data && typeof data.error === 'string' && data.error) ||
      `Request failed (${response.status}).`;
    throw new ApiError(message, response.status, usage);
  }
  if (!data) {
    throw new ApiError('Backend returned an empty response.', response.status, usage);
  }
  return data as T;
}

export interface SearchResult {
  photos: RankedPhoto[];
  descriptors: VisualDescriptors;
  queries: QueryPlanItem[];
  usage?: UsageSummary;
  reference?: UnsplashPhoto | null;
}

export function visualSearch(payload: {
  mode: 'moodboard' | 'stealthisshot';
  text?: string;
  image?: string;
  mimeType?: string;
  focus?: string;
  userApiKey?: string;
}): Promise<SearchResult> {
  const { userApiKey, ...body } = payload;
  return request<SearchResult>('/api/search', {
    method: 'POST',
    body: JSON.stringify(body),
    userApiKey,
  });
}

export function similarSearch(payload: {
  photoUrl?: string;
  image?: string;
  mimeType?: string;
  focus?: string;
  userApiKey?: string;
}): Promise<SearchResult> {
  const { userApiKey, ...body } = payload;
  return request<SearchResult>('/api/similar', {
    method: 'POST',
    body: JSON.stringify(body),
    userApiKey,
  });
}

export function resolveProfile(input: string): Promise<{
  user: ProfileUser | null;
  candidates: ProfileUser[];
}> {
  return request(`/api/profile/resolve?input=${encodeURIComponent(input)}`);
}

export function advanceProfileIndex(username: string): Promise<ProfileStatus> {
  return request(`/api/profile/${encodeURIComponent(username)}/index`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export interface ProfilePhotosResult {
  photos: RankedPhoto[];
  totalMatches: number;
  facets: ProfileFacets;
  page: number;
  perPage: number;
}

export interface ProfileFilters {
  text?: string;
  topic?: string | null;
  from?: string | null;
  to?: string | null;
  location?: string | null;
  orderBy?: string;
  page?: number;
}

export function getProfilePhotos(
  username: string,
  filters: ProfileFilters = {}
): Promise<ProfilePhotosResult> {
  const params = new URLSearchParams();
  if (filters.text) params.set('text', filters.text);
  if (filters.topic) params.set('topic', filters.topic);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.location) params.set('location', filters.location);
  if (filters.orderBy) params.set('order_by', filters.orderBy);
  if (filters.page) params.set('page', String(filters.page));
  const qs = params.toString();
  return request(`/api/profile/${encodeURIComponent(username)}/photos${qs ? `?${qs}` : ''}`);
}

export function enrichProfile(
  username: string,
  ids: string[]
): Promise<{ enriched: number; remainingTargets: number }> {
  return request(`/api/profile/${encodeURIComponent(username)}/enrich`, {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}

export interface AskResult extends ProfilePhotosResult {
  filters: { text: string; topic: string | null; from: string | null; to: string | null };
  note: string;
  usage?: UsageSummary;
}

export function askProfile(
  username: string,
  question: string,
  userApiKey?: string
): Promise<AskResult> {
  return request(`/api/profile/${encodeURIComponent(username)}/ask`, {
    method: 'POST',
    body: JSON.stringify({ question }),
    userApiKey,
  });
}

export async function fetchUsage(): Promise<UsageSummary | null> {
  try {
    const data = await request<{ usage: UsageSummary }>('/api/usage');
    return data.usage ?? null;
  } catch {
    return null;
  }
}

export function triggerDownload(downloadLocation: string): Promise<{ ok: boolean }> {
  return request('/api/unsplash/download', {
    method: 'POST',
    body: JSON.stringify({ downloadLocation }),
  });
}
