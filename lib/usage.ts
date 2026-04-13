import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { NextRequest } from 'next/server';
import type { UsageSummary } from '@/types';

const DEFAULT_MONTHLY_LIMIT = 15;
const STORE_FILE = process.env.USAGE_STORE_FILE ?? '.context/usage-state.json';
const FINGERPRINT_SALT = process.env.USAGE_FINGERPRINT_SALT ?? 'splashboard-rate-limit-v1';

type UsageStore = Record<string, Record<string, number>>;

let storeQueue = Promise.resolve();

function getMonthlyLimit(): number {
  const parsed = Number.parseInt(process.env.MONTHLY_ACTION_LIMIT ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MONTHLY_LIMIT;
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
  const forwardedFor = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  const ip = forwardedFor?.split(',')[0]?.trim() || realIp?.trim() || 'unknown-ip';
  const userAgent = request.headers.get('user-agent') ?? 'unknown-user-agent';
  const acceptLanguage = request.headers.get('accept-language') ?? 'unknown-language';
  const secChUa = request.headers.get('sec-ch-ua') ?? 'unknown-client-hints';

  const stableIdentity = `${FINGERPRINT_SALT}|${ip}|${userAgent}|${acceptLanguage}|${secChUa}`;
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

async function readStore(): Promise<UsageStore> {
  await ensureStoreFileExists();
  const raw = await readFile(/* turbopackIgnore: true */ STORE_FILE, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as UsageStore;
    }
  } catch {
    // fall through
  }

  return {};
}

async function writeStore(store: UsageStore): Promise<void> {
  await writeFile(/* turbopackIgnore: true */ STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
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

  return withStoreLock(async () => {
    const store = await readStore();
    const used = store[identity]?.[monthKey] ?? 0;
    return toUsageSummary(used, limit, monthKey);
  });
}

export async function consumeMonthlyAction(
  request: NextRequest
): Promise<{ allowed: boolean; usage: UsageSummary }> {
  const identity = getRequestIdentity(request);
  const limit = getMonthlyLimit();
  const monthKey = getMonthKey();

  return withStoreLock(async () => {
    const store = await readStore();
    const monthlyUsage = store[identity] ?? {};
    const used = monthlyUsage[monthKey] ?? 0;

    if (used >= limit) {
      return {
        allowed: false,
        usage: toUsageSummary(used, limit, monthKey),
      };
    }

    const nextUsed = used + 1;
    monthlyUsage[monthKey] = nextUsed;
    store[identity] = pruneMonths(monthlyUsage, monthKey);
    await writeStore(store);

    return {
      allowed: true,
      usage: toUsageSummary(nextUsed, limit, monthKey),
    };
  });
}
