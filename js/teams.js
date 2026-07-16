// NFL team codes (Sleeper convention is canonical) and display names.

export const TEAM_NAMES = {
  ARI: 'Cardinals', ATL: 'Falcons', BAL: 'Ravens', BUF: 'Bills',
  CAR: 'Panthers', CHI: 'Bears', CIN: 'Bengals', CLE: 'Browns',
  DAL: 'Cowboys', DEN: 'Broncos', DET: 'Lions', GB: 'Packers',
  HOU: 'Texans', IND: 'Colts', JAX: 'Jaguars', KC: 'Chiefs',
  LAC: 'Chargers', LAR: 'Rams', LV: 'Raiders', MIA: 'Dolphins',
  MIN: 'Vikings', NE: 'Patriots', NO: 'Saints', NYG: 'Giants',
  NYJ: 'Jets', PHI: 'Eagles', PIT: 'Steelers', SEA: 'Seahawks',
  SF: '49ers', TB: 'Buccaneers', TEN: 'Titans', WAS: 'Commanders',
};

// ESPN uses a few different abbreviations than Sleeper.
const ESPN_TO_SLEEPER = { WSH: 'WAS', LA: 'LAR', JAC: 'JAX', OAK: 'LV', SD: 'LAC' };

export function normalizeCode(code) {
  if (!code) return null;
  const up = String(code).toUpperCase();
  return ESPN_TO_SLEEPER[up] || up;
}

export function teamName(code) {
  return TEAM_NAMES[normalizeCode(code)] || code;
}
