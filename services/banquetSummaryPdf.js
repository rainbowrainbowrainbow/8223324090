'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const {
    BANQUET_SUMMARY_MODE_LABELS: MODE_LABELS,
    normalizeBanquetSummaryMode,
    banquetSummaryModeContract,
    banquetSummaryModeRowTypes,
    banquetSummaryModeAllowsComment
} = require('./banquetSummary');

const ROOT_DIR = path.resolve(__dirname, '..');
const FONT_DIR = path.join(ROOT_DIR, 'assets', 'fonts');
const PDF_FONT_REGULAR = path.join(FONT_DIR, 'Nunito.ttf');
const PDF_FONT_BOLD = path.join(FONT_DIR, 'Nunito-Bold.ttf');
const PDF_FONT_BLACK = path.join(FONT_DIR, 'Nunito-Black.ttf');
const PDF_SERIF_REGULAR = path.join(FONT_DIR, 'NotoSerif-Regular.ttf');
const PDF_SERIF_BOLD = path.join(FONT_DIR, 'NotoSerif-Bold.ttf');

const PDF_VALIDATION_ERROR_CODE = 'banquet_summary_pdf_validation_failed';
const ENTRY_BLOCKING_WARNING_CODES = new Set([
    'entry_quantity_missing',
    'entry_date_missing',
    'entry_price_rule_missing'
]);

function cleanText(value, fallback = '') {
    if (value === undefined || value === null) return fallback;
    const text = String(value).replace(/\s+/g, ' ').trim();
    return text || fallback;
}

function pdfText(value, fallback = '—') {
    return cleanText(value, fallback);
}

function nullableNumber(value) {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function formatDate(value) {
    if (!value) return '—';
    const text = String(value).slice(0, 10);
    const parts = text.split('-');
    if (parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`;
    return text || '—';
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
    const number = nullableNumber(value);
    if (number === null) return '—';
    const suffix = String(currency || 'UAH').toUpperCase() === 'UAH' ? 'грн' : String(currency || 'UAH').toUpperCase();
    return `${new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(number)} ${suffix}`;
}

function formatQuantity(value) {
    const number = nullableNumber(value);
    if (number === null) return pdfText(value);
    return Number.isInteger(number)
        ? String(number)
        : new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(number);
}

function rowQuantityLabel(row = {}) {
    if (row.type === 'entry') {
        const quantity = nullableNumber(row.quantity);
        return quantity === null ? '—' : `${formatQuantity(quantity)} дітей`;
    }
    if (row.type === 'program' || row.type === 'activity') return '—';
    if (row.type === 'service_event') return '—';
    const unit = cleanText(row.meta?.servingUnit || row.servingUnit || row.serving_unit);
    const quantity = formatQuantity(row.quantity);
    return unit && quantity !== '—' ? `${quantity} ${unit}` : quantity;
}

function rowDurationLabel(row = {}) {
    if (row.type !== 'program' && row.type !== 'activity') return '—';
    const duration = nullableNumber(
        row.durationMinutes
        ?? row.duration_minutes
        ?? row.meta?.durationMinutes
        ?? row.meta?.duration_minutes
        ?? row.meta?.duration
    );
    return duration === null || duration <= 0 ? '—' : `${Math.round(duration)} хв`;
}

function rowServingTime(row = {}) {
    if (row.type === 'program' || row.type === 'activity' || row.type === 'entry') return '—';
    return cleanText(row.meta?.servingTime || row.meta?.time || row.servingTime || row.serving_time, '—');
}

function rowCommentForMode(row = {}, mode) {
    if (row.type === 'entry') return cleanText(row.comment);
    const parts = [];
    if (row.type === 'service_event' && row.meta?.time) parts.push(`Час ${row.meta.time}`);
    if (row.comment && (mode !== 'client' || row.type === 'program' || row.type === 'activity')) {
        parts.push(row.comment);
    }
    return cleanText(parts.join(' · '));
}

function safeFilenamePart(value, fallback = 'booking') {
    const text = cleanText(value, fallback)
        .replace(/[\\/:*?"<>|]+/g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    return text || fallback;
}

function banquetSummaryPdfFilename(summary = {}, mode = 'client') {
    const normalizedMode = normalizeBanquetSummaryMode(mode);
    const bookingId = safeFilenamePart(summary.bookingId || summary.group?.id || 'booking');
    return `banquet-sheet-${bookingId}-${normalizedMode}.pdf`;
}

function existingPath(candidates = []) {
    return candidates.find(candidate => candidate && fs.existsSync(candidate)) || null;
}

function resolvePdfFonts() {
    const regular = existingPath([
        process.env.PDF_FONT_REGULAR,
        PDF_FONT_REGULAR,
        PDF_SERIF_REGULAR,
        'C:\\Windows\\Fonts\\arial.ttf',
        'C:\\Windows\\Fonts\\segoeui.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf'
    ]);
    const bold = existingPath([
        process.env.PDF_FONT_BOLD,
        PDF_FONT_BOLD,
        PDF_FONT_BLACK,
        PDF_SERIF_BOLD,
        regular,
        'C:\\Windows\\Fonts\\arialbd.ttf',
        'C:\\Windows\\Fonts\\segoeuib.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
        '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf'
    ]);

    if (!regular || !bold) {
        const err = new Error('PDF font with Cyrillic support is not available');
        err.statusCode = 500;
        err.code = 'pdf_font_missing';
        throw err;
    }
    return { regular, bold };
}

function allRows(summary = {}) {
    const rows = Array.isArray(summary.orderRows) ? summary.orderRows : [];
    const serviceEvents = Array.isArray(summary.serviceEvents) ? summary.serviceEvents : [];
    const serviceIds = new Set(serviceEvents.map(row => row?.id).filter(Boolean));
    const missingServiceEvents = serviceEvents.filter(row => row && (!row.id || !serviceIds.has(row.id) || !rows.some(item => item?.id === row.id)));
    return [...rows, ...missingServiceEvents];
}

function issue(code, message) {
    return { code, message };
}

function uniqueIssues(issues = []) {
    const result = [];
    const seen = new Set();
    for (const item of issues) {
        const code = cleanText(item?.code);
        const message = cleanText(item?.message);
        if (!code && !message) continue;
        const key = `${code || ''}:${message || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ code: code || 'pdf_validation_issue', message: message || code });
    }
    return result;
}

