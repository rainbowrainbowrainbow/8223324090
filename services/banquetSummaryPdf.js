'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const {
    BANQUET_SUMMARY_MODE_LABELS: MODE_LABELS,
    normalizeBanquetSummaryMode,
    banquetSummaryModeContract,
    banquetSummaryModeRowTypes,
    banquetSummaryModeAllowsComment,
    buildBanquetOrderRowViewModels
} = require('./banquetSummary');

const ROOT_DIR = path.resolve(__dirname, '..');
const FONT_DIR = path.join(ROOT_DIR, 'assets', 'fonts');
const PDF_FONT_REGULAR = path.join(FONT_DIR, 'Nunito.ttf');
const PDF_FONT_BOLD = path.join(FONT_DIR, 'Nunito-Bold.ttf');
const PDF_FONT_BLACK = path.join(FONT_DIR, 'Nunito-Black.ttf');
const PDF_SERIF_REGULAR = path.join(FONT_DIR, 'NotoSerif-Regular.ttf');
const PDF_SERIF_BOLD = path.join(FONT_DIR, 'NotoSerif-Bold.ttf');
const BANQUET_LOGO_PATH = path.join(ROOT_DIR, 'images', 'banquet-logo.png');
const PDF_COLORS = Object.freeze({
    teal: '#0f6668',
    tealDark: '#142f35',
    gold: '#b68a3b',
    cream: '#fffdf8',
    muted: '#637477',
    card: '#ffffff',
    ink: '#142f35',
    border: '#d8e3e1',
    soft: '#f7f8f5'
});
const PDF_TYPE_SCALE = Object.freeze({
    sectionTitle: 10.4,
    keyValue: 9.4,
    paragraph: 9.2,
    emptyState: 8.6,
    tableHeader: 9.4,
    tableBody: 9.2,
    scheduleEmpty: 9.4,
    heroPill: 7.6,
    heroCardTitle: 9.3,
    heroCardBadge: 7.7,
    heroCardMeta: 7.6,
    heroGenerated: 7.4,
    heroVenueTitle: 11,
    heroVenueMeta: 7.8,
    heroVenuePhone: 8.4
});
const PDF_HEADER_LAYOUT = Object.freeze({
    height: 76,
    guideOffsetY: 74,
    logoSize: 44,
    cardWidth: 144,
    cardHeight: 60
});
const PDF_TABLE_LAYOUT = Object.freeze({
    clientOrderColumns: Object.freeze({
        position: 4.8,
        quantity: 0.85,
        unitPrice: 0.9,
        subtotal: 0.95
    })
});
const PDF_SPACING_LAYOUT = Object.freeze({
    sectionEnsure: 19,
    sectionPreMoveDown: 0.18,
    sectionRuleY: 10.5,
    sectionAccentStartY: 2.7,
    sectionAccentEndY: 11.8,
    sectionTitleY: 1.2,
    sectionAfterY: 13.5,
    keyValueMinRow: 11.4,
    keyValueExtraHeight: 1.2,
    keyValueEnsureExtra: 0.5,
    keyValueAfterMoveDown: 0.06,
    paragraphLineGap: 0.25,
    paragraphMinSpace: 14.5,
    paragraphExtraSpace: 1.6,
    paragraphAfterMoveDown: 0.04,
    tablePadding: 1.6,
    tableLineGap: 0,
    tableParagraphGap: 0.45,
    tableHeaderMinHeight: 12.8,
    tableBodyMinHeight: 13.2
});

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

function summaryArrival(summary = {}) {
    const event = summary.event || {};
    const arrival = summary.arrival || summary.banquetArrival || {};
    return {
        date: cleanText(arrival.date) || event.date || null,
        time: cleanText(arrival.time) || null,
        room: cleanText(arrival.room) || event.room || null
    };
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
    if (row.type === 'ticket') {
        const quantity = nullableNumber(row.quantity);
        return quantity === null
            ? '—'
            : `${formatQuantity(quantity)} ${row.meta?.audience === 'adult' ? 'дорослих' : 'дітей'}`;
    }
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
    if (row.type === 'program' || row.type === 'activity' || row.type === 'ticket' || row.type === 'entry') return '—';
    return cleanText(row.meta?.servingTime || row.meta?.time || row.servingTime || row.serving_time, '—');
}

