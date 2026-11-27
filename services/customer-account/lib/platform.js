import { createHash, randomBytes } from 'node:crypto';
import { del, get, list, put } from '@vercel/blob';

export function problem(status, code) {
  return Object.assign(new Error(code), { status, code });
}

export function json(res, status, payload) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(status).json(payload);
}

export function fail(res, error) {
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 503;
  const code = error?.message === error?.code && /^[a-z0-9_]{1,70}$/i.test(error.code) ? error.code : 'service_unavailable';
  return json(res, status, { error: code });
}

export function origin() {
  const fallback = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  const value = process.env.ROCKET_ORIGIN || (fallback ? 'https://' + fallback : '');
  let address;
  try { address = new URL(value); } catch { throw problem(503, 'origin_unconfigured'); }
  if (address.protocol !== 'https:' || address.username || address.password || address.pathname !== '/' || address.search || address.hash) {
    throw problem(503, 'origin_unconfigured');
  }
  return address.origin;
}

export function requirePost(req) {
  if (req.method !== 'POST') throw problem(405, 'method_not_allowed');
  if (req.headers.origin !== origin()) throw problem(403, 'origin_mismatch');
}

export function readBody(req) {
  if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw problem(415, 'json_required');
  let data = req.body;
  if (Buffer.isBuffer(data)) data = data.toString('utf8');
  if (typeof data === 'string') {
    if (Buffer.byteLength(data) > 16384) throw problem(413, 'body_too_large');
    try { data = JSON.parse(data); } catch { throw problem(400, 'invalid_json'); }
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw problem(400, 'invalid_json');
  if (Buffer.byteLength(JSON.stringify(data)) > 16384) throw problem(413, 'body_too_large');
  return data;
}

export const randomToken = () => randomBytes(32).toString('base64url');
export const digest = value => createHash('sha256').update(value, 'utf8').digest('hex');

export function getCookie(req, name) {
  const prefix = name + '=';
  const item = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(prefix));
  return item ? item.slice(prefix.length) : '';
}

export function setCookie(res, name, value, maxAge) {
  const previous = res.getHeader('Set-Cookie');
  const cookies = previous ? (Array.isArray(previous) ? previous : [previous]) : [];
  cookies.push(name + '=' + value + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + Math.max(0, Math.floor(maxAge)));
  res.setHeader('Set-Cookie', cookies);
}

export async function getJSON(pathname) {
  const result = await get(pathname, { access: 'private', useCache: false });
  if (!result) return null;
  if (result.statusCode !== 200 || !result.stream) throw problem(503, 'storage_unavailable');
  return new Response(result.stream).json();
}

export async function putJSON(pathname, value) {
  try {
    await put(pathname, JSON.stringify(value), { access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json' });
  } catch (error) {
    // A concurrent writer or a retry after a lost response may already have created this record.
    if (await getJSON(pathname) !== null) throw problem(409, 'record_exists');
    throw error;
  }
}

export async function deleteJSON(pathname) { await del(pathname); }

export async function listJSON(prefix, limit = 20, cursor) {
  const page = await list({ prefix, limit: Math.max(1, Math.min(100, limit)), ...(cursor ? {cursor} : {}) });
  return { items: page.blobs.map(({ pathname, uploadedAt }) => ({ pathname, uploadedAt })), cursor: page.cursor, hasMore: page.hasMore };
}

export async function getSession(req) {
  const raw = getCookie(req, '__Host-rocket-session');
  if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
  const session = await getJSON('sessions/' + digest(raw) + '.json');
  if (!session || !Number.isFinite(session.expires) || session.expires <= Date.now() || !/^[a-f0-9]{64}$/.test(session.owner)) return null;
  return session;
}

export function paymentConfig() {
  const clientKey = (process.env.TOSS_CLIENT_KEY || '').trim();
  const secretKey = (process.env.TOSS_SECRET_KEY || '').trim();
  const ck = /^(test|live)_ck_[A-Za-z0-9_-]+$/.exec(clientKey);
  const sk = /^(test|live)_sk_[A-Za-z0-9_-]+$/.exec(secretKey);
  if (!ck || !sk || ck[1] !== sk[1]) return null;
  const source = process.env.ROCKET_UNIT_PRICE_KRW || (ck[1] === 'test' ? '100000' : '');
  const unitPrice = Number(source);
  if (!/^[1-9]\d*$/.test(source) || !Number.isSafeInteger(unitPrice * 3) || unitPrice * 3 > 999999999) return null;
  return { clientKey, secretKey, mode: ck[1], unitPrice };
}
