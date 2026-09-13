'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function fixture(response) {
    const requests = [];
    const context = {
        getAuthHeaders: () => ({ Authorization: 'synthetic-session', 'X-Business-Context': 'dar', 'x-business-scope': 'all' }),
        async apiFetchWithAuthRetry(url, options) { requests.push({ url, options }); return response; }
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/business-cabinet-manager.js'), 'utf8'), context);
    return { manager: context.BusinessCabinetManager, requests };
}

test('cabinet management visibility uses organization role and rejects global creator guesses', () => {
    const { manager } = fixture();
    assert.equal(manager.canManage({ role: 'creator', platformRole: 'creator' }), false);
    for (const role of ['owner', 'admin']) assert.equal(manager.canManage({ businessProfile: { organizations: [{ role }] } }), true);
    assert.equal(manager.canManage({ businessProfile: { organizations: [{ role: 'member' }] } }), false);
});

test('server module capability controls selection, limited support stays explicit and existing blocked config remains visible', () => {
    const { manager } = fixture();
    const html = manager.moduleOptions([
        { key: 'scoped', label: '<img src=x>', canEnable: true, status: 'limited', reason: 'Scoped reads only' },
        { key: 'legacy', label: 'Legacy', canEnable: false, status: 'not_migrated', reason: 'Pending owner mapping' }
    ], ['legacy']);
    assert.match(html, /data-cabinet-module="scoped"/);
    assert.match(html, /&lt;img src=x&gt;/);
    assert.match(html, /Scoped reads only/);
    assert.match(html, /data-cabinet-module="legacy" checked disabled/);
    assert.doesNotMatch(html, /<img/);
    assert.equal(manager.moduleOptions(null, []), '');
});

test('management requests remove aggregate/context headers and preserve exact mutation body', async () => {
    const f = fixture({ ok: true, status: 200, json: async () => ({ success: true }) });
    await f.manager.request('/api/organizations/7/businesses', 'POST', { contextKey: 'custom_business', modules: [] });
    const request = f.requests[0];
    assert.equal(request.options.authBusinessScope, false);
    assert.deepEqual(JSON.parse(JSON.stringify(request.options.headers)), { Authorization: 'synthetic-session', 'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(request.options.body), { contextKey: 'custom_business', modules: [] });
});

test('denial gives safe localized retry message without raw backend details', async () => {
    const f = fixture({ ok: false, status: 403, json: async () => ({ success: false, code: 'organization_management_denied', error: 'private diagnostic' }) });
    await assert.rejects(() => f.manager.request('/api/organizations/management'), error => {
        assert.equal(error.status, 403);
        assert.equal(error.code, 'organization_management_denied');
        assert.match(error.message, /недоступне/);
        assert.doesNotMatch(error.message, /private/);
        return true;
    });
});

test('cabinet assets and owner recovery integration preserve the existing access editor', () => {
    const html = fs.readFileSync(path.join(__dirname, '../profile.html'), 'utf8');
    const code = fs.readFileSync(path.join(__dirname, '../js/profile-page.js'), 'utf8');
    assert.ok(html.indexOf('js/business-cabinet-manager.js') < html.indexOf('js/profile-page.js'));
    assert.equal((code.match(/BusinessCabinetManager\?\.mount/g) || []).length, 2);
    assert.equal((code.match(/BusinessMembershipManager\?\.mount/g) || []).length, 2);
});
