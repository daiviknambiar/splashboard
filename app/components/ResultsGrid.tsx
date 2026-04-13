'use client';

import { PhotoCard } from './PhotoCard';
import type { RankedPhoto, Mode, VisualDescriptors } from '@/types';

interface ResultsGridProps {
  photos: RankedPhoto[];
  mode: Mode;
  descriptors?: VisualDescriptors | null;
  modeLabel?: string;
  onExportMoodBoard?: () => void;
  exportDisabled?: boolean;
  exportLabel?: string;
}

function parseNumericValue(value: string | null | undefined): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[^\d.]/g, '');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function prettyNumber(value: number) {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1).replace(/\.0$/, '');
}

function formatRange(prefix: string, min: number | null, max: number | null, suffix = '') {
  if (min === null && max === null) return 'Not enough data yet';
  if (min !== null && max !== null && min !== max) {
    return `${prefix}${prettyNumber(min)}${suffix} to ${prefix}${prettyNumber(max)}${suffix}`;
  }
  const value = min ?? max;
  return value === null ? 'Not enough data yet' : `${prefix}${prettyNumber(value)}${suffix}`;
}

function summarizeShotMetadata(photos: RankedPhoto[]) {
  const cameraCounts = new Map<string, number>();
  const focalLengthCounts = new Map<string, number>();
  const shutterCounts = new Map<string, number>();
  const apertures: number[] = [];
  const isos: number[] = [];
  let withExifCount = 0;

  photos.forEach((photo) => {
    const exif = photo.exif;
    if (!exif) return;

    const hasAnyExif =
      exif.make || exif.model || exif.focal_length || exif.aperture || exif.exposure_time || exif.iso;
    if (!hasAnyExif) return;
    withExifCount += 1;

    const cameraName = exif.model ?? exif.make;
    if (cameraName) {
      cameraCounts.set(cameraName, (cameraCounts.get(cameraName) ?? 0) + 1);
    }

    if (exif.focal_length) {
      const focal = Math.round(parseNumericValue(exif.focal_length) ?? 0);
      if (focal > 0) {
        const key = `${focal}mm`;
        focalLengthCounts.set(key, (focalLengthCounts.get(key) ?? 0) + 1);
      }
    }

    if (exif.aperture) {
      const aperture = parseNumericValue(exif.aperture);
      if (aperture !== null) apertures.push(aperture);
    }

    if (typeof exif.iso === 'number' && Number.isFinite(exif.iso)) {
      isos.push(exif.iso);
    }

    if (exif.exposure_time) {
      const shutter = `${exif.exposure_time}s`;
      shutterCounts.set(shutter, (shutterCounts.get(shutter) ?? 0) + 1);
    }
  });

  const sortCounts = (counts: Map<string, number>) =>
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([value, count]) => ({ value, count }));

  const apertureMin = apertures.length > 0 ? Math.min(...apertures) : null;
  const apertureMax = apertures.length > 0 ? Math.max(...apertures) : null;
  const isoMin = isos.length > 0 ? Math.min(...isos) : null;
  const isoMax = isos.length > 0 ? Math.max(...isos) : null;

  return {
    withExifCount,
    total: photos.length,
    topCameras: sortCounts(cameraCounts),
    topFocalLengths: sortCounts(focalLengthCounts),
    topShutterSpeeds: sortCounts(shutterCounts),
    apertureRange: formatRange('f/', apertureMin, apertureMax),
    isoRange: formatRange('', isoMin, isoMax),
  };
}

