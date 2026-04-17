'use client';

import { useCallback } from 'react';
import { triggerDownload } from '@/lib/unsplash';
import type { UnsplashPhoto } from '@/types';

interface PhotoCardProps {
  photo: UnsplashPhoto;
  showExif?: boolean;
  index?: number;
  featured?: boolean;
  variant?: 'mood' | 'shot';
}

function formatFocalLength(value: string) {
  const trimmed = value.trim();
  return trimmed.endsWith('mm') ? trimmed : `${trimmed}mm`;
}

function formatCameraName(make?: string | null, model?: string | null) {
  if (make && model && model.toLowerCase().startsWith(make.toLowerCase())) return model;
  if (make && model) return `${make} ${model}`;
  return model ?? make ?? null;
}

export function PhotoCard({
  photo,
  showExif = false,
  index = 0,
  featured = false,
  variant = 'mood',
}: PhotoCardProps) {
  const handleClick = useCallback(async () => {
    // Trigger Unsplash download endpoint per guidelines — fire-and-forget.
    triggerDownload(photo.links.download_location).catch(() => {});

    window.open(
      `${photo.links.html}?utm_source=splashboard&utm_medium=referral`,
      '_blank',
      'noopener,noreferrer'
    );
  }, [photo.links.download_location, photo.links.html]);

  const exif = photo.exif;
  const cameraName = formatCameraName(exif?.make, exif?.model);
  const shotLens = [
    exif?.focal_length ? formatFocalLength(exif.focal_length) : null,
    exif?.aperture ? `f/${exif.aperture}` : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' · ');
  const shotExposure = [
    exif?.exposure_time ? `${exif.exposure_time}s` : null,
    typeof exif?.iso === 'number' ? `ISO ${exif.iso}` : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' · ');
  const aspectRatio =
    variant === 'shot'
      ? featured
        ? '16 / 10'
        : '4 / 5'
      : `${photo.width} / ${photo.height}`;

  return (
    <div
      className={`photo-card photo-card--${variant} group relative cursor-pointer overflow-hidden bg-stone-100 ${
        featured ? 'photo-card--featured mb-0' : 'mb-3 rounded-xl'
      }`}
      style={{
        animationDelay: `${Math.min(index * 35, 600)}ms`,
        aspectRatio,
      }}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      aria-label={`View photo by ${photo.user.name} on Unsplash`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') handleClick();
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.urls.regular}
        alt={photo.alt_description ?? `Photo by ${photo.user.name} on Unsplash`}
        className={`w-full h-full object-cover ${featured ? 'photo-card__img--featured' : ''}`}
        loading="lazy"
        decoding="async"
      />

      {/* Hover overlay */}
      <div className="photo-card__overlay" aria-hidden="true">
        {photo.color && (
          <span
            className="photo-card__swatch"
            style={{ backgroundColor: photo.color }}
          />
        )}

        <p className="text-white/90 text-xs leading-relaxed">
          <a
            href={`${photo.user.links.html}?utm_source=splashboard&utm_medium=referral`}
            className="font-semibold hover:text-white transition-colors"
            onClick={(e) => e.stopPropagation()}
            target="_blank"
            rel="noopener noreferrer"
          >
            {photo.user.name}
          </a>
          <span className="text-white/55"> on </span>
          <a
            href="https://unsplash.com?utm_source=splashboard&utm_medium=referral"
            className="text-white/55 hover:text-white/80 transition-colors"
            onClick={(e) => e.stopPropagation()}
            target="_blank"
            rel="noopener noreferrer"
          >
            Unsplash
          </a>
        </p>
      </div>

      {variant === 'shot' && showExif && featured && (
        <dl className="photo-card__meta-readout" aria-label="Shot settings details">
          <div className="photo-card__meta-readout-row">
            <dt>Camera</dt>
            <dd>{cameraName ?? 'Not published'}</dd>
          </div>
          <div className="photo-card__meta-readout-row">
            <dt>Lens</dt>
            <dd>{exif?.focal_length ? formatFocalLength(exif.focal_length) : 'Not published'}</dd>
          </div>
          <div className="photo-card__meta-readout-row">
            <dt>Aperture</dt>
            <dd>{exif?.aperture ? `f/${exif.aperture}` : 'Not published'}</dd>
          </div>
          <div className="photo-card__meta-readout-row">
            <dt>Shutter</dt>
            <dd>{exif?.exposure_time ? `${exif.exposure_time}s` : 'Not published'}</dd>
          </div>
          <div className="photo-card__meta-readout-row">
            <dt>ISO</dt>
            <dd>{typeof exif?.iso === 'number' ? `ISO ${exif.iso}` : 'Not published'}</dd>
          </div>
        </dl>
      )}

      {variant === 'shot' && showExif && !featured && (
        <dl className="photo-card__meta-readout" aria-label="Shot settings details">
          <div className="photo-card__meta-readout-row">
            <dt>Camera</dt>
            <dd>{cameraName ?? 'Not published'}</dd>
          </div>
          <div className="photo-card__meta-readout-row">
            <dt>Lens</dt>
            <dd>{shotLens || 'Not published'}</dd>
          </div>
          <div className="photo-card__meta-readout-row">
            <dt>Exposure</dt>
            <dd>{shotExposure || 'Not published'}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}
