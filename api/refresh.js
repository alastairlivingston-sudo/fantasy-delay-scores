// POST /api/refresh — run the highlight resolver NOW instead of waiting for
// highlights.yml's hourly schedule. The app polls /api/snapshots afterwards and
// re-renders when the week's `checkedAt` moves.
//
// Setup (one-time, or the endpoint stays a no-op): add GH_DISPATCH_TOKEN to the
// Vercel project env — a fine-grained PAT scoped to this repo only, with
// Actions: Read and write. Nothing else in the app needs it, and without it
// this returns `not-configured` and the app hides its "Check now" button.
//
// Rate limiting: the app has no accounts, so this endpoint is effectively
// public and its per-browser allowance (js/quota.js) is advisory — anyone can
// clear localStorage. The real ceiling is the GLOBAL weekly cap below, counted
// from GitHub's own dispatch history, which needs no database. It is a ceiling
// on *manual* checks only: scheduled runs are a different event type.
//
// Spamming it is cheap by construction: resolve-highlights.js backs off per
// game, so repeat checks inside the backoff window cost zero YouTube quota, and
// the workflow's `snapshots` concurrency group serialises whatever does run.

const REPO = process.env.SNAPSHOTS_REPO || 'alastairlivingston-sudo/fantasy-delay-scores';
const WORKFLOW = 'highlights.yml';
const REF = process.env.REFRESH_REF || 'main';

// Read per request, not at module load, so the cap can be retuned from the
// Vercel dashboard without a redeploy.
const weeklyLimit = () => Number(process.env.REFRESH_WEEKLY_LIMIT || 500);

function gh(path, init) {
  return fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${process.env.GH_DISPATCH_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'spoiler-safe-sleeper',
      ...(init?.headers || {}),
    },
  });
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store, max-age=0');
  res.setHeader('content-type', 'application/json');
  const WEEKLY_LIMIT = weeklyLimit();

  // GET is a side-effect-free capability probe, so the app can hide its
  // "Check now" button on load rather than only after a failed tap.
  if (req.method === 'GET') {
    return res.status(200).json({
      configured: Boolean(process.env.GH_DISPATCH_TOKEN),
      limit: WEEKLY_LIMIT,
    });
  }
  if (req.method !== 'POST') {
    res.setHeader('allow', 'GET, POST');
    return res.status(405).json({ error: 'method-not-allowed' });
  }
  if (!process.env.GH_DISPATCH_TOKEN) {
    return res.status(503).json({
      error: 'not-configured',
      message: 'Set GH_DISPATCH_TOKEN in the Vercel project env to enable manual checks.',
    });
  }

  // Manual dispatches in the trailing 7 days. GitHub's `created` filter is
  // date-granular, so this is a whole-day rolling window — deliberately the
  // generous reading, since the cap is a backstop, not an accounting system.
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const countRes = await gh(
    `actions/workflows/${WORKFLOW}/runs`
    + `?event=workflow_dispatch&created=%3E%3D${since}&per_page=1`);
  if (!countRes.ok) {
    return res.status(502).json({
      error: 'github-unavailable',
      message: `GitHub returned ${countRes.status} counting recent checks.`,
    });
  }
  const used = (await countRes.json()).total_count ?? 0;
  if (used >= WEEKLY_LIMIT) {
    return res.status(429).json({
      error: 'rate-limited', used, limit: WEEKLY_LIMIT,
      message: `${WEEKLY_LIMIT} manual checks already ran in the last 7 days.`,
    });
  }

  const dispatch = await gh(`actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref: REF }),
  });
  if (!dispatch.ok) {
    // 404 here almost always means the token can't see Actions on this repo.
    return res.status(502).json({
      error: 'dispatch-failed',
      message: `GitHub returned ${dispatch.status} starting the check.`,
    });
  }

  return res.status(202).json({
    dispatched: true,
    globalUsed: used + 1,
    globalLimit: WEEKLY_LIMIT,
    globalRemaining: Math.max(0, WEEKLY_LIMIT - (used + 1)),
  });
}
