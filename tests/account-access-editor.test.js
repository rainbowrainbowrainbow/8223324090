const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');

require('../js/account-access-editor.js');
const editor = global.AccountAccessEditor;

test('effective access draft uses deny, allow, role preset, then default deny', () => {
    const model = editor.createModel({
        user: { username: 'qa.admin' },
        initial: { role: 'admin', actionAllowlist: [], actionDenylist: [] },
        actions: [
            { key: 'hr.schedule.view', label: 'Schedule', defaultRoles: ['admin'], delegable: true },
            { key: 'hr.reports.view', label: 'Reports', defaultRoles: [], delegable: true }
        ]
    });
    const schedule = model.config.capabilities.find(item => item.key === 'hr.schedule.view');
    const reports = model.config.capabilities.find(item => item.key === 'hr.reports.view');

    assert.equal(model.decision(schedule).allowed, true);
    assert.equal(model.decision(schedule).source, 'role_preset');
    assert.equal(model.decision(reports).allowed, false);
    assert.equal(model.decision(reports).source, 'default_deny');

    model.setMode(reports, 'allow');
    assert.equal(model.decision(reports).source, 'explicit_allow');
    assert.equal(model.isDirty(), true);

    model.setMode(schedule, 'deny');
    assert.equal(model.decision(schedule).allowed, false);
    assert.equal(model.decision(schedule).source, 'explicit_deny');
    assert.deepEqual(model.draft.actionAllowlist, ['hr.reports.view']);
    assert.deepEqual(model.draft.actionDenylist, ['hr.schedule.view']);
});

test('one capability cannot remain in allow and deny arrays', () => {
    const model = editor.createModel({
        initial: {
            role: 'animator',
            actionAllowlist: ['edit_booking'],
            actionDenylist: ['edit_booking']
        },
        actions: [{ key: 'edit_booking', label: 'Edit', defaultRoles: [], delegable: true }]
    });
    const definition = model.config.capabilities[0];
    model.setMode(definition, 'allow');
    assert.deepEqual(model.draft.actionAllowlist, ['edit_booking']);
    assert.deepEqual(model.draft.actionDenylist, []);
    model.setMode(definition, 'deny');
    assert.deepEqual(model.draft.actionAllowlist, []);
    assert.deepEqual(model.draft.actionDenylist, ['edit_booking']);
    model.setMode(definition, 'inherited');
    assert.deepEqual(model.draft.actionAllowlist, []);
    assert.deepEqual(model.draft.actionDenylist, []);
});

test('page modules support inherited, allow and deny with canonical draft keys', () => {
    const definition = { key: '/reports', canonicalPath: '/reports', aliases: ['/reports.html'], label: 'Reports', defaultRoles: ['senior_manager'] };
    const model = editor.createModel({
        initial: { role: 'senior_manager', pageAllowlist: ['/reports.html', '/reports'], pageDenylist: [] },
        pages: [definition]
    });
    const reports = model.config.capabilities[0];

    assert.deepEqual(model.draft.pageAllowlist, ['/reports']);
    assert.deepEqual(model.draft.pageDenylist, []);
    assert.equal(model.decision(reports).source, 'explicit_allow');

    model.setMode(reports, 'deny');
    assert.deepEqual(model.draft.pageAllowlist, []);
    assert.deepEqual(model.draft.pageDenylist, ['/reports']);
    assert.deepEqual(model.effectiveDiff()[0].previousMode, 'allow');
    assert.deepEqual(model.effectiveDiff()[0].nextMode, 'deny');
    assert.equal(model.decision(reports).source, 'explicit_deny');

    model.setMode(reports, 'allow');
    assert.deepEqual(model.draft.pageAllowlist, ['/reports']);
    assert.deepEqual(model.draft.pageDenylist, []);

    model.setMode(reports, 'inherited');
    assert.deepEqual(model.draft.pageAllowlist, []);
    assert.deepEqual(model.draft.pageDenylist, []);
    assert.equal(model.decision(reports).source, 'role_preset');

    const conflictingStoredState = editor.createModel({
        initial: { role: 'senior_manager', pageAllowlist: ['/reports.html'], pageDenylist: ['/reports'] },
        pages: [definition]
    });
    assert.deepEqual(conflictingStoredState.draft.pageAllowlist, []);
    assert.deepEqual(conflictingStoredState.draft.pageDenylist, ['/reports']);
});

