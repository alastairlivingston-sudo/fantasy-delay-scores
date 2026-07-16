# Spoiler-Safe Sleeper Scores — Build Plan

A mobile-first web app for watching NFL on delayed UK TV without having your
Sleeper fantasy matchup spoiled. You control what the app is allowed to show
you: only games you've watched, or a time-delayed replay of the live scores.

## 1. Problem statement review — what works, what doesn't

Each requirement was verified against the live APIs before this plan was
written (2026-07-16). Verdicts:

### 1.1 "Select games I've watched" / "delay function" — ✅ both, with one honest caveat

Two spoiler modes are built:

- **Watched mode** (fully feasible): the week's NFL games are listed; you tick
  the ones you've seen. Fantasy points only count players whose game you've
  ticked. Everything else shows as "hidden" — no totals leak.
- **Delay mode** (feasible with a caveat): a slider (e.g. 45/60/90 min) shows
  your matchup *as it stood N minutes ago*.

**The caveat:** Sleeper's public API only serves *current* cumulative points —
there is no historical timeline to rewind into. FantasyPros can offer delay
because their servers store timestamped stat feeds. A static app must record
its own snapshots: while the app is open it polls Sleeper every 60 seconds and
stores snapshots in `localStorage`. The delay view replays those snapshots.
Consequence: **open the app at (real) kickoff** — it records silently while
you watch on delay. If you open it 40 minutes in with a 60-minute delay, the
delayed view starts from when recording began (it will never *guess* backwards,
and it will never show you newer data than your delay allows).

Phase 2 option if this bites: a scheduled serverless function + KV store
records snapshots server-side 24/7, making delay work even if you open the app
late. Deliberately not in v1 — it adds accounts/infrastructure to what is
otherwise a zero-backend app.

### 1.2 Connect to Sleeper account + scoring systems — ✅ verified, no auth needed

Sleeper's API is public, read-only, keyless, and (contrary to the note in the
old repo's CLAUDE.md) **does send CORS headers** (`access-control-allow-origin: *`,
verified), so the browser calls it directly — no backend proxy.

Verified chain for user `AlastairL` (user_id `735249111976112128`):

| Endpoint | Gives |
|---|---|
| `GET /v1/user/<username>` | user_id |
| `GET /v1/user/<id>/leagues/nfl/<season>` | all leagues + each league's `scoring_settings` |
| `GET /v1/league/<id>/rosters` + `/users` | rosters, owner names |
| `GET /v1/league/<id>/matchups/<week>` | **`players_points` — per-player fantasy points already computed in that league's scoring** |
| `GET /v1/state/nfl` | current season/week |

Because `players_points` is pre-scored per league, the app never reimplements
scoring rules — it works identically across your three leagues (Borehamwood,
MTS and Associates, +1+ UK 12 Team Dynasty) and any league format.

### 1.3 Project the likely winner — ✅

`api.sleeper.com/projections/nfl/<season>/<week>` (verified, CORS OK) gives
per-stat projections per player. The app dot-products those with the league's
`scoring_settings`, so projections are in *your league's* scoring too.

Model: for each starter, `expected_final = seen_points + remaining_fraction ×
projection`, where remaining_fraction comes from the game clock (ESPN
scoreboard, verified CORS OK) — 1.0 pre-game, 0 at final, linear in between.
Win probability = normal approximation over the score difference with variance
proportional to unplayed projection. **Spoiler-consistent:** in watched/delay
mode the projection uses only the points you're allowed to see, so the win %
itself can't leak the live state.

### 1.4 Spoiler-safe YouTube highlights — ✅ v1 via crafted deep links

The app builds a per-game YouTube search link (e.g.
`Dolphins vs Bills Week 3 2025 NFL game highlights`) that lands on the
official NFL highlight uploads — whose titles don't contain scores. The app
itself never displays a score for an unwatched game anywhere (including this
tab). Residual risk: YouTube's results page is out of our control (thumbnails,
related videos). Phase 2 option: YouTube Data API lookup of the exact NFL
video ID to deep-link straight into the player, skipping the results page.
Requires an API key, so not in the keyless v1.

### 1.5 Hosting & scaffolding — ✅ static single-page app; Vercel recommended, Netlify works identically

No secrets, no backend ⇒ pure static site (one `index.html` + ES modules, no
build step, no framework). Both hosts are equivalent for v1; **Vercel** is
recommended (this workspace has direct Vercel deploy/log integration for
iterating, and Phase 2's cron + KV snapshot recorder maps cleanly onto Vercel
Cron + KV). `vercel.json` and `netlify.toml` are both included, so either
deploy works with zero changes. Mobile-first is the design baseline (thumb-row
mode switcher, single column, large tap targets).

### 1.6 Repo reset — ✅ done

The previous contents (Borehamwood 2025 celebration-app file set, photos, CSV)
didn't match this plan and were removed. They remain in git history if ever
needed.

## 2. Architecture

```
index.html            single page, mobile-first
css/style.css
js/
  api.js              Sleeper + ESPN fetchers (all public, CORS-verified)
  state.js            localStorage: config, watched sets, snapshots
  recorder.js         60s polling loop → snapshot ring buffer
  gate.js             PURE: live/watched/delay gating of players_points
  project.js          PURE: expected finals + win probability
  youtube.js          PURE: spoiler-safe highlight link builder
  app.js              UI controller / rendering
tests/                node:test unit tests for the pure modules
scripts/smoke.js      live-API contract check (shapes still match)
```

