Refresh all generated data files, then verify.
1. Run `npm run data` (writes public/data/nfl-slots.json and trades.json via the Node scripts).
2. If ANTHROPIC_API_KEY is set, run `npm run commentary`.
3. Start `npm run dev`, load the page, report: does the "verified" badge show? Any empty timelines
   (TEAMFIX gap)? List any week whose computed score differs from season.seed.json.
