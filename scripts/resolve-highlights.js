// Resolves finished games to official NFL highlight video IDs via the
// YouTube Data API (free tier: 10k units/day; one search = 100 units; we do
// at most 16/week because results are cached in highlights.json).
// Runs in the recorder workflow; without YOUTUBE_API_KEY it exits quietly and
// the app falls back to spoiler-safe search links.
//
// Usage: node scripts/resolve-highlights.js <dataDir>

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getNflState, getScoreboard } from '../js/api.js';
import { highlightQuery } from '../js/youtube.js';
import { isRollover } from '../js/snapshots.js';

const NFL_CHANNEL_ID = 'UCDVYQ4Zhbm3S2dlz7P1GBDg'; // official NFL channel

const dataDir = process.argv[2];
const key = process.env.YOUTUBE_API_KEY;
if (!dataDir) { console.error('usage: node scripts/resolve-highlights.js <dataDir>'); process.exit(1); }
if (!key) { console.log('YOUTUBE_API_KEY not set; skipping (app uses search links)'); process.exit(0); }

const state = await getNflState();
let season = Number(process.env.FORCE_SEASON || state.season);
let week = Number(process.env.FORCE_WEEK || state.week);
if (!process.env.FORCE_WEEK && state.season_type !== 'regular' && state.season_type !== 'post') {
  console.log('off-season; skipping');
  process.exit(0);
}
week = Math.min(Math.max(week || 1, 1), 18);

await mkdir(dataDir, { recursive: true });
const file = join(dataDir, 'highlights.json');
let stored = null;
try { stored = JSON.parse(await readFile(file, 'utf8')); } catch { /* new file */ }
if (isRollover(stored, season, week)) stored = { season, week, videos: {} };

const games = await getScoreboard(season, week);
const pending = games.filter((g) => g.state === 'post' && !stored.videos[g.gameKey]);
console.log(`${pending.length} finished games without a resolved highlight`);

for (const g of pending) {
  const q = highlightQuery({ away: g.away, home: g.home, week, season });
  const url = 'https://www.googleapis.com/youtube/v3/search?' + new URLSearchParams({
    key, q, channelId: NFL_CHANNEL_ID, part: 'snippet', type: 'video', maxResults: '1',
  });
  const res = await fetch(url);
  if (!res.ok) { console.warn(`YouTube API ${res.status} for ${g.gameKey}; stopping`); break; }
  const body = await res.json();
  const id = body.items?.[0]?.id?.videoId;
  if (id) {
    stored.videos[g.gameKey] = id;
    console.log(`${g.gameKey} -> ${id}`);
  } else {
    console.log(`${g.gameKey}: no result yet (highlight may not be uploaded)`);
  }
}

await writeFile(file, JSON.stringify(stored));
console.log(`highlights.json: ${Object.keys(stored.videos).length} videos for week ${week}`);
