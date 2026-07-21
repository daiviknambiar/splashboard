'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  advanceProfileIndex,
  askProfile,
  enrichProfile,
  getProfilePhotos,
  resolveProfile,
  ApiError,
  type ProfileFilters,
  type ProfilePhotosResult,
} from '@/lib/api';
import type { ProfileStatus, ProfileUser, RankedPhoto, UsageSummary } from '@/types';
import { PhotoCard } from './PhotoCard';

type Stage = 'input' | 'resolving' | 'candidates' | 'indexing' | 'ready';

interface ProfileExplorerProps {
  userApiKey?: string;
  autoOpen?: string;
  onUsage?: (usage: UsageSummary) => void;
}

const ORDER_OPTIONS = [
  { value: 'latest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'popular', label: 'Most liked' },
];

function formatMonthLabel(month: string): string {
  const [year, m] = month.split('-').map((v) => Number.parseInt(v, 10));
  if (!Number.isFinite(year) || !Number.isFinite(m)) return month;
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, m - 1, 1))
  );
}

export function ProfileExplorer({ userApiKey, onUsage, autoOpen }: ProfileExplorerProps) {
  const [stage, setStage] = useState<Stage>('input');
  const [input, setInput] = useState('');
  const [candidates, setCandidates] = useState<ProfileUser[]>([]);
  const [status, setStatus] = useState<ProfileStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<ProfileFilters>({ orderBy: 'latest' });
  const [results, setResults] = useState<ProfilePhotosResult | null>(null);
  const [photos, setPhotos] = useState<RankedPhoto[]>([]);
  const [page, setPage] = useState(1);
  const [loadingResults, setLoadingResults] = useState(false);

  const [question, setQuestion] = useState('');
  const [askNote, setAskNote] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [enriching, setEnriching] = useState(false);

  const indexAbort = useRef(false);
  const username = status?.user?.username ?? null;

  const fail = useCallback(
    (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Something went wrong.';
      setError(message);
      if (err instanceof ApiError && err.usage) onUsage?.(err.usage);
    },
    [onUsage]
  );

  const startIndexing = useCallback(
    async (user: ProfileUser) => {
      setStage('indexing');
      setError(null);
      indexAbort.current = false;
      try {
        let current = await advanceProfileIndex(user.username);
        setStatus(current);
        while (!indexAbort.current && (!current.indexComplete || !current.clustersReady)) {
          // Each call advances a budgeted slice of Unsplash pages; pause
          // briefly between slices so regular searches stay responsive.
          await new Promise((resolve) => setTimeout(resolve, 800));
          current = await advanceProfileIndex(user.username);
          setStatus(current);
          if (
            !current.indexComplete &&
            current.rate?.remaining !== null &&
            current.rate !== undefined &&
            (current.rate.remaining ?? 0) <= 8
          ) {
            setError(
              'Paused: the Unsplash hourly request budget is nearly used up. Indexing resumes automatically next hour — already-indexed photos are browsable now.'
            );
            break;
          }
        }
        setStage('ready');
      } catch (err) {
        fail(err);
        setStage(status ? 'ready' : 'input');
      }
    },
    [fail, status]
  );

  useEffect(() => () => {
    indexAbort.current = true;
  }, []);

  // Open a profile immediately (e.g. from the sample's "explore live" button).
  useEffect(() => {
    if (!autoOpen) return;
    setInput(autoOpen);
    resolveProfile(autoOpen)
      .then(({ user }) => {
        if (user) startIndexing(user as ProfileUser);
      })
      .catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen]);

  const handleResolve = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const trimmed = input.trim();
      if (!trimmed) return;
      setStage('resolving');
      setError(null);
      setCandidates([]);
      try {
        const { user, candidates: found } = await resolveProfile(trimmed);
        if (user) {
          await startIndexing(user as ProfileUser);
        } else if (found.length > 0) {
          setCandidates(found);
          setStage('candidates');
        } else {
          setError('No Unsplash profile matched that. Try the profile URL, e.g. unsplash.com/@username.');
          setStage('input');
        }
      } catch (err) {
        fail(err);
        setStage('input');
      }
    },
    [input, startIndexing, fail]
  );

  const runQuery = useCallback(
    async (nextFilters: ProfileFilters, nextPage = 1, append = false) => {
      if (!username) return;
      setLoadingResults(true);
      setError(null);
      try {
        const result = await getProfilePhotos(username, { ...nextFilters, page: nextPage });
        setResults(result);
        setPage(nextPage);
        setPhotos((prev) => (append ? [...prev, ...result.photos] : result.photos));
      } catch (err) {
        fail(err);
      } finally {
        setLoadingResults(false);
      }
    },
    [username, fail]
  );

  // Initial + filter-driven fetches once the profile is browsable.
  useEffect(() => {
    if (stage === 'ready' && username) {
      runQuery(filters, 1, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, username, filters]);

  const handleAsk = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const trimmed = question.trim();
      if (!trimmed || !username || asking) return;
      setAsking(true);
      setError(null);
      try {
        const result = await askProfile(username, trimmed, userApiKey);
        if (result.usage) onUsage?.(result.usage);
        setAskNote(result.note || null);
        setFilters((prev) => ({
          ...prev,
          text: result.filters.text,
          topic: result.filters.topic,
          from: result.filters.from,
          to: result.filters.to,
        }));
      } catch (err) {
        fail(err);
      } finally {
        setAsking(false);
      }
    },
    [question, username, asking, userApiKey, onUsage, fail]
  );

  const handleEnrich = useCallback(async () => {
    if (!username || photos.length === 0 || enriching) return;
    setEnriching(true);
    setError(null);
    try {
      await enrichProfile(username, photos.map((photo) => photo.id));
      await runQuery(filters, 1, false);
    } catch (err) {
      fail(err);
    } finally {
      setEnriching(false);
    }
  }, [username, photos, enriching, filters, runQuery, fail]);

  const clearFilters = useCallback(() => {
    setAskNote(null);
    setQuestion('');
    setFilters({ orderBy: 'latest' });
  }, []);

  const facets = results?.facets;
  const activeFilterCount = [filters.text, filters.topic, filters.from, filters.to, filters.location].filter(
    Boolean
  ).length;
  const indexProgress = status && status.totalPhotos > 0 ? Math.round((status.indexedCount / status.totalPhotos) * 100) : 0;

  // ---- Stage: profile input ----
  if (stage === 'input' || stage === 'resolving' || stage === 'candidates') {
    return (
      <div className="w-full">
        <form onSubmit={handleResolve} className="input-zone">
          <label htmlFor="profile-input" className="profile-input-label">
            Photographer profile
          </label>
          <div className="profile-input-row">
            <input
              id="profile-input"
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="unsplash.com/@username, a username, or a photographer's name"
              className="profile-input"
              disabled={stage === 'resolving'}
              spellCheck={false}
            />
            <button type="submit" className="search-btn" disabled={!input.trim() || stage === 'resolving'}>
              <span>{stage === 'resolving' ? 'Finding...' : 'Open profile'}</span>
            </button>
          </div>
          <p className="profile-hint">
            Splashboard indexes the whole portfolio so you can filter 1,000+ photos by topic, date, place, or a
            plain-language question.
          </p>
        </form>

        {stage === 'candidates' && candidates.length > 0 && (
          <div className="candidate-list t-panel-slide" data-open="true" role="listbox" aria-label="Matching profiles">
            {candidates.map((candidate) => (
              <button
                key={candidate.username}
                type="button"
                className="candidate-row"
                onClick={() => startIndexing(candidate)}
              >
                {candidate.profile_image?.medium && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={candidate.profile_image.medium} alt="" className="candidate-avatar" />
                )}
                <span className="candidate-name">{candidate.name}</span>
                <span className="candidate-meta">
                  @{candidate.username} · {candidate.total_photos ?? '?'} photos
                </span>
              </button>
            ))}
          </div>
        )}

        {error && (
          <p className="error-inline mt-3" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  // ---- Stage: indexing / ready ----
  return (
    <div className="w-full">
      {status && (
        <div className="profile-header">
          {status.user.profile_image?.medium && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={status.user.profile_image.medium} alt="" className="candidate-avatar candidate-avatar--lg" />
          )}
          <div className="profile-header__names">
            <p className="profile-header__name">
              {/* Link back to the photographer's Unsplash profile with utm
                  params, per Unsplash API guideline 3. */}
              <a
                href={`${
                  status.user.links?.html ?? `https://unsplash.com/@${status.user.username}`
                }?utm_source=splashboard&utm_medium=referral`}
                target="_blank"
                rel="noopener noreferrer"
                className="profile-header__link"
              >
                {status.user.name}
              </a>
            </p>
            <p className="profile-header__meta">
              @{status.user.username} · {status.totalPhotos} photos
              {status.user.location ? ` · ${status.user.location}` : ''}
            </p>
          </div>
          <button
            type="button"
            className="prompt-chip"
            onClick={() => {
              indexAbort.current = true;
              setStage('input');
              setStatus(null);
              setResults(null);
              setPhotos([]);
              clearFilters();
            }}
          >
            Switch profile
          </button>
        </div>
      )}

      {stage === 'indexing' && status && (
        <div className="index-progress" aria-live="polite">
          <div className="index-progress__bar">
            <div className="index-progress__fill" style={{ width: `${indexProgress}%` }} />
          </div>
          <p className="index-progress__copy">
            <span className="t-shimmer" data-text={`Indexing portfolio... ${status.indexedCount}/${status.totalPhotos}`}>
              Indexing portfolio... {status.indexedCount}/{status.totalPhotos}
            </span>
            {status.indexComplete && !status.clustersReady && ' · building topic map'}
          </p>
        </div>
      )}

      {stage === 'ready' && status && (
        <>
          <form onSubmit={handleAsk} className="ask-row">
            <input
              type="text"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={`Ask this portfolio anything, e.g. "foggy forest shots from winter"`}
              className="profile-input"
              disabled={asking}
            />
            <button type="submit" className="search-btn" disabled={!question.trim() || asking}>
              <span>{asking ? 'Thinking...' : 'Ask'}</span>
            </button>
          </form>
          {askNote && (
            <p className="ask-note" role="status">
              {askNote}{' '}
              <button type="button" className="ask-note__clear" onClick={clearFilters}>
                Clear
              </button>
            </p>
          )}

          {status.clusters.length > 0 && (
            <div className="topic-strip" aria-label="Topic clusters">
              {status.clusters.map((cluster) => (
                <button
                  key={cluster.label}
                  type="button"
                  className={`topic-chip ${filters.topic === cluster.label ? 'topic-chip--active' : ''}`}
                  onClick={() =>
                    setFilters((prev) => ({
                      ...prev,
                      topic: prev.topic === cluster.label ? null : cluster.label,
                    }))
                  }
                >
                  {cluster.label}
                  <span className="topic-chip__count">{cluster.count}</span>
                </button>
              ))}
            </div>
          )}

          <div className="filter-row">
            <input
              type="text"
              value={filters.text ?? ''}
              onChange={(event) => setFilters((prev) => ({ ...prev, text: event.target.value }))}
              placeholder="Filter by keywords"
              className="profile-input profile-input--compact"
              aria-label="Keyword filter"
            />
            <label className="filter-date">
              <span>From</span>
              <input
                type="date"
                value={filters.from ?? ''}
                onChange={(event) => setFilters((prev) => ({ ...prev, from: event.target.value || null }))}
              />
            </label>
            <label className="filter-date">
              <span>To</span>
              <input
                type="date"
                value={filters.to ?? ''}
                onChange={(event) => setFilters((prev) => ({ ...prev, to: event.target.value || null }))}
              />
            </label>
            <select
              value={filters.orderBy ?? 'latest'}
              onChange={(event) => setFilters((prev) => ({ ...prev, orderBy: event.target.value }))}
              className="filter-select"
              aria-label="Sort order"
            >
              {ORDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {activeFilterCount > 0 && (
              <button type="button" className="prompt-chip" onClick={clearFilters}>
                Reset ({activeFilterCount})
              </button>
            )}
          </div>

          {facets && (
            <div className="facet-panel">
              <div className="facet-block">
                <p className="facet-block__title">
                  Places{' '}
                  <span className="facet-block__hint">
                    {facets.enrichedCount}/{facets.totalIndexed} photos location-checked
                  </span>
                </p>
                {facets.topLocations.length > 0 ? (
                  <div className="facet-chips">
                    {facets.topLocations.map((loc) => (
                      <button
                        key={loc.name}
                        type="button"
                        className={`topic-chip ${filters.location === loc.name ? 'topic-chip--active' : ''}`}
                        onClick={() =>
                          setFilters((prev) => ({
                            ...prev,
                            location: prev.location === loc.name ? null : loc.name,
                          }))
                        }
                      >
                        {loc.name}
                        <span className="topic-chip__count">{loc.count}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="facet-block__empty">
                    No location data fetched yet. Locations come from per-photo lookups.
                  </p>
                )}
                <button
                  type="button"
                  className="prompt-chip"
                  onClick={handleEnrich}
                  disabled={enriching || photos.length === 0}
                >
                  {enriching ? 'Checking locations...' : 'Fetch locations + EXIF for these results'}
                </button>
              </div>

              {facets.dateHistogram.length > 1 && (
                <div className="facet-block">
                  <p className="facet-block__title">Activity</p>
                  <div className="date-histogram" aria-hidden="true">
                    {facets.dateHistogram.map((bucket) => {
                      const max = Math.max(...facets.dateHistogram.map((b) => b.count));
                      return (
                        <div
                          key={bucket.month}
                          className="date-histogram__bar"
                          style={{ height: `${Math.max(8, (bucket.count / max) * 100)}%` }}
                          title={`${formatMonthLabel(bucket.month)}: ${bucket.count}`}
                        />
                      );
                    })}
                  </div>
                  <p className="facet-block__hint">
                    {formatMonthLabel(facets.dateHistogram[0].month)} to{' '}
                    {formatMonthLabel(facets.dateHistogram[facets.dateHistogram.length - 1].month)}
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="profile-results">
            <p className="results-header__count">
              {loadingResults
                ? 'Filtering...'
                : `${results?.totalMatches ?? 0} match${(results?.totalMatches ?? 0) === 1 ? '' : 'es'}`}
            </p>
            {photos.length > 0 ? (
              <div className="moodboard-canvas">
                {photos.map((photo, i) => (
                  <PhotoCard key={photo.id} photo={photo} index={i} variant="mood" showExif={false} />
                ))}
              </div>
            ) : (
              !loadingResults && <p className="empty-state">No photos match these filters.</p>
            )}
            {results && photos.length < results.totalMatches && (
              <button
                type="button"
                className="search-btn profile-load-more"
                onClick={() => runQuery(filters, page + 1, true)}
                disabled={loadingResults}
              >
                <span>{loadingResults ? 'Loading...' : 'Load more'}</span>
              </button>
            )}
          </div>
        </>
      )}

      {error && (
        <p className="error-inline mt-3" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
