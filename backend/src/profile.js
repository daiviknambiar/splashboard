import {
  deleteProfileCache,
  getProfile,
  getProfilePhotos,
  insertProfilePhotos,
  saveProfileClusters,
  setPhotoTopics,
  updateProfileProgress,
  upsertProfile,
} from './db.js';
import { generateJson } from './llm.js';
import { getPhotoDetails, getUser, getUserPhotos, rateBudget, searchUsers, UnsplashError } from './unsplash.js';

const PER_PAGE = 30;
// An indexed portfolio is a cache of Unsplash metadata, not our data. After
// this long it is dropped and rebuilt from the API, so we never serve a
// stale mirror of a photographer's work (deleted photos, renamed captions).
export const PROFILE_CACHE_TTL_MS = Number.parseInt(
  process.env.PROFILE_CACHE_TTL_MS ?? '',
  10
) || 30 * 24 * 60 * 60 * 1000;
// Keep a reserve so profile scans never consume the entire hourly budget —
// regular searches must keep working while an index is in progress.
const RATE_RESERVE = 8;

const CLUSTER_SCHEMA = {
  type: 'object',
  properties: {
    clusters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          keywords: { type: 'array', items: { type: 'string' } },
        },
        required: ['label', 'keywords'],
      },
    },
  },
  required: ['clusters'],
};

const ASK_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    topic: { type: ['string', 'null'] },
    from: { type: ['string', 'null'] },
    to: { type: ['string', 'null'] },
    note: { type: 'string' },
  },
  required: ['text', 'note'],
};

export function parseProfileInput(input) {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/unsplash\.com\/(?:@|(?:[a-z]{2}\/)?@)([A-Za-z0-9_]+)/i);
  if (urlMatch) return { kind: 'username', username: urlMatch[1] };
  if (/^@?[A-Za-z0-9_]+$/.test(trimmed) && !trimmed.includes(' ')) {
    return { kind: 'username', username: trimmed.replace(/^@/, '') };
  }
  return { kind: 'query', query: trimmed };
}

export async function resolveProfile(input) {
  const parsed = parseProfileInput(input);
  if (parsed.kind === 'username') {
    try {
      const user = await getUser(parsed.username);
      return { user, candidates: [] };
    } catch (error) {
      if (error instanceof UnsplashError && error.status === 404) {
        const candidates = await searchUsers(parsed.username);
        return { user: null, candidates };
      }
      throw error;
    }
  }
  const candidates = await searchUsers(parsed.query);
  return { user: null, candidates };
}

function budgetAllows(requests) {
  const { remaining, updatedAt } = rateBudget();
  if (remaining === null) return true; // unknown until first request of the hour
  // Stale reading: the hourly window has likely reset since the last request.
  if (Date.now() - updatedAt > 10 * 60 * 1000) return true;
  return remaining - requests >= RATE_RESERVE;
}

/**
 * Advance a profile index by up to `maxRequests` Unsplash page fetches.
 * Called repeatedly by the frontend (poll loop) so a 1K-photo profile
 * indexes incrementally without blowing the hourly rate budget.
 */
export async function advanceProfileIndex(username, { maxRequests = 8 } = {}) {
  let profile = getProfile(username);

  // Expired index: drop it and rebuild from page 1 rather than serving
  // month-old metadata.
  if (profile && profile.indexedAt && Date.now() - profile.indexedAt > PROFILE_CACHE_TTL_MS) {
    deleteProfileCache(username);
    profile = null;
  }

  if (!profile) {
    const user = await getUser(username);
    upsertProfile(username, user, user.total_photos ?? 0);
    profile = getProfile(username);
  }

  let { nextPage, indexedCount } = profile;
  const totalPhotos = profile.totalPhotos;
  let requestsUsed = 0;

  while (!profile.indexComplete && requestsUsed < maxRequests && budgetAllows(1)) {
    const photos = await getUserPhotos(username, { page: nextPage, perPage: PER_PAGE });
    requestsUsed += 1;

    if (photos.length > 0) {
      insertProfilePhotos(username, photos);
      indexedCount += photos.length;
    }

    const complete = photos.length < PER_PAGE || indexedCount >= totalPhotos;
    nextPage += 1;
    updateProfileProgress(username, { indexedCount, nextPage, indexComplete: complete });
    if (complete) break;
  }

  profile = getProfile(username);

  if (profile.indexComplete && !profile.clusters) {
    await buildClusters(username);
    profile = getProfile(username);
  }

  return profileStatus(profile);
}

