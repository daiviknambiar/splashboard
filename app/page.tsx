'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { MoodBoard } from './components/MoodBoard';
import { StealTheShot, type ShotSearchPayload } from './components/StealTheShot';
import { ProfileExplorer } from './components/ProfileExplorer';
import { ResultsGrid } from './components/ResultsGrid';
import { SplashAnimation } from './components/SplashAnimation';
import { visualSearch, similarSearch, fetchUsage, ApiError, type SearchResult } from '@/lib/api';
import type { Mode, RankedPhoto, SearchStatus, UsageSummary, VisualDescriptors } from '@/types';
import { PhotoCard } from './components/PhotoCard';
import { triggerDownload } from '@/lib/unsplash';
import sampleBoardData from './data/sample-board.json';
import sampleShotData from './data/sample-shot.json';
import sampleProfileData from './data/sample-profile.json';

const SAMPLE_PROMPT = 'quiet misty mornings on the coast, soft fog, muted blues';
const SAMPLE_PHOTOS = sampleBoardData as RankedPhoto[];
const SAMPLE_SHOT = sampleShotData as {
  focus: string;
  reference: RankedPhoto;
  photos: RankedPhoto[];
};
const SAMPLE_PROFILE = sampleProfileData as {
  user: { username: string; name: string; location?: string | null; total_photos?: number; profile_image?: { medium: string } };
  clusters: Array<{ label: string; count: number }>;
  facets: {
    dateHistogram: Array<{ month: string; count: number }>;
    topLocations: Array<{ name: string; count: number }>;
    enrichedCount: number;
    totalIndexed: number;
  };
  totalMatches: number;
  photos: RankedPhoto[];
};

function shortMonth(month: string): string {
  const [year, m] = month.split('-').map((v) => Number.parseInt(v, 10));
  if (!Number.isFinite(year) || !Number.isFinite(m)) return month;
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, m - 1, 1))
  );
}
const REPO_URL = 'https://github.com/daiviknambiar/splashboard';

// Idealized numbers for the decorative Profile Explorer home card — meant to
// convey what the tool does at scale, not Towner's literal (small) sample.
const PROFILE_SHOWCASE = {
  totalPhotos: '1,204',
  askNote: '\u2192 23 matches from 1,204 photos, found instantly',
  clusters: [
    { label: 'Misty Coastlines', count: 214 },
    { label: 'Alpine Peaks', count: 187 },
    { label: 'Iceland Roads', count: 121 },
    { label: 'Parisian Streets', count: 98 },
    { label: 'Night Skies', count: 64 },
  ],
  places: [
    { label: 'Iceland', count: 176 },
    { label: 'Dolomites', count: 143 },
    { label: 'Paris', count: 98 },
  ],
  histogram: [18, 34, 52, 41, 88, 63, 120, 96, 74, 132, 108, 86, 140, 152],
};

type ViewMode = Mode | 'home';

const HOW_IT_WORKS: { step: string; title: string; copy: string }[] = [
  { step: '1', title: 'Describe or drop', copy: 'A vibe in words, a reference photo, or a photographer’s profile.' },
  { step: '2', title: 'AI plans the search', copy: 'Your input becomes targeted Unsplash queries with color and framing filters.' },
  { step: '3', title: 'Curated results', copy: 'A ranked board with camera settings, topics, and places to dig into.' },
];

type SearchMode = 'moodboard' | 'stealthisshot';

type ModeResults = Record<SearchMode, { photos: RankedPhoto[]; descriptors: VisualDescriptors | null }>;
type ModeUiState = Record<SearchMode, { status: SearchStatus; errorMsg: string | null }>;

const DEFAULT_MONTHLY_LIMIT = 4;

const HOME_META = {
  label: 'Overview',
  tag: 'Three tools',
  explainer:
    'Three AI-powered ways to search Unsplash: pin a mood board from words, reverse-engineer any shot, or deep-search a photographer\u2019s entire portfolio.',
};

const MODE_META: Record<Mode, { label: string; tag: string; explainer: string }> = {
  moodboard: {
    label: 'Mood Board',
    tag: 'Words to wall',
    explainer: 'Describe a vibe in plain words. AI turns it into targeted Unsplash searches and pins a board.',
  },
  stealthisshot: {
    label: 'Steal This Shot',
    tag: 'Reference to recipe',
    explainer:
      'Drop a photo or paste an Unsplash link. Get lookalikes plus the camera settings that made them.',
  },
  profile: {
    label: 'Profile Explorer',
    tag: 'Portfolio X-ray',
    explainer:
      'Point at any photographer — even one with thousands of photos — and ask for exactly what you need in plain words. Splashboard indexes the whole portfolio into searchable topics, dates, and places.',
  },
};

