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

function htmlContains(filename, text) {
    return fs.readFileSync(path.join(ROOT, filename), 'utf8').includes(text);
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
    const productSalesBtnRule = modalsCss.match(/\.btn-product-sales\s*\{([\s\S]*?)\}/)?.[1] || '';
    const darkProductSalesBtnRule = modalsCss.match(/body\.dark-mode\s+\.btn-product-sales\s*\{([\s\S]*?)\}/)?.[1] || '';

    check('loginForm exists', !!doc.getElementById('loginForm'));
    check('loginScreen exists', !!doc.getElementById('loginScreen'));
    check('mainApp exists', !!doc.getElementById('mainApp'));
    check('submit button has type=submit', doc.querySelector('.btn-login')?.type === 'submit');
    check('sidebarLinks exists', !!doc.getElementById('sidebarLinks'));
    check('Timeline product sales button exists', !!doc.getElementById('productSalesBtn'));
    check('Timeline product sales modal exists', !!doc.getElementById('productSalesModal'));
    check('Timeline product sales month filter exists', doc.getElementById('productSalesMonth')?.type === 'month');
    check('Timeline product sales category and program filters exist', !!doc.getElementById('productSalesCategory') && !!doc.getElementById('productSalesProgram'));
    check('Timeline product sales export buttons exist', !!doc.getElementById('productSalesXlsxBtn') && !!doc.getElementById('productSalesCsvBtn'));
    check('Timeline product sales button is a modal trigger', doc.getElementById('productSalesBtn')?.textContent.includes('📊'));
    check('Timeline product sales modal omits payment/debt fields', !doc.getElementById('productSalesModal')?.textContent.includes('Оплачено') && !doc.getElementById('productSalesModal')?.textContent.includes('Борг'));
    check('Timeline product sales export buttons are styled as buttons', doc.getElementById('productSalesXlsxBtn')?.classList.contains('product-sales-export-btn') && doc.getElementById('productSalesCsvBtn')?.classList.contains('product-sales-export-btn'));
    check('Timeline product sales button has readable light text color', productSalesBtnRule.includes('color: var(--gray-800'));
    check('Timeline product sales button has readable dark text color', darkProductSalesBtnRule.includes('color: var(--text-primary'));
    check('Booking pinata mode selector exists', !!doc.getElementById('pinataMode'));
    check('Booking client pinata service fields exist', !!doc.getElementById('clientPinataServiceFields') && !!doc.getElementById('clientPinataServicePrice'));
    check('Park pinata filler excludes client-owned option', !html.includes('value="Клієнта"'));
    check('login release badge matches package version', doc.querySelector('.login-release-badge')?.textContent.includes(pkg.version));
    check('login release badge matches package release label', doc.querySelector('.login-release-badge')?.textContent.includes(pkg.eventGenix.releaseLabel));
    check('login tagline matches package release contract', doc.querySelector('.tagline')?.textContent === `AI First CRM v${pkg.version} — ${pkg.eventGenix.releaseLabel}`);
    check('login changelog button matches package release contract', doc.getElementById('changelogBtn')?.textContent.includes(`v${pkg.version}: ${pkg.eventGenix.releaseLabel}`));
});

checkPage('dashboard.html', (doc, html) => {
    check('loginForm exists', !!doc.getElementById('loginForm'));
    check('mainApp exists', !!doc.getElementById('mainApp'));
    check('dashboardGrid exists', !!doc.getElementById('dashboardGrid'));
    check('dashboard omits giant work queue panel from main flow', !doc.getElementById('workQueuePanel') && !doc.getElementById('workQueueBody'));
    check('dashboard login tagline matches package version', html.includes(`AI First CRM v${pkg.version}`));
    check('dashboard changelog button matches package version', html.includes(`Що нового у v${pkg.version}`));
});

checkPage('designs.html', (doc, html) => {
    check('5 tabs exist', doc.querySelectorAll('[data-tab]').length === 5);
    check('tabCatalogs exists', !!doc.getElementById('tabCatalogs'));
    check('catalogViewer exists', !!doc.getElementById('catalogViewer'));
    check('catalogList exists', !!doc.getElementById('catalogList'));
    check('No misplaced <script> in function', !html.match(/w\.document\.write[\s\S]*?<script>/));
});

checkPage('art-director.html', (doc, html) => {
    check('tabs exist', doc.querySelectorAll('.artdir-tab').length > 0);
    check('sidebar exists', !!doc.getElementById('sidebarNav'));
    check('Art director content due date exists', doc.getElementById('contentDueDate')?.type === 'date');
    check('Art director content modal uses shrink-safe grid', html.includes('grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:10px'));
    check('Art director modal controls are bounded', html.includes('id="contentDueDate" style="width:100%; min-width:0; max-width:100%;'));
});

checkPage('center.html', (doc) => {
    check('tabs exist', doc.querySelectorAll('.center-tab-btn').length > 0);
    check('sidebar exists', !!doc.getElementById('sidebarNav'));
});

checkPage('copilot.html', (doc) => {
    const copilotCss = fs.readFileSync(path.join(ROOT, 'css', 'copilot.css'), 'utf8');
    check('copilotApp exists', !!doc.getElementById('copilotApp'));
    check('nav items exist', doc.querySelectorAll('.copilot-nav-item').length > 0);
    check('Copilot form rows use shrink-safe grid', copilotCss.includes('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)'));
    check('Copilot form controls are bounded inside grid rows', copilotCss.includes('.form-row .copilot-input'));
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
    check('Customer edit modal exists', !!doc.getElementById('customerEditModal'));
    check('Customer child birthday date input exists', doc.getElementById('editChildBirthday')?.type === 'date');
    check('Customer explainability region exists', !!doc.getElementById('customerExplainability'));
    check('Customer edit modal uses shrink-safe grid', html.includes('grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px'));
    check('Customer edit date input is bounded', html.includes('id="editChildBirthday" style="width:100%;min-width:0;max-width:100%;'));
});