function profileStatus(profile) {
  return {
    user: profile.user,
    totalPhotos: profile.totalPhotos,
    indexedCount: Math.min(profile.indexedCount, profile.totalPhotos),
    indexComplete: profile.indexComplete,
    clustersReady: Boolean(profile.clusters),
    clusters: profile.clusters ?? [],
    rate: rateBudget(),
  };
}

export function getProfileStatus(username) {
  const profile = getProfile(username);
  return profile ? profileStatus(profile) : null;
}

async function buildClusters(username) {
  const rows = getProfilePhotos(username);
  const entries = rows
    .map((row) => row.description)
    .filter(Boolean);
  if (entries.length === 0) {
    saveProfileClusters(username, []);
    return;
  }

  // Sample capped so a 1K-profile prompt stays small; keywords generalize.
  const sample = entries.length > 500 ? entries.filter((_, i) => i % Math.ceil(entries.length / 500) === 0) : entries;

  const { data } = await generateJson({
    tier: 'fast',
    schema: CLUSTER_SCHEMA,
    prompt: [
      'You are organizing a photographer\'s Unsplash portfolio into browsable topic clusters.',
      'Given these photo descriptions, return 5-12 topic clusters.',
      'Each cluster needs a short human label (2-3 words) and 4-12 lowercase keywords that appear in matching descriptions.',
      'Keywords must be literal words/phrases from the descriptions, not abstractions.',
      'Return only the JSON object.',
      '',
      'Descriptions:',
      sample.map((entry) => `- ${entry.slice(0, 140)}`).join('\n'),
    ].join('\n'),
  });

  const clusters = (data.clusters ?? [])
    .filter((c) => typeof c?.label === 'string' && Array.isArray(c?.keywords))
    .map((c) => ({
      label: c.label,
      keywords: c.keywords.filter((k) => typeof k === 'string').map((k) => k.toLowerCase()),
    }));

  // Assign topics locally by keyword match — deterministic and free.
  for (const row of rows) {
    if (!row.description) continue;
    const topics = clusters
      .filter((cluster) => cluster.keywords.some((keyword) => row.description.includes(keyword)))
      .map((cluster) => cluster.label);
    if (topics.length > 0) setPhotoTopics(row.id, topics);
  }

  const withCounts = clusters.map((cluster) => ({
    ...cluster,
    count: rows.filter((row) => row.description && cluster.keywords.some((k) => row.description.includes(k))).length,
  }));
  saveProfileClusters(username, withCounts.filter((c) => c.count > 0));
}

function rowToPhoto(row) {
  const photo = JSON.parse(row.json);
  if (row.detail_json) {
    const detail = JSON.parse(row.detail_json);
    photo.exif = detail.exif ?? photo.exif;
    photo.location = detail.location ?? null;
  }
  photo.topics = row.topics_json ? JSON.parse(row.topics_json) : [];
  photo.locationName = row.location_name ?? null;
  return photo;
}