export function ResultsGrid({
  photos,
  mode,
  descriptors,
  modeLabel,
  onExportMoodBoard,
  exportDisabled = false,
  exportLabel = 'Download board',
}: ResultsGridProps) {
  if (photos.length === 0) return null;
  const [heroPhoto, ...masonryPhotos] = photos;
  const isMoodBoard = mode === 'moodboard';
  const title = isMoodBoard ? 'Fresh mood pulls' : 'Shot-matched lookalikes';
  const topMatchTitle = 'Closest style hit';
  const topMatchCopy = 'Use the EXIF hints to reverse-engineer focal length, body choice, and exposure.';
  const descriptorTags = descriptors
    ? [
        descriptors.locationType,
        descriptors.lightingConditions,
        descriptors.colorPalette,
        descriptors.mood,
        descriptors.framing,
      ].filter((tag): tag is string => Boolean(tag))
    : [];
  const shotSummary = isMoodBoard ? null : summarizeShotMetadata(photos);

  return (
    <section
      className={`results-section ${
        isMoodBoard ? 'results-section--mood' : 'results-section--shot'
      } w-full max-w-7xl mx-auto px-4 pb-16`}
    >
      <div className="results-header">
        <div>
          <p className="results-header__eyebrow">{modeLabel ?? 'Curated Lens'}</p>
          <h2 className="results-header__title">{title}</h2>
        </div>
        <div className="results-header__actions">
          <p className="results-header__count">
            {photos.length} image{photos.length !== 1 ? 's' : ''}
          </p>
          {isMoodBoard && onExportMoodBoard && (
            <button
              type="button"
              className="export-btn"
              onClick={onExportMoodBoard}
              disabled={exportDisabled}
            >
              {exportLabel}
            </button>
          )}
        </div>
      </div>

      {descriptorTags.length > 0 && (
        <div className="descriptor-strip mb-6" aria-label="Extracted descriptors">
          {descriptorTags.map((tag) => (
            <span key={tag} className="descriptor-chip">
              {tag}
            </span>
          ))}
        </div>
      )}

      {isMoodBoard ? (
        <div className="moodboard-canvas">
          {photos.map((photo, i) => (
            <PhotoCard
              key={photo.id}
              photo={photo}
              showExif={false}
              index={i}
              variant="mood"
            />
          ))}
        </div>
      ) : (
        <>
          {shotSummary && (
            <div className="shot-insight-grid mb-5" aria-label="Photography metadata analysis">
              <article className="shot-insight-card">
                <p className="shot-insight-card__kicker">Coverage</p>
                <p className="shot-insight-card__value">
                  {shotSummary.withExifCount}/{shotSummary.total}
                </p>
                <p className="shot-insight-card__copy">images include useful camera metadata</p>
              </article>

              <article className="shot-insight-card">
                <p className="shot-insight-card__kicker">Camera Bodies</p>
                <p className="shot-insight-card__value shot-insight-card__value--list">
                  {shotSummary.topCameras.length > 0
                    ? shotSummary.topCameras.map((camera) => camera.value).join(', ')
                    : 'No camera model data'}
                </p>
                <p className="shot-insight-card__copy">most common capture hardware in matches</p>
              </article>

              <article className="shot-insight-card">
                <p className="shot-insight-card__kicker">Lens + Exposure</p>
                <p className="shot-insight-card__value shot-insight-card__value--list">
                  {shotSummary.topFocalLengths.length > 0
                    ? shotSummary.topFocalLengths.map((focal) => focal.value).join(', ')
                    : 'No focal length data'}
                </p>
                <p className="shot-insight-card__copy">
                  Aperture {shotSummary.apertureRange} · ISO {shotSummary.isoRange}
                </p>
              </article>
            </div>
          )}

          {heroPhoto && (
            <div className="featured-row mb-4">
              <PhotoCard
                photo={heroPhoto}
                showExif
                index={0}
                featured
                variant="shot"
              />

              <aside className="featured-note">
                <p className="featured-note__kicker">Top Match</p>
                <p className="featured-note__title">{topMatchTitle}</p>
                <p className="featured-note__copy">{topMatchCopy}</p>
                {shotSummary && shotSummary.topShutterSpeeds.length > 0 && (
                  <p className="featured-note__copy featured-note__copy--tight">
                    Common shutter picks:{' '}
                    {shotSummary.topShutterSpeeds.map((speed) => speed.value).join(', ')}
                  </p>
                )}
              </aside>
            </div>
          )}

          <div className="shot-grid">
            {masonryPhotos.map((photo, i) => (
              <PhotoCard
                key={photo.id}
                photo={photo}
                showExif
                index={i + 1}
                variant="shot"
              />
            ))}
          </div>
        </>
      )}

    </section>
  );
}
