'use client';

import { useCallback } from 'react';
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

export function PhotoCard({
  photo,
  showExif = false,
  index = 0,
  featured = false,
  variant = 'mood',
}: PhotoCardProps) {
  const handleClick = useCallback(async () => {
    // Trigger download endpoint per Unsplash guidelines — fire-and-forget
    fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ downloadLocation: photo.links.download_location }),
    }).catch(() => {});

    window.open(
      `${photo.links.html}?utm_source=splashboard&utm_medium=referral`,
      '_blank',
      'noopener,noreferrer'
    );
  }, [photo.links.download_location, photo.links.html]);

  const exif = photo.exif;
  const hasExif =
    showExif &&
    exif &&
    (exif.model || exif.focal_length || exif.aperture || exif.exposure_time || exif.iso);

  return (
    <div
      className={`photo-card photo-card--${variant} group relative cursor-pointer overflow-hidden bg-stone-100 ${
        featured ? 'photo-card--featured mb-0' : 'mb-3 rounded-xl'
      }`}
      style={{
        animationDelay: `${Math.min(index * 35, 600)}ms`,
        aspectRatio: `${photo.width} / ${photo.height}`,
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

      {variant === 'shot' && (
        <div className="photo-card__meta-panel" aria-label="Shot metadata">
          {hasExif ? (
            <>
              {exif?.model && <span className="photo-card__meta-chip">{exif.model}</span>}
              {exif?.focal_length && (
                <span className="photo-card__meta-chip">{formatFocalLength(exif.focal_length)}</span>
              )}
              {exif?.aperture && <span className="photo-card__meta-chip">f/{exif.aperture}</span>}
              {exif?.exposure_time && (
                <span className="photo-card__meta-chip">{exif.exposure_time}s</span>
              )}
              {exif?.iso && <span className="photo-card__meta-chip">ISO {exif.iso}</span>}
            </>
          ) : (
            <span className="photo-card__meta-chip photo-card__meta-chip--muted">Metadata unavailable</span>
          )}
        </div>
      )}

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

        {hasExif && (
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
            {exif?.model && (
              <span className="text-white/50 text-[10px] font-mono">{exif.model}</span>
            )}
            {exif?.focal_length && (
              <span className="text-white/50 text-[10px] font-mono">{formatFocalLength(exif.focal_length)}</span>
            )}
            {exif?.aperture && (
              <span className="text-white/50 text-[10px] font-mono">f/{exif.aperture}</span>
            )}
            {exif?.exposure_time && (
              <span className="text-white/50 text-[10px] font-mono">{exif.exposure_time}s</span>
            )}
            {exif?.iso && (
              <span className="text-white/50 text-[10px] font-mono">ISO {exif.iso}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
