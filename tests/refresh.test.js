// The /api/refresh endpoint: capability probe, weekly cap, dispatch. The
// browser smoke test stubs this endpoint out entirely, so its own decision
// logic is only covered here. GitHub is stubbed via globalThis.fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/refresh.js';

function fakeRes() {
  const r = { headers: {}, code: 0, body: null };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.send = r.json;
  return r;
}

/** Stub GitHub. `runs` is the total_count returned for the rate-limit query. */
function stubGitHub({ runs = 0, countOk = true, dispatchOk = true } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method || 'GET' });
    if (String(url).includes('/dispatches')) {
      return { ok: dispatchOk, status: dispatchOk ? 204 : 404, json: async () => ({}) };
    }
    return { ok: countOk, status: countOk ? 200 : 500, json: async () => ({ total_count: runs }) };
  };
  return calls;
}

const withEnv = async (env, fn) => {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try { return await fn(); } finally { process.env = saved; }
};

test('GET reports whether manual checks are configured', async () => {
  await withEnv({ GH_DISPATCH_TOKEN: '', REFRESH_WEEKLY_LIMIT: '500' }, async () => {
    const res = fakeRes();
    await handler({ method: 'GET' }, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.configured, false, 'no token ⇒ the app hides its button');
  });
  await withEnv({ GH_DISPATCH_TOKEN: 'tok' }, async () => {
    const res = fakeRes();
    await handler({ method: 'GET' }, res);
    assert.equal(res.body.configured, true);
  });
});

test('POST without a token refuses instead of pretending to work', async () => {
  await withEnv({ GH_DISPATCH_TOKEN: '' }, async () => {
    const res = fakeRes();
    await handler({ method: 'POST' }, res);
    assert.equal(res.code, 503);
    assert.equal(res.body.error, 'not-configured');
  });
});

test('POST dispatches the workflow and reports the global allowance', async () => {
  await withEnv({ GH_DISPATCH_TOKEN: 'tok', REFRESH_WEEKLY_LIMIT: '500' }, async () => {
    const calls = stubGitHub({ runs: 3 });
    const res = fakeRes();
    await handler({ method: 'POST' }, res);
    assert.equal(res.code, 202);
    assert.equal(res.body.dispatched, true);
    assert.equal(res.body.globalRemaining, 496);

    const [count, dispatch] = calls;
    assert.match(count.url, /event=workflow_dispatch/, 'scheduled runs must not count');
    assert.match(count.url, /created=%3E%3D\d{4}-\d{2}-\d{2}/, 'trailing-window filter is encoded');
    assert.equal(dispatch.method, 'POST');
    assert.match(dispatch.url, /highlights\.yml\/dispatches$/);
  });
});

test('the global weekly cap refuses once it is reached', async () => {
  await withEnv({ GH_DISPATCH_TOKEN: 'tok', REFRESH_WEEKLY_LIMIT: '500' }, async () => {
    const calls = stubGitHub({ runs: 500 });
    const res = fakeRes();
    await handler({ method: 'POST' }, res);
    assert.equal(res.code, 429);
    assert.equal(res.body.error, 'rate-limited');
    assert.equal(calls.length, 1, 'refused before dispatching anything');
  });
});

test('a GitHub failure is reported, never silently swallowed', async () => {
  await withEnv({ GH_DISPATCH_TOKEN: 'tok' }, async () => {
    stubGitHub({ countOk: false });
    const res = fakeRes();
    await handler({ method: 'POST' }, res);
    assert.equal(res.code, 502);
    assert.equal(res.body.error, 'github-unavailable');
  });
  await withEnv({ GH_DISPATCH_TOKEN: 'tok' }, async () => {
    stubGitHub({ dispatchOk: false });
    const res = fakeRes();
    await handler({ method: 'POST' }, res);
    assert.equal(res.code, 502);
    assert.equal(res.body.error, 'dispatch-failed');
  });
});

test('other verbs are rejected', async () => {
  await withEnv({ GH_DISPATCH_TOKEN: 'tok' }, async () => {
    const res = fakeRes();
    await handler({ method: 'DELETE' }, res);
    assert.equal(res.code, 405);
  });
});

test('the cap is tunable from the environment without a redeploy', async () => {
  await withEnv({ GH_DISPATCH_TOKEN: 'tok', REFRESH_WEEKLY_LIMIT: '5' }, async () => {
    const res = fakeRes();
    await handler({ method: 'GET' }, res);
    assert.equal(res.body.limit, 5);

    stubGitHub({ runs: 5 });
    const blocked = fakeRes();
    await handler({ method: 'POST' }, blocked);
    assert.equal(blocked.code, 429);
    assert.equal(blocked.body.limit, 5);

    stubGitHub({ runs: 4 });
    const allowed = fakeRes();
    await handler({ method: 'POST' }, allowed);
    assert.equal(allowed.code, 202, 'one under the cap still goes through');
    assert.equal(allowed.body.globalRemaining, 0);
  });
});
