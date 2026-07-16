# Spoiler-Safe Sleeper Scores

Watch NFL on delayed UK TV without your Sleeper fantasy matchup getting
spoiled. The app shows your matchup with **you** in control of what's visible:

- **Live** — normal, everything current.
- **Watched** — tick the games you've seen; only those players' points count.
  Everything else is hidden, including totals and win probability inputs.
- **Delay** — see the matchup as it stood 15 min–2 hrs ago. A GitHub Actions
  recorder snapshots scores every ~5 minutes during games (no need to have the
  app open), the app adds 60-second snapshots while it is open, and the delayed
  view replays them. It never shows anything newer than your delay.

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

- `.github/workflows/record.yml` — snapshot recorder; runs from the default
  branch, stores data on the self-clearing `snapshots` branch.
- `api/snapshots.js` — Vercel function serving that data to the app. For a
  private repo, set `GH_SNAPSHOTS_TOKEN` (fine-grained PAT, Contents: read)
  in the Vercel project env.
- `scripts/resolve-highlights.js` — direct YouTube highlight links; add a free
  YouTube Data API key as the `YOUTUBE_API_KEY` Actions secret to enable.

See `BUILD_PLAN.md` for the full architecture, feasibility notes, the Phase 2
enable checklist, and Phase 3 ideas.
