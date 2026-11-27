import {
  fail, getJSON, getSession, json, listJSON, paymentConfig, problem,
  putJSON, randomToken, readBody, requirePost
} from '../lib/platform.js';

const orderPattern = /^rs_[0-9]{13}_[A-Za-z0-9_-]{43}$/;
const statuses = new Set([
  'READY', 'IN_PROGRESS', 'WAITING_FOR_DEPOSIT', 'DONE', 'CANCELED',
  'PARTIAL_CANCELED', 'ABORTED', 'EXPIRED'
]);

function orderPath(owner, id) { return 'orders/' + owner + '/' + id + '.json'; }
function receiptPath(owner, id) { return 'receipts/' + owner + '/' + id + '.json'; }

function view(order, status, approvedAt = null) {
  const { orderId, orderName, quantity, amount, mode, createdAt } = order;
  return { orderId, orderName, quantity, amount, mode, createdAt, status, approvedAt };
}

async function createOrder(owner, config, quantity) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 3) {
    throw problem(400, 'INVALID_QUANTITY');
  }
  const amount = config.unitPrice * quantity;
  if (!Number.isSafeInteger(amount) || amount < 1) throw problem(503, 'BILLING_UNAVAILABLE');
  const now = Date.now();
  // Blob lists paths in lexical order. The timestamp prefix makes new orders appear first.
  const timePrefix = String(9999999999999 - now).padStart(13, '0');
  const orderId = 'rs_' + timePrefix + '_' + randomToken();
  const order = {
    orderId, orderName: '로켓보안 웹 설정 점검 · 도메인 ' + quantity + '개',
    quantity, amount, mode: config.mode, createdAt: new Date(now).toISOString()
  };
  await putJSON(orderPath(owner, orderId), order);
  return {
    ...view(order, 'CREATED'), customerKey: 'rs_' + owner.slice(0, 40),
    clientKey: config.clientKey
  };
}

async function ownedOrder(owner, id) {
  if (typeof id !== 'string' || !orderPattern.test(id)) throw problem(400, 'INVALID_ORDER');
  const order = await getJSON(orderPath(owner, id));
  if (!order || order.orderId !== id) throw problem(404, 'ORDER_NOT_FOUND');
  return order;
}

// Only fields required for confirmation are retained, never card or account data.
async function recordApproval(owner, order, payment) {
  const path = receiptPath(owner, order.orderId);
  try {
    await putJSON(path, {
      orderId: order.orderId, amount: order.amount, mode: order.mode,
      paymentKey: payment.paymentKey, approvedAt: payment.approvedAt
    });
  } catch (error) {
    if (error.status !== 409) throw error;
    const previous = await getJSON(path);
    if (!previous || previous.orderId !== order.orderId || previous.amount !== order.amount ||
        previous.mode !== order.mode || previous.paymentKey !== payment.paymentKey) {
      throw problem(503, 'PAYMENT_RECONCILIATION_REQUIRED');
    }
  }
}

function validKey(key) {
  return typeof key === 'string' && key.length > 0 && key.length <= 200 && !/[\u0000-\u0020\u007f]/.test(key);
}

async function verifiedResult(owner, order, payment, expectedKey) {
  if (payment.orderId !== order.orderId || payment.totalAmount !== order.amount ||
      payment.currency !== 'KRW' || !validKey(payment.paymentKey) ||
      (expectedKey && payment.paymentKey !== expectedKey) || !statuses.has(payment.status)) {
    throw problem(409, 'PAYMENT_MISMATCH');
  }
  if (payment.status === 'DONE') {
    if (typeof payment.approvedAt !== 'string' || !Number.isFinite(Date.parse(payment.approvedAt))) {
      throw problem(502, 'INVALID_PROVIDER_RESPONSE');
    }
    await recordApproval(owner, order, payment);
  }
  return view(order, payment.status, payment.approvedAt || null);
}

async function toss(config, path, body, idempotencyKey) {
  const headers = {
    Authorization: 'Basic ' + Buffer.from(config.secretKey + ':', 'utf8').toString('base64')
  };
  if (body) {
    headers['Content-Type'] = 'application/json';
    headers['Idempotency-Key'] = idempotencyKey;
  }
  try {
    const response = await fetch('https://api.tosspayments.com/v1/payments/' + path, {
      method: body ? 'POST' : 'GET', headers, redirect: 'error', cache: 'no-store',
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(body ? 60000 : 10000)
    });
    return { status: response.status, payload: await response.json() };
  } catch {
    return { status: 503, payload: {} };
  }
}