function positiveNumber(value) {
    const number = nullableNumber(value);
    return number !== null && number > 0;
}

function financeOrderTotal(summary = {}) {
    const totalRow = Array.isArray(summary.finance?.rows)
        ? summary.finance.rows.find(row => row?.key === 'total' || row?.role === 'total')
        : null;
    return nullableNumber(totalRow?.amount ?? summary.totals?.orderTotal);
}

function entryValidationIssues(summary = {}) {
    const warnings = Array.isArray(summary.warnings) ? summary.warnings : [];
    const issues = [];
    for (const warning of warnings) {
        if (!ENTRY_BLOCKING_WARNING_CODES.has(warning?.code)) continue;
        if (warning.code === 'entry_quantity_missing') {
            issues.push(issue('entry_quantity_missing', 'Не розраховано вхід: не вказано кількість дітей.'));
        } else if (warning.code === 'entry_date_missing') {
            issues.push(issue('entry_date_missing', 'Не розраховано вхід: не вказано дату банкету.'));
        } else if (warning.code === 'entry_price_rule_missing') {
            issues.push(issue('entry_price_rule_missing', 'Не розраховано вхід: відсутнє правило ціни в Центрі цін.'));
        }
    }
    return issues;
}

function clientValidationIssues(summary = {}) {
    const errors = [];
    if (!cleanText(summary.customer?.name)) errors.push(issue('customer_name_missing', 'Не вказано імʼя клієнта.'));
    if (!cleanText(summary.customer?.phone)) errors.push(issue('customer_phone_missing', 'Не вказано телефон клієнта.'));
    if (!cleanText(summary.event?.date)) errors.push(issue('event_date_missing', 'Не вказано дату банкету.'));
    if (!cleanText(summary.event?.time)) errors.push(issue('event_time_missing', 'Не вказано час приходу гостей.'));
    if (!cleanText(summary.event?.room)) errors.push(issue('event_room_missing', 'Не вказано кімнату.'));
    if (!positiveNumber(summary.counts?.children)) errors.push(issue('children_count_missing', 'Не вказано кількість дітей.'));
    if (financeOrderTotal(summary) === null) errors.push(issue('order_total_missing', 'Не розраховано загальну суму.'));
    return uniqueIssues([...errors, ...entryValidationIssues(summary)]);
}

