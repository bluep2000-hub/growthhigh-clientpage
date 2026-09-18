// Run: node src/tests/check_room_rebuild_ui.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
const start = html.indexOf('  let roomRebuildBusy =');
const uiEnd = html.indexOf('  /* A — 본문 화면', start);
const bindStart = html.indexOf('  function bindRoom(){');
const bindEnd = html.indexOf('  /* 소통 내역', bindStart);
assert(start >= 0 && uiEnd > start && bindEnd > bindStart);

function page(call) {
  const button = {disabled: false}, result = {}, check = {hidden: true};
  let token = true, timeout, cleared = false;
  const state = {
    CLIENT: 'whiffkorea', SAMPLE: false, EDITQ: true,
    ED: {can: () => true, on: () => token, call},
    editSwitch: force => {state.forceAuth = force; return '<span>담당자 편집</span>';}, esc: s => s,
    AbortController,
    setTimeout: (fn, ms) => { assert.equal(ms, 30000); timeout = fn; return 1; },
    clearTimeout: () => { cleared = true; },
    EKEY: 'test-editor', sessionStorage: {removeItem: key => { assert.equal(key, state.EKEY); token = false; }},
    go: view => { assert.equal(view, 'room'); state.reauthenticated = true; },
    document: {querySelector: selector => ({'[data-room-rebuild]': button,
      '[data-room-result]': result, '[data-room-check]': check}[selector] || null),
      querySelectorAll: () => []},
  };
  vm.runInNewContext(html.slice(start, uiEnd) + html.slice(bindStart, bindEnd) + '\nbindRoom();', state);
  return {state, button, result, check, timeout: () => timeout(), cleared: () => cleared,
    logout: () => token = false};
}

(async () => {
  let finish, calls = 0;
  const p = page(async (method, route, body, signal) => {
    assert.equal(method, 'POST'); assert.equal(route, '/room/rebuild');
    assert.equal(body.slug, 'whiffkorea'); assert(signal instanceof AbortSignal);
    calls++; return new Promise(resolve => finish = resolve);
  });
  const pending = p.button.onclick();
  assert(p.button.disabled); await p.button.onclick(); assert.equal(calls, 1);
  assert(p.state.roomRebuildUi().includes(' disabled'), 'navigation must preserve pending state');
  finish({rebuild: 'sent'}); await pending;
  assert(!p.button.disabled && p.cleared());
  assert(p.result.textContent.includes('반영 요청을 보냈습니다'));
  assert(!p.check.hidden);
  assert(p.state.roomRebuildUi().includes('target="_blank" rel="noopener"'));

  for (const rebuild of ['failed', 'skipped']) {
    const failure = page(async () => ({rebuild}));
    await failure.button.onclick();
    assert(failure.result.textContent.includes('시작하지 못했습니다'));
    assert(failure.check.hidden && !failure.button.disabled);
    await failure.button.onclick(); // manual retry remains available
  }
  for (const response of [null, {}]) {
    const lost = page(async () => response); await lost.button.onclick();
    assert(lost.result.textContent.includes('결과를 확인하지 못했습니다'));
  }
  const timed = page((_, __, ___, signal) => new Promise((resolve, reject) =>
    signal.addEventListener('abort', () => reject(Object.assign(new Error(), {name: 'AbortError'})))));
  const waiting = timed.button.onclick(); timed.timeout(); await waiting;
  assert(timed.result.textContent.includes('결과를 확인하지 못했습니다'));
  assert(!timed.button.disabled && !timed.check.hidden);
  const network = page(async () => { throw new TypeError('network'); });
  await network.button.onclick(); assert(network.result.textContent.includes('결과를 확인하지 못했습니다'));
  const expired = page(async () => { throw {status: 401}; }); await expired.button.onclick();
  assert(expired.state.reauthenticated && expired.result.textContent.includes('다시 인증'));
  assert(!expired.state.roomRebuildUi().includes('data-room-rebuild'));
  const expiredWithoutQuery = page(async () => { throw {status: 401}; });
  expiredWithoutQuery.state.EDITQ = false; await expiredWithoutQuery.button.onclick();
  assert(expiredWithoutQuery.state.roomRebuildUi().includes('다시 인증'));
  assert(expiredWithoutQuery.state.forceAuth, 'cached editor must be able to reauthenticate without ?edit');

  const hidden = page(async () => ({rebuild: 'sent'}));
  hidden.state.EDITQ = false; hidden.logout(); assert.equal(hidden.state.roomRebuildUi(), '');
  hidden.state.EDITQ = true; hidden.state.SAMPLE = true; assert.equal(hidden.state.roomRebuildUi(), '');
  hidden.state.SAMPLE = false; hidden.state.CLIENT = 'studiolb'; assert.equal(hidden.state.roomRebuildUi(), '');
  console.log('Room rebuild UI checks passed: visibility, pending, retry, auth, timeout, unknown result');
})().catch(error => { console.error(error); process.exitCode = 1; });
