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
   YOUTUBE_API_KEY Actions secret enables direct highlight links.
8. NEVER test scripts/record-live.js (or record.js) against the real
   `https://github.com/<owner>/<repo>.git` remote — this environment can carry
   ambient push credentials that make even a deliberately-invalid token
   succeed. Always pass RECORD_LIVE_REMOTE pointing at a local bare repo
   (`git init --bare /tmp/x.git`) for dry runs.

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

## Owner context
Sleeper username `AlastairL` (user_id 735249111976112128). 2025 leagues:
Borehamwood (8-team), MTS and Associates (10), +1+ UK 12 Team Dynasty (12).
Off-season default: browse previous season so the app is testable year-round.

## Commands
- `npm run dev` — serve on :5173
- `npm test` — unit tests for pure modules
- `npm run smoke` — live API contract check
- `FORCE_SEASON=2025 FORCE_WEEK=17 node scripts/record.js <dir>` — recorder dry run
