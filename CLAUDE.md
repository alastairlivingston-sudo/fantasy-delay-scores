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
5. Sleeper has no historical stat timeline. Delay mode replays snapshots the
   client recorded itself (localStorage, 60s cadence, only while a tab is open).

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
