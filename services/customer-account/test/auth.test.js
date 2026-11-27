import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { registerHooks } from 'node:module';
import { OAuth2Client } from 'google-auth-library';

const site = 'https://accounts.example.test';
const clientId = 'test-client.apps.googleusercontent.com';
const fixtureKey = Symbol.for('rocket.test.auth.platform');
const hash = value => createHash('sha256').update(value).digest('hex');

function memoryPlatform() {
  const records = new Map();
  return {
    records,
    digest: hash,
    randomToken: () => randomBytes(32).toString('base64url'),
    origin: () => site,
    getCookie: (req, name) => req.cookies[name],
    setCookie: (res, name, value) => { res.cookies[name] = value; },
    requirePost(req) {
      if (req.method !== 'POST' || req.headers.origin !== site) throw new Error('Forbidden');
    },
    async getJSON(key) { return records.get(key) ?? null; },
    async deleteJSON(key) { records.delete(key); },
    async putJSON(key, value) {
      assert.ok(!records.has(key), 'storage records are immutable');
      records.set(key, value);
    }
  };
}

function browser(handler) {
  const cookies = {};
  async function request(query, options = {}) {
    const req = {
      url: '/api/auth?' + new URLSearchParams(query),
      method: 'GET', headers: { host: new URL(site).host }, cookies: { ...cookies },
      ...options
    };
    const res = {
      statusCode: 200, headers: {}, cookies: {},
      setHeader(name, value) { this.headers[name] = value; },
      end() {}
    };
    await handler(req, res);
    Object.assign(cookies, res.cookies);
    return res;
  }
  return { cookies, request };
}

