// localStorage persistence: config, watched-game sets, delay snapshots.

const CONFIG_KEY = 'sss:config';
const SNAP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SNAP_MAX_COUNT = 1440;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* full/blocked */ }
}

export function loadConfig() {
  const config = read(CONFIG_KEY, {
    username: 'AlastairL', userId: null, leagueId: null,
    season: null, week: null,
    mode: 'watched', delayMinutes: 2, modeConfirmed: false,
    defaultLeagueId: null, defaultSeason: null, defaultWeek: null,
    defaultMode: null, defaultDelayMinutes: null,
    // [{id, name, season, teams}] — the account's leagues, cached so the menu's
    // league dropdown is populated before any network call comes back.
    leagues: [],
    watched: {}, // {"<leagueId>:<week>": {gameKey: true}}
  });
  // Live mode was removed; anyone with it stored falls back to watched.
  if (config.mode === 'live') config.mode = 'watched';
  return config;
}
export function saveConfig(config) { write(CONFIG_KEY, config); }

/* --- watched games ---
 * Keyed by SEASON+WEEK, not by league: "I watched SF @ LAR" is a fact about
 * you, not about one of your leagues, so ticking it once counts everywhere.
 * (Season is part of the key because week 1 of 2025 and of 2026 are different
 * games — the old per-league key had no season in it and would have collided
 * when browsing a past season.)
 */

const watchedKey = (season, week) => `${season}:${week}`;
const legacyWatchedKey = (leagueId, week) => `${leagueId}:${week}`;

export function watchedFor(config, season, week) {
  return config.watched[watchedKey(season, week)] || {};
}

export function setWatched(config, season, week, gameKey, isWatched) {
  const key = watchedKey(season, week);
  const set = { ...(config.watched[key] || {}) };
  if (isWatched) set[gameKey] = true; else delete set[gameKey];
  config.watched[key] = set;
  saveConfig(config);
}

/**
 * Fold a pre-existing per-league tick set into the shared season+week one, so
 * upgrading doesn't silently drop ticks the viewer already made. Idempotent:
 * the legacy entry is removed once merged. Returns true if anything moved.
 */
export function adoptLegacyWatched(config, season, week, leagueId) {
  const legacy = config.watched[legacyWatchedKey(leagueId, week)];
  if (!legacy || !Object.keys(legacy).length) return false;
  const key = watchedKey(season, week);
  config.watched[key] = { ...legacy, ...(config.watched[key] || {}) };
  delete config.watched[legacyWatchedKey(leagueId, week)];
  saveConfig(config);
  return true;
}

/* --- manual-refresh allowance (see js/quota.js for the week maths) --- */

const REFRESH_KEY = 'sss:refresh-quota';

export function loadRefreshQuota() { return read(REFRESH_KEY, null); }
export function saveRefreshQuota(quota) { write(REFRESH_KEY, quota); }

const snapKey = (leagueId, week) => `sss:snap:${leagueId}:${week}`;

export function loadSnapshots(leagueId, week) {
  return read(snapKey(leagueId, week), []);
}

export function appendSnapshot(leagueId, week, snapshot) {
  const cutoff = Date.now() - SNAP_MAX_AGE_MS;
  const snaps = loadSnapshots(leagueId, week).filter((s) => s.t >= cutoff);
  snaps.push(snapshot);
  write(snapKey(leagueId, week), snaps.slice(-SNAP_MAX_COUNT));
  return snaps;
}
