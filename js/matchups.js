// The league's matchups, as the matchup tab flicks through them.
// Pure: no window/document/fetch, so `node --test` covers it.

/**
 * Sleeper returns one row per roster, paired by `matchup_id`. Group those rows
 * into matchups, yours first — index 0 is always "your matchup", so a league or
 * week change can just reset to 0.
 *
 * A side can be missing: an odd-sized league gives someone a bye, and a league
 * that hasn't started has rows with no matchup_id at all. Those stay in the
 * list as one-sided entries rather than disappearing — the roster view already
 * tolerates a short side.
 *
 * sides:  [{roster_id, matchup_id, starters, players_points}]
 * mySide: the row for your roster (identity, not a copy), or undefined
 * nameOf: (side) => display name
 * Returns [{id, a, b, aName, bName, mine}]
 */
export function buildMatchups(sides, mySide, nameOf = () => undefined) {
  const paired = new Map();
  const unpaired = [];
  for (const side of sides || []) {
    if (side.matchup_id == null) { unpaired.push([side]); continue; }
    paired.set(side.matchup_id, [...(paired.get(side.matchup_id) || []), side]);
  }

  const groups = [...paired.entries()]
    .sort((x, y) => Number(x[0]) - Number(y[0]))
    .map(([id, group]) => ({ id, group }))
    .concat(unpaired.map((group) => ({ id: null, group })));

  return groups
    .map(({ id, group }) => {
      // Your roster always reads on the left, whichever side Sleeper listed it.
      const ordered = mySide && group[1] === mySide ? [group[1], group[0]] : group;
      const [a, b] = ordered;
      return {
        id, a, b,
        aName: nameOf(a), bName: nameOf(b),
        mine: Boolean(mySide) && ordered.includes(mySide),
      };
    })
    // Array.prototype.sort is stable, so the rest keep matchup_id order.
    .sort((x, y) => Number(y.mine) - Number(x.mine));
}

/** Every starter on every roster in the league, de-duplicated. */
export function leagueStarters(pairs) {
  const ids = new Set();
  for (const m of pairs || []) {
    for (const side of [m.a, m.b]) {
      for (const pid of side?.starters || []) ids.add(pid);
    }
  }
  return [...ids];
}
