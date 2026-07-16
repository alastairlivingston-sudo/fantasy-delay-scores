// Spoiler-safe YouTube highlight links. Pure: no window/document/fetch.
//
// Official NFL highlight uploads are titled like
// "Dolphins vs. Bills Game Highlights | NFL 2025 Week 3" — no score in the
// title — so a precise search query lands on them without exposing scores.

import { teamName } from './teams.js';

export function highlightQuery({ away, home, week, season }) {
  return `${teamName(away)} vs ${teamName(home)} Week ${week} ${season} NFL game highlights`;
}

export function highlightSearchUrl(game) {
  return 'https://www.youtube.com/results?search_query=' +
    encodeURIComponent(highlightQuery(game));
}