export function queryProfilePhotos(username, filters = {}) {
  const { text = '', topic = null, from = null, to = null, location = null, orderBy = 'latest', page = 1, perPage = 30 } = filters;
  const rows = getProfilePhotos(username);

  const textNeedles = text
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean);

  let filtered = rows.filter((row) => {
    if (from && (!row.created_at || row.created_at.slice(0, 10) < from)) return false;
    if (to && (!row.created_at || row.created_at.slice(0, 10) > to)) return false;
    if (topic) {
      const topics = row.topics_json ? JSON.parse(row.topics_json) : [];
      if (!topics.includes(topic)) return false;
    }
    if (location) {
      if (!row.location_name || !row.location_name.toLowerCase().includes(location.toLowerCase())) return false;
    }
    if (textNeedles.length > 0) {
      const haystack = `${row.description ?? ''} ${row.location_name ?? ''}`.toLowerCase();
      const matches = textNeedles.filter((needle) => haystack.includes(needle)).length;
      if (matches === 0) return false;
      row._textScore = matches;
    }
    return true;
  });

  if (orderBy === 'popular') {
    filtered.sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0));
  } else if (orderBy === 'oldest') {
    filtered.sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));
  } else if (textNeedles.length > 0) {
    filtered.sort((a, b) => (b._textScore ?? 0) - (a._textScore ?? 0) || (b.likes ?? 0) - (a.likes ?? 0));
  } else {
    filtered.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  }

  const start = (page - 1) * perPage;
  const photos = filtered.slice(start, start + perPage).map(rowToPhoto);

  return {
    photos,
    totalMatches: filtered.length,
    facets: buildFacets(rows),
    page,
    perPage,
  };
}

function buildFacets(rows) {
  const byMonth = new Map();
  const locations = new Map();
  let enriched = 0;

  for (const row of rows) {
    if (row.created_at) {
      const month = row.created_at.slice(0, 7);
      byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
    }
    if (row.detail_fetched_at) enriched += 1;
    if (row.location_name) {
      locations.set(row.location_name, (locations.get(row.location_name) ?? 0) + 1);
    }
  }

  return {
    dateHistogram: [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, count]) => ({ month, count })),
    topLocations: [...locations.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([name, count]) => ({ name, count })),
    enrichedCount: enriched,
    totalIndexed: rows.length,
  };
}

/**
 * Fetch full details (real location + EXIF) for specific photos, budget-aware.
 */
export async function enrichProfilePhotos(username, ids, { maxRequests = 10 } = {}) {
  const rows = getProfilePhotos(username);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const targets = ids.filter((id) => byId.has(id) && !byId.get(id).detail_fetched_at);

  let used = 0;
  let enriched = 0;
  for (const id of targets) {
    if (used >= maxRequests || !budgetAllows(1)) break;
    const { fromCache } = await getPhotoDetails(id);
    if (!fromCache) used += 1;
    enriched += 1;
  }

  return { enriched, remainingTargets: targets.length - enriched, rate: rateBudget() };
}

export async function smartAsk(username, question) {
  const profile = getProfile(username);
  if (!profile) throw new Error('Profile is not indexed yet.');

  const rows = getProfilePhotos(username);
  const months = rows.map((r) => r.created_at?.slice(0, 7)).filter(Boolean);
  const clusterLabels = (profile.clusters ?? []).map((c) => c.label);

  const { data, meta } = await generateJson({
    tier: 'fast',
    schema: ASK_SCHEMA,
    prompt: [
      `A user is searching within the Unsplash portfolio of ${profile.user?.name ?? username}.`,
      `The portfolio spans ${months[months.length - 1] ?? '?'} to ${months[0] ?? '?'} with ${rows.length} photos.`,
      clusterLabels.length > 0 ? `Available topic clusters: ${clusterLabels.join(', ')}.` : 'No topic clusters available.',
      '',
      `User question: "${question}"`,
      '',
      'Translate the question into search filters over photo descriptions:',
      '- text: 2-6 lowercase keywords likely to appear in matching photo descriptions (space separated).',
      '- topic: one of the available cluster labels if one clearly fits, else null.',
      '- from/to: ISO dates (YYYY-MM-DD) only if the question implies a time range, else null.',
      '- note: one short sentence explaining how you interpreted the question.',
      'Return only the JSON object.',
    ].join('\n'),
  });

  const filters = {
    text: typeof data.text === 'string' ? data.text : '',
    topic: clusterLabels.includes(data.topic) ? data.topic : null,
    from: typeof data.from === 'string' ? data.from : null,
    to: typeof data.to === 'string' ? data.to : null,
  };
  return { filters, note: typeof data.note === 'string' ? data.note : '', meta };
}
