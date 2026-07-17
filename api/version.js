// Returns the currently-deployed version so the app can tell when a newer
// build is live and offer a refresh (see js/app.js update check). Served with
// no-store so the client always sees the real deployment, never a cached value.
// On Vercel the commit SHA is injected automatically; falls back to the
// deployment id, then 'dev' for local runs.

export default function handler(req, res) {
  res.setHeader('cache-control', 'no-store, max-age=0');
  res.setHeader('content-type', 'application/json');
  res.status(200).send(JSON.stringify({
    version: process.env.VERCEL_GIT_COMMIT_SHA
      || process.env.VERCEL_DEPLOYMENT_ID
      || 'dev',
  }));
}
