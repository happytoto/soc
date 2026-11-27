(() => {
  'use strict';
  const board = document.querySelector('[data-advisory-board]');
  const teaser = document.querySelector('[data-advisory-teaser]');
  const root = board || teaser;
  if (!root) return;

  const anchors = {
    kisa: { host: 'www.boho.or.kr', name: 'KISA 보호나라', dateLabel: '게시' },
    'cisa-kev': { host: 'www.cisa.gov', name: 'CISA KEV', dateLabel: '목록 등록' }
  };
  const refreshAfter = 15 * 60 * 1000;
  const staleAfter = 18 * 60 * 60 * 1000;
  const clock = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  const published = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const byId = id => document.getElementById(id);
  const elem = (tag, value) => {
    const node = document.createElement(tag);
    if (value !== undefined) node.textContent = value;
    return node;
  };
  let snapshot = null;
  let requested = 0;
  let loading = false;
  let readFailed = false;

  function safeItem(item) {
    if (!item || !Object.hasOwn(anchors, item.sourceId) || typeof item.title !== 'string' ||
        !item.title.trim() || typeof item.id !== 'string' || !Number.isFinite(Date.parse(item.publishedAt))) return false;
    try {
      const url = new URL(item.url);
      return url.protocol === 'https:' && !url.username && !url.password && !url.port && url.hostname === anchors[item.sourceId].host;
    } catch { return false; }
  }
  function readSnapshot(data) {
    if (data?.schemaVersion !== 1 || !Array.isArray(data.items) || !Array.isArray(data.sources) ||
        !Number.isFinite(Date.parse(data.checkedAt))) throw new Error('Invalid bulletin');
    const items = data.items.filter(safeItem).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    const sources = data.sources.filter(s => s && Object.hasOwn(anchors, s.id));
    if (!sources.length) throw new Error('Missing sources');
    return {checkedAt: data.checkedAt, items, sources};
  }
  function state() {
    if (!snapshot) return 'unavailable';
    const sourceReady = snapshot.sources.filter(s => s.lastSuccessAt && Number.isFinite(Date.parse(s.lastSuccessAt)));
    if (!sourceReady.length) return 'unavailable';
    if (readFailed || sourceReady.some(s => Date.now() - Date.parse(s.lastSuccessAt) > staleAfter)) return 'stale';
    if (sourceReady.length < Object.keys(anchors).length || sourceReady.some(s => s.status !== 'ok')) return 'partial';
    return 'ready';
  }
  function stamp(s) { return clock.format(new Date(s)) + ' KST'; }
  function dateLabel(item) { return anchors[item.sourceId].dateLabel + ' ' + published.format(new Date(item.publishedAt)); }
  function renderStatus() {
    const mode = state();
    root.dataset.state = mode;
    if (!snapshot) return;
    if (teaser) {
      const item = snapshot.items[0];
      if (item) {
        byId('teaser-title').textContent = item.sourceId === 'cisa-kev' ? item.id + ' · ' + item.title : item.title;
        byId('teaser-byline').textContent = anchors[item.sourceId].name + ' · ' + dateLabel(item);
      }
      byId('teaser-health').textContent = mode === 'ready' ? '' : mode === 'partial' ? '일부 출처 갱신 지연' : '갱신 확인 필요';
      return;
    }
    const labels = {ready:'공식 자료를 확인했습니다.',partial:'일부 출처의 갱신이 지연되고 있습니다.',
      stale:'갱신 지연 · 저장된 자료를 표시합니다.',unavailable:'출처에서 자료를 확인하지 못했습니다.'};
    byId('feed-status').textContent = labels[mode] + ' 마지막 수집 시도 ' + stamp(snapshot.checkedAt);
    const output = byId('source-times');
    output.replaceChildren();
    for (const key of Object.keys(anchors)) {
      const source = snapshot.sources.find(s => s.id === key);
      const line = elem('div');
      line.append(elem('dt', anchors[key].name), elem('dd', source?.lastSuccessAt && Number.isFinite(Date.parse(source.lastSuccessAt))
        ? '마지막 성공 ' + stamp(source.lastSuccessAt) + (source.status === 'ok' ? '' : ' · 이번 확인 실패') : '성공 기록 없음'));
      output.append(line);
    }
  }
  function renderList() {
    if (!board || !snapshot) return;
    const search = byId('feed-query').value.trim().toLocaleLowerCase('ko-KR');
    const source = byId('feed-source').value;
    const list = byId('feed-list');
    const items = snapshot.items.filter(item => (source === 'all' || item.sourceId === source) &&
      [item.title,item.id,item.vendor,item.product].filter(Boolean).join(' ').toLocaleLowerCase('ko-KR').includes(search));
    const fragment = document.createDocumentFragment();
    for (const item of items) {
      const entry = elem('li');
      const label = elem('p', anchors[item.sourceId].name + ' · ' + dateLabel(item));
      label.className = 'item-byline';
      const link = elem('a', item.sourceId === 'cisa-kev' ? item.id + ' · ' + item.title : item.title);
      link.href = item.url;
      link.rel = 'external noreferrer';
      entry.append(label, link);
      fragment.append(entry);
    }
    list.replaceChildren(fragment);
    byId('feed-result').textContent = items.length ? '표시한 자료 ' + items.length + '건'
      : snapshot.items.length ? '일치하는 자료가 없습니다. 제품명이나 CVE 번호를 바꾸거나 전체 출처를 선택해 보세요.'
      : '표시할 자료가 없습니다. 아래 기관 원문에서 확인하세요.';
  }
  async function refresh() {
    if (loading || document.hidden) return;
    loading = true;
    requested = Date.now();
    try {
      const response = await fetch(root.dataset.feedUrl, {cache: 'no-cache', credentials: 'omit', signal: AbortSignal.timeout(12000)});
      if (!response.ok) throw new Error('Unavailable');
      snapshot = readSnapshot(await response.json());
      readFailed = false;
      if (board) byId('feed-filters').hidden = false;
      renderList();
    } catch {
      readFailed = true;
      if (!snapshot && board) {
        byId('feed-status').textContent = '자료를 불러오지 못했습니다. 아래 기관 원문을 이용하거나 다시 확인해 주세요.';
        byId('feed-result').textContent = '';
      }
      if (!snapshot && teaser) byId('teaser-health').textContent = '갱신 확인 필요';
    } finally {
      loading = false;
      renderStatus();
    }
  }
  if (board) {
    byId('feed-query').addEventListener('input', renderList);
    byId('feed-source').addEventListener('change', renderList);
    byId('retry-feed').addEventListener('click', refresh);
    byId('retry-feed').hidden = false;
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - requested >= refreshAfter) refresh();
  });
  window.setInterval(refresh, refreshAfter);
  refresh();
})();
