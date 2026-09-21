'use strict';

(() => {
  const root = document.getElementById('omniTelephonyRoot');
  const panel = document.getElementById('omniTelephonyWorkspace');
  if (!root || !panel) return;

  const VIEWS = [
    ['all', 'Усі', true], ['incoming', 'Вхідні', true], ['outgoing', 'Вихідні', true], ['missed', 'Втрачені', true],
    ['agent', 'За співробітником', true], ['number', 'За номером', true],
    ['live', 'Просто зараз', false], ['queues', 'Моніторинг черг', false],
  ];
  const FILTERS = [
    ['startDate', 'Від', 'date', 'telStartDate'], ['endDate', 'До', 'date', 'telEndDate'],
    ['agent', 'Співробітник', 'text', 'telAgent'], ['companyNumber', 'Номер компанії', 'text', 'telCompanyNumber'],
    ['customerNumber', 'Номер клієнта', 'text', 'telCustomerNumber'],
  ];
  const STATUS = { ringing: 'Дзвонить', answered: 'Відповіли', missed: 'Пропущений', completed: 'Завершений', unknown: 'Невідомо' };
  const DIRECTION = { incoming: 'Вхідний', outgoing: 'Вихідний', unknown: 'Невідомий' };
  const state = {
    active: false, request: null, requestId: 0, context: null, view: 'all', filters: {},
    page: { cursor: null, previous: null, next: null }, result: null, summary: null,
    summaryError: null, loading: false, error: null, capability: null,
  };

  const currentContext = () => window.CrmBusinessContext?.current?.() || 'event_genix';
  const isHistorical = view => VIEWS.find(item => item[0] === view)?.[2] === true;
  const text = value => value === null || value === undefined || value === '' ? '—' : String(value);
  const label = (value, labels) => labels[String(value || '').toLowerCase()] || 'Невідомо';
  const duration = value => {
    if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—';
    const seconds = Math.max(0, Math.floor(Number(value)));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  };
  const today = () => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date()).reduce((out, part) => ({ ...out, [part.type]: part.value }), {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const formatTime = value => {
    if (!value || Number.isNaN(new Date(value).getTime())) return '—';
    return new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
  };

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function el(name, props = {}, children = []) {
    const node = document.createElement(name);
    Object.entries(props).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      if (key === 'text') node.textContent = value;
      else if (key === 'className') node.className = value;
      else if (key.startsWith('aria-') || key.startsWith('data-')) node.setAttribute(key, String(value));
      else if (key in node) node[key] = value;
      else node.setAttribute(key, String(value));
    });
    children.filter(Boolean).forEach(child => node.append(child));
    return node;
  }

  function initialFilters() {
    const params = new URLSearchParams(window.location.search);
    const values = {};
    FILTERS.forEach(([name, , , param]) => { values[name] = params.get(param) || ''; });
    values.startDate ||= today(); values.endDate ||= today(); values.status = params.get('telStatus') || '';
    return values;
  }

  function restoreLocation() {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('telView');
    state.view = VIEWS.some(item => item[0] === requested) ? requested : 'all';
    state.filters = initialFilters();
    state.page = { cursor: params.get('telCursor') || null, previous: null, next: null };
  }

  function writeLocation({ push = false } = {}) {
    const url = new URL(window.location.href);
    url.searchParams.set('telView', state.view);
    FILTERS.forEach(([name, , , param]) => {
      if (state.filters[name]) url.searchParams.set(param, state.filters[name]); else url.searchParams.delete(param);
    });
    if (state.filters.status) url.searchParams.set('telStatus', state.filters.status); else url.searchParams.delete('telStatus');
    if (state.page.cursor) url.searchParams.set('telCursor', state.page.cursor); else url.searchParams.delete('telCursor');
    const next = `${url.pathname}?${url.searchParams}${url.hash}`;
    if (push) window.history.pushState({ telephony: true }, '', next);
    else window.history.replaceState({ telephony: true }, '', next);
  }

  function readForm() {
    const form = root.querySelector('[data-telephony-filters]');
    if (!form) return { ...state.filters };
    const data = new FormData(form); const values = {};
    FILTERS.forEach(([name]) => { values[name] = String(data.get(name) || '').trim(); });
    values.status = String(data.get('status') || '').trim();
    return values;
  }

  function abortRequest() {
    if (state.request) state.request.controller.abort();
    state.request = null;
  }

  function unsupportedMessage(view) {
    return view === 'queues'
      ? 'Моніторинг черг недоступний: Binotel ще не надав підтверджений API та права акаунта для цього зрізу.'
      : 'Поточні дзвінки недоступні: Binotel ще не надав live-read API, ліміти та права акаунта.';
  }

  function capabilityMessage(payload) {
    const capability = payload?.capabilities?.historical || payload?.capabilities?.live || payload?.capabilities?.queues;
    if (capability === 'not_configured') return 'Телефонія не налаштована для цього бізнесу.';
    if (capability === 'unsupported_capability') return 'Ця можливість ще не підтверджена для Binotel-акаунта.';
    return payload?.error || 'Телефонія тимчасово недоступна.';
  }

  async function fetchJson(path, request) {
    const response = await apiFetchWithAuthRetry(path, {
      headers: { ...getAuthHeaders(false), 'X-Business-Context': request.context }, signal: request.controller.signal,
    });
    if (!response) throw new Error('SESSION_UNAVAILABLE');
    return { ok: response.ok, payload: await response.json().catch(() => null) };
  }

  function isCurrent(request) {
    return state.active && state.request?.id === request.id && !request.controller.signal.aborted && currentContext() === request.context;
  }

  function requestQuery(cursor) {
    const params = new URLSearchParams();
    Object.entries(state.filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    params.set('view', state.view); params.set('limit', '50'); if (cursor) params.set('cursor', cursor);
    return params;
  }

  async function load({ cursor = null, previous = null, push = false, useStateFilters = false } = {}) {
    if (!state.active) return;
    if (!useStateFilters) state.filters = readForm();
    state.page = { cursor, previous, next: null }; writeLocation({ push });
    abortRequest();
    if (!isHistorical(state.view)) {
      state.loading = false; state.result = null; state.summary = null; state.error = null; state.capability = unsupportedMessage(state.view); render();
      return;
    }
    const request = { id: ++state.requestId, context: currentContext(), controller: new AbortController() };
    state.request = request; state.context = request.context; state.loading = true; state.error = null; state.capability = null;
    state.result = null; state.summary = null; state.summaryError = null; render();
    const callsQuery = requestQuery(cursor); const summaryQuery = new URLSearchParams(callsQuery); summaryQuery.delete('cursor');
    try {
      const [calls, summary] = await Promise.all([
        fetchJson(`/api/omni/telephony/calls?${callsQuery}`, request),
        fetchJson(`/api/omni/telephony/summary?${summaryQuery}`, request),
      ]);
      if (!isCurrent(request)) return;
      if (!calls.ok || !calls.payload?.success) { state.capability = capabilityMessage(calls.payload); return; }
      state.result = calls.payload; state.page.next = calls.payload.page?.cursor || null;
      if (summary.ok && summary.payload?.success) state.summary = summary.payload;
      else state.summaryError = capabilityMessage(summary.payload);
    } catch (error) {
      if (!isCurrent(request)) return;
      state.error = error?.message === 'SESSION_UNAVAILABLE' ? 'Сесію оновлено. Повторіть запит телефонії.' : 'Помилка мережі під час завантаження телефонії.';
    } finally {
      if (!isCurrent(request)) return;
      state.loading = false; state.request = null; render();
    }
  }

  function summaryCards(summary) {
    if (!summary?.data) return null;
    const rows = [
      ['Усього', summary.data.total], ['Вхідні', summary.data.incoming], ['Вихідні', summary.data.outgoing], ['Пропущені', summary.data.missed],
      ['Сер. очікування', duration(summary.data.averageWaitingSeconds)], ['Сер. розмова', duration(summary.data.averageTalkSeconds)],
    ];
    return el('div', { className: 'omni-telephony-summary', 'aria-label': 'Підсумок журналу' }, rows.map(([name, value]) =>
      el('div', { className: 'omni-telephony-summary-item' }, [el('strong', { text: text(value) }), el('span', { text: name })])
    ));
  }

  function pagination() {
    if (!state.result) return null;
    const wrap = el('div', { className: 'omni-telephony-pagination', 'aria-label': 'Сторінки журналу' });
    const previous = el('button', { type: 'button', text: 'Попередня', disabled: !state.page.previous });
    previous.addEventListener('click', () => load({ cursor: state.page.previous, previous: null, push: true }));
    const next = el('button', { type: 'button', text: 'Наступна', disabled: !state.page.next });
    next.addEventListener('click', () => load({ cursor: state.page.next, previous: state.page.cursor, push: true }));
    wrap.append(previous, el('span', { text: state.page.next ? 'Є наступна сторінка' : 'Остання сторінка' }), next);
    return wrap;
  }

  function customerLink(call) {
    const id = String(call.customer?.id || '').trim();
    if (!id) return null;
    const url = new URL('/customers', window.location.origin);
    url.searchParams.set('open', id); url.searchParams.set('businessContext', state.context || currentContext());
    return el('a', { href: `${url.pathname}?${url.searchParams}`, text: 'Відкрити клієнта', className: 'omni-telephony-customer-link' });
  }

  function recordingControl(call) {
    const available = call.recording?.available === true;
    return el('button', {
      type: 'button', disabled: true, text: available ? 'Запис потребує активації' : 'Запис недоступний',
      title: available ? 'Без підтвердженого server-side recording contract відтворення вимкнено.' : 'Для цього дзвінка запису немає.',
    });
  }

  function callTable(calls) {
    if (!calls.length) return el('p', { className: 'omni-telephony-state', text: 'За обраними фільтрами дзвінків немає.' });
    const table = el('table', { className: 'omni-telephony-table' });
    const headers = ['Напрямок / стан', 'Клієнт / номер', 'Номер компанії', 'Співробітник / група', 'Очікування', 'Тривалість', 'Час', 'Запис'];
    table.append(el('thead', {}, [el('tr', {}, headers.map(value => el('th', { scope: 'col', text: value })))]));
    const body = el('tbody');
    calls.forEach(call => {
      const customer = el('td', {}, [el('div', { text: text(call.customer?.name || call.customerPhone) })]);
      const link = customerLink(call); if (link) customer.append(link);
      const agent = [call.agent?.name, call.agent?.group].filter(Boolean).join(' · ') || call.agent?.internalNumber;
      body.append(el('tr', {}, [
        el('td', { text: `${label(call.direction, DIRECTION)} · ${label(call.status, STATUS)}` }), customer,
        el('td', { text: text(call.companyPhone) }), el('td', { text: text(agent) }),
        el('td', { text: duration(call.waitingSeconds) }), el('td', { text: duration(call.talkSeconds) }),
        el('td', { text: formatTime(call.startedAt) }), el('td', {}, [recordingControl(call)]),
      ]));
    });
    table.append(body); return table;
  }

  function render() {
    clear(root);
    const form = el('form', { className: 'omni-telephony-filters', 'data-telephony-filters': 'true', 'aria-label': 'Фільтри телефонії' });
    FILTERS.forEach(([name, title, type]) => {
      form.append(el('label', {}, [el('span', { text: title }), el('input', { name, type, value: state.filters[name] || '', 'aria-label': title })]));
    });
    const status = el('select', { name: 'status', 'aria-label': 'Стан дзвінка' });
    status.append(el('option', { value: '', text: 'Усі стани' }));
    Object.entries(STATUS).forEach(([value, title]) => status.append(el('option', { value, text: title, selected: state.filters.status === value })));
    form.append(el('label', {}, [el('span', { text: 'Стан' }), status]));
    form.append(el('button', { type: 'submit', text: 'Застосувати', disabled: state.loading }));
    const reset = el('button', { type: 'button', text: 'Очистити', className: 'omni-secondary-action', disabled: state.loading });
    reset.addEventListener('click', () => { state.filters = { startDate: today(), endDate: today(), agent: '', companyNumber: '', customerNumber: '', status: '' }; render(); load({ push: true, useStateFilters: true }); });
    form.append(reset); form.addEventListener('submit', event => { event.preventDefault(); load({ push: true }); }); root.append(form);

    const tabs = el('div', { className: 'omni-telephony-tabs', role: 'tablist', 'aria-label': 'Види дзвінків' });
    VIEWS.forEach(([value, title, supported]) => {
      const button = el('button', { type: 'button', role: 'tab', text: title, className: value === state.view ? 'active' : '', 'aria-selected': String(value === state.view), disabled: !supported, title: supported ? '' : unsupportedMessage(value) });
      if (supported) button.addEventListener('click', () => { if (state.view !== value) { state.view = value; state.page = { cursor: null, previous: null, next: null }; load({ push: true }); } });
      tabs.append(button);
    });
    tabs.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const available = [...tabs.querySelectorAll('button:not(:disabled)')]; const index = available.indexOf(document.activeElement); if (index < 0) return;
      event.preventDefault();
      const target = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + available.length) % available.length;
      available[target].focus(); available[target].click();
    });
    root.append(tabs);

    const content = el('div', { className: 'omni-telephony-content', 'aria-live': 'polite' });
    if (state.loading) content.append(el('p', { className: 'omni-telephony-state', text: 'Завантажуємо журнал телефонії…', role: 'status' }));
    else if (state.error) content.append(el('p', { className: 'omni-telephony-state error', text: state.error, role: 'alert' }));
    else if (state.capability) content.append(el('p', { className: 'omni-telephony-state unsupported', text: state.capability, role: 'status' }));
    else if (state.result) {
      content.append(el('div', { className: 'omni-telephony-meta' }, [
        el('span', { text: `Джерело: ${text(state.result.freshness)}` }),
        el('span', { text: state.summary?.completeness === 'partial' ? 'Підсумок неповний' : 'Підсумок за всім доступним зрізом' }),
      ]));
      const cards = summaryCards(state.summary); if (cards) content.append(cards);
      if (state.summaryError) content.append(el('p', { className: 'omni-telephony-summary-note', text: `Зведення недоступне: ${state.summaryError}` }));
      content.append(callTable(state.result.data || [])); const pages = pagination(); if (pages) content.append(pages);
    } else content.append(el('p', { className: 'omni-telephony-state', text: 'Оберіть вид дзвінків і застосуйте фільтри.' }));
    root.append(content);
  }

  function enter() { state.active = true; restoreLocation(); render(); load({ cursor: state.page.cursor }); }
  function resetForContext() {
    abortRequest(); state.context = null; state.result = null; state.summary = null; state.summaryError = null;
    state.error = null; state.capability = null; state.loading = false; state.page = { cursor: null, previous: null, next: null };
  }

  window.addEventListener('omni:mode', event => {
    const active = event.detail?.mode === 'telephony'; panel.hidden = !active;
    if (active && !state.active) enter();
    if (!active && state.active) { state.active = false; abortRequest(); state.loading = false; }
  });
  window.addEventListener('omni:business-context-change', () => { resetForContext(); if (state.active) { restoreLocation(); render(); load(); } });
  window.addEventListener('popstate', () => { if (state.active) { restoreLocation(); render(); load({ cursor: state.page.cursor }); } });
  render();
})();
