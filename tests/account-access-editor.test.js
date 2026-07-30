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

test('page modules expose inherited/allow without inventing a page deny array', () => {
    const model = editor.createModel({
        initial: { role: 'animator', pageAllowlist: [] },
        pages: [{ key: '/finance', label: 'Finance', defaultRoles: ['accountant'] }]
    });
    const definition = model.config.capabilities[0];
    model.setMode(definition, 'allow');
    assert.deepEqual(model.draft.pageAllowlist, ['/finance']);
    model.setMode(definition, 'deny');
    assert.deepEqual(model.draft.pageAllowlist, []);
    assert.equal(Object.hasOwn(model.draft, 'pageDenylist'), false);
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
    assert.match(moduleSource, /role="dialog" aria-modal="true"/);
    assert.match(moduleSource, /role="alertdialog"/);
    assert.match(moduleSource, /data-action="discard"/);
    assert.match(moduleSource, /ignoreServer: true/);
    assert.match(moduleSource, /if \(model\.saving\) return/);
    assert.match(moduleSource, /document\.addEventListener\('keydown'/);
    assert.match(moduleSource, /element\.inert = true/);
    assert.match(css, /body\.account-access-editor-open \.toast-container/);
    assert.match(css, /@media \(max-width: 600px\)/);
    assert.match(packageJson, /test:browser:account-access/);
    assert.match(workflow, /Run effective access editor browser smoke/);
    assert.match(workflow, /test:browser:account-access/);
});