test('stored-list diff ignores canonical key ordering', () => {
    const model = editor.createModel({
        initial: { role: 'admin', pageAllowlist: ['/reports', '/customers'] },
        pages: [
            { key: '/reports', canonicalPath: '/reports', label: 'Reports', group: 'Sales', defaultRoles: ['admin'] },
            { key: '/customers', canonicalPath: '/customers', label: 'Customers', group: 'Sales', defaultRoles: ['admin'] }
        ]
    });
    model.draft = { ...model.draft, pageAllowlist: ['/customers', '/reports'] };
    assert.equal(model.isDirty(), false);
    assert.deepEqual(model.diff(), []);
});

test('page group actions preview effective changes before applying the draft', () => {
    const model = editor.createModel({
        initial: { role: 'senior_manager', pageAllowlist: [], pageDenylist: [] },
        pages: [
            { key: '/reports', canonicalPath: '/reports', label: 'Reports', group: 'Sales', defaultRoles: ['senior_manager'] },
            { key: '/customers', canonicalPath: '/customers', label: 'Customers', group: 'Sales', defaultRoles: ['senior_manager'] }
        ]
    });
    const pages = model.config.capabilities;
    const preview = model.previewGroup(pages, 'deny', 'Sales');

    assert.deepEqual(model.draft.pageDenylist, []);
    assert.equal(preview.changedCount, 2);
    assert.equal(preview.effectiveChanges.length, 2);
    assert.deepEqual(preview.nextState.pageDenylist, ['/reports', '/customers']);

    model.draft = preview.nextState;
    assert.deepEqual(model.draft.pageAllowlist, []);
    assert.deepEqual(model.draft.pageDenylist, ['/reports', '/customers']);
});

