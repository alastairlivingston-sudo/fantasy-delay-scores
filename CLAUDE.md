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
   `js/snapshots.js`: the 60-second marathon recorder (record-live.yml — runs
   whenever `js/schedule.js` says there are live games, chaining legs to cover
   windows longer than a job's 6h cap, and resolving highlights on the same
   loop), the ~5-min recorder (record.yml) as a backstop, and the client's own
   60s localStorage recording while a tab is open. All
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
   whose Sleeper week has rolled over). THE QUOTA IS THE BINDING CONSTRAINT,
   not the schedule: 100 units per search means ~100 searches/day in total,
   i.e. only ~7-8 per game on a 13-game Sunday. Checking every unresolved game
   on every 2-minute recorder tick would spend the whole day in 15 minutes. So
   `shouldSearchAgain` (js/youtube.js) gives each game its own backoff and
   stops after 8. Retuning means MOVING those 8, never adding more — the curve
   is placed against observed upload delays (15 min to ~4 h after the whistle),
   with 6 of the 8 inside that band. Only a bigger quota buys more.
8. GitHub throttles and silently DROPS scheduled runs on a quiet repo, and this
   applies to HOURLY crons too, not just `*/5`. Measured on highlights.yml's
   first 24h of hourly scheduling: 5 runs delivered, gaps of 2.5-4.6h, none at
   the requested minute. Never make a user-visible guarantee depend on cron
   delivery — NOTHING may depend on a run firing at a particular time. This
   killed the live recorder silently for weeks: its leg-1 gate demanded the UK
   hour be exactly 17, and on 2026-09-13 the deliveries arrived at 19:34 and
   20:16 UK, so both no-opped and the whole Sunday slate went unrecorded.
   The pattern that works is a long-running job that decides for itself: a
   delivery at any time either finds the window open (from the week's games,
   not the clock) or sleeps until it opens, then loops internally at 60s.
   Cron then only has to land *once*, not on time. Other mitigations: many
   cron candidates, and the app's own `autoCheckIfStale`.
9. The `snapshots` branch lives in the SAME repo Vercel watches, so every push
   to it is a deploy trigger. The 60s recorder burned Vercel's free 100
   deploys/day in under two hours and blocked production deploys with it.
   Vercel reads `git.deploymentEnabled` from the vercel.json IN THE COMMIT
   BEING PUSHED, so main's copy never applied to this branch at all: snapshots
   is an orphan branch whose tree was only `data/`. Measured 2026-09-21, a week
   after that setting landed on main: all 20 most recent deployments came from
   `snapshots`, one every ~4 minutes, and the cap blocked production with them.
   The branch now carries its own opt-out — `scripts/snapshots-branch-config.js`
   writes a root vercel.json with `deploymentEnabled: false`, called from all
   four paths that build the branch (record.yml, highlights.yml,
   backfill-highlights.yml, record-live.js). It must be rewritten on every run:
   those jobs restore only `data/` from the remote, so anything else in the tree
   is lost when the branch is rebuilt. record-live.js also batches pushes
   (samples at 60s, pushes every ~3 min, flushes on exit) — that alone was never
   enough, since even every ~3 min fills 100/day in about five hours. Before
   raising any push rate, count what else reacts to a push.
10. NEVER test scripts/record-live.js (or record.js) against the real
   `https://github.com/<owner>/<repo>.git` remote — this environment can carry
   ambient push credentials that make even a deliberately-invalid token
   succeed. Always pass RECORD_LIVE_REMOTE pointing at a local bare repo
   (`git init --bare /tmp/x.git`) for dry runs.
11. Manual highlight checks: `POST /api/refresh` dispatches highlights.yml on
    demand. Needs `GH_DISPATCH_TOKEN` in the Vercel env (fine-grained PAT, this
    repo only, Actions: read+write); `GET /api/refresh` is a side-effect-free
    probe so the app hides its button when the token is absent. The endpoint is
    public (no accounts), so the per-browser 500/week allowance in js/quota.js
    is an allowance, NOT a security control — the real ceiling is the global
    weekly cap in api/refresh.js, counted from GitHub's own `workflow_dispatch`
    history (no database). Spam is cheap by design: the per-game backoff means
    repeat checks inside the backoff window cost zero YouTube quota.
12. A channel search for "<Team> vs <Team> Week N <season> highlights" WILL
    return the same fixture from an EARLIER SEASON. Measured on the stored
    files: 2026 wk2 CAR@ATL pointed at a 2025-09-21 upload, 2026 wk2 JAX@DEN at
    2025-12-22, 2026 wk1 DEN@KC at the 2025 wk17 game — and one video was
    stored for both CIN@HOU and CLE@TB. So a candidate is kept only if
    `highlightMismatch` (js/youtube.js) clears it: published between kickoff+2h
    and kickoff+4d, title naming both teams and agreeing on week/season, and its
    id not already claimed by another game that week. Real publish lags across
    287 stored links: 2.97h to 7.7h after kickoff, so that window has room at
    both ends. The search also passes publishedAfter/publishedBefore and takes 5
    candidates instead of 1 — same 100-unit cost, and the wrong-year video is
    never even returned. `pruneHighlights` re-checks stored links on every
    resolver run, and the app re-checks at render, so a bad link stops being
    shown without waiting for the file to be rewritten.

## Hard rules
1. Rendering must only read gated data from `js/gate.js`. In watched/delay
   mode nothing outside gate.js may touch raw live points — including the win
   probability, which is computed from gated points only.
2. Never show an ESPN score or a game clock-derived total for an unwatched game.
3. Delay mode must never show a snapshot newer than (now − delay); if none is
   old enough, show pre-game state + an explanatory notice, never the oldest
   available snapshot.
4. `js/gate.js`, `js/project.js`, `js/youtube.js`, `js/matchups.js` stay
   environment-free (no window/document/fetch) so `node --test` covers them.
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
10. A game card never shows live/final status. A game still reading "Live" long
   after it should have ended says "overtime", which is a spoiler by itself, and
   "Final" says the opposite. Whether the official highlight is up is the ONLY
   per-game progress signal the card gives; the placeholder text for a game
   without one is identical whatever its state.
11. The matchup tab flicks through EVERY matchup in the league (arrows, like
   Sleeper), and every one of them renders from the same gate.js ctx as your
   own — same watched ticks, same delayed snapshot. Browsing the league can
   never show a score your mode wouldn't. `buildMatchups` puts yours at index
   0, so a league or week change resets to it.
12. Switching league is one tap on the league name in the header, then one tap
   on the league. It used to be a native `<select>` buried in the drawer: tap
   ☰, find the row, spin the wheel, confirm, close. Don't put a league (or any
   other everyday switch) behind a `<select>` on mobile.

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
