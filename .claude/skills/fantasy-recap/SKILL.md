---
name: fantasy-recap
description: >
  Build self-contained, mobile-first, data-driven sports/fantasy recap web apps that read a committed
  CSV/JSON dataset and render a swipeable story deck. Use for celebration or season-review sites that
  must be statically hosted with no backend and no client-side secrets.
---

# Fantasy Recap Builder

## Method (in order)
1. Read the data contract first. Confirm CSV/JSON shape before writing UI. Never assume columns.
2. One committed source of truth in /data, parsed client-side (PapaParse for CSV). No servers.
3. External APIs only from Node build scripts that write static JSON (browsers hit CORS; scripts don't).
4. Verify against ground truth. Reconcile to known totals; fix parsing to match reality, never edit data.
5. Mobile-first story deck: CSS scroll-snap, one item per screen, progress dots, a finale. No heavy libs.
6. No secrets client-side. AI text generated offline and committed as JSON.
7. Shareable: native share + canvas-to-PNG cards per item.

## Design system
Dark broadcast aesthetic; Oswald (display) + Inter (body); one accent colour; tabular-nums; subtle glow.

## Definition of done
Loads on a phone <2s; every number traceable to the dataset; deploys as a static folder, zero secrets.
