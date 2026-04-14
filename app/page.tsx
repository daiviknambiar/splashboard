'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { MoodBoard } from './components/MoodBoard';
import { StealTheShot } from './components/StealTheShot';
import { ResultsGrid } from './components/ResultsGrid';
import { SplashAnimation } from './components/SplashAnimation';
import { mergeAndRankResults } from '@/lib/ranker';
import { getPhotoDetails, searchPhotos } from '@/lib/unsplash';
import type { Mode, RankedPhoto, SearchStatus, UsageSummary, VisualDescriptors } from '@/types';

const STATUS_COPY: Record<SearchStatus, string | null> = {
  idle: 'Idle',
  analyzing: 'Scanning the vibe...',
  searching: 'Pin-hunting...',
  done: 'Fresh pulls ready',
  error: 'Glitch',
};

type AnalyzePayload =
  | { type: 'text'; description: string }
  | { type: 'image'; image: string; mimeType: string };

type ModeResults = Record<Mode, { photos: RankedPhoto[]; descriptors: VisualDescriptors | null }>;
type ModeUiState = Record<Mode, { status: SearchStatus; errorMsg: string | null }>;

interface StoredUsageState {
  month: string;
  used: number;
}

const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || 'daiviknambiarpro@gmail.com';
const LOCAL_USAGE_KEY = 'splashboard:monthly-usage:v1';
const DEFAULT_MONTHLY_LIMIT = 15;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

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
  }).format(
    new Date(Date.UTC(yearNum, monthNum - 1, 1))
  );
}

function getMonthKey(date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function getMonthlyLimit(): number {
  const parsed = Number.parseInt(process.env.NEXT_PUBLIC_MONTHLY_ACTION_LIMIT ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MONTHLY_LIMIT;
  }
  return parsed;
}

function toUsageSummary(used: number, limit: number, month: string, usingOwnApiKey = false): UsageSummary {
  return {
    month,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    isLimited: used >= limit,
    usingOwnApiKey,
  };
}

function readStoredUsage(month: string): StoredUsageState {
  if (typeof window === 'undefined') {
    return { month, used: 0 };
  }

  try {
    const raw = window.localStorage.getItem(LOCAL_USAGE_KEY);
    if (!raw) {
      return { month, used: 0 };
    }

    const parsed = JSON.parse(raw) as Partial<StoredUsageState>;
    const parsedUsed = Number(parsed.used);
    if (
      typeof parsed.month === 'string' &&
      parsed.month === month &&
      Number.isFinite(parsedUsed) &&
      parsedUsed >= 0
    ) {
      return { month: parsed.month, used: parsedUsed };
    }
  } catch {
    // fall through to reset
  }

  return { month, used: 0 };
}

function writeStoredUsage(state: StoredUsageState): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LOCAL_USAGE_KEY, JSON.stringify(state));
}

function getUsageSummaryFromStorage(usingOwnApiKey = false): UsageSummary {
  const month = getMonthKey();
  const limit = getMonthlyLimit();
  const state = readStoredUsage(month);
  return toUsageSummary(state.used, limit, month, usingOwnApiKey);
}

function consumeMonthlyActionFromStorage(): { allowed: boolean; usage: UsageSummary } {
  const month = getMonthKey();
  const limit = getMonthlyLimit();
  const state = readStoredUsage(month);
  const nextUsed = Math.min(limit, state.used + 1);

  if (state.used >= limit) {
    return {
      allowed: false,
      usage: toUsageSummary(state.used, limit, month),
    };
  }

  writeStoredUsage({ month, used: nextUsed });
  return {
    allowed: true,
    usage: toUsageSummary(nextUsed, limit, month),
  };
}

async function analyzeWithApi(
  payload: AnalyzePayload,
  ownApiKey: string | undefined
): Promise<VisualDescriptors> {
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      ...(ownApiKey ? { apiKey: ownApiKey } : {}),
    }),
  });

  const responseData = (await response.json().catch(() => null)) as
    | { descriptors?: VisualDescriptors; error?: string }
    | null;

  if (!response.ok) {
    throw new Error(responseData?.error || 'Unable to analyze input.');
  }

  if (!responseData?.descriptors) {
    throw new Error('Invalid analysis response from server.');
  }

  return responseData.descriptors;
}

