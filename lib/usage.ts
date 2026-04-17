import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { NextRequest } from 'next/server';
import type { UsageSummary } from '@/types';

const DEFAULT_MONTHLY_LIMIT = 4;
const STORE_FILE = process.env.USAGE_STORE_FILE ?? '.context/usage-state.json';
const FINGERPRINT_SALT = process.env.USAGE_FINGERPRINT_SALT ?? 'splashboard-rate-limit-v1';
const DEFAULT_BURST_WINDOW_SECONDS = 60;
const DEFAULT_BURST_LIMIT = 8;

interface UsageRecord {
  monthly: Record<string, number>;
  recent: number[];
}

type UsageStore = Record<string, UsageRecord>;
type RawUsageStore = Record<string, unknown>;

let storeQueue = Promise.resolve();

function getMonthlyLimit(): number {
  const parsed = Number.parseInt(process.env.MONTHLY_ACTION_LIMIT ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MONTHLY_LIMIT;
  }

  return parsed;
}

function getBurstWindowMs(): number {
  const parsed = Number.parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS ?? '', 10);
  const seconds = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BURST_WINDOW_SECONDS;
  return seconds * 1000;
}

function getBurstLimit(): number {
  const parsed = Number.parseInt(process.env.RATE_LIMIT_MAX_REQUESTS ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_BURST_LIMIT;
  }
  return parsed;
}

function getMonthKey(date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function getPreviousMonthKey(currentMonth: string): string {
  const [yearRaw, monthRaw] = currentMonth.split('-');
  const year = Number.parseInt(yearRaw, 10);
  const month = Number.parseInt(monthRaw, 10);

  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return currentMonth;
  }

  const previous = new Date(Date.UTC(year, month - 2, 1));
  return getMonthKey(previous);
}

function toUsageSummary(
  used: number,
  limit: number,
  month: string,
  usingOwnApiKey = false
): UsageSummary {
  return {
    month,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    isLimited: used >= limit,
    usingOwnApiKey,
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function getRequestIdentity(request: NextRequest): string {
  // IP-based identity prevents per-browser evasion on the same device/network.
  const forwardedFor = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  const vercelForwardedFor = request.headers.get('x-vercel-forwarded-for');
  const ip =
    forwardedFor?.split(',')[0]?.trim() ||
    realIp?.trim() ||
    vercelForwardedFor?.split(',')[0]?.trim() ||
    'unknown-ip';

  const stableIdentity = `${FINGERPRINT_SALT}|${ip}`;
  return sha256(stableIdentity).slice(0, 40);
}

async function ensureStoreFileExists(): Promise<void> {
  await mkdir(path.dirname(/* turbopackIgnore: true */ STORE_FILE), { recursive: true });
  try {
    await readFile(/* turbopackIgnore: true */ STORE_FILE, 'utf8');
  } catch {
    await writeFile(/* turbopackIgnore: true */ STORE_FILE, '{}', 'utf8');
  }
}

function normalizeMonthlyUsage(
  raw: unknown,
  currentMonth: string
): Record<string, number> {
  const monthlyUsage: Record<string, number> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return monthlyUsage;
  }

  for (const [month, count] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) continue;
    monthlyUsage[month] = Math.floor(count);
  }

  return pruneMonths(monthlyUsage, currentMonth);
}

function pruneRecentRequests(recent: number[], now: number, windowMs: number): number[] {
  const minTime = now - windowMs;
  return recent.filter((timestamp) => Number.isFinite(timestamp) && timestamp >= minTime);
}

function normalizeUsageRecord(
  rawRecord: unknown,
  currentMonth: string,
  now: number,
  windowMs: number
): UsageRecord {
  if (!rawRecord || typeof rawRecord !== 'object' || Array.isArray(rawRecord)) {
    return { monthly: {}, recent: [] };
  }

  const maybeRecord = rawRecord as Partial<UsageRecord> & Record<string, unknown>;
  const legacyMonthly = normalizeMonthlyUsage(rawRecord, currentMonth);
  const monthly = maybeRecord.monthly
    ? normalizeMonthlyUsage(maybeRecord.monthly, currentMonth)
    : legacyMonthly;
  const recentRaw = Array.isArray(maybeRecord.recent) ? maybeRecord.recent : [];
  const recent = pruneRecentRequests(
    recentRaw.filter((value): value is number => typeof value === 'number'),
    now,
    windowMs
  );

  return { monthly, recent };
}

function compactStore(store: UsageStore): UsageStore {
  return Object.fromEntries(
    Object.entries(store).filter(([, record]) => {
      const hasMonthly = Object.keys(record.monthly).length > 0;
      const hasRecent = record.recent.length > 0;
      return hasMonthly || hasRecent;
    })
  );
}

