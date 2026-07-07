const fs = require('fs');
const path = require('path');
const pkg = require('../../package.json');

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cssDeclarationValue(rule, property) {
    let value = '';
    const pattern = new RegExp(`(?:^|;)\\s*${escapeRegExp(property)}\\s*:\\s*([^;]+)`, 'g');
    for (const match of rule.matchAll(pattern)) {
        value = match[1].trim();
    }
    return value;
}

function cssCustomPropertyValue(css, property) {
    let value = '';
    const pattern = new RegExp(`${escapeRegExp(property)}\\s*:\\s*([^;]+);`, 'g');
    for (const match of css.matchAll(pattern)) {
        value = match[1].trim();
    }
    return value;
}

function resolveCssValue(css, value) {
    const variable = String(value || '').match(/^var\((--[^),\s]+)\)$/);
    return variable ? cssCustomPropertyValue(css, variable[1]) : String(value || '').trim();
}

function cssNumericValue(css, rule, property) {
    const value = resolveCssValue(css, cssDeclarationValue(rule, property));
    const match = value.match(/^(-?\d+(?:\.\d+)?)([a-z%]*)$/i);
    return match ? { number: Number(match[1]), unit: match[2] || '', value } : null;
}

function cssShorthandFirstNumericValue(css, rule, property) {
    const rawValue = cssDeclarationValue(rule, property);
    const firstValue = rawValue.match(/var\([^)]*\)|[^\s]+/)?.[0] || '';
    const value = resolveCssValue(css, firstValue);
    const match = value.match(/^(-?\d+(?:\.\d+)?)([a-z%]*)$/i);
    return match ? { number: Number(match[1]), unit: match[2] || '', value } : null;
}

