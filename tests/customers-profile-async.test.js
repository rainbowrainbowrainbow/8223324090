const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const repoRoot = path.resolve(__dirname, '..');
const customersSource = fs.readFileSync(path.join(repoRoot, 'js', 'customers-page.js'), 'utf8');
const profileSource = fs.readFileSync(path.join(repoRoot, 'js', 'profile-page.js'), 'utf8');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function customerHarness() {
    const start = customersSource.indexOf('async function fetchCustomers()');
    const end = customersSource.indexOf('async function fetchStats()', start);
    assert.ok(start >= 0 && end > start, 'customer reload lifecycle exists');

    const dom = new JSDOM('<table><tbody id="crmTableBody"></tbody></table><div id="pagination"></div>', {
        runScripts: 'outside-only',
        url: 'https://crm.test/customers'
    });
    const context = dom.getInternalVMContext();
    const requests = [];
    const renders = [];
    context.fetch = (url, options) => {
        const pending = deferred();
        requests.push({ url: String(url), options, pending });
        return pending.promise;
    };
    context.customerApiUrl = value => value;
    context.renderCustomerTable = () => renders.push({ type: 'table', customers: context.CrmState.customers.slice() });
    context.renderPagination = () => renders.push({ type: 'pagination', page: context.CrmState.page });
    context.CrmState = {
        page: 1,
        filters: { search: '', source: '', sortBy: 'updated_at', dateFrom: '', dateTo: '', tag: '', minVisits: null, maxVisits: null },
        customers: [], total: 0, pages: 1
    };
    context.hasVisitBound = value => value !== null && value !== undefined && value !== '';
    vm.runInContext(`
        let customersRequestController = null;
        let customersRequestSeq = 0;
        ${customersSource.slice(start, end)}
        this.__hooks = { fetchCustomers, reloadCustomers };
    `, context, { filename: 'js/customers-page.js' });

    return { dom, context, requests, renders, hooks: context.__hooks };
}

function response(data) {
    return { status: 200, json: async () => data };
}

for (const latestFirst of [true, false]) {
    test(`Customers applies and renders only request B when ${latestFirst ? 'B' : 'A'} resolves first`, async () => {
        const harness = customerHarness();
        const { context, requests, renders, hooks } = harness;
        context.CrmState.filters.search = 'A';
        const requestA = hooks.reloadCustomers();
        context.CrmState.filters.search = 'B';
        const requestB = hooks.reloadCustomers();
        assert.equal(requests.length, 2);
        assert.equal(requests[0].options.signal.aborted, true, 'request B aborts request A');

        if (latestFirst) {
            requests[1].pending.resolve(response({ customers: [{ id: 'B' }], total: 1, pages: 1, page: 1 }));
            assert.equal(await requestB, true);
            requests[0].pending.resolve(response({ customers: [{ id: 'A' }], total: 1, pages: 1, page: 1 }));
            assert.equal(await requestA, false);
        } else {
            requests[0].pending.resolve(response({ customers: [{ id: 'A' }], total: 1, pages: 1, page: 1 }));
            assert.equal(await requestA, false);
            assert.equal(renders.length, 0, 'stale request does not clear the active loading UI by rendering');
            requests[1].pending.resolve(response({ customers: [{ id: 'B' }], total: 1, pages: 1, page: 1 }));
            assert.equal(await requestB, true);
        }

        assert.deepEqual(Array.from(context.CrmState.customers, item => ({ ...item })), [{ id: 'B' }]);
        assert.deepEqual(renders.map(item => item.type), ['table', 'pagination']);
        harness.dom.window.close();
    });
}