checkPage('finance.html', (doc, html) => {
    check('Finance transaction edit modal exists', !!doc.getElementById('transEditModal'));
    check('Finance transaction date input exists', doc.getElementById('editDate')?.type === 'date');
    check('Finance transaction modal uses shrink-safe grid', html.includes('grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px'));
    check('Finance transaction date input is bounded', html.includes('id="editDate" style="width:100%;min-width:0;max-width:100%;'));
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
    check('Leads explainability region exists', !!doc.getElementById('leadsExplainability'));
    check('Lead edit modal date input exists', leadDate?.type === 'date');
    check('Lead edit modal children input exists', leadChildren?.type === 'number');
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
    check('Chat settings page exposes test connection', !!doc.getElementById('chatAiTestBtn'));
    check('Chat settings page exposes integrations controls', !!doc.getElementById('chatIntegrationSummary') && !!doc.getElementById('chatIntegrationGuardian'));
    check('Chat settings page exposes Guardian controls', !!doc.getElementById('guardianEnabled') && !!doc.getElementById('guardianProvider') && !!doc.getElementById('guardianModel'));
});

checkPage('tasks.html', (doc) => {
    check('Tasks explainability region exists', !!doc.getElementById('taskExplainability'));
    check('Tasks category filters exist', !!doc.getElementById('catFilters'));
    check('Tasks subcategory filters host exists', !!doc.getElementById('subcatFilters'));
    check('Tasks operation pack bar exists', !!doc.getElementById('operationPackBar'));
    check('Tasks operation pack source fields exist', !!doc.getElementById('operationSourceType') && !!doc.getElementById('operationSourceId'));
    check('Tasks board content exists', !!doc.getElementById('boardContent'));
    check('Tasks top area does not render points strip', !doc.getElementById('pointsBar') && !doc.getElementById('pointsPermanent') && !doc.getElementById('pointsMonthly'));
    check('Tasks page has no Focus tab button', !doc.querySelector('[data-view="focus"]'));
});

checkPage('reports.html', (doc, html) => {
    const reportsCode = fs.readFileSync(path.join(ROOT, 'js', 'reports-page.js'), 'utf8');
    const removedChartText = ['Динаміка прибутку', 'Витрати по категоріях', 'Доходи vs Витрати (по днях)'];
    check('Reports page removes low-signal chart blocks', removedChartText.every(text => !html.includes(text)));
    check('Reports page has no chart canvases or Chart.js CDN', !doc.getElementById('barChart') && !doc.getElementById('pieChart') && !doc.getElementById('lineChart') && !html.includes('cdn.jsdelivr.net/npm/chart.js'));
    check('Reports page script no longer renders Chart.js widgets', !reportsCode.includes('renderCharts') && !reportsCode.includes('new Chart(') && !reportsCode.includes('rpt-chart'));
});

// ═══════════════════════════════════════════════════
// JS FILE CHECKS
// ═══════════════════════════════════════════════════

console.log('\nbase CSS');
const baseCss = fs.readFileSync(path.join(ROOT, 'css', 'base.css'), 'utf8');
check('Notifications dark mode defines local text contrast tokens', baseCss.includes('body.dark-mode .alerts-panel-v4') && baseCss.includes('--ap-text-primary: #F8FAFC') && baseCss.includes('--ap-text-secondary: #CBD5E1') && baseCss.includes('--ap-text-muted: #94A3B8'));
check('Notifications dark mode overrides primary text color', baseCss.includes('body.dark-mode .ap-title') && baseCss.includes('body.dark-mode .ap-item-title') && baseCss.includes('body.dark-mode .ap-empty-text'));
check('Notifications dark mode overrides secondary and meta text color', baseCss.includes('body.dark-mode .ap-item-desc') && baseCss.includes('body.dark-mode .ap-count') && baseCss.includes('body.dark-mode .ap-group-title'));
check('Notifications dark mode keeps read items readable', baseCss.includes('body.dark-mode .ap-item.read') && baseCss.includes('opacity: 1') && baseCss.includes('body.dark-mode .ap-item.read .ap-item-title'));
check('Notifications dark mode covers alert variants', baseCss.includes('body.dark-mode .ap-item.warning .ap-icon') && baseCss.includes('body.dark-mode .ap-item.critical .ap-icon') && baseCss.includes('body.dark-mode .ap-item.info .ap-icon'));

