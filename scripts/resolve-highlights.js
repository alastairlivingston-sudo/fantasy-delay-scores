// Resolves finished games to official NFL highlight video IDs via the
// YouTube Data API (free tier: 10k units/day; one search = 100 units + one
// videos.list = 1 unit per candidate). A hit is only kept if it passes
// isFullHighlightVideo (duration + title checks) — the app never falls back to
// a raw YouTube search, since that results page can itself show a score.
//
// Run hourly all season by highlights.yml, and opportunistically by the two
// recorder workflows. Without YOUTUBE_API_KEY it exits quietly.
//
// The official upload lands hours AFTER the final whistle, so most runs find
// nothing and have to come back later. Two things keep that inside the free
// quota: a per-game backoff that eventually gives up (js/youtube.js's
// shouldSearchAgain), and a per-run search budget.
//
// Usage: node scripts/resolve-highlights.js <dataDir>
// Env:   YOUTUBE_API_KEY          required; without it this is a no-op
//        FORCE_SEASON/FORCE_WEEK  resolve a specific week (backfill, testing)
//        HIGHLIGHT_WEEKS_BACK     also resolve the N weeks before it (default 1,
//                                 so a Monday-night game still resolves after
//                                 Sleeper's week has rolled over)
//        HIGHLIGHT_SEARCH_BUDGET  max YouTube searches this run (default 25)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getNflState, getScoreboard } from '../js/api.js';
import { highlightQuery, isFullHighlightVideo, shouldSearchAgain } from '../js/youtube.js';

const NFL_CHANNEL_ID = 'UCDVYQ4Zhbm3S2dlz7P1GBDg'; // official NFL channel

const dataDir = process.argv[2];
const key = process.env.YOUTUBE_API_KEY;
if (!dataDir) { console.error('usage: node scripts/resolve-highlights.js <dataDir>'); process.exit(1); }
if (!key) { console.log('YOUTUBE_API_KEY not set; skipping (no highlights will resolve)'); process.exit(0); }

const state = await getNflState();
const season = Number(process.env.FORCE_SEASON || state.season);
let week = Number(process.env.FORCE_WEEK || state.week);
if (!process.env.FORCE_WEEK && state.season_type !== 'regular' && state.season_type !== 'post') {
  console.log('off-season; skipping');
  process.exit(0);
}
week = clampWeek(week);

const weeksBack = Number(process.env.HIGHLIGHT_WEEKS_BACK ?? 1);
const weeks = [...new Set(
  Array.from({ length: weeksBack + 1 }, (_, i) => week - i).filter((w) => w >= 1),
)];

// Shared across weeks: one bad week must not spend the whole run's quota.
let searchesLeft = Number(process.env.HIGHLIGHT_SEARCH_BUDGET || 25);
let apiDown = false; // a non-OK YouTube response stops the run (quota/outage)

await mkdir(dataDir, { recursive: true });
// One week failing (an ESPN blip, a week with no scoreboard) must not throw
// away another week's resolved links — the caller's next step pushes whatever
// did get written. A run where EVERY week failed has nothing to push and
// should go red, so it's visible rather than silently doing nothing.
let failures = 0;
for (const w of weeks) {
  if (apiDown) break;
  try {
    await resolveWeek(w);
  } catch (err) {
    failures++;
    console.warn(`week ${w} failed: ${err.message}`);
  }
}
if (failures === weeks.length) {
  console.error('every week failed; nothing resolved');
  process.exit(1);
}

async function resolveWeek(w) {
  // One persistent file per week (highlights-<season>-<week>.json). Unlike the
  // snapshot files, these are NEVER cleared on rollover — a resolved highlight
  // is permanent, so browsing a past season still shows real links.
  const file = join(dataDir, `highlights-${season}-${w}.json`);
  let stored = null;
  try { stored = JSON.parse(await readFile(file, 'utf8')); } catch { /* new file */ }
  if (!stored || stored.season !== season || stored.week !== w) {
    stored = { season, week: w, videos: {} };
  }
  // {gameKey: {attempts, lastTriedAt}} for finished games still without a
  // usable upload — the backoff state behind shouldSearchAgain.
  stored.pending ||= {};

  const games = await getScoreboard(season, w);
  const unresolved = games.filter((g) => g.state === 'post' && !stored.videos[g.gameKey]);
  const due = unresolved.filter((g) => shouldSearchAgain(stored.pending[g.gameKey]));
  console.log(`week ${w}: ${unresolved.length} finished games without a highlight, ${due.length} due a search`);

  for (const g of due) {
    if (searchesLeft <= 0) { console.log('search budget spent; stopping'); break; }
    searchesLeft--;
    const attempt = stored.pending[g.gameKey] || { attempts: 0, lastTriedAt: 0 };
    attempt.attempts++;
    attempt.lastTriedAt = Date.now();
    stored.pending[g.gameKey] = attempt;

    const video = await findHighlight(g, w);
    if (video === null) { apiDown = true; break; } // API said no — stop, retry next run
    if (video) {
      stored.videos[g.gameKey] = video;
      delete stored.pending[g.gameKey];
    }
  }

  // Written even when nothing resolved: checkedAt is what the app shows as
  // "highlights last checked", and it's how you tell a stalled recorder from a
  // week whose uploads simply aren't out yet.
  stored.checkedAt = Date.now();
  await writeFile(file, JSON.stringify(stored));
  console.log(`highlights-${season}-${w}.json: ${Object.keys(stored.videos).length} videos`);
}

/**
 * The validated official highlight for one game, or `undefined` when there
 * isn't one yet, or `null` when the YouTube API itself failed (quota, outage)
 * and the run should stop rather than burn attempts on a dead endpoint.
 */
async function findHighlight(g, w) {
  const searchUrl = 'https://www.googleapis.com/youtube/v3/search?' + new URLSearchParams({
    key, q: highlightQuery({ away: g.away, home: g.home, week: w, season }),
    channelId: NFL_CHANNEL_ID, part: 'snippet', type: 'video', maxResults: '1',
  });
  const searchRes = await fetch(searchUrl);
  if (!searchRes.ok) { console.warn(`YouTube API ${searchRes.status} for ${g.gameKey}; stopping`); return null; }
  const id = (await searchRes.json()).items?.[0]?.id?.videoId;
  if (!id) { console.log(`${g.gameKey}: no result yet (highlight may not be uploaded)`); return undefined; }

  const detailUrl = 'https://www.googleapis.com/youtube/v3/videos?' + new URLSearchParams({
    key, id, part: 'snippet,contentDetails',
  });
  const detailRes = await fetch(detailUrl);
  if (!detailRes.ok) { console.warn(`YouTube API ${detailRes.status} for ${g.gameKey} details; stopping`); return null; }
  const detail = (await detailRes.json()).items?.[0];
  const title = detail?.snippet?.title;
  const durationIso = detail?.contentDetails?.duration;
  if (detail && isFullHighlightVideo({ title, durationIso })) {
    console.log(`${g.gameKey} -> ${id} ("${title}")`);
    return { id, publishedAt: detail.snippet.publishedAt };
  }
  console.log(`${g.gameKey}: top result "${title}" (${durationIso}) failed validation; not saving`);
  return undefined;
}

function clampWeek(w) { return Math.min(Math.max(w || 1, 1), 18); }