function kitchenValidationIssues(summary = {}) {
    const rows = allRows(summary);
    const hasMenu = rows.some(row => row?.type === 'menu' && cleanText(row.title || row.name));
    const hasServiceEvent = rows.some(row => row?.type === 'service_event' && cleanText(row.title || row.name));
    return hasMenu || hasServiceEvent
        ? []
        : [issue('kitchen_rows_missing', 'Немає меню або подій видачі для кухонного PDF.')];
}

function validateBanquetSummaryPdf(summary = {}, mode = 'client') {
    const normalizedMode = normalizeBanquetSummaryMode(mode);
    if (normalizedMode === 'client') {
        const errors = clientValidationIssues(summary);
        return { valid: !errors.length, mode: normalizedMode, errors, warnings: [] };
    }
    if (normalizedMode === 'kitchen') {
        const errors = kitchenValidationIssues(summary);
        return { valid: !errors.length, mode: normalizedMode, errors, warnings: [] };
    }
    return {
        valid: true,
        mode: normalizedMode,
        errors: [],
        warnings: clientValidationIssues(summary)
    };
}

function pdfValidationError(validation) {
    const modeLabel = MODE_LABELS[validation?.mode] || 'PDF';
    const publicMessage = validation?.mode === 'client'
        ? 'Неможливо сформувати клієнтський PDF'
        : (validation?.mode === 'kitchen' ? 'Неможливо сформувати PDF для кухні' : `Неможливо сформувати PDF: ${modeLabel}`);
    const err = new Error(publicMessage);
    err.statusCode = 422;
    err.code = PDF_VALIDATION_ERROR_CODE;
    err.details = uniqueIssues(validation?.errors || []);
    err.mode = validation?.mode || 'client';
    err.publicMessage = publicMessage;
    return err;
}

function validationWarningsForView(validation) {
    return uniqueIssues(validation?.warnings || []).map(item => ({
        code: item.code,
        message: item.message,
        source: 'pdf_validation'
    }));
}

function pdfConfigForMode(mode = 'client') {
    const contract = banquetSummaryModeContract(mode);
    return {
        showBrief: Boolean(contract.sections.brief),
        showOrderRows: Boolean(contract.sections.orderRows),
        showSchedule: Boolean(contract.sections.schedule),
        showResponsible: Boolean(contract.sections.responsible),
        showFinance: Boolean(contract.sections.finance),
        showDeposit: Boolean(contract.sections.finance),
        showTerms: Boolean(contract.sections.terms),
        showWarnings: Boolean(contract.sections.warnings),
        showComments: Boolean(contract.sections.comments),
        showPrices: Boolean(contract.showPrices),
        showInternalFields: Boolean(contract.showInternalFields),
        showEmptyResponsible: Boolean(contract.showEmptyResponsible),
        rowTypes: banquetSummaryModeRowTypes(mode),
        scheduleSourceRowTypes: new Set(contract.scheduleSourceRowTypes || contract.orderRowTypes || [])
    };
}

function responsibleRowsForMode(summary = {}, mode = 'client') {
    const contract = banquetSummaryModeContract(mode);
    const rows = Array.isArray(summary.responsible?.rows) ? summary.responsible.rows : [];
    return rows
        .map(row => ({
            role: cleanText(row?.role),
            label: cleanText(row?.label),
            name: cleanText(row?.name),
            modes: Array.isArray(row?.modes) ? row.modes.map(item => cleanText(item).toLowerCase()).filter(Boolean) : [],
            showWhenEmpty: row?.showWhenEmpty === true
        }))
        .filter(row => row.label)
        .filter(row => !row.modes.length || row.modes.includes(mode))
        .filter(row => row.name || (contract.showEmptyResponsible && row.showWhenEmpty));
}