async function runUnsplashSearch(descriptors: VisualDescriptors, lens: Mode): Promise<RankedPhoto[]> {
  const queries = [
    `${descriptors.locationType} ${descriptors.lightingConditions}`.trim(),
    descriptors.searchTerms[0] ?? `${descriptors.mood} ${descriptors.colorPalette}`.trim(),
    descriptors.searchTerms[1] ?? `${descriptors.framing} ${descriptors.locationType}`.trim(),
  ]
    .filter((query): query is string => query.trim().length > 0)
    .slice(0, 3);

  const batches = await Promise.all(
    queries.map(async (query, index) => {
      try {
        const photos = await searchPhotos(query, 10);
        return { photos, queryIndex: index };
      } catch (err) {
        console.warn(`[unsplash] query ${index} failed:`, err);
        return { photos: [], queryIndex: index };
      }
    })
  );

  const ranked = mergeAndRankResults(batches, descriptors);
  const topResults = ranked.slice(0, 24);

  if (lens !== 'stealthisshot') {
    return topResults;
  }

  return Promise.all(
    topResults.map(async (photo) => {
      const hasExif =
        photo.exif &&
        (photo.exif.make ||
          photo.exif.model ||
          photo.exif.focal_length ||
          photo.exif.aperture ||
          photo.exif.exposure_time ||
          photo.exif.iso);
      if (hasExif) {
        return photo;
      }

      try {
        const details = await getPhotoDetails(photo.id);
        return {
          ...photo,
          ...details,
          score: photo.score,
        };
      } catch (err) {
        console.warn(`[unsplash] details fetch failed for ${photo.id}:`, err);
        return photo;
      }
    })
  );
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
  const [mode, setMode] = useState<Mode>('moodboard');
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
  const [useOwnGeminiKey, setUseOwnGeminiKey] = useState(false);
  const [ownGeminiKey, setOwnGeminiKey] = useState('');

  const hasOwnGeminiKey = ownGeminiKey.trim().length > 0;
  const usingOwnGeminiKey = useOwnGeminiKey && hasOwnGeminiKey;
  const freeTierBlocked = Boolean(usage?.isLimited) && !usingOwnGeminiKey;

  const runSearch = useCallback(
    async (targetMode: Mode, analyzePayload: AnalyzePayload) => {
      if (freeTierBlocked) {
        setUiByMode((prev) => ({
          ...prev,
          [targetMode]: {
            status: 'error',
            errorMsg: 'Free monthly limit reached. Add your own Gemini key or contact for self-hosting.',
          },
        }));
        return;
      }

      const ownApiKey = ownGeminiKey.trim();

      setResultsByMode((prev) => ({
        ...prev,
        [targetMode]: {
          photos: [],
          descriptors: null,
        },
      }));
      setUiByMode((prev) => ({
        ...prev,
        [targetMode]: {
          status: 'analyzing',
          errorMsg: null,
        },
      }));
      setSplashActive(true);

      try {
        if (!usingOwnGeminiKey) {
          const quota = consumeMonthlyActionFromStorage();
          setUsage(quota.usage);

          if (!quota.allowed) {
            throw new Error(
              `You have reached the free monthly limit (${quota.usage.limit} actions). Add your own Gemini API key or contact us for self-hosting.`
            );
          }
        } else {
          setUsage(getUsageSummaryFromStorage(true));
        }

        let descriptors: VisualDescriptors;
        if (analyzePayload.type === 'text') {
          const trimmed = analyzePayload.description.trim();
          if (trimmed.length < 3 || trimmed.length > 1000) {
            throw new Error('description must be 3–1000 characters');
          }
          descriptors = await analyzeWithApi(
            { type: 'text', description: trimmed },
            usingOwnGeminiKey ? ownApiKey : undefined
          );
        } else {
          if (!analyzePayload.image || typeof analyzePayload.image !== 'string') {
            throw new Error('base64 image is required');
          }
          if (!ALLOWED_IMAGE_TYPES.has(analyzePayload.mimeType)) {
            throw new Error('Unsupported image type');
          }
          descriptors = await analyzeWithApi(
            {
              type: 'image',
              image: analyzePayload.image,
              mimeType: analyzePayload.mimeType,
            },
            usingOwnGeminiKey ? ownApiKey : undefined
          );
        }

        setUiByMode((prev) => ({
          ...prev,
          [targetMode]: {
            status: 'searching',
            errorMsg: null,
          },
        }));

        const photos = await runUnsplashSearch(descriptors, targetMode);
        setResultsByMode((prev) => ({
          ...prev,
          [targetMode]: {
            photos,
            descriptors,
          },
        }));
        setUiByMode((prev) => ({
          ...prev,
          [targetMode]: {
            status: 'done',
            errorMsg: null,
          },
        }));

        if (targetMode === 'moodboard') {
          setMoodBoardSaved(false);
        }
      } catch (err) {
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
    [freeTierBlocked, ownGeminiKey, usingOwnGeminiKey]
  );

  useEffect(() => {
    setUsage(getUsageSummaryFromStorage(false));
  }, []);

  const handleMoodBoardSearch = useCallback(
    (description: string) => {
      setMode('moodboard');
      setMoodBoardSaved(false);
      runSearch('moodboard', { type: 'text', description });
    },
    [runSearch]
  );

  const handleImageUpload = useCallback(
    (base64: string, mimeType: string) => {
      setMode('stealthisshot');
      runSearch('stealthisshot', { type: 'image', image: base64, mimeType });
    },
    [runSearch]
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
      setMoodBoardSaved(true);
      setUiByMode((prev) => ({
        ...prev,
        moodboard: {
          status: prev.moodboard.status,
          errorMsg: null,
        },
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

  const activeUi = uiByMode[mode];
  const activeResults = resultsByMode[mode];

  const isLoading = activeUi.status === 'analyzing' || activeUi.status === 'searching';
  const inputsDisabled = isLoading || freeTierBlocked;
  const statusCopy = STATUS_COPY[activeUi.status] ?? 'Idle';
  const loadingCopy =
    activeUi.status === 'analyzing' || activeUi.status === 'searching'
      ? STATUS_COPY[activeUi.status]
      : null;
  const modeLabel = mode === 'moodboard' ? 'Mood Board' : 'Steal This Shot';
  const usageCopy = usage
    ? `${usage.remaining} of ${usage.limit} free actions left for ${formatMonth(usage.month)}`
    : 'Checking monthly free actions...';
  const usageTag = usingOwnGeminiKey ? 'BYO key' : usage ? `${usage.remaining} left` : '...';
  const contactHref = CONTACT_EMAIL
    ? `mailto:${CONTACT_EMAIL}?subject=Splashboard%20Self-Hosting%20License`
    : null;

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
              <span className="header-status__usage">{usageTag}</span>
            </div>
          </div>
        </header>

        <main className="flex-1">
          <section className="max-w-7xl mx-auto px-4 pt-9 pb-8">
            <div className="studio-layout">
              <aside className="story-panel">
                <h1 className="hero-title">Find matching visuals fast.</h1>
                <p className="hero-copy">
                  Type a mood or upload a photo to get similar shots and useful camera details.
                </p>
                <div className="quota-panel" aria-live="polite">
                  <p className="quota-panel__eyebrow">Free plan</p>
                  <p className="quota-panel__summary">{usageCopy}</p>

                  <label className="byok-toggle">
                    <input
                      type="checkbox"
                      checked={useOwnGeminiKey}
                      onChange={(event) => setUseOwnGeminiKey(event.target.checked)}
                    />
                    <span>Use your own Gemini 2.5 Flash API key</span>
                  </label>

                  {useOwnGeminiKey && (
                    <div className="byok-field">
                      <input
                        type="password"
                        value={ownGeminiKey}
                        onChange={(event) => setOwnGeminiKey(event.target.value)}
                        placeholder="AIza..."
                        className="byok-input"
                        autoComplete="off"
                      />
                      <p className="byok-note">
                        Your key is used only for this request and is never saved server-side.
                      </p>
                    </div>
                  )}

                  {freeTierBlocked && (
                    <p className="quota-panel__alert">
                      Free limit reached. Add your own key or contact for a self-hosting license.
                    </p>
                  )}

                  <p className="quota-panel__contact">
                    {contactHref ? (
                      <a href={contactHref} className="footer-link">
                        Contact me to buy the code or set up self-hosting.
                      </a>
                    ) : (
                      'email daiviknambiarpro@gmail.com'
                    )}
                  </p>
                </div>
              </aside>

              <div className="studio-stage">
                <div className="stage-toolbar">
                  <div className="lens-toggle" role="tablist" aria-label="Results lens" data-mode={mode}>
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
                      <MoodBoard
                        value={moodBoardInput}
                        onValueChange={handleMoodBoardInputChange}
                        onSearch={handleMoodBoardSearch}
                        disabled={inputsDisabled}
                      />
                    </article>
                  ) : (
                    <article className="tool-card tool-card--shot tool-card--active">
                      <div className="tool-card__header">
                        <div>
                          <h2>Steal This Shot</h2>
                          <p>Reference to lookalikes + camera DNA</p>
                        </div>
                      </div>
                      <StealTheShot onUpload={handleImageUpload} disabled={inputsDisabled} />
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

                {activeUi.status === 'error' && activeUi.errorMsg && (
                  <p
                    className="error-inline"
                    role="alert"
                  >
                    {activeUi.errorMsg}
                  </p>
                )}
              </div>
            </div>
          </section>

          {activeResults.photos.length > 0 && (
            <ResultsGrid
              photos={activeResults.photos}
              mode={mode}
              descriptors={activeResults.descriptors}
              modeLabel={modeLabel}
              onExportMoodBoard={mode === 'moodboard' ? handleMoodBoardExport : undefined}
              exportDisabled={isExportingMoodBoard}
              exportLabel={isExportingMoodBoard ? 'Exporting...' : 'Download board'}
            />
          )}

          {activeUi.status === 'done' && activeResults.photos.length === 0 && (
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
