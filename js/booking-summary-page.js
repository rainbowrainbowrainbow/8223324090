'use strict';

(function () {
    const API_BASE = '/api';
    let currentSummary = null;
    let currentSummaryRequest = {
        id: '',
        businessContext: 'event_genix',
        groupId: '',
        mode: 'client'
    };

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

    function summaryCelebrants(summary = {}) {
        const explicit = Array.isArray(summary.celebrants) ? summary.celebrants : [];
        const customerChildren = Array.isArray(summary.customer?.children) ? summary.customer.children : [];
        const fallback = summary.celebrant ? [summary.celebrant] : [];
        return [...explicit, ...customerChildren, ...fallback]
            .map(child => ({
                name: String(child?.name || child?.childName || child?.child_name || '').trim(),
                birthday: String(child?.birthday || child?.birthDate || child?.childBirthday || child?.child_birthday || '').trim()
            }))
            .filter(child => child.name || child.birthday)
            .filter((child, index, rows) => rows.findIndex(item =>
                item.name === child.name && item.birthday === child.birthday
            ) === index);
    }

    function summaryCelebrantsNames(summary = {}) {
        const names = summaryCelebrants(summary).map(child => child.name).filter(Boolean);
        return names.length ? names.join(', ') : null;
    }

    function summaryCelebrantsBirthdays(summary = {}) {
        const birthdays = summaryCelebrants(summary).map(child => child.birthday).filter(Boolean);
        return birthdays.length ? birthdays.map(formatBirthday).join(', ') : null;
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

    function summaryMoney(value) {
        const n = Number(value);
        return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
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
        if (row?.type === 'entry') return summaryEntryQuantityLabel(row);
        if (['program', 'activity', 'service_event'].includes(row?.type)) return '—';
        return summaryMenuQuantityLabel(row);
    }

    function summaryDurationLabel(row = {}) {
        if (!['program', 'activity'].includes(row?.type)) return '—';
        const meta = row.meta || {};
        const raw = row.durationMinutes ?? row.duration_minutes ?? meta.durationMinutes ?? meta.duration_minutes ?? meta.duration;
        const duration = Number(raw);
        if (!Number.isFinite(duration) || duration <= 0) return '—';
        return `${Math.round(duration)} хв`;
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

    const SUMMARY_MODES = new Set(['client', 'kitchen', 'staff']);
    const FALLBACK_SUMMARY_MODE_CONTRACTS = Object.freeze({
        client: Object.freeze({
            mode: 'client',
            sections: Object.freeze({
                header: true,
                brief: true,
                orderRows: true,
                schedule: true,
                finance: true,
                terms: true,
                comments: false,
                warnings: false,
                responsible: true
            }),
            orderRowTypes: Object.freeze(['program', 'activity', 'entry', 'menu']),
            scheduleSourceRowTypes: Object.freeze(['program', 'activity', 'entry', 'menu', 'service_event']),
            commentTypes: Object.freeze([]),
            showPrices: true,
            showInternalFields: false,
            showEmptyResponsible: false
        }),
        kitchen: Object.freeze({
            mode: 'kitchen',
            sections: Object.freeze({
                header: true,
                brief: true,
                orderRows: true,
                schedule: true,
                finance: false,
                terms: false,
                comments: true,
                warnings: false,
                responsible: true
            }),
            orderRowTypes: Object.freeze(['menu']),
            scheduleSourceRowTypes: Object.freeze(['menu', 'service_event']),
            commentTypes: Object.freeze(['kitchen']),
            showPrices: false,
            showInternalFields: false,
            showEmptyResponsible: true
        }),
        staff: Object.freeze({
            mode: 'staff',
            sections: Object.freeze({
                header: true,
                brief: true,
                orderRows: true,
                schedule: true,
                finance: true,
                terms: true,
                comments: true,
                warnings: true,
                responsible: true
            }),
            orderRowTypes: Object.freeze(['program', 'activity', 'entry', 'menu']),
            scheduleSourceRowTypes: Object.freeze(['program', 'activity', 'entry', 'menu', 'service_event']),
            commentTypes: Object.freeze(['activity', 'kitchen', 'internal']),
            showPrices: true,
            showInternalFields: true,
            showEmptyResponsible: true
        })
    });

    function normalizeSummaryMode(mode) {
        const normalized = String(mode || '').trim().toLowerCase();
        return SUMMARY_MODES.has(normalized) ? normalized : 'client';
    }

    function summaryMode(summary = currentSummary) {
        return normalizeSummaryMode(summary?.mode || qs().get('mode') || 'client');
    }

    function cloneSummaryModeContract(contract) {
        return {
            ...contract,
            sections: { ...(contract.sections || {}) },
            orderRowTypes: Array.isArray(contract.orderRowTypes) ? [...contract.orderRowTypes] : [],
            scheduleSourceRowTypes: Array.isArray(contract.scheduleSourceRowTypes) ? [...contract.scheduleSourceRowTypes] : [],
            commentTypes: Array.isArray(contract.commentTypes) ? [...contract.commentTypes] : []
        };
    }

    function summaryModeContract(summary = currentSummary, mode = summaryMode(summary)) {
        const normalizedMode = normalizeSummaryMode(mode);
        const contract = summary?.modeContract;
        if (contract && normalizeSummaryMode(contract.mode) === normalizedMode) {
            return cloneSummaryModeContract(contract);
        }
        return cloneSummaryModeContract(FALLBACK_SUMMARY_MODE_CONTRACTS[normalizedMode]);
    }

    function summaryModeSection(summary, section, mode = summaryMode(summary)) {
        return Boolean(summaryModeContract(summary, mode).sections?.[section]);
    }

    function summaryModeAllowsComment(summary, type, mode = summaryMode(summary)) {
        const contract = summaryModeContract(summary, mode);
        return Boolean(contract.sections?.comments && contract.commentTypes.includes(String(type || '').trim().toLowerCase()));
    }

    function orderRowComment(row = {}) {
        const meta = row.meta || {};
        const parts = [];
        if (row.type === 'service_event' && meta.time) parts.push(`Час ${meta.time}`);
        if (row.comment) parts.push(row.comment);
        return parts.join(' · ') || null;
    }

    function summaryOrderRows(summary, mode = summaryMode(summary)) {
        const rowTypes = new Set(summaryModeContract(summary, mode).orderRowTypes || []);
        return (Array.isArray(summary?.orderRows) ? summary.orderRows : [])
            .filter(row => row && rowTypes.has(row.type));
    }

    function summaryServiceEventRows(summary) {
        const explicit = Array.isArray(summary?.serviceEvents) ? summary.serviceEvents : [];
        const fromRows = (Array.isArray(summary?.orderRows) ? summary.orderRows : [])
            .filter(row => row?.type === 'service_event');
        return explicit.length ? explicit : fromRows;
    }

    function summaryScheduleTimeSort(item = {}) {
        const match = String(item.time || '').match(/^(\d{1,2}):(\d{2})/);
        if (!match) return 99999;
        return Number(match[1]) * 60 + Number(match[2]);
    }

    function summaryScheduleModes(item = {}) {
        return Array.isArray(item.modes) ? item.modes.map(mode => String(mode || '').trim().toLowerCase()) : [];
    }

    function summaryScheduleNoteModes(item = {}) {
        return Array.isArray(item.noteModes) ? item.noteModes.map(mode => String(mode || '').trim().toLowerCase()) : [];
    }

    function summaryScheduleNoteForMode(item = {}, mode = 'client') {
        const note = item.note || '';
        if (!note) return '';
        const noteModes = summaryScheduleNoteModes(item);
        return noteModes.length && !noteModes.includes(mode) ? '' : note;
    }

    function pushSummaryScheduleFallback(items, seen, time, title, note = '') {
        if (!time || !title) return;
        const key = `${time}|${title}|${note}`.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        items.push({ time, title, note });
    }

    function fallbackSummaryScheduleRows(summary, mode = summaryMode(summary)) {
        const items = [];
        const seen = new Set();
        const event = summary?.event || {};
        const contract = summaryModeContract(summary, mode);
        const scheduleSourceTypes = new Set(contract.scheduleSourceRowTypes || contract.orderRowTypes || []);
        if (mode !== 'kitchen') {
            pushSummaryScheduleFallback(items, seen, event.time, 'Прихід гостей', event.room ? `Кімната: ${event.room}` : '');
        }
        (Array.isArray(summary?.orderRows) ? summary.orderRows : [])
            .filter(row => row && scheduleSourceTypes.has(row.type))
            .forEach(row => {
                if (row?.type === 'program' || row?.type === 'activity') {
                    pushSummaryScheduleFallback(items, seen, row.meta?.time || event.time, row.title || 'Активність');
                } else if (row?.type === 'menu') {
                    pushSummaryScheduleFallback(items, seen, row.meta?.servingTime || row.meta?.time, 'Видача меню');
                }
            });
        summaryServiceEventRows(summary).filter(row => row && scheduleSourceTypes.has(row.type)).forEach(row => {
            const meta = row.meta || {};
            pushSummaryScheduleFallback(items, seen, meta.time || meta.servingTime, row.title || 'Подія');
        });
        return items.sort((a, b) => summaryScheduleTimeSort(a) - summaryScheduleTimeSort(b));
    }

    function summaryScheduleRows(summary, mode = summaryMode(summary)) {
        const normalizedMode = normalizeSummaryMode(mode);
        const rows = Array.isArray(summary?.schedule) ? summary.schedule : null;
        if (!rows) return fallbackSummaryScheduleRows(summary, normalizedMode);
        return rows
            .map((item, index) => {
                const modes = summaryScheduleModes(item);
                if (modes.length && !modes.includes(normalizedMode)) return null;
                const time = item?.time || '';
                const title = item?.title || '';
                if (!time || !title) return null;
                return {
                    time,
                    title,
                    note: summaryScheduleNoteForMode(item, normalizedMode),
                    sortOrder: Number.isFinite(item?.sortOrder) ? item.sortOrder : index
                };
            })
            .filter(Boolean)
            .sort((a, b) => {
                const timeDiff = summaryScheduleTimeSort(a) - summaryScheduleTimeSort(b);
                if (timeDiff !== 0) return timeDiff;
                return (a.sortOrder || 0) - (b.sortOrder || 0);
            });
    }

    function summaryResponsibleRows(summary, mode = summaryMode(summary)) {
        const normalizedMode = normalizeSummaryMode(mode);
        const contract = summaryModeContract(summary, normalizedMode);
        const rows = Array.isArray(summary?.responsible?.rows) ? summary.responsible.rows : [];
        return rows
            .map(row => {
                const modes = Array.isArray(row?.modes) ? row.modes.map(item => String(item || '').trim().toLowerCase()).filter(Boolean) : [];
                if (modes.length && !modes.includes(normalizedMode)) return null;
                const label = row?.label || '';
                const name = row?.name || '';
                if (!label) return null;
                if (!name && (!contract.showEmptyResponsible || row?.showWhenEmpty !== true)) return null;
                return { label, name };
            })
            .filter(Boolean);
    }

    function summaryCommentRows(summary, mode = summaryMode(summary)) {
        return (Array.isArray(summary?.comments) ? summary.comments : [])
            .map(comment => ({
                type: comment?.type || '',
                label: comment?.type === 'activity' ? 'Коментар до активності' : (comment?.label || 'Примітка'),
                text: comment?.text || ''
            }))
            .filter(comment => comment.text && summaryModeAllowsComment(summary, comment.type, mode));
    }

    function summaryServingTime(row = {}) {
        const meta = row.meta || {};
        return meta.servingTime || meta.time || null;
    }

    function summaryOrderServingLabel(row = {}) {
        if (['program', 'activity', 'entry'].includes(row?.type)) return '—';
        return formatValue(summaryServingTime(row));
    }

    function summaryClientOrderQuantityLabel(row = {}) {
        return summaryOrderQuantityLabel(row);
    }

    function summaryClientOrderUnitPriceLabel(row = {}, currency = 'UAH') {
        return formatMoney(row.unitPrice, currency);
    }

    function summaryClientOrderSubtotalLabel(row = {}, currency = 'UAH') {
        return formatMoney(row.subtotal, currency);
    }

    function summaryClientOrderRowViewFromRow(row = {}, currency = 'UAH') {
        const duration = summaryDurationLabel(row);
        const serving = summaryOrderServingLabel(row);
        const comment = orderRowComment(row);
        const commentLabel = comment ? `Примітка: ${comment}` : null;
        const metaLines = [];
        if (duration !== '—') metaLines.push(`Тривалість: ${duration}`);
        if (serving !== '—') metaLines.push(`Видача: ${serving}`);
        if (commentLabel) metaLines.push(commentLabel);
        return {
            type: row?.type || 'item',
            title: row?.title || row?.name || (row?.type === 'entry' ? 'Вхід' : 'Позиція'),
            quantityLabel: summaryClientOrderQuantityLabel(row),
            unitPriceLabel: summaryClientOrderUnitPriceLabel(row, currency),
            subtotalLabel: summaryClientOrderSubtotalLabel(row, currency),
            metaLines,
            commentLabel
        };
    }

    function normalizeSummaryClientOrderRowView(row = {}) {
        return {
            type: String(row?.type || 'item'),
            title: formatValue(row?.title || row?.name || 'Позиція'),
            quantityLabel: formatValue(row?.quantityLabel),
            unitPriceLabel: formatValue(row?.unitPriceLabel),
            subtotalLabel: formatValue(row?.subtotalLabel),
            metaLines: (Array.isArray(row?.metaLines) ? row.metaLines : [])
                .map(item => String(item || '').trim())
                .filter(Boolean),
            commentLabel: String(row?.commentLabel || '').trim() || null
        };
    }

    function summaryClientOrderRowViews(summary = {}, mode = summaryMode(summary)) {
        const normalizedMode = normalizeSummaryMode(mode);
        const explicit = summary?.orderRowViews?.[normalizedMode] || summary?.orderRowViewModels?.[normalizedMode];
        if (Array.isArray(explicit)) return explicit.map(normalizeSummaryClientOrderRowView);
        const currency = summary?.totals?.currency || 'UAH';
        return summaryOrderRows(summary, normalizedMode)
            .map(row => normalizeSummaryClientOrderRowView(summaryClientOrderRowViewFromRow(row, currency)));
    }

    function summaryClientOrderMetaHtml(viewModel = {}) {
        const items = Array.isArray(viewModel.metaLines) ? viewModel.metaLines : [];
        if (!items.length) return '';
        return `<div class="summary-order-meta">${items.map(item => `<span>${escapeHtml(item)}</span>`).join('')}</div>`;
    }

    function summaryClientOrderTextLines(rowViews = []) {
        return rowViews.flatMap((row, index) => {
            const lines = [
                `${index + 1}. ${row.title}`,
                `   К-сть: ${row.quantityLabel}`,
                `   Ціна: ${row.unitPriceLabel}`,
                `   Сума: ${row.subtotalLabel}`
            ];
            (Array.isArray(row.metaLines) ? row.metaLines : []).forEach(item => {
                lines.push(`   ${item}`);
            });
            return lines;
        });
    }

    function orderRowsHtml(summary, mode = summaryMode(summary)) {
        const rows = summaryOrderRows(summary, mode);
        const currency = summary?.totals?.currency || 'UAH';
        if (!rows.length) {
            return '<div class="summary-order-empty">Позиції замовлення відсутні.</div>';
        }
        if (normalizeSummaryMode(mode) === 'client') {
            const clientRows = summaryClientOrderRowViews(summary, mode);
            if (!clientRows.length) {
                return '<div class="summary-order-empty">Позиції замовлення відсутні.</div>';
            }
            return `
            <table class="summary-order-table summary-order-table--client">
                <colgroup>
                    <col>
                    <col style="width:118px">
                    <col style="width:116px">
                    <col style="width:122px">
                </colgroup>
                <thead>
                    <tr>
                        <th>Позиція</th>
                        <th class="qty">К-сть</th>
                        <th class="money">Ціна</th>
                        <th class="money">Сума</th>
                    </tr>
                </thead>
                <tbody>
                    ${clientRows.map(row => `
                        <tr>
                            <td class="name" data-label="Позиція">
                                <span>${escapeHtml(row.title)}</span>
                                ${summaryClientOrderMetaHtml(row)}
                            </td>
                            <td class="qty" data-label="К-сть">${escapeHtml(row.quantityLabel)}</td>
                            <td class="money" data-label="Ціна">${escapeHtml(row.unitPriceLabel)}</td>
                            <td class="money" data-label="Сума">${escapeHtml(row.subtotalLabel)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
        }
        return `
            <table class="summary-order-table">
                <colgroup>
                    <col style="width:42px">
                    <col>
                    <col style="width:86px">
                    <col style="width:118px">
                    <col style="width:112px">
                    <col style="width:150px">
                </colgroup>
                <thead>
                    <tr>
                        <th class="num">№</th>
                        <th>Назва</th>
                        <th class="duration">Тривалість</th>
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
                                <td class="duration">${escapeHtml(summaryDurationLabel(row))}</td>
                                <td class="qty">${escapeHtml(summaryOrderQuantityLabel(row))}</td>
                                <td class="serving">${escapeHtml(summaryOrderServingLabel(row))}</td>
                                <td>${escapeHtml(formatValue(comment))}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;
    }

    function renderResponsible(summary, mode = summaryMode(summary)) {
        const rows = summaryResponsibleRows(summary, mode);
        if (!rows.length) return '';
        return `
            <div class="summary-responsible-list">
                ${rows.map(row => `
                    <div class="summary-responsible-item">
                        <strong>${escapeHtml(row.label)}</strong>
                        <span>${escapeHtml(formatValue(row.name))}</span>
                    </div>
                `).join('')}
            </div>
        `;
    }

    function renderSchedule(summary, mode = summaryMode(summary)) {
        const rows = summaryScheduleRows(summary, mode);
        if (!rows.length) return '';
        return `
            <div class="summary-schedule-list">
                ${rows.map(row => `
                    <div class="summary-schedule-item">
                        <time>${escapeHtml(row.time)}</time>
                        <div>
                            <strong>${escapeHtml(row.title)}</strong>
                            ${row.note ? `<small>${escapeHtml(row.note)}</small>` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
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

    function renderComments(summary, mode = summaryMode(summary)) {
        const comments = summaryCommentRows(summary, mode);
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

    function addSummaryFinanceRow(rows, key, label, amount, currency, options = {}) {
        const value = summaryMoney(amount);
        if (value === null) return;
        if (options.hideZero !== false && value <= 0) return;
        rows.push({
            key,
            label,
            amount: value,
            currency,
            role: options.role || 'line'
        });
    }

    function formatGeneratedAtShort(value) {
        const date = value instanceof Date ? value : new Date(value || Date.now());
        if (Number.isNaN(date.getTime())) return '—';
        return date.toLocaleString('uk-UA', {
            year: '2-digit',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function fallbackSummaryFinanceRows(summary) {
        const totals = summary?.totals || {};
        const currency = totals.currency || 'UAH';
        const rows = [];
        const orderTotal = summaryMoney(totals.orderTotal);
        const bookingPrice = summaryMoney(totals.bookingPrice);
        addSummaryFinanceRow(rows, 'total', 'Загальна сума', orderTotal ?? bookingPrice, currency, { hideZero: false, role: 'total' });
        return rows;
    }

    function summaryFinanceRows(summary) {
        const rows = Array.isArray(summary?.finance?.rows) ? summary.finance.rows : [];
        const normalized = rows
            .map(row => ({
                key: row?.key || '',
                label: row?.label || '',
                amount: summaryMoney(row?.amount),
                currency: row?.currency || summary?.finance?.currency || summary?.totals?.currency || 'UAH',
                role: row?.role || 'line'
            }))
            .filter(row => row.label && row.amount !== null);
        const totalRow = normalized.find(row => row.key === 'total')
            || normalized.find(row => row.role === 'total');
        if (totalRow) {
            return [{
                ...totalRow,
                key: 'total',
                label: 'Загальна сума',
                role: 'total'
            }];
        }
        return fallbackSummaryFinanceRows(summary);
    }

    function renderTotals(summary) {
        const rows = summaryFinanceRows(summary);
        if (!rows.length) return '<div class="summary-order-empty">Фінансові дані відсутні.</div>';
        return `
            <table class="summary-finance-table">
                <tbody>
                    ${rows.map(row => `
                        <tr class="summary-finance-row summary-finance-row--${escapeHtml(row.role)}" data-finance-row="${escapeHtml(row.key)}">
                            <th scope="row">${escapeHtml(row.label)}</th>
                            <td>${escapeHtml(formatMoney(row.amount, row.currency))}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
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
        const mode = summaryMode(summary);
        const contract = summaryModeContract(summary, mode);
        const sections = contract.sections || {};
        const scheduleRows = sections.schedule ? summaryScheduleRows(summary, mode) : [];
        const responsibleRows = sections.responsible ? summaryResponsibleRows(summary, mode) : [];
        const commentRows = sections.comments ? summaryCommentRows(summary, mode) : [];
        const renderedAt = new Date();
        const manager = summary.document?.generatedBy || event.manager;
        const documentTitle = summary.document?.title || 'БАНКЕТНИЙ ЛИСТ';
        const celebrants = summaryCelebrants(summary);
        const celebrantsNameLabel = celebrants.length > 1 ? 'Діти клієнта' : 'Іменинник';
        const celebrantsBirthdayLabel = celebrants.length > 1 ? 'ДН дітей' : 'Дата народження';
        const celebrantsNameDisplay = summaryCelebrantsNames(summary) || celebrant.name;
        const celebrantsBirthdayDisplay = summaryCelebrantsBirthdays(summary)
            || (celebrant.birthday ? formatBirthday(celebrant.birthday) : null);

        if (printRoot) printRoot.hidden = false;
        doc.hidden = false;
        doc.innerHTML = `
            <header class="banquet-hero" aria-label="Шапка банкетного листа">
                <div class="brand-logo-frame" aria-hidden="true">
                    <img class="brand-logo" src="images/banquet-logo.png" alt="${escapeHtml(venue.name || 'Event Genix')}" loading="eager">
                    <span class="brand-mark"></span>
                </div>
                <div class="brand-copy">
                    <div class="generated-at">${escapeHtml(formatGeneratedAtShort(renderedAt))}</div>
                    <h1>${escapeHtml(venue.name || 'Заклад')}</h1>
                    <p>${escapeHtml(formatValue(venue.addressLine1))}</p>
                    <p>${escapeHtml(formatValue(venue.addressLine2))}</p>
                    <strong>${escapeHtml(formatValue(venue.phone))}</strong>
                </div>
                <aside class="booking-card" aria-label="Дані банкетного листа">
                    <h2>${escapeHtml(documentTitle)}</h2>
                    <div class="booking-id">${escapeHtml(summary.bookingId || '—')}</div>
                    <div class="booking-meta">
                        <div class="meta-row">
                            <span>Сформовано:</span>
                            <b>${escapeHtml(formatDateTime(renderedAt))}</b>
                        </div>
                        <div class="meta-row">
                            <span>Менеджер:</span>
                            <b>${escapeHtml(formatValue(manager))}</b>
                        </div>
                    </div>
                </aside>
            </header>

            <div class="banquet-content">
            ${sections.brief ? `<section class="summary-brief" aria-label="Коротка інформація по банкету">
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
                        briefItem(celebrantsNameLabel, celebrantsNameDisplay),
                        briefItem(celebrantsBirthdayLabel, celebrantsBirthdayDisplay),
                        briefItem('Бронь створено', formatDateTime(event.createdAt))
                    ])}
                </div>
            </section>` : ''}

            ${sections.responsible && responsibleRows.length ? `
                <section class="summary-section summary-section--responsible">
                    <h2>Відповідальні</h2>
                    ${renderResponsible(summary, mode)}
                </section>
            ` : ''}

            ${sections.schedule && scheduleRows.length ? `
                <section class="summary-section summary-section--schedule">
                    <h2>Розклад</h2>
                    ${renderSchedule(summary, mode)}
                </section>
            ` : ''}

            ${sections.orderRows ? `
                <section class="summary-section summary-section--orders">
                    <h2>${mode === 'kitchen' ? 'Кухня / видача' : 'Замовлення'}</h2>
                    ${orderRowsHtml(summary, mode)}
                </section>
            ` : ''}

            ${sections.schedule && !scheduleRows.length && summaryServiceEventRows(summary).length ? `
                <section class="summary-section summary-section--service-events">
                    <h2>Події видачі</h2>
                    ${serviceEventsHtml(summary)}
                </section>
            ` : ''}

            ${sections.comments && commentRows.length ? `
                <section class="summary-section summary-section--comments">
                    <h2>Примітки</h2>
                    ${renderComments(summary, mode)}
                </section>
            ` : ''}

            ${sections.finance ? `<section class="summary-section summary-section--finance">
                <h2>Фінанси</h2>
                ${renderTotals(summary)}
            </section>` : ''}

            ${sections.terms ? `<section class="summary-section summary-section--terms">
                <h2>${escapeHtml(summary.terms?.title || 'Умови банкету')}</h2>
                ${renderTerms(summary)}
            </section>` : ''}
            </div>
        `;
        const logo = doc.querySelector('.brand-logo');
        if (logo) {
            logo.addEventListener('error', () => {
                logo.hidden = true;
                logo.closest('.brand-logo-frame')?.classList.add('is-logo-missing');
            }, { once: true });
        }
    }

    function summaryText(summary) {
        const event = summary.event || {};
        const customer = summary.customer || {};
        const celebrant = summary.celebrant || {};
        const counts = summary.counts || {};
        const totals = summary.totals || {};
        const currency = totals.currency || 'UAH';
        const mode = summaryMode(summary);
        const contract = summaryModeContract(summary, mode);
        const sections = contract.sections || {};
        const rows = sections.orderRows ? summaryOrderRows(summary, mode) : [];
        const clientOrderRows = sections.orderRows && mode === 'client' ? summaryClientOrderRowViews(summary, mode) : [];
        const scheduleRows = sections.schedule ? summaryScheduleRows(summary, mode) : [];
        const serviceEvents = sections.schedule && !scheduleRows.length ? summaryServiceEventRows(summary) : [];
        const responsibleRows = sections.responsible ? summaryResponsibleRows(summary, mode) : [];
        const comments = sections.comments ? summaryCommentRows(summary, mode) : [];
        const financeRows = sections.finance ? summaryFinanceRows(summary) : [];
        const terms = sections.terms && Array.isArray(summary.terms?.items) ? summary.terms.items : [];
        const programLabel = event.hasRealProgram ? (event.programDisplayName || event.programName) : null;
        const celebrants = summaryCelebrants(summary);
        const celebrantsNameLabel = celebrants.length > 1 ? 'Діти клієнта' : 'Іменинник';
        const celebrantsBirthdayLabel = celebrants.length > 1 ? 'ДН дітей' : 'Дата народження';
        const celebrantsNameDisplay = summaryCelebrantsNames(summary) || celebrant.name;
        const celebrantsBirthdayDisplay = summaryCelebrantsBirthdays(summary)
            || (celebrant.birthday ? formatBirthday(celebrant.birthday) : null);

        return [
            summary.venue?.name || 'Банкетний лист',
            `Booking ID: ${summary.bookingId || '—'}`,
            '',
            `Дата банкету: ${formatDate(event.date)}`,
            `Прихід гостей: ${formatValue(event.time)}`,
            `Замовник: ${formatValue(customer.name)}`,
            `Телефон: ${formatValue(customer.phone)}`,
            `${celebrantsNameLabel}: ${formatValue(celebrantsNameDisplay)}`,
            `${celebrantsBirthdayLabel}: ${formatValue(celebrantsBirthdayDisplay)}`,
            `Кімната: ${formatValue(event.room)}`,
            `Бронь створено: ${formatDateTime(event.createdAt)}`,
            `Менеджер: ${formatValue(event.manager)}`,
            `Дітей: ${formatValue(counts.children)}`,
            `Дорослих: ${formatValue(counts.adults)}`,
            ...(programLabel ? [`Програма: ${formatValue(programLabel)}`] : []),
            '',
            ...(responsibleRows.length ? [
                'Відповідальні:',
                ...responsibleRows.map(row => `${row.label}: ${formatValue(row.name)}`),
                ''
            ] : []),
            ...(scheduleRows.length ? [
                'Розклад:',
                ...scheduleRows.map(row => `${row.time} — ${row.title}${row.note ? ` (${row.note})` : ''}`),
                ''
            ] : []),
            ...(sections.orderRows ? [
                mode === 'kitchen' ? 'Кухня / видача:' : 'Замовлення:',
                ...(mode === 'client'
                    ? (clientOrderRows.length ? summaryClientOrderTextLines(clientOrderRows) : ['Позиції відсутні'])
                    : rows.length ? rows.map((row, index) => {
                const comment = orderRowComment(row);
                const servingTime = summaryServingTime(row);
                const quantityLabel = summaryOrderQuantityLabel(row);
                const durationLabel = summaryDurationLabel(row);
                if (row?.type === 'entry') {
                    const entryComment = row.comment ? ` (${row.comment})` : '';
                    return `${index + 1}. ${row.title || 'Вхід'} — ${summaryEntryFullAmountLabel(row, currency)}${entryComment}`;
                }
                if (row?.type === 'program' || row?.type === 'activity') {
                    return `${index + 1}. ${row.title || 'Активність'} — ${durationLabel} — ${formatMoney(row.subtotal, currency)}${comment ? ` (${comment})` : ''}`;
                }
                if (!contract.showPrices) {
                    return `${index + 1}. ${row.title || 'Позиція'} — ${formatValue(servingTime)} — ${quantityLabel}${comment ? ` (${comment})` : ''}`;
                }
                return `${index + 1}. ${row.title || 'Позиція'} — ${formatValue(servingTime)} — ${quantityLabel} × ${formatMoney(row.unitPrice, currency)} = ${formatMoney(row.subtotal, currency)}${comment ? ` (${comment})` : ''}`;
                }) : ['Позиції відсутні'])
            ] : []),
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
            ...(sections.finance ? [
                '',
                'Фінанси:',
                ...(financeRows.length ? financeRows.map(row => `${row.label}: ${formatMoney(row.amount, row.currency || currency)}`) : ['—'])
            ] : []),
            ...(sections.terms ? [
                '',
                'Умови:',
                ...(terms.length ? terms.map(item => `- ${item}`) : ['—'])
            ] : [])
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

    function closeSummaryDocument() {
        const fallback = el('bookingSummaryClose')?.dataset.returnUrl || '/';
        if (window.history.length > 1) {
            window.history.back();
            return;
        }
        window.location.assign(fallback || '/');
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

    function bookingSummaryPdfUrl(mode) {
        const normalizedMode = normalizeSummaryMode(mode);
        const requestParams = new URLSearchParams({
            businessContext: currentSummaryRequest.businessContext || 'event_genix',
            mode: normalizedMode
        });
        if (currentSummaryRequest.groupId) requestParams.set('groupId', currentSummaryRequest.groupId);
        return `${API_BASE}/bookings/${encodeURIComponent(currentSummaryRequest.id)}/banquet-summary.pdf?${requestParams.toString()}`;
    }

    function filenameFromDisposition(disposition, fallback) {
        const value = String(disposition || '');
        const utfMatch = value.match(/filename\*=UTF-8''([^;]+)/i);
        if (utfMatch) {
            try {
                return decodeURIComponent(utfMatch[1]);
            } catch {}
        }
        const plainMatch = value.match(/filename="?([^";]+)"?/i);
        return plainMatch?.[1] || fallback;
    }

    async function responseErrorMessage(response) {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            const data = await response.json().catch(() => ({}));
            const base = data.error || data.message || `Не вдалося експортувати PDF (${response.status}).`;
            const details = Array.isArray(data.details)
                ? data.details
                    .map(item => item?.message || item?.code || item)
                    .filter(Boolean)
                : [];
            return details.length ? `${base}:\n- ${details.join('\n- ')}` : base;
        }
        return `Не вдалося експортувати PDF (${response.status}).`;
    }

    async function exportSummaryPdf(mode) {
        if (!currentSummary || !currentSummaryRequest.id) {
            showToast('Банкетний лист ще не завантажений');
            return;
        }
        const token = storedToken();
        if (!token) {
            showToast('Потрібно увійти в CRM, щоб експортувати PDF');
            return;
        }

        const normalizedMode = normalizeSummaryMode(mode);
        const button = document.querySelector(`[data-booking-summary-pdf-mode="${normalizedMode}"]`);
        if (button) button.disabled = true;

        try {
            const response = await fetch(bookingSummaryPdfUrl(normalizedMode), {
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/pdf'
                }
            });
            const contentType = response.headers.get('content-type') || '';
            if (!response.ok || !contentType.includes('application/pdf')) {
                throw new Error(await responseErrorMessage(response));
            }
            const blob = await response.blob();
            const filename = filenameFromDisposition(
                response.headers.get('content-disposition'),
                `banquet-sheet-${currentSummary.bookingId || currentSummaryRequest.id}-${normalizedMode}.pdf`
            );
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
            showToast('PDF експортовано');
        } catch (err) {
            console.error('[booking-summary] pdf export failed', err);
            showToast(err?.message || 'Не вдалося експортувати PDF');
        } finally {
            if (button) button.disabled = false;
        }
    }

    async function loadSummary() {
        const params = qs();
        const id = params.get('id');
        const businessContext = params.get('businessContext') || 'event_genix';
        const groupId = params.get('groupId') || '';
        const mode = normalizeSummaryMode(params.get('mode') || 'client');
        const returnUrl = params.get('return') || '/';
        const close = el('bookingSummaryClose');
        if (close) close.dataset.returnUrl = returnUrl || '/';

        if (!id) {
            setState('Не передано booking id.', 'error');
            return;
        }

        currentSummaryRequest = { id, businessContext, groupId, mode };

        const token = storedToken();
        if (!token) {
            setState('Потрібно увійти в CRM, щоб відкрити банкетний лист.', 'error');
            return;
        }

        const requestParams = new URLSearchParams({ businessContext, mode });
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
        renderWarnings(summaryModeSection(data, 'warnings', mode) ? data.warnings : []);
        renderDocument(data);
        setState('');
    }

    function bindActions() {
        el('bookingSummaryClose')?.addEventListener('click', closeSummaryDocument);
        el('bookingSummaryPrint')?.addEventListener('click', printSummaryDocument);
        el('bookingSummaryClientPdf')?.addEventListener('click', () => exportSummaryPdf('client'));
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