console.log('\ndark mode contrast CSS');
const darkModeCss = fs.readFileSync(path.join(ROOT, 'css', 'dark-mode.css'), 'utf8');
const catalogCss = fs.readFileSync(path.join(ROOT, 'css', 'catalog.css'), 'utf8');
const contentCss = fs.readFileSync(path.join(ROOT, 'css', 'content.css'), 'utf8');
const achievementsCss = fs.readFileSync(path.join(ROOT, 'css', 'achievements.css'), 'utf8');
const profilePageHtml = fs.readFileSync(path.join(ROOT, 'profile.html'), 'utf8');
const profileCode = fs.readFileSync(path.join(ROOT, 'js', 'profile-page.js'), 'utf8');
const profilePagesCss = fs.readFileSync(path.join(ROOT, 'css', 'pages.css'), 'utf8');
const questsRouteCode = fs.readFileSync(path.join(ROOT, 'routes', 'quests.js'), 'utf8');
check('Dark mode defines shared text aliases', darkModeCss.includes('--text: #F8FAFC;') && darkModeCss.includes('--text-primary: #F8FAFC;') && darkModeCss.includes('--text-secondary: #CBD5E1;') && darkModeCss.includes('--text-muted: #94A3B8;'));
check('Dark mode defines shared surface/card aliases', darkModeCss.includes('--surface: #1E1E38;') && darkModeCss.includes('--card-bg: #1E1E38;') && darkModeCss.includes('--bg-card: #1E1E38;') && darkModeCss.includes('--border-color: rgba(255,255,255,0.12);'));
check('Dark placeholders and empty states use readable muted token', darkModeCss.includes('body.dark-mode .program-search-input::placeholder { color: var(--text-muted); }') && darkModeCss.includes('body.dark-mode .login-form input::placeholder') && darkModeCss.includes('body.dark-mode .empty-state-hint { color: var(--text-muted); }'));
check('Dark native selects keep opened options readable', darkModeCss.includes('body.dark-mode select option') && darkModeCss.includes('body.dark-mode select option:checked') && darkModeCss.includes('color-scheme: dark;'));
check('Dark customer/task muted labels avoid low-contrast gray', darkModeCss.includes('body.dark-mode .customer-age { color: var(--text-muted); }') && darkModeCss.includes('body.dark-mode .task-no-assignee { color: var(--text-muted); }') && !darkModeCss.includes('body.dark-mode .customer-age { color: #64748B; }'));
check('Dark catalog muted text avoids low-alpha white', catalogCss.includes('body.dark-mode .catalog-card-meta { color: var(--text-muted, #94A3B8); }') && catalogCss.includes('body.dark-mode .cat-page-detail { color: var(--text-muted, #94A3B8); }') && !catalogCss.includes('body.dark-mode .catalog-card-meta { color: rgba(255,255,255,0.4); }'));
check('Dark content/profile muted CTAs use readable muted token', contentCss.includes('body.dark-mode .content-bcard-slug { color: var(--text-muted, #94A3B8); }') && achievementsCss.includes('body.dark-mode .add-note-btn { border-color: #3D3D5C; color: var(--text-muted, #94A3B8); }'));
check('Profile dark mode defines readable local text tokens', profilePageHtml.includes('--profile-dark-text: #F8FAFC;') && profilePageHtml.includes('--profile-dark-secondary: #CBD5E1;') && profilePageHtml.includes('--profile-dark-muted: #94A3B8;'));
check('Profile dark mode uses text tokens for primary work content', profilePageHtml.includes('body.dark-mode .profile-identity-copy h1') && profilePageHtml.includes('body.dark-mode .profile-task-row b') && profilePageHtml.includes('color: var(--profile-dark-text);'));
check('Profile dark mode covers primary tabs and cabinet cards', profilePageHtml.includes('body.dark-mode .profile-primary-tab.active') && profilePageHtml.includes('body.dark-mode .profile-secondary-tab.active') && profilePageHtml.includes('body.dark-mode .cabinet-task-section') && profilePageHtml.includes('body.dark-mode .cabinet-capture input'));
check('Profile nav separates primary and secondary tab contracts', profileCode.includes('profile-primary-tabs profile-work-tabs') && profileCode.includes('profile-primary-tab') && profileCode.includes('profile-secondary-tab') && !profileCode.includes('class="profile-tab'));
check('Profile reward claim surfaces use shared pending refresh contract', profileCode.includes('let rewardClaimPending = new Set()') && profileCode.includes('function renderRewardClaimButton') && profileCode.includes('function refreshProfileRewardSurfaces') && profileCode.includes("isRewardClaimPending('quest'") && profileCode.includes("isRewardClaimPending('season'"));
check('Profile achievements use auto-award state language without fake manual claim', profileCode.includes('function checkProfileAutoRewards') && profileCode.includes('achievement-state--claimed') && profileCode.includes('achievement-state--progress') && !profileCode.includes('/achievements/claim'));
check('Quest claim route uses valid reward lookup SQL', questsRouteCode.includes('SELECT * FROM daily_quests WHERE id = $1 LIMIT 1') && !questsRouteCode.includes('LIMIT 200 WHERE id = $1'));
check('Profile settings supports local avatar upload from device', profileCode.includes('id="profileAvatarFile"') && profileCode.includes("fetch('/api/auth/profile/avatar/upload'") && profileCode.includes('handleProfileAvatarFileChange') && profilePageHtml.includes('.profile-avatar-file-pick'));
check('Profile cabinet quick cluster uses label-first segmented markup', profileCode.includes('function getCabinetQuickMode') && profileCode.includes('function syncCabinetQuickMode') && profileCode.includes('class="cabinet-quick-cluster"') && profileCode.includes('cabinet-quick-label') && profileCode.includes('cabinet-quick-count') && profileCode.includes('\\u0417\\u0430\\u0434\\u0430\\u0447\\u0456') && profileCode.includes('\\u0410\\u043b\\u0435\\u0440\\u0442\\u0438') && profileCode.includes('\\u0412\\u043e\\u0440\\u043e\\u043d\\u043a\\u0430'));
check('Profile cabinet quick cluster removed icon-first pulse markup', !profileCode.includes('cabinetPulseIcon') && !profileCode.includes('cabinet-pulse-icon') && !profileCode.includes('cabinet-pulse-btn') && !profileCode.includes('cabinet-pulse-count'));
check('Profile cabinet quick cluster CSS covers state, theme, mobile, and print', profilePagesCss.includes('.cabinet-quick-cluster') && profilePagesCss.includes('.cabinet-quick-segment--zero') && profilePagesCss.includes('.cabinet-quick-segment--hot') && profilePagesCss.includes('.cabinet-quick-segment--critical') && profilePagesCss.includes('body.dark-mode .cabinet-quick-cluster') && profilePagesCss.includes('@media print') && profilePagesCss.includes('page-break-inside: avoid') && !profilePagesCss.includes('.cabinet-pulse-icon'));

