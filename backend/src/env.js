import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The backend previously relied on backend/.env existing but nothing ever
// loaded it (no dotenv, no --env-file), so GEMINI_API_KEY was always empty
// on local runs. This loader reads the repo root .env plus backend/.env
// without adding a dependency. Existing process.env values always win.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILES = [
  path.resolve(HERE, '../../.env'), // repo root
  path.resolve(HERE, '../../.env.local'),
  path.resolve(HERE, '../.env'), // backend/.env
];

export function loadEnv() {
  for (const file of ENV_FILES) {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      // Strip inline comments (`value  # comment`) and surrounding quotes.
      const hash = value.search(/\s#/);
      if (hash >= 0) value = value.slice(0, hash).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
}
