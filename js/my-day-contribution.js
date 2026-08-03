(function () {
    'use strict';

    const API_URL = '/api/my-day/contribution';
    const KYIV_TIMEZONE = 'Europe/Kyiv';
    const REQUEST_TIMEOUT_MS = 15000;

    const state = {
        from: addDays(kyivDate(), -6),
        to: kyivDate(),
        data: null,
        loading: false,
        loaded: false,
        error: ''
    };
    let pendingRequest = null;
    let requestSequence = 0;

    function escape(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[char]));
    }

    function kyivDate(date = new Date()) {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: KYIV_TIMEZONE,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(date);
        const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
        return `${values.year}-${values.month}-${values.day}`;
    }

    function addDays(localDate, delta) {
        const date = new Date(`${localDate}T12:00:00Z`);
        date.setUTCDate(date.getUTCDate() + Number(delta || 0));
        return date.toISOString().slice(0, 10);
    }

    function normalizeNumber(value) {
        const number = Number(value || 0);
        return Number.isFinite(number) ? number : 0;
    }

    function formatMinutes(value) {
        const minutes = Math.max(0, Math.round(normalizeNumber(value)));
        const hours = Math.floor(minutes / 60);
        const rest = minutes % 60;
        if (!hours) return `${rest} хв`;
        if (!rest) return `${hours} год`;
        return `${hours} год ${rest} хв`;
    }

    function requestUrl() {
        const params = new URLSearchParams({ from: state.from, to: state.to });
        const path = `${API_URL}?${params.toString()}`;
        return typeof window !== 'undefined' && window.CrmBusinessContext?.apiUrl
            ? window.CrmBusinessContext.apiUrl(path)
            : path;
    }

    function authHeaders() {
        const headers = typeof window !== 'undefined' && typeof window.getAuthHeaders === 'function'
            ? window.getAuthHeaders(false)
            : {};
        return { Accept: 'application/json', ...headers };
    }

    function errorMessage(response, payload = {}) {
        if (response?.status === 401) return 'Потрібна повторна авторизація для завантаження матриці внеску.';
        if (response?.status === 429) return 'Забагато запитів. Зачекайте хвилину і повторіть вручну.';
        return payload.error || 'Не вдалося завантажити матрицю внеску.';
    }

    async function requestContribution(signal) {
        const response = await fetch(requestUrl(), {
            credentials: 'include',
            headers: authHeaders(),
            signal
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.success === false) {
            if (typeof window !== 'undefined' && typeof window.handleAuthError === 'function') {
                window.handleAuthError(response);
            }
            throw new Error(errorMessage(response, payload));
        }
        return payload;
    }

    function cancel(reason = 'cancelled') {
        requestSequence += 1;
        if (pendingRequest?.controller && !pendingRequest.controller.signal.aborted) {
            pendingRequest.controller.abort(reason);
        }
        pendingRequest = null;
        state.loading = false;
    }

    function load(force = false) {
        if (pendingRequest && !force) return pendingRequest.promise;
        if (pendingRequest && force) cancel('refresh');
        if (state.loaded && !force) return Promise.resolve(state);
        if (state.error && !force) return Promise.resolve(state);
        state.loading = true;
        state.error = '';
        const controller = new AbortController();
        const token = ++requestSequence;
        let timedOut = false;
        const timeoutId = setTimeout(() => {
            timedOut = true;
            controller.abort('timeout');
        }, REQUEST_TIMEOUT_MS);
        const promise = (async () => {
            try {
                const payload = await requestContribution(controller.signal);
                if (token !== requestSequence || controller.signal.aborted) return state;
                state.data = payload;
                state.loaded = true;
            } catch (error) {
                if (token !== requestSequence) return state;
                if (timedOut) {
                    state.error = 'Завантаження матриці внеску тривало понад 15 секунд. Повторіть вручну.';
                    state.loaded = false;
                    return state;
                }
                if (controller.signal.aborted || error?.name === 'AbortError') return state;
                state.error = error.message || 'Не вдалося завантажити матрицю внеску.';
                state.loaded = false;
            } finally {
                clearTimeout(timeoutId);
                if (token === requestSequence) {
                    state.loading = false;
                    pendingRequest = null;
                }
            }
            return state;
        })();
        pendingRequest = { controller, promise, token };
        return promise;
    }

    function metricCard(label, value, hint) {
        return `<article class="my-day-contribution-metric">
            <span>${escape(label)}</span>
            <strong>${escape(value)}</strong>
            <small>${escape(hint)}</small>
        </article>`;
    }

    function renderTotals(data) {
        const totals = data?.totals || {};
        return `<div class="my-day-contribution-metrics" aria-label="Підсумки внеску">
            ${metricCard('Завершені задачі', normalizeNumber(totals.taskCount), 'рахуються один раз')}
            ${metricCard('Час задач', formatMinutes(totals.taskMinutes), 'окремо від звичок')}
            ${metricCard('Виконані звички', normalizeNumber(totals.habitCompletions), 'тільки done')}
            ${metricCard('Хвилини звичок', formatMinutes(totals.habitMinutes), 'не входять у task-time')}
        </div>`;
    }

    function badge(taxonomy) {
        if (!taxonomy) return '';
        return `<span class="my-day-task-chip my-day-task-chip--direction" style="--my-day-chip-color:${escape(taxonomy.color || '#64748B')}">${escape(taxonomy.icon || '•')} <span>${escape(taxonomy.name)}</span></span>`;
    }

    function renderRow(item, options = {}) {
        const label = item.label || item.taxonomy?.name || 'Без назви';
        const taxonomyBadge = item.taxonomy ? badge(item.taxonomy) : `<span class="my-day-contribution-unclassified">${escape(label)}</span>`;
        return `<tr>
            <th scope="row">${taxonomyBadge}</th>
            <td>${escape(normalizeNumber(item.taskCount))}</td>
            <td>${escape(formatMinutes(item.taskMinutes))}</td>
            <td>${escape(normalizeNumber(item.habitCompletions))}</td>
            <td>${escape(formatMinutes(item.habitMinutes))}</td>
            ${options.showNote ? `<td>${escape(options.note || '')}</td>` : ''}
        </tr>`;
    }

    function renderMatrix(title, description, rows, emptyText, options = {}) {
        const body = rows?.length
            ? rows.map(item => renderRow(item, options)).join('')
            : `<tr><td colspan="${options.showNote ? 6 : 5}" class="my-day-contribution-empty">${escape(emptyText)}</td></tr>`;
        return `<section class="my-day-contribution-section" aria-labelledby="${escape(options.id)}">
            <div class="profile-panel-head">
                <div>
                    <h3 id="${escape(options.id)}">${escape(title)}</h3>
                    <p>${escape(description)}</p>
                </div>
            </div>
            <div class="my-day-contribution-table-wrap">
                <table class="my-day-contribution-table">
                    <thead>
                        <tr>
                            <th scope="col">Маркер</th>
                            <th scope="col">Задачі</th>
                            <th scope="col">Час задач</th>
                            <th scope="col">Звички</th>
                            <th scope="col">Хв звичок</th>
                            ${options.showNote ? '<th scope="col">Правило</th>' : ''}
                        </tr>
                    </thead>
                    <tbody>${body}</tbody>
                </table>
            </div>
        </section>`;
    }

    function renderDays(days = []) {
        const body = days.length ? days.map(day => `<tr>
            <th scope="row">${escape(day.date)}</th>
            <td>${escape(normalizeNumber(day.taskCount))}</td>
            <td>${escape(formatMinutes(day.taskMinutes))}</td>
            <td>${escape(normalizeNumber(day.habitCompletions))}</td>
            <td>${escape(formatMinutes(day.habitMinutes))}</td>
        </tr>`).join('') : '<tr><td colspan="5" class="my-day-contribution-empty">Немає днів у періоді.</td></tr>';
        return `<section class="my-day-contribution-section" aria-labelledby="myDayContributionDaysTitle">
            <div class="profile-panel-head">
                <div>
                    <h3 id="myDayContributionDaysTitle">Динаміка по днях</h3>
                    <p>Прозорий розклад внеску без score, штрафів або гейміфікації.</p>
                </div>
            </div>
            <div class="my-day-contribution-table-wrap">
                <table class="my-day-contribution-table">
                    <thead><tr><th scope="col">Дата</th><th scope="col">Задачі</th><th scope="col">Час задач</th><th scope="col">Звички</th><th scope="col">Хв звичок</th></tr></thead>
                    <tbody>${body}</tbody>
                </table>
            </div>
        </section>`;
    }

    function emptyContributionData(range, source = {}) {
        const totals = source.totals || {};
        return {
            ...source,
            range,
            totals: {
                taskCount: normalizeNumber(totals.taskCount),
                taskMinutes: normalizeNumber(totals.taskMinutes),
                habitCompletions: normalizeNumber(totals.habitCompletions),
                habitMinutes: normalizeNumber(totals.habitMinutes)
            },
            directions: Array.isArray(source.directions) ? source.directions : [],
            impacts: Array.isArray(source.impacts) ? source.impacts : [],
            days: Array.isArray(source.days) ? source.days : [],
            unclassified: source.unclassified || {
                label: 'Без напряму',
                taskCount: 0,
                taskMinutes: 0,
                habitCompletions: 0,
                habitMinutes: 0
            }
        };
    }

    function contributionHasData(data) {
        return Boolean(normalizeNumber(data.totals?.taskCount)
            || normalizeNumber(data.totals?.taskMinutes)
            || normalizeNumber(data.totals?.habitCompletions)
            || normalizeNumber(data.totals?.habitMinutes));
    }

    function renderPanel() {
        const source = state.data || {};
        const range = source.range || { from: state.from, to: state.to, timezone: KYIV_TIMEZONE };
        const data = emptyContributionData(range, source);
        const hasData = contributionHasData(data);
        const status = state.error
            ? `<div class="profile-empty-professional is-error" role="alert"><p>${escape(state.error)}</p><button type="button" data-my-day-contribution-refresh>Повторити</button></div>`
            : '';
        const body = state.loading && !state.loaded
            ? '<div class="profile-empty-professional" aria-live="polite">Завантаження матриці внеску...</div>'
            : `${renderTotals(data)}
                   ${hasData ? '' : `<div class="profile-empty-professional my-day-contribution-zero-state">За ${escape(range.from)} — ${escape(range.to)} ще немає завершених задач, time entries або виконаних звичок.</div>`}
                   ${renderMatrix('Напрями', 'Кожна задача або звичка потрапляє в один напрям або в “Без напряму”.', [...data.directions, data.unclassified].filter(Boolean), 'Напрями ще не мають внеску.', { id: 'myDayContributionDirectionsTitle' })}
                   ${renderMatrix('Впливи', 'Впливи можуть перетинатися: один елемент може рахуватись у кілька впливів.', data.impacts, 'Впливи ще не мають внеску.', { id: 'myDayContributionImpactsTitle' })}
                   ${renderDays(data.days)}`;
        return `<div class="cabinet-shell cabinet-command-center" id="myDayContributionPanel" role="tabpanel" aria-labelledby="myDayModeContribution" aria-busy="${state.loading ? 'true' : 'false'}">
            <div class="my-day-contribution-toolbar">
                <div>
                    <h2>Внесок</h2>
                    <p>Матриця особистих зусиль за ${escape(range.timezone || KYIV_TIMEZONE)}. Максимум 92 дні.</p>
                </div>
                <form class="my-day-contribution-range" data-my-day-contribution-range>
                    <label>З <input type="date" name="from" value="${escape(state.from)}" required aria-label="Початкова дата внеску"></label>
                    <label>По <input type="date" name="to" value="${escape(state.to)}" required aria-label="Кінцева дата внеску"></label>
                    <button type="submit">Оновити</button>
                </form>
            </div>
            ${status}${body}
        </div>`;
    }
    function bind(root, onChanged) {
        const form = root?.querySelector('[data-my-day-contribution-range]');
        if (form && form.dataset.myDayContributionBound !== 'true') {
            form.dataset.myDayContributionBound = 'true';
            form.addEventListener('submit', async event => {
                event.preventDefault();
                const data = new FormData(form);
                state.from = String(data.get('from') || state.from);
                state.to = String(data.get('to') || state.to);
                state.loaded = false;
                await load(true);
                await onChanged?.();
            });
        }
        root?.querySelectorAll('[data-my-day-contribution-refresh]').forEach(button => {
            if (button.dataset.myDayContributionRefreshBound === 'true') return;
            button.dataset.myDayContributionRefreshBound = 'true';
            button.addEventListener('click', async () => {
                button.disabled = true;
                try {
                    await load(true);
                    await onChanged?.();
                } finally {
                    if (button.isConnected) button.disabled = false;
                }
            });
        });
    }

    window.MyDayContribution = { bind, cancel, load, renderPanel, state };
}());