const criticalJS = [
    'js/config.js', 'js/api.js', 'js/auth.js', 'js/ui.js', 'js/app.js',
    'js/assistant-rail.js',
    'js/components/sidebar.js',
    'js/art-director-page.js', 'js/center-page.js', 'js/demo-page.js',
    'js/designs-page.js', 'js/copilot-page.js',
    'js/dashboard-page.js', 'js/finance-page.js', 'js/analytics-page.js',
    'js/hr-page.js', 'js/staff-page.js', 'js/customers-page.js',
    'js/tasks-page.js', 'js/leads-page.js', 'js/chat-page.js', 'js/chat-settings-page.js',
    'js/warehouse-page.js', 'js/reports-page.js',
    'js/booking.js', 'js/timeline.js', 'js/settings.js',
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

// Check shared logout binding ownership
console.log('\nshared logout binding');
const authCode = fs.readFileSync(path.join(ROOT, 'js', 'auth.js'), 'utf8');
const htmlFiles = fs.readdirSync(ROOT).filter(file => file.endsWith('.html'));
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
check('All logout button pages load auth.js', pagesWithLogoutButton.every(page => getHtmlScripts(page.html).includes('js/auth.js')));
check('No page JS owns logoutBtn directly outside auth.js', nonAuthJsLogoutOwners.length === 0);
check('No inline logoutBtn click handlers remain', inlineLogoutOwners.length === 0);

// Check shared layout shell guardrails
console.log('\nlayout shell guardrails');
const fullAppShellPages = new Set(['chat.html', 'chat-settings.html', 'copilot.html', 'designer.html', 'index.html', 'omni.html', 'training.html']);
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

check('No standard page nests main-content inside page-container', nestedShellPages.length === 0);
check('No shell containers use inline left offsets', inlineOffsetPages.length === 0);
check('Only documented full-app pages use main-content shell', unexpectedMainShellPages.length === 0);
check('All mainApp shells start from hidden main-app baseline', missingHiddenMainAppPages.length === 0);
shellPages.forEach(page => page.dom.window.close());

// Check sidebar nav items
const sidebarCode = fs.readFileSync(path.join(ROOT, 'js/components/sidebar.js'), 'utf8');
const layoutCss = fs.readFileSync(path.join(ROOT, 'css/layout.css'), 'utf8');
const sidebarAuroraCss = fs.readFileSync(path.join(ROOT, 'css/sidebar-aurora.css'), 'utf8');
check('Sidebar has /designs', sidebarCode.includes("href: '/designs'"));
check('Sidebar has /designs#catalogs', sidebarCode.includes("href: '/designs#catalogs'"));
check('Sidebar has /designer', sidebarCode.includes("href: '/designer'"));
check('Sidebar has /guardian-ops', sidebarCode.includes("href: '/guardian-ops'"));
check('Sidebar exposes /omni for communications', sidebarCode.includes("href: '/omni'") && sidebarCode.includes('omni:'));
check('Sidebar has Центр керування', sidebarCode.includes('Центр керування'));

check('Sidebar navigation no longer delays on visible old DOM', !sidebarCode.includes('setTimeout(() => { window.location.href = href; }, 180)') && sidebarCode.includes('requestAnimationFrame(navigate)'));
check('Sidebar init is idempotent for shared bindings', sidebarCode.includes('transitionsBound') && sidebarCode.includes('sidebarToggleBound') && sidebarCode.includes('sidebarOverlayBound') && sidebarCode.includes('sidebarLinkBound'));
check('Sidebar uses AI command deck instead of legacy equal status cards', sidebarCode.includes('function _ensureCommandDeck') && sidebarCode.includes('sidebarCommandDeck') && sidebarCode.includes('focusChipTasks') && sidebarCode.includes('sidebarPrimaryAction') && !sidebarCode.includes('function _ensurePillsRow'));
check('Sidebar scenario IA is grouped around today, sales, team, product, and system', sidebarCode.includes("key: 'today'") && sidebarCode.includes("key: 'sales'") && sidebarCode.includes("key: 'team'") && sidebarCode.includes("key: 'product'") && sidebarCode.includes("key: 'system'") && sidebarCode.includes('getRolePreferredGroups'));
check('Sidebar additional menu uses CRM tabs instead of external links', sidebarCode.includes('EXTRA_MENU_HREFS') && sidebarCode.includes('_getExtraMenuItems') && !sidebarCode.includes('Notion · daily ops') && !sidebarCode.includes('calendar.google.com') && !sidebarCode.includes('web.monobank.ua'));
check('Sidebar day menu is a three-button menu instead of configurable Today list', sidebarCode.includes('TODAY_MENU_HREFS') && sidebarCode.includes('sidebar-today-menu-grid') && sidebarCode.includes('Меню дня') && !sidebarCode.includes('sidebar-today-config-label'));
check('Sidebar role-aware focus honors runtime role switches before stored profile role', sidebarCode.includes('function _getSidebarActiveRole') && /runtimeRole\s*\|\|\s*_getSidebarPrimaryRole/.test(sidebarCode) && !/_getSidebarPrimaryRole\([^)]*\)\s*\|\|\s*\(typeof getUserRole/.test(sidebarCode));
check('Sidebar visual contract defines command deck, focus chips, and quiet nav states', sidebarAuroraCss.includes('.sidebar-command-deck') && sidebarAuroraCss.includes('.focus-chip') && sidebarAuroraCss.includes('.sidebar-primary-action') && sidebarAuroraCss.includes('.nav-status') && sidebarAuroraCss.includes('.sidebar-group-signal') && sidebarAuroraCss.includes('display: none !important'));
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
check('Page exit uses neutral shell veil instead of old shell animation', layoutCss.includes('body.page-exiting::before') && layoutCss.includes('body.page-exiting #mainApp') && !layoutCss.includes('animation: ptFadeOut 0.18s'));

const trainingPageCode = fs.readFileSync(path.join(ROOT, 'js/training-page.js'), 'utf8');
const chatPageCode = fs.readFileSync(path.join(ROOT, 'js/chat-page.js'), 'utf8');
const chatHtml = fs.readFileSync(path.join(ROOT, 'chat.html'), 'utf8');
const chatCss = fs.readFileSync(path.join(ROOT, 'css', 'chat.css'), 'utf8');
const minigameCode = fs.readFileSync(path.join(ROOT, 'js', 'minigame-match3.js'), 'utf8');
const minigameCss = fs.readFileSync(path.join(ROOT, 'css', 'minigame.css'), 'utf8');
const dashboardHtml = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
const dashboardPageCode = fs.readFileSync(path.join(ROOT, 'js/dashboard-page.js'), 'utf8');
const dashboardCss = fs.readFileSync(path.join(ROOT, 'css/dashboard.css'), 'utf8');
const assistantRailCode = fs.readFileSync(path.join(ROOT, 'js/assistant-rail.js'), 'utf8');
const assistantRailCss = fs.readFileSync(path.join(ROOT, 'css/assistant-rail.css'), 'utf8');
const dashboardRouteCode = fs.readFileSync(path.join(ROOT, 'routes/dashboard.js'), 'utf8');
check('Training page script does not double-initialize sidebar', !trainingPageCode.includes('Sidebar.init('));
check('Chat page no longer uses early first-paint hack', !chatPageCode.includes('Show main app FIRST') && chatPageCode.includes('showAuthenticatedPageShell'));
check('Chat info panel has the title node required by runtime actions', chatHtml.includes('id="chatInfoPanelTitle"') && chatPageCode.includes('_setInfoPanelTitle'));
check('Chat theme follows shared manual/auto storage contract', chatPageCode.includes('function _applyChatThemeFromStorage') && chatPageCode.includes('pzp_autoNight') && chatPageCode.includes('chatResetAutoThemeBtn') && chatPageCode.includes('night-auto'));
check('Chat transient panels close through shared outside/Escape handling', chatPageCode.includes('function _closeChatTransientPanels') && chatPageCode.includes('function _closeChatModalOverlays') && chatPageCode.includes('if (_closeChatModalOverlays()) return') && chatPageCode.includes('if (_closeChatTransientPanels()) return'));
check('Chat bootstrap resolves initial dialog target canonically', chatPageCode.includes('function _resolveInitialChannelTarget') && chatPageCode.includes('function _getUrlChannelId') && chatPageCode.includes('window.__chatPendingOpenChannelId') && chatPageCode.includes('chatLastActiveChannelId') && !chatPageCode.includes('_selectChannel(_channels[0])'));
check('Chat bootstrap renders visible dialog loading and empty states', chatHtml.includes('id="chatDialogState"') && chatPageCode.includes('function _showDialogLoadingState') && chatPageCode.includes('function _renderDialogEmptyState') && chatPageCode.includes('data-chat-dialog-retry') && chatCss.includes('.chat-dialog-state.visible') && chatCss.includes('@keyframes chatDialogSpin'));
check('Chat selected dialog is persisted for token resume', chatPageCode.includes("localStorage.setItem(CHAT_LAST_ACTIVE_CHANNEL_KEY, String(channel.id))") && chatPageCode.includes('await _selectChannel(initialChannel)') && chatPageCode.includes('_rememberPendingDialogOpen(channel.id);'));
check('Chat guardian/info panels use one panel-state manager', chatPageCode.includes('var _chatPanelState = { active: null }') && chatPageCode.includes('function _closeAllChatPanels') && chatPageCode.includes("_toggleChatPanel('guardianLog'") && chatPageCode.includes("_toggleChatPanel('digest'") && chatPageCode.includes("_toggleChatPanel('guardianAnalytics'"));
check('Chat digest stats have readable tone classes', chatPageCode.includes('function _renderGuardianStat') && chatPageCode.includes('guardian-digest-stat--') && chatCss.includes('.guardian-digest-stat--danger') && chatCss.includes('.guardian-digest-stat--warning'));
check('Chat date divider has dark readable badge', chatCss.includes('body.dark-mode .chat-date-divider span') && chatCss.includes('background: rgba(15,23,42,0.82)') && chatCss.includes('color: #E2E8F0'));
const chatSettingsCode = fs.readFileSync(path.join(ROOT, 'js', 'chat-settings-page.js'), 'utf8');
check('Chat settings page has dedicated script and shared key source UI', chatCss.includes('.chat-settings-page') && chatSettingsCode.includes('/api/settings/chat/ai/test') && fs.readFileSync(path.join(ROOT, 'chat-settings.html'), 'utf8').includes('crm_ai_default'));
check('Chat settings page gates shell reveal behind auth/API load', chatSettingsCode.includes('function _handleAuthRequired') && chatSettingsCode.includes('if (!_authToken())') && chatSettingsCode.includes('handleAuthError(resp)') && chatSettingsCode.includes('_render(data);') && chatSettingsCode.includes('_revealShell();'));
check('Match-3 game-over CTAs use semantic visible action group', minigameCode.includes('function renderGameOverActions') && minigameCode.includes('class="go-actions"') && minigameCode.includes('game-btn-overlay-secondary') && !minigameCode.includes('style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:12px"'));
check('Match-3 overlay secondary CTAs have mobile-visible styling', minigameCss.includes('.game-btn-overlay-secondary') && minigameCss.includes('.go-actions') && minigameCss.includes('grid-template-columns: 1fr 1fr') && minigameCss.includes('.go-action-primary'));
check('Dashboard retires bulky low-signal widgets from the main surface', dashboardPageCode.includes('DASHBOARD_RETIRED_WIDGETS') && ['finance_today', 'reports_today', 'account_stats', 'week_bookings'].every(key => dashboardPageCode.includes(key)) && dashboardPageCode.includes('!DASHBOARD_RETIRED_WIDGETS.has'));
check('Dashboard grid keeps widgets at natural height', dashboardCss.includes('align-items: start') && dashboardCss.includes('align-self: start'));
check('CRM assistant rail is shared and loaded from auth shell', authCode.includes('function initCrmAssistantRail') && authCode.includes('css/assistant-rail.css') && authCode.includes('js/assistant-rail.js') && assistantRailCode.includes('window.CrmAssistantRail'));
const assistantRailUsesCenteredHost = assistantRailCode.includes('function ensureAssistantRailHost') && assistantRailCode.includes("host.id = 'crmAssistantRailHost'") && assistantRailCode.includes('host.appendChild(rail)');
const assistantRailUsesLegacyDirectInsert = assistantRailCode.includes('insertBefore(rail, userPanel)');
check('Shared assistant rail injects header UI instead of dashboard static copy', !dashboardHtml.includes('id="dashboardAssistantRail"') && assistantRailCode.includes('function ensureMounted') && assistantRailCode.includes("document.querySelector('.header .header-content')") && (assistantRailUsesCenteredHost || assistantRailUsesLegacyDirectInsert));
check('Shared assistant rail has 5s proactive help with interaction guard', assistantRailCode.includes('function scheduleProactiveHelp') && assistantRailCode.includes('5000') && assistantRailCode.includes('pageInteractionDetected') && assistantRailCode.includes('cancelProactiveHelp'));
check('Shared assistant rail supports CRM voice/text API contract', assistantRailCode.includes('/api/crm-assistant/reply') && assistantRailCode.includes('/api/crm-assistant/speak') && assistantRailCode.includes('/api/crm-assistant/transcribe') && assistantRailCode.includes('voiceEnabled'));
check('Shared assistant rail styles include partial ticker and mode visuals', assistantRailCss.includes('@keyframes assistantTicker') && assistantRailCss.includes('.assistant-rail-subtitles.is-ticker') && assistantRailCss.includes('[data-mode="speaking"]') && assistantRailCss.includes('[data-mode="busy"]') && assistantRailCss.includes('body.dark-mode .crm-assistant-rail'));
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
    return scripts.includes(obsoleteScript) || styles.includes(obsoleteStyle);
});
const roleSwitcherCss = fs.readFileSync(path.join(ROOT, 'css', 'role-switcher.css'), 'utf8');
const rolePanelTombstone = fs.readFileSync(path.join(ROOT, 'js', 'role-panel.js'), 'utf8');
check('Obsolete right-side role panel is not mounted by any page', pagesWithObsoleteRightPanel.length === 0 && rolePanelTombstone.includes('Compatibility tombstone') && !rolePanelTombstone.includes('createElement'));
check('Role switcher CSS keeps creator preview without right-panel chrome', roleSwitcherCss.includes('.role-switcher-dropdown') && !roleSwitcherCss.includes('.role-panel-fab') && !roleSwitcherCss.includes('.role-panel {'));