interface MoodCardLayoutItem {
  photo: RankedPhoto;
  x: number;
  y: number;
  cardWidth: number;
  cardHeight: number;
  imageWidth: number;
  imageHeight: number;
  rotationDeg: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatMonth(monthKey: string): string {
  const [year, month] = monthKey.split('-');
  const yearNum = Number.parseInt(year, 10);
  const monthNum = Number.parseInt(month, 10);

  if (!Number.isFinite(yearNum) || !Number.isFinite(monthNum) || monthNum < 1 || monthNum > 12) {
    return monthKey;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(yearNum, monthNum - 1, 1)));
}

function loadImageForCanvas(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to load image for export'));
    image.src = url;
  });
}

async function exportMoodBoardImage(photos: RankedPhoto[]) {
  if (photos.length === 0) {
    throw new Error('No mood board images available to download yet.');
  }

  const canvasWidth = 2200;
  const outerPadding = 72;
  const headerHeight = 112;
  const columnGap = 30;
  const framePadding = 14;
  const frameBottom = 26;
  const cardGap = 26;
  const rotationPattern = [-0.8, 0.55, -0.32, 0.38];
  const maxColumns = 5;
  const targetExportHeight = Math.round(canvasWidth * 1.2);
  const baseColumns = photos.length <= 8 ? 2 : photos.length <= 16 ? 3 : 4;
  const minColumns = Math.min(Math.max(baseColumns, 1), photos.length);
  const allowedMaxColumns = Math.min(maxColumns, photos.length);

  function buildLayout(columns: number) {
    const columnWidth = (canvasWidth - outerPadding * 2 - columnGap * (columns - 1)) / columns;
    const imageWidth = columnWidth - framePadding * 2;
    const minImageHeight = imageWidth * 0.72;
    const maxImageHeight = imageWidth * 1.35;
    const columnHeights = Array(columns).fill(outerPadding + headerHeight);
    const layout: MoodCardLayoutItem[] = [];

    photos.forEach((photo, index) => {
      const naturalHeight = imageWidth * (photo.height / photo.width);
      const imageHeight = clamp(naturalHeight, minImageHeight, maxImageHeight);
      const cardHeight = imageHeight + framePadding * 2 + frameBottom;

      let targetColumn = 0;
      for (let i = 1; i < columnHeights.length; i += 1) {
        if (columnHeights[i] < columnHeights[targetColumn]) {
          targetColumn = i;
        }
      }

      const x = outerPadding + targetColumn * (columnWidth + columnGap);
      const y = columnHeights[targetColumn];

      layout.push({
        photo,
        x,
        y,
        cardWidth: columnWidth,
        cardHeight,
        imageWidth,
        imageHeight,
        rotationDeg: rotationPattern[index % rotationPattern.length] ?? 0,
      });

      columnHeights[targetColumn] += cardHeight + cardGap;
    });

    const canvasHeight = Math.ceil(Math.max(...columnHeights) + outerPadding);
    return {
      canvasHeight,
      layout,
    };
  }

  let selectedLayout = buildLayout(minColumns);
  for (let columns = minColumns + 1; columns <= allowedMaxColumns; columns += 1) {
    const candidate = buildLayout(columns);
    if (candidate.canvasHeight < selectedLayout.canvasHeight) {
      selectedLayout = candidate;
    }
    if (candidate.canvasHeight <= targetExportHeight) {
      selectedLayout = candidate;
      break;
    }
  }

  const { canvasHeight, layout } = selectedLayout;
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to initialize image export.');
  }

  const backgroundGradient = context.createLinearGradient(0, 0, canvasWidth, canvasHeight);
  backgroundGradient.addColorStop(0, '#f1e2c1');
  backgroundGradient.addColorStop(1, '#dfc89d');
  context.fillStyle = backgroundGradient;
  context.fillRect(0, 0, canvasWidth, canvasHeight);

  context.fillStyle = 'rgba(103, 83, 52, 0.06)';
  for (let x = 0; x < canvasWidth; x += 14) {
    context.fillRect(x, 0, 1, canvasHeight);
  }

  context.fillStyle = '#4c3824';
  context.font = '700 52px "Space Grotesk", "DM Sans", sans-serif';
  context.textAlign = 'left';
  context.fillText('Mood Board', outerPadding, outerPadding + 50);
  context.font = '500 23px "DM Sans", sans-serif';
  context.fillStyle = '#6c5538';
  context.fillText(`${photos.length} curated images`, outerPadding, outerPadding + 84);

  const renderedCards = await Promise.all(
    layout.map(async (item) => {
      try {
        const image = await loadImageForCanvas(item.photo.urls.regular);
        return { item, image };
      } catch {
        return { item, image: null };
      }
    })
  );

  renderedCards.forEach(({ item, image }) => {
    const imageX = -item.cardWidth / 2 + framePadding;
    const imageY = -item.cardHeight / 2 + framePadding;

    context.save();
    context.translate(item.x + item.cardWidth / 2, item.y + item.cardHeight / 2);
    context.rotate((item.rotationDeg * Math.PI) / 180);

    context.shadowColor = 'rgba(53, 34, 18, 0.2)';
    context.shadowBlur = 20;
    context.shadowOffsetY = 10;
    context.fillStyle = '#f8f1e2';
    context.fillRect(-item.cardWidth / 2, -item.cardHeight / 2, item.cardWidth, item.cardHeight);

    context.shadowColor = 'transparent';
    context.fillStyle = '#d8c6a5';
    context.fillRect(imageX, imageY, item.imageWidth, item.imageHeight);

    if (image) {
      const sourceRatio = image.naturalWidth / image.naturalHeight;
      const targetRatio = item.imageWidth / item.imageHeight;
      let sourceX = 0;
      let sourceY = 0;
      let sourceWidth = image.naturalWidth;
      let sourceHeight = image.naturalHeight;

      if (sourceRatio > targetRatio) {
        sourceWidth = image.naturalHeight * targetRatio;
        sourceX = (image.naturalWidth - sourceWidth) / 2;
      } else {
        sourceHeight = image.naturalWidth / targetRatio;
        sourceY = (image.naturalHeight - sourceHeight) / 2;
      }

      context.save();
      context.beginPath();
      context.rect(imageX, imageY, item.imageWidth, item.imageHeight);
      context.clip();
      context.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        imageX,
        imageY,
        item.imageWidth,
        item.imageHeight
      );
      context.restore();
    } else {
      context.fillStyle = '#604a2d';
      context.font = '600 24px "DM Sans", sans-serif';
      context.textAlign = 'center';
      context.fillText('Image unavailable', 0, imageY + item.imageHeight / 2);
    }

    context.fillStyle = '#cf4f3f';
    context.beginPath();
    context.arc(0, -item.cardHeight / 2 + 12, 5, 0, Math.PI * 2);
    context.fill();

    context.restore();
  });

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) {
    throw new Error('Failed to generate mood board image.');
  }

  const objectUrl = URL.createObjectURL(blob);
  const downloadLink = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');

  downloadLink.href = objectUrl;
  downloadLink.download = `splashboard-mood-board-${stamp}.png`;
  document.body.appendChild(downloadLink);
  downloadLink.click();
  downloadLink.remove();
  URL.revokeObjectURL(objectUrl);
}

