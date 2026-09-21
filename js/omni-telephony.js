'use strict';

(() => {
  const root = document.getElementById('omniTelephonyRoot');
  const panel = document.getElementById('omniTelephonyWorkspace');
  if (!root || !panel) return;

  const state = { view: 'all', loading: false, error: null, result: null, controller: null, context: null, filters: {} };
  const views = [
    ['all', 'Усі'], ['incoming', 'Вхідні'], ['outgoing', 'Вихідні'], ['missed', 'Втрачені'],
    ['agent', 'За співробітником'], ['number', 'За номером'], ['live', 'Просто зараз'], ['queues', 'Моніторинг черг'],
  ];
  const text = value => value === null || value === undefined || value === '' ? '—' : String(value);
  const duration = value => value === null || value === undefined ? '—' : `${Math.floor(Number(value) / 60)}:${String(Number(value) % 60).padStart(2, '0')}`;
  const currentContext = () => window.CrmBusinessContext?.current?.() || 'event_genix';
  const kyivDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((out, part) => ({ ...out, [part.type]: part.value }), {});
  const today = () => { const d = kyivDate(); return `${d.year}-${d.month}-${d.day}`; };

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function el(name, props = {}, children = []) {
    const node = document.createElement(name);
    Object.entries(props).forEach(([key, value]) => {
      if (key === 'text') node.textContent = value;
      else if (key === 'className') node.className = value;
      else if (key.startsWith('aria-')) node.setAttribute(key, value);
      else if (key in node) node[key] = value;
      else node.setAttribute(key, value);
    });
    children.filter(Boolean).forEach(child => node.append(child));
    return node;
  }

  function query() {
    const form = root.querySelector('form');
    const data = new FormData(form);
    return Object.fromEntries([...data.entries()].filter(([, value]) => value !== ''));
  }

  function render() {
    clear(root);
    const form = el('form', { className: 'omni-telephony-filters', 'aria-label': 'Фільтри телефонії' });
    const fields = [
      ['startDate', 'Від', 'date'], ['endDate', 'До', 'date'], ['agent', 'Співробітник', 'text'],
      ['companyNumber', 'Номер компанії', 'text'], ['customerNumber', 'Номер клієнта', 'text'],
    ];
    fields.forEach(([name, label, type]) => {
      const input = el('input', { name, type, value: (state.filters[name] ?? state.result?.query?.[name]) || (name === 'startDate' || name === 'endDate' ? today() : ''), 'aria-label': label });
      form.append(el('label', { text: label }, [input]));
    });
    const status = el('select', { name: 'status', 'aria-label': 'Стан дзвінка' });
    ['', 'ringing', 'answered', 'missed', 'completed'].forEach(value => status.append(el('option', { value, text: value || 'Усі стани' })));
    form.append(el('label', { text: 'Стан' }, [status]));
    form.append(el('button', { type: 'submit', text: 'Застосувати', disabled: state.loading }));
    form.append(el('button', { type: 'button', text: 'Очистити', className: 'omni-secondary-action', onclick: () => { state.result = null; state.filters = {}; render(); } }));
    root.append(form);
    const tabs = el('div', { className: 'omni-telephony-tabs', role: 'tablist', 'aria-label': 'Види дзвінків' });
    views.forEach(([value, label]) => tabs.append(el('button', { type: 'button', role: 'tab', text: label, className: value === state.view ? 'active' : '', 'aria-selected': String(value === state.view), onclick: () => { state.view = value; load(); } })));
    root.append(tabs);
    const content = el('div', { className: 'omni-telephony-content' });
    if (state.loading) content.append(el('p', { text: 'Завантажуємо журнал телефонії…', role: 'status' }));
    else if (state.error) content.append(el('p', { className: 'omni-telephony-state error', text: state.error, role: 'alert' }));
    else if (!state.result) content.append(el('p', { className: 'omni-telephony-state', text: 'Оберіть вид дзвінків і застосуйте фільтри.' }));
    else if (!state.result.success) content.append(el('p', { className: 'omni-telephony-state unsupported', text: state.result.error || 'Телефонія недоступна для цього бізнесу.' }));
    else content.append(table(state.result.data || []));
    root.append(content);
    form.addEventListener('submit', event => { event.preventDefault(); load(); });
  }

  function table(calls) {
    if (!calls.length) return el('p', { className: 'omni-telephony-state', text: 'За обраними фільтрами дзвінків немає.' });
    const table = el('table', { className: 'omni-telephony-table' });
    const headers = ['Напрямок / стан', 'Клієнт / номер', 'Номер компанії', 'Співробітник / група', 'Очікування', 'Тривалість', 'Час', 'Запис'];
    table.append(el('thead', {}, [el('tr', {}, headers.map(value => el('th', { scope: 'col', text: value })))]));
    const body = el('tbody');
    calls.forEach(call => body.append(el('tr', {}, [
      el('td', { text: `${text(call.direction)} · ${text(call.status)}` }), el('td', { text: text(call.customer?.name || call.customerPhone) }),
      el('td', { text: text(call.companyPhone) }), el('td', { text: text(call.agent?.name || call.agent?.internalNumber) }),
      el('td', { text: duration(call.waitingSeconds) }), el('td', { text: duration(call.talkSeconds) }),
      el('td', { text: text(call.startedAt) }), el('td', { text: call.recording?.available ? 'Доступний' : 'Немає' }),
    ])));
    table.append(body); return table;
  }

  async function load() {
    state.filters = query();
    if (state.controller) state.controller.abort();
    state.controller = new AbortController(); state.context = currentContext(); state.loading = true; state.error = null; render();
    const data = new URLSearchParams(state.filters); const endpoint = state.view === 'live' ? 'live' : state.view === 'queues' ? 'queues' : 'calls';
    if (endpoint === 'calls') data.set('view', state.view); data.set('businessContext', state.context);
    try {
      const url = `/api/omni/telephony/${endpoint}?${data}`;
      const response = await apiFetchWithAuthRetry(url, { headers: { ...getAuthHeaders(false), 'X-Business-Context': state.context }, signal: state.controller.signal });
      const body = await response.json().catch(() => null);
      if (state.context !== currentContext() || state.controller.signal.aborted) return;
      state.result = body || { success: false, error: 'Неочікувана відповідь сервера.' };
      if (!response.ok && !state.result.error) state.result.error = 'Журнал телефонії тимчасово недоступний.';
    } catch (error) { if (!state.controller.signal.aborted) state.error = 'Помилка мережі під час завантаження телефонії.'; }
    finally { if (!state.controller.signal.aborted) { state.loading = false; render(); } }
  }

  window.addEventListener('omni:mode', event => { panel.hidden = event.detail?.mode !== 'telephony'; if (event.detail?.mode === 'telephony' && !state.result && !state.loading) load(); });
  window.addEventListener('crm:business-context-change', () => { state.controller?.abort(); state.result = null; state.error = null; state.context = null; if (!panel.hidden) load(); });
  render();
})();
