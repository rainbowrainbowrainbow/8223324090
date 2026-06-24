/**
 * tests/ui-check.js — DOM-level UI checks using jsdom
 * Validates HTML structure, JS function availability, onclick handlers
 * Run: node tests/ui-check.js
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;

function check(label, condition) {
    if (condition) { passed++; }
    else { failed++; console.log(`  ❌ ${label}`); }
}

function fileText(filename) {
    return fs.readFileSync(path.join(ROOT, filename), 'utf8');
}

function cssTextWithImports(filename, seen = new Set()) {
    const normalized = filename.replace(/\\/g, '/');
    if (seen.has(normalized)) return '';
    seen.add(normalized);

    const css = fileText(normalized);
    const dir = path.posix.dirname(normalized);
    const imports = [];
    const importPattern = /@import\s+(?:url\()?["']?([^"')]+\.css(?:\?[^"')]+)?)["']?\)?\s*;?/g;
    let match;

    while ((match = importPattern.exec(css)) !== null) {
        const rawRef = match[1].split('?')[0].replace(/^\/+/, '');
        const imported = rawRef.startsWith('css/')
            ? rawRef
            : path.posix.normalize(path.posix.join(dir, rawRef));
        imports.push(cssTextWithImports(imported, seen));
    }

    return [css, ...imports].filter(Boolean).join('\n');
}

function cssRuleText(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
    return match ? match[1] : '';
}

function cssRuleIncludingSelectorText(css, selector) {
    const normalizedSelector = String(selector || '').trim().replace(/\s+/g, ' ');
    let rule = '';
    for (const match of css.matchAll(/([^{}]+)\{([\s\S]*?)\}/g)) {
        const selectors = match[1].split(',').map(item => item.trim().replace(/\s+/g, ' '));
        if (selectors.includes(normalizedSelector)) rule = match[2];
    }
    return rule;
}

function cssAtRuleBlock(css, atRulePrefix) {
    const start = css.indexOf(atRulePrefix);
    if (start === -1) return '';
    const open = css.indexOf('{', start);
    if (open === -1) return '';
    let depth = 0;
    for (let i = open; i < css.length; i++) {
        if (css[i] === '{') depth++;
        if (css[i] === '}') depth--;
        if (depth === 0) return css.slice(open + 1, i);
    }
    return '';
}

function hrSurfaceText() {
    return `${fileText('hr.html')}\n${fileText('css/hr-page.css')}`;
}

function htmlContains(filename, text) {
    if (filename === 'hr.html') return hrSurfaceText().includes(text);
    return fileText(filename).includes(text);
}

function checkPage(filename, checks) {
    const filepath = path.join(ROOT, filename);
    if (!fs.existsSync(filepath)) { console.log(`⚠️  ${filename} not found`); return; }
    const html = fs.readFileSync(filepath, 'utf8');
    const dom = new JSDOM(html, { url: `http://localhost:3000/${filename.replace('.html','')}`, runScripts: 'outside-only' });
    const doc = dom.window.document;
    console.log(`\n📄 ${filename}`);
    checks(doc, html);
    dom.window.close();
}

function checkJSFile(filename) {
    const filepath = path.join(ROOT, filename);
    if (!fs.existsSync(filepath)) { console.log(`⚠️  ${filename} not found`); return; }
    const code = fs.readFileSync(filepath, 'utf8');
    console.log(`\n📜 ${filename}`);

    // Check syntax
    try {
        new Function(code);
        check('Syntax valid', true);
    } catch (e) {
        check(`Syntax valid (${e.message})`, false);
    }

    // Check no ?.property = assignments
    const badAssignments = code.match(/\?\.\w+\s*=[^=]/g);
    check('No ?.prop = assignments', !badAssignments || badAssignments.length === 0);

    // Check no misplaced <script> tags
    check('No <script> in JS', !code.includes('<script>'));

    return code;
}

function getHtmlScripts(html) {
    return [...html.matchAll(/<script\s+src=["']([^"']+)["']/g)]
        .map(m => m[1].split('?')[0]);
}

function getInlineScripts(html) {
    return [...html.matchAll(/<script(?!\s+src)[^>]*>([\s\S]*?)<\/script>/g)]
        .map(m => m[1]);
}

function walkFiles(dir, matcher) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries.flatMap(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walkFiles(full, matcher);
        return matcher(full) ? [full] : [];
    });
}

// ═══════════════════════════════════════════════════
// PAGE CHECKS
// ═══════════════════════════════════════════════════

checkPage('index.html', (doc, html) => {
    const modalsCss = fs.readFileSync(path.join(ROOT, 'css', 'modals.css'), 'utf8');
    const featuresCss = fs.readFileSync(path.join(ROOT, 'css', 'features.css'), 'utf8');
    const panelCss = fs.readFileSync(path.join(ROOT, 'css', 'panel.css'), 'utf8');
    const darkModeCss = fs.readFileSync(path.join(ROOT, 'css', 'dark-mode.css'), 'utf8');
    const appCode = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
    const bookingCode = [
        fs.readFileSync(path.join(ROOT, 'js', 'booking-drawer-state.js'), 'utf8'),
        fs.readFileSync(path.join(ROOT, 'js', 'booking-banquet-selector.js'), 'utf8'),
        fs.readFileSync(path.join(ROOT, 'js', 'booking-save-path.js'), 'utf8'),
        fs.readFileSync(path.join(ROOT, 'js', 'booking.js'), 'utf8')
    ].join('\n');
    const bookingFormCode = fs.readFileSync(path.join(ROOT, 'js', 'booking-form.js'), 'utf8');
    const apiCode = fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8');
    const bookingsRouteCode = fs.readFileSync(path.join(ROOT, 'routes', 'bookings.js'), 'utf8');
    const productPricingCode = fs.readFileSync(path.join(ROOT, 'services', 'productPricing.js'), 'utf8');
    const productSalesBtnRule = modalsCss.match(/\.btn-product-sales,\s*[\r\n]+\.btn-new-booking\s*\{([\s\S]*?)\}/)?.[1]
        || modalsCss.match(/\.btn-product-sales\s*\{([\s\S]*?)\}/)?.[1] || '';
    const darkProductSalesBtnRule = modalsCss.match(/body\.dark-mode\s+\.btn-product-sales,\s*[\r\n]+body\.dark-mode\s+\.btn-new-booking\s*\{([\s\S]*?)\}/)?.[1]
        || modalsCss.match(/body\.dark-mode\s+\.btn-product-sales\s*\{([\s\S]*?)\}/)?.[1] || '';
    const legacyBatchInputRule = featuresCss.match(/\.batch-qty-option input\s*\{([\s\S]*?)\}/)?.[1] || '';

    check('loginForm exists', !!doc.getElementById('loginForm'));
    check('loginScreen exists', !!doc.getElementById('loginScreen'));
    check('mainApp exists', !!doc.getElementById('mainApp'));
    check('submit button has type=submit', doc.querySelector('.btn-login')?.type === 'submit');
    check('sidebarLinks exists', !!doc.getElementById('sidebarLinks'));
    check('Timeline product sales button exists', !!doc.getElementById('productSalesBtn'));
    check('Timeline create booking toolbar button is absent', !doc.getElementById('newBookingBtn'));
    check('Booking customer UI reads canonical children without writing one-child payload', bookingCode.includes('function bookingCustomerChildrenProjection') && bookingCode.includes('function bookingCustomerChildrenDisplay') && bookingCode.includes('Діти:') && bookingCode.includes('bookingCustomerChildLine') && !bookingCode.includes('obj.customer ='));
    check('Room-first timeline selector and booking animator field are wired',
        !!doc.getElementById('timelineViewSelector')
        && !!doc.querySelector('[data-timeline-view="rooms"]')
        && !!doc.querySelector('[data-timeline-view="animators"].active')
        && !!doc.querySelector('#settingsTimelineDefaultView option[value="animators"][selected]')
        && !!doc.getElementById('bookingPrimaryAnimatorSelect')
        && !!doc.getElementById('settingsTimelineRoomFirstEnabled')
        && !!doc.getElementById('settingsTimelineDefaultView')
        && appCode.includes('window.TimelineView.set?.(button.dataset.timelineView)')
        && htmlContains('js/timeline.js', 'function defaultTimelineViewMode()')
        && htmlContains('js/timeline.js', 'defaultTimelineView')
        && htmlContains('js/timeline.js', "TIMELINE_VIEW_USER_CHOICE_VERSION = 'standard-default-v1'")
        && htmlContains('js/timeline.js', 'timelineViewChoiceStorageKey')
        && !htmlContains('js/timeline.js', 'room-first-v1')
        && htmlContains('js/timeline-context.js', 'roomTimelineEnabled')
        && apiCode.includes('function timelineApiUrlWithView')
        && apiCode.includes('timelineView=${encodeURIComponent(String(view))}')
        && htmlContains('routes/lines.js', 'BANQUET_SERVICE_LINE_ID')
        && htmlContains('routes/lines.js', "String(row.line_id || '').trim() === BANQUET_SERVICE_LINE_ID")
        && htmlContains('routes/lines.js', '!isLegacyRoomTimelineLineRow(row)')
        && bookingsRouteCode.includes('function isBanquetServiceRootBooking')
        && bookingsRouteCode.includes('function isBanquetServiceTimelineBooking')
        && bookingsRouteCode.includes('function isRoomProjectableBanquetServiceRootBooking')
        && bookingsRouteCode.includes('function buildBookingTimelineProjection')
        && bookingsRouteCode.includes("hiddenReason = 'banquet_service_hidden_from_animator'")
        && bookingsRouteCode.includes('return bookings.map(booking => projectBookingForTimelineView(booking, timelineView))')
        && bookingsRouteCode.includes('.filter(booking => !isBanquetServiceRootBooking(booking) || isRoomProjectableBanquetServiceRootBooking(booking))')
        && htmlContains('js/timeline.js', 'function shouldRenderBookingVisualLink')
        && htmlContains('js/timeline.js', 'relationType === SHARED_ROOM_LINK_RELATION_TYPE && !isRoomTimelineView()')
        && bookingCode.includes("ROOM_FIRST_BANQUET_SERVICE_LINE_ID = 'banquet-service'")
        && bookingCode.includes('function populatePrimaryAnimatorSelect')
        && bookingCode.includes('openAnimationBookingInAnimatorView')
        && bookingCode.includes('openRoomBookingAnimationBridge'));
    check('Timeline regular line headers render title-only resource names',
        htmlContains('js/timeline.js', 'line-header line-header--title-only')
        && htmlContains('js/timeline.js', '<span class="line-name">${escapeHtml(line.name)}</span>')
        && !htmlContains('js/timeline.js', 'getLineSubtitle(lineForHeader)')
        && htmlContains('css/timeline.css', '.line-header--title-only .line-name'));
    check('Timeline room preview state only top-aligns headers with a rendered preview card',
        htmlContains('js/timeline.js', 'function clearTimelineBanquetRoomHeaderPreviewState(header)')
        && htmlContains('js/timeline.js', 'return false;')
        && htmlContains('js/timeline.js', 'return true;')
        && htmlContains('js/timeline.js', 'const rendered = renderTimelineBanquetRoomCard(header, TIMELINE_BANQUET_ROOM_PREVIEWS.get(key));')
        && htmlContains('js/timeline.js', 'if (rendered) {')
        && htmlContains('js/timeline.js', "header.classList.add('has-timeline-banquet-room-preview')")
        && htmlContains('js/timeline.js', 'clearTimelineBanquetRoomHeaderPreviewState(header);')
        && htmlContains('css/timeline.css', '.line-header.has-timeline-banquet-room-preview'));
    check('Animator timeline filters banquet service pseudo-lines and kitchen blocks',
        htmlContains('js/timeline.js', "TIMELINE_BANQUET_SERVICE_LINE_ID = 'banquet-service'")
        && htmlContains('js/timeline.js', 'function isParkAnimatorTimelineView')
        && htmlContains('js/timeline.js', 'function isTimelineBanquetServicePseudoLine')
        && htmlContains('js/timeline.js', 'function isTimelineBanquetServiceBooking')
        && htmlContains('js/timeline-resource-identity.js', 'function timelineCanonicalProjectionForCurrentView')
        && htmlContains('js/timeline-resource-identity.js', 'function timelineBookingRenderHiddenReason')
        && htmlContains('js/timeline.js', '.filter(line => !isTimelineBanquetServicePseudoLine(line) && !isTimelineRoomOnlyLine(line))')
        && htmlContains('js/timeline.js', '.filter(booking => !booking.timelineRenderHiddenReason)')
        && htmlContains('routes/bookings.js', 'function isBanquetServiceTimelineBooking')
        && htmlContains('routes/bookings.js', 'function buildBookingTimelineProjection')
        && htmlContains('routes/bookings.js', "hiddenReason = 'banquet_service_hidden_from_animator'"));
    check('Timeline product sales modal exists', !!doc.getElementById('productSalesModal'));
    check('Deprecated room load popover is removed from timeline toolbar',
        !doc.getElementById('roomLoadBtn')
        && !doc.getElementById('roomLoadPanel')
        && !htmlContains('js/app.js', 'initRoomLoadPanel')
        && !htmlContains('js/timeline.js', 'function roomLoadBookingMinutes')
        && !htmlContains('js/timeline.js', 'updateRoomLoadPanel')
        && !htmlContains('css/features.css', '.room-load-panel'));
    check('Timeline product sales month filter exists', doc.getElementById('productSalesMonth')?.type === 'month');
    check('Timeline product sales category and program filters exist', !!doc.getElementById('productSalesCategory') && !!doc.getElementById('productSalesProgram'));
    check('Timeline product sales export buttons exist', !!doc.getElementById('productSalesXlsxBtn') && !!doc.getElementById('productSalesCsvBtn'));
    check('Timeline product sales button is a modal trigger', doc.getElementById('productSalesBtn')?.textContent.includes('📊'));
    const timelineActionMenu = doc.getElementById('dropdownContent');
    check('Timeline action menu is contextual and does not duplicate sidebar navigation',
        doc.getElementById('adminDropdown')?.dataset.menuScope === 'timeline-actions'
        && doc.getElementById('menuToggleBtn')?.textContent.includes('Дії')
        && doc.querySelector('.v32-controls #adminDropdown #menuToggleBtn')
        && doc.getElementById('menuToggleBtn')?.querySelector('.timeline-control-icon--dots')
        && !!doc.getElementById('historyBtn')
        && !!doc.getElementById('digestBtn')
        && !!doc.getElementById('exportPdfBtn')
        && timelineActionMenu?.querySelector('#digestBtn')
        && timelineActionMenu?.querySelector('#exportPdfBtn')
        && !doc.getElementById('afishaBtn')
        && !doc.getElementById('dashboardBtn')
        && !doc.getElementById('settingsBtn')
        && !doc.getElementById('certificatesBtn')
        && !timelineActionMenu?.querySelector('a[href="/programs"]')
        && !timelineActionMenu?.querySelector('a[href="/tasks"]'));
    check('Timeline print action is restored through existing print flow',
        doc.getElementById('exportPdfBtn')?.textContent.includes('Друк розкладу')
        && doc.getElementById('exportPdfBtn')?.getAttribute('role') === 'menuitem'
        && htmlContains('js/app.js', "document.getElementById('exportPdfBtn')")
        && htmlContains('js/app.js', 'exportTimelinePdf')
        && htmlContains('js/ui.js', 'function exportTimelinePdf')
        && htmlContains('js/ui.js', 'window.print()')
        && htmlContains('js/ui.js', 'printing-timeline')
        && htmlContains('css/timeline.css', '@media print'));
    check('Timeline day digest uses structured backend errors and actionable UI messages',
        htmlContains('js/settings.js', 'function dailyDigestFailureMessage')
        && htmlContains('js/settings.js', "code === 'NO_CHAT_ID'")
        && htmlContains('js/settings.js', "code === 'NO_BOT_TOKEN'")
        && htmlContains('js/settings.js', "code === 'TELEGRAM_SEND_FAILED'")
        && htmlContains('js/settings.js', 'readDailyDigestResponse(response)')
        && htmlContains('services/scheduler.js', 'function buildDigestSendResult')
        && htmlContains('services/scheduler.js', "code: 'NO_BOT_TOKEN'")
        && htmlContains('services/scheduler.js', "reason: 'telegram_send_failed'")
        && htmlContains('routes/telegram.js', "code: 'DIGEST_INTERNAL_ERROR'"));
    check('Timeline history opens as a primary toolbar action with shared history styling',
        doc.querySelector('.v32-controls > #historyBtn.btn-history')
        && !timelineActionMenu?.querySelector('#historyBtn')
        && modalsCss.includes('.action-history-row')
        && modalsCss.includes('.action-history-modal')
        && htmlContains('js/settings.js', 'ActionHistoryView.renderList(items'));
    check('Timeline product sales modal omits payment/debt fields', !doc.getElementById('productSalesModal')?.textContent.includes('Оплачено') && !doc.getElementById('productSalesModal')?.textContent.includes('Борг'));
    check('Timeline product sales export buttons are styled as buttons', doc.getElementById('productSalesXlsxBtn')?.classList.contains('product-sales-export-btn') && doc.getElementById('productSalesCsvBtn')?.classList.contains('product-sales-export-btn'));
    check('Timeline product sales button has readable light text color', productSalesBtnRule.includes('color: var(--gray-800'));
    check('Timeline product sales button has readable dark text color', darkProductSalesBtnRule.includes('color: var(--text-primary'));
    check('CRM modals disable sweep/shine window motion', modalsCss.includes('v0.59.9: CRM window motion kill switch') && modalsCss.includes('.modal-content::after') && modalsCss.includes('content: none !important') && modalsCss.includes('animation: none !important'));
    check('Confirm modals stay singleton and motion-free', modalsCss.includes('v0.59.12: confirm dialogs are singleton') && modalsCss.includes('.confirm-overlay[data-confirm-kind="confirm"]') && modalsCss.includes('transform: none !important'));
    check('Product sales title opts out of sticky modal header block', modalsCss.includes('.product-sales-head h3') && modalsCss.includes('position: static !important') && modalsCss.includes('background: transparent !important'));
    check('Certificate modals use dedicated close buttons for mobile Safari', doc.querySelector('#certificateModal [data-cert-modal-close="certificateModal"]')?.tagName === 'BUTTON' && doc.querySelector('#certDetailModal [data-cert-modal-close="certDetailModal"]')?.tagName === 'BUTTON' && doc.querySelector('#batchCertModal [data-cert-modal-close="batchCertModal"]')?.tagName === 'BUTTON');
    check('Timeline edit animator modal uses CRM-styled controls without color picker',
        doc.querySelector('#editLineModal .timeline-line-editor-modal')
        && doc.querySelector('#editLineModal #editLineNameSelect')
        && doc.querySelector('#editLineModal #editLineName')
        && doc.querySelector('#editLineModal #editLineColor[type="hidden"]')
        && !doc.querySelector('#editLineModal input[type="color"]')
        && modalsCss.includes('.timeline-line-editor-modal')
        && modalsCss.includes('.timeline-line-editor-actions')
        && modalsCss.includes('.form-group select')
        && modalsCss.includes('appearance: none')
        && modalsCss.includes('#editLineModal .timeline-line-editor-form select')
        && modalsCss.includes('color-scheme: dark')
        && modalsCss.includes('#editLineModal .timeline-line-editor-form select:focus'));
    check('Legacy certificate batch quantity picker hides radio without display none and keeps focus ring', !!doc.querySelector('input[name="batchQty"]') && !legacyBatchInputRule.includes('display: none') && legacyBatchInputRule.includes('opacity: 0') && legacyBatchInputRule.includes('clip-path: inset(50%)') && featuresCss.includes('.batch-qty-option:has(input:focus-visible)') && featuresCss.includes('.batch-qty-option:has(input:checked)') && featuresCss.includes('body.dark-mode .batch-qty-option:has(input:checked)'));
    check('Booking pinata mode selector exists', !!doc.getElementById('pinataMode'));
    const pinataModeOptions = Array.from(doc.getElementById('pinataMode')?.querySelectorAll('option') || []).map(option => option.value);
    check('Booking pinata mode selector omits no-pinata option', !pinataModeOptions.includes('none') && pinataModeOptions.includes('park') && pinataModeOptions.includes('client'));
    check('Booking pinata visual pickers exist for design and filler', !!doc.getElementById('pinataDesignPickerList') && !!doc.getElementById('pinataFillerPickerList') && !!doc.getElementById('pinataDesignPickerStatus') && !!doc.getElementById('pinataFillerPickerStatus'));
    check('Booking client pinata service fields exist', !!doc.getElementById('clientPinataServiceFields') && !!doc.getElementById('clientPinataServicePrice'));
    check('Park pinata filler supports client-owned filler without legacy client-pinata token', html.includes('value="client_filler"') && html.includes('Свій наповнювач клієнта') && !html.includes('value="Клієнта"'));
    check('Booking multi-activity selection surface exists', !!doc.getElementById('selectedActivitiesList') && html.includes('program-details--summary'));
    check('Booking multi-activity frontend keeps separate activity payloads', bookingCode.includes('selectedActivityProgramIds') && bookingCode.includes('function bookingMultiActivityEnabled') && bookingCode.includes('function buildMultiActivityBookings') && bookingCode.includes('apiCreateBookingFull(booking, linked, { banquetActivities })') && bookingCode.includes('additionalMultiHostActivity') && bookingCode.includes('multiActivity'));
    check('Booking reset clears multi-activity state', bookingFormCode.includes('setSelectedActivityPrograms([], { renderSummary: false, renderPackage: false, markDirty: false })') && bookingFormCode.includes("classList.remove('selected', 'is-primary-activity')"));
    check('Booking API submits banquetActivities through full create', apiCode.includes('options.banquetActivities') && apiCode.includes('payload.banquetActivities'));
    check('Room booking animation bridge defers banquet group creation until save',
        !bookingCode.includes('findOrCreateBanquetGroupForSourceBooking')
        && bookingCode.includes('BookingDrawerState.roomBookingAnimationBridge')
        && /apiGetBanquetByBooking\(sourceBooking\.id\)[\s\S]*BookingDrawerState\.roomBookingAnimationBridge/.test(bookingCode.slice(bookingCode.indexOf('async function openRoomBookingAnimationBridge'), bookingCode.indexOf('// v43.5.0: Reveal a booking')))
        && !bookingCode.slice(bookingCode.indexOf('async function openRoomBookingAnimationBridge'), bookingCode.indexOf('// v43.5.0: Reveal a booking')).includes('apiCreateBanquetGroup')
        && !bookingCode.slice(bookingCode.indexOf('async function handleBookingRoomSelectionContextChange'), bookingCode.indexOf('function clearRoomSelectionBanquetContextAfterCustomerChange')).includes('apiCreateBanquetGroup')
        && !bookingCode.slice(bookingCode.indexOf('function renderBookingBanquetGroupSelector'), bookingCode.indexOf('async function refreshBookingBanquetGroupCandidates')).includes('apiCreateBanquetGroup')
        && bookingCode.includes("createPath.kind === 'source_kitchen_to_activity'")
        && bookingCode.includes("createPath.kind === 'source_activity_to_kitchen'")
        && bookingCode.includes('apiCreateBanquetActivityBooking(bridgeGroupId')
        && bookingCode.includes("!String(booking.linkedTo || '').trim()")
        && !/function canAddAnimationFromRoomBooking[\s\S]*!booking\.programId[\s\S]*function banquetGroupIdFromSnapshot/.test(bookingCode)
        && apiCode.includes('function apiGetBanquetByBooking')
        && apiCode.includes('function apiCreateBanquetGroup')
        && apiCode.includes('function apiCreateBanquetActivityBooking')
        && apiCode.includes('/activity-booking')
        && bookingsRouteCode.includes('BANQUET_GROUP_ACTIVITY_REQUIRES_ATOMIC_ENDPOINT'));
    check('Products API requests effective prices by timeline date', apiCode.includes("params.set('priceDate'") && productPricingCode.includes('function buildProductPriceJoin') && productPricingCode.includes('effective_from <= ${queryDate}') && productPricingCode.includes('nextPriceFrom'));
    check('Booking full route persists activity bookings as banquet-linked root blocks', bookingsRouteCode.includes('const banquetActivities = Array.isArray(req.body?.banquetActivities)') && bookingsRouteCode.includes('const activityRows = []') && bookingsRouteCode.includes('excludeIds: [main.id]') && bookingsRouteCode.includes('upsertBanquetLink(client, businessContext, main.id, activity.id') && bookingsRouteCode.includes('activityBookings: responseActivityBookings') && bookingsRouteCode.includes('banquetLinks: mapBookingVisualLinkRowsForResponse(banquetLinkRows, main.id)') && bookingsRouteCode.includes('sharedRoomLinks: mapBookingVisualLinkRowsForResponse(') && bookingsRouteCode.includes('Finance auto-record (create/full activity)'));
    check('Booking save pins effective product prices server-side', bookingsRouteCode.includes('applyEffectiveBookingPrice') && bookingsRouteCode.includes('refreshMultiActivityPriceTotals') && productPricingCode.includes('extra.priceSnapshot') && productPricingCode.includes('priceDate'));
    check('Booking multi-activity cards have price and selected-list styling',
        panelCss.includes('.program-price-badge')
        && panelCss.includes('.program-next-price-badge')
        && panelCss.includes('.selected-activity-item')
        && panelCss.includes('.selected-activity-remove')
        && darkModeCss.includes('body.dark-mode .selected-activity-item')
        && darkModeCss.includes('html[data-theme="dark"] .selected-activity-item')
        && darkModeCss.includes('body.dark-mode .selected-activity-main strong')
        && darkModeCss.includes('body.dark-mode .selected-activity-meta')
        && darkModeCss.includes('body.dark-mode .selected-activity-remove'));
    const loginDisplayLabel = String(pkg.eventGenix.releaseLabel || '').replace(/^CRM\s+\d+(?:\.\d+)?\s*:\s*/i, '');
    check('login release badge shows package version once', doc.querySelector('.login-release-badge')?.textContent.trim() === `✨ ${pkg.version}`);
    check('login release badge does not duplicate release label', !doc.querySelector('.login-release-badge')?.textContent.includes(pkg.eventGenix.releaseLabel));
    check('login tagline uses clean release title without CRM marker duplication', doc.querySelector('.tagline')?.textContent === `AI First CRM v${pkg.version} — ${loginDisplayLabel}`);
    check('login changelog button keeps one version marker', doc.getElementById('changelogBtn')?.textContent.trim() === `Що нового у v${pkg.version}`);
    check('login form supports smart paste for copied credential blocks', appCode.includes('parseLoginCredentialBlock') && appCode.includes('bindSmartCredentialPaste') && appCode.includes("clipboardData?.getData('text')"));
    const recentChangelogOrder = ['v0.55.45','v0.55.44','v0.55.43','v0.55.42','v0.55.41','v0.55.40','v0.55.39','v0.55.38','v0.55.37','v0.55.36','v0.55.35','v0.55.34','v0.55.33','v0.55.32','v0.55.31','v0.55.30','v0.55.29','v0.55.28','v0.55.27','v0.55.26','v0.55.25','v0.55.24','v0.55.23','v0.55.22','v0.55.21','v0.55.20','v0.55.19','v0.55.18','v0.55.17','v0.55.16','v0.55.15','v0.55.14','v0.55.13','v0.55.12','v0.55.11','v0.55.10','v0.55.9','v0.55.8'];
    const recentChangelogPositions = recentChangelogOrder.map(version => html.indexOf(`<h4>${version}`));
    check('changelog modal does not jump from latest v0.55 release straight to v0.55.8', recentChangelogPositions.every(pos => pos >= 0) && recentChangelogPositions.every((pos, index, list) => index === 0 || pos > list[index - 1]));
    const recent058ChangelogOrder = ['v0.58.13','v0.58.12','v0.58.11','v0.58.10','v0.58.9','v0.58.8','v0.58.7','v0.58.6','v0.58.5','v0.58.4','v0.58.3','v0.58.2','v0.58.1','v0.58.0'];
    const recent058ChangelogPositions = recent058ChangelogOrder.map(version => html.indexOf(`<h4>${version} `));
    check('changelog modal keeps the full v0.58 release history without gaps', recent058ChangelogPositions.every(pos => pos >= 0) && recent058ChangelogPositions.every((pos, index, list) => index === 0 || pos > list[index - 1]));
const recent060ChangelogOrder = ['v0.60.8','v0.60.7','v0.60.6','v0.60.5','v0.60.4','v0.60.3','v0.60.2','v0.60.1','v0.60.0'];
    const recent060ChangelogPositions = recent060ChangelogOrder.map(version => html.indexOf(`<h4>${version} `));
    check('changelog modal keeps the full v0.60 release history without gaps', recent060ChangelogPositions.every(pos => pos >= 0) && recent060ChangelogPositions.every((pos, index, list) => index === 0 || pos > list[index - 1]));
});

checkPage('dashboard.html', (doc, html) => {
    check('loginForm exists', !!doc.getElementById('loginForm'));
    check('mainApp exists', !!doc.getElementById('mainApp'));
    check('dashboardGrid exists', !!doc.getElementById('dashboardGrid'));
    check('dashboard omits giant work queue panel from main flow', !doc.getElementById('workQueuePanel') && !doc.getElementById('workQueueBody'));
    check('dashboard owns the only compact role preview trigger', !!doc.getElementById('dashboardRolePreviewButton') && !!doc.getElementById('dashboardRolePreviewMenu') && !doc.getElementById('dashboardRolePreviewSelect'));
    check('dashboard login tagline matches package version', html.includes(`AI First CRM v${pkg.version}`));
    check('dashboard changelog button matches package version', html.includes(`Що нового у v${pkg.version}`));
});

checkPage('designs.html', (doc, html) => {
    const designsPageCode = fs.readFileSync(path.join(ROOT, 'js', 'designs-page.js'), 'utf8');
    const catalogCss = fs.readFileSync(path.join(ROOT, 'css', 'catalog.css'), 'utf8');
    check('5 tabs exist', doc.querySelectorAll('[data-tab]').length === 5);
    check('tabCatalogs exists', !!doc.getElementById('tabCatalogs'));
    check('catalogViewer exists', !!doc.getElementById('catalogViewer'));
    check('catalogList exists', !!doc.getElementById('catalogList'));
    check('No misplaced <script> in function', !html.match(/w\.document\.write[\s\S]*?<script>/));
    check('Graduation catalog viewer keeps shell sidebar visible', designsPageCode.includes('catalog-graduation-viewer-open') && catalogCss.includes('body.catalog-graduation-viewer-open .sidebar-nav') && catalogCss.includes('body.catalog-graduation-viewer-open .catalog-viewer'));
    check('Graduation catalog canvas is left-aligned inside CRM workspace', catalogCss.includes('body.catalog-graduation-viewer-open .catalog-pages-container') && catalogCss.includes('justify-content: flex-start') && catalogCss.includes('body.catalog-graduation-viewer-open .cat-page') && catalogCss.includes('margin: 0;'));
});

checkPage('art-director.html', (doc, html) => {
    const pagesCss = cssTextWithImports('css/pages.css');
    const sidebarCode = fs.readFileSync(path.join(ROOT, 'js', 'components', 'sidebar.js'), 'utf8');
    const artCode = fs.readFileSync(path.join(ROOT, 'js', 'art-director-page.js'), 'utf8');
    const hrHtml = fs.readFileSync(path.join(ROOT, 'hr.html'), 'utf8');
    const hrSurface = `${hrHtml}\n${fileText('css/hr-page.css')}`;
    const hrCode = fs.readFileSync(path.join(ROOT, 'js', 'hr-page.js'), 'utf8');
    const hrRouteCode = fs.readFileSync(path.join(ROOT, 'routes', 'hr.js'), 'utf8');
    const warehouseHtml = fs.readFileSync(path.join(ROOT, 'warehouse.html'), 'utf8');
    const warehouseCode = fs.readFileSync(path.join(ROOT, 'js', 'warehouse-page.js'), 'utf8');
    const warehouseRouteCode = fs.readFileSync(path.join(ROOT, 'routes', 'warehouse.js'), 'utf8');
    check('tabs exist', doc.querySelectorAll('.artdir-tab').length > 0);
    check('sidebar exists', !!doc.getElementById('sidebarNav'));
    check('Art page uses modern standalone shell class', doc.getElementById('main-content')?.classList.contains('art-shell'));
    check('Art page has page hero instead of bare legacy H1', !!doc.getElementById('artPageTitle') && !!doc.querySelector('.art-page-hero .page-kicker'));
    check('Art tabs are accessible tablist controls', doc.getElementById('artdirTabs')?.getAttribute('role') === 'tablist' && doc.querySelector('.artdir-tab[aria-selected="true"]')?.dataset.tab === 'overview');
    check('Art iframe tabs keep only remaining embedded source contracts', !html.includes('/programs?embedded=1') && !html.includes('data-tab="programs"') && html.includes('/designs?embedded=1') && html.includes('/graduation?embedded=1'));
    check('Art shell removes centered slab wrapper at CSS level', pagesCss.includes('.page-container.art-shell') && pagesCss.includes('.art-shell .artdir-page') && pagesCss.includes('max-width: none') && pagesCss.includes('margin: 0;'));
    check('Art shell has tablet and mobile breakpoint guards', pagesCss.includes('@media (max-width: 1023px)') && pagesCss.includes('@media (max-width: 560px)') && pagesCss.includes('.art-page-actions > *'));
    check('Sidebar art label is normalized', sidebarCode.includes("href: '/art'") && sidebarCode.includes("label: 'Арт'") && !sidebarCode.includes("label: 'Арт директор'"));
    check('Art director content due date exists', doc.getElementById('contentDueDate')?.type === 'date');
    check('Art director content modal uses shrink-safe grid', html.includes('grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:10px'));
    check('Art director modal controls are bounded', html.includes('id="contentDueDate" style="width:100%; min-width:0; max-width:100%;'));
    check('Art keeps costumes only as a hidden legacy inspection surface', doc.getElementById('art-tab-costumes')?.dataset.legacyTab === 'costumes' && doc.getElementById('art-tab-costumes')?.classList.contains('artdir-tab--legacy-hidden') && doc.getElementById('tab-costumes')?.dataset.legacySurface === 'costumes' && artCode.includes("if (tabName === 'costumes') loadCostumes();") && artCode.includes("apiGet('/costumes')") && artCode.includes("apiPost('/costumes'"));
    check('Costume module is Warehouse-owned without Art redirect', warehouseHtml.includes('id="costumesTab"') && warehouseHtml.includes('id="warehouseCostumesList"') && warehouseHtml.includes('data-page-tab="costumes"') && warehouseCode.includes('loadWarehouseCostumes') && warehouseCode.includes('apiGetWarehouseCostumes') && warehouseCode.includes('apiCreateWarehouseCostume') && warehouseRouteCode.includes("router.get('/costumes'") && warehouseRouteCode.includes("router.post('/costumes'") && !warehouseCode.includes("window.location.href = '/art?tab=costumes'"));
    check('HR no longer exposes costumes as a visible owned tab', !hrHtml.includes('data-tab="costumes"') && !hrHtml.includes('id="tab-costumes"') && !hrHtml.includes('id="btnAddCostume"') && !hrHtml.includes('id="costumesList"'));
    check('Old HR costume deep link hands off to Warehouse costume entry', hrCode.includes("target === 'costumes'") && hrCode.includes("window.location.replace('/warehouse#costumes')") && !hrCode.includes('costumes: loadCostumes') && !hrCode.includes('window.showAddCostume'));
    check('HR vacancy candidate intake supports resume text and file upload', hrCode.includes('candidateResumeFiles') && hrCode.includes('raw_application_text') && hrCode.includes('/resume-files') && hrCode.includes('downloadResumeFile') && hrCode.includes('candidateResumeBadgeHtml') && hrSurface.includes('candidate-upload-card'));
    check('HR structure renders editable org chart nodes without crown markup', hrHtml.includes('id="companyOrgChart"') && hrHtml.includes('hrOrgEditSelectedBtn') && !hrHtml.includes('hr-org-crown') && !hrHtml.includes('♛'));
    check('HR structure frontend persists editable node model', hrCode.includes('DEFAULT_COMPANY_STRUCTURE_NODES') && hrCode.includes('openCompanyOrgNodeEditor') && hrCode.includes('nodes: normalizeCompanyStructureNodes(companyStructureNodes)') && hrCode.includes('schemaVersion: 1'));
    check('HR structure role editor ignores backdrop misclicks and uses guarded explicit close', hrCode.includes('function requestCloseCompanyOrgNodeEditor') && hrCode.includes('nudgeCompanyOrgNodeEditor(overlay)') && !hrCode.includes('if (event.target === overlay) closeCompanyOrgNodeEditor();') && hrCode.includes('UnsafeDismissGuard.attemptCloseEditableSurface(overlay') && fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8').includes('tests/hr-org-node-modal-dismiss.test.js'));
check('HR structure supports movable nodes and direct port connector lines', hrCode.includes('DEFAULT_COMPANY_STRUCTURE_POSITIONS') && hrCode.includes('startCompanyOrgDrag') && hrCode.includes('renderCompanyOrgLinks') && hrCode.includes('handleCompanyOrgPortClick') && hrHtml.includes('id="hrOrgAutoLayoutBtn"') && !hrHtml.includes('id="hrOrgRelinkSelectedBtn"') && !hrHtml.includes('id="hrOrgLineToolBtn"') && hrCode.includes('data-org-link-parent-port') && hrCode.includes('data-org-link-child-port') && hrCode.includes('hr-org-link-preview') && hrCode.includes('snapCompanyOrgCoord') && hrCode.includes('class="hr-org-link-layer"') && hrCode.includes('inferCompanyOrgAutoLayoutParents') && hrCode.includes('primaryCompanyOrgRoot') && !hrCode.includes('companyOrgFocusedLinkSet'));
check('HR structure canvas uses visible grid workspace and richer node editor', hrSurface.includes('--hr-org-grid-cell: 120px') && hrSurface.includes('.hr-org-node-editor-summary') && hrCode.includes('name="x"') && hrCode.includes('name="y"') && hrCode.includes('autoArrangeTreeCompanyOrgNodes') && hrCode.includes('resolveCompanyOrgNodeOverlaps'));
check('HR structure keeps the org chart compact enough for one desktop screen', hrCode.includes('const ORG_CANVAS_MIN_WIDTH = 1180') && hrCode.includes('const ORG_NODE_WIDTH = 142') && hrCode.includes('const ORG_ONE_SCREEN_MAX_HEIGHT = 760') && hrCode.includes('function compactCompanyOrgNodesForOneScreen') && hrCode.includes('companyOrgNeedsOneScreenLayout(normalized)') && hrCode.includes('companyStructureNodes = compactCompanyOrgNodesForOneScreen(structure.nodes)') && hrSurface.includes('grid-template-columns: minmax(0, 1fr);') && hrSurface.includes('height: clamp(560px, calc(100dvh - 285px), 760px)') && hrSurface.includes('.hr-org-node-description') && hrSurface.includes('display: none;') && hrSurface.includes('.hr-org-detail-edit {') && hrSurface.includes('grid-column: 2;'));
check('HR structure route sanitizes structured node payloads', hrRouteCode.includes('sanitizeCompanyStructureNodes') && hrRouteCode.includes('COMPANY_STRUCTURE_ALLOWED_TONES') && hrRouteCode.includes('schemaVersion: COMPANY_STRUCTURE_SCHEMA_VERSION') && hrRouteCode.includes('source.x') && hrRouteCode.includes('source.y'));
    check('HR structure no longer leaks legacy animator shift summary below tabs', !hrHtml.includes('shiftsSummarySection') && !hrHtml.includes('loadShiftsSummary') && !hrHtml.includes('shiftsSummaryContainer') && hrCode.includes('function removeLegacyAnimatorShiftSummary') && hrCode.includes('removeLegacyAnimatorShiftSummary();'));
    check('HR resume uploads use authenticated Postgres-linked route storage', hrRouteCode.includes('multer.memoryStorage()') && hrRouteCode.includes('job_application_resume_files') && hrRouteCode.includes("router.post('/applications/:id/resume-files'") && hrRouteCode.includes("router.get('/applications/:id/resume-files/:fileId/download'"));
});

checkPage('center.html', (doc, html) => {
    const centerPageCode = fs.readFileSync(path.join(ROOT, 'js', 'center-page.js'), 'utf8');
    const bookingSummaryPageCode = fs.readFileSync(path.join(ROOT, 'js', 'booking-summary-page.js'), 'utf8');
    const centerCss = cssTextWithImports('css/pages.css');
    const bookingSummaryHardcode = /(500грн|500 грн|100грн|100 грн|3 доби|5 діб)/;
    check('tabs exist', doc.querySelectorAll('.center-tab-btn').length > 0);
    check('sidebar exists', !!doc.getElementById('sidebarNav'));
    check('Control Center has modern truth header', !!doc.querySelector('.center-hero') && !!doc.getElementById('centerTruthStrip') && !!doc.getElementById('centerFreshness'));
    check('Control Center tabs expose ARIA state', [...doc.querySelectorAll('.center-tab-btn')].every(btn => btn.getAttribute('role') === 'tab' && btn.hasAttribute('aria-selected')));
    check('Center exposes banquet terms price rules as a first-class price block',
        centerPageCode.includes('const BANQUET_TERMS_PRICE_RULES')
        && centerPageCode.includes("code: 'banquet_own_cake_fee'")
        && centerPageCode.includes("code: 'banquet_cork_fee'")
        && centerPageCode.includes("code: 'banquet_menu_correction_deadline_days'")
        && centerPageCode.includes("code: 'banquet_date_change_deadline_days'")
        && centerPageCode.includes('function renderBanquetTermsPriceBlock')
        && centerPageCode.includes('Умови банкету')
        && centerPageCode.includes('Плата за свій торт')
        && centerPageCode.includes('Cork Fee')
        && centerPageCode.includes('Меню можна коригувати за')
        && centerPageCode.includes('Дату можна змінити за')
        && centerPageCode.includes('Не знайдено правила')
        && centerPageCode.includes('confirmPriceChange(this)')
        && centerPageCode.includes('apiUpdatePrice(code')
        && html.includes('css/pages.css')
        && centerCss.includes('.banquet-terms-price-panel')
        && centerCss.includes('.banquet-terms-price-row')
        && centerCss.includes('.banquet-terms-price-grid')
        && !bookingSummaryHardcode.test(bookingSummaryPageCode));
});

checkPage('copilot.html', (doc) => {
    const copilotCss = fs.readFileSync(path.join(ROOT, 'css', 'copilot.css'), 'utf8');
    const copilotPageCode = fs.readFileSync(path.join(ROOT, 'js', 'copilot-page.js'), 'utf8');
    check('copilotApp exists', !!doc.getElementById('copilotApp'));
    check('nav items exist', doc.querySelectorAll('.copilot-nav-item').length > 0);
    check('Copilot form rows use shrink-safe grid', copilotCss.includes('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)'));
    check('Copilot form controls are bounded inside grid rows', copilotCss.includes('.form-row .copilot-input'));
    check('Copilot new case uses CRM prompt modal without native fallback', copilotPageCode.includes("await promptModal('Назва кейсу:'") && !copilotPageCode.includes('window.prompt'));
    check('Copilot follow-up copy is localized for visible CRM operators', copilotPageCode.includes('Дата дотиску') && copilotPageCode.includes('Дотиск після мовчання') && copilotPageCode.includes('Дотиск виконано') && !copilotPageCode.includes('Follow-up дата') && !copilotPageCode.includes('Follow-up виконано') && !copilotPageCode.includes('follow-up через 3 дні'));
});

checkPage('designer.html', (doc) => {
    check('5 tabs exist', doc.querySelectorAll('.designer-tab').length === 5);
    check('sidebar exists', !!doc.getElementById('sidebarNav'));
});

checkPage('guardian-ops.html', (doc, html) => {
    check('Guardian ops title exists', !!doc.getElementById('guardianOpsTitle'));
    check('Guardian ops status live region exists', doc.getElementById('guardianOpsStatus')?.getAttribute('aria-live') === 'polite');
    check('Guardian ops refresh button exists', !!doc.getElementById('guardianOpsRefreshBtn'));
    check('Guardian outbox list exists', !!doc.getElementById('guardianOutboxList'));
    check('Guardian event queue list exists', !!doc.getElementById('guardianEventQueueList'));
    check('Guardian dead-letter list exists', !!doc.getElementById('guardianDeadLetterList'));
    check('Guardian repair user input exists', !!doc.getElementById('guardianRepairUserId'));
    check('Guardian repair result region exists', !!doc.getElementById('guardianRepairResult'));
    check('Guardian active mutes list exists', !!doc.getElementById('guardianMutesList'));
    check('Guardian ops script included', html.includes('js/guardian-ops-page.js'));
});

checkPage('customers.html', (doc, html) => {
    const customerPageCode = fileText('js/customers-page.js');
    const customerCss = cssTextWithImports('css/pages.css');
    const customerHeroRule = cssRuleText(customerCss, '.customer-detail-hero');
    const customerHeroIdentityRule = cssRuleText(customerCss, '.customer-hero-identity');
    const customerHeroActionsRule = cssRuleText(customerCss, '.customer-hero-actions');
    const customerHeroDangerRule = cssRuleText(customerCss, '.customer-hero-danger-group');
    const customerHeroActionButtonRule = cssRuleText(customerCss, '.customer-hero-actions .entity-card-action');
    const customerChildFactsRule = cssRuleText(customerCss, '.customer-child-facts');
    const customerChildFactValueRule = cssRuleText(customerCss, '.customer-child-facts dd');
    const customerChildNoteRule = cssRuleText(customerCss, '.customer-child-note');
    const darkCustomerChildNoteRule = cssRuleIncludingSelectorText(customerCss, 'body.dark-mode .customer-child-note');
    const customerEditModalHtml = doc.getElementById('customerEditModal')?.outerHTML || '';
    const schedulerCode = fileText('services/scheduler.js');
    const eventBusCode = fileText('services/eventBus.js');
    const telegramRouteCode = fileText('routes/telegram.js');
    const customerRouteCode = fileText('routes/customers.js');
    const npsStatsStart = customerRouteCode.indexOf("router.get('/nps-stats'");
    const npsStatsEnd = customerRouteCode.indexOf('// ==========================================', npsStatsStart + 1);
    const npsStatsRouteBlock = customerRouteCode.slice(npsStatsStart, npsStatsEnd > npsStatsStart ? npsStatsEnd : undefined);
    const tagFilterOptions = [...doc.querySelectorAll('#tagFilter option')];
    const tagManagementBlock = customerPageCode.slice(
        customerPageCode.indexOf('// v30.4: TAG MANAGEMENT'),
        customerPageCode.indexOf('// v30.4: DUPLICATES')
    );
    check('Customer edit modal exists', !!doc.getElementById('customerEditModal'));
    check('Customer edit modal exposes dynamic children list', !!doc.getElementById('editChildrenSection') && !!doc.getElementById('editChildrenList') && !!doc.getElementById('editAddChildBtn'));
    check('Customer explainability region exists', !!doc.getElementById('customerExplainability'));
    check('Customer edit modal uses shrink-safe grid', html.includes('grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px'));
    check('Customer children editor renders birthday age and note fields', customerPageCode.includes('data-child-field="birthday"') && customerPageCode.includes('data-child-field="ageSnapshot"') && customerPageCode.includes('data-child-field="note"') && customerPageCode.includes('type="date" id="editChildBirthday${index}"'));
    check('Customer edit children participate in dirty state and save payload', customerPageCode.includes('editingChildren: []') && customerPageCode.includes('customerChildrenStateSignature()') && customerPageCode.includes('setCustomerEditingChildren(maysternyaMode ? [] : customerChildrenForEdit') && customerPageCode.includes('children: children.map'));
    check('Customer detail card uses dedicated children section', customerPageCode.includes('function renderCustomerChildrenSection') && customerPageCode.includes('class="detail-section customer-children-section"') && customerPageCode.includes('class="customer-child-facts"') && customerPageCode.includes('customerChildAgeDisplay') && !customerPageCode.includes("<div class=\"field-label\">Ім'я дитини</div>") && !customerPageCode.includes('<div class="field-label">ДН дитини</div>'));
    check('Customer children section is list-based and text-safe', customerPageCode.includes('role="list"') && customerPageCode.includes('role="listitem"') && customerChildFactsRule.includes('grid-template-columns') && customerChildFactValueRule.includes('overflow-wrap: anywhere') && customerChildNoteRule.includes('overflow-wrap: anywhere') && darkCustomerChildNoteRule.includes('#CBD5E1'));
    check('Customer hero layout prevents action overlap', customerHeroRule.includes('display: grid') && customerHeroRule.includes('grid-template-areas') && customerHeroRule.includes('"actions actions"') && customerHeroIdentityRule.includes('min-width: 0') && customerHeroActionsRule.includes('flex-wrap: wrap') && customerHeroActionsRule.includes('grid-area: actions') && customerHeroActionButtonRule.includes('white-space: normal') && customerHeroActionButtonRule.includes('overflow-wrap: anywhere') && customerHeroDangerRule.includes('border-left'));
    check('Customer API surfaces canonical children for list search export and bulk placeholders', customerRouteCode.includes('function loadCustomerChildrenMap') && customerRouteCode.includes('function applyCustomerChildrenProjection') && customerRouteCode.includes('function customerChildrenSearchSql') && customerRouteCode.includes('queryUpcomingBirthdayRows') && customerRouteCode.includes('customer.childNameDisplay || customer.childName') && customerRouteCode.includes('UPDATE customer_children') && customerRouteCode.includes('customerChildrenNameDisplay') && customerRouteCode.includes('customerChildrenBirthdayDisplay'));
    check('Customer legacy child fields are compatibility snapshots backed by policy helper', customerRouteCode.includes('buildLegacyChildSnapshot') && fileText('services/customerChildren.js').includes('LEGACY_CHILD_FIELD_POLICY') && fileText('docs/CUSTOMER_CHILDREN_LEGACY_FIELDS_POLICY_2026-06-23.md').includes('compatibility snapshots only'));
    check('Customer placeholders and exports show multi-child display policy', customerRouteCode.includes("replace(/\\{childBirthday\\}/g, customer.childBirthdayDisplay || customer.childBirthday || '')") && customerRouteCode.includes("'Діти'") && customerRouteCode.includes("'ДН дітей'") && customerRouteCode.includes('projected.childBirthdayDisplay ? `; ДН: ${projected.childBirthdayDisplay}`') && customerPageCode.includes('{childBirthday}') && customerPageCode.includes('підставляють короткий список') && fileText('docs/CUSTOMER_CHILDREN_DISPLAY_POLICY_2026-06-23.md').includes('Bulk message `{childName}`'));
    check('Customer child manual review exposes audit-preserving UI and API', !!doc.querySelector('.crm-tab[data-tab="children-review"]') && !!doc.getElementById('tabChildrenReview') && customerPageCode.includes('function loadChildrenReview') && customerPageCode.includes('function saveChildrenReviewEditor') && customerPageCode.includes("customerApiUrl('/api/customers/children-review?format=csv&limit=500')") && customerRouteCode.includes("router.get('/children-review'") && customerRouteCode.includes("router.post('/children-review/:customerId/resolve'") && customerRouteCode.includes("source_kind = 'manual_review'") && customerRouteCode.includes('original_preserved_in_source_rows') && customerRouteCode.includes('jsonb_set'));
    check('Customer child manual review resolves only active review candidates', customerRouteCode.includes("sourceFilter = `AND cc.id = ANY($3::bigint[]) AND ${customerChildReviewActiveSql('cc')} AND ${customerChildReviewCandidateSql('cc')}`"));
    check('Customer birthday scheduler reads canonical children with legacy fallback', schedulerCode.includes('function queryCustomersByChildBirthday') && schedulerCode.includes('JOIN customer_children cc') && schedulerCode.includes('UNION ALL') && schedulerCode.includes('isCustomerChildrenStorageMissing'));
    check('Customer dark mode covers body.dark-mode surfaces', html.includes('body.dark-mode .stat-card') && html.includes('body.dark-mode .crm-table-wrap'));
    check('Customer dark mode covers html data-theme surfaces', html.includes('html[data-theme="dark"] .stat-card') && html.includes('html[data-theme="dark"] .crm-table-wrap'));
    check('Customer dark empty state text is readable', html.includes('body.dark-mode .explain-empty-title') && html.includes('color: #F8FAFC !important'));
    check('Customers use canonical CRM business context shell instead of a local selector', !doc.getElementById('customerBusinessContext') && htmlContains('js/api.js', 'function getCrmBusinessState') && htmlContains('js/api.js', 'CRM_BUSINESS_SCOPED_PAGES') && htmlContains('js/customers-page.js', 'initCustomerBusinessContext') && htmlContains('js/customers-page.js', 'customerApiUrl'));
    check('Customer detail card exposes manual tag container', customerPageCode.includes('class="crm-tags-detail"') && customerPageCode.includes('id="detailTags"'));
    check('Customer detail card exposes manual tag handlers', customerPageCode.includes('window.showAddTagDropdown = function') && customerPageCode.includes('window.addTag = async function') && customerPageCode.includes('window.removeTag = async function'));
    check('Customer tags use API-backed dynamic catalog', customerPageCode.includes('tags: []') && customerPageCode.includes('predefinedTags: []') && customerPageCode.includes('async function fetchCustomerTags()') && customerPageCode.includes("customerApiUrl('/api/customers/tags')") && customerPageCode.includes('renderCustomerTagFilters()'));
    check('Customer NPS stats API reads true NPS and returns production contract', npsStatsRouteBlock.includes('er.nps_score IS NOT NULL') && npsStatsRouteBlock.includes('COUNT(*) FILTER (WHERE er.nps_score >= 9)::int AS promoters') && npsStatsRouteBlock.includes('COUNT(*) FILTER (WHERE er.nps_score BETWEEN 7 AND 8)::int AS passives') && npsStatsRouteBlock.includes('COUNT(*) FILTER (WHERE er.nps_score BETWEEN 0 AND 6)::int AS detractors') && npsStatsRouteBlock.includes('promoterPercent - detractorPercent') && npsStatsRouteBlock.includes('sentCount') && npsStatsRouteBlock.includes('responseRate') && npsStatsRouteBlock.includes('recentResponses') && npsStatsRouteBlock.includes('businessScope') && npsStatsRouteBlock.includes("customerScopeCondition(summaryParams, businessScope, 'er')") && npsStatsRouteBlock.includes("customerScopeCondition(sentParams, businessScope, 'b')") && !npsStatsRouteBlock.includes('avgNps: avgScore'));
    check('Customer NPS UI separates true NPS from legacy ratings', customerPageCode.includes('function renderNpsExplainer(totalResponses)') && customerPageCode.includes('NPS = % promoters - % detractors') && customerPageCode.includes('Promoters: 9-10') && customerPageCode.includes('passives: 7-8') && customerPageCode.includes('detractors: 0-6') && customerPageCode.includes('renderNpsDistribution(dist)') && customerPageCode.includes('responseRate') && customerPageCode.includes('renderLegacyReviewsSection') && customerPageCode.includes('Післяподієві оцінки 1-5') && customerPageCode.includes('NPS-відповідей ще немає') && !customerPageCode.includes('data.avgNps ?? data.avgScore ?? data.avgRating'));
    check('Customer NPS API keeps legacy rating separate from true NPS', npsStatsRouteBlock.includes('legacyReviews') && npsStatsRouteBlock.includes('COALESCE(AVG(er.rating), 0)::numeric(3,1) AS avg_rating') && npsStatsRouteBlock.includes('AND er.rating IS NOT NULL') && npsStatsRouteBlock.includes('avgRating') && npsStatsRouteBlock.includes('distribution: [1, 2, 3, 4, 5]'));
    check('Customer Telegram review scheduler reads customer social identities instead of missing booking/review columns', schedulerCode.includes('function normalizeCustomerTelegramChatId') && schedulerCode.includes('JOIN customers c ON c.id = b.customer_id') && schedulerCode.includes("jsonb_array_elements(COALESCE(c.social_identities, '[]'::jsonb))") && !schedulerCode.includes('b.customer_telegram_id') && !schedulerCode.includes('er.customer_telegram_id') && !schedulerCode.includes('b.phone'));
    check('Customer Telegram delivery rules honor customer chat payload and skip missing customer ids', eventBusCode.includes('action.use_customer_chat === true') && eventBusCode.includes('customerTelegramChatIdFromPayload(payload)') && eventBusCode.includes('payload?.telegramChatId') && eventBusCode.includes('!usesCustomerChat ? await getConfiguredChatId() : null') && eventBusCode.includes('sent Telegram message to customer chat'));
    check('Customer NPS follow-up uses true NPS scores and keeps legacy templates compatible', schedulerCode.includes('WHERE er.nps_score BETWEEN 0 AND 6') && schedulerCode.includes('WHERE er.nps_score >= 9') && schedulerCode.includes('nps_score: d.nps_score') && schedulerCode.includes('nps_score: p.nps_score') && !/WHERE er\.rating\s*[<=>]/.test(schedulerCode) && !/rating:\s*[dp]\.rating/.test(schedulerCode) && eventBusCode.includes('payload?.nps_score') && eventBusCode.includes("'{nps_score}/10'"));
    check('Customer auto prompt sends true NPS callbacks and marks bookings once', schedulerCode.includes('Наскільки ймовірно, що ви порекомендуєте нас друзям?') && schedulerCode.includes('b.nps_sent_at IS NULL') && schedulerCode.includes('[0, 1, 2, 3, 4, 5].map') && schedulerCode.includes('[6, 7, 8, 9, 10].map') && schedulerCode.includes('callback_data: `nps:${booking.id}:${score}`') && schedulerCode.includes('const sendResult = await sendTelegramMessage') && schedulerCode.includes('if (!sendResult?.ok)') && schedulerCode.includes('UPDATE bookings SET nps_sent_at = NOW() WHERE id = $1 AND nps_sent_at IS NULL') && !schedulerCode.includes('LEFT JOIN review_requests_sent rrs') && !schedulerCode.includes('INSERT INTO review_requests_sent') && !schedulerCode.includes('callback_data: `review:${booking.id}:'));
    check('Telegram NPS callback writes true NPS without touching legacy rating', telegramRouteCode.includes("data.startsWith('nps:')") && telegramRouteCode.includes('function safeParseNpsScore') && telegramRouteCode.includes('score >= 0 && score <= 10') && telegramRouteCode.includes('customer_id, customer_name, telegram_chat_id, nps_score') && telegramRouteCode.includes('UPDATE bookings') && telegramRouteCode.includes('SET nps_score = $1') && telegramRouteCode.includes('NPS вже збережено') && !telegramRouteCode.includes('nps_score, rating'));
    check('Legacy review callback remains available for old 1-5 keyboards', telegramRouteCode.includes("data.startsWith('review:')") && telegramRouteCode.includes('rating < 1 || rating > 5') && telegramRouteCode.includes('INSERT INTO event_reviews (business_context, booking_id, customer_id, customer_name, telegram_chat_id, rating)') && telegramRouteCode.includes('b.customer_id, $2, $3, $4') && !telegramRouteCode.includes('customer_name, telegram_chat_id, rating, nps_score'));
    check('Customer vCard toolbar distinguishes import from export', doc.getElementById('exportVcfBtn')?.textContent.trim() === 'Експорт vCard' && doc.getElementById('importVcfBtn')?.textContent.trim() === 'Імпорт vCard' && doc.getElementById('exportVcfBtn')?.getAttribute('aria-label') === 'Експорт клієнтів у vCard' && doc.getElementById('importVcfBtn')?.getAttribute('aria-label') === 'Імпорт клієнтів із vCard');
    check('Customer tag filters no longer ship hardcoded options', tagFilterOptions.length === 1 && tagFilterOptions[0]?.value === '' && !customerPageCode.includes("const predefined = ['VIP'"));
    check('Customer bulk and detail tag dropdowns use dynamic catalog', customerPageCode.includes("renderCustomerTagOptions('', 'Всі клієнти', { includeBirthdaySystemTags: true") && customerPageCode.includes('const catalog = getCustomerTagCatalog()') && customerPageCode.includes('data-tag-index'));
    check('Customer birthday tag filters expose system month shortcuts', customerPageCode.includes('BIRTHDAY_SYSTEM_TAGS') && customerPageCode.includes('currentKyivBirthdayMonthTag') && customerPageCode.includes('Іменинники цього місяця') && customerPageCode.includes("timeZone: 'Europe/Kyiv'") && customerPageCode.includes('includeBirthdaySystemTags: true') && customerPageCode.includes('includeCurrentBirthdayShortcut: true'));
    check('Customer manual tag controls keep birthday system tags out by default', customerPageCode.includes('function getCustomerTagCatalog({ includeBirthdaySystemTags = false } = {})') && customerPageCode.includes('const catalog = getCustomerTagCatalog();') && customerPageCode.includes('function renderCustomerTagOptions(selectedValue = \'\', emptyLabel = \'Всі теги\', options = {})'));
    check('Customer tag actions await full card/list/filter refresh', tagManagementBlock.includes('async function refreshCustomerTagSurfaces(customerId)') && tagManagementBlock.includes('await showCustomerDetail(customerId);') && tagManagementBlock.includes('await refreshData();') && tagManagementBlock.includes('renderCustomerTable();') && tagManagementBlock.includes('renderPagination();') && tagManagementBlock.includes('renderTagFilters();') && !/\n\s*refreshData\(\);/.test(tagManagementBlock));
    check('Customer tag actions expose loading state and duplicate notice', tagManagementBlock.includes('pendingCustomerTagActions') && tagManagementBlock.includes('function setCustomerTagActionButtonState') && tagManagementBlock.includes("button.setAttribute('aria-busy', 'true')") && tagManagementBlock.includes('payload.message && !payload.tag') && tagManagementBlock.includes("showNotification(payload.message, 'info')") && customerPageCode.includes('removeTag(${options.customerId},${item.id},this)') && customerPageCode.includes('window.addTag(customerId, item.tag, item.color, button)') && customerCss.includes('.crm-tag-option.is-loading'));
    check('Customer tag UI marks system tags and keeps remove controls keyboard-safe', customerPageCode.includes('function isCustomerSystemTag') && customerPageCode.includes('data-tag-source="${sourceAttr}"') && customerPageCode.includes('crm-tag-system-marker') && customerPageCode.includes('Керується датою народження') && customerPageCode.includes('options.removable && !isSystem') && customerCss.includes('.crm-tag-pill--system') && customerCss.includes('.crm-tag-remove:focus-visible') && customerCss.includes('@media (max-width: 520px)') && customerCss.includes('.customer-edit-custom-tag'));
    check('Customer edit modal has first-class tag controls', !!doc.getElementById('editTagsChips') && !!doc.getElementById('editAddTagBtn') && !!doc.getElementById('editTagDropdown') && !!doc.getElementById('editTagOptions') && !!doc.getElementById('editCustomTagInput') && !!doc.getElementById('editCustomTagAddBtn') && customerEditModalHtml.includes('customer-edit-tags-panel'));
    check('Customer edit tags participate in dirty state and save payload', customerPageCode.includes('editingTags: []') && customerPageCode.includes('function renderCustomerEditTags()') && customerPageCode.includes('function bindCustomerEditTagTools()') && customerPageCode.includes('serializedCustomerEditingTags()') && customerPageCode.includes('setCustomerEditingTags(customer?.tags || [])') && customerPageCode.includes('tags: CrmState.editingTags.map') && customerPageCode.includes('bindCustomerEditTagTools();'));
    check('Customer create/update routes persist questionnaire tags', htmlContains('routes/customers.js', 'function normalizeCustomerTagsPayload') && htmlContains('routes/customers.js', 'CUSTOMER_TAG_MAX_COUNT = 20') && htmlContains('routes/customers.js', 'CUSTOMER_TAG_MAX_LENGTH = 60') && htmlContains('routes/customers.js', 'tagsProvided') && htmlContains('routes/customers.js', 'async function syncManualCustomerTags') && htmlContains('routes/customers.js', 'manualCustomerTagCondition') && htmlContains('routes/customers.js', 'NOT (tag = ANY($2::text[]))') && htmlContains('routes/customers.js', 'customer.tags = await getCustomerTagsPg') && !htmlContains('routes/customers.js', 'DELETE FROM customer_tags WHERE customer_id = $1\', [customerId]'));
    check('Customer tag catalog exposes system tag capability for live regression tests', htmlContains('routes/customers.js', 'const caps = await getCustomerTagColumnCapabilities(pool);') && htmlContains('routes/customers.js', 'capabilities:') && htmlContains('routes/customers.js', 'systemTags: caps.hasSource && caps.hasSystemKey && caps.hasUpdatedAt'));
});

checkPage('finance.html', (doc, html) => {
    check('Finance transaction edit modal exists', !!doc.getElementById('transEditModal'));
    check('Finance transaction date input exists', doc.getElementById('editDate')?.type === 'date');
    check('Finance transaction modal uses shrink-safe grid', html.includes('grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px'));
    check('Finance transaction date input is bounded', html.includes('id="editDate" style="width:100%;min-width:0;max-width:100%;'));
    check('Finance page owns a dedicated currency rates modal', !!doc.getElementById('currencyRatesModal') && !!doc.getElementById('openCurrencyRatesBtn') && html.includes('currency-rates-window') && html.includes('Курси валют'));
});

checkPage('afisha.html', (doc, html) => {
    const afishaPageCode = fs.readFileSync(path.join(ROOT, 'js', 'afisha-page.js'), 'utf8');
    const afishaRouteCode = fs.readFileSync(path.join(ROOT, 'routes', 'afisha.js'), 'utf8');
    const afishaMaterialsMigration = fs.readFileSync(path.join(ROOT, 'db', 'migrations', '219_afisha_event_materials.sql'), 'utf8');
    check('Afisha page exposes event-centric workspace shell', !!doc.getElementById('afishaPageForm') && !!doc.getElementById('afishaPageList') && !!doc.getElementById('afishaStats') && !!doc.getElementById('afishaEventWorkspace') && html.includes('afisha-event-rail'));
    check('Afisha page exposes per-event materials folder UI', !!doc.getElementById('afishaMaterialForm') && !!doc.getElementById('afishaMaterialList') && !!doc.getElementById('afishaMaterialKind') && !!doc.getElementById('afishaMaterialFile'));
    check('Afisha page exposes import/export and recurring templates', !!doc.getElementById('afishaImportText') && !!doc.getElementById('afishaTemplateForm') && !!doc.getElementById('afishaTemplateList'));
    check('Afisha page uses API-backed event CRUD without timeline modal dependency', afishaPageCode.includes("api('POST', '/afisha'") && afishaPageCode.includes("api('PUT', `/afisha/") && afishaPageCode.includes("api('DELETE', `/afisha/") && !html.includes('id="afishaModal"'));
    check('Afisha materials use real event-scoped persistence and upload routes', afishaPageCode.includes('/materials/upload') && afishaPageCode.includes('new FormData()') && afishaRouteCode.includes('afisha_event_materials') && afishaRouteCode.includes("router.post('/:id/materials/upload'") && afishaRouteCode.includes("router.get('/:id/materials/:materialId/download'") && afishaMaterialsMigration.includes('CREATE TABLE IF NOT EXISTS afisha_event_materials') && afishaMaterialsMigration.includes('file_data BYTEA'));
    check('Afisha page includes shared shell and dedicated script', html.includes('sidebarLinks') && html.includes('js/afisha-page.js') && html.includes('data-page="afisha"'));
    check('Afisha standalone page verifies auth before showing shell', afishaPageCode.includes('bootstrapAfishaShell') && afishaPageCode.includes('apiVerifyToken()') && afishaPageCode.includes('showAuthenticatedPageShell()') && afishaPageCode.includes("window.location.href = '/'") && afishaPageCode.indexOf('bootstrapAfishaShell') < afishaPageCode.indexOf('initDefaults();'));
    check('Afisha lead conversion query prefills client context', afishaPageCode.includes('function leadPrefillFromUrl') && afishaPageCode.includes("queryParam('customerName')") && afishaPageCode.includes("queryParam('customerPhone')") && afishaPageCode.includes('applyLeadPrefillToAfishaForm(leadPrefillFromUrl())'));
    check('Afisha destructive actions use CRM confirm modal helper', afishaPageCode.includes('function confirmAfishaAction') && afishaPageCode.includes('await confirmAfishaAction') && !afishaPageCode.includes("if (!confirm('"));
});

checkPage('certificates.html', (doc, html) => {
    const certificatePageCode = fs.readFileSync(path.join(ROOT, 'js', 'certificates-page.js'), 'utf8');
    const certificatePreviewCode = fs.readFileSync(path.join(ROOT, 'js', 'certificate-preview.js'), 'utf8');
    const certificateRouteCode = fs.readFileSync(path.join(ROOT, 'routes', 'certificates.js'), 'utf8');
    const certificateServiceCode = fs.readFileSync(path.join(ROOT, 'services', 'certificates.js'), 'utf8');
    const pagesCss = cssTextWithImports('css/pages.css');
    const certQtyInputRule = pagesCss.match(/\.cert-quantity-option input\s*\{([\s\S]*?)\}/)?.[1] || '';
    const certQtyCheckedRule = pagesCss.match(/\.cert-quantity-option input:checked \+ span\s*\{([\s\S]*?)\}/)?.[1] || '';
    const certNavLinks = [...doc.querySelectorAll('.cert-page-actions [data-cert-mode]')];
    check('Certificates page exposes standalone list route surface', !!doc.getElementById('certificatesListView') && !!doc.getElementById('certPageList') && !!doc.getElementById('certPageStats'));
    check('Certificates page exposes standalone single-create route surface', !!doc.getElementById('certificatesNewView') && !!doc.getElementById('certificatePageForm') && !!doc.getElementById('certPageSubmitBtn'));
    check('Certificates page exposes standalone batch-create route surface', !!doc.getElementById('certificatesBatchView') && !!doc.getElementById('certificateBatchPageForm') && !!doc.getElementById('certBatchPageSubmitBtn'));
    check('Certificates batch route is locked to one-time entry without type selector', !doc.getElementById('certPageBatchType') && html.includes('Пакет сертифікатів на одноразовий вхід') && certificatePageCode.includes("const BATCH_CERTIFICATE_TYPE_TEXT = 'на одноразовий вхід'") && certificatePageCode.includes('eventName: eventName || undefined'));
    check('Certificates page routes primary actions to canonical routes', html.includes('href="/certificates/new"') && html.includes('href="/certificates/batch"') && html.includes('href="/certificates"'));
    check('Certificates routes are explicit before SPA fallback', htmlContains('server.js', "app.get(['/certificates', '/certificates/new', '/certificates/batch']") && htmlContains('server.js', "res.sendFile(path.join(__dirname, 'certificates.html'));"));
    check('Certificates legacy nested asset paths redirect to root assets', htmlContains('server.js', 'Redirect legacy nested asset paths left by cached /certificates/new HTML') && htmlContains('server.js', 'app.get(/^\\/certificates\\/(css|js|images)\\/(.+)$/') && htmlContains('server.js', 'res.redirect(302, `/${bucket}/${asset}${query}`);'));
    check('Certificates nested routes load shared shell assets from root', ['/css/base.css', '/css/sidebar-aurora.css', '/js/auth.js', '/js/components/sidebar.js', '/js/certificate-preview.js', '/js/certificates-page.js', '/images/gear-logo.svg'].every(token => html.includes(token)) && !html.includes('href="css/') && !html.includes('src="js/') && !html.includes('src="images/gear-logo.svg"'));
    check('Certificates page JS uses existing certificate API helpers', certificatePageCode.includes('apiGetCertificates') && certificatePageCode.includes('apiCreateCertificate') && certificatePageCode.includes('apiBatchCreateCertificates') && certificatePageCode.includes('apiUpdateCertificateStatus') && certificatePageCode.includes('apiDeleteCertificate'));
    check('Certificates page has route-driven modes instead of creation modals', certificatePageCode.includes("path.endsWith('/new')") && certificatePageCode.includes("path.endsWith('/batch')") && !html.includes('id="certificateModal"') && !html.includes('id="batchCertModal"'));
    check('Certificates header nav active state is route-driven and semantic', certNavLinks.length === 3 && certNavLinks.every(link => link.classList.contains('btn-page-secondary') && !link.classList.contains('btn-page-primary')) && certificatePageCode.includes('function syncHeaderActiveState') && certificatePageCode.includes("link.setAttribute('aria-current', 'page')") && pagesCss.includes('.cert-page-actions .cert-page-action-link.is-active'));
    check('Certificates header nav active CTA follows route without first-letter pseudo marker', certificatePageCode.includes("document.body?.setAttribute('data-cert-mode', mode)") && certificatePageCode.includes("link.toggleAttribute('data-cert-primary-cta', active)") && !/\.cert-page-actions\s+\.cert-page-action-link[^{]+::before/.test(pagesCss));
    check('Certificates single issue copy mentions abonement in active entry points', html.includes('Видати сертифікат або абонемент') && certificatePageCode.includes('const SINGLE_ISSUE_LABEL') && htmlContains('js/components/sidebar.js', "Видати сертифікат або абонемент") && htmlContains('js/search.js', "Видати сертифікат або абонемент"));
    check('Certificates single create requires recipient identity in UI and API', doc.getElementById('certPageDisplayValue')?.required === true && doc.getElementById('certPageDisplayValue')?.getAttribute('aria-required') === 'true' && !!doc.getElementById('certPageDisplayValueError') && certificatePageCode.includes('validateSingleIdentity') && certificateServiceCode.includes('certificateIdentityRequiredMessage') && certificateRouteCode.includes('validateCertificateInput(req.body, { requireIdentity: true })'));
    check('Certificates create/edit enforce normalized uniqueness while batch remains placeholder-based', certificateRouteCode.includes('assertUniqueCertificateIdentity') && certificateRouteCode.includes('CERTIFICATE_RECIPIENT_NOT_UNIQUE') && certificateRouteCode.includes("cert.issue_source !== 'batch' || hasDisplayValue") && certificateRouteCode.includes("VALUES ($1, 'fio', '', $2"));
    check('Certificates standalone page verifies auth before showing shell', certificatePageCode.includes('bootstrapAuthenticatedShell') && certificatePageCode.includes('apiVerifyToken()') && certificatePageCode.includes('showAuthenticatedPageShell()') && certificatePageCode.includes("window.location.href = '/'") && certificatePageCode.indexOf('bootstrapAuthenticatedShell') < certificatePageCode.indexOf('setMode(detectMode())'));
    check('Certificates delete action uses CRM confirm modal helper', certificatePageCode.includes('function confirmCertificateAction') && certificatePageCode.includes('await confirmCertificateAction') && !certificatePageCode.includes("if (!window.confirm('Видалити сертифікат?')"));
    check('Certificates standalone page does not carry a duplicate local profile modal', !doc.getElementById('profileModal') && !doc.getElementById('profileContent'));
    check('Certificates registry uses durable source metadata and true API stats', certificateServiceCode.includes('issueSource: row.issue_source') && certificateRouteCode.includes('issue_source') && certificateRouteCode.includes('batch_group_id') && certificateRouteCode.includes('stats: {') && certificatePageCode.includes('renderStats(state.stats, result.total, state.items)'));
    check('Certificates standalone detail/result restore visual preview helper', !!doc.getElementById('certificatePageDetailModal') && certificatePageCode.includes('CertificatePreview.renderInto') && certificatePageCode.includes('certCreatePreview') && certificatePageCode.includes('certificatePagePreview'));
    check('Certificates open on iPhone with static preview and safe PNG window fallback', certificatePreviewCode.includes('function renderStaticPreview') && certificatePreviewCode.includes('cert-preview-static-card') && certificatePreviewCode.includes("return renderStaticPreview(node, cert, { reason: 'touch' })") && certificatePageCode.includes('function openCertificateTouchExportWindow') && certificatePageCode.includes('function finishCertificatePngExport') && certificatePageCode.includes("isCertificateTouchExportDevice() ? 'Відкрити PNG' : 'Скачати PNG'") && !certificatePageCode.includes("link.href = canvas.toDataURL('image/png')") && pagesCss.includes('.cert-preview-static-card'));
    check('Certificates batch quantity picker hides native radio chrome but keeps focus state', html.includes('class="cert-quantity-option"') && certQtyInputRule.includes('opacity: 0') && certQtyInputRule.includes('clip-path: inset(50%)') && pagesCss.includes('.cert-quantity-option input:focus-visible + span'));
    check('Certificates batch quantity selected state avoids duplicate inset ring', certQtyCheckedRule.includes('box-shadow: none') && !certQtyCheckedRule.includes('inset') && pagesCss.includes('.cert-quantity-option input:checked:focus-visible + span') && pagesCss.includes('body.dark-mode .cert-quantity-option input:focus-visible + span'));
});

checkPage('staff.html', (doc, html) => {
    const baseCss = fs.readFileSync(path.join(ROOT, 'css', 'base.css'), 'utf8');
    const modalCss = fs.readFileSync(path.join(ROOT, 'css', 'modals.css'), 'utf8');
    const staffPagesCss = cssTextWithImports('css/pages.css');
    const uiCode = fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8');
    const staffCode = fs.readFileSync(path.join(ROOT, 'js', 'staff-page.js'), 'utf8');
    check('Staff schedule edit modal exists', !!doc.getElementById('schModalOverlay'));
    check('Staff fill-week modal exists', !!doc.getElementById('fillWeekOverlay'));
    check('Staff schedule modal uses shared top modal layer', html.includes('z-index: var(--z-modal, 30000)'));
    check('Base modal layer is above assistant and drawer surfaces', baseCss.includes('--z-modal: 30000') && baseCss.includes('--z-modal-confirm: 30100'));
    check('Confirm overlay uses modal confirm token', modalCss.includes('z-index: var(--z-modal-confirm, 30100)'));
    check('Shared ModalLayer guard exists', uiCode.includes('window.ModalLayer') && uiCode.includes('ensureTopLayer') && uiCode.includes('.sch-modal-overlay.visible'));
    check('Staff schedule opens through ModalLayer', staffCode.includes('ModalLayer.ensureTopLayer(overlay)'));
    check('Staff employee cells open HR profiles', staffCode.includes('data-hr-profile') && staffCode.includes('openHrProfile') && staffCode.includes('/hr?employee='));
    check('Staff employee cells keep account linking separate', staffCode.includes('[data-link-staff]') && staffCode.includes('e.target.closest'));
    check('Staff employee cells are keyboard accessible links', staffCode.includes('role="link"') && staffCode.includes("e.key !== 'Enter'") && staffCode.includes("e.key !== ' '"));
    check('Staff employee cells have profile affordance styling', html.includes('.emp-cell:hover') && html.includes('.emp-cell:focus-visible'));
    check('Staff schedule exposes managed replacement controls and state', !!doc.getElementById('schReplaceBtn') && !!doc.getElementById('schClearReplacementBtn') && !!doc.getElementById('schReplacementDetails') && staffCode.includes('async function replaceScheduleEntry') && staffCode.includes('async function clearScheduleReplacement') && staffCode.includes('function scheduleReplacementCandidates') && staffCode.includes('sch-replacement-badge') && staffPagesCss.includes('.sch-cell.is-replacement') && staffPagesCss.includes('.sch-replacement-details[hidden]'));
    check('Staff schedule keeps HR Pulse switcher and unified panel rhythm', !!doc.querySelector('.staff-pulse-nav[aria-label="Навігація пульсу компанії"]') && !!doc.querySelector('.staff-pulse-tab[href="/hr#today"]') && !!doc.querySelector('.staff-pulse-tab.active[href="/staff"][aria-current="page"]') && !!doc.querySelector('.staff-pulse-tab[href="/hr#reports"]') && staffPagesCss.includes('v0.73.52: /staff keeps HR Pulse navigation and schedule panels in one visual rhythm') && staffPagesCss.includes('.staff-pulse-nav-items') && staffPagesCss.includes('grid-template-columns: repeat(3, minmax(0, 1fr));') && staffPagesCss.includes('.staff-pulse-tab.active') && staffPagesCss.includes('body[data-page-group="hr"] .schedule-controls') && staffPagesCss.includes('border-radius: 18px') && staffPagesCss.includes('body.dark-mode .staff-pulse-nav'));
});

checkPage('leads.html', (doc, html) => {
    const leadDate = doc.getElementById('leadEventDate');
    const leadChildren = doc.getElementById('leadChildrenCount');
    const customerDate = doc.getElementById('ccEventDate');
    const customerChildren = doc.getElementById('ccChildrenCount');
    const cancelBtn = doc.getElementById('leadModalCancel');
    const saveBtn = doc.getElementById('leadModalSave');
    const leadShell = doc.querySelector('main#main-content.page-container');
    const leadsApp = doc.getElementById('leadsApp');
    const leadWorkspace = doc.getElementById('leadWorkspace');
    const kanbanView = doc.getElementById('kanbanView');
    const kanbanSummarySlot = doc.getElementById('kanbanSummarySlot');
    const leadPageCode = fileText('js/leads-page.js');
    const leadPageStyles = fileText('css/pages-leads.css');
    check('Leads explainability region exists', !!doc.getElementById('leadsExplainability'));
    check('Lead edit modal date input exists', leadDate?.type === 'date');
    check('Lead edit modal children input exists', leadChildren?.type === 'number');
    check('Lead celebrants use structured rows with birthday and preview', doc.getElementById('leadCelebrants')?.hasAttribute('hidden') && doc.getElementById('ccCelebrants')?.hasAttribute('hidden') && doc.getElementById('leadCelebrantsRows') && doc.getElementById('ccCelebrantsRows') && doc.getElementById('leadCelebrantsPreview') && doc.getElementById('ccCelebrantsPreview') && html.includes('data-celebrants-editor="leadCelebrants"') && html.includes('data-celebrants-editor="ccCelebrants"') && leadPageCode.includes('function renderCelebrantsEditor') && leadPageCode.includes('function getCelebrantsPayload') && leadPageCode.includes('function isCelebrantsEditorDirty') && leadPageCode.includes("if (!editId || leadCelebrantsDirty) body.celebrants = leadCelebrants") && leadPageCode.includes('if (ccCelebrantsDirty) leadBody.celebrants = body.celebrants || []') && leadPageStyles.includes('.lead-celebrant-row') && leadPageStyles.includes('.lead-celebrants-preview'));
    check('Lead edit modal cancel button exists', cancelBtn?.type === 'button');
    check('Lead edit modal save button exists', saveBtn?.type === 'button');
    check('Customer card modal date input exists', customerDate?.type === 'date');
    check('Customer card modal children input exists', customerChildren?.type === 'number');
    check('Leads uses one standard page shell', !!leadShell && !doc.querySelector('.page-container .main-content'));
    check('Leads app wrapper does not own shell offset', !!leadsApp && !leadsApp.classList.contains('main-content'));
    check('Leads unified workspace shell exists', !!leadWorkspace && !!doc.getElementById('leadWorkspaceBody'));
    check('Leads unified workspace has close control', doc.getElementById('leadWorkspaceClose')?.type === 'button');
    check('Leads kanban summary slot is a stable footer after kanban', !!kanbanView && !!kanbanSummarySlot && kanbanView.parentElement?.id === 'leadsKanbanLayout' && kanbanView.nextElementSibling?.id === 'kanbanSummarySlot' && kanbanSummarySlot.querySelector('#kanbanFunnel'));
    check('Lead modal grid allows narrow WebKit date inputs', html.includes('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)'));
    check('Lead modal controls can shrink inside grid columns', html.includes('min-width: 0; max-width: 100%'));
    check('Lead modal responsive row is scoped', html.includes('.lead-modal .form-row { grid-template-columns: 1fr; }'));
    check('Lead modal rows stack on touch devices', html.includes('@media (hover: none) and (pointer: coarse)') && html.includes('.lead-modal .form-row { grid-template-columns: 1fr; }'));
    check('Lead modal rows stack on WebKit touch fallback', html.includes('@supports (-webkit-touch-callout: none)') && html.includes('.lead-modal .form-row { grid-template-columns: 1fr; }'));
    check('Lead workspace hero cannot squeeze client text into a one-letter column', html.includes('.workspace-hero-main') && html.includes('display: flex;') && html.includes('.workspace-actions .workspace-btn'));
    check('Lead modals open above the lead workspace drawer', html.includes('.lead-modal-overlay') && html.includes('z-index: 1700'));
    check('Leads use canonical CRM business context shell instead of a local selector', !doc.getElementById('leadBusinessContext') && htmlContains('js/api.js', 'function getCrmBusinessState') && htmlContains('js/leads-page.js', 'initLeadBusinessContext') && htmlContains('js/leads-page.js', 'leadApiUrl'));
});

checkPage('chat.html', (doc) => {
    const messagesArea = doc.getElementById('chatMessagesArea');
    const dialogState = doc.getElementById('chatDialogState');
    const messages = doc.getElementById('chatMessages');
    check('Chat dialog state slot wraps messages area', !!messagesArea && !!dialogState && !!messages && messagesArea.contains(dialogState) && messagesArea.contains(messages));
    check('Chat dialog state sits before message list', !!dialogState && !!messages && dialogState.nextElementSibling?.id === 'chatMessages');
    check('Chat header links to dedicated settings page', doc.getElementById('chatSettingsBtn')?.getAttribute('href') === '/chat-settings');
    check('Guardian panels exist for managed replacement flow', !!doc.getElementById('guardianDigestPanel') && !!doc.getElementById('guardianLogPanel') && !!doc.getElementById('guardianAnalyticsPanel') && !!doc.getElementById('chatInfoPanel'));
});

checkPage('chat-settings.html', (doc) => {
    check('Chat settings page exposes AI controls', !!doc.getElementById('chatAiEnabled') && !!doc.getElementById('chatAiProvider') && !!doc.getElementById('chatAiModel'));
    check('Chat settings page uses model selectors instead of raw model text inputs', doc.getElementById('chatAiModel')?.tagName === 'SELECT' && doc.getElementById('guardianModel')?.tagName === 'SELECT');
    check('Chat settings page exposes test connection', !!doc.getElementById('chatAiTestBtn'));
    check('Chat settings page exposes integrations controls', !!doc.getElementById('chatIntegrationSummary') && !!doc.getElementById('chatIntegrationGuardian'));
    check('Chat settings page exposes Guardian controls', !!doc.getElementById('guardianEnabled') && !!doc.getElementById('guardianProvider') && !!doc.getElementById('guardianModel'));
    check('Chat settings page exposes AI provider diagnostics', !!doc.getElementById('aiProviderDiagnostics') && !!doc.getElementById('aiProviderRefreshBtn'));
});

checkPage('timeline-settings.html', (doc, html) => {
    check('Timeline settings shell exists', !!doc.getElementById('mainApp') && !!doc.getElementById('sidebarLinks') && !!doc.querySelector('.timeline-settings-page'));
    check('Timeline settings has context rail, workspace, and inspector', !!doc.getElementById('timelineSettingsContextList') && !!doc.getElementById('timelineSettingsBlockGroups') && !!doc.getElementById('timelineSettingsInspector'));
    check('Timeline settings has required tabs and actions',
        !!doc.querySelector('[data-timeline-settings-tab="blocks"]')
        && !!doc.querySelector('[data-timeline-settings-tab="visual"]')
        && !!doc.querySelector('[data-timeline-settings-tab="presets"]')
        && !!doc.querySelector('[data-timeline-settings-tab="system"]')
        && !!doc.getElementById('timelineSettingsBackLink')
        && !!doc.getElementById('timelineSettingsResetBtn')
        && !!doc.getElementById('timelineSettingsSaveBtn'));
    check('Timeline settings loads context and page controllers', getHtmlScripts(html).includes('js/timeline-context.js') && getHtmlScripts(html).includes('js/timeline-settings-page.js'));
});

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
    const printTriggerCount = (pageCode.match(/window\.print\s*\(/g) || []).length;
    const renderTermsBody = pageCode.match(/function renderTerms\(summary\) \{([\s\S]*?)\r?\n    \}\r?\n\r?\n    function renderDocument/)?.[1] || '';
    const renderDocumentBody = pageCode.match(/function renderDocument\(summary\) \{([\s\S]*?)\r?\n    \}\r?\n\r?\n    function summaryText/)?.[1] || '';
    const summaryTextBody = pageCode.match(/function summaryText\(summary\) \{([\s\S]*?)\r?\n    \}\r?\n\r?\n    async function copyText/)?.[1] || '';
    const pdfExportButtons = Array.from(doc.querySelectorAll('[data-booking-summary-pdf-mode]'));
    const frontendBanquetTermsHardcode = /(banquet_own_cake_fee|banquet_cork_fee|banquet_menu_correction_deadline_days|banquet_date_change_deadline_days|Cork Fee|Свій торт|500грн|500 грн|100грн|100 грн|3 доби|5 діб)/;
    check('Booking summary page exposes preview shell and actions',
        !!doc.getElementById('bookingSummaryBack')
        && !!doc.getElementById('bookingSummaryCopy')
        && !!doc.getElementById('bookingSummaryPrint')
        && pdfExportButtons.length === 3
        && pdfExportButtons.map(button => button.getAttribute('data-booking-summary-pdf-mode')).join(',') === 'client,kitchen,staff'
        && !!doc.getElementById('bookingSummaryWarnings')
        && !!doc.getElementById('bookingSummaryPrintRoot')
        && !!doc.getElementById('bookingSummaryDocument'));
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
        && renderDocumentBody.includes("briefItem('Дата банкету', formatDate(event.date))")
        && renderDocumentBody.includes("briefItem('Прихід гостей', event.time)")
        && !renderDocumentBody.includes("briefItem('Дата', formatDate(event.date))")
        && !renderDocumentBody.includes("briefItem('Час', event.time)")
        && summaryTextBody.includes('`Дата банкету: ${formatDate(event.date)}`')
        && summaryTextBody.includes('`Прихід гостей: ${formatValue(event.time)}`')
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
        && pageCode.includes('<th class="duration">Тривалість</th>')
        && pageCode.includes('<td class="duration">${escapeHtml(summaryDurationLabel(row))}</td>')
        && pageCode.includes("function summaryOrderServingLabel(row = {})")
        && pageCode.includes('function summaryEntryFullAmountLabel(row = {}, currency = \'UAH\')')
        && pageCode.includes('по ${unit}')
        && pageCode.includes('<col style="width:86px">')
        && pageCode.includes('<col style="width:118px">')
        && pageCode.includes('<td class="qty">${escapeHtml(summaryOrderQuantityLabel(row))}</td>')
        && summaryTextBody.includes('const durationLabel = summaryDurationLabel(row)')
        && summaryTextBody.includes('const quantityLabel = summaryOrderQuantityLabel(row)')
        && summaryTextBody.includes("row?.type === 'program' || row?.type === 'activity'")
        && summaryTextBody.includes('${durationLabel} — ${formatMoney(row.subtotal, currency)}')
        && summaryTextBody.includes('${summaryEntryFullAmountLabel(row, currency)}')
        && summaryTextBody.includes('— ${quantityLabel} × ${formatMoney(row.unitPrice, currency)}')
        && !summaryTextBody.includes('formatValue(row.quantity)} x')
        && banquetSummaryServiceCode.includes('servingUnit: item.servingUnit || null')
        && banquetSummaryServiceCode.includes('durationMinutes: durationMinutesOfBooking(mainBooking)')
        && banquetSummaryServiceCode.includes('durationMinutes: durationMinutesOfBooking(booking)')
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
        && pageCss.includes('margin: auto auto 0')
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
        && renderDocumentBody.includes('class="banquet-final-brand"')
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
        && pageCss.includes('.banquet-final-brand')
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
        && pageCode.includes('<table class="summary-order-table">')
        && !pageCode.includes('function compactFact')
        && !pageCode.includes('function compactLine')
        && !pageCode.includes('compactLine([')
        && !pageCode.includes('summary-brief-line')
        && !pageCode.includes("compactFact('Менеджер', event.manager)")
        && !pageCode.includes('summary-info-grid')
        && !pageCode.includes('summary-total-card')
        && !pageCode.includes('<td class="money">')
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

checkPage('sound.html', (doc, html) => {
    const soundCode = fs.readFileSync(path.join(ROOT, 'js', 'sound-page.js'), 'utf8');
    const soundCss = fs.readFileSync(path.join(ROOT, 'css', 'sound.css'), 'utf8');
    check('Sound library exposes upload as the real music fallback action', html.includes('onclick="_openUploadModal()"') && html.includes('Завантажити аудіо') && soundCode.includes('window._openUploadModal') && soundCode.includes('/music/library/upload') && soundCode.includes('new FormData()'));
    check('Sound page exposes Kie/Suno music generation instead of soon-only disabled state', html.includes('onclick="_openMusicModal()"') && html.includes('Створити музику') && !html.includes('AI-музика недоступна') && soundCode.includes('/music/library/generate-music') && soundCode.includes('?provider=${encodeURIComponent(provider)}') && soundCode.includes("'suno'"));
    check('Sound upload and music action states have explicit styling', soundCss.includes('.sound-create-btn.upload') && soundCss.includes('.sound-create-btn.music') && soundCss.includes('body.dark-mode .sound-create-btn.upload'));
});

checkPage('tasks.html', (doc, html) => {
    const tasksCode = fs.readFileSync(path.join(ROOT, 'js', 'tasks-page.js'), 'utf8');
    const taskCreateCodeForTasks = fs.readFileSync(path.join(ROOT, 'js', 'task-create.js'), 'utf8');
    check('Tasks explainability region exists', !!doc.getElementById('taskExplainability'));
    check('Tasks category filters exist', !!doc.getElementById('catFilters'));
    check('Tasks subcategory filters host exists', !!doc.getElementById('subcatFilters'));
    check('Tasks operation pack bar exists', !!doc.getElementById('operationPackBar'));
    check('Tasks operation pack source fields exist', !!doc.getElementById('operationSourceType') && !!doc.getElementById('operationSourceId'));
    check('Tasks board content exists', !!doc.getElementById('boardContent'));
    check('Tasks top area does not render points strip', !doc.getElementById('pointsBar') && !doc.getElementById('pointsPermanent') && !doc.getElementById('pointsMonthly'));
    check('Tasks page has no Focus tab button', !doc.querySelector('[data-view="focus"]'));
    check('Tasks summary and scope filters exist', !!doc.getElementById('tasksSummaryStrip') && !!doc.getElementById('taskScopeFilters') && !!doc.querySelector('[data-scope="waiting"]') && !!doc.querySelector('[data-scope="idea"]'));
    check('Tasks page scopes API through active CRM business context', tasksCode.includes('function initTaskBusinessContext') && tasksCode.includes("pageId: 'system'") && tasksCode.includes('function taskApiUrl') && tasksCode.includes('function taskPayload') && tasksCode.includes('taskApiFetchWithAuth') && taskCreateCodeForTasks.includes('function scopedTaskApiUrl') && taskCreateCodeForTasks.includes('function scopedTaskPayload'));
    check('Maysternya tasks follow-up workspace is business-switch guarded', !!doc.getElementById('maysternyaTaskOpsBar') && htmlContains('css/pages-tasks.css', '.maysternya-task-ops[hidden]') && tasksCode.includes('MAYSTERNYA_TASK_PRESETS') && tasksCode.includes('function isMaysternyaTaskContext') && tasksCode.includes("scope.mode === 'single'") && tasksCode.includes('currentMaysternyaTaskFilter') && tasksCode.includes('applyMaysternyaTaskPreset'));
    check('Tasks quick add is a compact self-first composer', doc.getElementById('quickAdd')?.classList.contains('task-composer') && !!doc.querySelector('[data-task-assignee-mode="self"].active') && !!doc.getElementById('taskDetailsToggle') && !!doc.getElementById('taskComposerDetails') && doc.getElementById('taskAssignedTo')?.hasAttribute('hidden'));
    const taskSubtaskAdd = doc.getElementById('taskSubtaskAddBtn');
    check('Tasks subtask add action is anchored above the editable subtask list', !!taskSubtaskAdd && taskSubtaskAdd.closest('.task-subtask-list-toolbar') && html.indexOf('id="taskSubtaskAddBtn"') > html.indexOf('id="taskSubtaskDraftStatus"') && html.indexOf('id="taskSubtaskAddBtn"') < html.indexOf('id="taskSubtasksList"') && html.includes('.task-subtask-list-toolbar'));
    check('Tasks quick add exposes daily capture defaults', !!doc.getElementById('taskCategory') && !!doc.getElementById('taskPriority') && !!doc.getElementById('taskDuePresets') && !!doc.querySelector('[data-due-preset="today"].active') && !!doc.querySelector('[data-due-preset="tomorrow"]') && !!doc.querySelector('[data-due-preset="no_date"]') && !!doc.querySelector('[data-due-preset="custom"]'));
    check('Tasks quick add exposes reschedule permission control', !!doc.getElementById('taskAllowReschedule') && tasksCode.includes('allowReschedule: document.getElementById') && taskCreateCodeForTasks.includes('controlMeta.canReschedule'));
    check('Tasks quick add avoids hidden assignee ghost field', html.includes('.task-assignee-select[hidden]') && html.includes('display: none !important') && tasksCode.includes("select.setAttribute('aria-hidden', 'true')") && tasksCode.includes('select.disabled = true'));
    check('Tasks quick add supports multi-create rows with inherited defaults', !!doc.getElementById('addTaskRowBtn') && !!doc.getElementById('taskBatchPanel') && !!doc.getElementById('taskBatchList') && tasksCode.includes('quickTaskBatchItems') && tasksCode.includes('createQuickTaskBatchItem(taskBatchSourceDraft())') && tasksCode.includes('buildTaskCreatePayload') && tasksCode.includes('quickTaskBatchItems.map(taskDraftFromBatchItem)'));
    check('Tasks create success toast carries details and an edit path', html.includes('js/sound-engine.js') && tasksCode.includes('function showTaskCreateSuccessToast') && tasksCode.includes('window.TaskCreate.buildCreateNotification') && tasksCode.includes("label: 'Відкрити'") && tasksCode.includes('postCreateWarningCount') && taskCreateCodeForTasks.includes('function buildCreateNotification') && taskCreateCodeForTasks.includes('Створено на:') && !tasksCode.includes('Задачу створено, але частину деталей треба перевірити'));
    check('Tasks multi-create rows use unique dynamic controls and per-item overrides', tasksCode.includes('data-task-batch-field="priority"') && tasksCode.includes('data-task-batch-field="duePreset"') && tasksCode.includes('data-task-batch-field="scheduleDate"') && tasksCode.includes('data-task-batch-remove') && html.includes('.task-batch-fields'));
    check('Tasks row actions use delegated stable contract', tasksCode.includes('function setupTaskActionDelegation') && tasksCode.includes('data-task-action="status"') && tasksCode.includes('data-task-action="schedule"') && tasksCode.includes('data-task-open="true"') && !tasksCode.includes('onclick="openTaskDetail'));
    check('Tasks overdue due badge opens canonical reschedule choices', tasksCode.includes('data-task-action="reschedule-overdue-menu"') && tasksCode.includes('data-task-action="reschedule-overdue"') && tasksCode.includes("['day_after', 'Післязавтра']") && tasksCode.includes("sourceSurface: 'task_page_overdue_badge'") && html.includes('.task-reschedule-menu'));
    check('Tasks operation pack is gated to operational categories', tasksCode.includes('function shouldShowOperationPackBar') && tasksCode.includes("currentCategory === 'orders' || currentCategory === 'checklist'") && html.includes('.tasks-page .operations-pack-bar[hidden]'));
    check('Tasks detail has observer materials access controls', tasksCode.includes('apiGetTaskObservers') && tasksCode.includes('apiSaveTaskObservers') && tasksCode.includes('_tdObservers') && tasksCode.includes('Спостерігачі і матеріали') && tasksCode.includes('saveTaskObservers'));
    check('Tasks task-kind and governance labels avoid visible English drift', tasksCode.includes("followup: 'Дотиск'") && tasksCode.includes("deep_work: 'Глибока робота'") && tasksCode.includes("checklist: 'Чеклист'") && tasksCode.includes('Звичайний список показує основні рядки') && !tasksCode.includes('Звичайний список показує canonical-рядки') && !tasksCode.includes("followup:'Follow-up'") && !tasksCode.includes("deep_work:'Deep work'"));
});

checkPage('reports.html', (doc, html) => {
    const reportsCode = fs.readFileSync(path.join(ROOT, 'js', 'reports-page.js'), 'utf8');
    const reportsRoutes = fs.readFileSync(path.join(ROOT, 'routes', 'reports.js'), 'utf8');
    const removedChartText = ['Динаміка прибутку', 'Витрати по категоріях', 'Доходи vs Витрати (по днях)'];
    check('Reports page removes low-signal chart blocks', removedChartText.every(text => !html.includes(text)));
    check('Reports page has no chart canvases or Chart.js CDN', !doc.getElementById('barChart') && !doc.getElementById('pieChart') && !doc.getElementById('lineChart') && !html.includes('cdn.jsdelivr.net/npm/chart.js'));
    check('Reports page script no longer renders Chart.js widgets', !reportsCode.includes('renderCharts') && !reportsCode.includes('new Chart(') && !reportsCode.includes('rpt-chart'));
    check('Reports manual modal uses page-scoped polished controls', !!doc.querySelector('#reportModal .rpt-report-modal') && html.includes('#reportForm select.form-control') && html.includes('appearance: none') && html.includes('rpt-hashtag-controls') && !html.includes('id="reportHashtagSelect" class="form-control" style='));
    check('Reports page exposes compact template-driven table workspace', !!doc.getElementById('report-template-workspace') && !!doc.getElementById('reportTemplatePicker') && !!doc.getElementById('reportTemplateActiveChip') && !!doc.getElementById('reportSheetTable') && !!doc.getElementById('reportTemplateUpload'));
    check('Reports template workflow supports standard/uploaded schemas and CSV export', reportsCode.includes('const REPORT_TABLE_TEMPLATES') && reportsCode.includes('function loadReportTemplate') && reportsCode.includes('function importReportTemplateFile') && reportsCode.includes('function exportReportTemplateCsv') && reportsCode.includes('reportTableTemplate'));
    check('Reports standard park template has controlled category/document fields and dar subtotal', reportsCode.includes('park-standard-report') && reportsCode.includes('PARK_STANDARD_CATEGORIES') && reportsCode.includes('PARK_STANDARD_DOCUMENTS') && reportsCode.includes('Ітого ДАР') && reportsCode.includes("type: 'select'"));
    check('Reports template workspace has draft/import/XLSX controls', !!doc.getElementById('reportTemplateDraftBtn') && !!doc.getElementById('reportTemplateImportCsvBtn') && !!doc.getElementById('reportTemplateExportXlsxBtn') && !!doc.getElementById('reportDraftList'));
    check('Reports template save uses durable backend workspace contract', reportsCode.includes('/api/reports/templates') && reportsCode.includes('/api/reports/drafts') && reportsCode.includes('function saveReportTemplateDraft') && reportsCode.includes('function exportReportTemplateXlsx') && reportsCode.includes("submittedVia: 'web-template'"));
    check('Reports builder exposes stable management state controls', !!doc.getElementById('reportSheetTitleInput') && !!doc.getElementById('reportSheetModeChip') && !!doc.getElementById('reportTemplateDirty') && !!doc.getElementById('reportSheetSummary') && reportsCode.includes('function refreshReportWorkspaceControls') && reportsCode.includes('function validateReportTableForCreate'));
    check('Reports builder protects table state and supports row/column management', reportsCode.includes('confirmDiscardReportTableChanges') && reportsCode.includes('data-report-row-duplicate') && reportsCode.includes('data-report-column-delete') && reportsCode.includes('function deleteReportTemplateColumn'));
    check('Reports accountant handoff is a prominent final-step CTA', !!doc.getElementById('reportFinalHandoff') && !!doc.querySelector('.rpt-final-handoff-btn#reportTemplateCloseBtn') && !doc.querySelector('.rpt-template-actions #reportTemplateCloseBtn') && html.includes('Фінальний етап') && reportsCode.includes('Останній крок роботи зі звітом'));
    check('Reports close flow persists locked accountant handoff state', !!doc.getElementById('reportTemplateCloseBtn') && reportsCode.includes('function closeReportTemplate') && reportsCode.includes('/api/reports/table/close') && reportsRoutes.includes("router.post('/table/close'") && reportsRoutes.includes('report_lifecycle_status') && reportsRoutes.includes('locked_snapshot') && reportsRoutes.includes('createReportHandoffTask') && reportsRoutes.includes("source_type: 'report'") && reportsRoutes.includes("duplicateMode: 'skip'"));
    check('Reports accountant approval workflow is task-backed and configurable', !!doc.getElementById('reportApprovalWorkflow') && !!doc.getElementById('reportApprovalAssignee') && reportsCode.includes('function saveWorkflowSettings') && reportsCode.includes('renderApprovalBadge') && reportsRoutes.includes("router.get('/workflow-settings'") && reportsRoutes.includes("router.post('/:id/request-approval'") && reportsRoutes.includes('approval_task_id') && reportsRoutes.includes('owner_user_id: reviewer?.id'));
    check('Reports template reports do not create visible technical hashtag toggles', reportsCode.includes('function isTechnicalReportHashtag') && reportsCode.includes('templateReportHashtags') && reportsCode.includes('visibleReportHashtags'));
});

// ═══════════════════════════════════════════════════
// JS FILE CHECKS
// ═══════════════════════════════════════════════════

console.log('\nbase CSS');
const baseCss = fs.readFileSync(path.join(ROOT, 'css', 'base.css'), 'utf8');
const alertsCode = fs.readFileSync(path.join(ROOT, 'js', 'alerts.js'), 'utf8');
const omniAlertBranchIndex = alertsCode.indexOf('_isOmniAccountAlert(a)');
const genericAlertActionIndex = alertsCode.indexOf('} else if (a.action)');
check('Notifications dark mode defines local text contrast tokens', baseCss.includes('body.dark-mode .alerts-panel-v4') && baseCss.includes('--ap-text-primary: #F8FAFC') && baseCss.includes('--ap-text-secondary: #CBD5E1') && baseCss.includes('--ap-text-muted: #94A3B8'));
check('Notifications dark mode overrides primary text color', baseCss.includes('body.dark-mode .ap-title') && baseCss.includes('body.dark-mode .ap-item-title') && baseCss.includes('body.dark-mode .ap-empty-text'));
check('Notifications dark mode overrides secondary and meta text color', baseCss.includes('body.dark-mode .ap-item-desc') && baseCss.includes('body.dark-mode .ap-count') && baseCss.includes('body.dark-mode .ap-group-title'));
check('Notifications dark mode keeps read items readable', baseCss.includes('body.dark-mode .ap-item.read') && baseCss.includes('opacity: 1') && baseCss.includes('body.dark-mode .ap-item.read .ap-item-title'));
check('Notifications dark mode covers alert variants', baseCss.includes('body.dark-mode .ap-item.warning .ap-icon') && baseCss.includes('body.dark-mode .ap-item.critical .ap-icon') && baseCss.includes('body.dark-mode .ap-item.info .ap-icon'));
check('Notifications route Omni account alerts to the connection workspace', alertsCode.includes('function _isOmniAccountAlert') && alertsCode.includes("source === 'omni_accounts'") && alertsCode.includes("link.startsWith('/omni?panel=accounts')") && omniAlertBranchIndex > -1 && genericAlertActionIndex > omniAlertBranchIndex);
check('Notifications avoid panel rerenders for unchanged websocket alert payloads', alertsCode.includes('function _alertsFingerprint') && alertsCode.includes('function _replaceAlertsData') && alertsCode.includes("if (p?.classList.contains('open') && changed) _renderPanel();"));

console.log('\ndark mode contrast CSS');
const darkModeCss = fs.readFileSync(path.join(ROOT, 'css', 'dark-mode.css'), 'utf8');
const catalogCss = fs.readFileSync(path.join(ROOT, 'css', 'catalog.css'), 'utf8');
const contentCss = fs.readFileSync(path.join(ROOT, 'css', 'content.css'), 'utf8');
const achievementsCss = fs.readFileSync(path.join(ROOT, 'css', 'achievements.css'), 'utf8');
const profilePageHtml = fs.readFileSync(path.join(ROOT, 'profile.html'), 'utf8');
const profileCode = fs.readFileSync(path.join(ROOT, 'js', 'profile-page.js'), 'utf8');
const profileApiCode = fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8');
const profileSidebarCode = fs.readFileSync(path.join(ROOT, 'js', 'components', 'sidebar.js'), 'utf8');
const reportsPageCode = fs.readFileSync(path.join(ROOT, 'js', 'reports-page.js'), 'utf8');
const authRouteCode = fs.readFileSync(path.join(ROOT, 'routes', 'auth.js'), 'utf8');
const profileAvatarStorageCode = fs.readFileSync(path.join(ROOT, 'services', 'profileAvatarStorage.js'), 'utf8');
const serverCode = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const taskCreateCode = fs.readFileSync(path.join(ROOT, 'js', 'task-create.js'), 'utf8');
const tasksPageCodeForProfileChecks = fs.readFileSync(path.join(ROOT, 'js', 'tasks-page.js'), 'utf8');
const tasksHtmlForProfileChecks = fs.readFileSync(path.join(ROOT, 'tasks.html'), 'utf8');
const soundEngineCodeForProfileChecks = fs.readFileSync(path.join(ROOT, 'js', 'sound-engine.js'), 'utf8');
const profilePagesCss = cssTextWithImports('css/pages.css');
const questsRouteCode = fs.readFileSync(path.join(ROOT, 'routes', 'quests.js'), 'utf8');
const renderMyTasksBody = profileCode.match(/function renderMyTasksTab\(\) \{[\s\S]*?\n\}/)?.[0] || '';
const renderMyDayBody = profileCode.match(/function renderMyDayTab\(\) \{[\s\S]*?\n\}/)?.[0] || '';
const renderMyDayCommandCenterBody = profileCode.match(/function renderMyDayCommandCenterTab\(\) \{[\s\S]*?\n\}/)?.[0] || '';
const cabinetTaskSegmentsBody = profileCode.match(/const CABINET_TASK_SEGMENTS = \[[\s\S]*?\];/)?.[0] || '';
check('Dark mode defines shared text aliases', darkModeCss.includes('--text: #F8FAFC;') && darkModeCss.includes('--text-primary: #F8FAFC;') && darkModeCss.includes('--text-secondary: #CBD5E1;') && darkModeCss.includes('--text-muted: #94A3B8;'));
check('Dark mode defines shared surface/card aliases', darkModeCss.includes('--surface: #1E1E38;') && darkModeCss.includes('--card-bg: #1E1E38;') && darkModeCss.includes('--bg-card: #1E1E38;') && darkModeCss.includes('--border-color: rgba(255,255,255,0.12);'));
check('Dark placeholders and empty states use readable muted token', darkModeCss.includes('body.dark-mode .program-search-input::placeholder { color: var(--text-muted); }') && darkModeCss.includes('body.dark-mode .login-form input::placeholder') && darkModeCss.includes('body.dark-mode .empty-state-hint { color: var(--text-muted); }'));
check('Dark native selects keep opened options readable', darkModeCss.includes('body.dark-mode select option') && darkModeCss.includes('body.dark-mode select option:checked') && darkModeCss.includes('color-scheme: dark;'));
check('Dark customer/task muted labels avoid low-contrast gray', darkModeCss.includes('body.dark-mode .customer-age { color: var(--text-muted); }') && darkModeCss.includes('body.dark-mode .task-no-assignee { color: var(--text-muted); }') && !darkModeCss.includes('body.dark-mode .customer-age { color: #64748B; }'));
check('Dark global search has an authoritative readable fallback in shared dark CSS', darkModeCss.includes('v0.61.56: global search must stay readable') && darkModeCss.includes('html[data-theme="dark"] .search-container') && darkModeCss.includes('#101827') && darkModeCss.includes('body.dark-mode .search-result-title') && darkModeCss.includes('body.dark-mode .search-result-subtitle') && darkModeCss.includes('body.dark-mode .search-empty') && darkModeCss.includes('body.dark-mode .search-result-badge') && darkModeCss.includes('opacity: 1'));
check('Dark catalog muted text avoids low-alpha white', catalogCss.includes('body.dark-mode .catalog-card-meta { color: var(--text-muted, #94A3B8); }') && catalogCss.includes('body.dark-mode .cat-page-detail { color: var(--text-muted, #94A3B8); }') && !catalogCss.includes('body.dark-mode .catalog-card-meta { color: rgba(255,255,255,0.4); }'));
check('Dark content/profile muted CTAs use readable muted token', contentCss.includes('body.dark-mode .content-bcard-slug { color: var(--text-muted, #94A3B8); }') && achievementsCss.includes('body.dark-mode .add-note-btn { border-color: #3D3D5C; color: var(--text-muted, #94A3B8); }'));
check('Profile dark mode defines readable local text tokens', profilePageHtml.includes('--profile-dark-text: #F8FAFC;') && profilePageHtml.includes('--profile-dark-secondary: #CBD5E1;') && profilePageHtml.includes('--profile-dark-muted: #94A3B8;'));
check('Profile dark mode uses text tokens for primary work content', profilePageHtml.includes('body.dark-mode .profile-identity-copy h1') && profilePageHtml.includes('body.dark-mode .profile-task-row b') && profilePageHtml.includes('color: var(--profile-dark-text);'));
check('Profile dark mode covers primary tabs and cabinet cards', profilePageHtml.includes('body.dark-mode .profile-primary-tab.active') && profilePageHtml.includes('body.dark-mode .profile-secondary-tab.active') && profilePageHtml.includes('body.dark-mode .cabinet-task-section') && profilePageHtml.includes('body.dark-mode .cabinet-capture input'));
check('Profile work header uses friendly composed desktop polish', profilePageHtml.includes('grid-template-columns: minmax(360px, 0.95fr) minmax(480px, 1.05fr);') && profileCode.includes('profile-friendly-shell') && profilePageHtml.includes('.profile-identity-title-row') && profilePageHtml.includes('.profile-identity-meta-row') && profilePageHtml.includes('.profile-work-stat.wide') && profilePageHtml.includes('grid-column: auto;') && profilePageHtml.includes('.profile-work-stat:hover') && profilePageHtml.includes('@media (max-width: 1320px)'));
check('Profile work shell behaves as a full-width CRM module', profilePageHtml.includes('width: min(100%, 1760px);') && profilePageHtml.includes('min-height: calc(100vh - 64px);') && profilePageHtml.includes('margin: 0 auto;') && !profilePageHtml.includes('max-width: min(1360px, calc(100vw - 320px));'));
check('Profile snapped desktop layout is guarded by content-width container queries', profilePageHtml.includes('container-name: profile-work;') && profilePageHtml.includes('@container profile-work (max-width: 1040px)') && profilePageHtml.includes('@container profile-work (max-width: 860px)') && profilePageHtml.includes('@media (min-width: 769px) and (max-width: 1180px)') && profilePageHtml.includes('#main-content.page-container') && profilePageHtml.includes('profile-secondary-work-menu .profile-secondary-tabs'));
check('Profile professions hub uses controlled desktop section spans', profilePageHtml.includes('grid-template-columns: repeat(12, minmax(0, 1fr));') && profilePageHtml.includes('.profile-professions-hub') && profilePageHtml.includes('.profile-profession-hero') && profilePageHtml.includes('.profile-profession-checklist-panel') && profilePageHtml.includes('.profile-profession-active-panel'));
check('Profile overview cockpit uses configurable clickable widgets with tooltips', profileCode.includes('const PROFILE_COCKPIT_WIDGETS') && profileCode.includes("id: 'next_shift'") && profileCode.includes('function renderProfileCockpitWidgetStrip') && profileCode.includes('data-profile-widget-target') && profileCode.includes('data-profile-tooltip-toggle') && profileCode.includes('function renderProfileWidgetSettingsPanel') && profileCode.includes('/auth/profile/cockpit-widgets') && profilePageHtml.includes('.profile-cockpit-widget') && profilePageHtml.includes('.profile-cockpit-tooltip') && profilePageHtml.includes('.profile-widget-config-panel'));
check('Profile replaces Огляд with professions work hub and keeps legacy tab fallback', profileCode.includes("let activeTab = 'professions'") && profileCode.includes('function profileWorkHubTabOrder') && profileCode.includes("label: 'Професії'") && profileCode.includes("label: 'Чеклісти'") && profileCode.includes("label: 'Матеріали'") && !profileCode.includes("renderProfilePrimaryTab('profile', 'Огляд')") && profileCode.includes('function normalizeProfileTab') && profileCode.includes("const requested = tab === 'profile' ? 'professions' : tab;") && profileCode.includes('function renderProfileProfessionsTab') && profileCode.includes('PROFILE_PROFESSION_GUIDES'));
check('Profile professions work hub uses active role, checklist, materials and next-shift data', profileCode.includes('Активний професійний контекст') && profileCode.includes('Чекліст активної професії') && profileCode.includes('function renderProfileMaterialsTab') && profileCode.includes('/training/knowledge-base?role=') && profileCode.includes('profileProfessionChecklistTasks') && profileCode.includes('profileShiftValue(nextShift)') && !profileCode.includes('<h2>Робочий стан</h2>') && authRouteCode.includes('profile_cockpit_widgets') && authRouteCode.includes('nextShift') && authRouteCode.includes('COUNT(*)::int AS total'));
check('Profile work routes use the compact profile tab row instead of large access cards', profileCode.includes('function profileWorkHubTabOrder') && profileCode.includes('function profileSecondaryTabOrder') && profileCode.includes('...profileWorkHubTabOrder().map') && !profileCode.includes('renderProfileWorkHubTabs(professionEntries)') && profileCode.includes('function renderProfilePrimaryTab') && profileCode.indexOf("id: 'professions'") < profileCode.indexOf("id: 'checklists'") && profileCode.indexOf("id: 'checklists'") < profileCode.indexOf("id: 'materials'") && profileCode.includes("id: 'settings'") && profilePageHtml.includes('.profile-secondary-work-menu') && profilePageHtml.includes('.profile-secondary-tabs') && profilePageHtml.includes('body.dark-mode .profile-secondary-tab.active'));
check('Profile cabinet task actions use delegated buttons and canonical task deeplink', profileCode.includes('function handleCabinetTaskActionClick') && profileCode.includes('data-cabinet-task-action="done"') && profileCode.includes('data-cabinet-task-action="more"') && profileCode.includes("'data-cabinet-task-action': 'open'") && profileCode.includes("'data-cabinet-task-action': 'move-target'") && profileCode.includes('/tasks?view=my&open=') && profileCode.includes('/tasks/${id}/complete') && profileCode.includes('/tasks/${id}/snooze') && !profileCode.includes('onclick="setCabinetTaskStatus') && !profileCode.includes("'/tasks?task="));
check('Profile cabinet task action buttons expose Ukrainian hover help', profileCode.includes('data-tooltip="${escapeHtml(doneActionLabel)}"') && profileCode.includes("const doneActionLabel = 'Виконати задачу';") && profileCode.includes("const snoozeActionLabel = 'Відкласти задачу';") && profileCode.includes("const openActionLabel = 'Відкрити задачу у повному списку';") && profilePagesCss.includes('.cabinet-task-actions button[data-tooltip]::after') && profilePagesCss.includes('.cabinet-task-action-done') && !profileCode.includes('title="Snooze"'));
check('Profile cabinet task actions expose undo, CRM snooze modal, and due badges', profileCode.includes('function showCabinetTaskUndoToast') && profileCode.includes('data-cabinet-task-action="snooze-menu"') && profileCode.includes("['1440', 'Завтра']") && profileCode.includes('data-task-due-state') && profileCode.includes('promptModal(') && profileCode.includes('відкласти задачу?') && !profileCode.includes('window.prompt(') && profilePagesCss.includes('.cabinet-snooze-menu') && profilePagesCss.includes('.cabinet-task-undo-toast') && profilePagesCss.includes('.cabinet-task-due-badge--overdue'));
check('Profile cabinet removes redundant task action legend row', !profileCode.includes('function renderCabinetTaskActionLegend') && !profileCode.includes('cabinet-action-legend') && !profilePagesCss.includes('.cabinet-action-legend'));
check('Profile overdue due badge opens reschedule choices and respects permission control', profileCode.includes('data-cabinet-task-action="reschedule-overdue-menu"') && profileCode.includes('data-cabinet-task-action="reschedule-overdue"') && profileCode.includes("['today', 'Сьогодні']") && profileCode.includes("['day_after', 'Післязавтра']") && profileCode.includes("'profile_my_cabinet_overdue_badge'") && profileCode.includes('cabinetTaskAllowReschedule') && profilePagesCss.includes('.cabinet-reschedule-menu'));
check('Profile my day supports persisted move-to-today drag for overdue and typed planned tasks', profileCode.includes('data-cabinet-task-drag="${dragKind}"') && profileCode.includes('data-cabinet-task-drag-target="today"') && profileCode.includes('data-cabinet-task-drop-target="today"') && profileCode.includes('function handleCabinetTaskDrop') && profileCode.includes('function moveCabinetTaskToToday') && profileCode.includes("profile_my_cabinet_overdue_to_today_drop") && profileCode.includes("profile_my_cabinet_move_to_today_drop") && profilePagesCss.includes('.cabinet-task-section--drop-target.is-drag-over') && profilePagesCss.includes('.cabinet-task-move-today'));
check('Profile cabinet tasker has canonical My Day projection and default-collapsed composer', profileCode.includes('const CABINET_TASK_SEGMENTS') && profileCode.includes('function cabinetTaskMatchesSegment') && profileCode.includes('function cabinetSegmentCounts') && profileCode.includes('function renderCabinetTaskComposer') && profileCode.includes('data-cabinet-composer-state=') && profileCode.includes("'expanded' : 'collapsed'") && profileCode.includes('data-cabinet-composer-toggle') && profileCode.includes('data-cabinet-composer-advanced') && profileCode.includes('function setCabinetTaskComposerExpanded') && profileCode.includes('function isCabinetPersonalTask') && profileCode.includes("visibility === 'me_only'") && profileCode.includes("category === 'improvement'") && profileCode.includes('function normalizeProfileTaskTab') && profileCode.includes("return tab === 'mytasks' ? 'myday' : tab;") && profileCode.includes('function syncProfileTabToUrl') && profileCode.includes('data-cabinet-due-preset') && profileCode.includes('data-cabinet-priority-preset') && profilePagesCss.includes('.cabinet-task-composer.is-collapsed') && profilePagesCss.includes('[data-cabinet-composer-advanced][hidden]') && profilePagesCss.includes('.cabinet-task-priority') && profilePagesCss.includes('.cabinet-priority-chip'));
check('Profile cabinet subtask add action is anchored above the editable subtask list', profileCode.includes('class="cabinet-subtask-list-toolbar"') && profileCode.indexOf('onclick="addCabinetSubtask()"') > profileCode.indexOf('id="cabinetSubtaskDraftStatus"') && profileCode.indexOf('onclick="addCabinetSubtask()"') < profileCode.indexOf('id="cabinetSubtaskList"') && profilePagesCss.includes('.cabinet-subtask-list-toolbar'));
check('Profile my day decomposed task cards collapse without hiding progress truth', profileCode.includes('function cabinetTaskIsDecomposed') && profileCode.includes("activeTab === 'myday'") && profileCode.includes('is-subtasks-collapsed') && profileCode.includes('is-subtasks-expanded') && profileCode.includes('function renderCabinetSubtaskCollapsedSummary') && profileCode.includes('aria-controls="cabinetSubtasksPanel') && profilePagesCss.includes('.cabinet-task-card.is-subtasks-collapsed') && profilePagesCss.includes('.cabinet-subtask-compact-summary') && profilePagesCss.includes('.cabinet-subtask-toggle::after'));
check('Profile my tasks duplicate is neutralized into My Day plus canonical Tasks link', renderMyDayBody.includes('return renderMyDayCommandCenterTab();') && renderMyDayCommandCenterBody.includes('renderCabinetTaskComposer') && renderMyDayCommandCenterBody.includes('renderCabinetPulseCluster()') && renderMyTasksBody.includes('return renderMyDayTab();') && profileCode.includes('function normalizeProfileTaskTab') && profileCode.includes("case 'mytasks': return renderMyDayTab();") && profileCode.includes('href="/tasks?view=today"') && profileCode.includes('href="/tasks?view=waiting"') && profileCode.includes('cabinet-command-center') && !profileCode.includes("setCabinetQuickMode('tasks')") && !profileCode.includes('href="/profile?tab=mytasks"') && !profileCode.includes('cabinet-shell--mytasks'));
const legacyProfileNewLeadPath = ['/api/leads', 'new-count'].join('/');
const legacyProfileApiGetNewLead = "apiGet('/leads/" + "new-count'";
check('Profile cabinet pulse uses canonical business-scoped live counters', profileCode.includes('function apiGetScoped') && profileCode.includes("apiGetScoped('/business/live-counters')") && profileCode.includes('function profileLiveCounterBucket') && profileCode.includes('function syncCabinetPulseCounts(liveCounters)') && profileCode.includes('bucket.alerts?.active') && profileCode.includes('safeCabinetPulseCount(leads.hot) || safeCabinetPulseCount(leads.new)') && !profileCode.includes(legacyProfileApiGetNewLead) && !profileCode.includes(legacyProfileNewLeadPath) && !profileCode.includes("apiGet('/dashboard/alerts'"));
check('Profile my day completed history strip uses real done task payload and accessible day groups', renderMyDayCommandCenterBody.includes('renderCabinetCompletedHistoryStrip()') && profileCode.includes('function renderCabinetCompletedHistoryStrip') && profileCode.includes('function renderCabinetCompletedHistoryTile') && profileCode.includes('function groupCabinetCompletedHistoryByDay') && profileCode.includes('function renderCabinetCompletedDayDivider') && profileCode.includes('data-cabinet-completed-day-divider') && profileCode.includes('aria-describedby=') && profilePagesCss.includes('.cabinet-completed-strip') && profilePagesCss.includes('.cabinet-completed-tile:focus-visible') && profilePagesCss.includes('.cabinet-completed-day-divider') && profilePagesCss.includes('.cabinet-completed-day-stats') && profilePagesCss.includes('.cabinet-completed-detail') && htmlContains('routes/tasks.js', 'completedHistoryLimit') && htmlContains('routes/tasks.js', "COALESCE(t.status, 'todo') = 'done'") && htmlContains('routes/tasks.js', 'completedHistoryOverflow'));
check('Profile task creation reuses canonical TaskCreate adapter', profilePageHtml.includes('js/task-create.js') && fs.readFileSync(path.join(ROOT, 'tasks.html'), 'utf8').includes('js/task-create.js') && profileCode.includes('window.TaskCreate.buildPayload') && profileCode.includes('window.TaskCreate.createTask') && profileCode.includes('showCabinetTaskCreateSuccessToast') && profileCode.includes('window.TaskCreate.buildCreateNotification') && !profileCode.includes('Задачу створено, але частину деталей треба перевірити') && taskCreateCode.includes('window.TaskCreate') && taskCreateCode.includes('buildPayload') && taskCreateCode.includes('createTask') && taskCreateCode.includes('buildCreateNotification') && taskCreateCode.includes('/tasks'));
check('Profile tasker completion replaces waiting primary segment and gates report-backed completion', cabinetTaskSegmentsBody.includes("{ id: 'actionable', label: 'Виконати'") && !cabinetTaskSegmentsBody.includes("{ id: 'waiting', label: 'Чекаю'") && profileCode.includes('cabinetTaskReportBadge') && profileCode.includes('cabinetTaskReportRequired') && profileCode.includes('window.TaskReportGate.openReportModal') && taskCreateCode.includes('window.TaskReportGate') && taskCreateCode.includes('/completion-report') && profilePagesCss.includes('.cabinet-task-report-badge'));
check('Profile tasker completion gives instant local feedback', profileCode.includes('function applyCabinetTaskStatusToProjection') && profileCode.includes("playTask?.('task-complete')") && profilePageHtml.includes('js/sound-engine.js') && profilePagesCss.includes('.cabinet-task-card.is-completed-feedback') && profilePagesCss.includes('@keyframes cabinetTaskComplete'));
check('Profile and Tasks expose quick priority, deferred bucket, and task-scoped sound controls', profileCode.includes('data-cabinet-task-priority-select') && profileCode.includes('renderCabinetTaskSoundControls') && profileCode.includes("renderCabinetSection('Відкладено'") && tasksPageCodeForProfileChecks.includes('data-task-priority-select') && tasksPageCodeForProfileChecks.includes("case 'deferred'") && tasksHtmlForProfileChecks.includes('data-view="deferred"') && tasksHtmlForProfileChecks.includes('id="taskSoundControls"') && tasksHtmlForProfileChecks.includes('js/sound-engine.js') && soundEngineCodeForProfileChecks.includes('task_sound_settings') && soundEngineCodeForProfileChecks.includes('playTask: function') && soundEngineCodeForProfileChecks.includes('_taskSoftChime') && !soundEngineCodeForProfileChecks.includes("localStorage.getItem('chat_sound_settings');\n                this.taskSettings"));
check('Profile tasker copy avoids canonical/cockpit leaks and removes noisy productivity panel', profileCode.includes('Додати в мій робочий простір') && profileCode.includes('Задачу створено в основних задачах') && !profileCode.includes('Додати в мій cockpit') && !profileCode.includes('canonical Tasks') && !profileCode.includes('Productivity cockpit') && !profileCode.includes('renderCabinetProductivitySurface') && !profileCode.includes('/tasks/productivity') && !profilePagesCss.includes('cabinet-productivity-surface'));
check('Profile nav keeps work context and all profile tabs in one compact row', profileCode.includes('profile-work-hub-context') && profileCode.includes('profile-secondary-work-menu') && profileCode.includes('profile-secondary-tabs') && profileCode.includes('profile-primary-tab') && profileCode.includes('profileWorkHubTabOrder().map') && !profileCode.includes('class="profile-tab'));
check('Profile visual rebuild integrates profession summary and tab rail', profileCode.includes('profile-profession-header-stack-title') && profileCode.includes('profile-secondary-work-menu-head') && profileCode.includes('data-profile-tab-rail="true"') && profilePageHtml.includes('.profile-secondary-work-menu-head') && profilePageHtml.includes('.profile-secondary-work-menu .profile-primary-tab.active') && profilePageHtml.includes('body.dark-mode .profile-identity-block'));
check('Profile role area opens a truthful working-role flow control', profileCode.includes('function renderProfileWorkingRoleControl') && profileCode.includes('id="profileWorkingRoleTrigger"') && profileCode.includes('Base role') && profileCode.includes('Additional granted roles') && profileCode.includes('Current working role') && profileCode.includes('What changes in this mode') && profileCode.includes('data-profile-working-role') && profilePageHtml.includes('.profile-working-role-panel') && profilePageHtml.includes('.profile-working-role-trigger'));
const legacyProfileGameCode = fs.readFileSync(path.join(ROOT, 'js', 'auth.js'), 'utf8');
const profileFeaturesCss = fs.readFileSync(path.join(ROOT, 'css', 'features.css'), 'utf8');
check('Urgent tasks are visibly highlighted across profile and tasks surfaces', profileCode.includes('data-task-priority="${escapeHtml(priority)}"') && profileCode.includes('priority-${priority}') && profileCode.includes('profile-task-priority--${escapeHtml(priority)}') && profileCode.includes('cabinet-task-priority-select--${escapeHtml(selected)}') && legacyProfileGameCode.includes('urgent-priority high-priority') && legacyProfileGameCode.includes('prof-inbox-item danger${urgentCls}') && tasksPageCodeForProfileChecks.includes("data-priority=\"${escapeHtml(t.priority || 'normal')}\"") && tasksPageCodeForProfileChecks.includes('task-priority-select--${escapeHtml(current)}') && profilePagesCss.includes('.profile-task-row[data-task-priority="urgent"]') && profilePagesCss.includes('.profile-task-priority--urgent') && profilePagesCss.includes('body.dark-mode .profile-task-row[data-task-priority="urgent"]') && profilePagesCss.includes('.cabinet-task-card.priority-urgent') && profilePagesCss.includes('.cabinet-task-priority-select--urgent') && profilePagesCss.includes('.task-card[data-priority="urgent"]') && profilePagesCss.includes('.task-priority-select--urgent') && darkModeCss.includes('body.dark-mode .prof-task-row.urgent-priority') && darkModeCss.includes('body.dark-mode .task-card[data-priority="urgent"]'));
check('Profile unfinished tabs use role-aware soon lockdown', profileCode.includes('PROFILE_CREATOR_ONLY_TABS') && profileCode.includes("new Set(['inventory', 'shop'])") && profileCode.includes('PROFILE_ALWAYS_SOON_TABS') && profileCode.includes("new Set(['quests', 'season', 'teams', 'referral'])") && profileCode.includes('function profileTabLock') && profileCode.includes('function renderProfileComingSoon') && profileCode.includes("profileTabLock('inventory')") && profileCode.includes("profileTabLock('shop')") && profileCode.includes("profileTabLock('quests')"));
check('Profile soon tabs collapse into one compact menu', profileCode.includes('function renderProfileSoonMenu') && profileCode.includes('data-profile-soon-menu') && profileCode.includes('data-profile-soon-trigger') && profileCode.includes('function toggleProfileSoonMenu') && profileCode.includes('function switchProfileSoonTab') && profilePagesCss.includes('.profile-soon-menu-panel') && profilePagesCss.includes('.profile-soon-menu-trigger'));
check('Profile soon tabs have diagonal CRM badge styles', profilePageHtml.includes('.profile-primary-tab.is-soon::after') && profilePageHtml.includes('content: attr(data-profile-soon)') && profilePageHtml.includes('.profile-soon-panel') && profilePageHtml.includes('body.dark-mode .profile-primary-tab.is-soon') && profilePageHtml.includes('.profile-soon-ribbon'));
check('Legacy profile game sub-tabs keep creator-only shop and inventory guard', legacyProfileGameCode.includes('function _gameSubTabLock') && legacyProfileGameCode.includes('function _profileGameIsCreator') && legacyProfileGameCode.includes('function _renderGameComingSoon') && legacyProfileGameCode.includes("_gameSubTabLock('inventory')") && legacyProfileGameCode.includes("_gameSubTabLock('shop')") && profileFeaturesCss.includes('.game-sub-tab.is-soon::after') && profileFeaturesCss.includes('.game-coming-soon'));
check('Profile reward claim surfaces use shared pending refresh contract', profileCode.includes('let rewardClaimPending = new Set()') && profileCode.includes('function renderRewardClaimButton') && profileCode.includes('function refreshProfileRewardSurfaces') && profileCode.includes("isRewardClaimPending('quest'") && profileCode.includes("isRewardClaimPending('season'"));
check('Profile achievements use auto-award state language without fake manual claim', profileCode.includes('function checkProfileAutoRewards') && profileCode.includes('achievement-state--claimed') && profileCode.includes('achievement-state--progress') && !profileCode.includes('/achievements/claim'));
check('Quest claim route uses valid reward lookup SQL', questsRouteCode.includes('SELECT * FROM daily_quests WHERE id = $1 LIMIT 1') && !questsRouteCode.includes('LIMIT 200 WHERE id = $1'));
check('Profile settings supports clean avatar upload from device', profileCode.includes('id="profileAvatarFile"') && profileCode.includes("fetch('/api/auth/profile/avatar/upload'") && profileCode.includes('handleProfileAvatarFileChange') && profileCode.includes('clearProfileAvatarFile') && profilePageHtml.includes('.profile-avatar-upload-card') && profilePageHtml.includes('.profile-avatar-upload-actions') && profilePageHtml.includes('.profile-avatar-file-pick') && !profileCode.includes("saveProfileAvatar('emoji')") && !profilePageHtml.includes('.profile-avatar-emoji-grid'));
check('Profile avatar settings do not expose manual image URL entry', !profileCode.includes('profileAvatarUrl') && !profileCode.includes('previewProfileAvatarUrl') && !profileCode.includes('Вставити посилання на фото') && !profileCode.includes('Найзручніше — обрати фото з пристрою'));
check('Profile avatar crop stays synced across profile, sidebar and refresh verify', profileCode.includes('PROFILE_AVATAR_CROP_DEFAULT') && profileCode.includes('profileAvatarCropStorageKey') && profileCode.includes('profileAvatarCropStorageKeys') && profileCode.includes('profileAvatarCropUsesSession') && profileCode.includes('syncOwnProfileAvatarSession') && profileCode.includes('profileAvatarZoom') && profileCode.includes('saveProfileAvatarCrop') && profileCode.includes('applyProfileAvatarCropToImage') && profileCode.includes('object-fit:cover') && profilePagesCss.includes('.profile-avatar-crop-card') && profileSidebarCode.includes('_readSidebarAvatarCrop') && profileSidebarCode.includes('_applySidebarAvatarCrop') && profileSidebarCode.includes('_sidebarAvatarCropStorageKeys') && profileSidebarCode.includes("img.style.objectFit = 'cover'") && profileApiCode.includes('function mergeApiCurrentUser') && profileApiCode.includes('return mergeApiCurrentUser(data.user);'));
check('Profile avatar upload is Postgres-backed and keeps a readable public preview path', profileAvatarStorageCode.includes("PROFILE_AVATAR_STORAGE_PROVIDER = 'postgres'") && profileAvatarStorageCode.includes('storeProfileAvatarBlob') && profileAvatarStorageCode.includes('buildProfileAvatarBlobFallbackHandler') && profileAvatarStorageCode.includes('publicProfileAvatarUrl') && authRouteCode.includes("await client.query('BEGIN')") && authRouteCode.includes('query: client') && authRouteCode.includes('provider: stored.provider'));
check('Server reads Postgres-backed profile avatars before the legacy /uploads static fallback', serverCode.includes("app.get('/uploads/profile-avatars/*'") && serverCode.indexOf("app.get('/uploads/profile-avatars/*'") < serverCode.indexOf("app.use('/uploads', express.static"));
check('Profile settings exposes grouped personal account security controls', profileCode.includes("apiGet('/auth/security')") && profileCode.includes('function renderProfileSecurityPanel') && profileCode.includes('function openProfilePasswordModal') && profileCode.includes('/auth/security/revoke-sessions') && profileCode.includes('function normalizeProfileSecuritySessions') && profileCode.includes('tokenCount') && profilePageHtml.includes('.profile-security-panel') && profilePageHtml.includes('.profile-security-card'));
check('Profile cabinet quick cluster uses label-first segmented markup', profileCode.includes('function getCabinetQuickMode') && profileCode.includes('function syncCabinetQuickMode') && profileCode.includes('class="cabinet-quick-cluster"') && profileCode.includes('cabinet-quick-label') && profileCode.includes('cabinet-quick-hint') && profileCode.includes('cabinet-quick-count') && profileCode.includes('\\u0417\\u0430\\u0434\\u0430\\u0447\\u0456') && profileCode.includes('\\u0410\\u043b\\u0435\\u0440\\u0442\\u0438') && profileCode.includes('\\u0412\\u043e\\u0440\\u043e\\u043d\\u043a\\u0430'));
check('Profile cabinet quick cluster removed icon-first pulse markup', !profileCode.includes('cabinetPulseIcon') && !profileCode.includes('cabinet-pulse-icon') && !profileCode.includes('cabinet-pulse-btn') && !profileCode.includes('cabinet-pulse-count'));
check('Profile cabinet quick cluster CSS covers state, theme, mobile, and print', profilePagesCss.includes('.cabinet-quick-cluster') && profilePagesCss.includes('.cabinet-quick-hint') && profilePagesCss.includes('.cabinet-quick-segment--zero') && profilePagesCss.includes('.cabinet-quick-segment--hot') && profilePagesCss.includes('.cabinet-quick-segment--critical') && profilePagesCss.includes('body.dark-mode .cabinet-quick-cluster') && profilePagesCss.includes('@media print') && profilePagesCss.includes('page-break-inside: avoid') && !profilePagesCss.includes('.cabinet-pulse-icon'));

const criticalJS = [
    'js/config.js', 'js/kitchen-menu-images.js', 'js/api.js', 'js/auth.js', 'js/ui.js', 'js/app.js',
    'js/task-create.js',
    'js/assistant-rail.js',
    'js/components/sidebar.js',
    'js/art-director-page.js', 'js/center-page.js', 'js/demo-page.js',
    'js/designs-page.js', 'js/copilot-page.js',
    'js/dashboard-page.js', 'js/finance-page.js', 'js/analytics-page.js',
    'js/hr-page.js', 'js/staff-page.js', 'js/customers-page.js',
    'js/tasks-page.js', 'js/leads-page.js', 'js/chat-page.js', 'js/chat-settings-page.js', 'js/timeline-settings-page.js',
    'js/warehouse-page.js', 'js/reports-page.js', 'js/certificates-page.js', 'js/afisha-page.js', 'js/crm-feature-registry.js',
    'js/booking-drawer-state.js', 'js/booking-banquet-selector.js', 'js/booking-save-path.js',
    'js/booking.js', 'js/booking-summary-page.js', 'js/timeline-interaction-model.js',
    'js/timeline-cache.js', 'js/timeline-resource-identity.js', 'js/timeline-banquet-inspector-helpers.js', 'js/timeline.js', 'js/settings.js',
    'js/graduation.js', 'js/sound-page.js', 'js/guardian-ops-page.js',
];

for (const f of criticalJS) {
    checkJSFile(f);
}

// Check copilot exports
const copilotCode = fs.readFileSync(path.join(ROOT, 'js/copilot-page.js'), 'utf8');
check('CopilotPage has selectScript', copilotCode.includes('selectScript'));
check('CopilotPage has showAddInteractionForm', copilotCode.includes('showAddInteractionForm'));
check('CopilotPage has loadTrackerAlerts', copilotCode.includes('loadTrackerAlerts'));
check('Copilot workflow and cases calls use mounted /api/copilot contract', copilotCode.includes('function copilotApiUrl') && copilotCode.includes("return '/api/copilot'") && copilotCode.includes("await apiPut('/cases/' + caseId") && !copilotCode.includes("await apiPost('/cases/' + caseId"));

// Check shared logout binding ownership
console.log('\nshared logout binding');
const authCode = fs.readFileSync(path.join(ROOT, 'js', 'auth.js'), 'utf8');
const apiCodeForAuthSession = fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8');
const htmlFiles = fs.readdirSync(ROOT).filter(file => file.endsWith('.html'));
const brokenRootFavicons = htmlFiles.filter(file => /<link[^>]+href=["']images\/favicon\.ico["']/i.test(fs.readFileSync(path.join(ROOT, file), 'utf8')));
const pagesWithLogoutButton = htmlFiles
    .map(file => ({ file, html: fs.readFileSync(path.join(ROOT, file), 'utf8') }))
    .filter(page => /id=["']logoutBtn["']/.test(page.html));
const nonAuthJsLogoutOwners = walkFiles(path.join(ROOT, 'js'), file => file.endsWith('.js') && path.basename(file) !== 'auth.js')
    .filter(file => fs.readFileSync(file, 'utf8').includes('logoutBtn'));
const inlineLogoutOwners = pagesWithLogoutButton.filter(page => (
    getInlineScripts(page.html).some(code => code.includes('logoutBtn') && code.includes('addEventListener'))
));

check('Auth exposes shared bindLogoutButton', authCode.includes('function bindLogoutButton()') && authCode.includes("btn.dataset.logoutBound === '1'"));
check('Shared logout binding calls canonical logout', authCode.includes('event.preventDefault();') && authCode.includes('logout();'));
check('Shared logout binding auto-initializes', authCode.includes('initSharedLogoutBinding();') && authCode.includes("document.addEventListener('DOMContentLoaded', bindLogoutButton"));
check('Auth stores refresh sessions, refreshes verify, and revokes logout sessions',
    authCode.includes("const AUTH_REFRESH_TOKEN_KEY = 'pzp_refresh_token'")
    && authCode.includes('function rememberAuthSession')
    && authCode.includes('function hasStoredRefreshSession')
    && authCode.includes('function revokeStoredRefreshToken')
    && authCode.includes("fetch('/api/auth/logout'")
    && authCode.includes('localStorage.removeItem(AUTH_REFRESH_TOKEN_KEY)')
    && apiCodeForAuthSession.includes('function apiRefreshAuthToken')
    && apiCodeForAuthSession.includes('`${API_BASE}/auth/refresh`')
    && apiCodeForAuthSession.includes('const refreshedToken = await apiRefreshAuthToken()')
    && apiCodeForAuthSession.includes('function clearApiAuthSessionStorage'));
check('Auth separates real working roles from preview roles', authCode.includes("const ROLE_WORKING_STORAGE_KEY = 'pzp_working_role'") && authCode.includes('const WorkingRole = {') && authCode.includes('window.WorkingRole = WorkingRole') && authCode.includes('getAvailableWorkingRoles') && authCode.includes('getStoredPreviewRole(user) || getActiveWorkingRole(user)') && authCode.includes("window.dispatchEvent(new CustomEvent('workingRoleChanged'"));
check('Assistant idle hints are opt-in instead of boot-time default', authCode.includes('function shouldEnableAssistantIdleHints') && authCode.includes('eg_crm_assistant_idle_hints') && authCode.includes('shouldEnableAssistantIdleHints() && typeof IdleHints') && !authCode.includes("if (typeof IdleHints !== 'undefined') IdleHints.init();"));
check('Root CRM pages do not reference missing favicon.ico asset', brokenRootFavicons.length === 0);
check('All logout button pages load auth.js', pagesWithLogoutButton.every(page => getHtmlScripts(page.html).includes('js/auth.js')));
check('No page JS owns logoutBtn directly outside auth.js', nonAuthJsLogoutOwners.length === 0);
check('No inline logoutBtn click handlers remain', inlineLogoutOwners.length === 0);

// Check shared layout shell guardrails
console.log('\nlayout shell guardrails');
const fullAppShellPages = new Set(['chat.html', 'chat-settings.html', 'copilot.html', 'designer.html', 'index.html', 'omni.html', 'timeline-settings.html', 'training.html']);
const shellPages = htmlFiles
    .map(file => {
        const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
        const dom = new JSDOM(html);
        return { file, dom, doc: dom.window.document };
    })
    .filter(page => page.doc.querySelector('.sidebar-nav'));
const nestedShellPages = shellPages.filter(page => page.doc.querySelector('.page-container .main-content'));
const inlineOffsetPages = shellPages.filter(page => (
    [...page.doc.querySelectorAll('.page-container, main.main-content')]
        .some(el => /margin-left\s*:\s*(220px|200px|64px)/i.test(el.getAttribute('style') || ''))
));
const unexpectedMainShellPages = shellPages.filter(page => (
    !fullAppShellPages.has(page.file)
    && page.doc.querySelector('main.main-content')
    && !page.doc.querySelector('main#main-content.page-container')
));
const mainAppShellPages = shellPages.filter(page => page.doc.getElementById('mainApp'));
const missingHiddenMainAppPages = mainAppShellPages.filter(page => {
    const main = page.doc.getElementById('mainApp');
    return !main.classList.contains('main-app') || !main.classList.contains('hidden');
});
const sidebarLinkedPages = htmlFiles
    .map(file => {
        const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
        const dom = new JSDOM(html);
        return { file, dom, doc: dom.window.document, html };
    })
    .filter(page => page.html.includes('components/sidebar.js') || page.html.includes('sidebar-aurora.css') || page.html.includes('Sidebar.init'));
const sidebarLinkedPagesWithoutShell = sidebarLinkedPages.filter(page => (
    !page.doc.getElementById('sidebarNav') || !page.doc.getElementById('sidebarLinks')
));

check('No standard page nests main-content inside page-container', nestedShellPages.length === 0);
check('No shell containers use inline left offsets', inlineOffsetPages.length === 0);
check('Only documented full-app pages use main-content shell', unexpectedMainShellPages.length === 0);
check('All mainApp shells start from hidden main-app baseline', missingHiddenMainAppPages.length === 0);
check('Every page that loads shared sidebar assets has sidebarNav/sidebarLinks shell', sidebarLinkedPagesWithoutShell.length === 0);
shellPages.forEach(page => page.dom.window.close());
sidebarLinkedPages.forEach(page => page.dom.window.close());

// Check sidebar nav items
const sidebarCode = fs.readFileSync(path.join(ROOT, 'js/components/sidebar.js'), 'utf8');
const layoutCss = fs.readFileSync(path.join(ROOT, 'css/layout.css'), 'utf8');
const featuresCss = fs.readFileSync(path.join(ROOT, 'css/features.css'), 'utf8');
const searchCode = fs.readFileSync(path.join(ROOT, 'js/search.js'), 'utf8');
const searchRoutes = fs.readFileSync(path.join(ROOT, 'routes/search.js'), 'utf8');
const featureRegistryCode = fs.readFileSync(path.join(ROOT, 'js/crm-feature-registry.js'), 'utf8');
const sidebarAuroraCss = cssTextWithImports('css/sidebar-aurora.css');
const warehouseCode = fs.readFileSync(path.join(ROOT, 'js/warehouse-page.js'), 'utf8');
const responsiveCss = fs.readFileSync(path.join(ROOT, 'css/responsive.css'), 'utf8');
const settingsCode = fs.readFileSync(path.join(ROOT, 'js/settings.js'), 'utf8');
const apiCode = fs.readFileSync(path.join(ROOT, 'js/api.js'), 'utf8');
const appCode = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
const timelineCode = fs.readFileSync(path.join(ROOT, 'js/timeline.js'), 'utf8');
const timelineCacheCode = fs.readFileSync(path.join(ROOT, 'js/timeline-cache.js'), 'utf8');
const timelineResourceIdentityCode = fs.readFileSync(path.join(ROOT, 'js/timeline-resource-identity.js'), 'utf8');
const timelineBanquetInspectorHelpersCode = fs.readFileSync(path.join(ROOT, 'js/timeline-banquet-inspector-helpers.js'), 'utf8');
const timelineInteractionModelCode = fs.readFileSync(path.join(ROOT, 'js/timeline-interaction-model.js'), 'utf8');
const timelineResourcesTestCode = fs.readFileSync(path.join(ROOT, 'tests', 'timeline-resources.test.js'), 'utf8');
const timelineRegressionMatrixTestCode = fs.readFileSync(path.join(ROOT, 'tests', 'timeline-regression-matrix.test.js'), 'utf8');
const timelineUatRegressionMatrixDoc = fs.readFileSync(path.join(ROOT, 'docs', 'TIMELINE_UAT_REGRESSION_MATRIX.md'), 'utf8');
const timelineVisualSettingsDoc = fs.readFileSync(path.join(ROOT, 'docs', 'TIMELINE_VISUAL_SETTINGS_CENTER.md'), 'utf8');
const packageJsonText = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
const uiCode = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8');
const notificationCode = fs.readFileSync(path.join(ROOT, 'js/notification.js'), 'utf8');
const graduationCode = fs.readFileSync(path.join(ROOT, 'js/graduation.js'), 'utf8');
const designsPageCode = fs.readFileSync(path.join(ROOT, 'js/designs-page.js'), 'utf8');
const globalModalsCss = fs.readFileSync(path.join(ROOT, 'css/modals.css'), 'utf8');
const timelineVisibilityCode = fs.readFileSync(path.join(ROOT, 'js/timeline-visibility.js'), 'utf8');
const timelineSettingsPageCode = fs.readFileSync(path.join(ROOT, 'js/timeline-settings-page.js'), 'utf8');
const timelineVisibilityServiceCode = fs.readFileSync(path.join(ROOT, 'services/timelineVisibilitySettings.js'), 'utf8');
const timelineConfigCode = fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8');
const timelineConstructorCss = fs.readFileSync(path.join(ROOT, 'css/timeline.css'), 'utf8');
const controlsCss = fs.readFileSync(path.join(ROOT, 'css/controls.css'), 'utf8');
const timelineSettingsCss = fs.readFileSync(path.join(ROOT, 'css/timeline-settings.css'), 'utf8');
const iphoneSafeDownloadFiles = [
    'js/app.js',
    'js/finance-page.js',
    'js/customers-page.js',
    'js/afisha-page.js',
    'js/staff-page.js',
    'js/warehouse-page.js',
    'js/reports-page.js',
    'js/settings-history.js',
    'js/hr-page.js',
    'js/graduation.js'
];
check('Shared toast engine supports longer interactive task notifications', notificationCode.includes('TOAST_DEFAULT_DURATION_MS = 6000') && notificationCode.includes('TOAST_DEFAULT_FADE_MS = 750') && notificationCode.includes('pauseOnInteract') && notificationCode.includes('toast-action-btn') && uiCode.includes('window.CrmToast?.show') && uiCode.includes('Auto-dismiss after 6s') && baseCss.includes('.toast-actions') && baseCss.includes('var(--toast-exit-ms, 0.75s)'));
check('Legacy layout block controls have CRM styling, drag, reset, and Ctrl+Z ownership', uiCode.includes('window.CrmLayoutControls') && uiCode.includes("'Рухати', 'move'") && uiCode.includes('function beginMove') && uiCode.includes('function resetAll') && uiCode.includes('function handleKeydown') && uiCode.includes('Ctrl+Z поверне') && layoutCss.includes('v0.75.45: Legacy assistant/layout block controls') && layoutCss.includes('button.crm-layout-control-button') && layoutCss.includes('body.crm-layout-dragging') && layoutCss.includes('.crm-layout-block-managed.is-crm-layout-offset'));
check('Legacy header RoleSwitcher does not render DOM controls', authCode.includes('Compatibility tombstone: legacy RoleSwitcher UI is retired') && !authCode.includes("switcher.id = 'roleSwitcher'") && !authCode.includes('roleSwitcherDropdown'));
check('Sidebar role identity is passive and has no preview menu owner', sidebarCode.includes('<span class="sidebar-identity-role" id="sidebarIdentityRole">CRM</span>') && !sidebarCode.includes('sidebarRolePreviewMenu') && !sidebarCode.includes('_hydrateRolePreviewEntry'));
check('Sidebar has /designs', sidebarCode.includes("href: '/designs'"));
check('Sidebar exposes product shortcuts for programs, animation, cakes, menu, and catalogs', sidebarCode.includes("href: '/programs'") && sidebarCode.includes("href: '/programs#animation'") && sidebarCode.includes("href: '/programs#kitchen-cakes'") && sidebarCode.includes("href: '/programs#kitchen-menu'") && sidebarCode.includes("href: '/programs#catalogs'"));
check('Sidebar has /designer', sidebarCode.includes("href: '/designer'"));
check('Sidebar has /guardian-ops', sidebarCode.includes("href: '/guardian-ops'"));
check('Sidebar exposes /omni for communications', sidebarCode.includes("href: '/omni'") && sidebarCode.includes('omni:'));
check('Sidebar has Центр керування', sidebarCode.includes('Центр керування'));
check('Sidebar promotes Afisha to standalone page instead of hash modal', sidebarCode.includes("href: '/afisha'") && !sidebarCode.includes("href: '#afisha'") && sidebarCode.includes("window.location.href = '/afisha'"));
check('Timeline button defaults to Park while MD context stays creator-only', sidebarCode.includes("label: 'Таймлайн'") && sidebarCode.includes("href: '/maysternya-doli'") && sidebarCode.includes("item.href === '/' && current === 'maysternya_doli'") && sidebarCode.includes("item.href === '/maysternya-doli' && current !== 'maysternya_doli'") && sidebarCode.includes('return creatorSurface') && sidebarCode.includes('Array.isArray(user?.extraRoles)') && sidebarCode.includes('Array.isArray(user?.extra_roles)') && sidebarCode.includes('MAYSTERNYA_SIDEBAR_HREFS') && sidebarCode.includes("'/sales-funnel'") && sidebarCode.includes("'/customers'") && sidebarCode.includes("'/omni#accounts'") && sidebarCode.includes("label: 'Підключення чатів'") && htmlContains('js/api.js', "paths: ['/', '/maysternya-doli']") && htmlContains('js/api.js', "return '/maysternya-doli'") && featureRegistryCode.includes("title: 'Таймлайн'") && featureRegistryCode.includes("title: 'Таймлайн МД'") && searchCode.includes("label: 'Таймлайн'") && htmlContains('js/timeline-context.js', "switchLabel: 'Таймлайн ПАРК'") && htmlContains('js/timeline-context.js', "brandName: 'Майстерня долі'") && htmlContains('js/timeline-context.js', 'showAfisha: false') && htmlContains('js/timeline-context.js', "settings: ['creator']") && htmlContains('services/timelineContext.js', "PRIVATE_TIMELINE_CONTEXTS") && authCode.includes("const ROLE_QUICK_ACCESS_BASE = ['/', '/staff', '/chat', '/certificates']") && authCode.includes("normalized !== '/maysternya-doli'") && htmlContains('js/timeline.js', 'function timelineShouldRenderAfisha') && htmlContains('js/timeline.js', 'showAfisha ? apiGetAfishaByDate') && htmlContains('js/timeline.js', 'const allAfisha = showAfisha ? (afishaEvents || []) : []') && htmlContains('js/timeline.js', 'function normalizeTimelineLinesForContext') && htmlContains('routes/lines.js', "name: 'Олександр'"));
check('Sidebar Sales group starts with Timeline shortcut', /key:\s*'sales'[\s\S]*?\{\s*href:\s*'\/',\s*icon:\s*'[^']+',\s*label:\s*'Таймлайн',\s*access:\s*'timeline',\s*group:\s*'sales'\s*\}[\s\S]*?\{\s*href:\s*'\/customers'/.test(sidebarCode));
check('Global search preserves active business context for CRM results and keeps product direct links route-safe', searchCode.includes('CrmBusinessContext.apiUrl') && searchRoutes.includes('requireBusinessContext') && searchRoutes.includes('COALESCE(c.business_context') && !searchRoutes.includes('/programs?highlight=') && searchRoutes.includes("'/maysternya-doli'") && searchRoutes.includes('businessContext') && searchCode.includes("href: '/programs#kitchen-menu'"));
check('Sidebar business context shell owns Products, Leads, and Customers scoping', htmlContains('js/api.js', 'CRM_BUSINESS_SCOPED_PAGES') && htmlContains('js/api.js', "products: { id: 'products'") && htmlContains('js/api.js', "leads: { id: 'leads'") && htmlContains('js/api.js', "customers: { id: 'customers'") && htmlContains('js/api.js', 'CRM_BUSINESS_SWITCH_ROLES') && htmlContains('js/api.js', 'function getCrmBusinessState') && htmlContains('js/components/sidebar.js', 'sidebarBusinessContextHost') && htmlContains('js/components/sidebar.js', 'api.switchTo(event.target.value') && htmlContains('js/auth.js', 'CrmBusinessContext?.renderShell') && !htmlContains('programs.html', 'productsBusinessSelect') && !htmlContains('customers.html', 'customerBusinessContext') && !htmlContains('leads.html', 'leadBusinessContext') && !htmlContains('js/api.js', 'id="globalBusinessContextSelect"'));
check('Sidebar business switcher has one canonical hydrated state and guarded transition UX', htmlContains('js/api.js', 'function resolveCrmBusinessContextState') && htmlContains('js/api.js', 'storageBusinessId') && htmlContains('js/api.js', 'crmBusinessContextHydrated') && htmlContains('js/api.js', 'clearCrmBusinessContextStorage') && sidebarCode.includes('businessSwitching') && sidebarCode.includes('data-sidebar-business-switcher="true"') && sidebarCode.includes('aria-busy') && sidebarCode.includes('showNotification') && sidebarCode.includes('crmBusinessContextHydrated') && sidebarAuroraCss.includes('.sidebar-business-select:focus-visible') && sidebarAuroraCss.includes('.sidebar-business-context[data-switching="true"]') && sidebarAuroraCss.includes('.sidebar-nav.collapsed .sidebar-business-select'));
const legacySidebarHotLeadPath = ['/api/leads', 'hot'].join('/');
const legacySidebarNewLeadPath = ['/api/leads', 'new-count'].join('/');
check('Sidebar live counters use canonical business-scoped endpoint', sidebarCode.includes("'/api/business/live-counters'") && sidebarCode.includes('function _fetchBusinessLiveCounters') && sidebarCode.includes('function _businessLiveCounterBucket') && sidebarCode.includes('function _businessScopeCounterLabel') && sidebarCode.includes("_setBadge('leads_new'") && sidebarCode.includes('focusChipFunnel') && sidebarCode.includes('crmBusinessContextChanged') && sidebarCode.includes('crmBusinessContextHydrated') && sidebarCode.includes('_refreshSidebarOperationalWidgets();') && !sidebarCode.includes(legacySidebarHotLeadPath) && !sidebarCode.includes(legacySidebarNewLeadPath));
check('Sidebar business switcher uses clean display labels without half-word wrapping', sidebarCode.includes('function _sidebarBusinessDisplayLabel') && sidebarCode.includes('const firstWord = _firstSidebarBusinessWord(fullLabel)') && sidebarCode.includes('data-full-label') && sidebarCode.includes('data-display-label') && sidebarCode.includes('Поточний бізнес CRM: ${businessFullLabelFor(currentContext)}') && sidebarAuroraCss.includes('.sidebar-business-select option') && sidebarAuroraCss.includes('white-space: nowrap') && sidebarAuroraCss.includes('line-height: 1'));
check('Sidebar business switcher exposes safe multi/all overview modes behind a gear panel', htmlContains('js/api.js', 'function resolveCrmBusinessScopeState') && htmlContains('js/api.js', 'allowsAggregate: crmBusinessPageAllowsAggregate') && htmlContains('js/api.js', 'hasPageBinding: crmBusinessPageHasBinding') && htmlContains('js/api.js', "const CRM_BUSINESS_AGGREGATE_PAGE_IDS = new Set(['dashboard', 'products', 'leads', 'customers', 'reports'])") && sidebarCode.includes('data-sidebar-business-settings-toggle') && sidebarCode.includes('sidebarBusinessSettingsPanel') && sidebarCode.includes('businessSettingsOpen') && sidebarCode.includes('aria-hidden="${settingsOpen ?') && sidebarCode.includes("' inert'") && sidebarCode.includes('data-sidebar-business-scope="true"') && sidebarCode.includes("['single', 'multi', 'all']") && sidebarCode.includes('data-business-scope-mode="${mode}"') && sidebarCode.includes('sidebar-business-readonly-note') && sidebarCode.includes('sidebar-business-multi-option') && sidebarCode.includes('sidebar-business-unavailable') && sidebarCode.includes('api.switchScope(nextScope') && sidebarAuroraCss.includes('.sidebar-business-settings-btn') && sidebarAuroraCss.includes('.sidebar-business-settings-panel') && sidebarAuroraCss.includes('.sidebar-business-scope-btn') && sidebarAuroraCss.includes('.sidebar-business-multi-option') && sidebarAuroraCss.includes('.sidebar-nav.collapsed .sidebar-business-settings-panel') && !htmlContains('js/api.js', 'id="globalBusinessContextSelect"'));
check('Aggregate business scope has explicit read-only UX guards on scoped CRM modules', htmlContains('js/api.js', 'function guardCrmBusinessWrite') && htmlContains('js/api.js', 'guardWrite: guardCrmBusinessWrite') && htmlContains('js/customers-page.js', 'function guardCustomerWrite') && htmlContains('js/customers-page.js', 'customerBusinessReadOnlyNotice') && htmlContains('js/leads-page.js', 'function guardLeadWrite') && htmlContains('js/leads-page.js', 'leadBusinessReadOnlyNotice') && htmlContains('js/programs-page.js', 'function guardProductWrite') && htmlContains('js/programs-page.js', 'productBusinessReadOnlyNotice') && reportsPageCode.includes('function guardReportsWrite') && reportsPageCode.includes('reportsBusinessReadOnlyNotice') && layoutCss.includes('.crm-business-readonly-banner'));
check('Timeline has sidebar-owned business switch and visual element visibility constructor', htmlContains('index.html', 'js/timeline-visibility.js') && timelineVisibilityCode.includes('TIMELINE_VISIBILITY_ELEMENTS') && !timelineVisibilityCode.includes('timelineBusinessSelect') && timelineVisibilityCode.includes('removeBusinessSwitcher') && timelineVisibilityCode.includes('timelineConstructorBtn') && timelineVisibilityCode.includes('bindConstructorButton') && timelineVisibilityCode.includes("canUseAction('settings'") && timelineVisibilityCode.includes("const STORAGE_NAME = 'timeline_element_visibility'") && timelineVisibilityCode.includes('localStorage.getItem(storageKey())') && timelineVisibilityCode.includes("/settings/timeline-visibility") && timelineVisibilityCode.includes('timelineScale') && timelineVisibilityCode.includes('bookingClose') && timelineVisibilityCode.includes('timeline-hidden-by-config') && timelineConstructorCss.includes('.timeline-permission-hidden') && htmlContains('js/timeline-context.js', 'defaultHiddenElements') && authCode.includes('TimelineVisibility.refreshAccess') && fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8').includes("app:user-changed") && timelineConstructorCss.includes('.timeline-constructor-panel') && timelineConstructorCss.includes('.timeline-constructor-btn') && timelineConstructorCss.includes('.timeline-visibility-chip'));
check('Timeline visual settings center exposes v2 block metadata and visual variables', timelineVisibilityCode.includes('currentTimelineId') && timelineVisibilityCode.includes('timelineId') && timelineVisibilityCode.includes('data-timeline-block-id') && timelineVisibilityCode.includes('description') && timelineVisibilityCode.includes('howToUse') && timelineVisibilityCode.includes('impact') && timelineVisibilityCode.includes('customLabel') && timelineVisibilityCode.includes('adminNote') && timelineVisibilityCode.includes('timeline-visual-settings-grid') && timelineVisibilityCode.includes('timelineConstructorVisualEditor') && timelineVisibilityCode.includes('timelineConstructorDetails') && timelineConstructorCss.includes('.timeline-visual-settings-grid') && timelineConstructorCss.includes('.timeline-constructor-selected') && timelineConstructorCss.includes('.timeline-block-density-compact') && timelineConstructorCss.includes('.timeline-block-emphasis-accent:not(.timeline-permission-hidden)'));
check('Timeline visual settings hardening exposes save status, reset confirmation, and admin-only label guidance', timelineVisibilityCode.includes('timelineConstructorSaveStatus') && timelineVisibilityCode.includes('setSaveStatus') && timelineVisibilityCode.includes('confirmResetSettings') && timelineVisibilityCode.includes('confirmModal') && timelineVisibilityCode.includes('Бойовий текст кнопок не перейменовується') && timelineVisibilityCode.includes('Видима тільки в налаштуваннях') && timelineConstructorCss.includes('.timeline-constructor-save-status[data-status="dirty"]') && timelineConstructorCss.includes('.timeline-constructor-save-status[data-status="error"]') && timelineConstructorCss.includes('.timeline-visual-field small') && timelineConstructorCss.includes('#timelineScroll.timeline-block-density-compact') && timelineConstructorCss.includes('#bookingPanel.timeline-block-density-comfortable'));
check('Timeline visual settings drawer is docked and avoids covering the whole workspace', timelineConstructorCss.includes('top: 92px') && timelineConstructorCss.includes('width: min(780px') && timelineConstructorCss.includes('calc(100vw - var(--eg-claude-sidebar-w, 224px) - 34px)') && timelineConstructorCss.includes('body.timeline-constructor-active::after') && timelineConstructorCss.includes('pointer-events: none') && timelineConstructorCss.includes('grid-template-columns: minmax(250px, 0.86fr) minmax(310px, 1.14fr)') && timelineConstructorCss.includes('.timeline-visual-blocks-zone') && timelineConstructorCss.includes('grid-row: 1 / span 2') && timelineConstructorCss.includes('.timeline-constructor-panel-body') && timelineConstructorCss.includes('overflow: auto'));
check('Timeline settings center has standalone route, access, sidebar entry, and shell styles',
    htmlContains('server.js', "app.get('/timeline-settings'")
    && authCode.includes("'/timeline-settings': ['creator', 'director']")
    && htmlContains('middleware/auth.js', "'/timeline-settings': ['creator', 'director']")
    && sidebarCode.includes("href: '/timeline-settings'")
    && timelineSettingsCss.includes('.timeline-settings-shell')
    && timelineSettingsCss.includes('.timeline-settings-context-btn')
    && timelineSettingsCss.includes('.timeline-settings-tabs'));
check('Timeline settings page uses existing visibility/display APIs with context query contract',
    timelineSettingsPageCode.includes("'/settings/timeline-visibility'")
    && timelineSettingsPageCode.includes("'/settings/timeline-display'")
    && timelineSettingsPageCode.includes('businessContext=')
    && timelineSettingsPageCode.includes('timelineView=')
    && timelineSettingsPageCode.includes("url.searchParams.set('context'")
    && timelineSettingsPageCode.includes("url.searchParams.set('timelineView'")
    && timelineSettingsPageCode.includes("url.searchParams.set('return'")
    && timelineSettingsPageCode.includes('timelineSettingsBackLink'));
check('Timeline settings center separates Park animator and room visual settings',
    timelineSettingsPageCode.includes("id: 'event_genix:animators'")
    && timelineSettingsPageCode.includes("id: 'event_genix:rooms'")
    && timelineSettingsPageCode.includes('activeView')
    && timelineSettingsPageCode.includes('data-timeline-settings-view')
    && timelineSettingsPageCode.includes('TIMELINE_VIEW_LABELS')
    && timelineVisibilityCode.includes('visibilityScopeKey')
    && timelineVisibilityCode.includes('currentTimelineViewKey')
    && timelineVisibilityCode.includes("url.searchParams.set('timelineView'")
    && timelineVisibilityCode.includes('timeline:view-changed')
    && timelineCode.includes("window.dispatchEvent(new CustomEvent('timeline:view-changed'"));
check('Timeline settings page renders registry blocks, filters, presets, and system modes',
    timelineSettingsPageCode.includes('renderBlocks')
    && timelineSettingsPageCode.includes('timelineSettingsBlockGroups')
    && timelineSettingsPageCode.includes('PRESETS')
    && timelineSettingsPageCode.includes("key: 'operator_daily'")
    && timelineSettingsPageCode.includes("key: 'compact_booking'")
    && timelineSettingsPageCode.includes("key: 'clean_phone'")
    && timelineSettingsPageCode.includes('MODULE_LABELS')
    && timelineSettingsPageCode.includes('FEATURE_LABELS')
    && htmlContains('timeline-settings.html', 'data-timeline-settings-filter="hidden"'));
check('Timeline settings block visibility badge is an actionable toggle',
    timelineSettingsPageCode.includes('data-timeline-settings-visibility-toggle')
    && timelineSettingsPageCode.includes('timelineSettingsVisibilityToggle')
    && timelineSettingsPageCode.includes('updateBlock(id, { visible: current.visible === false })')
    && timelineSettingsCss.includes('.timeline-settings-visibility-toggle')
    && timelineSettingsCss.includes('.timeline-settings-block-main'));
check('Timeline gear opens the standalone settings center instead of the overlay constructor entrypoint',
    timelineVisibilityCode.includes('/timeline-settings')
    && timelineVisibilityCode.includes('openSettingsCenter')
    && timelineVisibilityCode.includes("url.searchParams.set('return'")
    && !timelineVisibilityCode.includes('toggleConstructorMode(!state.constructorActive)'));
check('Timeline visual settings center has operator documentation and safe-change guardrails', timelineVisualSettingsDoc.includes('timeline:event_genix') && timelineVisualSettingsDoc.includes('visible') && timelineVisualSettingsDoc.includes('order') && timelineVisualSettingsDoc.includes('density') && timelineVisualSettingsDoc.includes('emphasis') && timelineVisualSettingsDoc.includes('customLabel') && timelineVisualSettingsDoc.includes('adminNote') && timelineVisualSettingsDoc.includes('не змінює бізнес-логіку') && timelineVisualSettingsDoc.includes('UAT') && timelineVisualSettingsDoc.includes('codex/room-timeline-hardening'));
check('Timeline display modes are real presentation settings', htmlContains('index.html', 'settingsTimelineDisplayMode') && htmlContains('index.html', 'settingsTimelineKitchenMode') && htmlContains('index.html', 'settingsTimelineRoomFirstEnabled') && htmlContains('index.html', 'settingsTimelineDefaultView') && htmlContains('js/timeline-context.js', 'const DISPLAY_MODES = {') && htmlContains('js/timeline-context.js', "education: {") && htmlContains('js/timeline-context.js', "parkKitchenEnabled") && htmlContains('js/timeline-context.js', "defaultTimelineView") && settingsCode.includes('/settings/timeline-display') && settingsCode.includes('roomTimelineEnabled') && settingsCode.includes('defaultTimelineView') && !settingsCode.includes("|| 'rooms'") && !settingsCode.includes("? 'rooms' : 'animators'") && appCode.includes('saveTimelineDisplaySettingsFromSettings') && appCode.includes('settingsTimelineDefaultView') && timelineConfigCode.includes('TIMELINE_DISPLAY_MODE') && timelineConfigCode.includes('EDUCATION_TIMELINE_PROGRAMS') && timelineCode.includes("presentation?.mode === 'education'") && timelineCode.includes('resourceType: \'cabinet\'') && htmlContains('css/panel.css', 'body.timeline-mode-park.timeline-park-without-kitchen #banquetFields'));
check('Deprecated room load visual settings are removed', !timelineVisibilityCode.includes('roomLoadPanel') && !timelineVisibilityCode.includes('roomLoadBtn') && !timelineSettingsPageCode.includes('roomLoadPanel') && !timelineSettingsPageCode.includes('roomLoadBtn') && !timelineVisibilityServiceCode.includes("visualBlock('roomLoad") && !timelineVisibilityServiceCode.includes("visualBlock('roomLoadPanel") && !featuresCss.includes('room-load-anchor') && !featuresCss.includes('room-load-close-label'));
const timelineBanquetRoomCardBlock = timelineCode.slice(
    timelineCode.indexOf('function timelineBanquetRoomCardSignals'),
    timelineCode.indexOf('function clearTimelineBanquetRoomPreviews')
);
const timelineBanquetOccupancyRoleBlock = timelineCode.slice(
    timelineCode.indexOf('function timelineBanquetPreviewRoleUsesOccupancyBand'),
    timelineCode.indexOf('function timelineBanquetPreviewGridDuplicateReason')
);
const timelineRoomServiceMarkerBlock = timelineCode.slice(
    timelineCode.indexOf('function renderTimelineRoomServiceMarkers'),
    timelineCode.indexOf('function clearTimelineBanquetRoomPreviews')
);
const timelineSetViewBlock = timelineCode.slice(
    timelineCode.indexOf('async function setTimelineView'),
    timelineCode.indexOf('window.TimelineView =')
);
const timelineBanquetLinkLayerBlock = timelineCode.slice(
    timelineCode.indexOf('function ensureBanquetLinkLayer'),
    timelineCode.indexOf('function clearBanquetLinkLayer')
);
const timelineFitCellWidthBlock = uiCode.slice(
    uiCode.indexOf('function _timelineFitCellWidth'),
    uiCode.indexOf('function _timelineResponsiveCellWidth')
);
const timelineRenderStartIndex = timelineCode.indexOf('async function renderTimeline()');
const timelineRenderClearIndex = timelineCode.indexOf('clearTimelineBanquetRoomPreviews()', timelineRenderStartIndex);
const timelineRenderFetchIndex = timelineCode.indexOf('getLinesForDate(selectedDate)', timelineRenderStartIndex);
const timelineBanquetOccupancyBandRule = cssRuleText(timelineConstructorCss, '.booking-block.is-timeline-banquet-occupancy-band');
const timelineBanquetGridDuplicateRule = cssRuleText(timelineConstructorCss, '.booking-block.is-timeline-banquet-grid-duplicate');
const timelineBanquetRoomCardSignalRule = cssRuleText(timelineConstructorCss, '.timeline-banquet-room-card-signal');
const timelineRoomServiceMarkerWithBadgeRule = cssRuleText(timelineConstructorCss, '.timeline-room-service-marker.has-user-letter');
const timelineRoomServiceMarkerBadgeRule = cssRuleText(timelineConstructorCss, '.timeline-room-service-marker .user-letter');
const timelineRoomVisualTokensRule = cssRuleText(timelineConstructorCss, 'body.timeline-view-rooms');
const timelineRoomActivityBadgeRule = cssRuleIncludingSelectorText(timelineConstructorCss, 'body.timeline-view-rooms .booking-block.is-room-timeline-activity-card .user-letter');
const timelineRoomTinyActivityBadgeRule = cssRuleIncludingSelectorText(timelineConstructorCss, 'body.timeline-view-rooms .booking-block.is-room-timeline-activity-card.booking-block--tiny .user-letter');
const timelineRoomCompactActivityBadgeRule = cssRuleText(timelineConstructorCss, 'body.timeline-view-rooms .timeline-container.compact .booking-block.is-room-timeline-activity-card .user-letter');
const timelineRoomServiceMarkerScopedBadgeRule = cssRuleText(timelineConstructorCss, 'body.timeline-view-rooms .timeline-room-service-marker .user-letter');
const timelineRoomActivityTimeRule = cssRuleText(timelineConstructorCss, 'body.timeline-view-rooms .booking-block.is-room-timeline-activity-card .booking-block-time');
const timelineRoomActivityTitleRule = cssRuleText(timelineConstructorCss, 'body.timeline-view-rooms .booking-block.is-room-timeline-activity-card .timeline-room-activity-title');
const timelineRoomActivityDetailRule = cssRuleText(timelineConstructorCss, 'body.timeline-view-rooms .booking-block.is-room-timeline-activity-card .timeline-room-activity-detail');
const timelineRoomServiceMainRule = cssRuleText(timelineConstructorCss, 'body.timeline-view-rooms .timeline-room-service-marker-main');
const timelineRoomServiceTimeRule = cssRuleText(timelineConstructorCss, 'body.timeline-view-rooms .timeline-room-service-marker-time');
const timelineRoomServiceTitleRule = cssRuleText(timelineConstructorCss, 'body.timeline-view-rooms .timeline-room-service-marker-title');
const timelineRoomServiceDetailRule = cssRuleText(timelineConstructorCss, 'body.timeline-view-rooms .timeline-room-service-marker-detail');
check('Room timeline banquet preview hydrates from cached group snapshots without blocking render',
    timelineCode.includes('TIMELINE_BANQUET_SNAPSHOT_CACHE')
    && timelineCode.includes('function loadTimelineBanquetSnapshotForBooking')
    && timelineCode.includes('apiGetBanquetByBooking(bookingId)')
    && timelineCode.includes('function applyTimelineBanquetPreview')
    && timelineCode.includes('function renderTimelineBanquetRoomCard')
    && timelineCode.includes('function showTimelineBanquetInspector')
    && timelineBanquetInspectorHelpersCode.includes('function timelineBanquetCommentItems')
    && timelineCode.includes('function timelineBanquetCommentsHtml')
    && timelineBanquetInspectorHelpersCode.includes('function timelineBanquetActivityStartsText')
    && timelineCode.includes('TIMELINE_BANQUET_COMPACT_HIDDEN_WARNING_CODES')
    && timelineCode.includes("'banquet_group_not_found'")
    && timelineCode.includes("'legacy_banquet_links_fallback'")
    && timelineCode.includes("'banquet_group_schema_unavailable'")
    && timelineBanquetInspectorHelpersCode.includes('function timelineBanquetSnapshotWarningText')
    && timelineBanquetInspectorHelpersCode.includes('.map(timelineBanquetSnapshotWarningText)')
    && !timelineCode.includes('Booking is not attached to a banquet group.')
    && !timelineCode.includes('Loaded from legacy booking_banquet_links because no banquet group exists yet.')
    && !timelineCode.includes('Banquet group schema is not available.')
    && timelineBanquetInspectorHelpersCode.includes('bookingWorkspace')
    && timelineBanquetInspectorHelpersCode.includes('comments.kitchen')
    && timelineBanquetInspectorHelpersCode.includes('comments.activity')
    && timelineBanquetInspectorHelpersCode.includes('comments.internal')
    && timelineBanquetInspectorHelpersCode.includes('item?.servingNote || item?.serving_note')
    && timelineBanquetInspectorHelpersCode.includes('item?.note || item?.notes')
    && timelineCode.includes('function timelineMenuQuantityLabel')
    && timelineBanquetInspectorHelpersCode.includes('servingUnit: item?.servingUnit || item?.serving_unit || item?.priceUnit || item?.price_unit || null')
    && timelineCode.includes('timelineMenuQuantityLabel(item)')
    && !timelineCode.includes("item?.quantity ? `x${item.quantity}` : ''")
    && !timelineCode.includes("item.quantity ? `× ${item.quantity}` : ''")
    && timelineCode.includes('timeline-banquet-inspector-menu-note')
    && timelineCode.includes('Початок активностей')
    && timelineCode.includes('Примітки')
    && timelineCode.includes('function hydrateTimelineBanquetPreview')
    && timelineCode.includes('function timelineBanquetPreviewRoleUsesOccupancyBand')
    && timelineCode.includes('function setTimelineBanquetOccupancyBand')
    && timelineCode.includes('function timelineBanquetPreviewRoleUsesGridDuplicateHide')
    && timelineCode.includes('function setTimelineBanquetGridDuplicateHidden')
    && timelineCode.includes('function applyTimelineBanquetGridPreviewVisuals')
    && timelineCode.includes('is-timeline-banquet-occupancy-band')
    && timelineCode.includes('is-timeline-banquet-grid-duplicate')
    && timelineCode.includes('requestIdleCallback')
    && timelineCode.includes('data-banquet-room-card')
    && timelineCode.includes('data-banquet-room-marker')
    && timelineCode.includes('function timelineBanquetRoomServingSignals')
    && timelineCode.includes('signals.push(...timelineBanquetRoomServingSignals(servingMarkers))')
    && timelineBanquetInspectorHelpersCode.includes("case 'room_setup':")
    && timelineBanquetInspectorHelpersCode.includes("return 'Підготувати кімнату'")
    && !timelineCode.includes('signals.slice(0, 3)')
    && !timelineCode.includes('cakeMarker || servingMarkers.find')
    && timelineCode.includes('timelineBanquetSummaryHref')
    && timelineConstructorCss.includes('.timeline-banquet-room-card')
    && timelineConstructorCss.includes('.timeline-banquet-room-card-signal')
    && timelineConstructorCss.includes('.timeline-banquet-room-marker')
    && timelineConstructorCss.includes('.timeline-banquet-room-card-signal--room-setup')
    && timelineConstructorCss.includes('.timeline-banquet-room-card-glance')
    && timelineConstructorCss.includes('.timeline-banquet-inspector')
    && timelineConstructorCss.includes('.timeline-banquet-inspector-section--notes')
    && timelineConstructorCss.includes('.timeline-banquet-inspector-notes')
    && timelineConstructorCss.includes('.timeline-banquet-inspector-menu-note')
    && timelineConstructorCss.includes('.timeline-banquet-inspector-note-text')
    && timelineConstructorCss.includes('.timeline-banquet-inspector-btn--primary')
    && timelineConstructorCss.includes('.booking-block.is-timeline-banquet-occupancy-band')
    && timelineConstructorCss.includes('.booking-block.is-timeline-banquet-occupancy-band .title')
    && /opacity:\s*0\.72\s*;/.test(timelineBanquetOccupancyBandRule)
    && /display:\s*none\s*!important\s*;/.test(timelineBanquetGridDuplicateRule)
    && /pointer-events:\s*none\s*;/.test(timelineBanquetGridDuplicateRule)
    && !timelineCode.includes('data-banquet-preview-trigger')
    && !timelineCode.includes('data-banquet-service-marker')
    && !timelineConstructorCss.includes('.timeline-banquet-chip')
    && !timelineConstructorCss.includes('.timeline-banquet-service-marker')
    && !timelineCode.includes('showTimelineBanquetPopover')
    && !timelineConstructorCss.includes('.timeline-banquet-popover'));
check('Room timeline service markers expose creator badges',
    timelineBanquetInspectorHelpersCode.includes('function timelineBanquetOwnerName')
    && timelineBanquetInspectorHelpersCode.includes('source?.createdBy')
    && timelineBanquetInspectorHelpersCode.includes('source?.created_by')
    && timelineCode.includes('function timelineRoomServiceMarkerOwnerName')
    && timelineCode.includes('function timelineRoomServiceMarkerOwnerLetter')
    && timelineCode.includes("markerEl.classList.toggle('has-user-letter'")
    && timelineCode.includes("ownerBadge.className = 'user-letter'")
    && timelineCode.includes("ownerBadge.setAttribute('aria-hidden', 'true')")
    && timelineCode.includes('ownerName, summary.room, summary.customerName')
    && /padding-right:\s*34px\s*;/.test(timelineRoomServiceMarkerWithBadgeRule)
    && /position:\s*absolute\s*;/.test(timelineRoomServiceMarkerBadgeRule)
    && /pointer-events:\s*none\s*;/.test(timelineRoomServiceMarkerBadgeRule));
check('Room timeline badges and text metrics are token-aligned without animator overrides',
    /--timeline-room-card-badge-size:\s*18px\s*;/.test(timelineRoomVisualTokensRule)
    && /--timeline-room-card-badge-font-size:\s*10px\s*;/.test(timelineRoomVisualTokensRule)
    && /--timeline-room-card-badge-font-weight:\s*900\s*;/.test(timelineRoomVisualTokensRule)
    && /--timeline-room-card-badge-offset-top:\s*7px\s*;/.test(timelineRoomVisualTokensRule)
    && /--timeline-room-card-badge-offset-right:\s*8px\s*;/.test(timelineRoomVisualTokensRule)
    && /--timeline-room-card-time-font-size:\s*13px\s*;/.test(timelineRoomVisualTokensRule)
    && /--timeline-room-card-title-font-size:\s*12px\s*;/.test(timelineRoomVisualTokensRule)
    && /--timeline-room-card-detail-font-size:\s*12px\s*;/.test(timelineRoomVisualTokensRule)
    && /--timeline-room-card-time-line-height:\s*1\.2\s*;/.test(timelineRoomVisualTokensRule)
    && /--timeline-room-card-title-line-height:\s*1\.2\s*;/.test(timelineRoomVisualTokensRule)
    && /--timeline-room-card-detail-line-height:\s*1\.22\s*;/.test(timelineRoomVisualTokensRule)
    && /width:\s*var\(--timeline-room-card-badge-size\)\s*;/.test(timelineRoomActivityBadgeRule)
    && /height:\s*var\(--timeline-room-card-badge-size\)\s*;/.test(timelineRoomActivityBadgeRule)
    && /font-size:\s*var\(--timeline-room-card-badge-font-size\)\s*;/.test(timelineRoomActivityBadgeRule)
    && /width:\s*var\(--timeline-room-card-badge-size\)\s*;/.test(timelineRoomTinyActivityBadgeRule)
    && /width:\s*var\(--timeline-room-card-badge-size\)\s*;/.test(timelineRoomCompactActivityBadgeRule)
    && /width:\s*var\(--timeline-room-card-badge-size\)\s*;/.test(timelineRoomServiceMarkerScopedBadgeRule)
    && /font-size:\s*var\(--timeline-room-card-time-font-size\)\s*;/.test(timelineRoomActivityTimeRule)
    && /font-size:\s*var\(--timeline-room-card-title-font-size\)\s*;/.test(timelineRoomActivityTitleRule)
    && /font-size:\s*var\(--timeline-room-card-detail-font-size\)\s*;/.test(timelineRoomActivityDetailRule)
    && /font-size:\s*var\(--timeline-room-card-time-font-size\)\s*;/.test(timelineRoomServiceMainRule)
    && /line-height:\s*var\(--timeline-room-card-time-line-height\)\s*;/.test(timelineRoomServiceMainRule)
    && /font-size:\s*var\(--timeline-room-card-time-font-size\)\s*;/.test(timelineRoomServiceTimeRule)
    && /font-size:\s*var\(--timeline-room-card-title-font-size\)\s*;/.test(timelineRoomServiceTitleRule)
    && /font-size:\s*var\(--timeline-room-card-detail-font-size\)\s*;/.test(timelineRoomServiceDetailRule)
    && !/body\.timeline-view-animators[\s\S]*--timeline-room-card-(?:badge|time|title|detail)/.test(timelineConstructorCss));
check('Room timeline service markers remain isolated from animator timeline',
    timelineRoomServiceMarkerBlock.includes('if (!isRoomTimelineView() || !summary) return')
    && timelineRoomServiceMarkerBlock.includes('timelineBanquetRoomGridForSummary(summary)')
    && timelineRoomServiceMarkerBlock.includes('lineGrid.appendChild(markerEl)')
    && timelineRoomServiceMarkerBlock.includes("markerEl.setAttribute('aria-haspopup', 'dialog')")
    && timelineCode.includes('function clearTimelineRoomServiceMarkers')
    && timelineCode.includes('function clearTimelineBanquetRoomPreviews()')
    && timelineCode.includes('clearTimelineRoomServiceMarkers();')
    && timelineSetViewBlock.includes('clearTimelineBanquetRoomPreviews()')
    && timelineSetViewBlock.indexOf('clearTimelineBanquetRoomPreviews()') < timelineSetViewBlock.indexOf('await renderTimeline()')
    && timelineRenderClearIndex > timelineRenderStartIndex
    && timelineRenderFetchIndex > timelineRenderClearIndex
    && timelineCacheCode.includes('const timelineView = timelineCurrentView();')
    && timelineCacheCode.includes('return `${context}|${mode}|${resourceType}|${timelineView}`;')
    && timelineConstructorCss.includes('.line-grid.has-timeline-room-service-markers')
    && timelineConstructorCss.includes('.timeline-line.has-timeline-room-service-marker-lanes')
    && timelineConstructorCss.includes('--room-service-marker-row-height')
    && timelineConstructorCss.includes('.timeline-room-service-marker')
    && timelineConstructorCss.includes('.timeline-room-service-marker-main')
    && timelineConstructorCss.includes('.timeline-room-service-marker-detail')
    && timelineConstructorCss.includes('min-width: 168px')
    && timelineConstructorCss.includes('height: 54px')
    && timelineConstructorCss.includes('font-size: 11px')
    && timelineConstructorCss.includes('padding: 8px 11px 9px')
    && timelineConstructorCss.includes('.timeline-room-service-marker--room-setup')
    && timelineCode.includes('function timelineRoomServiceMarkerDisplay')
    && timelineCode.includes('function timelineRoomServiceMarkerLane')
    && timelineCode.includes('function syncTimelineRoomServiceMarkerLayout')
    && timelineCode.includes('applyTimelineBanquetGridPreviewVisuals(target.block, targetRole, hasRoomServiceMarkers, target.booking, { isPrimary: targetIsPrimary })')
    && timelineCode.includes('applyTimelineBanquetGridPreviewVisuals(block, carrierRole, hasRoomServiceMarkers, carrierBooking, { isPrimary: carrierIsPrimary })')
    && timelineCode.includes('function timelineBanquetPreviewGridDuplicateReason')
    && timelineCode.includes('timelineBanquetPreviewRoleUsesGridDuplicateHide(role, context)')
    && timelineCode.includes("normalizedRole === 'kitchen'")
    && timelineCode.includes('setTimelineBanquetGridDuplicateHidden(block, false)')
    && !/normalizedRole === 'kitchen'/.test(timelineBanquetOccupancyRoleBlock)
    && timelineCode.includes('markerEl.dataset.markerTitle = display.title')
    && timelineCode.includes('markerEl.dataset.markerLane = String(laneIndex)')
    && timelineResourcesTestCode.includes("querySelectorAll('.line-grid .timeline-room-service-marker')")
    && timelineResourcesTestCode.includes('room timeline service markers keep readable event-block dimensions and structured content')
    && timelineResourcesTestCode.includes('marker height reserves text descenders')
    && timelineResourcesTestCode.includes('room timeline renders multiple menu serving markers inside the room grid')
    && timelineResourcesTestCode.includes('room timeline renders room_setup service event as a separate room-grid marker')
    && timelineResourcesTestCode.includes('room timeline keeps mixed same-time room-grid markers without dedupe')
    && timelineResourcesTestCode.includes('room timeline hides duplicate banquet grid blocks when service markers exist')
    && timelineResourcesTestCode.includes("querySelector('.booking-block.is-timeline-banquet-occupancy-band')")
    && timelineResourcesTestCode.includes("rootBlock.classList.contains('is-timeline-banquet-grid-duplicate')")
    && timelineResourcesTestCode.includes('assert.notEqual(markers[0].left, markers[1].left)')
    && timelineResourcesTestCode.includes('parseFloat(markers[2].left) > parseFloat(markers[1].left)')
    && timelineResourcesTestCode.includes('ctx.__timelineViewState.room = false')
    && !timelineCode.includes('data-banquet-service-marker')
    && !timelineConstructorCss.includes('.timeline-banquet-service-marker'));
check('Room timeline banquet preview uses readable labels instead of single-letter badge labels',
    timelineBanquetRoomCardBlock.includes("label: 'Без часу'")
    && timelineBanquetRoomCardBlock.includes('Кухня ${menuCount} поз.')
    && timelineBanquetRoomCardBlock.includes('timelineBanquetRoomServingSignals(servingMarkers)')
    && timelineBanquetRoomCardBlock.includes('timelineBanquetPlural(activityCount')
    && timelineBanquetRoomCardBlock.includes("['Кімната'")
    && timelineBanquetRoomCardBlock.includes("['Клієнт'")
    && timelineBanquetRoomCardBlock.includes("['Прихід гостей'")
    && timelineBanquetRoomCardBlock.includes("['Сигнали'")
    && timelineCode.includes('<span>Прихід гостей</span><strong>${escapeHtml(timelineBanquetDateTimeText(summary))}</strong>')
    && !timelineCode.includes('<span>Дата' + '/час</span><strong>${escapeHtml(timelineBanquetDateTimeText(summary))}</strong>')
    && timelineBanquetInspectorHelpersCode.includes("label: 'Видача'")
    && timelineCode.includes("'Торт'")
    && timelineCode.includes("data-banquet-inspector-details>Деталі")
    && timelineBanquetInspectorHelpersCode.includes('Активність —')
    && timelineBanquetInspectorHelpersCode.includes('Внутрішній коментар')
    && timelineCode.includes('>Банкетний лист</a>')
    && !timelineCode.includes('>Вижимка</a>')
    && /line-height:\s*1\.25\s*;/.test(timelineBanquetRoomCardSignalRule)
    && /padding:\s*2px 5px 3px\s*;/.test(timelineBanquetRoomCardSignalRule)
    && !timelineCode.includes('data-banquet-badge')
    && !timelineConstructorCss.includes('.timeline-banquet-badge')
    && !timelineCode.includes('timeline-banquet-room-card-icons')
    && !timelineCode.includes('card.title')
    && !/label:\s*['"`][МАБВ]['"`]/.test(timelineBanquetRoomCardBlock));
check('Room timeline banquet preview is click-inspector driven instead of hover-popover driven',
    timelineCode.includes('function setTimelineBanquetRoomPreviewHighlight')
    && timelineCode.includes("block.classList.add('is-timeline-banquet-preview-hovered')")
    && timelineCode.includes('showTimelineBanquetInspector(event, summary, card)')
    && timelineCode.includes('showTimelineBanquetInspector(event, block._timelineBanquetSummary, block)')
    && timelineCode.includes('function timelineBanquetBlockCanOpenInspector')
    && timelineCode.includes('if (!timelineBanquetBlockCanOpenInspector(block)) return false;')
    && timelineCode.includes("event.target?.closest?.('[data-banquet-room-card]')")
    && timelineCode.includes("event.key === 'Escape'")
    && !/addEventListener\('mouseenter'[^\n]+showTimelineBanquetInspector/.test(timelineCode)
    && !/addEventListener\('mouseenter'[^\n]+showTimelineBanquetPopover/.test(timelineCode));
check('Room timeline banquet activity blocks open booking modal instead of compact inspector',
    timelineCode.includes("TIMELINE_BANQUET_BOOKING_MODAL_BLOCK_ROLES = new Set(['activity', 'service', 'manual'])")
    && /function timelineBanquetBlockCanOpenInspector[\s\S]*TIMELINE_BANQUET_BOOKING_MODAL_BLOCK_ROLES\.has\(role\)\) return false/.test(timelineCode)
    && /function showTimelineBanquetPreviewFromBlock[\s\S]*if \(!timelineBanquetBlockCanOpenInspector\(block\)\) return false;[\s\S]*showTimelineBanquetInspector\(event, block\._timelineBanquetSummary, block\)/.test(timelineCode)
    && /if \(showTimelineBanquetPreviewFromBlock\(e, block\)\) return;\s*showBookingDetails\(renderBooking\.id\)/.test(timelineCode));
check('Room timeline banquet serving signals stay frontend-only and snapshot-backed',
    timelineBanquetInspectorHelpersCode.includes('function timelineBanquetServingInfo')
    && timelineBanquetInspectorHelpersCode.includes('timelineBanquetMenuPositions(booking)')
    && timelineCode.includes('function timelineBanquetServiceEvents')
    && timelineCode.includes('function timelineBanquetRoomServingSignals')
    && timelineCode.includes('timelineBanquetMarkerLabel(marker)')
    && timelineCode.includes('data-banquet-room-marker')
    && timelineCode.includes('timelineBanquetGlanceRows')
    && timelineCode.includes('summary.servingMarkers')
    && timelineBanquetInspectorHelpersCode.includes("case 'room_setup':")
    && timelineBanquetInspectorHelpersCode.includes("return 'Підготувати кімнату'")
    && timelineCode.includes('Не вказано час видачі')
    && timelineCode.includes('requestIdleCallback')
    && !timelineCode.includes('data-banquet-service-marker')
    && !timelineConstructorCss.includes('.timeline-banquet-service-marker')
    && !timelineCode.includes('/banquet-service-markers'));
check('Room timeline keeps banquet root surface visible even with zero activities',
    timelineCode.includes('function timelineBanquetSummaryHasPersistentRoot')
    && timelineCode.includes("category === 'banquet'")
    && timelineCode.includes('if (!signals.length && timelineBanquetSummaryHasPersistentRoot(summary))')
    && timelineCode.includes("key: 'banquet'")
    && timelineCode.includes("timelineBanquetPlural(activityCount, 'активність', 'активності', 'активностей')"));
check('Timeline booking links use durable API-backed connector model', htmlContains('db/migrations/216_booking_banquet_links.sql', 'CREATE TABLE IF NOT EXISTS booking_banquet_links') && htmlContains('routes/bookings.js', "router.post('/:id/banquet-links'") && htmlContains('routes/bookings.js', "router.delete('/:id/banquet-links/:targetId'") && htmlContains('routes/bookings.js', "shared_room_activity") && htmlContains('services/booking.js', 'bookingLinks: Array.isArray(row.booking_links)') && timelineCode.includes('booking-banquet-link-handle') && timelineCode.includes('renderBanquetLinksOverlay') && timelineCode.includes('getBookingVisualLinks') && timelineCode.includes('apiCreateBookingBanquetLink') && timelineCode.includes('removeBookingBanquetLink'));
check('Banquet groups schema stays isolated from bookings and legacy visual links',
    htmlContains('db/migrations/265_banquet_groups.sql', 'CREATE TABLE IF NOT EXISTS banquet_groups')
    && htmlContains('db/migrations/265_banquet_groups.sql', 'CREATE TABLE IF NOT EXISTS banquet_group_bookings')
    && htmlContains('db/migrations/265_banquet_groups.sql', "CHECK (role IN ('primary', 'kitchen', 'activity', 'service', 'manual'))")
    && htmlContains('db/migrations/265_banquet_groups.sql', 'UNIQUE (booking_id)')
    && htmlContains('db/migrations/265_banquet_groups.sql', 'idx_banquet_groups_business_date')
    && htmlContains('db/index.js', 'CREATE TABLE IF NOT EXISTS banquet_groups')
    && htmlContains('db/index.js', 'CREATE TABLE IF NOT EXISTS banquet_group_bookings')
    && !htmlContains('db/migrations/265_banquet_groups.sql', 'ALTER TABLE bookings ADD COLUMN')
    && !htmlContains('db/index.js', 'banquet_group_id'));
check('Timeline booking API failures render an explicit error state instead of an empty day', apiCode.includes('throwOnError') && timelineCode.includes('function renderTimelineDataError') && timelineCode.includes('Не вдалося завантажити бронювання') && !timelineCode.includes("getBookingsForDate(selectedDate).catch(e => { console.error('[Timeline] getBookingsForDate error:', e); return []; })"));
check('Timeline booking connector visual layer is non-blocking and dark-themeable', timelineConstructorCss.includes('.timeline-banquet-link-layer') && timelineConstructorCss.includes('pointer-events: none') && timelineConstructorCss.includes('.timeline-banquet-link-path') && timelineConstructorCss.includes('.timeline-booking-link-path--room') && timelineConstructorCss.includes('.timeline-booking-link-path--adjacent') && timelineConstructorCss.includes('.booking-banquet-link-handle') && timelineConstructorCss.includes('body.banquet-linking-active') && timelineConstructorCss.includes('html[data-theme="dark"] .booking-banquet-links-detail'));
check('Room timeline suppresses banquet connector visual lines',
    timelineCode.includes('function clearBanquetLinkLayer')
    && /if\s*\(\s*isRoomTimelineView\(\)\s*\)\s*\{\s*clearBanquetLinkLayer\(\);\s*return;\s*\}/.test(timelineCode)
    && timelineConstructorCss.includes('body.timeline-view-rooms .timeline-banquet-link-layer')
    && timelineConstructorCss.includes('display: none;'));
check('Animator timeline booking blocks show room meta without room timeline duplication', timelineCode.includes('const bookingRoomName = String(renderBooking.room || \'\').trim()') && timelineCode.includes('&& isParkAnimatorTimelineView()') && timelineCode.includes("(!isRoomTimelineView() && !shouldShowBookingRoomMeta ? bookingRoomName : '')") && timelineCode.includes('class="booking-block-room"') && timelineConstructorCss.includes('.booking-block .booking-block-room') && timelineConstructorCss.includes('.booking-block.has-booking-room-meta .subtitle') && timelineConstructorCss.includes('gap: 6px') && timelineConstructorCss.includes('.booking-block.has-booking-room-meta .booking-block-room') && timelineConstructorCss.includes('margin-left: 0') && timelineConstructorCss.includes('max-width: min(96px, calc(100% - 48px))') && timelineConstructorCss.includes('.booking-block.booking-block--short.has-booking-room-meta .timeline-compact-booking-meta .booking-block-room') && timelineConstructorCss.includes('max-width: min(72px, 100%)') && timelineConstructorCss.includes('body.dark-mode .booking-block .booking-block-room') && timelineConstructorCss.includes('html[data-theme="dark"] .booking-block .booking-block-room'));
check('Room timeline activity blocks share marker card styling', timelineCode.includes('const isRoomTimelineActivityCard = isRoomTimelineView()') && timelineCode.includes("block.classList.add('is-room-timeline-activity-card')") && timelineCode.includes('class="timeline-room-activity-main"') && timelineCode.indexOf('class="timeline-room-activity-main"') < timelineCode.indexOf('class="timeline-room-activity-title"') && timelineCode.includes('class="timeline-room-activity-detail"') && timelineConstructorCss.includes('body.timeline-view-rooms .booking-block.is-room-timeline-activity-card') && timelineConstructorCss.includes('body.timeline-view-rooms .timeline-room-service-marker') && timelineConstructorCss.includes('--timeline-room-card-accent') && timelineConstructorCss.includes('border-left: 4px solid var(--timeline-room-card-accent)') && timelineConstructorCss.includes('body.timeline-view-rooms .booking-block.is-room-timeline-activity-card.animation') && timelineConstructorCss.includes('body.timeline-view-rooms .booking-block.is-room-timeline-activity-card .timeline-room-activity-detail') && timelineConstructorCss.includes('-webkit-line-clamp: 2') && timelineConstructorCss.includes('body.timeline-view-rooms .booking-block.is-room-timeline-activity-card .booking-banquet-link-handle'));
check('Room timeline service marker backgrounds are solid category surfaces', timelineConstructorCss.includes('background: var(--timeline-service-card-bg)') && timelineConstructorCss.includes('--timeline-service-card-bg: #0F766E') && timelineConstructorCss.includes('--timeline-service-card-bg: #5B21B6') && timelineConstructorCss.includes('--timeline-service-card-bg: #1D4ED8') && timelineConstructorCss.includes('--timeline-service-card-bg: #BE185D') && timelineConstructorCss.includes('--timeline-service-card-bg: #334155') && timelineConstructorCss.includes('--timeline-service-card-bg: #0E7490') && !/timeline-room-service-marker--(?:food-service|room-setup|cake|drinks|custom|service)[^{]*\{[^}]*background:\s*linear-gradient/i.test(timelineConstructorCss));
check('Room timeline activity card backgrounds are solid category surfaces', timelineConstructorCss.includes('--timeline-room-card-bg: #1D4ED8') && timelineConstructorCss.includes('--timeline-room-card-bg: #C2410C') && timelineConstructorCss.includes('--timeline-room-card-bg: #BE185D') && timelineConstructorCss.includes('--timeline-room-card-bg: #0E7490') && !timelineConstructorCss.includes('--timeline-room-card-bg: linear-gradient') && !timelineConstructorCss.includes('--timeline-room-card-bg: rgba('));
check('Room timeline operational lanes separate markers and activity cards', timelineCode.includes('function syncTimelineRoomOperationalLayout(lineGrid = null)') && timelineCode.includes("lineGrid.querySelectorAll('.timeline-room-service-marker')") && timelineCode.includes(".booking-block.is-room-timeline-activity-card:not(.status-hidden)") && timelineCode.includes('dataset.roomOperationalLane = String(lane)') && timelineCode.includes("style.setProperty('--timeline-room-lane-top'") && timelineCode.includes('dataset.roomActivityLane = String(lane)') && timelineCode.includes('syncTimelineRoomOperationalLayout(lineGrid);') && timelineConstructorCss.includes('.line-grid.has-timeline-room-operational-lanes') && timelineConstructorCss.includes('.timeline-line.has-timeline-room-operational-lanes') && timelineConstructorCss.includes('body.timeline-view-rooms .timeline-container.compact .timeline-line.has-timeline-room-operational-lanes') && timelineConstructorCss.includes('body.timeline-view-rooms .timeline-container.compact .timeline-line.has-timeline-room-service-marker-lanes > .line-grid') && controlsCss.includes('body.timeline-view-rooms .timeline-container[data-zoom] .timeline-line.has-timeline-room-operational-lanes') && controlsCss.includes('body.timeline-view-rooms .timeline-container[data-zoom] .timeline-line.has-timeline-room-service-marker-lanes > .line-grid') && timelineConstructorCss.includes('--timeline-room-operational-row-height') && timelineConstructorCss.includes('--timeline-room-activity-card-height: 72px') && timelineConstructorCss.includes('height: var(--timeline-room-activity-card-height)'));
check('Timeline booking blocks expose width-based density display modes', timelineCode.includes('function timelineBookingBlockDensity(width)') && timelineCode.includes("safeWidth < 90) return 'tiny'") && timelineCode.includes("safeWidth < 140) return 'short'") && timelineCode.includes("safeWidth < 220) return 'medium'") && timelineCode.includes("return 'wide'") && timelineCode.includes('const bookingBlockDensity = timelineBookingBlockDensity(width)') && timelineCode.includes('booking-block--${bookingBlockDensity}') && timelineConstructorCss.includes('.booking-block--tiny') && timelineConstructorCss.includes('.booking-block--short') && timelineConstructorCss.includes('.booking-block--medium') && timelineConstructorCss.includes('.booking-block--wide'));
check('Short timeline activity blocks use compact labels with full title fallback', timelineCode.includes('function timelineCompactActivityLabel(booking, renderBooking, bookingTitle, bookingTitleTail)') && timelineCode.includes("return 'Піньята'") && timelineCode.includes("return 'АН'") && timelineCode.includes("return 'Бульб.'") && timelineCode.includes("return 'МК'") && timelineCode.includes("return 'Фото'") && timelineCode.includes("return 'Квест'") && timelineCode.includes("const isCompactActivityBlock = (bookingBlockDensity === 'tiny' || bookingBlockDensity === 'short')") && timelineCode.includes('const compactActivityLabel = timelineCompactActivityLabel(booking, renderBooking, bookingTitle, bookingTitleTail)') && timelineCode.includes('function timelineRoomActivityDisplayLabel(booking, renderBooking, bookingTitle, bookingTitleTail, compactActivityLabel') && timelineCode.includes('const roomActivityDisplayLabel = timelineRoomActivityDisplayLabel(booking, renderBooking, bookingTitle, bookingTitleTail, compactActivityLabel, bookingBlockDensity)') && timelineCode.includes('isCompactActivityBlock ? roomActivityDisplayLabel') && timelineCode.includes("block.setAttribute('title', fullBookingLabel)") && timelineCode.includes('class="timeline-compact-booking-label"') && timelineConstructorCss.includes('.booking-block .timeline-compact-booking-main') && timelineConstructorCss.includes('.booking-block .timeline-compact-booking-label'));
check('Short and tiny timeline activity blocks have dedicated compact CSS layout', timelineConstructorCss.includes('.booking-block.booking-block--short,') && timelineConstructorCss.includes('.booking-block.booking-block--tiny') && timelineConstructorCss.includes('flex-direction: column') && timelineConstructorCss.includes('max-width: calc(100% - 18px)') && timelineConstructorCss.includes('width: calc(100% - 18px)') && timelineConstructorCss.includes('.booking-block.booking-block--tiny .timeline-compact-booking-meta') && timelineConstructorCss.includes('.booking-block.booking-block--tiny .duration-badge') && timelineConstructorCss.includes('display: none') && timelineConstructorCss.includes('.booking-block.booking-block--short .booking-block-room') && timelineConstructorCss.includes('.booking-block.booking-block--short.has-booking-room-meta .timeline-compact-booking-meta .booking-block-room') && timelineConstructorCss.includes('max-width: min(72px, 100%)') && timelineConstructorCss.includes('body.timeline-view-rooms .booking-block.is-room-timeline-activity-card.booking-block--short') && timelineConstructorCss.includes('min-width: 124px') && timelineConstructorCss.includes('white-space: normal') && timelineConstructorCss.includes('-webkit-line-clamp: 2') && timelineConstructorCss.includes('body.dark-mode .booking-block.booking-block--short .timeline-compact-booking-label') && timelineConstructorCss.includes('body.timeline-view-rooms .booking-block.is-room-timeline-activity-card.pinata') && timelineConstructorCss.includes('--timeline-room-card-accent: #F472B6') && timelineConstructorCss.includes('--timeline-room-card-accent: #84CC16') && timelineConstructorCss.includes('--timeline-room-card-accent: #22D3EE') && timelineConstructorCss.includes('--timeline-room-card-accent: #A78BFA'));
check('Timeline toolbar controls share one CRM glass language without a duplicate business selector', darkModeCss.includes('v0.63.14: Timeline toolbar uses one CRM glass control language') && darkModeCss.includes('v0.63.54: timeline utility buttons align with the main control system') && darkModeCss.includes('.timeline-dashboard-page .control-panel') && darkModeCss.includes('.timeline-dashboard-page :where(.status-filter-btn, .period-btn, .zoom-btn)') && darkModeCss.includes('.timeline-dashboard-page :where(.btn-nav, .btn-today, .toggle-mini, .btn-new-booking, .btn-export, .btn-product-sales, .btn-menu-toggle, .btn-undo)') && !darkModeCss.includes('.btn-room-load') && !timelineVisibilityCode.includes('timelineBusinessSelect') && darkModeCss.includes('.timeline-dashboard-page .admin-dropdown[data-menu-scope="timeline-actions"] .btn-menu-toggle[aria-expanded="true"]') && darkModeCss.includes('.timeline-dashboard-page .v32-controls .admin-dropdown[data-menu-scope="timeline-actions"]') && darkModeCss.includes('margin-left: auto') && darkModeCss.includes('.timeline-dashboard-page .action-buttons:not(:has(> :not(.hidden):not([hidden])))') && darkModeCss.includes(':not(.timeline-hidden-by-config):not(.timeline-permission-hidden)') && responsiveCss.includes('overflow: visible !important;'));
check('Timeline sticky time scale stays above booking cards while scrolling', timelineConstructorCss.includes('.time-scale') && timelineConstructorCss.includes('z-index: 70') && timelineConstructorCss.includes('.booking-block:hover') && timelineConstructorCss.includes('z-index: 20') && timelineConstructorCss.includes('.booking-block.booking-block--just-created') && timelineConstructorCss.includes('z-index: 60') && timelineConstructorCss.includes('.booking-block.dragging') && timelineConstructorCss.includes('z-index: 100 !important'));
check('Timeline sticky time scale masks the top scroll seam without losing mobile guards',
    timelineConstructorCss.includes('--timeline-scale-bg')
    && timelineConstructorCss.includes('--timeline-scale-shadow')
    && timelineConstructorCss.includes('--timeline-sticky-offset')
    && timelineConstructorCss.includes('--timeline-scroll-pad: 20px')
    && timelineConstructorCss.includes('.time-scale::before')
    && timelineConstructorCss.includes('.time-scale::after')
    && timelineConstructorCss.includes('--timeline-scale-top-shield: 4px')
    && timelineConstructorCss.includes('--timeline-scale-inline-bleed: 10px')
    && timelineConstructorCss.includes('--timeline-scale-radius: 12px')
    && timelineConstructorCss.includes('--timeline-sticky-offset: calc(-1 * (var(--timeline-scroll-pad, 20px) - var(--timeline-scale-top-shield, 4px)))')
    && timelineConstructorCss.includes('top: calc(-1 * var(--timeline-scale-top-shield, 20px))')
    && timelineConstructorCss.includes('left: calc(-1 * (var(--timeline-scale-gutter, 130px) + var(--timeline-scale-inline-bleed, 10px)))')
    && timelineConstructorCss.includes('right: calc(-1 * var(--timeline-scale-inline-bleed, 10px))')
    && timelineConstructorCss.includes('border-radius: var(--timeline-scale-radius, 12px) var(--timeline-scale-radius, 12px) 0 0')
    && timelineConstructorCss.includes('height: 1px;')
    && timelineConstructorCss.includes('background: var(--timeline-scale-border, var(--gray-200));')
    && timelineConstructorCss.includes('box-shadow: var(--timeline-scale-shadow')
    && timelineConstructorCss.includes('pointer-events: none')
    && timelineConstructorCss.includes('.time-mark')
    && timelineConstructorCss.includes('z-index: 1')
    && darkModeCss.includes('--timeline-scroll-pad: 16px')
    && darkModeCss.includes('--timeline-scale-bg: var(--eg-timeline-bg)')
    && darkModeCss.includes('--timeline-scale-gutter: var(--timeline-line-header-w, 140px)')
    && darkModeCss.includes('--timeline-scale-top-shield: 4px')
    && darkModeCss.includes('--timeline-scale-top-shield: 3px')
    && darkModeCss.includes('--timeline-scroll-pad: 8px')
    && darkModeCss.includes('--timeline-scale-inline-bleed: 10px')
    && darkModeCss.includes('--timeline-scale-inline-bleed: 7px')
    && darkModeCss.includes('body.timeline-dashboard-page.timeline-compact-mode .time-scale')
    && !darkModeCss.includes('--timeline-scale-top-shield: var(--timeline-scroll-pad, 16px)')
    && responsiveCss.includes('v0.73.80: iPhone 11/Safari needs a definite container height')
    && responsiveCss.includes('height: clamp(360px, calc(var(--eg-viewport-height, 100dvh) - 250px), 58dvh) !important;'));
check('Timeline add animator lane spans content while CTA stays visible-centered',
    timelineCode.includes('function syncTimelineAddLineCtaPosition()')
    && timelineCode.includes('button.style.setProperty(\'--timeline-add-cta-x\'')
    && timelineCode.includes("scroll.addEventListener('scroll', scheduleTimelineAddLineCtaSync")
    && timelineConstructorCss.includes('width: var(--timeline-content-width, 100%)')
    && timelineConstructorCss.includes('.btn-add-line-big--centered-cta > span')
    && timelineConstructorCss.includes('transform: translateX(var(--timeline-add-cta-x, 0px))')
    && timelineConstructorCss.includes('.btn-add-line-big--icon-only > span:not(:first-child)'));
check('Timeline scale rows and add zone share a dynamic width contract',
    timelineCode.includes('function timelineRangeBoundMinutes(value)')
    && timelineCode.includes('function syncTimelineContentWidth(date, anchor)')
    && timelineCode.includes('timelineRangeCellCount(date) * cellWidth')
    && !timelineCode.includes('timelineRangeMarkCount(date) * cellWidth')
    && timelineCode.includes('const contentWidth = Math.ceil(headerWidth + gridWidth)')
    && timelineCode.includes("target.style.setProperty('--timeline-grid-width'")
    && timelineCode.includes("target.style.setProperty('--timeline-content-width'")
    && timelineCode.includes("const addLineBtn = document.getElementById('addLineBtn')")
    && timelineCode.includes('syncTimelineContentWidth(date, container)')
    && timelineCode.includes("syncTimelineContentWidth(selectedDate, container.querySelector('.line-grid[data-line-id]'))")
    && timelineConstructorCss.includes('--timeline-content-width: 100%')
    && timelineConstructorCss.includes('--timeline-grid-width: max-content')
    && (timelineConstructorCss.includes('transition:\n        background var(--speed-fast) var(--ease-smooth),')
        || timelineConstructorCss.includes('transition: background var(--speed-fast);'))
    && timelineConstructorCss.includes('width: var(--timeline-grid-width, max-content)')
    && timelineConstructorCss.includes('min-width: var(--timeline-grid-width, max-content)')
    && timelineConstructorCss.includes('width: var(--timeline-content-width, 100%)')
    && timelineConstructorCss.includes('min-width: var(--timeline-content-width, 100%)')
    && (timelineConstructorCss.includes('flex: 0 0 var(--timeline-grid-width, auto)')
        || timelineConstructorCss.includes('flex: 0 0 var(--timeline-grid-width, max-content)'))
    && responsiveCss.includes('width: var(--timeline-grid-width, max-content) !important;')
    && responsiveCss.includes('width: var(--timeline-content-width, 100%) !important;')
    && responsiveCss.includes('body.timeline-dashboard-page .btn-add-line-big')
    && timelineCode.includes('function timelineTimeToPixel(time, date, anchor)')
    && timelineCode.includes('function timelineLabelPlacement(markX, labelWidth, gridWidth')
    && timelineCode.includes('function timelineTimeMarkPlacements(date, anchor, geometry = null)')
    && timelineCode.includes('function timelineMiniTimeMarkPlacements(start, end, hourWidth)')
    && timelineCode.includes('function renderMiniTimeScaleHtml(start, end, hourWidth, gridWidth)')
    && timelineCode.includes('timelineTimeMarkPlacements(date, container, geometry)')
    && timelineCode.includes('renderMiniTimeScaleHtml(start, end, hourWidth, gridWidth)')
    && timelineConstructorCss.includes('.time-scale .time-mark.end-mark')
    && timelineConstructorCss.includes('.mini-time-mark.end')
    && timelineConstructorCss.includes('width: var(--mini-grid-width, max-content)')
    && timelineConstructorCss.includes('width: var(--mini-time-mark-width, max-content)')
    && timelineConstructorCss.includes('width: var(--time-mark-label-width, max-content) !important;')
    && timelineConstructorCss.includes('left: var(--time-mark-label-left, 0)')
    && !cssRuleText(timelineConstructorCss, '.time-scale .time-mark.end-mark').includes('right: 0')
    && cssRuleText(timelineConstructorCss, '.mini-time-mark').includes('position: absolute')
    && timelineBanquetLinkLayerBlock.includes('timelineBanquetLinkLayerSurfaceWidth(scroll)')
    && !timelineBanquetLinkLayerBlock.includes('scroll.scrollWidth')
    && timelineResourcesTestCode.includes('timeline dynamic width contract derives surfaces from range and cell geometry'));
check('Timeline time marker collision resolver handles start and end edges',
    timelineCode.includes('function timelineResolveTimeMarkCollisions(placements, gridWidth')
    && timelineCode.includes('function timelineShouldRenderTimeMarkAtDensity(markMinutes, startMinutes, endMinutes, cellMinutes, cellWidth')
    && timelineCode.includes('timelineShouldRenderTimeMarkAtDensity(markMinutes, startMinutes, endMinutes, cellMinutes, cellWidth)')
    && timelineCode.includes('pushFromStart();')
    && timelineCode.includes('pullFromEnd();')
    && timelineCode.includes('timelineResolveTimeMarkCollisions(placements, gridWidth, TIMELINE_TIME_MARK_LABEL_GAP)')
    && timelineResourcesTestCode.includes('timeline time marker placement clamps start label without overlapping the first interval mark')
    && timelineResourcesTestCode.includes('timeline time marker placement thins minor labels when compact density cannot fit every interval')
    && timelineResourcesTestCode.includes('timeline time marker placement clamps end label without overlapping the previous mark')
    && cssRuleText(timelineConstructorCss, '.time-scale .time-mark.start-mark').includes('text-align: center')
    && cssRuleText(timelineConstructorCss, '.mini-time-mark.start').includes('text-align: center')
    && !cssRuleText(timelineConstructorCss, '.time-scale .time-mark.start-mark').includes('left: 0')
    && !/time-mark\.start-mark[^{]*\{[^}]*text-align:\s*left/.test(timelineConstructorCss + responsiveCss)
    && !/mini-time-mark\.start[^{]*\{[^}]*text-align:\s*left/.test(timelineConstructorCss + responsiveCss)
    && htmlContains('tests/timeline-lifecycle.test.js', 'date navigation keeps start marker geometry readable after scroll reset')
    && htmlContains('tests/timeline-week-parity.test.js', 'week mini timeline start and end labels use shared collision geometry')
    && htmlContains('tests/timeline-release-proof.test.js', 'timeline release proof stack covers start and end marker alignment regressions'));
check('Timeline compact fit-screen width uses interval cells without adding the end label as a cell',
    uiCode.includes('function _timelineRangeBoundMinutes(value)')
    && uiCode.includes('function _timelineRangeCellCount(range, level)')
    && timelineFitCellWidthBlock.includes('const cells = _timelineRangeCellCount(range, level)')
    && !timelineFitCellWidthBlock.includes('+ 1')
    && !timelineFitCellWidthBlock.includes('range.end - range.start'));
check('Timeline now-line is measured to rows instead of covering the sticky time scale', uiCode.includes("document.getElementById('timelineLines')") && uiCode.includes('timelineLines.scrollHeight') && uiCode.includes('--timeline-now-line-top') && uiCode.includes('--timeline-now-line-height') && timelineConstructorCss.includes('top: var(--timeline-now-line-top, 0)') && timelineConstructorCss.includes('height: var(--timeline-now-line-height, 100%)') && !timelineConstructorCss.includes('.now-line-global {\n    position: absolute;\n    top: 0;\n    bottom: 0;'));
check('Timeline period selector supports only day and week modes', htmlContains('index.html', 'data-period="1"') && htmlContains('index.html', 'data-period="7"') && !htmlContains('index.html', 'data-period="3"') && !htmlContains('index.html', 'id="daysCount"') && timelineConfigCode.includes('TIMELINE_PERIOD_WEEK = 7') && timelineConfigCode.includes('normalizeTimelineModeState') && appCode.includes('function applyTimelinePeriod') && appCode.includes("__timelinePeriodDelegatedBound") && appCode.includes('function bootstrapInitializeApp') && appCode.includes("document.readyState === 'loading'") && timelineVisibilityCode.includes("visualBlock('viewModes'"));
check('Timeline dark event cards use solid readable surfaces', darkModeCss.includes('--eg-event-quest-bg: linear-gradient') && darkModeCss.includes('.timeline-dashboard-page .mini-booking-block') && darkModeCss.includes('.timeline-dashboard-page.dark-mode .booking-block,') && darkModeCss.includes('body.timeline-dashboard-page.dark-mode .booking-block.linked-ghost') && darkModeCss.includes('.timeline-dashboard-page .mini-booking-block.banquet'));
check('Timeline booking blocks show selected costumes on the visual card',
    timelineCode.includes('function bookingCostumeLabel')
    && timelineCode.includes('Костюм: ${costume}')
    && timelineCode.includes('const costumeText = costumeLabel ? `<div class="costume-text">')
    && timelineCode.includes('aria-label\', `${isMaysternyaSlotClosed ? closedSlotLabel')
    && timelineCode.includes('miniTitleParts.push(costumeLabel)')
    && timelineCode.includes('const miniCostumeText = costumeLabel ? `<span class="mini-booking-costume">')
    && timelineConstructorCss.includes('.booking-block .costume-text')
    && timelineConstructorCss.includes('.mini-booking-costume')
    && timelineConstructorCss.includes('text-overflow: ellipsis')
    && darkModeCss.includes('.timeline-dashboard-page.dark-mode .booking-block .costume-text')
    && darkModeCss.includes('.timeline-dashboard-page.dark-mode .mini-booking-costume'));

check('Sidebar navigation no longer delays on visible old DOM', !sidebarCode.includes('setTimeout(() => { window.location.href = href; }, 180)') && sidebarCode.includes('requestAnimationFrame(navigate)'));
check('Sidebar init is idempotent for shared bindings', sidebarCode.includes('transitionsBound') && sidebarCode.includes('sidebarToggleBound') && sidebarCode.includes('sidebarOverlayBound') && sidebarCode.includes('sidebarLinkBound'));
check('Sidebar mobile opener has one touch-safe owner and locks the phone canvas', appCode.includes('sharedSidebarOwnsMobileToggle') && appCode.includes('sidebarLegacyToggleBound') && sidebarCode.includes("toggle.dataset.sidebarToggleOwner = 'aurora'") && sidebarCode.includes("toggle.addEventListener('pointerup'") && sidebarCode.includes('aria-expanded') && sidebarCode.includes('sidebar-mobile-open') && sidebarCode.includes('sidebarMobileStateBound') && sidebarAuroraCss.includes('v0.73.0: phone and tablet sidebar entry reliability') && sidebarAuroraCss.includes('touch-action: manipulation') && sidebarAuroraCss.includes('translate3d(-105%, 0, 0)') && responsiveCss.includes('v0.73.0: final phone/tablet sidebar geometry after legacy responsive rules'));
check('Sidebar uses AI command deck instead of legacy equal status cards', sidebarCode.includes('function _ensureCommandDeck') && sidebarCode.includes('sidebarCommandDeck') && sidebarCode.includes('focusChipTasks') && sidebarCode.includes('focusChipAlerts') && !sidebarCode.includes('function _ensurePillsRow'));
check('Sidebar command task chip honors task page access', sidebarCode.includes('function _canSeeSidebarTaskSurface') && sidebarCode.includes("const taskItem = { href: '/tasks', access: 'tasks' }") && sidebarCode.includes('tasks.hidden = !canSeeTasks') && sidebarCode.includes('if (!_canSeeSidebarTaskSurface())') && htmlContains('middleware/auth.js', "'/tasks':     ALL_STAFF") && htmlContains('js/auth.js', "'/tasks':     _ALL_STAFF") && sidebarCode.includes('tasks:          _ALL_STAFF'));
check('Task quick widgets split completed-today and truthful open workload counts', profileCode.includes('function cabinetTaskQuickCounts') && profileCode.includes('виконано сьогодні') && profileCode.includes('cabinet-quick-split') && profileCode.includes('cabinet-quick-half--completed') && profileCode.includes('cabinet-quick-half--remaining') && profilePagesCss.includes('.cabinet-quick-divider') && sidebarCode.includes('/api/tasks/my-cabinet') && sidebarCode.includes('_isSidebarTaskCompletedToday') && sidebarCode.includes('_isSidebarTaskOpen') && sidebarCode.includes('sidebarOpenWorkload') && sidebarCode.includes('focusChipTasksDoneValue') && sidebarCode.includes('focus-chip-task-split') && sidebarAuroraCss.includes('.focus-chip-task-divider') && htmlContains('routes/tasks.js', 'completed: quickStats.done_today') && htmlContains('routes/tasks.js', 'openTaskCount') && htmlContains('routes/tasks.js', 'open_count') && !htmlContains('routes/tasks.js', 'const openTaskCount = rows.length') && !sidebarCode.includes("Number(tasks.assigned || 0) + Number(tasks.in_progress || 0)") && !sidebarCode.includes("activeCount = mine.filter(task => !['done', 'cancelled', 'archived'].includes(task.status) && _isSidebarTaskTodayOrUndated"));
check('Sidebar scenario IA is grouped around today, sales, team, product, and system', sidebarCode.includes("key: 'today'") && sidebarCode.includes("key: 'sales'") && sidebarCode.includes("key: 'team'") && sidebarCode.includes("key: 'product'") && sidebarCode.includes("key: 'system'") && sidebarCode.includes('getRolePreferredGroups'));
const hrPulseIndex = sidebarCode.indexOf("href: '/hr',           icon: '🤝', label: 'Пульс компанії'");
const hrTeamIndex = sidebarCode.indexOf("href: '/hr#team',      icon: '👥', label: 'Команда'");
const hrStructureIndex = sidebarCode.indexOf("href: '/hr#structure', icon: 'center', label: 'Структура'");
const hrPayrollIndex = sidebarCode.indexOf("href: '/hr#payroll',   icon: '📊', label: 'ЗП та KPI'");
const hrCheckinIndex = sidebarCode.indexOf("href: '/checkin',      icon: '📸', label: 'Check-in'");
const hrOtherIndex = sidebarCode.indexOf("href: '/hr#other',     icon: '🧭', label: 'Вакансії'");
const hrTrainingIndex = sidebarCode.indexOf("href: '/training',     icon: '🎓', label: 'Навчання'");
check('Sidebar HR exposes a clean IA without duplicate HR or leaked subitems', hrPulseIndex > -1 && hrTeamIndex > hrPulseIndex && hrStructureIndex > hrTeamIndex && hrPayrollIndex > hrStructureIndex && hrCheckinIndex > hrPayrollIndex && hrOtherIndex > hrCheckinIndex && hrTrainingIndex > hrOtherIndex && sidebarCode.includes("activeHashes: ['today', 'schedule', 'reports']") && sidebarCode.includes("activeHashes: ['team', 'workers', 'interns', 'reserve', 'blacklist', 'dismissed']") && sidebarCode.includes("activeHashes: ['structure', 'professions', 'checklists', 'accounts']") && sidebarCode.includes("activeHashes: ['payroll', 'salary', 'zrs', 'kpi']") && sidebarCode.includes("activeHashes: ['other', 'vacancies']") && sidebarCode.includes("activeHashes: ['materials', 'tests', 'progress', 'leaderboard', 'onboarding']") && !sidebarCode.includes("activeHashes: ['other', 'onboarding', 'vacancies']") && !sidebarCode.includes("activeHashes: ['other', 'onboarding', 'vacancies', 'costumes']") && sidebarCode.includes('HR_TEAM_BUCKET_VISIBILITY') && sidebarCode.includes("admin: ['workers', 'interns', 'dismissed']") && sidebarCode.includes("HR_TEAM_BUCKET_VISIBILITY_MANAGERS = ['creator', 'director', 'vice_director']") && !sidebarCode.includes("href: '/hr#team',      icon: '🤝', label: 'HR'") && !sidebarCode.includes("navLegacy: true") && !sidebarCode.includes("href: '/hr#professions'") && !sidebarCode.includes("href: '/hr#checklists'") && !sidebarCode.includes("href: '/hr#accounts'") && !sidebarCode.includes("href: '/hr#salary'") && !sidebarCode.includes("href: '/hr#kpi'") && !sidebarCode.includes("href: '/hr#onboarding'") && !sidebarCode.includes("href: '/hr#vacancies'") && !sidebarCode.includes("navSubitem:") && !sidebarCode.includes('data-sidebar-subitem') && !sidebarCode.includes('nav-link--subitem') && !sidebarAuroraCss.includes('nav-link--subitem') && !sidebarCode.includes("href: '/hr#today'") && !sidebarCode.includes("href: '/hr#schedule'") && !sidebarCode.includes("href: '/hr#reports'") && !sidebarCode.includes("href: '/hr#workers'") && !sidebarCode.includes("href: '/hr#interns'") && !sidebarCode.includes("href: '/hr#reserve'") && !sidebarCode.includes("href: '/hr#blacklist'") && !sidebarCode.includes("href: '/hr#dismissed'") && htmlContains('js/hr-page.js', "{ id: 'structure', label: 'Структура' }") && htmlContains('js/hr-page.js', "{ id: 'professions', label: 'Професії' }") && htmlContains('js/hr-page.js', "{ id: 'checklists', label: 'Чеклисти' }") && htmlContains('js/hr-page.js', "{ id: 'accounts', label: 'Акаунти', visible: () => canManageAccountSecurity() }"));
check('Sidebar additional menu uses a simple CRM page checklist editor', sidebarCode.includes('EXTRA_MENU_STORAGE_KEY') && sidebarCode.includes('_getSelectableExtraMenuItems') && sidebarCode.includes('_saveExtraMenuSelection') && sidebarCode.includes('data-sidebar-extra-picker') && sidebarCode.includes('data-sidebar-extra-page') && sidebarCode.includes('data-sidebar-extra-save') && !sidebarCode.includes('data-sidebar-extra-reset') && !sidebarCode.includes('data-sidebar-extra-clear') && !sidebarCode.includes('data-sidebar-extra-select-all') && !sidebarCode.includes('data-sidebar-extra-form') && !sidebarCode.includes('data-sidebar-extra-edit=') && !sidebarCode.includes('data-sidebar-extra-delete') && !sidebarCode.includes('Notion · daily ops') && !sidebarCode.includes('calendar.google.com') && !sidebarCode.includes('web.monobank.ua'));
check('Sidebar removes duplicated day menu and keeps Additional as the only quick CRM section with a universal favorites baseline', !sidebarCode.includes('TODAY_MENU_HREFS') && !sidebarCode.includes('sidebar-today-menu-grid') && sidebarCode.includes('_removeSidebarTodayDock') && sidebarCode.includes("const EXTRA_MENU_HREFS = ['/', '/staff', '/chat', '/certificates']") && sidebarCode.includes("href: '/certificates'") && sidebarCode.includes("href: '/staff'") && sidebarCode.includes('quickAccessOnly: true') && !sidebarCode.includes("href: '#certificates'"));
check('Role quick access uses one universal baseline for every role', authCode.includes("const ROLE_QUICK_ACCESS_BASE = ['/', '/staff', '/chat', '/certificates']") && authCode.includes('quickAccess: ROLE_QUICK_ACCESS_BASE') && authCode.includes('const _STAFF_PAGE_ACCESS = _ALL_STAFF') && htmlContains('middleware/auth.js', 'const STAFF_PAGE_ACCESS = ALL_STAFF') && sidebarCode.includes("const EXTRA_MENU_STORAGE_KEY = 'eg_sidebar_extra_menu_items_v3'") && sidebarCode.includes('const UTILITY_RAIL_MAX_FAVORITES = 4') && sidebarCode.includes("href: '/staff'") && sidebarCode.includes('schedule_daily: _ALL_STAFF') && sidebarCode.includes('_getSelectedExtraMenuHrefs(role)') && sidebarCode.includes('.map(href => byHref.get(href))') && htmlContains('js/staff-page.js', 'StaffState.canManage = canManage') && htmlContains('js/staff-page.js', "cell.setAttribute('aria-readonly', 'true')") && featureRegistryCode.includes("id: 'afisha.events'") && featureRegistryCode.includes("href: '/afisha'") && featureRegistryCode.includes("id: 'products.programs'") && featureRegistryCode.includes("id: 'products.cakes'") && featureRegistryCode.includes("id: 'products.menu'") && featureRegistryCode.includes("id: 'products.animation'"));
check('Theme switch belongs to the top-right header, not the sidebar or timeline toolbar', authCode.includes('function initHeaderThemeToggle') && authCode.includes('headerThemeToggle') && authCode.includes("currentUser.insertAdjacentElement('afterend', btn)") && authCode.includes('applyCrmThemeMode') && layoutCss.includes('.header-theme-toggle') && layoutCss.includes('.header-theme-glyph--sun') && layoutCss.includes('.header-theme-glyph--moon') && layoutCss.includes('.header-theme-toggle.is-dark .header-theme-thumb') && !layoutCss.includes('.sidebar-theme-btn') && !sidebarCode.includes('_initThemeToggle') && !sidebarCode.includes('sidebar-theme-btn') && !htmlContains('index.html', 'id="darkModeToggle"') && !htmlContains('index.html', 'id="darkModeIcon"'));
check('CRM dark theme is the default unless a user explicitly chose light', fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8').includes('const CRM_DEFAULT_DARK_MODE = true') && htmlContains('index.html', "var d=s!=='false';") && htmlContains('profile.html', "var d=s!=='false';") && fs.readFileSync(path.join(ROOT, 'js/chat-page.js'), 'utf8').includes('window.CRM_DEFAULT_DARK_MODE !== false') && fs.readFileSync(path.join(ROOT, 'js/profile-page.js'), 'utf8').includes("localStorage.getItem('pzp_dark_mode') !== 'false'"));
check('Header right-side actions hide duplicate profile name and share compact control sizing', layoutCss.includes('.header .user-panel > .user-name') && layoutCss.includes('display: none !important') && layoutCss.includes('width: 64px') && layoutCss.includes('min-height: 42px') && layoutCss.includes('border-radius: 12px'));
check('Global search is injected by the shared authenticated header on all CRM pages', authCode.includes('function initGlobalHeaderSearch') && authCode.includes('ensureGlobalSearchModal') && authCode.includes('js/search.js') && authCode.includes('js/crm-feature-registry.js') && authCode.includes('globalHeaderSearchBtn') && layoutCss.includes('v0.56.6: shared header search') && layoutCss.includes('.header-search-btn') && layoutCss.includes('.search-overlay') && layoutCss.includes('.search-container'));
check('Global search finds CRM pages, sections, product links, feature registry aliases, and assistant redirect commands', searchCode.includes('SEARCH_NAV_ALIASES') && searchCode.includes('window.Sidebar?.NAV_ITEMS') && searchCode.includes('getFeatureRegistryNavigationItems') && featureRegistryCode.includes('видати грамоту') && featureRegistryCode.includes("href: '/afisha'") && featureRegistryCode.includes("href: '/programs#kitchen-cakes'") && featureRegistryCode.includes("href: '/hr#dismissed'") && featureRegistryCode.includes('звільнені співробітники') && searchCode.includes("'/programs#animation'") && searchCode.includes("'/programs#kitchen-menu'") && searchCode.includes('buildNavigationResults') && searchCode.includes('buildAssistantSuggestion') && searchCode.includes('assistant_command') && searchCode.includes('window.CrmAssistantRail?.tryRunAssistantCommand') && searchCode.includes('/sales-funnel') && searchCode.includes('/finance') && layoutCss.includes('v0.57.12: global search is also a CRM navigation and assistant command hub') && featuresCss.includes('v0.57.12: global search navigation/assistant hub styling parity'));
check('Global search dark theme keeps modal hints and navigation results readable', layoutCss.includes('v0.61.44: global search dark contrast') && featuresCss.includes('v0.61.44: global search dark contrast') && layoutCss.includes('html[data-theme="dark"] .search-container') && featuresCss.includes('html[data-theme="dark"] .search-hint') && layoutCss.includes('background: rgba(15,23,42,0.58)') && featuresCss.includes('color: #CBD5E1'));
const visibleAssistantNamingText = [
    'js/assistant-rail.js',
    'js/dashboard-page.js',
    'js/components/sidebar.js',
    'js/kleshnya-page.js',
    'js/kleshnya-widget.js',
    'chat.html',
    'landing/script.js'
].map(file => fs.readFileSync(path.join(ROOT, file), 'utf8')).join('\n');
check('User-facing assistant naming uses Помічник instead of legacy crab branding', visibleAssistantNamingText.includes('Помічник') && !/(Клеш|клеш|КЛЕШ|к л е ш н я|🦀|🦞)/.test(visibleAssistantNamingText));
check('Sidebar role-aware focus honors runtime role switches before stored profile role', sidebarCode.includes('function _getSidebarActiveRole') && /runtimeRole\s*\|\|\s*_getSidebarPrimaryRole/.test(sidebarCode) && !/_getSidebarPrimaryRole\([^)]*\)\s*\|\|\s*\(typeof getUserRole/.test(sidebarCode));
check('Certificate issue flow avoids automatic iPhone preview generation', settingsCode.includes('function isCertificateTouchDevice') && settingsCode.includes("closeCertificateModalById('certificateModal')") && settingsCode.includes('showCertDetail(result.certificate.id)') && settingsCode.includes('on desktop only'));
check('Legacy certificate launchers route to page-level creation flows', settingsCode.includes("window.location.href = '/certificates';") && settingsCode.includes("window.location.href = '/certificates/new';") && settingsCode.includes("window.location.href = '/certificates/batch';"));
check('Certificate detail preview has safe fallback instead of unhandled canvas promise', settingsCode.includes('options = {}') && settingsCode.includes('skipPreview') && settingsCode.includes('Certificate preview generation failed') && settingsCode.includes('cert-preview-fallback'));
check('Legacy certificate detail uses static iPhone preview instead of text-only fallback', settingsCode.includes('function renderCertificateStaticPreview') && settingsCode.includes('cert-preview-static-card') && settingsCode.includes("renderCertificateStaticPreview(preview, cert, { reason: 'touch' })") && settingsCode.includes("openTouchDownloadWindow('Сертифікат')") && featuresCss.includes('.cert-preview-static-card'));
check('Legacy certificate detail preview keeps a ratio-safe modal canvas', htmlContains('index.html', 'modal-content cert-detail-modal-content') && settingsCode.includes("canvas.className = 'cert-detail-preview-canvas'") && featuresCss.includes('#certDetailModal .cert-detail-modal-content') && featuresCss.includes('aspect-ratio: 3 / 2') && featuresCss.includes('height: auto !important') && !/\.cert-image-preview canvas\s*\{[^}]*max-height:\s*42dvh/s.test(responsiveCss));
check('Timeline add animator falls back to local CRM line when Telegram send is unavailable', settingsCode.includes('function addAnimatorLineLocallyAfterTelegramFallback') && settingsCode.includes('getNextTimelineAnimatorLine') && settingsCode.includes('Telegram зараз недоступний') && settingsCode.indexOf("showNotification('Надсилаю запит у Telegram...', 'info')") < settingsCode.indexOf('const result = await apiTelegramAskAnimator') && settingsCode.indexOf('renderPendingLine();') > settingsCode.indexOf('if (!result || !result.success || !result.requestId)'));
check('Settings legacy automation and bot username calls use real mounted routes', settingsCode.includes('`${API_BASE}/automation-rules`') && settingsCode.includes('`${API_BASE}/settings/bot_username`') && !settingsCode.includes('/settings/automation-rules') && !settingsCode.includes('/settings/settings/bot_username'));
check('Settings Maysternya line creation uses CRM prompt modal without native fallback', settingsCode.includes("await promptModal('Назва спеціаліста або кабінету'") && !settingsCode.includes('window.prompt'));
check('Timeline add animator resolves Telegram target from animator, notifications, Omni, and known topic fallbacks', fs.readFileSync(path.join(ROOT, 'routes/telegram.js'), 'utf8').includes('resolveAnimatorAskTelegramTarget') && fs.readFileSync(path.join(ROOT, 'routes/telegram.js'), 'utf8').includes('telegram_animator_chat_id') && fs.readFileSync(path.join(ROOT, 'routes/telegram.js'), 'utf8').includes('TELEGRAM_NOTIFICATIONS_CHAT_ID') && fs.readFileSync(path.join(ROOT, 'routes/telegram.js'), 'utf8').includes('findKnownTelegramThreadId') && fs.readFileSync(path.join(ROOT, 'services/telegram.js'), 'utf8').includes('runtime.defaultChatId'));
check('Certificate mobile modals use iPhone-safe viewport and close target styling', responsiveCss.includes('#certificateModal.modal') && responsiveCss.includes('100dvh') && responsiveCss.includes('touch-action: manipulation') && featuresCss.includes('.cert-preview-fallback') && globalModalsCss.includes('background: transparent'));
check('Shared modal close controls close nearest modal on click and touch', uiCode.includes('function closeModalFromControl') && uiCode.includes('initSharedModalCloseControls') && uiCode.includes("document.addEventListener('touchend'") && appCode.includes("btn.dataset.modalCloseBound === '1'") && !appCode.includes("btn.addEventListener('click', closeAllModals)"));
check('Shared formModal keeps actions on-screen on tall forms', uiCode.includes('form-modal-overlay') && uiCode.includes('form-modal-dialog') && globalModalsCss.includes('v0.60.37: shared formModal must keep submit actions on-screen') && globalModalsCss.includes('max-height: calc(100dvh - 32px)') && globalModalsCss.includes('.form-modal-dialog .form-modal-fields') && globalModalsCss.includes('overflow-y: auto') && globalModalsCss.includes('.form-modal-dialog .confirm-actions'));
check('Timeline canvas exports have mobile Safari fallback instead of raw toDataURL downloads', uiCode.includes('openTouchImageExportWindow') && uiCode.includes('finishCanvasImageExport') && uiCode.includes('timeline_canvas_context_unavailable') && !uiCode.includes("link.href = canvas.toDataURL('image/png')"));
check('Timeline image export uses room-aware line booking matching', uiCode.includes('function getTimelineExportLineBookings') && uiCode.includes('timelineBookingsForLine(bookings, line)') && uiCode.includes('normalizeTimelineExportBookings') && uiCode.includes('normalizeTimelineExportLines') && uiCode.includes('getTimelineExportLineBookings(dd.bookings, line)') && !uiCode.includes("String(b.lineId || '') === String(line.id || '')"));
check('Sidebar visual contract defines command deck, focus chips, and quiet nav states', sidebarAuroraCss.includes('.sidebar-command-deck') && sidebarAuroraCss.includes('.focus-chip') && sidebarAuroraCss.includes('.nav-status') && sidebarAuroraCss.includes('.sidebar-group-signal') && sidebarAuroraCss.includes('display: none !important'));
check('Sidebar v0.61.22 refresh covers light, dark, active, and collapsed rail states', sidebarAuroraCss.includes('v0.61.22: global sidebar theme refresh') && sidebarAuroraCss.includes('--sb-polish-active') && sidebarAuroraCss.includes('body:not(.dark-mode) .sidebar-nav') && sidebarAuroraCss.includes('body.dark-mode .sidebar-nav') && sidebarAuroraCss.includes('.sidebar-nav.collapsed .sidebar-mini-link.active') && sidebarAuroraCss.includes('box-shadow: inset 3px 0 0 var(--sb-enterprise-accent)'));
check('Timeline legacy menu cleanup self-hides empty contextual action menu', layoutCss.includes('v0.61.22: timeline action menu cleanup') && layoutCss.includes('.admin-dropdown.is-empty') && appCode.includes('function refreshTimelineActionMenuVisibility') && appCode.includes('sidebar owns navigation') && !appCode.includes("document.getElementById('afishaBtn')"));
check('Timeline action menu lifecycle force-closes stale toolbar overlays after refresh', appCode.includes('function setTimelineActionMenuOpen') && appCode.includes('function closeTimelineActionMenu') && appCode.includes('function normalizeTimelineToolbarTransientState') && appCode.includes('content.hidden = !nextOpen') && appCode.includes("content.setAttribute('aria-hidden'") && appCode.includes('dataset.timelineActionMenuBound') && timelineCode.includes("normalizeTimelineToolbarTransientState('render-start')") && timelineCode.includes("refreshTimelineActionMenuVisibility({ forceClosed: true, reason: 'render-actions' })") && timelineCode.includes("normalizeTimelineToolbarTransientState('render-complete')") && layoutCss.includes('v0.73.1: closed Timeline action menu must leave no toolbar ghost block') && layoutCss.includes('.dropdown-content[hidden]') && layoutCss.includes('.dropdown-content[aria-hidden=\"true\"]') && layoutCss.includes('.is-open .dropdown-content'));
check('Sidebar brand shows Event Genix gear instead of CSS shield mark', sidebarAuroraCss.includes('restore the real Event Genix gear logo') && sidebarAuroraCss.includes('.sidebar-brand .logo-img-small') && sidebarAuroraCss.includes('display: block !important') && sidebarAuroraCss.includes('animation: none !important') && sidebarAuroraCss.includes('.sidebar-brand::before') && sidebarAuroraCss.includes('.sidebar-brand::after') && sidebarAuroraCss.includes('content: none !important'));
check('Sidebar shell width applies to page-container pages', sidebarAuroraCss.includes('stable on page-container pages') && sidebarAuroraCss.includes('body.shell-ready .page-container') && sidebarAuroraCss.includes('width: calc(100% - var(--eg-claude-sidebar-w))') && sidebarAuroraCss.includes('body.shell-ready .sidebar-nav.collapsed ~ .header ~ .page-container'));
check('Sidebar brand and identity text cannot wrap into broken columns', sidebarAuroraCss.includes('.sidebar-brand .em-logo-title') && sidebarAuroraCss.includes('white-space: nowrap !important') && sidebarAuroraCss.includes('text-overflow: ellipsis !important') && sidebarAuroraCss.includes('.sidebar-identity-title-line'));
check('Sidebar collapsed rail does not auto-expand over page content', sidebarAuroraCss.includes('--eg-sidebar-collapsed-w: 74px') && sidebarAuroraCss.includes('body.shell-ready .sidebar-nav.collapsed:hover') && sidebarAuroraCss.includes('width: var(--eg-sidebar-collapsed-w)') && sidebarAuroraCss.includes('overflow-x: hidden !important') && sidebarAuroraCss.includes('body.shell-ready .sidebar-nav.collapsed:hover .sidebar-design-extras') && sidebarAuroraCss.includes('display: none !important'));
check('Sidebar collapsed utility rail uses favorites, primary routes, preview cards, and a contextual flyout', sidebarCode.includes('UTILITY_RAIL_PRIMARY_HREFS') && sidebarCode.includes('UTILITY_RAIL_MAX_FAVORITES') && sidebarCode.includes('function _buildUtilityRailModel') && sidebarCode.includes('data-sidebar-rail-flyout') && sidebarCode.includes('sidebarRailFloat') && sidebarCode.includes('function _showRailFlyout') && sidebarCode.includes("event.key === 'Escape'") && !sidebarCode.includes('nav-tooltip') && sidebarAuroraCss.includes('v0.63.42: collapsed sidebar utility rail') && sidebarAuroraCss.includes('.sidebar-rail-preview') && sidebarAuroraCss.includes('.sidebar-rail-flyout') && sidebarAuroraCss.includes('.sidebar-mini-current'));
check('Sidebar collapsed rail is useful without hover-only guessing on tablets', sidebarCode.includes('RAIL_SHORT_LABEL_BY_HREF') && sidebarCode.includes('function _railShortLabel') && sidebarCode.includes('sidebar-mini-label') && sidebarCode.includes('sidebar-mini-count') && sidebarCode.includes('sidebar-rail-section-title') && sidebarAuroraCss.includes('v0.73.0: useful collapsed sidebar rail') && sidebarAuroraCss.includes('.sidebar-nav.collapsed .sidebar-mini-label') && sidebarAuroraCss.includes('.sidebar-mini-link--flyout .sidebar-mini-count') && sidebarAuroraCss.includes('grid-template-rows: 30px auto') && sidebarAuroraCss.includes('--eg-tablet-sidebar-rail-w: 88px') && responsiveCss.includes('--eg-tablet-sidebar-rail-w: 88px'));
check('Sidebar collapsed flyout keeps internal scroll and centered rail icons', sidebarCode.includes('function _handleRailFloatDocumentScroll') && sidebarCode.includes('panel.contains(target)') && sidebarCode.includes('window.addEventListener(\'scroll\', _handleRailFloatDocumentScroll, true)') && sidebarAuroraCss.includes('v0.73.44: collapsed rail flyout keeps its own scroll') && sidebarAuroraCss.includes('.sidebar-rail-flyout-body') && sidebarAuroraCss.includes('overscroll-behavior: contain') && sidebarAuroraCss.includes('.sidebar-mini-icon .nav-icon-magnet') && sidebarAuroraCss.includes('.sidebar-rail-flyout-icon .eg-icon-svg'));
check('Sidebar collapse control is visible and owns an icon mini rail', sidebarCode.includes('function _ensureSidebarCollapseButton') && sidebarCode.includes('function _setSidebarCollapsed') && sidebarCode.includes('sidebarMiniRail') && sidebarAuroraCss.includes('v0.55.43: persistent sidebar collapse button + icon rail') && sidebarAuroraCss.includes('.sidebar-nav.collapsed .sidebar-mini-rail') && sidebarAuroraCss.includes('.sidebar-mini-link.active') && sidebarAuroraCss.includes('.sidebar-collapse-btn') && sidebarAuroraCss.includes('display: inline-flex !important'));
check('Sidebar collapsed shell offsets use the rail width token', sidebarAuroraCss.includes('margin-left: var(--eg-sidebar-collapsed-w)') && sidebarAuroraCss.includes('width: calc(100% - var(--eg-sidebar-collapsed-w))') && sidebarAuroraCss.includes('body.shell-ready .sidebar-nav.collapsed ~ .header ~ .main-content.panel-open'));
check('Sidebar shell reserves full menu width before shell-ready handoff', sidebarAuroraCss.includes('system shell geometry source of truth') && sidebarAuroraCss.includes('--eg-shell-sidebar-offset: var(--eg-claude-sidebar-w)') && sidebarAuroraCss.includes('body[data-page-group] .header') && sidebarAuroraCss.includes('body[data-page-group] .page-container') && sidebarAuroraCss.includes('width: calc(100vw - var(--eg-shell-sidebar-offset))') && sidebarAuroraCss.includes('body[data-page-group] .sidebar-nav.collapsed ~ .header ~ .page-container'));
check('Sidebar collapse has one canonical shared owner', sidebarCode.includes("sidebar.dataset.sidebarStateOwner = 'aurora'") && sidebarCode.includes("collapseBtn.dataset.sidebarCollapseOwner = 'aurora'") && appCode.includes('sharedSidebarOwnsCollapse') && appCode.includes('sidebarLegacyCollapseBound') && !appCode.includes("collapseBtn.dataset.sidebarCollapseBound = 'true'"));
check('Sidebar collapsed state is locked against legacy hover variants', sidebarAuroraCss.includes('single-state sidebar collapse lock') && sidebarAuroraCss.includes('body[data-page-group] .sidebar-nav.collapsed:hover') && sidebarAuroraCss.includes('.sidebar-nav.collapsed:hover .sidebar-command-deck') && sidebarAuroraCss.includes('.sidebar-nav.collapsed:hover .sidebar-dashboard-jump-wrap'));
check('Sidebar profile card allows full names and long positions', sidebarAuroraCss.includes('profile card typography must show full names and long positions') && sidebarAuroraCss.includes('body.shell-ready .sidebar-nav:not(.collapsed) .sidebar-identity-name') && sidebarAuroraCss.includes('text-overflow: clip !important') && sidebarAuroraCss.includes('white-space: normal !important') && sidebarAuroraCss.includes('body.shell-ready .sidebar-nav:not(.collapsed) .sidebar-identity-role') && sidebarAuroraCss.includes('overflow-wrap: anywhere !important'));
check('Sidebar compact density reduces menu footprint without changing shell ownership', sidebarAuroraCss.includes('v0.55.30: compact sidebar density') && sidebarAuroraCss.includes('--eg-claude-sidebar-w: clamp(248px, 14vw, 300px)') && sidebarAuroraCss.includes('min-height: 42px !important') && sidebarAuroraCss.includes('.sidebar-nav:not(.collapsed) .sidebar-design-extra-link') && sidebarAuroraCss.includes('.sidebar-nav:not(.collapsed) .sidebar-links .nav-link'));
check('Sidebar laptop shell leaves usable timeline viewport', sidebarAuroraCss.includes('v0.55.42: smaller sidebar shell on laptop widths') && sidebarAuroraCss.includes('--eg-claude-sidebar-w: clamp(224px, 18vw, 260px)') && sidebarAuroraCss.includes('@media (min-width: 1024px) and (max-width: 1366px)') && sidebarAuroraCss.includes('.sidebar-nav:not(.collapsed) .sidebar-command-deck'));
check('Timeline laptop layout scales controls and cell widths responsively', responsiveCss.includes('v0.55.42: responsive timeline and sidebar fit on laptop/small screens') && responsiveCss.includes('--timeline-cell-w') && responsiveCss.includes('grid-template-columns: minmax(0, 1fr) minmax(280px, 0.9fr)') && responsiveCss.includes('.timeline-scroll') && responsiveCss.includes('overflow-x: auto'));
check('Timeline toolbar avoids laptop header clipping and overlapping action menus', responsiveCss.includes('v0.66.3 / v0.75.39: timeline toolbar header keeps action menus outside clipping containers') && responsiveCss.includes('body.timeline-dashboard-page .control-panel') && responsiveCss.includes('overflow: visible !important') && responsiveCss.includes('isolation: isolate') && responsiveCss.includes('grid-template-areas:') && responsiveCss.includes('"date status view"') && responsiveCss.includes('"tools tools actions"') && responsiveCss.includes('"tools view"') && responsiveCss.includes('grid-area: actions !important') && responsiveCss.includes('z-index: 80') && responsiveCss.includes('body.timeline-dashboard-page .v32-controls') && responsiveCss.includes('z-index: 20') && responsiveCss.includes('body.timeline-dashboard-page .admin-dropdown[data-menu-scope="timeline-actions"] .dropdown-content') && responsiveCss.includes('z-index: 300'));
check('Sidebar v0.55.35 makes the upper command block compact without truncating profile text', sidebarAuroraCss.includes('v0.55.35: compact sidebar command deck') && sidebarAuroraCss.includes('--sb-command-compact-alert-min: 126px') && sidebarAuroraCss.includes('grid-template-columns: var(--sb-command-compact-avatar) minmax(0, 1fr) !important') && sidebarAuroraCss.includes('overflow-wrap: break-word !important') && sidebarAuroraCss.includes('min-height: 38px !important'));
check('Sidebar removes the large alert hero card while preserving alert chip data', !sidebarCode.includes('sidebarPrimaryAction') && !sidebarCode.includes('data-sidebar-alert-nav=') && !sidebarCode.includes('function _shiftSidebarAlertCursor') && !sidebarCode.includes('alertItems: []') && sidebarCode.includes('focusChipAlerts') && sidebarCode.includes('function _renderSidebarAlerts') && sidebarCode.includes('function openAlerts'));
check('Sidebar alert center remains the concrete alert surface', sidebarCode.includes('crm:alerts-updated') && sidebarCode.includes('_renderSidebarAlerts({ alerts: event.detail?.alerts || [] })') && fs.readFileSync(path.join(ROOT, 'js/alerts.js'), 'utf8').includes('function _goAlert') && baseCss.includes('.ap-item.sidebar-alert-target'));
check('Sidebar light theme keeps profile name readable after compact density', sidebarAuroraCss.includes('v0.55.31: light theme sidebar completion') && sidebarAuroraCss.includes('grid-template-columns: 1fr !important') && sidebarAuroraCss.includes('overflow-wrap: break-word !important') && sidebarAuroraCss.includes('body:not(.dark-mode) .sidebar-nav') && sidebarAuroraCss.includes('body:not(.dark-mode) .sidebar-command-deck') && sidebarAuroraCss.includes('body:not(.dark-mode) .sidebar-identity-name'));
check('Sidebar Additional and nav sections have stable ordered rerender slots', sidebarCode.includes('EXTRA_MENU_COLLAPSED_STORAGE_KEY') && sidebarCode.includes('function _syncSidebarSectionOrder') && sidebarCode.includes('data-sidebar-extra-toggle-section') && sidebarAuroraCss.includes('v0.55.39: stable sidebar section order') && sidebarAuroraCss.includes('.sidebar-command-deck') && sidebarAuroraCss.includes('order: 10 !important') && sidebarAuroraCss.includes('.sidebar-design-extras') && sidebarAuroraCss.includes('order: 20 !important') && sidebarAuroraCss.includes('.sidebar-links') && sidebarAuroraCss.includes('order: 30 !important'));
check('Sidebar Additional menu has a persistent collapsed state and editable expanded state', sidebarCode.includes('_isExtraMenuCollapsed') && sidebarCode.includes('_setExtraMenuCollapsed(false)') && sidebarCode.includes('is-collapsed') && sidebarAuroraCss.includes('.sidebar-design-extras.is-collapsed .sidebar-design-extra-list') && sidebarAuroraCss.includes('.sidebar-design-extras.is-collapsed .sidebar-extra-editor'));
check('Sidebar Additional and group headers stay readable after compact density overrides', sidebarAuroraCss.includes('v0.56.3: sidebar menu readability polish') && sidebarAuroraCss.includes('.sidebar-nav:not(.collapsed) .sidebar-design-extras-head') && sidebarAuroraCss.includes('min-height: 42px !important') && sidebarAuroraCss.includes('.sidebar-nav:not(.collapsed) .sidebar-design-extras-dot::before') && sidebarAuroraCss.includes('.sidebar-nav:not(.collapsed) .sidebar-group-header') && sidebarAuroraCss.includes('grid-template-columns: 28px minmax(0, 1fr) 26px !important') && sidebarAuroraCss.includes('.sidebar-nav:not(.collapsed) .sidebar-group-header .nav-icon') && sidebarAuroraCss.includes('width: 26px !important'));
check('Sidebar collapsed groups clip submenu tails and disable hidden hit areas', sidebarCode.includes('aria-hidden="${finalOpen ?') && sidebarCode.includes("items.setAttribute('inert'") && sidebarCode.includes('function _syncSidebarGroupPanelStates') && sidebarAuroraCss.includes('v0.73.42: collapsed sidebar groups are clipped/inert') && sidebarAuroraCss.includes('grid-template-rows: 0fr') && sidebarAuroraCss.includes('grid-template-rows: 1fr') && sidebarAuroraCss.includes('pointer-events: none') && sidebarAuroraCss.includes('visibility 0s linear 0.24s') && sidebarAuroraCss.includes('overflow: hidden'));
check('Sidebar quick access header uses only Обране and replaces bulky Additional editor button', sidebarCode.includes('Обране') && sidebarCode.includes('sidebar-design-extras-gear') && sidebarCode.includes('Редагувати обране') && sidebarCode.includes('Сторінки обраного') && sidebarCode.includes('Знайти сторінку обраного') && !sidebarCode.includes('обране меню') && !sidebarCode.includes('Знайти сторінку швидкого доступу') && sidebarAuroraCss.includes('v0.57.1: Quick Access submenu polish') && sidebarAuroraCss.includes('grid-template-columns: minmax(0, 1fr) 34px !important') && sidebarAuroraCss.includes('v0.73.15: center the compact Favorites header') && sidebarAuroraCss.includes('display: grid !important') && sidebarAuroraCss.includes('grid-template-columns: 32px minmax(0, 1fr) 32px !important') && sidebarAuroraCss.includes('.sidebar-nav:not(.collapsed) .sidebar-design-extras-copy') && sidebarAuroraCss.includes('text-align: center !important') && sidebarAuroraCss.includes('.sidebar-design-extras-manage-text') && sidebarAuroraCss.includes('sidebarQuickGearSpin') && sidebarAuroraCss.includes('.sidebar-design-extras:not(.is-collapsed) .sidebar-design-extra-list::before'));
check('Sidebar productivity quick block matches Favorites collapse and settings behavior', sidebarCode.includes('PRODUCTIVITY_MENU_STORAGE_KEY') && sidebarCode.includes('PRODUCTIVITY_MENU_COLLAPSED_STORAGE_KEY') && sidebarCode.includes('PRODUCTIVITY_MENU_EDIT_STORAGE_KEY') && sidebarCode.includes('PRODUCTIVITY_QUICK_DEFAULT_HREFS') && sidebarCode.includes('sidebarProductivityQuick') && sidebarCode.includes('Особисте') && sidebarCode.includes('Особисті сторінки') && sidebarCode.includes('/profile?tab=myday') && sidebarCode.includes('/tasks?view=my') && sidebarCode.includes('Мій день') && sidebarCode.includes('function _renderProductivityQuickBlock') && sidebarCode.includes('function _renderProductivityEditor') && sidebarCode.includes('function _bindProductivityQuickBlock') && sidebarCode.includes('data-sidebar-productivity-toggle-section') && sidebarCode.includes('data-sidebar-productivity-toggle-editor') && sidebarCode.includes('data-sidebar-productivity-save') && sidebarCode.includes('new URLSearchParams(window.location.search') && sidebarAuroraCss.includes('v0.75.54: productivity quick block uses the same collapsible/settings shell as Favorites') && sidebarAuroraCss.includes('.sidebar-productivity-quick') && sidebarAuroraCss.includes('.sidebar-productivity-list[hidden]'));
check('Sidebar quick access editor keeps only Save and collapses after saving', sidebarCode.includes('data-sidebar-extra-search') && sidebarCode.includes('data-sidebar-extra-count') && sidebarCode.includes('_applyExtraMenuEditorFilter') && sidebarCode.includes('_setExtraMenuEditorOpen(false)') && sidebarCode.includes('_setExtraMenuCollapsed(true)') && sidebarAuroraCss.includes('.sidebar-extra-editor-tools') && sidebarAuroraCss.includes('grid-template-columns: minmax(0, 1fr) !important') && sidebarAuroraCss.includes('.sidebar-extra-search') && sidebarAuroraCss.includes('.sidebar-extra-save'));
check('Sidebar widget settings are separated from quick access pages and save deliberately', sidebarCode.includes('sidebar-widget-settings') && sidebarCode.includes('Налаштування віджетів') && sidebarCode.includes('Зміна застосовується після збереження') && sidebarCode.indexOf("_setSidebarCurrencySignalEnabled(currencySignal.checked)") < sidebarCode.indexOf("_saveExtraMenuSelection(checkedHrefs, role)") && sidebarCode.includes("extras.classList.add('has-widget-settings-dirty')") && sidebarAuroraCss.includes('.sidebar-widget-settings-head'));
check('Sidebar quick access gear opens only the checkbox settings panel', sidebarCode.includes('const editorWasOpen = _isExtraMenuEditorOpen();') && sidebarCode.includes('const extraListHidden = extraEditorOpen || extraCollapsed') && sidebarCode.includes('sidebar-design-extra-list"${extraListHidden ?') && sidebarAuroraCss.includes('.sidebar-design-extra-list[hidden]') && sidebarAuroraCss.includes('.sidebar-design-extras.is-editing .sidebar-design-extra-list'));
check('Sidebar identity card has compact passive time/date and optional currency signal without weather fetch noise', sidebarCode.includes('sidebarIdentityAux') && sidebarCode.includes('sidebarIdentityTime') && sidebarCode.includes('sidebarIdentityDate') && sidebarCode.includes('data-sidebar-static="true"') && sidebarCode.includes("item.dataset.sidebarStatic === 'true'") && !sidebarCode.includes('sidebarIdentityWeather') && sidebarCode.includes('sidebarIdentityCurrency') && sidebarCode.includes('SIDEBAR_CURRENCY_SIGNAL_STORAGE_KEY') && !sidebarCode.includes('/api/dashboard/widgets/weather') && sidebarCode.includes('/api/dashboard/widgets/currency') && !sidebarCode.includes('open-meteo.com') && sidebarCode.includes('Europe/Kyiv') && sidebarAuroraCss.includes('v0.58.0: enterprise sidebar navigation redesign') && sidebarAuroraCss.includes('v0.59.5: passive time/date widgets') && sidebarAuroraCss.includes('.sidebar-identity-aux'));
check('Sidebar identity card v2 keeps USD first and role badges patterned', sidebarCode.includes('function _sidebarRoleBadgeKey') && sidebarCode.includes('function _fetchSidebarCurrencyFallback') && sidebarCode.includes('/api/finance/currency/rates') && sidebarCode.includes('cardEl.dataset.role = roleKey') && sidebarAuroraCss.includes('v0.57.1: sidebar identity card v2') && sidebarAuroraCss.includes('.sidebar-identity-meta-item[data-sidebar-meta="currency"]') && sidebarAuroraCss.includes('order: 1 !important') && sidebarAuroraCss.includes('--role-badge-pattern') && sidebarAuroraCss.includes('.sidebar-identity-card[data-role="creator"]') && sidebarAuroraCss.includes('.sidebar-identity-card[data-role="dishwasher"]'));
check('Sidebar identity card keeps USD as the only chip and moves time/date under the avatar', sidebarCode.includes('sidebar-identity-portrait') && sidebarCode.includes('sidebar-identity-aux') && sidebarCode.includes('sidebar-identity-aux-item') && sidebarCode.includes('sidebar-identity-aux-v') && sidebarCode.indexOf('class="sidebar-identity-portrait"') < sidebarCode.indexOf('class="sidebar-identity-main"') && sidebarCode.indexOf('id="sidebarIdentityAux"') < sidebarCode.indexOf('class="sidebar-identity-main"') && !sidebarCode.includes('class="sidebar-identity-meta-item" data-sidebar-meta="time"') && !sidebarCode.includes('class="sidebar-identity-meta-item" data-sidebar-meta="date"') && sidebarAuroraCss.includes('v0.73.35: profile time/day stack belongs under the avatar') && sidebarAuroraCss.includes('"identity-portrait identity-main"') && sidebarAuroraCss.includes('.sidebar-identity-portrait') && sidebarAuroraCss.includes('grid-area: identity-main !important') && sidebarAuroraCss.includes('flex-wrap: nowrap !important') && sidebarAuroraCss.includes('.sidebar-identity-meta-item:not([data-sidebar-meta="currency"])') && sidebarAuroraCss.includes('display: none !important'));
check('Sidebar avatar falls back to initials when a profile image fails', sidebarCode.includes('function _sidebarAvatarFallback') && sidebarCode.includes("img.addEventListener('error'") && sidebarCode.includes("el.classList.remove('has-photo')") && sidebarCode.includes('el.textContent = fallback.label') && sidebarCode.includes('el.replaceChildren(img)') && sidebarCode.includes("img.loading = 'lazy'") && sidebarCode.includes("img.decoding = 'async'"));
check('Sidebar polished profile card gives name/role a full row and balances alert USD time/date', sidebarCode.indexOf('class="sidebar-identity-title-row"') < sidebarCode.indexOf('class="sidebar-identity-portrait"') && sidebarCode.indexOf('class="sidebar-identity-title-row"') < sidebarCode.indexOf('class="sidebar-identity-main"') && sidebarAuroraCss.includes('v0.73.36: polished profile card composition') && sidebarAuroraCss.includes('"identity-title identity-title"') && sidebarAuroraCss.includes('grid-template-columns: minmax(0, 1fr) max-content !important') && sidebarAuroraCss.includes('@keyframes sidebarIdentityAlertPulse') && sidebarAuroraCss.includes('.sidebar-command-deck[data-tone="critical"] .sidebar-identity-summary') && sidebarAuroraCss.includes('.sidebar-identity-aux-item + .sidebar-identity-aux-item') && sidebarAuroraCss.includes('grid-template-columns: auto minmax(0, 1fr) !important') && sidebarAuroraCss.includes('.sidebar-nav.collapsed .sidebar-identity-title-row'));
check('Sidebar profile business selector owns the full bottom row without a visible Business label', sidebarCode.indexOf('id="sidebarBusinessContextHost"') > sidebarCode.indexOf('class="sidebar-identity-main"') && !sidebarCode.includes('sidebar-business-label') && sidebarAuroraCss.includes('v0.73.41: profile business selector is label-free and stretches across the card') && sidebarAuroraCss.includes('v0.73.43: multi-business settings live behind a compact gear') && sidebarAuroraCss.includes('v0.73.52: business gear and Favorites gear share one size') && sidebarAuroraCss.includes('"identity-business identity-business"') && sidebarAuroraCss.includes('.sidebar-business-context') && sidebarAuroraCss.includes('grid-area: identity-business !important') && sidebarAuroraCss.includes('grid-column: 1 / -1 !important') && sidebarAuroraCss.includes('grid-template-columns: minmax(0, 1fr) !important') && sidebarAuroraCss.includes('.sidebar-business-control-row') && sidebarAuroraCss.includes('grid-template-columns: minmax(0, 1fr) 36px !important') && sidebarAuroraCss.includes('.sidebar-business-select') && sidebarAuroraCss.includes('height: 42px !important') && sidebarAuroraCss.includes('border-radius: 8px !important') && sidebarAuroraCss.includes('.sidebar-business-settings-btn') && sidebarAuroraCss.includes('sidebar-business-settings-btn:hover span') && sidebarAuroraCss.includes('animation: sidebarQuickGearSpin .5s ease both') && sidebarAuroraCss.includes('text-align: center !important') && sidebarAuroraCss.includes('border-top: 0 !important'));
check('Sidebar profile summary cleanup removes oval, de-pills role, and keeps identity signals split', sidebarCode.includes('const label = _sidebarRoleLabel(raw);') && !sidebarCode.includes('id="sidebarIdentityHealth"') && !sidebarCode.includes('sidebar-identity-health-dot') && sidebarAuroraCss.includes('v0.60.37: profile summary card cleanup') && sidebarAuroraCss.includes('.sidebar-identity-summary::before') && sidebarAuroraCss.includes('border-radius: 0 !important') && sidebarAuroraCss.includes('border-left: 1px solid color-mix') && sidebarAuroraCss.includes('grid-template-areas:') && sidebarAuroraCss.includes('"identity-business"'));
check('Sidebar USD tile fits the full rate after the polished profile layout', sidebarAuroraCss.includes('v0.73.36: polished profile card composition') && sidebarAuroraCss.includes('button.sidebar-identity-meta-item[data-sidebar-meta="currency"]') && sidebarAuroraCss.includes('grid-template-columns: auto minmax(0, 1fr) !important') && sidebarAuroraCss.includes('width: 100% !important') && sidebarAuroraCss.includes('.sidebar-identity-meta-item[data-sidebar-meta="currency"] .sidebar-identity-meta-v') && sidebarAuroraCss.includes('font-size: 12.2px !important') && sidebarAuroraCss.includes('text-overflow: unset !important') && sidebarAuroraCss.includes('.sidebar-identity-aux-v') && sidebarAuroraCss.includes('font-variant-numeric: tabular-nums !important'));
check('Sidebar currency signal opens the Finance rates window instead of a bottom sidebar panel', !sidebarCode.includes('function _fetchSidebarWeatherFallback') && sidebarCode.includes('function _openFinanceCurrencyRates') && sidebarCode.includes('/finance?currency=rates') && sidebarCode.includes("finance:open-currency-rates") && sidebarCode.includes('data-sidebar-currency-signal') && sidebarAuroraCss.includes('v0.58.15: sidebar currency chip is optional; full rates live in Finance.'));
check('Sidebar mobile quick access and identity chips keep the final no-cut fit', sidebarCode.includes('formatToParts(date)') && sidebarAuroraCss.includes('v0.72.0: mobile sidebar quick access fit') && sidebarAuroraCss.includes('--eg-sidebar-mobile-w: min(100vw, 336px)') && sidebarAuroraCss.includes('max-width: 76px !important') && sidebarAuroraCss.includes('grid-template-columns: minmax(0, 1fr) 44px !important') && sidebarAuroraCss.includes('grid-template-columns: 40px minmax(0, 1fr) 22px !important') && sidebarAuroraCss.includes('.sidebar-nav:not(.collapsed) .sidebar-design-extras-title') && sidebarAuroraCss.includes('white-space: normal !important') && sidebarAuroraCss.includes('.sidebar-extra-picker') && sidebarAuroraCss.includes('max-height: min(42dvh, 360px) !important'));
check('Sidebar enterprise redesign exposes component contracts, metric tones, ARIA and denser target widths', sidebarCode.includes('SIDEBAR_COMPONENTS') && sidebarCode.includes('SidebarShell') && sidebarCode.includes('UserSummaryCard') && sidebarCode.includes('function getMetricTone') && sidebarCode.includes("case 'tasks'") && sidebarCode.includes("case 'alerts'") && sidebarCode.includes("case 'leads'") && sidebarCode.includes('aria-expanded=') && sidebarCode.includes('aria-current="page"') && sidebarAuroraCss.includes('v0.67.4: компактніший sidebar') && sidebarAuroraCss.includes('--eg-claude-sidebar-w: clamp(196px, 12vw, 210px)') && sidebarAuroraCss.includes('--eg-sidebar-mobile-w: clamp(252px, 72vw, 280px)') && sidebarAuroraCss.includes('width: var(--eg-sidebar-mobile-w)') && sidebarAuroraCss.includes('--eg-sidebar-collapsed-w: 80px'));
check('Sidebar visual rhythm polish keeps one final spacing contract', sidebarAuroraCss.includes('v0.68.53: sidebar visual rhythm and layout polish') && sidebarAuroraCss.includes('--eg-sidebar-rhythm-x: 10px') && sidebarAuroraCss.includes('--eg-sidebar-card-radius: 10px') && sidebarAuroraCss.includes('.sidebar-nav:not(.collapsed) .sidebar-business-context') && sidebarAuroraCss.includes('grid-template-columns: minmax(0, 1fr) !important') && sidebarAuroraCss.includes('.sidebar-nav:not(.collapsed) .sidebar-design-extras-head-row') && sidebarAuroraCss.includes('grid-template-columns: minmax(0, 1fr) 36px !important'));
check('Sidebar identity header and rail rhythm stay tight after profile polish', sidebarAuroraCss.includes('v0.73.46: tighter sidebar identity header and denser navigation rhythm') && sidebarAuroraCss.includes('justify-content: flex-start') && sidebarAuroraCss.includes('border-left: 1px solid color-mix') && sidebarAuroraCss.includes('.sidebar-nav:not(.collapsed) .sidebar-links') && sidebarAuroraCss.includes('gap: 5px !important') && sidebarAuroraCss.includes('.sidebar-rail-section') && sidebarAuroraCss.includes('height: 54px !important'));
check('Sidebar shell has the compact one-third-smaller width pass', sidebarAuroraCss.includes('v0.57.11: compact shell sidebar') && sidebarAuroraCss.includes('--eg-claude-sidebar-w: clamp(196px, 11vw, 220px)') && sidebarAuroraCss.includes('--eg-claude-sidebar-w: clamp(184px, 14vw, 210px)') && sidebarAuroraCss.includes('.sidebar-command-kicker') && sidebarAuroraCss.includes('display: none !important') && sidebarAuroraCss.includes('.sidebar-nav:not(.collapsed) .sidebar-links .nav-link') && sidebarAuroraCss.includes('min-height: 34px !important'));
check('Sidebar dark profile card cleanup is explicit after light theme overrides', sidebarAuroraCss.includes('v0.55.32: dark profile card cleanup') && sidebarAuroraCss.includes('body.dark-mode .sidebar-nav:not(.collapsed) .sidebar-identity-card') && sidebarAuroraCss.includes('body.dark-mode .sidebar-identity-name') && sidebarAuroraCss.includes('body.dark-mode .sidebar-identity-health[data-tone="ready"]'));
check('Sidebar additional checklist editor has bounded selectable rows', sidebarAuroraCss.includes('v0.55.41: Additional editor is a simple CRM page checklist') && sidebarAuroraCss.includes('.sidebar-extra-picker') && sidebarAuroraCss.includes('.sidebar-extra-check') && sidebarAuroraCss.includes('.sidebar-extra-checkmark') && sidebarAuroraCss.includes('.sidebar-design-extra-empty'));
check('Sidebar dashboard jump does not reuse alert badges', !sidebarCode.includes("if (href === '/dashboard') return 'alerts';"));
check('Sidebar dashboard surface does not render the removed AI placeholder card', !sidebarCode.includes('sidebar-ai-companion') && !sidebarCode.includes('openAiCompanion') && !sidebarAuroraCss.includes('.sidebar-ai-companion'));
check('Sidebar does not inject duplicate profile now-card', !sidebarCode.includes('sidebarNowCard') && !sidebarCode.includes('sidebar-now-card') && !sidebarAuroraCss.includes('.sidebar-now-card'));
check('Sidebar profile card shows account role instead of time-based greeting', sidebarCode.includes('function _sidebarRoleLine') && !sidebarCode.includes('Доброго ранку') && !sidebarCode.includes('Доброго вечора') && !sidebarCode.includes('Гарного дня'));
const sidebarInitBody = sidebarCode.match(/function init\(containerSelector\) \{([\s\S]*?)\n    \}/)?.[1] || '';
check('Sidebar exposes explicit shell-ready API', sidebarCode.includes('markShellReady: _markShellReady') && sidebarCode.includes('clearShellReady: _clearShellReady'));
check('Sidebar init does not mark shell ready before page bootstrap', !sidebarInitBody.includes('_markShellReady()'));
check('Auth exposes shared authenticated shell reveal helper', authCode.includes('function showAuthenticatedPageShell()') && authCode.includes('Sidebar.markShellReady') && authCode.includes('function clearAuthenticatedPageShell()'));
check('Layout hides mainApp until shell readiness without depending on hidden class', layoutCss.includes('body[data-page-group]:not(.shell-ready) #mainApp {') && !layoutCss.includes('#mainApp:not(.hidden)'));
check('Layout gates page group animations behind shell readiness', layoutCss.includes('body.shell-ready[data-page-group="crm"]'));
check('Embedded iframe shells cancel shared sidebar geometry', layoutCss.includes('v0.63.26: embedded CRM surfaces must not reserve the parent sidebar width') && layoutCss.includes('html.embed-mode body[data-page-group] .page-container') && layoutCss.includes('body.embed-mode[data-page-group] .main-content') && layoutCss.includes('width: 100% !important'));
check('Art iframe sources opt into embedded shell before layout paint', htmlContains('graduation.html', "document.documentElement.classList.add('embed-mode')") && htmlContains('graduation.html', 'width: 100% !important') && htmlContains('designs.html', "document.documentElement.classList.add('embed-mode')") && designsPageCode.includes("document.body.classList.add('embed-mode')") && designsPageCode.includes("main.style.width = '100%'"));
check('Page exit uses neutral shell veil instead of old shell animation', layoutCss.includes('body.page-exiting::before') && layoutCss.includes('body.page-exiting #mainApp') && !layoutCss.includes('animation: ptFadeOut 0.18s'));

const trainingPageCode = fs.readFileSync(path.join(ROOT, 'js/training-page.js'), 'utf8');
const trainingHtml = fs.readFileSync(path.join(ROOT, 'training.html'), 'utf8');
const trainingCss = fs.readFileSync(path.join(ROOT, 'css', 'training.css'), 'utf8');
const chatPageCode = fs.readFileSync(path.join(ROOT, 'js/chat-page.js'), 'utf8');
const chatHtml = fs.readFileSync(path.join(ROOT, 'chat.html'), 'utf8');
const chatCss = cssTextWithImports('css/chat.css');
const minigameCode = fs.readFileSync(path.join(ROOT, 'js', 'minigame-match3.js'), 'utf8');
const minigameCss = fs.readFileSync(path.join(ROOT, 'css', 'minigame.css'), 'utf8');
const dashboardHtml = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
const dashboardPageCode = fs.readFileSync(path.join(ROOT, 'js/dashboard-page.js'), 'utf8');
const dashboardCss = cssTextWithImports('css/dashboard.css');
check('Shared action history renderer owns timeline, task detail, and Work Queue histories',
    uiCode.includes('window.ActionHistoryView')
    && settingsCode.includes('ActionHistoryView.renderList(items')
    && dashboardPageCode.includes("kind: 'reply'")
    && dashboardPageCode.includes("kind: 'task'")
    && tasksPageCodeForProfileChecks.includes('ActionHistoryView.renderList(history')
    && globalModalsCss.includes('.action-history-list')
    && dashboardCss.includes('.reply-action-history-row'));
const assistantRailCode = fs.readFileSync(path.join(ROOT, 'js/assistant-rail.js'), 'utf8');
const assistantFoundationCode = fs.readFileSync(path.join(ROOT, 'js/assistant-foundation.js'), 'utf8');
const kleshnyaWidgetCode = fs.readFileSync(path.join(ROOT, 'js/kleshnya-widget.js'), 'utf8');
const assistantRailCss = cssTextWithImports('css/assistant-rail.css');
const dashboardAssistantServiceCode = fs.readFileSync(path.join(ROOT, 'services', 'dashboardAssistant.js'), 'utf8');
const dashboardRouteCode = fs.readFileSync(path.join(ROOT, 'routes/dashboard.js'), 'utf8');
const tasksRouteCode = fs.readFileSync(path.join(ROOT, 'routes/tasks.js'), 'utf8');
const taskDuplicatePolicyCode = fs.readFileSync(path.join(ROOT, 'services/taskDuplicatePolicy.js'), 'utf8');
const chatRouteCode = fs.readFileSync(path.join(ROOT, 'routes', 'chat.js'), 'utf8');
const chatServiceCode = fs.readFileSync(path.join(ROOT, 'services', 'chatService.js'), 'utf8');
const guardianRouteCode = fs.readFileSync(path.join(ROOT, 'routes', 'guardian.js'), 'utf8');
const guardianServiceCode = fs.readFileSync(path.join(ROOT, 'services', 'guardian.js'), 'utf8');
check('Training page script does not double-initialize sidebar', !trainingPageCode.includes('Sidebar.init('));
check('Training page preserves the shared shell instead of entering isolated mode', trainingPageCode.includes('function restoreTrainingShellVisibility') && trainingPageCode.includes('training-shell-ready') && trainingPageCode.includes("window.addEventListener('pageshow'") && trainingPageCode.includes('apiVerifyToken') && layoutCss.includes('v0.59.2: Training is a normal CRM page') && layoutCss.includes('body.training-shell-ready #mainApp') && layoutCss.includes('body.training-shell-ready:not(.auth-screen) .sidebar-nav') && layoutCss.includes('body.training-shell-ready:not(.auth-screen) #logoutBtn') && !layoutCss.includes('body.training-shell-ready:not(.auth-screen) #sidebarToggle,\nbody.training-shell-ready:not(.auth-screen) #logoutBtn'));
check('Training workspace owns onboarding and uses shared CRM styling layer', trainingHtml.includes('css/training.css') && trainingHtml.includes('data-tab="onboarding"') && trainingHtml.includes('id="trainingOnboardingList"') && trainingHtml.includes('id="trainingStartOnboarding"') && trainingPageCode.includes("const TRAINING_TABS = new Set(['materials', 'tests', 'progress', 'leaderboard', 'onboarding'])") && trainingPageCode.includes('function activateTrainingTab') && trainingPageCode.includes("if (tabName === 'onboarding') loadOnboarding()") && trainingPageCode.includes("trainingJson('/api/hr/onboarding')") && trainingPageCode.includes("trainingJson('/api/hr/onboarding/start'") && trainingPageCode.includes("data-onboarding-check") && trainingCss.includes('v0.73.54: align /training with the shared CRM/HR visual language') && trainingCss.includes('.training-tabs') && trainingCss.includes('grid-template-columns: repeat(5, minmax(0, 1fr))') && trainingCss.includes('.training-onboarding-panel') && trainingCss.includes('html[data-theme="light"] body:not(.dark-mode) .training-page'));
check('Chat page no longer uses early first-paint hack', !chatPageCode.includes('Show main app FIRST') && chatPageCode.includes('showAuthenticatedPageShell'));
check('Chat info panel has the title node required by runtime actions', chatHtml.includes('id="chatInfoPanelTitle"') && chatPageCode.includes('_setInfoPanelTitle'));
check('Chat theme follows shared manual/auto storage contract', chatPageCode.includes('function _applyChatThemeFromStorage') && chatPageCode.includes('pzp_autoNight') && chatPageCode.includes('chatResetAutoThemeBtn') && chatPageCode.includes('night-auto'));
check('Chat transient panels close through shared outside/Escape handling', chatPageCode.includes('function _closeChatTransientPanels') && chatPageCode.includes('function _closeChatModalOverlays') && chatPageCode.includes('if (_closeChatModalOverlays()) return') && chatPageCode.includes('if (_closeChatTransientPanels()) return'));
check('Chat bootstrap resolves initial dialog target canonically', chatPageCode.includes('function _resolveInitialChannelTarget') && chatPageCode.includes('function _getUrlChannelId') && chatPageCode.includes('window.__chatPendingOpenChannelId') && chatPageCode.includes('chatLastActiveChannelId') && !chatPageCode.includes('_selectChannel(_channels[0])'));
check('Chat bootstrap renders visible dialog loading and empty states', chatHtml.includes('id="chatDialogState"') && chatPageCode.includes('function _showDialogLoadingState') && chatPageCode.includes('function _renderDialogEmptyState') && chatPageCode.includes('data-chat-dialog-retry') && chatCss.includes('.chat-dialog-state.visible') && chatCss.includes('@keyframes chatDialogSpin'));
check('Chat selected dialog is persisted for token resume', chatPageCode.includes("localStorage.setItem(CHAT_LAST_ACTIVE_CHANNEL_KEY, String(channel.id))") && chatPageCode.includes('await _selectChannel(initialChannel)') && chatPageCode.includes('_rememberPendingDialogOpen(channel.id);'));
check('Chat guardian/info panels use one panel-state manager', chatPageCode.includes('var _chatPanelState = { active: null }') && chatPageCode.includes('function _closeAllChatPanels') && chatPageCode.includes("_toggleChatPanel('guardianLog'") && chatPageCode.includes("_toggleChatPanel('digest'") && chatPageCode.includes("_toggleChatPanel('guardianAnalytics'"));
check('Chat digest stats have readable tone classes', chatPageCode.includes('function _renderGuardianStat') && chatPageCode.includes('guardian-digest-stat--') && chatCss.includes('.guardian-digest-stat--danger') && chatCss.includes('.guardian-digest-stat--warning'));
check('Chat digest generate button is a real delegated button, not a void stub', chatPageCode.includes('guardian-digest-generate-btn') && chatPageCode.includes('type="button" class="guardian-digest-generate-btn"') && !chatPageCode.includes('onclick="void(0)"'));
check('Chat context menu clamps and flips inside the viewport', chatPageCode.includes('function _positionChatContextMenu') && chatPageCode.includes('viewportW - menuW - padding') && chatPageCode.includes('dataset.placementX') && chatCss.includes('max-width: calc(100vw - 20px)') && chatCss.includes('max-height: calc(100vh - 20px)'));
check('Chat pinning has visible state, unpin, and pinned summary surface', chatPageCode.includes('function _refreshPinnedMessages') && chatPageCode.includes('function _renderPinnedSummary') && chatPageCode.includes("case 'chat:pin'") && chatPageCode.includes("DELETE', '/channels/' + _currentChannel.id + '/pinned/'") && chatCss.includes('.chat-message.is-pinned') && chatCss.includes('.chat-pinned-bar-content'));
check('Guardian security log uses readable operational event rows', chatPageCode.includes('guardian-log-event-row') && chatPageCode.includes('function _guardianEventDetail') && chatPageCode.includes('function _queueGuardianModerationRefresh') && chatCss.includes('.guardian-log-event-row') && chatCss.includes('.guardian-log-actor') && chatCss.includes('.guardian-log-entry-status'));
check('Guardian moderation keeps public text safe while counters use block events', chatRouteCode.includes('preCheck.publicMessage || preCheck.message') && !chatRouteCode.includes('canSeeGuardianDetails && preCheck.ownerMessage') && guardianRouteCode.includes('todayStats.blocked = Math.max') && guardianServiceCode.includes("logAction('block_precheck'") && guardianServiceCode.includes('words: toxicWords'));
check('Omni alert links open channel setup panel and focus requested channel', chatPageCode.includes('function _applyOmniLaunchParams') && chatPageCode.includes("launch.panel !== 'accounts'") && chatPageCode.includes('focusChannel: launch.channel') && chatPageCode.includes('data-omni-account-channel') && chatCss.includes('.omni-channel-card.is-alert-target') && chatCss.includes('@keyframes omniAlertTargetPulse'));
check('Chat date divider has dark readable badge', chatCss.includes('body.dark-mode .chat-date-divider span') && chatCss.includes('background: rgba(15,23,42,0.82)') && chatCss.includes('color: #E2E8F0'));
const chatSettingsCode = fs.readFileSync(path.join(ROOT, 'js', 'chat-settings-page.js'), 'utf8');
const aiConfigCode = fs.readFileSync(path.join(ROOT, 'services', 'ai-config.js'), 'utf8');
check('Chat settings page has dedicated script and shared key source UI', chatCss.includes('.chat-settings-page') && chatSettingsCode.includes('/api/settings/chat/ai/test') && fs.readFileSync(path.join(ROOT, 'chat-settings.html'), 'utf8').includes('crm_ai_default'));
check('Chat settings page exposes OpenRouter token rail defaults', chatSettingsCode.includes('openai/gpt-5.4-mini') && chatSettingsCode.includes('openai/gpt-5.5') && chatSettingsCode.includes('function _fillModelSelect') && chatSettingsCode.includes('/api/settings/ai/providers') && aiConfigCode.includes("openrouter: process.env.SUMMARY_MODEL || process.env.OPENROUTER_MODEL || 'openai/gpt-5.4-mini'"));
check('Chat settings page gates shell reveal behind auth/API load', chatSettingsCode.includes('function _handleAuthRequired') && chatSettingsCode.includes('if (!_authToken())') && chatSettingsCode.includes('handleAuthError(resp)') && chatSettingsCode.includes('_render(data);') && chatSettingsCode.includes('_revealShell();'));
check('Match-3 game-over CTAs use semantic visible action group', minigameCode.includes('function renderGameOverActions') && minigameCode.includes('class="go-actions"') && minigameCode.includes('game-btn-overlay-secondary') && !minigameCode.includes('style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:12px"'));
check('Match-3 overlay secondary CTAs have mobile-visible styling', minigameCss.includes('.game-btn-overlay-secondary') && minigameCss.includes('.go-actions') && minigameCss.includes('grid-template-columns: 1fr 1fr') && minigameCss.includes('.go-action-primary'));
check('Dashboard widget manager restores the full registry and creator tasker entrypoint', dashboardPageCode.includes('DASHBOARD_RETIRED_WIDGETS = new Set()') && dashboardPageCode.includes('personal_tasker') && dashboardPageCode.includes('openWidgetManager') && dashboardPageCode.includes('BOARD_LIVE_WIDGET_CAP = 18'));
check('Dashboard task widgets render canonical subtask decomposition previews', dashboardRouteCode.includes('TASK_WIDGET_SUBTASK_SELECT') && dashboardRouteCode.includes('normalizeSubtaskSummary') && dashboardRouteCode.includes('json_agg(json_build_object') && dashboardPageCode.includes('function renderDashboardTaskSubtasks') && dashboardPageCode.includes('renderWorkQueueTaskSubtasksCard') && dashboardPageCode.includes('subtaskCount') && dashboardCss.includes('.dashboard-task-subtasks') && dashboardCss.includes('.team-task-widget-row'));
check('Task completion refreshes task widgets across profile, sidebar, dashboard, and tasks page', profileCode.includes('function notifyTaskWidgetsChanged') && profileCode.includes("action: 'task_status'") && profileCode.includes("window.addEventListener('crm:tasks-updated'") && fs.readFileSync(path.join(ROOT, 'js/tasks-page.js'), 'utf8').includes('function notifyTaskWidgetsChanged') && fs.readFileSync(path.join(ROOT, 'js/tasks-page.js'), 'utf8').includes("window.addEventListener('crm:tasks-updated'") && sidebarCode.includes("window.addEventListener('crm:tasks-updated'") && sidebarCode.includes('refreshTaskMiniWidget: _refreshTaskMiniWidget') && dashboardPageCode.includes('TASK_RELATED_WIDGET_TYPES') && dashboardPageCode.includes('refreshTaskRelatedWidgets') && dashboardPageCode.includes("window.addEventListener('crm:tasks-updated'"));
check('Task done-today widgets use Kyiv completion date and DB-level personal-tasker stats', authRouteCode.includes('function profileTaskWorkloadDateSql') && authRouteCode.includes("DATE(completed_at AT TIME ZONE 'Europe/Kyiv')") && dashboardRouteCode.includes('normalizeTaskerStatsRow') && dashboardRouteCode.includes("DATE(t.completed_at AT TIME ZONE 'Europe/Kyiv')") && dashboardRouteCode.includes('done_today'));
check('Dashboard widget manager uses a full-height searchable two-pane settings workspace', dashboardPageCode.includes('hydrateSettingsOverlayLayout') && dashboardPageCode.includes('settings-widget-panel') && dashboardPageCode.includes('settingsWidgetSearch') && dashboardPageCode.includes('data-settings-widget-filter="active"') && dashboardPageCode.includes('updateSettingsWidgetSummary') && dashboardCss.includes('v0.62.3: dashboard settings is a real two-pane workspace') && dashboardCss.includes('.settings-modal-body') && dashboardCss.includes('grid-template-columns: minmax(280px, 0.78fr) minmax(420px, 1.22fr)') && dashboardCss.includes('min-height: 360px') && dashboardCss.includes('.settings-widget-toolbar'));
check('Dashboard grid keeps widgets at natural height', dashboardCss.includes('align-items: start') && dashboardCss.includes('align-self: start'));
check('CRM assistant rail is available from auth shell only when explicitly enabled', authCode.includes('function initCrmAssistantRail') && authCode.includes('/css/assistant-rail.css') && authCode.includes('/js/assistant-rail.js') && authCode.includes('function isCrmAssistantRailEnabled') && authCode.includes("localStorage.getItem(CRM_ASSISTANT_RAIL_ENABLED_KEY) === 'on'") && assistantRailCode.includes('window.CrmAssistantRail'));
check('CRM assistant rail defaults to off and cleans stale surfaces', authCode.includes('CRM_ASSISTANT_RAIL_ENABLED_KEY') && authCode.includes('function removeCrmAssistantRailSurface') && authCode.includes("document.getElementById('crmAssistantRailHost')?.remove()") && authCode.includes("document.getElementById('crmAssistantPanelOverlay')?.remove()") && authCode.includes("document.querySelectorAll('.crm-assistant-click-guide-overlay, .crm-assistant-magic-burst')") && assistantRailCode.includes('ASSISTANT_RAIL_ENABLED_KEY') && assistantRailCode.includes('function isAssistantRailSurfaceEnabled') && assistantRailCode.includes("localStorage.getItem(ASSISTANT_RAIL_ENABLED_KEY) === 'on'") && assistantRailCode.includes('if (!isAssistantRailSurfaceEnabled())') && assistantRailCode.includes('destroy: removeMountedAssistantRail'));
check('CRM assistant foundation loads before the shared rail', authCode.includes('/js/assistant-foundation.js') && authCode.indexOf('foundationJsPath') < authCode.indexOf('railJsPath') && assistantFoundationCode.includes('window.CrmAssistantFoundation'));
check('Dynamic shell assets use root-relative paths for nested CRM routes', authCode.includes("link.href = '/css/sidebar-smart-menu.css' + suffix") && authCode.includes("script.src = '/js/sidebar-smart-menu.js' + suffix") && authCode.includes("const railCssPath = '/css/assistant-rail.css'") && authCode.includes("const foundationJsPath = '/js/assistant-foundation.js'") && authCode.includes("script.src = `/js/crm-feature-registry.js") && authCode.includes("script.src = `/js/search.js") && notificationCode.includes("link.href = '/css/sidebar-smart-menu.css' + suffix") && notificationCode.includes("script.src = '/js/sidebar-smart-menu.js' + suffix") && !authCode.includes("link.href = 'css/sidebar-smart-menu.css'") && !authCode.includes("const railCssPath = 'css/assistant-rail.css'") && !notificationCode.includes("link.href = 'css/sidebar-smart-menu.css'"));
check('CRM assistant foundation exposes store, adapters, actions, targets, and reply schema contracts', assistantFoundationCode.includes('CONTRACT_VERSION') && assistantFoundationCode.includes('store =') && assistantFoundationCode.includes('function registerAdapter') && assistantFoundationCode.includes('actionRegistry') && assistantFoundationCode.includes('function normalizeTarget') && assistantFoundationCode.includes('function normalizeReply'));
check('CRM assistant foundation wires first adapters for dashboard/tasks/leads/chat/finance', ["pageId: 'dashboard'", "pageId: 'tasks'", "pageId: 'finance'", "pageId: 'leads'", "pageId: 'chat'"].every(token => assistantFoundationCode.includes(token)));
const assistantLeadsHotPath = ['/api/leads', 'hot'].join('/');
check('CRM assistant foundation uses API-backed adapter snapshots for priority pages', assistantFoundationCode.includes('function refreshAdapterSnapshot') && ['/api/work-queue', '/api/tasks/my-cabinet', '/api/finance/debts', '/api/finance/advanced-dashboard', assistantLeadsHotPath, '/api/chat/unread'].every(token => assistantFoundationCode.includes(token)));
check('CRM assistant snapshots scope work queue and hot leads', assistantFoundationCode.includes('function assistantScopedApiUrl') && assistantFoundationCode.includes("value.startsWith('/api/work-queue')") && assistantFoundationCode.includes("value.startsWith('/api/leads/hot')") && assistantFoundationCode.includes('CrmBusinessContext?.apiUrl') && assistantFoundationCode.includes('fetch(assistantScopedApiUrl(path)'));
check('CRM assistant foundation exposes action proposal and teaching flow contracts', assistantFoundationCode.includes('function chooseActionProposal') && assistantFoundationCode.includes('function startTeachingFlow') && assistantFoundationCode.includes('function nextTeachingStep') && assistantFoundationCode.includes('function dismissTeachingFlow') && assistantFoundationCode.includes('currentTeachingFlow'));
check('CRM assistant flagship core pages have actions and guided flows', ['dashboard.work-queue-review', 'tasks.overdue-review', 'finance.debt-review', 'leads.follow-up-review', 'chat.unread-review', 'dashboard.focus-work-queue', 'dashboard.show-overdue-tasks', 'tasks.focus-overdue', 'finance.open-debts', 'leads.focus-hot', 'chat.filter-unread'].every(token => assistantFoundationCode.includes(token)));
check('CRM assistant dashboard filter actions route to live surfaces', assistantFoundationCode.includes('function openDashboardOverdueTasks') && assistantFoundationCode.includes('tasks.html?view=team&assistantFilter=overdue') && assistantFoundationCode.includes('function openDashboardReplyBacklog') && assistantFoundationCode.includes('omni.html?filter=waiting&replySla=overdue') && assistantFoundationCode.includes("'overdue', 'deadline', 'task'"));
check('CRM assistant strategic advisor has role and page framing', assistantFoundationCode.includes('function pageStrategicAngle') && assistantFoundationCode.includes('buildStrategicRecommendation') && dashboardAssistantServiceCode.includes('strategicFrame') && dashboardAssistantServiceCode.includes('pagePriority') && fs.readFileSync(path.join(ROOT, 'prompts', 'crm-assistant-system.md'), 'utf8').includes('strategicFrame'));
check('CRM assistant foundation uses stable assistant target markers before highlighting', assistantFoundationCode.includes('data-assistant-target') && assistantFoundationCode.includes('crm-assistant-target-highlight') && assistantRailCss.includes('.crm-assistant-target-highlight'));
check('CRM assistant guided click-line uses real targets with reduced-motion fallback', assistantFoundationCode.includes('showClickGuide?.(serializeTarget(target), element') && assistantRailCode.includes('function showClickGuide') && assistantRailCode.includes('safeGuideRect(element)') && assistantRailCode.includes('function guideReplyTarget') && assistantRailCode.includes('findVisibleHrefTarget') && assistantRailCss.includes('.crm-assistant-click-guide-overlay') && assistantRailCss.includes('@keyframes assistantClickGuideTrace') && assistantRailCss.includes('prefers-reduced-motion: reduce') && assistantRailCss.includes('.crm-assistant-click-guide-path'));
check('CRM assistant voice starts in safe text-only mode unless explicitly enabled', assistantRailCode.includes('function isAssistantVoiceExplicitlyEnabled') && assistantRailCode.includes("localStorage.getItem(ASSISTANT_VOICE_PREF_KEY) === 'on'") && assistantFoundationCode.includes('function isVoiceExplicitlyEnabled') && assistantFoundationCode.includes("readStorage('eg_crm_assistant_voice', 'off') === 'on'") && assistantRailCode.includes('ASSISTANT_VOICE_OPT_IN_KEY') && assistantRailCode.includes('Текстовий режим'));
check('CRM assistant foundation exposes safe action command router', assistantFoundationCode.includes('assistant_action_commands_v1') && assistantFoundationCode.includes('function routeCommand') && assistantFoundationCode.includes('function executeCommand') && assistantFoundationCode.includes('SAFE_COMMAND_TYPES') && assistantFoundationCode.includes('FORBIDDEN_COMMAND_PATTERNS'));
check('CRM assistant command router supports safe shell commands and confirmed task creation', ['assistant.navigate', 'assistant.open-search', 'assistant.theme', 'assistant.sidebar-collapse', 'assistant.timeline-compact-on', 'assistant.teaching-start', 'assistant.create-task'].every(token => assistantFoundationCode.includes(token)) && assistantFoundationCode.includes('confirmationNeeded: true') && assistantFoundationCode.includes('/api/tasks'));
check('CRM assistant confirmations use shared CRM modal helper without native fallback', assistantFoundationCode.includes('function confirmAssistantAction') && assistantFoundationCode.includes('await confirmAssistantAction(action.label') && assistantFoundationCode.includes("await confirmAssistantAction(`${route.label || 'Підтвердити дію'}?${title}`") && !/window\.confirm(?:\s|[?.(])/.test(assistantFoundationCode));
check('CRM assistant command router leaves timeline schedule questions read-only', assistantFoundationCode.includes('function isReadOnlyTimelineScheduleQuestion') && assistantFoundationCode.includes('timeline_schedule_read_only_query'));
check('Shared assistant rail answers timeline schedule questions before command routing', assistantRailCode.includes('function tryAnswerTimelineScheduleQuery') && assistantRailCode.includes('function isTimelineScheduleQuery') && assistantRailCode.includes('/api/bookings/') && assistantRailCode.includes('/api/afisha/') && assistantRailCode.indexOf('tryAnswerTimelineScheduleQuery(prompt)') > -1 && assistantRailCode.indexOf('tryAnswerTimelineScheduleQuery(prompt)') < assistantRailCode.indexOf('tryRunAssistantCommand(prompt)'));
check('Shared assistant rail reads the visible timeline date and DOM booking blocks', assistantRailCode.includes('function getVisibleTimelineDate') && assistantRailCode.includes('AppState?.selectedDate') && assistantRailCode.includes("document.getElementById('timelineDate')") && assistantRailCode.includes('function collectVisibleTimelineBookings') && assistantRailCode.includes('#timelineLines .booking-block:not(.afisha-block)') && assistantRailCode.includes('timeline_schedule_visible_dom'));
check('Shared assistant rail routes commands before generic AI replies', assistantRailCode.includes('function tryRunAssistantCommand') && assistantRailCode.includes('api.commands.route') && assistantRailCode.includes('if (await tryRunAssistantCommand(prompt)) return;') && assistantRailCode.includes('runPendingAssistantCommandFromNavigation'));
const assistantRailUsesCenteredHost = assistantRailCode.includes('function ensureAssistantRailHost') && assistantRailCode.includes("host.id = 'crmAssistantRailHost'") && assistantRailCode.includes('host.appendChild(rail)');
const assistantRailUsesLegacyDirectInsert = assistantRailCode.includes('insertBefore(rail, userPanel)');
check('Shared assistant rail injects header UI instead of dashboard static copy', !dashboardHtml.includes('id="dashboardAssistantRail"') && assistantRailCode.includes('function ensureMounted') && assistantRailCode.includes("document.querySelector('.header .header-content')") && (assistantRailUsesCenteredHost || assistantRailUsesLegacyDirectInsert));
check('Shared assistant rail keeps proactive page help disabled by default', assistantRailCode.includes('function scheduleProactiveHelp') && assistantRailCode.includes('function isProactiveHelpEnabled') && assistantRailCode.includes('ASSISTANT_PROACTIVE_HELP_PREF_KEY') && assistantRailCode.includes('if (!isProactiveHelpEnabled()) return;') && assistantRailCode.includes('if (isProactiveHelpEnabled())'));
check('Shared assistant rail supports CRM voice/text API contract', assistantRailCode.includes('/api/crm-assistant/reply') && assistantRailCode.includes('/api/crm-assistant/speak') && assistantRailCode.includes('/api/crm-assistant/transcribe') && assistantRailCode.includes('voiceEnabled'));
check('Shared assistant rail uses foundation context and reply normalization', assistantRailCode.includes('CrmAssistantFoundation') && assistantRailCode.includes('getFoundationContext') && assistantRailCode.includes('normalizeReply(data.reply, payload)') && assistantRailCode.includes('runRegisteredAction') && assistantRailCode.includes('highlightTeachingTarget'));
check('Shared assistant rail renders action proposals and guided teaching controls', assistantRailCode.includes('id="crmAssistantActionProposal"') && assistantRailCode.includes('function renderActionProposal') && assistantRailCode.includes('data-crm-assistant-run-action') && assistantRailCode.includes('id="crmAssistantTeachingRunner"') && assistantRailCode.includes('function renderTeachingRunner') && assistantRailCss.includes('.crm-assistant-action-proposal') && assistantRailCss.includes('.crm-assistant-teaching-runner'));
check('Shared assistant rail styles include partial ticker and mode visuals', assistantRailCss.includes('@keyframes assistantTicker') && assistantRailCss.includes('.assistant-rail-subtitles.is-ticker') && assistantRailCss.includes('[data-mode="speaking"]') && assistantRailCss.includes('[data-mode="busy"]') && assistantRailCss.includes('body.dark-mode .crm-assistant-rail'));
check('Shared assistant rail has explicit-only voice lifecycle and blocked-playback guard', assistantRailCode.includes('playbackRunId') && assistantRailCode.includes('function handlePlaybackFailure') && assistantRailCode.includes('voiceBlocked') && assistantRailCode.includes('dataset.playbackState') && assistantRailCode.includes('addToHistory: false') && assistantRailCode.includes('SPEECH_TTS_TIMEOUT_MS') && assistantRailCode.includes('options.speak === true') && assistantRailCode.includes('user_action_required'));
check('Shared assistant rail disables flaky browser speech fallback by default', assistantRailCode.includes('const ASSISTANT_BROWSER_SPEECH_FALLBACK_ENABLED = false') && assistantRailCode.includes('function speakWithBrowserVoice') && assistantRailCode.includes('speech_synthesis_no_ukrainian_voice') && assistantRailCode.includes('if (!ASSISTANT_BROWSER_SPEECH_FALLBACK_ENABLED) throw primaryError;'));
check('Shared assistant rail emits low-noise hardening telemetry for failure paths', assistantRailCode.includes('/api/crm-assistant/telemetry') && assistantRailCode.includes("emitTelemetry('playback_blocked'") && assistantRailCode.includes("emitTelemetry('voice_transcription_failed'") && assistantFoundationCode.includes('TELEMETRY_THROTTLE_MS') && assistantFoundationCode.includes("emitTelemetry('snapshot_failed'"));
check('Shared assistant rail keeps subtitle ticker calm and readable', assistantRailCode.includes('subtitleMode') && assistantRailCode.includes('is-ticker-wrap') && assistantRailCss.includes('.assistant-rail-subtitles-wrap.is-ticker-wrap') && assistantRailCss.includes('assistantPremiumVoice'));
check('Shared assistant rail has readable animated topbar output states', assistantRailCode.includes('function assistantTickerThreshold') && assistantRailCode.includes('normalized.length >= assistantTickerThreshold') && assistantRailCode.includes("subtitlesWrap.setAttribute('aria-label'") && assistantRailCss.includes('v0.59.4: readable animated assistant output') && assistantRailCss.includes('assistantRailThinkingSweep') && assistantRailCss.includes('assistantRailListeningPulse') && assistantRailCss.includes('assistantRailSpeakingWave') && assistantRailCss.includes('assistantRailActionGlow') && assistantRailCss.includes('assistantRailSuccessBloom') && assistantRailCss.includes('assistantRailErrorSignal') && assistantRailCss.includes('animation: assistantTicker var(--assistant-ticker-duration, 18s) linear infinite !important'));
check('Shared assistant rail uses AI Command Bar instead of visible avatar presence', assistantRailCode.includes('assistant-command-form') && assistantRailCode.includes('assistant-command-mark') && assistantRailCode.includes('crmAssistantCommandPanel') && assistantRailCode.includes('placeholder="Запитати CRM або /команда"') && assistantRailCode.includes("mode: shouldPlayAudio ? 'thinking' : 'streaming'") && assistantRailCode.includes('scheduleSpeakingIdleFallback(text)') && !assistantRailCode.includes('crmAssistantRailAvatar') && !assistantRailCode.includes('assistant-rail-avatar-core') && assistantRailCss.includes('v0.63.38: AI Command Bar') && assistantRailCss.includes('v0.63.40: hotfix AI Command Bar header geometry') && assistantRailCss.includes('v0.63.41: AI mark and live reply panel polish') && assistantRailCss.includes('.assistant-command-form') && assistantRailCss.includes('.assistant-command-panel') && assistantRailCss.includes('.crm-assistant-rail .assistant-rail-presence') && assistantRailCss.includes('display: none !important') && assistantRailCss.includes('grid-template-areas: "command mic stop voice replay expand"') && assistantRailCss.includes('display: contents !important') && assistantRailCss.includes('#crmAssistantMicBtn') && assistantRailCss.includes('#crmAssistantExpandBtn') && assistantRailCss.includes('.assistant-command-form .assistant-rail-inline-search') && assistantRailCss.includes('position: static !important') && assistantRailCss.includes('[data-playback-state="text"] .assistant-command-panel'));
check('Shared assistant rail has a broad state-driven motion spectrum', assistantRailCode.includes("'guide'") && assistantRailCode.includes("'warning'") && assistantRailCode.includes('rail.dataset.motionState') && assistantRailCss.includes('v0.60.43: assistant motion spectrum + expandable stage') && assistantRailCss.includes('assistantRailIdleBreath') && assistantRailCss.includes('assistantRailHoverIgnition') && assistantRailCss.includes('assistantRailListeningResonance') && assistantRailCss.includes('assistantRailSpeakingCadence') && assistantRailCss.includes('assistantRailGuideBeam') && assistantRailCss.includes('assistantRailSuccessSettle') && assistantRailCss.includes('assistantRailWarningTension') && assistantRailCss.includes('assistantRailMutedDormancy'));
check('Shared assistant expanded stage is a deliberate larger assistant surface', assistantRailCode.includes('crm-assistant-stage') && assistantRailCode.includes('crmAssistantStageStatus') && assistantRailCode.includes('crmAssistantStageSubtitle') && assistantRailCode.includes("data-expanded', 'true'") && assistantRailCss.includes('assistantStageReveal') && assistantRailCss.includes('.crm-assistant-stage-orb') && assistantRailCss.includes('.crm-assistant-stage-meter') && assistantRailCss.includes('prefers-reduced-motion: reduce'));
check('Shared assistant rail has auto-pause voice turn finalization and queue guards', assistantRailCode.includes('function startVoiceTurnDetection') && assistantRailCode.includes('VOICE_SILENCE_MS') && assistantRailCode.includes("requestRecorderStop('auto_silence')") && assistantRailCode.includes('assistantTurnQueue') && assistantRailCode.includes('assistantTurnSerial') && assistantRailCode.includes('function stopAssistantActivity') && assistantRailCode.includes("id=\"crmAssistantStopBtn\""));
check('Shared assistant rail ticker is not disabled by compact subtitle overrides', assistantRailCss.includes('content: attr(data-ticker-text) !important') && !/\.assistant-rail-subtitles\.is-ticker\s*\{[^}]*display:\s*-webkit-box[^}]*transform:\s*none\s*!important[^}]*white-space:\s*normal/s.test(assistantRailCss));
check('Shared assistant rail opens the chat panel from subtitle text', assistantRailCode.includes('function openAssistantChatFromText') && assistantRailCode.includes('crmAssistantRailSubtitlesWrap') && assistantRailCode.includes('role="button"') && assistantRailCode.includes('addEventListener(\'keydown\'') && assistantRailCss.includes('.assistant-rail-subtitles-wrap:focus-visible') && assistantRailCss.includes('cursor: pointer'));
check('Shared assistant expanded chat can bridge to CRM Chat and return', assistantRailCode.includes('ASSISTANT_CHAT_RETURN_URL_KEY') && assistantRailCode.includes('function openCrmChatFromAssistant') && assistantRailCode.includes('/chat?assistantReturn=1') && assistantRailCode.includes('function resumeAssistantPanelFromChatReturn') && assistantRailCode.includes('crmAssistantOpenChatBtn') && assistantRailCss.includes('v0.57.10: assistant chat bridge workspace') && assistantRailCss.includes('.crm-assistant-chat-workspace') && chatPageCode.includes('function _initAssistantReturnBridge') && chatPageCode.includes('chatAssistantReturnBridge') && chatPageCode.includes('eg_assistant_chat_reopen_panel') && chatCss.includes('.chat-assistant-return-bridge'));
check('Shared assistant chat bridge imports the full LLM transcript into CRM Chat', assistantRailCode.includes('ASSISTANT_CHAT_TRANSCRIPT_KEY') && assistantRailCode.includes('function buildAssistantChatTransferPayload') && assistantRailCode.includes('/api/chat/assistant/transcript') && assistantRailCode.includes('ASSISTANT_CHAT_HISTORY_LIMIT') && chatPageCode.includes('ASSISTANT_CHAT_SYNC_CHANNEL_KEY') && chatPageCode.includes("params.get('assistantReturn') === '1'"));
check('CRM Chat assistant channel continues the same LLM dialog', chatPageCode.includes('function _isAssistantDialogChannel') && chatPageCode.includes("'/assistant/reply'") && chatPageCode.includes('function _syncAssistantTranscriptStorageFromChat') && chatRouteCode.includes("router.post('/assistant/reply'") && chatRouteCode.includes('getDashboardAssistantReply') && chatServiceCode.includes('type: row.type') && dashboardAssistantServiceCode.includes('chatHistory: compactChatHistory'));
check('CRM assistant localizes technical action and widget labels for users', assistantFoundationCode.includes('UI_TEXT_REPLACEMENTS') && assistantFoundationCode.includes('Показати прострочені задачі') && assistantFoundationCode.includes('Команда онлайн') && assistantRailCode.includes('function actionTypeLabel') && dashboardAssistantServiceCode.includes('ASSISTANT_UI_TEXT_REPLACEMENTS') && dashboardAssistantServiceCode.includes('Не показуй технічні id') && dashboardAssistantServiceCode.includes('Команда онлайн') && fs.readFileSync(path.join(ROOT, 'prompts', 'crm-assistant-system.md'), 'utf8').includes('внутрішні англійські id'));
check('CRM assistant chat uses one current user dialog with old-session styling and Enter submit', assistantRailCode.includes('ASSISTANT_CHAT_SESSION_KEY') && assistantRailCode.includes('eg_crm_assistant_history_v2') && assistantRailCode.includes('function isOldAssistantSession') && assistantRailCode.includes("event.key !== 'Enter' || event.shiftKey") && chatPageCode.includes('function _ensureAssistantDialogChannelFromBridge') && chatPageCode.includes('function _isOldAssistantSessionMessage') && chatPageCode.includes('assistant-old-session') && chatPageCode.includes('sessionId: _assistantSessionIdFromBridge') && chatServiceCode.includes('assistantSessionId') && chatCss.includes('.chat-message.assistant-old-session') && assistantRailCss.includes('.crm-assistant-history-item.old-session'));
check('Chat assistant return bridge does not show from stale session storage alone', chatPageCode.includes('function _isAssistantReturnRequest') && chatPageCode.includes('function _clearAssistantReturnBridgeContext') && chatPageCode.includes('if (!fromAssistant)') && chatPageCode.includes('_stripAssistantReturnParam();') && !chatPageCode.includes("params.get('assistantReturn') === '1' || !!sessionStorage.getItem(ASSISTANT_CHAT_RETURN_URL_KEY)"));
check('Shared assistant rail keeps CRM window bridge shimmer disabled', assistantRailCode.includes('const WINDOW_BRIDGE_EFFECTS_ENABLED = false') && assistantRailCode.includes('function initAssistantWindowBridge') && assistantRailCode.includes('function pulseAssistantWindowBridge') && assistantRailCode.includes('if (!WINDOW_BRIDGE_EFFECTS_ENABLED) return false;') && assistantRailCss.includes('v0.58.16: disabled assistant window bridge shimmer') && assistantRailCss.includes('.crm-assistant-linked-window::after') && assistantRailCss.includes('content: none !important') && assistantRailCss.includes('.crm-assistant-magic-burst') && assistantRailCss.includes('display: none !important') && !assistantRailCss.includes('assistantWindowBridgeSweep') && !assistantRailCss.includes('@keyframes assistantMagicDot'));
check('Shared assistant rail polishes action and guided teaching presentation', assistantRailCode.includes('function actionReasonText') && assistantRailCode.includes('function teachingStepLine') && assistantRailCode.includes('Підтвердити') && assistantRailCss.includes('.crm-assistant-action-card[data-action-type="focus"]') && assistantRailCss.includes('.crm-assistant-teaching-card.is-active'));
check('Shared assistant rail uses integrated compact topbar geometry', assistantRailCss.includes('integrated compact AI topbar') && assistantRailCss.includes('min-height: 86px !important') && assistantRailCss.includes('width: clamp(320px, 30vw, 520px) !important') && assistantRailCss.includes('body.shell-ready .sidebar-nav.collapsed ~ .header + .crm-assistant-rail-host'));
check('Shared assistant rail is stably docked in the header flow on all pages', assistantRailCss.includes('v0.63.53: stable global assistant docking') && assistantRailCss.includes('flex-flow: row nowrap !important') && assistantRailCss.includes('position: static !important') && assistantRailCss.includes('animation-name: none !important') && assistantRailCss.includes('.crm-assistant-rail:hover') && assistantRailCss.includes('transform: none !important'));
const assistantTimelineParityPatchIndex = assistantRailCss.indexOf('v0.66.44: timeline rail parity + dark composer contrast');
check('Timeline assistant uses the shared header topbar parity contract', assistantTimelineParityPatchIndex > assistantRailCss.indexOf('v0.66.17: timeline hard-resets old assistant overrides') && assistantRailCss.includes('body.timeline-dashboard-page .header .header-content.assistant-rail-mounted > #crmAssistantRailHost .crm-assistant-rail') && assistantRailCss.includes('grid-template-areas: "command mic stop voice replay expand" !important') && assistantRailCss.includes('justify-content: flex-end !important') && assistantRailCss.includes('min-height: 66px !important') && assistantRailCss.includes('body.timeline-dashboard-page .header .header-content.assistant-rail-mounted .crm-assistant-rail:focus-within .assistant-command-panel') && assistantRailCss.includes('opacity: 1 !important') && assistantRailCss.includes('v0.63.53: stable global assistant docking') && assistantRailCss.includes('body.timeline-dashboard-page .main-content > #crmAssistantRailHost') && assistantRailCode.includes("host.dataset.mount = 'top-menu'") && assistantRailCode.includes('headerContent.insertBefore(host, firstHeaderControl)') && !assistantRailCode.includes('function isTimelineAssistantPage') && !assistantRailCode.includes("host.dataset.mount = 'timeline-main'") && !assistantRailCode.includes("timelineMain.insertBefore(host, controlPanel)") && !assistantRailCode.includes("headerContent.classList.toggle('assistant-rail-timeline-mounted'") && !assistantRailCss.includes('v0.66.15: timeline assistant is a normal row in the timeline content') && !assistantRailCss.includes('.main-content.timeline-assistant-main-mounted > #crmAssistantRailHost.timeline-assistant-main-host') && authCode.includes("const expectedRailCssHref = `${railCssPath}${suffix}`") && authCode.includes("existingRailCss.href = expectedRailCssHref") && assistantRailCode.includes("document.body?.dataset?.crmPage === 'dashboard'") && !/isDashboardAssistantSuppressed[\\s\\S]*timeline-dashboard-page/.test(assistantRailCode));
check('Timeline assistant hidden command panel does not block toolbar clicks', assistantRailCss.includes('v0.69.19: hidden timeline assistant command panels must not steal timeline toolbar clicks') && assistantRailCss.includes('body.timeline-dashboard-page .header .header-content.assistant-rail-mounted .assistant-command-panel .assistant-rail-subtitles-wrap') && assistantRailCss.includes('pointer-events: none !important') && assistantRailCss.includes('body.timeline-dashboard-page .header .header-content.assistant-rail-mounted .crm-assistant-rail[data-live="true"] .assistant-command-panel .assistant-rail-subtitles-wrap') && assistantRailCss.includes('pointer-events: auto !important'));
check('Shared assistant rail keeps dark composer typing readable', assistantTimelineParityPatchIndex >= 0 && assistantRailCss.includes('body.dark-mode .crm-assistant-rail .assistant-command-form input') && assistantRailCss.includes('body.dark-mode .crm-assistant-panel .crm-assistant-form textarea') && assistantRailCss.includes('html[data-theme="dark"] body .crm-assistant-panel [contenteditable="true"]') && assistantRailCss.includes('-webkit-text-fill-color: #f8fafc !important') && assistantRailCss.includes('caret-color: #5eead4 !important') && assistantRailCss.includes('body.dark-mode .crm-assistant-rail .assistant-command-form input::placeholder') && assistantRailCss.includes('body.dark-mode .crm-assistant-panel .crm-assistant-form textarea::selection'));
check('Dashboard assistant shell has scoped premium command repair', dashboardHtml.includes('data-crm-page="dashboard"') && assistantRailCss.includes('v0.63.58: dashboard assistant shell repair') && assistantRailCss.includes('body[data-crm-page="dashboard"] .assistant-command-form') && assistantRailCss.includes('grid-template-areas: "command actions"') && assistantRailCss.includes('body[data-crm-page="dashboard"] .crm-assistant-rail .assistant-rail-actions') && assistantRailCss.includes('body[data-crm-page="dashboard"] .assistant-command-panel'));
check('Dashboard suppresses the shared assistant top widget', dashboardHtml.includes('data-crm-page="dashboard"') && assistantRailCode.includes('function isDashboardAssistantSuppressed') && assistantRailCode.includes("dataset?.crmPage === 'dashboard'") && assistantRailCode.includes('function removeMountedAssistantRail') && assistantRailCode.includes("document.getElementById('crmAssistantRailHost')?.remove()") && assistantRailCode.includes('if (!isAssistantRailSurfaceEnabled() || isDashboardAssistantSuppressed()) return false;'));
check('Shared assistant rail has compact top header without extra context text', assistantRailCss.includes('v0.57.11: compact top assistant') && assistantRailCss.includes('.assistant-rail-engine') && assistantRailCss.includes('.assistant-rail-context-strip') && assistantRailCss.includes('.assistant-rail-prompts') && assistantRailCss.includes('.crm-assistant-top-status span:not(.crm-assistant-top-status-dot)') && assistantRailCss.includes('display: none !important') && assistantRailCss.includes('min-height: 58px !important') && assistantRailCss.includes('width: clamp(300px, 34vw, 620px) !important'));
check('Shared assistant rail moves assistant output into a readable subtitle lane', assistantRailCode.includes('assistant-rail-subtitles-wrap') && assistantRailCode.indexOf('assistant-rail-presence') < assistantRailCode.indexOf('assistant-rail-subtitles-wrap') && assistantRailCss.includes('grid-template-areas:') && assistantRailCss.includes('"presence actions"') && assistantRailCss.includes('"subtitle subtitle"') && assistantRailCss.includes('border-left: 3px solid') && assistantRailCss.includes('overflow: hidden') && assistantRailCss.includes('.assistant-rail-subtitles-wrap:hover .assistant-rail-subtitles.is-ticker'));
check('Shared assistant rail mounts inside the top menu with lift-out interaction motion', assistantRailCode.includes("host.dataset.mount = 'top-menu'") && assistantRailCode.includes('headerContent.insertBefore(host, firstHeaderControl)') && !assistantRailCode.includes("header.insertAdjacentElement('afterend', host)") && assistantRailCss.includes('v0.58.4: assistant lives inside the top menu') && assistantRailCss.includes('> .crm-assistant-rail-host') && assistantRailCss.includes('assistantTopMenuWorkLift') && assistantRailCss.includes('translateY(-4px) scale(1.07)'));
check('Shared assistant top menu rail has wider aligned command line', assistantRailCss.includes('v0.58.6: top menu assistant alignment') && assistantRailCss.includes('max-width: min(1280px, calc(100vw - 360px))') && assistantRailCss.includes('grid-template-columns: minmax(300px, 0.72fr) minmax(560px, 1.28fr)') && assistantRailCss.includes('min-width: 420px !important') && assistantRailCss.includes('min-height: 44px !important'));
check('Shared assistant rail preserves compact header actions after mounting', assistantRailCss.includes('v0.56.2: compact header actions') && assistantRailCss.includes('.header .user-panel > .user-name') && assistantRailCss.includes('display: none !important') && assistantRailCss.includes('.header .header-theme-toggle') && assistantRailCss.includes('height: 42px !important') && assistantRailCss.includes('.header .btn-logout') && assistantRailCss.includes('font-size: 14px !important'));
check('Shared assistant rail exposes interactive context snapshot', assistantRailCode.includes('id="crmAssistantSignalCount"') && assistantRailCode.includes('assistant-rail-context-strip') && assistantRailCode.includes('function buildAssistantSnapshot') && assistantRailCode.includes('id="crmAssistantPanelSnapshot"') && assistantRailCode.includes('crm-assistant-mode-grid') && assistantRailCss.includes('interactive AI context card') && assistantRailCss.includes('.crm-assistant-panel-snapshot'));
check('Shared assistant expanded window is a full workspace, not a cramped drawer', assistantRailCss.includes('v0.55.36: polished Kleshnya open window') && assistantRailCss.includes('width: min(980px, calc(100vw - 36px)) !important') && assistantRailCss.includes('grid-template-areas:') && assistantRailCss.includes('"modes history"') && assistantRailCss.includes('.crm-assistant-panel-header::before') && assistantRailCss.includes('body:not(.dark-mode) .crm-assistant-panel-overlay') && assistantRailCss.includes('@media (max-width: 940px)'));
check('Shared assistant expanded window keeps bottom composer separate from workspace cards', assistantRailCode.includes('id="crmAssistantPanelContent"') && assistantRailCss.includes('v0.56.4: expanded assistant panel bottom layout fix') && assistantRailCss.includes('grid-area: workspace') && assistantRailCss.includes('grid-template-areas:') && assistantRailCss.includes('"workspace"') && assistantRailCss.includes('.crm-assistant-panel-content') && assistantRailCss.includes('grid-template-rows: auto minmax(0, 1fr) auto auto !important') && assistantRailCss.includes('z-index: 3 !important') && assistantRailCss.includes('resize: none !important'));
check('Shared assistant expanded mini chat owns vertical scrolling', assistantRailCss.includes('v0.60.7: assistant mini-window chat scroll') && assistantRailCss.includes('.crm-assistant-chat-workspace .crm-assistant-history') && assistantRailCss.includes('overflow-y: auto !important') && assistantRailCss.includes('align-content: start !important') && assistantRailCss.includes('overscroll-behavior: contain !important') && assistantRailCss.includes('scrollbar-gutter: stable !important') && assistantRailCss.includes('touch-action: pan-y !important'));
check('Shared assistant rail has a real light-theme surface contract', assistantRailCss.includes('v0.55.31: light theme completion') && assistantRailCss.includes('body:not(.dark-mode) .header') && assistantRailCss.includes('body:not(.dark-mode) .crm-assistant-rail-host') && assistantRailCss.includes('body:not(.dark-mode) .crm-assistant-rail .assistant-rail-name') && assistantRailCss.includes('body:not(.dark-mode) .assistant-rail-inline-form'));
check('Shared assistant rail has polished light-mode topbar overrides after dark compact rules', assistantRailCss.includes('v0.60.5: assistant light mode polish') && assistantRailCss.includes('html[data-theme="light"] .header .header-content.assistant-rail-mounted > .crm-assistant-rail-host .crm-assistant-rail') && assistantRailCss.includes('--assistant-light-rail-surface') && assistantRailCss.includes('html[data-theme="light"] .assistant-rail-avatar-core') && assistantRailCss.includes('html[data-theme="light"] .assistant-rail-inline-form') && assistantRailCss.includes('html[data-theme="light"] .crm-assistant-rail .assistant-rail-btn:disabled'));
check('Shared topbar visual polish keeps assistant compact and controls unified', assistantRailCss.includes('v0.61.38: coherent product topbar + calm assistant motion') && assistantRailCss.includes('--topbar-control-h: 40px') && assistantRailCss.includes('grid-template-areas: "presence actions"') && assistantRailCss.includes('.header :where(.btn-search, .header-search-btn, .header-theme-toggle, .btn-logout)') && assistantRailCss.includes('assistantTopbarIdleBreath') && assistantRailCss.includes('assistantTopbarEqualizer') && assistantRailCss.includes('assistantTopbarSuccess') && assistantRailCss.includes('prefers-reduced-motion: reduce'));
check('Shared assistant topbar keeps the same command geometry across dashboard and timeline headers', assistantRailCss.includes('v0.61.41: cross-page topbar geometry guard') && assistantRailCss.includes('grid-template-columns: auto auto minmax(520px, 1fr) auto auto') && assistantRailCss.includes('> .alert-bell-btn') && assistantRailCss.includes('grid-column: 3 !important') && assistantRailCss.includes('> .user-panel') && assistantRailCss.includes('margin-left: 0 !important') && assistantRailCss.includes('grid-template-columns: minmax(178px, 260px) minmax(0, 1fr)'));
check('Shared assistant topbar uses polished cockpit without hover-only noise', assistantRailCss.includes('v0.63.29: polished assistant cockpit') && assistantRailCss.includes('grid-template-columns: minmax(260px, 1fr) repeat(5, 40px)') && assistantRailCss.includes('.crm-assistant-rail:hover .assistant-rail-subtitles-wrap') && assistantRailCss.includes('pointer-events: none !important') && assistantRailCss.includes('assistantCockpitPanelIn') && assistantRailCss.includes('grid-template-areas:\n        "header header"\n        "stage workspace"'));
check('Shared assistant rail avatar polish removes the oversized hover/focus halo', assistantRailCss.includes('v0.63.32: assistant avatar polish and hover-ring fix') && assistantRailCss.includes('.assistant-rail-avatar-btn:focus-visible::after') && assistantRailCss.includes('content: none !important') && assistantRailCss.includes('.crm-assistant-rail:focus-within .assistant-rail-presence') && assistantRailCss.includes('box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.62) !important') && assistantRailCss.includes('.assistant-rail-btn:focus-visible') && assistantRailCss.includes('inset 0 -2px 0 color-mix(in srgb, var(--assistant-presence-current, #14b8a6) 52%, transparent)'));
check('Header theme toggle uses SVG glyphs with product-control styling', authCode.includes('header-theme-glyph--sun') && authCode.includes('header-theme-glyph--moon') && authCode.includes('<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">') && !authCode.includes('header-theme-glyph header-theme-glyph--sun">☀') && !authCode.includes('header-theme-glyph header-theme-glyph--moon">☾') && assistantRailCss.includes('.header-theme-glyph svg') && assistantRailCss.includes('.header-theme-toggle.is-dark .header-theme-glyph--moon'));
check('Shared header search and theme toggle stay readable on light theme', assistantRailCss.includes('v0.57.15: light header controls contrast') && assistantRailCss.includes('html[data-theme="light"] .header .header-search-btn') && assistantRailCss.includes('color: #1e293b !important') && assistantRailCss.includes('html[data-theme="light"] .header .header-theme-toggle') && assistantRailCss.includes('html[data-theme="light"] .header .header-theme-glyph--moon') && assistantRailCss.includes('color: #475569 !important'));
check('Shared assistant expanded window has crisp light-theme borders', assistantRailCss.includes('v0.57.15: light assistant window borders') && assistantRailCss.includes('html[data-theme="light"] .crm-assistant-panel') && assistantRailCss.includes('border: 2px solid rgba(13, 148, 136, 0.30)') && assistantRailCss.includes('html[data-theme="light"] .crm-assistant-chat-workspace') && assistantRailCss.includes('html[data-theme="light"] .crm-assistant-form textarea') && assistantRailCss.includes('rgba(13, 148, 136, 0.36)'));
check('Legacy floating assistant widget only delegates trusted user clicks to the shared rail', kleshnyaWidgetCode.includes('legacy assistant widget bridge') && kleshnyaWidgetCode.includes('window.CrmAssistantRail?.expand') && kleshnyaWidgetCode.includes('options.userInitiated !== true') && kleshnyaWidgetCode.includes('event.isTrusted !== false') && kleshnyaWidgetCode.includes('openFromUser') && kleshnyaWidgetCode.includes('isLegacyBridge') && !kleshnyaWidgetCode.includes('setTimeout(() => window.CrmAssistantRail?.expand') && !kleshnyaWidgetCode.includes('document.body.appendChild(fab)') && !kleshnyaWidgetCode.includes('apiSendKleshnyaMessage'));
check('Generic catalog viewers suppress the assistant rail instead of showing a non-functional topbar', assistantRailCss.includes('body.catalog-viewer-open .crm-assistant-rail-host') && assistantRailCss.includes('body.printing-catalog .crm-assistant-rail-host') && catalogCss.includes('body.catalog-viewer-open .crm-assistant-rail-host') && designsPageCode.includes("document.body.classList.toggle('catalog-viewer-open'"));
check('Graduation package catalog viewer stays inside the CRM shell instead of forcing fullscreen chrome loss', graduationCode.includes('graduation-catalog-viewer-open') && graduationCode.includes("document.getElementById('gradContent')") && !graduationCode.includes("document.body.classList.add('catalog-viewer-open')") && htmlContains('css/graduation.css', 'position: relative') && htmlContains('css/graduation.css', 'margin: 20px 0 0'));
check('Graduation catalog separates readable screen viewer from true A4 print export', catalogCss.includes('v0.59.1: desktop catalog viewer is a readable preview') && catalogCss.includes('width: min(100%, 1040px)') && catalogCss.includes('max-height: none') && catalogCss.includes('height: clamp(280px, 34dvh, 430px)') && designsPageCode.includes('function openGraduationCatalogPrintDocument') && designsPageCode.includes('/api/graduation/catalog/export') && htmlContains('designs.html', "catalogId === 'graduation'") && htmlContains('routes/graduation.js', '@page { margin: 0; size: A4 portrait; }') && htmlContains('routes/graduation.js', 'width: 210mm') && htmlContains('routes/graduation.js', 'height: 297mm') && htmlContains('routes/graduation.js', 'const packageSlug = String(req.query.package'));
check('Graduation diplomas live inside graduation shell with roster and print exports', htmlContains('graduation.html', 'data-tab="diplomas"') && graduationCode.includes('function renderDiplomas') && graduationCode.includes('generateDiplomaWishes') && graduationCode.includes('/diplomas/export/pdf') && htmlContains('routes/graduation.js', "router.get('/quotes/:id/children'") && htmlContains('routes/graduation.js', "router.get('/quotes/:id/diplomas/export/pdf'") && htmlContains('services/graduationDiplomas.js', 'class="diploma-template-bg"') && htmlContains('css/graduation.css', 'DIPLOMAS — roster'));
check('Graduation diplomas use a stable three-step workflow instead of one chaotic action toolbar', graduationCode.includes('grad-diploma-workflow') && graduationCode.includes('grad-diploma-step-quote') && graduationCode.includes('grad-diploma-step-roster') && graduationCode.includes('grad-diploma-step-output') && graduationCode.includes('Обери випускний') && graduationCode.includes('Список дітей') && graduationCode.includes('Preview / export') && graduationCode.includes('grad-diploma-empty-actions') && !graduationCode.includes('class="grad-diploma-toolbar"') && !htmlContains('css/graduation.css', '.grad-diploma-toolbar') && htmlContains('css/graduation.css', '.grad-diploma-workflow') && htmlContains('css/graduation.css', '.grad-diploma-utility-actions') && htmlContains('css/graduation.css', '.grad-diploma-output-actions'));
check('Graduation diploma template is A4 portrait with park seal and no class-teacher signature', htmlContains('services/graduationDiplomas.js', '@page { size: 210mm 297mm; margin: 0mm; }') && htmlContains('services/graduationDiplomas.js', 'width: 210mm; height: 297mm') && htmlContains('services/graduationDiplomas.js', 'margin: 0 !important') && htmlContains('services/graduationDiplomas.js', '/images/graduation/diploma-comic-template.png') && htmlContains('services/graduationDiplomas.js', '/images/park-logo.png') && !htmlContains('services/graduationDiplomas.js', 'Класний керівник'));
check('Graduation diploma typography uses bundled sharp fonts without blur effects', htmlContains('services/graduationDiplomas.js', 'font-family: "DiplomaSerif"') && htmlContains('services/graduationDiplomas.js', '/assets/fonts/NotoSerif-Black.ttf') && htmlContains('services/graduationDiplomas.js', '/assets/fonts/Nunito-Black.ttf') && htmlContains('services/graduationDiplomas.js', 'text-rendering: geometricPrecision') && !htmlContains('services/graduationDiplomas.js', 'fonts.googleapis.com') && !/\.diploma-text\s*\{[^}]*transform:/s.test(fs.readFileSync(path.join(ROOT, 'services', 'graduationDiplomas.js'), 'utf8')) && !htmlContains('services/graduationDiplomas.js', 'text-shadow:') && !htmlContains('services/graduationDiplomas.js', '-webkit-text-stroke'));
check('Graduation child-list create modal uses compact essential fields', graduationCode.includes('function packFormFields(pack = {}, options = {})') && graduationCode.includes('const compact = options.compact === true') && graduationCode.includes('if (compact) return coreFields') && graduationCode.includes("packFormFields({ name: packContextText() || '' }, { compact: true })") && graduationCode.includes("className: 'graduation-pack-form-modal'"));
const shellReadyExemptPages = new Set(['index.html']);
const noExplicitShellReadyPages = mainAppShellPages.filter(page => {
    if (shellReadyExemptPages.has(page.file)) return false;
    const html = fs.readFileSync(path.join(ROOT, page.file), 'utf8');
    const pageScripts = getHtmlScripts(html)
        .filter(src => src !== 'js/auth.js' && src !== 'js/components/sidebar.js')
        .map(src => {
            const scriptPath = path.join(ROOT, src);
            return fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, 'utf8') : '';
        })
        .join('\n');
    return !/(showAuthenticatedPageShell\s*\(|Sidebar\.markShellReady\s*\(|showMainApp\s*\()/.test(html + '\n' + pageScripts);
});
check('Every standalone mainApp page has an explicit post-auth shell-ready handoff', noExplicitShellReadyPages.length === 0);
const legacySidebarTogglePages = htmlFiles.filter(file => fs.readFileSync(path.join(ROOT, file), 'utf8').includes('Sidebar toggle for mobile'));
check('Top-level pages do not keep page-local sidebar toggle bindings', legacySidebarTogglePages.length === 0);
const pagesWithObsoleteRightPanel = htmlFiles.filter(file => {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const scripts = getHtmlScripts(html);
    const styles = [...html.matchAll(/<link\s+[^>]*href=["']([^"']+)["']/g)]
        .map(m => m[1].split('?')[0]);
    const obsoleteScript = ['js', 'role-panel.js'].join('/');
    const obsoleteStyle = ['css', 'role-panel.css'].join('/');
    const obsoleteRoleSwitcherStyle = ['css', 'role-switcher.css'].join('/');
    return scripts.includes(obsoleteScript) || styles.includes(obsoleteStyle) || styles.includes(obsoleteRoleSwitcherStyle);
});
check('Obsolete role panel and legacy role switcher assets are fully removed from pages', pagesWithObsoleteRightPanel.length === 0 && !fs.existsSync(path.join(ROOT, 'js', 'role-panel.js')) && !fs.existsSync(path.join(ROOT, 'css', 'role-switcher.css')));
check('Legacy dark-mode/sidebar shell DOM fallbacks are removed from live JS', !appCode.includes('darkModeToggle') && !authCode.includes('darkModeToggle') && !uiCode.includes('function toggleDarkMode') && !uiCode.includes('function initNightSettings') && !sidebarCode.includes('_removeLegacySidebarActions') && !sidebarCode.includes('sidebarActions'));

// Check lead modal action binding
const leadsCode = fs.readFileSync(path.join(ROOT, 'js/leads-page.js'), 'utf8');
const leadsRouteCode = fs.readFileSync(path.join(ROOT, 'routes/leads.js'), 'utf8');
const analyticsRouteCode = fs.readFileSync(path.join(ROOT, 'routes/analytics.js'), 'utf8');
const workQueueCode = fs.readFileSync(path.join(ROOT, 'services/workQueue.js'), 'utf8');
const schedulerCode = fs.readFileSync(path.join(ROOT, 'services/scheduler.js'), 'utf8');
const omniLeadAssistantCode = fs.readFileSync(path.join(ROOT, 'services', 'omniLeadAssistant.js'), 'utf8');
const leadsPageCss = cssTextWithImports('css/pages.css');
check('Customer birthday tag sync has one-time scheduler backfill marker', schedulerCode.includes("CUSTOMER_BIRTHDAY_TAGS_BACKFILL_SETTING_KEY = 'customer_birthday_tags_backfill_done'") && schedulerCode.includes('getSettingValue(CUSTOMER_BIRTHDAY_TAGS_BACKFILL_SETTING_KEY)') && schedulerCode.includes('setSettingValue(CUSTOMER_BIRTHDAY_TAGS_BACKFILL_SETTING_KEY') && schedulerCode.includes('!backfillDone && result.errors === 0') && schedulerCode.includes('checkBirthdayTagSync,') && htmlContains('server.js', 'checkBirthdayTagSync } = require') && htmlContains('server.js', "guardScheduler('checkBirthdayTagSync', checkBirthdayTagSync") && htmlContains('server.js', 'runAtKyivTimeOrUntilSettingDone') && htmlContains('server.js', "'customer_birthday_tags_backfill_done'"));
check('Lead modal buttons bind before async data loads', leadsCode.indexOf('setupEvents();') < leadsCode.indexOf('await loadUsers();'));
check('Lead modal buttons support touchend taps', leadsCode.includes("btn.addEventListener('touchend', run, { passive: false })"));
check('Lead modal close avoids shared closeModal collision', leadsCode.includes('function closeLeadModal') && !leadsCode.includes('function closeModal'));
check('Lead save has duplicate-submit guard', leadsCode.includes('leadSaveInFlight'));
check('Lead assignees use lead-scoped endpoint', leadsCode.includes("apiFetch('/api/leads/assignees')"));
check('Lead workspace opens via query-driven endpoint', leadsCode.includes('getWorkspaceLeadIdFromUrl') && leadsCode.includes('/workspace') && leadsCode.includes("url.searchParams.set('lead'"));
check('Lead workspace uses canonical pipeline stage', leadsCode.includes('canonical: pipeline_stage') && leadsCode.includes('PIPELINE_STAGES.find'));
check('Lead workspace links customer/task/omni context', leadsCode.includes("leadCrmContextHref('/customers'") && leadsCode.includes("leadCrmContextHref('/tasks'") && leadsCode.includes("leadCrmContextHref('/omni'"));
check('Lead workspace opens the real customer card instead of the legacy lead-local card modal', leadsCode.includes('function openLeadCustomerCard') && leadsCode.includes('onclick="openLeadCustomerCard(${lead.id})"') && leadsCode.includes('window.openLeadCustomerCard = openLeadCustomerCard') && !leadsCode.includes('onclick="showCustomerCardModal(${lead.id})"') && !leadsCode.includes('showCustomerCardModal(leadId);'));
check('Lead manual conversion deep-link auto-opens booking with ensured customer context', leadsCode.includes('function ensureLeadCustomerForBooking') && leadsCode.includes("params.set('customerId', customer.id)") && leadsCode.includes("params.set('convert', 'booking')") && leadsCode.includes("params.set('eventDate', eventDate)") && timelineCode.includes('function maybeAutoOpenLeadConversionBooking') && timelineCode.includes("customerId: (params.get('customerId')") && timelineCode.includes('openTimelineCreateBookingFromToolbar()') && timelineCode.includes("params.get('convert') === 'booking'"));
check('Lead deal drag opens customer card flow instead of booking prompt', leadsCode.includes('function offerDealCustomerCardFlow') && leadsCode.includes('function ensureDealCustomerCardForLead') && leadsCode.includes('data.customerLinkMode') && leadsCode.includes("leadCrmContextHref('/customers', { open: ensured.customer.id }") && leadsCode.includes("okText: 'Відкрити картку'") && !leadsCode.includes('function offerDealBookingFlow') && !leadsCode.includes('Створити бронювання на таймлайні зараз'));
check('Lead deal stage auto-creates or links a SQL customer card', leadsRouteCode.includes('function ensureDealCustomerForLead') && leadsRouteCode.includes("const shouldEnsureDealCustomer = effectivePipelineStage === 'deal'") && leadsRouteCode.includes('await ensureDealCustomerForLead(queryable, updatedLead, businessContext') && leadsRouteCode.includes('INSERT INTO customers (business_context, name, phone, instagram, child_name, source, notes, lead_id, social_identities)') && leadsRouteCode.includes('buildLeadCustomerNotes(lead)') && leadsRouteCode.includes('appendUniqueLeadCustomerNote'));
check('Lead/customer journey uses durable many-to-one link history', htmlContains('db/migrations/262_leads_customer_links_and_value.sql', 'CREATE TABLE IF NOT EXISTS lead_customer_links') && leadsRouteCode.includes('function linkLeadCustomer') && leadsRouteCode.includes('INSERT INTO lead_customer_links (business_context, lead_id, customer_id, link_type, source, metadata, created_by, updated_at)') && leadsRouteCode.includes('FROM lead_customer_links lcl') && leadsRouteCode.includes("linkType: 'deal_customer'") && leadsRouteCode.includes("linkType: 'operator_link'") && htmlContains('routes/customers.js', 'customer.leadLinks'));
check('Lead stage changes are written to lead_interactions atomically', leadsRouteCode.includes('function logStageChange(queryable') && leadsRouteCode.includes("INSERT INTO lead_interactions (lead_id, user_id, type, summary, details, created_at)") && leadsRouteCode.includes("'status_change'") && leadsRouteCode.includes("source: 'leads.patch'") && !leadsRouteCode.includes('created_by, created_at') && !leadsRouteCode.includes("logStageChange(updatedLead.id"));
check('Lead list pagination loads beyond the old 200-card kanban cap', leadsCode.includes('function fetchAllLeadPages') && leadsCode.includes("params.set('limit', String(pageSize))") && leadsCode.includes("params.set('offset', String(offset))") && leadsRouteCode.includes('const LEADS_MAX_LIMIT = 500') && leadsRouteCode.includes('pagination:') && !leadsCode.includes("params.set('limit', '200')") && !leadsRouteCode.includes('Math.min(parseInt(lim) || 50, 200)'));
check('Lead kanban budget total uses canonical potential value', leadsCode.includes('function leadPotentialValue') && leadsCode.includes('lead?.potential_value') && leadsCode.includes('leadPotentialValue(l)') && leadsRouteCode.includes('COALESCE(l.potential_value, latest_card.budget_approx) AS budget_approx') && leadsRouteCode.includes('potential_value =') && htmlContains('db/migrations/262_leads_customer_links_and_value.sql', 'ADD COLUMN IF NOT EXISTS potential_value'));
check('Lead webhook dedup is scoped by source channel and legacy webhooks use canonical upsert', leadsRouteCode.includes('async function findExistingWebhookLead(payload, businessContext, sourceChannel') && leadsRouteCode.includes('AND source_channel = $3') && leadsRouteCode.includes('upsertUniversalWebhookLead(payload, businessContext, sourceChannel') && !leadsRouteCode.includes("status NOT IN ('booked','closed','lost')"));
check('Omni lead assistant writes canonical lead value instead of active customer_cards rows', omniLeadAssistantCode.includes('potential_value') && !omniLeadAssistantCode.includes('INSERT INTO customer_cards'));
check('Legacy pipeline endpoint delegates lead rows to canonical lead list query', leadsRouteCode.includes("canonicalSource: '/api/leads?order=kanban'") && leadsRouteCode.includes('fetchLeadList({') && !leadsRouteCode.includes('LIMIT 300'));
check('Maysternya Sales Ops lead actions are scoped and task-backed', leadsCode.includes('function isMaysternyaLeadContext') && leadsCode.includes('MAYSTERNYA_LEAD_TASK_PRESETS') && leadsCode.includes("label: exactBooking ? 'Відкрити запис' : 'Створити запис'") && leadsCode.includes('createLeadWorkspaceFollowUpTask') && leadsCode.includes('businessContext: leadContextFromRecord(lead)'));
check('Maysternya bot webhook leads render as a separate lead source/type', leadsCode.includes("maysternya_bot: '🤖 Бот-хуки Майстерні'") && htmlContains('leads.html', '🤖 Бот-хуки Майстерні') && leadsCode.includes('function isMaysternyaBotLead') && leadsCode.includes('type-bot-hooks') && leadsCode.includes('lead-origin-chip--bot') && leadsCode.includes('leadSourceLabel(lead)') && leadsRouteCode.includes('normalizeUniversalWebhookEnvelope') && leadsRouteCode.includes('crm_event_type') && leadsPageCss.includes('.lead-origin-chip--bot') && leadsPageCss.includes('.lead-type-badge.type-bot-hooks'));
check('Lead customer linking uses searchable existing-customer dropdown', leadsCode.includes('leadCustomerSelect') && leadsCode.includes("apiFetch(`/api/customers/search?q=") && !leadsCode.includes('apiSearchCustomers(trimmed)') && leadsCode.includes('submitLeadCustomerLinkExisting') && leadsCode.includes('submitLeadCustomerCreateNew'));
check('Leads editable/customer confirmations avoid native browser dialogs', leadsCode.includes('function confirmLeadUiAction') && !/window\.confirm(?:\s|[?.(])/.test(leadsCode));
check('Lead kanban funnel renders into footer summary slot', leadsCode.includes('ensureKanbanSummarySlot') && leadsCode.includes('kanbanSummarySlot') && leadsCode.includes('slotEl.appendChild(funnelEl)') && !leadsCode.includes('kanbanWrap.parentNode.insertBefore(funnelEl, kanbanWrap)'));
check('Lead kanban action buttons do not bubble into opening the workspace card', leadsCode.includes('data-kanban-actions') && leadsCode.includes("card.querySelectorAll('a, button, select, [data-kanban-actions]')") && leadsCode.includes("if (control.matches?.('[data-lead-type-select]')) return;") && leadsCode.includes('function isKanbanInteractiveTarget') && leadsCode.includes("card.addEventListener('click'") && leadsCode.includes('event.stopPropagation(); editLead'));
check('Lead kanban drag persists vertical card order', leadsCode.includes("params.set('order', 'kanban')") && leadsCode.includes('kanbanDragState') && leadsCode.includes('function getKanbanDragAfterElement') && leadsCode.includes('col.insertBefore(draggingCard, afterElement)') && leadsCode.includes('col.appendChild(draggingCard)') && leadsCode.includes('function getKanbanOrderedLeadIds') && leadsCode.includes('kanban_order: orderedLeadIds') && leadsRouteCode.includes('kanban_position') && leadsRouteCode.includes('function persistLeadKanbanOrder') && leadsRouteCode.includes('l.kanban_position ASC NULLS LAST') && htmlContains('db/migrations/260_leads_kanban_position.sql', 'ADD COLUMN IF NOT EXISTS kanban_position'));
check('Lead kanban card phone stays fully readable beside quality control', htmlContains('leads.html', '.kanban-card-meta { min-width: 0; display: grid; grid-template-columns: 1fr;') && htmlContains('leads.html', '.kanban-card-meta-text { min-width: 0; max-width: 100%; overflow: visible;') && htmlContains('leads.html', 'white-space: normal; overflow-wrap: anywhere;'));
check('Lead kanban cards can change lead quality inline', leadsCode.includes('function renderLeadTypeSelect') && leadsCode.includes('data-lead-type-select') && leadsCode.includes('function bindKanbanLeadTypeMenuEvents') && leadsCode.includes('bindKanbanLeadTypeMenuEvents();') && leadsCode.includes('data-lead-type-option="true"') && leadsCode.includes('function showKanbanLeadTypeMenu') && leadsCode.includes('function updateLeadTypeFromKanbanSelect') && leadsCode.includes('persistLeadType(leadId, nextType, { reload: false, ...patchOptions })') && leadsCode.includes('window.showKanbanLeadTypeMenu = showKanbanLeadTypeMenu') && leadsCode.includes('window.updateLeadTypeFromKanbanSelect = updateLeadTypeFromKanbanSelect') && !leadsCode.includes('<select class="lead-type-select') && !leadsCode.includes('onclick="showKanbanLeadTypeMenu') && !leadsCode.includes('onclick="updateLeadTypeFromKanbanSelect') && leadsPageCss.includes('.kanban-card .lead-type-select--kanban') && leadsPageCss.includes('appearance: none') && leadsPageCss.includes('.lead-type-popover') && leadsPageCss.includes('body.dark-mode .kanban-card .lead-type-select--kanban.type-quality'));
check('Lead type workflow routes non-sales classifications out of active kanban', leadsCode.includes('ACTIVE_KANBAN_LEAD_TYPES') && leadsCode.includes('LEAD_TYPE_WORKFLOW_MESSAGES') && leadsCode.includes('const LEAD_QUEUE_FILTERS') && leadsCode.includes('leadTypeForCurrentQueue') && leadsCode.includes('const kanbanLeads = leadsData') && leadsCode.includes('body.pipeline_stage = \'new\'') && !leadsCode.includes('[Співпраця] Потрібна задача для відділу') && leadsRouteCode.includes('const LEAD_TYPE_WORKFLOW') && leadsRouteCode.includes('function shouldAddLeadToMailing') && leadsRouteCode.includes('function onCollaborationLead') && leadsRouteCode.includes('duplicateMode: \'skip\'') && htmlContains('services/scheduler.js', "COALESCE(l.lead_type, 'quality') = 'quality'"));
check('Lead sales analytics count only quality while exposing classification queues', leadsRouteCode.includes("const SALES_LEAD_TYPE = 'quality'") && leadsRouteCode.includes('salesStats') && leadsRouteCode.includes('salesStageStats') && leadsRouteCode.includes('classificationStats') && leadsRouteCode.includes('operationalQueueStats') && leadsRouteCode.includes('allStageStats') && leadsRouteCode.includes('allPipeline') && leadsRouteCode.includes("COALESCE(lead_type, 'quality') = 'quality'") && analyticsRouteCode.includes('const SALES_LEAD_TYPE_SQL') && analyticsRouteCode.includes('classificationStats') && analyticsRouteCode.includes('excludedLeadTypes') && dashboardRouteCode.includes('const SALES_LEAD_TYPE_FILTER') && dashboardRouteCode.includes("COALESCE(l.pipeline_stage, 'new') = 'new'") && workQueueCode.includes("source: 'quality leads.pipeline_stage + leads.last_contact_at_or_created_at'") && workQueueCode.includes('salesLeadType: SALES_LEAD_TYPE') && workQueueCode.includes('operationalQueueStats') && workQueueCode.includes("COALESCE(l.lead_type, 'quality') = 'quality'") && schedulerCode.includes("COALESCE(l.pipeline_stage, 'new') = 'new'") && leadsCode.includes('function isSalesMetricLead') && leadsCode.includes('renderFunnelBar(salesGrouped)'));
check('Lead type reason modal captures explicit lost_reason without native prompts', leadsCode.includes('const LEAD_TYPE_REASON_OPTIONS') && leadsCode.includes("'Бот/реклама'") && leadsCode.includes("'Немає бюджету'") && leadsCode.includes("'Попросив ціни'") && leadsCode.includes('function requestLeadTypeReason') && leadsCode.includes('function leadTypePatchOptions') && leadsCode.includes('body.lost_reason = lostReason') && leadsCode.includes('detailsMode: \'other\'') && leadsCode.includes("select?.value === 'Інше'") && htmlContains('leads.html', 'id="lostReasonTitle"') && htmlContains('leads.html', 'id="lostReasonNotesGroup"') && !/window\.prompt(?:\s|[?.(])/.test(leadsCode));
check('Lead quality type return stays in Sales Funnel unless customer card opening is explicit', leadsCode.includes('function showQualityCategoryModal(leadId, options = {})') && leadsCode.includes("overlay.dataset.openCustomerCard = options.openCustomerCard ? 'true' : 'false'") && leadsCode.includes('const openCustomerCardAfterSave = overlay.dataset.openCustomerCard === \'true\'') && leadsCode.includes('if (openCustomerCardAfterSave) await openLeadCustomerCard(leadId);') && leadsCode.includes('else if (workspaceLeadId === leadId) openLeadWorkspace(leadId, { pushState: false });') && !/await loadLeads\(\);\s*await openLeadCustomerCard\(leadId\);/.test(leadsCode));
check('Lead collaboration type uses an atomic backend task handoff before changing type', leadsCode.includes('function requestCollaborationLeadTaskPayload') && leadsCode.includes('function createCollaborationLeadTask') && leadsCode.includes("formModal('Задача для співпраці'") && leadsCode.includes("apiFetch('/api/tasks/owners')") && leadsCode.includes('/collaboration-task') && leadsCode.includes('collaborationTaskPayload') && leadsCode.includes("source_type: 'lead'") && leadsCode.includes("source_id: String(leadId)") && leadsCode.includes("throw new Error('Форма задач недоступна") && leadsRouteCode.includes("router.post('/:id/collaboration-task'") && leadsRouteCode.includes('buildCollaborationTaskPayload') && leadsRouteCode.includes('logCollaborationWorkflow') && leadsRouteCode.includes("duplicateMode: 'reject'") && leadsRouteCode.includes('collaborationTaskHandled') && leadsRouteCode.includes("leadTypePatch.value === 'collaboration' && !collaborationTaskHandled") && leadsRouteCode.includes('duplicateMode: \'skip\''));
check('Lead queue summary is the single active queue filter with counts', !htmlContains('leads.html', 'id="leadQueueTabs"') && !leadsPageCss.includes('.lead-queue-tabs') && ['active', 'collaboration', 'informational', 'screened', 'spam', 'all'].every(queue => leadsCode.includes(`'${queue}'`)) && leadsCode.includes("const DEFAULT_LEAD_QUEUE = 'active'") && leadsCode.includes("lead_queue") && leadsCode.includes("url.searchParams.delete('lead_type')") && leadsCode.includes("params.set('lead_type', currentTypeFilter)") && leadsCode.includes('data-lead-queue-summary-item="${queue}"') && leadsPageCss.includes('.lead-queue-summary-count'));
check('Lead queue summary uses API classification counts and explains Active queue scope', leadsCode.includes('const LEAD_QUEUE_SUMMARY_ORDER') && leadsCode.includes("apiFetch('/api/leads/stats')") && leadsCode.includes('leadStatsData') && leadsCode.includes('function leadQueueCountsFromStats') && leadsCode.includes('classificationStats') && leadsCode.includes('operationalQueueStats') && leadsCode.includes('leadQueueCount(queue, counts)') && leadsCode.includes('Показані тільки якісні продажні ліди. Інші звернення доступні в чергах вище.') && leadsPageCss.includes('.lead-queue-summary-row') && leadsPageCss.includes('.lead-queue-summary') && leadsPageCss.includes('.lead-active-queue-hint') && leadsPageCss.includes('.leads-stats.leads-stats--queue-summary'));
check('Lead workflow info modal explains lead types and kanban stages', leadsCode.includes('id="leadWorkflowInfoBtn"') && htmlContains('leads.html', 'id="leadWorkflowInfoModal"') && htmlContains('leads.html', 'Тип ліда й етап канбану') && htmlContains('leads.html', 'Для продажної аналітики зараз рахуються тільки Якісний ліди') && htmlContains('leads.html', 'pipeline_stage=deposit_received') && htmlContains('leads.html', 'status=proposal') && leadsCode.includes('function openLeadWorkflowInfoModal') && leadsCode.includes('function closeLeadWorkflowInfoModal') && leadsCode.includes('function bindLeadWorkflowInfoButton') && leadsCode.includes("button.addEventListener('click', openLeadWorkflowInfoModal)") && leadsCode.includes("overlay.id === 'leadWorkflowInfoModal'") && leadsPageCss.includes('.lead-workflow-info-btn') && leadsPageCss.includes('.lead-workflow-info-modal') && leadsPageCss.includes('.lead-workflow-stage-list'));
check('Lead kanban page loads lead-specific popover styles', htmlContains('leads.html', 'css/pages-leads.css'));
check('Lead kanban quality menu trigger owns pointer, click, touch, and keyboard before card drag handlers', leadsCode.includes('function handleKanbanLeadTypeTriggerEvent') && leadsCode.includes('function bindKanbanLeadTypeTriggerControls') && leadsCode.includes("document.addEventListener('pointerdown', handleTriggerCapture, true)") && leadsCode.includes("document.addEventListener('mousedown', handleTriggerCapture, true)") && leadsCode.includes("document.addEventListener('touchstart', handleTriggerCapture, true)") && leadsCode.includes("if (event.key !== 'Enter' && event.key !== ' ') return;") && leadsCode.includes('bindKanbanLeadTypeTriggerControls(kanbanWrap)') && leadsCode.includes('draggable="false"') && leadsCode.includes('data-kanban-interactive="true"') && leadsCode.includes("if (control.matches?.('[data-lead-type-select]')) return;") && leadsCode.includes('keepClickableForGuard') && !leadsCode.includes('draggable="true" data-id="${l.id}" onclick="openLeadWorkspace'));
check('Lead kanban quality read-only state explains access instead of failing silently', leadsCode.includes('function showKanbanLeadTypeReadOnlyNotice') && leadsCode.includes("showKanbanLeadTypeReadOnlyNotice(trigger)") && leadsCode.includes("leadReadOnlyMessage('змінювати якість ліда')") && leadsCode.includes("dataset.leadTypeReadonlyNotice = 'true'") && leadsPageCss.includes('.lead-type-popover--notice') && leadsPageCss.includes('.lead-type-select--blocked-pulse') && leadsPageCss.includes('@keyframes leadTypeBlockedPulse'));
check('Lead kanban stage headers explain what belongs in every funnel stage', leadsCode.includes("hint: 'Етап виявлення потреби:") && leadsCode.includes('function renderPipelineStageHelp') && leadsCode.includes('class="pipeline-stage-help"') && leadsCode.includes('data-tooltip="${escapeHtml(hint)}"') && leadsCode.includes('${renderPipelineStageHelp(stage)}') && leadsPageCss.includes('.pipeline-stage-help') && leadsPageCss.includes('.pipeline-stage-help::after') && leadsPageCss.includes('body.dark-mode .pipeline-stage-help'));

const customersCode = fs.readFileSync(path.join(ROOT, 'js/customers-page.js'), 'utf8');
const customersRouteCode = fs.readFileSync(path.join(ROOT, 'routes/customers.js'), 'utf8');
const tasksCode = fs.readFileSync(path.join(ROOT, 'js/tasks-page.js'), 'utf8');
const centerCode = fs.readFileSync(path.join(ROOT, 'js/center-page.js'), 'utf8');
const omniHtml = fs.readFileSync(path.join(ROOT, 'omni.html'), 'utf8');
const pagesCss = cssTextWithImports('css/pages.css');
check('Customers page opens existing customer deep links', customersCode.includes('getCustomerDeepLinkId') && customersCode.includes("params.get('open')") && customersCode.includes("params.get('highlight')"));
check('Customers page no longer exposes duplicate journey funnel UI', !customersCode.includes('JOURNEY_STAGES') && !customersCode.includes('data-journey-stage') && !customersCode.includes('handleJourneyStageAction') && !htmlContains('customers.html', 'data-tab="journey"') && !htmlContains('customers.html', 'tabJourney') && htmlContains('customers.html', "params.get('tab') === 'journey'") && htmlContains('customers.html', "target.searchParams.set('view', 'kanban')"));
check('Customers keeps lifecycle segment deep links as list filters only', customersCode.includes('CUSTOMER_LIFECYCLE_SEGMENTS') && customersCode.includes("id: 'prospects'") && customersCode.includes('maxVisits: 0') && customersCode.includes('getCustomerLifecycleSegment') && customersRouteCode.includes('parseCustomerVisitBound') && customersRouteCode.includes('maxVisits !== null') && customersRouteCode.includes('COALESCE(b_agg.booking_count, c.total_bookings, 0)'));
check('Customers CRUD uses Postgres without legacy remote migration path', !customersRouteCode.includes("require('../db/supabase')") && !customersRouteCode.includes('getSupabase') && !customersRouteCode.includes('migrate-to-supabase'));
check('Sales funnel accepts canonical and legacy query-driven kanban pipeline drilldown', leadsCode.includes('currentPipelineStage') && leadsCode.includes("params.set('pipeline_stage', currentPipelineStage)") && leadsCode.includes('applyLeadQueryParams') && leadsCode.includes("params.get('view')") && leadsCode.includes("params.get('pipeline_stage') || params.get('stage')"));
check('Sales funnel view and filters survive refresh through canonical URL state', leadsCode.includes('function syncLeadUrlState') && leadsCode.includes("url.searchParams.set('view', currentView)") && leadsCode.includes("url.searchParams.delete('view')") && leadsCode.includes("setOrDelete('status', currentFilter)") && leadsCode.includes("url.searchParams.set('lead_queue', currentLeadQueue)") && leadsCode.includes("setOrDelete('event_date', currentDateFilter)") && leadsCode.includes("setOrDelete('search', document.getElementById('leadsSearch')?.value?.trim() || '')") && leadsCode.includes("window.history.replaceState(state, '', url)") && /syncLeadUrlState\([^)]*\);\s*loadLeads\(\);/.test(leadsCode));
check('Legacy leads route preserves Sales Funnel refresh state', htmlContains('server.js', "const query = req.originalUrl.includes('?')") && htmlContains('server.js', 'res.redirect(302, `/sales-funnel${query}`);') && leadsCode.includes('function normalizeLeadCanonicalRoute') && leadsCode.includes("url.pathname = '/sales-funnel'") && leadsCode.includes('normalizeLeadCanonicalRoute();'));
check('Customer card exposes communication hub context', customersCode.includes('fetchCustomerCommunicationContext') && customersCode.includes('/communication-context') && customersCode.includes('renderCustomerCommunicationHub') && customersCode.includes('customerCommHub'));
check('Customer communication hub has exact/suggested/unavailable styling', htmlContains('customers.html', '.customer-hub-pill.exact') && htmlContains('customers.html', '.customer-hub-pill.suggested') && htmlContains('customers.html', '.customer-hub-pill.unavailable'));
check('Customer communication hub exposes one truthful interactive dialog icon', customersCode.includes('customerHubDialogTarget') && customersCode.includes('customerHubDialogIcon(dialogTarget)') && customersCode.includes('links.omniExact') && customersCode.includes('links.omniSuggested') && customersCode.includes('links.omniSearch') && htmlContains('customers.html', '.customer-dialog-icon.exact') && htmlContains('customers.html', '.customer-dialog-icon.suggested') && htmlContains('customers.html', '.customer-dialog-icon.search'));
check('Customer detail hero shows funnel stage, booking room, and Omni shortcut', customersCode.includes('function renderCustomerDetailHero') && customersCode.includes('customerPipelineStageMeta') && customersCode.includes('customerHeaderBookingDetails') && customersCode.includes('customerHeaderOmniTarget') && customersCode.includes('customer-hero-action-group') && customersCode.includes('customer-hero-danger-group') && customersCode.includes('loadCommunicationHub(customer.id, communicationContext)') && customersRouteCode.includes('SELECT id, pipeline_stage, status') && customersRouteCode.includes('leadPipelineStage') && pagesCss.includes('.customer-detail-hero') && pagesCss.includes('grid-template-areas') && pagesCss.includes('.customer-hero-stage') && pagesCss.includes('.customer-hero-booking') && pagesCss.includes('.customer-hero-omni') && pagesCss.includes('.customer-hero-danger-group'));
check('Customer create modal has styled source select and linking tools', htmlContains('customers.html', 'customer-edit-select-wrap') && htmlContains('customers.html', 'customer-edit-link-panel') && htmlContains('customers.html', 'data-customer-identity-add="telegram"') && customersCode.includes('bindCustomerIdentityTools'));
check('Maysternya customer presentation hides Park-only child/certificate details under business switch', customersCode.includes('function isMaysternyaCustomerContext') && customersCode.includes('Клієнти Майстерні') && customersCode.includes('Історія сесій') && customersCode.includes('!maysternyaMode && customer.certificates') && customersCode.includes("document.getElementById('editChildrenSection')") && customersCode.includes('const children = isMaysternyaCustomerContext() ? [] : serializedCustomerEditingChildren()'));
check('New customer flow opens detail hub after create', customersCode.includes('showCustomerDetail(result.id)') && customersCode.includes('saveBtn.disabled = true'));
check('Tasks page opens task deep links', tasksCode.includes('getTaskDeepLinkId') && tasksCode.includes('openTaskDetail(taskId)'));
check('Tasks page supports assistant overdue filter deep links', tasksCode.includes('assistantTaskFilter') && tasksCode.includes('assistantFilter') && tasksCode.includes('function applyAssistantTaskFilter') && tasksCode.includes('function isOverdueTask'));
check('Tasks quick composer defaults to current user and keeps new task first', tasksCode.includes('function resolveQuickAddOwnerUserId') && tasksCode.includes('setTaskAssigneeMode(\'self\')') && tasksCode.includes('lastCreatedTaskId') && tasksCode.includes('sortTasksForDisplay') && tasksCode.includes('keepNewTaskVisible(result.task, data)') && tasksCode.includes('result.task?.id'));
check('Tasks my view includes owned and delegated tasks with clear assignment badges', tasksCode.includes('function isTaskInMyWorkspace') && tasksCode.includes('function isTaskDelegatedByCurrentUser') && htmlContains('tasks.html', 'task-assignment-self') && tasksCode.includes('Я поставив:') && htmlContains('tasks.html', 'task-my-scope-summary'));
check('Tasks pin self-created personal tasks above mixed queues', tasksCode.includes('function isSelfCreatedPersonalTask') && tasksCode.includes("taskMode(task) === 'personal'") && tasksCode.includes('function taskWorkspaceDisplayRank') && tasksCode.indexOf('const rankDiff = taskWorkspaceDisplayRank(a) - taskWorkspaceDisplayRank(b);') > tasksCode.indexOf("const bDone = b.status === 'done';") && htmlContains('tasks.html', 'task-assignment-self-personal') && htmlContains('tasks.html', 'task-my-scope-pin'));
check('Tasks observer policy reaches detail UI and task APIs', tasksCode.includes('loadTaskObservers(t.id)') && tasksCode.includes('observerUserIds') && htmlContains('routes/tasks.js', "router.get('/:id/observers'") && htmlContains('services/taskPolicy.js', 'buildTaskObserverMatch'));
check('Tasks intelligence badges do not render raw object labels', tasksCode.includes('function formatTaskIntelLabel') && tasksCode.includes('formatTaskIntelLabel(intel.recommendedAction)'));
check('Tasks delete action does not bubble into card or bulk confirm flows', (tasksCode.includes('data-task-action="delete"') || tasksCode.includes("'data-task-action': 'delete'")) && tasksCode.includes('await deleteTask(taskId)') && tasksCode.includes('clearBulkSelection();') && uiCode.includes('let _activeConfirmClose = null') && uiCode.includes("overlay.dataset.confirmKind = 'confirm'") && uiCode.includes('const _toastDedupeMs = 1400'));
check('Tasks kanban cards expose real draggable status targets', tasksCode.includes('const KANBAN_STATUSES') && tasksCode.includes('data-kanban-card="true"') && tasksCode.includes('draggable="true"') && tasksCode.includes('data-kanban-status'));
check('Tasks kanban DnD persists status with optimistic rollback', tasksCode.includes('function setupTaskKanbanDragAndDrop') && tasksCode.includes('moveTaskBetweenKanbanColumns') && tasksCode.includes('await apiPatchTaskStatus(taskId, targetStatus)') && tasksCode.includes('restoreKanbanTaskSnapshot'));
check('Tasks kanban DnD has clear visual feedback states', htmlContains('tasks.html', '.kanban-col.is-drop-target') && htmlContains('tasks.html', '.task-card.is-dragging') && htmlContains('tasks.html', '.task-card.is-kanban-saving'));
check('Tasks API hides active duplicate rows by default and keeps governance cleanup explicit', tasksRouteCode.includes('activeDuplicateCanonicalFilterSql') && tasksRouteCode.includes('include_duplicates') && taskDuplicatePolicyCode.includes('function activeDuplicateCanonicalFilterSql') && taskDuplicatePolicyCode.includes('function taskDuplicateSourceAnchor') && tasksCode.includes('apiCleanupTaskDuplicates(true)') && tasksCode.includes('Звичайний список показує основні рядки') && htmlContains('db/migrations/188_tasks_canonical_active_dedup_v2.sql', "archive_reason = 'auto_duplicate_v2'"));
check('Task detail overlay uses guarded close instead of direct backdrop removal', tasksCode.includes('function isTaskDetailDirty') && tasksCode.includes('closeTaskDetailOverlay(false)') && !tasksCode.includes("taskDetailOverlay')?.remove()"));
check('Task detail dirty-close avoids native browser dialogs', tasksCode.includes('function confirmTaskUiAction') && !tasksCode.includes('window.confirm'));
check('Task detail save sends stale-write version from selected task', tasksCode.includes('dataset.taskVersion') && tasksCode.includes('version: document.getElementById'));
check('Tasks stale focus view falls back safely', tasksCode.includes("requestedView === 'focus'") && tasksCode.includes("currentView = 'today'"));
check('Tasks page does not fetch points for removed top strip', !tasksCode.includes('apiGetMyPoints') && !tasksCode.includes('loadMyPoints') && !tasksCode.includes('/points/'));
check('Task detail dirty state has no orphan focus rank field', !tasksCode.includes('_tdFocusRank'));
check('Tasks taxonomy exposes orders and checklist submenu rails', tasksCode.includes('const TASK_CATEGORY_TREE') && tasksCode.includes('orders:') && tasksCode.includes('checklist:') && tasksCode.includes('confectionery') && tasksCode.includes('cake_decor'));
check('Tasks operation labels are localized for cards and summary', tasksCode.includes('const PACK_STATUS_LABELS') && tasksCode.includes('Чернетка') && tasksCode.includes('У виробництві') && tasksCode.includes('Готові сьогодні') && tasksCode.includes('Блокерів:'));
check('Tasks dark taxonomy controls keep readable active contrast', pagesCss.includes('body.dark-mode .subcat-chip.active') && pagesCss.includes('color: #FDF4FF') && pagesCss.includes('body.dark-mode .operations-summary-item small') && pagesCss.includes('body.dark-mode .operations-summary-item.is-hot'));
check('Tasks dark taxonomy category chips brighten orders and checklist', pagesCss.includes('body.dark-mode .cat-chip[data-cat="orders"]') && pagesCss.includes('color: #F87171') && pagesCss.includes('body.dark-mode .cat-chip[data-cat="checklist"]') && pagesCss.includes('color: #E879F9'));
check('Tasks dark operation badges keep readable variant colors', pagesCss.includes('body.dark-mode .task-os-badge.pack-status') && pagesCss.includes('color: #7DD3FC') && pagesCss.includes('body.dark-mode .task-os-badge.blocked') && pagesCss.includes('color: #FCA5A5') && pagesCss.includes('body.dark-mode .task-os-badge.owner-role') && pagesCss.includes('color: #86EFAC'));
check('Dashboard team online renders last-seen presence states', dashboardPageCode.includes('formatTeamLastSeen') && dashboardPageCode.includes('онлайн зараз') && dashboardPageCode.includes('був ${minutes} хв тому') && dashboardPageCode.includes('team-presence-last-seen'));
check('Dashboard team online defaults to live-only with a subtle history toggle', dashboardPageCode.includes('pzp_team_online_history') && dashboardPageCode.includes("scope', isTeamOnlineHistoryEnabled() ? 'history' : 'online'") && dashboardPageCode.includes('team-presence-history-toggle') && dashboardRouteCode.includes('hidden_until_history_enabled') && dashboardRouteCode.includes("lower(COALESCE(u.username, '')) NOT LIKE 'openclaw%'"));
check('Dashboard board notes use a stable textarea editor', dashboardPageCode.includes('<textarea class="board-note-text board-note-editor"') && !dashboardPageCode.includes('contenteditable="${_boardInteractionMode'));
check('Dashboard board note focus does not force a rerender', dashboardPageCode.includes("selectBoardItem(textEl.dataset.boardText, { render: false })") && dashboardPageCode.includes('handleBoardTextInput(textEl)'));
check('Dashboard board drag ignores note editors and controls', dashboardPageCode.includes('function isBoardInteractiveTarget') && dashboardPageCode.includes('if (isBoardInteractiveTarget(event.target)) return;'));
check('Dashboard board exposes Photoshop-like active tools and clear-all action', dashboardPageCode.includes('const BOARD_CREATE_TOOLS') && dashboardPageCode.includes('function setBoardTool') && dashboardPageCode.includes('function clearBoardContent') && dashboardPageCode.includes('function createBoardItemFromTool') && dashboardHtml.includes('data-board-tool="note"') && dashboardHtml.includes('data-board-tool="rect"') && dashboardHtml.includes('id="boardToolOptions"') && dashboardHtml.includes('DashboardPage.clearBoardContent()'));
check('Dashboard unifies scene and board into one workspace mode', dashboardPageCode.includes("const DASHBOARD_WORKSPACE_MODE = 'workspace'") && dashboardPageCode.includes('function ensureUnifiedWorkspaceSeed') && dashboardRouteCode.includes("const DASHBOARD_WORKSPACE_MODE = 'workspace'") && dashboardHtml.includes('data-dashboard-workspace="unified"') && !dashboardHtml.includes("DashboardPage.setDashboardMode('grid')") && !dashboardHtml.includes('Сцена + Board'));
check('Dashboard workspace keeps widgets live after tool switches and exposes real builder controls', dashboardPageCode.includes('syncBoardWidgetRuntime') && dashboardPageCode.includes('data-widget-runtime') && dashboardPageCode.includes('addSelectedBoardWidget') && dashboardPageCode.includes('board-builder-widget-select') && dashboardPageCode.includes('beginBoardResize') && dashboardCss.includes('.board-resize-handle') && !dashboardPageCode.includes('board-widget-mute') && !dashboardCss.includes('.board-widget-mute'));
check('Dashboard workspace uses a Photoshop-like vertical tool dock', dashboardHtml.includes('dashboard-workspace-stage') && dashboardHtml.includes('board-tool-rail') && ['interaction', 'navigate', 'insert', 'draw', 'shape', 'connect', 'content', 'templates', 'actions'].every(family => dashboardHtml.includes(`data-board-tool-family="${family}"`)) && ['title="Вибір"', 'title="Пензель"', 'title="Очистити все"', 'aria-label="З промпта"'].every(token => dashboardHtml.includes(token)) && dashboardCss.includes('v0.60.40: Photoshop-like compact dashboard tool dock') && dashboardCss.includes('.board-pro-palette.board-tool-rail') && dashboardCss.includes('grid-template-columns: 58px minmax(0, 1fr)') && dashboardCss.includes('[data-board-action="undo"]::before'));
check('Dashboard workspace exposes Ukrainian tool labels, snap presets and compact top options', dashboardPageCode.includes('function setBoardSnapMode') && dashboardPageCode.includes('normalizeBoardSnapMode') && dashboardPageCode.includes('BOARD_SNAP_LABELS') && dashboardPageCode.includes('Планування композиції') && dashboardPageCode.includes('BOARD_PLANNING_ZONES') && dashboardHtml.includes('Єдина sandbox-сцена') && dashboardHtml.includes('data-board-tool="space"') && !dashboardHtml.includes('Workspace</button>') && !dashboardHtml.includes('Reset view') && dashboardCss.includes('--workspace-selection-ring') && dashboardCss.includes('.board-tool-snap-presets') && dashboardCss.includes('.dashboard-workspace-toolbar .board-tool-options') && dashboardCss.includes('.dashboard-planner-zone') && dashboardPageCode.includes('data-workspace-module="true"'));
check('Dashboard board exposes content-workspace presets with persistent tones', dashboardPageCode.includes('const BOARD_CONTENT_PRESETS') && dashboardPageCode.includes('function insertBoardContentPreset') && dashboardHtml.includes('data-board-preset="production"') && dashboardHtml.includes('data-board-tool-family="content"') && dashboardCss.includes('.board-content-preset-strip') && dashboardCss.includes('[data-board-tone="production"]') && dashboardRouteCode.includes('BOARD_CONTENT_TONES') && dashboardRouteCode.includes('safe.tone = normalizeBoardTone'));
check('Dashboard board uses one unified interaction mode', dashboardPageCode.includes("const BOARD_INTERACTION_MODE = 'unified'") && dashboardHtml.includes('boardUnifiedModeLabel') && !dashboardHtml.includes('boardViewModeBtn') && !dashboardHtml.includes('boardEditModeBtn') && !dashboardCss.includes('data-interaction-mode="edit"') && !dashboardCss.includes('data-interaction-mode="view"'));
check('Dashboard board preserves drawing, connector, and active-tool state through frontend/backend config', dashboardPageCode.includes('normalizeBoardStroke') && dashboardPageCode.includes('drawings: drawingsRaw') && dashboardPageCode.includes('normalizedConnectors') && dashboardPageCode.includes('schemaVersion: BOARD_SCHEMA_VERSION') && dashboardRouteCode.includes('sanitizeBoardStroke') && dashboardRouteCode.includes('sanitizeBoardConnector') && dashboardRouteCode.includes('schemaVersion: BOARD_SCHEMA_VERSION') && dashboardRouteCode.includes('activeTool: normalizeBoardTool'));
check('Dashboard board settings expose snap/grid/guides and drawing style persistence', dashboardPageCode.includes('settingsBoardSnapToGrid') && dashboardPageCode.includes('settingsBoardShowGrid') && dashboardPageCode.includes('settingsBoardShowGuides') && dashboardPageCode.includes('settingsBoardStrokeColor') && dashboardPageCode.includes('function setBoardPreference') && dashboardCss.includes('.board-tool-options') && dashboardCss.includes('dashboard-settings-board-card'));
check('Dashboard work queue actions use CRM modal/notification helpers instead of direct blocking dialogs', dashboardPageCode.includes('function confirmDashboardAction') && dashboardPageCode.includes('function notifyDashboardIssue') && !dashboardPageCode.includes('alert(err.message ||') && !dashboardPageCode.includes("if (!window.confirm('Підтвердити попереднє бронювання?')") && !dashboardPageCode.includes("if (!window.confirm('Позначити задачу виконаною?')") && !dashboardPageCode.includes("if (!window.confirm('Очистити очікування відповіді без позначки"));
const nativeConfirmPattern = /window\.confirm(?:\s|[?.(])/;
const nativeConfirmFiles = [
    'js/auth.js',
    'js/ui.js',
    'js/afisha-page.js',
    'js/certificates-page.js',
    'js/assistant-foundation.js',
    'js/dashboard-page.js',
    'js/hr-page.js',
    'js/profile-page.js',
    'js/leads-page.js',
    'js/tasks-page.js'
];
check('CRM frontend confirmation flows avoid native browser confirm fallbacks', nativeConfirmFiles.every(file => !nativeConfirmPattern.test(fs.readFileSync(path.join(ROOT, file), 'utf8'))));
const productionJsFiles = walkFiles(path.join(ROOT, 'js'), file => file.endsWith('.js'));
const nativeDialogPattern = /window\.(?:prompt|alert|confirm)\s*\(/;
check('CRM frontend uses shared modal/notification helpers instead of native browser dialogs',
    productionJsFiles.every(file => !nativeDialogPattern.test(fs.readFileSync(file, 'utf8'))));
const runtimeSurfaceFiles = [
    ...walkFiles(path.join(ROOT, 'js'), file => file.endsWith('.js')),
    ...walkFiles(path.join(ROOT, 'routes'), file => file.endsWith('.js')),
    ...walkFiles(path.join(ROOT, 'services'), file => file.endsWith('.js')),
    ...walkFiles(path.join(ROOT, 'middleware'), file => file.endsWith('.js')),
    path.join(ROOT, 'server.js'),
    path.join(ROOT, 'db', 'index.js')
];
const supabaseRuntimePattern = /@supabase\/supabase-js|SUPABASE_|getSupabase|createSupabase|createClient\s*\(\s*process\.env\.SUPABASE/i;
check('Live runtime surface stays on canonical Postgres and has no Supabase client path',
    runtimeSurfaceFiles.every(file => !supabaseRuntimePattern.test(fs.readFileSync(file, 'utf8'))));
check('Dashboard board repairs legacy note payloads', dashboardPageCode.includes('item.noteText || item.content || item.body || item.label') && dashboardPageCode.includes('legacy-note-upgrade') && dashboardRouteCode.includes('item.noteText || item.content || item.body || item.label'));
check('Dashboard board renders shape variants', dashboardPageCode.includes("addBoardShape(shape = 'rect', point = null)") && dashboardCss.includes('.board-shape-arrow::after') && dashboardCss.includes('.board-shape-diamond'));
check('Dashboard team online endpoint distinguishes websocket online from last seen', dashboardRouteCode.includes('getOnlineUserIds') && dashboardRouteCode.includes('lastSeenSource') && dashboardRouteCode.includes('recentlyActive'));
check('Omni page applies contextual search query', omniHtml.includes('applyQueryContext') && omniHtml.includes("params.get('search')"));
check('Omni page exposes account connectivity panel', omniHtml.includes('omniAccountsPanel') && omniHtml.includes('omniAccountsGrid') && omniHtml.includes("api('/accounts')"));
check('Omni page guides unavailable channels to account setup', omniHtml.includes('accountGuidanceMessage') && omniHtml.includes('data-account-jump') && omniHtml.includes('Підключення каналів'));
check('Omni page separates inbox from channel setup and health workspaces', omniHtml.includes('omni-workspace-modes') && omniHtml.includes('data-omni-mode="inbox"') && omniHtml.includes('id="omniChannelsWorkspace"') && omniHtml.includes('id="omniHealthWorkspace"') && omniHtml.includes('function setOmniMode') && omniHtml.includes('function renderOmniHealthWorkspace') && omniHtml.includes("hashPanel === 'accounts'") && omniHtml.includes('openAccountPanel'));
check('Omni channel setup is not embedded in the conversation sidebar', omniHtml.indexOf('id="omniAccountsPanel"') > omniHtml.indexOf('id="omniChannelsWorkspace"') && !omniHtml.includes('omni-chat-empty-icon">Om'));
check('Center hot leads update canonical pipeline stage', centerCode.includes('JSON.stringify({ pipeline_stage: status })'));
const legacyCenterHotLeadFetch = "fetch('/api/leads/" + "hot'";
check('Center hot leads list uses scoped business API URL', centerCode.includes('function centerScopedApiUrl') && centerCode.includes('CrmBusinessContext?.apiUrl') && centerCode.includes("fetch(centerScopedApiUrl('/api/leads/hot')") && !centerCode.includes(legacyCenterHotLeadFetch));
check('Center renders freshness and truth strip from overview metadata', centerCode.includes('function renderCenterTruth') && centerCode.includes('generatedAt') && centerCode.includes('confirmedBookings') && centerCode.includes('setInitialLoadingStates'));
const centerRouteCode = fileText('routes/center.js');
const leadBookingLinkCode = fileText('services/leadBookingLink.js');
const telegramTemplatesBanquetCode = fileText('services/templates.js');
const financeRouteCode = fileText('routes/finance.js');
check('Mixed booking previews use banquet arrival wording without global time rename',
    customersCode.includes('function customerBookingDateTimeText')
    && customersCode.includes('Прихід гостей: ${timeText}')
    && customersRouteCode.includes('banquet_guests')
    && leadsCode.includes('function workspaceBookingDateTimeText')
    && leadsRouteCode.includes('banquetGuests: row.banquet_guests')
    && centerCode.includes('function centerBookingDateTimeText')
    && centerRouteCode.includes('b.banquet_guests')
    && dashboardPageCode.includes('function dashboardWidgetBookingTimeText')
    && dashboardRouteCode.includes('b.banquet_guests')
    && leadBookingLinkCode.includes('function bookingLeadDateTimeNotes')
    && leadBookingLinkCode.includes('Дата банкету')
    && telegramTemplatesBanquetCode.includes('function bookingScheduleLine')
    && telegramTemplatesBanquetCode.includes('Прихід гостей')
    && settingsCode.includes('function settingsBookingScheduleLine')
    && financeRouteCode.includes('function financeBookingDateLineHtml'));
check('Center birthdays uses canonical CRM token key', htmlContains('center.html', "localStorage.getItem('pzp_token') || localStorage.getItem('token')"));
check('Explainability helper exposes filter summary and empty state renderers', uiCode.includes('window.Explainability') && uiCode.includes('renderFilterSummary') && uiCode.includes('renderEmptyState'));
check('CRM system UI exposes requestId-aware errors and shared state renderers',
    uiCode.includes('window.CrmApiErrors')
    && uiCode.includes('fromResponse(response')
    && uiCode.includes('window.CrmUiState')
    && uiCode.includes('renderError(error')
    && uiCode.includes('код: ${requestId}')
    && baseCss.includes('.crm-ui-state--error')
    && darkModeCss.includes('body.dark-mode .crm-ui-state--error'));
check('Reports API surfaces requestId-aware backend errors to users',
    reportsPageCode.includes('window.CrmApiErrors?.fromResponse')
    && reportsPageCode.includes('window.CrmApiErrors?.format?.(msg)'));
check('Shared API wrappers preserve backend requestId metadata',
    apiCode.includes('function apiErrorFromResponse')
    && apiCode.includes('formatApiErrorPayload')
    && apiCode.includes('requestId: errBody.requestId || errBody.request_id || null'));
check('Explainability shared styles exist', pagesCss.includes('.explain-filter-summary') && pagesCss.includes('.explain-empty') && pagesCss.includes('.explain-clear-btn'));
check('Timeline responsive density updates JS cell geometry with viewport', uiCode.includes('function applyTimelineResponsiveDensity') && uiCode.includes('_timelineResponsiveCellWidth') && uiCode.includes('--timeline-cell-w') && htmlContains('js/app.js', 'initTimelineResponsiveResize'));
check('Timeline Android density reads lexical CONFIG and visual viewport', uiCode.includes("typeof CONFIG === 'undefined'") && !uiCode.includes('if (!window.CONFIG || !CONFIG.TIMELINE)') && uiCode.includes('window.visualViewport?.addEventListener?.(\'resize\'') && uiCode.includes('window.visualViewport?.addEventListener?.(\'scroll\''));
check('Timeline iOS and iPad viewport hardening is explicit', uiCode.includes('function syncTimelineViewportMetrics') && uiCode.includes('--eg-viewport-height') && uiCode.includes('--eg-viewport-width') && uiCode.includes('timeline-dashboard-root') && htmlContains('css/timeline.css', 'var(--eg-viewport-height') && responsiveCss.includes('v0.63.5: iPad/tablet timeline shell') && responsiveCss.includes('html.timeline-dashboard-root') && responsiveCss.includes('body.timeline-dashboard-page.shell-ready .sidebar-nav:not(.collapsed) ~ .header'));
check('Timeline compact mode fits desktop while phones keep readable horizontal scroll', uiCode.includes('function _timelineFitCellWidth') && uiCode.includes('phones must scroll horizontally instead of crushing readable time cells') && uiCode.includes("container.dataset.fitScreen = compact && viewportWidth > 768 ? 'true' : 'scroll'") && uiCode.includes('event?.target?.checked') && uiCode.includes('timeline-compact-mode') && htmlContains('js/app.js', 'compactToggle.checked = AppState.compactMode') && htmlContains('css/timeline.css', 'v0.56.5: timeline compact fit-screen density') && htmlContains('css/controls.css', 'keep compact zoom modes genuinely compact') && darkModeCss.includes('v0.63.55: operational compact timeline density') && darkModeCss.includes('body.timeline-dashboard-page.timeline-compact-mode .control-panel') && darkModeCss.includes('body.timeline-dashboard-page.timeline-compact-mode .booking-block'));
check('Timeline phone layout has tidy toolbar rows and readable day/week scroll grids', responsiveCss.includes('v0.69.20: phone timeline toolbar and readable horizontal grid') && responsiveCss.includes('"prev date next"') && responsiveCss.includes('"today day day"') && responsiveCss.includes('.timeline-container[data-fit-screen="scroll"] .timeline-scroll') && responsiveCss.includes('width: max-content !important') && responsiveCss.includes('body.timeline-dashboard-page .multi-day-container') && responsiveCss.includes('body.timeline-dashboard-page .mini-line-grid') && responsiveCss.includes('--mini-grid-width') && responsiveCss.includes('body.timeline-dashboard-page.timeline-compact-mode :where(.status-filter-btn, .period-btn, .zoom-btn)'));
check('Timeline horizontal scroll restore is scoped and reset on navigation context changes',
    timelineCacheCode.includes('function timelineHorizontalScrollStateKey')
    && timelineCacheCode.includes('function captureTimelineHorizontalScrollState')
    && timelineCacheCode.includes('function restoreTimelineHorizontalScrollState')
    && timelineCacheCode.includes('function resetTimelineHorizontalScroll')
    && timelineCacheCode.includes('function markTimelineNavigationScrollReset')
    && timelineCacheCode.includes('timelineCacheScopeKey()')
    && timelineCacheCode.includes('const timelineView = timelineCurrentView();')
    && timelineCacheCode.includes('timelineDateKey(date)')
    && timelineCacheCode.includes("AppState.multiDayMode ? 'week' : 'day'")
    && timelineCacheCode.includes('timelineHorizontalScrollZoomKey()')
    && timelineCacheCode.includes("AppState.compactMode ? 'compact' : 'regular'")
    && timelineCode.includes("markTimelineNavigationScrollReset('date-change')")
    && timelineCode.includes("markTimelineNavigationScrollReset('view-switch-before-render')")
    && timelineCode.includes("markTimelineNavigationScrollReset('business-context-change')")
    && appCode.includes('const previousPeriod = AppState.multiDayMode ? TIMELINE_PERIOD_WEEK : TIMELINE_PERIOD_DAY')
    && appCode.includes('previousPeriod !== normalizedPeriod')
    && appCode.includes("markTimelineNavigationScrollReset('date-input-change')")
    && appCode.includes("markTimelineNavigationScrollReset('today')")
    && appCode.includes("markTimelineNavigationScrollReset('period-change')")
    && uiCode.includes('const previousCompactMode = Boolean(AppState.compactMode)')
    && uiCode.includes('previousCompactMode !== Boolean(AppState.compactMode)')
    && uiCode.includes('const previousLevel = AppState.zoomLevel || CONFIG.TIMELINE.CELL_MINUTES')
    && uiCode.includes('previousLevel !== nextLevel')
    && uiCode.includes("markTimelineNavigationScrollReset('zoom-change')")
    && uiCode.includes("markTimelineNavigationScrollReset('compact-change')")
    && !timelineCode.includes('Preserve horizontal scroll position across date changes')
    && !timelineCode.includes('Restore horizontal scroll position after render')
    && !timelineCode.includes('const savedScrollLeft = timelineScroll ? timelineScroll.scrollLeft : 0'));
check('Timeline room-to-animator switch reconciles vertical shell height without removing iPhone guards',
    uiCode.includes('function syncTimelineViewHeight')
    && uiCode.includes('function resetTimelineVerticalScroll')
    && uiCode.includes('scroll.scrollTop = 0')
    && timelineCode.includes("resetTimelineVerticalScroll('view-switch-before-render')")
    && uiCode.includes('resetVerticalScroll: detail.view !== detail.previousView')
    && uiCode.includes('function scheduleTimelineViewHeightSync')
    && uiCode.includes("window.addEventListener?.('timeline:view-changed'")
    && uiCode.includes('container.dataset.timelineView = view')
    && uiCode.includes('container.dataset.lineCount = String(lineCount)')
    && uiCode.includes("--timeline-content-height")
    && timelineCode.includes("scheduleTimelineViewHeightSync('render-complete')")
    && timelineConstructorCss.includes('body.timeline-view-animators .timeline-container[data-timeline-height-ready="true"]')
    && timelineConstructorCss.includes('max-height: min(var(--timeline-content-height), var(--timeline-shell-max-height))')
    && responsiveCss.includes('body.timeline-dashboard-page.timeline-view-animators .timeline-container[data-timeline-height-ready="true"]')
    && responsiveCss.includes('clamp(360px, var(--timeline-content-height), var(--timeline-shell-max-height)) !important')
    && responsiveCss.includes('v0.73.80: iPhone 11/Safari needs a definite container height')
    && responsiveCss.includes('height: clamp(360px, calc(var(--eg-viewport-height, 100dvh) - 250px), 58dvh) !important;'));
check('Timeline default zoom is 30 minutes when no valid saved preference exists', timelineConfigCode.includes('const TIMELINE_DEFAULT_ZOOM_MINUTES = 30') && timelineConfigCode.includes('CELL_MINUTES: TIMELINE_DEFAULT_ZOOM_MINUTES') && timelineConfigCode.includes('zoomLevel: TIMELINE_DEFAULT_ZOOM_MINUTES') && appCode.includes("const zoomKey = timelineStorageKey('zoom_level')") && appCode.includes('AppState.zoomLevel = normalizeTimelineZoomLevel(savedZoom)') && appCode.includes('localStorage.removeItem(zoomKey)') && uiCode.includes('normalizeTimelineZoomLevel(AppState.zoomLevel || CONFIG.TIMELINE.CELL_MINUTES)'));
check('Tasks counts are category-aware', tasksCode.includes('const active = filterByCategory(allTasks.filter') && tasksCode.includes('taskEmptyState'));
check('Tasks expose a live assistant snapshot for board-aware guidance', tasksCode.includes('function getTasksAssistantSnapshot') && tasksCode.includes('window.TasksPage') && tasksCode.includes('getAssistantSnapshot: getTasksAssistantSnapshot') && assistantFoundationCode.includes('function getTaskPageSnapshot') && assistantFoundationCode.includes('TasksPage.getAssistantSnapshot') && assistantFoundationCode.includes('tasks.page.current_view'));
check('Leads, Customers, Omni expose clearable filter summaries', leadsCode.includes('resetLeadFilters') && customersCode.includes('resetCustomerFilters') && omniHtml.includes('resetOmniFilters'));
check('Dashboard work queue surfaces endpoint metadata', dashboardPageCode.includes('renderWorkQueueExplainability') && dashboardPageCode.includes('omittedBuckets'));
check('Dashboard renders compact funnel widget from work queue insights', dashboardPageCode.includes('funnel:') && dashboardPageCode.includes('loadFunnelWidget') && dashboardPageCode.includes('renderCompactFunnelWidget') && dashboardPageCode.includes('funnelInsights'));
check('Dashboard widgets append active CRM business scope', dashboardPageCode.includes('function dashboardScopedApiUrl') && dashboardPageCode.includes('CrmBusinessContext?.apiUrl') && dashboardPageCode.includes('function buildWidgetDataUrl(type)') && dashboardPageCode.includes('return dashboardScopedApiUrl(path)') && dashboardPageCode.includes('fetch(dashboardScopedApiUrl(`/api/work-queue?${params.toString()}`)') && dashboardPageCode.includes("fetch(dashboardScopedApiUrl('/api/dashboard/widgets/funnel')"));
const legacyHotLeadPathForGuard = ['/api/leads', 'hot'].join('/');
const legacyNewLeadPathForGuard = ['/api/leads', 'new-count'].join('/');
const rawLegacyLeadFetchTokens = [
    `fetch('${legacyHotLeadPathForGuard}'`,
    `fetch("${legacyHotLeadPathForGuard}"`,
    `fetch('${legacyNewLeadPathForGuard}'`,
    `fetch("${legacyNewLeadPathForGuard}"`
];
check('User-facing operational counters avoid raw legacy lead endpoint fetches', [sidebarCode, profileCode, dashboardPageCode, assistantFoundationCode, centerCode].every(code => rawLegacyLeadFetchTokens.every(token => !code.includes(token))) && !profileCode.includes(legacyNewLeadPathForGuard) && dashboardPageCode.includes('function dashboardScopedApiUrl') && dashboardPageCode.includes('fetch(dashboardScopedApiUrl(`/api/work-queue?${params.toString()}`)') && assistantFoundationCode.includes('fetch(assistantScopedApiUrl(path)') && centerCode.includes("fetch(centerScopedApiUrl('/api/leads/hot')"));

// Check unsafe dismiss guardrails for critical editable surfaces
console.log('\nunsafe dismiss guardrails');
const bookingCode = [
    fs.readFileSync(path.join(ROOT, 'js', 'booking-drawer-state.js'), 'utf8'),
    fs.readFileSync(path.join(ROOT, 'js', 'booking-banquet-selector.js'), 'utf8'),
    fs.readFileSync(path.join(ROOT, 'js', 'booking-save-path.js'), 'utf8'),
    fs.readFileSync(path.join(ROOT, 'js/booking.js'), 'utf8')
].join('\n');
const bookingDetailEditControlsStart = bookingCode.indexOf('const secondaryActionHtml = [');
const bookingDetailEditControlsEnd = bookingCode.indexOf('const bookingDetailIdLabel', bookingDetailEditControlsStart);
const bookingDetailEditControlsBlock = bookingDetailEditControlsStart >= 0 && bookingDetailEditControlsEnd > bookingDetailEditControlsStart
    ? bookingCode.slice(bookingDetailEditControlsStart, bookingDetailEditControlsEnd)
    : '';
const bookingDetailCompactFooterBlock = (bookingDetailEditControlsBlock.match(/<div class="booking-actions modal-footer-sticky booking-actions--compact">[\s\S]*?<\/div>/) || [''])[0];
const bookingDetailAdvancedActionsBlock = (bookingDetailEditControlsBlock.match(/<details class="booking-detail-advanced-actions">[\s\S]*?<\/details>/) || [''])[0];
const bookingDetailStandardStart = bookingCode.indexOf('const bookingDetailIdLabel', bookingCode.indexOf('async function showBookingDetails'));
const bookingDetailStandardEnd = bookingCode.indexOf('// v24.3.1: CRM', bookingDetailStandardStart);
const bookingDetailStandardBlock = bookingDetailStandardStart >= 0 && bookingDetailStandardEnd > bookingDetailStandardStart
    ? bookingCode.slice(bookingDetailStandardStart, bookingDetailStandardEnd)
    : '';
const bookingStatusActionStart = uiCode.indexOf('async function changeBookingStatus');
const bookingStatusActionEnd = uiCode.indexOf('// ==========================================', bookingStatusActionStart + 1);
const bookingStatusActionBlock = bookingStatusActionStart >= 0 && bookingStatusActionEnd > bookingStatusActionStart
    ? uiCode.slice(bookingStatusActionStart, bookingStatusActionEnd)
    : '';
function bookingDetailRowBlock(source, label) {
    const labelAt = source.indexOf(`<span class="label">${label}:</span>`);
    if (labelAt < 0) return '';
    const rowStart = source.lastIndexOf('<div class="booking-detail-row', labelAt);
    const rowEnd = source.indexOf('</div>', labelAt);
    if (rowStart < 0 || rowEnd < rowStart) return '';
    return source.slice(rowStart, rowEnd + '</div>'.length);
}
function bookingDetailRowHasNoCopyAffordance(source, label) {
    const row = bookingDetailRowBlock(source, label);
    return Boolean(row)
        && !row.includes('booking-detail-row--copyable')
        && !row.includes('data-copy=')
        && !row.includes('detail-copy-btn');
}
function bookingDetailDynamicLabelRowHasNoCopyAffordance(source, labelExpression) {
    const labelAt = source.indexOf(`<span class="label">${labelExpression}:</span>`);
    if (labelAt < 0) return false;
    const rowStart = source.lastIndexOf('<div class="booking-detail-row', labelAt);
    const rowEnd = source.indexOf('</div>', labelAt);
    if (rowStart < 0 || rowEnd < rowStart) return false;
    const row = source.slice(rowStart, rowEnd + '</div>'.length);
    return !row.includes('booking-detail-row--copyable')
        && !row.includes('data-copy=')
        && !row.includes('detail-copy-btn');
}
const bookingDetailLineDetailStart = bookingDetailStandardBlock.indexOf('const lineDetailHtml');
const bookingDetailLineDetailEnd = bookingDetailStandardBlock.indexOf('const hostsDetailHtml', bookingDetailLineDetailStart);
const bookingDetailLineDetailBlock = bookingDetailLineDetailStart >= 0 && bookingDetailLineDetailEnd > bookingDetailLineDetailStart
    ? bookingDetailStandardBlock.slice(bookingDetailLineDetailStart, bookingDetailLineDetailEnd)
    : '';
const bookingDetailLineRowHasNoCopyAffordance = bookingDetailLineDetailBlock.includes('<div class="booking-detail-row">')
    && bookingDetailLineDetailBlock.includes('${lineRoleLabel}:')
    && !bookingDetailLineDetailBlock.includes('booking-detail-row--copyable')
    && !bookingDetailLineDetailBlock.includes('data-copy=')
    && !bookingDetailLineDetailBlock.includes('detail-copy-btn');
const bookingDetailStatusBadgeRule = cssRuleText(globalModalsCss, '#bookingModal .booking-detail-row .status-badge');
const bookingDetailGroupRow = bookingDetailRowBlock(bookingDetailStandardBlock, 'Група');
const activityFirstBanquetDetailFixture = {
    booking: {
        id: 'BK-2026-0502',
        programId: 'mafia',
        programName: 'Мафія',
        label: 'Мафія(90)',
        category: 'show',
        duration: 90,
        date: '2026-06-24',
        time: '15:00',
        room: 'Диван 3',
        lineId: 'anim-zhenia',
        hosts: 2,
        secondAnimator: 'Андрій',
        extraData: {
            bookingWorkspace: { scenario: 'event' },
            timelineIdentity: {
                lineId: 'anim-zhenia',
                resourceId: 'anim-zhenia',
                resourceName: 'Женя'
            }
        }
    },
    animatorLines: [{ id: 'anim-zhenia', name: 'Женя' }],
    expected: {
        timeLabel: 'Час активності',
        timeValue: '15:00 - 16:30',
        animatorLabel: 'Аніматори',
        animatorValue: 'Женя + Андрій',
        scenarioValue: 'Мафія'
    }
};
const kitchenMenuImagesCode = fs.readFileSync(path.join(ROOT, 'js/kitchen-menu-images.js'), 'utf8');
const programsPageCode = fs.readFileSync(path.join(ROOT, 'js/programs-page.js'), 'utf8');
const programsHtml = fs.readFileSync(path.join(ROOT, 'programs.html'), 'utf8');
const programsCss = fs.readFileSync(path.join(ROOT, 'css/pages-products.css'), 'utf8');
const productsRoute = fs.readFileSync(path.join(ROOT, 'routes/products.js'), 'utf8');
const indexHtmlForBookingPanel = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const bookingPanelStart = indexHtmlForBookingPanel.indexOf('<aside id="bookingPanel"');
const bookingPanelEnd = indexHtmlForBookingPanel.indexOf('</aside>', bookingPanelStart);
const bookingPanelHtml = bookingPanelStart >= 0 && bookingPanelEnd > bookingPanelStart
    ? indexHtmlForBookingPanel.slice(bookingPanelStart, bookingPanelEnd + '</aside>'.length)
    : indexHtmlForBookingPanel;
const editBookingBlock = bookingCode.slice(bookingCode.indexOf('async function editBooking'), bookingCode.indexOf('// ==========================================\n// DUPLICATE BOOKING'));
const duplicateBookingBlock = bookingCode.slice(bookingCode.indexOf('async function duplicateBooking'), bookingCode.indexOf('// ==========================================\n// INVITE HELPERS'));
const telegramTemplatesCode = fs.readFileSync(path.join(ROOT, 'services/templates.js'), 'utf8');
const demoPageCode = fs.readFileSync(path.join(ROOT, 'js/demo-page.js'), 'utf8');
const timelineCss = fs.readFileSync(path.join(ROOT, 'css/timeline.css'), 'utf8');
const appCodeForDismiss = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
const configCode = fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8');
const financeCode = fs.readFileSync(path.join(ROOT, 'js/finance-page.js'), 'utf8');
const designsHtml = fs.readFileSync(path.join(ROOT, 'designs.html'), 'utf8');
const staffCode = fs.readFileSync(path.join(ROOT, 'js/staff-page.js'), 'utf8');
const hrCode = fs.readFileSync(path.join(ROOT, 'js/hr-page.js'), 'utf8');
const hrRouteCode = fs.readFileSync(path.join(ROOT, 'routes', 'hr.js'), 'utf8');
const hrPayrollPeriodServiceCode = fs.readFileSync(path.join(ROOT, 'services', 'hrPayrollPeriod.js'), 'utf8');
const staffRouteCode = fs.readFileSync(path.join(ROOT, 'routes', 'staff.js'), 'utf8');
const hrAttendanceServiceCode = fs.readFileSync(path.join(ROOT, 'services', 'hrAttendance.js'), 'utf8');
const hrHtmlForContracts = hrSurfaceText();
const hrImplicitButtons = [...`${hrHtmlForContracts}\n${hrCode}`.matchAll(/<button\b[^>]*>/g)]
    .filter(match => !/\btype\s*=/.test(match[0]));
const contentCode = fs.readFileSync(path.join(ROOT, 'js/content-page.js'), 'utf8');
const securityMiddlewareCode = fs.readFileSync(path.join(ROOT, 'middleware/security.js'), 'utf8');
const panelCss = fs.readFileSync(path.join(ROOT, 'css/panel.css'), 'utf8');
const bookingFormJs = fs.readFileSync(path.join(ROOT, 'js/booking-form.js'), 'utf8');
check('Booking lead conversion cleanup removes auto-open query hints', bookingCode.includes("url.searchParams.delete('leadId')") && bookingCode.includes("url.searchParams.delete('convert')") && bookingCode.includes("url.searchParams.delete('eventDate')") && bookingCode.includes("url.searchParams.delete('customerId')") && bookingCode.includes("url.searchParams.delete('customerName')") && bookingCode.includes("url.searchParams.delete('topic')") && bookingCode.includes("url.searchParams.delete('message')") && bookingCode.includes("url.searchParams.delete('page')"));
check('Booking room dropdown keeps same-day booked rooms selectable with day booking suffix',
    bookingCode.includes('function collectRoomDayBookingsForBookingDay')
    && bookingCode.includes('function renderBookingRoomOptionsForDay')
    && bookingCode.includes('function roomDayBookingSuffix')
    && bookingCode.includes('dayBookingsByRoom')
    && bookingCode.includes('Кімнати з підписом уже мають бронювання цього дня')
    && bookingCode.includes('function refreshBookingRoomAvailabilityForSelectedDate')
    && bookingCode.includes('await refreshBookingRoomAvailabilityForSelectedDate();')
    && bookingCode.includes("await refreshBookingRoomAvailabilityForSelectedDate({ selectedRoom: booking.room || '', excludeId: bookingId });")
    && bookingCode.includes('has-day-bookings')
    && bookingCode.includes('зайнята зараз')
    && !bookingCode.includes('return !occupiedRooms.has(value) || value === selectedRoom')
    && !bookingCode.includes('Ця кімната вже має бронювання на цей день'));
check('Room availability day bookings expose structured customer and banquet metadata',
    htmlContains('routes/settings.js', 'LEFT JOIN banquet_group_bookings bgb')
    && htmlContains('routes/settings.js', 'LEFT JOIN banquet_groups bg')
    && htmlContains('routes/settings.js', 'customerId: b.customer_id ?? null')
    && htmlContains('routes/settings.js', 'banquetGroupId: b.banquet_group_id || null')
    && htmlContains('routes/settings.js', 'banquetGroupRole: b.banquet_group_role || null')
    && htmlContains('routes/settings.js', 'isBanquetGroupMember: Boolean(b.banquet_group_id)')
    && htmlContains('routes/settings.js', 'isBanquetPrimary: Boolean(')
    && htmlContains('services/timelineResources.js', 'customerId: booking.customer_id ?? null')
    && htmlContains('services/timelineResources.js', 'banquetGroupId: booking.banquet_group_id || null')
    && htmlContains('services/timelineResources.js', 'banquetGroupRole: booking.banquet_group_role || null')
    && htmlContains('services/timelineResources.js', 'isBanquetGroupMember: Boolean(booking.banquet_group_id)')
    && htmlContains('services/timelineResources.js', 'isBanquetPrimary: Boolean('));
const bookingRoomSelectionContextBlock = bookingCode.slice(
    bookingCode.indexOf('function selectedRoomDayBookings'),
    bookingCode.indexOf('function clearSelectedCustomerLink')
);
check('Booking room selection auto-fills customer and preselects banquet context without creating groups',
    bookingCode.includes('const customerId = booking.customerId ?? booking.customer_id ?? null')
    && bookingCode.includes('const banquetGroupId = booking.banquetGroupId || booking.banquet_group_id || null')
    && bookingCode.includes('const banquetGroupPrimaryBookingId = booking.banquetGroupPrimaryBookingId || booking.banquet_group_primary_booking_id || null')
    && bookingCode.includes('customerId,')
    && bookingCode.includes('banquetGroupId,')
    && bookingCode.includes('function selectedRoomDayBookings')
    && bookingCode.includes('function pickRoomBanquetSourceBooking')
    && bookingCode.includes('function roomBookingHasBanquetContext')
    && bookingCode.includes('function sourceBookingToBanquetContext')
    && bookingCode.includes('async function handleBookingRoomSelectionContextChange')
    && bookingCode.includes('roomSelectionContextRequestToken')
    && bookingCode.includes('autoFilledCustomerFromRoom')
    && bookingCode.includes('autoFilledBanquetFromRoom')
    && bookingCode.includes('markBookingCustomerSelectionManual({ render: false })')
    && bookingCode.includes("document.getElementById('bookingBanquetGroupSelect')?.addEventListener('change'")
    && /async function handleBookingRoomSelectionContextChange[\s\S]*pickRoomBanquetSourceBooking[\s\S]*hydrateBookingCustomerSelection\(sourceBooking[\s\S]*resolveRoomSelectionBanquetContext[\s\S]*BookingDrawerState\.selectedBanquetGroupId = banquetContext\.groupId[\s\S]*refreshBookingBanquetGroupCandidates/.test(bookingCode)
    && /async function resolveRoomSelectionBanquetContext[\s\S]*apiGetBanquetByBooking\(sourceBookingId\)/.test(bookingCode)
    && /function selectedBookingBanquetGroupContext[\s\S]*roomSelectionBanquetContext[\s\S]*roomContext\?\.sourceBookingId/.test(bookingCode)
    && !/async function handleBookingRoomSelectionContextChange[\s\S]*apiCreateBanquetGroup/.test(bookingRoomSelectionContextBlock));
check('Booking room auto-linked banquet context is cleared safely on customer mismatch',
    bookingCode.includes("const ROOM_SELECTION_CUSTOMER_CHANGED_MESSAGE = 'Клієнта змінено, прив’язку до банкета з кімнати скинуто. Оберіть банкет вручну, якщо потрібно.'")
    && bookingCode.includes('manualBanquetGroupSelection')
    && bookingCode.includes('function selectedBookingBanquetGroupCustomerMismatch')
    && bookingCode.includes('function clearRoomSelectionBanquetContextAfterCustomerChange')
    && /function selectCustomerFromSearch[\s\S]*markBookingCustomerSelectionManual\(\{ render: false \}\)[\s\S]*clearSelectedBanquetGroupIfCustomerMismatch\(\)[\s\S]*ROOM_SELECTION_CUSTOMER_CHANGED_MESSAGE/.test(bookingCode)
    && /bookingBanquetGroupSelect'\)\?\.addEventListener\('change'[\s\S]*manualBanquetGroupSelection = Boolean\(BookingDrawerState\.selectedBanquetGroupId\)/.test(bookingCode)
    && bookingCode.includes("source: candidate ? 'booking_banquet_group_selector' : (virtualState?.bridge || (roomContext ? 'room_selection_auto_banquet_context' : 'booking_banquet_group_selector'))")
    && bookingCode.includes('isVirtualSourceBridge: Boolean(virtualState?.valid)')
    && /function resolveBookingCreatePath[\s\S]*selectedBookingBanquetGroupCustomerMismatch\(selectedBanquetContext\)[\s\S]*reason: 'customer_mismatch'/.test(bookingCode)
    && /if \(createPath\.blocked\)[\s\S]*showNotification\(createPath\.error/.test(bookingCode)
    && /attachBanquetGroupContextToBooking\(booking, selectedBanquetContext, 'kitchen', selectedBanquetContextSource\)/.test(bookingCode)
    && /attachBanquetGroupContextToBooking\(booking,[\s\S]*selectedBanquetContext,[\s\S]*sourceBookingId: bridgeSourceBookingId[\s\S]*'activity'/.test(bookingCode)
    && htmlContains('services/banquetGroups.js', 'function resolveAtomicBanquetCustomerId')
    && htmlContains('services/banquetGroups.js', "code: 'CUSTOMER_BANQUET_MISMATCH'"));
check('Booking panel header shows client and child count live context',
    htmlContains('index.html', 'selectedCustomerDisplay')
    && htmlContains('index.html', 'selectedChildDisplay')
    && htmlContains('index.html', 'selectedGuestsDisplay')
    && htmlContains('index.html', 'id="banquetAdults"')
    && htmlContains('index.html', 'Кількість дітей')
    && htmlContains('index.html', 'Кількість дорослих')
    && !htmlContains('index.html', '<label>Гостей</label>')
    && bookingCode.includes('function updateBookingContextHeaderSummary')
    && bookingCode.includes('function bookingContextGuestsText')
    && bookingCode.includes('function bookingKitchenChildrenCountFromBooking')
    && bookingCode.includes('const kitchenChildrenCount = formData.kitchenEnabled')
    && bookingCode.includes('kidsCount: kidsCount || kitchenChildrenCount || null')
    && bookingCode.includes('obj.banquetGuests = formData.kitchenEnabled ? kitchenChildrenCount : null')
    && timelineBanquetInspectorHelpersCode.includes('?? firstTimelineBanquetValue(sourceForCounts, booking => booking.banquetGuests ?? booking.banquet_guests)')
    && bookingCode.includes("document.getElementById('banquetGuests')?.value?.trim()")
    && bookingCode.includes("document.getElementById('banquetAdults')")
    && bookingCode.includes('banquetAdults')
    && bookingCode.includes("document.getElementById('kidsCountInput')?.value?.trim()")
    && bookingCode.includes("document.getElementById('bookingLeadChildrenInfo')?.value?.trim()")
    && bookingCode.includes('updateBookingContextHeaderSummary();')
    && panelCss.includes('.info-value')
    && panelCss.includes('text-overflow: ellipsis')
    && responsiveCss.includes('grid-template-columns: repeat(2, minmax(0, 1fr));'));
check('Booking detail modal has a wider stable card without hover reflow',
    htmlContains('index.html', 'modal-content booking-detail-modal-content')
    && bookingCode.includes('class="booking-detail-heading"')
    && bookingCode.includes('booking-detail-header--compact')
    && bookingCode.includes('bookingDetailIdLabel')
    && bookingCode.includes('booking-detail-meta')
    && bookingCode.includes('booking-detail-meta-item')
    && !bookingCode.includes('--booking-detail-header-bg')
    && !bookingCode.includes('generateBookingHeaderGradient')
    && !bookingCode.includes('getCategoryIcon')
    && !bookingCode.includes('booking-detail-icon')
    && globalModalsCss.includes('#bookingModal .booking-detail-modal-content')
    && globalModalsCss.includes('max-width: min(760px, calc(100vw - 40px))')
    && globalModalsCss.includes('#bookingModal .booking-detail-header .booking-detail-title')
    && globalModalsCss.includes('background: transparent !important')
    && globalModalsCss.includes('padding: 14px 60px 14px 18px')
    && globalModalsCss.includes('.booking-detail-meta')
    && globalModalsCss.includes('.booking-detail-meta-item')
    && !/\.booking-detail-header\s*\{[^}]*linear-gradient\(135deg,\s*var\(--primary\)/.test(globalModalsCss)
    && bookingCode.includes('if (bookingDetailIsActivityWithRoomContext(booking)) return false;')
    && bookingCode.includes('async function resolveBookingDetailAnimatorDisplay(booking = {})')
    && bookingCode.includes("getAnimatorLinesForBookingDate({ forceAnimatorView: true, fresh: false })")
    && bookingCode.includes('function bookingDetailIsRoomNameFallback(booking = {}, value = \'\')')
    && bookingCode.includes('if (!bookingDetailIsRoomNameFallback(booking, identityName))')
    && bookingCode.includes("names.join(' + ')")
    && bookingCode.includes("'Не вказано'")
    && bookingCode.includes("isActivityDetailBooking ? 'Аніматори' : 'Аніматор'")
    && bookingDetailLineDetailBlock.includes('${escapeHtml(lineDetailValue)}')
    && bookingDetailStandardBlock.includes('const hostsDetailHtml = roomFirstServiceBooking || isActivityDetailBooking ?')
    && bookingDetailStandardBlock.includes("const bookingDetailDateLabel = isBanquetArrivalMode ? 'Дата банкету' : 'Дата';")
    && bookingDetailStandardBlock.includes('const isActivityDetailMode = isActivityDetailBooking;')
    && bookingDetailStandardBlock.includes("const bookingDetailTimeLabel = isActivityDetailMode ? 'Час активності' : (isBanquetArrivalMode ? 'Прихід гостей' : 'Час');")
    && bookingDetailStandardBlock.includes("const bookingDetailTimeValue = isBanquetArrivalMode ? (booking.time || '-') : bookingDetailTimeRange;")
    && bookingDetailDynamicLabelRowHasNoCopyAffordance(bookingDetailStandardBlock, '${escapeHtml(bookingDetailDateLabel)}')
    && bookingDetailDynamicLabelRowHasNoCopyAffordance(bookingDetailStandardBlock, '${escapeHtml(bookingDetailTimeLabel)}')
    && bookingDetailLineRowHasNoCopyAffordance
    && bookingDetailRowHasNoCopyAffordance(bookingDetailStandardBlock, 'Ведучих')
    && bookingDetailRowHasNoCopyAffordance(bookingDetailStandardBlock, 'Сума')
    && !bookingDetailStandardBlock.includes('<span class="label">Ціна:</span>')
    && bookingDetailRowHasNoCopyAffordance(bookingCode, 'Сценарій')
    && bookingDetailRowHasNoCopyAffordance(bookingDetailStandardBlock, 'Статус')
    && bookingCode.includes('function renderBookingCommentDetailRow')
    && bookingDetailStandardBlock.includes('${renderBookingCommentDetailRow(booking)}')
    && Boolean(bookingDetailGroupRow)
    && bookingDetailGroupRow.includes('<span class="value">${escapeHtml(booking.groupName)}</span>')
    && !bookingDetailGroupRow.includes('🎪')
    && !bookingDetailStandardBlock.includes('booking-detail-row booking-detail-row--summary')
    && !bookingDetailStandardBlock.includes('detail-copy-summary-btn')
    && !bookingDetailStandardBlock.includes('Скопіювати всю інформацію')
    && !bookingDetailStandardBlock.includes('📋 Скопіювати все')
    && bookingCode.includes('function shouldHideBookingWorkspaceScenarioDetail(booking = {})')
    && bookingCode.includes("if (scenario === 'kitchen_only') return true;")
    && bookingCode.includes("if (programCode === 'KITCHEN') return true;")
    && bookingCode.includes("return programName === 'kitchen' || programName === 'кухня';")
    && bookingCode.includes('function bookingDetailModalTitle(booking = {}, fallback = \'Бронювання\')')
    && bookingCode.includes('if (shouldHideBookingWorkspaceScenarioDetail(booking))')
    && bookingCode.includes('[programName, label, booking.room, booking.id]')
    && bookingCode.includes('!bookingDetailIsKitchenTitleToken(value)')
    && bookingDetailStandardBlock.includes("const bookingDetailTitle = bookingDetailModalTitle(booking, roomFirstServiceBooking ? 'Кімнатна бронь' : 'Бронювання');")
    && !bookingDetailStandardBlock.includes("const bookingDetailTitle = [booking.label || booking.programCode, booking.programName]")
    && bookingCode.includes('const scenarioRowHtml = shouldHideBookingWorkspaceScenarioDetail(booking)')
    && bookingCode.includes('function bookingDetailActivityScenarioLabel(booking = {}, workspace = null)')
    && bookingCode.includes('function bookingDetailActivityProductScenarioLabel(booking = {})')
    && bookingCode.includes("quest: 'Квест'")
    && bookingCode.includes("animation: 'Анімація'")
    && bookingCode.includes("return explicitLabel || productLabel || categoryLabel || 'Активність';")
    && bookingCode.includes('const activityScenarioLabel = bookingDetailActivityScenarioLabel(booking, workspace);')
    && bookingCode.includes('const scenarioLabel = activityScenarioLabel || meta.label;')
    && bookingCode.includes('<span class="label">Сценарій:</span><span class="value">${escapeHtml(scenarioLabel)}</span>')
    && bookingCode.includes('${scenarioRowHtml}')
    && bookingCode.includes('customer-action-btn" title="Скопіювати імʼя"')
    && bookingCode.includes("navigator.clipboard.writeText('${escapeHtml(customer.phone)}')")
    && bookingCode.includes("navigator.clipboard.writeText('@${escapeHtml(igName)}')")
    && bookingDetailStatusBadgeRule.includes('justify-self: end')
    && bookingDetailStatusBadgeRule.includes('width: fit-content')
    && bookingDetailStatusBadgeRule.includes('max-width: 100%')
    && bookingCode.includes('const editControls = isViewer() ?')
    && bookingCode.includes('booking-actions modal-footer-sticky booking-actions--compact')
    && bookingCode.includes('booking-detail-action--primary btn-edit-booking')
    && bookingCode.includes('booking-detail-more-actions')
    && bookingCode.includes('booking-detail-danger-zone')
    && bookingCode.includes('booking-detail-danger-action')
    && !bookingCode.includes('class="btn-delete-booking">Видалити</button>')
    && globalModalsCss.includes('#bookingModal .booking-actions.modal-footer-sticky.booking-actions--compact')
    && globalModalsCss.includes('grid-template-columns: minmax(0, 1.08fr)')
    && globalModalsCss.includes('.booking-detail-more-actions__panel')
    && globalModalsCss.includes('.booking-detail-danger-zone')
    && panelCss.includes('.booking-detail-package-row > div')
    && panelCss.includes('overflow-wrap: anywhere'));
check('Activity-first banquet detail fixture keeps activity labels and values correct',
    activityFirstBanquetDetailFixture.booking.programId === 'mafia'
    && activityFirstBanquetDetailFixture.booking.programName === 'Мафія'
    && activityFirstBanquetDetailFixture.booking.duration === 90
    && activityFirstBanquetDetailFixture.booking.room === 'Диван 3'
    && activityFirstBanquetDetailFixture.booking.secondAnimator === 'Андрій'
    && activityFirstBanquetDetailFixture.expected.timeLabel === 'Час активності'
    && activityFirstBanquetDetailFixture.expected.animatorLabel === 'Аніматори'
    && activityFirstBanquetDetailFixture.expected.animatorValue === 'Женя + Андрій'
    && activityFirstBanquetDetailFixture.expected.scenarioValue === 'Мафія'
    && bookingCode.includes('if (bookingDetailIsActivityWithRoomContext(booking)) return false;')
    && bookingDetailStandardBlock.includes("const bookingDetailTimeLabel = isActivityDetailMode ? 'Час активності' : (isBanquetArrivalMode ? 'Прихід гостей' : 'Час');")
    && bookingDetailStandardBlock.includes('const bookingDetailTimeValue = isBanquetArrivalMode ? (booking.time || \'-\') : bookingDetailTimeRange;')
    && bookingCode.includes('const lineRoleLabel = isEducationBooking ? \'Кабінет\' : (isActivityDetailBooking ? \'Аніматори\' : \'Аніматор\');')
    && bookingDetailLineDetailBlock.includes('${escapeHtml(lineDetailValue)}')
    && bookingDetailStandardBlock.includes('const hostsDetailHtml = roomFirstServiceBooking || isActivityDetailBooking ?')
    && bookingCode.includes('bookingDetailPushUniqueName(names, primaryLine?.name || primaryLine?.shortName || primaryLine?.short_name);')
    && bookingCode.includes('const identityName = identity.resourceName || identity.resource_name || identity.lineName || identity.line_name;')
    && bookingCode.includes('if (!bookingDetailIsRoomNameFallback(booking, identityName))')
    && bookingCode.includes('bookingDetailPushUniqueName(names, bookingDetailSecondAnimatorName(booking));')
    && bookingCode.includes("names.join(' + ')")
    && bookingCode.includes('const activityScenarioLabel = bookingDetailActivityScenarioLabel(booking, workspace);')
    && bookingCode.includes('const scenarioLabel = activityScenarioLabel || meta.label;')
    && bookingCode.includes('bookingDetailScenarioText')
    && bookingCode.includes("return explicitLabel || productLabel || categoryLabel || 'Активність';")
    && bookingCode.includes('<span class="label">Сценарій:</span><span class="value">${escapeHtml(scenarioLabel)}</span>')
    && !bookingDetailStandardBlock.includes("const bookingDetailTimeLabel = isBanquetArrivalMode ? 'Прихід гостей' : 'Час';")
    && !bookingDetailStandardBlock.includes('<span class="value">${escapeHtml(String(booking.hosts))}</span>'));
check('Booking detail banquet package, comments, and invite controls stay compact and accurate',
    bookingCode.includes('booking-detail-package-entry-title')
    && bookingCode.includes('Загальна сума')
    && !bookingCode.includes('<div>Разом пакет</div>')
    && bookingCode.indexOf('${renderFullBanquetCommentsSection({ anchorBooking, primaryMembers, kitchenMembers, activityMembers, serviceManualMembers, members })}') < bookingCode.indexOf('${renderBanquetMenuSection(packageBooking)}')
    && panelCss.includes('.booking-detail-package-table-head > span:not(:first-child)')
    && panelCss.includes('.booking-detail-package-entry-title')
    && panelCss.includes('.booking-detail-package-entry-row small')
    && panelCss.includes('border-left: 1px solid var(--gray-100)')
    && timelineConstructorCss.includes('grid-template-columns: 96px minmax(0, 1fr)')
    && timelineConstructorCss.includes('font-size: 11px')
    && bookingCode.includes('const inviteShortText =')
    && bookingCode.includes('const inviteMessengerText =')
    && bookingCode.includes('const inviteInstagramText =')
    && bookingCode.includes('data-share-text="${escapeHtml(inviteMessengerText)}"')
    && bookingCode.includes('invite-section-eyebrow')
    && bookingCode.includes('invite-format-grid')
    && bookingCode.includes('data-text="${escapeHtml(inviteShortText)}"')
    && bookingCode.includes('Viber / Telegram')
    && bookingCode.includes('Instagram')
    && bookingCode.includes('btn-invite-link-copy')
    && bookingCode.includes('btn.dataset.text || btn.dataset.url')
    && bookingCode.includes('section?.dataset.shareText')
    && featuresCss.includes('.invite-section-top')
    && featuresCss.includes('.invite-section-eyebrow')
    && featuresCss.includes('.invite-format-grid')
    && darkModeCss.includes('body.dark-mode .invite-section-header { color: var(--gray-900); }')
    && !darkModeCss.includes('body.dark-mode .invite-section-header { color: var(--white); }')
    && darkModeCss.includes('body.dark-mode .invite-section-eyebrow'));
check('Booking status actions use narrow endpoints and edit_booking visibility',
    apiCode.includes('async function apiMarkBookingPreliminary(id, payload = {})')
    && apiCode.includes('/preliminary')
    && bookingStatusActionBlock.includes('apiConfirmBooking(bookingId, { source: \'booking_panel\' })')
    && bookingStatusActionBlock.includes('apiMarkBookingPreliminary(bookingId, { source: \'booking_panel\' })')
    && !bookingStatusActionBlock.includes('apiUpdateBooking')
    && bookingStatusActionBlock.includes('preliminaryResult?.error')
    && bookingCode.includes('function canEditTimelineBooking()')
    && bookingCode.includes("canAccess('edit_booking')")
    && bookingDetailStandardBlock.includes('${canEditTimelineBooking() ? `<div class="status-toggle-section">')
    && /async bulkStatus\(status\)[\s\S]*canEditTimelineBooking\(\)[\s\S]*apiConfirmBooking\(id, \{ source: 'booking_panel' \}\)[\s\S]*apiMarkBookingPreliminary\(id, \{ source: 'booking_panel' \}\)[\s\S]*async function _loadPinataStockBadge/.test(bookingCode));
check('Booking detail modal switches banquet root header from time range to schedule summary',
    bookingCode.includes('function bookingDetailHeaderPackageBooking(')
    && bookingCode.includes('function bookingDetailHeaderIsBanquetScheduleMode(')
    && bookingCode.includes('function bookingDetailHeaderScheduleSummary(')
    && bookingCode.includes('function bookingDetailIsBanquetArrivalMode(')
    && bookingCode.includes('const headerPackageBooking = bookingDetailHeaderPackageBooking(booking, banquetSnapshot)')
    && bookingCode.includes('const headerScheduleHtml = bookingDetailHeaderScheduleSummary(headerPackageBooking)')
    && bookingCode.includes('const useBanquetHeaderSchedule = Boolean(headerScheduleHtml.trim())')
    && bookingCode.includes('&& bookingDetailHeaderIsBanquetScheduleMode(booking, banquetSnapshot, fullBanquetDetailHtml)')
    && bookingCode.includes('const isBanquetArrivalMode = bookingDetailIsBanquetArrivalMode(booking, banquetSnapshot, fullBanquetDetailHtml)')
    && bookingCode.includes('const headerTimeMetaHtml = useBanquetHeaderSchedule')
    && bookingCode.includes('|| isBanquetArrivalMode')
    && bookingCode.includes('bookingDetailTimeRange')
    && bookingCode.includes('${headerTimeMetaHtml}')
    && bookingCode.includes('${useBanquetHeaderSchedule ? headerScheduleHtml : \'\'}')
    && bookingCode.includes('groupedBookingMenuPositions(bookingPackage.menuPositions || [])')
    && bookingCode.includes("event.type === 'food_service'")
    && bookingCode.includes('booking-detail-header-schedule')
    && bookingCode.includes('Видачі')
    && bookingCode.includes('Сервіс')
    && globalModalsCss.includes('.booking-detail-header-schedule')
    && globalModalsCss.includes('.booking-detail-header-schedule-item')
    && globalModalsCss.includes('.booking-detail-header-schedule-label')
    && globalModalsCss.includes('.booking-detail-header-schedule-value'));
check('Booking detail modal links to banquet summary preview with return URL',
    bookingCode.includes('function bookingSummaryPreviewUrl')
    && bookingCode.includes('/booking-summary.html?')
    && bookingCode.includes('businessContext')
    && bookingCode.includes('returnPath')
    && bookingCode.includes('booking-summary-action')
    && bookingCode.includes('Банкетний лист')
    && !bookingDetailEditControlsBlock.includes('booking-summary-action">Вижимка</a>'));
check('Booking detail modal keeps rare operational actions collapsed',
    bookingCode.includes('const timeShiftControlsHtml = `')
    && bookingCode.includes('const advancedActionsHtml = `')
    && bookingCode.includes('<details class="booking-detail-advanced-actions">')
    && !bookingCode.includes('booking-detail-advanced-actions" open')
    && bookingCode.includes('booking-detail-advanced-actions__summary')
    && bookingCode.includes('Показати додаткові операції бронювання')
    && bookingCode.includes('shiftBookingTime')
    && bookingCode.includes('${timeShiftControlsHtml}')
    && bookingCode.includes('${lineSwitchHtml}')
    && !bookingCode.includes('${lineSwitchHtml}\n        ${inviteSectionHtml}')
    && globalModalsCss.includes('.booking-detail-advanced-actions')
    && globalModalsCss.includes('.booking-detail-advanced-actions__summary:focus-visible')
    && globalModalsCss.includes('.booking-detail-advanced-actions .booking-time-shift')
    && globalModalsCss.includes('scroll-margin-bottom: 96px'));
check('Booking banquet modal UX regression guard keeps compact defaults',
    bookingDetailEditControlsBlock.includes('const secondaryActionHtml = [')
    && bookingDetailEditControlsBlock.includes('const moreActionsHtml = secondaryActionHtml ?')
    && bookingDetailEditControlsBlock.includes('const dangerZoneHtml = canDeleteTimelineBooking() ?')
    && bookingDetailCompactFooterBlock.includes('booking-detail-action--primary btn-edit-booking')
    && bookingDetailCompactFooterBlock.includes('booking-summary-action">Банкетний лист</a>')
    && !bookingDetailCompactFooterBlock.includes('Вижимка')
    && bookingDetailCompactFooterBlock.includes('${moreActionsHtml}')
    && !bookingDetailCompactFooterBlock.includes('duplicateBooking')
    && !bookingDetailCompactFooterBlock.includes('showRecurringModal')
    && !bookingDetailCompactFooterBlock.includes('openBookingChat')
    && !bookingDetailCompactFooterBlock.includes('deleteBooking')
    && bookingDetailEditControlsBlock.includes('booking-detail-action--more')
    && bookingDetailEditControlsBlock.includes('booking-detail-more-actions__panel')
    && bookingDetailEditControlsBlock.includes('class="booking-detail-secondary-action">Повторити</button>')
    && bookingDetailEditControlsBlock.includes('class="booking-detail-secondary-action">Повторюване</button>')
    && bookingDetailEditControlsBlock.includes('class="booking-detail-secondary-action">Чат команди</button>')
    && bookingDetailAdvancedActionsBlock.includes('booking-detail-advanced-actions__summary')
    && bookingDetailAdvancedActionsBlock.includes('${timeShiftControlsHtml}')
    && bookingDetailAdvancedActionsBlock.includes('${lineSwitchHtml}')
    && !bookingDetailAdvancedActionsBlock.includes(' open')
    && bookingDetailEditControlsBlock.indexOf('${dangerZoneHtml}') >= 0
    && bookingDetailEditControlsBlock.indexOf('<div class="booking-actions modal-footer-sticky booking-actions--compact">') > bookingDetailEditControlsBlock.indexOf('${dangerZoneHtml}')
    && bookingDetailEditControlsBlock.includes('booking-detail-danger-action">Видалити</button>')
    && !bookingDetailEditControlsBlock.includes('class="btn-delete-booking">Видалити</button>')
    && globalModalsCss.includes('#bookingModal .booking-actions.modal-footer-sticky.booking-actions--compact')
    && globalModalsCss.includes('.booking-detail-more-actions__panel')
    && globalModalsCss.includes('.booking-detail-danger-zone')
    && globalModalsCss.includes('.booking-detail-advanced-actions'));
check('Booking detail modal renders full banquet group details with controlled manual attach',
    bookingCode.includes('function renderFullBanquetDetail')
    && bookingCode.includes('apiGetBanquetByBooking(booking.id)')
    && bookingCode.includes('banquetSnapshotPrimaryBooking')
    && bookingCode.includes('function createBanquetGroupFromBookingDetails')
    && bookingCode.includes('function attachBookingToBanquetGroupFromDetails')
    && bookingCode.includes('apiAttachBanquetGroupBooking')
    && bookingCode.includes('bookingDetailIsRoot(target)')
    && bookingCode.includes('const fullBanquetDetailHtml = renderFullBanquetDetail(booking, bookings, banquetSnapshot)')
    && bookingCode.includes('booking-customer-block--priority')
    && bookingCode.includes('const priorityCustomerBlockHtml = hasBanquetOverview ? customerBlockHtml :')
    && bookingCode.includes('function bookingDetailHasMenuOverview')
    && bookingCode.includes('function bookingDetailCanOwnBanquetPackage')
    && bookingCode.includes('bookingDetailIsRoot(booking)')
    && bookingCode.includes('bookingDetailCanOwnBanquetPackage(booking)')
    && bookingCode.includes('if (!packageBooking || !bookingDetailHasMenuOverview(packageBooking)) return')
    && bookingCode.includes('includeServiceEvents: false')
    && bookingCode.includes("renderBanquetWorkSection('Банкет'")
    && bookingCode.includes('renderBanquetMenuSection(packageBooking)')
    && bookingCode.includes('renderBanquetServiceSection(packageBooking, serviceManualMembers)')
    && bookingCode.includes('function fullBanquetDetailCommentItems')
    && bookingCode.includes('function renderFullBanquetCommentsSection')
    && bookingCode.includes("renderBanquetWorkSection('Примітки'")
    && bookingCode.includes('renderFullBanquetCommentsSection({ anchorBooking, primaryMembers, kitchenMembers, activityMembers, serviceManualMembers, members })')
    && bookingCode.includes("add('kitchen', 'Кухня'")
    && bookingCode.includes("add('activity', `Активність —")
    && bookingCode.includes("add('internal', 'Внутрішній коментар'")
    && bookingCode.includes('renderBanquetActivitiesSection(activityMembers)')
    && bookingCode.includes('renderBanquetWarningsSection(warnings)')
    && bookingCode.includes('renderBanquetTechnicalSection({')
    && !bookingCode.includes('group-first')
    && !bookingCode.includes('Service / manual')
    && !bookingCode.includes('Кухня / меню не прив')
    && !bookingCode.includes('Технічні linked_to children')
    && bookingCode.includes('Кандидати підібрані тільки за тим самим бізнес-контекстом і датою')
    && timelineConstructorCss.includes('.booking-banquet-full-detail')
    && timelineConstructorCss.includes('.booking-banquet-section--work')
    && timelineConstructorCss.includes('.booking-banquet-service-row')
    && timelineConstructorCss.includes('.booking-banquet-comments')
    && timelineConstructorCss.includes('.booking-banquet-comment-row')
    && timelineConstructorCss.includes('.booking-banquet-technical')
    && timelineConstructorCss.includes('.booking-banquet-candidate-role')
    && timelineConstructorCss.includes('.booking-banquet-warning')
    && globalModalsCss.includes('.booking-customer-block--priority'));
check('Timeline booking links only an existing customer card',
    htmlContains('index.html', 'Знайдіть і виберіть існуючу картку клієнта перед збереженням бронювання.')
    && htmlContains('index.html', 'bookingNewCustomerForm" class="booking-new-customer-form hidden" hidden aria-hidden="true"')
    && !htmlContains('index.html', 'bookingCreateCustomerBtn')
    && bookingCode.includes("const nextMode = mode === 'new' ? 'search' : mode;")
    && bookingCode.includes('const hasClient = hasSelectedCustomer;')
    && bookingCode.includes("errors.push('Оберіть існуючого клієнта з пошуку.');")
    && bookingCode.includes('obj.customerId = parseInt(existingId);')
    && !bookingCode.includes('obj.customer =')
    && !bookingCode.includes("setBookingClientMode('new'")
    && !bookingCode.includes('bookingCreateCustomerBtn')
    && !bookingCode.includes('isValidNewBookingClient'));
check('Timeline booking workspace keeps default program-only mode and enables room-first banquet workspace explicitly',
    htmlContains('index.html', 'id="bookingHasEventToggle" checked hidden aria-hidden="true"')
    && htmlContains('index.html', 'id="bookingKitchenToggle" hidden aria-hidden="true"')
    && htmlContains('index.html', 'id="bookingLeadDetailsToggle" hidden aria-hidden="true"')
    && !bookingPanelHtml.includes('bookingModeSelector')
    && !bookingPanelHtml.includes('bookingScenarioBar')
    && !bookingPanelHtml.includes('Що входить у бронювання?')
    && bookingCode.includes('const BOOKING_PROGRAM_ONLY_WORKSPACE = true')
    && bookingCode.includes('if (isRoomFirstTimelineView()) return false;')
    && bookingCode.includes('return true;')
    && bookingCode.includes('return isRoomFirstTimelineView() && timelineKitchenEnabled();')
    && /function isBookingLeadDetailsEnabled\(\) \{\r?\n\s+return false;/.test(bookingCode)
    && bookingCode.includes("errors.push(isEducation ? 'Оберіть заняття або вкажіть тему.' : 'Оберіть програму події.');")
    && bookingCode.includes("mode: formData.kitchenEnabled || !formData.hasEvent ? 'room_first_workspace' : (BOOKING_PROGRAM_ONLY_WORKSPACE ? 'event_program_only' : 'workspace')")
    && bookingCode.includes('const kitchenEnabled = roomFirst && timelineKitchenEnabled();')
    && bookingCode.includes('eventFields.hidden = roomFirst;')
    && bookingCode.includes('prefillRoomFirstCustomerFromRoomLine(line.name, time)')
    && bookingCode.includes('shouldEditBookingInAnimatorView')
    && bookingCode.includes('canAddAnimationFromRoomBooking')
    && bookingCode.includes('Додати активну програму')
    && !bookingCode.includes('function getBookingScenarioContentState')
    && !bookingCode.includes("bookingHasEventToggle')?.addEventListener('change'")
    && !bookingCode.includes("bookingKitchenToggle')?.addEventListener('change'")
    && !bookingCode.includes("bookingLeadDetailsToggle')?.addEventListener('change'"));
check('Booking kitchen menu uses searchable catalog controls instead of the long native select as the primary UI',
    htmlContains('index.html', 'bookingMenuCatalogOpenBtn')
    && htmlContains('index.html', 'booking-menu-catalog-panel booking-menu-catalog-overlay hidden')
    && htmlContains('index.html', 'role="dialog" aria-modal="true"')
    && !bookingPanelHtml.includes('bookingMenuCatalogPanel')
    && htmlContains('index.html', 'bookingMenuCatalogSearch')
    && htmlContains('index.html', 'bookingMenuCatalogTabs')
    && htmlContains('index.html', 'bookingMenuCatalogList')
    && htmlContains('index.html', 'bookingMenuCatalogCart')
    && htmlContains('index.html', 'bookingMenuCatalogCartList')
    && htmlContains('index.html', 'bookingMenuInsightPanel')
    && htmlContains('index.html', 'bookingMenuInsightTitle')
    && htmlContains('index.html', 'bookingMenuInsightBody')
    && htmlContains('index.html', 'bookingMenuCatalogMobileCartBtn')
    && htmlContains('index.html', `js/kitchen-menu-images.js?v=${pkg.version}`)
    && indexHtmlForBookingPanel.indexOf('js/kitchen-menu-images.js') < indexHtmlForBookingPanel.indexOf('js/config.js')
    && htmlContains('index.html', 'booking-menu-legacy-controls hidden')
    && kitchenMenuImagesCode.includes('window.KITCHEN_MENU_IMAGES')
    && kitchenMenuImagesCode.includes("basePath: '/images/kitchen-menu/'")
    && kitchenMenuImagesCode.includes('"menu_2026_021_item": "products/menu-998.png"')
    && kitchenMenuImagesCode.includes('"menu_2026_026_item": "products/menu-999.png"')
    && kitchenMenuImagesCode.includes('"menu_2026_064_item": "products/menu-997.png"')
    && kitchenMenuImagesCode.includes('"menu_2026_073_item": "products/menu-999.png"')
    && kitchenMenuImagesCode.includes('"MENU-026": "products/menu-026.jpg"')
    && kitchenMenuImagesCode.includes('"CAKE-06": "products/cake-06.jpg"')
    && bookingCode.includes('function renderBookingMenuCatalog')
    && bookingCode.includes('function renderBookingMenuCatalogCart')
    && bookingCode.includes('function bookingMenuProductEmoji')
    && bookingCode.includes('function bookingMenuCatalogVisualHtml')
    && bookingCode.includes('function bookingMenuImageManifestUrl')
    && bookingCode.includes('window.KITCHEN_MENU_IMAGES')
    && bookingCode.includes('bookingMenuCatalogHandleImageError')
    && bookingCode.includes('function setBookingMenuCatalogCartOpen')
    && bookingCode.includes('function isBookingMenuCatalogMobileCartLayout')
    && bookingCode.includes('preferCart')
    && bookingCode.includes('function upsertBookingMenuCatalogProduct')
    && bookingCode.includes('function setBookingMenuCatalogOpen')
    && bookingCode.includes('BOOKING_MENU_CATALOG_FOOD_SECTION_FILTERS')
    && bookingCode.includes("section:pizza")
    && bookingCode.includes('До піци')
    && bookingCode.includes('Холодні закуски')
    && bookingCode.includes('Холодні напої')
    && !bookingCode.includes("key: 'food'")
    && !bookingCode.includes("key: 'drink'")
    && bookingCode.includes('data-menu-catalog-quantity-input')
    && bookingCode.includes('data-menu-catalog-price-input')
    && bookingCode.includes('data-menu-catalog-note-input')
    && bookingCode.includes('BOOKING_MENU_CATALOG_INSIGHT_MODES')
    && bookingCode.includes('BOOKING_MENU_CATALOG_ADMIN_REVIEW_ACTIONS_ENABLED = false')
    && bookingCode.includes('data-menu-catalog-insight')
    && bookingCode.includes('function bookingMenuCatalogPromptFor')
    && bookingCode.includes('function renderBookingMenuCatalogInsight')
    && bookingCode.includes('function generateBookingMenuCatalogInsightDraft')
    && bookingCode.includes('function saveBookingMenuCatalogInsightDraft')
    && bookingCode.includes('function approveBookingMenuCatalogInsightPrompt')
    && bookingCode.includes('apiGenerateProductMenuAiDraft')
    && bookingCode.includes('apiSaveProductMenuAiDraft')
    && bookingCode.includes('data-menu-insight-generate')
    && bookingCode.includes('data-menu-insight-save')
    && bookingCode.includes('function nudgeBookingMenuCatalogInsightCard')
    && bookingCode.includes('BookingPackageState.catalogInsightNudgeTimer')
    && bookingCode.includes('function commitBookingMenuCatalogInlineInput')
    && bookingCode.includes("document.body?.classList.toggle('booking-menu-catalog-active', nextOpen)")
    && bookingCode.includes("document.getElementById('bookingMenuCatalogPanel')?.addEventListener('click'")
    && bookingCode.includes("document.getElementById('bookingMenuCatalogPanel')?.addEventListener('change'")
    && bookingCode.includes("document.getElementById('bookingMenuCatalogPanel')?.addEventListener('keydown'")
    && bookingCode.includes("document.getElementById('bookingMenuCatalogMobileCartBtn')?.addEventListener('click'")
    && bookingCode.includes("document.getElementById('bookingMenuCatalogCartCloseBtn')?.addEventListener('click'")
    && bookingCode.includes("cart.setAttribute('inert'")
    && bookingCode.includes("window.addEventListener('resize'")
    && bookingCode.includes("event.key !== 'Escape'")
    && bookingCode.includes('Завантажую меню')
    && bookingCode.includes('Меню ще не налаштоване')
    && bookingCode.includes('Очистити пошук')
    && bookingCode.includes("document.getElementById('bookingMenuCatalogSearch')?.addEventListener('input'")
    && panelCss.includes('.booking-menu-catalog-panel')
    && panelCss.includes('body.booking-menu-catalog-active')
    && panelCss.includes('position: fixed')
    && panelCss.includes('inset: 0')
    && panelCss.includes('grid-template-rows: auto minmax(0, 1fr) auto')
    && panelCss.includes('grid-template-columns: minmax(0, 1fr) minmax(280px, 330px)')
    && panelCss.includes('.booking-menu-catalog-panel > .booking-menu-catalog-header')
    && panelCss.includes('.booking-menu-catalog-panel > .booking-menu-catalog-body')
    && panelCss.includes('.booking-menu-catalog-panel > .booking-menu-catalog-footer')
    && panelCss.includes('.booking-menu-catalog-browser,')
    && panelCss.includes('.booking-menu-catalog-cart {')
    && panelCss.includes('contain: paint')
    && panelCss.includes('isolation: isolate')
    && panelCss.includes('transform: translateZ(0)')
    && panelCss.includes('.booking-menu-catalog-search,')
    && panelCss.includes('grid-template-columns: repeat(auto-fill, minmax(224px, 1fr))')
    && panelCss.includes('.booking-menu-catalog-list > *')
    && panelCss.includes('z-index: 3')
    && panelCss.includes('justify-content: start')
    && panelCss.includes('display: flex')
    && panelCss.includes('flex-direction: column')
    && panelCss.includes('overflow: hidden')
    && panelCss.includes('padding: 0 10px calc(96px + env(safe-area-inset-bottom, 0px))')
    && panelCss.includes('scroll-padding-top: 48px')
    && panelCss.includes('min-height: 252px')
    && panelCss.includes('.booking-menu-catalog-item:hover')
    && panelCss.includes('transform: translate3d(0, -2px, 0)')
    && panelCss.includes('@media (prefers-reduced-motion: reduce)')
    && panelCss.includes('height: auto')
    && panelCss.includes('aspect-ratio: 3.35 / 1')
    && panelCss.includes('min-height: 32px')
    && panelCss.includes('width: 100%')
    && panelCss.includes('grid-template-columns: 32px minmax(44px, 1fr) 32px 32px 32px')
    && panelCss.includes('@media (max-height: 820px), (max-width: 1440px)')
    && panelCss.includes('grid-template-columns: minmax(0, 1fr) minmax(260px, 300px)')
    && panelCss.includes('grid-template-columns: repeat(auto-fill, minmax(216px, 1fr))')
    && panelCss.includes('padding: 0 8px calc(82px + env(safe-area-inset-bottom, 0px))')
    && panelCss.includes('min-height: 236px')
    && panelCss.includes('aspect-ratio: 3.6 / 1')
    && panelCss.includes('margin-top: 0')
    && bookingCode.indexOf('bookingMenuCatalogVisualHtml(product, title)') < bookingCode.indexOf('booking-menu-catalog-stepper')
    && bookingCode.indexOf('booking-menu-catalog-stepper') < bookingCode.indexOf('booking-menu-catalog-main')
    && panelCss.includes('.booking-menu-catalog-cart')
    && panelCss.includes('.booking-menu-catalog-mobile-cart')
    && panelCss.includes('.booking-menu-catalog-thumb')
    && panelCss.includes('.booking-menu-catalog-thumb--cart')
    && panelCss.includes('.booking-menu-catalog-thumb img')
    && panelCss.includes('.booking-menu-catalog-thumb.uses-fallback-image img')
    && panelCss.includes('.booking-menu-catalog-thumb.has-image span')
    && panelCss.includes('.booking-menu-catalog-thumb.is-image-missing img')
    && bookingCode.includes("BOOKING_MENU_CATALOG_FALLBACK_IMAGE = '/images/kitchen-menu/fallback-burger-wide.jpg'")
    && bookingCode.includes('data-menu-catalog-fallback')
    && panelCss.includes('.booking-menu-catalog-cart-open .booking-menu-catalog-cart')
    && panelCss.includes('.booking-menu-catalog-panel::after')
    && panelCss.includes('.booking-menu-catalog-tabs')
    && panelCss.includes('overflow-x: visible')
    && panelCss.includes('flex-wrap: wrap')
    && panelCss.includes('.booking-menu-catalog-stepper')
    && panelCss.includes('.booking-menu-catalog-actions')
    && panelCss.includes('.booking-menu-catalog-action--allergens')
    && panelCss.includes('.booking-menu-insight-panel')
    && panelCss.includes('.booking-menu-insight-prompt')
    && panelCss.includes('.booking-menu-insight-result')
    && panelCss.includes('.booking-menu-insight-status.success')
    && panelCss.includes('bookingMenuInsightCardIn')
    && panelCss.includes('bookingMenuInsightNudge')
    && panelCss.includes('.booking-menu-insight-card.is-nudged')
    && panelCss.includes('.booking-menu-catalog-group-heading')
    && panelCss.includes('.booking-menu-catalog-group-heading::before')
    && panelCss.includes('inset: 0 -100vw 0 0')
    && panelCss.includes('.booking-menu-catalog-item.selected')
    && panelCss.includes('.booking-menu-catalog-inline-input')
    && panelCss.includes('@media (max-width: 900px)'));
check('Booking kitchen catalog keeps the aggregate total only in the footer',
    htmlContains('index.html', '<small id="bookingMenuCatalogSummary">0 позицій</small>')
    && htmlContains('index.html', '<small id="bookingMenuCatalogCartSummary">0 позицій</small>')
    && !htmlContains('index.html', '<small id="bookingMenuCatalogSummary">0 позицій · 0 ₴</small>')
    && !htmlContains('index.html', '<small id="bookingMenuCatalogCartSummary">0 позицій · 0 ₴</small>')
    && bookingCode.includes('if (inline) inline.textContent = summary.combined')
    && bookingCode.includes('if (header) header.textContent = summary.countText')
    && bookingCode.includes('if (cartSummary) cartSummary.textContent = summary.countText')
    && bookingCode.includes('if (footerTotal) footerTotal.textContent = summary.subtotalText')
    && bookingCode.includes('if (mobileCart) mobileCart.textContent = `Вибрано · ${summary.countText}`')
    && !bookingCode.includes('if (header) header.textContent = summary.combined')
    && !bookingCode.includes('if (cartSummary) cartSummary.textContent = summary.combined')
    && !bookingCode.includes('if (mobileCart) mobileCart.textContent = `Вибрано · ${summary.subtotalText}`'));
check('Booking kitchen catalog footer presents the only total as a right-aligned primary summary',
    htmlContains('index.html', 'booking-menu-catalog-footer-count')
    && htmlContains('index.html', 'booking-menu-catalog-footer-total" aria-live="polite"')
    && htmlContains('index.html', '<span>Разом</span>')
    && panelCss.includes('.booking-menu-catalog-footer-total')
    && panelCss.includes('grid-template-columns: minmax(0, 1fr) auto auto auto')
    && panelCss.includes('justify-content: flex-end')
    && panelCss.includes('font-size: 22px')
    && panelCss.includes('font-weight: 1000')
    && panelCss.includes('grid-template-areas:')
    && panelCss.includes('"count done"')
    && panelCss.includes('"total done"')
    && panelCss.includes('"cart cart"')
    && panelCss.includes('grid-area: total'));
check('Booking panel notes section omits noisy base-request helper copy',
    !bookingPanelHtml.includes('Базова заявка')
    && !bookingPanelHtml.includes('Коротка тема і примітки оператора без зайвого шуму.'));
const roomBookingAnimationBridgeBlock = bookingCode.slice(
    bookingCode.indexOf('async function openRoomBookingAnimationBridge'),
    bookingCode.indexOf('// v43.5.0: Reveal a booking', bookingCode.indexOf('async function openRoomBookingAnimationBridge'))
);
check('Booking comments use workspace contract instead of legacy notes for new Park kitchen/activity bookings',
    bookingPanelHtml.includes('id="bookingNotesSection"')
    && bookingPanelHtml.includes('id="bookingGroupNameSection"')
    && bookingCode.includes('function syncParkBookingGroupNameVisibility')
    && bookingCode.includes('section.hidden = hidden')
    && bookingCode.includes('commentType')
    && bookingCode.includes('bookingComments: buildBookingWorkspaceComments(commentType, bookingComment)')
    && bookingCode.includes('comments: normalizeBookingWorkspaceComments(formData.bookingComments || {})')
    && bookingCode.includes('const shouldPersistLegacyNotes = !isParkTimelineBookingMode()')
    && bookingCode.includes('notes: shouldPersistLegacyNotes ? rawBookingComment : null')
    && bookingCode.includes('groupName: shouldPersistLegacyGroupName ?')
    && bookingCode.includes('BookingDrawerState.legacyNotesFallback')
    && !bookingCode.includes('groupName: sourceBooking.groupName')
    && !bookingCode.includes('sourceBooking.notes')
    && roomBookingAnimationBridgeBlock
    && !roomBookingAnimationBridgeBlock.includes('sourceBooking.notes')
    && !roomBookingAnimationBridgeBlock.includes('sourceBooking.groupName')
    && /function buildMultiActivityBookingFromProgram[\s\S]*notes: null,[\s\S]*groupName: null,[\s\S]*function buildMultiActivityBookings/.test(bookingCode)
    && /async function openRoomBookingAnimationBridge[\s\S]*BookingDrawerState\.roomBookingAnimationBridge = \{[\s\S]*groupId: existingGroupId \|\| sourceBooking\.banquetGroupId \|\| sourceBooking\.banquet_group_id \|\| null,[\s\S]*sourceBookingId: sourceBooking\.id[\s\S]*function revealHiddenBooking/.test(bookingCode)
    && /attachBanquetGroupContextToBooking\(booking,[\s\S]*bridgeGroupId[\s\S]*bridgeSourceBookingId[\s\S]*'room_booking_animation_bridge'/.test(bookingCode));
check('Booking banquet selector loads same-customer groups and routes selected kitchen/activity atomically',
    bookingPanelHtml.includes('id="bookingBanquetGroupSection"')
    && bookingPanelHtml.includes('id="bookingBanquetGroupSelect"')
    && bookingPanelHtml.includes('Прив’язати до банкету')
    && bookingPanelHtml.includes('Без прив’язки')
    && bookingCode.includes('function refreshBookingBanquetGroupCandidates')
    && /function bookingBanquetGroupCandidatesRefreshKey\(\{ date = '', customerId = '' \} = \{\}\)[\s\S]*date:[\s\S]*customerId:[\s\S]*\.\.\.bookingBanquetSelectorSourceMeta\(\)/.test(bookingCode)
    && /apiGetBanquetCandidates\(\{[\s\S]*date,[\s\S]*customerId,[\s\S]*room: sourceMeta\.room,[\s\S]*sourceBookingId: sourceMeta\.sourceBookingId,[\s\S]*drawerMode: sourceMeta\.drawerMode,[\s\S]*contextGeneration: sourceMeta\.contextGeneration/.test(bookingCode)
    && bookingCode.includes('function selectedBookingBanquetGroupContext')
    && bookingCode.includes('preselectGroupId: BookingDrawerState.roomBookingAnimationBridge.groupId ||')
    && bookingCode.includes('function isSelectedBanquetKitchenCreate')
    && bookingCode.includes('function isSelectedBanquetActivityCreate')
    && bookingCode.includes('function validateKitchenFirstActivityBridge')
    && bookingCode.includes('function resolveBookingCreatePath')
    && bookingCode.includes("case 'existing_group_member'")
    && bookingCode.includes("case 'existing_group_activity'")
    && bookingCode.includes("case 'source_activity_to_kitchen'")
    && bookingCode.includes("case 'source_kitchen_to_activity'")
    && bookingCode.includes('apiCreateBanquetMemberBooking(createPath.groupId')
    && bookingCode.includes('apiCreateBanquetActivityBooking(bridgeGroupId')
    && bookingCode.includes('apiCreateBanquetActivityBookingFromSource')
    && /if \(createPath\.blocked\)[\s\S]*unlockSubmitBtn\(\);[\s\S]*return;/.test(bookingCode)
    && /else if \(createPath\.kind === 'existing_group_member'\)[\s\S]*apiCreateBanquetMemberBooking\(createPath\.groupId/.test(bookingCode)
    && /else \{[\s\S]*const finalCreatePath = resolveBookingCreatePath[\s\S]*apiCreateBooking\(booking\)/.test(bookingCode)
    && apiCode.includes('function apiFailureFromBody')
    && apiCode.includes('function apiGetBanquetCandidates')
    && apiCode.includes('/banquets/candidates')
    && apiCode.includes('function apiCreateBanquetMemberBooking')
    && apiCode.includes('/member-booking')
    && /async function apiCreateBooking[\s\S]*apiFailureFromBody\(body, response\)[\s\S]*async function apiCreateEducationLessonSeries/.test(apiCode)
    && /async function apiCreateBookingFull[\s\S]*apiFailureFromBody\(body, response\)[\s\S]*async function apiGetBanquetByBooking/.test(apiCode)
    && /async function apiCreateBanquetMemberBooking[\s\S]*apiFailureFromBody\(body, response\)[\s\S]*async function apiCreateBanquetActivityBooking/.test(apiCode)
    && /async function apiCreateBanquetActivityBooking[\s\S]*apiFailureFromBody\(body, response\)[\s\S]*async function apiCreateBanquetActivityBookingFromSource/.test(apiCode)
    && /async function apiCreateBanquetActivityBookingFromSource[\s\S]*apiFailureFromBody\(body, response\)[\s\S]*async function apiAttachBanquetGroupBooking/.test(apiCode)
    && apiCode.includes('/banquets/from-source/activity-booking'));
check('Booking kitchen menu supports serving times and banquet service events without schema changes',
    bookingCode.includes('servingTime')
    && bookingCode.includes('servingNote')
    && bookingCode.includes('servingGroupId')
    && bookingCode.includes('serviceEvents: formData.serviceEvents || []')
    && bookingCode.includes('data-menu-serving-time')
    && bookingCode.includes('data-menu-serving-apply-selected')
    && bookingCode.includes('data-menu-serving-copy-all')
    && bookingCode.includes('data-menu-service-event-add')
    && bookingCode.includes("BOOKING_CREATE_PAST_VALIDATION_TIME_ZONE = 'Europe/Kyiv'")
    && bookingCode.includes('function bookingCreatePastValidationError')
    && bookingCode.includes('function bookingCreateTimeCandidates')
    && bookingCode.includes('bookingCreateOperationalTimeCandidates')
    && bookingCode.includes('shouldUseKitchenOperationalCreateTime')
    && bookingCode.includes('BOOKING_SERVICE_EVENT_CREATE_TYPES')
    && bookingCode.includes("['food_service', 'drinks', 'room_setup', 'custom']")
    && bookingCode.includes('Час видачі позицій')
    && bookingCode.includes('Базовий час')
    && bookingCode.includes('Видати о')
    && bookingCode.includes('Додати подію')
    && !bookingCode.includes('<option value="cake">Винос торта</option>')
    && bookingCode.includes('Не вказано час видачі')
    && bookingCode.includes('function groupedBookingMenuPositions')
    && bookingCode.includes('booking-detail-package-serving-group')
    && bookingCode.includes('booking-detail-package-table')
    && bookingCode.includes('booking-detail-package-table-row')
    && bookingCode.includes('booking-detail-package-service-row')
    && bookingCode.includes('booking-banquet-service-row--checklist')
    && !bookingCode.includes("<strong>${escapeHtml(BOOKING_SERVICE_EVENT_TYPES[event.type] || 'Подія')}</strong>")
    && bookingCode.includes('Час видачі не вказано')
    && htmlContains('index.html', 'Страви й торти додаються з каталогу')
    && htmlContains('services/bookingPackage.js', 'BOOKING_PACKAGE_SCHEMA_VERSION = 2')
    && htmlContains('services/bookingPackage.js', 'normalizeServiceEvents')
    && htmlContains('services/banquetSummary.js', 'serving_time_missing')
    && htmlContains('services/banquetSummary.js', 'serviceEvents: serviceEventRows')
    && htmlContains('js/booking-summary-page.js', 'orderRowComment')
    && htmlContains('js/booking-summary-page.js', 'summaryServiceEventRows')
    && htmlContains('js/booking-summary-page.js', 'Події видачі')
    && htmlContains('js/booking-summary-page.js', 'Видача')
    && panelCss.includes('.booking-menu-serving-toolbar')
    && panelCss.includes('.booking-menu-serving-block')
    && panelCss.includes('.booking-menu-serving-action--primary')
    && panelCss.includes('.booking-menu-service-event-field')
    && panelCss.includes('.booking-menu-serving-picker')
    && panelCss.includes('.booking-menu-service-event')
    && panelCss.includes('.booking-menu-serving-warning')
    && panelCss.includes('.booking-detail-package-serving-group')
    && panelCss.includes('.booking-detail-package-table')
    && panelCss.includes('.booking-detail-package-table-row')
    && panelCss.includes('.booking-detail-package-service-row')
    && panelCss.includes('.booking-detail-package-total')
    && timelineConstructorCss.includes('.booking-banquet-service-row--checklist')
    && htmlContains('css/booking-summary.css', '.summary-service-events')
    && htmlContains('css/booking-summary.css', '.summary-order-table .serving'));
check('Booking menu quantity wording separates portion count from packed serving unit',
    bookingCode.includes('function normalizeBookingMenuServingUnitDisplay')
    && bookingCode.includes('function formatBookingMenuQuantityWithServingUnit')
    && bookingCode.includes('function formatBookingMenuPositionQuantity')
    && bookingCode.includes('по ${unit}')
    && bookingCode.includes('formatBookingMenuPositionQuantity(item))} × ${escapeHtml(formatPrice(item.unitPrice))}')
    && bookingCode.includes('<span role="cell">${escapeHtml(formatBookingMenuPositionQuantity(item))}</span>')
    && bookingCode.includes('const price = item.unitPrice ? ` × ${item.unitPrice} грн` :')
    && bookingCode.includes("const unit = normalizeBookingMenuServingUnitDisplay(product.servingUnit || product.priceUnit || '')")
    && bookingCode.includes('const cartQuantityLabel = formatBookingMenuPositionQuantity(item)')
    && bookingCode.includes('${cartQuantityLabel ? ` · ${escapeHtml(cartQuantityLabel)}` : \'\'}')
    && htmlContains('services/bookingPackage.js', 'function normalizeMenuServingUnitDisplay')
    && htmlContains('services/bookingPackage.js', 'function formatMenuQuantityWithServingUnit')
    && htmlContains('services/bookingPackage.js', 'function formatMenuPositionQuantity')
    && htmlContains('services/bookingPackage.js', 'formatMenuPositionQuantity(item)')
    && htmlContains('services/bookingPackage.js', 'const price = item.unitPrice ? ` × ${item.unitPrice} грн` :')
    && !bookingCode.includes('${escapeHtml(String(item.quantity))}${item.servingUnit')
    && !htmlContains('services/bookingPackage.js', '${qty}${item.servingUnit'));
check('Booking menu serving toolbar wraps responsively inside narrow booking panels',
    bookingCode.includes('data-menu-serving-time')
    && bookingCode.includes('data-menu-serving-apply-selected')
    && bookingCode.includes('data-menu-serving-copy-all')
    && bookingCode.includes('data-menu-service-event-add')
    && panelCss.includes('.booking-menu-serving-toolbar')
    && panelCss.includes('grid-template-columns: minmax(0, 1.08fr) minmax(230px, 0.92fr);')
    && panelCss.includes('.booking-menu-serving-block--bulk')
    && panelCss.includes('.booking-menu-serving-block--event')
    && panelCss.includes('.booking-menu-serving-actions')
    && panelCss.includes('container-type: inline-size;')
    && panelCss.includes('@container (max-width: 520px)')
    && panelCss.includes('.booking-menu-position-row > div:first-child')
    && panelCss.includes('grid-column: 1 / -1;')
    && panelCss.includes('.booking-menu-serving-picker')
    && panelCss.includes('flex-wrap: wrap;')
    && panelCss.includes('white-space: normal;')
    && !panelCss.includes('grid-template-columns: minmax(110px, 0.8fr) repeat(2, minmax(120px, 1fr)) minmax(110px, 0.7fr) minmax(92px, 0.6fr) auto;'));
check('Products menu tab owns menu-card images, AI review entrypoints, and image prompt drafts',
    programsHtml.includes(`js/kitchen-menu-images.js?v=${pkg.version}`)
    && programsHtml.includes(`css/pages-products.css?v=${pkg.version}`)
    && programsCss.includes('.kitchen-product-media')
    && programsCss.includes('.kitchen-menu-image-studio')
    && programsCss.includes('.kitchen-menu-image-status.ready')
    && programsCss.includes('.kitchen-menu-image-meta')
    && programsCss.includes('.kitchen-menu-ai-actions')
    && programsPageCode.includes('function productMenuImageManifestUrl')
    && programsPageCode.includes('window.KITCHEN_MENU_IMAGES')
    && programsPageCode.includes('function renderKitchenCardVisual')
    && programsPageCode.includes('function renderKitchenMenuAiActions')
    && programsPageCode.includes('function renderKitchenMenuImageStudio')
    && programsPageCode.includes('function generateKitchenMenuImage')
    && programsPageCode.includes('function saveKitchenMenuImageDraft')
    && programsPageCode.includes('buildKitchenMenuImagePrompt')
    && programsPageCode.includes('apiGenerateProductMenuImage')
    && programsPageCode.includes('imageStudio')
    && apiCode.includes('function apiGenerateProductMenuImage')
    && productsRoute.includes("router.post('/:id/menu-image/generate'")
    && productsRoute.includes('/images/generations')
    && productsRoute.includes('OPENAI_MENU_IMAGE_MODEL')
    && bookingCode.includes('BOOKING_MENU_CATALOG_ADMIN_REVIEW_ACTIONS_ENABLED = false'));
check('Timeline booking no longer exposes silent booking toggle',
    !bookingPanelHtml.includes('bookingSkipNotificationSection')
    && !bookingPanelHtml.includes('skipNotificationToggle')
    && !bookingPanelHtml.includes('Без сповіщень')
    && !bookingPanelHtml.includes('тихе бронювання')
    && !bookingCode.includes("document.getElementById('skipNotificationToggle')")
    && !bookingFormJs.includes('skipNotificationToggle')
    && !timelineVisibilityCode.includes("key: 'skipNotification'")
    && !htmlContains('js/timeline-context.js', "'skipNotification'"));
check('Booking edit keeps the existing customer selected without reselecting',
    bookingCode.includes('function hydrateBookingCustomerSelection')
    && bookingCode.includes('function applySelectedCustomerToBookingForm')
    && bookingCode.includes('rememberSelectedCustomerSnapshot(normalized)')
    && bookingCode.includes("setBookingClientMode('existing')")
    && editBookingBlock.includes('await hydrateBookingCustomerSelection(booking, { renderSummary: false });')
    && duplicateBookingBlock.includes('await hydrateBookingCustomerSelection(booking, { renderSummary: false });')
    && editBookingBlock.includes('if (window.BookingForm?.markClean) BookingForm.markClean();')
    && duplicateBookingBlock.includes('if (window.BookingForm?.markClean) BookingForm.markClean();')
    && !editBookingBlock.includes('apiGetCustomer(booking.customerId).then')
    && !duplicateBookingBlock.includes('apiGetCustomer(booking.customerId).then'));
check('HR access editor describes extraRoles as real working-role grants', hrCode.includes('Це реальні extraRoles акаунта') && hrCode.includes('const extraRoles = normalizeAccountListInput(formResult.extraRoles)') && hrCode.includes('extraRoles: normalizeAccountListInput(result.extraRoles)'));
check('Maysternya Doli uses the shared booking panel without toolbar create shortcut', configCode.includes("const MAYSTERNYA_DOLI_PROGRAMS = [") && configCode.includes("id: 'md_demo_consult_15'") && configCode.includes("name: 'Демо консультація'") && configCode.includes('duration: 15') && configCode.includes("id: 'md_full_consult_40'") && configCode.includes("name: 'Повна консультація'") && configCode.includes('duration: 90') && configCode.includes('Повна консультація(90)') && !configCode.includes("id: 'md_consult_60'") && !configCode.includes("id: 'md_custom'") && configCode.includes("? ['custom']") && configCode.includes("custom: IS_MAYSTERNYA_DOLI_TIMELINE ? 'Консультації' : 'Послуги'") && configCode.includes('apiGetProducts(true, { businessContext, priceDate })') && configCode.includes('Array.isArray(apiProducts)') && configCode.includes('timelineDisplayUsesApiProducts') && !configCode.includes('if (IS_MAYSTERNYA_DOLI_TIMELINE) {\n        AppState.products = PROGRAMS;') && bookingCode.includes("TIMELINE_DISPLAY_MODE !== 'park'") && bookingCode.includes('p.updatedAt') && bookingCode.includes('prepareMaysternyaBookingPanel') && bookingCode.includes('MAYSTERNYA_ONLINE_ROOM') && bookingFormJs.includes('isMaysternyaBookingContext') && htmlContains('index.html', 'maysternyaQuickBookingTools') && !htmlContains('index.html', 'newBookingBtn') && timelineCode.includes('openTimelineCreateBookingFromToolbar') && !timelineVisibilityCode.includes("visualBlock('createBooking'") && !authCode.includes("setTimelinePermissionHidden('newBookingBtn'") && !panelCss.includes('body.timeline-context-maysternya .booking-room-first-section') && !panelCss.includes('body.timeline-context-maysternya .booking-customer-search-section') && !panelCss.includes('body.timeline-mode-simple .booking-room-first-section') && !panelCss.includes('body.timeline-mode-simple .status-section'));
check('Maysternya Doli booking can close busy slots', bookingCode.includes('closeMaysternyaTimelineSlot') && bookingCode.includes('slotClosed: true') && bookingCode.includes('MAYSTERNYA_CLOSED_ROOM') && timelineCode.includes('slot-closed') && timelineCode.includes('isMaysternyaSlotClosed') && timelineCss.includes('.booking-block.slot-closed') && htmlContains('index.html', 'maysternyaCloseSlotBtn'));
check('Resource-backed timeline can close cabinets and show capacity-aware free resources', bookingCode.includes('isTimelineResourceBackedBookingMode') && bookingCode.includes('timelineResourceCapacityError') && bookingCode.includes('timelineResourceBlock') && bookingCode.includes('resource_blackout') && bookingCode.includes('data-free-room') && bookingCode.includes('capacity=${encodeURIComponent(String(requestedCapacity))}') && timelineCode.includes('resourceBlockExtra') && panelCss.includes('body.timeline-mode-education .maysternya-quick-booking-tools') && !panelCss.includes('body.timeline-mode-education #kidsCountSection') && fs.readFileSync(path.join(ROOT, 'css/features.css'), 'utf8').includes('.free-room-chip small'));
check('Education timeline captures lesson metadata, real series, and teacher conflicts', htmlContains('index.html', 'educationLessonSection') && htmlContains('index.html', 'educationLessonTeacher') && htmlContains('index.html', 'educationLessonRepeatEvery') && bookingCode.includes('getEducationLessonDetails') && bookingCode.includes('apiCreateEducationLessonSeries') && bookingCode.includes('extraData.educationLesson') && bookingFormJs.includes('educationLessonRepeatEvery') && timelineCode.includes('educationLessonExtra') && timelineCode.includes('lessonSeriesBadge') && htmlContains('routes/bookings.js', 'validateEducationLessonTeacherConflict') && htmlContains('routes/bookings.js', 'education-series') && htmlContains('routes/bookings.js', 'buildEducationLessonSeriesCandidates') && htmlContains('routes/bookings.js', 'seriesRootBookingId') && panelCss.includes('.education-lesson-section'));
check('Booking UI separates park and client pinata modes', bookingCode.includes('syncPinataModeFields') && bookingCode.includes('clientPinataServicePrice') && bookingCode.includes('renderPinataDetailRows'));
check('Booking pinata and filler use one visual picker template', bookingCode.includes('function renderPinataChoiceCard') && bookingCode.includes('function renderPinataVisualPickers') && bookingCode.includes('buildPinataDesignChoices') && bookingCode.includes('buildPinataFillerChoices') && panelCss.includes('.pinata-choice-card') && panelCss.includes('.pinata-choice-thumb'));
check('Booking creation refreshes timeline truth and pinata detail boxes stay dark themed', bookingCode.includes('refreshCreatedBookingTimelineSnapshot') && bookingCode.includes('getSelectedProgramIdFromUi') && timelineResourceIdentityCode.includes('function timelineBookingsForLine') && timelineCode.includes('timelineBookingsForLine(bookings, line)') && apiCode.includes('options.fresh') && darkModeCss.includes('body.dark-mode .pinata-mode-section') && darkModeCss.includes('body.dark-mode .pinata-service-section label'));
check('Pinata booking and Telegram templates use readable Ukrainian labels', bookingCode.includes('Клієнтська піньята (послуга)') && bookingCode.includes('Піньята парку') && bookingCode.includes('Свій наповнювач клієнта') && telegramTemplatesCode.includes('Піньята: №') && telegramTemplatesCode.includes('Наповнювач:') && telegramTemplatesCode.includes('CLIENT_PINATA_FILLER_LABEL') && (telegramTemplatesCode.match(/function appendPinataOperationalLines/g) || []).length === 1 && !telegramTemplatesCode.includes('\u0420\u045f\u0421') && !bookingCode.includes('\u0420\u045f\u0421\u2013\u0420\u0405\u0421\u040a\u0421\u040f\u0421\u201a\u0420\u00b0'));
check('Safe new-tab helper isolates opener for simple navigation popups', uiCode.includes('function openSafeNewTab') && uiCode.includes("'noopener,noreferrer'") && uiCode.includes('win.opener = null'));
check('Shared iPhone download helpers cover async file exports', uiCode.includes('function openTouchDownloadWindow') && uiCode.includes('function finishBlobDownload') && uiCode.includes('function openAsyncNavigationWindow') && uiCode.includes('function finishAsyncNavigationWindow') && uiCode.includes('window.finishBlobDownload = finishBlobDownload'));
check('Blob exports use shared iPhone-safe download helper', iphoneSafeDownloadFiles.every(file => fileText(file).includes('finishBlobDownload')) && iphoneSafeDownloadFiles.every(file => fileText(file).includes('openTouchDownloadWindow')) && iphoneSafeDownloadFiles.every(file => fileText(file).includes('closeTouchDownloadWindow') || file === 'js/afisha-page.js' || file === 'js/staff-page.js' || file === 'js/settings-history.js'));
check('Demo player target button avoids raw target_url inline window.open', demoPageCode.includes('function openDemoTarget') && demoPageCode.includes('openSafeNewTab(url)') && demoPageCode.includes("replace(/'/g, '&#039;')") && !demoPageCode.includes("window.open('${steps[currentStep].target_url}'"));
check('Simple navigation new tabs use safe opener contract', bookingCode.includes('openSafeNewTab(chatUrl)') && chatPageCode.includes('openSafeNewTab(tasksUrl)') && graduationCode.includes('openSafeNewTab(url)') && htmlContains('finance.html', "openSafeNewTab('https://t.me/EGen_Park_Report_bot')") && htmlContains('designs.html', 'openSafeNewTab(gradUrl)'));
check('Design file downloads open a real tab on touch devices', designsPageCode.includes('isTouchDownloadDevice()') && designsPageCode.includes('openSafeNewTab(href)'));
check('Booking chat pre-opens mobile navigation before async channel fetch', bookingCode.includes('openAsyncNavigationWindow') && bookingCode.includes('finishAsyncNavigationWindow(asyncWindow, chatUrl)') && bookingCode.indexOf('openAsyncNavigationWindow') < bookingCode.indexOf("fetch('/api/chat/booking-channel'"));
check('Design catalog full edit add-item uses DOM listener instead of fragile inline HTML injection', designsHtml.includes('function addFullEditItemRow') && designsHtml.includes('data-fe-add-item') && designsHtml.includes('addFullEditItemRow(itemsContainer)') && !designsHtml.includes("_feItems\\').insertAdjacentHTML") && !designsHtml.includes('border:1px+solid+var(--gray-200)'));
check('Booking UI captures pinata and filler numbers separately', bookingCode.includes('pinataNumber') && bookingCode.includes('pinataFillerNumber') && htmlContains('index.html', 'pinataSharedFields'));
check('Booking route normalizes client pinata server-side', htmlContains('routes/bookings.js', 'normalizePinataFields') && htmlContains('routes/bookings.js', 'client_pinata_service_price'));
check('Booking route stores pinata operation numbers server-side', htmlContains('routes/bookings.js', 'pinata_number') && htmlContains('routes/bookings.js', 'pinata_filler_number'));
check('Pinata demand excludes client pinata service', htmlContains('routes/catalogs.js', "COALESCE(b.pinata_mode, 'park') = 'park'") && htmlContains('routes/warehouse.js', "COALESCE(pinata_mode, 'park') = 'park'"));
check('Shared UnsafeDismissGuard exposes dirty guarded close policy', uiCode.includes('const UnsafeDismissGuard') && uiCode.includes('attemptCloseEditableSurface') && uiCode.includes('confirmDiscardIfDirty') && uiCode.includes('window.UnsafeDismissGuard = UnsafeDismissGuard'));
check('Shared closeAllModals respects editable dirty surfaces', uiCode.includes("m.dataset.editableSurface === 'true'") && uiCode.includes('attemptCloseEditableSurface(m') && uiCode.includes('reason: \'close-all\''));
check('Shared formModal cancel/backdrop path asks dirty guard', uiCode.includes('const requestCancel = async') && uiCode.includes('confirmDiscardIfDirty(overlay') && uiCode.includes('closeOnBackdrop = true') && uiCode.includes("overlay.addEventListener('click', (e) => { if (e.target === overlay && closeOnBackdrop) requestCancel(); });"));
check('Lead edit backdrop and Escape route through guarded close', leadsCode.includes("overlay.id === 'leadModal'") && leadsCode.includes('closeLeadModal(false)') && leadsCode.includes('attemptCloseEditableSurface(modal'));
check('Booking panel guards date changes and panel close', bookingCode.includes('async function closeBookingPanel') && bookingCode.includes('attemptCloseEditableSurface(panel') && appCodeForDismiss.includes("document.querySelectorAll('[data-booking-panel-close]')") && appCodeForDismiss.includes("event.key !== 'Escape'") && appCodeForDismiss.includes("document.getElementById('bookingMenuCatalogPanel')") && appCodeForDismiss.includes('closeBookingPanel(false)') && htmlContains('index.html', 'bookingPanelEdgeClose') && panelCss.includes('.booking-panel-edge-close') && timelineCode.includes('async function selectCell'));
check('Timeline linked host blocks use canonical interaction model for group drag', timelineCode.includes('function getBookingDragGroup') && timelineCode.includes('s.draggedBooking = booking') && timelineCode.includes('s.mainBooking = dragGroup.mainBooking') && timelineCode.includes('apiUpdateLinkedBookingsAtomic(intent.mainBooking.id') && timelineCode.includes('model.buildDragAtomicPayload') && timelineInteractionModelCode.includes('function resolveTimelineBookingGroup') && timelineInteractionModelCode.includes('function buildDragInteractionIntent') && timelineCode.includes('if (!isViewer()) {') && timelineCode.includes('if (!isLinked) {') && timelineCss.includes('.booking-block.linked-ghost') && timelineCss.includes('cursor: grab'));
check('Timeline resize and undo use shared truth helpers and interaction save lock', timelineCode.includes('model.buildResizeAtomicPayload') && timelineCode.includes('model.buildResizeUndoSnapshot(resizeIntent, result)') && timelineCode.includes('model.buildDragUndoSnapshot(intent, atomicResult)') && timelineCode.includes('model.buildDragUndoAtomicPayload') && timelineCode.includes('model.buildResizeUndoAtomicPayload') && timelineCode.includes('if (_timelineInteractionSaveInFlight) return;') && timelineInteractionModelCode.includes('function buildResizeUndoAtomicPayload') && timelineInteractionModelCode.includes('function buildDragUndoAtomicPayload'));
check('Timeline Phase 4 has executable UAT regression matrix and authenticated-browser blocker documented', packageJsonText.includes('tests/timeline-regression-matrix.test.js') && timelineRegressionMatrixTestCode.includes('linked secondary cross-line') && timelineRegressionMatrixTestCode.includes('timeline context parity') && timelineRegressionMatrixTestCode.includes('interaction save lock blocks a second drag start') && timelineUatRegressionMatrixDoc.includes('/maysternya-doli') && timelineUatRegressionMatrixDoc.includes('TEST_USER') && timelineUatRegressionMatrixDoc.includes('TEST_PASS') && timelineUatRegressionMatrixDoc.includes('authenticated browser UAT') && timelineUatRegressionMatrixDoc.includes('timeline-interaction-model.js?v=<release>'));
check('Timeline interaction lifecycle cancels stale drag/resize state on interrupted sessions', timelineCode.includes('function cancelActiveTimelineInteractions') && timelineCode.includes("cancelActiveTimelineInteractions('render')") && timelineCode.includes("window.addEventListener('blur'") && timelineCode.includes("addEventListener('lostpointercapture'") && timelineCode.includes('function _samePointerId') && timelineCode.includes('s.completing = true') && timelineCode.includes("cancelActiveTimelineInteractions('date-change')") && timelineCode.includes("cancelActiveTimelineInteractions('visibilitychange')"));
check('Timeline lane geometry uses measured cells and pending assistant row keeps grid alignment', timelineCode.includes('function getTimelineCellWidth') && timelineCode.includes('timelineDurationWidth(effectiveDuration, anchor)') && timelineCode.includes('getTimelineCellWidth(s.grid)') && timelineCode.includes("renderGridCells('pending', selectedDate)") && timelineCss.includes('.timeline-line > .line-header') && timelineCss.includes('.pending-grid .grid-cell') && timelineCss.includes('min-height: inherit') && responsiveCss.includes('.pending-grid') && responsiveCss.includes('min-height: inherit'));
check('Timeline renders bookings even when line/resource identity drifts', timelineResourceIdentityCode.includes('function timelineLineMatchKeys') && timelineResourceIdentityCode.includes('function timelineBookingMatchKeys') && timelineResourceIdentityCode.includes('addTimelineMetadataMatchKeys') && timelineCode.includes('fallbackReason: \'unmatched_line_identity\'') && timelineCode.includes('Rendered unmatched bookings on fallback line') && timelineCode.includes('lineBookingsById.get(String(line.id))'));
check('Room timeline cannot save or edit legacy animator lines', htmlContains('routes/lines.js', 'function isRoomTimelineLinePayload') && htmlContains('routes/lines.js', '__timelineIsolationTestHooks') && htmlContains('routes/lines.js', 'room_timeline_legacy_line_save_blocked') && htmlContains('routes/lines.js', 'Room timeline rows cannot be saved through legacy animator lines endpoint') && timelineCode.includes('Blocked legacy line save from room timeline view') && timelineCode.includes('isViewer() || isRoomTimelineView()') && timelineCode.includes('if (isRoomTimelineView()) return;') && apiCode.includes('window.TimelineView?.isRooms?.()') && apiCode.includes('timelineApiUrlWithView(`/lines/${date}`)') && settingsCode.includes('function isRoomTimelineLineEditingBlocked') && settingsCode.includes('notifyRoomTimelineLineEditingBlocked'));
check('Animator timeline quarantines polluted room rows at read time', htmlContains('routes/lines.js', 'function isLegacyRoomTimelineLineRow') && htmlContains('routes/lines.js', 'Filtered room timeline rows from animator timeline response') && htmlContains('routes/lines.js', 'const lines = filteredRows') && timelineCode.includes('function isTimelineRoomOnlyLine') && timelineCode.includes('timelineLineValueStartsWithRoomId') && timelineCode.includes('!isTimelineBanquetServicePseudoLine(line) && !isTimelineRoomOnlyLine(line)'));
check('Timeline view isolation regression matrix covers polluted rows and view switch cache', timelineRegressionMatrixTestCode.includes('pollutedLegacyRows') && timelineRegressionMatrixTestCode.includes("['748']") && timelineRegressionMatrixTestCode.includes("['room-takeaway', 'room-marvel']") && timelineRegressionMatrixTestCode.includes('timelineCacheScopeKey') && timelineRegressionMatrixTestCode.includes('AppState\\.cachedLines') && timelineRegressionMatrixTestCode.includes('timelineApiUrlWithView'));
check('Phone timeline keeps the second line visible on iPhone 11', responsiveCss.includes('v0.73.80: iPhone 11/Safari needs a definite container height') && responsiveCss.includes('height: clamp(360px, calc(var(--eg-viewport-height, 100dvh) - 250px), 58dvh) !important;') && responsiveCss.includes('flex: 1 1 0 !important;') && responsiveCss.includes('max-height: none !important;') && uiCode.includes('if (viewportWidth <= 480) return 84;'));
check('Phone timeline positions second-line bookings from measured line grid', timelineCode.includes('v0.73.81: iOS/Safari can paint mobile grid cells after the row is attached') && timelineCode.includes('container.appendChild(lineEl);') && timelineCode.includes('createBookingBlock(b, start, lineGrid)') && timelineCode.includes('createAfishaBlock(ev, start, lineGrid)') && timelineCode.includes('function createBookingBlock(booking, startHour, anchor)') && uiCode.includes('timelineMinutesToPixels(nowMin - startMin, gridAnchor)'));
check('Graduation timeline renders package components as persisted interactive nested segments', timelineCode.includes('function normalizeGraduationSegments') && timelineCode.includes('extra.graduationSegments') && timelineCode.includes('function initGraduationSegmentInteractions') && timelineCode.includes('data-graduation-segment-id') && timelineCode.includes('graduationSegmentsHaveOverlap') && timelineCode.includes('withGraduationSegmentExtraData') && timelineCode.includes('apiUpdateBooking(booking.id, payload)') && timelineCss.includes('.booking-block.graduation-parent') && timelineCss.includes('.graduation-segment-track') && timelineCss.includes('.graduation-segment-resize'));
check('Task/customer/finance edit surfaces use shared dirty guard', tasksCode.includes('attemptCloseEditableSurface(overlay') && customersCode.includes('attemptCloseEditableSurface(modal') && financeCode.includes('attemptCloseEditableSurface(modal'));
check('Design/catalog overlays guard dirty dismiss paths', designsPageCode.includes('attemptCloseEditableSurface(overlay') && designsHtml.includes('guardedEditableOverlayClose') && designsHtml.includes('closeAutomationModal(false)'));
check('Staff and HR edit modals use guarded close paths', staffCode.includes('attemptCloseEditableSurface(overlay') && hrCode.includes('closeHrEditableModal') && hrCode.includes('showHrEditableModal'));
check('HR grouped IA keeps Pulse clean and vacancy workspace owns hiring surfaces', htmlContains('hr.html', 'id="hrNav"') && htmlContains('hr.html', 'id="hrPageTitle"') && hrCode.includes('const HR_NAV_GROUPS') && hrCode.includes('const HR_STRUCTURE_WORKSPACE_TABS') && hrCode.includes('const HR_PAYROLL_WORKSPACE_TABS') && hrCode.includes('const HR_OTHER_WORKSPACE_TABS') && hrCode.includes('const HR_PULSE_WORKSPACE_TABS') && hrCode.includes('function isHrStructureWorkspaceTab') && hrCode.includes('function isHrPayrollWorkspaceTab') && hrCode.includes('function isHrOtherWorkspaceTab') && hrCode.includes('function isHrPulseWorkspaceTab') && hrCode.includes('function hrWorkspaceGroupId') && hrCode.includes('function updateHrPageTitle') && hrCode.includes('function bindHrNavClicks') && hrCode.includes("other: { tab: 'vacancies' }") && hrCode.includes("href: '/training#onboarding'") && hrCode.includes("window.location.replace('/training#onboarding')") && hrCode.includes("payroll: { tab: 'salary' }") && hrCode.includes("id: 'pulse'") && hrCode.includes("label: 'Пульс компанії'") && hrCode.includes("{ id: 'today', label: 'Сьогодні' }") && hrCode.includes("{ id: 'schedule', label: 'Графік', href: '/staff' }") && hrCode.includes("{ id: 'reports', label: 'Звіти' }") && sidebarCode.includes("label: 'Пульс компанії'") && sidebarCode.includes("label: 'ЗП та KPI'") && sidebarCode.includes("label: 'Вакансії'") && hrCode.includes("label: 'Команда'") && hrCode.includes("label: 'Структура компанії'") && hrCode.includes("{ id: 'salary', label: 'Зарплата' }") && hrCode.includes("{ id: 'zrs', label: 'ЗРС' }") && hrCode.includes("{ id: 'kpi', label: 'KPI' }") && !hrCode.includes("{ id: 'onboarding', label: 'Онбординг' }") && hrCode.includes("{ id: 'vacancies', label: 'Вакансії' }") && !hrCode.includes("{ id: 'costumes', label: 'Костюми'") && hrCode.includes("{ id: 'checklists', label: 'Чеклисти' }") && hrCode.includes("label: 'ЗП та KPI'") && hrCode.includes("label: 'Вакансії'") && hrCode.includes("note: 'найм, відгуки, співбесіди, шаблони платформ'") && hrCode.includes("workspaceGroupId ? group.id === workspaceGroupId : group.id === 'pulse'") && hrCode.includes("workspaceGroupId === 'other' ? 'Навігація вакансій'") && hrCode.includes("nav.classList.toggle('hr-nav--structure-only'") && hrCode.includes("nav.classList.toggle('hr-nav--pulse'") && hrCode.includes("workspaceMode || pulseMode ? ' hidden' : ''") && hrCode.includes('if (header) header.hidden = pulseMode') && htmlContains('hr.html', '.hr-nav {') && htmlContains('hr.html', 'flex-direction: column') && htmlContains('hr.html', '.hr-nav--structure-only') && htmlContains('hr.html', '.hr-nav--structure-only .hr-nav-group-title') && htmlContains('hr.html', '.hr-nav--pulse .hr-nav-items') && htmlContains('hr.html', 'grid-template-columns: repeat(3, minmax(0, 1fr));') && htmlContains('hr.html', 'data-vacancy-tab="responses"') && htmlContains('hr.html', 'data-vacancy-tab="interviews"') && htmlContains('hr.html', 'data-vacancy-tab="templates"') && hrCode.includes('function formatVacancyPlatformText') && hrRouteCode.includes("router.get('/vacancy-platforms'") && hrRouteCode.includes("router.post('/vacancy-platforms/format-preview'") && !htmlContains('hr.html', 'data-tab="ai-team"') && !htmlContains('hr.html', 'data-tab="ratings"') && !htmlContains('hr.html', 'id="tab-leaves"'));
check('Warehouse owns the costume entry point instead of HR temporary navigation', htmlContains('warehouse.html', 'data-page-tab="costumes"') && htmlContains('warehouse.html', 'id="costumesTab"') && htmlContains('warehouse.html', 'id="warehouseCostumesList"') && htmlContains('warehouse.html', 'id="addCostumeBtn"') && htmlContains('warehouse.html', "switchPageTab('costumes')") && warehouseCode.includes("if (tab === 'costumes')") && warehouseCode.includes('loadWarehouseCostumes') && warehouseCode.includes('apiGetWarehouseCostumes') && !warehouseCode.includes("window.location.href = '/art?tab=costumes'") && warehouseCode.includes("hash === 'procurement' || hash === 'pinata' || hash === 'contractors' || hash === 'costumes'") && hrCode.includes("window.location.replace('/warehouse#costumes')") && !hrCode.includes("href: '/art?tab=costumes'"));
const hrPulseNavRule = hrHtmlForContracts.match(/\n\s*\.hr-nav--pulse(?:\s*,\s*\n\s*\.hr-nav--people)?\s*\{([\s\S]*?)\}/)?.[1] || '';
const hrPulseMobileNavRule = hrHtmlForContracts.match(/@media \(max-width: 768px\)\s*\{[\s\S]*?\.hr-nav--pulse\s*\{([\s\S]*?)\}/)?.[1] || '';
const hrTodayDateRule = hrHtmlForContracts.match(/\n\s*\.hr-today-date\s*\{([\s\S]*?)\}/)?.[1] || '';
const hrTodayDateMobileRule = hrHtmlForContracts.match(/@media \(max-width: 768px\)\s*\{[\s\S]*?\.hr-today-date\s*\{([\s\S]*?)\}/)?.[1] || '';
const hrLoadKpiBlock = hrCode.slice(hrCode.indexOf('async function loadKpi'), hrCode.indexOf('async function loadRatings'));
check('HR Pulse date badge stays below tabs without sticky overlap', htmlContains('hr.html', '.hr-nav--pulse + #tab-today.active') && /position:\s*relative;/.test(hrPulseNavRule) && /top:\s*auto;/.test(hrPulseNavRule) && !/position:\s*sticky;/.test(hrPulseNavRule) && /top:\s*auto;/.test(hrPulseMobileNavRule) && /display:\s*inline-flex;/.test(hrTodayDateRule) && /width:\s*fit-content;/.test(hrTodayDateRule) && /min-height:\s*36px;/.test(hrTodayDateRule) && htmlContains('hr.html', 'body.dark-mode .hr-today-date') && /width:\s*100%;/.test(hrTodayDateMobileRule));
check('HR Pulse Today has search and department segmentation on the Today surface', htmlContains('hr.html', 'id="todaySearch"') && htmlContains('hr.html', 'id="todayDepartmentSegments"') && htmlContains('hr.html', 'class="hr-today-controls"') && hrCode.includes('let todayFilters') && hrCode.includes('function renderTodayDepartmentSegments') && hrCode.includes('function filteredTodayItems') && hrCode.includes('function todaySearchHaystack') && hrCode.includes('function summarizeTodayItems') && hrCode.includes("todayFilters.department !== 'all'") && hrCode.includes('departmentLabel(item.department)') && htmlContains('hr.html', 'body.dark-mode .hr-today-controls') && htmlContains('hr.html', '.hr-today-segments') && htmlContains('hr.html', 'grid-template-columns: repeat(2, minmax(0, 1fr));') && hrRouteCode.includes('SELECT id, name, department, position, color, role_type, photo_url') && hrRouteCode.includes('FROM staff') && hrRouteCode.includes("record.status === 'unscheduled'") && hrRouteCode.includes('department: s.department') && hrRouteCode.includes('position: s.position'));
check('HR Pulse Today moves arrived people to review bottom with color indication', hrCode.includes('const TODAY_ARRIVED_STATUSES') && hrCode.includes('function isTodayItemArrived') && hrCode.includes('function sortTodayItemsForReview') && hrCode.includes('return sortTodayItemsForReview(filtered);') && hrCode.includes('hr-staff-row--arrived') && hrCode.includes('data-attendance-state="${arrived ?') && htmlContains('hr.html', '.hr-staff-row--arrived') && htmlContains('hr.html', 'body.dark-mode .hr-staff-row.hr-staff-row--arrived'));
check('HR operational routes exclude blacklist and unscheduled reserve from live lists', hrRouteCode.includes('function operationalStaffForDateWhere') && hrRouteCode.includes("COALESCE(${alias}.hr_pool_status, 'core') <> 'blacklisted'") && hrRouteCode.includes("COALESCE(${alias}.hr_pool_status, 'core') <> 'reserve'") && hrRouteCode.includes("router.put('/staff/:id/pool-status'") && hrRouteCode.includes('cleanupFutureStaffOperationalSchedule(client, req.params.id') && staffRouteCode.includes('function activeOperationalStaffForDateWhere') && staffRouteCode.includes("router.get('/face-descriptors'") && staffRouteCode.includes("WHERE ${activeOperationalStaffForDateWhere('s', 'hs', 'tr')}") && staffRouteCode.includes("conditions.push(\"COALESCE(hr_pool_status, 'core') <> 'blacklisted'\")"));
check('Camera check-in syncs into HR Today attendance records', staffRouteCode.includes('const { getKyivDate, getKyivDateStr } = require') && staffRouteCode.includes('function syncHrClockInFromStaffCheckin') && staffRouteCode.includes('function syncHrClockOutFromStaffCheckout') && staffRouteCode.includes('INSERT INTO hr_time_records (business_context, staff_id, record_date, clock_in') && staffRouteCode.includes('hrTimeRecord = await syncHrClockInFromStaffCheckin(client, staffId') && staffRouteCode.includes('hrTimeRecord = await syncHrClockOutFromStaffCheckout(client, staffId') && staffRouteCode.includes('WHERE staff_id = $1 AND date = $2') && staffRouteCode.includes('const date = req.query.date || getKyivDateStr();') && staffRouteCode.includes("broadcast('hr:attendance-updated'") && htmlContains('js/ws.js', "case 'hr:attendance-updated':") && hrCode.includes('function initHrRealtime') && hrCode.includes("window.addEventListener('ws:hr-attendance'") && htmlContains('hr.html', 'js/ws.js'));
check('HR clock-out payroll uses shared scheduled/manual and actual/camera settlement paths', hrAttendanceServiceCode.includes('function calculateHrClockOutPayroll') && hrAttendanceServiceCode.includes("settlementMode: useScheduled ? 'scheduled_shift' : 'actual_time'") && hrAttendanceServiceCode.includes('plannedShiftWorkedMinutes') && hrRouteCode.includes('calculateHrClockOutPayroll(rec') && hrRouteCode.includes('settlementMode: settlement_mode || settlementMode') && hrRouteCode.includes('business_context = COALESCE(business_context') && staffRouteCode.includes('calculateHrClockOutPayroll(rec') && hrCode.includes("body.settlement_mode = 'scheduled_shift'") && hrCode.includes('У зарплату буде зараховано планову зміну'));
check('HR button contract has explicit button types and a focused Node test', hrImplicitButtons.length === 0 && packageJsonText.includes('tests/hr-button-contract.test.js'));
check('HR legacy tab ids remap to canonical grouped destinations', hrCode.includes('const HR_TAB_ALIASES') && hrCode.includes("workers: { tab: 'team', bucket: 'workers' }") && hrCode.includes("ratings: { tab: 'kpi' }") && hrCode.includes("leaves: { tab: 'schedule' }") && hrCode.includes("reserve: { tab: 'team', bucket: 'reserve' }") && hrCode.includes("blacklist: { tab: 'team', bucket: 'blacklist' }") && hrCode.includes("dismissed: { tab: 'team', bucket: 'dismissed' }") && hrCode.includes("terminated: { tab: 'team', bucket: 'dismissed' }") && hrCode.includes("'ai-team': { tab: 'today' }") && hrCode.includes("window.location.replace('/warehouse#costumes')"));
check('HR Team uses Pulse-style bucket navigation and control panel', pagesCss.includes('v0.73.53: HR Team uses the same segmented rhythm') && pagesCss.includes('.hr-nav.hr-nav--people') && pagesCss.includes('.hr-nav.hr-nav--people .hr-nav-items') && pagesCss.includes('grid-template-columns: repeat(5, minmax(0, 1fr));') && pagesCss.includes('.hr-team-controls') && pagesCss.includes('.hr-team-filter-info') && htmlContains('hr.html', 'class="hr-team-controls"') && htmlContains('hr.html', 'id="teamFilterInfo"') && htmlContains('hr.html', 'Показувати звільнених') && !htmlContains('hr.html', 'hr-team-section-head') && htmlContains('hr.html', '.hr-people-bucket') && htmlContains('hr.html', '.hr-people-bucket-count') && hrCode.includes('const PEOPLE_BUCKETS') && hrCode.includes('const HR_PEOPLE_WORKSPACE_TABS') && hrCode.includes('function isHrPeopleWorkspaceTab') && hrCode.includes("{ id: 'workers', label: 'Робітники', tab: 'team', bucket: 'workers', visible: () => canSeeHrTeamBucket('workers') }") && hrCode.includes("{ id: 'interns', label: 'Стажери', tab: 'team', bucket: 'interns', visible: () => canSeeHrTeamBucket('interns') }") && hrCode.includes("{ id: 'blacklist', label: 'Чорний список', tab: 'team', bucket: 'blacklist', visible: () => canSeeHrTeamBucket('blacklist') }") && hrCode.includes("{ id: 'reserve', label: 'Резерв', tab: 'team', bucket: 'reserve', visible: () => canSeeHrTeamBucket('reserve') }") && hrCode.includes("{ id: 'dismissed', label: 'Звільнені', tab: 'team', bucket: 'dismissed', visible: () => canSeeHrTeamBucket('dismissed') }") && hrCode.includes("if (staff.is_active === false) return 'dismissed';") && !hrCode.includes("{ id: 'team', label: 'Команда', tab: 'team' }") && hrCode.includes('function getHrTeamBucketAccess') && hrCode.includes('function visiblePeopleBuckets') && hrCode.includes('function normalizeVisiblePeopleBucket') && hrCode.includes('function canManageHrTeamBucketVisibility') && hrCode.includes('let activePeopleBucket = null') && hrCode.includes('function setHrNavTeamMode') && hrCode.includes("nav.classList.toggle('hr-nav--people'") && hrCode.includes("if (header) header.hidden = pulseMode || peopleMode") && hrCode.includes('activePeopleBucket = nextBucket') && hrCode.includes('function updateTeamFilterInfo') && hrCode.includes('totalCount') && hrCode.includes('window.setPeopleBucket') && hrCode.includes('syncHrNavActive') && hrCode.includes('updatePeopleNavCounts(grouped)') && hrCode.includes('renderPeopleBucketState') && htmlContains('hr.html', 'hr-people-empty--loading') && htmlContains('hr.html', 'hr-people-empty--error') && !hrCode.includes('function loadReservePool') && !hrCode.includes('function renderAITeam'));
check('HR Team profile modal uses compact dropdown picker for secondary professions', htmlContains('hr.html', 'id="editSecondaryProfessionPicker"') && htmlContains('hr.html', 'hr-profession-picker') && htmlContains('hr.html', 'id="editSecondaryProfessionChips"') && htmlContains('hr.html', 'id="editSecondaryProfessionOptions"') && htmlContains('hr.html', 'Основна професія') && hrCode.includes('function bindSecondaryProfessionPicker') && hrCode.includes('function setSecondaryProfessionPickerOpen') && hrCode.includes('data-secondary-add') && hrCode.includes('data-secondary-remove') && hrCode.includes('setSelectedSecondaryProfessionKeys') && hrCode.includes('syncHiddenSecondaryProfessionSelect') && htmlContains('css/hr-page.css', '.hr-profession-picker.is-open .hr-profession-options') && htmlContains('css/hr-page.css', 'position: absolute') && htmlContains('css/hr-page.css', 'max-height: 220px'));
check('HR Team cards separate professions, statuses, actions, and move flow', htmlContains('hr.html', '.hr-team-card-head') && htmlContains('hr.html', '.hr-team-profession-area') && htmlContains('hr.html', '.hr-team-status-row') && htmlContains('hr.html', '.hr-team-actions') && htmlContains('hr.html', '.hr-team-move') && hrCode.includes('function buildStaffMovePayload') && hrCode.includes('function openStaffMoveMenu') && hrCode.includes('window.openStaffMoveMenu = openStaffMoveMenu') && hrCode.includes("body.hr_pool_status = 'reserve'") && hrCode.includes("body.role_type = 'intern'") && hrCode.includes('preferredWorkerRoleForStaff') && hrCode.includes('function setStaffProfileActive') && hrCode.includes("normalizedTarget === 'dismissed'") && hrCode.includes('через offboarding') && hrCode.includes('Звільнення:') && hrRouteCode.includes("termination_date = NULL") && hrRouteCode.includes("UPDATE employee_profiles") && hrRouteCode.includes("UPDATE users") && hrRouteCode.includes("staff_rehire") && pagesCss.includes('.hr-team-card.inactive') && !htmlContains('hr.html', '.hr-team-card.inactive { opacity: 0.5;'));
check('HR Team profile action lives in card header and opens from avatar or name', hrCode.includes('const profileClick = `openStaffEdit(${Number(s.id)})`;') && hrCode.includes('hr-team-profile-trigger') && hrCode.includes('hr-team-name-button') && hrCode.includes('hr-team-edit hr-team-edit--top') && htmlContains('css/hr-page.css', '.hr-team-profile-trigger') && htmlContains('css/hr-page.css', '.hr-team-name-button') && htmlContains('css/hr-page.css', '.hr-team-edit--top'));
check('HR staff profile opens with team identity card and editable name/phone row', htmlContains('hr.html', 'class="hr-staff-profile-hero"') && htmlContains('hr.html', 'id="editStaffHeaderName"') && htmlContains('hr.html', 'id="editStaffName"') && htmlContains('hr.html', 'id="editPhone"') && hrCode.includes('function syncStaffProfileHeaderName') && hrCode.includes("name: document.getElementById('editStaffName')?.value || null") && hrRouteCode.includes("queueStaffUpdate('name'") && htmlContains('css/hr-page.css', '.hr-staff-profile-card') && htmlContains('css/hr-page.css', '.hr-staff-profile-quick-fields') && htmlContains('css/hr-page.css', '.hr-staff-profile-quick-fields input') && htmlContains('css/hr-page.css', 'body.dark-mode .hr-staff-profile-quick-fields input'));
check('HR staff profile can choose hourly, daily, or monthly rate units', htmlContains('hr.html', 'id="editRateUnit"') && htmlContains('hr.html', 'value="day"') && htmlContains('hr.html', 'value="month"') && hrCode.includes('function syncStaffRateUnitUi') && hrCode.includes('rate_unit: currentEditRateUnit()') && hrCode.includes('function renderSalaryRateSummary') && hrCode.includes('formatStaffRate(segment.rate, segment.rateUnit)') && hrCode.includes("return 'month'") && hrRouteCode.includes('function normalizeStaffRateUnit') && hrRouteCode.includes("COALESCE(s.rate_unit, 'hour') AS rate_unit") && hrRouteCode.includes("WHEN rate_unit = 'month' THEN 0") && htmlContains('db/migrations/259_staff_rate_unit_month.sql', "rate_unit IN ('hour', 'day', 'month')") && htmlContains('css/hr-page.css', '.hr-primary-rate-card') && htmlContains('css/hr-page.css', '.hr-profession-rate-control'));
check('HR staff profile hides the manual pool status selector', !htmlContains('hr.html', 'id="editPoolStatus"') && hrCode.includes("const editPoolStatus = document.getElementById('editPoolStatus');") && hrCode.includes("if (editPoolStatus) body.hr_pool_status = editPoolStatus.value || 'core';") && !hrCode.includes("hr_pool_status: document.getElementById('editPoolStatus')?.value || 'core'"));
check('HR staff profile hides blacklist reason from the profile form', !htmlContains('hr.html', 'id="editBlacklistReason"') && !hrCode.includes("blacklist_reason: document.getElementById('editBlacklistReason')") && hrCode.includes("formModal('Причина чорного списку'") && hrRouteCode.includes("queueStaffUpdate('blacklist_reason'"));
check('HR Team permanent staff delete is guarded for duplicate cleanup', hrCode.includes('class="hr-team-delete"') && hrCode.includes('function deleteStaffProfile') && hrCode.includes("hrFetch(`/staff/${staffId}/delete-readiness`)") && hrCode.includes('Введіть ТАК для підтвердження') && hrCode.includes("confirmation: 'ТАК'") && hrCode.includes('window.deleteStaffProfile = deleteStaffProfile') && hrRouteCode.includes("router.get('/staff/:id/delete-readiness'") && hrRouteCode.includes("router.delete('/staff/:id'") && hrRouteCode.includes("const STAFF_DELETE_CONFIRMATION = 'ТАК'") && hrRouteCode.includes('STAFF_DELETE_BLOCKER_CHECKS') && hrRouteCode.includes('UPDATE hr_audit_log SET staff_id = NULL') && hrRouteCode.includes('staff_delete_permanent') && pagesCss.includes('.hr-team-delete') && pagesCss.includes('body.dark-mode .page-container .hr-team-delete'));
check('HR schedule owns leave request controls after standalone leaves removal', htmlContains('hr.html', 'Заявки на відпустки та вихідні') && htmlContains('hr.html', 'id="leaveStatusFilter"') && htmlContains('hr.html', 'id="leavesList"') && !htmlContains('hr.html', 'id="tab-leaves"') && hrCode.includes('await loadLeaves();'));
check('HR salary exposes calendar period filter without letting custom ranges commit payroll', htmlContains('hr.html', 'id="salaryDateFrom"') && htmlContains('hr.html', 'id="salaryDateTo"') && htmlContains('hr.html', 'type="date"') && htmlContains('hr.html', 'id="btnApplySalaryPeriod"') && htmlContains('hr.html', 'id="btnResetSalaryPeriod"') && pagesCss.includes('v0.73.78: HR salary calendar period picker') && pagesCss.includes('body.dark-mode .hr-salary-date-input') && hrCode.includes('function payrollMonthBounds') && hrCode.includes('function currentSalaryPeriod') && hrCode.includes('function salaryPeriodQueryString') && hrCode.includes('hrFetch(`/salary?${query}`)') && hrCode.includes("period.mode === 'range'") && hrCode.includes('Нарахування зарплати доступне тільки для повного місяця') && hrPayrollPeriodServiceCode.includes('function payrollPeriodRange') && hrRouteCode.includes('$2::date AS date_from') && hrRouteCode.includes("sa.month >= p.month_from AND sa.month <= p.month_to"));
check('HR KPI uses the backend KPI snapshot instead of client-side source merging', htmlContains('hr.html', 'id="tab-kpi"') && htmlContains('hr.html', 'id="kpiSummary"') && htmlContains('hr.html', 'id="kpiSources"') && htmlContains('hr.html', '.hr-kpi-sources') && htmlContains('hr.html', 'class="hr-kpi-refresh"') && hrCode.includes('async function loadKpi') && hrLoadKpiBlock.includes("hrFetch(`/kpi?month=${month}`)") && hrRouteCode.includes("router.get('/kpi'") && hrRouteCode.includes('loadKpiSnapshot') && hrCode.includes('renderKpiSources') && hrCode.includes('HR-зріз') && hrCode.includes('Підсумковий KPI') && hrCode.includes('даних ще немає') && !hrLoadKpiBlock.includes("hrFetch(`/report/monthly?month=${month}`)") && !hrLoadKpiBlock.includes("hrFetch('/ratings')") && !hrCode.includes('monthly report') && !hrCode.includes('ratings context') && !htmlContains('hr.html', 'ratingsBoard'));
check('HR dark and mobile styles cover nav badges, compact people cards, KPI sources and accordion layout', htmlContains('hr.html', 'body.dark-mode .hr-nav-count') && htmlContains('hr.html', 'body.dark-mode .hr-kpi-source') && htmlContains('hr.html', 'body.dark-mode .hr-people-empty--error') && htmlContains('hr.html', '@media (max-width: 768px)') && htmlContains('hr.html', '.hr-people-bucket-grid { grid-template-columns: 1fr; }') && htmlContains('hr.html', 'grid-template-columns: repeat(auto-fill, minmax(240px, 1fr))') && htmlContains('hr.html', '.hr-team-avatar { width: 42px; height: 42px; font-size: 16px; }') && !/\.hr-people-bucket-body\s*\{[^}]*overflow-[xy]\s*:/.test(hrHtmlForContracts));
check('HR exposes account center with account creation, profile, staff binding, password controls, and safe list recovery', htmlContains('hr.html', 'id="tab-accounts"') && hrCode.includes("{ id: 'accounts', label: 'Акаунти', visible: () => canManageAccountSecurity() }") && htmlContains('hr.html', 'accountCenterList') && htmlContains('hr.html', 'accountCreateBtn') && htmlContains('hr.html', 'accountCenterResetFiltersBtn') && htmlContains('hr.html', 'accountCenterFilterNotice') && hrCode.includes('function loadAccountCenter') && hrCode.includes('function canManageAccountSecurity') && hrCode.includes('openAccountCreateModal') && hrCode.includes('function openAccountProfileModal') && hrCode.includes('function loadAccountStaffOptions') && hrCode.includes('/api/users/${encodeURIComponent(userId)}/profile') && hrCode.includes('function openAccountPasswordModal') && hrCode.includes('/api/users/${encodeURIComponent(userId)}/reset-password') && hrCode.includes('function resetAccountCenterFilters') && hrCode.includes('loadAccountCenter({ resetFilters: true })') && !hrCode.includes('deactivateKarinaAccounts') && !htmlContains('hr.html', 'Вимкнути акаунти Каріни') && htmlContains('routes/users.js', 'ACCOUNT_MANAGER_ROLES') && htmlContains('routes/users.js', "router.get('/staff-options'") && htmlContains('routes/users.js', "router.patch('/:id/profile'"));
check('HR Account Center shows live role access packs for create and access modals', uiCode.includes("f.type === 'dynamicNote'") && uiCode.includes("f.type === 'presetButtons'") && uiCode.includes('data-fm-preset') && uiCode.includes('setFieldValue') && uiCode.includes('applyPresetValues') && uiCode.includes("setFieldValue(key, value, { notify: false })") && uiCode.includes('aria-pressed') && uiCode.includes('updateFormState') && uiCode.includes('visibleWhen') && uiCode.includes('data-fm-field-wrap') && uiCode.includes("f.type === 'select' && f.dependsOn && (f.optionsBy || typeof f.optionsFor === 'function')") && uiCode.includes("f.type === 'checkboxGroup' && f.dependsOn") && hrCode.includes('function formatAccountRoleAccessPack') && hrCode.includes('function renderAccountRolePackFromForm') && hrCode.includes('function getAccountRolePresetButtons') && hrCode.includes('function getAccountPageOptions') && hrCode.includes("key: 'rolePreset'") && hrCode.includes("key: 'roleAccessPack'") && hrCode.includes("key: 'pageAllowlist', label: 'Дозволити окремі сторінки', type: 'checkboxGroup'") && hrCode.includes("dependsOn: 'role'") && hrCode.includes("dependsOn: 'businessContexts'") && hrCode.includes('businessFieldsVisible') && hrCode.includes("values.defaultBusinessContext === 'maysternya_doli'") && hrCode.includes('accountRolePresets') && hrCode.includes('accountPageAccessMatrix') && hrCode.includes('accountActionPermissionsMatrix') && packageJsonText.includes('tests/form-modal-dependencies.test.js') && htmlContains('routes/users.js', 'rolePresets:') && htmlContains('routes/users.js', 'pageAccess: PAGE_ACCESS') && htmlContains('routes/users.js', 'actionPermissions: ACTION_PERMISSIONS'));
check('HR Account Center hides protected account actions before API calls', hrCode.includes('function currentAccountCanMutateTarget') && hrCode.includes('function currentAccountCanToggleTarget') && hrCode.includes('const targetProtected = canManageSecurity && !canMutateTarget') && hrCode.includes('захищено') && hrCode.includes('currentAccountCanMutateTarget(user)') && hrCode.includes('currentAccountCanToggleTarget(user)'));
check('Extensionless CRM HTML routes are no-store to avoid stale HR tab DOM', securityMiddlewareCode.includes('STATIC_HTML_ROUTE_PATHS') && securityMiddlewareCode.includes("'/hr'") && securityMiddlewareCode.includes('function isHtmlPagePath') && securityMiddlewareCode.includes("res.set('Cache-Control', 'no-cache, no-store, must-revalidate')"));
check('Service worker script is not served as immutable static JS', securityMiddlewareCode.includes("p === '/sw.js'") && securityMiddlewareCode.includes('stale workers can keep serving') && securityMiddlewareCode.includes("res.set('Cache-Control', 'no-cache, no-store, must-revalidate')"));
check('Content edit modals force-close only after durable actions', contentCode.includes('attemptCloseEditableSurface(modal') && contentCode.includes('await closeModal(true)') && contentCode.includes('await closeCardModal(true)'));

// Check Timeline/Kleshnya shell collapse keeps geometry in CSS
check('Timeline sidebar collapse is class-based', appCode.includes("sidebar.classList.add('collapsed')") && appCode.includes("sidebar.classList.toggle('collapsed')"));
check('Timeline sidebar collapse avoids inline shell offsets', !appCode.includes('style.marginLeft') && !appCode.includes("style.width = 'calc(100% - 64px)'"));
check('Timeline product sales button opens modal', appCode.includes('showProductSalesModal') && appCode.includes("document.getElementById('productSalesBtn')?.addEventListener('click', showProductSalesModal)"));
check('Timeline create toolbar button is absent while deep-link booking flow stays available', !appCode.includes("document.getElementById('newBookingBtn')") && timelineCode.includes('async function openTimelineCreateBookingFromToolbar') && timelineCode.includes('openBookingPanel(time, line.id)') && timelineCode.includes('getDefaultTimelineBookingTime'));
check('Timeline product sales API loads monthly report', appCode.includes('/api/analytics/product-sales?') && appCode.includes('loadProductSalesReport'));
check('Timeline product sales export supports CSV and XLSX', appCode.includes("downloadProductSalesExport('csv')") && appCode.includes("downloadProductSalesExport('xlsx')"));
check('Timeline product sales supports pinata quick filter', appCode.includes("categorySelect.value = 'pinata'"));
check('Timeline product sales/export permission state does not fight visibility constructor', authCode.includes('function setTimelinePermissionHidden') && !authCode.includes("setTimelinePermissionHidden('newBookingBtn'") && authCode.includes("setTimelinePermissionHidden('exportTimelineBtn', !canAccess('export_data'))") && authCode.includes("setTimelinePermissionHidden('exportPdfBtn', !canAccess('export_data'))") && authCode.includes("setTimelinePermissionHidden('productSalesBtn', !canAccess('export_data'))") && timelineVisibilityCode.includes("visualBlock('export', 'Верхня панель', 'Експорт', '#exportTimelineBtn, #exportPdfBtn')") && !authCode.includes("exportBtn.style.display = 'none'"));

// ═══════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`${'═'.repeat(50)}`);
process.exit(failed > 0 ? 1 : 0);
