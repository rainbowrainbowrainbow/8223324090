'use strict';

(function () {
    const API_BASE = '/api';
    let currentSummary = null;

    function qs() {
        return new URLSearchParams(window.location.search || '');
    }

    function el(id) {
        return document.getElementById(id);
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function storedToken() {
        try {
            return localStorage.getItem('pzp_token') || localStorage.getItem('pzp_access_token') || '';
        } catch {
            return '';
        }
    }

    function setState(message, type = 'info') {
        const state = el('bookingSummaryState');
        if (!state) return;
        state.hidden = !message;
        state.textContent = message || '';
        state.dataset.state = type;
    }

    function showToast(message) {
        const old = document.querySelector('.booking-summary-toast');
        if (old) old.remove();
        const toast = document.createElement('div');
        toast.className = 'booking-summary-toast';
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 1600);
    }

    function formatDate(value) {
        if (!value) return '—';
        const text = String(value).slice(0, 10);
        const parts = text.split('-');
        if (parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`;
        return text;
    }

    function formatDateTime(value) {
        if (!value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleString('uk-UA', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function formatMoney(value, currency = 'UAH') {
        const n = Number(value);
        if (!Number.isFinite(n)) return '—';
        return `${new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(n)} ${currency}`;
    }

    function formatValue(value) {
        if (value === undefined || value === null || value === '') return '—';
        return String(value);
    }

    function compactFact(label, value) {
        return `<span class="summary-brief-item"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(formatValue(value))}</span>`;
    }

    function compactLine(items = []) {
        return `
            <p class="summary-brief-line">
                ${items.filter(Boolean).join('')}
            </p>
        `;
    }

    function countsText(counts = {}) {
        const parts = [];
        if (counts.children !== undefined && counts.children !== null && counts.children !== '') parts.push(`Діти ${counts.children}`);
        if (counts.adults !== undefined && counts.adults !== null && counts.adults !== '') parts.push(`Дорослі ${counts.adults}`);
        if (counts.guests !== undefined && counts.guests !== null && counts.guests !== '') parts.push(`Гості ${counts.guests}`);
        if (counts.tables !== undefined && counts.tables !== null && counts.tables !== '') parts.push(`Столи ${counts.tables}`);
        return parts.join(' · ') || null;
    }

    function renderWarnings(warnings = []) {
        const box = el('bookingSummaryWarnings');
        if (!box) return;
        const items = Array.isArray(warnings) ? warnings.filter(Boolean) : [];
        if (!items.length) {
            box.hidden = true;
            box.innerHTML = '';
            return;
        }
        box.hidden = false;
        box.innerHTML = `
            <h2>Попередження перед друком</h2>
            <ul>
                ${items.map(item => `<li>${escapeHtml(item.message || item.code || item)}</li>`).join('')}
            </ul>
        `;
    }

    function orderRowComment(row = {}) {
        const meta = row.meta || {};
        const parts = [];
        if (row.type === 'service_event' && meta.time) parts.push(`Час ${meta.time}`);
        if (row.comment) parts.push(row.comment);
        return parts.join(' · ') || null;
    }

    function summaryOrderRows(summary) {
        return (Array.isArray(summary?.orderRows) ? summary.orderRows : [])
            .filter(row => row?.type !== 'service_event');
    }

    function summaryServiceEventRows(summary) {
        const explicit = Array.isArray(summary?.serviceEvents) ? summary.serviceEvents : [];
        const fromRows = (Array.isArray(summary?.orderRows) ? summary.orderRows : [])
            .filter(row => row?.type === 'service_event');
        return explicit.length ? explicit : fromRows;
    }

    function summaryServingTime(row = {}) {
        const meta = row.meta || {};
        return meta.servingTime || meta.time || null;
    }

    function orderRowsHtml(summary) {
        const rows = summaryOrderRows(summary);
        if (!rows.length) {
            return '<div class="summary-order-empty">Позиції замовлення відсутні.</div>';
        }
        return `
            <table class="summary-order-table">
                <colgroup>
                    <col style="width:42px">
                    <col>
                    <col style="width:72px">
                    <col style="width:112px">
                    <col style="width:170px">
                </colgroup>
                <thead>
                    <tr>
                        <th class="num">№</th>
                        <th>Назва</th>
                        <th class="qty">К-сть</th>
                        <th class="serving">Видача</th>
                        <th>Примітка</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map((row, index) => `
                        <tr>
                            <td class="num">${index + 1}</td>
                            <td class="name">${escapeHtml(row.title || row.name || 'Позиція')}</td>
                            <td class="qty">${escapeHtml(formatValue(row.quantity))}</td>
                            <td class="serving">${escapeHtml(formatValue(summaryServingTime(row)))}</td>
                            <td>${escapeHtml(formatValue(orderRowComment(row)))}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    function serviceEventsHtml(summary) {
        const rows = summaryServiceEventRows(summary);
        if (!rows.length) return '';
        return `
            <div class="summary-service-events">
                ${rows.map(row => {
                    const meta = row.meta || {};
                    const note = orderRowComment(row);
                    return `
                        <div class="summary-service-event">
                            <strong>${escapeHtml(row.title || 'Подія')}</strong>
                            <span>${escapeHtml(formatValue(meta.time || meta.servingTime))}</span>
                            ${note ? `<small>${escapeHtml(note)}</small>` : ''}
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    function renderTotals(summary) {
        const totals = summary?.totals || {};
        const deposit = summary?.deposit || {};
        const currency = totals.currency || 'UAH';
        return `
            <div class="summary-finance-lines">
                <p>
                    <strong>Сума:</strong> ${escapeHtml(formatMoney(totals.orderTotal, currency))}
                    <span>Програма: ${escapeHtml(formatMoney(totals.programBasePrice, currency))}</span>
                    <span>Бронювання: ${escapeHtml(formatMoney(totals.bookingPrice, currency))}</span>
                    <span>Меню: ${escapeHtml(formatMoney(totals.menuSubtotal, currency))}</span>
                    <span>Активності: ${escapeHtml(formatMoney(totals.activitySubtotal, currency))}</span>
                </p>
                <p>
                    <strong>Завдаток:</strong> ${escapeHtml(formatMoney(deposit.amount, currency))}
                    <span>Спосіб: ${escapeHtml(formatValue(deposit.paymentMethod))}</span>
                    <span>Статус: ${escapeHtml(formatValue(deposit.paymentStatus))}</span>
                </p>
            </div>
        `;
    }

    function renderTerms(summary) {
        const terms = summary?.terms || {};
        const items = Array.isArray(terms.items) ? terms.items.filter(Boolean) : [];
        return `
            <div class="summary-note-block summary-terms">
                ${items.length
                    ? `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
                    : '<span class="summary-muted">Умови банкету не заповнені.</span>'}
            </div>
        `;
    }

    function renderDocument(summary) {
        const doc = el('bookingSummaryDocument');
        if (!doc) return;
        const venue = summary.venue || {};
        const event = summary.event || {};
        const customer = summary.customer || {};
        const celebrant = summary.celebrant || {};
        const counts = summary.counts || {};
        const people = countsText(counts);

        doc.hidden = false;
        doc.innerHTML = `
            <header class="summary-doc-header">
                <div>
                    <h2 class="summary-venue-name">${escapeHtml(venue.name || 'Заклад')}</h2>
                    <div class="summary-venue-lines">
                        <span>${escapeHtml(formatValue(venue.addressLine1))}</span>
                        <span>${escapeHtml(formatValue(venue.addressLine2))}</span>
                        <span>${escapeHtml(formatValue(venue.phone))}</span>
                    </div>
                </div>
                <div class="summary-doc-meta">
                    <span>Booking ID: ${escapeHtml(summary.bookingId || '—')}</span>
                    <span>Сформовано: ${escapeHtml(formatDateTime(summary.document?.generatedAt))}</span>
                    <span>Автор: ${escapeHtml(formatValue(summary.document?.generatedBy))}</span>
                </div>
            </header>

            <h1 class="summary-title">${escapeHtml(summary.document?.title || 'Вижимка банкету')}</h1>

            <section class="summary-brief" aria-label="Коротка інформація по банкету">
                ${compactLine([
                    compactFact('Клієнт', customer.name),
                    compactFact('Телефон', customer.phone),
                    compactFact('Кімната', event.room),
                    compactFact('Дата', formatDate(event.date))
                ])}
                ${compactLine([
                    compactFact('Час', event.time),
                    compactFact('Гості', people),
                    compactFact('Програма', event.programName)
                ])}
                ${compactLine([
                    compactFact('Іменинник', celebrant.name),
                    compactFact('Дата народження', formatDate(celebrant.birthday)),
                    compactFact('Менеджер', event.manager)
                ])}
                ${compactLine([
                    compactFact('Оформлено', formatDateTime(event.createdAt)),
                    compactFact('Booking ID', summary.bookingId || '—')
                ])}
            </section>

            <section class="summary-section">
                <h2>Замовлення</h2>
                ${orderRowsHtml(summary)}
            </section>

            ${summaryServiceEventRows(summary).length ? `
                <section class="summary-section">
                    <h2>Події видачі</h2>
                    ${serviceEventsHtml(summary)}
                </section>
            ` : ''}

            <section class="summary-section">
                <h2>Суми і завдаток</h2>
                ${renderTotals(summary)}
            </section>

            <section class="summary-section">
                <h2>${escapeHtml(summary.terms?.title || 'Умови банкету')}</h2>
                ${renderTerms(summary)}
            </section>
        `;
    }

    function summaryText(summary) {
        const event = summary.event || {};
        const customer = summary.customer || {};
        const celebrant = summary.celebrant || {};
        const counts = summary.counts || {};
        const totals = summary.totals || {};
        const deposit = summary.deposit || {};
        const currency = totals.currency || 'UAH';
        const rows = summaryOrderRows(summary);
        const serviceEvents = summaryServiceEventRows(summary);
        const terms = Array.isArray(summary.terms?.items) ? summary.terms.items : [];

        return [
            summary.venue?.name || 'Вижимка банкету',
            `Booking ID: ${summary.bookingId || '—'}`,
            '',
            `Дата/час: ${formatDate(event.date)} ${formatValue(event.time)}`,
            `Замовник: ${formatValue(customer.name)}`,
            `Телефон: ${formatValue(customer.phone)}`,
            `Іменинник: ${formatValue(celebrant.name)}`,
            `Дата народження: ${formatDate(celebrant.birthday)}`,
            `Кімната: ${formatValue(event.room)}`,
            `Дата оформлення: ${formatDateTime(event.createdAt)}`,
            `Менеджер: ${formatValue(event.manager)}`,
            `Дітей: ${formatValue(counts.children)}`,
            `Дорослих: ${formatValue(counts.adults)}`,
            '',
            'Замовлення:',
            ...(rows.length ? rows.map((row, index) => {
                const comment = orderRowComment(row);
                const servingTime = summaryServingTime(row);
                return `${index + 1}. ${row.title || 'Позиція'} — ${formatValue(servingTime)} — ${formatValue(row.quantity)} x ${formatMoney(row.unitPrice, currency)} = ${formatMoney(row.subtotal, currency)}${comment ? ` (${comment})` : ''}`;
            }) : ['Позиції відсутні']),
            ...(serviceEvents.length ? [
                '',
                'Події видачі:',
                ...serviceEvents.map((row, index) => {
                    const meta = row.meta || {};
                    const note = orderRowComment(row);
                    return `${index + 1}. ${row.title || 'Подія'} — ${formatValue(meta.time || meta.servingTime)}${note ? ` (${note})` : ''}`;
                })
            ] : []),
            '',
            `Сума замовлення: ${formatMoney(totals.orderTotal, currency)}`,
            `Сума бронювання: ${formatMoney(totals.bookingPrice, currency)}`,
            `Завдаток: ${formatMoney(deposit.amount, currency)}`,
            `Спосіб внесення: ${formatValue(deposit.paymentMethod)}`,
            '',
            'Умови:',
            ...(terms.length ? terms.map(item => `- ${item}`) : ['—'])
        ].join('\n');
    }

    async function copyText(text) {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return;
        }
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', 'readonly');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
    }

    async function loadSummary() {
        const params = qs();
        const id = params.get('id');
        const businessContext = params.get('businessContext') || 'event_genix';
        const groupId = params.get('groupId') || '';
        const returnUrl = params.get('return') || '/';
        const back = el('bookingSummaryBack');
        if (back) back.href = returnUrl || '/';

        if (!id) {
            setState('Не передано booking id.', 'error');
            return;
        }

        const token = storedToken();
        if (!token) {
            setState('Потрібно увійти в CRM, щоб відкрити вижимку.', 'error');
            return;
        }

        const requestParams = new URLSearchParams({ businessContext });
        if (groupId) requestParams.set('groupId', groupId);
        const url = `${API_BASE}/bookings/${encodeURIComponent(id)}/banquet-summary?${requestParams.toString()}`;
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success === false) {
            setState(data.error || `Не вдалося завантажити вижимку (${response.status}).`, 'error');
            return;
        }

        currentSummary = data;
        renderWarnings(data.warnings);
        renderDocument(data);
        setState('');
    }

    function bindActions() {
        el('bookingSummaryPrint')?.addEventListener('click', () => {
            window.print();
        });
        el('bookingSummaryCopy')?.addEventListener('click', async () => {
            if (!currentSummary) {
                showToast('Вижимка ще не завантажена');
                return;
            }
            try {
                await copyText(summaryText(currentSummary));
                showToast('Текст вижимки скопійовано');
            } catch {
                showToast('Не вдалося скопіювати текст');
            }
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        bindActions();
        loadSummary().catch(err => {
            console.error('[booking-summary] load failed', err);
            setState('Не вдалося завантажити вижимку.', 'error');
        });
    });
})();
