'use client';

import { useState, useCallback, useRef, useEffect, type DragEvent, type ChangeEvent, type FormEvent } from 'react';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const UNSPLASH_PHOTO_URL_RE = /unsplash\.com\/(?:[a-z]{2}\/)?photos\//i;

export interface ShotSearchPayload {
  image?: string;
  mimeType?: string;
  photoUrl?: string;
  focus?: string;
}

interface StealTheShotProps {
  onSearch: (payload: ShotSearchPayload) => void;
  disabled?: boolean;
  prefill?: { photoUrl?: string; focus?: string } | null;
}

export function StealTheShot({ onSearch, disabled, prefill }: StealTheShotProps) {
  const [dragActive, setDragActive] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [imageData, setImageData] = useState<{ base64: string; mimeType: string } | null>(null);
  const [photoUrl, setPhotoUrl] = useState('');
  const [focus, setFocus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!prefill) return;
    // Syncing an external prefill (e.g. "Try this reference") into the form.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (prefill.photoUrl !== undefined) {
      setPhotoUrl(prefill.photoUrl);
      setPreview(null);
      setImageData(null);
    }
    if (prefill.focus !== undefined) setFocus(prefill.focus);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [prefill]);

  const processFile = useCallback((file: File) => {
    setError(null);

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('Please upload a JPEG, PNG, WebP, or GIF image.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError('Image must be under 10 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      setPreview(result);
      setImageData({ base64, mimeType: file.type });
      setPhotoUrl('');
    };
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback(() => setDragActive(false), []);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleClear = () => {
    setPreview(null);
    setImageData(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (disabled) return;
      const file = e.clipboardData?.files?.[0];
      if (file && file.type.startsWith('image/')) {
        processFile(file);
        return;
      }
      const text = e.clipboardData?.getData('text') ?? '';
      if (UNSPLASH_PHOTO_URL_RE.test(text)) {
        setPhotoUrl(text.trim());
        setPreview(null);
        setImageData(null);
      }
    }

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [disabled, processFile]);

  const hasReference = Boolean(imageData) || UNSPLASH_PHOTO_URL_RE.test(photoUrl.trim());

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (disabled) return;
      setError(null);

      const trimmedUrl = photoUrl.trim();
      const trimmedFocus = focus.trim();

      if (imageData) {
        onSearch({ image: imageData.base64, mimeType: imageData.mimeType, focus: trimmedFocus || undefined });
        return;
      }
      if (trimmedUrl) {
        if (!UNSPLASH_PHOTO_URL_RE.test(trimmedUrl)) {
          setError('Paste a link to a photo page, e.g. unsplash.com/photos/...');
          return;
        }
        onSearch({ photoUrl: trimmedUrl, focus: trimmedFocus || undefined });
        return;
      }
      setError('Add a reference first: drop an image or paste an Unsplash photo link.');
    },
    [disabled, imageData, photoUrl, focus, onSearch]
  );

  return (
    <form className="w-full" onSubmit={handleSubmit}>
      {preview ? (
        <div className="preview-shell preview-shell--shot">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Uploaded reference photo" className="preview-shell__image" />
          <div className="preview-shell__toolbar">
            <button
              type="button"
              onClick={handleClear}
              disabled={disabled}
              className="preview-shell__action"
              aria-label="Remove image and start over"
            >
              Change image
            </button>
          </div>
          {disabled && (
            <div className="preview-shell__overlay">
              <span className="text-sm text-[var(--text-muted)]">Analyzing...</span>
            </div>
          )}
        </div>
      ) : (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => !disabled && inputRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="Upload an image — click or drag and drop"
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !disabled) inputRef.current?.click();
          }}
          className={`drop-zone drop-zone--shot ${dragActive ? 'drop-zone--active' : ''} ${disabled ? 'drop-zone--disabled' : ''}`}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ALLOWED_TYPES.join(',')}
            onChange={handleChange}
            disabled={disabled}
            className="sr-only"
            aria-hidden="true"
          />

          <svg
            width="36"
            height="36"
            viewBox="0 0 36 36"
            fill="none"
            className={`drop-zone__icon ${dragActive ? 'drop-zone__icon--active' : ''}`}
            aria-hidden="true"
          >
            <rect x="1" y="1" width="34" height="34" rx="9" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M18 23V13M18 13l-4 4M18 13l4 4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M12 27h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>

          <p className="drop-zone__title">{dragActive ? 'Drop frame' : 'Drop an inspo shot'}</p>
          <p className="drop-zone__hint">click to browse or paste with Cmd/Ctrl+V</p>
          <p className="drop-zone__meta">JPEG/PNG/WebP/GIF up to 10 MB</p>
        </div>
      )}

      {!preview && (
        <div className="shot-url-row">
          <span className="shot-url-row__or">or</span>
          <input
            type="text"
            value={photoUrl}
            onChange={(e) => setPhotoUrl(e.target.value)}
            placeholder="Paste an Unsplash photo link — unsplash.com/photos/..."
            className="profile-input profile-input--compact"
            disabled={disabled}
            spellCheck={false}
            aria-label="Unsplash photo link"
          />
        </div>
      )}

      <div className="shot-focus-block">
        <label htmlFor="shot-focus" className="profile-input-label">
          Pinpoint the match <span className="profile-input-label__optional">optional</span>
        </label>
        <input
          id="shot-focus"
          type="text"
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          placeholder={`e.g. "match the fog and leading lines, ignore the person"`}
          className="profile-input"
          disabled={disabled}
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-xs text-[var(--text-muted)]">
          Results include the camera settings used, when photographers publish them.
        </p>
        <button type="submit" className="search-btn" disabled={disabled || !hasReference}>
          <span>Find lookalikes</span>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M3 8h10M9 4l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-500 text-center">
          {error}
        </p>
      )}
    </form>
  );
}
