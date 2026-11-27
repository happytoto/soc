'use strict';

const el = id => document.getElementById(id);
const money = value => new Intl.NumberFormat('ko-KR', {style: 'currency', currency: 'KRW'}).format(value);
const date = new Intl.DateTimeFormat('ko-KR', {dateStyle: 'medium', timeZone: 'Asia/Seoul'});
const validAmount = value => Number.isSafeInteger(value) && value > 0;
const validOrder = id => typeof id === 'string' && /^[A-Za-z0-9_=-]{6,64}$/.test(id);
const statusNames = {
  APPROVED_RECORD: '승인 기록', CREATED: '주문 생성', DONE: '승인 완료', CANCELED: '취소 완료', PARTIAL_CANCELED: '부분 취소',
  ABORTED: '승인 중단', EXPIRED: '결제 기한 만료', IN_PROGRESS: '진행 중', READY: '결제 대기',
  WAITING_FOR_DEPOSIT: '입금 대기', NO_APPROVAL: '승인 내역 없음'
};
let account = null;
let cursor = null;
let sdkLoad = null;
let confirming = false;
let historyEpoch = 0;
let accountEpoch = 0;
const params = new URLSearchParams(location.search);
let pending = null;
if (params.get('payment') === 'success') {
  const payKey = params.get('paymentKey') || '';
  const id = params.get('orderId');
  const amount = params.get('amount') || '';
  if (validOrder(id) && /^[A-Za-z0-9_-]{1,200}$/.test(payKey) && /^[1-9]\d{0,12}$/.test(amount) &&
      ['orderId','paymentKey','amount','payment'].every(key => params.getAll(key).length === 1)) {
    pending = {orderId: id, paymentKey: payKey, amount: Number(amount)};
  }
}
function setReturn(title, message) {
  el('return-panel').hidden = false;
  el('return-title').textContent = title;
  el('return-status').textContent = message;
}
function clearReturnUrl() {
  history.replaceState(null, '', location.pathname);
}
if (params.get('payment') === 'fail') {
  setReturn('결제가 완료되지 않았습니다', params.get('code') === 'PAY_PROCESS_CANCELED'
    ? '결제창에서 취소했습니다. 다시 결제하려면 주문 내역을 확인한 뒤 이용권을 선택하세요.'
    : '카드 인증을 끝내지 못했습니다. 주문 내역에서 처리 상태를 확인할 수 있습니다.');
  clearReturnUrl();
} else if (params.get('payment') === 'success' && !pending) {
  setReturn('결제 정보를 확인해 주세요', '결제창에서 전달받은 정보가 불완전합니다. 내 주문 내역에서 해당 주문의 현재 상태를 확인하세요.');
  clearReturnUrl();
} else if (pending) {
  setReturn('결제 결과 확인', '주문과 승인 정보를 확인하고 있습니다.');
}
async function api(path, body) {
  const options = {method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store'};
  if (body !== undefined) {
    options.headers = {'Content-Type': 'application/json'};
    options.body = JSON.stringify(body);
  }
  const res = await fetch(path, options);
  if (!res.ok) {
    const err = new Error('request');
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return {};
  return res.json();
}
function updateSum() {
  if (!validAmount(account?.unitPrice)) return;
  const amount = account.unitPrice * Number(el('qty').value);
  el('sum').textContent = money(amount);
  el('buy').textContent = (account.mode === 'test' ? '테스트 결제창 열기' : '실제 결제창 열기') + ' · ' + money(amount);
}
function renderAccount() {
  const signed = account?.authenticated === true;
  el('login').hidden = signed || !account?.googleReady || Boolean(pending);
  el('logout').hidden = !signed || Boolean(pending);
  el('refresh').hidden = signed && account.billingReady && !pending;
  el('relogin').hidden = !pending || signed || !account?.googleReady;
  el('retry-confirm').hidden = !pending;
  el('history').hidden = !signed;
  if (!signed) {
    historyEpoch++;
    cursor = null;
    el('orders').replaceChildren();
    el('more').hidden = true;
  }
  el('account-title').textContent = signed ? '내 계정' : '로그인';
  el('account-status').textContent = !account ? '연결 상태를 확인하지 못했습니다. 잠시 후 다시 시도하세요.'
    : signed ? 'Google 계정으로 로그인했습니다.'
    : account.googleReady ? 'Google 계정으로 로그인하면 주문 내역을 볼 수 있습니다.' : 'Google 로그인 연결을 준비하고 있습니다. 아래에서 샘플 포털을 체험할 수 있습니다.';
  const orderReady = Boolean(account?.billingReady && ['test','live'].includes(account.mode) && validAmount(account.unitPrice));
  el('order').hidden = !signed || !orderReady || Boolean(pending);
  el('billing-status').textContent = !account ? '연결을 복구하면 이용권 정보를 확인할 수 있습니다.'
    : !orderReady ? '온라인 결제 연결을 준비하고 있습니다. 서비스 신청은 운영팀에 문의해 주세요.'
    : pending ? '이전 결제의 승인 결과를 먼저 확인하세요.'
    : (account.mode === 'test' ? '테스트 결제 · 실제 청구 없음' : '실제 결제 · 승인하면 카드에 청구됩니다.') + ' / 도메인당 ' + money(account.unitPrice) + (signed ? '' : ' / 로그인 후 주문할 수 있습니다.');
  updateSum();
}
async function refreshAccount(confirmReturn = false) {
  const version = ++accountEpoch;
  try {
    const next = await api('/api/account');
    if (version !== accountEpoch) return;
    account = next;
  } catch {
    if (version !== accountEpoch) return;
    account = null;
  }
  renderAccount();
  if (pending && confirmReturn && account?.authenticated) await confirmPayment();
  else if (pending && !account?.authenticated) {
    setReturn('결제 승인을 이어서 확인하세요', account?.googleReady
      ? '새 탭에서 주문한 Google 계정으로 로그인하고 이 탭으로 돌아와 승인 결과를 다시 확인하세요.'
      : '이 탭을 열어 둔 채 계정 연결 상태를 새로고침하세요.');
  }
  if (account?.authenticated) await listHistory(false);
}
async function confirmPayment() {
  if (!pending || confirming || !account?.authenticated) return;
  confirming = true;
  el('retry-confirm').disabled = true;
  el('return-status').textContent = '승인 결과를 확인하고 있습니다.';
  try {
    const receipt = await api('/api/billing?action=confirm', pending);
    if (receipt.status !== 'DONE' || receipt.orderId !== pending.orderId || receipt.amount !== pending.amount) throw new Error('receipt');
    const label = receipt.mode === 'test' ? '테스트 결제 승인' : '결제 승인 완료';
    setReturn(label, receipt.orderName + ' · ' + money(receipt.amount) + ' · 주문번호 ' + receipt.orderId);
    pending = null;
    clearReturnUrl();
    renderAccount();
  } catch (err) {
    if (err.status === 401) {
      account = {...account, authenticated: false};
      renderAccount();
      setReturn('로그인이 필요합니다', '새 탭에서 주문한 Google 계정으로 로그인하고 이 탭으로 돌아와 다시 확인하세요.');
    } else {
      setReturn('승인 결과 확인이 필요합니다', '중복 결제를 피하려면 승인 결과를 다시 확인하거나 내 주문 내역에서 현재 상태를 조회하세요.');
    }
  } finally {
    confirming = false;
    el('retry-confirm').disabled = false;
  }
}
function getSdk() {
  if (typeof window.TossPayments === 'function') return Promise.resolve(window.TossPayments);
  if (!sdkLoad) {
    sdkLoad = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://js.tosspayments.com/v2/standard';
      script.referrerPolicy = 'no-referrer';
      script.onload = () => typeof window.TossPayments === 'function' ? resolve(window.TossPayments) : reject(new Error('sdk'));
      script.onerror = () => {script.remove(); reject(new Error('sdk'));};
      document.head.append(script);
    }).catch(err => {sdkLoad = null; throw err;});
  }
  return sdkLoad;
}
el('order').addEventListener('submit', async event => {
  event.preventDefault();
  const button = el('buy');
  if (button.disabled || pending || !account?.authenticated || !account.billingReady) return;
  const qty = Number(el('qty').value);
  if (![1,2,3].includes(qty) || !validAmount(account.unitPrice)) return;
  const expected = qty * account.unitPrice;
  const mode = account.mode;
  button.disabled = true;
  el('qty').disabled = true;
  el('checkout-status').textContent = '결제창을 준비하고 있습니다.';
  try {
    const toss = await getSdk();
    const order = await api('/api/billing?action=order', {quantity: qty});
    if (order.amount !== expected || order.mode !== mode) {
      await refreshAccount();
      el('checkout-status').textContent = '주문 조건이 변경되었습니다. 현재 금액과 결제 모드를 확인한 후 다시 주문하세요.';
      return;
    }
    if (!validOrder(order.orderId) || !order.clientKey || !order.customerKey || !order.orderName) throw new Error('order');
    const payment = toss(order.clientKey).payment({customerKey: order.customerKey});
    await payment.requestPayment({
      method: 'CARD', amount: {value: order.amount, currency: 'KRW'},
      orderId: order.orderId, orderName: order.orderName,
      successUrl: location.origin + '/?payment=success', failUrl: location.origin + '/?payment=fail',
      windowTarget: 'self'
    });
    el('checkout-status').textContent = '내 주문 내역에서 처리 상태를 확인할 수 있습니다.';
  } catch (err) {
    el('checkout-status').textContent = err.status === 401 ? '다시 로그인한 뒤 주문해 주세요.'
      : err.code === 'USER_CANCEL' ? '결제창을 닫았습니다.' : '결제창을 열지 못했습니다. 연결과 주문 내역을 확인해 주세요.';
    if (err.status === 401) await refreshAccount();
  } finally {
    button.disabled = false;
    el('qty').disabled = false;
  }
});
function make(tag, text, cls) {
  const e = document.createElement(tag);
  e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
function renderOrder(order) {
  const row = document.createElement('li');
  const timestamp = new Date(order.createdAt);
  const created = Number.isFinite(timestamp.getTime()) ? date.format(timestamp) : '';
  const label = order.mode === 'test' ? '테스트' : '실제';
  row.append(make('h3', order.orderName), make('p', money(order.amount) + ' / ' + label + ' / ' + (statusNames[order.status] || '주문 기록')),
    make('p', [created, '주문번호 ' + order.orderId].filter(Boolean).join(' · '), 'meta'));
  const lookup = make('button', '현재 결제 상태 조회');
  lookup.type = 'button';
  const result = make('p', '', 'feedback');
  result.setAttribute('role','status');
  lookup.onclick = async () => {
    lookup.disabled = true;
    try {
      const current = await api('/api/billing?action=sync', {orderId: order.orderId});
      result.textContent = '조회 결과 · ' + (statusNames[current.status] || '상태 확인 필요');
      if (pending && !confirming && current.orderId === pending.orderId && current.amount === pending.amount &&
          ['DONE','CANCELED','PARTIAL_CANCELED','EXPIRED','ABORTED'].includes(current.status)) {
        setReturn('결제 조회 결과', statusNames[current.status] + ' · 주문번호 ' + current.orderId);
        pending = null;
        clearReturnUrl();
        renderAccount();
      }
    } catch (err) {
      result.textContent = '상태를 가져오지 못했습니다. 잠시 후 다시 조회하세요.';
      if (err.status === 401) await refreshAccount();
    } finally {lookup.disabled = false;}
  };
  row.append(lookup,result);
  return row;
}
async function listHistory(append) {
  if (!account?.authenticated) return;
  const version = ++historyEpoch;
  if (!append) {
    cursor = null;
    el('orders').replaceChildren();
  }
  el('load-history').disabled = true;
  el('more').disabled = true;
  el('history-status').textContent = '주문 내역을 불러오는 중입니다.';
  try {
    const suffix = append && cursor ? '&cursor=' + encodeURIComponent(cursor) : '';
    const data = await api('/api/billing?action=history' + suffix);
    if (version !== historyEpoch) return;
    if (!Array.isArray(data.orders)) throw new Error('history');
    for (const o of data.orders) el('orders').append(renderOrder(o));
    cursor = data.hasMore && data.cursor ? data.cursor : null;
    el('history-status').textContent = el('orders').children.length ? '주문 당시 기록입니다. 결제 취소 등 최신 상태는 주문별로 조회하세요.' : '아직 생성된 주문이 없습니다.';
  } catch (err) {
    if (version !== historyEpoch) return;
    el('history-status').textContent = '주문 내역을 가져오지 못했습니다. 잠시 후 다시 조회하세요.';
    if (err.status === 401) {account = {...account, authenticated: false}; renderAccount();}
  } finally {
    if (version === historyEpoch) {
      el('more').hidden = !cursor;
      el('load-history').disabled = false;
      el('more').disabled = false;
    }
  }
}
el('qty').onchange = updateSum;
el('retry-confirm').onclick = () => refreshAccount(true);
el('refresh').onclick = () => refreshAccount(false);
el('load-history').onclick = () => listHistory(false);
el('more').onclick = () => listHistory(true);
el('logout').onclick = async () => {
  el('logout').disabled = true;
  try {
    await api('/api/auth?action=logout', {});
    await refreshAccount();
  } catch {
    el('account-status').textContent = '로그아웃을 확인하지 못했습니다. 다시 시도하세요.';
  } finally {el('logout').disabled = false;}
};
refreshAccount(true);
