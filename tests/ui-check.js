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
    check('Lead modal grid allows narrow WebKit date inputs', html.includes('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)'));
    check('Lead modal controls can shrink inside grid columns', html.includes('min-width: 0; max-width: 100%'));
    check('Lead modal responsive row is scoped', html.includes('.lead-modal .form-row { grid-template-columns: 1fr; }'));
    check('Lead modal rows stack on touch devices', html.includes('@media (hover: none) and (pointer: coarse)') && html.includes('.lead-modal .form-row { grid-template-columns: 1fr; }'));
    check('Lead modal rows stack on WebKit touch fallback', html.includes('@supports (-webkit-touch-callout: none)') && html.includes('.lead-modal .form-row { grid-template-columns: 1fr; }'));
});

checkPage('tasks.html', (doc) => {
    check('Tasks explainability region exists', !!doc.getElementById('taskExplainability'));
    check('Tasks category filters exist', !!doc.getElementById('catFilters'));
    check('Tasks board content exists', !!doc.getElementById('boardContent'));
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
check('Dark mode defines shared text aliases', darkModeCss.includes('--text: #F8FAFC;') && darkModeCss.includes('--text-primary: #F8FAFC;') && darkModeCss.includes('--text-secondary: #CBD5E1;') && darkModeCss.includes('--text-muted: #94A3B8;'));
check('Dark mode defines shared surface/card aliases', darkModeCss.includes('--surface: #1E1E38;') && darkModeCss.includes('--card-bg: #1E1E38;') && darkModeCss.includes('--bg-card: #1E1E38;') && darkModeCss.includes('--border-color: rgba(255,255,255,0.12);'));
check('Dark placeholders and empty states use readable muted token', darkModeCss.includes('body.dark-mode .program-search-input::placeholder { color: var(--text-muted); }') && darkModeCss.includes('body.dark-mode .login-form input::placeholder') && darkModeCss.includes('body.dark-mode .empty-state-hint { color: var(--text-muted); }'));
check('Dark native selects keep opened options readable', darkModeCss.includes('body.dark-mode select option') && darkModeCss.includes('body.dark-mode select option:checked') && darkModeCss.includes('color-scheme: dark;'));
check('Dark customer/task muted labels avoid low-contrast gray', darkModeCss.includes('body.dark-mode .customer-age { color: var(--text-muted); }') && darkModeCss.includes('body.dark-mode .task-no-assignee { color: var(--text-muted); }') && !darkModeCss.includes('body.dark-mode .customer-age { color: #64748B; }'));
check('Dark catalog muted text avoids low-alpha white', catalogCss.includes('body.dark-mode .catalog-card-meta { color: var(--text-muted, #94A3B8); }') && catalogCss.includes('body.dark-mode .cat-page-detail { color: var(--text-muted, #94A3B8); }') && !catalogCss.includes('body.dark-mode .catalog-card-meta { color: rgba(255,255,255,0.4); }'));
check('Dark content/profile muted CTAs use readable muted token', contentCss.includes('body.dark-mode .content-bcard-slug { color: var(--text-muted, #94A3B8); }') && achievementsCss.includes('body.dark-mode .add-note-btn { border-color: #3D3D5C; color: var(--text-muted, #94A3B8); }'));

const criticalJS = [
    'js/config.js', 'js/api.js', 'js/auth.js', 'js/ui.js', 'js/app.js',
    'js/components/sidebar.js',
    'js/art-director-page.js', 'js/center-page.js', 'js/demo-page.js',
    'js/designs-page.js', 'js/copilot-page.js',
    'js/dashboard-page.js', 'js/finance-page.js', 'js/analytics-page.js',
    'js/hr-page.js', 'js/staff-page.js', 'js/customers-page.js',
    'js/tasks-page.js', 'js/leads-page.js', 'js/chat-page.js',
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
const fullAppShellPages = new Set(['chat.html', 'copilot.html', 'designer.html', 'index.html', 'omni.html', 'training.html']);
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
check('Sidebar status widgets render as one horizontal segmented rail', sidebarCode.includes('aria-label\', \'Швидкий стан CRM') && sidebarAuroraCss.includes('grid-template-columns: repeat(3, minmax(0, 1fr))') && sidebarCode.includes('Натисніть, щоб відкрити повну'));
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
const dashboardPageCode = fs.readFileSync(path.join(ROOT, 'js/dashboard-page.js'), 'utf8');
const dashboardCss = fs.readFileSync(path.join(ROOT, 'css/dashboard.css'), 'utf8');
check('Training page script does not double-initialize sidebar', !trainingPageCode.includes('Sidebar.init('));
check('Chat page no longer uses early first-paint hack', !chatPageCode.includes('Show main app FIRST') && chatPageCode.includes('showAuthenticatedPageShell'));
check('Dashboard retires bulky low-signal widgets from the main surface', dashboardPageCode.includes('DASHBOARD_RETIRED_WIDGETS') && ['finance_today', 'reports_today', 'account_stats', 'week_bookings'].every(key => dashboardPageCode.includes(key)) && dashboardPageCode.includes('!DASHBOARD_RETIRED_WIDGETS.has'));
check('Dashboard grid keeps widgets at natural height', dashboardCss.includes('align-items: start') && dashboardCss.includes('align-self: start'));
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
check('Dashboard team online renders last-seen presence states', dashboardPageCode.includes('formatTeamLastSeen') && dashboardPageCode.includes('онлайн зараз') && dashboardPageCode.includes('був ${minutes} хв тому') && dashboardPageCode.includes('team-presence-last-seen'));
check('Dashboard board notes use a stable textarea editor', dashboardPageCode.includes('<textarea class="board-note-text board-note-editor"') && !dashboardPageCode.includes('contenteditable="${_boardInteractionMode'));
check('Dashboard board note focus does not force a rerender', dashboardPageCode.includes("selectBoardItem(textEl.dataset.boardText, { render: false })") && dashboardPageCode.includes('handleBoardTextInput(textEl)'));
check('Dashboard board drag ignores note editors and controls', dashboardPageCode.includes('function isBoardInteractiveTarget') && dashboardPageCode.includes('if (isBoardInteractiveTarget(event.target)) return;'));
const dashboardRouteCode = fs.readFileSync(path.join(ROOT, 'routes/dashboard.js'), 'utf8');
check('Dashboard team online endpoint distinguishes websocket online from last seen', dashboardRouteCode.includes('getOnlineUserIds') && dashboardRouteCode.includes('lastSeenSource') && dashboardRouteCode.includes('recentlyActive'));
check('Omni page applies contextual search query', omniHtml.includes('applyQueryContext') && omniHtml.includes("params.get('search')"));
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