function profileHarness() {
    const resourceStart = profileSource.indexOf('function getProfileResourceState');
    const resourceEnd = profileSource.indexOf('function profileCockpitWidgetDef', resourceStart);
    const switchStart = profileSource.indexOf('async function switchTab');
    const switchEnd = profileSource.indexOf('async function setProfileProfessionContext', switchStart);
    assert.ok(resourceStart >= 0 && resourceEnd > resourceStart, 'profile resource lifecycle exists');
    assert.ok(switchStart >= 0 && switchEnd > switchStart, 'profile tab lifecycle exists');

    const dom = new JSDOM('<div id="tabContent"></div>', { runScripts: 'outside-only', url: 'https://crm.test/profile' });
    const context = dom.getInternalVMContext();
    const apiCalls = [];
    const handlers = new Map();
    const renders = [];
    context.apiGet = endpoint => {
        apiCalls.push(endpoint);
        const handler = handlers.get(endpoint);
        return handler ? handler() : Promise.resolve(null);
    };
    Object.assign(context, {
        normalizeProfileTab: tab => tab,
        syncProfileTabToUrl() {},
        profileTabLock: () => false,
        isProfileTaskProjectionTab: () => false,
        loadMyCabinetProjection: async () => {},
        applyCabinetTaskSoundPreferences() {},
        refreshCabinetPulseCounts: async () => {},
        loadShopItems: async () => {},
        loadLeaderboard: async () => {},
        loadSeasonalQuests: async () => {},
        loadTeamsData: async () => {},
        loadReferralData: async () => {},
        loadProfileWorkMaterials: async () => {},
        profileActiveProfessionEntry: () => ({ key: 'main' }),
        profileSecondaryTabOrder: () => [],
        attachProfileListeners() {},
        renderTabContent: () => {
            renders.push(context.__getActiveTab());
            return context.__getActiveTab();
        }
    });
    vm.runInContext(`
        let activeTab = 'professions';
        let profileTabRequestSeq = 0;
        const profileResourceStates = new Map();
        let isOwnProfile = true;
        let myAchievements = [];
        let myInventory = [];
        let walletData = null;
        let questsData = null;
        let titlesData = null;
        let allStreaks = null;
        let myCabinetData = null;
        let profileSecurityData = null;
        let shopItems = [];
        let leaderboardData = null;
        let seasonalQuests = null;
        let teamsData = null;
        let referralData = null;
        ${profileSource.slice(resourceStart, resourceEnd)}
        ${profileSource.slice(switchStart, switchEnd)}
        this.__hooks = { ensureProfileTabData, switchTab, getProfileResourceState };
        this.__getActiveTab = () => activeTab;
        this.__getInventory = () => myInventory;
        this.__getAchievements = () => myAchievements;
    `, context, { filename: 'js/profile-page.js' });

    return { dom, context, apiCalls, handlers, renders, hooks: context.__hooks };
}

test('Profile caches legitimate empty inventory and achievements responses', async () => {
    const harness = profileHarness();
    harness.handlers.set('/wallet', () => Promise.resolve({ balance: 0 }));
    harness.handlers.set('/inventory', () => Promise.resolve([]));
    harness.handlers.set('/achievements', () => Promise.resolve([]));

    await harness.hooks.ensureProfileTabData('inventory');
    await harness.hooks.ensureProfileTabData('inventory');
    await harness.hooks.ensureProfileTabData('achievements');
    await harness.hooks.ensureProfileTabData('achievements');

    assert.equal(harness.apiCalls.filter(value => value === '/wallet').length, 1);
    assert.equal(harness.apiCalls.filter(value => value === '/inventory').length, 1);
    assert.equal(harness.apiCalls.filter(value => value === '/achievements').length, 1);
    assert.equal(harness.hooks.getProfileResourceState('inventory').status, 'loaded');
    assert.equal(harness.hooks.getProfileResourceState('achievements').status, 'loaded');
    harness.dom.window.close();
});

test('Profile late tab response never repaints the current tab', async () => {
    const harness = profileHarness();
    const achievements = deferred();
    const wallet = deferred();
    const inventory = deferred();
    harness.handlers.set('/achievements', () => achievements.promise);
    harness.handlers.set('/wallet', () => wallet.promise);
    harness.handlers.set('/inventory', () => inventory.promise);

    const oldTab = harness.hooks.switchTab('achievements');
    const currentTab = harness.hooks.switchTab('inventory');
    wallet.resolve({ balance: 0 });
    inventory.resolve([]);
    assert.equal(await currentTab, true);
    achievements.resolve([]);
    assert.equal(await oldTab, false);

    assert.equal(harness.context.__getActiveTab(), 'inventory');
    assert.deepEqual(harness.renders, ['inventory']);
    assert.equal(harness.dom.window.document.getElementById('tabContent').innerHTML, 'inventory');
    harness.dom.window.close();
});
