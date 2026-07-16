// Vercel serverless function: serves files from this repo's `snapshots`
// branch to the static app. Tries anonymous raw access first (works if the
// repo is public); for a private repo set GH_SNAPSHOTS_TOKEN in the Vercel
// project env (fine-grained PAT, Contents: read-only, this repo only).

const REPO = process.env.SNAPSHOTS_REPO || 'alastairlivingston-sudo/Sleeper-app-2';
const BRANCH = 'snapshots';

export default async function handler(req, res) {
  const file = String(req.query.file || '');
  if (!/^[A-Za-z0-9_-]+\.json$/.test(file)) {
    return res.status(400).json({ error: 'bad file name' });
  }

  let upstream = await fetch(
    `https://raw.githubusercontent.com/${REPO}/${BRANCH}/data/${file}`);

  if (!upstream.ok && process.env.GH_SNAPSHOTS_TOKEN) {
    upstream = await fetch(
      `https://api.github.com/repos/${REPO}/contents/data/${file}?ref=${BRANCH}`,
      {
        headers: {
          authorization: `Bearer ${process.env.GH_SNAPSHOTS_TOKEN}`,
          accept: 'application/vnd.github.raw+json',
          'user-agent': 'spoiler-safe-sleeper',
        },
      });
  }

  if (!upstream.ok) {
    return res.status(404).json({ error: 'no snapshot data', status: upstream.status });
  }

  res.setHeader('cache-control', 'public, s-maxage=60, stale-while-revalidate=300');
  res.setHeader('content-type', 'application/json');
  return res.status(200).send(await upstream.text());
}
