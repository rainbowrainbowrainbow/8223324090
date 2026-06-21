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

    function formatBirthday(value) {
        if (!value) return '—';
        const text = String(value).trim();
        const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (isoMatch) return `${isoMatch[3]}.${isoMatch[2]}.${isoMatch[1]}`;
        const date = new Date(text);
        if (Number.isNaN(date.getTime())) return '—';
        return date.toLocaleDateString('uk-UA', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
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

    function formatCurrencyLabel(currency = 'UAH') {
        const normalized = String(currency || 'UAH').trim();
        return normalized.toUpperCase() === 'UAH' ? '₴' : normalized;
    }

    function formatMoney(value, currency = 'UAH') {
        const n = Number(value);
        if (!Number.isFinite(n)) return '—';
        return `${new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(n)} ${formatCurrencyLabel(currency)}`;
    }

    function formatValue(value) {
        if (value === undefined || value === null || value === '') return '—';
        return String(value);
    }

    const SUMMARY_MENU_PORTION_UNITS = new Set(['порція', 'порції', 'порцій', 'порц', 'portion', 'portions']);

    function summaryMenuQuantityNumber(value) {
        const number = Number(String(value ?? '').replace(',', '.'));
        if (!Number.isFinite(number) || number <= 0) return '';
        return Number.isInteger(number)
            ? String(number)
            : new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(number);
    }

    function summaryMenuPortionWord(value) {
        const number = Number(String(value ?? '').replace(',', '.'));
        const absolute = Math.abs(number);
        const integer = Math.floor(absolute);
        if (!Number.isInteger(number)) return 'порції';
        const mod10 = integer % 10;
        const mod100 = integer % 100;
        if (mod10 === 1 && mod100 !== 11) return 'порція';
        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'порції';
        return 'порцій';
    }

    function normalizeSummaryMenuServingUnitDisplay(value) {
        const raw = String(value || '').trim();
        if (!raw) return '';
        return raw
            .replace(/\s+/g, ' ')
            .replace(/^(\d+(?:[.,]\d+)?)\s*(г|гр|гр\.|грам|грами|грамів)$/i, '$1 г')
            .replace(/^(\d+(?:[.,]\d+)?)\s*(кг|kg)$/i, '$1 кг');
    }

    function isSummaryMenuPortionServingUnit(value) {
        const normalized = String(value || '').trim().toLowerCase();
        return !normalized || SUMMARY_MENU_PORTION_UNITS.has(normalized);
    }

    function isSummaryMenuPackServingUnit(value) {
        return /^\d+(?:[.,]\d+)?\s*(г|гр|гр\.|грам|грами|грамів|кг|kg)$/i.test(String(value || '').trim());
    }

    function summaryMenuQuantityLabel(row = {}) {
        const meta = row.meta || {};
        const quantity = summaryMenuQuantityNumber(row.quantity);
        if (!quantity) return formatValue(row.quantity);
        const rawUnit = meta.servingUnit || row.servingUnit || row.serving_unit || meta.priceUnit || row.priceUnit || row.price_unit || '';
        if (isSummaryMenuPortionServingUnit(rawUnit)) return `${quantity} ${summaryMenuPortionWord(row.quantity)}`;
        const unit = normalizeSummaryMenuServingUnitDisplay(rawUnit);
        if (isSummaryMenuPackServingUnit(rawUnit) && unit) return `${quantity} ${summaryMenuPortionWord(row.quantity)} по ${unit}`;
        return unit ? `${quantity} ${unit}` : `${quantity} ${summaryMenuPortionWord(row.quantity)}`;
    }

    function summaryEntryQuantityLabel(row = {}) {
        const quantity = summaryMenuQuantityNumber(row.quantity);
        return quantity ? `${quantity} дітей` : formatValue(row.quantity);
    }

    function summaryOrderQuantityLabel(row = {}) {
        return row?.type === 'entry' ? summaryEntryQuantityLabel(row) : summaryMenuQuantityLabel(row);
    }

    function summaryEntryUnitAmountLabel(row = {}, currency = 'UAH') {
        const unitPrice = Number(row.unitPrice);
        const subtotal = row.subtotal;
        if (Number.isFinite(unitPrice) && unitPrice > 0) {
            return `× ${formatMoney(unitPrice, currency)} = ${formatMoney(subtotal, currency)}`;
        }
        return formatMoney(subtotal, currency);
    }

    function summaryEntryFullAmountLabel(row = {}, currency = 'UAH') {
        const quantityLabel = summaryEntryQuantityLabel(row);
        const unitPrice = Number(row.unitPrice);
        if (Number.isFinite(unitPrice) && unitPrice > 0) {
            return `${quantityLabel} × ${formatMoney(unitPrice, currency)} = ${formatMoney(row.subtotal, currency)}`;
        }
        return `${quantityLabel} = ${formatMoney(row.subtotal, currency)}`;
    }

    function briefItem(label, value) {
        return `
            <div class="summary-brief-item">
                <span class="summary-brief-label">${escapeHtml(label)}:</span>
                <span class="summary-brief-value">${escapeHtml(formatValue(value))}</span>
            </div>
        `;
    }

    function briefColumn(items = []) {
        return `
            <div class="summary-brief-column">
                ${items.filter(Boolean).join('')}
            </div>
        `;
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

    function summaryCommentRows(summary) {
        return (Array.isArray(summary?.comments) ? summary.comments : [])
            .map(comment => ({
                label: comment?.label || 'Примітка',
                text: comment?.text || ''
            }))
            .filter(comment => comment.text);
    }

    function summaryServingTime(row = {}) {
        const meta = row.meta || {};
        return meta.servingTime || meta.time || null;
    }

    function orderRowsHtml(summary) {
        const rows = summaryOrderRows(summary);
        const currency = summary?.totals?.currency || 'UAH';
        if (!rows.length) {
            return '<div class="summary-order-empty">Позиції замовлення відсутні.</div>';
        }
        return `
            <table class="summary-order-table">
                <colgroup>
                    <col style="width:42px">
                    <col>
                    <col style="width:118px">
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
                    ${rows.map((row, index) => {
                        const isEntry = row?.type === 'entry';
                        const entryAmount = isEntry ? summaryEntryUnitAmountLabel(row, currency) : null;
                        const comment = isEntry
                            ? [entryAmount, row.comment].filter(Boolean).join(' · ')
                            : orderRowComment(row);
                        return `
                            <tr>
                                <td class="num">${index + 1}</td>
                                <td class="name">${escapeHtml(row.title || row.name || 'Позиція')}</td>
                                <td class="qty">${escapeHtml(summaryOrderQuantityLabel(row))}</td>
                                <td class="serving">${escapeHtml(isEntry ? '—' : formatValue(summaryServingTime(row)))}</td>
                                <td>${escapeHtml(formatValue(comment))}</td>
                            </tr>
                        `;
                    }).join('')}
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

    function renderComments(summary) {
        const comments = summaryCommentRows(summary);
        if (!comments.length) return '';
        return `
            <div class="summary-note-block summary-comments">
                ${comments.map(comment => `
                    <div class="summary-comment-row">
                        <strong>${escapeHtml(comment.label)}</strong>
                        <span>${escapeHtml(comment.text)}</span>
                    </div>
                `).join('')}
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
                    <span>Вхід: ${escapeHtml(formatMoney(totals.entrySubtotal, currency))}</span>
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
        const printRoot = el('bookingSummaryPrintRoot');
        const venue = summary.venue || {};
        const event = summary.event || {};
        const customer = summary.customer || {};
        const celebrant = summary.celebrant || {};
        const counts = summary.counts || {};
        const programLabel = event.hasRealProgram ? (event.programDisplayName || event.programName) : null;

        if (printRoot) printRoot.hidden = false;
        doc.hidden = false;
        doc.innerHTML = `
            <header class="summary-doc-header">
                <div class="summary-doc-heading">
                    <h2 class="summary-venue-name">${escapeHtml(venue.name || 'Заклад')}</h2>
                </div>
                <div class="summary-doc-meta-grid">
                    <div class="summary-venue-lines">
                        <span>${escapeHtml(formatValue(venue.addressLine1))}</span>
                        <span>${escapeHtml(formatValue(venue.addressLine2))}</span>
                        <span>${escapeHtml(formatValue(venue.phone))}</span>
                    </div>
                    <div class="summary-doc-meta">
                        <span>Booking ID: ${escapeHtml(summary.bookingId || '—')}</span>
                        <span>Сформовано: ${escapeHtml(formatDateTime(summary.document?.generatedAt))}</span>
                        <span>Менеджер: ${escapeHtml(formatValue(summary.document?.generatedBy))}</span>
                    </div>
                </div>
            </header>

            <h1 class="summary-title">${escapeHtml(summary.document?.title || 'БАНКЕТНИЙ ЛИСТ')}</h1>

            <section class="summary-brief" aria-label="Коротка інформація по банкету">
                <div class="summary-brief-grid">
                    ${briefColumn([
                        briefItem('Клієнт', customer.name),
                        briefItem('Телефон', customer.phone),
                        briefItem('Кімната', event.room),
                        briefItem('Дата банкету', formatDate(event.date)),
                        briefItem('Прихід гостей', event.time)
                    ])}
                    ${briefColumn([
                        briefItem('Діти', counts.children),
                        programLabel ? briefItem('Програма', programLabel) : '',
                        briefItem('Іменинник', celebrant.name),
                        briefItem('Дата народження', formatBirthday(celebrant.birthday)),
                        briefItem('Оформлено', formatDateTime(event.createdAt))
                    ])}
                </div>
            </section>

            <section class="summary-section summary-section--orders">
                <h2>Замовлення</h2>
                ${orderRowsHtml(summary)}
            </section>

            ${summaryServiceEventRows(summary).length ? `
                <section class="summary-section summary-section--service-events">
                    <h2>Події видачі</h2>
                    ${serviceEventsHtml(summary)}
                </section>
            ` : ''}

            ${summaryCommentRows(summary).length ? `
                <section class="summary-section summary-section--comments">
                    <h2>Примітки</h2>
                    ${renderComments(summary)}
                </section>
            ` : ''}

            <section class="summary-section summary-section--finance">
                <h2>Суми і завдаток</h2>
                ${renderTotals(summary)}
            </section>

            <section class="summary-section summary-section--terms">
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
        const comments = summaryCommentRows(summary);
        const terms = Array.isArray(summary.terms?.items) ? summary.terms.items : [];
        const programLabel = event.hasRealProgram ? (event.programDisplayName || event.programName) : null;

        return [
            summary.venue?.name || 'Банкетний лист',
            `Booking ID: ${summary.bookingId || '—'}`,
            '',
            `Дата банкету: ${formatDate(event.date)}`,
            `Прихід гостей: ${formatValue(event.time)}`,
            `Замовник: ${formatValue(customer.name)}`,
            `Телефон: ${formatValue(customer.phone)}`,
            `Іменинник: ${formatValue(celebrant.name)}`,
            `Дата народження: ${formatBirthday(celebrant.birthday)}`,
            `Кімната: ${formatValue(event.room)}`,
            `Дата оформлення: ${formatDateTime(event.createdAt)}`,
            `Менеджер: ${formatValue(event.manager)}`,
            `Дітей: ${formatValue(counts.children)}`,
            `Дорослих: ${formatValue(counts.adults)}`,
            ...(programLabel ? [`Програма: ${formatValue(programLabel)}`] : []),
            '',
            'Замовлення:',
            ...(rows.length ? rows.map((row, index) => {
                const comment = orderRowComment(row);
                const servingTime = summaryServingTime(row);
                const quantityLabel = summaryOrderQuantityLabel(row);
                if (row?.type === 'entry') {
                    const entryComment = row.comment ? ` (${row.comment})` : '';
                    return `${index + 1}. ${row.title || 'Вхід'} — ${summaryEntryFullAmountLabel(row, currency)}${entryComment}`;
                }
                return `${index + 1}. ${row.title || 'Позиція'} — ${formatValue(servingTime)} — ${quantityLabel} × ${formatMoney(row.unitPrice, currency)} = ${formatMoney(row.subtotal, currency)}${comment ? ` (${comment})` : ''}`;
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
            ...(comments.length ? [
                '',
                'Примітки:',
                ...comments.map(comment => `- ${comment.label}: ${comment.text}`)
            ] : []),
            '',
            `Сума замовлення: ${formatMoney(totals.orderTotal, currency)}`,
            `Вхід: ${formatMoney(totals.entrySubtotal, currency)}`,
            `Меню: ${formatMoney(totals.menuSubtotal, currency)}`,
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

    function printSummaryDocument() {
        const originalTitle = document.title;
        const printTitle = currentSummary?.bookingId
            ? `Банкетний лист ${currentSummary.bookingId}`
            : 'Банкетний лист';
        let restored = false;

        const restoreTitle = () => {
            if (restored) return;
            restored = true;
            document.title = originalTitle;
            window.removeEventListener('afterprint', restoreTitle);
        };

        window.addEventListener('afterprint', restoreTitle, { once: true });
        document.title = printTitle;
        window.print();
        setTimeout(restoreTitle, 1000);
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
            setState('Потрібно увійти в CRM, щоб відкрити банкетний лист.', 'error');
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
            setState(data.error || `Не вдалося завантажити банкетний лист (${response.status}).`, 'error');
            return;
        }

        currentSummary = data;
        renderWarnings(data.warnings);
        renderDocument(data);
        setState('');
    }

    function bindActions() {
        el('bookingSummaryPrint')?.addEventListener('click', printSummaryDocument);
        el('bookingSummaryCopy')?.addEventListener('click', async () => {
            if (!currentSummary) {
                showToast('Банкетний лист ще не завантажений');
                return;
            }
            try {
                await copyText(summaryText(currentSummary));
                showToast('Текст банкетного листа скопійовано');
            } catch {
                showToast('Не вдалося скопіювати текст');
            }
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        bindActions();
        loadSummary().catch(err => {
            console.error('[booking-summary] load failed', err);
            setState('Не вдалося завантажити банкетний лист.', 'error');
        });
    });
})();
