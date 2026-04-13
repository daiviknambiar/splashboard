'use client';

import { useState, useCallback, useRef, useEffect, type DragEvent, type ChangeEvent } from 'react';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

interface StealTheShotProps {
  onUpload: (base64: string, mimeType: string) => void;
  disabled?: boolean;
}

export function StealTheShot({ onUpload, disabled }: StealTheShotProps) {
  const [dragActive, setDragActive] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    (file: File) => {
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
        // result is data:image/jpeg;base64,<data>
        const base64 = result.split(',')[1];
        setPreview(result);
        onUpload(base64, file.type);
      };
      reader.readAsDataURL(file);
    },
    [onUpload]
  );

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
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (disabled) return;
      const files = e.clipboardData?.files;
      const file = files?.[0];
      if (file && file.type.startsWith('image/')) {
        processFile(file);
      }
    }

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [disabled, processFile]);

  return (
    <div className="w-full">
      {preview ? (
        <div className="preview-shell preview-shell--shot">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview}
            alt="Uploaded photo"
            className="preview-shell__image"
          />
          <div className="preview-shell__toolbar">
            <button
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

          <p className="drop-zone__title">
            {dragActive ? 'Drop frame' : 'Drop an inspo shot'}
          </p>
          <p className="drop-zone__hint">
            click to browse or paste with Cmd/Ctrl+V
          </p>
          <p className="drop-zone__meta">
            JPEG/PNG/WebP/GIF up to 10 MB
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-500 text-center">
          {error}
        </p>
      )}
    </div>
  );
}
