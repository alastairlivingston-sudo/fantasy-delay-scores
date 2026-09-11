# Spoiler-Safe Sleeper Scores — Project Memory

## What this is
Mobile-first static single-page app for watching NFL on delayed UK TV without
spoiling your Sleeper fantasy matchup. Three view modes: Live, Watched-games,
Delay (snapshot replay). No backend, no build step, no framework, no secrets.
See BUILD_PLAN.md for architecture and phases.

## Verified API facts (do not re-litigate; re-verify with `npm run smoke`)
1. `api.sleeper.app` and `api.sleeper.com` DO send `Access-Control-Allow-Origin: *`.
   Browser calls are fine. (An earlier project's CLAUDE.md claimed otherwise — wrong.)
2. `GET /v1/league/<id>/matchups/<week>` includes `players_points` and
   `starters_points`, already computed in the league's own scoring. Never
   reimplement scoring for actuals.
3. `api.sleeper.com/projections/nfl/<season>/<week>?season_type=regular`
   gives per-stat projections + player team/opponent. Dot-product with the
   league's `scoring_settings` for league-accurate projections.
4. ESPN scoreboard (`site.api.espn.com/.../scoreboard?seasontype=2&week=N&dates=<year>`)
   is public + CORS OK; gives status/period/clock per game.
5. Sleeper has no historical stat timeline, and no free public API offers one.
   Delay mode replays self-recorded snapshots from three sources, merged by
   `js/snapshots.js`: the ~5-min GitHub Actions recorder (record.yml, most
   game windows), the 60-second Sunday-evening recorder (record-live.yml,
   17:00-04:00 UK wall-clock — see BUILD_PLAN.md for why it needs two chained
   jobs and how js/schedule.js keeps it DST-correct without date maintenance),
   and the client's own 60s localStorage recording while a tab is open. All
   snapshot data lives on the single-commit `snapshots` branch, cleared on
   week rollover, served to the app by the `api/snapshots.js` Vercel function.
6. Repo should be public: browsers can't read raw.githubusercontent.com from a
   private repo without the GH_SNAPSHOTS_TOKEN fallback, and public repos get
   unlimited free Actions minutes (the Sunday marathon job needs real hours/
   week). Scheduled workflows only run from the default branch (main).
7. YouTube Data API is free (10k units/day, 100/search); the optional
   YOUTUBE_API_KEY Actions secret enables direct highlight links. The official
   upload lands HOURS after the final whistle, so resolution must run on a
   clock, not in game windows — `.github/workflows/highlights.yml` runs the
   resolver hourly all season (plus the previous week, for Monday-night games
   whose Sleeper week has rolled over). Retries back off per game and give up
   after 8 misses (`shouldSearchAgain` in js/youtube.js) so hourly runs can't
   burn the quota.
8. GitHub throttles and silently DROPS scheduled runs on a quiet repo, and this
   applies to HOURLY crons too, not just `*/5`. Measured on highlights.yml's
   first 24h of hourly scheduling: 5 runs delivered, gaps of 2.5-4.6h, none at
   the requested minute. Never make a user-visible guarantee depend on cron
   delivery. Current mitigation is threefold: four cron candidates per hour
   (dropped independently), record.yml's opportunistic resolve step, and — the
   only reliable one — the app dispatching its own check when it notices stale
   data (`autoCheckIfStale` in js/app.js).
9. NEVER test scripts/record-live.js (or record.js) against the real
   `https://github.com/<owner>/<repo>.git` remote — this environment can carry
   ambient push credentials that make even a deliberately-invalid token
   succeed. Always pass RECORD_LIVE_REMOTE pointing at a local bare repo
   (`git init --bare /tmp/x.git`) for dry runs.
10. Manual highlight checks: `POST /api/refresh` dispatches highlights.yml on
    demand. Needs `GH_DISPATCH_TOKEN` in the Vercel env (fine-grained PAT, this
    repo only, Actions: read+write); `GET /api/refresh` is a side-effect-free
    probe so the app hides its button when the token is absent. The endpoint is
    public (no accounts), so the per-browser 500/week allowance in js/quota.js
    is an allowance, NOT a security control — the real ceiling is the global
    weekly cap in api/refresh.js, counted from GitHub's own `workflow_dispatch`
    history (no database). Spam is cheap by design: the per-game backoff means
    repeat checks inside the backoff window cost zero YouTube quota.

## Hard rules
1. Rendering must only read gated data from `js/gate.js`. In watched/delay
   mode nothing outside gate.js may touch raw live points — including the win
   probability, which is computed from gated points only.
2. Never show an ESPN score or a game clock-derived total for an unwatched game.
3. Delay mode must never show a snapshot newer than (now − delay); if none is
   old enough, show pre-game state + an explanatory notice, never the oldest
   available snapshot.
4. `js/gate.js`, `js/project.js`, `js/youtube.js` stay environment-free (no
   window/document/fetch) so `node --test` covers them.
5. Sleeper team codes are canonical; normalise ESPN codes (WSH→WAS, LA→LAR)
   at the api.js boundary.
6. A starter whose game hasn't kicked off renders "—", never "0.0" — both are
   zero, but only one means "still to play". The distinction is `p.state`, which
   is gated output, so it stays correct (and conservative) in delay mode.
7. `js/quota.js` is pure too (same node --test rule as gate/project/youtube).
8. Watched ticks are keyed by SEASON+WEEK, never by league — "I watched
   SF @ LAR" is a fact about the viewer, so one tick counts in every league.
   `adoptLegacyWatched` folds in the old `<leagueId>:<week>` sets on load; keep
   it until it's certain no browser still holds them.
9. `renderStarters` pairs the two sides by index and either side can be
   shorter (bye week, odd-sized league, no opponent yet). `playerCell` must
   tolerate an undefined player — it threw once and took the whole view down
   with a "Failed to load" alert.

## Owner context
Sleeper username `AlastairL` (user_id 735249111976112128). 2025 leagues:
Borehamwood (8-team), MTS and Associates (10), +1+ UK 12 Team Dynasty (12).
Off-season default: browse previous season so the app is testable year-round.

## Commands
- `npm run dev` — serve on :5173
- `npm test` — unit tests for pure modules
- `npm run smoke` — live API contract check
- `FORCE_SEASON=2025 FORCE_WEEK=17 node scripts/record.js <dir>` — recorder dry run
- `HIGHLIGHT_WEEKS_BACK=0 YOUTUBE_API_KEY=… node scripts/resolve-highlights.js <dir>`
  — resolver dry run (no key ⇒ clean no-op)