function buildBanquetSummaryPdfView(summary = {}, mode = 'client', options = {}) {
    const normalizedMode = normalizeBanquetSummaryMode(mode);
    const modeContract = banquetSummaryModeContract(normalizedMode);
    const config = pdfConfigForMode(normalizedMode);
    const validation = options.validation || validateBanquetSummaryPdf(summary, normalizedMode);
    const scheduleRows = allRows(summary).filter(row => row && config.scheduleSourceRowTypes.has(row.type));
    const rows = allRows(summary).filter(row => row && config.rowTypes.has(row.type));
    const comments = Array.isArray(summary.comments)
        ? summary.comments.filter(comment => banquetSummaryModeAllowsComment(normalizedMode, comment?.type))
        : [];
    const view = {
        mode: normalizedMode,
        modeLabel: modeContract.label,
        modeContract,
        config,
        rows,
        comments,
        responsible: responsibleRowsForMode(summary, normalizedMode),
        warnings: config.showWarnings
            ? uniqueIssues([
                ...(Array.isArray(summary.warnings) ? summary.warnings.filter(Boolean) : []),
                ...validationWarningsForView(validation)
            ])
            : [],
        schedule: buildScheduleItems(summary, scheduleRows, normalizedMode)
    };
    view.orderTableColumns = buildOrderTableColumns(view);
    view.orderTableRows = buildOrderTableRows(view, summary);
    view.financeRows = config.showFinance ? financeRowsForSummary(summary) : [];
    return view;
}

function timeSortValue(time) {
    const match = String(time || '').match(/^(\d{1,2}):(\d{2})/);
    if (!match) return 99999;
    return Number(match[1]) * 60 + Number(match[2]);
}

