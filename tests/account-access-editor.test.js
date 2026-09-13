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

function membershipProfile(overrides = {}) {
    const membership = { role: 'manager', extraRoles: [], pageAllowlist: ['/reports'], pageDenylist: [],
        actionAllowlist: [], actionDenylist: ['delete_booking'], isDefault: true, isActive: true, organizationRole: 'owner' };
    return {
        userId: 42, canEditAccount: true, membershipContextKeys: ['event_genix', 'dar'],
        organizations: [{ id: 7, name: 'Fixture Organization', slug: 'fixture', role: 'owner', businesses: [
            { id: 11, contextKey: 'event_genix', label: 'Fixture Park', status: 'active', accessMode: 'membership', membership,
                canEdit: true, canDeactivate: true, canManageOrganizationRole: true },
            { id: 12, contextKey: 'dar', label: 'Fixture Dar', status: 'active', accessMode: 'membership',
                membership: { ...membership, role: 'animator', pageAllowlist: [], actionDenylist: [], isDefault: false },
                canEdit: true, canDeactivate: true, canManageOrganizationRole: true }
        ] }], ...overrides
    };
}

function membershipEditor(options = {}) {
    return editor.createModel({ user: { id: 42, username: 'fixture_account' },
        initial: { role: 'creator', extraRoles: [], pageAllowlist: ['/finance'], businessContexts: ['event_genix', 'maysternya_doli'], defaultBusinessContext: 'event_genix' },
        accessProfile: membershipProfile(), ...options });
}

function captureMembershipTransport(t, fail = false) {
    const oldFetch = global.apiFetchWithAuthRetry;
    const oldHeaders = global.getAuthHeaders;
    const requests = [];
    global.getAuthHeaders = () => ({ 'Content-Type': 'application/json', 'X-Business-Context': 'dar', 'X-Business-Scope': 'all', 'X-Business-Contexts': 'dar,event_genix' });
    global.apiFetchWithAuthRetry = async (url, options) => {
        requests.push({ url, ...options, body: options.body ? JSON.parse(options.body) : undefined });
        return { ok: !fail, status: fail ? 403 : 200, async json() { return fail ? { success: false, error: 'Fixture access denied' } : { success: true }; } };
    };
    t.after(() => {
        if (oldFetch) global.apiFetchWithAuthRetry = oldFetch;
        else delete global.apiFetchWithAuthRetry;
        if (oldHeaders) global.getAuthHeaders = oldHeaders;
        else delete global.getAuthHeaders;
    });
    return requests;
}

test('business scope uses membership roles and overrides without inheriting global creator grants', () => {
    const model = membershipEditor();
    assert.equal(editor.switchScope(model, 'business:7:12'), true);
    assert.equal(model.draft.role, 'animator');
    assert.deepEqual(model.draft.pageAllowlist, []);
    assert.equal(model.draft.isDefault, false);
    assert.deepEqual(model.draft.businessContexts, ['dar']);
    assert.equal(model.isDirty(), false);
    assert.equal(editor.switchScope(model, 'business:7:11'), true);
    assert.equal(model.draft.role, 'manager');
    assert.deepEqual(model.draft.actionDenylist, ['delete_booking']);
    assert.equal(editor.switchScope(model, 'account'), true);
    assert.equal(model.draft.role, 'creator');
    assert.deepEqual(model.draft.pageAllowlist, ['/finance']);
});

test('dirty business scope switch waits for an explicit discard decision', () => {
    const model = membershipEditor();
    editor.switchScope(model, 'business:7:11');
    model.draft.role = 'reception';
    assert.equal(editor.requestScope(model, 'business:7:12'), false);
    assert.equal(model.scope, 'business:7:11');
    assert.equal(model.draft.role, 'reception');
    assert.equal(model.confirmClose, true);
    assert.equal(model.pendingScope, 'business:7:12');
    editor.switchScope(model, model.pendingScope);
    assert.equal(model.scope, 'business:7:12');
    assert.equal(model.draft.role, 'animator');
    assert.equal(model.isDirty(), false);
});

test('business save uses membership PUT with exact independent overrides and never invokes global account save', async t => {
    const requests = captureMembershipTransport(t);
    let globalSaves = 0;
    const model = membershipEditor({ onSave() { globalSaves += 1; } });
    editor.switchScope(model, 'business:7:12');
    model.draft.role = 'reception';
    model.draft.isDefault = true;
    model.draft.pageDenylist = ['/reports'];
    const response = await editor.saveDraft(model);
    assert.equal(response.scope, 'business');
    assert.equal(globalSaves, 0);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/organizations/7/members/42');
    assert.equal(requests[0].method, 'PUT');
    assert.equal(requests[0].authBusinessScope, false);
    assert.deepEqual(requests[0].headers, { 'Content-Type': 'application/json' });
    assert.deepEqual(requests[0].body, { businessId: 12, role: 'reception', pageDenylist: ['/reports'], isDefault: true });
});

