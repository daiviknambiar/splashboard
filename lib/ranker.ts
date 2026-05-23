import { UnsplashPhoto, RankedPhoto, VisualDescriptors } from '@/types';

function descriptorKeywords(d: VisualDescriptors): string[] {
  const fields = [
    d.locationType,
    d.lightingConditions,
    d.colorPalette,
    d.mood,
    d.framing,
    d.architectureStyle ?? '',
    ...d.searchTerms,
  ];
  const words = fields.flatMap((f) => f.toLowerCase().split(/[\s,]+/));
  return [...new Set(words.filter(Boolean))];
}

function scorePhoto(
  photo: UnsplashPhoto,
  keywords: string[],
  queryIndex: number
): number {
  let score = 0;

  // Higher-confidence queries rank earlier → more points
  score += (3 - queryIndex) * 10;

  // Tag overlap
  for (const tag of photo.tags ?? []) {
    const t = tag.title.toLowerCase();
    if (keywords.some((k) => t.includes(k) || k.includes(t))) score += 5;
  }

  // Alt description overlap
  const alt = (photo.alt_description ?? '').toLowerCase();
  for (const k of keywords) {
    if (alt.includes(k)) score += 2;
  }

  return score;
}

export function mergeAndRankResults(
  batches: Array<{ photos: UnsplashPhoto[]; queryIndex: number }>,
  descriptors: VisualDescriptors
): RankedPhoto[] {
  const keywords = descriptorKeywords(descriptors);
  const seen = new Set<string>();
  const ranked: RankedPhoto[] = [];

  for (const { photos, queryIndex } of batches) {
    for (const photo of photos) {
      if (seen.has(photo.id)) continue;
      seen.add(photo.id);
      ranked.push({ ...photo, score: scorePhoto(photo, keywords, queryIndex) });
    }
  }

  return ranked.sort((a, b) => b.score - a.score);
}