// Check lead modal action binding
const leadsCode = fs.readFileSync(path.join(ROOT, 'js/leads-page.js'), 'utf8');
check('Lead modal buttons bind before async data loads', leadsCode.indexOf('setupEvents();') < leadsCode.indexOf('await loadUsers();'));
check('Lead modal buttons support touchend taps', leadsCode.includes("btn.addEventListener('touchend', run, { passive: false })"));
check('Lead modal close avoids shared closeModal collision', leadsCode.includes('function closeLeadModal') && !leadsCode.includes('function closeModal'));
check('Lead save has duplicate-submit guard', leadsCode.includes('leadSaveInFlight'));
check('Lead assignees use lead-scoped endpoint', leadsCode.includes("apiFetch('/api/leads/assignees')"));
check('Lead workspace opens via query-driven endpoint', leadsCode.includes('getWorkspaceLeadIdFromUrl') && leadsCode.includes('/workspace') && leadsCode.includes("url.searchParams.set('lead'"));
check('Lead workspace uses canonical pipeline stage', leadsCode.includes('canonical: pipeline_stage') && leadsCode.includes('PIPELINE_STAGES.find'));
check('Lead workspace links customer/task/omni context', leadsCode.includes('/customers?open=') && leadsCode.includes('/tasks?open=') && leadsCode.includes('/omni?search='));
check('Lead customer linking uses searchable existing-customer dropdown', leadsCode.includes('leadCustomerSelect') && leadsCode.includes('apiSearchCustomers') && leadsCode.includes('submitLeadCustomerLinkExisting') && leadsCode.includes('submitLeadCustomerCreateNew'));
check('Lead kanban funnel renders into footer summary slot', leadsCode.includes('ensureKanbanSummarySlot') && leadsCode.includes('kanbanSummarySlot') && leadsCode.includes('slotEl.appendChild(funnelEl)') && !leadsCode.includes('kanbanWrap.parentNode.insertBefore(funnelEl, kanbanWrap)'));