test('business deactivation uses the selected membership DELETE without changing account roles or defaults', async t => {
    const requests = captureMembershipTransport(t);
    const model = membershipEditor();
    editor.switchScope(model, 'business:7:11');
    model.draft.isActive = false;
    assert.equal(model.isDirty(), true);
    const result = await editor.saveDraft(model);
    assert.equal(result.deactivated, true);
    assert.equal(requests[0].url, '/api/organizations/7/members/42/11');
    assert.equal(requests[0].method, 'DELETE');
    assert.equal(requests[0].body, undefined);
    assert.equal(model.accountInitial.role, 'creator');
});

test('failed membership save preserves the complete dirty draft for correction or retry', async t => {
    captureMembershipTransport(t, true);
    const model = membershipEditor();
    editor.switchScope(model, 'business:7:11');
    model.draft.pageDenylist = ['/reports'];
    const before = structuredClone(model.draft);
    await assert.rejects(editor.saveDraft(model), /Fixture access denied/);
    assert.deepEqual(model.draft, before);
    assert.equal(model.isDirty(), true);
});

test('membership-only owner opens a business directly and cannot switch or save global account state', async () => {
    const model = membershipEditor({ accessProfile: membershipProfile({ canEditAccount: false }) });
    assert.equal(model.scope, 'business:7:11');
    assert.equal(editor.switchScope(model, 'account'), false);
    model.scope = 'account';
    await assert.rejects(editor.saveDraft(model), /глобального доступу/);
});

test('missing membership requires explicit activation and non-platform role instead of copying account rights', async t => {
    const requests = captureMembershipTransport(t);
    const profile = membershipProfile({ canEditAccount: false });
    profile.organizations[0].businesses[0].membership = null;
    profile.organizations[0].businesses[0].canDeactivate = false;
    const model = membershipEditor({ accessProfile: profile });
    assert.equal(model.draft.role, '');
    assert.equal(model.draft.isActive, false);
    assert.deepEqual(model.draft.pageAllowlist, []);
    model.draft.isActive = true;
    await assert.rejects(editor.saveDraft(model), /Оберіть бізнес-роль/);
    model.draft.role = 'creator';
    await assert.rejects(editor.saveDraft(model), /Оберіть бізнес-роль/);
    assert.equal(requests.length, 0);
    model.draft.role = 'animator';
    await editor.saveDraft(model);
    assert.equal(requests[0].body.role, 'animator');
    assert.equal(Object.hasOwn(requests[0].body, 'organizationRole'), false);
});

test('read-only membership flags deny mutation and ownership changes are sent only when authorized and changed', async t => {
    const requests = captureMembershipTransport(t);
    const profile = membershipProfile();
    profile.organizations[0].businesses[0].canEdit = false;
    profile.organizations[0].businesses[0].canDeactivate = false;
    const model = membershipEditor({ accessProfile: profile });
    editor.switchScope(model, 'business:7:11');
    await assert.rejects(editor.saveDraft(model), /недоступна/);
    model.draft.isActive = false;
    await assert.rejects(editor.saveDraft(model), /Деактивація/);
    assert.equal(requests.length, 0);
    editor.switchScope(model, 'business:7:12');
    model.draft.organizationRole = 'admin';
    await editor.saveDraft(model);
    assert.equal(requests[0].body.organizationRole, 'admin');
});

test('global callback preserves read-only membership mirrors while compatibility business edits remain possible', async () => {
    let saved;
    const model = membershipEditor({ onSave(state) { saved = state; return { success: true }; } });
    model.draft.businessContexts = ['dar', 'crm'];
    model.draft.defaultBusinessContext = 'dar';
    model.draft.role = 'director';
    await editor.saveDraft(model);
    assert.deepEqual(saved.businessContexts.sort(), ['crm', 'event_genix']);
    assert.equal(saved.defaultBusinessContext, 'event_genix');
    assert.equal(saved.role, 'director');
});

test('existing creator membership default edits preserve inherited creator fields without assigning them again', async t => {
    const requests = captureMembershipTransport(t);
    const profile = membershipProfile();
    profile.organizations[0].businesses[0].membership.role = 'creator';
    const model = membershipEditor({ accessProfile: profile });
    editor.switchScope(model, 'business:7:11');
    model.draft.isDefault = false;
    await editor.saveDraft(model);
    assert.equal(Object.hasOwn(requests[0].body, 'role'), false);
    assert.equal(requests[0].body.isDefault, false);
});

test('profile target mismatch and loading state fail closed', async () => {
    const model = membershipEditor();
    assert.throws(() => editor.applyAccessProfile(model, membershipProfile({ userId: 99 })), /не відповідає/);
    model.profileLoading = true;
    await assert.rejects(editor.saveDraft(model), /Дочекайтеся/);
});

test('default-only edit leaves role and every override absent so concurrent unrelated changes survive', async t => {
    const requests = captureMembershipTransport(t);
    const model = membershipEditor();
    editor.switchScope(model, 'business:7:12');
    model.draft.isDefault = true;
    await editor.saveDraft(model);
    assert.deepEqual(requests[0].body, { businessId: 12, isDefault: true });
});
