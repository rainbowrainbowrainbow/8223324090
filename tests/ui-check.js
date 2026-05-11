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

// ═══════════════════════════════════════════════════
// PAGE CHECKS
// ═══════════════════════════════════════════════════

checkPage('index.html', (doc) => {
    check('loginForm exists', !!doc.getElementById('loginForm'));
    check('loginScreen exists', !!doc.getElementById('loginScreen'));
    check('mainApp exists', !!doc.getElementById('mainApp'));
    check('submit button has type=submit', doc.querySelector('.btn-login')?.type === 'submit');
    check('sidebarLinks exists', !!doc.getElementById('sidebarLinks'));
});

checkPage('dashboard.html', (doc, html) => {
    check('loginForm exists', !!doc.getElementById('loginForm'));
    check('mainApp exists', !!doc.getElementById('mainApp'));
    check('dashboardGrid exists', !!doc.getElementById('dashboardGrid'));
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

checkPage('art-director.html', (doc) => {
    check('tabs exist', doc.querySelectorAll('.artdir-tab').length > 0);
    check('sidebar exists', !!doc.getElementById('sidebarNav'));
});

checkPage('center.html', (doc) => {
    check('tabs exist', doc.querySelectorAll('.center-tab-btn').length > 0);
    check('sidebar exists', !!doc.getElementById('sidebarNav'));
});

checkPage('copilot.html', (doc) => {
    check('copilotApp exists', !!doc.getElementById('copilotApp'));
    check('nav items exist', doc.querySelectorAll('.copilot-nav-item').length > 0);
});

checkPage('designer.html', (doc) => {
    check('5 tabs exist', doc.querySelectorAll('.designer-tab').length === 5);
    check('sidebar exists', !!doc.getElementById('sidebarNav'));
});

// ═══════════════════════════════════════════════════
// JS FILE CHECKS
// ═══════════════════════════════════════════════════

const criticalJS = [
    'js/config.js', 'js/api.js', 'js/auth.js', 'js/app.js',
    'js/components/sidebar.js',
    'js/art-director-page.js', 'js/center-page.js', 'js/demo-page.js',
    'js/designs-page.js', 'js/copilot-page.js',
    'js/dashboard-page.js', 'js/finance-page.js', 'js/analytics-page.js',
    'js/hr-page.js', 'js/staff-page.js', 'js/customers-page.js',
    'js/tasks-page.js', 'js/leads-page.js', 'js/chat-page.js',
    'js/warehouse-page.js', 'js/reports-page.js',
    'js/booking.js', 'js/timeline.js', 'js/settings.js',
    'js/graduation.js', 'js/sound-page.js',
];

for (const f of criticalJS) {
    checkJSFile(f);
}

// Check copilot exports
const copilotCode = fs.readFileSync(path.join(ROOT, 'js/copilot-page.js'), 'utf8');
check('CopilotPage has selectScript', copilotCode.includes('selectScript'));
check('CopilotPage has showAddInteractionForm', copilotCode.includes('showAddInteractionForm'));
check('CopilotPage has loadTrackerAlerts', copilotCode.includes('loadTrackerAlerts'));

// Check sidebar nav items
const sidebarCode = fs.readFileSync(path.join(ROOT, 'js/components/sidebar.js'), 'utf8');
check('Sidebar has /designs', sidebarCode.includes("href: '/designs'"));
check('Sidebar has /designs#catalogs', sidebarCode.includes("href: '/designs#catalogs'"));
check('Sidebar has /designer', sidebarCode.includes("href: '/designer'"));
check('Sidebar has Центр керування', sidebarCode.includes('Центр керування'));

// ═══════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`${'═'.repeat(50)}`);
process.exit(failed > 0 ? 1 : 0);