const customersCode = fs.readFileSync(path.join(ROOT, 'js/customers-page.js'), 'utf8');
const tasksCode = fs.readFileSync(path.join(ROOT, 'js/tasks-page.js'), 'utf8');
const centerCode = fs.readFileSync(path.join(ROOT, 'js/center-page.js'), 'utf8');
const uiCode = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8');
const omniHtml = fs.readFileSync(path.join(ROOT, 'omni.html'), 'utf8');
const pagesCss = fs.readFileSync(path.join(ROOT, 'css/pages.css'), 'utf8');
check('Customers page opens existing customer deep links', customersCode.includes('getCustomerDeepLinkId') && customersCode.includes("params.get('open')") && customersCode.includes("params.get('highlight')"));
check('Customer card exposes communication hub context', customersCode.includes('fetchCustomerCommunicationContext') && customersCode.includes('/communication-context') && customersCode.includes('renderCustomerCommunicationHub') && customersCode.includes('customerCommHub'));
check('Customer communication hub has exact/suggested/unavailable styling', htmlContains('customers.html', '.customer-hub-pill.exact') && htmlContains('customers.html', '.customer-hub-pill.suggested') && htmlContains('customers.html', '.customer-hub-pill.unavailable'));
check('Tasks page opens task deep links', tasksCode.includes('getTaskDeepLinkId') && tasksCode.includes('openTaskDetail(taskId)'));
check('Task detail overlay uses guarded close instead of direct backdrop removal', tasksCode.includes('function isTaskDetailDirty') && tasksCode.includes('closeTaskDetailOverlay(false)') && !tasksCode.includes("taskDetailOverlay')?.remove()"));
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
check('Dashboard board notes use a stable textarea editor', dashboardPageCode.includes('<textarea class="board-note-text board-note-editor"') && !dashboardPageCode.includes('contenteditable="${_boardInteractionMode'));
check('Dashboard board note focus does not force a rerender', dashboardPageCode.includes("selectBoardItem(textEl.dataset.boardText, { render: false })") && dashboardPageCode.includes('handleBoardTextInput(textEl)'));
check('Dashboard board drag ignores note editors and controls', dashboardPageCode.includes('function isBoardInteractiveTarget') && dashboardPageCode.includes('if (isBoardInteractiveTarget(event.target)) return;'));
check('Dashboard board exposes drawing tools and clear-all action', dashboardPageCode.includes('function setBoardTool') && dashboardPageCode.includes('function clearBoardContent') && dashboardPageCode.includes('function addBoardText') && dashboardPageCode.includes('function addBoardFrame') && dashboardHtml.includes('data-board-tool="brush"') && dashboardHtml.includes('DashboardPage.clearBoardContent()'));
check('Dashboard board preserves drawing state through frontend and backend config', dashboardPageCode.includes('normalizeBoardStroke') && dashboardPageCode.includes('drawings: drawingsRaw') && dashboardRouteCode.includes('sanitizeBoardStroke') && dashboardRouteCode.includes('drawings,') && dashboardRouteCode.includes('activeTool: normalizeBoardTool'));
check('Dashboard board repairs legacy note payloads', dashboardPageCode.includes('item.noteText || item.content || item.body || item.label') && dashboardPageCode.includes('legacy-note-upgrade') && dashboardRouteCode.includes('item.noteText || item.content || item.body || item.label'));
check('Dashboard board renders shape variants', dashboardPageCode.includes("addBoardShape(shape = 'rect')") && dashboardCss.includes('.board-shape-arrow::after') && dashboardCss.includes('.board-shape-diamond'));
check('Dashboard team online endpoint distinguishes websocket online from last seen', dashboardRouteCode.includes('getOnlineUserIds') && dashboardRouteCode.includes('lastSeenSource') && dashboardRouteCode.includes('recentlyActive'));
check('Omni page applies contextual search query', omniHtml.includes('applyQueryContext') && omniHtml.includes("params.get('search')"));
check('Omni page exposes account connectivity panel', omniHtml.includes('omniAccountsPanel') && omniHtml.includes('omniAccountsGrid') && omniHtml.includes("api('/accounts')"));
check('Omni page guides unavailable channels to account setup', omniHtml.includes('accountGuidanceMessage') && omniHtml.includes('data-account-jump') && omniHtml.includes('Підключення каналів'));
check('Omni page separates inbox from channel setup and health workspaces', omniHtml.includes('omni-workspace-modes') && omniHtml.includes('data-omni-mode="inbox"') && omniHtml.includes('id="omniChannelsWorkspace"') && omniHtml.includes('id="omniHealthWorkspace"') && omniHtml.includes('function setOmniMode') && omniHtml.includes('function renderOmniHealthWorkspace'));
check('Omni channel setup is not embedded in the conversation sidebar', omniHtml.indexOf('id="omniAccountsPanel"') > omniHtml.indexOf('id="omniChannelsWorkspace"') && !omniHtml.includes('omni-chat-empty-icon">Om'));
check('Center hot leads update canonical pipeline stage', centerCode.includes('JSON.stringify({ pipeline_stage: status })'));
check('Explainability helper exposes filter summary and empty state renderers', uiCode.includes('window.Explainability') && uiCode.includes('renderFilterSummary') && uiCode.includes('renderEmptyState'));
check('Explainability shared styles exist', pagesCss.includes('.explain-filter-summary') && pagesCss.includes('.explain-empty') && pagesCss.includes('.explain-clear-btn'));
check('Tasks counts are category-aware', tasksCode.includes('const active = filterByCategory(allTasks.filter') && tasksCode.includes('taskEmptyState'));
check('Leads, Customers, Omni expose clearable filter summaries', leadsCode.includes('resetLeadFilters') && customersCode.includes('resetCustomerFilters') && omniHtml.includes('resetOmniFilters'));
check('Dashboard work queue surfaces endpoint metadata', dashboardPageCode.includes('renderWorkQueueExplainability') && dashboardPageCode.includes('omittedBuckets'));
check('Dashboard renders compact funnel widget from work queue insights', dashboardPageCode.includes('funnel:') && dashboardPageCode.includes('loadFunnelWidget') && dashboardPageCode.includes('renderCompactFunnelWidget') && dashboardPageCode.includes('funnelInsights'));

