import { NextRequest, NextResponse } from 'next/server';
import { getPhotoDetails, searchPhotos } from '@/lib/unsplash';
import { mergeAndRankResults } from '@/lib/ranker';
import { VisualDescriptors } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const descriptors = body as VisualDescriptors;
    const lens = body?.lens === 'stealthisshot' ? 'stealthisshot' : 'moodboard';

    if (!descriptors.searchTerms || !Array.isArray(descriptors.searchTerms)) {
      return NextResponse.json({ error: 'searchTerms array is required' }, { status: 400 });
    }

    // Build 3 targeted queries — each targets a different attribute combination.
    // Max 3 to stay comfortably within the 50 req/hour demo limit.
    const queries = [
      `${descriptors.locationType} ${descriptors.lightingConditions}`.trim(),
      descriptors.searchTerms[0] ?? `${descriptors.mood} ${descriptors.colorPalette}`.trim(),
      descriptors.searchTerms[1] ?? `${descriptors.framing} ${descriptors.locationType}`.trim(),
    ]
      .filter(Boolean)
      .slice(0, 3);

    // Fire all queries in parallel — fail-soft per query
    const batches = await Promise.all(
      queries.map(async (query, index) => {
        try {
          const photos = await searchPhotos(query, 10);
          return { photos, queryIndex: index };
        } catch (err) {
          console.warn(`[/api/search] query ${index} failed:`, err);
          return { photos: [], queryIndex: index };
        }
      })
    );

    const ranked = mergeAndRankResults(batches, descriptors);
    const topResults = ranked.slice(0, 24);

    // Unsplash search responses often have partial EXIF; hydrate full photo payload for shot mode.
    const enrichedResults =
      lens === 'stealthisshot'
        ? await Promise.all(
            topResults.map(async (photo) => {
              const hasExif =
                photo.exif &&
                (photo.exif.make ||
                  photo.exif.model ||
                  photo.exif.focal_length ||
                  photo.exif.aperture ||
                  photo.exif.exposure_time ||
                  photo.exif.iso);
              if (hasExif) return photo;

              try {
                const details = await getPhotoDetails(photo.id);
                return {
                  ...photo,
                  ...details,
                  score: photo.score,
                };
              } catch (err) {
                console.warn(`[/api/search] details fetch failed for ${photo.id}:`, err);
                return photo;
              }
            })
          )
        : topResults;

    return NextResponse.json({ photos: enrichedResults, descriptors });
  } catch (err) {
    console.error('[/api/search]', err);
    return NextResponse.json(
      { error: 'Search failed', detail: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
