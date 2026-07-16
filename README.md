# Spoiler-Safe Sleeper Scores

Watch NFL on delayed UK TV without your Sleeper fantasy matchup getting
spoiled. The app shows your matchup with **you** in control of what's visible:

- **Live** — normal, everything current.
- **Watched** — tick the games you've seen; only those players' points count.
  Everything else is hidden, including totals and win probability inputs.
- **Delay** — see the matchup as it stood 15 min–2 hrs ago. GitHub Actions
  recorders snapshot scores in the background (no need to have the app open):
  every ~5 minutes for most game windows, every ~60 seconds on Sunday evenings
  (17:00–04:00 UK time, DST-aware). The app adds its own 60-second snapshots
  while open too, and the delayed view replays whichever data exists. It never
  shows anything newer than your delay.

Plus a live win-probability estimate (from what you've *seen*, so it can't
spoil you) and spoiler-safe YouTube highlight links per game.

No login, no API keys: Sleeper's public read-only API is used directly from
the browser.

## Use it

Deploy the repo root as a static site (Vercel or Netlify, zero config — both
config files are included), or locally:

```
npm run dev     # http://localhost:5173
```

Enter your Sleeper username, pick a league and week. During the off-season it
defaults to the most recent completed season so you can explore.

## Develop

```
npm test        # unit tests for gating / projection / youtube modules
npm run smoke   # verifies the live Sleeper + ESPN APIs still match assumptions
```

Server-side pieces (all optional — the app degrades gracefully without them):

- `.github/workflows/record.yml` — ~5-minute snapshot recorder for most game
  windows; runs from the default branch, stores data on the self-clearing
  `snapshots` branch.
- `.github/workflows/record-live.yml` — 60-second recorder for Sunday
  evenings (17:00–04:00 UK wall-clock); see `BUILD_PLAN.md` for how it fits
  an 11-hour window into GitHub's 6-hour job cap and stays DST-correct.
- `api/snapshots.js` — Vercel function serving that data to the app. For a
  private repo, set `GH_SNAPSHOTS_TOKEN` (fine-grained PAT, Contents: read)
  in the Vercel project env; not needed once the repo is public.
- `scripts/resolve-highlights.js` — direct YouTube highlight links; add a free
  YouTube Data API key as the `YOUTUBE_API_KEY` Actions secret to enable.

See `BUILD_PLAN.md` for the full architecture, feasibility notes, the Phase 2
enable checklist, and Phase 3 ideas.