// Check unsafe dismiss guardrails for critical editable surfaces
console.log('\nunsafe dismiss guardrails');
const bookingCode = fs.readFileSync(path.join(ROOT, 'js/booking.js'), 'utf8');
const timelineCode = fs.readFileSync(path.join(ROOT, 'js/timeline.js'), 'utf8');
const appCodeForDismiss = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
const financeCode = fs.readFileSync(path.join(ROOT, 'js/finance-page.js'), 'utf8');
const designsPageCode = fs.readFileSync(path.join(ROOT, 'js/designs-page.js'), 'utf8');
const designsHtml = fs.readFileSync(path.join(ROOT, 'designs.html'), 'utf8');
const staffCode = fs.readFileSync(path.join(ROOT, 'js/staff-page.js'), 'utf8');
const hrCode = fs.readFileSync(path.join(ROOT, 'js/hr-page.js'), 'utf8');
const contentCode = fs.readFileSync(path.join(ROOT, 'js/content-page.js'), 'utf8');
check('Booking UI separates park and client pinata modes', bookingCode.includes('syncPinataModeFields') && bookingCode.includes('clientPinataServicePrice') && bookingCode.includes('renderPinataDetailRows'));
check('Booking UI captures pinata and filler numbers separately', bookingCode.includes('pinataNumber') && bookingCode.includes('pinataFillerNumber') && htmlContains('index.html', 'pinataSharedFields'));
check('Booking route normalizes client pinata server-side', htmlContains('routes/bookings.js', 'normalizePinataFields') && htmlContains('routes/bookings.js', 'client_pinata_service_price'));
check('Booking route stores pinata operation numbers server-side', htmlContains('routes/bookings.js', 'pinata_number') && htmlContains('routes/bookings.js', 'pinata_filler_number'));
check('Pinata demand excludes client pinata service', htmlContains('routes/catalogs.js', "COALESCE(b.pinata_mode, 'park') = 'park'") && htmlContains('routes/warehouse.js', "COALESCE(pinata_mode, 'park') = 'park'"));
check('Shared UnsafeDismissGuard exposes dirty guarded close policy', uiCode.includes('const UnsafeDismissGuard') && uiCode.includes('attemptCloseEditableSurface') && uiCode.includes('confirmDiscardIfDirty') && uiCode.includes('window.UnsafeDismissGuard = UnsafeDismissGuard'));
check('Shared closeAllModals respects editable dirty surfaces', uiCode.includes("m.dataset.editableSurface === 'true'") && uiCode.includes('attemptCloseEditableSurface(m') && uiCode.includes('reason: \'close-all\''));
check('Shared formModal cancel/backdrop path asks dirty guard', uiCode.includes('const requestCancel = async') && uiCode.includes('confirmDiscardIfDirty(overlay') && uiCode.includes("overlay.addEventListener('click', (e) => { if (e.target === overlay) requestCancel(); });"));
check('Lead edit backdrop and Escape route through guarded close', leadsCode.includes("overlay.id === 'leadModal'") && leadsCode.includes('closeLeadModal(false)') && leadsCode.includes('attemptCloseEditableSurface(modal'));
check('Booking panel guards date changes and panel close', bookingCode.includes('async function closeBookingPanel') && bookingCode.includes('attemptCloseEditableSurface(panel') && appCodeForDismiss.includes('if (!await closeBookingPanel(false))') && timelineCode.includes('async function selectCell'));
check('Task/customer/finance edit surfaces use shared dirty guard', tasksCode.includes('attemptCloseEditableSurface(overlay') && customersCode.includes('attemptCloseEditableSurface(modal') && financeCode.includes('attemptCloseEditableSurface(modal'));
check('Design/catalog overlays guard dirty dismiss paths', designsPageCode.includes('attemptCloseEditableSurface(overlay') && designsHtml.includes('guardedEditableOverlayClose') && designsHtml.includes('closeAutomationModal(false)'));
check('Staff and HR edit modals use guarded close paths', staffCode.includes('attemptCloseEditableSurface(overlay') && hrCode.includes('closeHrEditableModal') && hrCode.includes('showHrEditableModal'));
check('Content edit modals force-close only after durable actions', contentCode.includes('attemptCloseEditableSurface(modal') && contentCode.includes('await closeModal(true)') && contentCode.includes('await closeCardModal(true)'));

