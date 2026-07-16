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
  return read(CONFIG_KEY, {
    username: '', userId: null, leagueId: null,
    season: null, week: null,
    mode: 'live', delayMinutes: 60,
    watched: {}, // {"<leagueId>:<week>": {gameKey: true}}
  });
}
export function saveConfig(config) { write(CONFIG_KEY, config); }

export function watchedFor(config, leagueId, week) {
  return config.watched[`${leagueId}:${week}`] || {};
}
export function setWatched(config, leagueId, week, gameKey, isWatched) {
  const key = `${leagueId}:${week}`;
  const set = { ...(config.watched[key] || {}) };
  if (isWatched) set[gameKey] = true; else delete set[gameKey];
  config.watched[key] = set;
  saveConfig(config);
}

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