function rowCommentForMode(row = {}, mode) {
    const type = String(row.type || '').trim().toLowerCase();
    if (mode === 'client') {
        if (type === 'service_event') {
            return row.meta?.time ? cleanText(`Час ${row.meta.time}`) : '';
        }
        return ['program', 'activity', 'ticket', 'entry', 'menu'].includes(type)
            ? cleanText(row.comment)
            : '';
    }
    if (type === 'entry') return cleanText(row.comment);
    const parts = [];
    if (type === 'service_event' && row.meta?.time) parts.push(`Час ${row.meta.time}`);
    if (row.comment) {
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
    const arrival = summaryArrival(summary);
    if (!cleanText(summary.customer?.name)) errors.push(issue('customer_name_missing', 'Не вказано імʼя клієнта.'));
    if (!cleanText(summary.customer?.phone)) errors.push(issue('customer_phone_missing', 'Не вказано телефон клієнта.'));
    if (!cleanText(arrival.date)) errors.push(issue('event_date_missing', 'Не вказано дату банкету.'));
    if (!cleanText(arrival.time)) errors.push(issue('event_time_missing', 'Не вказано час приходу гостей.'));
    if (!cleanText(arrival.room)) errors.push(issue('event_room_missing', 'Не вказано кімнату.'));
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
    view.orderRowViews = normalizedMode === 'client'
        ? normalizedOrderRowViews(summary, normalizedMode, rows, summary.totals?.currency || 'UAH')
        : [];
    view.orderTableColumns = buildOrderTableColumns(view);
    view.orderTableRows = buildOrderTableRows(view, summary);
    view.financeRows = config.showFinance ? financeRowsForSummary(summary) : [];
    view.menuWorkflowRows = config.showFinance ? menuWorkflowRowsForSummary(summary) : [];
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
    const arrival = summaryArrival(summary);
    if (mode !== 'kitchen') {
        pushUniqueScheduleItem(items, seen, arrival.time, 'Прихід гостей', arrival.room ? `Кімната: ${arrival.room}` : '');
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

function resetCursorX(doc) {
    doc.x = doc.page.margins.left;
}

function pageContentWidth(doc) {
    return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function pageContentHeight(doc) {
    return doc.page.height - doc.page.margins.top - doc.page.margins.bottom;
}

function pageBottom(doc) {
    return doc.page.height - doc.page.margins.bottom;
}

function addDecoratedPage(doc) {
    doc.addPage();
    drawPageDecor(doc);
    doc.x = doc.page.margins.left;
    doc.y = doc.page.margins.top;
}

function ensureSpace(doc, height) {
    const requiredHeight = Math.min(Math.max(0, height), pageContentHeight(doc));
    if (doc.y + requiredHeight > pageBottom(doc)) {
        addDecoratedPage(doc);
        return true;
    }
    return false;
}

function drawPageDecor(doc) {
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const left = doc.page.margins.left;
    const top = doc.page.margins.top;
    const width = pageContentWidth(doc);
    const borderTop = Math.max(18, top - 10);
    const borderHeight = pageHeight - borderTop - Math.max(18, doc.page.margins.bottom - 8);

    doc.save();
    doc.moveTo(left, top + PDF_HEADER_LAYOUT.guideOffsetY)
        .lineTo(left + width, top + PDF_HEADER_LAYOUT.guideOffsetY)
        .lineWidth(0.45)
        .strokeColor(PDF_COLORS.border)
        .stroke();
    doc.restore();

    doc.save();
    doc.roundedRect(left - 8, borderTop, width + 16, borderHeight, 8)
        .lineWidth(0.45)
        .strokeColor('#e3ebe8')
        .stroke();
    doc.restore();
}

function drawSectionTitle(doc, title, options = {}) {
    const keepWithNext = Math.max(0, options.keepWithNext || 0);
    ensureSpace(doc, Math.max(PDF_SPACING_LAYOUT.sectionEnsure, PDF_SPACING_LAYOUT.sectionAfterY + keepWithNext + 2));
    resetCursorX(doc);
    doc.moveDown(PDF_SPACING_LAYOUT.sectionPreMoveDown);
    resetCursorX(doc);
    const left = doc.page.margins.left;
    const y = doc.y;
    const label = title.toUpperCase();
    doc.moveTo(left, y + PDF_SPACING_LAYOUT.sectionRuleY)
        .lineTo(left + pageContentWidth(doc), y + PDF_SPACING_LAYOUT.sectionRuleY)
        .lineWidth(0.45)
        .strokeColor(PDF_COLORS.border)
        .stroke();
    doc.moveTo(left, y + PDF_SPACING_LAYOUT.sectionAccentStartY)
        .lineTo(left, y + PDF_SPACING_LAYOUT.sectionAccentEndY)
        .lineWidth(1.1)
        .strokeColor(PDF_COLORS.gold)
        .stroke();
    doc.font('SummaryBold')
        .fontSize(PDF_TYPE_SCALE.sectionTitle)
        .fillColor(PDF_COLORS.tealDark)
        .text(label, left + 8, y + PDF_SPACING_LAYOUT.sectionTitleY, {
            width: pageContentWidth(doc) - 8,
            align: 'left',
            lineGap: 0.2,
            continued: false
        });
    doc.y = Math.max(doc.y, y + PDF_SPACING_LAYOUT.sectionAfterY);
    resetCursorX(doc);
}

function drawKeyValueGrid(doc, items = []) {
    const filtered = items.filter(item => item && cleanText(item.value));
    if (!filtered.length) return;
    const contentWidth = pageContentWidth(doc);
    const columnWidth = (contentWidth - 14) / 2;
    const labelWidth = 78;

    for (let index = 0; index < filtered.length; index += 2) {
        const pair = filtered.slice(index, index + 2);
        const rowHeight = Math.max(PDF_SPACING_LAYOUT.keyValueMinRow, ...pair.map(item => {
            doc.font('SummaryBold').fontSize(PDF_TYPE_SCALE.keyValue);
            const labelHeight = doc.heightOfString(`${item.label}:`, {
                width: labelWidth,
                lineGap: 0.3
            });
            doc.font('SummaryRegular').fontSize(PDF_TYPE_SCALE.keyValue);
            const valueHeight = doc.heightOfString(pdfText(item.value), {
                width: columnWidth - labelWidth,
                lineGap: 0.3
            });
            return Math.max(labelHeight, valueHeight) + PDF_SPACING_LAYOUT.keyValueExtraHeight;
        }));

        ensureSpace(doc, rowHeight + PDF_SPACING_LAYOUT.keyValueEnsureExtra);
        const y = doc.y;
        pair.forEach((item, pairIndex) => {
            const x = doc.page.margins.left + pairIndex * (columnWidth + 14);
            doc.font('SummaryBold').fontSize(PDF_TYPE_SCALE.keyValue).fillColor(PDF_COLORS.tealDark)
                .text(`${item.label}:`, x, y, { width: labelWidth, lineGap: 0.3 });
            doc.font('SummaryRegular').fontSize(PDF_TYPE_SCALE.keyValue).fillColor(PDF_COLORS.tealDark)
                .text(pdfText(item.value), x + labelWidth, y, {
                    width: columnWidth - labelWidth,
                    lineGap: 0.3
                });
        });
        doc.y = y + rowHeight;
        resetCursorX(doc);
    }
    doc.moveDown(PDF_SPACING_LAYOUT.keyValueAfterMoveDown);
}

function drawParagraphList(doc, items = []) {
    const filtered = items.map(item => cleanText(item)).filter(Boolean);
    if (!filtered.length) {
        doc.font('SummaryRegular').fontSize(PDF_TYPE_SCALE.emptyState).fillColor(PDF_COLORS.muted).text('Немає даних.');
        return;
    }
    filtered.forEach(item => {
        resetCursorX(doc);
        const text = `• ${item}`;
        doc.font('SummaryRegular').fontSize(PDF_TYPE_SCALE.paragraph);
        const height = doc.heightOfString(pdfText(text), {
            width: pageContentWidth(doc),
            lineGap: PDF_SPACING_LAYOUT.paragraphLineGap
        });
        ensureSpace(doc, Math.max(PDF_SPACING_LAYOUT.paragraphMinSpace, height + PDF_SPACING_LAYOUT.paragraphExtraSpace));
        resetCursorX(doc);
        doc.font('SummaryRegular').fontSize(PDF_TYPE_SCALE.paragraph).fillColor(PDF_COLORS.ink).text(text, doc.page.margins.left, doc.y, {
            width: pageContentWidth(doc),
            lineGap: PDF_SPACING_LAYOUT.paragraphLineGap
        });
        doc.moveDown(PDF_SPACING_LAYOUT.paragraphAfterMoveDown);
        resetCursorX(doc);
    });
}

function rowAmount(row = {}, currency) {
    if (['ticket', 'entry'].includes(row.type) && nullableNumber(row.unitPrice) !== null && nullableNumber(row.quantity) !== null) {
        return `${formatQuantity(row.quantity)} × ${formatMoney(row.unitPrice, currency)} = ${formatMoney(row.subtotal, currency)}`;
    }
    return formatMoney(row.subtotal, currency);
}

function normalizedOrderRowViews(summary = {}, mode = 'client', rows = [], currency = 'UAH') {
    const explicit = summary.orderRowViews?.[mode] || summary.orderRowViewModels?.[mode];
    if (Array.isArray(explicit)) return explicit;
    return buildBanquetOrderRowViewModels(rows, mode, currency);
}

function clientOrderTitleCell(viewModel = {}) {
    const details = Array.isArray(viewModel.metaLines)
        ? viewModel.metaLines.map(item => cleanText(item)).filter(Boolean)
        : [];
    const title = cleanText(viewModel.title, 'Позиція');
    return details.length ? `${title}\n${details.join('\n')}` : title;
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
    const orderTotal = nullableNumber(totals.orderTotal);
    const bookingPrice = nullableNumber(totals.bookingPrice);
    addFinanceRow(rows, 'total', 'Загальна сума', orderTotal ?? bookingPrice, currency, { hideZero: false, role: 'total' });
    const depositAmount = deposit.amount === undefined || deposit.amount === null ? null : nullableNumber(deposit.amount);
    addFinanceRow(rows, 'deposit', 'Завдаток', depositAmount ?? 0, currency, { hideZero: false });
    const total = orderTotal ?? bookingPrice;
    addFinanceRow(
        rows,
        'amount_due',
        'Залишок після завдатку',
        total === null ? null : Math.max(0, total - (depositAmount ?? 0)),
        currency,
        { hideZero: false, role: 'due' }
    );
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
    const totalRow = normalized.find(row => row.key === 'total') || normalized.find(row => row.role === 'total');
    if (totalRow) {
        return normalized.map(row => row === totalRow ? {
            ...totalRow,
            key: 'total',
            label: 'Загальна сума',
            role: 'total'
        } : row);
    }
    return fallbackFinanceRows(summary);
}

function tableCellLines(cell) {
    const text = cell === undefined || cell === null ? '' : String(cell);
    const lines = text.split(/\r?\n/).map(line => cleanText(line)).filter(Boolean);
    return lines.length ? lines : [''];
}

function tableCellTextHeight(doc, cell, width, lineGap = PDF_SPACING_LAYOUT.tableLineGap, paragraphGap = PDF_SPACING_LAYOUT.tableParagraphGap) {
    return tableCellLines(cell).reduce((height, line, index, lines) => {
        const textHeight = doc.heightOfString(line, { width, lineGap });
        return height + textHeight + (index < lines.length - 1 ? paragraphGap : 0);
    }, 0);
}

function drawTableCellText(doc, cell, x, y, width, options = {}) {
    const lineGap = options.lineGap ?? PDF_SPACING_LAYOUT.tableLineGap;
    const paragraphGap = options.paragraphGap ?? PDF_SPACING_LAYOUT.tableParagraphGap;
    const align = options.align || 'left';
    let currentY = y;
    const lines = tableCellLines(cell);
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const textHeight = doc.heightOfString(line, { width, lineGap });
        doc.text(line, x, currentY, { width, lineGap, align });
        currentY += textHeight + (index < lines.length - 1 ? paragraphGap : 0);
    }
}

function tableColumnWidths(doc, columns = []) {
    const contentWidth = pageContentWidth(doc);
    const totalWeight = columns.reduce((sum, col) => sum + (Number(col.weight) || 0), 0) || columns.length || 1;
    const widths = columns.map(col => Math.floor(contentWidth * (Number(col.weight) || 1) / totalWeight));
    if (widths.length) {
        widths[widths.length - 1] += contentWidth - widths.reduce((sum, width) => sum + width, 0);
    }
    return widths;
}

function tableHeaderOptions() {
    return {
        bold: true,
        fill: PDF_COLORS.soft,
        textColor: PDF_COLORS.tealDark,
        minHeight: PDF_SPACING_LAYOUT.tableHeaderMinHeight,
        fontSize: PDF_TYPE_SCALE.tableHeader,
        header: true
    };
}

function tableBodyOptions() {
    return {
        minHeight: PDF_SPACING_LAYOUT.tableBodyMinHeight,
        fontSize: PDF_TYPE_SCALE.tableBody
    };
}

function tableRowHeight(doc, cells = [], widths = [], options = {}) {
    const padding = PDF_SPACING_LAYOUT.tablePadding;
    const fontSize = options.fontSize || PDF_TYPE_SCALE.tableBody;
    doc.font(options.bold ? 'SummaryBold' : 'SummaryRegular').fontSize(fontSize);
    const heights = cells.map((cell, index) => tableCellTextHeight(
        doc,
        cell,
        Math.max(1, (widths[index] || 0) - padding * 2),
        options.lineGap ?? PDF_SPACING_LAYOUT.tableLineGap,
        options.paragraphGap ?? PDF_SPACING_LAYOUT.tableParagraphGap
    ));
    return Math.max(options.minHeight || 16, ...heights.map(item => item + padding * 2));
}

function tableStartHeight(doc, columns = [], rows = []) {
    if (!rows.length) return PDF_SPACING_LAYOUT.paragraphMinSpace;
    const widths = tableColumnWidths(doc, columns);
    const headerHeight = tableRowHeight(doc, columns.map(col => col.label), widths, tableHeaderOptions());
    const firstRowHeight = tableRowHeight(doc, rows[0], widths, tableBodyOptions());
    return headerHeight + firstRowHeight + 4;
}

function drawTable(doc, columns = [], rows = []) {
    if (!rows.length) {
        doc.font('SummaryRegular').fontSize(PDF_TYPE_SCALE.emptyState).fillColor(PDF_COLORS.muted).text('Позиції відсутні.');
        return;
    }

    const left = doc.page.margins.left;
    const widths = tableColumnWidths(doc, columns);
    const headerCells = columns.map(col => col.label);
    const headerOptions = tableHeaderOptions();

    const drawRow = (cells, options = {}) => {
        const padding = PDF_SPACING_LAYOUT.tablePadding;
        const fontSize = options.fontSize || PDF_TYPE_SCALE.tableBody;
        const height = tableRowHeight(doc, cells, widths, options);
        const rowHeightBudget = Math.min(height + 2, pageContentHeight(doc));
        const pageAdded = ensureSpace(doc, rowHeightBudget);
        if (pageAdded && !options.header) {
            drawRow(headerCells, headerOptions);
        }
        if (!options.header && height + 2 <= pageContentHeight(doc) && doc.y + height + 2 > pageBottom(doc)) {
            addDecoratedPage(doc);
            drawRow(headerCells, headerOptions);
        }
        resetCursorX(doc);
        const y = doc.y;
        let x = left;
        cells.forEach((cell, index) => {
            if (options.fill) {
                doc.rect(x, y, widths[index], height).fillAndStroke(options.fill, PDF_COLORS.border);
            } else {
                doc.rect(x, y, widths[index], height).strokeColor(PDF_COLORS.border).stroke();
            }
            doc.font(options.bold ? 'SummaryBold' : 'SummaryRegular')
                .fontSize(fontSize)
                .fillColor(options.textColor || PDF_COLORS.ink);
            drawTableCellText(doc, cell, x + padding, y + padding, widths[index] - padding * 2, {
                lineGap: PDF_SPACING_LAYOUT.tableLineGap,
                align: columns[index]?.align || 'left'
            });
            x += widths[index];
        });
        doc.y = y + height;
        resetCursorX(doc);
    };

    drawRow(headerCells, headerOptions);
    rows.forEach(row => drawRow(row, tableBodyOptions()));
}

function financeTableColumns() {
    return [
        { label: 'Позиція', weight: 2 },
        { label: 'Сума', weight: 1 }
    ];
}

function financeTableRows(summary = {}) {
    return financeRowsForSummary(summary).map(row => [
        row.label,
        formatMoney(row.amount, row.currency || summary.totals?.currency || 'UAH')
    ]);
}

function menuWorkflowRowsForSummary(summary = {}) {
    const workflow = summary.menuWorkflow || summary.menu_workflow || null;
    if (!workflow || workflow.mode !== 'actual') return [];
    const currency = summary.totals?.currency || workflow.currency || 'UAH';
    const rows = [];
    const add = (label, value) => {
        const cleanLabel = cleanText(label);
        const cleanValue = cleanText(value);
        if (cleanLabel && cleanValue) rows.push([cleanLabel, cleanValue]);
    };
    add('Статус', workflow.statusLabel || workflow.status_label || (workflow.status === 'finalized' ? 'Меню по факту · закрито' : 'Меню по факту · очікує закриття'));
    add('Мінімум меню', formatMoney(nullableNumber(workflow.minimumAmount ?? workflow.minimum_amount) ?? 0, currency));
    add('Попередня сума', formatMoney(nullableNumber(workflow.positionsSubtotal ?? workflow.positions_subtotal) ?? 0, currency));
    add('Різниця до мінімуму', formatMoney(nullableNumber(workflow.adjustmentAmount ?? workflow.adjustment_amount) ?? 0, currency));
    add('Сума меню до оплати', formatMoney(nullableNumber(workflow.chargedSubtotal ?? workflow.charged_subtotal) ?? 0, currency));
    const finalizedBy = workflow.finalizedBy || workflow.finalized_by || null;
    const finalizedByLabel = typeof finalizedBy === 'object' && finalizedBy
        ? (finalizedBy.name || finalizedBy.username || finalizedBy.id)
        : finalizedBy;
    if (workflow.status === 'finalized') {
        add('Закрито', [finalizedByLabel, workflow.finalizedAt || workflow.finalized_at].filter(Boolean).join(' · ') || 'Так');
    }
    if (workflow.exceptionReason || workflow.exception_reason) {
        add('Причина винятку', workflow.exceptionReason || workflow.exception_reason);
    }
    const taskSource = workflow.taskSource || workflow.task_source || null;
    if (taskSource?.sourceModule || taskSource?.source_module) {
        add('Контрольна задача', 'Закрити меню по факту');
    }
    return rows;
}

function menuWorkflowTableColumns() {
    return [
        { label: 'Меню по факту', weight: 1 },
        { label: 'Стан', weight: 2 }
    ];
}

function commentsTableColumns() {
    return [
        { label: 'Тип', weight: 1 },
        { label: 'Коментар', weight: 3 }
    ];
}

function commentsTableRows(comments = []) {
    return comments.map(comment => [
        comment.label || 'Примітка',
        comment.text || ''
    ]);
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
    if (view.mode === 'client') {
        return view.orderRowViews.map(row => [
            clientOrderTitleCell(row),
            pdfText(row.quantityLabel),
            pdfText(row.unitPriceLabel),
            pdfText(row.subtotalLabel)
        ]);
    }
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
    if (view.mode === 'client') {
        const weights = PDF_TABLE_LAYOUT.clientOrderColumns;
        return [
            { label: 'Позиція', weight: weights.position },
            { label: 'К-сть', weight: weights.quantity, align: 'center' },
            { label: 'Ціна', weight: weights.unitPrice, align: 'right' },
            { label: 'Сума', weight: weights.subtotal, align: 'right' }
        ];
    }
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

function scheduleTableColumns() {
    return [
        { label: 'Час', weight: 0.7 },
        { label: 'Подія', weight: 2 },
        { label: 'Примітка', weight: 2 }
    ];
}

function scheduleTableRows(schedule = []) {
    return schedule.map(item => [item.time, item.title, item.note || '']);
}

function responsibleTableColumns() {
    return [
        { label: 'Роль', weight: 1.1 },
        { label: 'Відповідальний', weight: 2.2 }
    ];
}

function responsibleTableRows(rows = []) {
    return rows.map(row => [row.label, row.name || '—']);
}

function drawSchedule(doc, schedule = []) {
    if (!schedule.length) {
        doc.font('SummaryRegular').fontSize(PDF_TYPE_SCALE.scheduleEmpty).fillColor(PDF_COLORS.muted).text('Розклад не заповнений.');
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

function drawRoundedHeroBackground(doc, x, y, width, height, radius) {
    doc.save();
    doc.roundedRect(x, y, width, height, radius).clip();
    doc.rect(x, y, width, height).fill(PDF_COLORS.cream);
    doc.restore();

    doc.roundedRect(x, y, width, height, radius)
        .lineWidth(0.9)
        .strokeColor(PDF_COLORS.gold)
        .stroke();
}

function drawHeroLogo(doc, x, y, size) {
    doc.save();
    doc.roundedRect(x, y, size, size, 8)
        .fillAndStroke('#ffffff', PDF_COLORS.border);
    if (fs.existsSync(BANQUET_LOGO_PATH)) {
        try {
            doc.image(BANQUET_LOGO_PATH, x + 5, y + 5, {
                fit: [size - 10, size - 10],
                align: 'center',
                valign: 'center'
            });
        } catch {
            doc.roundedRect(x + 12, y + 12, size - 24, size - 24, (size - 24) / 2)
                .lineWidth(0.6)
                .strokeColor(PDF_COLORS.border)
                .stroke();
        }
    }
    doc.restore();
}

function drawHeroPill(doc, text, x, y, width) {
    const label = pdfText(text);
    const textWidth = Math.min(width, Math.max(56, doc.widthOfString(label) + 12));
    doc.save();
    doc.fillOpacity(0.44)
        .roundedRect(x, y, textWidth, 13, 6.5)
        .fill(PDF_COLORS.cream);
    doc.restore();
    doc.roundedRect(x, y, textWidth, 13, 6.5)
        .lineWidth(0.45)
        .strokeColor(PDF_COLORS.gold)
        .stroke();
    doc.font('SummaryBold')
        .fontSize(PDF_TYPE_SCALE.heroPill)
        .fillColor(PDF_COLORS.teal)
        .text(label, x + 6, y + 3.4, { width: textWidth - 12, lineGap: 0 });
}

function drawHeroBookingCard(doc, summary, x, y, width, height, renderedAt, manager) {
    doc.save();
    doc.fillOpacity(0.94)
        .roundedRect(x, y, width, height, 8)
        .fill(PDF_COLORS.card);
    doc.restore();
    doc.roundedRect(x, y, width, height, 8)
        .lineWidth(0.45)
        .strokeColor(PDF_COLORS.border)
        .stroke();
    doc.moveTo(x, y + 3)
        .lineTo(x, y + height - 3)
        .lineWidth(1.1)
        .strokeColor(PDF_COLORS.gold)
        .stroke();

    const innerX = x + 9;
    const innerW = width - 17;
    doc.font('SummaryBold')
        .fontSize(PDF_TYPE_SCALE.heroCardTitle)
        .fillColor(PDF_COLORS.tealDark)
        .text(pdfText(summary.document?.title, '\u0411\u0410\u041d\u041a\u0415\u0422\u041d\u0418\u0419 \u041b\u0418\u0421\u0422').toUpperCase(), innerX, y + 7.2, {
            width: innerW,
            lineGap: 0.2
        });

    const bookingId = pdfText(summary.bookingId);
    const bookingY = y + 23.5;
    const bookingW = Math.min(innerW, Math.max(66, doc.widthOfString(bookingId) + 12));
    doc.save();
    doc.fillOpacity(0.5)
        .roundedRect(innerX, bookingY, bookingW, 13, 6.5)
        .fill('#fbf6e9');
    doc.restore();
    doc.roundedRect(innerX, bookingY, bookingW, 13, 6.5)
        .lineWidth(0.45)
        .strokeColor('#dfcfaa')
        .stroke();
    doc.font('SummaryBold')
        .fontSize(PDF_TYPE_SCALE.heroCardBadge)
        .fillColor('#6e551c')
        .text(bookingId, innerX + 6, bookingY + 3.6, { width: bookingW - 12 });

    const rows = [
        ['\u0421\u0444\u043e\u0440\u043c\u043e\u0432\u0430\u043d\u043e:', formatDateTime(renderedAt)],
        ['\u041c\u0435\u043d\u0435\u0434\u0436\u0435\u0440:', pdfText(manager)]
    ];
    let rowY = y + 39.5;
    rows.forEach(([label, value]) => {
        doc.font('SummaryRegular')
            .fontSize(PDF_TYPE_SCALE.heroCardMeta)
            .fillColor(PDF_COLORS.muted)
            .text(label, innerX, rowY, { width: 49, lineGap: 0 });
        doc.font('SummaryBold')
            .fontSize(PDF_TYPE_SCALE.heroCardMeta)
            .fillColor(PDF_COLORS.ink)
            .text(value, innerX + 52, rowY, { width: innerW - 52, lineGap: 0.1 });
        rowY += 9.4;
    });
}
function drawHeader(doc, summary, view) {
    const venue = summary.venue || {};
    const left = doc.page.margins.left;
    const top = doc.page.margins.top;
    const width = pageContentWidth(doc);
    const height = PDF_HEADER_LAYOUT.height;
    const logoSize = PDF_HEADER_LAYOUT.logoSize;
    const cardWidth = PDF_HEADER_LAYOUT.cardWidth;
    const cardHeight = PDF_HEADER_LAYOUT.cardHeight;
    const cardX = left + width - cardWidth - 9;
    const cardY = top + 8;
    const logoX = left + 12;
    const logoY = top + 16;
    const brandX = logoX + logoSize + 12;
    const brandWidth = Math.max(150, cardX - brandX - 12);
    const renderedAt = new Date();
    const manager = summary.document?.generatedBy || summary.event?.manager || null;

    drawPageDecor(doc);
    doc.x = left;
    doc.y = top;

    doc.save();
    doc.fillOpacity(0.96)
        .roundedRect(left, top + 4, width, height - 4, 8)
        .fill(PDF_COLORS.cream);
    doc.restore();
    doc.roundedRect(left, top + 4, width, height - 4, 8)
        .lineWidth(0.45)
        .strokeColor(PDF_COLORS.border)
        .stroke();

    drawHeroLogo(doc, logoX, logoY, logoSize);

    const generatedLabel = formatGeneratedAtShort(renderedAt);
    doc.font('SummaryBold').fontSize(PDF_TYPE_SCALE.heroGenerated);
    const pillWidth = Math.min(brandWidth, Math.max(58, doc.widthOfString(generatedLabel) + 14));
    doc.font('SummaryBold')
        .fontSize(PDF_TYPE_SCALE.heroGenerated)
        .fillColor(PDF_COLORS.muted)
        .text(generatedLabel, brandX, top + 13.5, { width: pillWidth, lineGap: 0 });

    const venueName = pdfText(venue.name, 'Event Genix');
    const titleY = top + 27;
    doc.font('SummaryBold').fontSize(PDF_TYPE_SCALE.heroVenueTitle);
    const titleHeight = doc.heightOfString(venueName, {
        width: brandWidth,
        lineGap: 0.1
    });
    doc.fillColor(PDF_COLORS.tealDark)
        .text(venueName, brandX, titleY, {
            width: brandWidth,
            lineGap: 0.1
        });

    const addressY = Math.max(top + 43.5, titleY + Math.min(titleHeight, 22) + 2.5);
    doc.font('SummaryRegular')
        .fontSize(PDF_TYPE_SCALE.heroVenueMeta)
        .fillColor(PDF_COLORS.muted)
        .text(pdfText(venue.addressLine1), brandX, addressY, { width: brandWidth, lineGap: 0.1 })
        .text(pdfText(venue.addressLine2), brandX, addressY + 8.5, { width: brandWidth, lineGap: 0.1 });
    doc.font('SummaryBold')
        .fontSize(PDF_TYPE_SCALE.heroVenuePhone)
        .fillColor(PDF_COLORS.teal)
        .text(pdfText(venue.phone), brandX, addressY + 17.5, { width: brandWidth, lineGap: 0 });

    drawHeroBookingCard(doc, summary, cardX, cardY, cardWidth, cardHeight, renderedAt, manager);

    doc.x = left;
    doc.y = top + height + 5;
}

function summaryCelebrants(summary = {}) {
    const explicit = Array.isArray(summary.celebrants) ? summary.celebrants : [];
    const customerChildren = Array.isArray(summary.customer?.children) ? summary.customer.children : [];
    const fallback = summary.celebrant ? [summary.celebrant] : [];
    return [...explicit, ...customerChildren, ...fallback]
        .map(child => ({
            name: cleanText(child?.name || child?.childName || child?.child_name),
            birthday: cleanText(child?.birthday || child?.birthDate || child?.childBirthday || child?.child_birthday)
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
    return birthdays.length ? birthdays.map(formatDate).join(', ') : null;
}

function buildBriefItems(summary = {}, view) {
    const event = summary.event || {};
    const arrival = summaryArrival(summary);
    const customer = summary.customer || {};
    const celebrant = summary.celebrant || {};
    const counts = summary.counts || {};
    const celebrants = summaryCelebrants(summary);
    const celebrantsNameLabel = celebrants.length > 1 ? 'Діти клієнта' : 'Іменинник';
    const celebrantsBirthdayLabel = celebrants.length > 1 ? 'ДН дітей' : 'Дата народження';
    const celebrantsNameDisplay = summaryCelebrantsNames(summary) || celebrant.name;
    const celebrantsBirthdayDisplay = summaryCelebrantsBirthdays(summary)
        || (celebrant.birthday ? formatDate(celebrant.birthday) : null);
    const items = [
        { label: 'Клієнт', value: customer.name },
        { label: 'Телефон', value: customer.phone },
        { label: 'Кімната', value: arrival.room || event.room },
        { label: 'Дата', value: formatDate(arrival.date || event.date) },
        { label: 'Прихід гостей', value: arrival.time },
        { label: 'Діти', value: counts.children },
        { label: 'Дорослі', value: counts.adults },
        { label: 'Столи', value: counts.tables },
        { label: 'Програма', value: event.hasRealProgram ? (event.programDisplayName || event.programName) : null },
        { label: celebrantsNameLabel, value: celebrantsNameDisplay },
        { label: celebrantsBirthdayLabel, value: celebrantsBirthdayDisplay },
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
        const responsibleColumns = responsibleTableColumns();
        const responsibleRows = responsibleTableRows(view.responsible);
        ensureSpace(doc, PDF_SPACING_LAYOUT.sectionAfterY + tableStartHeight(doc, responsibleColumns, responsibleRows) + 2);
        drawSectionTitle(doc, 'Відповідальні');
        drawTable(doc, responsibleColumns, responsibleRows);
    }

    if (view.config.showSchedule) {
        const scheduleColumns = scheduleTableColumns();
        const scheduleRows = scheduleTableRows(view.schedule);
        ensureSpace(doc, PDF_SPACING_LAYOUT.sectionAfterY + tableStartHeight(doc, scheduleColumns, scheduleRows) + 2);
        drawSectionTitle(doc, 'Розклад');
        if (scheduleRows.length) {
            drawTable(doc, scheduleColumns, scheduleRows);
        } else {
            drawSchedule(doc, view.schedule);
        }
    }

    if (view.config.showOrderRows) {
        const orderColumns = view.orderTableColumns;
        const orderRows = view.orderTableRows;
        ensureSpace(doc, PDF_SPACING_LAYOUT.sectionAfterY + tableStartHeight(doc, orderColumns, orderRows) + 2);
        drawSectionTitle(doc, view.mode === 'kitchen' ? 'Кухня / видача' : 'Замовлення');
        drawTable(doc, orderColumns, orderRows);
    }

    if (view.config.showComments && view.comments.length) {
        const commentsColumns = commentsTableColumns();
        const commentsRows = commentsTableRows(view.comments);
        ensureSpace(doc, PDF_SPACING_LAYOUT.sectionAfterY + tableStartHeight(doc, commentsColumns, commentsRows) + 2);
        drawSectionTitle(doc, 'Коментарі');
        drawTable(doc, commentsColumns, commentsRows);
    }

    if (view.config.showFinance) {
        const financeColumns = financeTableColumns();
        const financeRows = financeTableRows(summary);
        const menuWorkflowColumns = menuWorkflowTableColumns();
        const menuWorkflowRows = view.menuWorkflowRows || [];
        ensureSpace(doc, PDF_SPACING_LAYOUT.sectionAfterY + tableStartHeight(doc, financeColumns, financeRows) + tableStartHeight(doc, menuWorkflowColumns, menuWorkflowRows) + 2);
        drawSectionTitle(doc, 'Фінанси');
        if (menuWorkflowRows.length) {
            drawTable(doc, menuWorkflowColumns, menuWorkflowRows);
            doc.moveDown(0.35);
        }
        drawTable(doc, financeColumns, financeRows);
    }

    if (view.config.showTerms) {
        ensureSpace(doc, PDF_SPACING_LAYOUT.sectionAfterY + PDF_SPACING_LAYOUT.paragraphMinSpace + 2);
        drawSectionTitle(doc, summary.terms?.title || 'Умови банкету');
        drawParagraphList(doc, summary.terms?.items || []);
    }

    if (view.config.showWarnings && view.warnings.length) {
        ensureSpace(doc, PDF_SPACING_LAYOUT.sectionAfterY + PDF_SPACING_LAYOUT.paragraphMinSpace + 2);
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
            margin: 34,
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
