import { OAuth2Client } from 'google-auth-library';
import {
  deleteJSON, digest, getCookie, getJSON, origin, putJSON,
  randomToken, requirePost, setCookie
} from '../lib/platform.js';

const FLOW_COOKIE = '__Host-rocket-oidc';
const SESSION_COOKIE = '__Host-rocket-session';
const FLOW_SECONDS = 600;
const SESSION_SECONDS = 60 * 60 * 8;
const validToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

function redirect(res, location) {
  res.statusCode = 303;
  res.setHeader('Location', location);
  res.end();
}

function googleClient(req) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret || !process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error('Authentication is unavailable');
  }
  const callback = new URL('/api/auth?action=callback', origin(req)).href;
  return new OAuth2Client(clientId, clientSecret, callback);
}

async function removeCookieRecord(req, name, folder) {
  const raw = getCookie(req, name);
  if (validToken(raw)) await deleteJSON(folder + '/' + digest(raw) + '.json');
}

async function login(req, res) {
  const site = new URL(origin(req));
  if (req.headers.host !== site.host) {
    return redirect(res, new URL('/api/auth?action=login', site).href);
  }
  const client = googleClient(req);
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const browserToken = randomToken();
  const state = randomToken();
  const nonce = randomToken();
  await removeCookieRecord(req, FLOW_COOKIE, 'auth-flows');
  await putJSON('auth-flows/' + digest(browserToken) + '.json', {
    state, nonce, codeVerifier, expires: Date.now() + FLOW_SECONDS * 1000
  });
  setCookie(res, FLOW_COOKIE, browserToken, FLOW_SECONDS);
  return redirect(res, client.generateAuthUrl({
    scope: ['openid', 'email'],
    access_type: 'online',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  }));
}

async function callback(req, res, params) {
  const client = googleClient(req);
  const binding = getCookie(req, FLOW_COOKIE);
  const state = params.get('state');
  if (!validToken(binding) || !validToken(state)) throw new Error('Invalid sign-in');
  const path = 'auth-flows/' + digest(binding) + '.json';
  const flow = await getJSON(path);
  if (!flow || flow.state !== state) throw new Error('Invalid sign-in');
  setCookie(res, FLOW_COOKIE, '', 0);
  await deleteJSON(path);
  const code = params.get('code');
  if (!Number.isFinite(flow.expires) || flow.expires <= Date.now() ||
      params.has('error') || !code || code.length > 4096) {
    throw new Error('Invalid sign-in');
  }

  const { tokens } = await client.getToken({ code, codeVerifier: flow.codeVerifier });
  if (!tokens.id_token) throw new Error('Invalid sign-in');
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID
  });
  const claims = ticket.getPayload();
  if (!claims || !['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss) ||
      claims.nonce !== flow.nonce ||
      (claims.azp !== undefined && claims.azp !== process.env.GOOGLE_CLIENT_ID) ||
      !(claims.email_verified === true || claims.email_verified === 'true') ||
      !Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now() ||
      typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) {
    throw new Error('Invalid Google identity');
  }

  const session = randomToken();
  const owner = digest('google:' + claims.sub);
  await removeCookieRecord(req, SESSION_COOKIE, 'sessions');
  await putJSON('sessions/' + digest(session) + '.json', {
    owner, expires: Date.now() + SESSION_SECONDS * 1000
  });
  setCookie(res, SESSION_COOKIE, session, SESSION_SECONDS);
  return redirect(res, '/');
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const params = new URL(req.url, 'https://request.invalid').searchParams;
  const action = params.get('action');
  if (!['login', 'callback', 'logout'].includes(action)) {
    res.statusCode = 404;
    return res.end();
  }
  const method = action === 'logout' ? 'POST' : 'GET';
  if (req.method !== method) {
    res.setHeader('Allow', method);
    res.statusCode = 405;
    return res.end();
  }
  if (action === 'logout') {
    try {
      requirePost(req);
    } catch {
      res.statusCode = 403;
      return res.end();
    }
    try {
      await removeCookieRecord(req, SESSION_COOKIE, 'sessions');
      await removeCookieRecord(req, FLOW_COOKIE, 'auth-flows');
      setCookie(res, SESSION_COOKIE, '', 0);
      setCookie(res, FLOW_COOKIE, '', 0);
      return redirect(res, '/');
    } catch {
      res.statusCode = 503;
      return res.end();
    }
  }
  try {
    if (action === 'login') return await login(req, res);
    return await callback(req, res, params);
  } catch {
    return redirect(res, '/?authError=1');
  }
}
