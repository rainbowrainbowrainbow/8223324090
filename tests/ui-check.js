/**
 * tests/ui-check.js — DOM-level UI checks using jsdom
 * Validates HTML structure, JS function availability, onclick handlers
 * Run: node tests/ui-check.js
 */
const nodeFs = require('fs');
const path = require('path');
const pkg = require('../package.json');
const { createUiCheckContext } = require('./static/static-check-helpers');
const { runInviteChecks } = require('./static/invite-checks');
const { runBookingSummaryChecks } = require('./static/booking-summary-checks');

const fs = Object.create(nodeFs);
fs.readFileSync = (...args) => {
    const value = nodeFs.readFileSync(...args);
    return typeof value === 'string' ? value.replace(/\r\n?/g, '\n') : value;
};

const ROOT = path.join(__dirname, '..');
const ui = createUiCheckContext({ root: ROOT });
const {
    JSDOM,
    check,
    fileText,
    cssTextWithImports,
    cssRuleText,
    cssRuleIncludingSelectorText,
    cssAtRuleBlock,
    hrSurfaceText,
    htmlContains,
    checkPage,
    checkJSFile,
    getHtmlScripts,
    scriptIndex,
    htmlScriptLoadsBefore,
    getInlineScripts,
    walkFiles,
    sourceBlock
} = ui;

const bookingSummaryBrowserSmokeCode = fileText('tests/browser/booking-summary-browser-smoke.js');
const taskCenterBrowserSmokeCode = fileText('tests/browser/task-center-parity-browser-smoke.js');
const myDayInteractionsBrowserSmokeCode = fileText('tests/browser/my-day-interactions-browser-smoke.js');
const myDayActualAppBrowserSmokeCode = fileText('tests/browser/my-day-actual-app-browser-smoke.js');
const liveMyDaySmokeCode = fileText('scripts/live-my-day-smoke.js');
const hrPulseBrowserSmokeCode = fileText('tests/browser/hr-pulse-browser-smoke.js');
const hrTeamBrowserSmokeCode = fileText('tests/browser/hr-team-browser-smoke.js');
const hrTodayBrowserSmokeCode = fileText('tests/browser/hr-today-metrics-browser-smoke.js');
const hrAttendanceStateCode = fileText('js/hr-attendance-state.js');
const pagesTasksCss = fileText('css/pages-tasks.css');
const ciWorkflow = fileText('.github/workflows/ci.yml');
const inviteShareCode = fileText('js/invite-share.js');
const timelineBookingCode = fileText('js/booking.js');

runInviteChecks(ui);

const hermesStudioHtml = fileText('hermes-studio.html');
const hermesStudioCss = fileText('css/hermes-studio.css');
const hermesStudioJs = fileText('js/hermes-studio-page.js');
const hermesStudioBoardRule = cssRuleText(hermesStudioCss, '.hermes-studio-board');
const hermesStudioAssetRule = cssRuleText(hermesStudioCss, '.hermes-studio-assets');
const hermesStudioDecisionActionsRule = cssRuleText(hermesStudioCss, '.hermes-studio-decision-actions');
const hermesStudioDesktopNarrowBlock = cssAtRuleBlock(hermesStudioCss, '@media (max-width: 1380px)');
const hermesStudioMobileBlock = cssAtRuleBlock(hermesStudioCss, '@media (max-width: 720px)');
check('Hermes Studio review workspace keeps assets history and actions responsive',
    hermesStudioHtml.includes('class="hermes-studio-workspace"')
    && hermesStudioHtml.includes('class="hermes-studio-detail"')
    && hermesStudioHtml.includes('class="hermes-studio-decision-box"')
    && hermesStudioJs.includes('function renderAssets(job)')
    && hermesStudioJs.includes('const url = safeUrl(asset.url);')
    && hermesStudioJs.includes('<img src="${esc(url)}" alt="${esc(role)}">')
    && /grid-template-columns:\s*minmax\(360px,\s*0\.82fr\)\s*minmax\(480px,\s*1\.18fr\);/.test(hermesStudioBoardRule)
    && /min-width:\s*0;/.test(hermesStudioBoardRule)
    && hermesStudioDesktopNarrowBlock.includes('.hermes-studio-board')
    && hermesStudioDesktopNarrowBlock.includes('grid-template-columns: 1fr;')
    && /repeat\(auto-fit,\s*minmax\(170px,\s*1fr\)\)/.test(hermesStudioAssetRule)
    && /min-width:\s*0;/.test(hermesStudioAssetRule)
    && /display:\s*grid;/.test(hermesStudioDecisionActionsRule)
    && /repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(hermesStudioDecisionActionsRule)
    && hermesStudioCss.includes('.hermes-studio-decision-actions > button')
    && hermesStudioCss.includes('overflow-wrap: anywhere;')
    && hermesStudioMobileBlock.includes('.hermes-studio-decision-actions')
    && hermesStudioMobileBlock.includes('grid-template-columns: 1fr;'));

function cssImportVersionTagsAreCurrent(filename) {
    const css = fileText(filename);
    const imports = [...css.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;?]+\.css)(?:\?v=([^"')\s;]+))?["']?\s*\)?\s*;/g)];
    return imports.length > 0 && imports.every(match => match[2] === pkg.version);
}

check('Aggregate CSS imports carry current asset versions',
    ['css/assistant-rail.css', 'css/pages.css', 'css/pages-shell.css', 'css/sidebar-aurora.css'].every(cssImportVersionTagsAreCurrent));

const pagesShellCss = fileText('css/pages-shell.css');
const sidebarAuroraEntrypointCss = fileText('css/sidebar-aurora.css');
const sidebarAuroraProfileCss = fileText('css/sidebar-aurora-profile.css');
check('Primary page runtime CSS keeps page modules isolated',
    pagesShellCss.includes('pages-core.css')
    && pagesShellCss.includes('pages-shared-widgets.css')
    && !/pages-(tasks|profile|reports|hr-staff|hr-foundation)\.css/.test(pagesShellCss)
    && sidebarAuroraEntrypointCss.includes('sidebar-aurora-profile.css')
    && htmlContains('tasks.html', 'css/pages-tasks.css')
    && htmlContains('reports.html', 'css/pages-reports.css')
    && htmlContains('profile.html', 'css/pages-profile.css')
    && htmlContains('hr.html', 'css/pages-hr-staff.css'));

const HR_WORKSPACE_PAGES = ['hr.html', 'staff.html', 'reports.html'];
const HR_WORKSPACE_ACTION_BUTTON_SELECTOR = [
    'button[class*="btn-page"]',
    'button[class*="btn-primary"]',
    'button[class*="btn-secondary"]',
    'button[class*="btn-danger"]',
    'button[class*="toolbar"]',
    'button[class*="action"]',
    'button[id*="Export"]',
    'button[id*="export"]',
    'button[id*="Print"]',
    'button[id*="print"]'
].join(',');
const UI_ACTION_EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

function inlineStyleBlockBytes(filename) {
    return [...fileText(filename).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
        .reduce((total, match) => total + match[1].length, 0);
}

function actionButtonEmojiTexts(filename) {
    const doc = new JSDOM(fileText(filename)).window.document;
    return [...doc.querySelectorAll(HR_WORKSPACE_ACTION_BUTTON_SELECTOR)]
        .map(button => button.textContent.trim())
        .filter(text => UI_ACTION_EMOJI_PATTERN.test(text));
}

const pagesCoreCssForContract = fileText('css/pages-core.css');
check('HR workspace shared UI contract exposes reusable primitives',
    [
        '.btn-page-primary',
        '.btn-page-secondary',
        '.btn-page-danger',
        '.btn-page-ghost',
        '.btn-page-toolbar',
        '.ui-chip',
        '.ui-chip.active',
        '.ui-tab-card',
        '.workspace-hero',
        '.workspace-command-bar'
    ].every(token => pagesCoreCssForContract.includes(token)));
check('HR workspace pages keep extracted CSS out of inline style blocks',
    HR_WORKSPACE_PAGES.every(filename => inlineStyleBlockBytes(filename) === 0));
check('HR workspace action buttons avoid emoji text icons',
    HR_WORKSPACE_PAGES.every(filename => actionButtonEmojiTexts(filename).length === 0));

function cssRuleSetsDisplay(css, selector, display) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rulePattern = new RegExp(`${escapedSelector}\\s*\\{[^}]*display\\s*:\\s*${display}\\s*;`, 'm');
    return rulePattern.test(css);
}

function textHasAll(source, tokens) {
    return tokens.every(token => source.includes(token));
}

// ═══════════════════════════════════════════════════
// PAGE CHECKS
// ═══════════════════════════════════════════════════

checkPage('index.html', (doc, html) => {
    const modalsCss = fs.readFileSync(path.join(ROOT, 'css', 'modals.css'), 'utf8');
    const featuresCss = fs.readFileSync(path.join(ROOT, 'css', 'features.css'), 'utf8');
    const panelCss = fs.readFileSync(path.join(ROOT, 'css', 'panel.css'), 'utf8');
    const darkModeCss = fs.readFileSync(path.join(ROOT, 'css', 'dark-mode.css'), 'utf8');
    const assistantTopbarCss = fs.readFileSync(path.join(ROOT, 'css', 'assistant-rail-topbar.css'), 'utf8');
    const assistantAggregateCss = cssTextWithImports('css/assistant-rail.css');
    const appCode = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
    const bookingCode = [
        fs.readFileSync(path.join(ROOT, 'js', 'booking-drawer-state.js'), 'utf8'),
        fs.readFileSync(path.join(ROOT, 'js', 'booking-banquet-selector.js'), 'utf8'),
        fs.readFileSync(path.join(ROOT, 'js', 'booking-save-path.js'), 'utf8'),
        fs.readFileSync(path.join(ROOT, 'js', 'booking-activity-schedule.js'), 'utf8'),
        fs.readFileSync(path.join(ROOT, 'js', 'booking.js'), 'utf8')
    ].join('\n');
    const timelineCode = fs.readFileSync(path.join(ROOT, 'js', 'timeline.js'), 'utf8');
    const bookingFormCode = fs.readFileSync(path.join(ROOT, 'js', 'booking-form.js'), 'utf8');
    const apiCode = fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8');
    const bookingsRouteCode = fs.readFileSync(path.join(ROOT, 'routes', 'bookings.js'), 'utf8');
    const timelineBrowserSmokeCode = fs.readFileSync(path.join(ROOT, 'tests', 'browser', 'timeline-browser-smoke.js'), 'utf8');
    const timelineVisibilityCode = fs.readFileSync(path.join(ROOT, 'js', 'timeline-visibility.js'), 'utf8');
    const productPricingCode = fs.readFileSync(path.join(ROOT, 'services', 'productPricing.js'), 'utf8');
    const responsiveCss = cssTextWithImports('css/responsive.css');
    const timelineVisualHierarchyCss = darkModeCss.slice(Math.max(0, darkModeCss.indexOf('/* Task 5: timeline visual hierarchy')));
    const timelineToolbarHierarchyCss = responsiveCss.slice(Math.max(0, responsiveCss.indexOf('/* Task 5: keep cyan')));
    const timelineHeaderWideDesktopCss = cssAtRuleBlock(responsiveCss, '@media (max-width: 2160px) and (min-width: 1537px) {');
    const timelineViewPanelResponsiveCss = sourceBlock(responsiveCss, '/* v0.77.77: header/topbar wrapping guard for the timeline shell.', '@media (max-width: 430px) {');
    const timelineCompactCommandCss = sourceBlock(
        responsiveCss,
        '/* v0.77.79: compact date command line removes the empty full-width card shell. */',
        '/* v0.77.83: filters open as a normal-flow collapsible shelf under the date row. */'
    );
    check('Booking customer context layout uses a class fallback instead of CSS :has()',
        !!doc.querySelector('#customerDataSection.customer-data-section')
        && !!doc.querySelector('#bookingSelectedCustomerCard')
        && panelCss.includes('.customer-data-section.has-selected-customer .booking-customer-layout')
        && !panelCss.includes('.customer-data-section:has(#bookingSelectedCustomerCard:not(.hidden)) .booking-customer-layout')
        && bookingCode.includes('function syncBookingSelectedCustomerLayoutState')
        && bookingCode.includes("section.classList.add('has-selected-customer')")
        && bookingCode.includes("section.classList.remove('has-selected-customer')"));
    const timelineHeaderLabelBreakpointCss = cssAtRuleBlock(responsiveCss, '@media (max-width: 1536px) {');
    const timelineHeaderNarrowDesktopCss = cssAtRuleBlock(responsiveCss, '@media (max-width: 1360px) and (min-width: 1181px) {');
    const timelineHeaderSmallMobileCss = cssAtRuleBlock(responsiveCss, '@media (max-width: 430px) {');
    const timelineMediumToolbarCss = cssAtRuleBlock(responsiveCss, '@media (max-width: 1536px) and (min-width: 769px) {');
    const timelineMediumCenterRule = cssRuleText(timelineMediumToolbarCss, 'body.timeline-dashboard-page .schedule-command-center .schedule-command-zone--center');
    const timelineHeaderFiltersRule = cssRuleText(responsiveCss, 'body.timeline-dashboard-page .timeline-header-filters');
    const timelineViewPanelRule = cssRuleText(responsiveCss, 'body.timeline-dashboard-page .timeline-view-panel');
    const timelineInlineViewPanelRule = cssRuleText(responsiveCss, 'body.timeline-dashboard-page .schedule-command-center.toolbarContainer > .timeline-view-panel');
    const timelineViewPanelHiddenRule = cssRuleText(responsiveCss, 'body.timeline-dashboard-page .timeline-view-panel[hidden]');
    const assistantTopbarActionsRule = cssRuleText(assistantTopbarCss, '.timeline-dashboard-page .header .timeline-header-actions');
    const timelineWideDesktopHeaderRule = cssRuleText(timelineHeaderWideDesktopCss, 'body.timeline-dashboard-page .header .header-content');
    const timelineHeaderActionsRule = cssRuleText(responsiveCss, 'body.timeline-dashboard-page .header .timeline-header-actions');
    const timelineHeaderLogoutRule = cssRuleText(responsiveCss, 'body.timeline-dashboard-page .header .timeline-header-actions .timeline-header-logout');
    const timelineConstructorExistingButtonBlock = sourceBlock(
        timelineVisibilityCode,
        "if (document.getElementById('timelineConstructorBtn'))",
        'return;'
    );
    const timelineConstructorNewButtonBlock = sourceBlock(
        timelineVisibilityCode,
        "const button = document.createElement('button');",
        'bindConstructorButton(button);'
    );
    const timelineConstructorHeaderButtonTokens = [
        'timeline-header-settings-btn',
        'toolbarIconButton',
        'toolbarGhostButton'
    ];
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
    const bookingTimeControl = doc.getElementById('bookingTime');
    check('Booking create drawer exposes editable activity start time control',
        bookingTimeControl?.tagName === 'SELECT'
        && !doc.querySelector('input[type="hidden"]#bookingTime')
        && !!doc.getElementById('bookingTimeStepBack')
        && !!doc.getElementById('bookingTimeStepForward')
        && bookingFormCode.includes("'bookingTime'")
        && bookingCode.includes('function renderBookingTimeOptions')
        && bookingCode.includes('function stepBookingTimeControl')
        && bookingCode.includes('handleBookingTimeControlChange(el.value)')
        && bookingCode.includes('function scheduleBookingTimePreflightRefresh')
        && bookingCode.includes('function refreshBookingRoomSelectionContextForTimeChange')
        && bookingCode.includes('function shiftSelectedActivityScheduleDraftsByBookingTimeDelta')
        && bookingCode.includes('timeChangeToken')
        && bookingCode.includes('booking_time_room_conflict')
        && bookingCode.includes('banquet_changed_needs_confirmation')
        && fileText('js/booking-activity-schedule.js').includes('allowInvalidManualTimes')
        && panelCss.includes('.booking-time-control')
        && panelCss.includes('grid-template-columns: minmax(44px, auto) minmax(96px, 1fr) minmax(44px, auto)')
        && panelCss.includes('min-width: 0')
        && responsiveCss.includes('.info-item--booking-time')
        && responsiveCss.includes('grid-template-columns: minmax(48px, auto) minmax(0, 1fr) minmax(48px, auto)')
        && responsiveCss.includes('min-height: 44px')
        && darkModeCss.includes('body.dark-mode .booking-time-select'));
    check('Booking customer UI uses canonical park workflow while preserving compact inline compatibility', bookingCode.includes('function bookingCustomerChildrenProjection') && bookingCode.includes('function bookingCustomerChildrenDisplay') && bookingCode.includes('bookingCustomerChildLine') && bookingCode.includes('function openBookingCustomerCreateWorkflow') && bookingCode.includes('function bookingCustomerCreateWorkflowUrl') && bookingCode.includes("baseUrl.searchParams.set('action', 'create')") && bookingCode.includes("baseUrl.searchParams.set('origin', 'booking')") && bookingCode.includes("baseUrl.searchParams.set('handoff', receiver.token)") && bookingCode.includes('function handleBookingCustomerHandoffCreated') && bookingCode.includes('apiGetCustomer(normalizedCustomerId)') && bookingCode.includes('applySelectedCustomerToBookingForm') && bookingCode.includes('handoffApi.createReceiver') && bookingCode.includes("entity: 'customer'") && bookingCode.includes('function bookingInlineCustomerCreationEnabled') && bookingCode.includes('function bookingCustomerPayloadFromDraft') && bookingCode.includes("bookingInlineCustomerCreationEnabled() && BookingDrawerState.clientMode === 'new'") && bookingCode.includes('if (customer) obj.customer = customer') && htmlContains('index.html', 'bookingNewCustomerForm'));
    check('Booking lead UI opens canonical sales funnel deal handoff', htmlContains('index.html', 'bookingCreateLeadBtn') && bookingCode.includes('const BOOKING_LEAD_ACCESS_ROLES') && bookingCode.includes('function canOpenBookingLeadCreateWorkflow') && bookingCode.includes("canAccessPage('/sales-funnel')") && bookingCode.includes('function openBookingLeadCreateWorkflow') && bookingCode.includes('function bookingLeadCreateWorkflowUrl') && bookingCode.includes("baseUrl.searchParams.set('createStage', 'deal')") && bookingCode.includes("baseUrl.searchParams.set('origin', 'booking')") && bookingCode.includes("baseUrl.searchParams.set('customerId', String(selectedCustomerId))") && bookingCode.includes("entity: 'lead'") && bookingCode.includes('function handleBookingLeadHandoffCreated') && bookingCode.includes('AppState.leadConversionContext') && bookingCode.includes('BookingDrawerState.leadHandoffContext') && bookingCode.includes('obj.leadId = AppState.leadConversionContext.leadId') && htmlContains('index.html', 'option value="deal"'));
    check('Timeline period and timeline type controls are split',
        !!doc.querySelector('#periodSelector[data-schedule-view-mode-selector]')
        && !!doc.querySelector('[data-schedule-view-mode="day"][data-period="1"]')
        && !!doc.querySelector('[data-schedule-view-mode="week"][data-period="7"]')
        && !doc.querySelector('#periodSelector [data-schedule-view-mode="rooms"]')
        && !doc.querySelector('#timelineHolidaysToggle')
        && !htmlContains('index.html', 'timeline-holidays-switch')
        && !htmlContains('index.html', 'timeline-holidays-switch-thumb')
        && !htmlContains('index.html', 'Без свят')
        && !!doc.querySelector('#settingsTimelineDefaultView option[value="rooms"][selected]')
        && !!doc.getElementById('bookingPrimaryAnimatorSelect')
        && !!doc.getElementById('settingsTimelineRoomFirstEnabled')
        && !!doc.getElementById('settingsTimelineDefaultView')
        && appCode.includes('window.TimelineView.setMode(button.dataset.scheduleViewMode)')
        && htmlContains('js/timeline.js', 'function defaultTimelineViewMode()')
        && htmlContains('js/timeline.js', 'function timelineViewModeState()')
        && htmlContains('js/timeline.js', 'showHolidays: timelineShowHolidays()')
        && htmlContains('js/timeline.js', 'document.body.dataset.currentScheduleViewMode = viewMode')
        && htmlContains('js/timeline.js', 'delete document.body.dataset.scheduleViewMode')
        && htmlContains('js/timeline.js', "document.querySelectorAll('[data-schedule-view-mode-selector] [data-schedule-view-mode]')")
        && htmlContains('js/timeline.js', 'setMode: setTimelineScheduleViewMode')
        && htmlContains('js/timeline.js', 'set: setTimelineView')
        && htmlContains('js/timeline.js', 'toggleHolidays: toggleTimelineHolidays')
        && !htmlContains('js/timeline.js', "label.textContent = showHolidays ? 'Свята' : 'Без свят'")
        && htmlContains('js/timeline.js', 'defaultTimelineView')
        && htmlContains('js/timeline.js', "TIMELINE_VIEW_USER_CHOICE_VERSION = 'standard-default-v1'")
        && htmlContains('js/timeline.js', 'function normalizeStoredTimelineViewMode')
        && htmlContains('js/timeline.js', 'const requested = urlView || storedView || defaultView')
        && htmlContains('js/timeline.js', 'localStorage.removeItem(timelineViewStorageKey())')
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
    check('Timeline block click falls back when linked parent is hidden in current view',
        timelineCode.includes('function openTimelineBookingDetailsFromBlock')
        && timelineCode.includes('const targetId = ownId || linkedId')
        && timelineCode.includes('fallbackBooking: renderBooking')
        && timelineCode.includes("onMissing: collectDetailMiss(linkedId ? 'linked_child' : 'direct')")
        && timelineCode.includes("onMissing: collectDetailMiss('linked_parent')")
        && timelineCode.includes("source: 'timeline_block_click_parent_fallback'")
        && bookingCode.includes('async function showBookingDetails(bookingId, options = {})')
        && bookingCode.includes('options.silentMissing !== true')
        && bookingCode.includes('bookingDetailsOpenFailureCode')
        && !timelineCode.includes('showBookingDetails(renderBooking.linkedTo)'));
    check('Timeline booking detail modal rendering stays owned by booking.js',
        bookingCode.includes('async function showBookingDetails(bookingId, options = {})')
        && bookingCode.includes("document.getElementById('bookingDetails').innerHTML")
        && bookingCode.includes("document.getElementById('bookingModal')?.classList.remove('hidden')")
        && !timelineCode.includes('timelineOpenRecoveredBookingDetails')
        && !timelineCode.includes('TL-BK-DETAIL-RECOVERY-OPENED')
        && !timelineCode.includes("getElementById('bookingDetails')")
        && !timelineCode.includes('bookingDetails.innerHTML')
        && !timelineCode.includes('booking-detail-row'));
    check('Booking costume selector hydrates from Warehouse inventory with static fallback',
        appCode.includes('async function initializeCostumes(options = {})')
        && appCode.includes('function bookingCostumeFallbackOptions')
        && appCode.includes('BOOKING_COSTUME_FALLBACK_OPTIONS')
        && appCode.includes("BOOKING_COSTUME_NON_BOOKABLE_CONDITIONS = new Set(['damaged', 'retired'])")
        && appCode.includes('function bookingCostumeIsSelectable')
        && appCode.includes('costume.deleted === true || costume.is_deleted === true || costume.deleted_at || costume.deletedAt')
        && appCode.includes('function bookingCostumeOptionLabel')
        && appCode.includes('assigned to ${assignedName}')
        && appCode.includes('saved on booking')
        && appCode.includes('apiGetWarehouseCostumes')
        && appCode.includes('function ensureCostumeSelectOption')
        && appCode.includes("select.dataset.costumeSource = 'fallback'")
        && appCode.includes("select.dataset.costumeSource = 'warehouse'")
        && appCode.includes('renderCostumeOptions(response.data || [], { selectedValue: select.value || selectedValue })')
        && !appCode.includes('Array.isArray(COSTUMES)')
        && !appCode.includes('renderCostumeOptions([...warehouseNames, ...fallbackCostumes]')
        && bookingCode.includes('await initializeCostumes({ refreshWarehouse: true })')
        && bookingCode.includes('ensureCostumeSelectOption(booking.costume)'));
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
        && doc.querySelector('.action-buttons #adminDropdown #menuToggleBtn')
        && !doc.querySelector('.v32-controls #adminDropdown')
        && doc.getElementById('menuToggleBtn')?.querySelector('.timeline-control-icon--dots')
        && doc.querySelector('#timelineViewPanel .timeline-view-panel-actions > #historyBtn.btn-history.timeline-header-history-btn')
        && !doc.querySelector('.header .timeline-header-actions > #historyBtn')
        && !doc.getElementById('digestBtn')
        && !timelineActionMenu?.querySelector('#exportPdfBtn')
        && !timelineActionMenu?.querySelector('#exportTimelineBtn')
        && !doc.getElementById('afishaBtn')
        && !doc.getElementById('dashboardBtn')
        && !doc.getElementById('settingsBtn')
        && !doc.getElementById('certificatesBtn')
        && !timelineActionMenu?.querySelector('a[href="/programs"]')
        && !timelineActionMenu?.querySelector('a[href="/tasks"]'));
    check('Timeline print action is restored through existing print flow',
        doc.querySelector('.schedule-command-row--utility .date-controls > #exportPdfBtn.toolbarButton.toolbarGhostButton[type="button"]')
        && doc.getElementById('exportPdfBtn')?.textContent.trim() === 'Друк'
        && !doc.getElementById('exportPdfBtn')?.hasAttribute('role')
        && htmlContains('js/app.js', "document.getElementById('exportPdfBtn')")
        && htmlContains('js/app.js', 'exportTimelinePdf')
        && htmlContains('js/ui.js', 'function exportTimelinePdf')
        && htmlContains('js/ui.js', 'window.print()')
        && htmlContains('js/ui.js', 'printing-timeline')
        && htmlContains('css/timeline.css', '@media print'));
    check('Timeline day digest uses structured backend errors and actionable UI messages',
        htmlContains('js/settings.js', 'function dailyDigestFailureMessage')
        && htmlContains('js/settings.js', 'function setDailyDigestButtonLoading')
        && htmlContains('js/settings.js', "btn.classList.add('is-loading')")
        && htmlContains('js/settings.js', "code === 'NO_CHAT_ID'")
        && htmlContains('js/settings.js', "code === 'NO_BOT_TOKEN'")
        && htmlContains('js/settings.js', "code === 'TELEGRAM_SEND_FAILED'")
        && htmlContains('js/settings.js', 'readDailyDigestResponse(response)')
        && htmlContains('services/scheduler.js', 'function buildDigestSendResult')
        && htmlContains('services/scheduler.js', "code: 'NO_BOT_TOKEN'")
        && htmlContains('services/scheduler.js', "reason: 'telegram_send_failed'")
        && htmlContains('routes/telegram.js', "code: 'DIGEST_INTERNAL_ERROR'"));
    check('Timeline history opens from the filter panel with shared history behavior',
        doc.querySelector('#timelineViewPanel .timeline-view-panel-actions > #historyBtn.btn-history.timeline-header-history-btn')
        && !doc.querySelector('.header .timeline-header-actions > #historyBtn')
        && !timelineActionMenu?.querySelector('#historyBtn')
        && modalsCss.includes('.action-history-row')
        && modalsCss.includes('.action-history-modal')
        && htmlContains('js/settings.js', 'ActionHistoryView.renderList(items'));
    check('Timeline header keeps view panel, ordered topbar actions, and a utility-row view trigger',
        !!doc.querySelector('.control-panel.schedule-command-center.toolbarContainer[role="toolbar"]')
        && !doc.querySelector('.header .btn-search')
        && !doc.querySelector('.header #globalHeaderSearchBtn')
        && !html.includes('onclick="openSearch()"')
        && htmlContains('js/auth.js', "document.body?.classList?.contains('timeline-dashboard-page')")
        && !doc.querySelector('.header .header-content > .timeline-header-filters')
        && !doc.querySelector('.header .timeline-view-panel#timelineViewPanel')
        && !!doc.querySelector('.schedule-command-center > .timeline-view-panel#timelineViewPanel[hidden][aria-label="Фільтри таймлайну"]')
        && !!doc.querySelector('#timelineViewPanel > #timelineHeaderFilters.timeline-header-filters[aria-label="Фільтри таймлайну"]')
        && !doc.querySelector('.header .timeline-header-actions #timelineViewPanelToggle')
        && !!doc.querySelector('.schedule-command-row--utility .date-controls > #timelineViewPanelToggle[aria-controls="timelineViewPanel"][aria-expanded="false"][title="Відкрити фільтри таймлайну"][aria-label="Відкрити фільтри таймлайну"]')
        && doc.getElementById('timelineViewPanelToggle')?.querySelector('.timeline-filter-label')?.textContent.trim() === 'Фільтри'
        && doc.getElementById('timelineViewPanelToggle')?.textContent.trim() === 'Фільтри'
        && !doc.getElementById('timelineViewPanelSummary')
        && !doc.querySelector('#timelineViewPanelToggle .timeline-filter-summary')
        && !htmlContains('js/app.js', 'syncTimelineViewPanelSummary')
        && !htmlContains('js/app.js', 'timelineActiveControlText')
        && !htmlContains('css/responsive.css', 'timeline-filter-summary')
        && !Array.from(doc.querySelectorAll('.header .timeline-header-actions button, .schedule-command-row--utility button')).some(el => el.textContent.trim() === 'Вигляд')
        && !doc.querySelector('.header .timeline-header-actions > #historyBtn')
        && !!doc.querySelector('#timelineViewPanel .timeline-view-panel-actions > #historyBtn')
        && Array.from(doc.querySelectorAll('.header .timeline-header-actions > :is(button, span)')).map(el => el.id).join('|') === 'currentUser|logoutBtn'
        && Array.from(doc.querySelectorAll('.header .timeline-header-actions > :is(button, span)')).map(el => el.id).slice(-1)[0] === 'logoutBtn'
        && !responsiveCss.includes('filters stay hidden behind one compact popover trigger')
        && !responsiveCss.includes('compact popover')
        && !assistantTopbarCss.includes('compact popover')
        && !doc.getElementById('digestBtn')
        && !doc.querySelector('.timeline-header-filters-label')
        && !doc.querySelector('.timeline-header-filter-icon--sliders')
        && Array.from(doc.querySelectorAll('.timeline-view-panel-label')).map(el => el.textContent.trim()).join('|') === 'Статус|Період|Масштаб'
        && !!doc.querySelector('.timeline-header-filters .status-filter-controls.toolbarGroup.segmentedControl')
        && !!doc.querySelector('.timeline-header-filters #periodSelector[data-schedule-view-mode-selector]')
        && !!doc.querySelector('.timeline-header-filters .v32-controls.toolbarGroup .zoom-controls')
        && !doc.querySelector('.timeline-header-filters .timeline-compact-toggle')
        && !doc.getElementById('compactModeToggle')
        && !!doc.querySelector('.header .user-panel.timeline-header-actions #logoutBtn.timeline-header-logout[type="button"]')
        && !doc.querySelector('.timeline-header-filters #logoutBtn')
        && !doc.querySelector('.timeline-header-filters #timelineHolidaysToggle')
        && !!doc.querySelector('.schedule-command-row--utility.toolbarRow .schedule-command-zone--date.toolbarZone .date-controls.toolbarGroup')
        && !!doc.querySelector('.schedule-command-row--utility .date-controls > #exportPdfBtn.toolbarButton.toolbarGhostButton[type="button"]')
        && !!doc.querySelector('.schedule-command-row--utility .date-controls > #exportTimelineBtn.toolbarButton.toolbarGhostButton[type="button"]')
        && Array.from(doc.querySelectorAll('.schedule-command-row--utility .date-controls button, .schedule-command-row--utility .date-controls input')).map(el => el.id).join('|') === 'prevDay|timelineDate|todayBtn|nextDay|exportPdfBtn|exportTimelineBtn|timelineViewPanelToggle'
        && !doc.querySelector('.schedule-command-row--utility.toolbarRow .schedule-command-zone--actions')
        && !doc.querySelector('.schedule-command-row--utility #historyBtn')
        && !doc.querySelector('.schedule-command-row--utility #digestBtn')
        && !doc.querySelector('.schedule-command-row--utility #logoutBtn')
        && !doc.querySelector('.schedule-command-row--utility #headerThemeToggle')
        && !!doc.querySelector('.schedule-command-row--actions.toolbarRow .schedule-command-zone--actions.toolbarZone .action-buttons.toolbarGroup')
        && !!doc.querySelector('.schedule-command-row--actions .action-buttons #adminDropdown[data-menu-scope="timeline-actions"]')
        && !doc.querySelector('.schedule-command-row--main')
        && !!doc.querySelector('.schedule-command-center #timelineViewPanel .status-filter-controls')
        && !!doc.querySelector('.schedule-command-center #timelineViewPanel .timeline-view-mode-selector')
        && !!doc.querySelector('.schedule-command-center #timelineViewPanel .zoom-controls')
        && !!doc.querySelector('.schedule-command-center #timelineViewPanel .timeline-view-panel-actions #historyBtn')
        && !doc.querySelector('.v32-controls #historyBtn')
        && !doc.querySelector('.v32-controls #adminDropdown')
        && htmlContains('css/responsive.css', 'v0.77.47: compact two-row Schedule Command Center')
        && htmlContains('css/responsive.css', 'v0.77.59: three-zone Schedule Command Center layout')
        && htmlContains('css/responsive.css', 'v0.77.61: follow-up toolbar action row and non-overlapping view overlay')
        && htmlContains('css/responsive.css', 'v0.77.64: balanced top-row zones and compact view/holidays cluster')
        && htmlContains('css/responsive.css', 'Timeline view panel: keep schedule display controls in one shared selector scope.')
        && htmlContains('css/responsive.css', 'v0.77.77: header/topbar wrapping guard for the timeline shell.')
        && htmlContains('css/responsive.css', 'v0.77.83: filters open as a normal-flow collapsible shelf under the date row.')
        && htmlContains('css/responsive.css', '.timeline-view-panel')
        && htmlContains('css/responsive.css', '.timeline-view-panel[hidden]')
        && htmlContains('css/responsive.css', 'max-inline-size: 100%')
        && htmlContains('css/responsive.css', '.timeline-header-filters')
        && htmlContains('css/responsive.css', '.timeline-header-filter-group')
        && htmlContains('css/responsive.css', '.schedule-command-row--main')
        && htmlContains('css/responsive.css', '.schedule-command-zone--left')
        && htmlContains('css/responsive.css', '.schedule-command-zone--center')
        && htmlContains('css/responsive.css', '.schedule-command-zone--view')
        && htmlContains('css/responsive.css', '.schedule-command-zone--utility')
        && htmlContains('css/responsive.css', '.schedule-command-zone--actions')
        && htmlContains('css/responsive.css', '@media (max-width: 1536px) and (min-width: 769px)')
        && htmlContains('css/responsive.css', 'grid-template-areas:')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .schedule-command-center .schedule-command-zone--actions .action-buttons')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .schedule-command-row--actions')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .timeline-view-panel-actions .timeline-header-history-btn'));
    check('Timeline header regression guard forbids old search, compact, label, and second-row contracts',
        !doc.querySelector('.timeline-dashboard-page .header .btn-search')
        && !doc.querySelector('.timeline-header-filters .btn-search')
        && !doc.querySelector('.timeline-dashboard-page .header #globalHeaderSearchBtn')
        && !html.includes('onclick="openSearch()"')
        && !doc.getElementById('compactModeToggle')
        && !doc.querySelector('.timeline-header-filters .timeline-compact-toggle')
        && !doc.querySelector('.timeline-compact-toggle')
        && !doc.querySelector('.timeline-header-filters-label')
        && !doc.querySelector('.timeline-header-filter-icon--sliders')
        && !html.includes('timeline-header-filters-label')
        && !responsiveCss.includes('timeline-header-filters-label')
        && !doc.querySelector('.timeline-header-filters #logoutBtn')
        && !!doc.querySelector('.header .timeline-header-actions #logoutBtn.timeline-header-logout[type="button"]')
        && htmlContains('js/timeline-visibility.js', "document.querySelector('.timeline-header-actions')")
        && htmlContains('js/timeline-visibility.js', "host.querySelector('#headerThemeToggle')")
        && htmlContains('js/timeline-visibility.js', 'host.insertBefore(button, themeAction)')
        && htmlContains('js/timeline-visibility.js', "host.querySelector('.timeline-header-logout')")
        && htmlContains('js/timeline-visibility.js', 'host.insertBefore(button, logoutAction)')
        && !htmlContains('js/timeline-visibility.js', 'actionButtons.appendChild(button)')
        && htmlContains('js/app.js', "localStorage.removeItem(timelineStorageKey('compact_mode'))")
        && htmlContains('js/app.js', 'AppState.compactMode = false')
        && !htmlContains('js/app.js', "localStorage.getItem(timelineStorageKey('compact_mode')) === 'true'")
        && timelineHeaderFiltersRule.includes('border: 0')
        && timelineHeaderFiltersRule.includes('outline: 0')
        && timelineHeaderFiltersRule.includes('background: transparent')
        && timelineHeaderFiltersRule.includes('box-shadow: none')
        && timelineViewPanelRule.includes('position: relative')
        && timelineViewPanelRule.includes('max-inline-size: 100%')
        && timelineInlineViewPanelRule.includes('position: relative !important')
        && timelineInlineViewPanelRule.includes('top: auto !important')
        && timelineInlineViewPanelRule.includes('width: 100% !important')
        && timelineInlineViewPanelRule.includes('max-width: 100% !important')
        && !timelineInlineViewPanelRule.includes('position: absolute')
        && !timelineInlineViewPanelRule.includes('top: calc(100% + 8px)')
        && !timelineInlineViewPanelRule.includes('z-index: 140')
        && timelineViewPanelRule.includes('overflow: hidden')
        && timelineViewPanelHiddenRule.includes('display: none !important')
        && htmlContains('js/app.js', 'function setTimelineViewPanelOpen')
        && htmlContains('js/app.js', 'function initTimelineViewPanel')
        && htmlContains('js/app.js', 'panel.hidden = !nextOpen')
        && htmlContains('js/app.js', "toggle.classList.toggle('is-open', nextOpen)")
        && htmlContains('js/app.js', "classList.toggle('is-view-panel-open', nextOpen)")
        && htmlContains('js/app.js', "classList?.toggle('timeline-view-panel-open', nextOpen)")
        && htmlContains('js/app.js', "scheduleTimelineViewHeightSync(nextOpen ? 'view-panel-open' : 'view-panel-close')")
        && htmlContains('js/app.js', "event.key !== 'Escape'")
        && htmlContains('js/app.js', 'panel.contains(target)')
        && !htmlContains('js/app.js', 'scrollIntoView')
        && !doc.querySelector('.header .header-content > .timeline-header-filters')
        && timelineBrowserSmokeCode.includes('metrics.cellWidth >= 48')
        && timelineBrowserSmokeCode.includes('metrics.bookingWidth >= 150'));
    check('Timeline view panel filters keep exact visual order and direct handler hooks',
        Array.from(doc.querySelector('.timeline-header-filters')?.children || []).map(el => {
            if (el.matches('.timeline-header-filter-group--status') && el.querySelector('.status-filter-controls')) return 'status';
            if (el.matches('.timeline-header-filter-group--period') && el.querySelector('#periodSelector[data-schedule-view-mode-selector]')) return 'period';
            if (el.matches('.timeline-header-filter-group--zoom') && el.querySelector('.zoom-controls')) return 'zoom';
            return `unexpected:${el.className || el.id || el.tagName}`;
        }).join('|') === 'status|period|zoom'
        && !doc.querySelector('.timeline-header-filters-label')
        && !doc.querySelector('.timeline-header-filter-icon--sliders')
        && !doc.querySelector('.timeline-header-filters .timeline-compact-toggle')
        && !doc.getElementById('compactModeToggle')
        && Array.from(doc.querySelectorAll('.timeline-header-filter-group > .timeline-view-panel-label')).map(el => el.textContent.trim()).join('|') === 'Статус|Період|Масштаб'
        && Array.from(doc.querySelectorAll('.timeline-header-filters .status-filter-btn')).map(btn => btn.dataset.filter).join('|') === 'all|confirmed|preliminary'
        && Array.from(doc.querySelectorAll('.timeline-header-filters [data-schedule-view-mode]')).map(btn => btn.dataset.scheduleViewMode).join('|') === 'day|week'
        && Array.from(doc.querySelectorAll('.timeline-header-filters [data-timeline-view]')).length === 0
        && Array.from(doc.querySelectorAll('.schedule-command-row--utility [data-timeline-view]')).length === 0
        && Array.from(doc.querySelectorAll('.timeline-header-filters .zoom-btn')).map(btn => btn.dataset.zoom).join('|') === '15|30|60'
        && !!doc.querySelector('.header .timeline-header-actions #logoutBtn[type="button"]:not([onclick])')
        && !doc.querySelector('.timeline-header-filters #logoutBtn'));
    check('Timeline view panel keeps status, period, and scale controls distributed',
        !!doc.querySelector('.timeline-header-filter-group--status .status-filter-controls')
        && !!doc.querySelector('.timeline-header-filter-group--period .timeline-view-mode-selector')
        && !!doc.querySelector('.timeline-header-filter-group--zoom .zoom-controls')
        && !!doc.querySelector('.schedule-command-center #timelineViewPanel .status-filter-controls')
        && !doc.querySelector('.timeline-header-filters #timelineHolidaysToggle')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .timeline-header-filters .status-filter-controls')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .timeline-header-filters .period-selector')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .timeline-header-filters .zoom-controls')
        && htmlContains('css/responsive.css', 'grid-template-columns: repeat(2, minmax(0, 1fr))')
        && htmlContains('css/responsive.css', 'grid-template-columns: repeat(3, minmax(0, 1fr))')
        && htmlContains('css/responsive.css', 'min-width: 0 !important;'));
    check('Timeline medium toolbar stays compact across tablet breakpoints',
        htmlContains('css/responsive.css', '@media (max-width: 1536px) and (min-width: 769px)')
        && htmlContains('css/responsive.css', '@media (min-width: 700px) and (max-width: 768px)')
        && htmlContains('css/responsive.css', '--toolbar-control-h: 32px;')
        && htmlContains('css/responsive.css', '--toolbar-item-h: 28px;')
        && htmlContains('css/responsive.css', 'grid-template-areas:')
        && htmlContains('css/responsive.css', '"left center"')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .schedule-command-center .schedule-command-zone--left .date-navigation-cluster .day-info')
        && htmlContains('css/responsive.css', 'display: none !important;')
        && htmlContains('css/responsive.css', 'overflow-x: auto !important')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .schedule-command-center .schedule-command-zone--actions .action-buttons')
        && /justify-self:\s*stretch/.test(timelineMediumCenterRule)
        && /justify-content:\s*flex-start\s*!important;/.test(timelineMediumCenterRule)
        && /overflow-x:\s*auto\s*!important;/.test(timelineMediumCenterRule)
        && htmlContains('css/responsive.css', 'gap: 5px !important;'));
    check('Timeline toolbar controls use shared classes and requested design tokens',
        doc.querySelectorAll('.schedule-command-center .segmentedControl').length >= 3
        && doc.querySelectorAll('.timeline-header-filters .segmentedControl').length === 3
        && Array.from(doc.querySelectorAll('.status-filter-controls .segmentedItem')).map(btn => btn.dataset.filter).join('|') === 'all|confirmed|preliminary'
        && Array.from(doc.querySelectorAll('.timeline-view-mode-selector .segmentedItem')).map(btn => btn.dataset.scheduleViewMode).join('|') === 'day|week'
        && Array.from(doc.querySelectorAll('.zoom-controls .segmentedItem')).map(btn => btn.dataset.zoom).join('|') === '15|30|60'
        && !!doc.querySelector('#prevDay.toolbarIconButton.toolbarGhostButton')
        && !!doc.querySelector('#nextDay.toolbarIconButton.toolbarGhostButton')
        && !!doc.querySelector('#todayBtn.toolbarButton.toolbarGhostButton')
        && !!doc.querySelector('#menuToggleBtn.toolbarIconButton.toolbarGhostButton')
        && !!doc.querySelector('#timelineViewPanelToggle.toolbarButton.toolbarGhostButton')
        && !!doc.querySelector('#historyBtn.toolbarButton.toolbarGhostButton.timeline-header-history-btn')
        && !doc.getElementById('digestBtn')
        && !!doc.querySelector('#exportTimelineBtn.toolbarButton.toolbarGhostButton')
        && !doc.querySelector('.timeline-header-filters .timeline-compact-toggle')
        && !doc.getElementById('compactModeToggle')
        && !!doc.querySelector('.header .timeline-header-actions #logoutBtn.timeline-header-logout[type="button"]')
        && !doc.querySelector('.timeline-header-filters #logoutBtn')
        && htmlContains('js/timeline-visibility.js', "toolbarIconButton toolbarGhostButton hidden")
        && htmlContains('css/responsive.css', 'v0.77.54: shared Schedule Command Center toolbar controls')
        && timelineHeaderFiltersRule.includes('border: 0')
        && timelineHeaderFiltersRule.includes('outline: 0')
        && timelineHeaderFiltersRule.includes('background: transparent')
        && timelineHeaderFiltersRule.includes('box-shadow: none')
        && !html.includes('timeline-header-filters-label')
        && !html.includes('timeline-header-filter-icon--sliders')
        && !responsiveCss.includes('timeline-header-filters-label')
        && !responsiveCss.includes('body.timeline-dashboard-page .timeline-header-filters .timeline-compact-toggle')
        && htmlContains('css/responsive.css', '--timeline-topbar-control-h: 40px')
        && htmlContains('css/responsive.css', '--timeline-topbar-radius: 10px')
        && htmlContains('css/responsive.css', '--timeline-topbar-icon-size: 18px')
        && htmlContains('css/responsive.css', '--timeline-topbar-control-bg: var(--eg-panel-bg-soft')
        && htmlContains('css/responsive.css', '--timeline-topbar-control-bg-hover: var(--eg-surface-elevated')
        && htmlContains('css/responsive.css', '--timeline-topbar-border: var(--eg-border-default')
        && htmlContains('css/responsive.css', '--timeline-topbar-border-hover: var(--eg-border-strong')
        && htmlContains('css/responsive.css', '--timeline-topbar-text: var(--eg-text-secondary')
        && htmlContains('css/responsive.css', '--timeline-topbar-focus: var(--eg-focus-ring')
        && htmlContains('css/responsive.css', '--timeline-header-filter-border: var(--eg-border-default')
        && htmlContains('css/responsive.css', '--timeline-header-filter-control-bg: var(--eg-panel-bg-soft')
        && htmlContains('css/responsive.css', '--timeline-header-filter-hover-bg: var(--eg-surface-elevated')
        && htmlContains('css/responsive.css', '--timeline-header-filter-active-bg: var(--eg-accent')
        && htmlContains('css/responsive.css', '--timeline-header-filter-text: var(--eg-text-secondary')
        && htmlContains('css/responsive.css', 'border-radius: 999px !important')
        && htmlContains('css/responsive.css', ':focus-visible')
        && htmlContains('css/responsive.css', ':disabled')
        && htmlContains('css/responsive.css', '.is-loading')
        && htmlContains('css/responsive.css', 'aria-busy="true"'));
    check('Timeline view panel filter toolbar is theme-aware without losing light active tokens',
        htmlContains('css/responsive.css', 'body.dark-mode.timeline-dashboard-page .timeline-view-panel')
        && htmlContains('css/responsive.css', 'html[data-theme="dark"] body.timeline-dashboard-page .timeline-view-panel')
        && timelineHeaderFiltersRule.includes('background: transparent')
        && timelineHeaderFiltersRule.includes('border: 0')
        && timelineViewPanelRule.includes('background: var(--eg-surface-elevated')
        && timelineViewPanelRule.includes('border: 1px solid var(--timeline-header-filter-border)')
        && timelineViewPanelRule.includes('box-shadow: 0 10px 24px')
        && htmlContains('css/responsive.css', '--timeline-header-filter-control-bg: var(--eg-panel-bg-soft')
        && htmlContains('css/responsive.css', '--timeline-header-filter-border: var(--eg-border-default')
        && htmlContains('css/responsive.css', '--timeline-header-filter-border-strong: var(--eg-border-strong')
        && htmlContains('css/responsive.css', '--timeline-header-filter-active-bg: var(--eg-accent')
        && htmlContains('css/responsive.css', '--timeline-header-filter-text: var(--eg-text-secondary')
        && htmlContains('css/responsive.css', '--timeline-header-filter-muted: var(--eg-text-muted')
        && htmlContains('css/responsive.css', '--timeline-header-filter-focus: var(--eg-focus-ring'));
    check('Timeline schedule command center has a scoped light theme override over dark-first variables',
        htmlContains('css/responsive.css', 'Light theme keeps the schedule command bar aligned with the light CRM shell.')
        && htmlContains('css/responsive.css', 'body:not(.dark-mode).timeline-dashboard-page .schedule-command-center.toolbarContainer')
        && htmlContains('css/responsive.css', 'html[data-theme="light"] body.timeline-dashboard-page .schedule-command-center.toolbarContainer')
        && htmlContains('css/responsive.css', '--toolbar-container-bg: rgba(15, 23, 42, 0.92)')
        && htmlContains('css/responsive.css', '--toolbar-control-bg: rgba(30, 41, 59, 0.68)')
        && htmlContains('css/responsive.css', '--toolbar-inactive-text: rgba(226, 232, 240, 0.68)')
        && htmlContains('css/responsive.css', '--toolbar-container-bg: rgba(248, 250, 252')
        && htmlContains('css/responsive.css', '--toolbar-control-bg: rgba(255, 255, 255')
        && htmlContains('css/responsive.css', '--toolbar-inactive-text: #475569')
        && htmlContains('css/responsive.css', '--toolbar-active-bg: linear-gradient(135deg, #14B8A6, #0D9488)')
        && htmlContains('css/responsive.css', '.schedule-command-center.toolbarContainer .date-navigation-cluster .date-button-shell.toolbarGhostButton')
        && htmlContains('css/responsive.css', 'box-shadow: 0 0 0 3px var(--toolbar-focus-ring) !important;'));
    check('Timeline dashboard background and toolbar hierarchy reduce passive neon noise',
        darkModeCss.includes('.timeline-dashboard-page.dark-mode')
        && darkModeCss.includes('--eg-app-bg: #101827')
        && !darkModeCss.includes('--eg-app-bg: #070B10')
        && timelineVisualHierarchyCss.includes('Task 5: timeline visual hierarchy reduces neon background noise.')
        && timelineVisualHierarchyCss.includes('background: var(--eg-app-bg) !important')
        && timelineVisualHierarchyCss.includes('rgba(100, 116, 139, 0.035)')
        && timelineVisualHierarchyCss.includes('rgba(148, 163, 184, 0.035)')
        && timelineVisualHierarchyCss.includes('body.timeline-dashboard-page .grid-cell:hover')
        && timelineVisualHierarchyCss.includes('background: rgba(148, 163, 184, 0.10) !important')
        && timelineVisualHierarchyCss.includes('body.timeline-dashboard-page .grid-cell.selected')
        && timelineVisualHierarchyCss.includes('background: rgba(14, 165, 134, 0.14) !important')
        && timelineVisualHierarchyCss.includes('body.timeline-dashboard-page.dark-mode .booking-block')
        && timelineVisualHierarchyCss.includes('0 8px 18px rgba(2, 6, 23, 0.24)')
        && timelineToolbarHierarchyCss.includes('Task 5: keep cyan for active timeline state, not passive hover.')
        && timelineToolbarHierarchyCss.includes('--toolbar-hover-bg: rgba(71, 85, 105, 0.16)')
        && timelineToolbarHierarchyCss.includes('border-color: rgba(148, 163, 184, 0.22) !important')
        && timelineToolbarHierarchyCss.includes('box-shadow: none !important')
        && !/\.timeline-dashboard-page \.main-content\s*\{[^}]*url\(/.test(darkModeCss));
    check('Timeline view panel opens as a collapsible shelf under the date command row',
        htmlContains('css/responsive.css', 'body.timeline-dashboard-page .header .header-content')
        && htmlContains('css/responsive.css', 'flex-wrap: nowrap;')
        && htmlContains('css/responsive.css', 'max-inline-size: 100%;')
        && !doc.querySelector('.header .timeline-view-panel#timelineViewPanel')
        && !!doc.querySelector('.schedule-command-center > .timeline-view-panel#timelineViewPanel')
        && !!doc.querySelector('.schedule-command-row--utility + #timelineViewPanel')
        && htmlContains('css/responsive.css', 'v0.77.83: filters open as a normal-flow collapsible shelf under the date row.')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .schedule-command-center.toolbarContainer.is-view-panel-open')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .schedule-command-center.toolbarContainer > .timeline-view-panel')
        && timelineCompactCommandCss.includes('margin-bottom: 4px !important')
        && !timelineCompactCommandCss.includes('margin-bottom: 12px !important')
        && timelineCompactCommandCss.includes('body.timeline-dashboard-page .schedule-command-center.toolbarContainer:not(.is-view-panel-open)')
        && timelineCompactCommandCss.includes('gap: 0 !important')
        && timelineCompactCommandCss.includes('position: relative !important')
        && timelineViewPanelRule.includes('position: relative')
        && timelineViewPanelRule.includes('width: 100%')
        && timelineViewPanelRule.includes('max-width: 100%')
        && timelineViewPanelRule.includes('display: flex')
        && timelineViewPanelRule.includes('align-items: flex-end')
        && htmlContains('css/timeline.css', 'body.timeline-dashboard-page.timeline-view-panel-open .timeline-container')
        && htmlContains('css/timeline.css', 'calc(var(--eg-viewport-height, 100vh) - 336px)')
        && htmlContains('css/timeline.css', 'calc(var(--eg-viewport-height, 100dvh) - 336px)')
        && htmlContains('css/timeline.css', 'body.timeline-dashboard-page.timeline-view-rooms.timeline-view-panel-open .timeline-container')
        && htmlContains('css/timeline.css', 'body.timeline-dashboard-page.timeline-view-rooms.timeline-view-panel-open .timeline-scroll')
        && htmlContains('css/timeline.css', 'overflow-x: scroll;')
        && htmlContains('css/timeline.css', 'overflow-y: scroll;')
        && timelineInlineViewPanelRule.includes('position: relative !important')
        && timelineInlineViewPanelRule.includes('inset: auto !important')
        && timelineInlineViewPanelRule.includes('top: auto !important')
        && timelineInlineViewPanelRule.includes('width: 100% !important')
        && timelineInlineViewPanelRule.includes('max-inline-size: 100% !important')
        && timelineInlineViewPanelRule.includes('display: flex !important')
        && timelineInlineViewPanelRule.includes('align-items: flex-end !important')
        && !timelineInlineViewPanelRule.includes('position: absolute')
        && !timelineInlineViewPanelRule.includes('top: calc(100% + 8px)')
        && !timelineInlineViewPanelRule.includes('z-index: 140')
        && timelineViewPanelHiddenRule.includes('display: none !important')
        && timelineCompactCommandCss.includes('body.timeline-dashboard-page .schedule-command-center .schedule-command-row--actions:not(:has(.action-buttons > :not(.hidden):not([hidden]):not(.timeline-hidden-by-config):not(.timeline-permission-hidden):not(.is-empty)))')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .timeline-view-panel[hidden]')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .timeline-header-filters')
        && htmlContains('css/responsive.css', 'display: grid !important;')
        && htmlContains('css/responsive.css', 'grid-template-columns: minmax(230px, 1.25fr) minmax(150px, 0.8fr) minmax(210px, 0.9fr)')
        && htmlContains('css/responsive.css', 'grid-template-columns: minmax(220px, 1.1fr) minmax(150px, 0.8fr)')
        && htmlContains('css/responsive.css', 'gap: 9px')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .timeline-header-filter-group--status')
        && htmlContains('css/responsive.css', 'grid-column: 1 !important')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .timeline-view-panel-actions')
        && htmlContains('css/responsive.css', 'border-left: 1px solid var(--timeline-header-filter-border')
        && htmlContains('css/responsive.css', 'border-top: 1px solid var(--timeline-header-filter-border')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .timeline-view-panel-actions .timeline-header-history-btn .timeline-control-icon')
        && htmlContains('css/responsive.css', 'display: none;')
        && htmlContains('css/responsive.css', '--timeline-view-panel-segment-h: 30px')
        && htmlContains('css/responsive.css', 'v0.77.77: header/topbar wrapping guard for the timeline shell.')
        && htmlContains('css/responsive.css', '@media (min-width: 1181px)')
        && htmlContains('css/responsive.css', '@media (max-width: 1180px)')
        && htmlContains('css/responsive.css', '@media (max-width: 768px)')
        && htmlContains('css/responsive.css', 'width: 100% !important;')
        && htmlContains('css/responsive.css', 'grid-template-columns: 1fr !important')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .header .timeline-header-actions')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .header .timeline-header-actions .timeline-header-logout')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .header .timeline-header-actions .timeline-header-settings-btn')
        && htmlContains('css/responsive.css', 'min-width: 0 !important;')
        && htmlContains('css/responsive.css', 'white-space: nowrap !important;')
        && htmlContains('css/responsive.css', 'overflow: hidden !important;')
        && htmlContains('css/responsive.css', 'text-overflow: ellipsis !important;')
        && !responsiveCss.includes('wide constrained desktops need a second header row')
        && htmlContains('css/responsive.css', '@media (max-width: 1360px) and (min-width: 1181px)'));
    check('Timeline filter shelf and topbar actions have an overflow-safe contract',
        timelineViewPanelResponsiveCss.includes('@media (min-width: 1181px)')
        && timelineViewPanelResponsiveCss.includes('flex-wrap: nowrap;')
        && timelineViewPanelResponsiveCss.includes('align-items: center;')
        && timelineViewPanelRule.includes('position: relative')
        && timelineViewPanelRule.includes('width: 100%')
        && timelineViewPanelRule.includes('max-inline-size: 100%')
        && timelineInlineViewPanelRule.includes('position: relative !important')
        && timelineInlineViewPanelRule.includes('width: 100% !important')
        && !timelineInlineViewPanelRule.includes('position: absolute')
        && !timelineInlineViewPanelRule.includes('z-index: 140')
        && timelineViewPanelRule.includes('overflow: hidden')
        && timelineViewPanelHiddenRule.includes('display: none !important')
        && timelineHeaderFiltersRule.includes('display: grid !important')
        && timelineInlineViewPanelRule.includes('display: flex !important')
        && responsiveCss.includes('grid-template-columns: minmax(230px, 1.25fr) minmax(150px, 0.8fr) minmax(210px, 0.9fr) !important')
        && responsiveCss.includes('grid-template-columns: minmax(220px, 1.1fr) minmax(150px, 0.8fr) !important')
        && timelineViewPanelResponsiveCss.includes('@media (max-width: 768px)')
        && responsiveCss.includes('grid-template-columns: 1fr !important')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .schedule-command-center.toolbarContainer.is-view-panel-open')
        && htmlContains('css/responsive.css', 'width: 100% !important;')
        && timelineHeaderActionsRule.includes('margin-left: auto;')
        && timelineHeaderActionsRule.includes('border-left:')
        && timelineHeaderLogoutRule.includes('background: var(--timeline-topbar-accent)')
        && timelineHeaderLogoutRule.includes('border-color: var(--timeline-topbar-accent)')
        && htmlContains('css/responsive.css', 'font-weight: 800 !important;')
        && htmlContains('css/responsive.css', 'white-space: nowrap')
        && htmlContains('js/timeline-visibility.js', 'function constructorButtonHost()')
        && htmlContains('js/timeline-visibility.js', "document.querySelector('.timeline-header-actions')")
        && htmlContains('js/timeline-visibility.js', 'function placeConstructorButton(button)')
        && htmlContains('js/timeline-visibility.js', "host.querySelector('#headerThemeToggle')")
        && htmlContains('js/timeline-visibility.js', 'host.insertBefore(button, themeAction)')
        && htmlContains('js/timeline-visibility.js', "host.querySelector('.timeline-header-logout')")
        && htmlContains('js/timeline-visibility.js', 'host.insertBefore(button, logoutAction)')
        && !responsiveCss.includes('body.timeline-dashboard-page .timeline-header-filters .timeline-header-logout')
        && !responsiveCss.includes('body.timeline-dashboard-page .header .timeline-header-filters + .user-panel')
        && !doc.querySelector('.header .header-content > .timeline-header-filters')
        && !timelineViewPanelRule.includes('overflow-x: auto'));
    check('Timeline browser smoke guards header visibility and 15-minute geometry thresholds',
        timelineBrowserSmokeCode.includes('function assertTimelineHeaderAnd15MinuteGeometry')
        && timelineBrowserSmokeCode.includes('function assertTimelineViewPanelInteractions')
        && timelineBrowserSmokeCode.includes('page.setViewportSize({ width: 1920, height: 1080 })')
        && timelineBrowserSmokeCode.includes('{ width: 1920, height: 1080 }')
        && timelineBrowserSmokeCode.includes('{ width: 1440, height: 900 }')
        && timelineBrowserSmokeCode.includes('{ width: 1366, height: 768 }')
        && timelineBrowserSmokeCode.includes('{ width: 768, height: 900 }')
        && timelineBrowserSmokeCode.includes('{ width: 430, height: 932 }')
        && timelineBrowserSmokeCode.includes('{ width: 390, height: 844 }')
        && timelineBrowserSmokeCode.includes("await page.locator('#timelineViewPanelToggle').click()")
        && timelineBrowserSmokeCode.includes('#timelineViewPanel .status-filter-btn[data-filter="confirmed"]')
        && timelineBrowserSmokeCode.includes('#timelineViewPanel [data-schedule-view-mode="week"]')
        && timelineBrowserSmokeCode.includes('#timelineViewPanel .zoom-btn[data-zoom="${expected}"]')
        && timelineBrowserSmokeCode.includes("document.getElementById('timelineViewPanel')")
        && timelineBrowserSmokeCode.includes("document.getElementById('timelineViewPanelToggle')")
        && timelineBrowserSmokeCode.includes('const readZoomState = () => page.evaluate')
        && timelineBrowserSmokeCode.includes('const assertZoomLevel = async (level, label) =>')
        && timelineBrowserSmokeCode.includes('await assertZoomLevel(30')
        && timelineBrowserSmokeCode.includes('await assertZoomLevel(60')
        && timelineBrowserSmokeCode.includes('await assertZoomLevel(15')
        && timelineBrowserSmokeCode.includes("localStorage.getItem(key)")
        && timelineBrowserSmokeCode.includes("page.reload({ waitUntil: 'domcontentloaded' })")
        && timelineBrowserSmokeCode.includes('saved 15-minute zoom survives reload in CONFIG')
        && timelineBrowserSmokeCode.includes('saved 15-minute zoom remains in localStorage after reload')
        && timelineBrowserSmokeCode.includes("'.header .timeline-header-actions #logoutBtn'")
        && timelineBrowserSmokeCode.includes('metrics.actionsRightGap >= 0')
        && timelineBrowserSmokeCode.includes('metrics.logoutTop >= 0')
        && timelineBrowserSmokeCode.includes('metrics.searchVisible')
        && timelineBrowserSmokeCode.includes('metrics.digestVisible')
        && timelineBrowserSmokeCode.includes('metrics.compactToggleVisible')
        && timelineBrowserSmokeCode.includes('metrics.filterLabelVisible')
        && timelineBrowserSmokeCode.includes('metrics.viewPanelHidden')
        && timelineBrowserSmokeCode.includes('metrics.viewPanelLayoutVisible')
        && timelineBrowserSmokeCode.includes('metrics.viewToggleExpanded')
        && timelineBrowserSmokeCode.includes("metrics.viewToggleLabel, 'Фільтри'")
        && timelineBrowserSmokeCode.includes("metrics.visibleTimelineViewLabels.includes('Вигляд'), false")
        && timelineBrowserSmokeCode.includes('metrics.historyInTopbar, false')
        && timelineBrowserSmokeCode.includes('metrics.historyInViewPanel, true')
        && timelineBrowserSmokeCode.includes('await waitForLegacyTimelineTypeSwitchRemoved(page')
        && timelineBrowserSmokeCode.includes("metrics.dateInteractiveIds, 'prevDay|timelineDate|todayBtn|nextDay|exportPdfBtn|exportTimelineBtn|timelineViewPanelToggle'")
        && timelineBrowserSmokeCode.includes('metrics.utilityRowHeight <= 52')
        && timelineBrowserSmokeCode.includes('metrics.commandCenterHeight <= 96')
        && timelineBrowserSmokeCode.includes('metrics.closedDateToTimelineGap >= 0 && metrics.closedDateToTimelineGap <= 64')
        && timelineBrowserSmokeCode.includes('metrics.utilityRowHeight <= 144')
        && timelineBrowserSmokeCode.includes('metrics.commandCenterHeight <= 156')
        && timelineBrowserSmokeCode.includes('metrics.closedDateToTimelineGap >= 0 && metrics.closedDateToTimelineGap <= 96')
        && timelineBrowserSmokeCode.includes("openMetrics.viewPanelPosition, 'relative'")
        && timelineBrowserSmokeCode.includes('openMetrics.viewPanelLayoutVisible, true')
        && timelineBrowserSmokeCode.includes('openMetrics.viewPanelInCommandCenter, true')
        && timelineBrowserSmokeCode.includes('openMetrics.viewPanelTop >= openMetrics.utilityRowBottom - 1')
        && timelineBrowserSmokeCode.includes('opening filters grows the command center as a shelf')
        && timelineBrowserSmokeCode.includes('timeline starts below the open filter shelf')
        && timelineBrowserSmokeCode.includes('viewPanelCoversTimeline')
        && timelineBrowserSmokeCode.includes('open filter shelf does not cover the timeline container')
        && timelineBrowserSmokeCode.includes('open filter shelf does not cover timeline time labels')
        && timelineBrowserSmokeCode.includes('open filter shelf does not cover timeline rows')
        && timelineBrowserSmokeCode.includes('openMetrics.viewPanelWidth <= Math.min(1040, openMetrics.viewportWidth)')
        && timelineBrowserSmokeCode.includes('openMetrics.viewPanelHeight <= 220')
        && timelineBrowserSmokeCode.includes('openMetrics.uncontrolledOverflowX <= TIMELINE_SHELL_OVERFLOW_TOLERANCE_PX')
        && timelineBrowserSmokeCode.includes('metrics.settingsAllowed')
        && timelineBrowserSmokeCode.includes('metrics.settingsVisible')
        && timelineBrowserSmokeCode.includes("metrics.visibleTimelineControlIds, 'timelineConstructorBtn|headerThemeToggle|logoutBtn'")
        && timelineBrowserSmokeCode.includes('metrics.settingsRight <= metrics.themeLeft')
        && timelineBrowserSmokeCode.includes('metrics.themeRight <= metrics.logoutLeft')
        && timelineBrowserSmokeCode.includes('metrics.settingsDividerVisible, false')
        && timelineBrowserSmokeCode.includes('metrics.actionsBorderLeftWidth >= 1')
        && timelineBrowserSmokeCode.includes('metrics.hiddenControls')
        && timelineBrowserSmokeCode.includes('metrics.uncontrolledOverflowX <= TIMELINE_SHELL_OVERFLOW_TOLERANCE_PX')
        && timelineBrowserSmokeCode.includes('controlledTimelineScrollOffenders')
        && timelineBrowserSmokeCode.includes("localStorage.setItem('pzp_compact_mode', 'true')")
        && timelineBrowserSmokeCode.includes('metrics.compactState')
        && timelineBrowserSmokeCode.includes('metrics.compactStorage')
        && timelineBrowserSmokeCode.includes('metrics.cellWidth >= 48')
        && timelineBrowserSmokeCode.includes('metrics.bookingWidth >= 150')
        && timelineBrowserSmokeCode.includes('await assertTimelineHeaderAnd15MinuteGeometry(page, date, activity.id);'));
    check('Timeline toolbar exposes accessible pressed, loading, and focus states',
        Array.from(doc.querySelectorAll('.status-filter-controls .status-filter-btn')).every(btn => btn.tagName === 'BUTTON' && btn.getAttribute('type') === 'button' && btn.hasAttribute('aria-pressed'))
        && Array.from(doc.querySelectorAll('.status-filter-controls .status-filter-btn')).map(btn => `${btn.dataset.filter}:${btn.getAttribute('aria-pressed')}`).join('|') === 'all:true|confirmed:false|preliminary:false'
        && Array.from(doc.querySelectorAll('.timeline-view-mode-selector .timeline-view-mode-btn')).every(btn => btn.tagName === 'BUTTON' && btn.getAttribute('type') === 'button' && btn.hasAttribute('aria-pressed'))
        && Array.from(doc.querySelectorAll('.timeline-view-mode-selector .timeline-view-mode-btn')).map(btn => `${btn.dataset.scheduleViewMode}:${btn.getAttribute('aria-pressed')}`).join('|') === 'day:true|week:false'
        && !doc.querySelector('#timelineHolidaysToggle')
        && Array.from(doc.querySelectorAll('.zoom-controls .zoom-btn')).every(btn => btn.tagName === 'BUTTON' && btn.getAttribute('type') === 'button' && btn.hasAttribute('aria-pressed'))
        && !doc.querySelector('.timeline-compact-toggle')
        && !doc.getElementById('compactModeToggle')
        && Array.from(doc.querySelectorAll('.timeline-header-filter-icon')).every(icon => icon.getAttribute('aria-hidden') === 'true')
        && doc.querySelector('#logoutBtn')?.closest('.timeline-header-actions')
        && !doc.querySelector('#logoutBtn')?.closest('.timeline-header-filters')
        && doc.querySelector('#timelineViewPanelToggle[aria-controls="timelineViewPanel"][aria-expanded="false"]')
        && doc.querySelector('#timelineViewPanel[hidden] #timelineHeaderFilters')
        && doc.querySelector('#historyBtn')?.closest('#timelineViewPanel .timeline-view-panel-actions')
        && !doc.querySelector('.header .timeline-header-actions #historyBtn')
        && !doc.getElementById('digestBtn')
        && htmlContains('js/app.js', 'function syncTimelineStatusFilterButtons')
        && htmlContains('js/app.js', 'function syncTimelineCompactToggleAria')
        && htmlContains('js/app.js', 'function syncTimelineViewPanelBadge')
        && htmlContains('js/timeline.js', "b.setAttribute('aria-pressed', active ? 'true' : 'false')")
        && htmlContains('js/ui.js', "btn.setAttribute('aria-pressed', active ? 'true' : 'false')")
        && htmlContains('css/responsive.css', ':focus-visible')
        && htmlContains('css/responsive.css', 'box-shadow: 0 0 0 3px var(--toolbar-focus-ring) !important;'));
    check('Timeline filter trigger uses a stable default-state badge contract',
        !!doc.querySelector('#timelineViewPanelToggle #timelineViewPanelBadge.timeline-filter-badge[data-filter-badge][aria-hidden="true"]')
        && doc.querySelector('#timelineViewPanelToggle')?.textContent.trim() === 'Фільтри'
        && htmlContains('js/app.js', 'function getTimelineDefaultZoomLevel')
        && htmlContains('js/app.js', 'function getTimelineViewPanelActiveFilterCount')
        && htmlContains('js/app.js', "const status = String(AppState.statusFilter || 'all')")
        && htmlContains('js/app.js', "if (getTimelineShelfPeriodMode() !== 'day') count += 1")
        && htmlContains('js/app.js', 'const defaultZoom = getTimelineDefaultZoomLevel()')
        && htmlContains('js/app.js', "toggle.classList.toggle('has-active-filters', active)")
        && htmlContains('js/app.js', "toggle.dataset.filterCount = String(count)")
        && htmlContains('js/app.js', "toggle.setAttribute('data-filter-state', active ? 'custom' : 'default')")
        && htmlContains('js/app.js', "badge.textContent = active ? String(count) : ''")
        && htmlContains('js/app.js', 'window.syncTimelineViewPanelBadge = syncTimelineViewPanelBadge')
        && htmlContains('js/app.js', 'syncTimelineViewPanelBadge();')
        && htmlContains('css/responsive.css', '.timeline-filter-badge')
        && htmlContains('css/responsive.css', 'width: 16px')
        && htmlContains('css/responsive.css', 'min-width: 16px')
        && htmlContains('css/responsive.css', 'visibility: hidden')
        && htmlContains('css/responsive.css', '.timeline-header-view-btn.has-active-filters .timeline-filter-badge')
        && htmlContains('css/responsive.css', '.timeline-header-view-btn.has-active-filters')
        && htmlContains('css/responsive.css', '.schedule-command-row--utility #todayBtn')
        && htmlContains('css/responsive.css', 'background: transparent !important')
        && htmlContains('css/responsive.css', '.date-button-shell.toolbarGhostButton #timelineDate')
        && timelineBrowserSmokeCode.includes('readFilterBadgeState')
        && timelineBrowserSmokeCode.includes("filter badge starts at zero in default state")
        && timelineBrowserSmokeCode.includes("filter badge counts non-default status")
        && timelineBrowserSmokeCode.includes("filter badge counts non-default week period")
        && timelineBrowserSmokeCode.includes("filter badge reflects zoom default state"));
    check('Timeline segmented controls avoid native title tooltips and press transforms',
        Array.from(doc.querySelectorAll('.schedule-command-center :is(.status-filter-btn, .period-btn, .zoom-btn)')).length === 8
        && Array.from(doc.querySelectorAll('.schedule-command-center :is(.status-filter-btn, .period-btn, .zoom-btn)')).every(btn => !btn.hasAttribute('title'))
        && Array.from(doc.querySelectorAll('.schedule-command-center :is(.status-filter-btn, .period-btn, .zoom-btn)')).every(btn => btn.hasAttribute('aria-label'))
        && !doc.querySelector('.period-btn[data-schedule-view-mode="week"][title]')
        && !doc.querySelector('.timeline-header-filters [title]')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .schedule-command-center :where(.status-filter-btn, .period-btn, .zoom-btn):where(:hover, :focus, :focus-visible, :active)')
        && htmlContains('css/responsive.css', 'transform: none !important;'));
    check('Timeline header filter accessibility keeps semantic tab order and decorative icons quiet',
        Array.from(doc.querySelectorAll('.timeline-header-filters :is(button, input)')).map(el => (
            el.id || el.dataset.filter || el.dataset.scheduleViewMode || el.dataset.timelineView || el.dataset.zoom || el.textContent.trim()
        )).join('|') === 'all|confirmed|preliminary|day|week|15|30|60'
        && Array.from(doc.querySelectorAll('.header :is(button, input, [tabindex="0"])')).map(el => (
            el.id || el.dataset.filter || el.dataset.scheduleViewMode || el.dataset.timelineView || el.dataset.zoom || el.textContent.trim()
        )).includes('logoutBtn')
        && Array.from(doc.querySelectorAll('.timeline-header-filters .timeline-header-filter-icon')).every(icon => icon.getAttribute('aria-hidden') === 'true' && icon.tabIndex < 0)
        && !doc.querySelector('.timeline-header-filters .timeline-header-filter-icon:is(button, a, input)')
        && !doc.querySelector('.timeline-header-filters .timeline-compact-toggle')
        && !doc.getElementById('compactModeToggle')
        && htmlContains('js/app.js', "localStorage.removeItem(timelineStorageKey('compact_mode'))")
        && htmlContains('js/app.js', 'AppState.compactMode = false')
        && htmlContains('css/responsive.css', 'pointer-events: none !important;'));
    check('Timeline toolbar interaction handlers stay bound after layout rewrite',
        doc.getElementById('loginForm')?.tagName === 'FORM'
        && doc.querySelector('#prevDay[type="button"]')
        && doc.querySelector('#nextDay[type="button"]')
        && doc.querySelector('#timelineDate[type="date"]')
        && doc.querySelector('#todayBtn[type="button"]')
        && doc.querySelector('.status-filter-btn[data-filter="all"][aria-pressed="true"]')
        && doc.querySelector('.status-filter-btn[data-filter="confirmed"][aria-pressed="false"]')
        && doc.querySelector('.status-filter-btn[data-filter="preliminary"][aria-pressed="false"]')
        && doc.querySelector('#periodSelector[data-schedule-view-mode-selector]')
        && doc.querySelector('[data-schedule-view-mode="day"][aria-pressed="true"]')
        && doc.querySelector('[data-schedule-view-mode="week"][aria-pressed="false"]')
        && !doc.querySelector('#periodSelector [data-schedule-view-mode="rooms"]')
        && !doc.querySelector('#timelineHolidaysToggle[data-timeline-holidays-toggle]')
        && Array.from(doc.querySelectorAll('.zoom-controls .zoom-btn')).map(btn => `${btn.dataset.zoom}:${btn.getAttribute('aria-pressed')}`).join('|') === '15:true|30:false|60:false'
        && !doc.getElementById('compactModeToggle')
        && !doc.querySelector('.timeline-compact-toggle')
        && doc.querySelector('.header .timeline-header-actions #logoutBtn[type="button"]')
        && !doc.querySelector('.timeline-header-filters #logoutBtn')
        && !doc.getElementById('digestBtn')
        && !doc.querySelector('.header .timeline-header-actions #timelineViewPanelToggle')
        && doc.querySelector('.schedule-command-row--utility .date-controls #timelineViewPanelToggle[type="button"]')
        && doc.querySelector('#timelineViewPanel .timeline-view-panel-actions #historyBtn[type="button"]')
        && !doc.querySelector('.header .timeline-header-actions #historyBtn')
        && doc.querySelector('#adminDropdown[data-menu-scope="timeline-actions"] #menuToggleBtn[aria-haspopup="menu"][aria-expanded="false"]')
        && htmlContains('js/app.js', "document.getElementById('loginForm')?.addEventListener('submit', async (e) => {")
        && htmlContains('js/app.js', 'const result = await login(usernameEl?.value, passwordEl?.value)')
        && htmlContains('js/app.js', "document.getElementById('prevDay')?.addEventListener('click', () => changeDate(-1))")
        && htmlContains('js/app.js', "document.getElementById('nextDay')?.addEventListener('click', () => changeDate(1))")
        && htmlContains('js/app.js', "document.getElementById('timelineDate')?.addEventListener('change', async (e) => {")
        && htmlContains('js/app.js', "todayBtn.addEventListener('click', async () => {")
        && htmlContains('js/app.js', "document.querySelectorAll('.status-filter-btn').forEach(btn => {")
        && htmlContains('js/app.js', "closest?.('[data-schedule-view-mode-selector] [data-schedule-view-mode]')")
        && !htmlContains('js/app.js', "closest?.('[data-schedule-view-mode]')")
        && htmlContains('js/app.js', 'window.TimelineView.setMode(button.dataset.scheduleViewMode)')
        && !htmlContains('js/app.js', '__timelineHolidaysDelegatedBound')
        && !htmlContains('js/app.js', "closest?.('[data-timeline-holidays-toggle]')")
        && !htmlContains('js/app.js', "const holidaysToggle = document.getElementById('timelineHolidaysToggle')")
        && htmlContains('js/app.js', "historyBtnEl.addEventListener('click', showHistory)")
        && htmlContains('js/app.js', "document.getElementById('timelineViewPanelToggle')")
        && htmlContains('js/app.js', "document.getElementById('timelineViewPanel')")
        && htmlContains('js/app.js', "'Закрити фільтри таймлайну'")
        && htmlContains('js/app.js', "'Відкрити фільтри таймлайну'")
        && htmlContains('js/app.js', "classList.toggle('is-view-panel-open', nextOpen)")
        && !htmlContains('js/app.js', 'панель вигляду таймлайну')
        && htmlContains('js/app.js', 'function initTimelineViewPanel')
        && htmlContains('js/app.js', "panel.contains(target)")
        && htmlContains('js/app.js', "event.key !== 'Escape'")
        && !htmlContains('js/app.js', "digestBtn.addEventListener('click', sendDailyDigest)")
        && htmlContains('js/app.js', "document.querySelectorAll('.zoom-btn').forEach(btn => {")
        && htmlContains('js/app.js', "compactToggle.addEventListener('change', toggleCompactMode)")
        && htmlContains('js/app.js', 'function setTimelineActionMenuOpen')
        && htmlContains('js/app.js', "content.hidden = !nextOpen")
        && htmlContains('js/app.js', "closeTimelineActionMenu('outside-click')")
        && htmlContains('js/app.js', "closeTimelineActionMenu('escape')")
        && htmlContains('js/timeline-visibility.js', "button.id = 'timelineConstructorBtn'")
        && htmlContains('js/timeline-visibility.js', 'bindConstructorButton(button)')
        && htmlContains('js/timeline-visibility.js', 'openSettingsCenter()')
        && htmlContains('js/timeline.js', "document.body.dataset.currentScheduleViewMode = viewMode")
        && htmlContains('js/timeline.js', "delete document.body.dataset.scheduleViewMode")
        && htmlContains('js/timeline.js', "document.querySelectorAll('[data-schedule-view-mode-selector] [data-schedule-view-mode]')")
        && !htmlContains('js/timeline.js', "document.querySelectorAll('[data-schedule-view-mode]')"));
    check('Timeline toolbar micro-interactions stay subtle and keyboard-safe',
        htmlContains('css/responsive.css', 'transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease;')
        && htmlContains('css/responsive.css', 'transform: translateY(1px) !important;')
        && htmlContains('css/responsive.css', 'animation: scheduleToolbarSpinner 720ms linear infinite;')
        && htmlContains('css/responsive.css', 'border-top-color: transparent;')
        && !htmlContains('css/responsive.css', 'scheduleDigestPulse')
        && htmlContains('css/responsive.css', 'timeline-header-view-btn')
        && htmlContains('css/responsive.css', 'timeline-header-history-btn')
        && htmlContains('css/layout.css', 'animation: timelineActionMenuIn 140ms ease-out forwards;')
        && htmlContains('css/layout.css', 'transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease;')
        && htmlContains('js/app.js', "closeTimelineActionMenu('escape')")
        && htmlContains('js/app.js', 'function focusTimelineActionMenuItem')
        && htmlContains('js/app.js', "e.key !== 'ArrowDown'")
        && htmlContains('js/app.js', "e.key === 'ArrowUp'"));
    check('Timeline assistant rail late CSS keeps ordered topbar actions styled',
        assistantTopbarCss.includes('v0.77.78: timeline topbar utility actions keep their button geometry after late assistant topbar CSS')
        && assistantTopbarActionsRule.includes('margin-left: auto;')
        && assistantTopbarActionsRule.includes('border-left: 1px solid var(--timeline-topbar-border);')
        && assistantTopbarCss.includes('.timeline-dashboard-page .header .timeline-header-actions :where(.timeline-header-settings-btn, .timeline-header-logout, .header-theme-toggle)')
        && !assistantTopbarCss.includes('#historyBtn')
        && assistantTopbarCss.includes('.timeline-dashboard-page .header .timeline-header-actions > #currentUser {\n    order: 5;')
        && assistantTopbarCss.includes('.timeline-dashboard-page .header .timeline-header-actions > #timelineConstructorBtn {\n    order: 10;')
        && assistantTopbarCss.includes('.timeline-dashboard-page .header .timeline-header-actions > #headerThemeToggle {\n    order: 20;')
        && !assistantTopbarCss.includes('.timeline-dashboard-page .header .timeline-header-actions > #historyBtn')
        && !assistantTopbarCss.includes('.timeline-dashboard-page .header .timeline-header-actions .timeline-header-history-btn')
        && assistantTopbarCss.includes('.timeline-dashboard-page .header .timeline-header-actions > #logoutBtn {\n    order: 50;')
        && assistantTopbarCss.includes('order: 50;')
        && !assistantTopbarCss.includes('timeline-header-settings-btn--separated')
        && !assistantTopbarCss.includes('timelineViewPanelToggle')
        && !assistantTopbarCss.includes('timeline-header-view-btn')
        && !assistantTopbarCss.includes('timeline-view-panel')
        && !assistantTopbarCss.includes('timeline-header-filters')
        && !assistantTopbarCss.includes('schedule-command-row--utility')
        && assistantTopbarCss.includes('.timeline-dashboard-page .header .timeline-header-actions .toolbar-label-short')
        && assistantTopbarCss.includes('display: none;')
        && assistantTopbarCss.includes('.timeline-dashboard-page .header .timeline-header-actions .timeline-header-logout')
        && assistantTopbarCss.includes('--timeline-topbar-control-h: 40px;')
        && assistantTopbarCss.includes('--timeline-topbar-accent: var(--eg-accent);')
        && assistantAggregateCss.includes('body.timeline-dashboard-page .header .header-content.assistant-rail-mounted')
        && assistantAggregateCss.includes('body.timeline-dashboard-page .header .header-content.assistant-rail-mounted > #crmAssistantRailHost')
        && assistantAggregateCss.includes('position: static !important')
        && assistantAggregateCss.includes('body.timeline-dashboard-page .header .header-content.assistant-rail-mounted .assistant-command-panel .assistant-rail-subtitles-wrap')
        && assistantAggregateCss.includes('pointer-events: none !important')
        && assistantAggregateCss.includes('body.timeline-dashboard-page .header .header-content.assistant-rail-mounted .crm-assistant-rail[data-live="true"] .assistant-command-panel .assistant-rail-subtitles-wrap')
        && assistantAggregateCss.includes('pointer-events: auto !important')
        && timelineCompactCommandCss.includes('z-index: 70 !important')
        && timelineInlineViewPanelRule.includes('z-index: auto !important')
        && !timelineInlineViewPanelRule.includes('z-index: 140'));
    check('Timeline date navigation cluster keeps date primary with export actions and the view trigger outside topbar',
        !!doc.querySelector('.schedule-command-row--utility .schedule-command-zone--date .date-controls.date-navigation-cluster')
        && Array.from(doc.querySelectorAll('.schedule-command-row--utility .date-controls button, .schedule-command-row--utility .date-controls input')).map(el => el.id).join('|') === 'prevDay|timelineDate|todayBtn|nextDay|exportPdfBtn|exportTimelineBtn|timelineViewPanelToggle'
        && !!doc.querySelector('.date-navigation-cluster .date-button-shell > #timelineDate[type="date"]')
        && !!doc.querySelector('.date-navigation-cluster > #exportPdfBtn[type="button"].toolbarButton.toolbarGhostButton')
        && !!doc.querySelector('.date-navigation-cluster > #exportTimelineBtn[type="button"].toolbarButton.toolbarGhostButton')
        && !!doc.querySelector('.date-navigation-cluster > #timelineViewPanelToggle[aria-controls="timelineViewPanel"]')
        && doc.querySelector('.date-navigation-cluster > #timelineViewPanelToggle')?.textContent.trim() === 'Фільтри'
        && !doc.querySelector('.header .timeline-header-actions #timelineViewPanelToggle')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .schedule-command-row--utility .timeline-header-view-btn')
        && htmlContains('css/responsive.css', '--timeline-topbar-control-h: 40px;')
        && htmlContains('css/responsive.css', '--timeline-topbar-accent: var(--eg-accent, #0EA586);')
        && !!doc.querySelector('.date-navigation-cluster .date-button-calendar[aria-hidden="true"]')
        && !doc.querySelector('.date-navigation-cluster .day-info')
        && !doc.querySelector('#dayOfWeekLabel')
        && !doc.querySelector('#workingHours')
        && doc.querySelector('.date-navigation-cluster #todayBtn')?.textContent.trim() === 'Зараз'
        && htmlContains('css/responsive.css', '.date-navigation-cluster')
        && htmlContains('css/responsive.css', '.date-button-shell')
        && htmlContains('css/responsive.css', 'v0.77.79: compact date command line removes the empty full-width card shell.')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .schedule-command-center.toolbarContainer')
        && htmlContains('css/responsive.css', 'width: max-content !important;')
        && htmlContains('css/responsive.css', 'padding: 0 !important;')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .schedule-command-center .schedule-command-row--utility .date-navigation-cluster')
        && htmlContains('css/responsive.css', 'min-height: 40px !important;')
        && htmlContains('css/responsive.css', 'v0.80.39: print/image export actions live in the date row without wrapping over the timeline.')
        && htmlContains('css/responsive.css', 'flex-wrap: nowrap !important;')
        && htmlContains('css/responsive.css', '.btn-today.is-today')
        && htmlContains('css/responsive.css', 'overflow-x: auto')
        && htmlContains('css/responsive.css', 'rgba(20, 184, 166, 0.08)'));
    check('Timeline status filter segmented control is compact and keeps full labels',
        Array.from(doc.querySelectorAll('.status-filter-controls .status-filter-btn')).map(btn => btn.getAttribute('aria-label') || btn.textContent.trim()).join('|') === 'Всі|Підтверджені|Попередні'
        && !doc.querySelector('.status-filter-controls .status-filter-count')
        && htmlContains('css/responsive.css', 'v0.77.52: compact muted timeline status segmented control')
        && htmlContains('css/responsive.css', '.status-filter-controls .status-filter-btn.active')
        && htmlContains('css/responsive.css', 'font-size: 14px !important;')
        && htmlContains('css/responsive.css', 'height: 32px !important;')
        && htmlContains('css/responsive.css', 'opacity: 0.4 !important;'));
    check('Timeline header scale controls stay light without compact toggle and no scale label',
        !doc.querySelector('.schedule-command-label')
        && !htmlContains('index.html', '<span class="schedule-command-label">Масштаб:</span>')
        && Array.from(doc.querySelectorAll('.timeline-header-filters .zoom-controls .zoom-btn')).map(btn => `${btn.dataset.zoom}:${btn.textContent.trim()}`).join('|') === '15:15 хв|30:30 хв|60:60 хв'
        && !doc.querySelector('.timeline-header-filters .timeline-compact-toggle')
        && !doc.getElementById('compactModeToggle')
        && !doc.querySelector('.toggle-mini-label')
        && htmlContains('css/responsive.css', 'v0.77.53: lighter bottom-left scale and compact-mode controls')
        && htmlContains('css/responsive.css', '.timeline-header-filters .zoom-controls')
        && !htmlContains('css/responsive.css', '.timeline-header-filters .timeline-compact-toggle')
        && !htmlContains('css/responsive.css', '.timeline-compact-toggle-track')
        && htmlContains('css/responsive.css', '.timeline-header-filters :where(.segmentedItem.active, .segmentedItem[aria-pressed="true"])')
        && htmlContains('css/responsive.css', '#14B8A6'));
    check('Timeline settings toolbar action is a compact header account action with accessible labeling',
        htmlContains('js/timeline-visibility.js', "button.title = 'Налаштування'")
        && htmlContains('js/timeline-visibility.js', "button.setAttribute('aria-label', 'Налаштування')")
        && textHasAll(timelineConstructorExistingButtonBlock, timelineConstructorHeaderButtonTokens)
        && textHasAll(timelineConstructorNewButtonBlock, ['timeline-constructor-btn', 'hidden', ...timelineConstructorHeaderButtonTokens])
        && !timelineVisibilityCode.includes('timeline-header-settings-btn--separated')
        && htmlContains('js/timeline-visibility.js', "document.querySelector('.timeline-header-actions')")
        && htmlContains('js/timeline-visibility.js', "host.querySelector('#headerThemeToggle')")
        && htmlContains('js/timeline-visibility.js', 'host.insertBefore(button, themeAction)')
        && htmlContains('js/timeline-visibility.js', "host.querySelector('.timeline-header-logout')")
        && htmlContains('js/timeline-visibility.js', 'host.insertBefore(button, logoutAction)')
        && !htmlContains('js/timeline-visibility.js', 'actionButtons.appendChild(button)')
        && !doc.getElementById('timelineConstructorBtn')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .header .timeline-header-actions .timeline-header-settings-btn:focus-visible')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .header .timeline-header-actions .timeline-header-settings-btn.hidden')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .header .timeline-header-actions .timeline-header-settings-btn')
        && !responsiveCss.includes('timeline-header-settings-btn--separated')
        && htmlContains('css/responsive.css', 'width: 40px !important;')
        && htmlContains('css/responsive.css', 'border-radius: 14px !important;')
        && htmlContains('css/responsive.css', 'clip-path: inset(50%)')
        && htmlContains('css/responsive.css', '--timeline-header-filter-focus'));
    check('Timeline toolbar adapts labels and keeps small-screen priority order',
        doc.querySelector('.status-filter-btn[data-filter="confirmed"] .toolbar-label-full')?.textContent.trim() === 'Підтверджені'
        && doc.querySelector('.status-filter-btn[data-filter="confirmed"] .toolbar-label-short')?.textContent.trim() === 'Підтв.'
        && doc.querySelector('.status-filter-btn[data-filter="preliminary"] .toolbar-label-full')?.textContent.trim() === 'Попередні'
        && doc.querySelector('.status-filter-btn[data-filter="preliminary"] .toolbar-label-short')?.textContent.trim() === 'Попер.'
        && doc.querySelector('#historyBtn .toolbar-label-full')?.textContent.trim() === 'Історія змін'
        && doc.querySelector('#historyBtn .toolbar-label-short')?.textContent.trim() === 'Історія'
        && htmlContains('css/responsive.css', 'v0.77.55: responsive Schedule Command Center behavior')
        && htmlContains('css/responsive.css', '@media (min-width: 1181px)')
        && htmlContains('css/responsive.css', '@media (max-width: 1180px) and (min-width: 769px)')
        && htmlContains('css/responsive.css', '@media (max-width: 768px)')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .schedule-command-center .toolbar-label-short')
        && htmlContains('css/responsive.css', 'overflow-x: auto !important')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .schedule-command-row--actions')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .schedule-command-center .schedule-command-zone--actions .action-buttons')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .schedule-command-center .schedule-command-zone--utility .v32-controls')
        && !htmlContains('index.html', 'id="digestBtn"')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .schedule-command-center .action-buttons #adminDropdown')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .timeline-view-panel-actions .timeline-header-history-btn')
        && !htmlContains('css/responsive.css', 'body.timeline-dashboard-page .header .timeline-header-actions > #historyBtn')
        && !htmlContains('css/assistant-rail-topbar.css', '.timeline-dashboard-page .header .timeline-header-actions > #historyBtn')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .header .timeline-header-actions > #headerThemeToggle')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .header .timeline-header-actions > #timelineConstructorBtn {\n    order: 10;')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .header .timeline-header-actions > #headerThemeToggle {\n    order: 20;')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .header .timeline-header-actions > #logoutBtn')
        && htmlContains('css/responsive.css', 'order: 50;')
        && htmlContains('css/responsive.css', '.schedule-command-zone--actions')
        && htmlContains('css/responsive.css', 'overflow-x: hidden'));
    check('Timeline header filter labels expose full and short markup without duplicated CSS display',
        !!doc.querySelector('.timeline-header-filters .status-filter-btn[data-filter=confirmed] .toolbar-label-full')
        && !!doc.querySelector('.timeline-header-filters .status-filter-btn[data-filter=confirmed] .toolbar-label-short')
        && !!doc.querySelector('.timeline-header-filters .status-filter-btn[data-filter=preliminary] .toolbar-label-full')
        && !!doc.querySelector('.timeline-header-filters .status-filter-btn[data-filter=preliminary] .toolbar-label-short')
        && htmlContains('css/responsive.css', 'v0.77.69: header filter labels must not render full and short text at once.'));
    check('Timeline header filter label visibility CSS is scoped and breakpointed',
        !!doc.querySelector('.timeline-header-filters .status-filter-btn[data-filter="confirmed"] .toolbar-label-full')
        && !!doc.querySelector('.timeline-header-filters .status-filter-btn[data-filter="confirmed"] .toolbar-label-short')
        && !!doc.querySelector('.timeline-header-filters .status-filter-btn[data-filter="preliminary"] .toolbar-label-full')
        && !!doc.querySelector('.timeline-header-filters .status-filter-btn[data-filter="preliminary"] .toolbar-label-short')
        && htmlContains('css/responsive.css', 'v0.77.69: header filter labels must not render full and short text at once.')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .timeline-header-filters .toolbar-label-full')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .timeline-header-filters .toolbar-label-short')
        && htmlContains('css/responsive.css', '@media (max-width: 1536px)')
        && htmlContains('css/responsive.css', '@media (max-width: 430px)')
        && htmlContains('css/responsive.css', 'display: none;')
        && htmlContains('css/responsive.css', 'display: inline;'));
    check('Timeline header filter label CSS keeps panel labels readable without simultaneous short display',
        cssRuleSetsDisplay(responsiveCss, 'body.timeline-dashboard-page .timeline-header-filters .toolbar-label-full', 'inline')
        && cssRuleSetsDisplay(responsiveCss, 'body.timeline-dashboard-page .timeline-header-filters .toolbar-label-short', 'none')
        && cssRuleSetsDisplay(timelineHeaderLabelBreakpointCss, 'body.timeline-dashboard-page .timeline-header-filters .toolbar-label-full', 'inline')
        && cssRuleSetsDisplay(timelineHeaderLabelBreakpointCss, 'body.timeline-dashboard-page .timeline-header-filters .toolbar-label-short', 'none')
        && !cssRuleSetsDisplay(timelineHeaderNarrowDesktopCss, 'body.timeline-dashboard-page .timeline-header-filters .toolbar-label-full', 'none')
        && !cssRuleSetsDisplay(timelineHeaderNarrowDesktopCss, 'body.timeline-dashboard-page .timeline-header-filters .toolbar-label-short', 'inline')
        && /body\.timeline-dashboard-page \.timeline-header-filters \.toolbar-label-full\s*\{\s*display:\s*none;/.test(responsiveCss)
        && /body\.timeline-dashboard-page \.timeline-header-filters \.toolbar-label-short\s*\{\s*display:\s*inline;/.test(responsiveCss)
        && !cssRuleSetsDisplay(responsiveCss, 'body.timeline-dashboard-page .timeline-header-filters .toolbar-label-full', 'inline-block')
        && !cssRuleSetsDisplay(timelineHeaderLabelBreakpointCss, 'body.timeline-dashboard-page .timeline-header-filters .toolbar-label-short', 'inline-block')
        && !cssRuleSetsDisplay(timelineHeaderNarrowDesktopCss, 'body.timeline-dashboard-page .timeline-header-filters .toolbar-label-short', 'inline-block')
        && !cssRuleSetsDisplay(timelineHeaderSmallMobileCss, 'body.timeline-dashboard-page .timeline-header-filters .toolbar-label-short', 'inline-block')
        && !responsiveCss.includes('body.timeline-dashboard-page .timeline-header-filters > .timeline-header-filter-icon {\n        display: none;'));
    check('Timeline small toolbar keeps date row clean with row-scoped secondary actions',
        htmlContains('css/responsive.css', '@media (max-width: 768px)')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .schedule-command-center .schedule-command-zone')
        && htmlContains('css/responsive.css', 'overscroll-behavior-x: contain')
        && !!doc.querySelector('.schedule-command-row--utility .date-controls #prevDay')
        && !!doc.querySelector('.schedule-command-row--utility .date-controls #timelineDate')
        && !!doc.querySelector('.schedule-command-row--utility .date-controls #todayBtn')
        && !!doc.querySelector('.schedule-command-row--utility .date-controls #nextDay')
        && !doc.querySelector('.schedule-command-row--utility .action-buttons')
        && !doc.getElementById('digestBtn')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .schedule-command-center .action-buttons #adminDropdown')
        && htmlContains('css/responsive.css', 'order: 10;')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .schedule-command-center .action-buttons #adminDropdown')
        && htmlContains('css/responsive.css', 'order: 50;')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .schedule-command-center .schedule-command-zone--actions')
        && htmlContains('css/responsive.css', 'body.timeline-dashboard-page .schedule-command-row--actions')
        && htmlContains('css/responsive.css', '.schedule-command-zone--center .status-filter-controls')
        && htmlContains('css/responsive.css', 'width: auto !important')
        && htmlContains('css/responsive.css', '.schedule-command-zone--center .view-mode-controls'));
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
    check('Booking activity editor omits duplicate legacy summary rows',
        ['detailDuration', 'detailHosts', 'detailPrice', 'detailAge', 'detailKids'].every(id => !doc.getElementById(id))
        && !bookingCode.includes('за активностями')
        && !bookingCode.includes(' макс.'));
    check('Booking multi-activity frontend keeps separate activity payloads',
        bookingCode.includes('selectedActivityProgramIds')
        && bookingCode.includes('function bookingMultiActivityEnabled')
        && bookingCode.includes('function buildMultiActivityBookings')
        && bookingCode.includes('apiCreateBookingFull(booking, linked, { banquetActivities, banquetContext })')
        && bookingCode.includes('selectedActivitySecondAnimatorFields')
        && bookingCode.includes('secondAnimator: secondAnimatorFields.secondAnimator')
        && bookingCode.includes('secondAnimatorLineId: secondAnimatorFields.secondAnimatorLineId')
        && !bookingCode.includes('additionalMultiHostActivity')
        && bookingCode.includes('multiActivity'));
    check('Booking multi-activity pinatas use per-activity subflow state', bookingCode.includes('selectedActivityPinataFields') && bookingCode.includes('function renderSelectedActivityPinataSubflow') && bookingCode.includes('data-activity-pinata-field') && bookingCode.includes('activityPinata:') && bookingCode.includes('pinataMode: pinataFields.pinataMode') && panelCss.includes('.selected-activity-pinata'));
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
    check('Timeline active banquet click opens add-to-existing drawer instead of silent standalone create',
        timelineCode.includes('function normalizeTimelineActiveBanquetContext')
        && timelineCode.includes('function setTimelineActiveBanquetContext')
        && timelineCode.includes('function getTimelineActiveBanquetContextForCell')
        && /async function selectCell[\s\S]*const banquetContext = getTimelineActiveBanquetContextForCell\(cell\)[\s\S]*openBookingPanel\(cell\.dataset\.time,\s*cell\.dataset\.line,\s*\{[\s\S]*banquetContext[\s\S]*contextSource:\s*'timeline_empty_cell'/.test(timelineCode)
        && bookingCode.includes('function normalizeExplicitBookingBanquetContext')
        && bookingCode.includes('function normalizeExplicitBanquetPackageSnapshot')
        && bookingCode.includes('function applyExplicitBanquetPrefill')
        && bookingCode.includes('function resolveBookingActiveBanquetRoleIntent')
        && bookingCode.includes('function attachActiveBanquetIntentMarker')
        && bookingCode.includes("intent: 'add_to_existing'")
        && bookingCode.includes('requiresMembership: true')
        && bookingCode.includes('activeBanquetRoleIntent')
        && bookingCode.includes('function applyExplicitBookingBanquetContext')
        && bookingCode.includes('function renderActiveBanquetContextBanner')
        && bookingCode.includes('booking-active-banquet-context__role')
        && bookingCode.includes('booking-active-banquet-context')
        && bookingCode.includes('data-booking-standalone-override')
        && timelineCode.includes('function timelineActiveBanquetPackageSnapshot')
        && timelineCode.includes('packageSnapshot')
        && bookingCode.includes('function bookingCreatePathActiveBanquetRole')
        && bookingCode.includes('active_banquet_context_requires_source_booking')
        && bookingCode.includes('active_banquet_context_unresolved_path')
        && bookingCode.includes('active_banquet_context_member')
        && bookingCode.includes('active_banquet_context_activity')
        && bookingCode.includes('activeBanquetIntent')
        && bookingCode.includes('standaloneBookingOverride')
        && bookingsRouteCode.includes('BANQUET_ADD_TO_EXISTING_REQUIRES_ATOMIC_ENDPOINT')
        && bookingsRouteCode.includes('rejectExplicitBanquetAddToExistingGenericCreate(res, b)')
        && /function resolveBookingCreatePath[\s\S]*activeBanquetIntent[\s\S]*standaloneBookingOverride[\s\S]*active_banquet_context_requires_group/.test(bookingCode));
    check('Timeline browser smoke covers active banquet empty-cell grouped save',
        timelineBrowserSmokeCode.includes('function openActiveBanquetEmptyCellDrawer')
        && timelineBrowserSmokeCode.includes('function submitActiveBanquetMemberFromEmptyCell')
        && timelineBrowserSmokeCode.includes('active inspector -> empty cell')
        && timelineBrowserSmokeCode.includes('/member-booking')
        && timelineBrowserSmokeCode.includes('genericBookingRequests')
        && timelineBrowserSmokeCode.includes('does not use generic booking endpoints'));
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
    check('Booking activity image fallback keeps emoji cards when imageUrl fails',
        bookingCode.includes('function programMediaFallbackHtml')
        && bookingCode.includes('function fallbackProgramMediaImage')
        && bookingCode.includes('function handleProgramMediaImageError')
        && bookingCode.includes("container.addEventListener('error', handleProgramMediaImageError, true)")
        && bookingCode.includes('data-fallback-icon')
        && bookingCode.includes('program-media--image-failed')
        && bookingCode.includes('media.innerHTML = programMediaFallbackHtml(fallbackIcon)')
        && !bookingCode.includes('program-image-placeholder')
        && panelCss.includes('.program-media--image-failed')
        && darkModeCss.includes('body.dark-mode .program-media--image-failed'));
    const loginDisplayLabel = String(pkg.eventGenix.releaseLabel || '').replace(/^CRM\s+\d+(?:\.\d+)?\s*:\s*/i, '');
    check('login release badge shows package version once', doc.querySelector('.login-release-badge')?.textContent.trim() === `✨ ${pkg.version}`);
    check('login release badge does not duplicate release label', !doc.querySelector('.login-release-badge')?.textContent.includes(pkg.eventGenix.releaseLabel));
    check('login tagline uses clean release title without CRM marker duplication', doc.querySelector('.tagline')?.textContent === `AI First CRM v${pkg.version} — ${loginDisplayLabel}`);
    check('login changelog button keeps one version marker', doc.getElementById('changelogBtn')?.textContent.trim() === `Що нового у v${pkg.version}`);
    check('login form supports smart paste for copied credential blocks', appCode.includes('parseLoginCredentialBlock') && appCode.includes('bindSmartCredentialPaste') && appCode.includes("clipboardData?.getData('text')"));
    const completeChangelogHtml = `${html}\n${fileText('changelog-history.fragment')}`;
    const recentChangelogOrder = ['v0.55.45','v0.55.44','v0.55.43','v0.55.42','v0.55.41','v0.55.40','v0.55.39','v0.55.38','v0.55.37','v0.55.36','v0.55.35','v0.55.34','v0.55.33','v0.55.32','v0.55.31','v0.55.30','v0.55.29','v0.55.28','v0.55.27','v0.55.26','v0.55.25','v0.55.24','v0.55.23','v0.55.22','v0.55.21','v0.55.20','v0.55.19','v0.55.18','v0.55.17','v0.55.16','v0.55.15','v0.55.14','v0.55.13','v0.55.12','v0.55.11','v0.55.10','v0.55.9','v0.55.8'];
    const recentChangelogPositions = recentChangelogOrder.map(version => completeChangelogHtml.indexOf(`<h4>${version}`));
    check('changelog modal does not jump from latest v0.55 release straight to v0.55.8', recentChangelogPositions.every(pos => pos >= 0) && recentChangelogPositions.every((pos, index, list) => index === 0 || pos > list[index - 1]));
    const recent058ChangelogOrder = ['v0.58.13','v0.58.12','v0.58.11','v0.58.10','v0.58.9','v0.58.8','v0.58.7','v0.58.6','v0.58.5','v0.58.4','v0.58.3','v0.58.2','v0.58.1','v0.58.0'];
    const recent058ChangelogPositions = recent058ChangelogOrder.map(version => completeChangelogHtml.indexOf(`<h4>${version} `));
    check('changelog modal keeps the full v0.58 release history without gaps', recent058ChangelogPositions.every(pos => pos >= 0) && recent058ChangelogPositions.every((pos, index, list) => index === 0 || pos > list[index - 1]));
const recent060ChangelogOrder = ['v0.60.8','v0.60.7','v0.60.6','v0.60.5','v0.60.4','v0.60.3','v0.60.2','v0.60.1','v0.60.0'];
    const recent060ChangelogPositions = recent060ChangelogOrder.map(version => completeChangelogHtml.indexOf(`<h4>${version} `));
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
    check('HR structure exposes operational display group metadata', hrCode.includes('STAFF_DISPLAY_GROUP_LABELS') && hrCode.includes('COMPANY_STRUCTURE_DEFAULT_DISPLAY_GROUPS') && hrCode.includes('function companyStructureDisplayGroupOptions') && hrCode.includes('name="displayGroup"') && hrCode.includes('displayGroup: normalizeCompanyStructureDisplayGroupKey') && hrSurface.includes('.hr-org-node-filter'));
    check('HR structure role editor ignores backdrop misclicks and uses guarded explicit close', hrCode.includes('function requestCloseCompanyOrgNodeEditor') && hrCode.includes('nudgeCompanyOrgNodeEditor(overlay)') && !hrCode.includes('if (event.target === overlay) closeCompanyOrgNodeEditor();') && hrCode.includes('UnsafeDismissGuard.attemptCloseEditableSurface(overlay') && fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8').includes('tests/hr-org-node-modal-dismiss.test.js'));
check('HR professions use one filterable master-detail workspace instead of generic cards', hrHtml.includes('id="professionCatalogSearch"') && hrHtml.includes('id="professionCatalogStatus"') && hrHtml.includes('id="professionCatalogDepartment"') && hrHtml.includes('id="professionCatalogStructureNode"') && hrHtml.includes('id="professionCatalogStaff"') && hrHtml.includes('id="professionCatalogChecklist"') && hrHtml.includes('id="professionWorkspace"') && hrHtml.includes('data-profession-workspace-tab="main"') && hrHtml.includes('data-profession-workspace-tab="people"') && hrHtml.includes('data-profession-workspace-tab="checklist"') && hrHtml.includes('data-profession-workspace-tab="usage"') && hrCode.includes('async function openProfessionWorkspace({ id = null, key = null, initialTab =') && !hrCode.includes("formModal(current ? `Професія"));
check('HR profession workspace keeps deep links, Back, immutable existing keys, and explicit sources', hrCode.includes('function parseProfessionWorkspaceLocation') && hrCode.includes('history.back()') && hrCode.includes('professionWorkspaceHash') && hrCode.includes('professionWorkspaceKeyReadonly') && hrCode.includes("profession.source === 'system'") && hrCode.includes('captureProfessionReturnContext') && hrCode.includes('restoreProfessionReturnContext') && hrRouteCode.includes("router.get('/professions/workspace/:identity'") && hrRouteCode.includes('loadProfessionWorkspaceCatalog'));
check('HR structure uses hybrid chart/tree navigation with compact node actions', hrCode.includes('DEFAULT_COMPANY_STRUCTURE_POSITIONS') && hrCode.includes('startCompanyOrgDrag') && hrCode.includes('renderCompanyOrgLinks') && hrCode.includes('renderCompanyOrgTree') && hrCode.includes('setCompanyOrgViewMode') && hrHtml.includes('id="hrOrgViewChart"') && hrHtml.includes('id="hrOrgViewTree"') && hrHtml.includes('id="hrOrgFitBtn"') && hrCode.includes('data-org-quick-add') && hrCode.includes('data-org-quick-more') && !hrCode.includes('class="hr-org-port hr-org-port--child"') && !hrCode.includes('class="hr-org-port hr-org-port--parent"') && hrCode.includes('snapCompanyOrgCoord') && hrCode.includes('class="hr-org-link-layer"'));
check('HR structure canvas uses visible grid workspace and richer node editor', hrSurface.includes('--hr-org-grid-cell: 120px') && hrSurface.includes('.hr-org-node-editor-summary') && hrCode.includes('name="x"') && hrCode.includes('name="y"') && hrCode.includes('autoArrangeTreeCompanyOrgNodes') && hrCode.includes('resolveCompanyOrgNodeOverlaps'));
check('HR structure supports validated reparent, archive impact, and local undo redo', hrCode.includes('function reparentCompanyStructureNode') && hrCode.includes('companyOrgWouldCreateCycle') && hrCode.includes('function companyOrgNodeImpact') && hrCode.includes('Звʼязки не будуть видалені') && hrCode.includes('function undoCompanyStructureDraft') && hrCode.includes('function redoCompanyStructureDraft') && hrHtml.includes('id="hrOrgInspectorParent"') && hrHtml.includes('id="hrOrgUndoBtn"') && hrHtml.includes('id="hrOrgRedoBtn"'));
check('HR structure is responsive and keeps a keyboard-accessible inspector', hrSurface.includes('@media (max-width: 820px)') && hrSurface.includes('.hr-org-detail.is-mobile-open') && hrSurface.includes('.hr-org-tree { display: block; overflow-x: hidden; }') && hrHtml.includes('role="tree"') && hrHtml.includes('aria-label="Інспектор вузла"') && hrHtml.includes('aria-label="Скасувати останню зміну"'));
check('HR structure uses explicit draft save, conflict recovery, and safe empty loading', hrCode.includes("companyStructureLoadState = 'loading'") && hrCode.includes('function markCompanyStructureChanged') && hrCode.includes('companyStructureSavePromise') && hrCode.includes("setCompanyStructureSaveState('conflict'") && hrCode.includes('applyDefaultCompanyStructureTemplate') && !hrCode.includes('scheduleCompanyStructureAutosave') && !hrCode.includes('compactCompanyOrgNodesForOneScreen') && hrHtml.includes('id="btnRetryCompanyStructure"') && hrHtml.includes('id="btnApplyCompanyStructureTemplate"') && hrHtml.includes('id="btnReloadCompanyStructureConflict"') && hrHtml.includes('id="btnCopyCompanyStructureDraft"') && hrRouteCode.includes('hasSavedStructure'));
check('HR structure route sanitizes structured node payloads', hrRouteCode.includes('normalizeStaffCompanyStructurePayload') && hrRouteCode.includes('return normalizeStaffCompanyStructurePayload(value);') && htmlContains('services/staffDisplayGroups.js', 'function normalizeStaffCompanyStructurePayload') && htmlContains('services/staffDisplayGroups.js', 'function normalizeStaffCompanyStructureNodes') && htmlContains('services/staffDisplayGroups.js', 'displayGroup: staffStructureDisplayGroupKey({ ...source, id })') && htmlContains('services/staffDisplayGroups.js', 'collapsed: source.collapsed === true') && htmlContains('services/staffDisplayGroups.js', 'archived: source.archived === true'));
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
        && html.includes('css/pages-shell.css')
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
    const customerHeroRule = cssRuleText(customerCss, '.customer-detail-hero.entity-card-header');
    const customerHeroIdentityRule = cssRuleText(customerCss, '.customer-hero-identity');
    const customerHeroTitleRule = cssRuleText(customerCss, '.customer-detail-hero .customer-hero-title h3');
    const customerHeroActionsRule = cssRuleText(customerCss, '.customer-hero-actions');
    const customerHeroDangerRule = cssRuleText(customerCss, '.customer-hero-danger-group');
    const customerHeroActionButtonRule = cssRuleText(customerCss, '.customer-hero-actions .entity-card-action');
    const customerContactGridRule = cssRuleText(customerCss, '.entity-card-shell .detail-grid.customer-contact-grid');
    const customerPageCss = fileText('css/pages-customers.css');
    const customerTabletBlock = cssAtRuleBlock(customerPageCss, '@media (max-width: 980px)');
    const customerMobileBlock = cssAtRuleBlock(customerPageCss, '@media (max-width: 560px)');
    const customerChildFactsRule = cssRuleText(customerCss, '.customer-child-facts');
    const customerChildFactValueRule = cssRuleText(customerCss, '.customer-child-facts dd');
    const customerChildNoteRule = cssRuleText(customerCss, '.customer-child-note');
    const customerChildDietaryStylesStart = customerCss.indexOf('.customer-child-dietary-toggles');
    const customerChildDietaryStylesEnd = customerCss.indexOf('[data-theme="dark"] .customer-child-input', customerChildDietaryStylesStart);
    const customerChildDietaryStyles = customerChildDietaryStylesStart >= 0
        ? customerCss.slice(customerChildDietaryStylesStart, customerChildDietaryStylesEnd > customerChildDietaryStylesStart ? customerChildDietaryStylesEnd : undefined)
        : '';
    const customerChildDietaryNoteRule = cssRuleText(customerCss, '.customer-child-dietary-note');
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
    check('Customer children editor renders structured dietary controls', customerPageCode.includes('CUSTOMER_CHILD_DIETARY_TAGS') && customerPageCode.includes('data-child-dietary-tag') && customerPageCode.includes('aria-pressed') && customerPageCode.includes('data-child-field="dietaryNote"') && customerChildDietaryStyles.includes('.customer-child-dietary-toggle') && customerChildDietaryStyles.includes('.customer-child-dietary-tag') && customerChildDietaryStyles.includes('overflow-wrap: anywhere') && customerChildDietaryNoteRule.includes('overflow-wrap: anywhere'));
    check('Customer edit children participate in dirty state and save payload', customerPageCode.includes('editingChildren: []') && customerPageCode.includes('customerChildrenStateSignature()') && customerPageCode.includes('setCustomerEditingChildren(maysternyaMode ? [] : customerChildrenForEdit') && customerPageCode.includes('children: children.map'));
    check('Customer edit children save structured dietary payload', customerPageCode.includes('dietaryTags: child.dietaryTags || []') && customerPageCode.includes('dietaryNote: child.dietaryNote || null'));
    check('Customer detail card uses dedicated children section', customerPageCode.includes('function renderCustomerChildrenSection') && customerPageCode.includes('class="detail-section customer-children-section"') && customerPageCode.includes('class="customer-child-facts"') && customerPageCode.includes('customerChildAgeDisplay') && !customerPageCode.includes("<div class=\"field-label\">Ім'я дитини</div>") && !customerPageCode.includes('<div class="field-label">ДН дитини</div>'));
    check('Customer children section is list-based and text-safe', customerPageCode.includes('role="list"') && customerPageCode.includes('role="listitem"') && customerChildFactsRule.includes('grid-template-columns') && customerChildFactValueRule.includes('overflow-wrap: anywhere') && customerChildNoteRule.includes('overflow-wrap: anywhere') && customerPageCode.includes('customer-child-dietary') && darkCustomerChildNoteRule.includes('#CBD5E1'));
    check('Customer contact and child detail grids reflow without clipping long values', customerPageCode.includes('detail-grid customer-contact-grid') && customerContactGridRule.includes('repeat(3, minmax(0, 1fr))') && customerTabletBlock.includes('.entity-card-shell .detail-grid.customer-contact-grid') && customerTabletBlock.includes('repeat(2, minmax(0, 1fr))') && customerMobileBlock.includes('.entity-card-shell .detail-grid.customer-contact-grid') && customerMobileBlock.includes('grid-template-columns: 1fr') && customerChildFactsRule.includes('repeat(2, minmax(0, 1fr))') && customerChildNoteRule.includes('grid-column: 1 / -1'));
    check('Customer long contact values wrap without clipping or ellipsis', customerPageCss.includes('.customer-hero-contact-summary span,') && customerPageCss.includes('overflow-wrap: anywhere') && customerPageCss.includes('text-wrap: pretty') && !/\.customer-hero-contact-summary span,[\s\S]{0,500}(?:overflow:\s*hidden|text-overflow:\s*ellipsis|white-space:\s*nowrap)/.test(customerPageCss));
    check('Customer hero layout prevents action overlap', customerHeroRule.includes('display: grid') && customerHeroRule.includes('grid-template-areas') && customerHeroRule.includes('"actions actions"') && customerHeroIdentityRule.includes('min-width: 0') && customerHeroActionsRule.includes('flex-wrap: wrap') && customerHeroActionsRule.includes('grid-area: actions') && customerHeroActionButtonRule.includes('white-space: normal') && customerHeroActionButtonRule.includes('overflow-wrap: anywhere') && customerHeroDangerRule.includes('border-left'));
    check('Customer hero keeps grid ownership and isolates its nested title from sticky modal headings', !/\.customer-detail-header\s*\{[^}]*display\s*:\s*flex/i.test(html) && customerHeroTitleRule.includes('position: static') && customerHeroTitleRule.includes('margin: 0') && customerHeroTitleRule.includes('padding: 0') && customerHeroTitleRule.includes('background: transparent'));
    check('Customer dark enabled Edit action is readable without overriding disabled buttons', customerPageCss.includes('body.dark-mode #customerDetailModal .customer-hero-actions button.entity-card-action:not(.danger):not(:disabled):not([aria-disabled="true"])') && customerPageCss.includes('color: #F8FAFC') && customerPageCss.includes('background: #1E293B'));
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
    const staffHrPagesCss = fileText('css/pages-hr-staff.css');
    const uiCode = fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8');
    const staffCode = fs.readFileSync(path.join(ROOT, 'js', 'staff-page.js'), 'utf8');
    const staffScheduleShellCode = fs.readFileSync(path.join(ROOT, 'js', 'staff-schedule-shell.js'), 'utf8');
    const staffScheduleBrowserSmokeCode = fs.readFileSync(path.join(ROOT, 'tests', 'browser', 'staff-schedule-custom-range-browser-smoke.js'), 'utf8');
    const staffScheduleLiveSmokeCode = fs.readFileSync(path.join(ROOT, 'scripts', 'live-staff-schedule-smoke.js'), 'utf8');
    const pulseSwitcherCode = fs.readFileSync(path.join(ROOT, 'js', 'hr-pulse-switcher.js'), 'utf8');
    const staffPulseRenderDom = new JSDOM('<div id="staffPulseNavItems"></div>', { runScripts: 'outside-only' });
    staffPulseRenderDom.window.eval(pulseSwitcherCode);
    staffPulseRenderDom.window.HrPulseSwitcher.renderStaffNav(staffPulseRenderDom.window.document.getElementById('staffPulseNavItems'), { activeId: 'schedule' });
    const staffPulseDoc = staffPulseRenderDom.window.document;
    check('Staff schedule edit modal exists', staffScheduleShellCode.includes('id="schModalOverlay"'));
    check('Staff fill-week modal exists', staffScheduleShellCode.includes('id="fillWeekOverlay"'));
    check('Staff schedule modal uses shared top modal layer', staffPagesCss.includes('z-index: var(--z-modal, 30000)'));
    check('Base modal layer is above assistant and drawer surfaces', baseCss.includes('--z-modal: 30000') && baseCss.includes('--z-modal-confirm: 30100'));
    check('Confirm overlay uses modal confirm token', modalCss.includes('z-index: var(--z-modal-confirm, 30100)'));
    check('Shared ModalLayer guard exists', uiCode.includes('window.ModalLayer') && uiCode.includes('ensureTopLayer') && uiCode.includes('.sch-modal-overlay.visible'));
    check('Staff schedule opens through ModalLayer', staffCode.includes('ModalLayer.ensureTopLayer(overlay)'));
    check('Staff employee cells open HR profiles', staffCode.includes('data-hr-profile') && staffCode.includes('openHrProfile') && staffCode.includes('/hr?employee='));
    check('Staff employee cells keep account linking separate', staffCode.includes('[data-link-staff]') && staffCode.includes('e.target.closest'));
    check('Staff employee cells are keyboard accessible links', staffCode.includes('role="link"') && staffCode.includes("e.key !== 'Enter'") && staffCode.includes("e.key !== ' '"));
    check('Staff employee cells have profile affordance styling', staffPagesCss.includes('.emp-cell:hover') && staffPagesCss.includes('.emp-cell:focus-visible'));
    check('Staff schedule exposes managed replacement controls and state', staffScheduleShellCode.includes('id="schReplaceBtn"') && staffScheduleShellCode.includes('id="schClearReplacementBtn"') && staffScheduleShellCode.includes('id="schReplacementDetails"') && staffCode.includes('async function replaceScheduleEntry') && staffCode.includes('async function clearScheduleReplacement') && staffCode.includes('function scheduleReplacementCandidates') && staffCode.includes('sch-replacement-badge') && staffPagesCss.includes('.sch-cell.is-replacement') && staffPagesCss.includes('.sch-replacement-details[hidden]'));
    check('Staff schedule UI uses scheduleable staff guards for rows, replacements, fill, and attendance', staffCode.includes('function isScheduleableStaffForUi') && staffCode.includes('function scheduleableStaffErrorMessage') && staffCode.includes('StaffState.staff = scheduleableStaffForUi(data.data || [])') && staffCode.includes('function scheduleVisibleStaff(staffList = StaffState.staff)') && staffCode.includes('.filter(staff => isScheduleableStaffForUi(staff, entry.date))') && staffCode.includes('targetStaff = uniqueScheduleStaffById(scheduleableStaffForUi(targetStaff));') && staffCode.includes("action === 'clock-in' && staff && !isScheduleableStaffForUi(staff, todayStr())") && staffCode.includes("scheduleableStaffErrorMessage(result, 'Помилка збереження')") && staffCode.includes("scheduleableStaffErrorMessage(apiResult, 'Помилка підміни')"));
    const staffPulseTabs = [...staffPulseDoc.querySelectorAll('.staff-pulse-tab')];
    const pulseSwitcherLightTokenBlock = sourceBlock(staffPagesCss, ':where(.hr-nav--pulse, .staff-pulse-nav) {', '.hr-nav--pulse {');
    const pulseSwitcherDarkTokenBlock = sourceBlock(staffPagesCss, 'body.dark-mode :where(.hr-nav--pulse, .staff-pulse-nav),', '/* v0.73.52: /staff keeps HR Pulse navigation');
    const staffPulseNavRule = cssRuleText(staffPagesCss, '.staff-pulse-nav');
    const staffPulseNavAfterRule = cssRuleText(staffPagesCss, '.staff-pulse-nav::after');
    const staffPulseNavItemsRule = cssRuleText(staffPagesCss, '.staff-pulse-nav-items');
    const staffPulseTabRule = cssRuleText(staffPagesCss, '.staff-pulse-tab');
    const staffPulseTabIconRule = cssRuleText(staffPagesCss, '.staff-pulse-tab-icon');
    const staffPulseTabLineRule = cssRuleText(staffPagesCss, '.staff-pulse-tab-line');
    const staffScheduleCommandRule = sourceBlock(staffPagesCss, '.staff-schedule-command {', '.staff-schedule-command::before');
    const staffScheduleHrShellRule = cssRuleText(staffPagesCss, 'body.staff-schedule-hr-mode #hrStaffScheduleShell');
    const staffScheduleHrCommandRule = cssRuleText(staffPagesCss, 'body.staff-schedule-hr-mode #hrStaffScheduleShell .staff-schedule-command');
    const staffScheduleCommandContentRule = cssRuleText(staffPagesCss, '.staff-schedule-command-content');
    const staffScheduleCommandMetricsRule = cssRuleText(staffPagesCss, '.staff-schedule-command-metrics');
    const staffScheduleMetricChipRule = cssRuleText(staffPagesCss, '.staff-schedule-metric-chip');
    const staffScheduleMetricChipLabelRule = cssRuleText(staffPagesCss, '.staff-schedule-metric-chip span');
    const staffScheduleCommandHeadingRule = cssRuleText(staffPagesCss, '.staff-schedule-command .page-header h2');
    const staffPulseTabletBlock = cssAtRuleBlock(staffHrPagesCss, '@media (max-width: 1120px)');
    const staffPulseTabletNavRule = cssRuleText(staffPulseTabletBlock, '.staff-pulse-nav');
    const staffPulseTabletItemsRule = cssRuleText(staffPulseTabletBlock, '.staff-pulse-nav-items');
    const staffPulseMobileBlock = cssAtRuleBlock(staffHrPagesCss, '@media (max-width: 480px)');
    const staffPulseMobileContentRule = cssRuleText(staffPulseMobileBlock, '.staff-pulse-tab-content');
    const staffReducedMotionBlock = cssAtRuleBlock(staffHrPagesCss, '@media (prefers-reduced-motion: reduce)');
    const legacyStaffPulseNavTokens = [
        'today-nav-light.png',
        'today-nav-dark.png',
        'schedule-nav-light.png',
        'schedule-nav-dark.png',
        'reports-nav-light.png',
        'reports-nav-dark.png',
        'staff-pulse-tab-media',
        'staff-pulse-tab-img',
        'staff-pulse-tab-overlay'
    ];
    const staffPulseBoundedContainer = rule => /position:\s*relative;/.test(rule) && /overflow:\s*hidden;/.test(rule) && /contain:\s*layout paint;/.test(rule);
    const staffFunctionBlock = functionName => {
        const marker = new RegExp(`(?:async\\s+)?function\\s+${functionName}\\s*\\(`).exec(staffCode);
        if (!marker) return '';
        const start = marker.index;
        const remainder = staffCode.slice(start + marker[0].length);
        const nextFunction = /\n(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.exec(remainder);
        return staffCode.slice(start, nextFunction ? start + marker[0].length + nextFunction.index : staffCode.length);
    };
    const sharedOpenModalBlock = uiCode.slice(uiCode.indexOf('function openModal('), uiCode.indexOf('function closeModal('));
    const sharedCloseModalBlock = uiCode.slice(uiCode.indexOf('function closeModal('), uiCode.indexOf('function closeModalFromControl'));
    const staffScheduleEditingCellMatchesBlock = staffFunctionBlock('scheduleEditingCellMatches');
    const staffScheduleCellFocusTargetBlock = staffFunctionBlock('scheduleCellFocusTarget');
    const staffScheduleShiftPreferencesLoadBlock = staffFunctionBlock('loadScheduleShiftPreferences');
    const staffScheduleOpenCellBlock = staffFunctionBlock('openScheduleCell');
    const staffScheduleOpenModalBlock = staffFunctionBlock('openEditModal');
    const staffScheduleCloseModalBlock = staffFunctionBlock('closeEditModal');
    const staffScheduleHistoryLoadBlock = staffFunctionBlock('loadScheduleCellHistory');
    const staffScheduleReadOnlyModalBlock = staffFunctionBlock('setScheduleModalReadOnly');
    const staffScheduleGlobalEscapeStart = staffCode.lastIndexOf("document.addEventListener('keydown', (e) => {");
    const staffScheduleGlobalEscapeBlock = staffScheduleGlobalEscapeStart > -1
        ? staffCode.slice(staffScheduleGlobalEscapeStart, staffCode.indexOf('staffScheduleInitialized = true', staffScheduleGlobalEscapeStart))
        : '';
    const staffScheduleModalOverlayRule = cssRuleText(staffPagesCss, '.sch-modal-overlay');
    const staffScheduleModalRule = cssRuleText(staffPagesCss, '.sch-modal');
    const staffScheduleShiftModalRule = cssRuleText(staffPagesCss, '#schModalOverlay .sch-modal--schedule');
    const staffScheduleModalScrollRule = cssRuleText(staffPagesCss, '#schModalOverlay .sch-modal-scroll');
    const staffScheduleModalActionsRule = cssRuleText(staffPagesCss, '#schModalOverlay .sch-primary-actions');
    const staffScheduleModalActionButtonRule = cssRuleText(staffPagesCss, '#schModalOverlay .sch-primary-actions > button');
    const staffScheduleResponsiveBlock = sourceBlock(staffPagesCss, '/* Responsive */', '/* Account linking');
    const staffScheduleResponsivePreferenceRule = cssRuleText(staffScheduleResponsiveBlock, '.sch-shift-preference-options');
    const staffScheduleSummaryIndex = staffScheduleShellCode.indexOf('id="scheduleSummary"');
    const staffScheduleTableIndex = staffScheduleShellCode.indexOf('id="scheduleWrapper"');
    const staffScheduleHealthPanelIndex = staffScheduleShellCode.indexOf('id="scheduleHealthPanel"');
    const staffScheduleRenderBlock = staffCode.slice(staffCode.indexOf('function renderSchedule()'), staffCode.indexOf('// EDIT MODAL'));
    const staffScheduleEmpRowBlock = staffCode.slice(staffCode.indexOf('function renderEmpRow'), staffCode.indexOf('function scheduleCellFromEvent'));
    const staffScheduleCellActivationBlock = staffCode.slice(staffCode.indexOf('function scheduleCellFromEvent'), staffCode.indexOf('function renderSchedule()'));
    const staffScheduleHealthBadgeRenderBlock = staffCode.slice(staffCode.indexOf('function renderScheduleHealthBadges'), staffCode.indexOf('function renderScheduleHealthIssueList'));
    const staffSchedulePrimaryRenderBlock = staffCode.slice(staffCode.indexOf('function renderSchedule()'), staffCode.indexOf('// Group staff by department'));
    const staffScheduleViewModeBlock = staffCode.slice(staffCode.indexOf('async function setScheduleViewMode'), staffCode.indexOf('function bindScheduleViewSwitchControls'));
    const staffScheduleLoadViewBlock = staffCode.slice(staffCode.indexOf('function renderLoadView()'), staffCode.indexOf('// ACCOUNT LINKING'));
    const staffScheduleExportBlock = staffCode.slice(staffCode.indexOf('function handleExcelExport()'), staffCode.indexOf('// PRINT'));
    const staffScheduleSummaryBlock = staffCode.slice(staffCode.indexOf('function summarizeScheduleRange'), staffCode.indexOf('function renderEmpRow'));
    const staffScheduleBulkActionsBlock = staffCode.slice(staffCode.indexOf('function openFillWeekModal()'), staffCode.indexOf('// LOAD VIEW'));
    const staffScheduleWeekNavBlock = staffCode.slice(staffCode.indexOf('async function goToWeek'), staffCode.indexOf('function prevWeek'));
    const staffScheduleInitLoadBlock = staffCode.slice(staffCode.indexOf('async function initStaffSchedulePage'), staffCode.indexOf('// Event listeners'));
    const staffDeptFilterRenderBlock = staffCode.slice(staffCode.indexOf('function renderDeptFilter()'), staffCode.indexOf('function renderWeekLabel()'));
    const staffScheduleFetchBlock = staffCode.slice(staffCode.indexOf('async function fetchSchedule('), staffCode.indexOf('async function fetchScheduleAttendance'));
    const staffScheduleAttendanceFetchBlock = staffCode.slice(staffCode.indexOf('async function fetchScheduleAttendance'), staffCode.indexOf('async function fetchScheduleHours'));
    const staffScheduleRangeNavigationBlock = staffCode.slice(staffCode.indexOf('async function goToScheduleRange'), staffCode.indexOf('async function goToWeek'));
    const staffSchedulePrintBlock = staffCode.slice(staffCode.indexOf('function handlePrint()'), staffCode.indexOf('// v39.11: Add staff modal'));
    const staffScheduleNormalizeStaffIdBlock = staffFunctionBlock('normalizeScheduleStaffId');
    const staffScheduleUniqueStaffBlock = staffFunctionBlock('uniqueScheduleStaffById');
    const staffScheduleCanonicalGroupBlock = staffFunctionBlock('scheduleCanonicalDisplayGroupKey');
    const staffScheduleMembershipBlock = staffFunctionBlock('staffScheduleDepartmentKeys');
    const staffScheduleGroupingKeysBlock = staffFunctionBlock('scheduleStaffGroupingDepartmentKeys');
    const staffScheduleDepartmentCountBlock = staffFunctionBlock('scheduleDepartmentCountMap');
    const staffScheduleVisibleWithoutSearchBlock = staffFunctionBlock('scheduleStaffVisibleWithoutSearch');
    const staffScheduleGroupStaffBlock = staffFunctionBlock('groupStaffByScheduleDepartment');
    const staffScheduleFinalVisibleBlock = staffFunctionBlock('scheduleFinalVisibleStaffSnapshot');
    const staffScheduleExportVisibleBlock = staffFunctionBlock('scheduleExportVisibleStaff');
    const staffScheduleWorkbookModelBlock = staffFunctionBlock('buildScheduleWorkbookModel');
    const staffScheduleWorkbookBlock = staffFunctionBlock('buildScheduleWorkbookHtml');
    const staffScheduleDisplayNameBlock = staffFunctionBlock('scheduleStaffDisplayName');
    const staffScheduleFillModalBlock = staffFunctionBlock('openFillWeekModal');
    const staffScheduleFillSaveBlock = staffFunctionBlock('handleFillWeekSave');
    const staffScheduleCopyVisibleIdsBlock = staffFunctionBlock('scheduleCopyWeekVisibleStaffIds');
    const staffScheduleDiagnosticsHiddenRule = cssRuleText(staffPagesCss, 'body[data-page-group="hr"] .schedule-secondary-diagnostics > [hidden]');
    const staffScheduleHealthBadgeCssStart = staffPagesCss.indexOf('body[data-page-group="hr"] .schedule-health-badges');
    const staffScheduleHealthBadgeCssBlock = staffScheduleHealthBadgeCssStart > -1
        ? staffPagesCss.slice(staffScheduleHealthBadgeCssStart, staffPagesCss.indexOf('body[data-page-group="hr"] .schedule-table tr.has-health-critical', staffScheduleHealthBadgeCssStart))
        : '';
    const staffScheduleDeptChipRule = cssRuleText(staffPagesCss, 'body[data-page-group="hr"] .staff-schedule-command-bar .dept-chip');
    const staffScheduleDeptChipActiveRule = cssRuleText(staffPagesCss, 'body[data-page-group="hr"] .staff-schedule-command-bar .dept-chip.active');
    const staffScheduleDeptChipLabelRule = cssRuleText(staffPagesCss, 'body[data-page-group="hr"] .staff-schedule-command-bar .dept-chip-label');
    const staffScheduleDeptChipCountRule = cssRuleText(staffPagesCss, 'body[data-page-group="hr"] .staff-schedule-command-bar .dept-chip-count');
    const staffScheduleDeptChipDarkRule = cssRuleIncludingSelectorText(staffPagesCss, 'body.dark-mode[data-page-group="hr"] .staff-schedule-command-bar .dept-chip');
    const staffScheduleSearchRowRule = cssRuleText(staffPagesCss, 'body[data-page-group="hr"] .staff-schedule-command-bar .staff-schedule-search-row');
    const staffScheduleGroupToggleRule = cssRuleText(staffPagesCss, '.dept-row .schedule-group-toggle');
    const staffScheduleGroupCaretRule = cssRuleText(staffPagesCss, '.schedule-group-caret');
    const staffScheduleGroupCaretBeforeRule = cssRuleText(staffPagesCss, '.schedule-group-caret::before');
    const staffScheduleGroupExpandedCaretRule = cssRuleText(staffPagesCss, '.dept-row.is-expanded .schedule-group-caret');
    const staffScheduleCategoryStickyRule = cssRuleIncludingSelectorText(staffPagesCss, '.schedule-table .schedule-category-sticky-cell');
    const staffScheduleCategoryFillRule = cssRuleIncludingSelectorText(staffPagesCss, '.schedule-table .schedule-category-fill-cell');
    const staffScheduleSearchInputRule = cssRuleText(staffPagesCss, 'body[data-page-group="hr"] .staff-schedule-command-bar .staff-schedule-search');
    const staffScheduleSearchFocusRule = cssRuleText(staffPagesCss, 'body[data-page-group="hr"] .staff-schedule-command-bar .staff-schedule-search:focus');
    const staffScheduleSearchInfoRule = cssRuleText(staffPagesCss, 'body[data-page-group="hr"] .staff-schedule-command-bar .staff-schedule-filter-info');
    const staffScheduleSearchDarkRule = cssRuleIncludingSelectorText(staffPagesCss, 'body.dark-mode[data-page-group="hr"] .staff-schedule-command-bar .staff-schedule-search');
    const staffScheduleSearchInfoDarkRule = cssRuleIncludingSelectorText(staffPagesCss, 'body.dark-mode[data-page-group="hr"] .staff-schedule-command-bar .staff-schedule-filter-info');
    const staffScheduleRangeRowRule = cssRuleText(staffPagesCss, 'body[data-page-group="hr"] .staff-schedule-command-bar .staff-schedule-range-row');
    const staffScheduleDateFieldRule = cssRuleText(staffPagesCss, 'body[data-page-group="hr"] .staff-schedule-command-bar .staff-schedule-date-field');
    const staffScheduleRangeApplyRule = cssRuleText(staffPagesCss, 'body[data-page-group="hr"] .staff-schedule-command-bar .staff-schedule-range-apply');
    const staffScheduleRangePresetsRule = cssRuleText(staffPagesCss, 'body[data-page-group="hr"] .staff-schedule-command-bar .staff-schedule-range-presets');
    const staffScheduleRangeDarkRule = cssRuleIncludingSelectorText(staffPagesCss, 'body.dark-mode[data-page-group="hr"] .staff-schedule-command-bar .staff-schedule-date-input');
    const staffScheduleHeaderActionsRule = cssRuleText(staffPagesCss, 'body[data-page-group="hr"] .staff-schedule-command-bar .staff-schedule-header-actions');
    const staffScheduleHeaderActionButtonRule = cssRuleText(staffPagesCss, 'body[data-page-group="hr"] .staff-schedule-command-bar .staff-schedule-header-actions .btn-page-toolbar');
    const staffScheduleHeaderActionsDarkRule = cssRuleIncludingSelectorText(staffPagesCss, 'body.dark-mode[data-page-group="hr"] .staff-schedule-command-bar .staff-schedule-header-actions');
    const staffScheduleHeaderActionDarkRule = cssRuleIncludingSelectorText(staffPagesCss, 'body.dark-mode[data-page-group="hr"] .staff-schedule-command-bar .staff-schedule-header-actions .btn-page-toolbar');
    const staffScheduleViewSwitchRule = cssRuleText(staffPagesCss, 'body[data-page-group="hr"] .staff-schedule-command-bar .staff-schedule-view-switch');
    const staffScheduleViewOptionRule = cssRuleText(staffPagesCss, 'body[data-page-group="hr"] .staff-schedule-command-bar .staff-schedule-view-option');
    const staffScheduleViewOptionActiveRule = cssRuleIncludingSelectorText(staffPagesCss, 'body[data-page-group="hr"] .staff-schedule-command-bar .staff-schedule-view-option.active');
    const staffScheduleViewSwitchDarkRule = cssRuleIncludingSelectorText(staffPagesCss, 'body.dark-mode[data-page-group="hr"] .staff-schedule-command-bar .staff-schedule-view-switch');
    const staffFillPeriodHintRule = cssRuleText(staffPagesCss, '#fillWeekOverlay .fill-period-hint');
    const staffScheduleCommandBarRule = cssRuleText(staffPagesCss, 'body[data-page-group="hr"] .staff-schedule-command-bar');
    const staffScheduleCommandBarControlsRule = cssRuleText(staffPagesCss, 'body[data-page-group="hr"] .staff-schedule-command-bar .schedule-controls');
    const staffScheduleCommandBarControlsDarkRule = cssRuleIncludingSelectorText(staffPagesCss, 'body.dark-mode[data-page-group="hr"] .staff-schedule-command-bar .schedule-controls');
    const staffScheduleCommandBarDarkRule = cssRuleIncludingSelectorText(staffPagesCss, 'body.dark-mode[data-page-group="hr"] .staff-schedule-command-bar');
    const staffScheduleCommandBarWeekNavRule = cssRuleText(staffPagesCss, 'body[data-page-group="hr"] .staff-schedule-command-bar .schedule-controls .week-nav');
    const staffScheduleCommandBarWeekButtonRule = cssRuleText(staffPagesCss, 'body[data-page-group="hr"] .staff-schedule-command-bar .schedule-controls .week-nav button');
    const staffScheduleCommandBarWeekLabelRule = cssRuleText(staffPagesCss, 'body[data-page-group="hr"] .staff-schedule-command-bar .schedule-controls .week-label');
    const staffScheduleCellFocusRule = cssRuleText(staffPagesCss, '.sch-cell:focus-visible');
    const staffScheduleMobileCommandStart = staffPagesCss.search(/@media \(max-width: 768px\) \{\r?\n    body\[data-page-group="hr"\] \.staff-schedule-command-bar/);
    const staffScheduleMobileCommandBlock = staffScheduleMobileCommandStart > -1
        ? staffPagesCss.slice(staffScheduleMobileCommandStart, staffPagesCss.indexOf('@media (max-width: 480px)', staffScheduleMobileCommandStart))
        : '';
    check('Shared modal lifecycle keeps legacy hidden defaults while supporting custom schedule modal options',
        sharedOpenModalBlock.includes('function openModal(modalEl, triggerEl, options = {})')
        && sharedOpenModalBlock.includes("if (typeof options.show === 'function') options.show(modalEl)")
        && sharedOpenModalBlock.includes("else modalEl.classList.remove('hidden')")
        && sharedOpenModalBlock.includes('const preferred = resolveModalLifecycleTarget(options.initialFocus, modalEl)')
        && sharedOpenModalBlock.includes("if (typeof options.onRequestClose === 'function')")
        && sharedOpenModalBlock.includes("options.onRequestClose({ reason: 'escape', modal: modalEl })")
        && sharedOpenModalBlock.includes('e.preventDefault()')
        && sharedOpenModalBlock.includes('e.stopPropagation()')
        && sharedCloseModalBlock.includes('const lifecycleOptions = { ...(trapState.options || {}), ...options }')
        && sharedCloseModalBlock.includes("if (typeof lifecycleOptions.hide === 'function') lifecycleOptions.hide(modalEl)")
        && sharedCloseModalBlock.includes("else modalEl.classList.add('hidden')")
        && sharedCloseModalBlock.includes('resolveModalLifecycleTarget(lifecycleOptions.restoreFocus, modalEl) || trapState.trigger'));
    check('Staff schedule modal async reads and dismiss requests are stale-safe and single-flight',
        staffScheduleEditingCellMatchesBlock.includes("overlay?.classList.contains('visible')")
        && staffScheduleEditingCellMatchesBlock.includes('editing.rangeKey === rangeKey')
        && staffScheduleShiftPreferencesLoadBlock.includes('++StaffState.shiftPreferencesLoadSeq')
        && staffScheduleShiftPreferencesLoadBlock.includes('seq !== StaffState.shiftPreferencesLoadSeq')
        && staffScheduleShiftPreferencesLoadBlock.includes('scheduleEditingCellMatches(numericStaffId, requestedDate, requestedRangeKey)')
        && staffScheduleHistoryLoadBlock.includes('++StaffState.scheduleHistoryLoadSeq')
        && staffScheduleHistoryLoadBlock.includes('scheduleCellHistoryAbortController.abort()')
        && staffScheduleHistoryLoadBlock.includes('fetchScheduleHistory(numericStaffId, normalizedDate, { signal: controller?.signal })')
        && staffScheduleHistoryLoadBlock.includes('seq !== StaffState.scheduleHistoryLoadSeq')
        && staffScheduleHistoryLoadBlock.includes('scheduleEditingCellMatches(numericStaffId, normalizedDate, requestedRangeKey)')
        && staffScheduleCloseModalBlock.includes('if (_staffScheduleClosePromise) return _staffScheduleClosePromise')
        && staffScheduleCloseModalBlock.includes('_staffScheduleClosePromise = closeRequest')
        && staffScheduleCloseModalBlock.includes('if (_staffScheduleClosePromise === closeRequest) _staffScheduleClosePromise = null')
        && staffScheduleCloseModalBlock.includes('StaffState.scheduleHistoryLoadSeq += 1')
        && staffScheduleCloseModalBlock.includes('StaffState.shiftPreferencesLoadSeq += 1')
        && staffScheduleCloseModalBlock.includes('scheduleCellHistoryAbortController.abort()'));
    check('Staff schedule shift modal uses shared focus lifecycle and isolates Escape from legacy overlays',
        staffScheduleOpenCellBlock.includes("department: cell.dataset.scheduleDepartment || ''")
        && staffScheduleOpenCellBlock.includes("professionKey: cell.dataset.scheduleProfession || ''")
        && staffScheduleOpenModalBlock.includes('openModal(overlay, trigger, {')
        && staffScheduleOpenModalBlock.includes('show: modal =>')
        && staffScheduleOpenModalBlock.includes('hide: modal =>')
        && staffScheduleOpenModalBlock.includes('initialFocus: () => StaffState.canManage')
        && staffScheduleOpenModalBlock.includes("document.getElementById('schStatus')")
        && staffScheduleOpenModalBlock.includes("document.getElementById('schCancelBtn')")
        && staffScheduleOpenModalBlock.includes('onRequestClose: () => closeEditModal(false)')
        && staffScheduleOpenModalBlock.includes('restoreFocus: () => scheduleCellFocusTarget(staffId, date, trigger, sectionDepartment)')
        && staffScheduleCellFocusTargetBlock.includes('document.querySelector(selector)')
        && staffScheduleCellFocusTargetBlock.includes("document.getElementById('scheduleStaffSearch')")
        && staffScheduleCellFocusTargetBlock.includes("document.getElementById('scheduleWrapper')")
        && staffScheduleGlobalEscapeBlock.includes("e.key !== 'Escape' || e.defaultPrevented")
        && !staffScheduleGlobalEscapeBlock.includes('closeEditModal'));
    check('Staff schedule shift modal exposes labelled controls, read-only context, and live history semantics',
        /id="schModalOverlay"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="schModalTitle"/.test(staffScheduleShellCode)
        && !/id="schModalOverlay"[^>]*aria-label=/.test(staffScheduleShellCode)
        && ['schStatus', 'schPrimaryProfession', 'schNote'].every(id => staffScheduleShellCode.includes(`<label for="${id}">`))
        && staffScheduleShellCode.includes('id="schSegmentsList"')
        && staffScheduleShellCode.includes('id="schAddSegmentBtn"')
        && staffScheduleShellCode.includes('id="schPlanSummary"')
        && staffCode.includes('data-segment-field="profession"')
        && staffCode.includes('data-segment-field="start"')
        && staffCode.includes('data-segment-field="end"')
        && !/<input(?=[^>]*id="schNote")(?=[^>]*aria-label=)[^>]*>/.test(staffScheduleShellCode)
        && staffScheduleShellCode.includes('class="sch-history-panel" role="region" aria-labelledby="schHistoryTitle"')
        && staffScheduleShellCode.includes('id="schHistoryTitle"')
        && /id="schHistoryList"[^>]*aria-live="polite"[^>]*aria-busy="false"/.test(staffScheduleShellCode)
        && staffScheduleReadOnlyModalBlock.includes("overlay.setAttribute('aria-describedby', 'schReadOnlyHint')")
        && staffScheduleReadOnlyModalBlock.includes("overlay.removeAttribute('aria-describedby')"));
    check('Staff schedule tables expose captions and column header scopes',
        (staffScheduleShellCode.match(/<caption class="staff-schedule-table-caption">/g) || []).length === 2
        && staffScheduleRenderBlock.includes('<th scope="col">')
        && staffScheduleRenderBlock.includes('<th scope="col" class="${isToday ?')
        && staffScheduleLoadViewBlock.includes('<th scope="col">')
        && staffScheduleLoadViewBlock.includes("<th scope=\"col\" class=\"${isToday ?")
        && (staffScheduleLoadViewBlock.match(/scope="col"/g) || []).length >= 3);
    check('Staff schedule shift modal stays bounded and operable on narrow viewports',
        /overflow-y:\s*auto;/.test(staffScheduleModalOverlayRule)
        && /overscroll-behavior:\s*contain;/.test(staffScheduleModalOverlayRule)
        && /max-height:\s*calc\(100dvh\s*-\s*32px\);/.test(staffScheduleModalRule)
        && /margin:\s*auto\s+0;/.test(staffScheduleModalRule)
        && /display:\s*flex;/.test(staffScheduleShiftModalRule)
        && /flex-direction:\s*column;/.test(staffScheduleShiftModalRule)
        && /overflow:\s*hidden;/.test(staffScheduleShiftModalRule)
        && /flex:\s*1\s+1\s+auto;/.test(staffScheduleModalScrollRule)
        && /min-height:\s*0;/.test(staffScheduleModalScrollRule)
        && /overflow-y:\s*auto;/.test(staffScheduleModalScrollRule)
        && /flex:\s*0\s+0\s+auto;/.test(staffScheduleModalActionsRule)
        && /min-height:\s*44px;/.test(staffScheduleModalActionButtonRule)
        && staffScheduleResponsiveBlock.includes('@media (max-width: 768px)')
        && /grid-template-columns:\s*1fr;/.test(staffScheduleResponsivePreferenceRule));
    check('Staff schedule keeps premium HR Pulse switcher and unified panel rhythm',
        !!doc.getElementById('staffScheduleShell')
        && doc.getElementById('staffScheduleShell')?.dataset.staffScheduleShell === 'standalone'
        && html.includes('js/staff-schedule-shell.js?v=0.81.35')
        && html.includes('js/hr-pulse-switcher.js?v=0.81.35')
        && staffScheduleShellCode.includes('function scheduleWorkspaceTemplate')
        && staffScheduleShellCode.includes('function scheduleModalTemplate')
        && staffScheduleShellCode.includes('window.StaffScheduleShell')
        && staffScheduleShellCode.includes('class="staff-pulse-nav"')
        && staffScheduleShellCode.includes('id="staffPulseNavItems"')
        && staffScheduleShellCode.includes('data-pulse-switcher="staff"')
        && staffCode.includes('function renderStaffPulseSwitcher')
        && staffCode.includes('function initStaffSchedulePage')
        && staffCode.includes('function ensureStaffScheduleShell')
        && staffCode.includes('function shouldAutoInitStaffSchedulePage')
        && staffCode.includes('window.StaffSchedulePage')
        && staffCode.includes("includePulseNav: mode !== 'hr'")
        && !staffCode.includes('function isStaffScheduleEmbedMode')
        && !staffCode.includes('function applyStaffScheduleEmbedMode')
        && !staffCode.includes("params.get('embed')")
        && staffCode.includes("const user = typeof AppState !== 'undefined' ? AppState.currentUser : null")
        && staffCode.includes("switcher.renderStaffNav(container, { activeId: 'schedule', user })")
        && pulseSwitcherCode.includes('const PULSE_ITEMS')
        && pulseSwitcherCode.includes("id: 'today'")
        && pulseSwitcherCode.includes("id: 'schedule'")
        && pulseSwitcherCode.includes("id: 'reports'")
        && pulseSwitcherCode.includes('function renderStaffNav')
        && staffPulseTabs.length === 3
        && !!staffPulseDoc.querySelector('.staff-pulse-tab[href="/hr#today"][data-pulse-tone="people"]')
        && !!staffPulseDoc.querySelector('.staff-pulse-tab.active[href="/staff"][aria-current="page"][data-pulse-tone="schedule"]')
        && !!staffPulseDoc.querySelector('.staff-pulse-tab[href="/hr#reports"][data-pulse-tone="reports"]')
        && staffPulseDoc.querySelectorAll('.staff-pulse-tab-icon[aria-hidden="true"] svg').length === 3
        && staffPulseDoc.querySelectorAll('.staff-pulse-tab-content .staff-pulse-tab-title').length === 3
        && staffPulseDoc.querySelectorAll('.staff-pulse-tab-content .staff-pulse-tab-subtitle').length === 3
        && staffPulseDoc.querySelectorAll('.staff-pulse-tab-badge,[data-pulse-badge]').length === 0
        && staffPulseDoc.querySelectorAll('.staff-pulse-tab-line[aria-hidden="true"]').length === 3
        && staffScheduleShellCode.includes('class="staff-schedule-command"')
        && !staffScheduleShellCode.includes('class="staff-schedule-command-metrics"')
        && !staffScheduleShellCode.includes('id="scheduleHeaderPeriod"')
        && !staffScheduleShellCode.includes('id="scheduleHeaderDepartment"')
        && !staffScheduleShellCode.includes('id="scheduleHeaderStaffCount"')
        && !staffScheduleShellCode.includes('id="scheduleHeaderStatus"')
        && staffPagesCss.includes('v0.77.102: HR and Staff Pulse switchers share one visual token contract')
        && staffPagesCss.includes('--pulse-switcher-card-width: clamp(172px, 15vw, 210px);')
        && staffPagesCss.includes('--pulse-switcher-card-width: clamp(168px, 14vw, 196px);')
        && staffPagesCss.includes('--pulse-switcher-hover-shadow')
        && staffPagesCss.includes('--pulse-switcher-focus-shadow')
        && staffPagesCss.includes('v0.73.52: /staff keeps HR Pulse navigation and schedule panels in one visual rhythm')
        && staffPagesCss.includes('.staff-pulse-nav-items')
        && staffPulseNavItemsRule.includes('grid-template-columns: repeat(3, minmax(0, 1fr));')
        && staffPagesCss.includes('.staff-pulse-tab-icon')
        && staffPagesCss.includes('.staff-pulse-tab-title')
        && staffPagesCss.includes('.staff-pulse-tab-subtitle')
        && !staffPagesCss.includes('.staff-pulse-tab-badge')
        && !pulseSwitcherCode.includes('data-pulse-badge=')
        && !staffCode.includes('setStaffPulseCardBadge')
        && !staffCode.includes('updateSchedulePulseCardBadge')
        && staffPagesCss.includes('.staff-pulse-tab-line')
        && staffPagesCss.includes('.staff-pulse-tab:focus-visible')
        && staffPagesCss.includes('.staff-schedule-command')
        && !staffPagesCss.includes('.staff-schedule-command-metrics')
        && !staffPagesCss.includes('.staff-schedule-metric-chip')
        && staffPagesCss.includes('body.dark-mode .staff-pulse-nav')
        && staffPagesCss.includes('body.staff-schedule-hr-mode #hrStaffScheduleShell')
        && !staffPagesCss.includes('body.staff-schedule-embed-mode')
        && /margin-bottom:\s*12px;/.test(staffPulseNavRule)
        && /width:\s*100%;/.test(staffScheduleHrShellRule)
        && /min-width:\s*0;/.test(staffScheduleHrShellRule)
        && /margin:\s*0 0 12px;/.test(staffScheduleHrCommandRule)
        && staffPagesCss.includes('@media (max-width: 480px)')
        && staffPagesCss.includes('@media (prefers-reduced-motion: reduce)'));
    check('Staff schedule command bar uses one continuous dark surface',
        /background:\s*linear-gradient/.test(staffScheduleCommandBarDarkRule)
        && /padding:\s*0;/.test(staffScheduleCommandBarControlsDarkRule)
        && /border:\s*0;/.test(staffScheduleCommandBarControlsDarkRule)
        && /border-radius:\s*0;/.test(staffScheduleCommandBarControlsDarkRule)
        && /background:\s*transparent;/.test(staffScheduleCommandBarControlsDarkRule)
        && /box-shadow:\s*none;/.test(staffScheduleCommandBarControlsDarkRule));
    check('Staff schedule keeps the table as the primary surface before diagnostics',
        staffScheduleSummaryIndex > -1
        && staffScheduleTableIndex > staffScheduleSummaryIndex
        && staffScheduleHealthPanelIndex > staffScheduleTableIndex
        && staffScheduleShellCode.includes('class="schedule-secondary-diagnostics"')
        && staffScheduleShellCode.includes('id="scheduleHealthPanel" class="schedule-health-panel" aria-live="polite" hidden')
        && staffScheduleShellCode.includes('id="scheduleForecastPanel" class="schedule-forecast-panel" aria-live="polite" hidden')
        && staffScheduleShellCode.includes('id="managerAccountabilityPanel" class="manager-accountability-panel" aria-live="polite" hidden')
        && /display:\s*none\s*!important;/.test(staffScheduleDiagnosticsHiddenRule)
        && /margin:\s*0\s*!important;/.test(staffScheduleDiagnosticsHiddenRule)
        && /padding:\s*0\s*!important;/.test(staffScheduleDiagnosticsHiddenRule)
        && /box-shadow:\s*none\s*!important;/.test(staffScheduleDiagnosticsHiddenRule)
        && staffSchedulePrimaryRenderBlock.includes('scheduleFinalVisibleStaffSnapshot(')
        && staffScheduleRenderBlock.includes("tbody.classList.toggle('show-hours', Boolean(StaffState.showHours))")
        && !staffScheduleRenderBlock.includes("tbody.classList.add('show-hours')")
        && !staffScheduleViewModeBlock.includes("classList.add('show-hours')")
        && !staffSchedulePrimaryRenderBlock.includes('renderScheduleHealthPanel(health)')
        && !staffSchedulePrimaryRenderBlock.includes('renderStaffingForecastPanel(forecast)')
        && !staffSchedulePrimaryRenderBlock.includes('renderManagerAccountabilityPanel(accountability)')
        && !staffSchedulePrimaryRenderBlock.includes('buildStaffingDemandForecast(dates, baseFiltered)')
        && !staffSchedulePrimaryRenderBlock.includes('buildManagerAccountability(dates, baseFiltered, health)')
        && !staffScheduleWeekNavBlock.includes('fetchStaffingForecastBookings(from, to)')
        && !staffScheduleInitLoadBlock.includes('fetchStaffingForecastBookings(from, to)'));
    check('Staff schedule cells are keyboard accessible controls',
        staffCode.includes('function scheduleCellAriaLabel')
        && staffScheduleEmpRowBlock.includes('const cellAriaLabel = scheduleCellAriaLabel')
        && staffScheduleEmpRowBlock.includes('role="button" tabindex="0" aria-label="${escapeHtml(cellAriaLabel)}"')
        && staffScheduleCellActivationBlock.includes('function scheduleCellFromEvent')
        && staffScheduleCellActivationBlock.includes("target.closest('button, a, input, select, textarea, [data-health-detail], [data-attendance-action]')")
        && staffScheduleCellActivationBlock.includes('function bindScheduleCellActivation')
        && staffScheduleCellActivationBlock.includes("tbody.addEventListener('keydown'")
        && staffScheduleCellActivationBlock.includes("event.key !== 'Enter' && event.key !== ' '")
        && staffScheduleCellActivationBlock.includes('event.preventDefault()')
        && staffScheduleCellActivationBlock.includes('openScheduleCell(cell)')
        && /outline:\s*2px solid rgba\(20,184,166,0\.72\);/.test(staffScheduleCellFocusRule)
        && /outline-offset:\s*-2px;/.test(staffScheduleCellFocusRule));
    check('Staff schedule renders attendance inside visible shift cells',
        staffCode.includes('function renderScheduleAttendanceSummary')
        && staffScheduleRenderBlock.includes('renderScheduleAttendanceSummary(dates, filtered)')
        && staffCode.includes("container.innerHTML = '';")
        && staffCode.includes('container.hidden = true;')
        && !staffCode.includes('class="attendance-day-card"')
        && staffScheduleEmpRowBlock.includes('const attendanceIndicator = renderScheduleAttendanceIndicator(emp.id, ds, entry)')
        && staffScheduleEmpRowBlock.includes('class="sch-cell-attendance">${attendanceIndicator}')
        && staffPagesCss.includes('.sch-cell-attendance')
        && staffCode.includes('${actualArrival}→${actualLeave}')
        && !staffScheduleEmpRowBlock.includes('attendanceClass')
        && !staffScheduleEmpRowBlock.includes('has-attendance-'));
    check('Staff schedule dark mode keeps collapsed group fill cells dark',
        staffPagesCss.includes('body.dark-mode .dept-row .schedule-category-fill-cell')
        && staffPagesCss.includes('[data-theme="dark"] .dept-row .schedule-category-fill-cell')
        && staffPagesCss.includes('body.dark-mode .sub-group-row .schedule-category-fill-cell')
        && staffPagesCss.includes('[data-theme="dark"] .sub-group-row .schedule-category-fill-cell'));
    check('Staff schedule health indicators collapse repeated table badges',
        staffScheduleHealthBadgeRenderBlock.includes('const counts = scheduleHealthCounts(sorted)')
        && staffScheduleHealthBadgeRenderBlock.includes('const severity = scheduleHealthSeverity(sorted)')
        && staffScheduleHealthBadgeRenderBlock.includes('const countLabel = count > 9 ?')
        && staffScheduleHealthBadgeRenderBlock.includes('schedule-health-badge schedule-health-badge-compact is-${severity}')
        && /data-health-detail="\$\{escapeHtml\(detail\)\}"/.test(staffScheduleHealthBadgeRenderBlock)
        && /class="schedule-health-badge-count"[\s\S]*\$\{countLabel\}/.test(staffScheduleHealthBadgeRenderBlock)
        && !staffScheduleHealthBadgeRenderBlock.includes('visible.map(issue')
        && !staffScheduleHealthBadgeRenderBlock.includes('schedule-health-badge-more')
        && /body\[data-page-group="hr"\] \.schedule-health-badges[\s\S]*flex-wrap:\s*nowrap;/.test(staffScheduleHealthBadgeCssBlock)
        && /body\[data-page-group="hr"\] \.schedule-health-badge-compact[\s\S]*min-width:\s*24px;[\s\S]*border-radius:\s*999px;[\s\S]*white-space:\s*nowrap;/.test(staffScheduleHealthBadgeCssBlock)
        && /body\[data-page-group="hr"\] \.sch-cell \.schedule-health-badge-compact[\s\S]*height:\s*16px;/.test(staffScheduleHealthBadgeCssBlock)
        && /body\[data-page-group="hr"\] \.schedule-health-badge-count[\s\S]*font-size:\s*10px;[\s\S]*opacity:\s*0\.92;/.test(staffScheduleHealthBadgeCssBlock));
    check('Staff schedule department filters use HR Today-style segment markup and states',
        staffDeptFilterRenderBlock.includes('class="dept-chip-label"')
        && staffDeptFilterRenderBlock.includes('class="dept-chip-count"')
        && staffDeptFilterRenderBlock.includes('aria-pressed="${active ?')
        && staffDeptFilterRenderBlock.includes("c.setAttribute('aria-pressed', 'false')")
        && staffDeptFilterRenderBlock.includes("chip.setAttribute('aria-pressed', 'true')")
        && staffDeptFilterRenderBlock.includes('const allCount = uniqueScheduleStaffById(scheduleableStaffForUi(StaffState.staff)).length')
        && staffCode.includes('function scheduleDepartmentCountMap(staffList = StaffState.staff)')
        && staffCode.includes('const counts = scheduleDepartmentCountMap(StaffState.staff)')
        && !staffDeptFilterRenderBlock.includes('${label} (${count})')
        && /min-height:\s*38px;/.test(staffScheduleDeptChipRule)
        && /border-radius:\s*10px;/.test(staffScheduleDeptChipRule)
        && /background:\s*rgba\(255,255,255,0\.56\);/.test(staffScheduleDeptChipRule)
        && /background:\s*rgba\(20,184,166,0\.12\);/.test(staffScheduleDeptChipActiveRule)
        && /min-width:\s*22px;/.test(staffScheduleDeptChipCountRule)
        && /border-radius:\s*999px;/.test(staffScheduleDeptChipCountRule)
        && /background:\s*rgba\(255,255,255,0\.035\);/.test(staffScheduleDeptChipDarkRule));
    check('Staff schedule people search filters rows and load view from the shared shell',
        staffScheduleShellCode.includes('id="scheduleStaffSearch"')
        && staffScheduleShellCode.includes('id="scheduleStaffFilterInfo"')
        && staffScheduleShellCode.includes('class="staff-schedule-search-row"')
        && staffScheduleShellCode.includes('role="search"')
        && staffCode.includes("searchQuery: ''")
        && staffCode.includes('function normalizeScheduleSearchText')
        && staffCode.includes('function scheduleStaffSearchHaystack')
        && staffCode.includes('function scheduleStaffVisibleWithoutSearch')
        && staffCode.includes('function staffMatchesScheduleDepartment')
        && staffScheduleVisibleWithoutSearchBlock.includes('staffMatchesScheduleDepartment(staff, StaffState.activeDept)')
        && staffCode.includes('function bindScheduleStaffSearchControls')
        && staffCode.includes("document.getElementById('scheduleStaffSearch')")
        && staffFunctionBlock('scheduleVisibleStaff').includes('visible.filter(staff => scheduleStaffSearchHaystack(staff).includes(query))')
        && staffCode.includes('renderScheduleStaffFilterInfo(baseFiltered)')
        && staffCode.includes('if (StaffState.showLoadView) renderLoadView();')
        && staffScheduleRenderBlock.includes("grouping: 'canonical'"));
    check('Staff schedule subgroup ownership is deterministic while duplicate-label headers stay suppressed',
        staffCode.includes('function staffProfessionKeys(staff = {})')
        && staffCode.includes('function staffScheduleDepartmentKeys(staff = {})')
        && staffCode.includes('function scheduleProfessionDisplayGroupKey(professionKey)')
        && staffCode.includes('for (const professionKey of staffProfessionKeys(staff))')
        && staffCode.includes('function resolveScheduleSubGroup(staff = {}, departmentKey = \'\', context = {})')
        && staffCode.includes('function partitionScheduleStaffBySubGroup(departmentKey = \'\', deptStaff = [], subGroups = null, context = {})')
        && staffCode.includes('function scheduleSubGroupProfessionCandidates(staff = {}, activeDepartment = \'\')')
        && staffCode.includes('function compareScheduleSubGroupCandidates(left = {}, right = {})')
        && staffCode.includes('function shouldSkipScheduleSubGroup(departmentKey = \'\', subGroup = {})')
        && staffCode.includes('const SCHEDULE_OTHER_SUB_GROUP = Object.freeze({')
        && staffCode.includes("label: 'Інші'")
        && staffCode.includes('function scheduleRenderableSubGroupBuckets(departmentKey = \'\', partition = {})')
        && (staffCode.match(/scheduleRenderableSubGroupBuckets\(dept, subGroupPartition\)/g) || []).length >= 2
        && (staffCode.match(/partitionScheduleStaffBySubGroup\(dept, deptStaff, subGroups/g) || []).length >= 2
        && staffCode.includes('.sort(compareScheduleSubGroupCandidates)')
        && staffCode.includes('ownershipByStaffId.set(staffId, subGroup)')
        && staffCode.includes('data-schedule-subgroup-label=')
        && !staffCode.includes('function staffMatchesDepartmentSubGroup')
        && !staffCode.includes('if (parentKey && subGroupKey && parentKey === subGroupKey) return true'));
    check('Staff schedule health uses one shift profession department and neutral missing readiness',
        staffCode.includes('function scheduleHealthShiftProfessionKey(staff = {}, entry = {})')
        && staffCode.includes('function scheduleHealthShiftDepartment(staff = {}, entry = {})')
        && staffCode.includes('const workingCountByDepartmentDate = new Map()')
        && staffCode.includes('workingCountByDepartmentDate.set(countKey')
        && staffCode.includes('workingCountByDepartmentDate.get(`${department}:${date}`) || 0')
        && staffCode.includes("data-staff-readiness-state=\"unknown\"")
        && staffCode.includes('staff-card-badge neutral')
        && staffCode.includes('Немає даних</span>')
        && staffCode.includes('readiness.hasData && readiness.total > 0 && readiness.percent < 45')
        && !staffCode.includes("code: 'missing_readiness'")
        && staffCode.includes('isScheduleManagerStaff(staff, entry)')
        && staffScheduleBrowserSmokeCode.includes('async function runDeterministicSubgroupReadinessFlow')
        && staffScheduleBrowserSmokeCode.includes('runDeterministicSubgroupReadinessFlow('));
    check('Staff schedule groups collapse by default and expand through accessible headers',
        staffCode.includes('expandedScheduleGroups: new Set()')
        && staffCode.includes("const STAFF_SCHEDULE_EXPANDED_GROUPS_STORAGE_KEY = 'pzp_staff_schedule_expanded_groups'")
        && staffCode.includes('function hydrateScheduleExpandedGroups')
        && staffCode.includes('function persistScheduleExpandedGroups')
        && staffCode.includes('hydrateScheduleExpandedGroups();')
        && staffCode.includes('localStorage.setItem(STAFF_SCHEDULE_EXPANDED_GROUPS_STORAGE_KEY')
        && staffCode.includes('localStorage.removeItem(STAFF_SCHEDULE_EXPANDED_GROUPS_STORAGE_KEY)')
        && staffCode.includes('function isScheduleGroupExpandedForRender')
        && staffCode.includes('function scheduleSearchAutoExpandsGroups')
        && staffCode.includes('function toggleScheduleGroup')
        && staffCode.includes('function bindScheduleGroupToggles')
        && staffScheduleRenderBlock.includes('const groupExpanded = isScheduleGroupExpandedForRender(dept)')
        && staffScheduleRenderBlock.includes('data-schedule-group-toggle="${escapeHtml(dept)}"')
        && staffScheduleRenderBlock.includes('aria-expanded="${groupExpanded ?')
        && staffScheduleRenderBlock.includes('class="schedule-category-sticky-cell schedule-group-sticky-cell"')
        && staffScheduleRenderBlock.includes('class="schedule-category-fill-cell schedule-group-fill-cell" colspan="${dates.length}"')
        && staffScheduleRenderBlock.includes('class="schedule-category-sticky-cell schedule-sub-group-sticky-cell"')
        && staffScheduleRenderBlock.includes('class="schedule-category-fill-cell schedule-sub-group-fill-cell" colspan="${dates.length}"')
        && !staffScheduleRenderBlock.includes('<tr class="dept-row ${groupStateClass}" data-dept="${escapeHtml(dept)}"><td colspan="${dates.length + 1}">')
        && !staffScheduleRenderBlock.includes('<tr class="sub-group-row"><td colspan="${dates.length + 1}">')
        && staffScheduleRenderBlock.includes('if (!groupExpanded) continue;')
        && staffScheduleRenderBlock.includes('bindScheduleGroupToggles(tbody)')
        && staffCode.includes('if (department) setScheduleGroupExpanded(department, true);')
        && /display:\s*flex;/.test(staffScheduleGroupToggleRule)
        && /cursor:\s*pointer;/.test(staffScheduleGroupToggleRule)
        && /content:\s*'›';/.test(staffScheduleGroupCaretBeforeRule)
        && /transform:\s*rotate\(90deg\);/.test(staffScheduleGroupExpandedCaretRule));
    check('Staff schedule category headers stay pinned to the left rail while horizontally scrolling',
        /position:\s*sticky;/.test(staffScheduleCategoryStickyRule)
        && /left:\s*0;/.test(staffScheduleCategoryStickyRule)
        && /z-index:\s*8;/.test(staffScheduleCategoryStickyRule)
        && /pointer-events:\s*none;/.test(staffScheduleCategoryFillRule)
        && staffPagesCss.includes('#scheduleWrapper.is-long-range .schedule-table .schedule-category-sticky-cell')
        && staffPagesCss.includes('.dept-row[data-dept="animators"] .schedule-group-sticky-cell')
        && !staffPagesCss.includes('.dept-row[data-dept="animators"] td { border-left'));
    check('Staff schedule exposes a validated custom period picker',
        staffScheduleShellCode.includes('id="scheduleDateFrom"')
        && staffScheduleShellCode.includes('id="scheduleDateTo"')
        && staffScheduleShellCode.includes('id="applyScheduleRangeBtn"')
        && staffScheduleShellCode.includes('data-schedule-range-preset="first-half"')
        && staffScheduleShellCode.includes('data-schedule-range-preset="second-half"')
        && !staffScheduleShellCode.includes('data-schedule-range-preset="month"')
        && staffScheduleShellCode.includes('>1-15</button>')
        && staffScheduleShellCode.includes('>16-31</button>')
        && !staffScheduleShellCode.includes('>Весь місяць</button>')
        && staffScheduleShellCode.includes('aria-label="Показати 16-31 число місяця"')
        && !staffScheduleShellCode.includes('1 половина')
        && !staffScheduleShellCode.includes('2 половина')
        && !staffScheduleShellCode.includes('16-кінець')
        && staffCode.includes('rangeStart: null')
        && staffCode.includes('rangeEnd: null')
        && staffCode.includes("rangeMode: 'rolling'")
        && staffCode.includes('function syncScheduleRangePresetLabel')
        && staffCode.includes('formatSchedulePresetDayRange(presetRange)')
        && staffCode.includes('const STAFF_SCHEDULE_MAX_RANGE_DAYS = 31')
        && staffCode.includes('const STAFF_SCHEDULE_LONG_RANGE_DAYS = 16')
        && staffCode.includes('const STAFF_SCHEDULE_LAYOUT = {')
        && staffCode.includes('desktop: { minWidth: 900, stickyColumn: 240, dayColumn: 144 }')
        && staffCode.includes('mobile: { minWidth: 900, stickyColumn: 176, dayColumn: 128 }')
        && staffCode.includes('fullRange: {')
        && staffCode.includes('desktop: { minWidth: 900, stickyColumn: 220, dayColumn: 30 }')
        && staffCode.includes('mobile: { minWidth: 900, stickyColumn: 160, dayColumn: 42 }')
        && staffCode.includes('function syncScheduleRangeLayout')
        && staffCode.includes("wrapper.classList.toggle('is-long-range', longRange)")
        && staffCode.includes("wrapper.classList.toggle('is-full-range', fullRange)")
        && staffCode.includes('function validateScheduleRange')
        && staffCode.includes('Дата початку має бути не пізніше дати завершення')
        && staffCode.includes('function getScheduleDates')
        && staffCode.includes('return getScheduleDates().map(formatDateStr);')
        && staffCode.includes('function bindScheduleRangeControls')
        && staffCode.includes("document.getElementById('applyScheduleRangeBtn')")
        && staffCode.includes("return goToScheduleRange(range.start, range.end, 'rolling');")
        && staffCode.includes('scheduleNavigationStepDays()')
        && staffCode.includes('await goToWeek(getScheduleFocusStart(new Date()));'));
    check('Staff schedule commits confirmed ranges atomically and blocks stale responses',
        staffScheduleShellCode.includes('id="scheduleDataRegion"')
        && staffScheduleShellCode.includes('data-schedule-state="idle"')
        && staffScheduleShellCode.includes('aria-busy="false"')
        && staffScheduleShellCode.includes('id="scheduleRangeState"')
        && staffScheduleShellCode.includes('id="scheduleRangeStateTitle"')
        && staffScheduleShellCode.includes('id="scheduleRangeStateMessage"')
        && staffScheduleShellCode.includes('id="scheduleRangeRetryBtn"')
        && /id="exportExcelBtn"[^>]*disabled/.test(staffScheduleShellCode)
        && /id="printBtn"[^>]*disabled/.test(staffScheduleShellCode)
        && staffCode.includes('let staffScheduleRangeLoadSeq = 0')
        && staffCode.includes('let staffScheduleRangeAbortController = null')
        && staffCode.includes("rangeLoadState: 'idle'")
        && staffCode.includes('rangePending: null')
        && staffCode.includes('rangeRetry: null')
        && staffCode.includes('function setScheduleRangeLoadState')
        && staffCode.includes('function scheduleRangeDataReady')
        && staffCode.includes('function retryScheduleRangeLoad')
        && staffScheduleFetchBlock.includes('signal')
        && staffScheduleFetchBlock.includes('scheduleRawEntries')
        && staffScheduleFetchBlock.includes('displayGroups')
        && !/StaffState\.(?:schedule|scheduleRawEntries|displayGroups|scheduleLoadedRange)\s*=/.test(staffScheduleFetchBlock)
        && staffScheduleAttendanceFetchBlock.includes('signal')
        && staffScheduleAttendanceFetchBlock.includes('attendanceSummary')
        && !/StaffState\.(?:attendance|attendanceSummary|attendanceUnavailable)\s*=/.test(staffScheduleAttendanceFetchBlock)
        && staffScheduleRangeNavigationBlock.includes('staffScheduleRangeLoadSeq')
        && staffScheduleRangeNavigationBlock.includes('staffScheduleRangeAbortController')
        && staffScheduleRangeNavigationBlock.includes('new AbortController()')
        && staffScheduleRangeNavigationBlock.includes('Promise.all(')
        && staffScheduleRangeNavigationBlock.includes('StaffState.schedule =')
        && staffScheduleRangeNavigationBlock.includes('StaffState.scheduleRawEntries =')
        && staffScheduleRangeNavigationBlock.includes('StaffState.attendance =')
        && staffScheduleRangeNavigationBlock.includes('StaffState.attendanceSummary =')
        && staffScheduleRangeNavigationBlock.includes('StaffState.hoursData =')
        && staffScheduleRangeNavigationBlock.includes('StaffState.scheduleLoadedRange =')
        && staffScheduleRangeNavigationBlock.includes("setScheduleRangeLoadState('loading'")
        && staffScheduleRangeNavigationBlock.includes("setScheduleRangeLoadState('error'")
        && staffScheduleRangeNavigationBlock.includes("'empty'")
        && staffScheduleRangeNavigationBlock.includes("'ready'")
        && staffScheduleExportBlock.includes('scheduleRangeDataReady()')
        && staffSchedulePrintBlock.includes('scheduleRangeDataReady()')
        && staffPagesCss.includes('.staff-schedule-range-state')
        && staffPagesCss.includes('[data-schedule-state="loading"]')
        && staffPagesCss.includes('[data-schedule-state="error"]'));
    check('Staff schedule keeps membership filters while All and export use one canonical row',
        staffScheduleNormalizeStaffIdBlock.includes('Number(')
        && /Number\.is(?:SafeInteger|Integer|Finite)/.test(staffScheduleNormalizeStaffIdBlock)
        && staffScheduleUniqueStaffBlock.includes('normalizeScheduleStaffId')
        && staffScheduleUniqueStaffBlock.includes('new Set()')
        && staffScheduleCanonicalGroupBlock.includes('normalizeScheduleDisplayGroupKey(staff.display_group || staff.displayGroup)')
        && staffScheduleCanonicalGroupBlock.includes('if (backendGroup) return backendGroup')
        && staffScheduleCanonicalGroupBlock.includes('normalizeScheduleDisplayGroupKey(legacyScheduleDisplayDepartmentKey(staff))')
        && (/\|\| 'admin'/.test(staffScheduleCanonicalGroupBlock) || staffScheduleCanonicalGroupBlock.includes("return 'admin'"))
        && staffScheduleMembershipBlock.includes('staffProfessionKeys(staff)')
        && staffScheduleMembershipBlock.includes('scheduleProfessionDisplayGroupKey')
        && staffScheduleMembershipBlock.includes('scheduleCanonicalDisplayGroupKey(staff)')
        && staffScheduleGroupingKeysBlock.includes('staffMatchesScheduleDepartment(staff, activeDepartment) ? [activeDepartment] : []')
        && staffScheduleGroupingKeysBlock.includes('return [scheduleCanonicalDisplayGroupKey(staff)]')
        && staffScheduleGroupingKeysBlock.includes("options.grouping === 'membership'")
        && staffScheduleRenderBlock.includes("grouping: 'canonical'")
        && staffScheduleDepartmentCountBlock.includes('uniqueScheduleStaffById(')
        && staffScheduleVisibleWithoutSearchBlock.includes('uniqueScheduleStaffById(')
        && staffScheduleGroupStaffBlock.includes('uniqueScheduleStaffById(')
        && staffScheduleFinalVisibleBlock.includes('scheduleVisibleStaff(')
        && staffScheduleFinalVisibleBlock.includes('scheduleHealthFilteredStaff(')
        && (staffScheduleFinalVisibleBlock.match(/uniqueScheduleStaffById\(/g) || []).length >= 2
        && staffSchedulePrimaryRenderBlock.includes('scheduleFinalVisibleStaffSnapshot(')
        && staffScheduleExportVisibleBlock.includes('scheduleFinalVisibleStaffSnapshot(')
        && staffScheduleFillModalBlock.includes('scheduleVisibleStaff()')
        && staffScheduleFillModalBlock.includes('normalizeScheduleStaffId(emp.id)')
        && staffScheduleFillSaveBlock.includes('uniqueScheduleStaffById(')
        && staffScheduleCopyVisibleIdsBlock.includes('uniqueScheduleStaffById(')
        && staffScheduleCopyVisibleIdsBlock.includes('normalizeScheduleStaffId')
        && staffScheduleDisplayNameBlock.includes('staff.display_name || staff.displayName || staff.name')
        && staffScheduleWorkbookBlock.includes('data-schedule-export-staff-id=')
        && staffScheduleWorkbookBlock.includes('data-schedule-export-department=')
        && staffScheduleWorkbookModelBlock.includes("grouping: 'canonical'")
        && staffScheduleWorkbookModelBlock.includes('scheduleStaffDisplayName(emp)')
        && staffScheduleBrowserSmokeCode.includes('const STAFF_API_ROWS =')
        && /secondary_professions:\s*\['reception',\s*'reception',\s*'animator'\]/.test(staffScheduleBrowserSmokeCode)
        && /secondary_professions:\s*\['manager',\s*'barista'\]/.test(staffScheduleBrowserSmokeCode)
        && /secondary_professions:\s*\['trampoline_instructor'\]/.test(staffScheduleBrowserSmokeCode)
        && staffScheduleBrowserSmokeCode.includes("role_type: 'legacy_shift_role'")
        && /secondary_professions:\s*\['legacy_auxiliary'\]/.test(staffScheduleBrowserSmokeCode)
        && /\{\s*\.\.\.STAFF_ROWS\[0\],\s*id:\s*'101'\s*\}/.test(staffScheduleBrowserSmokeCode)
        && staffScheduleBrowserSmokeCode.includes('function scheduleStaffIdsFromDom')
        && staffScheduleBrowserSmokeCode.includes('function scheduleExportStaffIdsFromHtml')
        && staffScheduleBrowserSmokeCode.includes('function assertUniqueScheduleStaffIds')
        && staffScheduleBrowserSmokeCode.includes('function assertScheduleExportParity')
        && staffScheduleBrowserSmokeCode.includes('async function runMembershipGroupingFlow')
        && staffScheduleBrowserSmokeCode.includes('runMembershipGroupingFlow('));
    check('Staff schedule read-only surfaces use the selected visible period',
        staffSchedulePrimaryRenderBlock.includes('const dates = getScheduleDates()')
        && staffSchedulePrimaryRenderBlock.includes("syncScheduleRangeLayout('scheduleWrapper', dates, 'schedule')")
        && staffSchedulePrimaryRenderBlock.includes('scheduleFinalVisibleStaffSnapshot(')
        && staffScheduleRenderBlock.includes('renderSummary(filtered, dates)')
        && staffScheduleSummaryBlock.includes('function summarizeScheduleRange')
        && staffScheduleSummaryBlock.includes('const ds = typeof d ===')
        && staffScheduleSummaryBlock.includes('updateScheduleHeaderMetrics(summarizeScheduleToday(filtered), filtered)')
        && !staffScheduleSummaryBlock.includes('Не заповнено:')
        && staffScheduleViewModeBlock.includes('const target = scheduleNavigationRange()')
        && staffScheduleViewModeBlock.includes('rangeReloaded = await goToScheduleRange(target.start, target.end, scheduleNavigationMode())')
        && staffScheduleRangeNavigationBlock.includes('fetchScheduleHours(target.from, target.to, requestOptions)')
        && staffScheduleLoadViewBlock.includes('const dates = getScheduleDates()')
        && staffScheduleLoadViewBlock.includes("syncScheduleRangeLayout('loadViewWrapper', dates, 'load')")
        && staffScheduleExportBlock.includes('buildScheduleWorkbookExportPayload()')
        && staffScheduleExportBlock.includes("staffApiFetch('/api/staff/schedule/export-xlsx'")
        && staffScheduleExportBlock.includes('response.blob()')
        && staffScheduleExportBlock.includes('const filename = `grafik_${payload.period.from}_${payload.period.to}.xlsx`;')
        && staffCode.includes('function buildScheduleWorkbookHtml')
        && staffCode.includes('schedule-export-table')
        && staffCode.includes('StaffState.scheduleLoadedRange')
        && staffCode.includes('scheduleRangeDataReady()')
        && staffCode.includes('function buildScheduleHealth(dates = getScheduleDates()')
        && staffCode.includes('function buildStaffingDemandForecast(dates = getScheduleDates()')
        && staffCode.includes('function buildManagerAccountability(dates = getScheduleDates()')
        && staffPagesCss.includes('.schedule-wrapper.is-long-range')
        && staffPagesCss.includes('--schedule-table-min-width')
        && staffPagesCss.includes('#scheduleWrapper.is-long-range .schedule-table thead th:not(:first-child)')
        && staffPagesCss.includes('#loadViewWrapper.is-long-range .schedule-table thead th:not(:first-child):not(:last-child)')
        && staffPagesCss.includes('#scheduleWrapper.is-full-range .schedule-table .sch-cell')
        && staffPagesCss.includes('#scheduleWrapper.is-full-range .schedule-table .sch-time'));
    check('Staff schedule bulk actions respect the selected period safely',
        staffScheduleShellCode.includes('id="fillWeekTitle"')
        && staffScheduleShellCode.includes('id="fillWeekPeriodHint"')
        && staffCode.includes('const STAFF_SCHEDULE_BULK_CONFIRM_ENTRY_THRESHOLD = 40')
        && staffCode.includes('function syncScheduleBulkActionLabels')
        && staffCode.includes('scheduleRangeDayCount(range.start, range.end) === STAFF_SCHEDULE_WINDOW_DAYS')
        && staffCode.includes("fillBtn.textContent = customRange ? 'Заповнити період' : 'Заповнити тиждень'")
        && staffCode.includes("copyBtn.dataset.scheduleCopyUnavailable = allowed ? 'false' : 'true'")
        && staffCode.includes("Натисніть, щоб побачити пояснення")
        && staffScheduleBulkActionsBlock.includes('updateFillWeekModalCopy()')
        && staffScheduleBulkActionsBlock.includes('const dates = getScheduleDates()')
        && staffScheduleBulkActionsBlock.includes('const currentRange = scheduleCurrentRange()')
        && staffScheduleBulkActionsBlock.includes('entries.length >= STAFF_SCHEDULE_BULK_CONFIRM_ENTRY_THRESHOLD')
        && staffScheduleBulkActionsBlock.includes("confirmModal(confirmLines.join('\\n'), { type: 'warning', okText: 'Заповнити' })")
        && staffScheduleBulkActionsBlock.includes('await goToScheduleRange(currentRange.start, currentRange.end, currentMode)')
        && staffScheduleBulkActionsBlock.includes('if (!canCopyWeekInCurrentRange())')
        && staffScheduleBulkActionsBlock.includes('Копія тижня недоступна для довільного періоду')
        && staffScheduleBulkActionsBlock.includes('const sourceEnd = formatDateStr(shiftScheduleDate(StaffState.weekStart, 6))')
        && staffScheduleBulkActionsBlock.includes('Довільний visible range не копіюється цією дією.')
        && /font-size:\s*13px;/.test(staffFillPeriodHintRule));
    check('Staff schedule people search matches HR Today light dark and mobile control rhythm',
        /"week actions"\s*"range range"\s*"search search"\s*"dept dept";/.test(staffScheduleCommandBarControlsRule)
        && /grid-area:\s*range;/.test(staffScheduleRangeRowRule)
        && /grid-template-columns:\s*repeat\(2,\s*168px\)\s*minmax\(124px,\s*max-content\)\s*minmax\(238px,\s*max-content\);/.test(staffScheduleRangeRowRule)
        && /padding:\s*8px 10px;/.test(staffScheduleRangeRowRule)
        && /border-radius:\s*14px;/.test(staffScheduleRangeRowRule)
        && /text-transform:\s*uppercase;/.test(staffScheduleDateFieldRule)
        && /background:\s*rgba\(20,184,166,0\.12\);/.test(staffScheduleRangeApplyRule)
        && /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*max-content\)\);/.test(staffScheduleRangePresetsRule)
        && /background:\s*rgba\(15,23,42,0\.54\);/.test(staffScheduleRangeDarkRule)
        && /grid-area:\s*search;/.test(staffScheduleSearchRowRule)
        && /grid-template-columns:\s*minmax\(220px,\s*1fr\);/.test(staffScheduleSearchRowRule)
        && /min-height:\s*38px;/.test(staffScheduleSearchInputRule)
        && /border-radius:\s*10px;/.test(staffScheduleSearchInputRule)
        && /background:\s*rgba\(255,255,255,0\.88\);/.test(staffScheduleSearchInputRule)
        && /border-color:\s*rgba\(20,184,166,0\.54\);/.test(staffScheduleSearchFocusRule)
        && /position:\s*absolute;/.test(staffScheduleSearchInfoRule)
        && /clip-path:\s*inset\(50%\);/.test(staffScheduleSearchInfoRule)
        && /white-space:\s*nowrap;/.test(staffScheduleSearchInfoRule)
        && /background:\s*rgba\(15,23,42,0\.54\);/.test(staffScheduleSearchDarkRule)
        && /color:\s*#CBD5E1;/.test(staffScheduleSearchInfoDarkRule)
        && /grid-area:\s*actions;/.test(staffScheduleHeaderActionsRule)
        && /justify-content:\s*flex-end;/.test(staffScheduleHeaderActionsRule)
        && /width:\s*max-content;/.test(staffScheduleHeaderActionsRule)
        && /min-width:\s*82px;/.test(staffScheduleHeaderActionButtonRule)
        && /background:\s*rgba\(15,23,42,0\.46\);/.test(staffScheduleHeaderActionDarkRule)
        && /"week"\s*"range"\s*"actions"\s*"search"\s*"dept";/.test(staffScheduleMobileCommandBlock)
        && /body\[data-page-group="hr"\] \.staff-schedule-command-bar \.staff-schedule-range-row[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/.test(staffScheduleMobileCommandBlock)
        && /body\[data-page-group="hr"\] \.staff-schedule-command-bar \.staff-schedule-date-input[\s\S]*width:\s*100%;/.test(staffScheduleMobileCommandBlock)
        && /body\[data-page-group="hr"\] \.staff-schedule-command-bar \.staff-schedule-header-actions[\s\S]*display:\s*inline-flex;/.test(staffScheduleMobileCommandBlock)
        && /body\[data-page-group="hr"\] \.staff-schedule-command-bar \.staff-schedule-header-actions \.btn-page-toolbar[\s\S]*min-width:\s*76px;/.test(staffScheduleMobileCommandBlock)
        && /body\[data-page-group="hr"\] \.staff-schedule-command-bar \.staff-schedule-search-row[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\);/.test(staffScheduleMobileCommandBlock)
        && /body\[data-page-group="hr"\] \.staff-schedule-command-bar \.staff-schedule-filter-info[\s\S]*position:\s*absolute;[\s\S]*clip-path:\s*inset\(50%\);[\s\S]*white-space:\s*nowrap;/.test(staffScheduleMobileCommandBlock));
    check('Staff schedule mobile controls use 44px touch targets and a stacked command grid',
        staffScheduleMobileCommandBlock.includes('body[data-page-group="hr"] .staff-schedule-command-bar')
        && /display:\s*grid;/.test(staffScheduleMobileCommandBlock)
        && /"controls";/.test(staffScheduleMobileCommandBlock)
        && /grid-area:\s*controls;/.test(staffScheduleMobileCommandBlock)
        && /grid-template-columns:\s*44px minmax\(0,\s*1fr\) 44px minmax\(78px,\s*max-content\);/.test(staffScheduleMobileCommandBlock)
        && /grid-column:\s*auto;/.test(staffScheduleMobileCommandBlock)
        && /flex-wrap:\s*nowrap;/.test(staffScheduleMobileCommandBlock)
        && /overflow-x:\s*auto;/.test(staffScheduleMobileCommandBlock)
        && /overscroll-behavior-inline:\s*contain;/.test(staffScheduleMobileCommandBlock)
        && /scrollbar-width:\s*none;/.test(staffScheduleMobileCommandBlock)
        && /body\[data-page-group="hr"\] \.staff-schedule-command-bar \.staff-schedule-header-actions[\s\S]*display:\s*inline-flex;/.test(staffScheduleMobileCommandBlock)
        && /body\[data-page-group="hr"\] \.staff-schedule-command-bar \.staff-schedule-header-actions[\s\S]*width:\s*max-content;/.test(staffScheduleMobileCommandBlock)
        && /body\[data-page-group="hr"\] \.staff-schedule-command-bar \.staff-schedule-header-actions \.btn-page-toolbar[\s\S]*min-width:\s*76px;/.test(staffScheduleMobileCommandBlock)
        && /white-space:\s*nowrap;/.test(staffScheduleMobileCommandBlock)
        && /max-width:\s*min\(72vw,\s*190px\);/.test(staffScheduleMobileCommandBlock)
        && staffScheduleSummaryBlock.includes("container.innerHTML = ''")
        && staffScheduleSummaryBlock.includes('container.hidden = true')
        && !staffScheduleSummaryBlock.includes('summary-chip'));
    check('Staff schedule header actions replace the legacy visible toolbar',
        staffScheduleShellCode.includes('class="staff-schedule-header-actions"')
        && staffScheduleShellCode.includes('id="exportExcelBtn"')
        && staffScheduleShellCode.includes('id="printBtn"')
        && staffScheduleShellCode.includes('class="btn-page-toolbar staff-schedule-action-button"')
        && !staffScheduleShellCode.includes('id="scheduleActionsDropdown"')
        && !staffScheduleShellCode.includes('id="scheduleActionsMenuBtn"')
        && !staffScheduleShellCode.includes('id="scheduleActionsMenu"')
        && !staffScheduleShellCode.includes('id="addStaffBtn"')
        && !staffScheduleShellCode.includes('id="copyWeekBtn"')
        && !staffScheduleShellCode.includes('id="fillWeekBtn"')
        && !staffScheduleShellCode.includes('id="importExcelBtn"')
        && !staffScheduleShellCode.includes('id="excelImportInput"')
        && !staffScheduleShellCode.includes('class="schedule-toolbar"')
        && !staffScheduleShellCode.includes('id="scheduleViewSwitch"')
        && !staffScheduleShellCode.includes('id="scheduleViewMainBtn"')
        && !staffScheduleShellCode.includes('id="toggleHoursBtn"')
        && !staffScheduleShellCode.includes('id="toggleLoadViewBtn"')
        && !staffScheduleShellCode.includes('id="toggleLinkViewBtn"')
        && !staffScheduleShellCode.includes('data-schedule-view="hours"')
        && !staffScheduleShellCode.includes('data-schedule-view="load"')
        && !staffScheduleShellCode.includes('data-schedule-view="accounts"')
        && !staffScheduleShellCode.includes('id="bulkCreateBtn"')
        && staffCode.includes("document.getElementById('exportExcelBtn')?.addEventListener('click', handleExcelExport)")
        && staffCode.includes("document.getElementById('printBtn')?.addEventListener('click', handlePrint)")
        && !staffCode.includes('function bindScheduleActionsMenuControls')
        && !staffCode.includes('function syncScheduleActionsMenuVisibility')
        && !staffCode.includes('const SCHEDULE_ACTION_MENU_ITEM_IDS')
        && staffCode.includes("const STAFF_SCHEDULE_VIEW_MODES = new Set(['schedule', 'hours', 'load', 'accounts'])")
        && staffCode.includes('function setScheduleViewMode')
        && staffCode.includes('function resetSchedulePrimaryViewMode')
        && staffCode.includes('function bindScheduleViewSwitchControls')
        && staffCode.includes('if (!buttons.length)')
        && !staffCode.includes('async function toggleHours()')
        && !staffCode.includes('function toggleLoadView()')
        && !staffCode.includes('async function toggleLinkView()')
        && staffCode.includes('StaffState.showHours = nextMode ===')
        && staffCode.includes('StaffState.showLoadView = nextMode ===')
        && staffCode.includes('StaffState.showLinkView = nextMode ===')
        && staffScheduleViewModeBlock.includes('rangeReloaded = await goToScheduleRange(target.start, target.end, scheduleNavigationMode())')
        && staffScheduleRangeNavigationBlock.includes('fetchScheduleHours(target.from, target.to, requestOptions)')
        && staffCode.includes('await fetchLinkStatus()')
        && staffCode.includes("document.getElementById('fillWeekBtn')?.addEventListener('click', openFillWeekModal)")
        && staffCode.includes("document.getElementById('copyWeekBtn')?.addEventListener('click', handleCopyWeek)")
        && staffCode.includes("document.getElementById('importExcelBtn')?.addEventListener('click', triggerExcelImport)")
        && staffCode.includes("document.getElementById('addStaffBtn')?.addEventListener('click', openAddStaffModal)")
        && !staffCode.includes("document.getElementById('toggleHoursBtn')?.addEventListener('click', toggleHours)")
        && !staffCode.includes("document.getElementById('toggleLoadViewBtn')?.addEventListener('click', toggleLoadView)")
        && !staffCode.includes("document.getElementById('toggleLinkViewBtn')?.addEventListener('click', toggleLinkView)")
        && /display:\s*inline-flex;/.test(staffScheduleHeaderActionsRule)
        && /width:\s*max-content;/.test(staffScheduleHeaderActionsRule)
        && /gap:\s*4px;/.test(staffScheduleHeaderActionsRule)
        && /min-height:\s*38px;/.test(staffScheduleHeaderActionButtonRule)
        && /min-width:\s*82px;/.test(staffScheduleHeaderActionButtonRule)
        && /background:\s*rgba\(15,23,42,0\.30\);/.test(staffScheduleHeaderActionsDarkRule)
        && !staffPagesCss.includes('.staff-schedule-view-switch')
        && !staffPagesCss.includes('.staff-schedule-view-label')
        && !staffPagesCss.includes('.staff-schedule-view-option'));
    check('Staff schedule has repeatable read-only live smoke coverage',
        pkg.scripts['smoke:staff-schedule'] === 'npx --yes --package playwright node scripts/live-staff-schedule-smoke.js'
        && staffScheduleLiveSmokeCode.includes('Read-only guarantee')
        && staffScheduleLiveSmokeCode.includes('LIVE_SMOKE_USER')
        && staffScheduleLiveSmokeCode.includes('TEST_USER')
        && staffScheduleLiveSmokeCode.includes("path.join(ROOT, 'output', 'playwright', 'live-staff-schedule-smoke'")
        && staffScheduleLiveSmokeCode.includes('function assertNoForbiddenStaffWrites')
        && staffScheduleLiveSmokeCode.includes("pathname === '/api/staff/schedule/bulk'")
        && staffScheduleLiveSmokeCode.includes("pathname === '/api/staff/schedule/copy-week'")
        && staffScheduleLiveSmokeCode.includes("pathname === '/api/staff/import-excel'")
        && staffScheduleLiveSmokeCode.includes('function assertCompactHeaderActions')
        && staffScheduleLiveSmokeCode.includes('function assertWideScheduleLayout')
        && staffScheduleLiveSmokeCode.includes('function assertScheduleExtraViewsRemoved')
        && !staffScheduleLiveSmokeCode.includes('function assertViewSwitchReadOnlyModes')
        && staffScheduleLiveSmokeCode.includes("['#scheduleActionsDropdown', '#scheduleActionsMenuBtn', '#scheduleActionsMenu'")
        && staffScheduleLiveSmokeCode.includes("page.locator('[data-schedule-view]').count()")
        && !staffScheduleLiveSmokeCode.includes('data-schedule-view="hours"')
        && !staffScheduleLiveSmokeCode.includes('data-schedule-view="load"')
        && !staffScheduleLiveSmokeCode.includes('data-schedule-view="accounts"')
        && staffScheduleLiveSmokeCode.includes("applyPreset(page, 'first-half')")
        && staffScheduleBrowserSmokeCode.includes("applyPreset(page, 'second-half')")
        && staffScheduleBrowserSmokeCode.includes('assertFittedScheduleLayout')
        && staffScheduleBrowserSmokeCode.includes("second-half starts on day 16")
        && staffScheduleLiveSmokeCode.includes("await waitForDayColumns(page, 9)")
        && staffScheduleLiveSmokeCode.includes("await waitForDayColumns(page, 15)")
        && staffScheduleLiveSmokeCode.includes("download.suggestedFilename()")
        && staffScheduleLiveSmokeCode.includes("window.open = () =>")
        && staffScheduleLiveSmokeCode.includes("'.schedule-toolbar'")
        && staffScheduleBrowserSmokeCode.includes('function assertScheduleGroupExpansionPersists')
        && staffScheduleBrowserSmokeCode.includes('function assertDepartmentChipsFit')
        && staffScheduleBrowserSmokeCode.includes('async function runPeriodReliabilityFlow')
        && staffScheduleBrowserSmokeCode.includes('async function runInitialRangeFailureFlow')
        && staffScheduleBrowserSmokeCode.includes('runPeriodReliabilityFlow(')
        && staffScheduleBrowserSmokeCode.includes('runInitialRangeFailureFlow(')
        && staffScheduleBrowserSmokeCode.includes('expanded schedule group persists after reload')
        && staffScheduleBrowserSmokeCode.includes('{ width: 320, height: 760 }')
        && staffScheduleBrowserSmokeCode.includes('{ width: 360, height: 800 }')
        && staffScheduleBrowserSmokeCode.includes('{ width: 390, height: 844 }')
        && staffScheduleBrowserSmokeCode.includes('for (const darkMode of [false, true])')
        && staffScheduleLiveSmokeCode.includes('mobile: Object.freeze({ width: 390, height: 844 })')
        && staffScheduleLiveSmokeCode.includes('narrowMobile: Object.freeze({ width: 360, height: 800 })')
        && staffScheduleLiveSmokeCode.includes('function assertScheduleGroupExpansionPersists')
        && staffScheduleLiveSmokeCode.includes('expanded schedule group persists after reload')
        && staffScheduleLiveSmokeCode.includes("VIEWPORTS.narrowMobile, 'mobile-360'"));
    check('Staff HR Pulse command cards do not depend on legacy nav PNG layers',
        legacyStaffPulseNavTokens.every(token => !html.includes(token) && !staffPagesCss.includes(token)));
    check('HR Pulse light theme keeps switcher and schedule command surfaces light-only by default',
        /--pulse-switcher-shell-bg:\s*linear-gradient\(135deg,\s*rgba\(255,255,255,0\.82\)/.test(pulseSwitcherLightTokenBlock)
        && /--pulse-switcher-card-bg:\s*rgba\(255,255,255,0\.72\);/.test(pulseSwitcherLightTokenBlock)
        && /--pulse-switcher-card-color:\s*#0F172A;/.test(pulseSwitcherLightTokenBlock)
        && /--pulse-switcher-title-color:\s*#0F172A;/.test(pulseSwitcherLightTokenBlock)
        && /--pulse-switcher-hover-color:\s*#0F172A;/.test(pulseSwitcherLightTokenBlock)
        && /--pulse-switcher-active-color:\s*#0F172A;/.test(pulseSwitcherLightTokenBlock)
        && !/--pulse-switcher-shell-bg:\s*rgba\(15,23,42/.test(pulseSwitcherLightTokenBlock)
        && !/--pulse-switcher-card-bg:\s*rgba\(15,23,42/.test(pulseSwitcherLightTokenBlock)
        && /--pulse-switcher-shell-bg:\s*rgba\(15,23,42,0\.88\);/.test(pulseSwitcherDarkTokenBlock)
        && /--pulse-switcher-card-bg:\s*rgba\(15,23,42,0\.62\);/.test(pulseSwitcherDarkTokenBlock)
        && /background:\s*linear-gradient\(135deg,\s*rgba\(255,255,255,0\.86\),\s*rgba\(248,250,252,0\.72\)\);/.test(staffScheduleCommandBarRule)
        && /background:\s*rgba\(248,250,252,0\.88\);/.test(staffScheduleCommandBarWeekNavRule)
        && /background:\s*rgba\(255,255,255,0\.88\);/.test(staffScheduleCommandBarWeekButtonRule)
        && /color:\s*#475569;/.test(staffScheduleCommandBarWeekButtonRule)
        && /background:\s*rgba\(255,255,255,0\.90\);/.test(staffScheduleCommandBarWeekLabelRule)
        && /color:\s*#0F172A;/.test(staffScheduleCommandBarWeekLabelRule)
        && /background:\s*rgba\(255,255,255,0\.84\);/.test(staffScheduleHeaderActionButtonRule)
        && /color:\s*#334155;/.test(staffScheduleHeaderActionButtonRule)
        && /background:\s*linear-gradient\(135deg,\s*rgba\(15,23,42,0\.58\),\s*rgba\(15,23,42,0\.40\)\);/.test(staffScheduleCommandBarDarkRule));
    check('HR Pulse browser smoke can verify light theme instead of hardcoding dark mode',
        hrPulseBrowserSmokeCode.includes("const THEME_MODE = String(process.env.HR_PULSE_BROWSER_SMOKE_THEME || 'light').toLowerCase()")
        && hrPulseBrowserSmokeCode.includes("localStorage.setItem('pzp_dark_mode', themeMode === 'dark' ? 'true' : 'false')")
        && hrPulseBrowserSmokeCode.includes('async function assertThemeMode')
        && hrPulseBrowserSmokeCode.includes('async function assertLightScheduleCommandBar')
        && hrPulseBrowserSmokeCode.includes('light pulse card token is not dark')
        && !hrPulseBrowserSmokeCode.includes("localStorage.setItem('pzp_dark_mode', 'true')"));
    check('Staff HR Pulse switcher containers keep bounded containment',
        staffPulseBoundedContainer(staffPulseNavRule)
        && staffPulseBoundedContainer(staffPulseTabRule)
        && staffPulseBoundedContainer(staffScheduleCommandRule));
    check('Staff HR Pulse command shell uses full-width desktop grid without decorative filler',
        /display:\s*grid;/.test(staffPulseNavItemsRule)
        && /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/.test(staffPulseNavItemsRule)
        && /width:\s*100%;/.test(staffPulseNavItemsRule)
        && /overscroll-behavior-inline:\s*contain;/.test(staffPulseNavItemsRule)
        && /content:\s*none;/.test(staffPulseNavAfterRule)
        && /display:\s*none;/.test(staffPulseNavAfterRule)
        && /width:\s*100%;/.test(staffPulseTabRule)
        && /max-width:\s*none;/.test(staffPulseTabRule)
        && /@media \(max-width:\s*1120px\)/.test(staffPagesCss)
        && /overflow-x:\s*auto;/.test(staffPagesCss)
        && /scrollbar-width:\s*none;/.test(staffPagesCss));
    check('Staff HR Pulse responsive polish protects tablet scroll, mobile text, chips, and reduced motion',
        /width:\s*100%;/.test(staffPulseTabletNavRule)
        && /display:\s*flex;/.test(staffPulseTabletItemsRule)
        && /flex-wrap:\s*nowrap;/.test(staffPulseTabletItemsRule)
        && /overflow-x:\s*auto;/.test(staffPulseTabletItemsRule)
        && /scrollbar-width:\s*none;/.test(staffPulseTabletItemsRule)
        && /min-width:\s*0;/.test(staffPulseMobileContentRule)
        && !/padding-right:\s*26px;/.test(staffPulseMobileContentRule)
        && /overflow:\s*hidden;/.test(staffScheduleDeptChipLabelRule)
        && /text-overflow:\s*ellipsis;/.test(staffScheduleDeptChipLabelRule)
        && /white-space:\s*nowrap;/.test(staffScheduleDeptChipLabelRule)
        && /max-width:\s*100%;/.test(staffScheduleCommandHeadingRule)
        && /overflow-wrap:\s*anywhere;/.test(staffScheduleCommandHeadingRule)
        && /animation:\s*none\s*!important;/.test(staffReducedMotionBlock)
        && /transition:\s*none\s*!important;/.test(staffReducedMotionBlock)
        && /transform:\s*none\s*!important;/.test(staffReducedMotionBlock));
    check('Staff HR Pulse icon cards keep bounded decorative affordances',
        /display:\s*grid;/.test(staffPulseTabIconRule)
        && /place-items:\s*center;/.test(staffPulseTabIconRule)
        && /position:\s*absolute;/.test(staffPulseTabLineRule)
        && /transform:\s*scaleX/.test(staffPulseTabLineRule));
    check('Staff schedule command header is CSS-only and removes fixed metric chips',
        !html.includes('images/hr-pulse/schedule-operations.png')
        && !staffPagesCss.includes('schedule-operations.png')
        && !staffPagesCss.includes('.staff-schedule-command-media')
        && !staffPagesCss.includes('.staff-schedule-command-overlay')
        && /background:\s*[\s\S]*linear-gradient/.test(staffScheduleCommandRule)
        && !/url\(/.test(staffScheduleCommandRule)
        && /display:\s*grid;/.test(staffScheduleCommandContentRule)
        && !staffScheduleShellCode.includes('scheduleHeaderPeriod')
        && !staffPagesCss.includes('.staff-schedule-command-metrics')
        && !staffPagesCss.includes('.staff-schedule-metric-chip')
        && staffScheduleSummaryBlock.includes("container.innerHTML = ''")
        && staffScheduleSummaryBlock.includes('container.hidden = true')
        && staffCode.includes('function scheduleHeaderMetricsFromState')
        && staffCode.includes('function updateScheduleHeaderMetrics')
        && staffCode.includes("setScheduleHeaderMetricText('scheduleHeaderPeriod'")
        && staffCode.includes("setScheduleHeaderMetricText('scheduleHeaderDepartment'")
        && staffCode.includes("setScheduleHeaderMetricText('scheduleHeaderStaffCount'")
        && staffCode.includes("setScheduleHeaderMetricText('scheduleHeaderStatus'"));
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
    check('Lead modal date details collects child and adult guest counts safely',
        !!doc.getElementById('leadEventDetails')
        && doc.getElementById('leadEventDate')?.getAttribute('aria-controls') === 'leadEventDetails'
        && doc.getElementById('leadAdultsCount')?.type === 'number'
        && doc.getElementById('leadGuestsTotal')
        && leadPageStyles.includes('.lead-event-details')
        && leadPageStyles.includes('.lead-event-guests-table')
        && leadPageCode.includes("const LEAD_GUEST_NOTE_PREFIX = 'Гості на бажану дату:'")
        && leadPageCode.includes('function leadEventPreferenceFromLead')
        && leadPageCode.includes('eventPreference: isMaysternyaLeadContext()')
        && !leadPageCode.includes('function notesWithLeadGuestSummary')
        && leadPageCode.includes('function guestCountsFromLeadNotes')
        && leadPageCode.includes("const fields = ['leadName', 'leadPhone', 'leadInstagram', 'leadSource', 'leadEventDate', 'leadChildrenCount', 'leadAdultsCount'"));
    check('Lead celebrants use structured rows with birthday and preview', doc.getElementById('leadCelebrants')?.hasAttribute('hidden') && doc.getElementById('ccCelebrants')?.hasAttribute('hidden') && doc.getElementById('leadCelebrantsRows') && doc.getElementById('ccCelebrantsRows') && doc.getElementById('leadCelebrantsPreview') && doc.getElementById('ccCelebrantsPreview') && html.includes('data-celebrants-editor="leadCelebrants"') && html.includes('data-celebrants-editor="ccCelebrants"') && leadPageCode.includes('function renderCelebrantsEditor') && leadPageCode.includes('function getCelebrantsPayload') && leadPageCode.includes('function isCelebrantsEditorDirty') && leadPageCode.includes("if (!editId || leadCelebrantsDirty) body.celebrants = leadCelebrants") && leadPageCode.includes('if (ccCelebrantsDirty) leadBody.celebrants = body.celebrants || []') && leadPageStyles.includes('.lead-celebrant-row') && leadPageStyles.includes('.lead-celebrants-preview'));
    check('Lead edit modal celebrants layout stays inside the dialog', leadPageStyles.includes('#leadModal .lead-modal') && leadPageStyles.includes('overflow-x: hidden;') && leadPageStyles.includes('grid-template-columns: minmax(140px, 1.4fr) minmax(130px, 1fr) minmax(76px, .55fr) 40px') && leadPageStyles.includes('grid-column: 1 / -1;') && leadPageStyles.includes('body.dark-mode .lead-celebrant-remove'));
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

runBookingSummaryChecks(ui, { bookingSummaryBrowserSmokeCode });

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
    check('Tasks scope filters exist', !!doc.getElementById('taskScopeFilters') && !!doc.querySelector('[data-scope="waiting"]') && !!doc.querySelector('[data-scope="idea"]'));
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
    const reportsCss = fs.readFileSync(path.join(ROOT, 'css', 'pages-reports.css'), 'utf8');
    const removedChartText = ['Динаміка прибутку', 'Витрати по категоріях', 'Доходи vs Витрати (по днях)'];
    check('Reports page removes low-signal chart blocks', removedChartText.every(text => !html.includes(text)));
    check('Reports page has no chart canvases or Chart.js CDN', !doc.getElementById('barChart') && !doc.getElementById('pieChart') && !doc.getElementById('lineChart') && !html.includes('cdn.jsdelivr.net/npm/chart.js'));
    check('Reports page script no longer renders Chart.js widgets', !reportsCode.includes('renderCharts') && !reportsCode.includes('new Chart(') && !reportsCode.includes('rpt-chart'));
    check('Reports manual modal uses page-scoped polished controls', !!doc.querySelector('#reportModal .rpt-report-modal') && reportsCss.includes('#reportForm select.form-control') && reportsCss.includes('appearance: none') && html.includes('rpt-hashtag-controls') && !html.includes('id="reportHashtagSelect" class="form-control" style='));
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
const reportsRouteCode = fs.readFileSync(path.join(ROOT, 'routes', 'reports.js'), 'utf8');
const authRouteCode = fs.readFileSync(path.join(ROOT, 'routes', 'auth.js'), 'utf8');
const profileAvatarStorageCode = fs.readFileSync(path.join(ROOT, 'services', 'profileAvatarStorage.js'), 'utf8');
const imageStorageCodeForProfileChecks = fs.readFileSync(path.join(ROOT, 'services', 'imageStorage.js'), 'utf8');
const serverCode = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const taskCreateCode = fs.readFileSync(path.join(ROOT, 'js', 'task-create.js'), 'utf8');
const taskUiSharedCode = fs.readFileSync(path.join(ROOT, 'js', 'task-ui-shared.js'), 'utf8');
const tasksPageCodeForProfileChecks = fs.readFileSync(path.join(ROOT, 'js', 'tasks-page.js'), 'utf8');
const tasksHtmlForProfileChecks = fs.readFileSync(path.join(ROOT, 'tasks.html'), 'utf8');
const soundEngineCodeForProfileChecks = fs.readFileSync(path.join(ROOT, 'js', 'sound-engine.js'), 'utf8');
const profilePagesCss = cssTextWithImports('css/pages.css');
const questsRouteCode = fs.readFileSync(path.join(ROOT, 'routes', 'quests.js'), 'utf8');
const renderMyTasksBody = profileCode.match(/function renderMyTasksTab\(\) \{[\s\S]*?\n\}/)?.[0] || '';
const renderMyDayBody = profileCode.match(/function renderMyDayTab\(\) \{[\s\S]*?\n\}/)?.[0] || '';
const renderMyDayCommandCenterBody = profileCode.match(/function renderMyDayCommandCenterTab\(\) \{[\s\S]*?\n\}/)?.[0] || '';
const renderCabinetMyDaySecondaryStart = profileCode.indexOf('function renderCabinetMyDaySecondary');
const renderMyDayCommandCenterStart = profileCode.indexOf('function renderMyDayCommandCenterTab');
const renderCabinetMyDaySecondaryBody = renderCabinetMyDaySecondaryStart > -1 && renderMyDayCommandCenterStart > renderCabinetMyDaySecondaryStart
    ? profileCode.slice(renderCabinetMyDaySecondaryStart, renderMyDayCommandCenterStart)
    : '';
const profileWorkHubTabOrderBody = profileCode.match(/function profileWorkHubTabOrder\(\) \{[\s\S]*?\n\}/)?.[0] || '';
const profileSecondaryTabOrderBody = profileCode.match(/function profileSecondaryTabOrder\(\) \{[\s\S]*?\n\}/)?.[0] || '';
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
check('Profile My Day uses a compact profile capsule without removing the full profile header path', profileCode.includes('function renderProfileMyDayCapsule') && profileCode.includes('data-profile-my-day-capsule') && profileCode.includes("const isMyDayTab = activeTab === 'myday';") && profileCode.includes('profile-work-header--myday') && profileCode.includes('renderProfileMyDayCapsule(p, professionEntries)') && profileCode.includes('renderProfileProfessionHeaderPanel(professionEntries)') && profilePagesCss.includes('.profile-work-header--myday') && profilePagesCss.includes('.profile-my-day-capsule') && profilePagesCss.includes('.profile-my-day-capsule-avatar'));
check('Profile My Day header removes duplicate profession switcher and subtitle copy', !profileCode.includes('робочі + особисті задачі') && profileCode.includes('profile-work-hub--myday') && profileCode.includes("${isMyDayTab ? '' : renderProfileProfessionSwitcher(professionEntries)}") && profileCode.includes('function renderProfileProfessionSwitcher') && profileCode.includes('profile-work-hub-context') && profilePageHtml.includes('.profile-work-hub--myday'));
check('Profile secondary tabs put My Day before professions and remove redundant route helper copy', profileWorkHubTabOrderBody.includes("id: 'professions'") && profileSecondaryTabOrderBody.includes("{ id: 'myday', label: 'Мій день', ownOnly: true }") && profileSecondaryTabOrderBody.indexOf("id: 'myday'") < profileSecondaryTabOrderBody.indexOf('...profileWorkHubTabOrder().map') && !profileCode.includes('Усі вкладки лишаються в одному компактному маршруті'));
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
check('Profile cabinet undo uses canonical status route with retry-safe toast state', profileCode.includes('result = await apiPatch(`/tasks/${id}/status`, { status, sourceSurface })') && profileCode.includes("undoBtn.setAttribute('aria-busy', 'true')") && profileCode.includes("undoBtn.removeAttribute('aria-busy')") && profileCode.includes('scheduleDismiss(9000)') && !profileCode.includes('apiQuickTaskStatus(id, status)') && !profileCode.includes('/auth/tasks/${id}/quick-status'));
check('Profile cabinet removes redundant task action legend row', !profileCode.includes('function renderCabinetTaskActionLegend') && !profileCode.includes('cabinet-action-legend') && !profilePagesCss.includes('.cabinet-action-legend'));
check('Profile overdue due badge opens reschedule choices and respects permission control', profileCode.includes('data-cabinet-task-action="reschedule-overdue-menu"') && profileCode.includes('data-cabinet-task-action="reschedule-overdue"') && profileCode.includes("['today', 'Сьогодні']") && profileCode.includes("['day_after', 'Післязавтра']") && profileCode.includes("'profile_my_cabinet_overdue_badge'") && profileCode.includes('cabinetTaskAllowReschedule') && profilePagesCss.includes('.cabinet-reschedule-menu'));
check('Profile my day supports persisted move-to-today drag for overdue and typed planned tasks', profileCode.includes('data-cabinet-task-drag="${dragKind}"') && profileCode.includes('data-cabinet-task-drag-target="today"') && profileCode.includes('data-cabinet-task-drop-target="today"') && profileCode.includes('function handleCabinetTaskDrop') && profileCode.includes('function moveCabinetTaskToToday') && profileCode.includes("profile_my_cabinet_overdue_to_today_drop") && profileCode.includes("profile_my_cabinet_move_to_today_drop") && profilePagesCss.includes('.cabinet-task-section--drop-target.is-drag-over') && profilePagesCss.includes('.cabinet-task-move-today'));
check('Profile cabinet tasker has canonical My Day projection and default-collapsed composer', profileCode.includes('const CABINET_TASK_SEGMENTS') && profileCode.includes('function cabinetTaskMatchesSegment') && profileCode.includes('function cabinetSegmentCounts') && profileCode.includes('function renderCabinetTaskComposer') && profileCode.includes('function renderCabinetMyDayListModeToggle') && profileCode.includes('data-cabinet-composer-state=') && profileCode.includes("'expanded' : 'collapsed'") && profileCode.includes('data-cabinet-composer-toggle') && profileCode.includes('data-cabinet-composer-advanced') && profileCode.includes('function setCabinetTaskComposerExpanded') && profileCode.includes('function isCabinetPersonalTask') && profileCode.includes("visibility === 'me_only'") && profileCode.includes("category === 'improvement'") && profileCode.includes('function normalizeProfileTaskTab') && profileCode.includes("return tab === 'mytasks' ? 'myday' : tab;") && profileCode.includes('function syncProfileTabToUrl') && profileCode.includes('data-cabinet-due-preset') && profileCode.includes("value: 'month_end'") && profileCode.includes('data-cabinet-priority-preset') && profileCode.includes('data-cabinet-my-day-view-mode') && profileCode.includes('CABINET_MY_DAY_VIEW_MODE_OPTIONS') && profileCode.includes('aria-label="Дата задачі:') && profileCode.includes('aria-label="Пріоритет:') && !profileCode.includes('data-cabinet-due-preset="all"') && profilePagesCss.includes('.cabinet-task-composer.is-collapsed') && profilePagesCss.includes('[data-cabinet-composer-advanced][hidden]') && profilePagesCss.includes('.cabinet-task-priority') && profilePagesCss.includes('.cabinet-priority-chip') && profilePagesCss.includes('.cabinet-due-chip:focus-visible') && profilePagesCss.includes('.cabinet-list-mode-chip:focus-visible') && profilePagesCss.includes('text-overflow: ellipsis'));
check('Profile My Day uses a responsive two-column workspace without duplicated command controls', profileCode.includes('const CABINET_MY_DAY_SEGMENTS') && profileCode.includes('function cabinetMyDaySegmentCounts') && profileCode.includes('function renderCabinetMyDaySegments') && profileCode.includes('function setCabinetMyDaySegment') && renderMyDayCommandCenterBody.includes('data-cabinet-my-day-layout="focused-overdue"') && renderMyDayCommandCenterBody.includes('data-cabinet-focused-preset=') && renderMyDayCommandCenterBody.includes('cabinet-day-column--today') && renderMyDayCommandCenterBody.includes('cabinet-day-column--overdue') && renderMyDayCommandCenterBody.includes('renderCabinetMyDayTodayPrimary(primaryContext)') && renderMyDayCommandCenterBody.includes('renderCabinetOverdueTriageList(overdue)') && renderMyDayCommandCenterBody.includes('renderCabinetMyDayListModeToggle()') && profileCode.includes('CABINET_MY_DAY_VIEW_MODE_OPTIONS') && profileCode.includes('data-cabinet-my-day-view-mode') && !renderMyDayCommandCenterBody.includes('cabinet-day-command-bar') && !renderMyDayCommandCenterBody.includes('renderCabinetMyDaySegments()') && !renderMyDayCommandCenterBody.includes('data-cabinet-my-day-sound-settings') && !renderMyDayCommandCenterBody.includes('renderCabinetMyDaySoundSettingsAction()') && !renderMyDayCommandCenterBody.includes('cabinet-day-command-stats') && profilePagesCss.includes('.cabinet-command-center') && profilePagesCss.includes('container-type: inline-size') && profilePagesCss.includes('.cabinet-day-workspace--two-column') && profilePagesCss.includes('grid-template-columns: repeat(2, minmax(0, 1fr));') && profilePagesCss.includes('@container (max-width: 1120px)') && profilePagesCss.includes('grid-template-columns: 1fr;') && profilePagesCss.includes('.cabinet-day-workspace--two-column .cabinet-day-column--overdue'));
check('Profile My Day renders one unified completion pulse after composer without legacy history duplication', renderMyDayCommandCenterBody.indexOf('renderCabinetTaskComposer') > -1 && renderMyDayCommandCenterBody.indexOf('renderCabinetCompletionPulse()') > renderMyDayCommandCenterBody.indexOf('renderCabinetTaskComposer') && renderMyDayCommandCenterBody.indexOf('cabinet-day-workspace') > renderMyDayCommandCenterBody.indexOf('renderCabinetCompletionPulse()') && !renderMyDayCommandCenterBody.includes('renderCabinetCompletedHistoryStrip()') && !renderMyDayCommandCenterBody.includes('renderCabinetCompletedTodayDashboard()') && !renderCabinetMyDaySecondaryBody.includes('renderCabinetCompletedHistoryStrip()') && profileCode.includes('function renderCabinetCompletionPulse') && profileCode.includes('data-cabinet-completion-pulse') && profileCode.includes('data-cabinet-completion-toggle') && profileCode.includes('completedDashboardExpanded'));
check('Profile My Day all mode groups are collapsible with accessible stable headers', profileCode.includes('const CABINET_MY_DAY_ALL_GROUP_IDS') && profileCode.includes('const collapsedCabinetAllGroupIds') && profileCode.includes('function toggleCabinetAllGroup') && profileCode.includes('data-cabinet-all-group-toggle') && profileCode.includes('aria-expanded="${isCollapsed ?') && profileCode.includes('aria-controls="${escapeHtml(sectionBodyId)}"') && profileCode.includes('data-cabinet-all-group-collapsed') && profileCode.includes('cabinetAllGroupBound') && profilePagesCss.includes('.cabinet-task-section--all-group.is-collapsed') && profilePagesCss.includes('.cabinet-section-toggle:focus-visible') && profilePagesCss.includes('.cabinet-section-body[hidden]') && profilePagesCss.includes('.cabinet-section-toggle-icon'));
check('Profile My Day composer keeps due chips separate from priority chips', profileCode.includes('const duePresets = CABINET_DUE_PRESETS.map') && profileCode.includes('const priorityPresets = renderCabinetPriorityPresets(selectedPriority)') && profileCode.indexOf('cabinet-task-control-group--due') > -1 && profileCode.indexOf('cabinet-task-control-group--priority') > profileCode.indexOf('cabinet-task-control-group--due') && profileCode.includes('class="cabinet-due-presets"') && profileCode.includes('class="cabinet-priority-presets"') && !profileCode.includes('data-cabinet-due-preset="${item.value}"'));
check('Profile cabinet subtask add action is anchored above the editable subtask list', profileCode.includes('class="cabinet-subtask-list-toolbar"') && profileCode.indexOf('onclick="addCabinetSubtask()"') > profileCode.indexOf('id="cabinetSubtaskDraftStatus"') && profileCode.indexOf('onclick="addCabinetSubtask()"') < profileCode.indexOf('id="cabinetSubtaskList"') && profilePagesCss.includes('.cabinet-subtask-list-toolbar'));
check('Profile My Day compact task cards keep bounded metadata and move checklist details behind view expansion', profileCode.includes('let activeCabinetInlineTaskId') && profileCode.includes('function cabinetResolveActiveInlineTaskId') && profileCode.includes('function cabinetDefaultInlineTaskId') && profileCode.includes('function setCabinetActiveInlineTask') && profileCode.includes('function cabinetTaskVisibleBadges') && profileCode.includes('data-cabinet-visible-badge') && profileCode.includes('is-my-day-compact-card') && profileCode.includes('data-cabinet-active-subtask-slice') && profileCode.includes('function renderCabinetActiveSubtaskSlice') && profileCode.includes('function renderCabinetMyDaySubtaskSummary') && profileCode.includes('data-cabinet-subtask-summary') && profileCode.includes('showMyDayDetails ? myDaySubtaskSummary :') && profileCode.includes('data-cabinet-task-action="toggle-my-day-details"') && profilePagesCss.includes('.cabinet-task-card.is-my-day-compact-card') && profilePagesCss.includes('.cabinet-task-visible-badge') && profilePagesCss.includes('.cabinet-subtask-summary') && profilePagesCss.includes('.cabinet-subtask-active-slice') && profilePagesCss.includes('.cabinet-subtask-toggle::after'));
check('Profile My Day overdue segment renders a responsive triage shell with existing delegated actions', profileCode.includes('function renderCabinetOverdueTriageList') && profileCode.includes('function renderCabinetOverdueTriageRow') && profileCode.includes('data-cabinet-overdue-triage') && profileCode.includes('data-cabinet-overdue-triage-row') && profileCode.includes('data-cabinet-task-action="move-to-today"') && profileCode.includes('data-cabinet-task-action="reschedule-overdue"') && profileCode.includes('data-reschedule-option="custom"') && profileCode.includes('data-source-surface="profile_my_cabinet_overdue_triage"') && profileCode.includes('data-cabinet-move-target="no_date"') && profileCode.includes('data-cabinet-move-method="triage"') && profileCode.includes("button.dataset.cabinetMoveMethod || 'menu'") && profilePagesCss.includes('.cabinet-overdue-triage') && profilePagesCss.includes('container-type: inline-size') && profilePagesCss.includes('.cabinet-overdue-triage-row') && profilePagesCss.includes('display: block;') && profilePagesCss.includes('.cabinet-task-zone--header') && profilePagesCss.includes('.cabinet-overdue-triage-actions') && profilePagesCss.includes('flex-wrap: wrap') && profilePagesCss.includes('@container (max-width: 640px)') && profilePagesCss.includes('.cabinet-overdue-triage-actions .cabinet-task-more'));
check('Profile my tasks duplicate is neutralized into My Day plus canonical Tasks link', renderMyDayBody.includes('return renderMyDayCommandCenterTab();') && profileCode.includes('renderCabinetTaskComposer') && profileCode.includes('function renderCabinetMyDaySecondary') && profileCode.includes('function renderCabinetPulseCluster') && !renderCabinetMyDaySecondaryBody.includes('renderCabinetPulseCluster()') && renderMyTasksBody.includes('return renderMyDayTab();') && profileCode.includes('function normalizeProfileTaskTab') && profileCode.includes("case 'mytasks': return renderMyDayTab();") && profileCode.includes('href="/tasks?view=today"') && profileCode.includes('href="/tasks?view=waiting"') && profileCode.includes('cabinet-command-center') && !profileCode.includes("setCabinetQuickMode('tasks')") && !profileCode.includes('href="/profile?tab=mytasks"') && !profileCode.includes('cabinet-shell--mytasks'));
check('Profile My Day preserves sound settings helpers without visible command shortcut', profileCode.includes('function renderCabinetMyDaySoundSettingsAction') && profileCode.includes('data-cabinet-my-day-sound-settings') && profileCode.includes('function openCabinetMyDaySoundSettings') && profileCode.includes("window.TaskUI?.openActionMenu?.(button") && profileCode.includes('function bindCabinetTaskSoundControls') && profileCode.includes('bindCabinetTaskSoundControls(root)') && profileCode.includes("apiPatch('/tasks/preferences'") && !renderMyDayCommandCenterBody.includes('data-cabinet-my-day-sound-settings') && !renderMyDayCommandCenterBody.includes('renderCabinetMyDaySoundSettingsAction()') && !renderMyDayCommandCenterBody.includes('cabinet-day-action--settings') && !profileCode.includes('<div class="cabinet-section-head"><h3>Звук</h3><span>налаштування</span></div>') && profilePagesCss.includes('.cabinet-sound-settings-menu'));
const legacyProfileNewLeadPath = ['/api/leads', 'new-count'].join('/');
const legacyProfileApiGetNewLead = "apiGet('/leads/" + "new-count'";
check('Profile cabinet pulse uses canonical business-scoped live counters', profileCode.includes('function apiGetScoped') && profileCode.includes("apiGetScoped('/business/live-counters')") && profileCode.includes('function profileLiveCounterBucket') && profileCode.includes('function syncCabinetPulseCounts(liveCounters)') && profileCode.includes('bucket.alerts?.active') && profileCode.includes('safeCabinetPulseCount(leads.hot) || safeCabinetPulseCount(leads.new)') && !profileCode.includes(legacyProfileApiGetNewLead) && !profileCode.includes(legacyProfileNewLeadPath) && !profileCode.includes("apiGet('/dashboard/alerts'"));
check('Profile unified completion pulse exposes Today and cursor-backed History as one local drilldown', profileCode.includes('function renderCabinetCompletionPulse') && profileCode.includes('function renderCabinetCompletionDetails') && profileCode.includes('function renderCabinetCompletionTabs') && profileCode.includes('function renderCabinetCompletionTaskRow') && profileCode.includes('function showMoreCabinetCompletionDetails') && profileCode.includes('function loadNextCabinetCompletionHistoryPage') && profileCode.includes('function fetchCabinetCompletionHistoryPage') && profileCode.includes('completedDashboardHistoryState') && profileCode.includes('nextCursor') && profileCode.includes('hasMore') && profileCode.includes('requestSeq') && profileCode.includes('Завантажено') && profileCode.includes('/tasks/my-cabinet/completions') && profileCode.includes('data-cabinet-completion-tab="today"') && profileCode.includes('data-cabinet-completion-tab="history"') && profileCode.includes('aria-controls="cabinetCompletionDetails"') && profileCode.includes('completedTodayTasks') && profileCode.includes('completedHistory') && profileCode.includes('data-cabinet-task-action="open"') && profileCode.includes('completedDashboardVisibleCount') && profileCode.includes('completedDashboardHistoryVisibleCount') && !profileCode.includes('Історія на 36 записів тут не використовується') && !profileCode.includes('<details class="cabinet-completed-details">') && !profileCode.includes('data-cabinet-completed-day-divider') && htmlContains('services/taskCabinetProjection.js', 'completedHistoryLimit') && htmlContains('services/taskCompletionHistory.js', "COALESCE(t.status, 'todo') = 'done'") && htmlContains('services/taskCompletionHistory.js', 'nextCursor') && htmlContains('services/taskCabinetProjection.js', 'completedHistoryOverflow'));
check('Profile completion pulse stays compact, icon-safe and namespaced with inline metrics and micro-bars', profileCode.includes('let completedDashboardExpanded = false') && profileCode.includes("let completedDashboardTab = 'today'") && profileCode.includes('function renderCabinetImpactIcon') && profileCode.includes('window.MyDayImpactIcons.render') && profileCode.includes('function renderCabinetCompletionPulse') && profileCode.includes('function renderCabinetCompletedTodayDashboard') && profileCode.includes('cabinet-completion-summary') && profileCode.includes('data-cabinet-completion-toggle') && profileCode.includes('data-cabinet-completion-all="true"') && profileCode.includes('Вигляд карток') && profileCode.includes('Компактний') && profileCode.includes('Повний') && !profileCode.includes('data-cabinet-completed-today-toggle') && !profileCode.includes('cabinetCompletedTodayExpanded') && !profileCode.includes('cabinet-completed-today') && !profileCode.includes('impact.icon') && profilePagesCss.includes('/* Unified My Day completion pulse */') && profilePagesCss.includes('.cabinet-completion-pulse') && profilePagesCss.includes('.cabinet-completion-summary') && profilePagesCss.includes('.cabinet-completion-icon .my-day-impact-icon') && profilePagesCss.includes('.cabinet-completion-tabs') && profilePagesCss.includes('.cabinet-completion-row[hidden]') && profilePagesCss.includes('.cabinet-day-workspace-toolbar') && profilePagesCss.includes('.cabinet-view-mode-label') && profilePagesCss.includes('body:not(.dark-mode) .cabinet-completion-pulse') && profilePagesCss.includes('html[data-theme="light"] body .cabinet-completion-pulse') && !profilePagesCss.includes('cabinet-completed-today') && profilePagesCss.includes('overflow: hidden;') && profilePagesCss.includes('height: 5px;'));
check('My Day browser smokes catch production completion-pulse visual regressions', myDayInteractionsBrowserSmokeCode.includes('/js/my-day-impact-icons.js') && myDayInteractionsBrowserSmokeCode.includes('window.MyDayImpactIcons.render') && ['system', 'processes', 'learning', 'network'].every(key => myDayInteractionsBrowserSmokeCode.includes(`icon: '${key}'`)) && myDayInteractionsBrowserSmokeCode.includes('raw impact icon keys must not appear') && myDayInteractionsBrowserSmokeCode.includes('impact labels overlap bars') && myDayInteractionsBrowserSmokeCode.includes('completion buttons leak outside the container') && myDayInteractionsBrowserSmokeCode.includes('width: 1440, height: 900') && myDayInteractionsBrowserSmokeCode.includes('width: 1280, height: 720') && myDayInteractionsBrowserSmokeCode.includes('width: 390, height: 844') && myDayInteractionsBrowserSmokeCode.includes('data-cabinet-completion-all') && myDayInteractionsBrowserSmokeCode.includes('completedHistoryApiReads') && myDayInteractionsBrowserSmokeCode.includes('History API down') && myDayInteractionsBrowserSmokeCode.includes('simulateCompletionProjectionRefresh') && myDayInteractionsBrowserSmokeCode.includes('History rows must be deduped by task id') && myDayActualAppBrowserSmokeCode.includes('function assertMyDayCompletionPulseContracts') && myDayActualAppBrowserSmokeCode.includes('command center renders one completion pulse') && myDayActualAppBrowserSmokeCode.includes('card view mode control has an explicit label') && myDayActualAppBrowserSmokeCode.includes('raw impact keys visible') && myDayActualAppBrowserSmokeCode.includes('impact labels overlap bars') && myDayActualAppBrowserSmokeCode.includes('completion buttons leak outside pulse') && myDayActualAppBrowserSmokeCode.includes('History rows should not duplicate task ids after Show more') && myDayActualAppBrowserSmokeCode.includes('History tab must not promise full history without pagination completion') && myDayActualAppBrowserSmokeCode.includes('no four identical cabinet projection requests') && myDayActualAppBrowserSmokeCode.includes('bundle review sends explicit accepted field masks') && myDayActualAppBrowserSmokeCode.includes('second disposable account does not see the first account active timer through API') && myDayActualAppBrowserSmokeCode.includes('AI simple commit from real Tasks composer'));
check('My Day AI draft contract preserves accepted description and impacts through UI commit and projected cards',
    htmlContains('tests/task-ai-draft-ui-contract.test.js', 'preview → accept → commit')
    || (
        htmlContains('tests/task-ai-draft-ui-contract.test.js', 'carries accepted description and impacts into commit payload')
        && htmlContains('tests/task-ai-draft-cabinet-projection.test.js', 'cabinet projection returns persisted My Day impacts')
        && htmlContains('js/task-ai-draft.js', 'function commitPayloadFor(root)')
        && htmlContains('js/task-ai-draft.js', 'acceptedFieldMask')
        && htmlContains('js/task-ai-draft.js', 'finalDraft')
        && htmlContains('js/task-ai-draft.js', 'impactIds')
        && htmlContains('js/profile-page.js', 'window.TaskCreate.commitAiDraft')
        && htmlContains('js/profile-page.js', 'window.TaskAiDraft?.markCommittedTaskId')
        && htmlContains('js/profile-page.js', 'renderCabinetMyDayClassificationZone(task')
        && htmlContains('services/taskCabinetProjection.js', 'myDay: myDayClassificationsByTaskId.get(taskId)')
    ));
check('Live My Day smoke validates the unified completion pulse instead of stale history details', liveMyDaySmokeCode.includes('function assertCompletionPulseDisclosure') && liveMyDaySmokeCode.includes('data-cabinet-completion-pulse') && liveMyDaySmokeCode.includes('data-cabinet-completion-toggle') && liveMyDaySmokeCode.includes('data-cabinet-completion-tab="today"') && liveMyDaySmokeCode.includes('data-cabinet-completion-tab="history"') && liveMyDaySmokeCode.includes('raw impact icon keys visible') && liveMyDaySmokeCode.includes('expanded completion pulse overflows horizontally') && liveMyDaySmokeCode.includes('completion details are removed after collapse') && !liveMyDaySmokeCode.includes('cabinet-completed-strip--compact') && !liveMyDaySmokeCode.includes('cabinet-completed-details'));
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
const taskPriorityStates = ['urgent', 'high', 'normal', 'low'];
const tasksPriorityStyleSurface = `${tasksHtmlForProfileChecks}\n${profilePagesCss}`;
check('Urgent tasks are visibly highlighted across profile and tasks surfaces', profileCode.includes('data-task-priority="${escapeHtml(priority)}"') && profileCode.includes('priority-${priority}') && profileCode.includes('profile-task-priority--${escapeHtml(priority)}') && profileCode.includes('cabinet-task-priority-select--${escapeHtml(selected)}') && legacyProfileGameCode.includes('urgent-priority high-priority') && legacyProfileGameCode.includes('prof-inbox-item danger${urgentCls}') && tasksPageCodeForProfileChecks.includes("data-priority=\"${escapeHtml(t.priority || 'normal')}\"") && tasksPageCodeForProfileChecks.includes('task-priority-select--${escapeHtml(current)}') && profilePagesCss.includes('.profile-task-row[data-task-priority="urgent"]') && profilePagesCss.includes('.profile-task-priority--urgent') && profilePagesCss.includes('body.dark-mode .profile-task-row[data-task-priority="urgent"]') && profilePagesCss.includes('.cabinet-task-card.priority-urgent') && profilePagesCss.includes('.cabinet-task-priority-select--urgent') && profilePagesCss.includes('.task-card[data-priority="urgent"]') && profilePagesCss.includes('.task-priority-select--urgent') && darkModeCss.includes('body.dark-mode .prof-task-row.urgent-priority') && darkModeCss.includes('body.dark-mode .task-card[data-priority="urgent"]'));
check('Task priority colors cover urgent, high, normal and low across Tasks and Profile', taskPriorityStates.every(priority => tasksPageCodeForProfileChecks.includes(`{ value: '${priority}'`)) && taskPriorityStates.every(priority => profileCode.includes(`{ value: '${priority}'`)) && taskPriorityStates.every(priority => tasksPriorityStyleSurface.includes(`.task-card[data-priority="${priority}"]`)) && taskPriorityStates.every(priority => tasksPriorityStyleSurface.includes(`.task-priority-select--${priority}`)) && taskPriorityStates.every(priority => profilePagesCss.includes(`.profile-task-row[data-task-priority="${priority}"]`) || profilePagesCss.includes(`.cabinet-task-card[data-task-priority="${priority}"]`)) && taskPriorityStates.every(priority => profilePagesCss.includes(`.cabinet-task-priority-select--${priority}`)) && ['high', 'normal', 'low'].every(priority => tasksPriorityStyleSurface.includes(`body.dark-mode .task-card[data-priority="${priority}"]`) || tasksPriorityStyleSurface.includes(`html[data-theme="dark"] .task-card[data-priority="${priority}"]`)) && ['high', 'normal', 'low'].every(priority => profilePagesCss.includes(`body.dark-mode .profile-task-row[data-task-priority="${priority}"]`) || profilePagesCss.includes(`body.dark-mode .cabinet-task-card[data-task-priority="${priority}"]`)));
check('Tasks and Profile share task UI priority/status helpers',
    taskUiSharedCode.includes('global.TaskUiShared = Object.freeze')
    && taskUiSharedCode.includes('normalizeTaskPriority')
    && taskUiSharedCode.includes('taskPriorityLabel')
    && taskUiSharedCode.includes('taskPriorityRank')
    && taskUiSharedCode.includes('normalizeTaskStatus')
    && taskUiSharedCode.includes('taskMutationFailure')
    && taskUiSharedCode.includes('taskOfflineFailure')
    && taskUiSharedCode.includes('applyPriorityClasses')
    && taskUiSharedCode.includes("if (value === 'critical') return 'urgent';")
    && taskUiSharedCode.includes("if (value === 'medium') return 'normal';")
    && tasksHtmlForProfileChecks.includes('js/task-ui-shared.js')
    && profilePageHtml.includes('js/task-ui-shared.js')
    && tasksHtmlForProfileChecks.indexOf('js/task-ui-shared.js') < tasksHtmlForProfileChecks.indexOf('js/tasks-page.js')
    && profilePageHtml.indexOf('js/task-ui-shared.js') < profilePageHtml.indexOf('js/profile-page.js')
    && tasksPageCodeForProfileChecks.includes('window.TaskUiShared?.normalizeTaskPriority')
    && tasksPageCodeForProfileChecks.includes('window.TaskUiShared?.taskMutationFailure')
    && tasksPageCodeForProfileChecks.includes('window.TaskUiShared?.applyPriorityClasses')
    && profileCode.includes('window.TaskUiShared?.normalizeTaskPriority')
    && profileCode.includes('window.TaskUiShared?.normalizeTaskMutationResult')
    && profileCode.includes('window.TaskUiShared?.applyPriorityClasses'));
check('Task status and priority mutations fail visibly and rollback quick priority controls',
    tasksPageCodeForProfileChecks.includes('function taskMutationFailure(payload = {}, response = null')
    && tasksPageCodeForProfileChecks.includes('function taskMutationOfflineFailure(error, fallback =')
    && tasksPageCodeForProfileChecks.includes('function normalizeTaskMutationResult(result, fallback =')
    && tasksPageCodeForProfileChecks.includes('requestId: payload.requestId || payload.request_id || null')
    && tasksPageCodeForProfileChecks.includes('offline: true')
    && tasksPageCodeForProfileChecks.includes('setTaskPrioritySelectBusy(select, true)')
    && tasksPageCodeForProfileChecks.includes('setTaskPrioritySelectBusy(select, false)')
    && tasksPageCodeForProfileChecks.includes('applyTaskPriorityVisualState(taskId, previous)')
    && tasksPageCodeForProfileChecks.includes('setTaskPrioritySelectVisual(select, previous)')
    && tasksPageCodeForProfileChecks.includes('const mutation = normalizeTaskMutationResult(result,')
    && tasksPageCodeForProfileChecks.includes('if (!res.ok)')
    && tasksPageCodeForProfileChecks.includes('taskMutationFailure(data, res,')
    && profileCode.includes('function normalizeCabinetTaskMutationResult(result, fallback =')
    && profileCode.includes('function patchCabinetTaskPriority(taskId, priority)')
    && profileCode.includes('setCabinetPrioritySelectBusy(select, true)')
    && profileCode.includes('setCabinetPrioritySelectBusy(select, false)')
    && profileCode.includes('applyCabinetTaskPriorityVisualState(taskId, previous, select)')
    && profileCode.includes("const mutation = normalizeCabinetTaskMutationResult(result, 'Task status update failed')")
    && profileCode.includes("throw new Error(mutation.error || 'Task status update failed')"));
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
check('Server reads Postgres-backed profile avatars before static and blocks SPA HTML fallback', serverCode.includes("app.get('/uploads/profile-avatars/*'")
    && serverCode.includes("app.use('/uploads/profile-avatars'")
    && serverCode.includes("error: 'profile_avatar_not_found'")
    && serverCode.indexOf("app.get('/uploads/profile-avatars/*'") < serverCode.indexOf("app.use('/uploads/profile-avatars'")
    && serverCode.indexOf("app.use('/uploads/profile-avatars'") < serverCode.indexOf("app.use(express.static(path.join(__dirname)))"));
check('Server reads Postgres-backed catalog images before static and blocks SPA HTML fallback', imageStorageCodeForProfileChecks.includes('CATALOG_IMAGE_STORAGE_BUCKET = \'catalog_image_blobs\'') && imageStorageCodeForProfileChecks.includes('buildCatalogImageBlobFallbackHandler') && serverCode.includes("app.get('/uploads/catalog-images/items/:filename'") && serverCode.includes("app.use('/uploads/catalog-images/items'") && serverCode.includes("error: 'image_not_found'") && serverCode.indexOf("app.get('/uploads/catalog-images/items/:filename'") < serverCode.indexOf("app.use(express.static(path.join(__dirname)))"));
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
    'js/hr-pulse-switcher.js', 'js/hr-page.js', 'js/staff-page.js', 'js/customers-page.js',
    'js/tasks-page.js', 'js/leads-page.js', 'js/chat-page.js', 'js/chat-settings-page.js', 'js/timeline-settings-page.js',
    'js/warehouse-page.js', 'js/reports-page.js', 'js/certificates-page.js', 'js/afisha-page.js', 'js/crm-feature-registry.js',
    'js/booking-drawer-state.js', 'js/booking-banquet-selector.js', 'js/booking-save-path.js',
    'js/invite-config.js', 'js/invite-share.js',
    'js/booking-package-renderer.js', 'js/booking-banquet-detail.js', 'js/booking-activity-schedule.js', 'js/booking.js', 'js/booking-summary-page.js', 'js/timeline-interaction-model.js',
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
const inlineHeaderSettingsOwners = htmlFiles
    .map(file => ({ file, html: fs.readFileSync(path.join(ROOT, file), 'utf8') }))
    .filter(page => getInlineScripts(page.html).some(code => (
        code.includes('headerSettingsBtn')
        && (code.includes('addEventListener') || code.includes('onclick'))
    )));
const legacyHeaderLogoutOutliers = ['afisha.html', 'certificates.html', 'designs.html']
    .map(file => {
        const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
        const dom = new JSDOM(html);
        const doc = dom.window.document;
        const logoutBtn = doc.querySelector('.header .header-content > .user-panel > #logoutBtn.btn-logout[type="button"]:not([onclick])');
        const result = {
            file,
            ok: Boolean(logoutBtn) && scriptIndex(getHtmlScripts(html), 'js/auth.js') >= 0
        };
        dom.window.close();
        return result;
    });
const pagesWithStaticHeaderThemeToggle = htmlFiles.filter(file => {
    const dom = new JSDOM(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    const hasToggle = !!dom.window.document.getElementById('headerThemeToggle');
    dom.window.close();
    return hasToggle;
});
const pagesWithStaticHeaderSettingsButton = htmlFiles.filter(file => {
    const dom = new JSDOM(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    const hasSettings = !!dom.window.document.getElementById('headerSettingsBtn');
    dom.window.close();
    return hasSettings;
});
const pagesWithStaticTimelineConstructor = htmlFiles.filter(file => {
    const dom = new JSDOM(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    const hasConstructor = !!dom.window.document.getElementById('timelineConstructorBtn');
    dom.window.close();
    return hasConstructor;
});

check('Auth exposes shared bindLogoutButton', authCode.includes('function bindLogoutButton()') && authCode.includes("btn.dataset.logoutBound === '1'"));
check('Auth owns logoutBtn DOM binding', authCode.includes("const btn = document.getElementById('logoutBtn')") && authCode.includes("btn.addEventListener('click'") && authCode.includes('event.preventDefault();') && authCode.includes('logout();'));
check('Shared logout binding calls canonical logout', authCode.includes('event.preventDefault();') && authCode.includes('logout();'));
check('Shared logout binding auto-initializes', authCode.includes('initSharedLogoutBinding();') && authCode.includes("document.addEventListener('DOMContentLoaded', bindLogoutButton"));
check('Auth initializes shared header actions before the header theme toggle',
    authCode.includes('function initSharedHeaderActions()')
    && authCode.includes('function isEmbeddedShellMode()')
    && authCode.includes("document.querySelectorAll('.header .user-panel')")
    && authCode.includes("panel.classList.add('header-actions')")
    && authCode.includes('HEADER_SETTINGS_PLACEHOLDER_TEXT')
    && authCode.includes('function registerHeaderSettingsAction')
    && authCode.includes('function createHeaderSettingsButton')
    && authCode.includes("button.id = 'headerSettingsBtn'")
    && authCode.includes("button.addEventListener('click', handleHeaderSettingsClick)")
    && authCode.includes('setTimeout(initSharedHeaderActions, 115);')
    && authCode.includes('setTimeout(initHeaderThemeToggle, 120);'));
check('Auth runtime-injects headerThemeToggle after currentUser or before logout', authCode.includes('function initHeaderThemeToggle()') && authCode.includes("btn.id = 'headerThemeToggle'") && authCode.includes("btn.className = 'header-theme-toggle'") && authCode.includes("currentUser.insertAdjacentElement('afterend', btn)") && authCode.includes('userPanel.insertBefore(btn, logoutBtn)') && pagesWithStaticHeaderThemeToggle.length === 0);
check('Header settings gear stays runtime-only and timeline adopts it without a duplicate',
    pagesWithStaticHeaderSettingsButton.length === 0
    && pagesWithStaticTimelineConstructor.length === 0
    && authCode.includes('window.HeaderSettingsActions')
    && authCode.includes("window.TimelineVisibility?.openSettingsCenter")
    && fs.readFileSync(path.join(ROOT, 'js', 'timeline-visibility.js'), 'utf8').includes("document.getElementById('headerSettingsBtn')")
    && fs.readFileSync(path.join(ROOT, 'js', 'timeline-visibility.js'), 'utf8').includes("sharedHeaderButton.id = 'timelineConstructorBtn'"));
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
check('All logout button pages load auth.js', pagesWithLogoutButton.every(page => scriptIndex(getHtmlScripts(page.html), 'js/auth.js') >= 0));
check('No page JS owns logoutBtn directly outside auth.js', nonAuthJsLogoutOwners.length === 0);
check('No inline logoutBtn click handlers remain', inlineLogoutOwners.length === 0);
check('No inline header settings handlers exist outside the shared runtime owner', inlineHeaderSettingsOwners.length === 0);
check('Legacy header logout outliers use shared logoutBtn binding', legacyHeaderLogoutOutliers.every(page => page.ok));

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
const sharedHeaderContractExceptions = new Set(['analytics.html', 'booking-summary.html', 'checkin.html', 'invite.html']);
const STANDARD_AUTH_SHELL_PAGES = [
    'accounting-deposits.html', 'afisha.html', 'art-director.html', 'center.html', 'certificates.html',
    'chat.html', 'chat-settings.html', 'content.html', 'copilot.html', 'customers.html',
    'dashboard.html', 'demo.html', 'designer.html', 'designs.html', 'finance.html',
    'game.html', 'graduation.html', 'guardian-ops.html', 'hermes-studio.html', 'hr.html',
    'index.html', 'leads.html', 'omni.html', 'profile.html', 'programs.html',
    'quiz.html', 'report-agent.html', 'reports.html', 'room.html', 'shop.html',
    'sound.html', 'staff.html', 'status.html', 'tasks.html', 'timeline-settings.html',
    'training.html', 'warehouse.html'
];
const headerShellPages = htmlFiles
    .map(file => {
        const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
        const dom = new JSDOM(html);
        return { file, dom, doc: dom.window.document };
    })
    .filter(page => page.doc.querySelector('.header .header-content'));
const headerShellPagesMissingUserPanel = headerShellPages.filter(page => (
    !sharedHeaderContractExceptions.has(page.file)
    && !page.doc.querySelector('.header .header-content > .user-panel')
));
const standardHeaderShellPages = STANDARD_AUTH_SHELL_PAGES.map(file => {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const dom = new JSDOM(html, { url: `http://localhost:3000/${file.replace('.html', '')}`, runScripts: 'outside-only' });
    return { file, dom, doc: dom.window.document, html };
});
const missingStandardHeaderShellContract = standardHeaderShellPages.filter(page => (
    !page.doc.querySelector('.header .header-content > .user-panel')
    || !page.doc.querySelector('.header .header-content > .user-panel #logoutBtn.btn-logout[type="button"]:not([onclick])')
    || scriptIndex(getHtmlScripts(page.html), 'js/auth.js') < 0
    || !page.html.includes('css/layout.css')
    || !page.html.includes('css/responsive.css')
    || !page.html.includes('css/dark-mode.css')
));
const standardHeaderShellActionDrift = standardHeaderShellPages.filter(page => {
    const panel = page.doc.querySelector('.header .header-content > .user-panel');
    return !panel
        || panel.querySelectorAll('#logoutBtn').length !== 1
        || page.doc.querySelectorAll('#logoutBtn').length !== 1
        || page.doc.querySelectorAll('#headerSettingsBtn').length !== 0
        || page.doc.querySelectorAll('#headerThemeToggle').length !== 0
        || [...panel.querySelectorAll('#logoutBtn')].some(btn => (
            btn.getAttribute('type') !== 'button'
            || btn.hasAttribute('onclick')
        ));
});
const sharedHeaderActionsInitCode = sourceBlock(authCode, 'const HEADER_SETTINGS_PLACEHOLDER_TEXT', 'function clearAuthStorage');
const runtimeHeaderActionsDom = new JSDOM('<header class="header"><div class="header-content"><div class="user-panel"><span id="currentUser"></span><button id="logoutBtn"></button></div></div></header>', { runScripts: 'outside-only' });
runtimeHeaderActionsDom.window.eval(`${sharedHeaderActionsInitCode}\ninitSharedHeaderActions();\ninitSharedHeaderActions();`);
const runtimeHeaderActions = runtimeHeaderActionsDom.window.document.querySelectorAll('.header .user-panel.header-actions');
const runtimeHeaderSettings = runtimeHeaderActionsDom.window.document.querySelectorAll('.header .user-panel.header-actions > #headerSettingsBtn');
const runtimeHeaderSettingsButton = runtimeHeaderSettings[0];
const runtimeHeaderSettingsOrderIds = runtimeHeaderActions[0]
    ? [...runtimeHeaderActions[0].children].map(node => node.id).filter(Boolean)
    : [];
const runtimeHeaderFallbackBeforeClick = runtimeHeaderActionsDom.window.document.getElementById('headerSettingsFallbackNotice');
runtimeHeaderSettings[0]?.click();
const runtimeHeaderFallbackAfterClick = runtimeHeaderActionsDom.window.document.getElementById('headerSettingsFallbackNotice');
const dashboardHeaderActionsDom = new JSDOM('<header class="header"><div class="header-content"><div class="user-panel"><span id="currentUser"></span><button id="logoutBtn"></button></div></div></header>', { url: 'http://localhost:3000/dashboard', runScripts: 'outside-only' });
dashboardHeaderActionsDom.window.eval(`${sharedHeaderActionsInitCode}\nwindow.__dashboardSettingsOpened = 0;\nwindow.DashboardPage = { openSettings: function(){ window.__dashboardSettingsOpened += 1; } };\ninitSharedHeaderActions();\ndocument.getElementById('headerSettingsBtn').click();`);
const chatHeaderActionsDom = new JSDOM('<header class="header"><div class="header-content"><div class="user-panel"><span id="currentUser"></span><button id="logoutBtn"></button></div></div></header>', { url: 'http://localhost:3000/chat', runScripts: 'outside-only' });
chatHeaderActionsDom.window.eval(`${sharedHeaderActionsInitCode}\nwindow.__chatSettingsAllowed = false;\nwindow.canAccessPage = function(page){ window.__chatSettingsAllowed = page === '/chat-settings'; return false; };\ninitSharedHeaderActions();\ndocument.getElementById('headerSettingsBtn').click();`);
const omniHeaderActionsDom = new JSDOM('<header class="header"><div class="header-content"><div class="user-panel"><span id="currentUser"></span><button id="logoutBtn"></button></div></div></header>', { url: 'http://localhost:3000/omni', runScripts: 'outside-only' });
omniHeaderActionsDom.window.eval(`${sharedHeaderActionsInitCode}\nwindow.__omniSettingsAllowed = false;\nwindow.canAccessPage = function(page){ window.__omniSettingsAllowed = page === '/chat-settings'; return page === '/chat-settings'; };\ninitSharedHeaderActions();\nwindow.__omniSettingsActionSource = String(resolveHeaderSettingsAction());`);
const embedHeaderActionsDom = new JSDOM('<header class="header"><div class="header-content"><div class="user-panel"><span id="currentUser"></span><button id="logoutBtn"></button></div></div></header>', { url: 'http://localhost:3000/programs?embed=1', runScripts: 'outside-only' });
embedHeaderActionsDom.window.eval(`${sharedHeaderActionsInitCode}\nwindow.__embedInitResult = initSharedHeaderActions();\ninitSharedHeaderActions();`);
const runtimeHeaderReorderDom = new JSDOM('<header class="header"><div class="header-content"><div class="user-panel"><span id="currentUser"></span><button id="headerThemeToggle"></button><button id="headerSettingsBtn"></button><button id="logoutBtn"></button></div></div></header>', { runScripts: 'outside-only' });
runtimeHeaderReorderDom.window.eval(`${sharedHeaderActionsInitCode}\ninitSharedHeaderActions();`);
const runtimeHeaderReorderIds = [...runtimeHeaderReorderDom.window.document.querySelector('.header .user-panel').children].map(node => node.id).filter(Boolean);
const runtimeTimelineHeaderReorderDom = new JSDOM('<header class="header"><div class="header-content"><div class="user-panel"><span id="currentUser"></span><button id="headerThemeToggle"></button><button id="timelineConstructorBtn"></button><button id="logoutBtn"></button></div></div></header>', { runScripts: 'outside-only' });
runtimeTimelineHeaderReorderDom.window.eval(`${sharedHeaderActionsInitCode}\ninitSharedHeaderActions();`);
const runtimeTimelineHeaderReorderIds = [...runtimeTimelineHeaderReorderDom.window.document.querySelector('.header .user-panel').children].map(node => node.id).filter(Boolean);
const runtimeStandardHeaderSettingsPages = standardHeaderShellPages.filter(page => {
    page.dom.window.eval(`${sharedHeaderActionsInitCode}\ninitSharedHeaderActions();\ninitSharedHeaderActions();`);
    return page.doc.querySelectorAll('.header .user-panel.header-actions > #headerSettingsBtn, .header .user-panel.header-actions > #timelineConstructorBtn').length !== 1;
});
const programsEmbedHtml = fs.readFileSync(path.join(ROOT, 'programs.html'), 'utf8');
const graduationEmbedHtml = fs.readFileSync(path.join(ROOT, 'graduation.html'), 'utf8');
const chatHeaderLocalSettingsHtml = fs.readFileSync(path.join(ROOT, 'chat.html'), 'utf8');
const omniHeaderLocalSettingsHtml = fs.readFileSync(path.join(ROOT, 'omni.html'), 'utf8');
const profileHeaderHtml = fs.readFileSync(path.join(ROOT, 'profile.html'), 'utf8');
const backendAuthCodeForHeaderActions = fs.readFileSync(path.join(ROOT, 'middleware', 'auth.js'), 'utf8');
const permissionRegistryCode = fs.readFileSync(path.join(ROOT, 'config', 'permissionRegistry.js'), 'utf8');
const accountAccessPolicyCode = fs.readFileSync(path.join(ROOT, 'services', 'accountAccessPolicy.js'), 'utf8');

check('No standard page nests main-content inside page-container', nestedShellPages.length === 0);
check('No shell containers use inline left offsets', inlineOffsetPages.length === 0);
check('Only documented full-app pages use main-content shell', unexpectedMainShellPages.length === 0);
check('All mainApp shells start from hidden main-app baseline', missingHiddenMainAppPages.length === 0);
check('Every page that loads shared sidebar assets has sidebarNav/sidebarLinks shell', sidebarLinkedPagesWithoutShell.length === 0);
check('Shared header shell pages keep direct user-panel contract with explicit exceptions',
    ['analytics.html', 'booking-summary.html', 'checkin.html', 'invite.html'].every(file => sharedHeaderContractExceptions.has(file))
    && headerShellPagesMissingUserPanel.length === 0);
check('All 37 standard CRM shell pages keep shared header action prerequisites',
    STANDARD_AUTH_SHELL_PAGES.length === 37
    && missingStandardHeaderShellContract.length === 0
    && STANDARD_AUTH_SHELL_PAGES.every(file => !sharedHeaderContractExceptions.has(file)));
check('All 37 standard CRM shell pages keep one static logout and runtime-owned settings/theme',
    standardHeaderShellActionDrift.length === 0
    && pagesWithStaticHeaderThemeToggle.length === 0
    && pagesWithStaticHeaderSettingsButton.length === 0
    && pagesWithStaticTimelineConstructor.length === 0);
check('Shared header actions runtime init is idempotent',
    runtimeHeaderActions.length === 1
    && runtimeHeaderActions[0].className.split(/\s+/).filter(item => item === 'header-actions').length === 1
    && runtimeHeaderSettings.length === 1
    && runtimeHeaderSettingsButton?.getAttribute('type') === 'button'
    && runtimeHeaderSettingsButton?.getAttribute('aria-label') === 'Налаштування'
    && runtimeHeaderSettingsButton?.getAttribute('title') === 'Налаштування'
    && runtimeHeaderSettingsButton?.dataset.headerSettingsBound === '1'
    && runtimeHeaderSettingsOrderIds.indexOf('headerSettingsBtn') >= 0
    && runtimeHeaderSettingsOrderIds.indexOf('logoutBtn') >= 0
    && runtimeHeaderSettingsOrderIds.indexOf('headerSettingsBtn') < runtimeHeaderSettingsOrderIds.indexOf('logoutBtn')
    && !runtimeHeaderFallbackBeforeClick
    && runtimeHeaderFallbackAfterClick?.textContent === 'Налаштування цього розділу ще не доступні');
check('Shared header actions normalize settings/theme/logout order',
    runtimeHeaderReorderIds.join('>') === 'currentUser>headerSettingsBtn>headerThemeToggle>logoutBtn'
    && runtimeTimelineHeaderReorderIds.join('>') === 'currentUser>timelineConstructorBtn>headerThemeToggle>logoutBtn');
check('Shared header settings adapters keep real actions scoped',
    dashboardHeaderActionsDom.window.__dashboardSettingsOpened === 1
    && chatHeaderActionsDom.window.__chatSettingsAllowed === true
    && omniHeaderActionsDom.window.__omniSettingsAllowed === true
    && omniHeaderActionsDom.window.__omniSettingsActionSource.includes('/chat-settings')
    && chatHeaderActionsDom.window.document.getElementById('headerSettingsFallbackNotice')?.textContent === 'Налаштування цього розділу ще не доступні');
check('All standard CRM shell pages get exactly one runtime settings gear',
    runtimeStandardHeaderSettingsPages.length === 0);
check('Shared header controls skip embedded CRM shells and documented public surfaces',
    embedHeaderActionsDom.window.__embedInitResult === 0
    && embedHeaderActionsDom.window.document.querySelectorAll('.header-actions, #headerSettingsBtn').length === 0
    && authCode.includes('if (isEmbeddedShellMode()) return 0;')
    && authCode.includes('if (isEmbeddedShellMode()) return;')
    && authCode.includes('if (isEmbeddedShellMode()) return false;')
    && programsEmbedHtml.includes("document.documentElement.classList.add('embed-mode')")
    && programsEmbedHtml.includes("!document.documentElement.classList.contains('embed-mode')")
    && graduationEmbedHtml.includes("document.documentElement.classList.add('embed-mode')")
    && ['analytics.html', 'booking-summary.html', 'checkin.html', 'invite.html'].every(file => sharedHeaderContractExceptions.has(file))
    && ['checkin.html', 'invite.html'].every(file => {
        const dom = new JSDOM(fs.readFileSync(path.join(ROOT, file), 'utf8'));
        const ok = !dom.window.document.querySelector('.header .user-panel')
            && !dom.window.document.getElementById('logoutBtn')
            && !dom.window.document.getElementById('headerSettingsBtn');
        dom.window.close();
        return ok;
    }));
check('Special CRM shells keep local settings separate from the shared header gear',
    chatHeaderLocalSettingsHtml.includes('id="omniOpenSettingsBtn"')
    && chatHeaderLocalSettingsHtml.includes('id="chatSettingsBtn"')
    && omniHeaderLocalSettingsHtml.includes('class="omni-settings-link"')
    && !chatHeaderLocalSettingsHtml.includes('id="headerSettingsBtn"')
    && !omniHeaderLocalSettingsHtml.includes('id="headerSettingsBtn"')
    && authCode.includes("currentPath === '/chat' || currentPath === '/omni'")
    && omniHeaderActionsDom.window.document.querySelectorAll('.header .user-panel.header-actions > #headerSettingsBtn').length === 1);
check('Shared header settings fallback does not mutate capability policy or bypass privileged routes',
    sharedHeaderActionsInitCode.includes('return () => showHeaderSettingsFeedback();')
    && !sharedHeaderActionsInitCode.includes('PAGE_ACCESS')
    && !/PAGE_ACCESS\s*\[[^\]]+\]\s*=/.test(authCode)
    && permissionRegistryCode.includes("key: '/timeline-settings'")
    && permissionRegistryCode.includes("defaultRoles: ['creator', 'director']")
    && permissionRegistryCode.includes("key: '/chat-settings'")
    && /key: '\/chat-settings'[\s\S]{0,240}defaultRoles: \['creator', 'director'\]/.test(permissionRegistryCode)
    && permissionRegistryCode.includes("key: '/checkin'")
    && accountAccessPolicyCode.includes('const PAGE_ACCESS = Object.freeze')
    && !permissionRegistryCode.includes('headerSettings'));
check('Training and profile recover shared header controls without breaking profile navigation',
    fs.readFileSync(path.join(ROOT, 'js', 'training-page.js'), 'utf8').includes('window.HeaderSettingsActions?.refresh?.()')
    && fs.readFileSync(path.join(ROOT, 'js', 'training-page.js'), 'utf8').includes("window.addEventListener('pageshow', restoreTrainingShellVisibility)")
    && /bindLogoutButton\(\);\r?\n    initSharedHeaderActions\(\);\r?\n    initHeaderThemeToggle\(\);/.test(authCode)
    && authCode.includes("el.classList.add('user-name-clickable')")
    && authCode.includes("el.setAttribute('role', 'link')")
    && authCode.includes("el.addEventListener('click', openProfilePage)")
    && authCode.includes("if (e.key === 'Enter' || e.key === ' ')")
    && profileHeaderHtml.includes('id="currentUser" class="user-name"'));
check('Graduation/catalog print modes keep CRM chrome out of printable catalog surfaces',
    graduationEmbedHtml.includes('@media print') || fs.readFileSync(path.join(ROOT, 'css', 'graduation.css'), 'utf8').includes('@media print')
    && fs.readFileSync(path.join(ROOT, 'css', 'graduation.css'), 'utf8').includes('.header,')
    && fs.readFileSync(path.join(ROOT, 'css', 'catalog.css'), 'utf8').includes('body.printing-catalog')
    && fs.readFileSync(path.join(ROOT, 'css', 'catalog.css'), 'utf8').includes('.header, .sidebar-nav')
    && fs.readFileSync(path.join(ROOT, 'css', 'assistant-rail-presence.css'), 'utf8').includes('body.printing-catalog .crm-assistant-rail-host'));
shellPages.forEach(page => page.dom.window.close());
sidebarLinkedPages.forEach(page => page.dom.window.close());
headerShellPages.forEach(page => page.dom.window.close());
standardHeaderShellPages.forEach(page => page.dom.window.close());
runtimeHeaderActionsDom.window.close();
dashboardHeaderActionsDom.window.close();
chatHeaderActionsDom.window.close();
omniHeaderActionsDom.window.close();
embedHeaderActionsDom.window.close();

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
const bookingMutationCode = fs.readFileSync(path.join(ROOT, 'js/booking.js'), 'utf8');
const appCode = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
const timelineCode = fs.readFileSync(path.join(ROOT, 'js/timeline.js'), 'utf8');
const timelineContextCode = fs.readFileSync(path.join(ROOT, 'js/timeline-context.js'), 'utf8');
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
const timelineInlineViewPanelRuleGlobal = cssRuleText(responsiveCss, 'body.timeline-dashboard-page .schedule-command-center.toolbarContainer > .timeline-view-panel');
const timelineBaseCellWidthBlock = sourceBlock(uiCode, 'function _timelineBaseCellWidth', 'function _timelineViewportWidth');
const timelineBaseCellWidthRows = [...timelineBaseCellWidthBlock.matchAll(/return\s+level\s*===\s*15\s*\?\s*(\d+)\s*:\s*level\s*===\s*30\s*\?\s*(\d+)\s*:\s*(\d+);/g)]
    .map(match => match.slice(1).map(Number));
const timelineCompactBaseWidths = timelineBaseCellWidthRows[0] || [];
const timelineRegularBaseWidths = timelineBaseCellWidthRows[1] || [];
const timelineResponsiveCellWidthBlock = sourceBlock(uiCode, 'function _timelineResponsiveCellWidth', 'function _timelineResponsiveHeaderWidth');
const timelineReadableMinimums = (timelineResponsiveCellWidthBlock.match(/const readableMinimum\s*=\s*level\s*===\s*15\s*\?\s*(\d+)\s*:\s*level\s*===\s*30\s*\?\s*(\d+)\s*:\s*(\d+);/) || [])
    .slice(1)
    .map(Number);
const timelineApplyResponsiveDensityBlock = sourceBlock(uiCode, 'function applyTimelineResponsiveDensity', 'function syncTimelineViewHeight');
const timelineCompactLineHeights = (timelineApplyResponsiveDensityBlock.match(/const nextLineHeight\s*=\s*compact\s*\?\s*\(level\s*===\s*15\s*\?\s*(\d+)\s*:\s*level\s*===\s*30\s*\?\s*(\d+)\s*:\s*(\d+)\)/) || [])
    .slice(1)
    .map(Number);
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
check('Timeline button defaults to Park while MD context stays creator-only', sidebarCode.includes("label: 'Таймлайн'") && sidebarCode.includes("href: '/maysternya-doli'") && sidebarCode.includes("item.href === '/' && current === 'maysternya_doli'") && sidebarCode.includes("item.href === '/maysternya-doli' && current !== 'maysternya_doli'") && sidebarCode.includes('return creatorSurface') && sidebarCode.includes('Array.isArray(user?.extraRoles)') && sidebarCode.includes('Array.isArray(user?.extra_roles)') && sidebarCode.includes('MAYSTERNYA_SIDEBAR_HREFS') && sidebarCode.includes("'/sales-funnel'") && sidebarCode.includes("'/customers'") && sidebarCode.includes("'/omni#accounts'") && sidebarCode.includes("label: 'Підключення чатів'") && htmlContains('js/api.js', "paths: ['/', '/maysternya-doli']") && htmlContains('js/api.js', "return '/maysternya-doli'") && featureRegistryCode.includes("title: 'Таймлайн'") && featureRegistryCode.includes("title: 'Таймлайн МД'") && searchCode.includes("label: 'Таймлайн'") && htmlContains('js/timeline-context.js', "switchLabel: 'Таймлайн ПАРК'") && htmlContains('js/timeline-context.js', "brandName: 'Майстерня долі'") && htmlContains('js/timeline-context.js', 'showAfisha: false') && htmlContains('js/timeline-context.js', "settings: ['creator']") && htmlContains('services/timelineContext.js', "PRIVATE_TIMELINE_CONTEXTS") && authCode.includes("const ROLE_QUICK_ACCESS_BASE = ['/', '/staff', '/chat', '/certificates']") && permissionRegistryCode.includes("explicitAllow: false, risk: 'critical', status: PAGE_STATUS.SPECIAL_CONTEXT") && htmlContains('js/timeline.js', 'function timelineShouldRenderAfisha') && htmlContains('js/timeline.js', 'showAfisha ? apiGetAfishaByDate') && htmlContains('js/timeline.js', 'const allAfisha = showAfisha ? (afishaEvents || []) : []') && htmlContains('js/timeline.js', 'function normalizeTimelineLinesForContext') && htmlContains('routes/lines.js', "name: 'Олександр'"));
check('Sidebar Sales group starts with Timeline shortcut', /key:\s*'sales'[\s\S]*?\{\s*href:\s*'\/',\s*icon:\s*'[^']+',\s*label:\s*'Таймлайн',\s*access:\s*'timeline',\s*group:\s*'sales'\s*\}[\s\S]*?\{\s*href:\s*'\/customers'/.test(sidebarCode));
check('Global search preserves active business context for CRM results and keeps product direct links route-safe', searchCode.includes('CrmBusinessContext.apiUrl') && searchRoutes.includes('requireBusinessContext') && searchRoutes.includes('COALESCE(c.business_context') && !searchRoutes.includes('/programs?highlight=') && searchRoutes.includes("'/maysternya-doli'") && searchRoutes.includes('businessContext') && searchCode.includes("href: '/programs#kitchen-menu'"));
check('Sidebar business context shell owns Products, Leads, and Customers scoping', htmlContains('js/api.js', 'CRM_BUSINESS_SCOPED_PAGES') && htmlContains('js/api.js', "products: { id: 'products'") && htmlContains('js/api.js', "leads: { id: 'leads'") && htmlContains('js/api.js', "customers: { id: 'customers'") && htmlContains('js/api.js', 'CRM_BUSINESS_SWITCH_ROLES') && htmlContains('js/api.js', 'function getCrmBusinessState') && htmlContains('js/components/sidebar.js', 'sidebarBusinessContextHost') && htmlContains('js/components/sidebar.js', 'api.switchTo(event.target.value') && htmlContains('js/auth.js', 'CrmBusinessContext?.renderShell') && !htmlContains('programs.html', 'productsBusinessSelect') && !htmlContains('customers.html', 'customerBusinessContext') && !htmlContains('leads.html', 'leadBusinessContext') && !htmlContains('js/api.js', 'id="globalBusinessContextSelect"'));
check('Timeline business context navigation preserves lead booking conversion URL handoff', htmlContains('js/api.js', 'function crmBusinessHasLeadBookingHandoff') && htmlContains('js/api.js', "params.get('convert') === 'booking'") && htmlContains('js/api.js', "params.get('open') === 'booking'") && htmlContains('js/api.js', "params.has('bookingMode')") && htmlContains('js/api.js', "params.has('eventDate')") && htmlContains('js/api.js', 'crmBusinessHasLeadBookingHandoff(current)') && htmlContains('js/api.js', 'target.pathname === current.pathname'));
check('Sidebar business switcher has one canonical hydrated state and guarded transition UX', htmlContains('js/api.js', 'function resolveCrmBusinessContextState') && htmlContains('js/api.js', 'storageBusinessId') && htmlContains('js/api.js', 'crmBusinessContextHydrated') && htmlContains('js/api.js', 'clearCrmBusinessContextStorage') && sidebarCode.includes('businessSwitching') && sidebarCode.includes('data-sidebar-business-switcher="true"') && sidebarCode.includes('aria-busy') && sidebarCode.includes('showNotification') && sidebarCode.includes('crmBusinessContextHydrated') && sidebarAuroraCss.includes('.sidebar-business-select:focus-visible') && sidebarAuroraCss.includes('.sidebar-business-context[data-switching="true"]') && sidebarAuroraCss.includes('.sidebar-nav.collapsed .sidebar-business-select'));
const legacySidebarHotLeadPath = ['/api/leads', 'hot'].join('/');
const legacySidebarNewLeadPath = ['/api/leads', 'new-count'].join('/');
check('Sidebar live counters use canonical business-scoped endpoint', sidebarCode.includes("'/api/business/live-counters'") && sidebarCode.includes('function _fetchBusinessLiveCounters') && sidebarCode.includes('function _businessLiveCounterBucket') && sidebarCode.includes('function _businessScopeCounterLabel') && sidebarCode.includes("_setBadge('leads_new'") && sidebarCode.includes('focusChipFunnel') && sidebarCode.includes('crmBusinessContextChanged') && sidebarCode.includes('crmBusinessContextHydrated') && sidebarCode.includes('_refreshSidebarOperationalWidgets();') && !sidebarCode.includes(legacySidebarHotLeadPath) && !sidebarCode.includes(legacySidebarNewLeadPath));
check('Sidebar business switcher uses clean display labels without half-word wrapping', sidebarCode.includes('function _sidebarBusinessDisplayLabel') && sidebarCode.includes('const firstWord = _firstSidebarBusinessWord(fullLabel)') && sidebarCode.includes('data-full-label') && sidebarCode.includes('data-display-label') && sidebarCode.includes('Поточний бізнес CRM: ${businessFullLabelFor(currentContext)}') && sidebarAuroraCss.includes('.sidebar-business-select option') && sidebarAuroraCss.includes('white-space: nowrap') && sidebarAuroraCss.includes('line-height: 1'));
check('Sidebar business switcher exposes safe multi/all overview modes behind a gear panel', htmlContains('js/api.js', 'function resolveCrmBusinessScopeState') && htmlContains('js/api.js', 'allowsAggregate: crmBusinessPageAllowsAggregate') && htmlContains('js/api.js', 'hasPageBinding: crmBusinessPageHasBinding') && htmlContains('js/api.js', "const CRM_BUSINESS_AGGREGATE_PAGE_IDS = new Set(['dashboard', 'products', 'leads', 'customers', 'reports'])") && sidebarCode.includes('data-sidebar-business-settings-toggle') && sidebarCode.includes('sidebarBusinessSettingsPanel') && sidebarCode.includes('businessSettingsOpen') && sidebarCode.includes('aria-hidden="${settingsOpen ?') && sidebarCode.includes("' inert'") && sidebarCode.includes('data-sidebar-business-scope="true"') && sidebarCode.includes("['single', 'multi', 'all']") && sidebarCode.includes('data-business-scope-mode="${mode}"') && sidebarCode.includes('sidebar-business-readonly-note') && sidebarCode.includes('sidebar-business-multi-option') && sidebarCode.includes('sidebar-business-unavailable') && sidebarCode.includes('api.switchScope(nextScope') && sidebarAuroraCss.includes('.sidebar-business-settings-btn') && sidebarAuroraCss.includes('.sidebar-business-settings-panel') && sidebarAuroraCss.includes('.sidebar-business-scope-btn') && sidebarAuroraCss.includes('.sidebar-business-multi-option') && sidebarAuroraCss.includes('.sidebar-nav.collapsed .sidebar-business-settings-panel') && !htmlContains('js/api.js', 'id="globalBusinessContextSelect"'));
check('Aggregate business scope has explicit read-only UX guards on scoped CRM modules', htmlContains('js/api.js', 'function guardCrmBusinessWrite') && htmlContains('js/api.js', 'guardWrite: guardCrmBusinessWrite') && htmlContains('js/customers-page.js', 'function guardCustomerWrite') && htmlContains('js/customers-page.js', 'customerBusinessReadOnlyNotice') && htmlContains('js/leads-page.js', 'function guardLeadWrite') && htmlContains('js/leads-page.js', 'leadBusinessReadOnlyNotice') && htmlContains('js/programs-page.js', 'function guardProductWrite') && htmlContains('js/programs-page.js', 'productBusinessReadOnlyNotice') && reportsPageCode.includes('function guardReportsWrite') && reportsPageCode.includes('reportsBusinessReadOnlyNotice') && layoutCss.includes('.crm-business-readonly-banner'));
check('Timeline has sidebar-owned business switch and visual element visibility constructor', htmlContains('index.html', 'js/timeline-visibility.js') && timelineVisibilityCode.includes('TIMELINE_VISIBILITY_ELEMENTS') && !timelineVisibilityCode.includes('timelineBusinessSelect') && timelineVisibilityCode.includes('removeBusinessSwitcher') && timelineVisibilityCode.includes('timelineConstructorBtn') && timelineVisibilityCode.includes('bindConstructorButton') && timelineVisibilityCode.includes("canUseAction('settings'") && timelineVisibilityCode.includes("const STORAGE_NAME = 'timeline_element_visibility'") && timelineVisibilityCode.includes('localStorage.getItem(storageKey())') && timelineVisibilityCode.includes("/settings/timeline-visibility") && timelineVisibilityCode.includes('timelineScale') && timelineVisibilityCode.includes('bookingClose') && timelineVisibilityCode.includes('timeline-hidden-by-config') && timelineConstructorCss.includes('.timeline-permission-hidden') && htmlContains('js/timeline-context.js', 'defaultHiddenElements') && authCode.includes('TimelineVisibility.refreshAccess') && fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8').includes("app:user-changed") && timelineConstructorCss.includes('.timeline-constructor-panel') && timelineConstructorCss.includes('.timeline-constructor-btn') && timelineConstructorCss.includes('.timeline-visibility-chip'));
check('Timeline visibility server settings wait for an authenticated AppState user',
    timelineVisibilityCode.includes('function hasAuthenticatedTimelineUser()')
    && timelineVisibilityCode.includes('if (!hasAuthenticatedTimelineUser()) return null;')
    && timelineVisibilityCode.includes('if (!authenticated) {')
    && timelineVisibilityCode.includes('if (!hasAuthenticatedTimelineUser()) return;')
    && !/applyVisibility\(\);\s*loadServerSettings\(\)\.then[\s\S]*?refreshAccess\(\);/.test(timelineVisibilityCode));
check('Timeline visual settings center exposes v2 block metadata and visual variables', timelineVisibilityCode.includes('currentTimelineId') && timelineVisibilityCode.includes('timelineId') && timelineVisibilityCode.includes('data-timeline-block-id') && timelineVisibilityCode.includes('description') && timelineVisibilityCode.includes('howToUse') && timelineVisibilityCode.includes('impact') && timelineVisibilityCode.includes('customLabel') && timelineVisibilityCode.includes('adminNote') && timelineVisibilityCode.includes('timeline-visual-settings-grid') && timelineVisibilityCode.includes('timelineConstructorVisualEditor') && timelineVisibilityCode.includes('timelineConstructorDetails') && timelineConstructorCss.includes('.timeline-visual-settings-grid') && timelineConstructorCss.includes('.timeline-constructor-selected') && timelineConstructorCss.includes('.timeline-block-density-compact') && timelineConstructorCss.includes('.timeline-block-emphasis-accent:not(.timeline-permission-hidden)'));
check('Timeline visual settings hardening exposes save status, reset confirmation, and admin-only label guidance', timelineVisibilityCode.includes('timelineConstructorSaveStatus') && timelineVisibilityCode.includes('setSaveStatus') && timelineVisibilityCode.includes('confirmResetSettings') && timelineVisibilityCode.includes('confirmModal') && timelineVisibilityCode.includes('Бойовий текст кнопок не перейменовується') && timelineVisibilityCode.includes('Видима тільки в налаштуваннях') && timelineConstructorCss.includes('.timeline-constructor-save-status[data-status="dirty"]') && timelineConstructorCss.includes('.timeline-constructor-save-status[data-status="error"]') && timelineConstructorCss.includes('.timeline-visual-field small') && timelineConstructorCss.includes('#timelineScroll.timeline-block-density-compact') && timelineConstructorCss.includes('#bookingPanel.timeline-block-density-comfortable'));
check('Timeline visual settings drawer is docked and avoids covering the whole workspace', timelineConstructorCss.includes('top: 92px') && timelineConstructorCss.includes('width: min(780px') && timelineConstructorCss.includes('calc(100vw - var(--eg-claude-sidebar-w, 224px) - 34px)') && timelineConstructorCss.includes('body.timeline-constructor-active::after') && timelineConstructorCss.includes('pointer-events: none') && timelineConstructorCss.includes('grid-template-columns: minmax(250px, 0.86fr) minmax(310px, 1.14fr)') && timelineConstructorCss.includes('.timeline-visual-blocks-zone') && timelineConstructorCss.includes('grid-row: 1 / span 2') && timelineConstructorCss.includes('.timeline-constructor-panel-body') && timelineConstructorCss.includes('overflow: auto'));
check('Timeline settings center has standalone route, access, sidebar entry, and shell styles',
    htmlContains('server.js', "app.get('/timeline-settings'")
    && permissionRegistryCode.includes("key: '/timeline-settings'")
    && permissionRegistryCode.includes("defaultRoles: ['creator', 'director'], risk: 'critical', sidebarLinks: ['/timeline-settings']")
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
check('Timeline display modes are real presentation settings', htmlContains('index.html', 'settingsTimelineDisplayMode') && htmlContains('index.html', 'settingsTimelineKitchenMode') && htmlContains('index.html', 'settingsTimelineRoomFirstEnabled') && htmlContains('index.html', 'settingsTimelineDefaultView') && htmlContains('js/timeline-context.js', 'const DISPLAY_MODES = {') && htmlContains('js/timeline-context.js', "education: {") && htmlContains('js/timeline-context.js', "parkKitchenEnabled") && htmlContains('js/timeline-context.js', "defaultTimelineView") && htmlContains('js/timeline-context.js', 'defaultTimelineViewForContext') && settingsCode.includes('/settings/timeline-display') && settingsCode.includes('roomTimelineEnabled') && settingsCode.includes('defaultTimelineView') && settingsCode.includes('defaultTimelineViewForControlSettings') && !settingsCode.includes("|| 'rooms'") && appCode.includes('saveTimelineDisplaySettingsFromSettings') && appCode.includes('settingsTimelineDefaultView') && timelineConfigCode.includes('TIMELINE_DISPLAY_MODE') && timelineConfigCode.includes('EDUCATION_TIMELINE_PROGRAMS') && timelineCode.includes("presentation?.mode === 'education'") && timelineCode.includes('resourceType: \'cabinet\'') && htmlContains('css/panel.css', 'body.timeline-mode-park.timeline-park-without-kitchen #banquetFields'));
check('Timeline overrun warning has legend and priority danger styling',
    timelineContextCode.includes('TIMELINE_OVERRUN_LEGEND_HTML')
    && timelineContextCode.includes('legend-item--time-overrun')
    && timelineContextCode.includes('dot overrun')
    && timelineConstructorCss.includes('.legend-item:has(.dot.overrun)')
    && timelineConstructorCss.includes('.dot.overrun { background: linear-gradient(135deg, #DC2626 0%, #7F1D1D 100%); }')
    && timelineConstructorCss.includes('.booking-block.booking-block--time-overrun')
    && timelineConstructorCss.includes('background: linear-gradient(135deg, #DC2626 0%, #7F1D1D 100%) !important')
    && darkModeCss.includes('body.dark-mode .legend-item:has(.dot.overrun)')
    && darkModeCss.includes('.timeline-dashboard-page .legend-item:has(.dot.overrun)')
    && darkModeCss.includes('.timeline-dashboard-page .dot.overrun'));
check('Deprecated room load visual settings are removed', !timelineVisibilityCode.includes('roomLoadPanel') && !timelineVisibilityCode.includes('roomLoadBtn') && !timelineSettingsPageCode.includes('roomLoadPanel') && !timelineSettingsPageCode.includes('roomLoadBtn') && !timelineVisibilityServiceCode.includes("visualBlock('roomLoad") && !timelineVisibilityServiceCode.includes("visualBlock('roomLoadPanel") && !featuresCss.includes('room-load-anchor') && !featuresCss.includes('room-load-close-label'));
const timelineBanquetRoomCardBlock = timelineCode.slice(
    timelineCode.indexOf('function timelineBanquetRoomCardSignals'),
    timelineCode.indexOf('function clearTimelineBanquetRoomPreviews')
);
const timelineBanquetInspectorBlock = timelineCode.slice(
    timelineCode.indexOf('function showTimelineBanquetInspector'),
    timelineCode.indexOf('function timelineBanquetRoomKey')
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
const timelineRenderFetchIndex = timelineCode.indexOf('getLinesForDate(selectedDate, { requestToken: renderRequestToken })', timelineRenderStartIndex);
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
    && timelineBanquetInspectorHelpersCode.includes('function timelineBanquetSnapshotArrival')
    && timelineBanquetInspectorHelpersCode.includes('function timelineBanquetArrivalMarker')
    && timelineBanquetInspectorHelpersCode.includes('const arrival = timelineBanquetSnapshotArrival(snapshot)')
    && timelineBanquetInspectorHelpersCode.includes('arrival?.time || fallbackTime')
    && timelineBanquetInspectorHelpersCode.includes('groupId: groupId || null')
    && timelineBanquetInspectorHelpersCode.includes('updatedAt: updatedAt || null')
    && timelineBanquetInspectorHelpersCode.includes("type: 'guest_arrival'")
    && timelineCode.includes('function timelineCanEditBanquet(summary = {})')
    && timelineCode.includes("canAccess('edit_booking')")
    && timelineCode.includes("params.set('editArrival', '1')")
    && timelineBanquetInspectorBlock.includes('const editBookingButton = timelineCanEditBanquet(summary)')
    && timelineBanquetInspectorBlock.includes('data-banquet-inspector-edit>Редагувати</button>')
    && !timelineBanquetInspectorBlock.includes('data-banquet-inspector-edit-arrival')
    && !timelineBanquetInspectorBlock.includes('timelineBanquetSummaryHref(summary, { editArrival: true })')
    && timelineBanquetInspectorBlock.includes('const bookingId = summary.carrierBooking?.id || summary.primaryBooking?.id;')
    && timelineBanquetInspectorBlock.includes("source: 'timeline_banquet_inspector'")
    && timelineBanquetInspectorBlock.includes('preferBanquetEditor: true')
    && timelineBookingCode.includes('async function editBooking(bookingId, options = {})')
    && timelineBookingCode.includes('function shouldRouteBookingEditToAnimatorView')
    && timelineBookingCode.includes('if (shouldRouteBookingEditToAnimatorView(anchorBooking, options, banquetEditContext))')
    && timelineCode.includes('markerEl.dataset.banquetGroupId = canonicalGroupId')
    && timelineCode.includes("if (type === 'guest_arrival') markerEl.draggable = false")
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
    && timelineConstructorCss.includes('.timeline-banquet-room-card-signal--guest-arrival')
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
    && timelineConstructorCss.includes('.timeline-room-service-marker--guest-arrival')
    && timelineConstructorCss.includes('min-width: 168px')
    && timelineConstructorCss.includes('height: 54px')
    && timelineConstructorCss.includes('font-size: 11px')
    && timelineConstructorCss.includes('padding: 8px 11px 9px')
    && timelineConstructorCss.includes('.timeline-room-service-marker--room-setup')
    && timelineCode.includes('function timelineRoomServiceMarkerDisplay')
    && timelineCode.includes('function timelineRoomServiceMarkerLane')
    && timelineCode.includes('function timelineBanquetRoomOperationalMarkers')
    && timelineRoomServiceMarkerBlock.includes('timelineBanquetRoomOperationalMarkers(summary)')
    && timelineRoomServiceMarkerBlock.includes('showTimelineBanquetInspector(event, summary, markerEl)')
    && !timelineRoomServiceMarkerBlock.includes('openBookingPanel')
    && !timelineRoomServiceMarkerBlock.includes('showBookingDetails')
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
    && timelineResourcesTestCode.includes('room timeline renders canonical banquet arrival as a room-grid operational marker')
    && timelineResourcesTestCode.includes("'.timeline-room-service-marker--guest-arrival'")
    && timelineResourcesTestCode.includes("ctx.__timelineViewState.room = false")
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
    && timelineCode.includes('showTimelineBanquetInspector(event, block._timelineBanquetSummary || null, block, {')
    && timelineCode.includes('function timelineBanquetBlockCanOpenInspector')
    && timelineCode.includes('if (!timelineBanquetBlockCanOpenInspector(block)) return false;')
    && timelineCode.includes("event.target?.closest?.('[data-banquet-room-card]')")
    && timelineCode.includes("event.key === 'Escape'")
    && !/addEventListener\('mouseenter'[^\n]+showTimelineBanquetInspector/.test(timelineCode)
    && !/addEventListener\('mouseenter'[^\n]+showTimelineBanquetPopover/.test(timelineCode));
check('Room timeline banquet activity blocks open booking modal instead of compact inspector',
    timelineCode.includes("TIMELINE_BANQUET_BOOKING_MODAL_BLOCK_ROLES = new Set(['activity', 'service', 'manual'])")
    && /function timelineBanquetBlockCanOpenInspector[\s\S]*TIMELINE_BANQUET_BOOKING_MODAL_BLOCK_ROLES\.has\(role\)\) return false/.test(timelineCode)
    && /function showTimelineBanquetPreviewFromBlock[\s\S]*if \(!timelineBanquetBlockCanOpenInspector\(block\)\) return false;[\s\S]*showTimelineBanquetInspector\(event, block\._timelineBanquetSummary \|\| null, block, \{/.test(timelineCode)
    && /if \(showTimelineBanquetPreviewFromBlock\(e, block\)\) return;\s*void openTimelineBookingDetailsFromBlock\(renderBooking\)/.test(timelineCode)
    && timelineCode.includes('const targetId = ownId || linkedId')
    && timelineCode.includes("source: 'timeline_block_click_parent_fallback'")
    && timelineCode.includes('fallbackBooking: renderBooking'));
check('Room timeline banquet serving signals stay frontend-only and snapshot-backed',
    timelineBanquetInspectorHelpersCode.includes('function timelineBanquetServingInfo')
    && timelineBanquetInspectorHelpersCode.includes('function timelineBanquetSnapshotArrival')
    && timelineBanquetInspectorHelpersCode.includes('function timelineBanquetArrivalMarker')
    && timelineBanquetInspectorHelpersCode.includes('timelineBanquetMenuPositions(booking)')
    && timelineCode.includes('function timelineBanquetServiceEvents')
    && timelineCode.includes('function timelineBanquetRoomServingSignals')
    && timelineCode.includes('timelineBanquetMarkerLabel(marker)')
    && timelineCode.includes('data-banquet-room-marker')
    && timelineCode.includes('timelineBanquetGlanceRows')
    && timelineCode.includes('summary.servingMarkers')
    && timelineCode.includes('timelineBanquetRoomOperationalMarkers(summary)')
    && timelineCode.includes("case 'guest_arrival':")
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
    && !htmlContains('db/index.js', 'CREATE TABLE IF NOT EXISTS banquet_groups')
    && !htmlContains('db/index.js', 'CREATE TABLE IF NOT EXISTS banquet_group_bookings')
    && !htmlContains('db/migrations/265_banquet_groups.sql', 'ALTER TABLE bookings ADD COLUMN')
    && !htmlContains('db/index.js', 'banquet_group_id'));
check('Timeline booking API failures render an explicit error state instead of an empty day', apiCode.includes('throwOnError') && timelineCode.includes('function renderTimelineDataError') && timelineCode.includes('Не вдалося завантажити бронювання') && !timelineCode.includes("getBookingsForDate(selectedDate).catch(e => { console.error('[Timeline] getBookingsForDate error:', e); return []; })"));
const timelineBookingLinkLayerZIndex = Number(timelineConstructorCss.match(/\.timeline-banquet-link-layer\s*\{[^}]*z-index:\s*(\d+);/s)?.[1]);
const timelineBookingBlockZIndex = Number(timelineConstructorCss.match(/\.booking-block\s*\{[^}]*z-index:\s*(\d+);/s)?.[1]);
const timelineBanquetOccupancyZIndex = Number(timelineConstructorCss.match(/\.booking-block\.is-timeline-banquet-occupancy-band\s*\{[^}]*z-index:\s*(\d+);/s)?.[1]);
check('Timeline booking connector visual layer stays behind booking cards and above the grid',
    timelineConstructorCss.includes('.timeline-banquet-link-layer')
    && timelineConstructorCss.includes('pointer-events: none')
    && timelineConstructorCss.includes('.timeline-banquet-link-path')
    && timelineConstructorCss.includes('.timeline-booking-link-path--room')
    && timelineConstructorCss.includes('.timeline-booking-link-path--adjacent')
    && timelineConstructorCss.includes('.booking-banquet-link-handle')
    && timelineConstructorCss.includes('body.banquet-linking-active')
    && timelineConstructorCss.includes('html[data-theme="dark"] .booking-banquet-links-detail')
    && timelineBookingLinkLayerZIndex === 6
    && timelineBookingBlockZIndex === 10
    && timelineBanquetOccupancyZIndex === 7
    && timelineBookingLinkLayerZIndex < Math.min(timelineBookingBlockZIndex, timelineBanquetOccupancyZIndex));
check('Room timeline suppresses banquet connector visual lines',
    timelineCode.includes('function clearBanquetLinkLayer')
    && /if\s*\(\s*isRoomTimelineView\(\)\s*\)\s*\{\s*clearBanquetLinkLayer\(\);\s*return;\s*\}/.test(timelineCode)
    && timelineConstructorCss.includes('body.timeline-view-rooms .timeline-banquet-link-layer')
    && timelineConstructorCss.includes('display: none;'));
check('Animator timeline booking blocks show room meta without room timeline duplication', timelineCode.includes('const bookingRoomName = String(renderBooking.room || \'\').trim()') && timelineCode.includes('&& isParkAnimatorTimelineView()') && timelineCode.includes("(!isRoomTimelineView() && !shouldShowBookingRoomMeta ? bookingRoomName : '')") && timelineCode.includes('class="booking-block-room"') && timelineConstructorCss.includes('.booking-block .booking-block-room') && timelineConstructorCss.includes('.booking-block.has-booking-room-meta .subtitle') && timelineConstructorCss.includes('gap: 6px') && timelineConstructorCss.includes('.booking-block.has-booking-room-meta .booking-block-room') && timelineConstructorCss.includes('margin-left: 0') && timelineConstructorCss.includes('max-width: min(96px, calc(100% - 48px))') && timelineConstructorCss.includes('.booking-block.booking-block--short.has-booking-room-meta .timeline-compact-booking-meta .booking-block-room') && timelineConstructorCss.includes('max-width: min(72px, 100%)') && timelineConstructorCss.includes('body.dark-mode .booking-block .booking-block-room') && timelineConstructorCss.includes('html[data-theme="dark"] .booking-block .booking-block-room'));
check('Room timeline activity blocks share marker card styling', timelineCode.includes('const isRoomTimelineActivityCard = isRoomTimelineView()') && timelineCode.includes("block.classList.add('is-room-timeline-activity-card')") && timelineCode.includes('class="timeline-room-activity-main"') && timelineCode.indexOf('class="timeline-room-activity-main"') < timelineCode.indexOf('class="timeline-room-activity-title"') && timelineCode.includes('class="timeline-room-activity-detail"') && timelineConstructorCss.includes('body.timeline-view-rooms .booking-block.is-room-timeline-activity-card') && timelineConstructorCss.includes('body.timeline-view-rooms .timeline-room-service-marker') && timelineConstructorCss.includes('--timeline-room-card-accent') && timelineConstructorCss.includes('border-left: 4px solid var(--timeline-room-card-accent)') && timelineConstructorCss.includes('body.timeline-view-rooms .booking-block.is-room-timeline-activity-card.animation') && timelineConstructorCss.includes('body.timeline-view-rooms .booking-block.is-room-timeline-activity-card .timeline-room-activity-detail') && timelineConstructorCss.includes('-webkit-line-clamp: 2') && timelineConstructorCss.includes('body.timeline-view-rooms .booking-block.is-room-timeline-activity-card .booking-banquet-link-handle'));
check('Room timeline service marker backgrounds are solid category surfaces', timelineConstructorCss.includes('background: var(--timeline-service-card-bg)') && timelineConstructorCss.includes('--timeline-service-card-bg: #4D7C0F') && timelineConstructorCss.includes('--timeline-service-card-bg: #0F766E') && timelineConstructorCss.includes('--timeline-service-card-bg: #5B21B6') && timelineConstructorCss.includes('--timeline-service-card-bg: #1D4ED8') && timelineConstructorCss.includes('--timeline-service-card-bg: #BE185D') && timelineConstructorCss.includes('--timeline-service-card-bg: #334155') && timelineConstructorCss.includes('--timeline-service-card-bg: #0E7490') && !/timeline-room-service-marker--(?:guest-arrival|food-service|room-setup|cake|drinks|custom|service)[^{]*\{[^}]*background:\s*linear-gradient/i.test(timelineConstructorCss));
check('Room timeline activity card backgrounds are solid category surfaces', timelineConstructorCss.includes('--timeline-room-card-bg: #1D4ED8') && timelineConstructorCss.includes('--timeline-room-card-bg: #C2410C') && timelineConstructorCss.includes('--timeline-room-card-bg: #BE185D') && timelineConstructorCss.includes('--timeline-room-card-bg: #0E7490') && !timelineConstructorCss.includes('--timeline-room-card-bg: linear-gradient') && !timelineConstructorCss.includes('--timeline-room-card-bg: rgba('));
check('Room timeline operational lanes separate markers and activity cards', timelineCode.includes('function syncTimelineRoomOperationalLayout(lineGrid = null)') && timelineCode.includes("lineGrid.querySelectorAll('.timeline-room-service-marker')") && timelineCode.includes(".booking-block.is-room-timeline-activity-card:not(.status-hidden)") && timelineCode.includes('dataset.roomOperationalLane = String(lane)') && timelineCode.includes("style.setProperty('--timeline-room-lane-top'") && timelineCode.includes('dataset.roomActivityLane = String(lane)') && timelineCode.includes('syncTimelineRoomOperationalLayout(lineGrid);') && timelineConstructorCss.includes('.line-grid.has-timeline-room-operational-lanes') && timelineConstructorCss.includes('.timeline-line.has-timeline-room-operational-lanes') && timelineConstructorCss.includes('body.timeline-view-rooms .timeline-container.compact .timeline-line.has-timeline-room-operational-lanes') && timelineConstructorCss.includes('body.timeline-view-rooms .timeline-container.compact .timeline-line.has-timeline-room-service-marker-lanes > .line-grid') && controlsCss.includes('body.timeline-view-rooms .timeline-container[data-zoom] .timeline-line.has-timeline-room-operational-lanes') && controlsCss.includes('body.timeline-view-rooms .timeline-container[data-zoom] .timeline-line.has-timeline-room-service-marker-lanes > .line-grid') && timelineConstructorCss.includes('--timeline-room-operational-row-height') && timelineConstructorCss.includes('--timeline-room-activity-card-height: 72px') && timelineConstructorCss.includes('height: var(--timeline-room-activity-card-height)'));
check('Timeline booking blocks expose width-based density display modes', timelineCode.includes('function timelineBookingBlockDensity(width)') && timelineCode.includes("safeWidth < 44) return 'micro'") && timelineCode.includes("safeWidth < 90) return 'tiny'") && timelineCode.includes("safeWidth < 140) return 'short'") && timelineCode.includes("safeWidth < 220) return 'medium'") && timelineCode.includes("return 'wide'") && timelineCode.includes('const bookingBlockDensity = timelineBookingBlockDensity(width)') && timelineCode.includes('booking-block--${bookingBlockDensity}') && timelineConstructorCss.includes('.booking-block--micro') && timelineConstructorCss.includes('.booking-block--tiny') && timelineConstructorCss.includes('.booking-block--short') && timelineConstructorCss.includes('.booking-block--medium') && timelineConstructorCss.includes('.booking-block--wide'));
check('Short timeline activity blocks use compact labels with full title fallback', timelineCode.includes('function timelineCompactActivityLabel(booking, renderBooking, bookingTitle, bookingTitleTail, density = \'medium\')') && timelineCode.includes('function timelinePinataNumberValue(booking, renderBooking') && timelineCode.includes('function timelinePinataNumberDisplay(value)') && timelineCode.includes("return 'ПІН'") && timelineCode.includes("return 'АН'") && timelineCode.includes("return 'Бульб.'") && timelineCode.includes("return 'МК'") && timelineCode.includes("return 'КВ'") && timelineCode.includes("return 'ШОУ'") && timelineCode.includes("return 'ФОТО'") && timelineCode.includes('function timelineMicroActivityLabel(booking, renderBooking, compactActivityLabel') && timelineCode.includes('function timelineCompactActivityTailLabel(bookingTitleTail, bookingTitle, compactActivityLabel)') && timelineCode.includes("const isCompactActivityBlock = (bookingBlockDensity === 'micro' || bookingBlockDensity === 'tiny' || bookingBlockDensity === 'short')") && timelineCode.includes('const compactActivityLabel = timelineCompactActivityLabel(booking, renderBooking, bookingTitle, bookingTitleTail, bookingBlockDensity)') && timelineCode.includes('const microActivityLabel = timelineMicroActivityLabel(booking, renderBooking, compactActivityLabel, bookingTitle, bookingTitleTail)') && timelineCode.includes('const compactActivityTail = bookingBlockDensity === \'short\'') && timelineCode.includes('function timelineRoomActivityDisplayLabel(booking, renderBooking, bookingTitle, bookingTitleTail, compactActivityLabel') && timelineCode.includes('const roomActivityDisplayLabel = timelineRoomActivityDisplayLabel(booking, renderBooking, bookingTitle, bookingTitleTail, compactActivityLabel, bookingBlockDensity)') && timelineCode.includes('isCompactActivityBlock ? roomActivityDisplayLabel') && timelineCode.includes("block.setAttribute('title', fullBookingLabel)") && timelineCode.includes('class="timeline-micro-booking-code"') && timelineCode.includes('class="timeline-compact-booking-label"') && timelineConstructorCss.includes('.booking-block .timeline-compact-booking-main') && timelineConstructorCss.includes('.booking-block .timeline-compact-booking-label'));
check('Micro, short and tiny timeline activity blocks have dedicated compact CSS layout', timelineConstructorCss.includes('.booking-block.booking-block--micro,') && timelineConstructorCss.includes('.booking-block.booking-block--short,') && timelineConstructorCss.includes('.booking-block.booking-block--tiny') && timelineConstructorCss.includes('.booking-block.booking-block--micro .timeline-micro-booking-code') && timelineConstructorCss.includes('flex: 0 0 100%') && timelineCode.includes('data-code-length="${escapeHtml(String(microActivityLabel.length))}"') && timelineConstructorCss.includes('.booking-block.booking-block--micro .timeline-micro-booking-code[data-code-length="4"]') && timelineConstructorCss.includes('.booking-block.booking-block--micro .timeline-micro-booking-code[data-code-length="5"]') && timelineConstructorCss.includes('body.timeline-dashboard-page .booking-block.booking-block--micro') && timelineConstructorCss.includes('padding: 0 2px !important') && timelineConstructorCss.includes('.booking-block.booking-block--micro .booking-banquet-link-handle') && timelineConstructorCss.includes('.booking-block.booking-block--micro .duration-badge') && timelineConstructorCss.includes('flex-direction: column') && timelineConstructorCss.includes('max-width: calc(100% - 18px)') && timelineConstructorCss.includes('width: calc(100% - 18px)') && timelineConstructorCss.includes('.booking-block.booking-block--tiny .timeline-compact-booking-meta') && timelineConstructorCss.includes('.booking-block.booking-block--tiny .duration-badge') && timelineConstructorCss.includes('display: none') && timelineConstructorCss.includes('.booking-block.booking-block--short .timeline-compact-booking-tail') && timelineConstructorCss.includes('.booking-block.booking-block--short .booking-block-room') && timelineConstructorCss.includes('.booking-block.booking-block--short.has-booking-room-meta .timeline-compact-booking-meta .booking-block-room') && timelineConstructorCss.includes('max-width: min(72px, 100%)') && timelineConstructorCss.includes('body.timeline-view-rooms .booking-block.is-room-timeline-activity-card.booking-block--short') && timelineConstructorCss.includes('min-width: 124px') && timelineConstructorCss.includes('white-space: normal') && timelineConstructorCss.includes('-webkit-line-clamp: 2') && timelineConstructorCss.includes('body.dark-mode .booking-block.booking-block--short .timeline-compact-booking-label') && timelineConstructorCss.includes('body.timeline-view-rooms .booking-block.is-room-timeline-activity-card.pinata') && timelineConstructorCss.includes('--timeline-room-card-accent: #F472B6') && timelineConstructorCss.includes('--timeline-room-card-accent: #84CC16') && timelineConstructorCss.includes('--timeline-room-card-accent: #22D3EE') && timelineConstructorCss.includes('--timeline-room-card-accent: #A78BFA'));
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
check('Timeline secondary UX keeps add animator, Afisha, and empty cells quiet',
    timelineCode.includes('function formatAfishaEventCount(count)')
    && timelineCode.includes('const afishaEventLabel = formatAfishaEventCount(events.length)')
    && timelineCode.includes('<span class="line-name">Афіша</span>')
    && !timelineCode.includes('<span class="line-name">🎪 Афіша</span>')
    && timelineCode.includes('<span class="line-sub"><span class="afisha-line-count">${afishaEventLabel}</span>${distBtnHtml}</span>')
    && timelineCode.includes('aria-label="Розподілити афішу по ведучих"')
    && timelineCode.includes('class="afisha-birthday-badge">ІМ</span>')
    && timelineCode.includes("birthday: 'Вітання іменинників'")
    && !timelineCode.includes('birthdayLabel')
    && timelineConstructorCss.includes('body.timeline-dashboard-page .btn-add-line-big')
    && timelineConstructorCss.includes('min-height: 44px !important')
    && timelineConstructorCss.includes('border-style: dashed !important')
    && timelineConstructorCss.includes('body.timeline-dashboard-page .afisha-timeline-line .afisha-line-header')
    && timelineConstructorCss.includes('body.timeline-dashboard-page .afisha-line-count')
    && timelineConstructorCss.includes('body.timeline-dashboard-page .afisha-dist-btn')
    && timelineConstructorCss.includes('.booking-block.afisha-block.afisha-type-birthday')
    && timelineConstructorCss.includes('.afisha-birthday-badge')
    && cssRuleText(timelineConstructorCss, '.grid-cell').includes('position: relative')
    && timelineConstructorCss.includes('.grid-cell::after')
    && timelineConstructorCss.includes('body.timeline-dashboard-page .line-grid .grid-cell:not([data-line="afisha"]):hover::after')
    && timelineConstructorCss.includes('body.timeline-dashboard-page .line-grid .grid-cell[data-line="afisha"]::after')
    && timelineCode.includes("cell.dataset.line !== 'afisha'")
    && timelineCode.includes("contextSource: 'timeline_empty_cell'"));
check('Timeline overlays use singleton tooltip and modal-safe stacking',
    !htmlContains('index.html', 'id="bookingTooltip"')
    && uiCode.includes('window.ensureBookingTooltip = function ensureBookingTooltip()')
    && uiCode.includes("tooltip.setAttribute('role', 'tooltip')")
    && uiCode.includes("tooltip.setAttribute('aria-hidden', hidden ? 'true' : 'false')")
    && uiCode.includes('tooltip.hidden = false')
    && timelineCode.includes('function ensureTimelineBookingTooltip()')
    && timelineCode.includes('const tooltip = ensureTimelineBookingTooltip()')
    && timelineCode.includes('function timelineTooltipSuppressed()')
    && timelineCode.includes('|| _banquetLinkDraft')
    && timelineCode.includes('|| _afishaDragState')
    && timelineConstructorCss.includes('--timeline-overlay-dropdown-z: 22000')
    && timelineConstructorCss.includes('--timeline-overlay-menu-z: 22100')
    && timelineConstructorCss.includes('--timeline-overlay-tooltip-z: 29000')
    && cssRuleText(timelineConstructorCss, '.booking-tooltip').includes('z-index: var(--timeline-overlay-tooltip-z, 29000)')
    && cssRuleText(timelineConstructorCss, '.booking-tooltip').includes('pointer-events: none')
    && timelineConstructorCss.includes('.booking-tooltip[hidden]')
    && responsiveCss.includes('z-index: var(--timeline-overlay-dropdown-z, 22000) !important')
    && responsiveCss.includes('z-index: var(--timeline-overlay-menu-z, 22100) !important')
    && timelineInlineViewPanelRuleGlobal.includes('position: relative !important')
    && timelineInlineViewPanelRuleGlobal.includes('z-index: auto !important')
    && globalModalsCss.includes('z-index: var(--z-modal, 30000)')
    && globalModalsCss.includes('z-index: var(--z-modal-confirm, 30100)')
    && htmlContains('tests/timeline-lifecycle.test.js', 'booking tooltip lifecycle creates one accessible singleton without pre-rendered HTML'));
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
check('Timeline now-line is measured to rows instead of covering the sticky time scale',
    uiCode.includes("document.getElementById('timelineLines')")
    && uiCode.includes('timelineLines.scrollHeight')
    && uiCode.includes('timelineMinutesToPixels(nowMin - startMin, gridAnchor)')
    && uiCode.includes('gridRect.left - scrollRect.left + timelineScroll.scrollLeft + left')
    && uiCode.includes('--timeline-now-line-top')
    && uiCode.includes('--timeline-now-line-height')
    && timelineConstructorCss.includes('top: var(--timeline-now-line-top, 0)')
    && timelineConstructorCss.includes('height: var(--timeline-now-line-height, 100%)')
    && timelineConstructorCss.includes('--timeline-now-line-width: 1px')
    && timelineConstructorCss.includes('z-index: var(--timeline-now-line-z, 15)')
    && timelineConstructorCss.includes('transform: translateX(-50%)')
    && timelineConstructorCss.includes('body.timeline-dashboard-page .timeline-scroll .now-line-global')
    && !timelineConstructorCss.includes('.now-line-global {\n    position: absolute;\n    top: 0;\n    bottom: 0;'));
check('Timeline grid marks and now-line share measured geometry',
    timelineCode.includes('function timelineGridMarkKind(totalMinutes)')
    && timelineCode.includes('const markKind = timelineGridMarkKind(displayMinutes)')
    && timelineCode.includes('const gridWidth = Math.ceil(geometry?.gridWidth || (timelineRangeCellCount(date) * cellWidth))')
    && timelineCode.includes("mark.dataset.markKind = entry.markKind || 'minor'")
    && timelineCode.includes('data-grid-mark="${markKind}"')
    && timelineConstructorCss.includes('--timeline-grid-minor-line')
    && timelineConstructorCss.includes('--timeline-grid-half-line')
    && timelineConstructorCss.includes('--timeline-grid-hour-line')
    && timelineConstructorCss.includes('.time-mark.minor')
    && timelineConstructorCss.includes('body.timeline-dashboard-page .line-grid .grid-cell[data-grid-mark="hour"]')
    && timelineConstructorCss.includes('body.timeline-dashboard-page .line-grid .grid-cell[data-grid-mark="half"]')
    && cssRuleText(timelineConstructorCss, '.grid-cell').includes('box-sizing: border-box')
    && cssRuleText(timelineConstructorCss, '.grid-cell.hour').includes('border-right: 1px solid')
    && !cssRuleText(timelineConstructorCss, '.grid-cell.hour').includes('border-right: 2px')
    && !/\.timeline-container\[data-zoom="(?:30|60)"\] \.grid-cell,\s*[\r\n]+\.timeline-container\[data-zoom="(?:30|60)"\] \.time-mark/.test(controlsCss)
    && htmlContains('tests/timeline-release-proof.test.js', 'timeline release proof stack covers grid mark and now-line geometry regressions'));
check('Timeline period selector stays separate from removed timeline type header selector',
    htmlContains('index.html', 'data-schedule-view-mode="day"')
    && htmlContains('index.html', 'data-schedule-view-mode="week"')
    && !htmlContains('index.html', 'data-schedule-view-mode="rooms"')
    && !htmlContains('index.html', 'data-timeline-type-selector')
    && !htmlContains('index.html', 'id="timelineTypeSelector"')
    && !htmlContains('index.html', 'class="timeline-type-selector segmentedControl"')
    && !htmlContains('index.html', 'class="timeline-type-btn segmentedItem"')
    && appCode.includes('__timelineScheduleModeDelegatedBound')
    && appCode.includes('__timelinePeriodDelegatedBound')
    && !appCode.includes('__timelineTypeViewDelegatedBound')
    && !appCode.includes("closest?.('[data-timeline-type-selector] [data-timeline-view]')")
    && timelineCode.includes("const TIMELINE_VIEW_ROOMS = 'rooms'")
    && timelineCode.includes("const TIMELINE_VIEW_ANIMATORS = 'animators'")
    && timelineCode.includes('set: setTimelineView')
    && !timelineCode.includes("btn.closest('[data-timeline-type-selector]')")
    && !responsiveCss.includes('.timeline-type-selector')
    && !responsiveCss.includes('.timeline-type-btn'));
check('Timeline type visual hierarchy moved out of the header selector',
    htmlContains('index.html', 'class="period-selector timeline-view-mode-selector segmentedControl"')
    && !htmlContains('index.html', 'timeline-visible-type-switch')
    && !htmlContains('index.html', 'timelineTypeSelector')
    && !htmlContains('index.html', 'class="timeline-overlay-toggle timeline-holidays-toggle toolbarToggleChip')
    && !responsiveCss.includes('body.timeline-dashboard-page .schedule-command-center .timeline-visible-type-switch')
    && !responsiveCss.includes('body.timeline-dashboard-page .schedule-command-center .timeline-type-selector')
    && !responsiveCss.includes('body.timeline-dashboard-page .schedule-command-center .timeline-type-btn')
    && responsiveCss.includes('overflow-x: auto !important'));
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
check('Sidebar command task chip honors task page access',
    sidebarCode.includes('function _canSeeSidebarTaskSurface')
    && sidebarCode.includes("const taskItem = { href: '/tasks', access: 'tasks' }")
    && sidebarCode.includes('tasks.hidden = !canSeeTasks')
    && sidebarCode.includes('if (!_canSeeSidebarTaskSurface())')
    && permissionRegistryCode.includes("key: '/tasks'")
    && accountAccessPolicyCode.includes('function resolveCapability')
    && sidebarCode.includes('window.canAccessPage(capability)'));
check('Task quick widgets split completed-today and truthful open workload counts', profileCode.includes('function cabinetTaskQuickCounts') && profileCode.includes('виконано сьогодні') && profileCode.includes('cabinet-quick-split') && profileCode.includes('cabinet-quick-half--completed') && profileCode.includes('cabinet-quick-half--remaining') && profilePagesCss.includes('.cabinet-quick-divider') && sidebarCode.includes('/api/tasks/my-cabinet') && sidebarCode.includes('_isSidebarTaskCompletedToday') && sidebarCode.includes('_isSidebarTaskOpen') && sidebarCode.includes('sidebarOpenWorkload') && sidebarCode.includes('focusChipTasksDoneValue') && sidebarCode.includes('focus-chip-task-split') && sidebarAuroraCss.includes('.focus-chip-task-divider') && htmlContains('services/taskCabinetProjection.js', 'completed: completedUnitsToday') && htmlContains('services/taskCabinetProjection.js', 'completedParentTotal') && htmlContains('services/taskCabinetProjection.js', 'completedUnitsTotal') && htmlContains('services/taskCabinetProjection.js', 'completedHistoryContract') && htmlContains('services/taskCabinetProjection.js', 'openTaskCount') && htmlContains('services/taskCabinetProjection.js', 'open_count') && !htmlContains('services/taskCabinetProjection.js', 'const openTaskCount = rows.length') && !sidebarCode.includes("Number(tasks.assigned || 0) + Number(tasks.in_progress || 0)") && !sidebarCode.includes("activeCount = mine.filter(task => !['done', 'cancelled', 'archived'].includes(task.status) && _isSidebarTaskTodayOrUndated"));
check('Profile My Day keeps non-sensitive load diagnostics for cabinet projection failures', profileCode.includes('let myCabinetLoadError') && profileCode.includes('function loadMyCabinetProjection') && profileCode.includes('function renderCabinetLoadNotice') && profileCode.includes('data-cabinet-refresh') && profileCode.includes('keepExistingOnError') && profilePagesCss.includes('.cabinet-load-notice') && profilePagesCss.includes('body.dark-mode .cabinet-load-notice'));
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
check('Role quick access uses one universal baseline for every role',
    authCode.includes("const ROLE_QUICK_ACCESS_BASE = ['/', '/staff', '/chat', '/certificates']")
    && authCode.includes('quickAccess: ROLE_QUICK_ACCESS_BASE')
    && permissionRegistryCode.includes("key: '/staff'")
    && permissionRegistryCode.includes('defaultRoles: ALL_STAFF')
    && sidebarCode.includes("const EXTRA_MENU_STORAGE_KEY = 'eg_sidebar_extra_menu_items_v3'")
    && sidebarCode.includes('const UTILITY_RAIL_MAX_FAVORITES = 4')
    && sidebarCode.includes("href: '/staff'")
    && sidebarCode.includes('function _sidebarPageCapability')
    && sidebarCode.includes('_getSelectedExtraMenuHrefs(role)')
    && sidebarCode.includes('.map(href => byHref.get(href))')
    && htmlContains('js/staff-page.js', "StaffState.canManageSchedule = canUseStaffCapability('hr.schedule.manage')")
    && htmlContains('js/staff-page.js', "cell.setAttribute('aria-readonly', 'true')")
    && featureRegistryCode.includes("id: 'afisha.events'")
    && featureRegistryCode.includes("href: '/afisha'")
    && featureRegistryCode.includes("id: 'products.programs'")
    && featureRegistryCode.includes("id: 'products.cakes'")
    && featureRegistryCode.includes("id: 'products.menu'")
    && featureRegistryCode.includes("id: 'products.animation'"));
check('Theme switch belongs to the top-right header, not the sidebar or timeline toolbar', authCode.includes('function initHeaderThemeToggle') && authCode.includes('headerThemeToggle') && authCode.includes("currentUser.insertAdjacentElement('afterend', btn)") && authCode.includes('applyCrmThemeMode') && layoutCss.includes('.header-theme-toggle') && layoutCss.includes('.header-theme-glyph--sun') && layoutCss.includes('.header-theme-glyph--moon') && layoutCss.includes('.header-theme-toggle.is-dark .header-theme-thumb') && !layoutCss.includes('.sidebar-theme-btn') && !sidebarCode.includes('_initThemeToggle') && !sidebarCode.includes('sidebar-theme-btn') && !htmlContains('index.html', 'id="darkModeToggle"') && !htmlContains('index.html', 'id="darkModeIcon"'));
check('CRM dark theme is the default unless a user explicitly chose light', fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8').includes('const CRM_DEFAULT_DARK_MODE = true') && htmlContains('index.html', "var d=s!=='false';") && htmlContains('profile.html', "var d=s!=='false';") && fs.readFileSync(path.join(ROOT, 'js/chat-page.js'), 'utf8').includes('window.CRM_DEFAULT_DARK_MODE !== false') && fs.readFileSync(path.join(ROOT, 'js/profile-page.js'), 'utf8').includes("localStorage.getItem('pzp_dark_mode') !== 'false'"));
check('Header right-side actions hide duplicate profile name and share compact control sizing', layoutCss.includes('.header .user-panel.header-actions') && layoutCss.includes('.header .header-actions > #headerSettingsBtn') && layoutCss.includes('.header-settings-btn') && layoutCss.includes('.header-settings-btn:focus-visible') && layoutCss.includes('.header-settings-fallback-notice') && layoutCss.includes('.header .user-panel > .user-name') && layoutCss.includes('display: none !important') && layoutCss.includes('width: 64px') && layoutCss.includes('min-height: 42px') && layoutCss.includes('border-radius: 12px'));
check('Shared header actions use timeline-style visual contract across CRM shell pages',
    layoutCss.includes('v0.78.91: one shared header action visual contract across CRM shell pages.')
    && layoutCss.includes('--header-actions-control-h: 40px;')
    && layoutCss.includes('--header-actions-radius: 10px;')
    && layoutCss.includes('--header-actions-accent: var(--eg-accent, #0EA586);')
    && layoutCss.includes('border-left: 1px solid var(--header-actions-border);')
    && layoutCss.includes('.header .header-actions :where(.header-settings-btn, .timeline-header-settings-btn, .header-theme-toggle, .btn-logout)')
    && layoutCss.includes('.header .header-actions :where(.header-settings-btn, .timeline-header-settings-btn)')
    && layoutCss.includes('.header .header-actions .header-theme-toggle {\n    width: 52px !important;')
    && layoutCss.includes('.header .header-actions .btn-logout {\n    padding: 0 18px !important;')
    && layoutCss.includes('background: var(--header-actions-accent) !important;')
    && layoutCss.includes('body.dark-mode .header .user-panel.header-actions')
    && responsiveCss.includes('.header .user-panel.header-actions')
    && responsiveCss.includes('--header-actions-control-h: 38px;')
    && responsiveCss.includes('--header-actions-control-h: 36px;')
    && responsiveCss.includes('--header-actions-control-h: 34px;')
    && responsiveCss.includes('.header .header-actions .btn-logout')
    && !authCode.includes('pzp_dark_mode =')
    && !authCode.includes('localStorage.setItem(\'pzp_dark_mode\', String(dark));\n    initSharedHeaderActions'));
check('Global search is injected by the shared authenticated header on all CRM pages', authCode.includes('function initGlobalHeaderSearch') && authCode.includes('ensureGlobalSearchModal') && authCode.includes('js/search.js') && authCode.includes('js/crm-feature-registry.js') && authCode.includes('globalHeaderSearchBtn') && layoutCss.includes('v0.56.6: shared header search') && layoutCss.includes('.header-search-btn') && layoutCss.includes('.search-overlay') && layoutCss.includes('.search-container'));
check('Shared compact header guardrails keep search, theme, and logout controls without regressing timeline search removal',
    authCode.includes('function initGlobalHeaderSearch')
    && authCode.includes('function initHeaderThemeToggle')
    && authCode.includes('function bindLogoutButton')
    && layoutCss.includes('.header .btn-search')
    && layoutCss.includes('.header .header-search-btn')
    && layoutCss.includes('.header-settings-btn')
    && layoutCss.includes('.header-theme-toggle')
    && layoutCss.includes('.btn-logout')
    && layoutCss.includes('.header .user-panel > .user-name')
    && layoutCss.includes('.header .btn-search:focus-visible')
    && layoutCss.includes('.header .header-search-btn:focus-visible')
    && layoutCss.includes('.header-settings-btn:focus-visible')
    && !htmlContains('index.html', 'id="globalHeaderSearchBtn"')
    && !htmlContains('index.html', 'class="btn-search"')
    && htmlContains('index.html', 'class="timeline-header-filters"')
    && htmlContains('index.html', 'id="logoutBtn"'));
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
check('Sidebar status colors use semantic tones after late sidebar layers',
    sidebarCode.includes('function _navStatusToneFor(item)')
    && sidebarCode.includes('data-sidebar-status-tone')
    && sidebarCode.includes("case 'tasks':")
    && sidebarCode.includes("case 'leads':")
    && sidebarCode.includes("case 'chat':")
    && sidebarCode.includes("case 'omni':")
    && sidebarCode.includes("_setFocusChipOperationalState(widget, displayCount, { kind: 'leads', hot: actionCount > 0 });")
    && !sidebarCode.includes("hot: actionCount > 0 || newCount > 0")
    && sidebarAuroraCss.includes('Task 9: final semantic sidebar status colors')
    && sidebarAuroraCss.includes('--sb-semantic-critical')
    && sidebarAuroraCss.includes('--sb-semantic-warning')
    && sidebarAuroraCss.includes('--sb-semantic-success')
    && sidebarAuroraCss.includes('--sb-semantic-neutral')
    && sidebarAuroraCss.includes('[data-sidebar-status-tone="critical"]')
    && sidebarAuroraCss.includes('[data-sidebar-status-tone="warning"]')
    && sidebarAuroraCss.includes('[data-sidebar-status-tone="neutral"]')
    && sidebarAuroraCss.includes('.nav-badge[data-badge-type="unread"]')
    && sidebarAuroraCss.includes('.nav-badge[data-badge-type="leads_new"]')
    && sidebarAuroraCss.includes('.nav-badge[data-badge-type="alerts"]')
    && sidebarAuroraCss.includes('.sidebar-group-signal.is-hot')
    && sidebarAuroraCss.includes('.sidebar-group-signal.is-critical')
    && sidebarAuroraCss.includes('.focus-chip--tasks.has-overdue')
    && sidebarAuroraCss.includes('.focus-chip--funnel.has-new:not(.has-action)')
    && sidebarAuroraCss.includes('.focus-chip-task-part--done'));
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
check('Sidebar final profile owner avoids mid-word identity and alert wrapping', sidebarAuroraProfileCss.includes('flex-wrap: wrap;') && sidebarAuroraProfileCss.includes('width: max-content;') && sidebarAuroraProfileCss.includes('overflow-wrap: break-word') && sidebarAuroraProfileCss.includes('word-break: normal;') && sidebarAuroraProfileCss.includes('hyphens: none;') && sidebarAuroraProfileCss.includes('padding: 7px 6px !important'));
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
const sidebarExtraListMarkupIndex = sidebarCode.indexOf('<div class="sidebar-design-extra-list"${extraListHidden ?');
const sidebarTimelineSlotMarkupIndex = sidebarCode.indexOf('sidebar-design-timeline-slot', sidebarExtraListMarkupIndex);
const sidebarExtraEditorMarkupIndex = sidebarCode.indexOf('${extraEditorOpen ? _renderExtraMenuEditor', sidebarExtraListMarkupIndex);
check('Sidebar timeline launcher is inside the Favorites collapsible list',
    sidebarExtraListMarkupIndex > -1
    && sidebarTimelineSlotMarkupIndex > sidebarExtraListMarkupIndex
    && sidebarExtraEditorMarkupIndex > sidebarTimelineSlotMarkupIndex
    && sidebarCode.includes('${timelineExtraItem || extraItems.length ? extraItems.map')
    && !sidebarCode.includes('</div>\n                ${timelineExtraItem ? `<div class="sidebar-design-timeline-slot"'));
check('Sidebar Additional and group headers stay readable after compact density overrides', sidebarAuroraCss.includes('v0.56.3: sidebar menu readability polish') && sidebarAuroraCss.includes('.sidebar-nav:not(.collapsed) .sidebar-design-extras-head') && sidebarAuroraCss.includes('min-height: 42px !important') && sidebarAuroraCss.includes('.sidebar-nav:not(.collapsed) .sidebar-design-extras-dot::before') && sidebarAuroraCss.includes('.sidebar-nav:not(.collapsed) .sidebar-group-header') && sidebarAuroraCss.includes('grid-template-columns: 28px minmax(0, 1fr) 26px !important') && sidebarAuroraCss.includes('.sidebar-nav:not(.collapsed) .sidebar-group-header .nav-icon') && sidebarAuroraCss.includes('width: 26px !important'));
check('Sidebar collapsed groups clip submenu tails and disable hidden hit areas', sidebarCode.includes('aria-hidden="${finalOpen ?') && sidebarCode.includes("items.setAttribute('inert'") && sidebarCode.includes('function _syncSidebarGroupPanelStates') && sidebarAuroraCss.includes('v0.73.42: collapsed sidebar groups are clipped/inert') && sidebarAuroraCss.includes('grid-template-rows: 0fr') && sidebarAuroraCss.includes('grid-template-rows: 1fr') && sidebarAuroraCss.includes('pointer-events: none') && sidebarAuroraCss.includes('visibility 0s linear 0.24s') && sidebarAuroraCss.includes('overflow: hidden'));
check('Sidebar quick access header uses only Обране and replaces bulky Additional editor button', sidebarCode.includes('Обране') && sidebarCode.includes('sidebar-design-extras-gear') && sidebarCode.includes('Редагувати обране') && sidebarCode.includes('Сторінки обраного') && sidebarCode.includes('Знайти сторінку обраного') && !sidebarCode.includes('обране меню') && !sidebarCode.includes('Знайти сторінку швидкого доступу') && sidebarAuroraCss.includes('v0.57.1: Quick Access submenu polish') && sidebarAuroraCss.includes('grid-template-columns: minmax(0, 1fr) 34px !important') && sidebarAuroraCss.includes('v0.73.15: center the compact Favorites header') && sidebarAuroraCss.includes('display: grid !important') && sidebarAuroraCss.includes('grid-template-columns: 32px minmax(0, 1fr) 32px !important') && sidebarAuroraCss.includes('.sidebar-nav:not(.collapsed) .sidebar-design-extras-copy') && sidebarAuroraCss.includes('text-align: center !important') && sidebarAuroraCss.includes('.sidebar-design-extras-manage-text') && sidebarAuroraCss.includes('sidebarQuickGearSpin') && sidebarAuroraCss.includes('.sidebar-design-extras:not(.is-collapsed) .sidebar-design-extra-list::before'));
check('Sidebar productivity quick block matches Favorites collapse and settings behavior', sidebarCode.includes('PRODUCTIVITY_MENU_STORAGE_KEY') && sidebarCode.includes('PRODUCTIVITY_MENU_COLLAPSED_STORAGE_KEY') && sidebarCode.includes('PRODUCTIVITY_MENU_EDIT_STORAGE_KEY') && sidebarCode.includes('PRODUCTIVITY_QUICK_DEFAULT_HREFS') && sidebarCode.includes('sidebarProductivityQuick') && sidebarCode.includes('Особисте') && sidebarCode.includes('Особисті сторінки') && sidebarCode.includes('/profile?tab=myday') && sidebarCode.includes('/tasks?view=my') && sidebarCode.includes('Мій день') && sidebarCode.includes('function _renderProductivityQuickBlock') && sidebarCode.includes('function _renderProductivityEditor') && sidebarCode.includes('function _bindProductivityQuickBlock') && sidebarCode.includes('data-sidebar-productivity-toggle-section') && sidebarCode.includes('data-sidebar-productivity-toggle-editor') && sidebarCode.includes('data-sidebar-productivity-save') && sidebarCode.includes('new URLSearchParams(window.location.search') && sidebarAuroraCss.includes('v0.75.54: productivity quick block uses the same collapsible/settings shell as Favorites') && sidebarAuroraCss.includes('.sidebar-productivity-quick') && sidebarAuroraCss.includes('.sidebar-productivity-list[hidden]'));
check('Sidebar quick access editor keeps only Save and collapses after saving', sidebarCode.includes('data-sidebar-extra-search') && sidebarCode.includes('data-sidebar-extra-count') && sidebarCode.includes('_applyExtraMenuEditorFilter') && sidebarCode.includes('_setExtraMenuEditorOpen(false)') && sidebarCode.includes('_setExtraMenuCollapsed(true)') && sidebarAuroraCss.includes('.sidebar-extra-editor-tools') && sidebarAuroraCss.includes('grid-template-columns: minmax(0, 1fr) !important') && sidebarAuroraCss.includes('.sidebar-extra-search') && sidebarAuroraCss.includes('.sidebar-extra-save'));
check('Sidebar widget settings are separated from quick access pages and save deliberately', sidebarCode.includes('sidebar-widget-settings') && sidebarCode.includes('Налаштування віджетів') && sidebarCode.includes('Зміна застосовується після збереження') && sidebarCode.indexOf("_setSidebarCurrencySignalEnabled(currencySignal.checked)") < sidebarCode.indexOf("_saveExtraMenuSelection(checkedHrefs, role)") && sidebarCode.includes("extras.classList.add('has-widget-settings-dirty')") && sidebarAuroraCss.includes('.sidebar-widget-settings-head'));
check('Sidebar quick access gear opens only the checkbox settings panel', sidebarCode.includes('const editorWasOpen = _isExtraMenuEditorOpen();') && sidebarCode.includes('const extraListHidden = extraEditorOpen || extraCollapsed') && sidebarCode.includes('sidebar-design-extra-list"${extraListHidden ?') && sidebarAuroraCss.includes('.sidebar-design-extra-list[hidden]') && sidebarAuroraCss.includes('.sidebar-design-extras.is-editing .sidebar-design-extra-list'));
check('Sidebar identity card has compact passive time/date and optional currency signal without weather fetch noise', sidebarCode.includes('sidebarIdentityAux') && sidebarCode.includes('sidebarIdentityTime') && sidebarCode.includes('sidebarIdentityDate') && sidebarCode.includes('data-sidebar-static="true"') && sidebarCode.includes("item.dataset.sidebarStatic === 'true'") && !sidebarCode.includes('sidebarIdentityWeather') && sidebarCode.includes('sidebarIdentityCurrency') && sidebarCode.includes('SIDEBAR_CURRENCY_SIGNAL_STORAGE_KEY') && !sidebarCode.includes('/api/dashboard/widgets/weather') && sidebarCode.includes('/api/dashboard/widgets/currency') && !sidebarCode.includes('open-meteo.com') && sidebarCode.includes('Europe/Kyiv') && sidebarAuroraCss.includes('v0.58.0: enterprise sidebar navigation redesign') && sidebarAuroraCss.includes('v0.59.5: passive time/date widgets') && sidebarAuroraCss.includes('.sidebar-identity-aux'));
check('Sidebar identity card v2 keeps USD first and role badges patterned', sidebarCode.includes('function _sidebarRoleBadgeKey') && sidebarCode.includes('function _fetchSidebarCurrencyFallback') && sidebarCode.includes('function _canUseSidebarFinanceCurrencyFallback') && sidebarCode.includes('/api/finance/currency/rates') && sidebarCode.includes('cardEl.dataset.role = roleKey') && sidebarAuroraCss.includes('v0.57.1: sidebar identity card v2') && sidebarAuroraCss.includes('.sidebar-identity-meta-item[data-sidebar-meta="currency"]') && sidebarAuroraCss.includes('order: 1 !important') && sidebarAuroraCss.includes('--role-badge-pattern') && sidebarAuroraCss.includes('.sidebar-identity-card[data-role="creator"]') && sidebarAuroraCss.includes('.sidebar-identity-card[data-role="dishwasher"]'));
check('Sidebar currency fallback waits for missing dashboard rates and canonical Finance capability before hitting protected rates', sidebarCode.includes('function _hasSidebarCurrencyRates') && sidebarCode.includes("if (!_canUseSidebarFinanceCurrencyFallback()) return null;") && sidebarCode.includes("const financeItem = { href: '/finance', access: 'finance' }") && sidebarCode.includes("const canManageFinance = typeof window.canUseAction === 'function'") && sidebarCode.includes("window.canUseAction('finance.manage')") && sidebarCode.includes("typeof canUseAction === 'function' && canUseAction('finance.manage')") && sidebarCode.indexOf("window.canUseAction('finance.manage')") < sidebarCode.indexOf('hasAccess(financeItem, role)') && sidebarCode.includes('_businessAllowsSidebarItem(financeItem, user)') && sidebarCode.includes('_isNavItemVisible(financeItem, user, role)') && sidebarCode.indexOf("const result = await _fetchSidebarWidget('currency');") < sidebarCode.indexOf('if (!_hasSidebarCurrencyRates(dashboardCurrency))') && sidebarCode.indexOf('if (!_hasSidebarCurrencyRates(dashboardCurrency))') < sidebarCode.indexOf('if (_canUseSidebarFinanceCurrencyFallback())') && sidebarCode.indexOf('if (_canUseSidebarFinanceCurrencyFallback())') < sidebarCode.indexOf('fallbackCurrency = await _fetchSidebarCurrencyFallback();') && !/Promise\.allSettled\(\[\s*_fetchSidebarWidget\('currency'\),\s*_fetchSidebarCurrencyFallback\(\)/.test(sidebarCode));
check('Sidebar identity card keeps USD as the only chip and moves time/date under the avatar', sidebarCode.includes('sidebar-identity-portrait') && sidebarCode.includes('sidebar-identity-aux') && sidebarCode.includes('sidebar-identity-aux-item') && sidebarCode.includes('sidebar-identity-aux-v') && sidebarCode.indexOf('class="sidebar-identity-portrait"') < sidebarCode.indexOf('class="sidebar-identity-main"') && sidebarCode.indexOf('id="sidebarIdentityAux"') < sidebarCode.indexOf('class="sidebar-identity-main"') && !sidebarCode.includes('class="sidebar-identity-meta-item" data-sidebar-meta="time"') && !sidebarCode.includes('class="sidebar-identity-meta-item" data-sidebar-meta="date"') && sidebarAuroraCss.includes('v0.73.35: profile time/day stack belongs under the avatar') && sidebarAuroraCss.includes('"identity-portrait identity-main"') && sidebarAuroraCss.includes('.sidebar-identity-portrait') && sidebarAuroraCss.includes('grid-area: identity-main !important') && sidebarAuroraCss.includes('flex-wrap: nowrap !important') && sidebarAuroraCss.includes('.sidebar-identity-meta-item:not([data-sidebar-meta="currency"])') && sidebarAuroraCss.includes('display: none !important'));
check('Sidebar avatar falls back to initials when a profile image fails', sidebarCode.includes('function _sidebarAvatarFallback') && sidebarCode.includes("img.addEventListener('error'") && sidebarCode.includes("el.classList.remove('has-photo')") && sidebarCode.includes('el.textContent = fallback.label') && sidebarCode.includes('el.replaceChildren(img)') && sidebarCode.includes("img.loading = 'lazy'") && sidebarCode.includes("img.decoding = 'async'"));
check('Sidebar polished profile card gives name/role a full row and balances alert USD time/date', sidebarCode.indexOf('class="sidebar-identity-title-row"') < sidebarCode.indexOf('class="sidebar-identity-portrait"') && sidebarCode.indexOf('class="sidebar-identity-title-row"') < sidebarCode.indexOf('class="sidebar-identity-main"') && sidebarAuroraCss.includes('v0.73.36: polished profile card composition') && sidebarAuroraCss.includes('"identity-title identity-title"') && sidebarAuroraCss.includes('grid-template-columns: minmax(0, 1fr) max-content !important') && sidebarAuroraCss.includes('@keyframes sidebarIdentityAlertPulse') && sidebarAuroraCss.includes('.sidebar-command-deck[data-tone="critical"] .sidebar-identity-summary') && sidebarAuroraCss.includes('.sidebar-identity-aux-item + .sidebar-identity-aux-item') && sidebarAuroraCss.includes('grid-template-columns: auto minmax(0, 1fr) !important') && sidebarAuroraCss.includes('.sidebar-nav.collapsed .sidebar-identity-title-row'));
check('Sidebar profile business selector owns the full bottom row without a visible Business label', sidebarCode.indexOf('id="sidebarBusinessContextHost"') > sidebarCode.indexOf('class="sidebar-identity-main"') && !sidebarCode.includes('sidebar-business-label') && sidebarAuroraCss.includes('v0.73.41: profile business selector is label-free and stretches across the card') && sidebarAuroraCss.includes('v0.73.43: multi-business settings live behind a compact gear') && sidebarAuroraCss.includes('v0.73.52: business gear and Favorites gear share one size') && sidebarAuroraCss.includes('"identity-business identity-business"') && sidebarAuroraCss.includes('.sidebar-business-context') && sidebarAuroraCss.includes('grid-area: identity-business !important') && sidebarAuroraCss.includes('grid-column: 1 / -1 !important') && sidebarAuroraCss.includes('grid-template-columns: minmax(0, 1fr) !important') && sidebarAuroraCss.includes('.sidebar-business-control-row') && sidebarAuroraCss.includes('grid-template-columns: minmax(0, 1fr) 36px !important') && sidebarAuroraCss.includes('.sidebar-business-select') && sidebarAuroraCss.includes('height: 42px !important') && sidebarAuroraCss.includes('border-radius: 8px !important') && sidebarAuroraCss.includes('.sidebar-business-settings-btn') && sidebarAuroraCss.includes('sidebar-business-settings-btn:hover span') && sidebarAuroraCss.includes('animation: sidebarQuickGearSpin .5s ease both') && sidebarAuroraCss.includes('text-align: center !important') && sidebarAuroraCss.includes('border-top: 0 !important'));
check('Sidebar profile summary cleanup removes oval, de-pills role, and keeps identity signals split', sidebarCode.includes('const label = _sidebarRoleLabel(raw);') && !sidebarCode.includes('id="sidebarIdentityHealth"') && !sidebarCode.includes('sidebar-identity-health-dot') && sidebarAuroraCss.includes('v0.60.37: profile summary card cleanup') && sidebarAuroraCss.includes('.sidebar-identity-summary::before') && sidebarAuroraCss.includes('border-radius: 0 !important') && sidebarAuroraCss.includes('border-left: 1px solid color-mix') && sidebarAuroraCss.includes('grid-template-areas:') && sidebarAuroraCss.includes('"identity-business"'));
check('Sidebar USD tile fits the full rate after the polished profile layout', sidebarAuroraCss.includes('v0.73.36: polished profile card composition') && sidebarAuroraCss.includes('button.sidebar-identity-meta-item[data-sidebar-meta="currency"]') && sidebarAuroraCss.includes('grid-template-columns: auto minmax(0, 1fr) !important') && sidebarAuroraCss.includes('width: 100% !important') && sidebarAuroraCss.includes('.sidebar-identity-meta-item[data-sidebar-meta="currency"] .sidebar-identity-meta-v') && sidebarAuroraCss.includes('font-size: 12.2px !important') && sidebarAuroraCss.includes('text-overflow: unset !important') && sidebarAuroraCss.includes('.sidebar-identity-aux-v') && sidebarAuroraCss.includes('font-variant-numeric: tabular-nums !important'));
check('Sidebar currency signal opens the Finance rates window instead of a bottom sidebar panel', !sidebarCode.includes('function _fetchSidebarWeatherFallback') && sidebarCode.includes('function _openFinanceCurrencyRates') && sidebarCode.includes('/finance?currency=rates') && sidebarCode.includes("finance:open-currency-rates") && sidebarCode.includes('data-sidebar-currency-signal') && sidebarAuroraCss.includes('v0.58.15: sidebar currency chip is optional; full rates live in Finance.'));
check('Sidebar mobile quick access and identity chips keep the final no-cut fit', sidebarCode.includes('formatToParts(date)') && sidebarAuroraCss.includes('v0.72.0: mobile sidebar quick access fit') && sidebarAuroraCss.includes('--eg-sidebar-mobile-w: min(100vw, 336px)') && sidebarAuroraCss.includes('max-width: 76px !important') && sidebarAuroraCss.includes('grid-template-columns: minmax(0, 1fr) 44px !important') && sidebarAuroraCss.includes('grid-template-columns: 40px minmax(0, 1fr) 22px !important') && sidebarAuroraCss.includes('.sidebar-nav:not(.collapsed) .sidebar-design-extras-title') && sidebarAuroraCss.includes('white-space: normal !important') && sidebarAuroraCss.includes('.sidebar-extra-picker') && sidebarAuroraCss.includes('max-height: min(42dvh, 360px) !important'));
const sidebarTimelineLauncherSmokeCode = fs.readFileSync(path.join(ROOT, 'tests/browser/sidebar-timeline-launcher-smoke.js'), 'utf8');
const timelineLauncherActiveRule = cssRuleText(sidebarAuroraCss, '.sidebar-nav:not(.collapsed) .sidebar-design-timeline-launcher.active');
const timelineLauncherGeometryMutationPattern = /\b(?:display|grid-template-columns|grid-template-rows|gap|padding|margin|width|height|min-width|min-height|max-width|max-height)\s*:/;
check('Sidebar launcher smoke verifies canonical default context and stable ready counts',
    sidebarTimelineLauncherSmokeCode.includes('function assertParkDefaultContext')
    && sidebarTimelineLauncherSmokeCode.includes("currentContext: window.CrmBusinessContext?.current?.() || ''")
    && sidebarTimelineLauncherSmokeCode.includes('function launcherCountDiagnostics')
    && sidebarTimelineLauncherSmokeCode.includes('timeline launcher counts did not stay ready for four animation frames')
    && sidebarTimelineLauncherSmokeCode.includes('const checkNextFrame = () =>')
    && sidebarTimelineLauncherSmokeCode.includes('readyFrames >= 4')
    && sidebarTimelineLauncherSmokeCode.includes('function assertTimelineDate')
    && sidebarTimelineLauncherSmokeCode.includes("currentDate: typeof formatDate === 'function'"));
check('Sidebar timeline launcher keeps mode, URL, semantic, sync and mobile-close contracts',
    sidebarCode.includes("Object.freeze({ key: 'animators', label: 'Свята' })")
    && sidebarCode.includes("Object.freeze({ key: 'rooms', label: 'Кімнати' })")
    && sidebarCode.includes("url.searchParams.set('timelineView', mode)")
    && sidebarCode.includes("variant: modeCount === 2 ? 'launcher' : (modeCount === 1 ? 'single' : 'hidden')")
    && sidebarCode.includes('data-sidebar-timeline-mode-count="${timelineCard.modeCount}"')
    && sidebarCode.includes('data-sidebar-timeline-active-mode="${_escAttr(activeMode)}"')
    && sidebarCode.includes("const activeMode = _sidebarCurrentTimelineView('', timelineCard.modes)")
    && sidebarCode.includes('function _sidebarTimelineViewFromUrl')
    && sidebarCode.includes('function _sidebarStoredTimelineView')
    && sidebarCode.includes("window.TimelineBusinessContext?.storageKey?.('timeline_view')")
    && sidebarCode.includes("keys.push('pzp_timeline_view')")
    && sidebarCode.includes('function _sidebarDefaultTimelineView')
    && sidebarCode.includes('function _sidebarTimelineModeKeys')
    && sidebarCode.includes('availableKeys.includes(value)')
    && sidebarCode.includes('modeLinks.map(link => link.dataset.sidebarTimelineMode)')
    && sidebarCode.includes('aria-pressed="${modeActive ?')
    && sidebarCode.includes("link.setAttribute('aria-pressed', isActive ? 'true' : 'false')")
    && sidebarCode.includes("link.setAttribute('aria-current', 'page')")
    && sidebarCode.includes("link.removeAttribute('aria-current')")
    && sidebarCode.includes('sidebar-design-timeline-inset')
    && sidebarCode.includes("window.addEventListener('timeline:view-changed'")
    && sidebarCode.includes('function _ensureSidebarBusinessProfile')
    && sidebarCode.includes('api.hydrateProfile({')
    && sidebarCode.includes('void _ensureSidebarBusinessProfile();')
    && apiCode.includes('function crmBusinessHasTimelineViewHandoff')
    && apiCode.includes('crmBusinessHasTimelineViewHandoff(current, context)')
    && sidebarCode.includes("[data-sidebar-rail-item], [data-sidebar-timeline-mode]")
    && sidebarCode.includes('if (isMobileSidebar()) setMobileSidebarOpen(false);')
    && sidebarCode.includes('function _isSidebarPlainPrimaryClick')
    && sidebarCode.includes('return !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey')
    && sidebarCode.includes('window.TimelineView.set(mode)')
    && sidebarCode.includes('_refreshSidebarTimelineSummary({ force: true })')
    && sidebarCode.includes("event?.key !== ' '")
    && sidebarAuroraCss.includes('--eg-timeline-launcher-duration: 170ms')
    && sidebarAuroraCss.includes('.sidebar-design-timeline-inset')
    && sidebarAuroraCss.includes('.sidebar-design-timeline-inset::before')
    && sidebarAuroraCss.includes('.sidebar-design-timeline-segment')
    && sidebarAuroraCss.includes('min-height: 34px')
    && sidebarAuroraCss.includes('height: 16px')
    && sidebarAuroraCss.includes('font-variant-numeric: tabular-nums')
    && sidebarAuroraCss.includes('@media (prefers-reduced-motion: reduce)'));
check('Sidebar timeline launcher active state is geometry-neutral',
    timelineLauncherActiveRule.includes('border-color')
    && timelineLauncherActiveRule.includes('background:')
    && timelineLauncherActiveRule.includes('box-shadow:')
    && !timelineLauncherGeometryMutationPattern.test(timelineLauncherActiveRule)
    && sidebarAuroraCss.includes('.sidebar-nav:not(.collapsed) .sidebar-design-timeline-launcher > .sidebar-design-timeline-main,')
    && sidebarAuroraCss.includes('min-height: 38px')
    && sidebarAuroraCss.includes('grid-template-columns: 28px minmax(0, 1fr) auto')
    && sidebarAuroraCss.includes('padding: 0 2px 0 3px')
    && sidebarAuroraCss.includes('grid-template-columns: repeat(2, minmax(0, 1fr))')
    && sidebarAuroraCss.includes('min-height: 34px')
    && sidebarAuroraCss.includes('height: 16px'));
check('Sidebar timeline launcher shows mode counts instead of visible summary or checkmarks',
    !sidebarCode.includes('data-sidebar-timeline-summary="true"')
    && sidebarCode.includes('data-sidebar-timeline-count-mode="${_escAttr(mode.key)}"')
    && sidebarCode.includes('data-sidebar-timeline-count-status="${_escAttr(countStatus)}"')
    && sidebarCode.includes('function _sidebarTimelineModeCountText')
    && sidebarCode.includes('function _sidebarTimelineModeStatus')
    && sidebarCode.includes('function _sidebarTimelineModeAriaLabel')
    && sidebarCode.includes('function _sidebarTimelineBookingHidden')
    && sidebarCode.includes("String(surface || '').trim().toLowerCase() === 'hidden'")
    && sidebarCode.includes('timelineSummaryCache: new Map()')
    && sidebarCode.includes('timelineSummaryPromises: new Map()')
    && sidebarCode.includes('timelineSummaryRequestSeq')
    && sidebarCode.includes('function _fetchSidebarTimelineSummaryMode')
    && sidebarCode.includes("url.searchParams.set('timelineView'")
    && sidebarCode.includes('_sidebarTimelineSummaryCacheKey(model, mode)')
    && sidebarCode.includes('_sidebarTimelineAvailableModeKeysFromDom')
    && sidebarCode.includes('seq !== _state.timelineSummaryRequestSeq')
    && sidebarCode.includes('timeline:summary-changed')
    && sidebarCode.includes('timeline:schedule-view-mode-changed')
    && sidebarCode.includes('detail.timelineView')
    && sidebarCode.includes('.filter(item => item !== mode)')
    && sidebarCode.includes('SIDEBAR_TIMELINE_COUNT_PLACEHOLDER')
    && !sidebarCode.includes('sidebar-design-timeline-segment-check')
    && !sidebarAuroraCss.includes('sidebar-design-timeline-segment-check')
    && sidebarAuroraCss.includes('.sidebar-design-timeline-segment-count')
    && sidebarAuroraCss.includes('min-width: 2ch')
    && sidebarAuroraCss.includes('font-size: 9.8px')
    && sidebarAuroraCss.includes('font-variant-numeric: tabular-nums')
    && !sidebarAuroraCss.includes('[data-sidebar-timeline-summary]')
    && !sidebarAuroraCss.includes('is-summary-changing')
    && timelineCode.includes('function dispatchTimelineSummaryChanged')
    && timelineCode.includes("window.dispatchEvent(new CustomEvent('timeline:summary-changed'")
    && timelineCode.includes('timelineView: typeof timelineCurrentView')
    && timelineCode.includes('bookings: Array.isArray(detail.bookings) ? detail.bookings : undefined')
    && timelineCode.includes("dispatchTimelineSummaryChanged({ date: formatDate(selectedDate), viewMode: 'day', bookings })")
    && timelineCode.includes("dispatchTimelineSummaryChanged({ date: formatDate(selectedDate), viewMode: 'week' })")
    && sidebarTimelineLauncherSmokeCode.includes('function assertLauncherSurfaceParity')
    && sidebarTimelineLauncherSmokeCode.includes('/dashboard?businessContext=${PARK_CONTEXT}')
    && sidebarTimelineLauncherSmokeCode.includes('function assertFavoritesTimelineCollapseBehavior')
    && sidebarTimelineLauncherSmokeCode.includes('eg_sidebar_extra_menu_collapsed_v1')
    && sidebarTimelineLauncherSmokeCode.includes('Tab does not focus hidden timeline controls while Favorites is collapsed')
    && sidebarTimelineLauncherSmokeCode.includes('Space expands Favorites')
    && sidebarTimelineLauncherSmokeCode.includes('Enter collapses Favorites')
    && sidebarTimelineLauncherSmokeCode.includes('closing editor returns Favorites to collapsed state')
    && sidebarTimelineLauncherSmokeCode.includes('function assertCompactLauncherGeometry')
    && sidebarTimelineLauncherSmokeCode.includes('launcher.rects.launcher.height <= launcherMax')
    && sidebarTimelineLauncherSmokeCode.includes('assertLauncherGeometryParity(dashboard, timeline')
    && sidebarTimelineLauncherSmokeCode.includes('tolerance = 1')
    && sidebarTimelineLauncherSmokeCode.includes('assertLauncherCountContract')
    && sidebarTimelineLauncherSmokeCode.includes('assert.equal(launcher.summaryCount, 0')
    && sidebarTimelineLauncherSmokeCode.includes('assert.equal(launcher.checkCount, 0')
    && sidebarTimelineLauncherSmokeCode.includes('assertLauncherCountsReady')
    && sidebarTimelineLauncherSmokeCode.includes("localStorage.setItem('pzp_dark_mode', 'true')")
    && sidebarTimelineLauncherSmokeCode.includes('const DATA_DATE = normalizeOptionalDate')
    && sidebarTimelineLauncherSmokeCode.includes('const EMPTY_DATE = normalizeOptionalDate')
    && sidebarTimelineLauncherSmokeCode.includes('function assertLauncherCountsForDate')
    && sidebarTimelineLauncherSmokeCode.includes('at least one timeline mode has visible records')
    && sidebarTimelineLauncherSmokeCode.includes('empty-date zero-count assertion')
    && sidebarTimelineLauncherSmokeCode.includes("currentUrl.searchParams.get('timelineView'), null")
    && sidebarTimelineLauncherSmokeCode.includes('assert.equal(animators, 0')
    && sidebarTimelineLauncherSmokeCode.includes('assert.equal(rooms, 0')
    && sidebarTimelineLauncherSmokeCode.includes('function assertLoadingLayoutStability')
    && sidebarTimelineLauncherSmokeCode.includes('loading stability check delayed at least one bookings summary request')
    && sidebarTimelineLauncherSmokeCode.includes('assertLauncherGeometryParity(ready, loading')
    && sidebarTimelineLauncherSmokeCode.includes("context.route('**/*'")
    && !sidebarTimelineLauncherSmokeCode.includes("context.route('**/api/**'")
    && sidebarTimelineLauncherSmokeCode.includes('if (url.origin !== base)')
    && sidebarTimelineLauncherSmokeCode.includes("if (method === 'GET')")
    && sidebarTimelineLauncherSmokeCode.includes("if (method === 'HEAD' || method === 'OPTIONS')")
    && sidebarTimelineLauncherSmokeCode.includes('const sameOriginGetCache = new Map()')
    && sidebarTimelineLauncherSmokeCode.includes('if (response.ok()) sameOriginGetCache.set(cacheKey, cachedResponse)')
    && sidebarTimelineLauncherSmokeCode.includes('read-only launcher smoke attempted no same-origin non-read requests')
    && !sidebarTimelineLauncherSmokeCode.includes("pathname === '/api/auth/refresh'")
    && !sidebarTimelineLauncherSmokeCode.includes("fetchJson(base, '/api/auth/login'")
    && !sidebarTimelineLauncherSmokeCode.includes("method: 'POST'"));
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
check('Training onboarding separates corporate and assigned profession scopes',
    trainingHtml.includes('Корпоративний setup та допуск кожної призначеної професії')
    && trainingHtml.includes('aria-live="polite" aria-busy="true"')
    && trainingPageCode.includes("value: 'general'")
    && trainingPageCode.includes("value: 'profession'")
    && trainingPageCode.includes("visibleWhen: values => values.scope === 'profession'")
    && trainingPageCode.includes('data-profession-key')
    && trainingPageCode.includes('/profession-checklist')
    && trainingPageCode.includes('training-onboarding-staff-group')
    && trainingCss.includes('.training-onboarding-scope-grid')
    && trainingCss.includes('.training-onboarding-card.is-completed'));
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
check('Dashboard exposes DashboardPage for shared header settings adapter', dashboardPageCode.includes('window.DashboardPage = DashboardPage') && authCode.includes("window.DashboardPage?.openSettings"));
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
check('Timeline header theme toggle keeps scoped sun and moon visual states', authCode.includes("btn.id = 'headerThemeToggle'") && authCode.includes("btn.className = 'header-theme-toggle'") && authCode.includes('header-theme-track" aria-hidden="true"') && authCode.includes('header-theme-glyph header-theme-glyph--sun') && authCode.includes('header-theme-glyph header-theme-glyph--moon') && authCode.includes('<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">') && authCode.includes("btn.setAttribute('aria-pressed', String(isDark))") && authCode.includes('syncHeaderThemeToggle') && authCode.includes('applyCrmThemeMode(!isCrmDarkThemeActive(), true)') && responsiveCss.includes('body.timeline-dashboard-page .header .header-theme-toggle') && responsiveCss.includes('body.timeline-dashboard-page .header .header-theme-glyph--sun') && responsiveCss.includes('body.timeline-dashboard-page .header .header-theme-glyph--moon') && responsiveCss.includes('body.dark-mode.timeline-dashboard-page .header .header-theme-toggle.is-dark .header-theme-glyph--sun') && responsiveCss.includes('html[data-theme="dark"] body.timeline-dashboard-page .header .header-theme-toggle.is-dark .header-theme-glyph--moon') && cssRuleText(responsiveCss, 'body.timeline-dashboard-page .header .header-theme-glyph--sun').includes('opacity: 1 !important') && cssRuleText(responsiveCss, 'body.timeline-dashboard-page .header .header-theme-glyph--moon').includes('opacity: 0 !important') && cssRuleIncludingSelectorText(responsiveCss, 'body.dark-mode.timeline-dashboard-page .header .header-theme-toggle.is-dark .header-theme-glyph--sun').includes('opacity: 0 !important') && cssRuleIncludingSelectorText(responsiveCss, 'body.dark-mode.timeline-dashboard-page .header .header-theme-toggle.is-dark .header-theme-glyph--moon').includes('opacity: 1 !important') && !responsiveCss.includes('body.timeline-dashboard-page .header .header-theme-glyph--sun {\n    opacity: 0 !important;') && !responsiveCss.includes('body.timeline-dashboard-page .header .header-theme-glyph--moon {\n    opacity: 0 !important;\n}\n\nbody.dark-mode.timeline-dashboard-page .header .header-theme-toggle.is-dark .header-theme-glyph--moon') && !sidebarCode.includes('_initThemeToggle') && !sidebarCode.includes('sidebar-theme-btn') && !htmlContains('index.html', 'id="darkModeToggle"'));
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
const achievementsRouteCode = fs.readFileSync(path.join(ROOT, 'routes', 'achievements.js'), 'utf8');
const shopRouteCode = fs.readFileSync(path.join(ROOT, 'routes', 'shop.js'), 'utf8');
const leadsPageCss = cssTextWithImports('css/pages.css');
check('Achievements auto-check is schema-tolerant for optional gamification criteria', achievementsRouteCode.includes('function optionalAchievementQuery') && achievementsRouteCode.includes("Achievement check skipped: catalog schema unavailable") && achievementsRouteCode.includes("optionalAchievementQuery('task_completion'") && achievementsRouteCode.includes("optionalAchievementQuery('task_decomposition'") && achievementsRouteCode.includes('function writeAchievementProgress') && achievementsRouteCode.includes('function awardAchievementCoins') && achievementsRouteCode.includes('if (!completed) return false;'));
check('Shop inventory route tolerates legacy username and current user_id inventory schemas', shopRouteCode.includes('function getTableColumns') && shopRouteCode.includes("getTableColumns('user_inventory')") && shopRouteCode.includes("const useShopItems = inventoryColumns.has('user_id') && shopItemColumns.size > 0;") && shopRouteCode.includes("const ownerColumn = inventoryColumns.has('user_id') ? 'user_id' : 'username';") && shopRouteCode.includes("columnSql(inventoryColumns, 'ui', 'acquired_via', columnSql(inventoryColumns, 'ui', 'obtained_from', 'NULL'))") && shopRouteCode.includes("const itemTable = useShopItems ? 'shop_items' : 'character_items';") && shopRouteCode.includes('if (!inventoryColumns.has(\'user_id\') && !inventoryColumns.has(\'username\')) return res.json([]);'));
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
check('Lead workspace customer block renders canonical multi-child rows', leadsCode.includes('function renderWorkspaceCustomerChildren') && leadsCode.includes('function workspaceCustomerChildRows') && leadsCode.includes("source: 'customer.children'") && leadsCode.includes("source: 'lead.celebrants'") && leadsCode.includes('Діти / іменинники') && leadsCode.includes('data-child-source="${escapeHtml(resolved.source)}"') && leadsCode.includes('workspace-row workspace-child-row') && leadsPageCss.includes('.workspace-child-list') && leadsPageCss.includes('.workspace-child-row') && htmlContains('leads.html', 'body.dark-mode .workspace-row') && leadsPageCss.includes('.workspace-child-facts { grid-template-columns: 1fr; }'));
check('Lead workspace child renderer does not collapse to legacy childName only', leadsCode.indexOf("source: 'customer.children'") >= 0 && leadsCode.indexOf("source: 'customer.children'") < leadsCode.indexOf("source: 'customer.childName'") && !leadsCode.includes('<dt>Дитина</dt><dd>${workspaceText(customer.childName)}</dd>') && leadsCode.includes('<dt>Діти / іменинники</dt><dd>${renderWorkspaceCustomerChildren(customer, lead)}</dd>'));
check('Lead workspace child renderer shows child notes and formatted birthdays', leadsCode.includes('note: String(item.note || item.notes || \'\').trim()') && leadsCode.includes('const birthday = child.birthday ? workspaceDate(child.birthday) :') && leadsCode.includes('const note = child.note ||') && leadsCode.includes('workspace-child-note'));
check('Lead workspace notes render separated lead and customer rows', leadsCode.includes('function workspaceStripLeadAutoNoteBlock') && leadsCode.includes('function workspaceCustomerVisibleNotes') && leadsCode.includes('function workspaceNoteRows') && leadsCode.includes('function renderWorkspaceInteractionRow') && leadsCode.includes("add('lead.notes', 'Нотатки ліда', lead.notes)") && leadsCode.includes("add('customer.notes', 'Нотатки клієнта'") && leadsCode.includes('data-note-source="${escapeHtml(item.source)}"') && leadsPageCss.includes('.workspace-note-text') && leadsPageCss.includes('white-space: pre-wrap') && leadsPageCss.includes('.workspace-note-row') && leadsPageCss.includes('body.dark-mode .workspace-note-source'));
check('Lead manual conversion deep-link auto-opens booking with ensured customer context', leadsCode.includes('function ensureLeadCustomerForBooking') && leadsCode.includes("params.set('customerId', customer.id)") && leadsCode.includes("params.set('convert', 'booking')") && leadsCode.includes("params.set('eventDate', preferredEventDate)") && timelineCode.includes('function maybeAutoOpenLeadConversionBooking') && timelineCode.includes("customerId: (params.get('customerId')") && timelineCode.includes('openTimelineCreateBookingFromToolbar()') && timelineCode.includes("params.get('convert') === 'booking'"));
check('Lead deal drag opens customer card flow instead of booking prompt', leadsCode.includes('function offerDealCustomerCardFlow') && leadsCode.includes('function ensureDealCustomerCardForLead') && leadsCode.includes('data.customerLinkMode') && leadsCode.includes("leadCrmContextHref('/customers', { open: ensured.customer.id }") && leadsCode.includes("okText: 'Відкрити картку'") && !leadsCode.includes('function offerDealBookingFlow') && !leadsCode.includes('Створити бронювання на таймлайні зараз'));
check('Lead booking conversion modes have explicit URL handoff contract', leadsCode.includes('const LEAD_BOOKING_CONVERSION_MODES = Object.freeze({') && leadsCode.includes("activity: Object.freeze({ bookingMode: 'activity', timelineView: 'animators' })") && leadsCode.includes("kitchen_room: Object.freeze({ bookingMode: 'kitchen_room', timelineView: 'rooms' })") && leadsCode.includes("params.set('bookingMode', conversionMode.bookingMode)") && leadsCode.includes("params.set('timelineView', conversionMode.timelineView)") && leadsCode.includes('function convertLeadToBookingMode') && timelineCode.includes("return mode === 'activity' || mode === 'kitchen_room' ? mode : ''") && timelineCode.includes("bookingMode: normalizeLeadBookingMode(params.get('bookingMode'))") && fileText('js/booking.js').includes("url.searchParams.delete('bookingMode')"));
const bookingCodeForLeadConversion = fileText('js/booking.js');
check('Lead booking conversion mode drives timeline view and booking workspace toggles',
    timelineCode.includes('function leadConversionRequiredTimelineView')
    && timelineCode.includes("if (mode === 'activity') return TIMELINE_VIEW_ANIMATORS")
    && timelineCode.includes("if (mode === 'kitchen_room') return TIMELINE_VIEW_ROOMS")
    && timelineCode.includes("url.searchParams.set('timelineView', requiredView)")
    && timelineCode.includes('enforceLeadConversionTimelineViewFromUrl(AppState.leadConversionContext);')
    && timelineCode.includes('leadConversionTimelineViewReady(AppState.leadConversionContext)')
    && bookingCodeForLeadConversion.includes('function applyLeadConversionBookingModeToForm')
    && bookingCodeForLeadConversion.includes("if (mode === 'activity')")
    && bookingCodeForLeadConversion.includes('setBookingWorkspaceHasEvent(true, { markDirty: false })')
    && bookingCodeForLeadConversion.includes('setBookingKitchenEnabled(false, { markDirty: false })')
    && bookingCodeForLeadConversion.includes("if (mode === 'kitchen_room')")
    && bookingCodeForLeadConversion.includes('setBookingWorkspaceHasEvent(false, { markDirty: false })')
    && bookingCodeForLeadConversion.includes('setBookingKitchenEnabled(true, { markDirty: false })')
    && bookingCodeForLeadConversion.includes('applyLeadConversionBookingModeToForm();'));
const updateLeadStageBlock = sourceBlock(leadsCode, 'async function updateLeadStage', '// ==========================================\n// LEAD TYPE MENU');
const loadLeadsBlock = sourceBlock(leadsCode, 'async function loadLeads', 'async function loadLeadQueueStats');
const loadLeadQueueStatsBlock = sourceBlock(leadsCode, 'async function loadLeadQueueStats', 'function leadQueueMeta');
const leadCustomerFallbackSearchBlock = sourceBlock(leadsCode, 'async function loadLeadCustomerSearchFallback', 'function leadCustomerFallbackChildrenText');
const renderLeadCustomerFallbackBlock = sourceBlock(leadsCode, 'function renderLeadCustomerSearchFallback', 'function resetLeadFilters');
const prefillLeadFromCustomerFallbackBlock = sourceBlock(leadsCode, 'function prefillLeadModalFromCustomer', 'function openLeadFromCustomerFallback');
const openLeadFromCustomerFallbackBlock = sourceBlock(leadsCode, 'function openLeadFromCustomerFallback', 'function editLead');
const linkSavedLeadToFallbackCustomerBlock = sourceBlock(leadsCode, 'async function linkSavedLeadToFallbackCustomer', 'async function saveLead');
const saveLeadBlock = sourceBlock(leadsCode, 'async function saveLead', 'async function deleteLead');
const leadDomReadyBlock = sourceBlock(leadsCode, "document.addEventListener('DOMContentLoaded'", 'async function checkTestMode');
const leadCustomerSearchEndpointCount = (leadsCode.match(/\/api\/customers\/search/g) || []).length;
const legacyLeadPatchRouteBlock = sourceBlock(leadsRouteCode, "router.patch('/:id',", "// POST /api/leads/:id/collaboration-task");
check('Lead deal stage refreshes kanban even when customer card prompt is dismissed',
    updateLeadStageBlock.includes("const openedCustomerCard = stage === 'deal'")
    && updateLeadStageBlock.includes('if (!openedCustomerCard) {')
    && updateLeadStageBlock.includes('await loadLeads();')
    && updateLeadStageBlock.includes("if (workspaceLeadId === normalizedLeadId) openLeadWorkspace(normalizedLeadId, { pushState: false });")
    && !/if\s*\(openedCustomerCard\)\s*return\s+true/.test(updateLeadStageBlock)
    && updateLeadStageBlock.includes('notifyLeadStageMoveFailure(data);')
    && updateLeadStageBlock.includes('finally')
    && updateLeadStageBlock.includes('setLeadStageMovePending(normalizedLeadId, false);'));
check('Lead kanban stage moves expose pending state and retry-safe rollback',
    leadsCode.includes('const pendingLeadStageMoves = new Set()')
    && leadsCode.includes('function setLeadStageMovePending')
    && leadsCode.includes("el.classList.toggle('is-stage-pending', pending)")
    && leadsCode.includes("el.setAttribute('aria-busy', 'true')")
    && leadsCode.includes('function readLeadStageMovePayload')
    && leadsCode.includes('function leadStageMoveFailureMessage')
    && leadsCode.includes('function notifyLeadStageMoveWarnings')
    && leadsCode.includes("payload.code === 'lead_write_locked'")
    && leadsCode.includes('Спробуйте ще раз через кілька секунд')
    && updateLeadStageBlock.includes('if (isLeadStageMovePending(normalizedLeadId))')
    && updateLeadStageBlock.includes('setLeadStageMovePending(normalizedLeadId, true);')
    && updateLeadStageBlock.includes('notifyLeadStageMoveWarnings(data);')
    && updateLeadStageBlock.includes('notifyLeadStageMoveFailure(data);')
    && updateLeadStageBlock.includes('setLeadStageMovePending(normalizedLeadId, false);')
    && leadsCode.includes('if (!saved) renderKanban();'));
check('Lead kanban order warnings do not roll back successful stage moves',
    leadsRouteCode.includes("code: 'kanban_order_not_saved'")
    && leadsRouteCode.includes('retryable: true')
    && leadsRouteCode.includes('if (warnings.length) response.warnings = warnings;')
    && leadsCode.includes("hasLeadStageMoveWarning(payload, 'kanban_order_not_saved')")
    && leadsCode.includes('Етап збережено, порядок оновиться після перезавантаження.')
    && updateLeadStageBlock.includes('if (res.ok && data.success) {')
    && updateLeadStageBlock.indexOf('notifyLeadStageMoveWarnings(data);') < updateLeadStageBlock.indexOf('return true;'));
check('Lead kanban drag uses the dedicated stage endpoint',
    updateLeadStageBlock.includes("apiFetch(`/api/leads/${normalizedLeadId}/stage`")
    && !updateLeadStageBlock.includes("apiFetch(`/api/leads/${normalizedLeadId}`,"));
check('Lead kanban load ignores stale responses before rendering',
    leadsCode.includes('let leadLoadSeq = 0')
    && loadLeadsBlock.includes('const loadSeq = ++leadLoadSeq;')
    && loadLeadsBlock.includes('const statsPromise = loadLeadQueueStats();')
    && loadLeadsBlock.includes('fetchKanbanLeadPages(params)')
    && loadLeadsBlock.includes('fetchLeadPage(params, { limit: LEAD_TABLE_PAGE_SIZE, offset: 0 })')
    && loadLeadsBlock.includes('if (loadSeq !== leadLoadSeq) return;')
    && loadLeadsBlock.indexOf('if (loadSeq !== leadLoadSeq) return;') < loadLeadsBlock.indexOf('leadStatsData = stats;')
    && loadLeadsBlock.indexOf('if (loadSeq !== leadLoadSeq) return;') < loadLeadsBlock.indexOf('leadsData = leadsResult.leads;')
    && loadLeadsBlock.indexOf('if (loadSeq !== leadLoadSeq) return;') < loadLeadsBlock.indexOf('renderKanban();')
    && !loadLeadQueueStatsBlock.includes('leadStatsData ='));
check('Lead page only adds customer search to the empty lead fallback path',
    leadCustomerSearchEndpointCount === 2
    && leadsCode.includes("apiFetch(`/api/customers/search?q=")
    && leadsCode.includes('const LEAD_CUSTOMER_FALLBACK_LIMIT = 5')
    && leadsCode.includes('let leadCustomerSearchMatches = []')
    && leadsCode.includes("let leadCustomerSearchQuery = ''")
    && loadLeadsBlock.includes('leadsData.length === 0 && shouldLoadLeadCustomerFallback(search)')
    && loadLeadsBlock.includes('leadCustomerSearchQuery = search;')
    && loadLeadsBlock.indexOf('leadsData = leadsResult.leads;') < loadLeadsBlock.indexOf('leadCustomerSearchMatches = await loadLeadCustomerSearchFallback(search);')
    && /leadCustomerSearchMatches = await loadLeadCustomerSearchFallback\(search\);\s*if \(loadSeq !== leadLoadSeq\) return;/.test(loadLeadsBlock)
    && leadCustomerFallbackSearchBlock.includes("fetch(leadApiUrl(`/api/customers/search?${params}`)")
    && leadCustomerFallbackSearchBlock.includes('res.status === 401 || res.status === 403 || !res.ok')
    && !leadCustomerFallbackSearchBlock.includes('apiFetch'));
check('Lead empty search customer fallback exposes explicit customer actions',
    renderLeadCustomerFallbackBlock.includes('lead-customer-search-fallback')
    && renderLeadCustomerFallbackBlock.includes('Ліда не знайдено, але є клієнт')
    && renderLeadCustomerFallbackBlock.includes('Відкрити клієнта')
    && renderLeadCustomerFallbackBlock.includes('Створити лід')
    && renderLeadCustomerFallbackBlock.includes('без автозбереження')
    && renderLeadCustomerFallbackBlock.includes("leadCrmContextHref('/customers', { open: customer.id }")
    && renderLeadCustomerFallbackBlock.includes('data-lead-customer-create-lead')
    && renderLeadCustomerFallbackBlock.includes('data-lead-write-action="true"'));
check('Lead customer fallback create action only prefills the existing add-lead modal',
    leadsCode.includes("const createFromCustomer = e.target.closest('[data-lead-customer-create-lead]')")
    && openLeadFromCustomerFallbackBlock.includes('openAddModal();')
    && openLeadFromCustomerFallbackBlock.includes('prefillLeadModalFromCustomer(customer);')
    && !/apiFetch|fetch\s*\(|saveLead\s*\(/.test(openLeadFromCustomerFallbackBlock)
    && prefillLeadFromCustomerFallbackBlock.includes("document.getElementById('leadName')")
    && prefillLeadFromCustomerFallbackBlock.includes("document.getElementById('leadPhone')")
    && prefillLeadFromCustomerFallbackBlock.includes("document.getElementById('leadInstagram')")
    && prefillLeadFromCustomerFallbackBlock.includes("document.getElementById('leadNotes')")
    && prefillLeadFromCustomerFallbackBlock.includes('modal.dataset.sourceCustomerId = String(customer.id);')
    && prefillLeadFromCustomerFallbackBlock.includes('modalInitialState = getModalState();')
    && prefillLeadFromCustomerFallbackBlock.includes('UnsafeDismissGuard'));
check('Lead customer fallback links the saved lead only after explicit save',
    leadsRouteCode.includes("router.post('/:id/link-customer', requireRole('manager')")
    && leadsCode.includes('function leadModalSourceCustomerId')
    && openLeadFromCustomerFallbackBlock.includes('prefillLeadModalFromCustomer(customer);')
    && !/apiFetch|fetch\s*\(|saveLead\s*\(/.test(openLeadFromCustomerFallbackBlock)
    && linkSavedLeadToFallbackCustomerBlock.includes("apiFetch(`/api/leads/${normalizedLeadId}/link-customer`")
    && linkSavedLeadToFallbackCustomerBlock.includes("method: 'POST'")
    && linkSavedLeadToFallbackCustomerBlock.includes('customerId: normalizedCustomerId')
    && linkSavedLeadToFallbackCustomerBlock.includes('return null;')
    && saveLeadBlock.includes('const sourceCustomerId = editId ? null : leadModalSourceCustomerId();')
    && saveLeadBlock.includes('const savedLeadId = editId || data.lead?.id;')
    && saveLeadBlock.includes('if (!editId && sourceCustomerId && savedLeadId && responseCustomerId !== sourceCustomerId)')
    && saveLeadBlock.includes('await linkSavedLeadToFallbackCustomer(savedLeadId, sourceCustomerId);')
    && saveLeadBlock.indexOf('const data = await res.json();') < saveLeadBlock.indexOf('await linkSavedLeadToFallbackCustomer(savedLeadId, sourceCustomerId);')
    && saveLeadBlock.indexOf('await linkSavedLeadToFallbackCustomer(savedLeadId, sourceCustomerId);') < saveLeadBlock.indexOf('closeLeadModal(true);')
    && leadsCode.includes('delete modal.dataset.sourceCustomerId;'));
check('Lead create modal supports canonical stage selector and booking handoff deep link',
    htmlContains('leads.html', 'id="leadStageGroup"')
    && htmlContains('leads.html', 'id="leadTypeGroup"')
    && htmlContains('leads.html', 'id="leadStageHint"')
    && leadsCode.includes("const LEAD_CREATE_STAGE_PARAM = 'createStage'")
    && leadsCode.includes("if (params.get(LEAD_CREATE_ACTION_PARAM) !== 'create') return null;")
    && leadsCode.includes("const createStage = fromBooking ? 'deal'")
    && leadsCode.includes('lockStage: fromBooking')
    && leadsCode.includes('sourceCustomerId: readLeadCreateCustomerId(params)')
    && leadsCode.includes('handoffRequest: leadCreateHandoffRequestFromUrl(params)')
    && leadsCode.includes('async function loadLeadCreateCustomer(customerId)')
    && leadsCode.includes('sourceCustomer = await loadLeadCreateCustomer(options.sourceCustomerId)')
    && leadsCode.includes('prefillLeadModalFromCustomer(sourceCustomer, { includeFallbackNote: false });')
    && leadDomReadyBlock.indexOf('await loadUsers();') < leadDomReadyBlock.indexOf('await maybeOpenLeadCreateFromUrl();')
    && leadDomReadyBlock.indexOf('await maybeOpenLeadCreateFromUrl();') < leadDomReadyBlock.indexOf('await loadLeads();')
    && leadsCode.includes('configureLeadStageControls({')
    && leadsCode.includes("if (typeGroup) typeGroup.style.display = editing ? '' : 'none';")
    && leadsCode.includes('prepareCreateStagePayload')
    && saveLeadBlock.includes('Object.assign(body, stagePayload);')
    && saveLeadBlock.includes('body.customerId = sourceCustomerId')
    && saveLeadBlock.includes('responseCustomerId !== sourceCustomerId')
    && leadsRouteCode.includes('requestedCreateCustomerId')
    && leadsRouteCode.includes("source: 'leads.post_requested_customer'")
    && leadsCode.includes("handoffApi.sendCreated(request, 'lead.created', payload)")
    && leadsCode.includes('completeLeadCreateHandoff(savedLeadId')
    && leadsCode.includes('url.searchParams.delete(key)')
    && !leadsCode.includes("params.get('pipeline_stage') || params.get('createStage')"));
check('Lead customer stages auto-create or link a SQL customer card',
    leadsRouteCode.includes('const CUSTOMER_CARD_PIPELINE_STAGES = new Set')
    && leadsRouteCode.includes("'deposit_received'")
    && legacyLeadPatchRouteBlock.includes("const shouldEnsureCustomerCard = CUSTOMER_CARD_PIPELINE_STAGES.has(effectivePipelineStage)")
    && legacyLeadPatchRouteBlock.includes("dealCustomerLink = await runPostCommitLeadStep('customer sync'")
    && legacyLeadPatchRouteBlock.includes('ensureDealCustomerForLead(client, updatedLead, businessContext')
    && leadsRouteCode.includes('INSERT INTO customers (business_context, name, phone, instagram, child_name, source, notes, lead_id, social_identities)')
    && leadsRouteCode.includes('buildLeadCustomerNotes(lead)')
    && leadsRouteCode.includes('appendUniqueLeadCustomerNote')
    && leadsRouteCode.includes('withLeadPatchGuardedTransaction')
    && leadsRouteCode.includes("SET LOCAL idle_in_transaction_session_timeout = '5000ms'")
    && legacyLeadPatchRouteBlock.indexOf("if (updateClient) await updateClient.query('COMMIT');") < legacyLeadPatchRouteBlock.indexOf("dealCustomerLink = await runPostCommitLeadStep('customer sync'"));
check('Lead PATCH exposes retryable write-lock taxonomy for Kanban',
    leadsRouteCode.includes('function mapLeadPatchError')
    && leadsRouteCode.includes("new Set(['55P03', '40P01', '57014'])")
    && leadsRouteCode.includes("code: 'lead_write_locked'")
    && leadsRouteCode.includes('retryable: true')
    && leadsRouteCode.includes("status: 409")
    && leadsRouteCode.includes("requestIdFromHttp")
    && leadsRouteCode.includes("PATCH /leads/:id retryable write conflict")
    && leadsRouteCode.includes("mappedError.payload.requestId"));
check('Lead dedicated stage endpoint keeps the critical transaction narrow',
    leadsRouteCode.includes("router.patch('/:id/stage'")
    && leadsRouteCode.includes('updated_at = NOW()')
    && leadsRouteCode.includes("source: 'leads.stage_patch'")
    && leadsRouteCode.includes("PATCH /leads/:id/stage retryable write conflict")
    && leadsRouteCode.indexOf("router.patch('/:id/stage'") < leadsRouteCode.indexOf("router.patch('/:id',"));
check('Lead kanban stage moves use optimistic locking',
    htmlContains('db/migrations/275_leads_updated_at_trigger.sql', 'CREATE TRIGGER trg_leads_updated_at')
    && leadsRouteCode.includes("code: 'lead_version_conflict'")
    && leadsRouteCode.includes("code: 'lead_version_required'")
    && leadsRouteCode.includes('leadPatchVersionFromBody')
    && leadsRouteCode.includes('leadVersionMatches(previousLead.updated_at, clientUpdatedAt)')
    && leadsRouteCode.includes('currentLead: leadConflictSnapshot(err.currentLead)')
    && leadsCode.includes('data-updated-at="${escapeHtml(updatedAt)}"')
    && leadsCode.includes('function leadUpdatedAtForStageMove')
    && leadsCode.includes("payload.code === 'lead_version_conflict'")
    && leadsCode.includes('Лід уже змінили в іншому місці. Оновлюю дошку.')
    && leadsCode.includes('updated_at: draggingCard?.dataset.updatedAt || leadUpdatedAtForStageMove(leadId)')
    && leadsCode.includes('await loadLeads();'));
check('Lead/customer journey uses durable many-to-one link history', htmlContains('db/migrations/262_leads_customer_links_and_value.sql', 'CREATE TABLE IF NOT EXISTS lead_customer_links') && leadsRouteCode.includes('function linkLeadCustomer') && leadsRouteCode.includes('INSERT INTO lead_customer_links (business_context, lead_id, customer_id, link_type, source, metadata, created_by, updated_at)') && leadsRouteCode.includes('FROM lead_customer_links lcl') && leadsRouteCode.includes("linkType: 'deal_customer'") && leadsRouteCode.includes("linkType: 'operator_link'") && htmlContains('routes/customers.js', 'customer.leadLinks'));
check('Lead desired date guest counts use normalized event preference storage', htmlContains('db/migrations/281_lead_event_preferences.sql', 'CREATE TABLE IF NOT EXISTS lead_event_preferences') && htmlContains('db/migrations/281_lead_event_preferences.sql', 'idx_lead_event_preferences_unique_lead') && leadsRouteCode.includes('function saveLeadEventPreference') && leadsRouteCode.includes('INSERT INTO lead_event_preferences') && leadsRouteCode.includes('eventPreference') && leadsCode.includes('function leadEventPreferenceFromLead') && leadsCode.includes('eventPreference: isMaysternyaLeadContext()') && !leadsCode.includes('function notesWithLeadGuestSummary'));
check('Lead conversion preferred date uses event preference before legacy lead date', leadsCode.includes('function leadConversionPreferredDate') && leadsCode.indexOf('function leadConversionPreferredDate') > leadsCode.indexOf('function leadEventPreferenceFromLead') && leadsCode.includes('const preference = leadEventPreferenceFromLead(lead)') && leadsCode.includes('preference.preferredDate') && leadsCode.includes('lead.event_date') && leadsCode.includes('lead.eventDate') && leadsCode.includes('const preferredEventDate = leadConversionPreferredDate(conversionLead)') && leadsCode.includes("params.set('date', preferredEventDate)") && leadsCode.includes("params.set('eventDate', preferredEventDate)") && !leadsCode.includes('const rawEventDate = leadRecordText(conversionLead'));
check('Lead stage changes are written to lead_interactions atomically', leadsRouteCode.includes('function logStageChange(queryable') && leadsRouteCode.includes("INSERT INTO lead_interactions (lead_id, user_id, type, summary, details, created_at)") && leadsRouteCode.includes("'status_change'") && leadsRouteCode.includes("source: 'leads.patch'") && !leadsRouteCode.includes('created_by, created_at') && !leadsRouteCode.includes("logStageChange(updatedLead.id"));
check('Lead list pagination is bounded per table or Kanban stage without a full-dataset loop', leadsCode.includes('const LEAD_TABLE_PAGE_SIZE = 100') && leadsCode.includes('const LEAD_KANBAN_PAGE_SIZE = 100') && leadsCode.includes('function fetchLeadPage') && leadsCode.includes('function fetchKanbanLeadPages') && leadsCode.includes('function loadMoreLeads') && leadsCode.includes('data-lead-load-more') && !leadsCode.includes('function fetchAllLeadPages') && !/while\s*\([^)]*50/.test(leadsCode) && leadsRouteCode.includes('const LEADS_MAX_LIMIT = 500') && leadsRouteCode.includes('pagination:') && !leadsCode.includes("params.set('limit', '200')") && !leadsRouteCode.includes('Math.min(parseInt(lim) || 50, 200)'));
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
check('Lead kanban conversion menu starts typed booking drafts without card drag/click conflicts', leadsCode.includes('const LEAD_BOOKING_CONVERSION_MENU_ITEMS = Object.freeze([') && leadsCode.includes("mode: 'activity'") && leadsCode.includes("mode: 'kitchen_room'") && leadsCode.includes('function renderLeadBookingConversionButton') && leadsCode.includes('data-lead-booking-convert') && leadsCode.includes('renderLeadBookingConversionButton(l)') && leadsCode.includes('function bindKanbanBookingConversionMenuEvents') && leadsCode.includes('bindKanbanBookingConversionMenuEvents();') && leadsCode.includes('bindKanbanBookingConversionTriggerControls(kanbanWrap)') && leadsCode.includes('data-lead-booking-conversion-option="true"') && leadsCode.includes('function updateLeadBookingConversionFromKanban') && leadsCode.includes('convertLeadToBookingMode(leadId, bookingMode)') && leadsCode.includes("if (control.matches?.('[data-lead-booking-convert]')) return;") && leadsCode.includes("closestLeadTypeElement(target, [") && leadsCode.includes("'.lead-booking-conversion-popover'") && leadsPageCss.includes('.kanban-card-actions .kanban-booking-convert-btn') && leadsPageCss.includes('.lead-booking-conversion-popover') && leadsPageCss.includes('.lead-booking-conversion-item'));
check('Lead kanban drag persists vertical card order', leadsCode.includes("order: 'kanban'") && leadsCode.includes('kanbanDragState') && leadsCode.includes('function getKanbanDragAfterElement') && leadsCode.includes('col.insertBefore(draggingCard, afterElement)') && leadsCode.includes('col.appendChild(draggingCard)') && leadsCode.includes('function getKanbanOrderedLeadIds') && leadsCode.includes('kanban_order: orderedLeadIds') && leadsRouteCode.includes('kanban_position') && leadsRouteCode.includes('function persistLeadKanbanOrder') && leadsRouteCode.includes('l.kanban_position ASC NULLS LAST') && htmlContains('db/migrations/260_leads_kanban_position.sql', 'ADD COLUMN IF NOT EXISTS kanban_position'));
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
const taskPaginationCode = fs.readFileSync(path.join(ROOT, 'services/taskPagination.js'), 'utf8');
const centerCode = fs.readFileSync(path.join(ROOT, 'js/center-page.js'), 'utf8');
const omniHtml = fs.readFileSync(path.join(ROOT, 'omni.html'), 'utf8');
const pagesCss = cssTextWithImports('css/pages.css');
check('Customers page supports canonical create deep link handoff without broadening manage actions',
    customersCode.includes("const CUSTOMER_CREATE_ACTION_PARAM = 'action'")
    && customersCode.includes("const CUSTOMER_CREATE_HANDOFF_PARAM = 'handoff'")
    && customersCode.includes("'reception'")
    && customersCode.includes('function canCreateCustomer')
    && customersCode.includes('function canManageCustomerActions')
    && customersCode.includes('const canCreate = canCreateCustomer(user);')
    && customersCode.includes("document.getElementById('addCustomerBtn').style.display = canCreate ? '' : 'none';")
    && customersCode.includes("document.getElementById('exportCsvBtn').style.display = canManage && canExportCustomerData(true) ? '' : 'none';")
    && customersCode.includes("document.getElementById('importVcfBtn').style.display = canManage ? '' : 'none';")
    && customersCode.includes('function maybeOpenCustomerCreateFromUrl')
    && customersCode.includes('openEditModal(null, options);')
    && customersCode.includes('if (!maybeOpenCustomerCreateFromUrl()) openCustomerDeepLink();')
    && customersCode.indexOf('await refreshData();') < customersCode.indexOf('if (!maybeOpenCustomerCreateFromUrl()) openCustomerDeepLink();')
    && customersCode.includes("handoffApi.sendCreated(request, 'customer.created', { customerId: normalizedCustomerId })")
    && customersCode.includes('completeCustomerCreateHandoff(result.id)')
    && customersCode.includes('activeCustomerCreateHandoffRequest = null')
    && !customersCode.includes("params.get('pipeline_stage') || params.get('createStage')"));
check('Reception create permission does not expose customer edit delete import or export UI',
    customersCode.includes('CUSTOMER_MANAGE_ROLES = Object.freeze')
    && customersCode.includes('CUSTOMER_CREATE_ROLES = Object.freeze')
    && customersCode.includes('if (isEditing && !canManageCustomerActions())')
    && customersCode.includes('window.editCustomer = async function(id)')
    && customersCode.includes('if (!canManageCustomerActions())')
    && customersCode.includes('${canManageCustomerActions() ? `<button type="button" class="btn-page-secondary entity-card-action" onclick="editCustomer(${customer.id})"')
    && customersCode.includes("document.getElementById('exportVcfBtn').style.display = canManage && canExportCustomerData() ? '' : 'none';"));
check('Customers financial export UI requires explicit revenue and export capabilities',
    customersCode.includes('function canViewCustomerRevenue()')
    && customersCode.includes("return typeof canAccess === 'function' && canAccess('view_revenue');")
    && customersCode.includes('function canExportCustomerData(includeRevenue = false)')
    && customersCode.includes("if (typeof canAccess !== 'function' || !canAccess('export_data')) return false;")
    && customersCode.includes('return !includeRevenue || canViewCustomerRevenue();')
    && customersCode.includes("document.getElementById('exportCsvBtn').style.display = canManage && canExportCustomerData(true) ? '' : 'none';")
    && customersCode.includes("document.getElementById('exportVcfBtn').style.display = canManage && canExportCustomerData() ? '' : 'none';")
    && customersCode.includes('if (!guardCustomerExport(true)) return;'));
check('Customers page opens existing customer deep links', customersCode.includes('getCustomerDeepLinkId') && customersCode.includes("params.get('open')") && customersCode.includes("params.get('highlight')"));
check('Customers ignore stale list responses before changing CRM state', customersCode.includes('let customersRequestController = null') && customersCode.includes('let customersRequestSeq = 0') && customersCode.includes('customersRequestController?.abort();') && customersCode.includes('signal: customersRequestController?.signal') && customersCode.includes('if (requestSeq !== customersRequestSeq) return false;') && customersCode.includes("err?.name === 'AbortError'"));
check('Center defers section data and upgrades section headers to accessible buttons', centerCode.includes('const centerSectionState = new Map()') && centerCode.includes('await loadInitiallyVisibleCenterSections();') && centerCode.includes("const defaultOpen = ['kpiSection'];") && !centerCode.includes('await Promise.all([\n        loadOverview(),') && centerCode.includes('function loadInitiallyVisibleCenterSections') && centerCode.includes('function isInitiallyVisibleCenterSection') && centerCode.includes('function loadCenterSection') && centerCode.includes('function centerSectionRetry') && centerCode.includes('function clearCenterSectionRetry') && centerCode.includes('function enhanceCenterSectionHeaders') && centerCode.includes("toggle.setAttribute('aria-controls'") && centerCode.includes("toggle.setAttribute('aria-expanded'") && htmlContains('center.html', '.center-section-toggle') && htmlContains('center.html', '.center-section-toggle:focus-visible'));
check('Profile shell loads tab dependencies lazily', profileCode.includes('async function ensureProfileTabData') && profileCode.includes("profileData = syncOwnProfileAvatarSession(await apiGet(") && !profileCode.includes("apiGet('/wallet'),\n        isOwnProfile ? apiGet('/inventory')") && profileCode.includes('await ensureProfileTabData(activeTab);') && profileCode.includes('if (!locked) await ensureProfileTabData(tab);'));
check('Reports use scoped SQL aggregation for filters instead of a 500-row client scan', reportsPageCode.includes("'/api/reports/submitters'") && !reportsPageCode.includes("'/api/reports?limit=500'") && reportsRouteCode.includes("router.get('/submitters'") && reportsRouteCode.includes('SELECT DISTINCT NULLIF(BTRIM(r.submitted_by)') && reportsRouteCode.includes('jsonb_array_elements_text') && reportsRouteCode.includes('GROUP BY tag.value') && !reportsRouteCode.includes('const stats = {};'));
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
check('Tasks page uses the opt-in paginated list contract with stale guards and retry/load-more states', tasksCode.includes('function apiGetTasksPage') && tasksCode.includes("pagination: '1'") && tasksCode.includes('let taskLoadSeq = 0') && tasksCode.includes('if (loadSeq !== taskLoadSeq) return;') && tasksCode.includes('function renderTaskPagination') && tasksCode.includes('data-task-load-more') && tasksCode.includes('data-task-retry') && tasksRouteCode.includes('const paginatedResponse = isTruthy(pagination || paginated);') && tasksRouteCode.includes('if (!paginatedResponse) return res.json(tasks);') && tasksRouteCode.includes("require('../services/taskPagination')") && taskPaginationCode.includes('function buildTaskPaginationMetadata') && tasksRouteCode.includes('pagination: buildTaskPaginationMetadata'));
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
    && apiCode.includes('requestId: errBody.requestId || errBody.request_id || null')
    && apiCode.includes('const requestId = body.requestId || body.request_id || null')
    && apiCode.includes('requestId,')
    && apiCode.includes('function apiAuthFailure(response = null)')
    && apiCode.includes('function apiOfflineFailure(err, fallback ='));
check('Next critical frontend mutations use normalized API error result contract',
    apiCode.includes('function normalizeApiErrorResult')
    && /async function apiSaveTimelineResource[\s\S]*normalizeApiErrorResult\(\{ \.\.\.body, status: response\.status \}/.test(apiCode)
    && /async function apiUpdateTimelineResource[\s\S]*normalizeApiErrorResult\(\{ \.\.\.body, status: response\.status \}/.test(apiCode)
    && /async function apiCreateProduct[\s\S]*normalizeApiErrorResult\(\{ \.\.\.body, status: response\.status \}/.test(apiCode)
    && /async function apiUpdateProductTechCard[\s\S]*normalizeApiErrorResult\(\{ \.\.\.body, status: response\.status \}/.test(apiCode)
    && profileCode.includes("return normalizeApiErrorResult(e, 'Помилка запиту')")
    && profileCode.includes("return normalizeApiErrorResult({ ...payload, status: r.status }, 'Помилка запиту')")
    && dashboardPageCode.includes('function normalizeDashboardApiResult')
    && dashboardPageCode.includes('async function dashboardMutationJson')
    && dashboardPageCode.includes("notifyDashboardIssue(result?.error || 'Не вдалося зберегти налаштування dashboard')")
    && centerCode.includes('function centerApiFailure')
    && centerCode.includes('async function centerMutationJson')
    && /async function apiSaveGoals[\s\S]*centerMutationJson\(r, 'Не вдалося зберегти цілі'\)/.test(centerCode)
    && /async function apiCreateDiscount[\s\S]*centerMutationJson\(response, 'Не вдалося створити промокод'\)/.test(centerCode)
    && /async function apiDeleteProposal[\s\S]*centerApiFailure\(err, 'Не вдалося видалити пропозицію'\)/.test(centerCode));
check('Critical booking mutations use normalized failure contract and user-visible guards',
    /async function apiCreateBooking[\s\S]*apiAuthFailure\(response\)[\s\S]*apiFailureFromBody\(body, response\)[\s\S]*apiOfflineFailure\(err, 'Не вдалося створити бронювання/.test(apiCode)
    && /async function apiCreateBookingFull[\s\S]*apiAuthFailure\(response\)[\s\S]*apiFailureFromBody\(body, response\)[\s\S]*apiOfflineFailure\(err, 'Не вдалося створити бронювання з повʼязаними подіями/.test(apiCode)
    && /async function apiDeleteBooking[\s\S]*apiAuthFailure\(response\)[\s\S]*apiFailureFromBody\(body, response\)[\s\S]*apiOfflineFailure\(err, 'Не вдалося видалити бронювання/.test(apiCode)
    && /async function apiUpdateBooking[\s\S]*apiAuthFailure\(response\)[\s\S]*apiFailureFromBody\(body, response, 'Конфлікт даних'\)[\s\S]*apiFailureFromBody\(body, response\)[\s\S]*apiOfflineFailure\(err, 'Не вдалося оновити бронювання/.test(apiCode)
    && bookingMutationCode.includes('if (!updateResult || updateResult.success === false)')
    && bookingMutationCode.includes('const result = await apiDeleteBooking(id);')
    && bookingMutationCode.includes('if (!result || result.success === false)')
    && bookingMutationCode.includes('const failures = []')
    && bookingMutationCode.includes('Скасовано ${successCount}/${ids.length}. ${failures[0]}'));
check('Explainability shared styles exist', pagesCss.includes('.explain-filter-summary') && pagesCss.includes('.explain-empty') && pagesCss.includes('.explain-clear-btn'));
check('Timeline responsive density updates JS cell geometry with viewport', uiCode.includes('function applyTimelineResponsiveDensity') && uiCode.includes('_timelineResponsiveCellWidth') && uiCode.includes('--timeline-cell-w') && htmlContains('js/app.js', 'initTimelineResponsiveResize'));
check('Timeline Android density reads lexical CONFIG and visual viewport', uiCode.includes("typeof CONFIG === 'undefined'") && !uiCode.includes('if (!window.CONFIG || !CONFIG.TIMELINE)') && uiCode.includes('let lastViewportSignature =') && uiCode.includes('if (viewportSignature === lastViewportSignature) return') && uiCode.includes('window.visualViewport?.addEventListener?.(\'resize\'') && uiCode.includes('window.visualViewport?.addEventListener?.(\'scroll\''));
check('Timeline iOS and iPad viewport hardening is explicit', uiCode.includes('function syncTimelineViewportMetrics') && uiCode.includes('--eg-viewport-height') && uiCode.includes('--eg-viewport-width') && uiCode.includes('timeline-dashboard-root') && htmlContains('css/timeline.css', 'var(--eg-viewport-height') && responsiveCss.includes('v0.63.5: iPad/tablet timeline shell') && responsiveCss.includes('html.timeline-dashboard-root') && responsiveCss.includes('body.timeline-dashboard-page.shell-ready .sidebar-nav:not(.collapsed) ~ .header'));
check('Timeline 15-minute zoom keeps readable desktop geometry after header filter changes',
    timelineCompactBaseWidths[0] >= 38
    && timelineRegularBaseWidths[0] >= 50
    && timelineReadableMinimums[0] >= timelineCompactBaseWidths[0]
    && timelineCompactLineHeights[0] >= 44
    && /if\s*\(\s*level\s*===\s*15\s*&&\s*viewportWidth\s*>\s*768\s*\)\s*return\s+base/.test(timelineResponsiveCellWidthBlock)
    && timelineResponsiveCellWidthBlock.indexOf('if (level === 15 && viewportWidth > 768) return base') < timelineResponsiveCellWidthBlock.indexOf('if (viewportWidth <= 1180)'));
check('Timeline normal mode ignores legacy compact preference', uiCode.includes('function _timelineFitCellWidth') && uiCode.includes('phones must scroll horizontally instead of crushing readable time cells') && uiCode.includes("container.dataset.fitScreen = compact && viewportWidth > 768 ? 'true' : 'scroll'") && uiCode.includes('const compact = false') && uiCode.includes('AppState.compactMode = false') && uiCode.includes('localStorage.removeItem(key)') && htmlContains('js/app.js', "localStorage.removeItem(timelineStorageKey('compact_mode'))") && htmlContains('js/app.js', 'AppState.compactMode = false') && !htmlContains('js/app.js', "localStorage.getItem(timelineStorageKey('compact_mode')) === 'true'") && !htmlContains('index.html', 'id="compactModeToggle"') && !htmlContains('index.html', 'class="timeline-compact-toggle') && !responsiveCss.includes('body.timeline-dashboard-page .timeline-header-filters .timeline-compact-toggle'));
check('Timeline phone layout has tidy toolbar rows and readable day/week scroll grids', responsiveCss.includes('v0.69.20: phone timeline toolbar and readable horizontal grid') && responsiveCss.includes('"prev date next"') && responsiveCss.includes('"today day day"') && responsiveCss.includes('.timeline-container[data-fit-screen="scroll"] .timeline-scroll') && responsiveCss.includes('width: max-content !important') && responsiveCss.includes('body.timeline-dashboard-page .multi-day-container') && responsiveCss.includes('body.timeline-dashboard-page .mini-line-grid') && responsiveCss.includes('--mini-grid-width'));
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
    && timelineConstructorCss.includes('body.timeline-dashboard-page.timeline-view-rooms.timeline-view-panel-open .timeline-container')
    && timelineConstructorCss.includes('body.timeline-dashboard-page.timeline-view-rooms.timeline-view-panel-open .timeline-scroll')
    && timelineConstructorCss.includes('overflow-x: scroll;')
    && timelineConstructorCss.includes('overflow-y: scroll;')
    && responsiveCss.includes('body.timeline-dashboard-page.timeline-view-animators .timeline-container[data-timeline-height-ready="true"]')
    && responsiveCss.includes('clamp(360px, var(--timeline-content-height), var(--timeline-shell-max-height)) !important')
    && responsiveCss.includes('v0.73.80: iPhone 11/Safari needs a definite container height')
    && responsiveCss.includes('height: clamp(360px, calc(var(--eg-viewport-height, 100dvh) - 250px), 58dvh) !important;'));
check('Timeline default zoom is 15 minutes when no valid saved preference exists', timelineConfigCode.includes('const TIMELINE_DEFAULT_ZOOM_MINUTES = 15') && timelineConfigCode.includes('CELL_MINUTES: TIMELINE_DEFAULT_ZOOM_MINUTES') && timelineConfigCode.includes('zoomLevel: TIMELINE_DEFAULT_ZOOM_MINUTES') && appCode.includes("const zoomKey = timelineStorageKey('zoom_level')") && appCode.includes('AppState.zoomLevel = normalizeTimelineZoomLevel(savedZoom)') && appCode.includes('localStorage.removeItem(zoomKey)') && uiCode.includes('normalizeTimelineZoomLevel(AppState.zoomLevel || CONFIG.TIMELINE.CELL_MINUTES)'));
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
const bookingPackageRendererCode = fs.readFileSync(path.join(ROOT, 'js', 'booking-package-renderer.js'), 'utf8');
const bookingBanquetDetailCode = fs.readFileSync(path.join(ROOT, 'js', 'booking-banquet-detail.js'), 'utf8');
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
const renderBookingPackageMenuRowsBlock = sourceBlock(bookingPackageRendererCode, 'function renderBookingPackageMenuRows', 'function normalizeBookingPackageEntertainmentRows');
const renderBookingPackageEntertainmentRowsBlock = sourceBlock(bookingPackageRendererCode, 'function renderBookingPackageEntertainmentRows', 'function formatBookingEntryQuantityLabel');
const renderBookingPackageDetailBlock = sourceBlock(bookingPackageRendererCode, 'function renderBookingPackageDetail', 'const api = {');
const renderBanquetMenuSectionBlock = sourceBlock(bookingBanquetDetailCode, 'function renderBanquetMenuSection', 'function renderBanquetServiceSection');
const banquetMenuMoneyRule = cssRuleText(timelineConstructorCss, '.booking-banquet-section--menu .booking-detail-package-money');
const mobileBanquetMenuMoneyRule = cssRuleIncludingSelectorText(
    cssAtRuleBlock(timelineConstructorCss, '@media (max-width: 640px)'),
    '.booking-banquet-section--menu .booking-detail-package-money'
);
const bookingInviteParamsBlock = sourceBlock(bookingCode, "const inviteModel = bookingDetailSafeRender('invite-model'", 'const invitePayload = inviteModel.payload');
const bookingInviteSectionBlock = sourceBlock(bookingCode, 'const inviteSectionHtml = roomFirstServiceBooking', 'const summaryPreviewHref');
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
const menuPhotoServiceCode = fs.readFileSync(path.join(ROOT, 'services/menuPhotoGeneration.js'), 'utf8');
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
const accountAccessEditorCode = fs.readFileSync(path.join(ROOT, 'js/account-access-editor.js'), 'utf8');
const hrPulseSwitcherCode = fs.readFileSync(path.join(ROOT, 'js/hr-pulse-switcher.js'), 'utf8');
const hrRouteCode = fs.readFileSync(path.join(ROOT, 'routes', 'hr.js'), 'utf8');
const authCss = fs.readFileSync(path.join(ROOT, 'css/auth.css'), 'utf8');
const hrPageCss = fs.readFileSync(path.join(ROOT, 'css/hr-page.css'), 'utf8');
const hrFoundationCss = fs.readFileSync(path.join(ROOT, 'css/pages-hr-foundation.css'), 'utf8');
const inviteHtmlForUiPolish = fs.readFileSync(path.join(ROOT, 'invite.html'), 'utf8');
const inviteHtmlForUiPolishNormalized = inviteHtmlForUiPolish.replace(/\r\n/g, '\n');
const staffCssForUiPolish = cssTextWithImports('css/pages.css');
const hrPayrollPeriodServiceCode = fs.readFileSync(path.join(ROOT, 'services', 'hrPayrollPeriod.js'), 'utf8');
const staffRouteCode = fs.readFileSync(path.join(ROOT, 'routes', 'staff.js'), 'utf8');
const hrAttendanceServiceCode = fs.readFileSync(path.join(ROOT, 'services', 'hrAttendance.js'), 'utf8');
const hrHtmlForContracts = hrSurfaceText();
function topLevelLexicalNames(source) {
    return [...source.matchAll(/^(?:const|let|class)\s+([A-Za-z_$][\w$]*)/gm)].map(match => match[1]);
}
function topLevelFunctionNames(source) {
    return [...source.matchAll(/^function\s+([A-Za-z_$][\w$]*)/gm)].map(match => match[1]);
}
const staffScheduleScoped = staffCode.includes('(function () {')
    && staffCode.trimEnd().endsWith('})();')
    && staffCode.includes('window.StaffSchedulePage =');
const hrStaffScheduleLexicalOverlap = topLevelLexicalNames(staffCode)
    .filter(name => new Set(topLevelLexicalNames(hrCode)).has(name))
    .sort();
const hrStaffScheduleFunctionOverlap = topLevelFunctionNames(staffCode)
    .filter(name => new Set(topLevelFunctionNames(hrCode)).has(name))
    .sort();
check('HR and staff schedule scripts have no shared top-level lexical names', hrStaffScheduleLexicalOverlap.length === 0);
check('Staff schedule script is scoped when embedded into HR', staffScheduleScoped);
check('HR and staff schedule function-name overlaps are isolated', staffScheduleScoped || hrStaffScheduleFunctionOverlap.length === 0);
const hrImplicitButtons = [...`${hrHtmlForContracts}\n${hrCode}`.matchAll(/<button\b[^>]*>/g)]
    .filter(match => !/\btype\s*=/.test(match[0]));
const contentCode = fs.readFileSync(path.join(ROOT, 'js/content-page.js'), 'utf8');
const securityMiddlewareCode = fs.readFileSync(path.join(ROOT, 'middleware/security.js'), 'utf8');
const checkinHtml = fileText('checkin.html');
const panelCss = fs.readFileSync(path.join(ROOT, 'css/panel.css'), 'utf8');
const bookingFormJs = fs.readFileSync(path.join(ROOT, 'js/booking-form.js'), 'utf8');
check('Security CSP allowlists the bundled Microsoft Clarity snippet without opening broad script origins', securityMiddlewareCode.includes("script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://www.clarity.ms https://scripts.clarity.ms") && securityMiddlewareCode.includes("https://*.clarity.ms https://c.bing.com") && !securityMiddlewareCode.includes('script-src *'));
check('Check-in model download is permitted by CSP and initialization errors are recoverable without attendance writes',
    securityMiddlewareCode.includes("connect-src 'self' ws: wss: https://*.up.railway.app https://cdn.jsdelivr.net")
    && checkinHtml.includes('const MODEL_LOAD_TIMEOUT_MS = 30000;')
    && checkinHtml.includes('function withTimeout(')
    && checkinHtml.includes('function showInitializationError(')
    && checkinHtml.includes('id="retryCheckinInitBtn"')
    && checkinHtml.includes('window.retryCheckinInitialization = initializeCheckin;')
    && checkinHtml.includes('await loadModels();')
    && checkinHtml.includes("setStatus('Потрібен доступ до камери")
    && checkinHtml.includes('.status.camera')
    && checkinHtml.includes("showInitializationError(err, 'model');")
    && !checkinHtml.slice(checkinHtml.indexOf('async function initializeCheckin()'), checkinHtml.indexOf('window.retryCheckinInitialization')).includes('performCheckin('));
check('Booking lead conversion cleanup removes auto-open query hints', bookingCode.includes("url.searchParams.delete('leadId')") && bookingCode.includes("url.searchParams.delete('convert')") && bookingCode.includes("url.searchParams.delete('eventDate')") && bookingCode.includes("url.searchParams.delete('bookingMode')") && bookingCode.includes("url.searchParams.delete('customerId')") && bookingCode.includes("url.searchParams.delete('customerName')") && bookingCode.includes("url.searchParams.delete('topic')") && bookingCode.includes("url.searchParams.delete('message')") && bookingCode.includes("url.searchParams.delete('page')"));
check('Booking room dropdown keeps same-day booked rooms selectable with day booking suffix',
    bookingCode.includes('function collectRoomDayBookingsForBookingDay')
    && bookingCode.includes('function renderBookingRoomOptionsForDay')
    && bookingCode.includes('function roomDayBookingSuffix')
    && bookingCode.includes('dayBookingsByRoom')
    && bookingCode.includes('Кімнати з підписом уже мають бронювання цього дня')
    && bookingCode.includes('function refreshBookingRoomAvailabilityForSelectedDate')
    && bookingCode.includes('await refreshBookingRoomAvailabilityForSelectedDate();')
    && bookingCode.includes("selectedRoom: booking.room || '',")
    && bookingCode.includes("selectedResourceId: booking.roomResourceId || booking.room_resource_id || '',")
    && bookingCode.includes('excludeId: bookingId')
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
    && bookingCode.includes("source: candidate ? 'booking_banquet_group_selector' : (explicitContext?.source || virtualState?.bridge || (roomContext ? 'room_selection_auto_banquet_context' : 'booking_banquet_group_selector'))")
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
    && bookingCode.includes('function resolveBookingChildrenCountSource')
    && bookingCode.includes('function getBookingChildrenCountInputValue')
    && bookingCode.includes('function getKitchenChildrenCountInputValue')
    && bookingCode.includes('function shouldShowStandaloneKidsCountInput')
    && bookingCode.includes('function bookingKitchenChildrenCountFromBooking')
    && bookingCode.includes("String(autoAppliedValues.banquetGuests ?? '') === String(kitchenValue)")
    && bookingCode.includes("resolved.source === 'lead'")
    && bookingCode.includes("editableElementId: 'banquetGuests'")
    && bookingCode.includes("editableElementId: 'kidsCountInput'")
    && bookingCode.includes('kidsCount: childrenCountSource.value ?? null')
    && bookingCode.includes('obj.banquetGuests = formData.kitchenEnabled ? kitchenChildrenCount : null')
    && indexHtmlForBookingPanel.indexOf('id="programDetails"') < indexHtmlForBookingPanel.indexOf('id="kidsCountSection"')
    && indexHtmlForBookingPanel.indexOf('id="kidsCountSection"') < indexHtmlForBookingPanel.indexOf('id="customProgramSection"')
    && indexHtmlForBookingPanel.indexOf('id="kidsCountSection"') < indexHtmlForBookingPanel.indexOf('id="banquetFields"')
    && indexHtmlForBookingPanel.indexOf('id="kidsCountSection"') < indexHtmlForBookingPanel.indexOf('class="form-section status-section"')
    && timelineBanquetInspectorHelpersCode.includes('?? firstTimelineBanquetValue(sourceForCounts, booking => booking.banquetGuests ?? booking.banquet_guests)')
    && bookingCode.includes("document.getElementById('banquetGuests')?.value")
    && bookingCode.includes("document.getElementById('banquetAdults')")
    && bookingCode.includes('banquetAdults')
    && bookingCode.includes("document.getElementById('kidsCountInput')?.value")
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
    && bookingCode.includes('function bookingDetailBanquetArrival(')
    && bookingDetailStandardBlock.includes("const bookingDetailTimeValue = isBanquetArrivalMode ? (banquetArrival?.time || '-') : bookingDetailTimeRange;")
    && bookingDetailStandardBlock.includes("const bookingDetailDateValue = isBanquetArrivalMode ? (banquetArrival?.date || booking.date || '-')")
    && !bookingDetailStandardBlock.includes("isBanquetArrivalMode ? (booking.time || '-')")
    && bookingDetailDynamicLabelRowHasNoCopyAffordance(bookingDetailStandardBlock, '${escapeHtml(bookingDetailDateLabel)}')
    && bookingDetailDynamicLabelRowHasNoCopyAffordance(bookingDetailStandardBlock, '${escapeHtml(bookingDetailTimeLabel)}')
    && bookingDetailLineRowHasNoCopyAffordance
    && bookingDetailRowHasNoCopyAffordance(bookingDetailStandardBlock, 'Ведучих')
    && !bookingDetailStandardBlock.includes('<span class="label">Сума:</span>')
    && !bookingDetailStandardBlock.includes('<span class="label">Ціна:</span>')
    && bookingDetailRowHasNoCopyAffordance(bookingCode, 'Сценарій')
    && bookingDetailRowHasNoCopyAffordance(bookingDetailStandardBlock, 'Статус')
    && bookingCode.includes('function renderBookingCommentDetailRow')
    && bookingCode.includes('function bookingDetailSafeRender(')
    && bookingDetailStandardBlock.includes("const commentDetailHtml = bookingDetailSafeRender('comment-detail', booking, () => renderBookingCommentDetailRow(booking))")
    && bookingDetailStandardBlock.includes('${commentDetailHtml}')
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
    && bookingCode.includes('function renderBookingCustomerCopyAction(value, label)')
    && bookingCode.includes('function bindBookingCustomerCopyActions(container)')
    && bookingCode.includes('data-booking-customer-copy')
    && bookingCode.includes('renderBookingCustomerCopyAction(customer.name')
    && bookingCode.includes('renderBookingCustomerCopyAction(customer.phone')
    && bookingCode.includes('renderBookingCustomerCopyAction(`@${igName}`')
    && !bookingCode.includes("navigator.clipboard.writeText('${escapeHtml(customer.phone)}')")
    && !bookingCode.includes("navigator.clipboard.writeText('@${escapeHtml(igName)}')")
    && bookingDetailStatusBadgeRule.includes('justify-self: end')
    && bookingDetailStatusBadgeRule.includes('width: fit-content')
    && bookingDetailStatusBadgeRule.includes('max-width: 100%')
    && bookingCode.includes('const editControls = isViewer()')
    && bookingCode.includes(': (banquetEditIntegrityIssue')
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
    && bookingDetailStandardBlock.includes('const bookingDetailTimeValue = isBanquetArrivalMode ? (banquetArrival?.time || \'-\') : bookingDetailTimeRange;')
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
check('Booking detail removes room timeline visibility notice',
    !bookingCode.includes('renderBookingTimelineVisibilityNotice')
    && !bookingCode.includes('timelineVisibilityHtml')
    && !bookingCode.includes('booking-detail-visibility')
    && !bookingCode.includes('Може відображатися у «Свята» і «Кімнати»')
    && !bookingCode.includes('Відображається у вкладці «Кімнати»')
    && !bookingCode.includes('Показати в кімнатах')
    && bookingCode.includes('async function showBookingInRoomTimeline(bookingId, dateKey = \'\')')
    && bookingCode.includes("window.showBookingInRoomTimeline = showBookingInRoomTimeline"));
check('Booking detail banquet package, comments, and invite controls stay compact and accurate',
    htmlScriptLoadsBefore('index.html', 'js/booking-package-renderer.js', 'js/booking-banquet-detail.js')
    && htmlScriptLoadsBefore('index.html', 'js/booking-banquet-detail.js', 'js/booking.js')
    && htmlScriptLoadsBefore('index.html', 'js/booking-activity-schedule.js', 'js/booking.js')
    && bookingPackageRendererCode.includes('booking-detail-package-entry-title')
    && bookingPackageRendererCode.includes('Загальна сума')
    && !bookingPackageRendererCode.includes('<div>Разом пакет</div>')
    && bookingPackageRendererCode.includes('function bookingPackageBusinessRowsSummary')
    && bookingPackageRendererCode.includes("if (entryCharge) parts.push('Вхід')")
    && bookingPackageRendererCode.includes('function renderBookingPackageMenuRows(positions = [], options = {})')
    && bookingPackageRendererCode.includes('function renderBookingPackageEntertainmentRows(rows = [], options = {})')
    && bookingPackageRendererCode.includes('const api = {')
    && bookingPackageRendererCode.includes('root.BookingPackageRenderer = Object.assign(root.BookingPackageRenderer || {}, api)')
    && bookingCode.includes('function bookingPackageRendererCall(')
    && bookingCode.includes('window.BookingPackageRenderer.renderBookingPackageSummary = renderBookingPackageSummary')
    && renderBookingPackageDetailBlock.includes('const showHeaderSummary = options.showHeaderSummary !== false')
    && bookingBanquetDetailCode.includes('showHeaderSummary: false')
    && bookingBanquetDetailCode.includes('showServingTitles: false')
    && bookingBanquetDetailCode.includes('showEntertainmentTitle: false')
    && bookingBanquetDetailCode.includes('showEntertainmentTableHead: false')
    && bookingBanquetDetailCode.includes('showEntertainmentKindBadge: false')
    && !bookingPackageRendererCode.includes('${escapeHtml(String(group.items.length))} позицій')
    && !bookingPackageRendererCode.includes('${escapeHtml(String(entertainmentRows.length))} позицій')
    && bookingBanquetDetailCode.indexOf('${renderFullBanquetCommentsSection({ anchorBooking, primaryMembers, kitchenMembers, activityMembers: visibleActivityMembers, serviceManualMembers, members })}') < bookingBanquetDetailCode.indexOf('${renderBanquetMenuSection(packageBooking)}')
    && bookingPackageRendererCode.includes('function renderBookingPackageEntertainmentRows')
    && bookingPackageRendererCode.includes('booking-detail-package-serving-group--entertainment')
    && bookingPackageRendererCode.includes('booking-menu-position-kind--entertainment')
    && bookingPackageRendererCode.includes('booking-detail-package-table-row--entertainment')
    && bookingPackageRendererCode.includes('const entertainmentSubtotal = entertainmentRows.reduce')
    && bookingPackageRendererCode.includes('const displayTotal = bookingPackageMoneyValue(packageTotal) + bookingPackageMoneyValue(entertainmentSubtotal)')
    && panelCss.includes('.booking-detail-package-serving-group--entertainment')
    && panelCss.includes('.booking-menu-position-kind--entertainment')
    && panelCss.includes('.booking-detail-package-table-row--entertainment')
    && panelCss.includes('.booking-detail-package-header small')
    && panelCss.includes('.booking-detail-package-table-head > span:not(:first-child)')
    && panelCss.includes('.booking-detail-package-entry-title')
    && panelCss.includes('.booking-detail-package-entry-row small')
    && panelCss.includes('.booking-detail-package-entry-row strong')
    && bookingPackageRendererCode.includes('booking-detail-package-money booking-detail-package-money--subtotal')
    && bookingPackageRendererCode.includes('booking-detail-package-money booking-detail-package-money--total')
    && banquetMenuMoneyRule.includes('font-family: inherit')
    && banquetMenuMoneyRule.includes('font-size: 13px')
    && banquetMenuMoneyRule.includes('font-weight: 900')
    && banquetMenuMoneyRule.includes('font-variant-numeric: tabular-nums')
    && banquetMenuMoneyRule.includes('letter-spacing: 0')
    && mobileBanquetMenuMoneyRule.includes('font-size: 12px')
    && panelCss.includes('border-left: 1px solid var(--gray-100)')
    && timelineConstructorCss.includes('grid-template-columns: 96px minmax(0, 1fr)')
    && timelineConstructorCss.includes('font-size: 11px')
    && bookingCode.includes("const inviteModel = bookingDetailSafeRender('invite-model', booking, () => window.InviteShare?.buildBookingDetailsInviteModel?.({")
    && bookingCode.includes('}, window.InviteConfig, window.location.origin, window.EventCards) || buildBookingDetailsInviteModelFallback({')
    && bookingCode.includes('const invitePayload = inviteModel.payload;')
    && bookingCode.includes('const invitePreviewChips = Array.isArray(inviteModel.previewChips)')
    && bookingCode.includes('const inviteShortText = invitePayload.shortText;')
    && bookingCode.includes('const inviteMessengerText = invitePayload.messengerText;')
    && bookingCode.includes('const inviteInstagramText = invitePayload.instagramText;')
    && bookingCode.includes('function buildBookingDetailsInviteModelFallback(input)')
    && bookingCode.includes('function buildBookingInviteSharePayloadFallback(data)')
    && bookingCode.includes("const addressRow = rows.find(row => clean(row?.label).toLowerCase() === 'адреса');")
    && bookingCode.includes('const addressLabel = address ? ` Адреса: ${address}.` : \'\';')
    && bookingCode.includes('address ? `Адреса: ${address}` : \'\'')
    && bookingCode.includes('shareTitle = clean(window.InviteConfig?.shareTitle)')
    && !bookingCode.includes('const inviteAddress =')
    && !bookingCode.includes('Парк Закревського Періоду, вул. Закревського 31/2, 3 поверх')
    && bookingCode.includes('data-share-text="${escapeHtml(inviteMessengerText)}"')
    && bookingCode.includes('data-share-title="${escapeHtml(invitePayload.shareTitle')
    && bookingCode.includes('invite-section-eyebrow')
    && bookingCode.includes('Публічне запрошення для клієнта')
    && bookingCode.includes('Посилання на запрошення для гостя')
    && bookingCode.includes('Відкрити запрошення')
    && bookingCode.includes('rel="noopener"')
    && bookingInviteSectionBlock.includes('href="${inviteUrl}"')
    && bookingCode.includes('invite-format-grid')
    && bookingCode.includes('data-text="${escapeHtml(inviteShortText)}"')
    && bookingCode.includes('Viber / Telegram')
    && bookingCode.includes('Instagram')
    && bookingCode.includes('btn-invite-link-copy')
    && bookingCode.includes('btn.dataset.text || btn.dataset.url')
    && bookingCode.includes('section?.dataset.shareText')
    && bookingCode.includes('section?.dataset.shareTitle || window.InviteConfig?.shareTitle')
    && bookingInviteSectionBlock.includes("${invitePreviewChips.map(chip => `<span>${escapeHtml(chip)}</span>`).join('')}")
    && !bookingInviteSectionBlock.includes('class="btn-invite-open">Відкрити</a>')
    && featuresCss.includes('.invite-section-top')
    && featuresCss.includes('.invite-section-eyebrow')
    && featuresCss.includes('.invite-section-description')
    && featuresCss.includes('.invite-format-grid')
    && featuresCss.includes('.btn-invite-open:focus-visible')
    && featuresCss.includes('min-height: 42px')
    && featuresCss.includes('white-space: nowrap')
    && darkModeCss.includes('body.dark-mode .invite-section-header { color: var(--gray-900); }')
    && !darkModeCss.includes('body.dark-mode .invite-section-header { color: var(--white); }')
    && darkModeCss.includes('body.dark-mode .invite-section-eyebrow')
    && darkModeCss.includes('body.dark-mode .invite-section-description')
    && darkModeCss.includes('body.dark-mode .btn-invite-open:focus-visible'));
check('Booking invite URL exposes only public event card contract',
    Boolean(bookingInviteParamsBlock)
    && inviteShareCode.includes("const SAFE_INVITE_KEYS = Object.freeze(['date', 'time', 'end', 'arrival', 'program', 'room', 'card'])")
    && inviteShareCode.includes('function buildBookingDetailsInviteModel(input, config, origin, eventCards)')
    && inviteShareCode.includes('function bookingInviteSnapshotArrival(snapshot)')
    && inviteShareCode.includes('function bookingInviteHasMeaningfulActivityTime(booking = {}, snapshot = null, arrival = null)')
    && inviteShareCode.includes('const cardKey = resolveInviteCardKey(eventCardRecord, eventCards);')
    && inviteShareCode.includes('const banquetSnapshot = input && (input.banquetSnapshot || input.snapshot);')
    && inviteShareCode.includes('const arrival = bookingInviteSnapshotArrival(banquetSnapshot) || bookingInviteSnapshotArrival(input);')
    && inviteShareCode.includes("date: cleanText(arrival?.date || booking.date)")
    && inviteShareCode.includes("time: hasActivityTime ? cleanText(booking.time) : ''")
    && inviteShareCode.includes("end: hasActivityTime ? cleanText(input && input.endTimeLabel) : ''")
    && inviteShareCode.includes("arrival: cleanText(arrival?.time)")
    && inviteShareCode.includes("program: cleanText(booking.programName || booking.label)")
    && inviteShareCode.includes("room: cleanText(arrival?.room || booking.room)")
    && inviteShareCode.includes('card: cardKey')
    && inviteShareCode.includes('previewChips')
    && inviteShareCode.includes('payload.arrivalLabel ? `Прихід гостей ${payload.arrivalLabel}` : \'\'')
    && bookingCode.includes("const inviteEndTimeLabel = booking.duration || booking.duration === 0 ? endTime : '';")
    && bookingInviteParamsBlock.includes('booking,')
    && bookingInviteParamsBlock.includes('eventCardRecord: bookingEventCardRecord')
    && bookingInviteParamsBlock.includes('endTimeLabel: inviteEndTimeLabel')
    && bookingInviteParamsBlock.includes('banquetSnapshot')
    && bookingCode.includes('const inviteUrl = invitePayload.inviteUrl;')
    && bookingCode.includes('const fullInviteUrl = invitePayload.fullInviteUrl;')
    && !/(customer|client|phone|comment|notes|price|sum|status|deposit|id)/i.test(bookingInviteParamsBlock));
check('Booking detail menu polish blocks legacy banquet menu clutter',
    Boolean(bookingDetailStandardBlock)
    && !bookingDetailStandardBlock.includes('<span class="label">Сума:</span>')
    && renderBookingPackageDetailBlock.includes('booking-detail-package')
    && bookingPackageRendererCode.includes('booking-detail-package-table')
    && bookingPackageRendererCode.includes('booking-detail-package-table-row')
    && bookingPackageRendererCode.includes('booking-detail-package-entry-row')
    && renderBookingPackageEntertainmentRowsBlock.includes('booking-detail-package-table-row--entertainment')
    && renderBookingPackageDetailBlock.includes('const showHeaderSummary = options.showHeaderSummary !== false')
    && renderBookingPackageDetailBlock.includes('businessRowsSummary = showHeaderSummary')
    && renderBookingPackageMenuRowsBlock.includes('showServingTitles ?')
    && renderBookingPackageEntertainmentRowsBlock.includes('showEntertainmentTitle ?')
    && renderBookingPackageEntertainmentRowsBlock.includes('showEntertainmentTableHead ?')
    && renderBookingPackageEntertainmentRowsBlock.includes('showEntertainmentKindBadge ?')
    && renderBanquetMenuSectionBlock.includes('showHeaderSummary: false')
    && renderBanquetMenuSectionBlock.includes('showServingTitles: false')
    && renderBanquetMenuSectionBlock.includes('showEntertainmentTitle: false')
    && renderBanquetMenuSectionBlock.includes('showEntertainmentTableHead: false')
    && renderBanquetMenuSectionBlock.includes('showEntertainmentKindBadge: false')
    && !renderBanquetMenuSectionBlock.includes('parts.push(`Меню: ${normalizedMenuCount}`)')
    && !renderBanquetMenuSectionBlock.includes('parts.push(`Розваги: ${normalizedEntertainmentCount}`)')
    && !renderBanquetMenuSectionBlock.includes('<small>Позиції меню</small>')
    && !renderBanquetMenuSectionBlock.includes('РОЗВАГИ')
    && bookingCode.includes('function renderFullBanquetDetail')
    && bookingBanquetDetailCode.includes('renderBanquetMenuSection(packageBooking)')
    && bookingBanquetDetailCode.includes('renderBanquetServiceSection(packageBooking, serviceManualMembers)'));
check('Booking status actions use narrow endpoints and edit_booking visibility',
    apiCode.includes('async function apiMarkBookingPreliminary(id, payload = {})')
    && apiCode.includes('/preliminary')
    && bookingStatusActionBlock.includes('apiConfirmBooking(bookingId, { source: \'booking_panel\' })')
    && bookingStatusActionBlock.includes('apiMarkBookingPreliminary(bookingId, { source: \'booking_panel\' })')
    && !bookingStatusActionBlock.includes('apiUpdateBooking')
    && bookingStatusActionBlock.includes('preliminaryResult?.error')
    && bookingCode.includes('function canEditTimelineBooking()')
    && bookingCode.includes("canAccess('edit_booking')")
    && bookingDetailStandardBlock.includes('${canEditTimelineBooking() && !banquetEditIntegrityIssue ? `<div class="status-toggle-section">')
    && /async bulkStatus\(status\)[\s\S]*canEditTimelineBooking\(\)[\s\S]*apiConfirmBooking\(id, \{ source: 'booking_panel' \}\)[\s\S]*apiMarkBookingPreliminary\(id, \{ source: 'booking_panel' \}\)[\s\S]*async function _loadPinataStockBadge/.test(bookingCode));
check('Booking detail modal switches banquet root header from time range to schedule summary',
    bookingCode.includes('function bookingDetailHeaderPackageBooking(')
    && bookingCode.includes('function bookingDetailHeaderIsBanquetScheduleMode(')
    && bookingCode.includes('function bookingDetailHeaderScheduleSummary(')
    && bookingCode.includes('function bookingDetailIsBanquetArrivalMode(')
    && bookingCode.includes("const headerPackageBooking = bookingDetailSafeRender('banquet-header-package', booking, () => bookingDetailHeaderPackageBooking(booking, banquetSnapshot), booking)")
    && bookingCode.includes("const headerScheduleHtml = bookingDetailSafeRender('banquet-header-schedule', booking, () => bookingDetailHeaderScheduleSummary(headerPackageBooking))")
    && bookingCode.includes("const useBanquetHeaderSchedule = Boolean(String(headerScheduleHtml || '').trim())")
    && bookingCode.includes("&& bookingDetailSafeRender('banquet-header-mode', booking, () => bookingDetailHeaderIsBanquetScheduleMode(booking, banquetSnapshot, fullBanquetDetailHtml), false)")
    && bookingCode.includes("const isBanquetArrivalMode = bookingDetailSafeRender('banquet-arrival-mode', booking, () => bookingDetailIsBanquetArrivalMode(booking, banquetSnapshot, fullBanquetDetailHtml), false)")
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
    && bookingDetailEditControlsBlock.includes('const dangerZoneHtml = renderBookingCancellationAction(booking, cancellationReadiness)')
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
    && bookingCode.includes('booking-detail-danger-action')
    && bookingCode.includes('requestBookingCancellation')
    && !bookingDetailEditControlsBlock.includes('class="btn-delete-booking">Видалити</button>')
    && globalModalsCss.includes('#bookingModal .booking-actions.modal-footer-sticky.booking-actions--compact')
    && globalModalsCss.includes('.booking-detail-more-actions__panel')
    && globalModalsCss.includes('.booking-detail-danger-zone')
    && globalModalsCss.includes('.booking-detail-advanced-actions'));
check('Booking detail modal renders full banquet group details with controlled manual attach',
    bookingCode.includes('function renderFullBanquetDetail')
    && bookingCode.includes('function bookingBanquetDetailRendererCall')
    && bookingBanquetDetailCode.includes('root.BookingBanquetDetail = Object.assign(root.BookingBanquetDetail || {}, api)')
    && bookingBanquetDetailCode.includes('function renderFullBanquetDetail')
    && bookingBanquetDetailCode.includes('renderBookingPackageDetailSafe')
    && bookingCode.includes('apiGetBanquetByBooking(booking.id)')
    && bookingCode.includes('banquetSnapshotPrimaryBooking')
    && bookingCode.includes('function createBanquetGroupFromBookingDetails')
    && bookingCode.includes('function attachBookingToBanquetGroupFromDetails')
    && bookingCode.includes('apiAttachBanquetGroupBooking')
    && bookingCode.includes('bookingDetailIsRoot(target)')
    && bookingCode.includes("const fullBanquetDetailHtml = bookingDetailSafeRender('full-banquet-detail', booking, () => renderFullBanquetDetail(booking, bookings, banquetSnapshot))")
    && bookingCode.includes('booking-customer-block--priority')
    && bookingCode.includes('const priorityCustomerBlockHtml = hasBanquetOverview ? customerBlockHtml :')
    && bookingCode.includes('function bookingDetailHasMenuOverview')
    && bookingCode.includes('function bookingDetailCanOwnBanquetPackage')
    && bookingCode.includes('bookingDetailIsRoot(booking)')
    && bookingCode.includes('bookingDetailCanOwnBanquetPackage(booking)')
    && bookingBanquetDetailCode.includes('function banquetDetailVisibleMembers')
    && bookingBanquetDetailCode.includes('function banquetDetailActivityMembers')
    && bookingCode.includes('function bookingDetailEntertainmentRowsFromMembers')
    && bookingBanquetDetailCode.includes('const visiblePrimaryMembers = primaryMembers.filter')
    && bookingBanquetDetailCode.includes('const visibleActivityMembers = banquetDetailActivityMembers(primaryMembers, activityMembers)')
    && bookingBanquetDetailCode.includes("if (!packageBooking || !bookingDetailHasMenuOverview(packageBooking)) return")
    && bookingBanquetDetailCode.includes('includeServiceEvents: false')
    && bookingBanquetDetailCode.includes("renderBanquetWorkSection('Банкет'")
    && bookingBanquetDetailCode.includes('renderBanquetMenuSection(packageBooking)')
    && bookingBanquetDetailCode.includes('renderBanquetServiceSection(packageBooking, serviceManualMembers)')
    && bookingCode.includes('function fullBanquetDetailCommentItems')
    && bookingBanquetDetailCode.includes('function renderFullBanquetCommentsSection')
    && bookingBanquetDetailCode.includes("renderBanquetWorkSection('Примітки'")
    && bookingBanquetDetailCode.includes('booking-banquet-comments booking-banquet-comments--compact')
    && bookingBanquetDetailCode.includes('renderFullBanquetCommentsSection({ anchorBooking, primaryMembers, kitchenMembers, activityMembers: visibleActivityMembers, serviceManualMembers, members })')
    && /role === 'kitchen'\s*\?\s*\(bookingDetailWorkspaceComment\(booking, 'kitchen'\) \|\| bookingDetailLegacyComment\(booking\)\)/.test(bookingCode)
    && bookingCode.includes("add('kitchen', 'Кухня'")
    && bookingCode.includes("add('activity', `Активність —")
    && bookingCode.includes("add('internal', 'Внутрішній коментар'")
    && bookingBanquetDetailCode.includes("renderBanquetWorkSection('Активності банкету'")
    && bookingBanquetDetailCode.includes("String(booking?.status || '').trim().toLowerCase() === 'cancelled'")
    && bookingBanquetDetailCode.includes('seenBookingIds.has(bookingId)')
    && bookingBanquetDetailCode.includes('renderBanquetActivitiesSection(visibleActivityMembers)')
    && bookingBanquetDetailCode.includes('renderBanquetWarningsSection(warnings)')
    && bookingBanquetDetailCode.includes('renderBanquetTechnicalSection({')
    && !bookingBanquetDetailCode.includes('group-first')
    && !bookingBanquetDetailCode.includes('Service / manual')
    && !bookingBanquetDetailCode.includes('Кухня / меню не прив')
    && !bookingBanquetDetailCode.includes('Технічні linked_to children')
    && bookingBanquetDetailCode.includes('Кандидати підібрані тільки за тим самим бізнес-контекстом і датою')
    && timelineConstructorCss.includes('.booking-banquet-full-detail')
    && timelineConstructorCss.includes('.booking-banquet-section--work')
    && timelineConstructorCss.includes('.booking-banquet-service-row')
    && timelineConstructorCss.includes('.booking-banquet-comments')
    && timelineConstructorCss.includes('.booking-banquet-comments--compact')
    && timelineConstructorCss.includes('.booking-banquet-section--comments')
    && timelineConstructorCss.includes('.booking-banquet-comment-row')
    && timelineConstructorCss.includes('.booking-banquet-technical')
    && timelineConstructorCss.includes('.booking-banquet-candidate-role')
    && timelineConstructorCss.includes('.booking-banquet-warning')
    && globalModalsCss.includes('.booking-customer-block--priority'));
check('Timeline booking accepts an existing customer card, canonical CRM-created handoff, or compact inline compatibility payload',
    htmlContains('index.html', 'bookingCreateCustomerBtn')
    && htmlContains('index.html', 'bookingCreateLeadBtn')
    && htmlContains('index.html', 'bookingNewCustomerForm')
    && bookingCode.includes('const inlineCustomerCreation = bookingInlineCustomerCreationEnabled();') && bookingCode.includes("const nextMode = mode === 'existing' ? 'existing' : (mode === 'new' && inlineCustomerCreation ? 'new' : 'search');")
    && bookingCode.includes('function bookingCustomerDraftFromForm()')
    && bookingCode.includes('function openBookingCustomerCreateWorkflow')
    && bookingCode.includes('function bookingCustomerCreateWorkflowUrl')
    && bookingCode.includes("baseUrl.searchParams.set('action', 'create')")
    && bookingCode.includes("baseUrl.searchParams.set('origin', 'booking')")
    && bookingCode.includes("baseUrl.searchParams.set('handoff', receiver.token)")
    && bookingCode.includes('function handleBookingCustomerHandoffCreated')
    && bookingCode.includes('apiGetCustomer(normalizedCustomerId)')
    && bookingCode.includes('applySelectedCustomerToBookingForm')
    && bookingCode.includes('function openBookingLeadCreateWorkflow')
    && bookingCode.includes('function bookingLeadCreateWorkflowUrl')
    && bookingCode.includes("baseUrl.searchParams.set('createStage', 'deal')")
    && bookingCode.includes("entity: 'lead'")
    && bookingCode.includes('function handleBookingLeadHandoffCreated')
    && bookingCode.includes('BookingDrawerState.leadHandoffContext')
    && bookingCode.includes('obj.leadId = AppState.leadConversionContext.leadId')
    && bookingCode.includes('handoffApi.createReceiver')
    && bookingCode.includes("entity: 'customer'")
    && bookingCode.includes('const hasClient = hasSelectedCustomer || hasNewCustomer;')
    && bookingCode.includes('customerDraft.search && !customerDraft.name')
    && bookingCode.includes('obj.customerId = parseInt(existingId, 10);')
    && bookingCode.includes('function bookingInlineCustomerCreationEnabled')
    && bookingCode.includes('function bookingCustomerPayloadFromDraft')
    && bookingCode.includes("bookingInlineCustomerCreationEnabled() && BookingDrawerState.clientMode === 'new'")
    && bookingCode.includes('if (customer) obj.customer = customer')
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
    && (bookingCode.includes("errors.push(isEducation ? 'Оберіть заняття або вкажіть тему.' : 'Оберіть програму події.');")
        || bookingCode.includes("addBookingValidationIssue(state, 'program', isEducation ? 'Оберіть заняття або вкажіть тему.' : 'Оберіть програму події.'"))
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
    && !kitchenMenuImagesCode.includes('"menu_2026_031_item"')
    && !kitchenMenuImagesCode.includes('"MENU-031"')
    && !kitchenMenuImagesCode.includes('products/menu-031.jpg')
    && bookingCode.includes('function renderBookingMenuCatalog')
    && bookingCode.includes('function renderBookingMenuCatalogCart')
    && bookingCode.includes('function bookingMenuProductEmoji')
    && bookingCode.includes('function bookingMenuCatalogVisualHtml')
    && bookingCode.includes('function bookingMenuImageManifestUrl')
    && bookingCode.includes('window.KITCHEN_MENU_IMAGES')
    && bookingCode.includes('|| product.iconUrl')
    && bookingCode.includes('|| product.icon_url')
    && configCode.includes('iconUrl: p.iconUrl || p.icon_url || null')
    && configCode.includes('|| p.iconUrl || p.icon_url || null')
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
    && panelCss.includes('min-height: 328px')
    && panelCss.includes('.booking-menu-catalog-item:hover')
    && panelCss.includes('transform: translate3d(0, -2px, 0)')
    && panelCss.includes('@media (prefers-reduced-motion: reduce)')
    && panelCss.includes('height: auto')
    && panelCss.includes('aspect-ratio: 3 / 2')
    && panelCss.includes('min-height: 32px')
    && panelCss.includes('width: 100%')
    && panelCss.includes('grid-template-columns: 32px minmax(44px, 1fr) 32px 32px 32px')
    && panelCss.includes('@media (max-height: 820px), (max-width: 1440px)')
    && panelCss.includes('grid-template-columns: minmax(0, 1fr) minmax(260px, 300px)')
    && panelCss.includes('grid-template-columns: repeat(auto-fill, minmax(216px, 1fr))')
    && panelCss.includes('padding: 0 8px calc(82px + env(safe-area-inset-bottom, 0px))')
    && panelCss.includes('min-height: 312px')
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
    && bookingCode.includes("BOOKING_MENU_CATALOG_FALLBACK_IMAGE = ''")
    && bookingCode.includes('data-menu-catalog-fallback')
    && !bookingCode.includes('img.src = BOOKING_MENU_CATALOG_FALLBACK_IMAGE')
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
    && bookingPanelHtml.includes('<textarea id="bookingNotes"')
    && bookingPanelHtml.includes('class="booking-notes-input"')
    && !bookingPanelHtml.includes('<input type="text" id="bookingNotes"')
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
    && /else \{[\s\S]*const finalCreatePath = resolveBookingCreatePath[\s\S]*apiCreateBooking\(booking,/.test(bookingCode)
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
check('Booking cancellation UI is group-aware and readiness fail-closed',
    bookingCode.includes('function renderBookingCancellationAction')
    && bookingCode.includes('requestBookingCancellation')
    && bookingCode.includes('apiGetBookingCancellationReadiness')
    && bookingCode.includes('apiCancelBanquetActivity')
    && bookingCode.includes('apiCancelBanquetGroup')
    && bookingCode.includes('Перевірка скасування недоступна')
    && !bookingCode.includes('deleteBookingLegacyRemoved'));
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
    && bookingPackageRendererCode.includes('Не вказано час видачі')
    && bookingPackageRendererCode.includes('function groupedBookingMenuPositions')
    && bookingPackageRendererCode.includes('booking-detail-package-serving-group')
    && bookingPackageRendererCode.includes('booking-detail-package-table')
    && bookingPackageRendererCode.includes('booking-detail-package-table-row')
    && bookingPackageRendererCode.includes('booking-detail-package-service-row')
    && bookingBanquetDetailCode.includes('booking-banquet-service-row--checklist')
    && !bookingBanquetDetailCode.includes("<strong>${escapeHtml(BOOKING_SERVICE_EVENT_TYPES[event.type] || 'Подія')}</strong>")
    && bookingPackageRendererCode.includes('Час видачі не вказано')
    && htmlContains('index.html', 'Страви й торти додаються з каталогу')
    && htmlContains('services/bookingPackage.js', 'BOOKING_PACKAGE_SCHEMA_VERSION = 3')
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
    && bookingPackageRendererCode.includes('<span role="cell">${escapeHtml(formatBookingMenuPositionQuantity(item))}</span>')
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
    && programsPageCode.includes('function renderKitchenMenuImagePreview')
    && programsPageCode.includes('function menuImageDraftStatusLabel')
    && programsPageCode.includes('function generateKitchenMenuImage')
    && programsPageCode.includes('function applyKitchenMenuImageDraft')
    && programsPageCode.includes('function rejectKitchenMenuImageDraft')
    && programsPageCode.includes('function saveKitchenMenuImageDraft')
    && programsPageCode.includes('function createKitchenMenuExternalDraft')
    && programsPageCode.includes('function readMenuImageFileAsDataUrl')
    && programsPageCode.includes('data-menu-image-action="apply"')
    && programsPageCode.includes('data-menu-image-action="reject"')
    && programsPageCode.includes('data-menu-image-action="external-draft"')
    && programsPageCode.includes('data-menu-image-file')
    && programsPageCode.includes('data-menu-image-url')
    && programsPageCode.includes('buildKitchenMenuImagePrompt')
    && programsPageCode.includes('apiGenerateProductMenuImage')
    && programsPageCode.includes('apiCreateProductMenuExternalDraft')
    && programsPageCode.includes('apiApplyProductMenuImage')
    && programsPageCode.includes('apiRejectProductMenuImage')
    && programsPageCode.includes('imageStudio')
    && programsCss.includes('.kitchen-menu-image-previews')
    && programsCss.includes('.kitchen-menu-image-preview')
    && programsCss.includes('.kitchen-menu-image-actions')
    && programsCss.includes('.kitchen-menu-image-manual')
    && programsCss.includes('.kitchen-menu-image-manual-status')
    && programsCss.includes('.kitchen-menu-image-status.failed')
    && programsCss.includes('.kitchen-menu-image-status.rejected')
    && apiCode.includes('function apiGenerateProductMenuImage')
    && apiCode.includes('/menu-image/draft')
    && apiCode.includes('function apiCreateProductMenuExternalDraft')
    && apiCode.includes('/menu-image/external-draft')
    && apiCode.includes('function apiGetProductMenuImageStatus')
    && apiCode.includes('function apiApplyProductMenuImage')
    && apiCode.includes('function apiRejectProductMenuImage')
    && productsRoute.includes("router.post('/:id/menu-image/draft'")
    && productsRoute.includes("router.post('/:id/menu-image/generate'")
    && productsRoute.includes("router.post('/:id/menu-image/external-draft'")
    && productsRoute.includes("router.post('/:id/menu-image/apply'")
    && productsRoute.includes("router.post('/:id/menu-image/reject'")
    && productsRoute.includes("router.get('/:id/menu-image/status'")
    && menuPhotoServiceCode.includes('/images/generations')
    && menuPhotoServiceCode.includes('OPENAI_MENU_IMAGE_MODEL')
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
check('Booking edit preserves current second animator across room timeline filtering',
    bookingCode.includes('function resolveSecondAnimatorSelectionCandidate')
    && bookingCode.includes('getAnimatorLinesForBookingDate({ forceAnimatorView: true')
    && bookingCode.includes("apiGetBookings(dateStr, { timelineView: 'animators'")
    && bookingCode.includes('selectedLineId')
    && bookingCode.includes('animatorSelectConflictExcludeIds(bookings, candidate.id, options)')
    && bookingCode.includes('excludeBookingIds: bookingEditConflictExcludeIds()')
    && bookingCode.includes('dataset.unresolvedSecondAnimator')
    && bookingCode.includes('second_animator_unresolved'));
check('Booking edit keeps the existing customer selected without reselecting',
    bookingCode.includes('function hydrateBookingCustomerSelection')
    && bookingCode.includes('function applySelectedCustomerToBookingForm')
    && bookingCode.includes('rememberSelectedCustomerSnapshot(normalized)')
    && bookingCode.includes("setBookingClientMode('existing')")
    && editBookingBlock.includes('await hydrateBookingCustomerSelection(booking, {')
    && editBookingBlock.includes("preselectBanquetGroupId: banquetEditContext?.groupId || ''")
    && duplicateBookingBlock.includes('await hydrateBookingCustomerSelection(booking, { renderSummary: false });')
    && editBookingBlock.includes('if (window.BookingForm?.markClean) BookingForm.markClean();')
    && duplicateBookingBlock.includes('if (window.BookingForm?.markClean) BookingForm.markClean();')
    && !editBookingBlock.includes('apiGetCustomer(booking.customerId).then')
    && !duplicateBookingBlock.includes('apiGetCustomer(booking.customerId).then'));
check('HR access editor and onboarding wizard persist extraRoles as real working-role grants',
    hrCode.includes('extraRoles: normalizeAccountListInput(draft.extraRoles)')
    && hrCode.includes("extraRoles: checkedAccountOnboardingValues('accountOnboardingExtraRoles', 'account-onboarding-extra-role')"));
check('Maysternya Doli uses the shared booking panel without toolbar create shortcut', configCode.includes("const MAYSTERNYA_DOLI_PROGRAMS = [") && configCode.includes("id: 'md_demo_consult_15'") && configCode.includes("name: 'Демо консультація'") && configCode.includes('duration: 15') && configCode.includes("id: 'md_full_consult_40'") && configCode.includes("name: 'Повна консультація'") && configCode.includes('duration: 90') && configCode.includes('Повна консультація(90)') && !configCode.includes("id: 'md_consult_60'") && !configCode.includes("id: 'md_custom'") && configCode.includes("? ['custom']") && configCode.includes("custom: IS_MAYSTERNYA_DOLI_TIMELINE ? 'Консультації' : 'Послуги'") && configCode.includes('apiGetProducts(true, { businessContext, priceDate })') && configCode.includes('Array.isArray(apiProducts)') && configCode.includes('timelineDisplayUsesApiProducts') && !configCode.includes('if (IS_MAYSTERNYA_DOLI_TIMELINE) {\n        AppState.products = PROGRAMS;') && bookingCode.includes("TIMELINE_DISPLAY_MODE !== 'park'") && bookingCode.includes('p.updatedAt') && bookingCode.includes('prepareMaysternyaBookingPanel') && bookingCode.includes('MAYSTERNYA_ONLINE_ROOM') && bookingFormJs.includes('isMaysternyaBookingContext') && htmlContains('index.html', 'maysternyaQuickBookingTools') && !htmlContains('index.html', 'newBookingBtn') && timelineCode.includes('openTimelineCreateBookingFromToolbar') && !timelineVisibilityCode.includes("visualBlock('createBooking'") && !authCode.includes("setTimelinePermissionHidden('newBookingBtn'") && !panelCss.includes('body.timeline-context-maysternya .booking-room-first-section') && !panelCss.includes('body.timeline-context-maysternya .booking-customer-search-section') && !panelCss.includes('body.timeline-mode-simple .booking-room-first-section') && !panelCss.includes('body.timeline-mode-simple .status-section'));
check('Maysternya Doli booking can close busy slots', bookingCode.includes('closeMaysternyaTimelineSlot') && bookingCode.includes('slotClosed: true') && bookingCode.includes('MAYSTERNYA_CLOSED_ROOM') && timelineCode.includes('slot-closed') && timelineCode.includes('isMaysternyaSlotClosed') && timelineCss.includes('.booking-block.slot-closed') && htmlContains('index.html', 'maysternyaCloseSlotBtn'));
check('Resource-backed timeline can close cabinets and show capacity-aware free resources', bookingCode.includes('isTimelineResourceBackedBookingMode') && bookingCode.includes('timelineResourceCapacityError') && bookingCode.includes('timelineResourceBlock') && bookingCode.includes('resource_blackout') && bookingCode.includes('data-free-room') && bookingCode.includes('capacity=${encodeURIComponent(String(requestedCapacity))}') && timelineCode.includes('resourceBlockExtra') && panelCss.includes('body.timeline-mode-education .maysternya-quick-booking-tools') && !panelCss.includes('body.timeline-mode-education #kidsCountSection') && fs.readFileSync(path.join(ROOT, 'css/features.css'), 'utf8').includes('.free-room-chip small'));
check('Education timeline captures lesson metadata, real series, and teacher conflicts', htmlContains('index.html', 'educationLessonSection') && htmlContains('index.html', 'educationLessonTeacher') && htmlContains('index.html', 'educationLessonRepeatEvery') && bookingCode.includes('getEducationLessonDetails') && bookingCode.includes('apiCreateEducationLessonSeries') && bookingCode.includes('extraData.educationLesson') && bookingFormJs.includes('educationLessonRepeatEvery') && timelineCode.includes('educationLessonExtra') && timelineCode.includes('lessonSeriesBadge') && htmlContains('routes/bookings.js', 'validateEducationLessonTeacherConflict') && htmlContains('routes/bookings.js', 'education-series') && htmlContains('routes/bookings.js', 'buildEducationLessonSeriesCandidates') && htmlContains('routes/bookings.js', 'seriesRootBookingId') && panelCss.includes('.education-lesson-section'));
check('Booking UI separates park and client pinata modes', bookingCode.includes('syncPinataModeFields') && bookingCode.includes('clientPinataServicePrice') && bookingCode.includes('renderPinataDetailRows'));
check('Booking pinata and filler use one visual picker template', bookingCode.includes('function renderPinataChoiceCard') && bookingCode.includes('function renderPinataVisualPickers') && bookingCode.includes('buildPinataDesignChoices') && bookingCode.includes('buildPinataFillerChoices') && panelCss.includes('.pinata-choice-card') && panelCss.includes('.pinata-choice-thumb'));
check('Booking pinata picker preserves operational 501-style numbers', bookingCode.includes('function bookingPinataNumbersHelper') && bookingCode.includes('bookingPinataNumbersHelper()?.OPERATIONAL_BASE || 500') && bookingCode.includes('function bookingPinataNumberValue') && bookingCode.includes('function bookingPinataNumberDisplay') && bookingCode.includes('function pinataOperationalNumberFromDesignId') && bookingCode.includes('const operationalNumber = pinataNormalizeChoiceValue(design.pinata_number || design.number || design.code)') && bookingCode.includes('pinataOperationalNumberFromDesignId(design.id || (index + 1))') && bookingCode.includes("typeof getAuthHeaders === 'function'") && bookingCode.includes('pinata_number'));
check('Timeline pinata hover and room labels expose operational numbers consistently',
    uiCode.includes('const PINATA_NUMBERS_ROOT')
    && uiCode.includes('PINATA_NUMBERS_ROOT.PinataNumbers')
    && uiCode.includes('const OPERATIONAL_BASE = 500')
    && uiCode.includes('function valueFromBooking(booking = {}, options = {})')
    && uiCode.includes('function fromCatalogId(id)')
    && uiCode.includes('function tooltipPinataNumberValue')
    && uiCode.includes('tooltip._lastPinataNumber')
    && uiCode.includes('🪅 Номер піньяти:')
    && bookingCode.includes('function bookingPinataNumbersHelper')
    && timelineCode.includes('function timelinePinataNumbersHelper')
    && !bookingCode.includes('normalized.match(/^P-(\\d{1,3})$/i)')
    && !timelineCode.includes('normalized.match(/^P-(\\d{1,3})$/i)')
    && timelineCode.includes('return `ПІН ${timelinePinataNumberDisplay(pinataNumber)}`')
    && !timelineCode.includes('return tightDensity ? `ПІН ${displayNumber}` : `Піньята ${displayNumber}`'));
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
check('Timeline quarantines room bookings when line/resource identity drifts', timelineResourceIdentityCode.includes('function timelineLineMatchKeys') && timelineResourceIdentityCode.includes('function timelineBookingMatchKeys') && timelineResourceIdentityCode.includes('addTimelineMetadataMatchKeys') && timelineCode.includes("=== 'room-quarantine'") && timelineCode.includes("fallbackReason: isRoomTimelineView() ? 'room_identity_quarantine' : 'unmatched_line_identity'") && timelineCode.includes('Skipped unmatched room bookings because quarantine line is unavailable') && timelineCode.includes('lineBookingsById.get(String(line.id))'));
check('Room timeline cannot save or edit legacy animator lines', htmlContains('routes/lines.js', 'function isRoomTimelineLinePayload') && htmlContains('routes/lines.js', '__timelineIsolationTestHooks') && htmlContains('routes/lines.js', 'room_timeline_legacy_line_save_blocked') && htmlContains('routes/lines.js', 'Room timeline rows cannot be saved through legacy animator lines endpoint') && timelineCode.includes('Blocked legacy line save from room timeline view') && timelineCode.includes('isViewer() || isRoomTimelineView()') && timelineCode.includes('if (isRoomTimelineView()) return;') && apiCode.includes('window.TimelineView?.isRooms?.()') && apiCode.includes('timelineApiUrlWithView(`/lines/${date}`)') && settingsCode.includes('function isRoomTimelineLineEditingBlocked') && settingsCode.includes('notifyRoomTimelineLineEditingBlocked'));
check('Animator timeline quarantines polluted room rows at read time', htmlContains('routes/lines.js', 'function isLegacyRoomTimelineLineRow') && htmlContains('routes/lines.js', 'Filtered room timeline rows from animator timeline response') && htmlContains('routes/lines.js', 'const lines = filteredRows') && timelineCode.includes('function isTimelineRoomOnlyLine') && timelineCode.includes('timelineLineValueStartsWithRoomId') && timelineCode.includes('!isTimelineBanquetServicePseudoLine(line) && !isTimelineRoomOnlyLine(line)'));
check('Timeline view isolation regression matrix covers polluted rows and view switch cache', timelineRegressionMatrixTestCode.includes('pollutedLegacyRows') && timelineRegressionMatrixTestCode.includes("['748']") && timelineRegressionMatrixTestCode.includes("['room-takeaway', 'room-quarantine', 'room-marvel']") && timelineRegressionMatrixTestCode.includes('timelineCacheScopeKey') && timelineRegressionMatrixTestCode.includes('AppState\\.cachedLines') && timelineRegressionMatrixTestCode.includes('timelineApiUrlWithView'));
check('Phone timeline keeps the second line visible on iPhone 11', responsiveCss.includes('v0.73.80: iPhone 11/Safari needs a definite container height') && responsiveCss.includes('height: clamp(360px, calc(var(--eg-viewport-height, 100dvh) - 250px), 58dvh) !important;') && responsiveCss.includes('flex: 1 1 0 !important;') && responsiveCss.includes('max-height: none !important;') && uiCode.includes('if (viewportWidth <= 480) return 84;'));
check('Phone timeline positions second-line bookings from measured line grid', timelineCode.includes('v0.73.81: iOS/Safari can paint mobile grid cells after the row is attached') && timelineCode.includes('container.appendChild(lineEl);') && timelineCode.includes('createBookingBlock(b, start, lineGrid, line)') && timelineCode.includes('createAfishaBlock(ev, start, lineGrid)') && timelineCode.includes('function createBookingBlock(booking, startHour, anchor, line = null)') && uiCode.includes('timelineMinutesToPixels(nowMin - startMin, gridAnchor)'));
check('Graduation timeline renders package components as persisted interactive nested segments', timelineCode.includes('function normalizeGraduationSegments') && timelineCode.includes('extra.graduationSegments') && timelineCode.includes('function initGraduationSegmentInteractions') && timelineCode.includes('data-graduation-segment-id') && timelineCode.includes('graduationSegmentsHaveOverlap') && timelineCode.includes('withGraduationSegmentExtraData') && timelineCode.includes('apiUpdateBooking(booking.id, payload)') && timelineCss.includes('.booking-block.graduation-parent') && timelineCss.includes('.graduation-segment-track') && timelineCss.includes('.graduation-segment-resize'));
check('Task/customer/finance edit surfaces use shared dirty guard', tasksCode.includes('attemptCloseEditableSurface(overlay') && customersCode.includes('attemptCloseEditableSurface(modal') && financeCode.includes('attemptCloseEditableSurface(modal'));
check('Design/catalog overlays guard dirty dismiss paths', designsPageCode.includes('attemptCloseEditableSurface(overlay') && designsHtml.includes('guardedEditableOverlayClose') && designsHtml.includes('closeAutomationModal(false)'));
check('Staff and HR edit modals use guarded close paths', staffCode.includes('attemptCloseEditableSurface(overlay') && hrCode.includes('closeHrEditableModal') && hrCode.includes('showHrEditableModal'));
check('HR grouped IA keeps Pulse clean and vacancy workspace owns hiring surfaces',
    htmlContains('hr.html', 'id="hrNav"')
    && htmlContains('hr.html', 'id="hrPageTitle"')
    && [
        'const HR_NAV_GROUPS',
        'const HR_STRUCTURE_WORKSPACE_TABS',
        'const HR_PAYROLL_WORKSPACE_TABS',
        'const HR_OTHER_WORKSPACE_TABS',
        'const HR_PULSE_WORKSPACE_TABS',
        'function isHrStructureWorkspaceTab',
        'function isHrPayrollWorkspaceTab',
        'function isHrOtherWorkspaceTab',
        'function isHrPulseWorkspaceTab',
        'function hrWorkspaceGroupId',
        'function updateHrPageTitle',
        'function bindHrNavClicks',
        "other: { tab: 'vacancies' }",
        "href: '/training#onboarding'",
        "window.location.replace('/training#onboarding')",
        "payroll: { tab: 'salary' }",
        "id: 'pulse'",
        'function hrPulseNavItems',
        'items: hrPulseNavItems',
        'function hrNavGroupItems',
        'items: hrNavGroupItems(group).filter(isHrNavItemVisible)',
        'function renderHrPulseNavButton',
        "label: 'KPI'",
        "workspaceGroupId ? group.id === workspaceGroupId : group.id === 'pulse'",
        "workspaceGroupId === 'other' ?",
        "nav.classList.toggle('hr-nav--structure-only'",
        "nav.classList.toggle('hr-nav--pulse'",
        "workspaceMode || pulseMode ? ' hidden' : ''",
        'if (header) header.hidden = pulseMode',
        'function formatVacancyPlatformText'
    ].every(token => hrCode.includes(token))
    && [
        "href: '/hr'",
        "href: '/hr#payroll'",
        "href: '/hr#other'"
    ].every(token => sidebarCode.includes(token))
    && !/\{\s*id:\s*'team',\s*label:\s*'[^']+',\s*tab:\s*'team'\s*\}/.test(hrCode)
    && !/\{\s*id:\s*'onboarding',\s*label:/.test(hrCode)
    && !/\{\s*id:\s*'costumes',\s*label:/.test(hrCode)
    && htmlContains('hr.html', 'js/hr-pulse-switcher.js?v=0.81.35')
    && hrPulseSwitcherCode.includes('const PULSE_ITEMS')
    && hrPulseSwitcherCode.includes("id: 'today'")
    && hrPulseSwitcherCode.includes("id: 'schedule'")
    && hrPulseSwitcherCode.includes("id: 'reports'")
    && hrPulseSwitcherCode.includes("href: '/staff'")
    && !hrPulseSwitcherCode.includes("hrHref: '/staff'")
    && htmlContains('hr.html', 'id="hrStaffScheduleShell"')
    && htmlContains('hr.html', 'data-staff-schedule-shell="hr"')
    && htmlContains('hr.html', 'js/staff-schedule-shell.js?v=0.81.35')
    && htmlContains('hr.html', 'js/staff-page.js?v=0.81.35')
    && !htmlContains('hr.html', 'id="hrScheduleEmbedFrame"')
    && !htmlContains('hr.html', 'data-src="/staff?embed=1"')
    && hrCode.includes('function loadHrScheduleModule')
    && hrCode.includes("schedule: loadHrScheduleModule")
    && hrCode.includes('window.StaffSchedulePage.init')
    && !hrCode.includes('function loadHrScheduleEmbed')
    && hrPageCss.includes('.hr-nav {')
    && hrPageCss.includes('flex-direction: column')
    && hrPageCss.includes('.hr-nav--structure-only')
    && hrPageCss.includes('.hr-nav--structure-only .hr-nav-group-title')
    && hrPageCss.includes('.hr-nav--pulse .hr-nav-items')
    && hrPageCss.includes('flex-wrap: nowrap;')
    && hrPageCss.includes('grid-template-columns: repeat(3, minmax(0, 1fr));')
    && htmlContains('hr.html', 'data-vacancy-tab="responses"')
    && htmlContains('hr.html', 'data-vacancy-tab="interviews"')
    && htmlContains('hr.html', 'data-vacancy-tab="templates"')
    && hrRouteCode.includes("router.get('/vacancy-platforms'")
    && hrRouteCode.includes("router.post('/vacancy-platforms/format-preview'")
    && !htmlContains('hr.html', 'data-tab="ai-team"')
    && !htmlContains('hr.html', 'data-tab="ratings"')
    && !htmlContains('hr.html', 'id="tab-leaves"'));
const hrPulseNavSurfaceRule = cssRuleText(hrPageCss, '.hr-nav--pulse');
const hrPulseNavEmptyTailRule = cssRuleText(hrPageCss, '.hr-nav--pulse::after');
const hrPulseNavItemsRule = cssRuleText(hrPageCss, '.hr-nav--pulse .hr-nav-items');
const hrPulseCardRule = cssRuleText(hrPageCss, '.hr-nav--pulse .hr-tab.hr-pulse-card');
const hrPulseCardIconRule = cssRuleText(hrPageCss, '.hr-pulse-card-icon');
const hrPulseCardLineRule = cssRuleText(hrPageCss, '.hr-pulse-card-line');
const hrScheduleModuleShellRule = cssRuleText(hrPageCss, '.hr-schedule-module-shell');
const hrPulseTabletBlock = cssAtRuleBlock(hrPageCss, '@media (max-width: 1120px)');
const hrPulseTabletNavRule = cssRuleText(hrPulseTabletBlock, '.hr-nav--pulse');
const hrPulseTabletItemsRule = cssRuleText(hrPulseTabletBlock, '.hr-nav--pulse .hr-nav-items');
const hrPulseMobileBlock = cssAtRuleBlock(hrPageCss, '@media (max-width: 768px)');
const hrPulseMobileItemsRule = cssRuleText(hrPulseMobileBlock, '.hr-nav--pulse .hr-nav-items');
const hrPulseMobileCardRule = cssRuleText(hrPulseMobileBlock, '.hr-nav--pulse .hr-tab.hr-pulse-card');
const hrPulseSmallMobileBlock = cssAtRuleBlock(hrPageCss, '@media (max-width: 480px)');
const hrPulseSmallMobileContentRule = cssRuleText(hrPulseSmallMobileBlock, '.hr-pulse-card-content');
const hrReducedMotionBlock = cssAtRuleBlock(hrPageCss, '@media (prefers-reduced-motion: reduce)');
const legacyHrPulseNavTokens = [
    'today-nav-light.png',
    'today-nav-dark.png',
    'schedule-nav-light.png',
    'schedule-nav-dark.png',
    'reports-nav-light.png',
    'reports-nav-dark.png',
    'lightImage',
    'darkImage',
    'withPulseVisual',
    'hr-pulse-card-media',
    'hr-pulse-card-img',
    'hr-pulse-card-overlay'
];
const hrReportsHeroRule = cssRuleText(hrPageCss, '.hr-reports-hero');
const hrReportsHeroContentRule = cssRuleText(hrPageCss, '.hr-reports-hero-content');
const hrReportsHeroMetricsRule = cssRuleText(hrPageCss, '.hr-reports-hero-metrics');
const hrReportsMetricChipRule = cssRuleText(hrPageCss, '.hr-reports-metric-chip');
const hrReportsHeroHeadingRule = cssRuleText(hrPageCss, '.hr-reports-hero h2');
check('HR Pulse premium switcher keeps icon cards, routing, and accessible decorative affordances',
    hrCode.includes('function hrPulseSwitcher')
    && hrCode.includes('function hrPulseNavItems')
    && hrCode.includes('function renderHrPulseNavButton')
    && hrCode.includes('switcher.renderTab')
    && hrCode.includes("className: 'hr-tab hr-pulse-card ui-tab-card'")
    && hrCode.includes("classPrefix: 'hr-pulse-card'")
    && hrCode.includes("'data-nav-id': pulseItem.id")
    && hrCode.includes("'data-tab': pulseItem.tab || pulseItem.id")
    && hrCode.includes("'data-href': pulseItem.href || ''")
    && hrCode.includes("tab.matches(':disabled, [aria-disabled=\"true\"], [aria-busy=\"true\"]')")
    && hrCode.includes(".hr-nav--pulse .hr-tab[aria-current]")
    && hrCode.includes("removeAttribute('aria-current')")
    && hrCode.includes("setAttribute('aria-current', 'page')")
    && hrPulseSwitcherCode.includes("icon: 'calendar'")
    && hrPulseSwitcherCode.includes("icon: 'clock'")
    && hrPulseSwitcherCode.includes("icon: 'report'")
    && hrPulseSwitcherCode.includes("tone: 'people'")
    && hrPulseSwitcherCode.includes("tone: 'schedule'")
    && hrPulseSwitcherCode.includes("tone: 'reports'")
    && hrPulseSwitcherCode.includes('function renderTab')
    && hrPulseSwitcherCode.includes('function renderStaffNav')
    && hrPulseSwitcherCode.includes('span class="${prefix}-icon"')
    && hrPulseSwitcherCode.includes('span class="${prefix}-title"')
    && hrPulseSwitcherCode.includes('span class="${prefix}-subtitle"')
    && hrPulseSwitcherCode.includes('span class="${prefix}-line"')
    && !hrPulseSwitcherCode.includes('span class="${prefix}-badge')
    && !hrPulseSwitcherCode.includes('data-pulse-badge=')
    && !hrCode.includes('hr-pulse-card-badge')
    && !hrCode.includes('setPulseCardBadge')
    && !hrCode.includes('applyPulseCardBadges')
    && hrPulseSwitcherCode.includes('aria-hidden="true"')
    && hrPageCss.includes('.hr-nav--pulse .hr-tab.hr-pulse-card')
    && hrPageCss.includes('.hr-pulse-card-icon')
    && hrPageCss.includes('.hr-pulse-card-title')
    && hrPageCss.includes('.hr-pulse-card-subtitle')
    && !hrPageCss.includes('.hr-pulse-card-badge')
    && hrPageCss.includes('.hr-pulse-card-line')
    && hrPageCss.includes('.hr-nav--pulse .hr-tab.hr-pulse-card:focus-visible')
    && hrPageCss.includes('.hr-nav--pulse .hr-tab.hr-pulse-card:disabled')
    && hrPageCss.includes('.hr-nav--pulse .hr-tab.hr-pulse-card[aria-disabled="true"]')
    && hrPageCss.includes('.hr-nav--pulse .hr-tab.hr-pulse-card[aria-busy="true"]')
    && staffCssForUiPolish.includes('v0.77.102: HR and Staff Pulse switchers share one visual token contract')
    && staffCssForUiPolish.includes('--pulse-switcher-card-width: clamp(168px, 14vw, 196px);')
    && staffCssForUiPolish.includes('--pulse-switcher-hover-shadow')
    && staffCssForUiPolish.includes('--pulse-switcher-focus-shadow')
    && /overflow:\s*hidden;/.test(hrPulseNavSurfaceRule)
    && /contain:\s*layout paint;/.test(hrPulseNavSurfaceRule)
    && /align-items:\s*stretch;/.test(hrPulseNavSurfaceRule)
    && /width:\s*100%;/.test(hrPulseNavSurfaceRule)
    && /--hr-pulse-content-gap:\s*12px;/.test(hrPulseNavSurfaceRule)
    && /margin-bottom:\s*var\(--hr-pulse-content-gap\);/.test(hrPulseNavSurfaceRule)
    && hrPageCss.includes('.hr-nav--pulse ~ .hr-tab-content.active')
    && /margin:\s*0 0 12px;/.test(hrScheduleModuleShellRule)
    && /content:\s*none;/.test(hrPulseNavEmptyTailRule)
    && /display:\s*none;/.test(hrPulseNavEmptyTailRule)
    && /display:\s*grid;/.test(hrPulseNavItemsRule)
    && /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/.test(hrPulseNavItemsRule)
    && /width:\s*100%;/.test(hrPulseNavItemsRule)
    && /overscroll-behavior-inline:\s*contain;/.test(hrPulseNavItemsRule)
    && /display:\s*grid;/.test(hrPulseCardRule)
    && /flex:\s*1 1 auto;/.test(hrPulseCardRule)
    && /width:\s*100%;/.test(hrPulseCardRule)
    && /min-width:\s*0;/.test(hrPulseCardRule)
    && /max-width:\s*none;/.test(hrPulseCardRule)
    && /overflow:\s*hidden;/.test(hrPulseCardRule)
    && /contain:\s*layout paint;/.test(hrPulseCardRule)
    && /outline:\s*2px solid/.test(hrPageCss)
    && /outline-offset:\s*2px;/.test(hrPageCss)
    && /cursor:\s*not-allowed;/.test(hrPageCss)
    && /cursor:\s*progress;/.test(hrPageCss)
    && /display:\s*grid;/.test(hrPulseCardIconRule)
    && /place-items:\s*center;/.test(hrPulseCardIconRule)
    && /position:\s*absolute;/.test(hrPulseCardLineRule)
    && /transform:\s*scaleX/.test(hrPulseCardLineRule)
    && /overflow:\s*hidden;/.test(hrReportsHeroRule)
    && /contain:\s*layout paint;/.test(hrReportsHeroRule)
    && /display:\s*grid;/.test(hrReportsHeroContentRule)
    && /display:\s*grid;/.test(hrReportsHeroMetricsRule)
    && /display:\s*grid;/.test(hrReportsMetricChipRule)
    && hrPageCss.includes('@media (max-width: 480px)')
    && hrPageCss.includes('@media (max-width: 1120px)')
    && hrPageCss.includes('overflow-x: auto;')
    && hrPageCss.includes('scrollbar-width: none;')
    && hrPageCss.includes('grid-template-columns: repeat(3, minmax(0, 1fr));')
    && hrPageCss.includes('@media (prefers-reduced-motion: reduce)'));
check('HR Pulse responsive polish protects tablet scroll, mobile text, headers, and reduced motion',
    /width:\s*100%;/.test(hrPulseTabletNavRule)
    && /overflow-x:\s*auto;/.test(hrPulseTabletItemsRule)
    && /scrollbar-width:\s*none;/.test(hrPulseTabletItemsRule)
    && /display:\s*flex;/.test(hrPulseMobileItemsRule)
    && /flex-wrap:\s*nowrap;/.test(hrPulseMobileItemsRule)
    && /overflow-x:\s*auto;/.test(hrPulseMobileItemsRule)
    && /scrollbar-width:\s*none;/.test(hrPulseMobileItemsRule)
    && /--hr-pulse-content-gap:\s*12px;/.test(hrPulseMobileBlock)
    && /margin-bottom:\s*var\(--hr-pulse-content-gap\);/.test(hrPulseMobileBlock)
    && /flex:\s*0 0 var\(--pulse-switcher-card-width\);/.test(hrPulseMobileCardRule)
    && /width:\s*var\(--pulse-switcher-card-width\);/.test(hrPulseMobileCardRule)
    && /max-width:\s*var\(--pulse-switcher-card-max\);/.test(hrPulseMobileCardRule)
    && /min-width:\s*0;/.test(hrPulseSmallMobileContentRule)
    && !/padding-right:\s*26px;/.test(hrPulseSmallMobileContentRule)
    && /max-width:\s*100%;/.test(hrReportsHeroHeadingRule)
    && /overflow-wrap:\s*anywhere;/.test(hrReportsHeroHeadingRule)
    && /animation:\s*none\s*!important;/.test(hrReducedMotionBlock)
    && /transition:\s*none\s*!important;/.test(hrReducedMotionBlock)
    && /transform:\s*none\s*!important;/.test(hrReducedMotionBlock));
check('HR Pulse command cards do not depend on legacy nav PNG layers',
    legacyHrPulseNavTokens.every(token => !hrCode.includes(token) && !hrPageCss.includes(token)));
check('Warehouse owns the costume entry point instead of HR temporary navigation', htmlContains('warehouse.html', 'data-page-tab="costumes"') && htmlContains('warehouse.html', 'id="costumesTab"') && htmlContains('warehouse.html', 'id="warehouseCostumesList"') && htmlContains('warehouse.html', 'id="addCostumeBtn"') && htmlContains('warehouse.html', "switchPageTab('costumes')") && warehouseCode.includes("if (tab === 'costumes')") && warehouseCode.includes('loadWarehouseCostumes') && warehouseCode.includes('apiGetWarehouseCostumes') && !warehouseCode.includes("window.location.href = '/art?tab=costumes'") && warehouseCode.includes("hash === 'procurement' || hash === 'pinata' || hash === 'contractors' || hash === 'costumes'") && hrCode.includes("window.location.replace('/warehouse#costumes')") && !hrCode.includes("href: '/art?tab=costumes'"));
const hrPulseNavRule = hrHtmlForContracts.match(/\n\s*\.hr-nav--pulse(?:\s*,\s*\n\s*\.hr-nav--people)?\s*\{([\s\S]*?)\}/)?.[1] || '';
const hrPulseMobileNavRule = hrHtmlForContracts.match(/@media \(max-width: 768px\)\s*\{[\s\S]*?\.hr-nav--pulse\s*\{([\s\S]*?)\}/)?.[1] || '';
const hrTodayDateRule = hrHtmlForContracts.match(/\n\s*\.hr-today-date\s*\{([\s\S]*?)\}/)?.[1] || '';
const hrTodayDateMobileRule = hrHtmlForContracts.match(/@media \(max-width: 768px\)\s*\{[\s\S]*?\.hr-today-date\s*\{([\s\S]*?)\}/)?.[1] || '';
const hrTodayHeroRule = cssRuleText(hrPageCss, '.hr-today-hero');
const hrTodayHeroContentRule = cssRuleText(hrPageCss, '.hr-today-hero-content');
const hrTodayHeroMetricsRule = cssRuleText(hrPageCss, '.hr-today-hero-metrics');
const hrTodayMetricChipRule = cssRuleText(hrPageCss, '.hr-today-metric-chip');
const hrTodayHeroHeadingRule = cssRuleText(hrPageCss, '.hr-today-hero-copy h3');
const hrTodayMetricLabelRule = cssRuleText(hrPageCss, '.hr-today-metric-label');
const hrLoadKpiBlock = hrCode.slice(hrCode.indexOf('async function loadKpi'), hrCode.indexOf('async function loadRatings'));
check('HR Pulse Today date sits under the heading without returning to a date badge', htmlContains('hr.html', '.hr-nav--pulse + #tab-today.active') && /position:\s*relative;/.test(hrPulseNavRule) && /top:\s*auto;/.test(hrPulseNavRule) && !/position:\s*sticky;/.test(hrPulseNavRule) && /top:\s*auto;/.test(hrPulseMobileNavRule) && /display:\s*inline-flex;/.test(hrTodayDateRule) && /width:\s*fit-content;/.test(hrTodayDateRule) && /min-height:\s*22px;/.test(hrTodayDateRule) && /background:\s*transparent;/.test(hrTodayDateRule) && /border:\s*0;/.test(hrTodayDateRule) && htmlContains('hr.html', 'body.dark-mode .hr-today-date') && /width:\s*fit-content;/.test(hrTodayDateMobileRule));
check('HR Pulse Today has simplified CSS header metric chips, search, department segmentation, and no mini staff board',
    !htmlContains('hr.html', 'pulse-strip-dark.png')
    && !htmlContains('hr.html', 'pulse-strip-light.png')
    && !htmlContains('hr.html', 'hr-today-hero-img--light')
    && !htmlContains('hr.html', 'hr-today-hero-img--dark')
    && !hrPageCss.includes('pulse-strip-dark.png')
    && !hrPageCss.includes('pulse-strip-light.png')
    && !hrPageCss.includes('.hr-today-hero-media')
    && !hrPageCss.includes('.hr-today-hero-overlay')
    && htmlContains('hr.html', 'class="hr-today-hero"')
    && htmlContains('hr.html', 'class="hr-today-hero-metrics"')
    && !htmlContains('hr.html', 'hr-today-metric-chip--date')
    && !htmlContains('hr.html', 'hr-today-metric-chip--readiness')
    && htmlContains('hr.html', 'id="todayOnShiftMetric"')
    && htmlContains('hr.html', 'id="todayLateMetric"')
    && htmlContains('hr.html', 'id="todayAbsentMetric"')
    && htmlContains('hr.html', 'id="todayLeaveMetric"')
    && !htmlContains('hr.html', 'id="todayReadinessMetric"')
    && /background:\s*[\s\S]*linear-gradient/.test(hrTodayHeroRule)
    && !/url\(/.test(hrTodayHeroRule)
    && /display:\s*grid;/.test(hrTodayHeroContentRule)
    && /display:\s*grid;/.test(hrTodayHeroMetricsRule)
    && /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/.test(hrTodayHeroMetricsRule)
    && /border:\s*1px solid/.test(hrTodayMetricChipRule)
    && /background:\s*linear-gradient/.test(hrTodayMetricChipRule)
    && /max-width:\s*100%;/.test(hrTodayHeroHeadingRule)
    && /overflow-wrap:\s*anywhere;/.test(hrTodayHeroHeadingRule)
    && /min-width:\s*0;/.test(hrTodayMetricLabelRule)
    && /overflow-wrap:\s*anywhere;/.test(hrTodayMetricLabelRule)
    && hrPageCss.includes('body.dark-mode .hr-today-metric-chip')
    && hrPageCss.includes('html[data-theme="dark"] body .hr-today-metric-chip')
    && htmlContains('hr.html', '<h3>Сьогодні</h3>')
    && !htmlContains('hr.html', 'Команда сьогодні')
    && !htmlContains('hr.html', 'Пульс зміни')
    && !htmlContains('hr.html', 'Готовність')
    && htmlContains('hr.html', 'id="todayDate"')
    && htmlContains('hr.html', 'id="todaySearch"')
    && htmlContains('hr.html', 'id="todayDepartmentSegments"')
    && !htmlContains('hr.html', 'id="todayHoneycombBoard"')
    && htmlContains('hr.html', 'class="hr-today-controls"')
    && hrCode.includes('let todayFilters')
    && hrCode.includes('function renderTodayDepartmentSegments')
    && hrCode.includes('function filteredTodayItems')
    && hrCode.includes('function todaySearchHaystack')
    && hrCode.includes('let todayDisplayGroups = []')
    && hrCode.includes('let staffDisplayGroupsContract = []')
    && hrCode.includes('function staffDisplayGroupKeyForStaff')
    && hrCode.includes('function normalizeStaffDisplayGroups')
    && hrCode.includes('function setStaffDisplayGroupsContract')
    && hrCode.includes('todayDepartmentOptions(items = [], groups = staffDisplayGroupsContract)')
    && hrCode.includes('staffDisplayGroupKeyForStaff(item) !== department')
    && hrCode.includes('setStaffDisplayGroupsContract(data.displayGroups')
    && hrCode.includes('function summarizeTodayItems')
    && !hrCode.includes('function todayAttendanceStatus')
    && !hrCode.includes('function todayStaffPhotoUrl')
    && !hrCode.includes('function todayIsBirthday')
    && !hrCode.includes('function todayCompactStaffName')
    && !hrCode.includes('function renderTodayHoneycombTile')
    && !hrCode.includes('function renderTodayHoneycombBoard')
    && hrCode.includes('function todayHeaderMetricsFromSummary')
    && hrCode.includes('function updateTodayHeaderMetrics')
    && hrCode.includes("setTodayHeaderMetricText('todayOnShiftMetric'")
    && hrCode.includes("setTodayHeaderMetricText('todayLateMetric'")
    && hrCode.includes("setTodayHeaderMetricText('todayAbsentMetric'")
    && hrCode.includes("setTodayHeaderMetricText('todayLeaveMetric'")
    && !hrCode.includes("setTodayHeaderMetricText('todayReadinessMetric'")
    && !hrCode.includes('renderTodayHoneycombBoard(visibleItems)')
    && !hrCode.includes('todayCompactStaffName(name)')
    && !hrCode.includes('hr-today-hex-name')
    && hrCode.includes("todayFilters.department !== 'all'")
    && hrCode.includes('departmentLabel(item.department)')
    && htmlContains('hr.html', 'body.dark-mode .hr-today-controls')
    && htmlContains('hr.html', '.hr-today-segments')
    && htmlContains('hr.html', '.hr-today-hero')
    && htmlContains('hr.html', '.hr-today-hero .hr-today-date')
    && hrPageCss.includes('#tab-today .hr-summary:empty')
    && hrCode.includes("document.getElementById('todaySummary').innerHTML = '';")
    && htmlContains('hr.html', 'grid-template-columns: repeat(2, minmax(0, 1fr));')
    && !hrCode.includes('<div class="hr-summary-card red"><div class="value">${s.absent}</div>')
    && !hrCode.includes('<div class="hr-summary-card purple"><div class="value">${s.sick + s.on_vacation}</div>')
    && !hrCode.includes('<div class="hr-summary-card green"><div class="value">${s.present}</div><div class="label">На роботі</div></div>')
    && !hrCode.includes('<div class="hr-summary-card yellow"><div class="value">${s.late}</div><div class="label">Запізнились</div></div>')
    && hrPageCss.includes('#tab-today .hr-summary-card.purple::before')
    && !hrPageCss.includes('.hr-today-honeycomb-board')
    && !hrPageCss.includes('.hr-today-honeycomb-empty')
    && !hrPageCss.includes('.hr-today-hex-tile')
    && !hrPageCss.includes('.hr-today-hex-photo')
    && !hrPageCss.includes('.hr-today-hex-birthday')
    && !hrPageCss.includes('.hr-today-hex-name')
    && !hrPageCss.includes('.hr-today-hex-alert')
    && !hrCode.includes('hr-today-hex-alert')
    && !hrCode.includes('aria-hidden="true">!</span>')
    && !hrPageCss.includes('.hr-today-hex-tile:not(.has-photo)::before')
    && !hrPageCss.includes('clip-path: polygon(25% 6%, 75% 6%, 100% 50%, 75% 94%, 25% 94%, 0 50%);')
    && !hrCode.includes('data-birthday="${isBirthday ?')
    && hrRouteCode.includes('SELECT id, name, department, position, color, role_type, company_structure_node_id, photo_url, birth_date')
    && hrRouteCode.includes('is_birthday_today')
    && hrRouteCode.includes('birth_date: s.birth_date')
    && hrRouteCode.includes('photo_url: s.photo_url')
    && hrRouteCode.includes('has_photo: Boolean')
    && hrRouteCode.includes('FROM staff')
    && hrRouteCode.includes('summarizeHrTodayItems(data)')
    && hrAttendanceServiceCode.includes('function summarizeHrTodayItems')
    && hrAttendanceServiceCode.includes('if (isAttendanceRecordOpen(record)) summary.present += 1')
    && hrAttendanceServiceCode.includes('const facts = attendanceFactMinutes(record)')
    && hrRouteCode.includes('department: s.department')
    && hrRouteCode.includes('position: s.position')
    && !htmlContains('hr.html', 'todayHoneycombMenu')
    && !htmlContains('hr.html', 'todayHoneycombTabs')
    && !hrCode.includes('todayHoneycombMenu')
    && !hrCode.includes('todayHoneycombTabs')
    && !hrPageCss.includes('hr-today-honeycomb-menu')
    && !hrPageCss.includes('hr-today-honeycomb-tabs'));
check('HR Pulse Today metrics open matching people and focus the selected row',
    htmlContains('hr.html', '<button type="button" class="hr-today-metric-chip')
    && htmlContains('hr.html', 'aria-controls="todayMetricPeoplePanel"')
    && htmlContains('hr.html', 'id="todayMetricPeoplePanel"')
    && htmlScriptLoadsBefore('hr.html', 'js/hr-attendance-state.js', 'js/hr-page.js')
    && hrAttendanceStateCode.includes('record && record.clock_in && !record.clock_out')
    && hrCode.includes('function isTodayItemOnShift')
    && hrCode.includes('HrAttendanceState.isAttendanceRecordOpen(item.record)')
    && !hrCode.includes('item.record?.clock_in && !item.record?.clock_out')
    && hrCode.includes('function todayMetricMatchesItem')
    && hrCode.includes('function renderTodayMetricPeoplePanel')
    && hrCode.includes('function focusTodayStaffFromMetric')
    && hrCode.includes('data-today-metric-staff-id=')
    && hrCode.includes("row.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' })")
    && hrPageCss.includes('.hr-today-metric-chip[aria-expanded="true"]')
    && hrPageCss.includes('.hr-today-metric-people-list')
    && hrPageCss.includes('.hr-today-metric-person:focus-visible')
    && hrPageCss.includes('.hr-staff-row.hr-staff-row--metric-focus'));
check('HR Pulse Reports has Today-style header metrics, compact controls, export, and report tables',
    !htmlContains('hr.html', 'images/hr-pulse/reports-kpi.png')
    && !hrPageCss.includes('reports-kpi.png')
    && !hrPageCss.includes('.hr-reports-hero-media')
    && !hrPageCss.includes('.hr-reports-hero-overlay')
    && htmlContains('hr.html', 'class="hr-reports-hero"')
    && htmlContains('hr.html', 'class="hr-reports-hero-metrics"')
    && htmlContains('hr.html', 'class="hr-reports-metric-chip')
    && htmlContains('hr.html', 'id="reportHeroAttendance"')
    && htmlContains('hr.html', 'id="reportHeroAttendanceMeta"')
    && htmlContains('hr.html', 'id="reportHeroLate"')
    && htmlContains('hr.html', 'id="reportHeroAbsent"')
    && htmlContains('hr.html', 'id="reportHeroTasks"')
    && htmlContains('hr.html', 'id="reportHeroTasksMeta"')
    && !htmlContains('hr.html', 'id="reportHeroCsv"')
    && !htmlContains('hr.html', 'id="reportHeroKpi"')
    && !htmlContains('hr.html', 'id="reportHeroRisks"')
    && !htmlContains('hr.html', 'id="reportHeroSummary"')
    && htmlContains('hr.html', 'class="hr-report-controls hr-report-command-bar workspace-command-bar"')
    && htmlContains('hr.html', 'id="reportMonth"')
    && htmlContains('hr.html', 'id="reportExport"')
    && htmlContains('hr.html', 'id="reportSummary"')
    && htmlContains('hr.html', 'id="reportHead"')
    && htmlContains('hr.html', 'id="reportBody"')
    && hrCode.includes('function canExportHrReports()')
    && hrCode.includes('reportExport.hidden = !canExportHrReports()')
    && hrCode.includes("reportExport.addEventListener('click', exportCSV)")
    && hrCode.includes('function formatReportOverdueTasks')
    && hrCode.includes('function formatReportHours')
    && hrCode.includes('function formatReportPlanWarnings')
    && !hrCode.includes('totalOvertime.toFixed(0)')
    && !hrCode.includes('⚠ ${r.plan_warning_count}')
    && hrCode.includes('function reportHeaderMetricsFromRows')
    && hrCode.includes('function updateReportHeaderMetrics')
    && hrCode.includes("setReportHeaderMetricText('reportHeroAttendance'")
    && hrCode.includes("setReportHeaderMetricText('reportHeroLate'")
    && hrCode.includes("setReportHeaderMetricText('reportHeroAbsent'")
    && hrCode.includes("setReportHeaderMetricText('reportHeroTasks'")
    && !hrCode.includes("setReportHeaderMetricText('reportHeroCsv'")
    && !hrCode.includes("setReportHeaderMetricText('reportHeroKpi'")
    && !hrCode.includes("setReportHeaderMetricText('reportHeroRisks'")
    && !hrCode.includes("setReportHeaderMetricText('reportHeroSummary'")
    && hrCode.includes('hr-report-stat--presence')
    && hrCode.includes('hr-report-stat--late')
    && hrCode.includes('hr-report-stat--absence')
    && hrCode.includes('hr-report-stat--overtime')
    && hrCode.includes('hr-report-stat--tasks')
    && hrCode.includes('hr-report-stat--kpi')
    && hrCode.includes('hr-report-stat--overdue')
    && /background:\s*[\s\S]*linear-gradient/.test(hrReportsHeroRule)
    && !/url\(/.test(hrReportsHeroRule)
    && /display:\s*grid;/.test(hrReportsHeroContentRule)
    && /display:\s*grid;/.test(hrReportsHeroMetricsRule)
    && /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/.test(hrReportsHeroMetricsRule)
    && /border:\s*1px solid/.test(hrReportsMetricChipRule)
    && /background:\s*linear-gradient/.test(hrReportsMetricChipRule)
    && hrPageCss.includes('body.dark-mode .hr-reports-metric-chip')
    && hrPageCss.includes('.hr-report-controls')
    && hrPageCss.includes('#tab-reports .hr-report-table')
    && hrPageCss.includes('body.dark-mode #tab-reports .hr-report-table'));
check('HR Pulse Today moves arrived people to review bottom with color indication', hrCode.includes('const TODAY_ARRIVED_STATUSES') && hrCode.includes('function isTodayItemArrived') && hrCode.includes('function sortTodayItemsForReview') && hrCode.includes('return sortTodayItemsForReview(filtered);') && hrCode.includes('hr-staff-row--arrived') && hrCode.includes('data-attendance-state="${arrived ?') && htmlContains('hr.html', '.hr-staff-row--arrived') && htmlContains('hr.html', 'body.dark-mode .hr-staff-row.hr-staff-row--arrived'));
check('HR Today quick actions open target profile and focused schedule with SVG controls',
    hrCode.includes('await _loadStaffLinks().catch(() => [])')
    && hrCode.includes('function renderTodayStaffProfileAction')
    && hrCode.includes('function renderTodayStaffScheduleAction')
    && hrCode.includes('function openTodayStaffSchedule')
    && hrCode.includes('openStaffProfile(${userId})')
    && hrCode.includes('/hr?scheduleStaff=${encodeURIComponent(id)}#schedule')
    && hrCode.includes('window.StaffSchedulePage.focusStaff(id)')
    && hrCode.includes("hrTodayActionIconSvg('profile')")
    && hrCode.includes("hrTodayActionIconSvg('schedule')")
    && hrCode.includes('class="hr-today-row-action hr-today-row-action--profile"')
    && hrCode.includes('class="hr-today-row-action hr-today-row-action--schedule"')
    && !hrCode.includes('/staff?highlight=')
    && staffCode.includes('function scheduleFocusStaffIdFromLocation')
    && staffCode.includes("params.get('scheduleStaff')")
    && staffCode.includes("params.get('highlight')")
    && staffCode.includes('function focusScheduleStaff')
    && staffCode.includes('focusStaff: focusScheduleStaff')
    && staffCode.includes('data-schedule-staff-row="${Number(emp.id)}"')
    && staffCssForUiPolish.includes('.schedule-table tbody tr.is-schedule-focus td')
    && !hrCode.includes('staffAccountBadge(item.staff_id')
    && !hrCode.includes('>📅</a>')
    && uiCode.includes("openSafeNewTab('/profile?id='")
    && !uiCode.includes("openSafeNewTab('/profile?user='")
    && uiCode.includes('function staffAccountBadgeIconSvg')
    && baseCss.includes('.staff-crm-badge svg')
    && hrPageCss.includes('.hr-today-row-action svg')
    && hrPageCss.includes('body.dark-mode #tab-today .hr-today-row-action')
    && dashboardPageCode.includes('openStaffProfile(${profileArg})')
    && !dashboardPageCode.includes("openStaffProfile('${profileArg}')")
    && !dashboardPageCode.includes('>👤</span>'));
check('HR schedule UI filters scheduleable staff, replacements, and stale lifecycle rows', hrCode.includes('function isHrScheduleableStaffForDate') && hrCode.includes('function hrScheduleableStaffErrorMessage') && hrCode.includes('async function refreshHrOperationalViews') && hrCode.includes('scheduleStaff = hrScheduleableStaffForUi(staffData.data || [])') && hrCode.includes('const scheduleableIds = new Set(scheduleStaff.map(staff => Number(staff.id)).filter(Number.isFinite))') && hrCode.includes('const visibleStaff = hrScheduleableStaffForUi(scheduleStaff);') && hrCode.includes('!staff || !isHrScheduleableStaffForDate(staff, date)') && hrCode.includes("isHrScheduleableStaffForDate(s, editingShift.existing.shift_date || editingShift.date)") && hrCode.includes("action !== 'out' && todayItem && !isHrScheduleableStaffForDate(todayItem, todayStr())") && hrCode.includes("return { ...data, success: false, status: resp.status, error: data.error || `HTTP ${resp.status}` };") && hrCode.includes('await refreshHrOperationalViews();'));
check('HR and staff schedule reads use shared scheduleable staff filters', hrRouteCode.includes("require('../services/staffOperationalFilters')") && hrRouteCode.includes('function operationalStaffForDateWhere') && hrRouteCode.includes('return scheduleableStaffWhere(alias, { dateExpression });') && hrRouteCode.includes("scheduleableStaffWhere('staff', {") && hrRouteCode.includes("scheduleableStaffWhere('s', { dateExpression: 'hs.shift_date' })") && staffRouteCode.includes('function activeScheduleStaffWhere') && staffRouteCode.includes('return scheduleableStaffWhere(alias, {') && staffRouteCode.includes("activeScheduleStaffWhere('s', 'ss.date')") && staffRouteCode.includes("activeScheduleStaffWhere('staff', 'CURRENT_DATE'") && htmlContains('services/staffOperationalFilters.js', "COALESCE(${safeAlias}.hr_pool_status, 'core') = 'core'") && htmlContains('services/staffOperationalFilters.js', "COALESCE(${safeAlias}.is_freelance, false) = false") && htmlContains('services/booking.js', "scheduleableStaffWhere('s', { dateExpression: 'ss.date' })") && htmlContains('routes/bookings.js', "scheduleableStaffWhere('s', { dateExpression: '$3' })") && htmlContains('routes/lines.js', "scheduleableStaffWhere('s', { dateExpression: 'l.date' })"));
check('Camera check-in syncs into HR Today attendance records', staffRouteCode.includes('getKyivDate,') && staffRouteCode.includes('getKyivDateStr,') && staffRouteCode.includes("} = require('../services/booking');") && staffRouteCode.includes('recordAttendanceClockIn(client') && staffRouteCode.includes('recordAttendanceClockOut(client') && hrAttendanceServiceCode.includes('async function recordAttendanceClockIn') && hrAttendanceServiceCode.includes('async function recordAttendanceClockOut') && hrAttendanceServiceCode.includes('INSERT INTO hr_time_records') && staffRouteCode.includes('hrTimeRecord = clockInResult.record') && staffRouteCode.includes('hrTimeRecord = clockOutResult.record') && staffRouteCode.includes('WHERE staff_id = $2 AND date = $3') && staffRouteCode.includes('const date = req.query.date || getKyivDateStr();') && staffRouteCode.includes("broadcast('hr:attendance-updated'") && htmlContains('js/ws.js', "case 'hr:attendance-updated':") && hrCode.includes('function initHrRealtime') && hrCode.includes("window.addEventListener('ws:hr-attendance'") && htmlContains('hr.html', 'js/ws.js'));
check('HR clock-out payroll uses shared scheduled/manual and actual/camera settlement paths', hrAttendanceServiceCode.includes('function calculateHrClockOutPayroll') && hrAttendanceServiceCode.includes('async function recordAttendanceClockOut') && hrAttendanceServiceCode.includes("settlementMode: useScheduled ? 'scheduled_shift' : 'actual_time'") && hrAttendanceServiceCode.includes('plannedShiftWorkedMinutes') && hrRouteCode.includes('recordAttendanceClockOut(client') && hrRouteCode.includes('settlementMode: settlement_mode || settlementMode') && hrAttendanceServiceCode.includes('business_context = COALESCE(business_context') && staffRouteCode.includes('recordAttendanceClockOut(client') && staffRouteCode.includes("settlementMode: 'actual_time'") && hrCode.includes("body.settlement_mode = 'scheduled_shift'") && hrCode.includes('У зарплату буде зараховано планову зміну'));
check('HR button contract has explicit button types and a focused Node test', hrImplicitButtons.length === 0 && packageJsonText.includes('tests/hr-button-contract.test.js'));
check('HR legacy tab ids remap to canonical grouped destinations', hrCode.includes('const HR_TAB_ALIASES') && hrCode.includes("workers: { tab: 'team', bucket: 'workers' }") && hrCode.includes("ratings: { tab: 'kpi' }") && hrCode.includes("leaves: { tab: 'schedule' }") && hrCode.includes("reserve: { tab: 'team', bucket: 'reserve' }") && hrCode.includes("blacklist: { tab: 'team', bucket: 'blacklist' }") && hrCode.includes("dismissed: { tab: 'team', bucket: 'dismissed' }") && hrCode.includes("terminated: { tab: 'team', bucket: 'dismissed' }") && hrCode.includes("'ai-team': { tab: 'today' }") && hrCode.includes("window.location.replace('/warehouse#costumes')"));
check('HR Team uses Pulse-style bucket navigation and category-local search',
    pagesCss.includes('v0.73.53: HR Team uses the same segmented rhythm')
    && pagesCss.includes('.hr-nav.hr-nav--people')
    && pagesCss.includes('.hr-nav.hr-nav--people .hr-nav-items')
    && pagesCss.includes('grid-template-columns: repeat(5, minmax(0, 1fr));')
    && pagesCss.includes('.hr-team-controls')
    && pagesCss.includes('.hr-team-filter-info')
    && pagesCss.includes('grid-template-columns: minmax(220px, 1fr) auto;')
    && !pagesCss.includes('.hr-team-active-toggle')
    && htmlContains('hr.html', 'class="hr-team-controls"')
    && htmlContains('hr.html', 'id="teamFilterInfo"')
    && !htmlContains('hr.html', 'teamArchiveSearch')
    && !htmlContains('hr.html', 'teamRoleFilter')
    && !htmlContains('hr.html', 'hr-team-section-head')
    && htmlContains('css/hr-page.css', '.hr-people-results')
    && htmlContains('css/hr-page.css', '.hr-people-results-grid')
    && htmlContains('css/hr-page.css', '.hr-team-bucket-badge')
    && hrCode.includes('const PEOPLE_BUCKETS')
    && hrCode.includes('const HR_PEOPLE_WORKSPACE_TABS')
    && hrCode.includes('function isHrPeopleWorkspaceTab')
    && hrCode.includes("{ id: 'workers', label: 'Робітники', tab: 'team', bucket: 'workers', visible: () => canSeeHrTeamBucket('workers') }")
    && hrCode.includes("{ id: 'interns', label: 'Стажери', tab: 'team', bucket: 'interns', visible: () => canSeeHrTeamBucket('interns') }")
    && hrCode.includes("{ id: 'blacklist', label: 'Чорний список', tab: 'team', bucket: 'blacklist', visible: () => canSeeHrTeamBucket('blacklist') }")
    && hrCode.includes("{ id: 'reserve', label: 'Резерв', tab: 'team', bucket: 'reserve', visible: () => canSeeHrTeamBucket('reserve') }")
    && hrCode.includes("{ id: 'dismissed', label: 'Звільнені', tab: 'team', bucket: 'dismissed', visible: () => canSeeHrTeamBucket('dismissed') }")
    && hrCode.includes("if (staff.is_active === false) return 'dismissed';")
    && !hrCode.includes("{ id: 'team', label: 'Команда', tab: 'team' }")
    && hrCode.includes('function getHrTeamBucketAccess')
    && hrCode.includes('function visiblePeopleBuckets')
    && hrCode.includes('function normalizeVisiblePeopleBucket')
    && hrCode.includes('function canSeeHrTeamBucket')
    && hrCode.includes('function canManageHrTeamBucketVisibility')
    && hrCode.includes('let activePeopleBucket = null')
    && hrCode.includes('function setHrNavTeamMode')
    && hrCode.includes("nav.classList.toggle('hr-nav--people'")
    && hrCode.includes("if (header) header.hidden = pulseMode || peopleMode")
    && hrCode.includes('function clearTeamSearchOnBucketChange')
    && hrCode.includes('activePeopleBucket = requestedBucket')
    && hrCode.includes('activePeopleBucket = nextBucket')
    && hrCode.includes('const activeStaff = teamStaff.filter(item => bucketForStaff(item) === activePeopleBucket);')
    && hrCode.includes('activeStaff.filter(item => teamSearchHaystack(item).includes(query))')
    && !hrCode.includes('teamArchiveSearch')
    && hrCode.includes('function updateTeamFilterInfo')
    && hrCode.includes('totalCount')
    && hrCode.includes('window.setPeopleBucket')
    && hrCode.includes('syncHrNavActive')
    && hrCode.includes('aria-pressed')
    && hrCode.includes('updatePeopleNavCounts(grouped)')
    && hrCode.includes('renderPeopleBucketState')
    && hrCode.includes('renderTeamBucket')
    && hrCode.includes('renderTeamSearchResults')
    && htmlContains('css/hr-page.css', 'hr-people-empty--loading')
    && htmlContains('css/hr-page.css', 'hr-people-empty--error')
    && !hrCode.includes('function loadReservePool')
    && !hrCode.includes('function renderAITeam'));
check('HR Team profile modal uses compact dropdown picker for secondary professions', htmlContains('hr.html', 'id="editSecondaryProfessionPicker"') && htmlContains('hr.html', 'hr-profession-picker') && htmlContains('hr.html', 'id="editSecondaryProfessionChips"') && htmlContains('hr.html', 'id="editSecondaryProfessionOptions"') && htmlContains('hr.html', 'Основна професія') && hrCode.includes('function bindSecondaryProfessionPicker') && hrCode.includes('function setSecondaryProfessionPickerOpen') && hrCode.includes('data-secondary-add') && hrCode.includes('data-secondary-remove') && hrCode.includes('setSelectedSecondaryProfessionKeys') && hrCode.includes('syncHiddenSecondaryProfessionSelect') && htmlContains('css/hr-page.css', '.hr-profession-picker.is-open .hr-profession-options') && htmlContains('css/hr-page.css', 'position: absolute') && htmlContains('css/hr-page.css', 'max-height: 220px'));
check('HR Team cards use compact profile action, word-safe names, status chips, training indicator, and overflow actions', htmlContains('css/hr-page.css', '.hr-team-card-head') && htmlContains('css/hr-page.css', '.hr-team-card-actions') && htmlContains('css/hr-page.css', '-webkit-line-clamp: 2') && htmlContains('css/hr-page.css', 'overflow-wrap: break-word') && htmlContains('css/hr-page.css', 'word-break: normal') && htmlContains('css/hr-page.css', '.hr-team-profession-area') && htmlContains('css/hr-page.css', '.hr-team-status-row') && htmlContains('css/hr-page.css', '.hr-team-status-chip') && htmlContains('css/hr-page.css', '.hr-team-training-compact') && htmlContains('css/hr-page.css', '.hr-team-overflow-menu') && hrCode.includes('function renderTeamCardStatusChips') && hrCode.includes('function renderTeamTrainingCompact') && hrCode.includes('function renderTeamCardOverflowMenu') && hrCode.includes('const cardActions = [profileTopAction, overflowMenu]') && hrCode.includes('hr-team-open') && hrCode.includes('hr-team-overflow-trigger') && hrCode.includes('hr-team-menu-section--danger') && hrCode.includes('тільки для дубля') && hrCode.includes('function buildStaffMovePayload') && hrCode.includes('function openStaffMoveMenu') && hrCode.includes('window.openStaffMoveMenu = openStaffMoveMenu') && hrCode.includes("body.hr_pool_status = 'reserve'") && hrCode.includes("body.role_type = 'intern'") && hrCode.includes('preferredWorkerRoleForStaff') && hrCode.includes('function setStaffProfileActive') && hrCode.includes("normalizedTarget === 'dismissed'") && hrCode.includes('вкладку завершення співпраці') && hrCode.includes('Звільнення:') && !hrCode.includes('<div class="hr-team-contact-grid"') && hrRouteCode.includes("termination_date = NULL") && hrRouteCode.includes("UPDATE employee_profiles") && hrRouteCode.includes("UPDATE users") && hrRouteCode.includes("staff_rehire") && pagesCss.includes('.hr-team-card.inactive') && !htmlContains('hr.html', '.hr-team-card.inactive { opacity: 0.5;'));
check('HR Team preserves card readiness indicators without a setup filter surface',
    hrCode.includes('function staffHasProfilePhoto')
    && hrCode.includes('function staffHasFaceDescriptor')
    && hrCode.includes('function staffHasCrmAccount')
    && hrCode.includes('function staffHasStructureLink')
    && hrCode.includes('function renderStaffReadinessBadges')
    && hrCode.includes('function renderTeamCardStatusChips')
    && hrCode.includes('function renderTeamTrainingCompact')
    && hrCode.includes('function renderTeamOnboardingCompact')
    && hrCode.includes('Фото профілю')
    && hrCode.includes('Камера / Face ID')
    && hrCode.includes('staff_face_descriptors')
    && !hrCode.includes('HR_TEAM_SETUP_FILTERS')
    && !hrCode.includes('renderTeamSetupBanner')
    && !hrCode.includes('setTeamSetupFilter')
    && !htmlContains('hr.html', 'teamMissingBanner')
    && !htmlContains('hr.html', 'teamArchiveSearch')
    && !htmlContains('css/hr-page.css', '.hr-setup-'));
check('HR Team browser smoke covers drawer, category-local search, race, theme, mobile, and focus regressions',
    pkg.scripts?.['test:browser:hr-team'] === 'npm exec --yes --package=playwright -c "node tests/browser/hr-team-browser-smoke.js"'
    && hrTeamBrowserSmokeCode.includes('assertTeamNavigation')
    && hrTeamBrowserSmokeCode.includes('assertProfileCleanDirtyAndFocus')
    && hrTeamBrowserSmokeCode.includes('assertRapidProfileSwitching')
    && hrTeamBrowserSmokeCode.includes('assertHistoryRaceAndLazyTabs')
    && hrTeamBrowserSmokeCode.includes('assertCardLayoutAndOverflow')
    && hrTeamBrowserSmokeCode.includes('assertFocusTrap')
    && hrTeamBrowserSmokeCode.includes('assertScopedSavesAndActionStates')
    && hrTeamBrowserSmokeCode.includes('assertMobileAndTheme')
    && hrTeamBrowserSmokeCode.includes('CATEGORY_LOCAL_SEARCH_CASES')
    && hrTeamBrowserSmokeCode.includes('neighborName')
    && hrTeamBrowserSmokeCode.includes('search input clears before rendering a different bucket')
    && hrTeamBrowserSmokeCode.includes('activateBucket')
    && hrTeamBrowserSmokeCode.includes('navigateHash')
    && hrTeamBrowserSmokeCode.includes('setRoleVisibility')
    && hrTeamBrowserSmokeCode.includes('Dismissed Epsilon')
    && hrTeamBrowserSmokeCode.includes("[390, 768, 1280, 1440]")
    && hrTeamBrowserSmokeCode.includes('stale history response')
    && hrTeamBrowserSmokeCode.includes('does not duplicate its request')
    && hrTeamBrowserSmokeCode.includes('aria-pressed')
    && hrTeamBrowserSmokeCode.includes('non-sticky')
    && !pkg.scripts?.verify?.includes('test:browser:hr-team'));
check('HR Team browser smoke is a required Chromium CI gate',
    ciWorkflow.includes('hr-team-browser:')
    && ciWorkflow.includes('name: HR Team browser smoke')
    && ciWorkflow.includes('playwright install --with-deps chromium')
    && ciWorkflow.includes('run: npm run test:browser:hr-team'));
check('Task Center theme browser smoke is computed-style based and required in Chromium CI',
    pkg.scripts?.['test:browser:task-center'] === 'npx --yes --package playwright node tests/browser/task-center-parity-browser-smoke.js'
    && ciWorkflow.includes('Run Task Center theme browser smoke')
    && ciWorkflow.includes('run: npm run test:browser:task-center')
    && !pkg.scripts?.verify?.includes('test:browser:task-center')
    && pagesTasksCss.includes('body.dark-mode .task-center-query-row input')
    && pagesTasksCss.includes('html[data-theme="dark"] .task-center-query-row input')
    && pagesTasksCss.includes('body.dark-mode .task-center-query-row select')
    && pagesTasksCss.includes('html[data-theme="dark"] .task-center-saved-views-row select')
    && pagesTasksCss.includes('.task-center-query-row input::placeholder')
    && pagesTasksCss.includes('.task-center-saved-views-row select:disabled')
    && pagesTasksCss.includes('body.dark-mode .task-overview-count')
    && pagesTasksCss.includes('html[data-theme="dark"] .task-overview-reason')
    && pagesTasksCss.includes('body.dark-mode .task-overview-action')
    && pagesTasksCss.includes('body.dark-mode .task-team-owner-card p')
    && pagesTasksCss.includes('html[data-theme="dark"] .task-team-metric')
    && pagesTasksCss.includes('body.dark-mode .task-planning-table td')
    && pagesTasksCss.includes('html[data-theme="dark"] .task-planning-table td.is-overload')
    && pagesTasksCss.includes('body.dark-mode .task-planning-day-tasks button')
    && !/--input-bg\s*:/.test(pagesTasksCss)
    && taskCenterBrowserSmokeCode.includes('function assertTaskCenterQueryThemeContract')
    && taskCenterBrowserSmokeCode.includes('function assertTaskCenterOperationalDarkSurfaces')
    && taskCenterBrowserSmokeCode.includes('getComputedStyle(el)')
    && taskCenterBrowserSmokeCode.includes("getComputedStyle(el, '::placeholder')")
    && taskCenterBrowserSmokeCode.includes('contrastRatio(foreground, background) >= 4.5')
    && taskCenterBrowserSmokeCode.includes('is not a white surface')
    && taskCenterBrowserSmokeCode.includes('planning overload cell')
    && taskCenterBrowserSmokeCode.includes('assert.equal(nonDateControls.length, 7')
    && taskCenterBrowserSmokeCode.includes('assert.equal(dateControls.length, 2')
    && taskCenterBrowserSmokeCode.includes("document.documentElement.setAttribute('data-theme', 'dark')")
    && taskCenterBrowserSmokeCode.includes('assertTaskCenterLightThemeUnchanged')
    && taskCenterBrowserSmokeCode.includes("el.disabled = true"));
check('HR Today metrics browser smoke covers polling, realtime, focus, mobile, and is required in Chromium CI',
    pkg.scripts?.['test:browser:hr-today'] === 'npm exec --yes --package=playwright -c "node tests/browser/hr-today-metrics-browser-smoke.js"'
    && hrTodayBrowserSmokeCode.includes('assertMetricLists')
    && hrTodayBrowserSmokeCode.includes('assertKeyboardAndFocus')
    && hrTodayBrowserSmokeCode.includes('assertPollingAndRealtime')
    && hrTodayBrowserSmokeCode.includes('assertMobileThemeAndReducedMotion')
    && hrTodayBrowserSmokeCode.includes("window.dispatchEvent(new CustomEvent('ws:hr-attendance'))")
    && hrTodayBrowserSmokeCode.includes("Number(delay) === 30000 ? 80 : delay")
    && ciWorkflow.includes('Run HR Today metrics browser smoke')
    && ciWorkflow.includes('run: npm run test:browser:hr-today'));
check('HR Team browser smoke mounts the production drawer and protects its visual contract',
    hrTeamBrowserSmokeCode.includes("const STAFF_EDIT_MODAL_HTML = extractElementMarkup(HR_HTML, 'staffEditModal');")
    && hrTeamBrowserSmokeCode.includes('window.__hrTeamBrowserModalMarkup = markup;')
    && hrTeamBrowserSmokeCode.includes('window.__hrTeamBrowserModalMarkup,')
    && !hrTeamBrowserSmokeCode.includes("'<div id=\"staffEditModal\"")
    && hrTeamBrowserSmokeCode.includes('assertExactProfileTabPanels')
    && hrTeamBrowserSmokeCode.includes('assertDrawerGeometryAndButtonStyles')
    && hrTeamBrowserSmokeCode.includes('exactly seven direct tab panels')
    && hrTeamBrowserSmokeCode.includes('header does not overlap tabs')
    && hrTeamBrowserSmokeCode.includes('tabs do not overlap scroll body')
    && hrTeamBrowserSmokeCode.includes('is not a browser-default button'));
check('HR staff history translates schedule replacement actions and field keys',
    hrCode.includes("staff_schedule_replacement_set: 'Призначено підміну зміни'")
    && hrCode.includes("staff_schedule_replacement_clear_removed: 'Знято підміну зі зміни'")
    && hrCode.includes("shiftStart: 'початок зміни'")
    && hrCode.includes("professionKey: 'професія'")
    && hrCode.includes("replacementReason: 'причина підміни'")
    && hrTeamBrowserSmokeCode.includes('history does not expose raw internal labels'));
check('HR Team profile action has a single primary open button instead of avatar/name/profile duplicates', hrCode.includes('const profileClick = `openStaffEdit(${Number(s.id)})`;') && hrCode.includes('hr-team-open') && hrCode.includes("card?.querySelector?.('.hr-team-open, .hr-team-overflow-trigger')") && !hrCode.includes('hr-team-profile-trigger') && !hrCode.includes('hr-team-name-button') && !hrCode.includes('hr-team-edit hr-team-edit--top') && htmlContains('css/hr-page.css', '.hr-team-open') && htmlContains('css/hr-page.css', '.hr-team-overflow-trigger'));
check('HR staff profile opens with team identity card and editable name/phone/photo row',
    htmlContains('hr.html', 'class="hr-staff-profile-panel hr-staff-profile-hero"')
    && htmlContains('hr.html', 'id="editStaffHeaderName"')
    && htmlContains('hr.html', 'id="editStaffName"')
    && htmlContains('hr.html', 'id="editPhone"')
    && htmlContains('hr.html', 'id="editPhotoPreview"')
    && htmlContains('hr.html', 'id="editPhotoUrl"')
    && hrCode.includes('function syncStaffProfileHeaderName')
    && hrCode.includes('function updateStaffPhotoPreview')
    && hrCode.includes('function clearStaffPhotoUrl')
    && hrCode.includes("name: document.getElementById('editStaffName')?.value || null")
    && hrCode.includes("photo_url: document.getElementById('editPhotoUrl')?.value?.trim() || null")
    && hrRouteCode.includes("queueStaffUpdate('name'")
    && hrRouteCode.includes('function normalizeStaffPhotoUrl')
    && hrRouteCode.includes("queueStaffUpdate('photo_url'")
    && hrRouteCode.includes("'photo_url'")
    && htmlContains('css/hr-page.css', '.hr-staff-profile-card')
    && htmlContains('css/hr-page.css', '.hr-staff-profile-quick-fields')
    && htmlContains('css/hr-page.css', '.hr-staff-profile-quick-fields input')
    && htmlContains('css/hr-page.css', '.hr-staff-photo-editor')
    && htmlContains('css/hr-page.css', '.hr-staff-photo-preview')
    && htmlContains('css/hr-page.css', 'body.dark-mode .hr-staff-profile-quick-fields input'));
check('HR staff profile uses drawer tabs, lazy profile loaders, and explicit save scopes',
    htmlContains('hr.html', 'class="hr-modal-overlay hr-staff-profile-overlay"')
    && htmlContains('hr.html', 'class="hr-staff-profile-tabs" role="tablist"')
    && htmlContains('hr.html', 'data-staff-profile-tab="main"')
    && htmlContains('hr.html', 'data-staff-profile-tab="offboarding"')
    && htmlContains('hr.html', 'id="editStaffHeaderMeta"')
    && htmlContains('hr.html', 'Зберегти основне')
    && htmlContains('hr.html', 'Зберегти типові зміни')
    && htmlContains('hr.html', 'Зберегти ролі та допуски')
    && hrCode.includes("payrollSave.textContent = 'Зберегти базові ставки'")
    && htmlContains('css/hr-page.css', '.hr-staff-profile-overlay')
    && htmlContains('css/hr-page.css', '.hr-staff-profile-drawer-head')
    && htmlContains('css/hr-page.css', '.hr-staff-profile-tabs')
    && htmlContains('css/hr-page.css', '.hr-staff-profile-body')
    && htmlContains('css/hr-page.css', '.hr-staff-profile-close')
    && htmlContains('css/hr-page.css', '.hr-staff-profile-save-scope')
    && htmlContains('hr.html', 'id="editCloseTop" class="hr-staff-profile-close"')
    && !htmlContains('hr.html', 'id="editCancel"')
    && !htmlContains('hr.html', 'hr-staff-profile-bottom-actions')
    && hrCode.includes('const STAFF_PROFILE_TABS')
    && hrCode.includes('function activateStaffProfileTab')
    && hrCode.includes('function loadStaffProfileTabData')
    && hrCode.includes('function loadStaffDocumentsAndResources')
    && hrCode.includes('function loadStaffOffboardingSurface')
    && hrCode.includes('function staffProfileDirtyScopes')
    && hrCode.includes("if (tab === 'history')")
    && !/hydrateStaffEditProfile[\s\S]{0,900}loadStaffProfileHistory\(numericStaffId\)/.test(hrCode));
check('HR staff profile shows derived lifecycle checklist without a new schema',
    htmlContains('hr.html', 'id="editStaffLifecycleChecklist"')
    && htmlContains('hr.html', 'class="hr-staff-profile-panel hr-staff-foundation-panel hr-lifecycle-panel"')
    && htmlContains('hr.html', 'Чекліст життєвого циклу')
    && !htmlContains('hr.html', 'Lifecycle checklist')
    && hrCode.includes('function renderStaffLifecycleChecklist')
    && hrCode.includes('function loadStaffLifecycleChecklist')
    && hrCode.includes("hrFetch(`/staff/${id}/lifecycle-checklist`)")
    && hrCode.includes('renderLifecycleSection')
    && hrCode.includes('Готовність онбордингу')
    && hrCode.includes('Закриття співпраці')
    && hrCode.includes('завершення не почато')
    && hrCode.includes('Незакрита зарплата')
    && hrCode.includes('Майбутні зміни')
    && hrCode.includes('CRM-акаунти:')
    && hrRouteCode.includes('function loadStaffLifecycleChecklist')
    && hrRouteCode.includes("router.get('/staff/:id/lifecycle-checklist', requireHrManage")
    && hrRouteCode.includes('hiring_application: hiringApplication')
    && /FROM job_applications a[\s\S]*a\.staff_id = \$1/.test(hrRouteCode)
    && hrFoundationCss.includes('.hr-lifecycle-panel')
    && hrFoundationCss.includes('.hr-lifecycle-summary')
    && hrFoundationCss.includes('body.dark-mode .hr-lifecycle-panel'));
check('HR print documents modal keeps responsive design-system controls and a stable blob preview',
    hrHtmlForContracts.includes('class="btn-page-secondary hr-print-documents-trigger"')
    && hrHtmlForContracts.includes('id="hrPrintPreviewButton" class="btn-page-primary"')
    && hrHtmlForContracts.includes('id="hrPrintDownloadButton" class="btn-page-secondary"')
    && hrHtmlForContracts.includes('id="hrPrintPrintButton" class="btn-page-secondary"')
    && hrHtmlForContracts.includes('id="hrPrintOpenButton" class="btn-page-secondary"')
    && hrHtmlForContracts.includes('id="hrPrintProfessionSearch" aria-label="Пошук категорій"')
    && !hrHtmlForContracts.includes('<small>A4 вертикально')
    && !hrHtmlForContracts.includes('<small>A4 горизонтально')
    && hrHtmlForContracts.includes('id="hrPrintDetailsTitle"')
    && hrPageCss.includes('body.hr-print-documents-open { overflow: hidden; }')
    && hrPageCss.includes('.hr-print-documents-trigger {')
    && hrPageCss.includes('.hr-print-documents-body {\n    display: flex; min-width: 0; min-height: 0; flex: 1 1 0; overflow: hidden;')
    && hrPageCss.includes('.hr-print-documents-form { min-width: 0; min-height: 0;')
    && /\.hr-print-profession-list\s*\{[^}]*min-width:\s*0;/.test(hrPageCss)
    && hrPageCss.includes('.hr-print-preview-panel {\n    display: flex; min-width: 0; min-height: 0;')
    && /\.hr-print-preview-state, \.hr-print-preview-frame\s*\{[^}]*min-width:\s*0;[^}]*min-height:\s*0;[^}]*flex:\s*1 1 0;/.test(hrPageCss)
    && hrPageCss.includes('.hr-print-preview-panel { min-height: 520px; }')
    && hrCode.includes('async function showHrPrintPreview')
    && hrCode.includes('function waitForHrPrintPreviewFrame')
    && hrCode.includes("frame.addEventListener('load', handleLoad, { once: true })")
    && hrCode.includes('navigator.pdfViewerEnabled === false')
    && hrCode.includes('Вбудований перегляд PDF недоступний у цьому браузері')
    && hrCode.includes('URL.revokeObjectURL(hrPrintDocumentsState.previewUrl)')
    && hrCode.includes("id: 'pastry_shop', label: 'Кондитерський цех'")
    && hrCode.includes("id: 'pizzaiolo', label: 'Піцейола'")
    && hrCode.includes("'pastry_chef', 'confectioner', 'pastry_assistant', 'head_pastry'")
    && hrCode.includes('function isHrPrintPreviewRequestCurrent')
    && hrCode.includes('scrollHrPrintPreviewIntoView()')
    && hrCode.includes("document.getElementById('hrPrintOpenButton')?.addEventListener('click', openHrPrintPdf)")
    && (hrCode.match(/await showHrPrintPreview\(\{/g) || []).length === 2
    && !hrCode.toLowerCase().includes('pdfjs'));
check('HR/invite/changelog polish prevents long labels from overflowing compact surfaces',
    hrPageCss.includes('.hr-profession-card-head > div')
    && hrPageCss.includes('.hr-profession-chip')
    && hrPageCss.includes('white-space: normal')
    && hrPageCss.includes('.hr-staff-profile-quick-fields { grid-template-columns: 1fr; }')
    && hrFoundationCss.includes('@media (max-width: 560px)')
    && hrFoundationCss.includes('.hr-offboarding-readiness-grid {\n        grid-template-columns: 1fr;')
    && hrFoundationCss.includes('.hr-lifecycle-item {\n        grid-template-columns: 1fr;')
    && staffCssForUiPolish.includes('.schedule-table tbody tr:not(.dept-row):not(.sub-group-row):hover')
    && staffCssForUiPolish.includes('.sub-group-row td')
    && staffCssForUiPolish.includes('overflow-wrap: anywhere')
    && inviteHtmlForUiPolishNormalized.includes('.invite-info-row .info {\nflex: 1;\nmin-width: 0;')
    && inviteHtmlForUiPolish.includes('.map-link')
    && inviteHtmlForUiPolish.includes('overflow-wrap: anywhere')
    && authCss.includes('.changelog-section code')
    && authCss.includes('overflow-wrap: anywhere'));
check('HR staff profile can choose hourly, daily, or monthly rate units', htmlContains('hr.html', 'id="editRateUnit"') && htmlContains('hr.html', 'value="day"') && htmlContains('hr.html', 'value="month"') && hrCode.includes('function syncStaffRateUnitUi') && hrCode.includes('rate_unit: currentEditRateUnit()') && hrCode.includes('function renderSalaryRateSummary') && hrCode.includes('formatStaffRate(segment.rate, segment.rateUnit)') && hrCode.includes("return 'month'") && hrRouteCode.includes('function normalizeStaffRateUnit') && hrRouteCode.includes("COALESCE(s.rate_unit, 'hour') AS rate_unit") && hrRouteCode.includes("WHEN rate_unit = 'month' THEN 0") && htmlContains('db/migrations/259_staff_rate_unit_month.sql', "rate_unit IN ('hour', 'day', 'month')") && htmlContains('css/hr-page.css', '.hr-primary-rate-card') && htmlContains('css/hr-page.css', '.hr-profession-rate-control'));
check('HR staff profile hides the manual pool status selector', !htmlContains('hr.html', 'id="editPoolStatus"') && hrCode.includes("const editPoolStatus = document.getElementById('editPoolStatus');") && hrCode.includes("if (editPoolStatus) body.hr_pool_status = editPoolStatus.value || 'core';") && !hrCode.includes("hr_pool_status: document.getElementById('editPoolStatus')?.value || 'core'"));
check('HR staff profile hides blacklist reason from the profile form', !htmlContains('hr.html', 'id="editBlacklistReason"') && !hrCode.includes("blacklist_reason: document.getElementById('editBlacklistReason')") && hrCode.includes("formModal('Причина чорного списку'") && hrRouteCode.includes("queueStaffUpdate('blacklist_reason'"));
check('HR Team permanent staff delete is guarded for duplicate cleanup', hrCode.includes('hr-team-delete') && hrCode.includes('hr-team-menu-section--danger') && hrCode.includes('тільки для дубля') && hrCode.includes('function deleteStaffProfile') && hrCode.includes("hrFetch(`/staff/${staffId}/delete-readiness`)") && hrCode.includes('Введіть ТАК для підтвердження') && hrCode.includes("confirmation: 'ТАК'") && hrCode.includes('window.deleteStaffProfile = deleteStaffProfile') && hrRouteCode.includes("router.get('/staff/:id/delete-readiness'") && hrRouteCode.includes("router.delete('/staff/:id'") && hrRouteCode.includes("const STAFF_DELETE_CONFIRMATION = 'ТАК'") && hrRouteCode.includes('STAFF_DELETE_BLOCKER_CHECKS') && hrRouteCode.includes('UPDATE hr_audit_log SET staff_id = NULL') && hrRouteCode.includes('staff_delete_permanent') && pagesCss.includes('.hr-team-delete') && pagesCss.includes('body.dark-mode .page-container .hr-team-delete'));
check('HR schedule mounts shared staff schedule module without leave request controls below it', htmlContains('hr.html', 'id="hrStaffScheduleShell"') && htmlContains('hr.html', 'data-staff-schedule-shell="hr"') && htmlContains('hr.html', 'js/staff-schedule-shell.js?v=0.81.35') && htmlContains('hr.html', 'js/staff-page.js?v=0.81.35') && !htmlContains('hr.html', 'id="hrScheduleEmbedFrame"') && !htmlContains('hr.html', 'data-src="/staff?embed=1"') && !htmlContains('hr.html', 'Заявки на відпустки та вихідні') && !htmlContains('hr.html', 'id="leaveStatusFilter"') && !htmlContains('hr.html', 'id="leavesList"') && !htmlContains('hr.html', 'id="btnNewLeave"') && !htmlContains('hr.html', 'id="tab-leaves"') && hrCode.includes('function loadHrScheduleModule') && hrCode.includes('window.StaffSchedulePage.init') && !htmlContains('hr.html', 'id="schedHead"') && !htmlContains('hr.html', 'id="schedBody"'));
check('HR salary exposes calendar period filter without letting custom ranges commit payroll', htmlContains('hr.html', 'id="salaryDateFrom"') && htmlContains('hr.html', 'id="salaryDateTo"') && htmlContains('hr.html', 'type="date"') && htmlContains('hr.html', 'id="btnApplySalaryPeriod"') && htmlContains('hr.html', 'id="btnResetSalaryPeriod"') && pagesCss.includes('v0.73.78: HR salary calendar period picker') && pagesCss.includes('body.dark-mode .hr-salary-date-input') && hrCode.includes('function payrollMonthBounds') && hrCode.includes('function currentSalaryPeriod') && hrCode.includes('function salaryPeriodQueryString') && hrCode.includes('hrFetch(`/salary?${query}`)') && hrCode.includes("period.mode === 'range'") && hrCode.includes('Нарахування зарплати доступне тільки для повного місяця') && hrPayrollPeriodServiceCode.includes('function payrollPeriodRange') && hrRouteCode.includes('$2::date AS date_from') && hrRouteCode.includes("sa.month >= p.month_from AND sa.month <= p.month_to"));
check('HR Salary and KPI expose accessible local employee filters without changing summary snapshots', htmlContains('hr.html', 'id="salarySearch"') && htmlContains('hr.html', 'id="salaryFilterInfo"') && htmlContains('hr.html', 'id="salaryFilterReset"') && htmlContains('hr.html', 'id="salaryDepartmentFilters"') && htmlContains('hr.html', 'id="kpiSearch"') && htmlContains('hr.html', 'id="kpiFilterInfo"') && htmlContains('hr.html', 'id="kpiFilterReset"') && htmlContains('hr.html', 'id="kpiDepartmentFilters"') && htmlContains('hr.html', 'aria-live="polite"') && hrCode.includes('const payrollViewState =') && hrCode.includes('function payrollFilteredRows') && hrCode.includes('normalizeSearchText(parts.filter(Boolean).join') && hrCode.includes('data-payroll-department=') && hrCode.includes('aria-pressed=') && hrCode.includes('renderKpiSources({ rows: allRows, sources })') && hrCode.includes('const totals = allRows.reduce') && hrPageCss.includes('#tab-salary .hr-payroll-filters') && hrPageCss.includes('[data-theme="dark"] #tab-kpi .hr-payroll-filters') && hrPageCss.includes('#tab-salary .hr-payroll-empty-state') && hrPageCss.includes('@media (max-width: 480px)'));
check('HR Salary and KPI group visible rows with persistent native-button toggles', hrCode.includes("storageKey: 'pzp_hr_payroll_salary_expanded_groups'") && hrCode.includes("storageKey: 'pzp_hr_payroll_kpi_expanded_groups'") && hrCode.includes("hydratePayrollExpandedGroups('salary')") && hrCode.includes("hydratePayrollExpandedGroups('kpi')") && hrCode.includes('function payrollGroupedRows') && hrCode.includes('function persistPayrollExpandedGroups') && hrCode.includes('function payrollSearchAutoExpandsGroups') && hrCode.includes('type="button" class="hr-payroll-group-toggle"') && hrCode.includes('data-payroll-group-toggle=') && hrCode.includes('aria-expanded=') && hrCode.includes("renderPayrollGroupedList('salary'") && hrCode.includes("renderPayrollGroupedList('kpi'") && hrPageCss.includes('#tab-salary .hr-payroll-group-header') && hrPageCss.includes('#tab-kpi .hr-payroll-group-toggle:focus-visible') && hrPageCss.includes('[data-theme="dark"] #tab-kpi .hr-payroll-group-header'));
check('HR Salary and KPI use responsive master-detail lists without wide Payroll tables', htmlContains('hr.html', 'id="salaryList" class="hr-payroll-list"') && htmlContains('hr.html', 'id="kpiList" class="hr-payroll-list"') && !htmlContains('hr.html', 'id="salaryHead"') && !htmlContains('hr.html', 'id="salaryBody"') && !htmlContains('hr.html', 'id="kpiHead"') && !htmlContains('hr.html', 'id="kpiBody"') && hrCode.includes('function renderSalaryEmployeeItem') && hrCode.includes('function renderKpiEmployeeItem') && hrCode.includes('function payrollStaffDepartmentSubtitle') && hrRouteCode.includes('staff_department_label') && hrRouteCode.includes('company_structure_node_id') && hrCode.includes('function bindPayrollDetailToggles') && hrCode.includes('data-payroll-detail-toggle') && hrCode.includes('renderSalaryRateSummary(s)') && hrCode.includes('${daysWorked} дн · ${hoursWorked} год') && hrPageCss.includes('@media (max-width: 1200px)') && hrPageCss.includes('#tab-salary .hr-payroll-salary-summary') && hrPageCss.includes('#tab-kpi .hr-payroll-kpi-summary') && hrPageCss.includes('#tab-salary .hr-payroll-detail-toggle') && hrPageCss.includes('min-height: 44px;'));
check('HR KPI uses the backend KPI snapshot instead of client-side source merging', htmlContains('hr.html', 'id="tab-kpi"') && htmlContains('hr.html', 'id="kpiSummary"') && htmlContains('hr.html', 'id="kpiSources"') && htmlContains('hr.html', '.hr-kpi-sources') && htmlContains('hr.html', 'class="hr-kpi-refresh"') && hrCode.includes('async function loadKpi') && hrLoadKpiBlock.includes("hrFetch(`/kpi?month=${month}`)") && hrRouteCode.includes("router.get('/kpi'") && hrRouteCode.includes('loadKpiSnapshot') && hrCode.includes('renderKpiSources') && hrCode.includes('HR-зріз') && hrCode.includes('Підсумковий KPI') && hrCode.includes('даних ще немає') && !hrLoadKpiBlock.includes("hrFetch(`/report/monthly?month=${month}`)") && !hrLoadKpiBlock.includes("hrFetch('/ratings')") && !hrCode.includes('monthly report') && !hrCode.includes('ratings context') && !htmlContains('hr.html', 'ratingsBoard'));
check('HR dark and mobile styles cover nav badges, compact people cards, KPI sources and result grid layout', htmlContains('hr.html', 'body.dark-mode .hr-nav-count') && htmlContains('hr.html', 'body.dark-mode .hr-kpi-source') && htmlContains('hr.html', 'body.dark-mode .hr-people-empty--error') && htmlContains('hr.html', '@media (max-width: 768px)') && htmlContains('hr.html', '.hr-people-results-grid { grid-template-columns: 1fr; }') && htmlContains('hr.html', 'grid-template-columns: repeat(auto-fill, minmax(268px, 1fr))') && htmlContains('hr.html', '.hr-team-avatar { width: 40px; height: 40px; font-size: 15px; }') && htmlContains('hr.html', '.hr-team-training-compact') && htmlContains('hr.html', '.hr-team-overflow-menu') && !/\.hr-people-results\s*\{[^}]*overflow-[xy]\s*:/.test(hrHtmlForContracts));
check('HR exposes account center with account creation, profile, staff binding, password controls, and safe list recovery', htmlContains('hr.html', 'id="tab-accounts"') && hrCode.includes("{ id: 'accounts', label: 'Акаунти', visible: () => canManageAccountSecurity() }") && htmlContains('hr.html', 'accountCenterList') && htmlContains('hr.html', 'accountCreateBtn') && htmlContains('hr.html', 'accountCenterResetFiltersBtn') && htmlContains('hr.html', 'accountCenterFilterNotice') && hrCode.includes('function loadAccountCenter') && hrCode.includes('function canManageAccountSecurity') && hrCode.includes('openAccountCreateModal') && hrCode.includes('function openAccountProfileModal') && hrCode.includes('function loadAccountStaffOptions') && hrCode.includes('/api/users/${encodeURIComponent(userId)}/profile') && hrCode.includes('function openAccountPasswordModal') && hrCode.includes('/api/users/${encodeURIComponent(userId)}/reset-password') && hrCode.includes('function resetAccountCenterFilters') && hrCode.includes('loadAccountCenter({ resetFilters: true })') && !hrCode.includes('deactivateKarinaAccounts') && !htmlContains('hr.html', 'Вимкнути акаунти Каріни') && htmlContains('routes/users.js', 'ACCOUNT_MANAGER_ROLES') && htmlContains('routes/users.js', "router.get('/staff-options'") && htmlContains('routes/users.js', "router.patch('/:id/profile'"));
check('HR Account Center uses the dedicated effective-access workspace',
    htmlContains('hr.html', 'css/account-access-editor.css?v=0.81.35')
    && htmlContains('hr.html', 'js/account-access-editor.js?v=0.81.35')
    && hrCode.includes('window.AccountAccessEditor.open')
    && hrCode.includes('resolveCapability: window.resolveCapability')
    && hrCode.includes('/workspace')
    && accountAccessEditorCode.includes("['overview', 'Огляд']")
    && accountAccessEditorCode.includes("['modules', 'Модулі та вкладки']")
    && accountAccessEditorCode.includes("['history', 'Історія']")
    && accountAccessEditorCode.includes('ignoreServer: true')
    && accountAccessEditorCode.includes('data-action="apply-preset"')
    && accountAccessEditorCode.includes('role="alertdialog"')
    && accountAccessEditorCode.includes('element.inert = true')
    && hrCode.includes('function getAccountRolePresetButtons')
    && hrCode.includes('accountRolePresets')
    && hrCode.includes('accountPageAccessMatrix')
    && hrCode.includes('accountActionPermissionsMatrix')
    && htmlContains('routes/users.js', 'rolePresets:')
    && htmlContains('routes/users.js', 'action.deprecated !== true'));
check('HR Account Center receives human page metadata from permissionRegistry',
    htmlContains('routes/users.js', 'getPublicPagePermissionMetadata')
    && htmlContains('routes/users.js', 'pages,')
    && permissionRegistryCode.includes('function getPublicPagePermissionMetadata')
    && permissionRegistryCode.includes("key: '/demo', label: 'Demo'")
    && permissionRegistryCode.includes("key: '/hermes-studio', label: 'Hermes Studio'")
    && permissionRegistryCode.includes("key: '/booking-summary.html', label: 'Підсумок бронювання'")
    && permissionRegistryCode.includes("key: '/certificates/new', label: 'Видати сертифікат або абонемент'")
    && permissionRegistryCode.includes("key: '/accounting-deposits', label: 'Перевірка завдатків'")
    && hrCode.includes('let accountPageDefinitions = []')
    && hrCode.includes('function getAccountPageDefinitions')
    && hrCode.includes('Array.isArray(data?.pages)')
    && hrCode.includes('group: page.groupLabel || page.group')
    && !hrCode.includes('const ACCOUNT_PAGE_LABELS =')
    && !hrCode.includes('function accountAccessPageGroup('));
check('HR Account Center hides protected account actions before API calls', hrCode.includes('function currentAccountCanMutateTarget') && hrCode.includes('function currentAccountCanToggleTarget') && hrCode.includes('function renderAccountActionMenu') && hrCode.includes('user.protected_account === true') && hrCode.includes('Системний або захищений акаунт') && hrCode.includes('currentAccountCanMutateTarget(user)') && hrCode.includes('currentAccountCanToggleTarget(user)'));
check('Extensionless CRM HTML routes are no-store to avoid stale HR tab DOM', securityMiddlewareCode.includes('STATIC_HTML_ROUTE_PATHS') && securityMiddlewareCode.includes("'/hr'") && securityMiddlewareCode.includes('function isHtmlPagePath') && securityMiddlewareCode.includes("res.set('Cache-Control', 'no-cache, no-store, must-revalidate')"));
check('Service worker script is not served as immutable static JS', securityMiddlewareCode.includes("p === '/sw.js'") && securityMiddlewareCode.includes('stale workers can keep serving') && securityMiddlewareCode.includes("res.set('Cache-Control', 'no-cache, no-store, must-revalidate')"));
check('Content edit modals force-close only after durable actions', contentCode.includes('attemptCloseEditableSurface(modal') && contentCode.includes('await closeModal(true)') && contentCode.includes('await closeCardModal(true)'));

check('HR Account Center page deny editor uses canonical tri-state state and preview',
    hrCode.includes('pageDenylist: normalizeAccountArray(user.page_denylist || user.pageDenylist)')
    && hrCode.includes('pageDenylist: normalizeAccountListInput(draft.pageDenylist)')
    && accountAccessEditorCode.includes('function pageCanonicalMap')
    && accountAccessEditorCode.includes('pageDenylist')
    && accountAccessEditorCode.includes('data-group-preview')
    && accountAccessEditorCode.includes('renderEffectiveDiff')
    && accountAccessEditorCode.includes('pendingGroupAction')
    && accountAccessEditorCode.includes("definition.type === 'page' || definition.type === 'action'"));

// Check Timeline/Kleshnya shell collapse keeps geometry in CSS
check('Timeline sidebar collapse is class-based', appCode.includes("sidebar.classList.add('collapsed')") && appCode.includes("sidebar.classList.toggle('collapsed')"));
check('Timeline sidebar collapse avoids inline shell offsets', !appCode.includes('style.marginLeft') && !appCode.includes("style.width = 'calc(100% - 64px)'"));
check('Timeline product sales button opens modal', appCode.includes('showProductSalesModal') && appCode.includes("document.getElementById('productSalesBtn')?.addEventListener('click', showProductSalesModal)"));
check('Timeline create toolbar button is absent while deep-link booking flow stays available', !appCode.includes("document.getElementById('newBookingBtn')") && timelineCode.includes('async function openTimelineCreateBookingFromToolbar') && timelineCode.includes('openBookingPanel(time, line.id)') && timelineCode.includes('getDefaultTimelineBookingTime'));
check('Timeline product sales API loads monthly report', appCode.includes('/api/analytics/product-sales?') && appCode.includes('loadProductSalesReport'));
check('Timeline product sales export supports CSV and XLSX', appCode.includes("downloadProductSalesExport('csv')") && appCode.includes("downloadProductSalesExport('xlsx')"));
check('Timeline product sales supports pinata quick filter', appCode.includes("categorySelect.value = 'pinata'"));
check('Timeline product sales separates revenue viewing from data export while preserving universal timeline exports',
    authCode.includes('function setTimelinePermissionHidden')
    && !authCode.includes("setTimelinePermissionHidden('newBookingBtn'")
    && authCode.includes("setTimelinePermissionHidden('exportTimelineBtn', false)")
    && authCode.includes("setTimelinePermissionHidden('exportPdfBtn', false)")
    && !authCode.includes("setTimelinePermissionHidden('exportTimelineBtn', !canAccess('export_data'))")
    && !authCode.includes("setTimelinePermissionHidden('exportPdfBtn', !canAccess('export_data'))")
    && !authCode.includes("setTimelinePermissionHidden('exportTimelineBtn', !canUse('export'))")
    && !authCode.includes("setTimelinePermissionHidden('exportPdfBtn', !canUse('export'))")
    && authCode.includes("setTimelinePermissionHidden('productSalesBtn', !canAccess('view_revenue'))")
    && appCode.includes("if (typeof canAccess !== 'function' || !canAccess('view_revenue'))")
    && appCode.includes("const canExport = typeof canAccess === 'function' && canAccess('export_data');")
    && appCode.includes("if (typeof canAccess !== 'function' || !canAccess('export_data') || !canAccess('view_revenue'))")
    && timelineVisibilityCode.includes("visualBlock('export', 'Верхня панель', 'Експорт', '#exportTimelineBtn, #exportPdfBtn')")
    && !authCode.includes("exportBtn.style.display = 'none'"));

// ═══════════════════════════════════════════════════


const cashierPaymentsHtml = fileText('cashier-payments.html');
const cashierPaymentsJs = fileText('js/cashier-payments-page.js');
const cashierPaymentsCss = fileText('css/cashier-payments.css');
check('Cashier payments pilot UI is scoped to park middle register and shows immutable fiscal/payment snapshot',
    cashierPaymentsHtml.includes('data-pilot-scope="event_genix:middle"')
    && cashierPaymentsHtml.includes('id="cashierFiscalProfile"')
    && cashierPaymentsHtml.includes('id="cashierRegister"')
    && cashierPaymentsHtml.includes('id="cashierPaymentStatus"')
    && cashierPaymentsHtml.includes('id="cashierFiscalStatus"')
    && cashierPaymentsHtml.includes('id="paymentItemsBody"')
    && cashierPaymentsHtml.includes('id="paymentTotalAmount"')
    && cashierPaymentsHtml.includes('\u0413\u043e\u0442\u0456\u0432\u043a\u0443 \u043e\u0442\u0440\u0438\u043c\u0430\u043d\u043e \u2014 \u0441\u0442\u0432\u043e\u0440\u0438\u0442\u0438 \u0447\u0435\u043a')
    && cashierPaymentsHtml.includes('\u0422\u0435\u0440\u043c\u0456\u043d\u0430\u043b \u043f\u043e\u043a\u0430\u0437\u0430\u0432 \u0443\u0441\u043f\u0456\u0448\u043d\u0443 \u043e\u043f\u043b\u0430\u0442\u0443')
    && cashierPaymentsHtml.includes('RCP-* \u2014 \u0432\u043d\u0443\u0442\u0440\u0456\u0448\u043d\u044f \u043a\u0432\u0438\u0442\u0430\u043d\u0446\u0456\u044f'));
check('Cashier thin UI exposes server-backed unresolved queue and read-only Checkbox sales report',
    cashierPaymentsHtml.includes('id="unresolvedOrdersPanel"')
    && cashierPaymentsHtml.includes('id="unresolvedOrdersBody"')
    && cashierPaymentsHtml.includes('id="refreshUnresolvedOrdersBtn"')
    && cashierPaymentsHtml.includes('id="checkboxSalesReportPanel"')
    && cashierPaymentsHtml.includes('id="checkboxSalesReportBody"')
    && cashierPaymentsHtml.includes('id="loadCheckboxSalesReportBtn"')
    && cashierPaymentsHtml.includes('id="refreshReadinessBtn"')
    && cashierPaymentsHtml.includes('id="checkboxReportDateFrom"')
    && cashierPaymentsHtml.includes('id="checkboxReportDateTo"')
    && cashierPaymentsHtml.includes('id="checkboxReportShiftId"')
    && cashierPaymentsHtml.includes('id="checkboxReportPage"')
    && cashierPaymentsHtml.includes('aria-live="polite"')
    && !cashierPaymentsHtml.includes('id="operationalContourPanel"')
    && !cashierPaymentsHtml.includes('id="serviceInForm"')
    && !cashierPaymentsHtml.includes('id="refundForm"')
    && !cashierPaymentsHtml.includes('id="reconciliationForm"')
    && !cashierPaymentsHtml.includes('type="password"'));
check('Cashier frontend uses provider-aware readiness and server-backed recovery APIs',
    cashierPaymentsJs.includes('loadPilotRegisterState')
    && cashierPaymentsJs.includes('/api/payments/pilot-register-state')
    && cashierPaymentsJs.includes('/api/payments/readiness/probe')
    && cashierPaymentsJs.includes('/api/payments/unresolved-orders')
    && cashierPaymentsJs.includes('/api/payments/checkbox-sales-report')
    && cashierPaymentsJs.includes('loadUnresolvedOrders')
    && cashierPaymentsJs.includes('renderUnresolvedOrders')
    && cashierPaymentsJs.includes('queue_unavailable')
    && cashierPaymentsJs.includes('unresolvedQueueState')
    && cashierPaymentsJs.includes('refreshReadiness')
    && cashierPaymentsJs.includes('failed_retryable')
    && cashierPaymentsJs.includes('failed_terminal')
    && cashierPaymentsJs.includes('dead')
    && cashierPaymentsJs.includes('POLLING_TIMEOUT_MS'));
check('Cashier payments frontend preserves idempotency and blocks repeat payment while fiscalization is pending',
    cashierPaymentsJs.includes('getCreateIdempotencyKey')
    && cashierPaymentsJs.includes('getConfirmIdempotencyKey')
    && cashierPaymentsJs.includes("const FISCAL_BLOCKING_STATUSES")
    && cashierPaymentsJs.includes('state.confirmSubmitted = true')
    && cashierPaymentsJs.includes('payment_repeat_blocked')
    && cashierPaymentsJs.includes('cashReceivedAmountMinor')
    && cashierPaymentsJs.includes('terminalShowedSuccess: true'));
check('Cashier payments page stays isolated from protected booking and timeline renderers',
    !cashierPaymentsJs.includes('showBookingDetails')
    && !cashierPaymentsJs.includes('bookingModal')
    && !cashierPaymentsJs.includes('bookingDetails')
    && !cashierPaymentsJs.includes('timeline.js')
    && !cashierPaymentsHtml.includes('js/booking.js')
    && !cashierPaymentsHtml.includes('js/timeline.js'));
check('Cashier payments UI keeps keyboard focus and responsive layout coverage',
    cashierPaymentsCss.includes(':focus-visible')
    && cashierPaymentsCss.includes('@media (max-width: 960px)')
    && cashierPaymentsHtml.includes('aria-live="polite"')
    && cashierPaymentsHtml.includes('aria-label="Позиції оплати"'));

// RESULTS
// ═══════════════════════════════════════════════════

const { passed, failed } = ui.results();
console.log(`\n${'═'.repeat(50)}`);
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`${'═'.repeat(50)}`);
process.exit(failed > 0 ? 1 : 0);