test('registry page metadata keeps human labels in the editor model', () => {
    const model = editor.createModel({
        initial: { role: 'admin', pageAllowlist: [] },
        pages: [
            { key: '/demo', label: 'Demo', group: 'Система', defaultRoles: [] },
            { key: '/hermes-studio', label: 'Hermes Studio', group: 'Продукт', defaultRoles: ['admin'] },
            { key: '/booking-summary.html', label: 'Підсумок бронювання', group: 'Система', defaultRoles: [] },
            { key: '/certificates/new', label: 'Видати сертифікат або абонемент', group: 'Продукт', defaultRoles: [] },
            { key: '/accounting-deposits', label: 'Перевірка завдатків', group: 'Продажі та фінанси', defaultRoles: [] }
        ]
    });
    const definitions = new Map(model.config.capabilities.map(definition => [definition.key, definition]));

    assert.equal(definitions.get('/demo').label, 'Demo');
    assert.equal(definitions.get('/hermes-studio').label, 'Hermes Studio');
    assert.equal(definitions.get('/booking-summary.html').label, 'Підсумок бронювання');
    assert.equal(definitions.get('/certificates/new').label, 'Видати сертифікат або абонемент');
    assert.equal(definitions.get('/accounting-deposits').label, 'Перевірка завдатків');
    assert.equal(definitions.get('/accounting-deposits').group, 'Продажі та фінанси');
    assert.equal(Array.from(definitions.values()).some(definition => definition.label === definition.key), false);
});
test('access editor owns its workspace and hr-page no longer uses formModal for access', () => {
    const html = fs.readFileSync(path.join(ROOT, 'hr.html'), 'utf8');
    const bridge = fs.readFileSync(path.join(ROOT, 'js', 'hr-page.js'), 'utf8');
    const moduleSource = fs.readFileSync(path.join(ROOT, 'js', 'account-access-editor.js'), 'utf8');
    const css = fs.readFileSync(path.join(ROOT, 'css', 'account-access-editor.css'), 'utf8');
    const packageJson = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
    const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    const start = bridge.indexOf('async function openAccountAccessEditor');
    const end = bridge.indexOf('async function toggleAccountActive', start);
    const accessFunction = bridge.slice(start, end);

    assert.match(html, /css\/account-access-editor\.css/);
    assert.match(html, /js\/account-access-editor\.js/);
    assert.equal(accessFunction.includes('formModal('), false);
    assert.match(accessFunction, /AccountAccessEditor\.open/);
    assert.match(accessFunction, /\/workspace/);
    assert.match(bridge, /accessReturnFocus[\s\S]*data-account-menu-toggle[\s\S]*openAccountAccessEditor\(userId, accessReturnFocus\)/);
    assert.match(moduleSource, /role="dialog" aria-modal="true"/);
    assert.match(moduleSource, /role="alertdialog"/);
    assert.match(moduleSource, /data-action="discard"/);
    assert.match(moduleSource, /ignoreServer: true/);
    assert.match(moduleSource, /pageDenylist/);
    assert.match(moduleSource, /data-group-preview/);
    assert.match(moduleSource, /renderEffectiveDiff/);
    assert.match(moduleSource, /const group = definition\.group \|\| \(definition\.type === 'page'/);
    assert.match(moduleSource, /if \(model\.saving\) return/);
    assert.match(moduleSource, /document\.addEventListener\('keydown'/);
    assert.match(moduleSource, /element\.inert = true/);
    assert.match(css, /body\.account-access-editor-open \.toast-container/);
    assert.match(css, /@media \(max-width: 600px\)/);
    assert.match(packageJson, /test:browser:account-access/);
    assert.match(workflow, /Run access editor lifecycle and focus browser smoke/);
    assert.match(workflow, /test:browser:account-access:lifecycle/);
    assert.match(workflow, /Run access editor dirty draft and failed-save browser smoke/);
    assert.match(workflow, /test:browser:account-access:draft/);
    assert.match(workflow, /Run access editor tri-state page browser smoke/);
    assert.match(workflow, /test:browser:account-access:tri-state/);
    assert.match(workflow, /Run access editor test-backend persistence browser smoke/);
    assert.match(workflow, /test:browser:account-access:backend/);
    assert.match(workflow, /Run access editor mobile browser smoke/);
    assert.match(workflow, /test:browser:account-access:mobile/);
});

test('account access editor cannot draft explicit-allow-disabled Finance access', () => {
    const model = editor.createModel({
        initial: { role: 'senior_manager', pageAllowlist: [], actionAllowlist: [], actionDenylist: [] },
        pages: [{ key: '/finance', label: 'Finance', defaultRoles: ['creator', 'director', 'accountant'], explicitAllow: false }],
        actions: [{ key: 'finance.manage', label: 'Manage finance', defaultRoles: ['creator', 'director', 'accountant'], explicitAllow: false, delegable: true }]
    });
    const financePage = model.config.capabilities.find(item => item.key === '/finance');
    const financeManage = model.config.capabilities.find(item => item.key === 'finance.manage');
    model.setMode(financePage, 'allow');
    model.setMode(financeManage, 'allow');
    assert.deepEqual(model.draft.pageAllowlist, []);
    assert.deepEqual(model.draft.actionAllowlist, []);
    model.setMode(financePage, 'deny');
    assert.deepEqual(model.draft.pageDenylist, ['/finance']);
    assert.equal(model.decision(financePage).source, 'explicit_deny');
    assert.equal(model.decision(financeManage).allowed, false);
});