// Check Timeline/Kleshnya shell collapse keeps geometry in CSS
const appCode = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
check('Timeline sidebar collapse is class-based', appCode.includes("sidebar.classList.add('collapsed')") && appCode.includes("sidebar.classList.toggle('collapsed')"));
check('Timeline sidebar collapse avoids inline shell offsets', !appCode.includes('style.marginLeft') && !appCode.includes("style.width = 'calc(100% - 64px)'"));
check('Timeline product sales button opens modal', appCode.includes('showProductSalesModal') && appCode.includes("document.getElementById('productSalesBtn')?.addEventListener('click', showProductSalesModal)"));
check('Timeline product sales API loads monthly report', appCode.includes('/api/analytics/product-sales?') && appCode.includes('loadProductSalesReport'));
check('Timeline product sales export supports CSV and XLSX', appCode.includes("downloadProductSalesExport('csv')") && appCode.includes("downloadProductSalesExport('xlsx')"));
check('Timeline product sales supports pinata quick filter', appCode.includes("categorySelect.value = 'pinata'"));
check('Timeline product sales button is permission-gated', authCode.includes('productSalesBtn') && authCode.includes("canAccess('export_data')"));

// ═══════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`${'═'.repeat(50)}`);
process.exit(failed > 0 ? 1 : 0);
