'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function element() {
    return {
        children: [], selectors: new Map(), listeners: {}, isConnected: true, hidden: false, value: '',
        replaceChildren() { this.children = []; },
        setAttribute(key, value) { this[key] = value; },
        querySelector(selector) {
            if (!this.selectors.has(selector)) this.selectors.set(selector, element());
            return this.selectors.get(selector);
        },
        addEventListener(name, listener) { this.listeners[name] = listener; },
        appendChild(child) { this.children.push(child); if (!this.value) this.value = child.value; },
        focus() { this.focused = true; }
    };
}

function fixture(role = 'owner') {
    const user = { id: 1, businessProfile: { organizations: [{ id: 7, role }] } };
    const state = { requests: [], responses: [], opened: [], reloads: 0 };
    const context = {
        AppState: { currentUser: user }, document: { createElement: () => element() },
        getAuthHeaders: () => ({ Authorization: 'Bearer local-fixture', 'X-Business-Context': 'dar', 'x-business-scope': 'all' }),
        async apiFetchWithAuthRetry(url, options) {
            state.requests.push({ url, options });
            const queued = state.responses.shift();
            return typeof queued === 'function' ? queued() : queued;
        },
        AccountAccessEditor: { async open(options) { state.opened.push(options); return { saved: false }; } },
        location: { reload() { state.reloads += 1; } }
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/business-membership-manager.js'), 'utf8'), context);
    return { user, state, context, manager: context.BusinessMembershipManager };
}

const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const plain = value => JSON.parse(JSON.stringify(value));

test('owner/admin entry depends on server organization membership, never global creator claims', () => {
    const f = fixture();
    assert.equal(f.manager.canManage(f.user), true);
    assert.equal(f.manager.canManage({ businessProfile: { organizations: [{ role: 'admin' }] } }), true);
    assert.equal(f.manager.canManage({ role: 'creator', platformRole: 'creator' }), false);
    const panel = element();
    f.manager.mount(panel, { id: 1, businessProfile: { organizations: [{ role: 'member' }] } });
    assert.equal(panel.hidden, true);
    assert.equal(f.state.requests.length, 0);
});

test('scoped directory loads on explicit click and renders user names as text', async () => {
    const f = fixture();
    const panel = element();
    f.manager.mount(panel, f.user);
    assert.equal(f.state.requests.length, 0);
    f.state.responses.push(response({ success: true, members: [{ id: 42, name: '<img src=x onerror=fixture>', username: 'fixture' }] }));
    await panel.querySelector('[data-members-load]').listeners.click();
    const select = panel.querySelector('[data-members-select]');
    assert.equal(f.state.requests[0].url, '/api/organizations/members');
    assert.equal(f.state.requests[0].options.authBusinessScope, false);
    assert.deepEqual(plain(f.state.requests[0].options.headers), { Authorization: 'Bearer local-fixture' });
    assert.equal(select.children[0].textContent, '<img src=x onerror=fixture>');
    assert.equal(select.children[0].innerHTML, undefined);
    assert.equal(panel.querySelector('[data-members-picker]').hidden, false);
    assert.equal(select.focused, true);
});

test('membership-only launcher supplies canonical catalogs and cannot open global account editing', async () => {
    const f = fixture();
    const panel = element();
    f.manager.mount(panel, f.user);
    f.state.responses.push(response({ success: true, members: [{ id: 42, username: 'fixture' }] }));
    await panel.querySelector('[data-members-load]').listeners.click();
    const accessProfile = { canEditAccount: true, permissionCatalog: {
        roles: ['creator', 'animator'], pages: [{ key: '/tasks', defaultRoles: ['animator'] }],
        actions: [{ key: 'tasks.create', delegable: true }]
    } };
    f.state.responses.push(response({ success: true, accessProfile }));
    await panel.querySelector('[data-members-edit]').listeners.click();
    assert.equal(f.state.requests[1].url, '/api/organizations/members/42/access-profile');
    const options = f.state.opened[0];
    assert.equal(options.canEditAccount, false);
    assert.deepEqual(plain(options.roles), [{ value: 'animator', label: 'animator' }]);
    assert.deepEqual(plain(options.pages), accessProfile.permissionCatalog.pages);
    assert.equal(options.onSave, undefined, 'Writes belong to the existing membership editor workflow');
    assert.equal(options.accessProfile, accessProfile);
});

test('access revocation keeps the directory hidden and permits retry without stale members', async () => {
    const f = fixture();
    const panel = element();
    f.manager.mount(panel, f.user);
    f.state.responses.push(response({ success: false }, 403));
    await panel.querySelector('[data-members-load]').listeners.click();
    assert.equal(panel.querySelector('[data-members-picker]').hidden, true);
    assert.match(panel.querySelector('[data-members-status]').textContent, /недоступне/);
    assert.equal(panel.querySelector('[data-members-load]').disabled, false);
    assert.equal(f.state.opened.length, 0);
});

test('directory reload cannot supersede a pending editor and both controls recover after closing it', async () => {
    const f = fixture();
    const panel = element();
    f.manager.mount(panel, f.user);
    const loadButton = panel.querySelector('[data-members-load]');
    const editButton = panel.querySelector('[data-members-edit]');
    f.state.responses.push(response({ success: true, members: [{ id: 42, username: 'fixture' }] }));
    await loadButton.listeners.click();
    let completeProfile;
    let closeEditor;
    let editorOpened;
    const opened = new Promise(resolve => { editorOpened = resolve; });
    f.context.AccountAccessEditor.open = async () => {
        editorOpened();
        return new Promise(resolve => { closeEditor = resolve; });
    };
    f.state.responses.push(() => new Promise(resolve => { completeProfile = resolve; }));
    const editing = editButton.listeners.click();
    assert.equal(loadButton.disabled, true);
    assert.equal(editButton.disabled, true);
    await loadButton.listeners.click();
    assert.equal(f.state.requests.length, 2, 'Reload must not replace a pending access-profile request');
    completeProfile(response({ success: true, accessProfile: { permissionCatalog: {} } }));
    await opened;
    assert.equal(loadButton.disabled, true);
    await loadButton.listeners.click();
    assert.equal(f.state.requests.length, 2, 'Reload must remain disabled while the editor is open');
    closeEditor({ saved: false });
    await editing;
    assert.equal(loadButton.disabled, false);
    assert.equal(editButton.disabled, false);
    f.state.responses.push(response({ success: true, members: [{ id: 43, username: 'updated_fixture' }] }));
    await loadButton.listeners.click();
    assert.equal(f.state.requests.length, 3);
    assert.equal(panel.querySelector('[data-members-select]').children[0].textContent, 'updated_fixture');
    assert.equal(editButton.disabled, false);
});

test('directory responses from a previous account never populate the current page', async () => {
    const f = fixture();
    const panel = element();
    f.manager.mount(panel, f.user);
    let complete;
    f.state.responses.push(() => new Promise(resolve => { complete = resolve; }));
    const loading = panel.querySelector('[data-members-load]').listeners.click();
    f.context.AppState.currentUser = { id: 2 };
    complete(response({ success: true, members: [{ id: 42, name: 'Previous account team' }] }));
    await loading;
    assert.deepEqual(panel.querySelector('[data-members-select]').children, []);
    assert.equal(panel.querySelector('[data-members-picker]').hidden, true);
});

test('profile registers shared editor assets and recovery path before any operational profile load', () => {
    const html = fs.readFileSync(path.join(__dirname, '../profile.html'), 'utf8');
    const code = fs.readFileSync(path.join(__dirname, '../js/profile-page.js'), 'utf8');
    assert.match(html, /css\/account-access-editor\.css/);
    assert.ok(html.indexOf('js/account-access-editor.js') < html.indexOf('js/business-membership-manager.js'));
    assert.ok(html.indexOf('js/business-membership-manager.js') < html.indexOf('js/profile-page.js'));
    const init = code.slice(code.indexOf('async function initProfilePage()'), code.indexOf('async function loadProfileData'));
    assert.ok(init.indexOf("accessContext.status !== 'ready'") < init.indexOf('await loadProfileData(viewUserId)'));
    assert.match(init, /BusinessMembershipManager\?\.mount/);
    assert.match(init, /if \(!user\.accessContext \|\| user\.accessContext\.status === 'ready'\) \{\s+if \(typeof hydrateActionPermissions/);
    assert.match(init, /showAuthenticatedPageShell\(\{ markRuntimeReady: false \}\)/);
    assert.match(init, /href="\/"[^>]*>Вибрати бізнес/);
});

test('known account assignment validates exact ID and opens the existing membership editor without directory search', async () => {
    const f = fixture();
    const panel = element();
    f.manager.mount(panel, f.user);
    const input = panel.querySelector('[data-members-account-id]');
    const button = panel.querySelector('[data-members-add]');
    input.value = '0';
    await button.listeners.click();
    assert.equal(f.state.requests.length, 0);
    input.value = '52';
    f.state.responses.push(response({ success: true, accessProfile: { permissionCatalog: {} } }));
    await button.listeners.click();
    assert.equal(f.state.requests[0].url, '/api/organizations/members/52/access-profile');
    assert.equal(f.state.opened[0].user.id, 52);
    assert.equal(f.state.opened[0].canEditAccount, false);
    assert.equal(button.disabled, false);
    assert.equal(button.focused, true);
});
