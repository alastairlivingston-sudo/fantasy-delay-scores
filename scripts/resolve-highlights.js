// Resolves finished games to official NFL highlight video IDs via the
// YouTube Data API (free tier: 10k units/day; one search = 100 units + one
// videos.list = 1 unit per candidate; at most 16 games/week, cached in
// highlights.json). A hit is only kept if it passes isFullHighlightVideo
// (duration + title checks) — the app never falls back to a raw YouTube
// search, since that results page can itself show a score.
// Runs in the recorder workflow; without YOUTUBE_API_KEY it exits quietly.
//
// Usage: node scripts/resolve-highlights.js <dataDir>

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getNflState, getScoreboard } from '../js/api.js';
import { highlightQuery, isFullHighlightVideo } from '../js/youtube.js';

const NFL_CHANNEL_ID = 'UCDVYQ4Zhbm3S2dlz7P1GBDg'; // official NFL channel

const dataDir = process.argv[2];
const key = process.env.YOUTUBE_API_KEY;
if (!dataDir) { console.error('usage: node scripts/resolve-highlights.js <dataDir>'); process.exit(1); }
if (!key) { console.log('YOUTUBE_API_KEY not set; skipping (no highlights will resolve)'); process.exit(0); }

const state = await getNflState();
let season = Number(process.env.FORCE_SEASON || state.season);
let week = Number(process.env.FORCE_WEEK || state.week);
if (!process.env.FORCE_WEEK && state.season_type !== 'regular' && state.season_type !== 'post') {
  console.log('off-season; skipping');
  process.exit(0);
}
week = Math.min(Math.max(week || 1, 1), 18);

await mkdir(dataDir, { recursive: true });
// One persistent file per week (highlights-<season>-<week>.json). Unlike the
// snapshot files, these are NEVER cleared on rollover — a resolved highlight is
// permanent, so browsing a past season still shows real links.
const file = join(dataDir, `highlights-${season}-${week}.json`);
let stored = null;
try { stored = JSON.parse(await readFile(file, 'utf8')); } catch { /* new file */ }
if (!stored || stored.season !== season || stored.week !== week) {
  stored = { season, week, videos: {} };
}

const games = await getScoreboard(season, week);
const pending = games.filter((g) => g.state === 'post' && !stored.videos[g.gameKey]);
console.log(`${pending.length} finished games without a resolved highlight`);

for (const g of pending) {
  const q = highlightQuery({ away: g.away, home: g.home, week, season });
  const searchUrl = 'https://www.googleapis.com/youtube/v3/search?' + new URLSearchParams({
    key, q, channelId: NFL_CHANNEL_ID, part: 'snippet', type: 'video', maxResults: '1',
  });
  const searchRes = await fetch(searchUrl);
  if (!searchRes.ok) { console.warn(`YouTube API ${searchRes.status} for ${g.gameKey}; stopping`); break; }
  const searchBody = await searchRes.json();
  const id = searchBody.items?.[0]?.id?.videoId;
  if (!id) { console.log(`${g.gameKey}: no result yet (highlight may not be uploaded)`); continue; }

  const detailUrl = 'https://www.googleapis.com/youtube/v3/videos?' + new URLSearchParams({
    key, id, part: 'snippet,contentDetails',
  });
  const detailRes = await fetch(detailUrl);
  if (!detailRes.ok) { console.warn(`YouTube API ${detailRes.status} for ${g.gameKey} details; stopping`); break; }
  const detail = (await detailRes.json()).items?.[0];
  const title = detail?.snippet?.title;
  const durationIso = detail?.contentDetails?.duration;
  if (detail && isFullHighlightVideo({ title, durationIso })) {
    stored.videos[g.gameKey] = { id, publishedAt: detail.snippet.publishedAt };
    console.log(`${g.gameKey} -> ${id} ("${title}")`);
  } else {
    console.log(`${g.gameKey}: top result "${title}" (${durationIso}) failed validation; not saving`);
  }
}

stored.checkedAt = Date.now();
await writeFile(file, JSON.stringify(stored));
console.log(`highlights.json: ${Object.keys(stored.videos).length} videos for week ${week}`);
