// Resolves finished games to official NFL highlight video IDs via the
// YouTube Data API (free tier: 10k units/day; one search = 100 units + one
// videos.list = 1 unit per candidate). A hit is only kept if it passes
// isFullHighlightVideo (duration + title checks) AND highlightMismatch (right
// teams, right week, published in the hours after THIS kickoff — the NFL
// channel is full of last season's version of the same fixture). The app never
// falls back to a raw YouTube search, since that results page can itself show
// a score.
//
// Stored per game: {id, publishedAt, title}. The title is kept so a later run
// can re-check a link it didn't resolve itself; it is safe to store because
// isFullHighlightVideo rejects any title carrying a scoreline.
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
import {
  highlightQuery, isFullHighlightVideo, shouldSearchAgain,
  highlightMismatch, publishWindow, pruneHighlights,
} from '../js/youtube.js';

const NFL_CHANNEL_ID = 'UCDVYQ4Zhbm3S2dlz7P1GBDg'; // official NFL channel

// The search is the expensive call (100 units; the videos.list that follows is
// 1 unit for the whole batch), so asking for a single result and validating
// only that one throws away a whole search whenever the top hit is last
// season's meeting. Same cost, more candidates.
// Declared up here, not beside findHighlight: the work below runs at top level,
// so anything it reaches must already be initialised.
const CANDIDATES = 5;

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

  // Re-check what's already stored before adding to it. Links resolved before
  // the date/title guards existed can be last season's meeting of the same two
  // teams, or another game's video entirely; dropping one here puts the game
  // back in the queue below, where the stricter checks apply.
  const pruned = pruneHighlights(stored.videos, games, { season, week: w });
  for (const d of pruned.dropped) {
    console.warn(`week ${w}: dropping stored ${d.gameKey} -> ${d.id} (${d.reason})`);
    delete stored.pending[d.gameKey]; // a fresh search, not a continued backoff
  }
  stored.videos = pruned.videos;

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

    const taken = new Set(Object.values(stored.videos).map((v) => v.id));
    const video = await findHighlight(g, w, taken);
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
 *
 * `taken` is the set of video ids already claimed by other games this week.
 */
async function findHighlight(g, w, taken = new Set()) {
  // Bound the search by the kickoff itself. This is the cheapest of the
  // wrong-year guards: the previous season's meeting is never returned at all,
  // so it can't take the one candidate slot that mattered.
  const range = publishWindow(g.date);
  const searchUrl = 'https://www.googleapis.com/youtube/v3/search?' + new URLSearchParams({
    key, q: highlightQuery({ away: g.away, home: g.home, week: w, season }),
    channelId: NFL_CHANNEL_ID, part: 'snippet', type: 'video', maxResults: String(CANDIDATES),
    ...(range ? {
      publishedAfter: new Date(range.from).toISOString(),
      publishedBefore: new Date(range.to).toISOString(),
    } : {}),
  });
  const searchRes = await fetch(searchUrl);
  if (!searchRes.ok) { console.warn(`YouTube API ${searchRes.status} for ${g.gameKey}; stopping`); return null; }
  const ids = ((await searchRes.json()).items || [])
    .map((i) => i?.id?.videoId).filter(Boolean);
  if (!ids.length) { console.log(`${g.gameKey}: no result yet (highlight may not be uploaded)`); return undefined; }

  const detailUrl = 'https://www.googleapis.com/youtube/v3/videos?' + new URLSearchParams({
    key, id: ids.join(','), part: 'snippet,contentDetails',
  });
  const detailRes = await fetch(detailUrl);
  if (!detailRes.ok) { console.warn(`YouTube API ${detailRes.status} for ${g.gameKey} details; stopping`); return null; }
  const items = (await detailRes.json()).items || [];

  // Search order is relevance order, so the first candidate that survives every
  // check is the best one — not merely an acceptable one.
  for (const id of ids) {
    const detail = items.find((i) => i.id === id);
    if (!detail) continue;
    const title = detail.snippet?.title;
    const durationIso = detail.contentDetails?.duration;
    const candidate = { id, publishedAt: detail.snippet?.publishedAt, title };
    if (taken.has(id)) {
      console.log(`${g.gameKey}: "${title}" already resolved for another game; skipping`);
      continue;
    }
    if (!isFullHighlightVideo({ title, durationIso })) {
      console.log(`${g.gameKey}: "${title}" (${durationIso}) isn't a full highlight reel; skipping`);
      continue;
    }
    const mismatch = highlightMismatch(candidate, { ...g, week: w, season });
    if (mismatch) {
      console.log(`${g.gameKey}: "${title}" rejected (${mismatch})`);
      continue;
    }
    console.log(`${g.gameKey} -> ${id} ("${title}")`);
    return candidate;
  }
  console.log(`${g.gameKey}: ${ids.length} candidate(s), none validated; not saving`);
  return undefined;
}

function clampWeek(w) { return Math.min(Math.max(w || 1, 1), 18); }
