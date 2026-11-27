import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('billing validates ownership, reconciles interrupted approvals and delivers one receipt per order', async t => {
  // Run the actual handler against a private, isolated fixture module and no external services.
  const dir = await mkdtemp(path.join(tmpdir(), 'rocket-billing-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await Promise.all(['api', 'lib'].map(name => mkdir(path.join(dir, name))));
  await writeFile(path.join(dir, 'package.json'), '{"type":"module"}');
  await copyFile(new URL('../api/billing.js', import.meta.url), path.join(dir, 'api/billing.js'));
  await writeFile(path.join(dir, 'lib/platform.js'), `
    import { randomBytes } from 'node:crypto';
    export const fixture = { rows: new Map(), dropReceipt: false, mode: 'test' };
    export function problem(status, code) { return Object.assign(new Error(code), { status, code }); }
    export function json(_res, status, body) { return { status, body }; }
    export function fail(_res, e) { return { status: e.status || 500, code: e.code }; }
    export function getSession(req) { return req.user && { owner: req.user }; }
    export function randomToken() { return randomBytes(32).toString('base64url'); }
    export function readBody(req) { return req.body; }
    export function requirePost(req) {
      if (req.method !== 'POST' || req.origin !== 'local-fixture') throw problem(403, 'ORIGIN');
    }
    export function paymentConfig() {
      return { unitPrice: 100000, secretKey: 'fixture', clientKey: 'fixture', mode: fixture.mode };
    }
    export function getJSON(key) { return fixture.rows.get(key) || null; }
    export function putJSON(key, record) {
      if (key.startsWith('receipts/') && fixture.dropReceipt) {
        fixture.dropReceipt = false;
        throw problem(503, 'STORAGE');
      }
      if (fixture.rows.has(key)) throw problem(409, 'CONFLICT');
      fixture.rows.set(key, record);
    }
    export function listJSON(prefix) {
      return { items: [...fixture.rows.keys()].filter(k => k.startsWith(prefix)).sort().map(pathname => ({ pathname })), hasMore: false };
    }
  `);
  const { default: handler } = await import(pathToFileURL(path.join(dir, 'api/billing.js')).href);
  const { fixture } = await import(pathToFileURL(path.join(dir, 'lib/platform.js')).href);
  const alice = 'a'.repeat(64);
  const bob = 'b'.repeat(64);
  const ledgers = new Map();
  const submittedKeys = [];
  let disconnectAfterApproval = false;
  let currency = 'KRW';
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(new URL(url).hostname, 'api.tosspayments.com');
    const respond = (status, payload) => ({ status, json: async () => payload });
    if (options.method === 'GET') {
      const payment = ledgers.get(url.split('/').pop());
      return payment ? respond(200, payment) : respond(404, { code: 'NOT_FOUND_PAYMENT' });
    }
    const { orderId, paymentKey, amount } = JSON.parse(options.body);
    submittedKeys.push(options.headers['Idempotency-Key']);
    if (paymentKey === 'declined') return respond(400, { code: 'REJECT_CARD_COMPANY' });
    if (ledgers.has(orderId)) return respond(400, { code: 'ALREADY_PROCESSED_PAYMENT' });
    const payment = { orderId, paymentKey, totalAmount: amount, currency, status: 'DONE', approvedAt: new Date().toISOString() };
    ledgers.set(orderId, payment);
    if (disconnectAfterApproval) {
      disconnectAfterApproval = false;
      throw new Error('connection closed after acquirer approval');
    }
    return respond(200, payment);
  });
  const call = (action, body, user = alice, origin = 'local-fixture') =>
    handler({ query: { action }, body, user, origin, method: action === 'history' ? 'GET' : 'POST' }, {});
  const makeOrder = async (quantity = 1) => {
    const result = await call('order', { quantity, amount: 1 });
    assert.equal(result.status, 201);
    assert.equal(result.body.amount, quantity * 100000);
    return { orderId: result.body.orderId, amount: result.body.amount, paymentKey: 'a-payment-key' };
  };
  assert.equal((await call('history', null, null)).status, 401);
  assert.equal((await call('order', { quantity: 4 })).status, 400);
  const first = await makeOrder(2);
  assert.equal((await call('sync', first)).body.status, 'NO_APPROVAL');
  assert.equal((await call('confirm', first, bob)).status, 404);
  assert.equal((await call('confirm', first, alice, 'other-origin')).status, 403);
  assert.equal((await call('confirm', { ...first, amount: 1 })).status, 400);
  assert.equal(submittedKeys.length, 0);
  disconnectAfterApproval = true;
  assert.equal((await call('confirm', first)).body.status, 'DONE');
  assert.equal((await call('confirm', first)).body.status, 'DONE');
  assert.equal(submittedKeys.length, 1);
  assert.equal((await call('confirm', { ...first, paymentKey: 'another-key' })).status, 409);
  assert.equal((await call('history', null, bob)).body.orders.length, 0);
  const historical = (await call('history')).body.orders[0];
  assert.equal(historical.status, 'APPROVED_RECORD');
  assert.equal('paymentKey' in historical, false);
  ledgers.get(first.orderId).status = 'CANCELED';
  assert.equal((await call('sync', first)).body.status, 'CANCELED');
  const second = await makeOrder();
  fixture.dropReceipt = true;
  assert.equal((await call('confirm', second)).status, 503);
  assert.equal((await call('sync', second)).body.status, 'DONE');
  const third = await makeOrder();
  const concurrent = await Promise.all([call('confirm', third), call('confirm', third)]);
  assert.ok(concurrent.every(result => result.body.status === 'DONE'));
  const key = 'confirm-' + third.orderId;
  assert.ok(submittedKeys.filter(item => item === key).length >= 1);
  assert.equal([...fixture.rows.keys()].filter(p => p.startsWith('receipts/') && p.includes(third.orderId)).length, 1);
  const fourth = await makeOrder();
  assert.equal((await call('confirm', { ...fourth, paymentKey: 'declined' })).status, 422);
  currency = 'USD';
  assert.equal((await call('confirm', fourth)).code, 'PAYMENT_MISMATCH');
  fixture.mode = 'live';
  assert.equal((await call('confirm', first)).code, 'ORDER_MODE_UNAVAILABLE');
});
