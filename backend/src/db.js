import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR?.trim() || path.resolve(HERE, '../data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'splashboard.db'));

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS profiles (
    username TEXT PRIMARY KEY,
    user_json TEXT NOT NULL,
    total_photos INTEGER NOT NULL DEFAULT 0,
    indexed_count INTEGER NOT NULL DEFAULT 0,
    next_page INTEGER NOT NULL DEFAULT 1,
    index_complete INTEGER NOT NULL DEFAULT 0,
    clusters_json TEXT,
    indexed_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    json TEXT NOT NULL,
    detail_json TEXT,
    description TEXT,
    created_at TEXT,
    likes INTEGER DEFAULT 0,
    topics_json TEXT,
    location_name TEXT,
    fetched_at INTEGER NOT NULL,
    detail_fetched_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_photos_username ON photos(username);
  CREATE INDEX IF NOT EXISTS idx_photos_created ON photos(username, created_at);

  CREATE TABLE IF NOT EXISTS detail_cache (
    id TEXT PRIMARY KEY,
    json TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );
`);

export function upsertProfile(username, userJson, totalPhotos) {
  db.prepare(
    `INSERT INTO profiles (username, user_json, total_photos, indexed_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET user_json = excluded.user_json, total_photos = excluded.total_photos`
  ).run(username, JSON.stringify(userJson), totalPhotos, Date.now());
}

export function getProfile(username) {
  const row = db.prepare('SELECT * FROM profiles WHERE username = ?').get(username);
  if (!row) return null;
  return {
    username: row.username,
    user: JSON.parse(row.user_json),
    totalPhotos: row.total_photos,
    indexedCount: row.indexed_count,
    nextPage: row.next_page,
    indexComplete: Boolean(row.index_complete),
    clusters: row.clusters_json ? JSON.parse(row.clusters_json) : null,
    indexedAt: row.indexed_at,
  };
}

export function updateProfileProgress(username, { indexedCount, nextPage, indexComplete }) {
  db.prepare(
    'UPDATE profiles SET indexed_count = ?, next_page = ?, index_complete = ?, indexed_at = ? WHERE username = ?'
  ).run(indexedCount, nextPage, indexComplete ? 1 : 0, Date.now(), username);
}

export function saveProfileClusters(username, clusters) {
  db.prepare('UPDATE profiles SET clusters_json = ? WHERE username = ?').run(
    JSON.stringify(clusters),
    username
  );
}

export function insertProfilePhotos(username, photos) {
  const stmt = db.prepare(
    `INSERT INTO photos (id, username, json, description, created_at, likes, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET json = excluded.json, description = excluded.description,
       created_at = excluded.created_at, likes = excluded.likes, fetched_at = excluded.fetched_at`
  );
  for (const photo of photos) {
    const description = [photo.description, photo.alt_description]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    stmt.run(
      photo.id,
      username,
      JSON.stringify(photo),
      description,
      photo.created_at ?? null,
      photo.likes ?? 0,
      Date.now()
    );
  }
}

export function getProfilePhotos(username) {
  return db
    .prepare('SELECT * FROM photos WHERE username = ? ORDER BY created_at DESC')
    .all(username);
}

export function setPhotoTopics(id, topics) {
  db.prepare('UPDATE photos SET topics_json = ? WHERE id = ?').run(JSON.stringify(topics), id);
}

export function savePhotoDetail(id, detail) {
  const locationName = detail?.location
    ? [detail.location.city, detail.location.country].filter(Boolean).join(', ') || detail.location.name || null
    : null;
  db.prepare(
    'UPDATE photos SET detail_json = ?, location_name = ?, detail_fetched_at = ? WHERE id = ?'
  ).run(JSON.stringify(detail), locationName, Date.now(), id);
  db.prepare(
    `INSERT INTO detail_cache (id, json, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at`
  ).run(id, JSON.stringify(detail), Date.now());
}

export function getCachedDetail(id, maxAgeMs) {
  const row = db.prepare('SELECT json, fetched_at FROM detail_cache WHERE id = ?').get(id);
  if (!row) return null;
  if (maxAgeMs && Date.now() - row.fetched_at > maxAgeMs) return null;
  return JSON.parse(row.json);
}

// ---- Cache retention ----
//
// Everything this backend stores is a cache of Unsplash-owned metadata, kept
// only to avoid re-fetching the same pages. Nothing here is a source of
// truth, so it gets an expiry rather than living forever.

export function deleteProfileCache(username) {
  db.prepare('DELETE FROM photos WHERE username = ?').run(username);
  db.prepare('DELETE FROM profiles WHERE username = ?').run(username);
}

export function purgeExpiredCache({ profileMaxAgeMs, detailMaxAgeMs }) {
  const now = Date.now();

  const staleProfiles = db
    .prepare('SELECT username FROM profiles WHERE indexed_at IS NULL OR indexed_at < ?')
    .all(now - profileMaxAgeMs);
  for (const row of staleProfiles) {
    deleteProfileCache(row.username);
  }

  // Photos whose profile row is already gone (e.g. an interrupted purge).
  const orphans = db
    .prepare('DELETE FROM photos WHERE username NOT IN (SELECT username FROM profiles)')
    .run();

  const details = db
    .prepare('DELETE FROM detail_cache WHERE fetched_at < ?')
    .run(now - detailMaxAgeMs);

  return {
    profiles: staleProfiles.length,
    orphanPhotos: Number(orphans.changes ?? 0),
    details: Number(details.changes ?? 0),
  };
}

// ---- Monthly usage quotas (per client key + global backstop) ----

db.exec(`
  CREATE TABLE IF NOT EXISTS usage_quota (
    month TEXT NOT NULL,
    client_key TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (month, client_key)
  );
`);

export function getUsage(month, clientKey) {
  const row = db
    .prepare('SELECT used FROM usage_quota WHERE month = ? AND client_key = ?')
    .get(month, clientKey);
  return row?.used ?? 0;
}

export function incrementUsage(month, clientKey) {
  db.prepare(
    `INSERT INTO usage_quota (month, client_key, used) VALUES (?, ?, 1)
     ON CONFLICT(month, client_key) DO UPDATE SET used = used + 1`
  ).run(month, clientKey);
}