Data flow each refresh:

```
Sleeper state ─┐
leagues/rosters ├─► matchup (players_points) ─┐
projections ───┤                              ├─► gate.js (mode) ─► visible points
ESPN scoreboard┴─► game states (clock/final) ─┘        │
                                                       ▼
                                             project.js ─► win %
```

Key rule enforced by design: **rendering only ever reads gated data.** Raw live
numbers exist only inside `gate.js`'s input; nothing above it sees them in
watched/delay mode.

Player→game mapping comes from the projections payload (every player carries
`team`/`opponent`), with a small Sleeper↔ESPN abbreviation normaliser
(WAS/WSH etc.). Team DEF player IDs are the team codes themselves.

## 3. Build phases

- **Phase 1 (built):** everything above — setup flow, three modes,
  win projection, highlights tab, tests, smoke script, deploy configs.

- **Phase 2 (built):** removes the "app must be open at kickoff" constraint.
  - **Server-side snapshot recorder.** No free public API stores in-game
    fantasy timelines (FantasyPros' delay runs on their proprietary feeds;
    nflverse publishes post-game only), and Vercel's free-tier cron only fires
    daily — so the repo itself is the database. `.github/workflows/record.yml`
    polls Sleeper + ESPN every ~5 minutes during all other NFL game windows;
    `.github/workflows/record-live.yml` covers Sunday evenings — the window
    you're most likely to be watching delayed — at 60-second resolution (see
    below). Both force-push a single-commit `snapshots` branch that resets
    automatically when the league week rolls over (the "clears every game
    week" requirement) — git history never accumulates. The app's own 60s
    recording still runs while open and merges in (`js/snapshots.js`).
  - **60-second Sunday-night recording, no need to have the app open.**
    `record-live.yml` runs 17:00→04:00 UK wall-clock. Two GitHub limits shape
    it: a hosted job caps out at 6 hours (the window is ~11h), and scheduled
    cron only fires reliably every ~5 minutes (too coarse for a 60s cadence,
    and can jitter under load). So the workflow doesn't rely on cron ticking
    every minute — it starts one job that loops with its own internal 60s
    sleep (immune to cron jitter once running), splits into two chained
    "legs" via the Actions API to stay under the 6-hour cap, and the
    start/stop times are evaluated live against Europe/London time
    (`js/schedule.js`) rather than hardcoded UTC — so it self-corrects across
    the BST/GMT clock change with no yearly maintenance. Two cron triggers
    (16:00 and 17:00 UTC) cover both possible DST states; the wrong one
    no-ops immediately. See `scripts/record-live.js` for the loop/chain logic.
  - **Snapshot serving.** The static app can't read a private repo, so
    `api/snapshots.js` (a Vercel function) proxies the `snapshots` branch:
    anonymous raw access once the repo is public (no token needed), or
    `GH_SNAPSHOTS_TOKEN` (fine-grained PAT, Contents read-only) if it's ever
    made private again. Missing data degrades to Phase 1 behaviour.
  - **YouTube direct links.** `scripts/resolve-highlights.js` runs in the
    same workflow with an optional `YOUTUBE_API_KEY` repo secret and maps
    each finished game to the official NFL channel's highlight video ID —
    the app then deep-links straight into the player, skipping the results
    page. The YouTube Data API is free: 10,000 quota units/day, 100 per
    search, results cached per week so we use ≤1,600. Without the key the
    app keeps the spoiler-safe search links.
  - **PWA install.** Manifest + iOS meta tags so the app pins to the home
    screen full-screen.

  **To switch Phase 2 on** (one-time):
  1. Make the repo public (GitHub → Settings → General → Danger Zone →
     Change visibility). Simplifies `api/snapshots.js` to anonymous access —
     no `GH_SNAPSHOTS_TOKEN` needed — and public repos get unlimited free
     GitHub Actions minutes, comfortably covering the Sunday marathon jobs.
  2. Merge this branch to `main` — GitHub only runs scheduled workflows from
     the default branch.
  3. Optional: create a free YouTube Data API key (Google Cloud console, no
     billing needed) and add it as a repo Actions secret `YOUTUBE_API_KEY`.

  **Honest caveat:** GitHub warns scheduled workflows can be delayed under
  high load, so the marathon job's *start* (17:00 or 04:00-ish handoff) could
  slip by a few minutes on a busy Sunday — rare, and once running the internal
  60s loop is unaffected by that jitter. If it ever proves annoying in
  practice, `scripts/record-live.js`'s dry-run hooks
  (`RECORD_LIVE_TICK_MS`/`RECORD_LIVE_MAX_ITERATIONS`/`RECORD_LIVE_REMOTE`)
  make it easy to test changes safely against a local repo before touching
  the real one.

- **Phase 3 (ideas):** red-zone/close-game notifications, multi-league
  dashboard, minute-level server recording via an external pinger
  (cron-job.org → a record endpoint) if 5-minute resolution feels coarse.

## 4. Testing & iteration scaffolding

- `npm test` — `node --test`: gating (watched filtering, delay replay picks the
  right snapshot and never a too-new one), projection blending, win-prob
  monotonicity, YouTube query building, team-code normalisation.
- `npm run smoke` — hits the four live APIs and asserts the response shapes the
  app depends on (catches upstream API drift).
- `npm run dev` — local static server on :5173.
- Off-season friendly: season/week pickers let you replay any 2025 week with
  real data, which is how the app is verified today (July 2026) and how you
  can demo it before September.