function pushUniqueScheduleItem(items, seen, time, title, note = '') {
    const normalizedTime = cleanText(time);
    const normalizedTitle = cleanText(title);
    if (!normalizedTime || !normalizedTitle) return;
    const key = `${normalizedTime}|${normalizedTitle}|${cleanText(note)}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ time: normalizedTime, title: normalizedTitle, note: cleanText(note) });
}

function scheduleItemModes(item = {}) {
    return Array.isArray(item.modes)
        ? item.modes.map(mode => cleanText(mode).toLowerCase()).filter(Boolean)
        : [];
}

function scheduleItemNoteForMode(item = {}, mode = 'client') {
    const note = cleanText(item.note);
    if (!note) return '';
    const noteModes = Array.isArray(item.noteModes)
        ? item.noteModes.map(value => cleanText(value).toLowerCase()).filter(Boolean)
        : [];
    return noteModes.length && !noteModes.includes(mode) ? '' : note;
}

function canonicalScheduleItems(summary = {}, mode = 'client') {
    if (!Array.isArray(summary.schedule)) return null;
    return summary.schedule
        .map((item, index) => {
            const modes = scheduleItemModes(item);
            if (modes.length && !modes.includes(mode)) return null;
            const time = cleanText(item?.time);
            const title = cleanText(item?.title);
            if (!time || !title) return null;
            return {
                time,
                title,
                note: scheduleItemNoteForMode(item, mode),
                sortOrder: Number.isFinite(item?.sortOrder) ? item.sortOrder : index
            };
        })
        .filter(Boolean)
        .sort((a, b) => {
            const timeDiff = timeSortValue(a.time) - timeSortValue(b.time);
            if (timeDiff !== 0) return timeDiff;
            return (a.sortOrder || 0) - (b.sortOrder || 0);
        });
}

function buildScheduleItems(summary = {}, rows = [], mode = 'client') {
    const canonical = canonicalScheduleItems(summary, mode);
    if (canonical) return canonical;

    const items = [];
    const seen = new Set();
    const event = summary.event || {};
    if (mode !== 'kitchen') {
        pushUniqueScheduleItem(items, seen, event.time, 'Прихід гостей', event.room ? `Кімната: ${event.room}` : '');
    }
    for (const row of rows) {
        if (row.type === 'program' || row.type === 'activity') {
            pushUniqueScheduleItem(items, seen, row.meta?.time || event.time, row.title, row.meta?.room || '');
        } else if (row.type === 'menu') {
            pushUniqueScheduleItem(items, seen, row.meta?.servingTime, `Видача: ${row.title}`, row.comment || '');
        } else if (row.type === 'service_event') {
            pushUniqueScheduleItem(items, seen, row.meta?.time || row.meta?.servingTime, row.title, row.comment || '');
        }
    }
    return items.sort((a, b) => timeSortValue(a.time) - timeSortValue(b.time));
}

function registerFonts(doc) {
    const fonts = resolvePdfFonts();
    doc.registerFont('SummaryRegular', fonts.regular);
    doc.registerFont('SummaryBold', fonts.bold);
    return fonts;
}

function ensureSpace(doc, height) {
    const bottom = doc.page.height - doc.page.margins.bottom;
    if (doc.y + height > bottom) {
        doc.addPage();
        doc.x = doc.page.margins.left;
    }
}

function resetCursorX(doc) {
    doc.x = doc.page.margins.left;
}

function pageContentWidth(doc) {
    return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function drawSectionTitle(doc, title) {
    ensureSpace(doc, 34);
    resetCursorX(doc);
    doc.moveDown(0.75);
    resetCursorX(doc);
    doc.font('SummaryBold').fontSize(11).fillColor('#111827').text(title.toUpperCase(), {
        width: pageContentWidth(doc),
        align: 'center',
        continued: false
    });
    doc.moveTo(doc.page.margins.left, doc.y + 3)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y + 3)
        .strokeColor('#d8dee9')
        .lineWidth(0.8)
        .stroke();
    doc.moveDown(0.6);
}

function drawKeyValueGrid(doc, items = []) {
    const filtered = items.filter(item => item && cleanText(item.value));
    if (!filtered.length) return;
    const contentWidth = pageContentWidth(doc);
    const columnWidth = (contentWidth - 18) / 2;
    const labelWidth = 92;

    for (let index = 0; index < filtered.length; index += 2) {
        const pair = filtered.slice(index, index + 2);
        const rowHeight = Math.max(18, ...pair.map(item => {
            doc.font('SummaryBold').fontSize(9);
            const labelHeight = doc.heightOfString(`${item.label}:`, {
                width: labelWidth,
                lineGap: 1
            });
            doc.font('SummaryRegular').fontSize(9);
            const valueHeight = doc.heightOfString(pdfText(item.value), {
                width: columnWidth - labelWidth,
                lineGap: 1
            });
            return Math.max(labelHeight, valueHeight) + 6;
        }));

        ensureSpace(doc, rowHeight + 2);
        const y = doc.y;
        pair.forEach((item, pairIndex) => {
            const x = doc.page.margins.left + pairIndex * (columnWidth + 18);
            doc.font('SummaryBold').fontSize(9).fillColor('#111827')
                .text(`${item.label}:`, x, y, { width: labelWidth, lineGap: 1 });
            doc.font('SummaryRegular').fontSize(9).fillColor('#111827')
                .text(pdfText(item.value), x + labelWidth, y, {
                    width: columnWidth - labelWidth,
                    lineGap: 1
                });
        });
        doc.y = y + rowHeight;
        resetCursorX(doc);
    }
    doc.moveDown(0.25);
}

function drawParagraphList(doc, items = []) {
    const filtered = items.map(item => cleanText(item)).filter(Boolean);
    if (!filtered.length) {
        doc.font('SummaryRegular').fontSize(9).fillColor('#64748b').text('Немає даних.');
        return;
    }
    filtered.forEach(item => {
        ensureSpace(doc, 24);
        resetCursorX(doc);
        doc.font('SummaryRegular').fontSize(9).fillColor('#111827').text(`• ${item}`, doc.page.margins.left, doc.y, {
            width: pageContentWidth(doc),
            lineGap: 1.5
        });
        doc.moveDown(0.15);
        resetCursorX(doc);
    });
}

function rowAmount(row = {}, currency) {
    if (row.type === 'entry' && nullableNumber(row.unitPrice) !== null && nullableNumber(row.quantity) !== null) {
        return `${formatQuantity(row.quantity)} × ${formatMoney(row.unitPrice, currency)} = ${formatMoney(row.subtotal, currency)}`;
    }
    return formatMoney(row.subtotal, currency);
}

function amountDue(total, depositAmount) {
    const totalMoney = nullableNumber(total);
    if (totalMoney === null) return null;
    return Math.round(Math.max(0, totalMoney - (nullableNumber(depositAmount) || 0)) * 100) / 100;
}

function addFinanceRow(rows, key, label, amount, currency, options = {}) {
    const value = nullableNumber(amount);
    if (value === null) return;
    if (options.hideZero !== false && value <= 0) return;
    rows.push({
        key,
        label,
        amount: Math.round(value * 100) / 100,
        currency,
        role: options.role || 'line'
    });
}

function fallbackFinanceRows(summary = {}) {
    const totals = summary.totals || {};
    const deposit = summary.deposit || {};
    const currency = totals.currency || 'UAH';
    const rows = [];
    addFinanceRow(rows, 'program', 'Програма', totals.programBasePrice, currency);
    addFinanceRow(rows, 'entry', 'Вхід', totals.entrySubtotal, currency);
    addFinanceRow(rows, 'menu', 'Меню', totals.menuSubtotal, currency);
    addFinanceRow(rows, 'activities', 'Додаткові активності', totals.activitySubtotal, currency);
    const orderTotal = nullableNumber(totals.orderTotal);
    const bookingPrice = nullableNumber(totals.bookingPrice);
    if (bookingPrice !== null && orderTotal !== null && Math.abs(bookingPrice - orderTotal) >= 0.01) {
        addFinanceRow(rows, 'booking', 'Бронювання', bookingPrice, currency, { hideZero: false });
    }
    addFinanceRow(rows, 'total', 'Разом', orderTotal, currency, { hideZero: false, role: 'total' });
    const depositAmount = deposit.amount === undefined || deposit.amount === null ? null : nullableNumber(deposit.amount);
    if (depositAmount !== null) {
        addFinanceRow(rows, 'deposit', 'Завдаток', depositAmount, currency, { hideZero: false, role: 'deposit' });
    }
    addFinanceRow(rows, 'amount_due', 'До сплати', amountDue(orderTotal, depositAmount), currency, { hideZero: false, role: 'due' });
    return rows;
}

function financeRowsForSummary(summary = {}) {
    const rows = Array.isArray(summary.finance?.rows) ? summary.finance.rows : [];
    const normalized = rows
        .map(row => ({
            key: row?.key || '',
            label: row?.label || '',
            amount: nullableNumber(row?.amount),
            currency: row?.currency || summary.finance?.currency || summary.totals?.currency || 'UAH',
            role: row?.role || 'line'
        }))
        .filter(row => row.label && row.amount !== null);
    return normalized.length ? normalized : fallbackFinanceRows(summary);
}

function drawTable(doc, columns = [], rows = []) {
    if (!rows.length) {
        doc.font('SummaryRegular').fontSize(9).fillColor('#64748b').text('Позиції відсутні.');
        return;
    }

    const left = doc.page.margins.left;
    const contentWidth = pageContentWidth(doc);
    const totalWeight = columns.reduce((sum, col) => sum + col.weight, 0);
    const widths = columns.map(col => Math.floor(contentWidth * col.weight / totalWeight));
    widths[widths.length - 1] += contentWidth - widths.reduce((sum, width) => sum + width, 0);

    const drawRow = (cells, options = {}) => {
        const padding = 4;
        doc.font(options.bold ? 'SummaryBold' : 'SummaryRegular').fontSize(options.fontSize || 8.5);
        const heights = cells.map((cell, index) => doc.heightOfString(pdfText(cell, ''), {
            width: widths[index] - padding * 2,
            lineGap: 1
        }));
        const height = Math.max(options.minHeight || 20, ...heights.map(item => item + padding * 2));
        ensureSpace(doc, height + 4);
        resetCursorX(doc);
        const y = doc.y;
        let x = left;
        cells.forEach((cell, index) => {
            if (options.fill) {
                doc.rect(x, y, widths[index], height).fillAndStroke(options.fill, '#d8dee9');
            } else {
                doc.rect(x, y, widths[index], height).strokeColor('#d8dee9').stroke();
            }
            doc.font(options.bold ? 'SummaryBold' : 'SummaryRegular')
                .fontSize(options.fontSize || 8.5)
                .fillColor('#111827')
                .text(pdfText(cell, ''), x + padding, y + padding, {
                    width: widths[index] - padding * 2,
                    lineGap: 1
                });
            x += widths[index];
        });
        doc.y = y + height;
        resetCursorX(doc);
    };

    drawRow(columns.map(col => col.label), { bold: true, fill: '#f5f7fb', minHeight: 19, fontSize: 8.5 });
    rows.forEach(row => drawRow(row, { minHeight: 22, fontSize: 8.2 }));
}

function drawFinance(doc, summary = {}) {
    const rows = financeRowsForSummary(summary).map(row => [
        row.label,
        formatMoney(row.amount, row.currency || summary.totals?.currency || 'UAH')
    ]);
    drawTable(doc, [
        { label: 'Позиція', weight: 2 },
        { label: 'Сума', weight: 1 }
    ], rows);
}

function drawComments(doc, comments = []) {
    const rows = comments.map(comment => [
        comment.label || 'Примітка',
        comment.text || ''
    ]);
    drawTable(doc, [
        { label: 'Тип', weight: 1 },
        { label: 'Коментар', weight: 3 }
    ], rows);
}

function buildOrderTableRows(view, summary = {}) {
    const currency = summary.totals?.currency || 'UAH';
    return view.rows.map((row, index) => {
        const base = [
            String(index + 1),
            row.title || row.name || 'Позиція',
            rowDurationLabel(row),
            rowQuantityLabel(row),
            rowServingTime(row)
        ];
        if (view.config.showPrices) base.push(rowAmount(row, currency));
        base.push(rowCommentForMode(row, view.mode));
        return base;
    });
}

function buildOrderTableColumns(view) {
    const columns = [
        { label: '№', weight: 0.35 },
        { label: 'Назва', weight: 2.2 },
        { label: 'Тривалість', weight: 0.85 },
        { label: view.mode === 'kitchen' ? 'Порції' : 'К-сть', weight: 0.95 },
        { label: 'Видача', weight: 0.85 }
    ];
    if (view.config.showPrices) columns.push({ label: 'Сума', weight: 1.25 });
    columns.push({ label: 'Примітка', weight: 1.5 });
    return columns;
}

function drawSchedule(doc, schedule = []) {
    if (!schedule.length) {
        doc.font('SummaryRegular').fontSize(9).fillColor('#64748b').text('Розклад не заповнений.');
        return;
    }
    drawTable(doc, [
        { label: 'Час', weight: 0.7 },
        { label: 'Подія', weight: 2 },
        { label: 'Примітка', weight: 2 }
    ], schedule.map(item => [item.time, item.title, item.note || '']));
}

function drawResponsible(doc, rows = []) {
    if (!rows.length) return;
    drawTable(doc, [
        { label: 'Роль', weight: 1.1 },
        { label: 'Відповідальний', weight: 2.2 }
    ], rows.map(row => [row.label, row.name || '—']));
}

function drawHeader(doc, summary, view) {
    const venue = summary.venue || {};
    doc.font('SummaryBold').fontSize(14).fillColor('#111827').text(pdfText(venue.name, 'Event Genix'), { width: 360 });
    doc.font('SummaryRegular').fontSize(8.5).fillColor('#64748b')
        .text([venue.addressLine1, venue.addressLine2, venue.phone].map(item => cleanText(item)).filter(Boolean).join(' · '));

    const rightX = doc.page.width - doc.page.margins.right - 170;
    const topY = doc.page.margins.top;
    const manager = summary.document?.generatedBy || summary.event?.manager || null;
    doc.font('SummaryRegular').fontSize(8.5).fillColor('#111827')
        .text(`Booking ID: ${pdfText(summary.bookingId)}`, rightX, topY, { width: 170, align: 'right' })
        .text(`Менеджер: ${pdfText(manager)}`, rightX, topY + 14, { width: 170, align: 'right' })
        .text(view.modeLabel, rightX, topY + 28, { width: 170, align: 'right' });

    doc.moveDown(0.8);
    doc.moveTo(doc.page.margins.left, doc.y)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .strokeColor('#111827')
        .lineWidth(1.2)
        .stroke();
    doc.moveDown(0.8);
    doc.font('SummaryBold').fontSize(18).fillColor('#111827').text('БАНКЕТНИЙ ЛИСТ', { align: 'center' });
    doc.moveDown(0.45);
}

function buildBriefItems(summary = {}, view) {
    const event = summary.event || {};
    const customer = summary.customer || {};
    const celebrant = summary.celebrant || {};
    const counts = summary.counts || {};
    const items = [
        { label: 'Клієнт', value: customer.name },
        { label: 'Телефон', value: customer.phone },
        { label: 'Кімната', value: event.room },
        { label: 'Дата', value: formatDate(event.date) },
        { label: 'Прихід гостей', value: event.time },
        { label: 'Діти', value: counts.children },
        { label: 'Дорослі', value: counts.adults },
        { label: 'Столи', value: counts.tables },
        { label: 'Програма', value: event.hasRealProgram ? (event.programDisplayName || event.programName) : null },
        { label: 'Іменинник', value: celebrant.name },
        { label: 'Дата народження', value: celebrant.birthday ? formatDate(celebrant.birthday) : null },
        { label: 'Бронь створено', value: formatDateTime(event.createdAt) }
    ];
    if (view.config.showInternalFields) {
        items.push(
            { label: 'Група', value: summary.group?.id || summary.group?.groupName }
        );
    }
    return items;
}

function drawBanquetSummaryPdf(doc, summary = {}, view) {
    drawHeader(doc, summary, view);
    if (view.config.showBrief) {
        drawKeyValueGrid(doc, buildBriefItems(summary, view));
    }

    if (view.config.showResponsible && view.responsible.length) {
        drawSectionTitle(doc, 'Відповідальні');
        drawResponsible(doc, view.responsible);
    }

    if (view.config.showSchedule) {
        drawSectionTitle(doc, 'Розклад');
        drawSchedule(doc, view.schedule);
    }

    if (view.config.showOrderRows) {
        drawSectionTitle(doc, view.mode === 'kitchen' ? 'Кухня / видача' : 'Замовлення');
        drawTable(doc, buildOrderTableColumns(view), buildOrderTableRows(view, summary));
    }

    if (view.config.showComments && view.comments.length) {
        drawSectionTitle(doc, 'Коментарі');
        drawComments(doc, view.comments);
    }

    if (view.config.showFinance) {
        drawSectionTitle(doc, 'Фінанси');
        drawFinance(doc, summary);
    }

    if (view.config.showTerms) {
        drawSectionTitle(doc, summary.terms?.title || 'Умови банкету');
        drawParagraphList(doc, summary.terms?.items || []);
    }

    if (view.config.showWarnings && view.warnings.length) {
        drawSectionTitle(doc, 'Службові попередження');
        drawParagraphList(doc, view.warnings.map(item => item.message || item.code || item));
    }
}

async function buildBanquetSummaryPdfBuffer(summary = {}, options = {}) {
    const mode = normalizeBanquetSummaryMode(options.mode);
    const validation = validateBanquetSummaryPdf(summary, mode);
    if (!validation.valid) throw pdfValidationError(validation);
    const view = buildBanquetSummaryPdfView(summary, mode, { validation });

    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            size: 'A4',
            margin: 42,
            info: {
                Title: `Banquet sheet ${summary.bookingId || ''}`.trim(),
                Creator: 'Event Genix CRM'
            }
        });
        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        try {
            registerFonts(doc);
            doc.font('SummaryRegular');
            drawBanquetSummaryPdf(doc, summary, view);
            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

module.exports = {
    MODE_LABELS,
    normalizeBanquetSummaryMode,
    validateBanquetSummaryPdf,
    banquetSummaryPdfFilename,
    buildBanquetSummaryPdfView,
    buildBanquetSummaryPdfBuffer,
    resolvePdfFonts
};
