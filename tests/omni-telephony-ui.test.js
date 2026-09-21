'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'omni.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'js', 'omni-telephony-workspace.js'), 'utf8');

test('Omni telephony is an internal mode with an isolated controller and no unsafe row HTML', () => {
  assert.match(html, /data-omni-mode="telephony"/);
  assert.match(html, /id="omniTelephonyWorkspace"/);
  assert.match(html, /js\/omni-telephony-workspace\.js/);
  assert.match(script, /apiFetchWithAuthRetry/);
  assert.match(script, /getAuthHeaders/);
  assert.doesNotMatch(script, /innerHTML/);
  assert.match(script, /controller\.abort\(\)/);
  assert.match(script, /companyNumber/);
  assert.match(script, /customerNumber/);
});

function flush() { return new Promise(resolve => setImmediate(resolve)); }

function response(payload, ok = true) { return { ok, json: async () => payload }; }

function harness(t, handler, url = 'https://fixture.local/omni?businessContext=event_genix&search=inbox') {
  const dom = new JSDOM('<section id="omniTelephonyWorkspace" hidden><div id="omniTelephonyRoot"></div></section>', {
    url, runScripts: 'outside-only', pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  window.CrmBusinessContext = { current: () => window.__context || 'event_genix' };
  window.getAuthHeaders = () => ({});
  window.apiFetchWithAuthRetry = handler;
  window.eval(script);
  window.dispatchEvent(new window.CustomEvent('omni:mode', { detail: { mode: 'telephony' } }));
  return window;
}

test('telephony UI keeps Omni URL state, renders scoped summary and pages the provider result', async t => {
  const requests = [];
  const window = harness(t, async url => {
    requests.push(url);
    const request = new URL(url, 'https://fixture.local');
    if (request.pathname.endsWith('/summary')) return response({ success: true, completeness: 'complete', data: {
      total: 2, incoming: 1, outgoing: 1, missed: 0, averageWaitingSeconds: 0, averageTalkSeconds: 5,
    } });
    return response({ success: true, freshness: 'fixture', page: { cursor: request.searchParams.get('cursor') ? null : 'page-2' }, data: [{
      direction: 'incoming', status: 'completed', customerPhone: '+380000000000', companyPhone: '100',
      agent: { name: 'Тест', group: 'Група' }, waitingSeconds: 0, talkSeconds: 0, startedAt: '2026-09-20T10:00:00.000Z',
      recording: { available: true }, customer: { id: '42', name: 'Тестовий клієнт' },
    }] });
  });
  await flush(); await flush();
  assert.match(window.document.body.textContent, /Тестовий клієнт/);
  assert.match(window.document.body.textContent, /0:00/);
  assert.equal(window.document.querySelector('.omni-telephony-customer-link').getAttribute('href'), '/customers?open=42&businessContext=event_genix');
  assert.equal(window.document.querySelector('button[title*="server-side recording"]').disabled, true);
  const form = window.document.querySelector('[data-telephony-filters]');
  form.elements.agent.value = 'Олена';
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await flush(); await flush();
  assert.equal(new URL(window.location.href).searchParams.get('search'), 'inbox');
  assert.equal(new URL(window.location.href).searchParams.get('telAgent'), 'Олена');
  assert.ok(requests.some(value => value.includes('agent=%D0%9E%D0%BB%D0%B5%D0%BD%D0%B0')));
  window.document.querySelector('.omni-telephony-pagination button:last-child').click();
  await flush(); await flush();
  assert.equal(new URL(window.location.href).searchParams.get('telCursor'), 'page-2');
});

test('telephony ignores a stale response and clears it on an Omni business-context change', async t => {
  const pending = [];
  const window = harness(t, url => new Promise(resolve => pending.push({ url, resolve })));
  const release = (entry, callId) => entry.resolve(response(entry.url.includes('/summary')
    ? { success: true, completeness: 'complete', data: { total: 1, incoming: 1, outgoing: 0, missed: 0, averageWaitingSeconds: 0, averageTalkSeconds: 0 } }
    : { success: true, freshness: 'fixture', page: { cursor: null }, data: [{ callId, direction: 'incoming', status: 'completed', customerPhone: callId, recording: {} }] }));
  await flush();
  const form = window.document.querySelector('[data-telephony-filters]');
  form.elements.customerNumber.value = 'new';
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  const latest = pending.splice(-2); latest.forEach((entry, index) => release(entry, `new-${index}`));
  await flush(); await flush();
  pending.splice(0).forEach((entry, index) => release(entry, `old-${index}`));
  await flush(); await flush();
  assert.match(window.document.body.textContent, /new-/);
  assert.doesNotMatch(window.document.body.textContent, /old-/);
  window.__context = 'dar';
  window.dispatchEvent(new window.CustomEvent('omni:business-context-change'));
  await flush();
  assert.match(window.document.body.textContent, /Завантажуємо журнал/);
});

test('unconfigured Binotel gives the owner a direct settings action', async t => {
  const window = harness(t, async () => response({
    success: false,
    error: 'Binotel is not configured',
    capabilities: { historical: 'not_configured' },
  }, false));
  let settingsOpened = 0;
  window.addEventListener('omni:configure-binotel', () => { settingsOpened += 1; });
  await flush(); await flush();
  const button = [...window.document.querySelectorAll('button')].find(item => item.textContent === 'Налаштувати Binotel');
  assert.ok(button);
  button.click();
  assert.equal(settingsOpened, 1);
});
