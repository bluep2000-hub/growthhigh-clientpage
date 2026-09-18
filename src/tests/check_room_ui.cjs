// Run: node src/tests/check_room_ui.cjs
// Exercise the real pin click handler with network success/failure and rapid clicks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
const start = html.indexOf('  function bindRoom(){');
const end = html.indexOf('  /* 소통 내역', start);
assert(start >= 0 && end > start);

function page(call) {
  const buttons = ['https://example.com/a', 'https://example.com/b'].map(url => ({
    dataset: {drpin: url}, disabled: false,
  }));
  const company = {};
  const state = {
    document: {querySelector: () => null,
      querySelectorAll: selector => selector === '[data-drpin]' ? buttons : []},
    ED: {call}, CLIENT: 'test-client', drPins: [], CO: company, D: {company},
    SKEY: 'test-cache', sessionStorage: {setItem: (_, value) => state.cache = JSON.parse(value)},
    drShow: () => {}, alert: message => state.alerts.push(message), alerts: [],
  };
  vm.runInNewContext(html.slice(start, end) + '\nbindRoom();', state);
  return {state, buttons};
}
const event = {preventDefault() {}, stopPropagation() {}};

(async () => {
  let finish, calls = 0;
  const {state, buttons} = page(() => {
    calls++;
    return new Promise(resolve => finish = resolve);
  });
  const saving = buttons[0].onclick(event);
  assert(buttons.every(b => b.disabled), 'all pins must wait for the current save');
  await buttons[1].onclick(event);
  assert.equal(calls, 1, 'rapid clicks must not overwrite the whole Notion pin list');
  finish({rebuild: 'sent'});
  await saving;
  assert.deepEqual(state.cache.company.pinned_links, ['https://example.com/a']);
  assert(buttons.every(b => !b.disabled));

  const failed = page(async () => { throw {status: 500}; });
  await failed.buttons[0].onclick(event);
  assert.equal(failed.state.drPins.length, 0, 'failed saves must roll back the optimistic pin');
  assert.equal(failed.state.cache, undefined);
  assert.equal(failed.state.alerts.length, 1);
  assert(failed.buttons.every(b => !b.disabled));

  const rebuild = page(async () => ({rebuild: 'failed'}));
  await rebuild.buttons[0].onclick(event);
  assert.deepEqual(rebuild.state.cache.company.pinned_links, ['https://example.com/a']);
  assert(rebuild.state.alerts[0].includes('고정은 저장됐지만'));
  console.log('Room UI checks passed: rapid clicks, cached success, rollback, rebuild warning');
})().catch(error => { console.error(error); process.exitCode = 1; });