function runBookingSummaryChecks(context, { bookingSummaryBrowserSmokeCode } = {}) {
    const {
        ROOT,
        check,
        checkPage,
        cssAtRuleBlock,
        cssRuleText,
        cssRuleIncludingSelectorText,
        htmlContains,
        getHtmlScripts
    } = context;

checkPage('booking-summary.html', (doc, html) => {
    const pageCode = fs.readFileSync(path.join(ROOT, 'js', 'booking-summary-page.js'), 'utf8');
    const banquetSummaryServiceCode = fs.readFileSync(path.join(ROOT, 'services', 'banquetSummary.js'), 'utf8');
    const banquetSummaryPdfCode = fs.readFileSync(path.join(ROOT, 'services', 'banquetSummaryPdf.js'), 'utf8');
    const pageCss = fs.readFileSync(path.join(ROOT, 'css', 'booking-summary.css'), 'utf8');
    const printCss = cssAtRuleBlock(pageCss, '@media print');
    const mobileCss = cssAtRuleBlock(pageCss, '@media (max-width: 760px)');
    const printHtmlRule = cssRuleIncludingSelectorText(printCss, 'html');
    const printDarkHtmlRule = cssRuleIncludingSelectorText(printCss, 'html[data-theme="dark"]');
    const printBodyRule = cssRuleIncludingSelectorText(printCss, 'body.booking-summary-page');
    const printDarkBodyRule = cssRuleIncludingSelectorText(printCss, 'html[data-theme="dark"] body.booking-summary-page');
    const printDirectDarkBodyRule = cssRuleIncludingSelectorText(printCss, 'html[data-theme="dark"] > body.booking-summary-page');
    const printDirectBodyRule = cssRuleIncludingSelectorText(printCss, 'html > body.booking-summary-page');
    const printToolbarRule = cssRuleIncludingSelectorText(printCss, '.booking-summary-toolbar');
    const printStateRule = cssRuleIncludingSelectorText(printCss, '.booking-summary-state');
    const printToastRule = cssRuleIncludingSelectorText(printCss, '.booking-summary-toast');
    const printDocumentRule = cssRuleIncludingSelectorText(printCss, '.booking-summary-document');
    const printA4PageRule = cssRuleIncludingSelectorText(printCss, '.booking-summary-a4-page');
    const mobilePrintRootRule = cssRuleIncludingSelectorText(mobileCss, '.booking-summary-print-root');
    const mobileA4PageRule = cssRuleIncludingSelectorText(mobileCss, '.booking-summary-a4-page');
    const printSectionHeadingRule = cssRuleIncludingSelectorText(printCss, '.summary-section h2');
    const printTableHeadRule = cssRuleIncludingSelectorText(printCss, '.summary-order-table thead');
    const printTableRowRule = cssRuleIncludingSelectorText(printCss, '.summary-order-table tr');
    const printServiceEventRule = cssRuleIncludingSelectorText(printCss, '.summary-service-event');
    const printTermsRule = cssRuleIncludingSelectorText(printCss, '.summary-terms');
    const printTermsSectionRule = cssRuleIncludingSelectorText(printCss, '.summary-section--terms');
    const printTermsItemRule = cssRuleIncludingSelectorText(printCss, '.summary-terms li');
    const printCommentsRule = cssRuleIncludingSelectorText(printCss, '.summary-comments');
    const printCommentsSectionRule = cssRuleIncludingSelectorText(printCss, '.summary-section--comments');
    const printCommentRowRule = cssRuleIncludingSelectorText(printCss, '.summary-comment-row');
    const summaryToolbarRule = cssRuleText(pageCss, '.booking-summary-toolbar');
    const summaryActionsRule = cssRuleText(pageCss, '.booking-summary-actions');
    const summaryButtonRule = cssRuleText(pageCss, '.booking-summary-btn');
    const summarySecondaryButtonRule = cssRuleText(pageCss, '.booking-summary-btn-secondary');
    const summaryPrimaryButtonRule = cssRuleText(pageCss, '.booking-summary-btn-primary');
    const summaryCloseButtonRule = cssRuleText(pageCss, '.booking-summary-close');
    const mobileSummaryActionsRule = cssRuleIncludingSelectorText(mobileCss, '.booking-summary-actions');
    const mobileSummaryCloseRule = cssRuleIncludingSelectorText(mobileCss, '.booking-summary-close');
    const banquetHeroRule = cssRuleText(pageCss, '.banquet-hero');
    const bookingCardRule = cssRuleText(pageCss, '.booking-card');
    const bookingIdRule = cssRuleText(pageCss, '.booking-id');
    const metaRowRule = cssRuleText(pageCss, '.meta-row');
    const termsSectionRule = cssRuleText(pageCss, '.summary-section--terms');
    const printTermsSpacingRule = cssRuleText(printCss, '.summary-section--terms');
    const summaryBriefRule = cssRuleText(pageCss, '.summary-brief');
    const summaryBriefGridRule = cssRuleText(pageCss, '.summary-brief-grid');
    const summaryBriefItemRule = cssRuleText(pageCss, '.summary-brief-item');
    const mobileHeroRule = cssRuleIncludingSelectorText(mobileCss, '.banquet-hero');
    const mobileBriefGridRule = cssRuleIncludingSelectorText(mobileCss, '.summary-brief-grid');
    const printHeroRule = cssRuleIncludingSelectorText(printCss, '.banquet-hero');
    const printBriefGridRule = cssRuleIncludingSelectorText(printCss, '.summary-brief-grid');
    const printBriefColumnRule = cssRuleIncludingSelectorText(printCss, '.summary-brief-column');
    const printBriefItemRule = cssRuleIncludingSelectorText(printCss, '.summary-brief-item');
    const densityBlockStart = pageCss.indexOf('/* Banquet readability density: measured A4 layout tokens. */');
    const densityCss = densityBlockStart >= 0 ? pageCss.slice(densityBlockStart) : '';
    const densityBriefItemRule = cssRuleIncludingSelectorText(densityCss, '.booking-summary-document .summary-brief-item');
    const densitySectionRule = cssRuleIncludingSelectorText(densityCss, '.booking-summary-document .summary-section');
    const densityResponsibleItemRule = cssRuleIncludingSelectorText(densityCss, '.booking-summary-document .summary-responsible-item');
    const densityScheduleItemRule = cssRuleIncludingSelectorText(densityCss, '.booking-summary-document .summary-schedule-item');
    const densityOrderCellRule = cssRuleIncludingSelectorText(densityCss, '.booking-summary-document .summary-order-table td');
    const densityBriefFont = cssNumericValue(densityCss, densityBriefItemRule, 'font-size');
    const densityResponsibleFont = cssNumericValue(densityCss, densityResponsibleItemRule, 'font-size');
    const densityScheduleFont = cssNumericValue(densityCss, densityScheduleItemRule, 'font-size');
    const densityOrderFont = cssNumericValue(densityCss, densityOrderCellRule, 'font-size');
    const densityBriefPadY = cssShorthandFirstNumericValue(densityCss, densityBriefItemRule, 'padding');
    const densitySectionMarginTop = cssNumericValue(densityCss, densitySectionRule, 'margin-top');
    const densityOrderPadY = cssShorthandFirstNumericValue(densityCss, densityOrderCellRule, 'padding');
    const printTriggerCount = (pageCode.match(/window\.print\s*\(/g) || []).length;
    const renderTermsBody = pageCode.match(/function renderTerms\(summary\) \{([\s\S]*?)\r?\n    \}\r?\n\r?\n    function renderDocument/)?.[1] || '';
    const renderDocumentBody = pageCode.match(/function renderDocument\(summary\) \{([\s\S]*?)\r?\n    \}\r?\n\r?\n    function summaryText/)?.[1] || '';
    const summaryTextBody = pageCode.match(/function summaryText\(summary\) \{([\s\S]*?)\r?\n    \}\r?\n\r?\n    async function copyText/)?.[1] || '';
    const pdfExportButtons = Array.from(doc.querySelectorAll('[data-booking-summary-pdf-mode]'));
    const frontendBanquetTermsHardcode = /(banquet_own_cake_fee|banquet_cork_fee|banquet_menu_correction_deadline_days|banquet_date_change_deadline_days|Cork Fee|Свій торт|500грн|500 грн|100грн|100 грн|3 доби|5 діб)/;
    check('Booking summary page exposes preview shell and actions',
        !doc.getElementById('bookingSummaryBack')
        && !!doc.getElementById('bookingSummaryClose')
        && !!doc.getElementById('bookingSummaryCopy')
        && !!doc.getElementById('bookingSummaryClientPdf')
        && !!doc.getElementById('bookingSummaryPrint')
        && pdfExportButtons.length === 1
        && pdfExportButtons[0]?.getAttribute('data-booking-summary-pdf-mode') === 'client'
        && doc.getElementById('bookingSummaryClose')?.getAttribute('aria-label') === 'Закрити банкетний лист'
        && doc.getElementById('bookingSummaryClose')?.getAttribute('title') === 'Закрити'
        && doc.getElementById('bookingSummaryClientPdf')?.textContent?.trim() === 'PDF для клієнта'
        && !html.includes('data-booking-summary-pdf-mode="kitchen"')
        && !html.includes('data-booking-summary-pdf-mode="staff"')
        && !html.includes('Для кухні')
        && !html.includes('Для персоналу')
        && !html.includes('Експорт PDF')
        && !html.includes('Повернутись')
        && pageCode.includes("el('bookingSummaryClientPdf')?.addEventListener('click', () => exportSummaryPdf('client'))")
        && !pageCode.includes("document.querySelectorAll('[data-booking-summary-pdf-mode]')")
        && html.includes('booking-summary-shell')
        && html.includes('booking-summary-btn-primary')
        && !banquetSummaryPdfCode.includes('drawFinalBrand')
        && !!doc.getElementById('bookingSummaryWarnings')
        && !!doc.getElementById('bookingSummaryPrintRoot')
        && !!doc.getElementById('bookingSummaryDocument'));
    check('Booking summary toolbar uses compact unified button hierarchy',
        summaryToolbarRule.includes('padding: 12px 20px')
        && summaryToolbarRule.includes('gap: 16px')
        && summaryActionsRule.includes('flex-wrap: nowrap')
        && summaryButtonRule.includes('min-height: 38px')
        && summaryButtonRule.includes('white-space: nowrap')
        && summaryButtonRule.includes('transition:')
        && summarySecondaryButtonRule.includes('background: rgba(15, 23, 42, 0.72)')
        && summaryPrimaryButtonRule.includes('box-shadow: 0 10px 26px rgba(20, 184, 166, 0.22)')
        && summaryCloseButtonRule.includes('width: 38px')
        && summaryCloseButtonRule.includes('border-radius: 999px')
        && pageCss.includes('.booking-summary-btn:disabled')
        && pageCss.includes('.booking-summary-btn:active')
        && pageCss.includes('.booking-summary-btn-primary:hover')
        && pageCss.includes('.booking-summary-close:active')
        && mobileSummaryActionsRule.includes('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 38px')
        && mobileSummaryCloseRule.includes('grid-column: 3')
        && printToolbarRule.includes('display: none !important')
        && !pageCss.includes('.booking-summary-export'));
    check('Booking summary browser smoke covers client document surface without joining npm test',
        pkg.scripts?.['test:browser:booking-summary'] === 'npx --yes --package playwright node tests/browser/booking-summary-browser-smoke.js'
        && pkg.scripts?.test === 'npm run verify'
        && !pkg.scripts?.verify?.includes('test:browser:booking-summary')
        && bookingSummaryBrowserSmokeCode.includes("const SUMMARY_PATH = '/booking-summary.html?id=BK-SMOKE-001&mode=client&businessContext=event_genix'")
        && bookingSummaryBrowserSmokeCode.includes('routeBookingSummaryApi(page)')
        && bookingSummaryBrowserSmokeCode.includes('banquet-summary.pdf')
        && bookingSummaryBrowserSmokeCode.includes('#bookingSummaryDocument:not([hidden])')
        && bookingSummaryBrowserSmokeCode.includes('.booking-summary-toolbar')
        && bookingSummaryBrowserSmokeCode.includes('#bookingSummaryClose[aria-label="Закрити банкетний лист"]')
        && bookingSummaryBrowserSmokeCode.includes('#bookingSummaryClientPdf[data-booking-summary-pdf-mode="client"]')
        && bookingSummaryBrowserSmokeCode.includes('#bookingSummaryPrint')
        && bookingSummaryBrowserSmokeCode.includes('Для кухні')
        && bookingSummaryBrowserSmokeCode.includes('Для персоналу')
        && bookingSummaryBrowserSmokeCode.includes('.banquet-final-brand')
        && bookingSummaryBrowserSmokeCode.includes('Позиція')
        && bookingSummaryBrowserSmokeCode.includes('К-сть')
        && bookingSummaryBrowserSmokeCode.includes('Ціна')
        && bookingSummaryBrowserSmokeCode.includes('Сума')
        && bookingSummaryBrowserSmokeCode.includes('assertPrintCssHidesToolbar(page)')
        && bookingSummaryBrowserSmokeCode.includes("page.setViewportSize({ width: 390, height: 844 })")
        && bookingSummaryBrowserSmokeCode.includes('assertNoHorizontalOverflow(page)'));
    check('Booking summary page uses banquet sheet naming without changing internal route contracts',
        doc.title === 'Event Genix | Банкетний лист'
        && doc.querySelector('meta[name="description"]')?.getAttribute('content') === 'Preview і друк банкетного листа Event Genix'
        && doc.querySelector('.booking-summary-toolbar')?.getAttribute('aria-label') === 'Дії з банкетним листом'
        && doc.querySelector('.booking-summary-toolbar h1')?.textContent?.trim() === 'Банкетний лист'
        && doc.getElementById('bookingSummaryState')?.textContent?.includes('Завантаження банкетного листа...')
        && doc.getElementById('bookingSummaryDocument')?.getAttribute('aria-label') === 'Документ банкетного листа'
        && pageCode.includes("summary.document?.title || 'БАНКЕТНИЙ ЛИСТ'")
        && pageCode.includes("summary.venue?.name || 'Банкетний лист'")
        && pageCode.includes('Потрібно увійти в CRM, щоб відкрити банкетний лист.')
        && pageCode.includes('Не вдалося завантажити банкетний лист')
        && pageCode.includes('Банкетний лист ще не завантажений')
        && pageCode.includes('Текст банкетного листа скопійовано')
        && banquetSummaryServiceCode.includes("title: 'БАНКЕТНИЙ ЛИСТ'")
        && pageCode.includes('/bookings/${encodeURIComponent(id)}/banquet-summary')
        && !html.includes('Вижимка банкету')
        && !html.includes('вижимк')
        && !pageCode.includes('Вижимка банкету')
        && !pageCode.includes('вижимк')
        && !banquetSummaryServiceCode.includes("title: 'Вижимка банкету'"));
    check('Booking summary page renders canonical comments section and copy text',
        pageCode.includes('function summaryCommentRows(summary, mode = summaryMode(summary))')
        && pageCode.includes('function renderComments(summary, mode = summaryMode(summary))')
        && pageCode.includes('function summaryModeAllowsComment(summary, type, mode = summaryMode(summary))')
        && pageCode.includes('function summaryArrival(summary = {})')
        && renderDocumentBody.includes("briefItem('Дата банкету', formatDate(arrival.date || event.date))")
        && renderDocumentBody.includes("briefItem('Прихід гостей', arrival.time || event.time)")
        && !renderDocumentBody.includes("briefItem('Дата', formatDate(event.date))")
        && !renderDocumentBody.includes("briefItem('Час', event.time)")
        && summaryTextBody.includes('const arrival = summaryArrival(summary)')
        && summaryTextBody.includes('`Дата банкету: ${formatDate(arrival.date || event.date)}`')
        && summaryTextBody.includes('`Прихід гостей: ${formatValue(arrival.time || event.time)}`')
        && !summaryTextBody.includes('Дата' + '/час:')
        && renderDocumentBody.includes('summary-section--comments')
        && renderDocumentBody.includes('${renderComments(summary, mode)}')
        && renderDocumentBody.indexOf('summary-section--comments') > renderDocumentBody.indexOf('summary-section--service-events')
        && renderDocumentBody.indexOf('summary-section--comments') < renderDocumentBody.indexOf('summary-section--finance')
        && summaryTextBody.includes('const comments = sections.comments ? summaryCommentRows(summary, mode) : []')
        && summaryTextBody.includes('Примітки:')
        && summaryTextBody.includes('comments.map(comment => `- ${comment.label}: ${comment.text}`)')
        && pageCss.includes('.summary-comments')
        && pageCss.includes('.summary-comment-row')
        && printCommentsSectionRule.includes('break-inside: avoid')
        && printCommentsRule.includes('break-inside: avoid')
        && printCommentRowRule.includes('break-inside: avoid')
        && banquetSummaryServiceCode.includes('function buildSummaryComments')
        && banquetSummaryServiceCode.includes('function inlineCommentKeysFromRows(rows = [])')
        && banquetSummaryServiceCode.includes('comments: summaryComments')
        && banquetSummaryServiceCode.includes("add('kitchen', 'Кухня'")
        && banquetSummaryServiceCode.includes("add('activity', 'Коментар до активності'")
        && banquetSummaryServiceCode.includes("add('internal', 'Внутрішній коментар'"));
    check('Booking summary sheet uses clear menu quantity wording',
        pageCode.includes('function summaryMenuQuantityLabel(row = {})')
        && pageCode.includes('function formatCurrencyLabel(currency = \'UAH\')')
        && pageCode.includes("return normalized.toUpperCase() === 'UAH' ? '₴' : normalized")
        && pageCode.includes('function normalizeSummaryMenuServingUnitDisplay')
        && pageCode.includes('function summaryOrderQuantityLabel(row = {})')
        && pageCode.includes("['program', 'activity', 'service_event'].includes(row?.type)")
        && pageCode.includes('function summaryDurationLabel(row = {})')
        && pageCode.includes('function summaryClientOrderQuantityLabel(row = {})')
        && pageCode.includes('function summaryClientOrderUnitPriceLabel(row = {}, currency = \'UAH\')')
        && pageCode.includes('function summaryClientOrderSubtotalLabel(row = {}, currency = \'UAH\')')
        && pageCode.includes('function summaryClientOrderRowViewFromRow(row = {}, currency = \'UAH\')')
        && pageCode.includes('function normalizeSummaryClientOrderRowView(row = {})')
        && pageCode.includes('function summaryClientOrderRowViews(summary = {}, mode = summaryMode(summary))')
        && pageCode.includes('summary?.orderRowViews?.[normalizedMode]')
        && pageCode.includes('summary?.orderRowViewModels?.[normalizedMode]')
        && pageCode.includes('function summaryClientOrderMetaHtml(viewModel = {})')
        && pageCode.includes('function summaryClientOrderTextLines(rowViews = [])')
        && pageCode.includes('`   К-сть: ${row.quantityLabel}`')
        && pageCode.includes('`   Ціна: ${row.unitPriceLabel}`')
        && pageCode.includes('`   Сума: ${row.subtotalLabel}`')
        && pageCode.includes('(Array.isArray(row.metaLines) ? row.metaLines : []).forEach(item => {')
        && pageCode.includes('<table class="summary-order-table summary-order-table--client">')
        && pageCode.includes('<th>Позиція</th>')
        && pageCode.includes('<th class="qty">К-сть</th>')
        && pageCode.includes('<th class="money">Ціна</th>')
        && pageCode.includes('<th class="money">Сума</th>')
        && pageCode.includes('data-label="Позиція"')
        && pageCode.includes('data-label="Ціна"')
        && pageCode.includes('data-label="Сума"')
        && pageCode.includes('${summaryClientOrderMetaHtml(row)}')
        && pageCode.includes('summaryClientOrderUnitPriceLabel(row, currency)')
        && pageCode.includes('summaryClientOrderSubtotalLabel(row, currency)')
        && pageCode.includes('const clientRows = summaryClientOrderRowViews(summary, mode);')
        && pageCode.includes('<th class="duration">Тривалість</th>')
        && pageCode.includes('<td class="duration">${escapeHtml(summaryDurationLabel(row))}</td>')
        && pageCode.includes("function summaryOrderServingLabel(row = {})")
        && pageCode.includes('function summaryEntryFullAmountLabel(row = {}, currency = \'UAH\')')
        && pageCode.includes('по ${unit}')
        && pageCode.includes('<col style="width:86px">')
        && pageCode.includes('<col style="width:118px">')
        && pageCode.includes('<td class="qty" data-label="К-сть">${escapeHtml(row.quantityLabel)}</td>')
        && summaryTextBody.includes("const clientOrderRows = sections.orderRows && mode === 'client' ? summaryClientOrderRowViews(summary, mode) : []")
        && summaryTextBody.includes("clientOrderRows.length ? summaryClientOrderTextLines(clientOrderRows) : ['Позиції відсутні']")
        && summaryTextBody.includes('const durationLabel = summaryDurationLabel(row)')
        && summaryTextBody.includes('const quantityLabel = summaryOrderQuantityLabel(row)')
        && summaryTextBody.includes("row?.type === 'program' || row?.type === 'activity'")
        && summaryTextBody.includes('${durationLabel} — ${formatMoney(row.subtotal, currency)}')
        && summaryTextBody.includes('${summaryEntryFullAmountLabel(row, currency)}')
        && summaryTextBody.includes('— ${quantityLabel} × ${formatMoney(row.unitPrice, currency)}')
        && !summaryTextBody.includes('formatValue(row.quantity)} x')
        && banquetSummaryServiceCode.includes('formatMenuQuantityWithServingUnit')
        && banquetSummaryServiceCode.includes('function buildBanquetOrderRowViewModels(orderRows = [], mode = \'client\', currency = CURRENCY)')
        && banquetSummaryServiceCode.includes('orderRowViews: {')
        && banquetSummaryServiceCode.includes('client: buildBanquetOrderRowViewModels(orderRows, \'client\', CURRENCY)')
        && banquetSummaryPdfCode.includes('buildBanquetOrderRowViewModels')
        && banquetSummaryPdfCode.includes('function normalizedOrderRowViews(summary = {}, mode = \'client\', rows = [], currency = \'UAH\')')
        && banquetSummaryPdfCode.includes('function clientOrderTitleCell(viewModel = {})')
        && banquetSummaryPdfCode.includes("view.orderRowViews = normalizedMode === 'client'")
        && banquetSummaryPdfCode.includes('return view.orderRowViews.map(row => [')
        && banquetSummaryServiceCode.includes('servingUnit: item.servingUnit || null')
        && banquetSummaryServiceCode.includes('durationMinutes: durationMinutesOfBooking(mainBooking)')
        && banquetSummaryServiceCode.includes('durationMinutes: durationMinutesOfBooking(booking)')
        && pageCss.includes('.summary-order-table--client')
        && pageCss.includes('.summary-order-table .money')
        && pageCss.includes('.summary-order-meta')
        && pageCss.includes('grid-template-columns: 84px minmax(0, 1fr)')
        && pageCss.includes('.summary-order-table .duration')
        && pageCss.includes('.summary-order-table .qty')
        && pageCss.includes('white-space: normal'));
    check('Booking summary page loads standalone controller and print CSS',
        getHtmlScripts(html).includes('js/booking-summary-page.js')
        && html.includes('css/booking-summary.css')
        && !!printCss
        && printCss.includes('size: A4'));
    check('Booking summary preview uses a stable A4 wrapper contract',
        doc.getElementById('bookingSummaryPrintRoot')?.classList.contains('booking-summary-print-root')
        && doc.getElementById('bookingSummaryDocument')?.classList.contains('booking-summary-document')
        && doc.getElementById('bookingSummaryDocument')?.classList.contains('booking-summary-a4-page')
        && pageCode.includes("el('bookingSummaryPrintRoot')")
        && pageCss.includes('.booking-summary-print-root')
        && pageCss.includes('.booking-summary-a4-page')
        && pageCss.includes('aspect-ratio: 210 / 297')
        && pageCss.includes('width: min(100%, 210mm)')
        && mobilePrintRootRule.includes('overflow-x: visible')
        && mobileA4PageRule.includes('width: 100%')
        && mobileA4PageRule.includes('max-width: 210mm'));
    check('Booking summary print resets dark theme and screen chrome',
        printHtmlRule.includes('background: #fff !important')
        && printDarkHtmlRule.includes('background-image: none !important')
        && printBodyRule.includes('background-color: #fff !important')
        && printDarkBodyRule.includes('color-scheme: light !important')
        && printDirectDarkBodyRule.includes('background-image: none !important')
        && printDirectBodyRule.includes('background-color: #fff !important')
        && printToolbarRule.includes('display: none !important')
        && printStateRule.includes('display: none !important')
        && printToastRule.includes('display: none !important')
        && printDocumentRule.includes('border-radius: 0 !important')
        && printDocumentRule.includes('background: var(--summary-panel) !important')
        && printDocumentRule.includes('box-shadow: none !important')
        && printDocumentRule.includes('color: #000 !important'));
    check('Booking summary print pagination keeps dense summaries on one A4 canvas and protects row breaks',
        pageCode.includes('summary-section--orders')
        && pageCode.includes('summary-section--service-events')
        && pageCode.includes('summary-section--comments')
        && pageCode.includes('summary-section--finance')
        && pageCode.includes('summary-section--terms')
        && printCss.includes('.summary-section--comments')
        && printCss.includes('.summary-section--finance')
        && printCss.includes('.summary-section--terms')
        && printCss.includes('orphans: 2')
        && printCss.includes('widows: 2')
        && pageCss.includes('--summary-a4-width: 210mm')
        && pageCss.includes('--summary-a4-height: 297mm')
        && pageCss.includes('min-height: var(--summary-a4-height)')
        && pageCss.includes('margin: 0')
        && pageCss.includes('padding: var(--summary-a4-pad-top) var(--summary-a4-pad-x) var(--summary-a4-pad-bottom)')
        && pageCss.includes('grid-column: auto !important')
        && !pageCss.includes('.banquet-final-brand')
        && pageCss.includes('padding: 3px 4px')
        && printSectionHeadingRule.includes('break-after: avoid')
        && printSectionHeadingRule.includes('page-break-after: avoid')
        && printTableHeadRule.includes('display: table-header-group')
        && printTableRowRule.includes('break-inside: avoid')
        && printTermsItemRule.includes('page-break-inside: avoid')
        && printServiceEventRule.includes('break-inside: avoid')
        && termsSectionRule.includes('margin-top: 12px')
        && printTermsSpacingRule.includes('margin-top: 12px')
        && printA4PageRule.includes('aspect-ratio: auto'));
    check('Booking summary readability density guard keeps readable floors and compact spacing',
        densityBlockStart >= 0
        && densityCss.includes('Banquet readability density')
        && densityCss.includes('--summary-density-brief-font')
        && densityCss.includes('--summary-density-list-font')
        && densityCss.includes('--summary-density-table-font')
        && densityBriefFont?.unit === 'px'
        && densityBriefFont.number >= 10.8
        && densityResponsibleFont?.unit === 'px'
        && densityResponsibleFont.number >= 10.2
        && densityScheduleFont?.unit === 'px'
        && densityScheduleFont.number >= 10.2
        && densityOrderFont?.unit === 'px'
        && densityOrderFont.number >= 9.8
        && densityBriefPadY?.unit === 'mm'
        && densityBriefPadY.number <= 0.75
        && densitySectionMarginTop?.unit === 'mm'
        && densitySectionMarginTop.number <= 2.4
        && densityOrderPadY?.unit === 'mm'
        && densityOrderPadY.number <= 1.1
        && pageCode.includes('<th>Позиція</th>')
        && pageCode.includes('<th class="qty">К-сть</th>')
        && pageCode.includes('<th class="money">Ціна</th>')
        && pageCode.includes('<th class="money">Сума</th>')
        && pageCode.includes('${summaryClientOrderMetaHtml(row)}')
        && pageCode.includes('(Array.isArray(row.metaLines) ? row.metaLines : []).forEach(item => {'));
    check('Booking summary terms stay backend-driven across preview, copy text, and print',
        renderDocumentBody.includes('summary-section--terms')
        && renderDocumentBody.includes('${renderTerms(summary)}')
        && renderDocumentBody.includes('summary.terms?.title')
        && renderTermsBody.includes('const terms = summary?.terms || {}')
        && renderTermsBody.includes('const items = Array.isArray(terms.items) ? terms.items.filter(Boolean) : []')
        && renderTermsBody.includes('items.map(item => `<li>${escapeHtml(item)}</li>`).join')
        && renderTermsBody.includes('Умови банкету не заповнені')
        && summaryTextBody.includes('const terms = sections.terms && Array.isArray(summary.terms?.items) ? summary.terms.items : []')
        && summaryTextBody.includes('terms.map(item => `- ${item}`)')
        && summaryTextBody.includes("terms.length ? terms.map")
        && !frontendBanquetTermsHardcode.test(pageCode)
        && !frontendBanquetTermsHardcode.test(pageCss));
    check('Booking summary terms distinguish manual terms from auto price-rule snapshots',
        banquetSummaryServiceCode.includes('function termsSnapshotSourceOf')
        && banquetSummaryServiceCode.includes('function isPriceRuleTermsSnapshot')
        && banquetSummaryServiceCode.includes("source: 'manual'")
        && banquetSummaryServiceCode.includes("source: 'snapshot_fallback'")
        && banquetSummaryServiceCode.includes("source: defaults.source || 'price_rules'")
        && banquetSummaryServiceCode.includes('priceRuleSnapshot')
        && !frontendBanquetTermsHardcode.test(pageCode)
        && !frontendBanquetTermsHardcode.test(pageCss));
    check('Booking summary print keeps banquet terms section and list items unbroken',
        printTermsSectionRule.includes('break-inside: avoid')
        && printTermsSectionRule.includes('page-break-inside: avoid')
        && printTermsRule.includes('break-inside: avoid')
        && printTermsRule.includes('page-break-inside: avoid')
        && printTermsItemRule.includes('break-inside: avoid')
        && printTermsItemRule.includes('page-break-inside: avoid'));
    check('Booking summary print keeps comments section unbroken',
        printCommentsSectionRule.includes('break-inside: avoid')
        && printCommentsSectionRule.includes('page-break-inside: avoid')
        && printCommentsRule.includes('break-inside: avoid')
        && printCommentsRule.includes('page-break-inside: avoid')
        && printCommentRowRule.includes('break-inside: avoid')
        && printCommentRowRule.includes('page-break-inside: avoid'));
    check('Booking summary print trigger stays browser-native without app-owned header or footer promises',
        printTriggerCount === 1
        && pageCode.includes('function printSummaryDocument()')
        && pageCode.includes('const originalTitle = document.title')
        && pageCode.includes('document.title = printTitle')
        && pageCode.includes('document.title = originalTitle')
        && pageCode.includes("window.addEventListener('afterprint', restoreTitle")
        && pageCode.includes('setTimeout(restoreTitle, 1000)')
        && pageCode.includes('window.print()')
        && !pageCode.includes('page.pdf')
        && !pageCode.includes('jsPDF')
        && !pageCode.includes('html2pdf')
        && !pageCode.includes('displayHeaderFooter')
        && !pageCss.includes('headerTemplate')
        && !pageCss.includes('footerTemplate')
        && !pageCss.includes('@top-')
        && !pageCss.includes('@bottom-'));
    check('Booking summary page consumes the banquet summary API and exports clean server PDFs',
        pageCode.includes('/bookings/${encodeURIComponent(id)}/banquet-summary')
        && pageCode.includes('/bookings/${encodeURIComponent(currentSummaryRequest.id)}/banquet-summary.pdf')
        && pageCode.includes("const groupId = params.get('groupId') || '';")
        && pageCode.includes("requestParams.set('groupId', groupId)")
        && pageCode.includes("Accept: 'application/pdf'")
        && pageCode.includes('response.blob()')
        && pageCode.includes('URL.createObjectURL(blob)')
        && pageCode.includes('data-booking-summary-pdf-mode')
        && pageCode.includes('totals.orderTotal')
        && printTriggerCount === 1
        && pageCode.includes('bookingSummaryWarnings')
        && pageCode.includes('navigator.clipboard')
        && !pageCode.includes('jsPDF')
        && !pageCode.includes('html2pdf'));
    check('Booking summary header labels generated account as manager, not author',
        pageCode.includes('<span>Менеджер:</span>')
        && pageCode.includes('<b>${escapeHtml(formatValue(manager))}</b>')
        && !pageCode.includes('<span>Автор: ${escapeHtml(formatValue(summary.document?.generatedBy))}</span>')
        && !pageCode.includes('Автор:')
        && !pageCode.includes("compactFact('Менеджер', event.manager)"));
    check('Booking summary uses render-time generated label and keeps booking creation clear',
        !banquetSummaryServiceCode.includes('generatedAt: new Date().toISOString()')
        && !renderDocumentBody.includes('summary.document?.generatedAt')
        && renderDocumentBody.includes('const renderedAt = new Date()')
        && renderDocumentBody.includes('formatGeneratedAtShort(renderedAt)')
        && renderDocumentBody.includes('<span>Сформовано:</span>')
        && !summaryTextBody.includes('Сформовано')
        && !renderDocumentBody.includes("briefItem('Оформлено'")
        && !summaryTextBody.includes('Дата оформлення')
        && renderDocumentBody.includes("briefItem('Бронь створено', formatDateTime(event.createdAt))")
        && summaryTextBody.includes('`Бронь створено: ${formatDateTime(event.createdAt)}`'));
    check('Booking summary keeps booking id as one visual hero chip and copy-text line',
        renderDocumentBody.includes('<div class="booking-id">${escapeHtml(summary.bookingId ||')
        && pageCode.includes('`Booking ID: ${summary.bookingId ||')
        && !renderDocumentBody.includes('Booking ID:')
        && !pageCode.includes("briefItem('Booking ID'"));
    check('Booking summary hero header uses official premium logo masthead and right booking card',
        fs.existsSync(path.join(ROOT, 'images', 'banquet-logo.png'))
        && renderDocumentBody.includes('<header class="banquet-hero"')
        && renderDocumentBody.includes('class="brand-logo-frame"')
        && renderDocumentBody.includes('class="brand-logo"')
        && renderDocumentBody.includes('images/banquet-logo.png')
        && !renderDocumentBody.includes('aria-hidden="true">EG')
        && !renderDocumentBody.includes('>EG</')
        && !renderDocumentBody.includes('BANQUET_HERO_LOGO_SRC')
        && !renderDocumentBody.includes('BANQUET_TOP_PLATE_SRC')
        && !renderDocumentBody.includes('BANQUET_CORNER_SRC')
        && !renderDocumentBody.includes('BANQUET_FINAL_LOGO_SRC')
        && !renderDocumentBody.includes('class="banquet-top-plate"')
        && !renderDocumentBody.includes('class="banquet-corner-art"')
        && !renderDocumentBody.includes('class="banquet-final-brand"')
        && renderDocumentBody.includes('<aside class="booking-card"')
        && renderDocumentBody.includes('<div class="brand-copy">')
        && renderDocumentBody.includes('venue.addressLine1')
        && renderDocumentBody.includes('venue.addressLine2')
        && renderDocumentBody.includes('venue.phone')
        && pageCss.includes('--summary-official-ink')
        && pageCss.includes('--summary-official-accent')
        && pageCss.includes('.brand-logo-frame')
        && pageCss.includes('.brand-logo')
        && pageCss.includes('.banquet-top-plate,')
        && pageCss.includes('.banquet-corner-art')
        && pageCss.includes('display: none !important')
        && pageCss.includes('.brand-logo[hidden]')
        && pageCss.includes('.brand-logo-frame.is-logo-missing .brand-logo')
        && !pageCss.includes('.banquet-final-brand')
        && pageCss.includes('grid-template-columns: 24mm minmax(0, 1fr) minmax(48mm, 58mm)')
        && pageCss.includes('border-left: 0')
        && pageCss.includes('.brand-logo-frame')
        && pageCss.includes('width: 24mm')
        && pageCss.includes('border: 1px solid var(--summary-official-line)')
        && pageCss.includes('object-fit: contain')
        && pageCss.includes('display: block !important')
        && metaRowRule.includes('grid-template-columns')
        && pageCss.includes('grid-template-columns: 21mm minmax(0, 1fr)')
        && pageCss.includes('min-height: 33mm')
        && !pageCss.includes('--summary-doc-meta-offset')
        && !pageCss.includes('padding-top: var(--summary-doc-meta-offset)')
        && !printCss.includes('--summary-doc-meta-offset'));
    check('Booking summary sheet uses two-column brief and keeps table only for ordered rows',
        pageCode.includes('function briefItem')
        && pageCode.includes('function briefColumn')
        && pageCode.includes('summary-brief-grid')
        && pageCode.includes('summary-brief-column')
        && pageCode.includes('summary-brief-label')
        && pageCode.includes('summary-brief-value')
        && pageCode.includes('function summaryFinanceRows(summary)')
        && pageCode.includes('function fallbackSummaryFinanceRows(summary)')
        && pageCode.includes('<table class="summary-finance-table">')
        && pageCode.includes('Загальна сума')
        && !pageCode.includes('До сплати')
        && !pageCode.includes('Сума бронювання')
        && pageCode.includes('<table class="summary-order-table summary-order-table--client">')
        && !pageCode.includes('function compactFact')
        && !pageCode.includes('function compactLine')
        && !pageCode.includes('compactLine([')
        && !pageCode.includes('summary-brief-line')
        && !pageCode.includes("compactFact('Менеджер', event.manager)")
        && !pageCode.includes('summary-info-grid')
        && !pageCode.includes('summary-total-card')
        && pageCode.includes('<td class="money" data-label="Ціна">')
        && pageCss.includes('.summary-brief-grid')
        && pageCss.includes('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)')
        && summaryBriefRule.includes('--summary-brief-label-width: 118px')
        && summaryBriefRule.includes('break-inside: avoid')
        && summaryBriefGridRule.includes('min-width: 0')
        && summaryBriefItemRule.includes('grid-template-columns: minmax(var(--summary-brief-label-width), 34%) minmax(0, 1fr)')
        && pageCss.includes('.summary-brief-column')
        && pageCss.includes('.summary-brief-label')
        && pageCss.includes('.summary-brief-value')
        && mobileBriefGridRule.includes('grid-template-columns: 1fr')
        && printCss.includes('--summary-brief-label-width: 106px')
        && printBriefGridRule.includes('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)')
        && printBriefGridRule.includes('page-break-inside: avoid')
        && printBriefColumnRule.includes('break-inside: avoid')
        && printBriefItemRule.includes('page-break-inside: avoid')
        && pageCss.includes('.summary-finance-table')
        && pageCss.includes('.summary-finance-row--due')
        && pageCss.includes('.summary-order-table thead')
        && pageCss.includes('break-inside: avoid')
        && !pageCss.includes('.summary-brief-line')
        && !pageCss.includes('.summary-info-grid')
        && !pageCss.includes('.summary-total-card'));
    check('Booking summary details rows use birthday, children, and conditional program contract',
        pageCode.includes('function formatBirthday(value)')
        && pageCode.includes('function summaryCelebrants(summary = {})')
        && pageCode.includes('function summaryCelebrantsNames(summary = {})')
        && renderDocumentBody.includes("briefItem('Діти', counts.children)")
        && renderDocumentBody.includes("programLabel ? briefItem('Програма', programLabel) : ''")
        && renderDocumentBody.includes('briefItem(celebrantsNameLabel, celebrantsNameDisplay)')
        && renderDocumentBody.includes('briefItem(celebrantsBirthdayLabel, celebrantsBirthdayDisplay)')
        && renderDocumentBody.includes("celebrants.length > 1 ? 'Діти клієнта' : 'Іменинник'")
        && renderDocumentBody.includes("celebrants.length > 1 ? 'ДН дітей' : 'Дата народження'")
        && summaryTextBody.includes('const programLabel = event.hasRealProgram ? (event.programDisplayName || event.programName) : null;')
        && summaryTextBody.includes('`${celebrantsNameLabel}: ${formatValue(celebrantsNameDisplay)}`')
        && summaryTextBody.includes('`${celebrantsBirthdayLabel}: ${formatValue(celebrantsBirthdayDisplay)}`')
        && summaryTextBody.includes('`Дітей: ${formatValue(counts.children)}`')
        && summaryTextBody.includes('...(programLabel ? [`Програма: ${formatValue(programLabel)}`] : [])')
        && !renderDocumentBody.includes("briefItem('Учасники'")
        && !renderDocumentBody.includes("briefItem('Програма', event.programName)")
        && !summaryTextBody.includes('`Програма: ${formatValue(event.programName)}`'));
    check('Banquet summary backend and PDF preserve full customer children display', banquetSummaryServiceCode.includes('celebrants: normalizedCustomer.children') && banquetSummaryServiceCode.includes('childrenDisplay: customerChildrenFullDisplay(children)') && banquetSummaryPdfCode.includes('function summaryCelebrants(summary = {})') && banquetSummaryPdfCode.includes("celebrants.length > 1 ? 'Діти клієнта' : 'Іменинник'") && banquetSummaryPdfCode.includes("celebrants.length > 1 ? 'ДН дітей' : 'Дата народження'"));
});
}

module.exports = {
    runBookingSummaryChecks
};