test('Google account flow', async t => {
  const platform = memoryPlatform();
  globalThis[fixtureKey] = platform;
  t.after(() => { delete globalThis[fixtureKey]; });
  const env = {
    GOOGLE_CLIENT_ID: clientId,
    GOOGLE_CLIENT_SECRET: 'unused-test-value',
    BLOB_READ_WRITE_TOKEN: 'unused-test-value'
  };
  for (const [key, value] of Object.entries(env)) {
    const original = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    });
  }

  // Replace only this handler's storage/platform import. The OAuth client and
  // its S256 challenge and authorization URL generation are the installed SDK.
  const authURL = new URL('../api/auth.js', import.meta.url).href;
  const shim = 'export const { deleteJSON, digest, getCookie, getJSON, origin, ' +
    'putJSON, randomToken, requirePost, setCookie } = globalThis[Symbol.for("rocket.test.auth.platform")];';
  const moduleHook = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL === authURL && specifier === '../lib/platform.js') {
        return { url: 'data:text/javascript,' + encodeURIComponent(shim), shortCircuit: true };
      }
      return nextResolve(specifier, context);
    }
  });
  t.after(() => moduleHook.deregister());
  const { default: handler } = await import(authURL);
  const sessions = () => [...platform.records].filter(([path]) => path.startsWith('sessions/'));

  let authorization;
  let claimOverrides = {};
  let rejectSignature = false;
  let exchanges = 0;
  t.mock.method(OAuth2Client.prototype, 'getToken', async function (input) {
    assert.equal(this.redirectUri, site + '/api/auth?action=callback');
    assert.equal(input.code, 'one-use-test-code');
    const expected = authorization.searchParams.get('code_challenge');
    assert.equal(createHash('sha256').update(input.codeVerifier).digest('base64url'), expected);
    exchanges += 1;
    return { tokens: { id_token: 'test.id.token' } };
  });
  t.mock.method(OAuth2Client.prototype, 'verifyIdToken', async ({ idToken, audience }) => {
    assert.equal(audience, clientId);
    assert.equal(idToken, 'test.id.token');
    if (rejectSignature) throw new Error('Test signature rejected');
    return { getPayload: () => ({
      iss: 'https://accounts.google.com', azp: clientId, sub: 'demo-subject',
      nonce: authorization.searchParams.get('nonce'), email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 180, ...claimOverrides
    }) };
  });

  async function start() {
    const agent = browser(handler);
    const result = await agent.request({ action: 'login' });
    assert.equal(result.statusCode, 303);
    authorization = new URL(result.headers.Location);
    assert.equal(authorization.origin, 'https://accounts.google.com');
    assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authorization.searchParams.get('scope'), 'openid email');
    assert.equal(authorization.searchParams.get('redirect_uri'), site + '/api/auth?action=callback');
    assert.ok(authorization.searchParams.get('nonce'));
    const state = authorization.searchParams.get('state');
    assert.ok(state);
    assert.notEqual(state, agent.cookies['__Host-rocket-oidc']);
    return { ...agent, state, callback: () => agent.request({ action: 'callback', state, code: 'one-use-test-code' }) };
  }

  await t.test('login, single-use callback, pseudonymous session and same-origin logout', async () => {
    const a = await start();
    const flowCookie = a.cookies['__Host-rocket-oidc'];
    const result = await a.callback();
    assert.equal(result.headers.Location, '/');
    assert.equal(result.headers['Cache-Control'], 'private, no-store');
    const [path, session] = sessions()[0];
    assert.equal(path, 'sessions/' + hash(a.cookies['__Host-rocket-session']) + '.json');
    assert.equal(session.owner, hash('google:demo-subject'));
    assert.deepEqual(Object.keys(session).sort(), ['expires', 'owner']);
    assert.ok(session.expires > Date.now());
    assert.equal(a.cookies['__Host-rocket-oidc'], '');
    const before = exchanges;
    const replay = await a.request({ action: 'callback', state: a.state, code: 'one-use-test-code' }, {
      cookies: { '__Host-rocket-oidc': flowCookie }
    });
    assert.equal(replay.headers.Location, '/?authError=1');
    assert.equal(exchanges, before);
    assert.equal((await a.request({ action: 'logout' })).statusCode, 405);
    const foreign = await a.request({ action: 'logout' }, { method: 'POST', headers: { origin: 'https://foreign.test' } });
    assert.equal(foreign.statusCode, 403);
    assert.equal(sessions().length, 1);
    const logout = await a.request({ action: 'logout' }, { method: 'POST', headers: { origin: site } });
    assert.equal(logout.headers.Location, '/');
    assert.equal(sessions().length, 0);
    assert.equal(a.cookies['__Host-rocket-session'], '');
  });

  await t.test('binding, state, and expiry are checked before exchange', async () => {
    const a = await start();
    const before = exchanges;
    const query = { action: 'callback', state: a.state, code: 'one-use-test-code' };
    assert.equal((await a.request(query, { cookies: {} })).headers.Location, '/?authError=1');
    assert.equal((await a.request({ ...query, state: 'x'.repeat(43) })).headers.Location, '/?authError=1');
    const flow = await platform.getJSON('auth-flows/' + hash(a.cookies['__Host-rocket-oidc']) + '.json');
    flow.expires = Date.now() - 1;
    assert.equal((await a.callback()).headers.Location, '/?authError=1');
    assert.equal(exchanges, before);
    assert.equal(sessions().length, 0);
  });

  for (const invalid of [{ iss: 'https://foreign.test' }, { nonce: 'wrong' }, { azp: 'foreign-client' }, { email_verified: false }, { exp: 1 }]) {
    await t.test('rejects invalid ' + Object.keys(invalid)[0], async () => {
      claimOverrides = invalid;
      const a = await start();
      assert.equal((await a.callback()).headers.Location, '/?authError=1');
      assert.equal(sessions().length, 0);
      claimOverrides = {};
    });
  }
  await t.test('Google SDK signature verification failure creates no session', async () => {
    rejectSignature = true;
    const a = await start();
    assert.equal((await a.callback()).headers.Location, '/?authError=1');
    assert.equal(sessions().length, 0);
    rejectSignature = false;
  });
  await t.test('request on an alternate host moves to the canonical host before writing cookies', async () => {
    const a = browser(handler);
    const result = await a.request({ action: 'login' }, { headers: { host: 'alias.example.test' } });
    assert.equal(result.headers.Location, site + '/api/auth?action=login');
    assert.deepEqual(result.cookies, {});
  });
});
