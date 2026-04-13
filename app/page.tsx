'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { MoodBoard } from './components/MoodBoard';
import { StealTheShot } from './components/StealTheShot';
import { ResultsGrid } from './components/ResultsGrid';
import { SplashAnimation } from './components/SplashAnimation';
import type { Mode, RankedPhoto, SearchStatus, VisualDescriptors } from '@/types';

const STATUS_COPY: Record<SearchStatus, string | null> = {
  idle: 'Idle',
  analyzing: 'Scanning the vibe...',
  searching: 'Pin-hunting...',
  done: 'Fresh pulls ready',
  error: 'Glitch',
};

export default function Home() {
  const [mode, setMode] = useState<Mode>('moodboard');
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [splashActive, setSplashActive] = useState(false);
  const [photos, setPhotos] = useState<RankedPhoto[]>([]);
  const [descriptors, setDescriptors] = useState<VisualDescriptors | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const runSearch = useCallback(async (analyzePayload: object) => {
    setErrorMsg(null);
    setPhotos([]);
    setDescriptors(null);

    // Fire splash
    setSplashActive(true);
    setStatus('analyzing');

    try {
      // 1. Analyze input → structured descriptors
      const analyzeRes = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(analyzePayload),
      });

      if (!analyzeRes.ok) {
        const err = await analyzeRes.json().catch(() => ({}));
        throw new Error(err.error ?? 'Analysis failed');
      }

      const desc: VisualDescriptors = await analyzeRes.json();
      setDescriptors(desc);
      setStatus('searching');

      // 2. Search Unsplash with descriptors
      const searchRes = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(desc),
      });

      if (!searchRes.ok) {
        const err = await searchRes.json().catch(() => ({}));
        throw new Error(err.error ?? 'Search failed');
      }

      const data = await searchRes.json();
      setPhotos(data.photos ?? []);
      setStatus('done');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong');
      setStatus('error');
    } finally {
      setSplashActive(false);
    }
  }, []);

  const handleMoodBoardSearch = useCallback(
    (description: string) => {
      setMode('moodboard');
      runSearch({ type: 'text', description });
    },
    [runSearch]
  );

  const handleImageUpload = useCallback(
    (base64: string, mimeType: string) => {
      setMode('stealthisshot');
      runSearch({ type: 'image', image: base64, mimeType });
    },
    [runSearch]
  );

  const isLoading = status === 'analyzing' || status === 'searching';
  const statusCopy = STATUS_COPY[status] ?? 'Idle';
  const loadingCopy =
    status === 'analyzing' || status === 'searching'
      ? STATUS_COPY[status]
      : null;
  const modeLabel = mode === 'moodboard' ? 'Mood Board' : 'Steal This Shot';

  return (
    <>
      <SplashAnimation active={splashActive} />

      <div
        className={`app-shell ${mode === 'stealthisshot' ? 'app-shell--shot' : ''} min-h-dvh flex flex-col`}
      >
        <div className="noise-overlay" aria-hidden="true" />

        <header className="app-header sticky top-0 z-30">
          <div className="app-header__inner max-w-7xl mx-auto px-4">
            <Link href="/" className="wordmark-wrap" aria-label="Splashboard home">
              <span className="wordmark">Splashboard</span>
              <span className="wordmark-tag">creative arcade</span>
            </Link>

            <div className="header-status">
              <span className="status-dot" data-active={isLoading ? 'true' : 'false'} />
              <span>{statusCopy}</span>
            </div>
          </div>
        </header>

        <main className="flex-1">
          <section className="max-w-7xl mx-auto px-4 pt-9 pb-8">
            <div className="studio-layout">
              <aside className="story-panel">
                <p className="hero-eyebrow">Creative Playground</p>
                <h1 className="hero-title">Pin vibes. Steal shots.</h1>
                <p className="hero-copy">
                  Keep it loose: type a mood or drop a frame and watch the board build itself.
                </p>
                <p className="hero-copy hero-copy--subtle">
                  Mood Board leans Pinterest. Steal This Shot leans photo-forensics.
                </p>
              </aside>

              <div className="studio-stage">
                <div className="stage-toolbar">
                  <div className="lens-toggle" role="tablist" aria-label="Results lens">
                    <button
                      role="tab"
                      aria-selected={mode === 'moodboard'}
                      className={`lens-toggle__tab ${mode === 'moodboard' ? 'lens-toggle__tab--active' : ''}`}
                      onClick={() => setMode('moodboard')}
                    >
                      Mood Board
                    </button>
                    <button
                      role="tab"
                      aria-selected={mode === 'stealthisshot'}
                      className={`lens-toggle__tab ${mode === 'stealthisshot' ? 'lens-toggle__tab--active' : ''}`}
                      onClick={() => setMode('stealthisshot')}
                    >
                      Steal This Shot
                    </button>
                  </div>
                </div>

                <div className="tool-switcher" aria-label="Search tools">
                  {mode === 'moodboard' ? (
                    <article className="tool-card tool-card--mood tool-card--active">
                      <div className="tool-card__header">
                        <div>
                          <h2>Mood Board</h2>
                          <p>Prompt to pins</p>
                        </div>
                      </div>
                      <MoodBoard onSearch={handleMoodBoardSearch} disabled={isLoading} />
                    </article>
                  ) : (
                    <article className="tool-card tool-card--shot tool-card--active">
                      <div className="tool-card__header">
                        <div>
                          <h2>Steal This Shot</h2>
                          <p>Reference to lookalikes + camera DNA</p>
                        </div>
                      </div>
                      <StealTheShot onUpload={handleImageUpload} disabled={isLoading} />
                    </article>
                  )}
                </div>

                {loadingCopy && (
                  <p
                    className="status-inline"
                    role="status"
                    aria-live="polite"
                  >
                    {loadingCopy}
                  </p>
                )}

                {status === 'error' && errorMsg && (
                  <p
                    className="error-inline"
                    role="alert"
                  >
                    {errorMsg}
                  </p>
                )}
              </div>
            </div>
          </section>

          {photos.length > 0 && (
            <ResultsGrid
              photos={photos}
              mode={mode}
              descriptors={descriptors}
              modeLabel={modeLabel}
            />
          )}

          {status === 'done' && photos.length === 0 && (
            <section className="max-w-7xl mx-auto px-4 pb-16">
              <p className="empty-state">No results found. Try a different prompt or image.</p>
            </section>
          )}
        </main>

        <footer className="app-footer mt-auto">
          <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
            <p className="text-xs text-[var(--text-muted)]">
              Images sourced from{' '}
              <a
                href="https://unsplash.com?utm_source=splashboard&utm_medium=referral"
                className="footer-link"
                target="_blank"
                rel="noopener noreferrer"
              >
                Unsplash
              </a>
            </p>
            <p className="text-xs text-[var(--text-muted)] hidden sm:block">
              Live lens: {modeLabel}
            </p>
          </div>
        </footer>
      </div>
    </>
  );
}