async function lookup(owner, order, config, expectedKey) {
  const { status, payload } = await toss(config, 'orders/' + encodeURIComponent(order.orderId));
  if (status === 404 && ['NOT_FOUND_PAYMENT', 'NOT_FOUND'].includes(payload?.code)) return null;
  if (status !== 200 || !payload) throw problem(503, 'PAYMENT_STATUS_UNAVAILABLE');
  return verifiedResult(owner, order, payload, expectedKey);
}

async function confirm(owner, order, config, data) {
  if (!validKey(data.paymentKey) || data.amount !== order.amount) {
    throw problem(400, 'INVALID_CONFIRMATION');
  }
  const receipt = await getJSON(receiptPath(owner, order.orderId));
  if (receipt) {
    if (receipt.paymentKey !== data.paymentKey) throw problem(409, 'PAYMENT_MISMATCH');
    const current = await lookup(owner, order, config, data.paymentKey);
    if (!current) throw problem(503, 'PAYMENT_RECONCILIATION_REQUIRED');
    return current;
  }
  const request = { paymentKey: data.paymentKey, orderId: order.orderId, amount: order.amount };
  const response = await toss(config, 'confirm', request, 'confirm-' + order.orderId);
  if (response.status === 200 && response.payload) {
    return verifiedResult(owner, order, response.payload, data.paymentKey);
  }
  // A timeout, an already processed response, or a lost write can follow a bank approval.
  // Reconcile at the merchant by the stored order ID before describing it as failed.
  const recovered = await lookup(owner, order, config, data.paymentKey);
  if (recovered) return recovered;
  if (response.status >= 500 || [401, 403, 409, 429].includes(response.status)) {
    throw problem(503, 'PAYMENT_STATUS_UNAVAILABLE');
  }
  throw problem(422, 'PAYMENT_NOT_APPROVED');
}

async function history(owner, cursor) {
  if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 2048)) {
    throw problem(400, 'INVALID_CURSOR');
  }
  const prefix = 'orders/' + owner + '/';
  const page = await listJSON(prefix, 12, cursor || undefined);
  const orders = await Promise.all(page.items.map(async ({ pathname }) => {
    if (!pathname.startsWith(prefix) || !pathname.endsWith('.json')) throw problem(502, 'INVALID_ORDER_HISTORY');
    const id = pathname.slice(prefix.length, -5);
    const order = await ownedOrder(owner, id);
    const receipt = await getJSON(receiptPath(owner, id));
    return view(order, receipt ? 'APPROVED_RECORD' : 'CREATED', receipt?.approvedAt);
  }));
  return { orders, cursor: page.cursor || null, hasMore: Boolean(page.hasMore) };
}

export default async function billing(req, res) {
  try {
    const action = req.query?.action;
    if (!['history', 'order', 'confirm', 'sync'].includes(action)) throw problem(404, 'NOT_FOUND');
    if (action === 'history') {
      if (req.method !== 'GET') throw problem(405, 'METHOD_NOT_ALLOWED');
    } else {
      requirePost(req);
    }
    const session = await getSession(req);
    if (!session) throw problem(401, 'LOGIN_REQUIRED');
    const { owner } = session;
    if (action === 'history') return json(res, 200, await history(owner, req.query?.cursor));
    const config = paymentConfig();
    if (!config) throw problem(503, 'BILLING_UNAVAILABLE');
    const data = await readBody(req);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw problem(400, 'INVALID_BODY');
    if (action === 'order') return json(res, 201, await createOrder(owner, config, data.quantity));
    const order = await ownedOrder(owner, data.orderId);
    if (order.mode !== config.mode) throw problem(409, 'ORDER_MODE_UNAVAILABLE');
    if (action === 'confirm') return json(res, 200, await confirm(owner, order, config, data));
    const current = await lookup(owner, order, config);
    if (!current && await getJSON(receiptPath(owner, order.orderId))) {
      throw problem(503, 'PAYMENT_RECONCILIATION_REQUIRED');
    }
    return json(res, 200, current || view(order, 'NO_APPROVAL'));
  } catch (error) {
    return fail(res, error);
  }
}
