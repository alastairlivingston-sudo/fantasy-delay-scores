# Borehamwood Champions 2025 — Project Memory

## What this is
A mobile-first, swipeable celebration web app for "Fourth and Golda Meir" (Sleeper handle AlastairL),
2025 champions of the Borehamwood Plancy League. Pure static site, hosted on Netlify. No backend.

## Hard rules (learned the hard way — do not violate)
1. The Sleeper API has NO CORS headers. Never call it from the browser. Only from Node scripts at build
   time, writing static JSON into public/data/.
2. No secrets in the client. The site is public. AI commentary is generated offline and committed as JSON.
3. Verify, never fabricate. All scores must reconcile against the known finals in season.seed.json.
4. Plain text only for ingest. The source of truth is public/data/all-weeks.csv.

## Architecture
all-weeks.csv -> app.js (PapaParse, in-browser) -> swipe deck
season.seed.json (schedule + baked banter + score cross-check)
nfl-slots.json (generated: per-match timelines)
commentary.json (generated: overrides seed banter)
trades.json (generated: Deadline Moves panel)

## Data contract
- all-weeks.csv: Owner, Week, Player, Position, NFL, Fantasy, Points
- season.seed.json: { matches:[{week, playoff, opp, handle, mine, them, commentary}] }
- nfl-slots.json: { "<week>": { "<TEAM>": "<ISO kickoff>" } }
- commentary.json: { "<week>": "<string>" }
- trades.json: [ { week, parties:[team], summary } ]

## Known data facts (validation)
Regular season 9-5, playoffs 2-0, final 11-5. Week 15 = first-round bye (skip in UI).
Week 3 lost by 0.02 (131.84-131.86). Week 12 conceded 202.36. Week 7 high 156.58.
Championship Week 17 vs Plancey Neutral (dpol) 143.96-118.58.

## Conventions
- Design: clean dark NFL-broadcast aesthetic. Oswald + Inter. Gold #C8A951. Mobile-first scroll-snap.
- Starter detection: a row is a starter unless its Fantasy slot is in
  {BN,BE,BENCH,IR,TAXI,RES,RESERVE,NA,empty}. App auto-checks both interpretations vs known scores.
- NFL codes: map Sleeper->ESPN via TEAMFIX in app.js
  (GNB->GB, KAN->KC, JAC->JAX, NWE->NE, NOR->NO, SFO->SF, TAM->TB, WAS->WSH, LA->LAR, OAK/LVR->LV, ARZ->ARI).

## Voice
Bone-dry British banter treating a low-stakes hobby with the utmost mock-gravity. Roast the loser
(including us), celebrate the winner, never cruel, always funny. Reference real players and numbers.

## Build & deploy
npm run data ; npm run commentary (optional, needs ANTHROPIC_API_KEY) ; npm run dev ; npm run deploy
