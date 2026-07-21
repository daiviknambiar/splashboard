import { generateJson } from './llm.js';
import { getPhotoDetails, searchPhotos, triggerDownload } from './unsplash.js';

const UNSPLASH_COLORS = new Set([
  'black_and_white', 'black', 'white', 'yellow', 'orange', 'red', 'purple',
  'magenta', 'green', 'teal', 'blue',
]);
const ORIENTATIONS = new Set(['landscape', 'portrait', 'squarish']);

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    descriptors: {
      type: 'object',
      properties: {
        locationType: { type: 'string' },
        lightingConditions: { type: 'string' },
        colorPalette: { type: 'string' },
        mood: { type: 'string' },
        framing: { type: 'string' },
        architectureStyle: { type: ['string', 'null'] },
        searchTerms: { type: 'array', items: { type: 'string' } },
      },
      required: ['locationType', 'lightingConditions', 'colorPalette', 'mood', 'framing', 'searchTerms'],
    },
    queries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          color: { type: ['string', 'null'] },
          orientation: { type: ['string', 'null'] },
          weight: { type: 'number' },
        },
        required: ['query', 'weight'],
      },
    },
  },
  required: ['descriptors', 'queries'],
};

function planPrompt({ mode, focus, hints }) {
  return [
    'You are the query planner for a visual search engine backed by the Unsplash API.',
    'Unsplash search matches keywords against photo tags, titles, and descriptions — short concrete noun phrases work best; abstract adjectives alone work poorly.',
    `Requested mode: ${mode}.`,
    focus
      ? `The user wants the search to focus specifically on: "${focus}". Weight the plan heavily toward this and de-emphasize everything else.`
      : '',
    hints ? `Extra context about the reference photo: ${hints}` : '',
    '',
    'Return a JSON object with:',
    '- descriptors: { locationType, lightingConditions, colorPalette, mood, framing, architectureStyle (null if none), searchTerms (3-6 short phrases) }',
    '- queries: 3-5 Unsplash search queries, each { query (2-5 words, concrete), color (one of black_and_white|black|white|yellow|orange|red|purple|magenta|green|teal|blue, or null), orientation (landscape|portrait|squarish or null), weight (1-10, how strongly this query captures the intent) }',
    'Vary the queries: one literal, one about light/mood, one about setting/composition.',
    'Only set color when the palette is strongly dominated by that single color family.',
    'Return only the JSON object.',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function buildQueryPlan({ mode, text, image, focus, hints, headerKeys }) {
  const prompt = [
    planPrompt({ mode, focus, hints }),
    text ? `\nAnalyze this description:\n${text}` : '\nAnalyze the attached image.',
  ].join('\n');

  const { data, meta } = await generateJson({
    tier: image ? 'deep' : 'fast',
    prompt,
    image,
    schema: PLAN_SCHEMA,
    headerKeys,
  });

  const descriptors = data.descriptors ?? {};
  descriptors.architectureStyle =
    typeof descriptors.architectureStyle === 'string' ? descriptors.architectureStyle : null;
  descriptors.searchTerms = Array.isArray(descriptors.searchTerms)
    ? descriptors.searchTerms.filter((t) => typeof t === 'string')
    : [];

  const queries = (Array.isArray(data.queries) ? data.queries : [])
    .filter((q) => typeof q?.query === 'string' && q.query.trim().length > 0)
    .slice(0, 5)
    .map((q) => ({
      query: q.query.trim(),
      color: UNSPLASH_COLORS.has(q.color) ? q.color : undefined,
      orientation: ORIENTATIONS.has(q.orientation) ? q.orientation : undefined,
      weight: Math.min(10, Math.max(1, Number(q.weight) || 5)),
    }));

  if (queries.length === 0) {
    throw new Error('AI did not produce any usable search queries.');
  }
  return { descriptors, queries, meta };
}

function descriptorKeywords(descriptors, focus) {
  const fields = [
    descriptors.locationType,
    descriptors.lightingConditions,
    descriptors.colorPalette,
    descriptors.mood,
    descriptors.framing,
    descriptors.architectureStyle ?? '',
    ...(descriptors.searchTerms ?? []),
  ];
  const focusWords = (focus ?? '').toLowerCase().split(/[\s,]+/).filter(Boolean);
  const words = fields.flatMap((f) => (f ?? '').toLowerCase().split(/[\s,]+/));
  return {
    keywords: [...new Set(words.filter(Boolean))],
    focusWords: [...new Set(focusWords)],
  };
}

function scorePhoto(photo, { keywords, focusWords }, queryWeight) {
  let score = queryWeight * 4;

  const tags = (photo.tags ?? []).map((tag) => tag.title?.toLowerCase() ?? '');
  const alt = `${photo.alt_description ?? ''} ${photo.description ?? ''}`.toLowerCase();

  for (const tag of tags) {
    if (keywords.some((k) => tag.includes(k) || k.includes(tag))) score += 5;
    // Focus terms count triple: the user explicitly asked for them.
    if (focusWords.some((k) => tag.includes(k) || k.includes(tag))) score += 15;
  }
  for (const k of keywords) {
    if (alt.includes(k)) score += 2;
  }
  for (const k of focusWords) {
    if (alt.includes(k)) score += 8;
  }
  return score;
}

export async function executeQueryPlan({ descriptors, queries, focus, perQuery = 10, limit = 24 }) {
  const failures = [];
  const batches = await Promise.all(
    queries.map(async (q) => {
      try {
        const photos = await searchPhotos({
          query: q.query,
          perPage: perQuery,
          color: q.color,
          orientation: q.orientation,
          contentFilter: 'high',
        });
        return { photos, weight: q.weight };
      } catch (error) {
        console.warn(`[search] query "${q.query}" failed:`, error.message);
        failures.push(error);
        return { photos: [], weight: q.weight };
      }
    })
  );

  // Partial failures degrade gracefully; total failure must be honest.
  if (failures.length === queries.length && failures.length > 0) {
    throw failures[0];
  }

  const scoring = descriptorKeywords(descriptors, focus);
  const seen = new Set();
  const ranked = [];
  for (const { photos, weight } of batches) {
    for (const photo of photos) {
      if (seen.has(photo.id)) continue;
      seen.add(photo.id);
      ranked.push({ ...photo, score: scorePhoto(photo, scoring, weight) });
    }
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, limit);
}

/** Fill EXIF details for top results (Steal This Shot needs camera data). */
export async function enrichWithExif(photos, { maxRequests = 12 } = {}) {
  let used = 0;
  return Promise.all(
    photos.map(async (photo) => {
      const hasExif = photo.exif && (photo.exif.make || photo.exif.model || photo.exif.focal_length);
      if (hasExif) return photo;
      try {
        const { detail, fromCache } = await getPhotoDetails(photo.id);
        if (!fromCache) {
          used += 1;
          if (used > maxRequests) return photo;
        }
        return { ...photo, ...detail, score: photo.score };
      } catch {
        return photo;
      }
    })
  );
}

const PHOTO_URL_RE = /unsplash\.com\/(?:[a-z]{2}\/)?photos\/(?:[^/?#]*-)?([A-Za-z0-9_-]{8,})/i;

export function parsePhotoUrl(url) {
  const match = url.trim().match(PHOTO_URL_RE);
  if (!match) return null;
  // Modern slugs are "some-description-<id>"; the ID is the trailing token.
  const slug = match[1];
  const tail = slug.split('-').pop();
  return tail && tail.length >= 8 ? tail : slug;
}

export async function loadReferencePhoto(photoUrl) {
  const photoId = parsePhotoUrl(photoUrl);
  if (!photoId) {
    throw new Error('That does not look like an Unsplash photo URL. Expected unsplash.com/photos/...');
  }
  const { detail } = await getPhotoDetails(photoId);

  const imageUrl = detail?.urls?.small;
  if (!imageUrl) throw new Error('Could not load the reference photo from Unsplash.');

  // Pulling the image bytes to analyze them is a download-like use, so
  // Unsplash API guideline 2 requires hitting the download endpoint. Best
  // effort - a failed ping must not break the search.
  if (detail?.links?.download_location) {
    triggerDownload(detail.links.download_location).catch((error) => {
      console.warn('[unsplash] reference download trigger failed:', error.message);
    });
  }

  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error('Could not download the reference photo.');
  const mimeType = response.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
  const base64 = Buffer.from(await response.arrayBuffer()).toString('base64');

  const hints = [
    detail.description || detail.alt_description,
    detail.location?.name ? `Location: ${detail.location.name}` : null,
    detail.exif?.model ? `Camera: ${detail.exif.model}` : null,
  ]
    .filter(Boolean)
    .join('. ');

  return { image: { base64, mimeType }, hints, reference: detail };
}
