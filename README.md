# Spoiler-Safe Sleeper Scores

Watch NFL on delayed UK TV without your Sleeper fantasy matchup getting
spoiled. The app shows your matchup with **you** in control of what's visible:

- **Live** — normal, everything current.
- **Watched** — tick the games you've seen; only those players' points count.
  Everything else is hidden, including totals and win probability inputs.
- **Delay** — see the matchup as it stood 30/45/60/90 minutes ago. The app
  records score snapshots while it's open, so **open it at real kickoff** and
  it replays them at your delay. It never shows anything newer than your delay.

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

See `BUILD_PLAN.md` for the full architecture, feasibility notes, and the
Phase 2 roadmap (server-side snapshot recorder, direct YouTube deep links, PWA).