function normalizeStore(
  rawStore: RawUsageStore,
  currentMonth: string,
  now: number,
  windowMs: number
): UsageStore {
  const normalized: UsageStore = {};
  for (const [identity, rawRecord] of Object.entries(rawStore)) {
    normalized[identity] = normalizeUsageRecord(rawRecord, currentMonth, now, windowMs);
  }
  return normalized;
}

async function readStore(): Promise<RawUsageStore> {
  await ensureStoreFileExists();
  const raw = await readFile(/* turbopackIgnore: true */ STORE_FILE, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as RawUsageStore;
    }
  } catch {
    // fall through
  }

  return {};
}

async function writeStore(store: UsageStore): Promise<void> {
  await writeFile(
    /* turbopackIgnore: true */ STORE_FILE,
    JSON.stringify(compactStore(store), null, 2),
    'utf8'
  );
}

function pruneMonths(monthlyUsage: Record<string, number>, currentMonth: string): Record<string, number> {
  const previousMonth = getPreviousMonthKey(currentMonth);
  const pruned: Record<string, number> = {};

  if (typeof monthlyUsage[currentMonth] === 'number') {
    pruned[currentMonth] = monthlyUsage[currentMonth];
  }
  if (typeof monthlyUsage[previousMonth] === 'number') {
    pruned[previousMonth] = monthlyUsage[previousMonth];
  }

  return pruned;
}

function withStoreLock<T>(work: () => Promise<T>): Promise<T> {
  const run = storeQueue.then(work, work);
  storeQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export async function getUsageSummary(request: NextRequest): Promise<UsageSummary> {
  const identity = getRequestIdentity(request);
  const limit = getMonthlyLimit();
  const monthKey = getMonthKey();
  const now = Date.now();
  const windowMs = getBurstWindowMs();

  return withStoreLock(async () => {
    const rawStore = await readStore();
    const normalizedStore = normalizeStore(rawStore, monthKey, now, windowMs);
    const usageRecord = normalizeUsageRecord(normalizedStore[identity], monthKey, now, windowMs);
    normalizedStore[identity] = usageRecord;
    await writeStore(normalizedStore);
    const used = usageRecord.monthly[monthKey] ?? 0;
    return toUsageSummary(used, limit, monthKey);
  });
}

export async function consumeMonthlyAction(
  request: NextRequest
): Promise<{ allowed: boolean; usage: UsageSummary }> {
  const identity = getRequestIdentity(request);
  const limit = getMonthlyLimit();
  const monthKey = getMonthKey();
  const now = Date.now();
  const windowMs = getBurstWindowMs();

  return withStoreLock(async () => {
    const rawStore = await readStore();
    const normalizedStore = normalizeStore(rawStore, monthKey, now, windowMs);
    const usageRecord = normalizeUsageRecord(normalizedStore[identity], monthKey, now, windowMs);
    const used = usageRecord.monthly[monthKey] ?? 0;

    if (used >= limit) {
      normalizedStore[identity] = usageRecord;
      await writeStore(normalizedStore);
      return {
        allowed: false,
        usage: toUsageSummary(used, limit, monthKey),
      };
    }

    const nextUsed = used + 1;
    usageRecord.monthly[monthKey] = nextUsed;
    usageRecord.monthly = pruneMonths(usageRecord.monthly, monthKey);
    normalizedStore[identity] = usageRecord;
    await writeStore(normalizedStore);

    return {
      allowed: true,
      usage: toUsageSummary(nextUsed, limit, monthKey),
    };
  });
}

export async function consumeBurstRequest(
  request: NextRequest
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const identity = getRequestIdentity(request);
  const monthKey = getMonthKey();
  const now = Date.now();
  const windowMs = getBurstWindowMs();
  const burstLimit = getBurstLimit();

  return withStoreLock(async () => {
    const rawStore = await readStore();
    const normalizedStore = normalizeStore(rawStore, monthKey, now, windowMs);
    const usageRecord = normalizeUsageRecord(normalizedStore[identity], monthKey, now, windowMs);

    if (usageRecord.recent.length >= burstLimit) {
      normalizedStore[identity] = usageRecord;
      await writeStore(normalizedStore);
      const oldestRequest = usageRecord.recent[0] ?? now;
      const retryAfterMs = Math.max(0, oldestRequest + windowMs - now);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      };
    }

    usageRecord.recent.push(now);
    normalizedStore[identity] = usageRecord;
    await writeStore(normalizedStore);
    return {
      allowed: true,
      retryAfterSeconds: 0,
    };
  });
}