export default function Home() {
  const [mode, setMode] = useState<ViewMode>('home');

  // URL hash <-> tool sync: deep-linkable tools, working back/forward.
  useEffect(() => {
    const HASH_TO_MODE: Record<string, ViewMode> = {
      '#moodboard': 'moodboard',
      '#shot': 'stealthisshot',
      '#profile': 'profile',
    };
    const sync = () => setMode(HASH_TO_MODE[window.location.hash] ?? 'home');
    sync();
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);

  const goTo = useCallback((next: ViewMode) => {
    const MODE_TO_HASH: Record<string, string> = {
      moodboard: '#moodboard',
      stealthisshot: '#shot',
      profile: '#profile',
    };
    if (next === 'home') {
      window.history.pushState(null, '', window.location.pathname + window.location.search);
    } else {
      window.location.hash = MODE_TO_HASH[next];
    }
    setMode(next);
  }, []);
  const [shotPrefill, setShotPrefill] = useState<{ photoUrl?: string; focus?: string } | null>(null);
  const [profileAutoOpen, setProfileAutoOpen] = useState<string | undefined>(undefined);
  const [splashActive, setSplashActive] = useState(false);
  const [moodBoardInput, setMoodBoardInput] = useState('');
  const [moodBoardSaved, setMoodBoardSaved] = useState(true);
  const [isExportingMoodBoard, setIsExportingMoodBoard] = useState(false);
  const [resultsByMode, setResultsByMode] = useState<ModeResults>({
    moodboard: { photos: [], descriptors: null },
    stealthisshot: { photos: [], descriptors: null },
  });
  const [uiByMode, setUiByMode] = useState<ModeUiState>({
    moodboard: { status: 'idle', errorMsg: null },
    stealthisshot: { status: 'idle', errorMsg: null },
  });
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [showFreePlanNotice, setShowFreePlanNotice] = useState(false);
  const [userApiKey, setUserApiKey] = useState('');
  const hasUserKey = userApiKey.trim().length > 0;
  const freeTierBlocked = Boolean(usage?.isLimited) && !hasUserKey;

  const noteUsage = useCallback((next: UsageSummary) => {
    setUsage(next);
    if (next.isLimited) {
      setShowFreePlanNotice(true);
    }
  }, []);

  // Load this visitor's remaining free runs on arrival (costs nothing).
  useEffect(() => {
    let cancelled = false;
    fetchUsage().then((initial) => {
      if (initial && !cancelled) setUsage(initial);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const runSearch = useCallback(
    async (targetMode: SearchMode, run: () => Promise<SearchResult>) => {
      if (freeTierBlocked) {
        setUiByMode((prev) => ({
          ...prev,
          [targetMode]: {
            status: 'error',
            errorMsg: 'Free monthly limit reached. See the setup guide to run your own backend.',
          },
        }));
        return;
      }

      setResultsByMode((prev) => ({
        ...prev,
        [targetMode]: { photos: [], descriptors: null },
      }));
      setUiByMode((prev) => ({
        ...prev,
        [targetMode]: { status: 'analyzing', errorMsg: null },
      }));
      setSplashActive(true);

      try {
        const result = await run();
        if (result.usage) noteUsage(result.usage);

        setResultsByMode((prev) => ({
          ...prev,
          [targetMode]: { photos: result.photos, descriptors: result.descriptors },
        }));
        setUiByMode((prev) => ({
          ...prev,
          [targetMode]: { status: 'done', errorMsg: null },
        }));

        if (targetMode === 'moodboard') {
          setMoodBoardSaved(false);
        }
      } catch (err) {
        if (err instanceof ApiError && err.usage) noteUsage(err.usage);
        setUiByMode((prev) => ({
          ...prev,
          [targetMode]: {
            status: 'error',
            errorMsg: err instanceof Error ? err.message : 'Something went wrong',
          },
        }));
      } finally {
        setSplashActive(false);
      }
    },
    [freeTierBlocked, noteUsage]
  );

  const handleMoodBoardSearch = useCallback(
    (description: string) => {
      goTo('moodboard');
      setMoodBoardSaved(false);
      const trimmed = description.trim();
      runSearch('moodboard', () =>
        visualSearch({ mode: 'moodboard', text: trimmed, userApiKey })
      );
    },
    [runSearch, userApiKey, goTo]
  );

  const handleShotSearch = useCallback(
    (payload: ShotSearchPayload) => {
      goTo('stealthisshot');
      runSearch('stealthisshot', () =>
        payload.photoUrl
          ? similarSearch({ photoUrl: payload.photoUrl, focus: payload.focus, userApiKey })
          : visualSearch({
              mode: 'stealthisshot',
              image: payload.image,
              mimeType: payload.mimeType,
              focus: payload.focus,
              userApiKey,
            })
      );
    },
    [runSearch, userApiKey, goTo]
  );

  const handleMoodBoardInputChange = useCallback((nextValue: string) => {
    setMoodBoardInput(nextValue);
    if (nextValue.trim().length > 0) {
      setMoodBoardSaved(false);
    }
  }, []);

  const handleMoodBoardExport = useCallback(async () => {
    if (isExportingMoodBoard) return;

    const photos = resultsByMode.moodboard.photos;
    if (photos.length === 0) return;

    setIsExportingMoodBoard(true);
    try {
      await exportMoodBoardImage(photos);
      // Unsplash guidelines: exporting composes these photos into a new
      // image, which counts as a "use" — fire each download trigger.
      photos.forEach((photo) => triggerDownload(photo.links.download_location));
      setMoodBoardSaved(true);
      setUiByMode((prev) => ({
        ...prev,
        moodboard: { status: prev.moodboard.status, errorMsg: null },
      }));
    } catch (err) {
      setUiByMode((prev) => ({
        ...prev,
        moodboard: {
          status: 'error',
          errorMsg: err instanceof Error ? err.message : 'Export failed',
        },
      }));
    } finally {
      setIsExportingMoodBoard(false);
    }
  }, [isExportingMoodBoard, resultsByMode.moodboard.photos]);

  useEffect(() => {
    const noDraft = moodBoardInput.trim().length === 0;
    const noPhotos = resultsByMode.moodboard.photos.length === 0;

    if (noDraft && noPhotos) {
      setMoodBoardSaved(true);
    }
  }, [moodBoardInput, resultsByMode.moodboard.photos.length]);

  const hasMoodBoardSessionData =
    moodBoardInput.trim().length > 0 || resultsByMode.moodboard.photos.length > 0;
  const hasUnsavedMoodBoard = hasMoodBoardSessionData && !moodBoardSaved;

  useEffect(() => {
    if (!hasUnsavedMoodBoard) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedMoodBoard]);

  const isSearchMode = mode === 'moodboard' || mode === 'stealthisshot';
  const activeUi = isSearchMode ? uiByMode[mode as SearchMode] : null;
  const activeResults = isSearchMode ? resultsByMode[mode as SearchMode] : null;

  const isLoading = activeUi?.status === 'analyzing' || activeUi?.status === 'searching';
  const inputsDisabled = isLoading || freeTierBlocked;
  const loadingCopy = isLoading ? 'Reading the reference and hunting pins...' : null;
  const meta = mode === 'home' ? HOME_META : MODE_META[mode];
  const runsMeterCopy = hasUserKey
    ? 'Using your API key — no run limits.'
    : usage
      ? usage.limit > 0
        ? `${usage.remaining} of ${usage.limit} free runs left this month`
        : 'Unlimited runs on this backend'
      : `${DEFAULT_MONTHLY_LIMIT} free runs per month`;
  const showSampleBoard =
    mode === 'moodboard' && (activeResults?.photos.length ?? 0) === 0 && !isLoading;
  const showSampleShot =
    mode === 'stealthisshot' && (activeResults?.photos.length ?? 0) === 0 && !isLoading;

  return (
    <>
      <SplashAnimation active={splashActive} />

      <div className="app-shell min-h-dvh flex flex-col" data-tool={mode}>
        <div className="noise-overlay" aria-hidden="true" />

        <header className="app-header sticky top-0 z-30">
          <div className="app-header__inner max-w-7xl mx-auto px-4">
            <Link
              href="/"
              className="wordmark-wrap"
              aria-label="Splashboard home"
              onClick={(event) => {
                event.preventDefault();
                goTo('home');
              }}
            >
              <span className="wordmark">Splashboard</span>
            </Link>
            <a
              href={REPO_URL}
              className="gh-star"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Star Splashboard on GitHub"
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
              </svg>
              <span>Star on GitHub</span>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z" />
              </svg>
            </a>
          </div>
        </header>

        <main className="flex-1">
          <section className="max-w-7xl mx-auto px-4 pt-10 pb-8">
            <div className="hero-block">
              <h1 className="hero-title">Find matching visuals <em className="hero-title__accent">fast.</em></h1>
              <p className="hero-copy">{meta.explainer}</p>
            </div>

            <div className={`tool-area ${mode === 'profile' ? 'tool-area--wide' : ''}`}>
              <div className="stage-toolbar">
                <div className="lens-toggle" role="tablist" aria-label="Tools" data-mode={mode}>
                  {(Object.keys(MODE_META) as Mode[]).map((toolMode) => (
                    <button
                      key={toolMode}
                      role="tab"
                      aria-selected={mode === toolMode}
                      className={`lens-toggle__tab ${mode === toolMode ? 'lens-toggle__tab--active' : ''}`}
                      onClick={() => goTo(toolMode)}
                    >
                      {MODE_META[toolMode].label}
                    </button>
                  ))}
                </div>
              </div>

              {mode === 'home' && (
                <div className="home-grid t-panel-slide" data-open="true">
                  <button
                    type="button"
                    className="home-card home-card--moodboard"
                    onClick={() => goTo('moodboard')}
                  >
                    <span className="home-card__title">Mood Board</span>
                    <span className="home-card__tag">{MODE_META.moodboard.tag}</span>
                    <span className="home-card__quote">&ldquo;{SAMPLE_PROMPT}&rdquo;</span>
                    <span className="home-card__collage" aria-hidden="true">
                      {SAMPLE_PHOTOS.slice(0, 6).map((photo) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={photo.id} src={photo.urls.small} alt="" loading="lazy" />
                      ))}
                    </span>
                    <span className="home-card__cta">Open →</span>
                  </button>

                  <button
                    type="button"
                    className="home-card home-card--stealthisshot"
                    onClick={() => goTo('stealthisshot')}
                  >
                    <span className="home-card__title">Steal This Shot</span>
                    <span className="home-card__tag">{MODE_META.stealthisshot.tag}</span>
                    <span className="home-card__quote">&ldquo;{SAMPLE_SHOT.focus}&rdquo;</span>
                    <span className="home-card__shotrow" aria-hidden="true">
                      <span className="home-card__shotref">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={SAMPLE_SHOT.reference.urls.small} alt="" loading="lazy" />
                        <em>reference</em>
                      </span>
                      <span className="home-card__shotarrow">→</span>
                      <span className="home-card__shotmatches">
                        {[SAMPLE_SHOT.photos[0], SAMPLE_SHOT.photos[2] ?? SAMPLE_SHOT.photos[1]].map(
                          (match) => (
                            <span key={match.id} className="home-card__shotmatch">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={match.urls.small} alt="" loading="lazy" />
                              <span className="home-card__exif">
                                {match.exif?.model ?? 'Camera'} · {match.exif?.focal_length ?? '?'}mm · f/
                                {match.exif?.aperture ?? '?'} · ISO {match.exif?.iso ?? '?'}
                              </span>
                            </span>
                          )
                        )}
                      </span>
                    </span>
                    <span className="home-card__cta">Open →</span>
                  </button>

                  <button
                    type="button"
                    className="home-card home-card--profile"
                    onClick={() => goTo('profile')}
                  >
                    <span className="home-card__title">Profile Explorer</span>
                    <span className="home-card__tag">{MODE_META.profile.tag}</span>
                    <span className="home-card__profilehead" aria-hidden="true">
                      {SAMPLE_PROFILE.user.profile_image?.medium && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={SAMPLE_PROFILE.user.profile_image.medium} alt="" />
                      )}
                      <span>
                        <strong>{SAMPLE_PROFILE.user.name}</strong>
                        <span className="home-card__profilemeta">
                          @{SAMPLE_PROFILE.user.username} · {PROFILE_SHOWCASE.totalPhotos} photos indexed
                        </span>
                      </span>
                    </span>
                    <span className="home-card__ask" aria-hidden="true">
                      <span className="home-card__ask-input">misty coastline shots from winter</span>
                      <span className="home-card__ask-btn">Ask</span>
                    </span>
                    <span className="home-card__ask-note" aria-hidden="true">
                      {PROFILE_SHOWCASE.askNote}
                    </span>
                    <span className="home-card__chips" aria-hidden="true">
                      {PROFILE_SHOWCASE.clusters.map((cluster) => (
                        <span key={cluster.label} className="topic-chip">
                          {cluster.label}
                          <span className="topic-chip__count">{cluster.count}</span>
                        </span>
                      ))}
                    </span>
                    <span className="home-card__minilabel" aria-hidden="true">Shooting activity</span>
                    <span className="home-card__histogram" aria-hidden="true">
                      {PROFILE_SHOWCASE.histogram.map((count, i) => {
                        const max = Math.max(...PROFILE_SHOWCASE.histogram);
                        return <span key={i} style={{ height: `${Math.max(10, (count / max) * 100)}%` }} />;
                      })}
                    </span>
                    <span className="home-card__minilabel" aria-hidden="true">Places</span>
                    <span className="home-card__chips" aria-hidden="true">
                      {PROFILE_SHOWCASE.places.map((place) => (
                        <span key={place.label} className="topic-chip">
                          {place.label}
                          <span className="topic-chip__count">{place.count}</span>
                        </span>
                      ))}
                    </span>
                    <span className="home-card__thumbs" aria-hidden="true">
                      {SAMPLE_PROFILE.photos.slice(0, 3).map((photo) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={photo.id} src={photo.urls.thumb} alt="" loading="lazy" />
                      ))}
                    </span>
                    <span className="home-card__cta">Open →</span>
                  </button>
                </div>
              )}

              <div className="tool-switcher" aria-label="Search tools">
                {mode === 'moodboard' && (
                  <article className="tool-card tool-card--mood tool-card--active t-panel-slide" data-open="true">
                    <MoodBoard
                      value={moodBoardInput}
                      onValueChange={handleMoodBoardInputChange}
                      onSearch={handleMoodBoardSearch}
                      disabled={inputsDisabled}
                    />
                  </article>
                )}
                {mode === 'stealthisshot' && (
                  <article className="tool-card tool-card--shot tool-card--active t-panel-slide" data-open="true">
                    <StealTheShot onSearch={handleShotSearch} disabled={inputsDisabled} prefill={shotPrefill} />
                  </article>
                )}
                {mode === 'profile' && (
                  <article className="tool-card tool-card--mood tool-card--profile tool-card--active t-panel-slide" data-open="true">
                    <ProfileExplorer userApiKey={userApiKey} onUsage={noteUsage} autoOpen={profileAutoOpen} />
                  </article>
                )}
              </div>

              {loadingCopy && (
                <p className="status-inline" role="status" aria-live="polite">
                  <span className="t-shimmer" data-text={loadingCopy}>
                    {loadingCopy}
                  </span>
                </p>
              )}

              {activeUi?.status === 'error' && activeUi.errorMsg && (
                <p className="error-inline" role="alert">
                  {activeUi.errorMsg}
                </p>
              )}

              <p className="runs-meter">
                <span
                  className={`runs-meter__dot ${
                    !hasUserKey && usage?.remaining === 0 ? 'runs-meter__dot--empty' : ''
                  }`}
                  aria-hidden="true"
                />
                {runsMeterCopy}
                <button
                  type="button"
                  className="runs-meter__why"
                  onClick={() => setShowFreePlanNotice((value) => !value)}
                  aria-expanded={showFreePlanNotice}
                >
                  {showFreePlanNotice ? 'Hide' : 'Details'}
                </button>
              </p>

              {mode === 'home' && (
                <div className="how-strip how-strip--home" aria-label="How Splashboard works">
                  {HOW_IT_WORKS.map((item) => (
                    <div key={item.step} className="how-step">
                      <span className="how-step__num">{item.step}</span>
                      <div>
                        <p className="how-step__title">{item.title}</p>
                        <p className="how-step__copy">{item.copy}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {showFreePlanNotice && (
              <div className="quota-panel quota-strip t-panel-slide" data-open="true" aria-live="polite">
                <p className="quota-panel__eyebrow">Free &amp; open source</p>
                <p className="quota-panel__summary">
                  {usage && usage.limit === 0
                    ? 'Splashboard is a free, open-source project. This backend has no search limits set.'
                    : `Splashboard is a free, open-source project, so each visitor gets ${usage?.limit ?? DEFAULT_MONTHLY_LIMIT} searches a month.`}{' '}
                  Samples and already-indexed profiles are always free to browse.
                </p>
                <div className="quota-panel__key-entry">
                  <label htmlFor="user-api-key" className="quota-panel__key-label">
                    Unlimited searches: use your own API key (OpenAI or Gemini)
                  </label>
                  <input
                    id="user-api-key"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={userApiKey}
                    onChange={(event) => setUserApiKey(event.target.value)}
                    placeholder="sk-... or AIza..."
                    className="quota-panel__key-input"
                  />
                  <p className="quota-panel__key-note">
                    {hasUserKey
                      ? 'Using your key — no limits. It stays in this tab and is only used for your searches.'
                      : 'Your key stays in this tab and is only used for your searches.'}
                  </p>
                </div>
                <p className="quota-panel__contact">
                  Or{' '}
                  <a href={REPO_URL} className="footer-link" target="_blank" rel="noopener noreferrer">
                    clone the repo
                  </a>{' '}
                  and run your own copy.
                </p>
                {freeTierBlocked && (
                  <p className="quota-panel__alert">
                    That&apos;s all your free searches for {formatMonth(usage?.month ?? '')}. Add a key above or
                    clone the repo — browsing stays free.
                  </p>
                )}
              </div>
            )}
          </section>

          {showSampleBoard && (
            <section className="sample-section max-w-7xl mx-auto px-4 pb-16">
              <div className="how-strip" aria-label="How Splashboard works">
                {HOW_IT_WORKS.map((item) => (
                  <div key={item.step} className="how-step">
                    <span className="how-step__num">{item.step}</span>
                    <div>
                      <p className="how-step__title">{item.title}</p>
                      <p className="how-step__copy">{item.copy}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="sample-board">
                <div className="results-header">
                  <div>
                    <p className="results-header__eyebrow">Sample board · cached demo</p>
                    <h2 className="results-header__title">&ldquo;{SAMPLE_PROMPT}&rdquo;</h2>
                  </div>
                  <div className="results-header__actions">
                    <p className="results-header__count">Uses none of your free runs</p>
                    <button
                      type="button"
                      className="export-btn"
                      onClick={() => {
                        handleMoodBoardInputChange(SAMPLE_PROMPT);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                    >
                      Remix this prompt
                    </button>
                  </div>
                </div>
                <div className="moodboard-canvas">
                  {SAMPLE_PHOTOS.map((photo, i) => (
                    <PhotoCard key={photo.id} photo={photo} index={i} variant="mood" showExif={false} />
                  ))}
                </div>
              </div>
            </section>
          )}

          {showSampleShot && (
            <section className="sample-section max-w-7xl mx-auto px-4 pb-16">
              <div className="sample-board">
                <div className="results-header">
                  <div>
                    <p className="results-header__eyebrow">Sample · cached demo</p>
                    <h2 className="results-header__title">
                      One reference photo, matched by &ldquo;{SAMPLE_SHOT.focus}&rdquo;
                    </h2>
                  </div>
                  <div className="results-header__actions">
                    <p className="results-header__count">Uses none of your free searches</p>
                    <button
                      type="button"
                      className="export-btn"
                      onClick={() => {
                        setShotPrefill({
                          photoUrl: SAMPLE_SHOT.reference.links.html,
                          focus: SAMPLE_SHOT.focus,
                        });
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                    >
                      Try this reference
                    </button>
                  </div>
                </div>
                <div className="sample-shot-row">
                  <div className="sample-shot-ref">
                    <p className="profile-input-label">Reference</p>
                    <PhotoCard photo={SAMPLE_SHOT.reference} index={0} variant="shot" showExif={false} />
                  </div>
                  <div className="sample-shot-matches">
                    <p className="profile-input-label">Lookalikes with camera settings</p>
                    <div className="shot-grid">
                      {SAMPLE_SHOT.photos.slice(0, 6).map((photo, i) => (
                        <PhotoCard key={photo.id} photo={photo} index={i + 1} variant="shot" showExif />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {mode === 'profile' && !profileAutoOpen && (
            <section className="sample-section max-w-7xl mx-auto px-4 pb-16">
              <div className="sample-board">
                <div className="results-header">
                  <div>
                    <p className="results-header__eyebrow">Sample · Profile Explorer</p>
                    <h2 className="results-header__title">{SAMPLE_PROFILE.user.name}&rsquo;s portfolio, mapped</h2>
                  </div>
                  <div className="results-header__actions">
                    <p className="results-header__count">Browsing indexed profiles is always free</p>
                    <button
                      type="button"
                      className="export-btn"
                      onClick={() => {
                        setProfileAutoOpen(SAMPLE_PROFILE.user.username);
                        goTo('profile');
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                    >
                      Explore it live
                    </button>
                  </div>
                </div>

                {/* Static snapshot of the real explorer UI — nothing here is
                    interactive; the CTA above opens the live version. */}
                <div className="sample-static" aria-hidden="true">
                  <div className="profile-header">
                    {SAMPLE_PROFILE.user.profile_image?.medium && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={SAMPLE_PROFILE.user.profile_image.medium} alt="" className="candidate-avatar candidate-avatar--lg" />
                    )}
                    <div className="profile-header__names">
                      <p className="profile-header__name">{SAMPLE_PROFILE.user.name}</p>
                      <p className="profile-header__meta">
                        @{SAMPLE_PROFILE.user.username} · {SAMPLE_PROFILE.user.total_photos} photos
                        {SAMPLE_PROFILE.user.location ? ` · ${SAMPLE_PROFILE.user.location}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="ask-row">
                    <input
                      type="text"
                      readOnly
                      tabIndex={-1}
                      value=""
                      placeholder={`Ask this portfolio anything, e.g. "misty coastline shots from winter"`}
                      className="profile-input"
                    />
                    <span className="search-btn"><span>Ask</span></span>
                  </div>

                  <div className="topic-strip">
                    {SAMPLE_PROFILE.clusters.map((cluster) => (
                      <span key={cluster.label} className="topic-chip">
                        {cluster.label}
                        <span className="topic-chip__count">{cluster.count}</span>
                      </span>
                    ))}
                  </div>

                  <div className="facet-panel">
                    <div className="facet-block">
                      <p className="facet-block__title">
                        Places{' '}
                        <span className="facet-block__hint">
                          {SAMPLE_PROFILE.facets.enrichedCount}/{SAMPLE_PROFILE.facets.totalIndexed} photos location-checked
                        </span>
                      </p>
                      <div className="facet-chips">
                        {SAMPLE_PROFILE.facets.topLocations.map((loc) => (
                          <span key={loc.name} className="topic-chip">
                            {loc.name}
                            <span className="topic-chip__count">{loc.count}</span>
                          </span>
                        ))}
                      </div>
                      <p className="facet-block__empty">Real photographer-tagged places, fetched on demand.</p>
                    </div>
                    {SAMPLE_PROFILE.facets.dateHistogram.length > 1 && (
                      <div className="facet-block">
                        <p className="facet-block__title">Activity</p>
                        <div className="date-histogram">
                          {SAMPLE_PROFILE.facets.dateHistogram.map((bucket) => {
                            const max = Math.max(...SAMPLE_PROFILE.facets.dateHistogram.map((b) => b.count));
                            return (
                              <div
                                key={bucket.month}
                                className="date-histogram__bar"
                                style={{ height: `${Math.max(8, (bucket.count / max) * 100)}%` }}
                              />
                            );
                          })}
                        </div>
                        <p className="facet-block__hint">
                          {shortMonth(SAMPLE_PROFILE.facets.dateHistogram[0].month)} to{' '}
                          {shortMonth(
                            SAMPLE_PROFILE.facets.dateHistogram[SAMPLE_PROFILE.facets.dateHistogram.length - 1].month
                          )}
                        </p>
                      </div>
                    )}
                  </div>

                  <p className="results-header__count">{SAMPLE_PROFILE.totalMatches} matches</p>
                  <div className="moodboard-canvas">
                    {SAMPLE_PROFILE.photos.map((photo, i) => (
                      <PhotoCard key={photo.id} photo={photo} index={i} variant="mood" showExif={false} />
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}

          {isSearchMode && activeResults && activeResults.photos.length > 0 && (
            <ResultsGrid
              photos={activeResults.photos}
              mode={mode}
              descriptors={activeResults.descriptors}
              modeLabel={meta.label}
              onExportMoodBoard={mode === 'moodboard' ? handleMoodBoardExport : undefined}
              exportDisabled={isExportingMoodBoard}
              exportLabel={isExportingMoodBoard ? 'Exporting...' : 'Download board'}
            />
          )}

          {isSearchMode && activeUi?.status === 'done' && activeResults?.photos.length === 0 && (
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
              Live lens: {meta.label}
            </p>
          </div>
        </footer>
      </div>
    </>
  );
}
