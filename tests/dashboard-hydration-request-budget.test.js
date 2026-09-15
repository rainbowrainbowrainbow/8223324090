'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const DASHBOARD_SOURCE = fs.readFileSync(path.join(ROOT, 'js', 'dashboard-page.js'), 'utf8');

function instrumentDashboardSource() {
    const injection = /    return \{\r?\n        init,/;
    assert.match(DASHBOARD_SOURCE, injection, 'dashboard test injection point must exist');
    return DASHBOARD_SOURCE.replace(injection, `
    window.__dashboardHydrationTest = {
        setConfig(config) { _config = normalizeDashboardConfig(config); _dashboardConfigState = 'ready'; },
        renderWidgets,
        renderBoard,
        refreshWidget,
        loadWidgetData,
        completeFocusTask,
        focusDashboardTask,
        snoozeDashboardTask,
        renderDayOrientation,
        loadDayOrientationSources,
        refreshDayOrientation,
        buildDayOrientation,
        checkDashboardDayBoundary,
        getConfigWidgets() { return [...(_config?.widgets || [])]; },
        getWidgetData(type) { return _widgetData[type]; },
        getWidgetMeta(type) { return _widgetDataMeta[type]; },
        expireWidgetData(type) {
            if (_widgetDataMeta[type]) _widgetDataMeta[type].fetchedAt = Date.now() - WIDGET_DATA_TTL_MS - 1000;
        },
        getPendingRequestCount() {
            return typeof _widgetDataRequests === 'undefined' ? -1 : _widgetDataRequests.size;
        }
    };

    return {
        init,`);
}

function response(data = {}, options = {}) {
    const ok = options.ok !== false;
    return {
        ok,
        status: options.status || (ok ? 200 : 500),
        json: async () => options.payload || { success: true, data }
    };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function boardConfig(widgets, items = []) {
    return {
        widgets,
        mode: 'board',
        layout: {},
        boardState: {
            items,
            drawings: [],
            connectors: [],
            preferences: { maxLiveWidgets: 8 }
        }
    };
}

function widgetItem(id, widgetType, x = 20) {
    return {
        id,
        type: 'widget',
        widgetType,
        title: widgetType,
        depth: 'live-compact',
        x,
        y: 20,
        w: 320,
        h: 220,
        z: 1
    };
}

function loadDashboardHarness(options = {}) {
    const dom = new JSDOM(`<!doctype html><html><body>
        <div id="dashboardGrid"></div>
        <section id="dashboardBoardShell"><div id="dashboardBoardCanvas"></div></section>
        <div id="dashboardBoardToolbar"></div>
        <div id="boardEditControls"></div>
        <div id="boardToolOptions"></div>
        <button id="dashboardBoardModeBtn"></button>
        <span id="boardUnifiedModeLabel"></span>
        <button id="boardUndoBtn"></button>
        <button id="boardRedoBtn"></button>
        <span id="boardSaveStatus"></span>
    </body></html>`, {
        url: 'http://localhost/dashboard',
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });

    const requests = [];
    if (options.now) {
        const NativeDate = dom.window.Date;
        dom.window.Date = class extends NativeDate {
            constructor(...args) { super(...(args.length ? args : [options.now])); }
            static now() { return new NativeDate(options.now).getTime(); }
        };
    }
    let role = options.role || 'manager';
    let business = options.business || 'event_genix';
    let sessionGeneration = options.sessionGeneration || 'session-1';
    let fetchImplementation = async url => response({
        marker: `${business}:${url}`,
        tasks: [],
        shifts: [],
        temperature: 11,
        city: 'Kyiv'
    });

    dom.window.AppState = {
        currentUser: { id: 41, username: 'manager.one', role: 'manager' }
    };
    dom.window.getUserRole = () => role;
    dom.window.hasMinRole = minimumRole => role === 'manager' && minimumRole === 'manager';
    dom.window.canAccessPage = () => true;
    dom.window.resolveCapability = () => ({ allowed: false });
    dom.window.CrmBusinessContext = {
        current: () => business,
        scope: () => ({ mode: 'single', activeContext: business, selectedContexts: [business] }),
        apiUrl: url => `${url}${url.includes('?') ? '&' : '?'}businessContext=${business}`
    };
    dom.window.localStorage.setItem('pzp_token', 'test-token');
    dom.window.localStorage.setItem('pzp_auth_session_generation', sessionGeneration);
    dom.window.setTimeout = () => 0;
    dom.window.clearTimeout = () => {};
    const notifications = [];
    dom.window.showNotification = (message, type) => {
        notifications.push({ message, type });
    };
    dom.window.scrollTo = (x, y) => {
        dom.window.__lastScrollTo = { x, y };
    };
    dom.window.fetch = (url, init) => {
        const value = String(url);
        requests.push(value);
        return Promise.resolve(fetchImplementation(value, init || {}));
    };

    const nativeAddEventListener = dom.window.document.addEventListener.bind(dom.window.document);
    dom.window.document.addEventListener = (type, listener, listenerOptions) => {
        if (type === 'DOMContentLoaded') return;
        nativeAddEventListener(type, listener, listenerOptions);
    };

    vm.runInContext(instrumentDashboardSource(), dom.getInternalVMContext(), {
        filename: 'js/dashboard-page.js'
    });

    return {
        dom,
        api: dom.window.__dashboardHydrationTest,
        requests,
        notifications,
        setRole(value) { role = value; },
        setBusiness(value) { business = value; },
        setSessionGeneration(value) {
            sessionGeneration = value;
            dom.window.localStorage.setItem('pzp_auth_session_generation', value);
        },
        setUser(user) { dom.window.AppState.currentUser = user; },
        setFetchImplementation(implementation) { fetchImplementation = implementation; }
    };
}

function addDayOrientationContainer(harness) {
    const section = harness.dom.window.document.createElement('section');
    section.id = 'dashboardDayOrientation';
    section.className = 'dashboard-day-orientation';
    section.setAttribute('role', 'status');
    harness.dom.window.document.body.insertBefore(section, harness.dom.window.document.getElementById('dashboardGrid'));
    return section;
}

function widgetRequestCounts(requests) {
    return requests
        .filter(url => url.includes('/api/dashboard/widgets/'))
        .reduce((counts, value) => {
            const url = new URL(value, 'http://localhost');
            const key = `${url.pathname}${url.search}`;
            counts[key] = (counts[key] || 0) + 1;
            return counts;
        }, {});
}

async function flushHydration() {
    await new Promise(resolve => setImmediate(resolve));
    await Promise.resolve();
}

function orientationFixture(type, overrides = {}) {
    return overrides[type] || {
        nearest_event: { event: null, preparation: null },
        my_focus: { tasks: [], overdueCount: 0, waitingCount: 0 },
        funnel: { meta: { funnelInsights: { waitingAction: 0, total: 0, stages: [] } } }
    }[type] || {};
}

test('orientation preserves the selected focus rank when another selected task has an earlier nonurgent date', async () => {
    const harness = loadDashboardHarness({ now: '2026-09-13T10:30:00Z' });
    const orientation = addDayOrientationContainer(harness);
    const tasks = [
        { id: 901, title: 'First selected priority', status: 'todo', focus_rank: 1, isSelectedFocus: true, dueState: 'upcoming', effectiveDueAt: '2026-09-16T09:00:00Z' },
        { id: 902, title: 'Second selected priority', status: 'todo', focus_rank: 2, isSelectedFocus: true, dueState: 'upcoming', effectiveDueAt: '2026-09-14T09:00:00Z' }
    ];
    harness.setFetchImplementation(async url => {
        if (url.includes('/widgets/my_focus')) return response({ tasks, selectedTasks: tasks, selectedCount: 2, recommendedCount: 0, actionableCount: 2, overdueCount: 0, waitingCount: 0 });
        if (url.includes('/widgets/nearest_event')) return response({ event: null, preparation: null });
        if (url.includes('/widgets/funnel')) return response({ meta: { funnelInsights: { waitingAction: 0 } } });
        return response({});
    });
    harness.api.setConfig(boardConfig(['my_focus']));
    harness.api.renderWidgets();
    await flushHydration();
    await flushHydration();
    assert.equal(orientation.querySelector('a.dashboard-day-orientation-action')?.getAttribute('href'), '/tasks?open=901');
    assert.equal(harness.dom.window.document.querySelector('[data-focus-task]')?.getAttribute('data-focus-task'), '901');
    harness.dom.window.close();
});

test('a known nearest event remains available when only preparation fails without inventing empty tasks', async () => {
    const harness = loadDashboardHarness();
    harness.dom.window.document.getElementById('dashboardGrid').innerHTML = '<section data-widget="nearest_event"><div id="widget-nearest_event"></div></section>';
    harness.setFetchImplementation(async () => response({
        event: { id: 903, date: '2026-09-15', dateScope: 'tomorrow', time: '12:00', program: 'Known event', canonicalHref: '/booking-summary?id=903' },
        confirmation: { status: 'confirmed' }, preparation: null,
        meta: { partial: true, sourceStates: { bookings: 'ready', preparation: 'error' }, warnings: [{ source: 'preparation', code: 'source_unavailable' }] }
    }));
    await harness.api.loadWidgetData('nearest_event');
    const widget = harness.dom.window.document.getElementById('widget-nearest_event');
    assert.match(widget.textContent, /Known event/);
    assert.equal(widget.querySelector('.nearest-event-open')?.getAttribute('href'), '/booking-summary?id=903');
    assert.match(widget.textContent, /Стан підготовки невідомий/);
    assert.doesNotMatch(widget.textContent, /Підготовчі задачі не знайдені|0 відкрито|все готово/);
    assert.ok(widget.querySelector('.widget-retry-btn'));
    harness.dom.window.close();
});

test('due client commitment outranks selected focus but current urgent work outranks both', async t => {
    const h = loadDashboardHarness();
    t.after(() => h.dom.window.close());
    addDayOrientationContainer(h);
    let urgent = false;
    h.setFetchImplementation(url => response(orientationFixture(new URL(url, 'http://localhost').pathname.split('/').pop(), {
        my_focus: { tasks: [
            { id: 1, title: 'Selected old task', focus_rank: 1, status:'todo', dueState:'review' },
            { id: 2, title: 'Current urgent task', focus_rank: 0, status:'todo', priority:'high', dueState: urgent ? 'today' : 'review' }
        ], selectedCount:1, recommendedCount:1, actionableCount:2, overdueCount:99, waitingCount:0 },
        funnel: { meta: { sourceStates:{funnel:'ready',followUps:'ready'}, funnelInsights:{waitingAction:500,total:500},
            followUps:[{title:'Call customer as agreed',dueAt:'2020-01-01T12:00:00Z',href:'/sales-funnel?lead=72'}] } }
    })));
    await h.api.loadDayOrientationSources();
    assert.equal(h.api.buildDayOrientation().href, '/sales-funnel?lead=72');
    assert.equal(h.api.buildDayOrientation().source, 'Домовленість із клієнтом');
    urgent = true;
    await h.api.refreshDayOrientation();
    assert.equal(h.api.buildDayOrientation().href, '/tasks?open=2');
    assert.equal(h.api.buildDayOrientation().source, 'Рекомендовано');
    assert.match(h.api.buildDayOrientation().reason, /робочий строк/);
});

test('one task lock blocks different simultaneous actions until the server answers', async t => {
    const h = loadDashboardHarness();
    t.after(() => h.dom.window.close());
    const gate = deferred();
    const mutations = [];
    h.dom.window.document.getElementById('dashboardGrid').innerHTML = '<section data-widget="my_focus"><div id="widget-my_focus"></div></section>';
    h.setFetchImplementation((url, init) => {
        if (init.method === 'PATCH' || init.method === 'POST') { mutations.push(url); return gate.promise; }
        if (url.includes('/my_focus')) return response({tasks:[{id:7,title:'One task',status:'todo',focus_rank:0}],selectedCount:0,recommendedCount:1,actionableCount:1,overdueCount:0,waitingCount:0});
        return response({});
    });
    await h.api.loadWidgetData('my_focus');
    const button = h.dom.window.document.querySelector('[data-dashboard-task-action="complete"]');
    const completing = h.api.completeFocusTask(7, button);
    const snoozing = await h.api.snoozeDashboardTask(7);
    const selecting = await h.api.focusDashboardTask(7);
    assert.equal(mutations.length, 1);
    assert.equal(snoozing, undefined);
    assert.equal(selecting, undefined);
    assert.ok([...h.dom.window.document.querySelectorAll('[data-dashboard-task-id="7"]')].every(control => control.disabled));
    assert.equal(h.notifications.length, 0, 'pending request must not announce success');
    gate.resolve(response({}, {ok:false,status:503,payload:{success:false,error:'Temporary failure'}}));
    const result = await completing;
    assert.equal(result.success, false);
    assert.ok(h.dom.window.document.querySelector('[data-dashboard-task-action="complete"]'));
    assert.ok([...h.dom.window.document.querySelectorAll('[data-dashboard-task-id="7"]')].every(control => !control.disabled));
});

test('repeated identity event reuses data but real business change refreshes once', async t => {
    const h = loadDashboardHarness();
    t.after(() => h.dom.window.close());
    h.api.setConfig(boardConfig(['my_focus']));
    h.setFetchImplementation(url => response(orientationFixture(new URL(url,'http://localhost').pathname.split('/').pop())));
    h.api.renderWidgets();
    h.dom.window.dispatchEvent(new h.dom.window.Event('app:user-changed'));
    await flushHydration();
    const before = h.requests.length;
    for(let i=0;i<5;i++) {
        h.setUser({id:41,username:'manager.one',role:'manager',last_seen_at:String(i)});
        h.dom.window.dispatchEvent(new h.dom.window.Event('app:user-changed'));
    }
    await flushHydration();
    assert.equal(h.requests.length,before);
    h.setBusiness('park');
    h.dom.window.dispatchEvent(new h.dom.window.Event('timeline:business-context-changed'));
    await flushHydration();
    const parkReads=h.requests.filter(url=>url.includes('widgets/my_focus')&&url.includes('businessContext=park'));
    assert.equal(parkReads.length,1);
});

test('orientation shows retry when every source fails and never loops in loading', async () => {
    const h = loadDashboardHarness();
    const el = addDayOrientationContainer(h);
    h.setFetchImplementation(() => response({}, { ok: false, status: 503 }));
    await h.api.loadDayOrientationSources();
    assert.equal(el.dataset.tone, 'neutral');
    assert.match(el.textContent, /недоступна/);
    assert.equal(el.querySelector('button').disabled, false);
    h.dom.window.close();
});

test('unknown preparation does not outrank an actionable focus task or funnel', async () => {
    const h = loadDashboardHarness();
    addDayOrientationContainer(h);
    h.setFetchImplementation(url => {
        const type = new URL(url, 'http://localhost').pathname.split('/').pop();
        return response(orientationFixture(type, {
            nearest_event: { event: { id: 4, time: '18:00', status: 'confirmed' }, preparation: { totalCount: 0 } },
            my_focus: { tasks: [{ id: 8, title: 'Call QA', status: 'todo', focus_rank: 1, isSelectedFocus: true }], overdueCount: 0, waitingCount: 0 }
        }));
    });
    await h.api.loadDayOrientationSources();
    assert.equal(h.api.buildDayOrientation().priority, 3);
    assert.equal(h.api.buildDayOrientation().href, '/tasks?open=8');
    h.dom.window.close();
});

test('failed refresh or revoked access cannot recommend previously cached tasks', async () => {
    for (const status of [503, 403]) {
        const h = loadDashboardHarness();
        addDayOrientationContainer(h);
        h.setFetchImplementation(url => response(orientationFixture(new URL(url, 'http://localhost').pathname.split('/').pop(), {
            my_focus: { tasks: [{ id: 8, title: 'Old QA task', status: 'todo' }], overdueCount: 1, waitingCount: 0 }
        })));
        await h.api.loadDayOrientationSources();
        assert.match(h.api.buildDayOrientation().title, /Old QA task/);
        h.setFetchImplementation(() => response({}, { ok: false, status }));
        await h.api.refreshDayOrientation();
        assert.equal(h.api.buildDayOrientation().tone, 'neutral');
        assert.doesNotMatch(h.api.buildDayOrientation().title, /Old QA|прострочена/);
        if (status === 403) assert.equal(h.api.getWidgetData('my_focus'), undefined);
        h.dom.window.close();
    }
});

test('incomplete success payload is not interpreted as a calm day', async () => {
    const h = loadDashboardHarness();
    addDayOrientationContainer(h);
    h.setFetchImplementation(() => response({}));
    await h.api.loadDayOrientationSources();
    assert.equal(h.api.buildDayOrientation().tone, 'neutral');
    assert.match(h.api.buildDayOrientation().note, /найближча подія.*мій фокус.*воронка/);
    h.dom.window.close();
});

for (const periodCase of [
    { name: 'today in Kyiv before UTC midnight', now: '2026-09-13T21:30:00Z', expected: /Сьогодні/, absent: /14 вересня/ },
    { name: 'older date after Kyiv midnight', now: '2026-09-14T21:30:00Z', expected: /14 вересня/, absent: /Сьогодні/ }
]) {
    test(`quick stats renders truthful labels, period, business context, and stale lead count: ${periodCase.name}`, async () => {
        const h = loadDashboardHarness({ now: periodCase.now });
        h.dom.window.resolveCapability = () => ({ allowed: true });
        h.dom.window.document.getElementById('dashboardGrid').innerHTML = '<div id="widget-quick_stats"></div>';
        h.setFetchImplementation(url => {
            if (url.includes('/widgets/quick_stats')) return response({
                bookingsToday: 4,
                activeTasks: 7,
                revenueToday: 12800,
                coldLeads: 6,
                meta: {
                    period: { key: 'today', date: '2026-09-14', timezone: 'Europe/Kyiv' },
                    businessScope: { mode: 'single', activeContext: 'event_genix', selectedContexts: ['event_genix'] }
                }
            });
            return response({});
        });

        await h.api.loadWidgetData('quick_stats');
        const text = h.dom.window.document.getElementById('widget-quick_stats').textContent;
        assert.match(text, /Задачі в роботі/);
        assert.match(text, /Вартість підтверджених бронювань/);
        assert.match(text, /12\s800 ₴/);
        assert.match(text, periodCase.expected);
        assert.doesNotMatch(text, periodCase.absent);
        assert.match(text, /Event Genix/);
        assert.match(text, /Без контакту понад 48 год: 6/);
        assert.doesNotMatch(text, /2026-09-14|event genix|підтв\./);
        assert.doesNotMatch(text, /Виручка/);
        assert.doesNotMatch(text, /прибут/i);
        h.dom.window.close();
    });
}

test('partial funnel data blocks calm orientation and renders an honest widget state', async () => {
    const h = loadDashboardHarness();
    const orientation = addDayOrientationContainer(h);
    h.dom.window.document.getElementById('dashboardGrid').innerHTML = '<div id="widget-funnel"></div>';
    h.setFetchImplementation(url => {
        if (url.includes('/widgets/nearest_event')) return response({ event: null, preparation: null });
        if (url.includes('/widgets/my_focus')) return response({ tasks: [], overdueCount: 0, waitingCount: 0 });
        if (url.includes('/widgets/funnel')) return response({
            meta: {
                funnelInsights: { total: 0, waitingAction: 0, stages: [], href: '/sales-funnel' },
                partial: true,
                sourceErrors: [{ source: 'leads_funnel_summary', error: 'database unavailable' }]
            }
        });
        return response({});
    });

    await h.api.loadDayOrientationSources({ missingOnly: false });
    h.api.renderDayOrientation();
    assert.match(orientation.textContent, /Частина сигналів дня недоступна/);
    assert.match(orientation.textContent, /воронка/);
    assert.doesNotMatch(orientation.textContent, /Термінових справ.*немає/);

    await h.api.loadWidgetData('funnel');
    const funnelText = h.dom.window.document.getElementById('widget-funnel').textContent;
    assert.match(funnelText, /Частина воронки недоступна/);
    assert.match(funnelText, /не роблю висновок про спокійний день/);
    assert.doesNotMatch(funnelText, /Воронка спокійна/);
    h.dom.window.close();
});

test('business switch refreshes hidden orientation sources once in the new context', async () => {
    const h = loadDashboardHarness();
    addDayOrientationContainer(h);
    h.api.setConfig(boardConfig([]));
    h.setFetchImplementation(url => response(orientationFixture(new URL(url, 'http://localhost').pathname.split('/').pop())));
    await h.api.loadDayOrientationSources();
    h.setBusiness('second_business');
    h.dom.window.dispatchEvent(new h.dom.window.Event('timeline:business-context-changed'));
    await flushHydration();
    for (const type of ['nearest_event', 'my_focus', 'funnel']) {
        assert.equal(widgetRequestCounts(h.requests)[`/api/dashboard/widgets/${type}?businessContext=second_business`], 1);
    }
    assert.deepEqual(Array.from(h.api.getConfigWidgets()), []);
    h.dom.window.close();
});

test('clock advances the nearest event within the day and refreshes all sources at Kyiv midnight', async () => {
    const h = loadDashboardHarness();
    addDayOrientationContainer(h);
    let eventId = 4;
    h.setFetchImplementation(url => response(orientationFixture(new URL(url, 'http://localhost').pathname.split('/').pop(), {
        nearest_event: { event: { id: eventId, date: '2026-09-13', time: eventId === 4 ? '14:30' : '15:00' }, preparation: { totalCount: 0 } }
    })));
    await h.api.loadDayOrientationSources();
    eventId = 5;
    await h.api.checkDashboardDayBoundary(new Date('2026-09-13T11:31:00Z'));
    assert.equal(h.api.getWidgetData('nearest_event').event.id, 5);
    assert.equal(widgetRequestCounts(h.requests)['/api/dashboard/widgets/nearest_event?businessContext=event_genix'], 2);
    await h.api.checkDashboardDayBoundary(new Date('2026-09-13T21:00:00Z'));
    assert.equal(widgetRequestCounts(h.requests)['/api/dashboard/widgets/my_focus?businessContext=event_genix'], 2);
    h.dom.window.close();
});

test('confirmed completion refreshes quick stats and cannot be retried after a failed widget refresh', async () => {
    const h = loadDashboardHarness();
    h.dom.window.document.getElementById('dashboardGrid').innerHTML = '<div id="widget-my_focus"></div><div id="widget-quick_stats"></div>';
    let done = false;
    h.setFetchImplementation((url, init) => {
        if (init.method === 'PATCH') { done = true; return response({}, { payload: { success: true, task: { id: 8, status: 'done' } } }); }
        if (url.includes('quick_stats')) return response({ activeTasks: done ? 0 : 1 });
        if (done) return response({}, { ok: false, status: 503 });
        return response({ tasks: [{ id: 8, title: 'QA', status: 'in_progress' }], overdueCount: 0, waitingCount: 0 });
    });
    await h.api.loadWidgetData('my_focus');
    await h.api.loadWidgetData('quick_stats');
    await h.api.completeFocusTask(8);
    assert.equal(h.api.getWidgetData('quick_stats').activeTasks, 0);
    assert.equal(h.dom.window.document.querySelector('[data-dashboard-task-complete="8"]'), null);
    assert.equal(h.api.getWidgetMeta('my_focus').error, 'HTTP 503');
    h.dom.window.close();
});

test('a completion response from the previous user context cannot change the current focus', async () => {
    const h = loadDashboardHarness();
    h.api.setConfig(boardConfig(['my_focus']));
    h.dom.window.document.getElementById('dashboardGrid').innerHTML = '<section class="widget-card" data-widget="my_focus"><div id="widget-my_focus"></div></section>';
    const mutation = deferred();
    h.setFetchImplementation((url, init) => init.method === 'PATCH' ? mutation.promise : response({
        tasks: [{ id: 8, title: 'Current context task', status: 'todo' }], overdueCount: 0, waitingCount: 0
    }));
    await h.api.loadWidgetData('my_focus');
    const completion = h.api.completeFocusTask(8);
    h.setUser({ id: 99, role: 'manager', username: 'new.qa' });
    h.dom.window.dispatchEvent(new h.dom.window.Event('app:user-changed'));
    await flushHydration();
    mutation.resolve(response({}, { payload: { success: true, task: { id: 8, status: 'done' } } }));
    const result = await completion;
    assert.equal(result.stale, true);
    assert.equal(h.api.getWidgetData('my_focus').tasks[0].status, 'todo');
    assert.equal(h.notifications.length, 0);
    h.dom.window.close();
});

test('an overdue recommendation never points to an unrelated non-overdue focus task', async () => {
    const h = loadDashboardHarness();
    addDayOrientationContainer(h);
    h.setFetchImplementation(url => response(orientationFixture(new URL(url, 'http://localhost').pathname.split('/').pop(), {
        my_focus: { tasks: [{ id: 8, title: 'Next week', deadline: '2099-01-01T12:00:00Z', status: 'todo' }], overdueCount: 3, waitingCount: 0 }
    })));
    await h.api.loadDayOrientationSources();
    assert.equal(h.api.buildDayOrientation().title, 'Next week');
    assert.equal(h.api.buildDayOrientation().href, '/tasks?open=8');
    assert.doesNotMatch(h.api.buildDayOrientation().title + h.api.buildDayOrientation().reason, /прострочен/,
        'a separate overdue counter must not label the recommended current task overdue');
    h.dom.window.close();
});

test('cold widget-grid hydration requests every enabled visible widget endpoint once', async () => {
    const harness = loadDashboardHarness();
    harness.api.setConfig(boardConfig(['tasks', 'weather']));

    harness.api.renderWidgets();
    await flushHydration();

    assert.deepEqual(widgetRequestCounts(harness.requests), {
        '/api/dashboard/widgets/tasks?businessContext=event_genix': 1,
        '/api/dashboard/widgets/weather?businessContext=event_genix': 1
    });
    assert.notEqual(harness.dom.window.document.getElementById('dashboardGrid').getAttribute('aria-hidden'), 'true');
    harness.dom.window.close();
});

test('default dashboard composition is today-first and gives key widgets supported sizes', async () => {
    const harness = loadDashboardHarness({ role: 'admin' });
    harness.api.setConfig({ layout: {} });

    harness.api.renderWidgets();
    await flushHydration();

    const cards = [...harness.dom.window.document.querySelectorAll('#dashboardGrid > .widget-card[data-widget]')];
    assert.deepEqual(cards.slice(0, 6).map(card => card.dataset.widget), [
        'quick_stats',
        'my_focus',
        'nearest_event',
        'bookings_today',
        'staff_today',
        'event_risk_summary'
    ]);
    assert.equal(cards[0].dataset.widgetSize, 'full');
    assert.equal(cards[1].dataset.widgetSize, 'wide');
    assert.equal(cards[2].dataset.widgetSize, 'standard');
    assert.equal(harness.api.getConfigWidgets()[0], 'quick_stats');
    harness.dom.window.close();
});

test('my focus keeps the first screen to three tasks and sends overflow to details', async () => {
    const harness = loadDashboardHarness();
    const grid = harness.dom.window.document.getElementById('dashboardGrid');
    grid.innerHTML = '<div id="widget-my_focus"></div>';
    harness.setFetchImplementation(url => {
        if (url.includes('/widgets/my_focus')) return response({
            overdueCount: 0,
            waitingCount: 1,
            selectedCount: 0, recommendedCount: 4, actionableCount: 4,
            tasks: [
                { id: 1, title: 'Very long focus task name that should stay inside the card without breaking the dashboard layout', deadline: '2026-09-14T11:00:00Z', status: 'todo', subtasks: [{ title: 'First subtask', status: 'todo' }, { title: 'Second subtask', status: 'todo' }] },
                { id: 2, title: 'Second focus task', status: 'todo' },
                { id: 3, title: 'Third focus task', status: 'todo' },
                { id: 4, title: 'Hidden from first screen', status: 'todo' }
            ]
        });
        return response({});
    });

    await harness.api.loadWidgetData('my_focus');

    const container = harness.dom.window.document.getElementById('widget-my_focus');
    assert.equal(container.querySelectorAll('.widget-task-item').length, 3);
    assert.match(container.textContent, /Ще 1 у черзі/);
    assert.match(container.textContent, /0 обрано у фокус/);
    assert.match(container.textContent, /4 рекомендовано/);
    assert.equal(container.querySelectorAll('.dashboard-task-subtask:not(.is-more)').length, 0);
    assert.equal(container.querySelectorAll('.dashboard-task-subtask-summary a[href="/tasks?open=1"]').length, 1);
    assert.match(container.textContent, /Виконано 0 із 2 · Деталі/);
    harness.dom.window.close();
});

test('saved legacy board data renders one visible widget-grid container and repeated render reuses current-context data', async () => {
    const harness = loadDashboardHarness();
    harness.api.setConfig(boardConfig(
        ['weather'],
        [widgetItem('weather-a', 'weather'), widgetItem('weather-b', 'weather', 380)]
    ));

    harness.api.renderWidgets();
    await flushHydration();
    harness.api.renderWidgets();
    await flushHydration();

    const counts = widgetRequestCounts(harness.requests);
    assert.equal(counts['/api/dashboard/widgets/weather?businessContext=event_genix'], 1);
    assert.equal(counts['/api/dashboard/widgets/funnel?businessContext=event_genix'] || 0, 0);
    assert.equal(harness.dom.window.document.querySelectorAll('#dashboardGrid [data-widget="weather"]').length, 1);
    assert.equal(harness.dom.window.document.querySelectorAll('[data-widget-type="weather"] .board-widget-live').length, 0);
    harness.dom.window.close();
});

test('explicit refresh updates visible widget-grid container through one fresh request', async () => {
    const harness = loadDashboardHarness();
    let temperature = 11;
    harness.setFetchImplementation(async url => response({
        marker: `${temperature}:${url}`,
        temperature,
        city: 'Kyiv'
    }));
    harness.api.setConfig(boardConfig(
        ['weather'],
        [widgetItem('weather-a', 'weather'), widgetItem('weather-b', 'weather', 380)]
    ));

    harness.api.renderWidgets();
    await flushHydration();
    temperature = 22;
    await harness.api.refreshWidget('weather');

    const weatherRequests = harness.requests.filter(url => url.includes('/widgets/weather'));
    assert.equal(weatherRequests.length, 2, 'initial hydration plus one explicit refresh');
    const containers = [
        harness.dom.window.document.getElementById('widget-weather')
    ].filter(Boolean);
    assert.equal(containers.length, 1);
    containers.forEach(container => assert.match(container.textContent, /22°/));
    harness.dom.window.close();
});

test('failed widget reads leave no poisoned in-flight or fulfilled entry and can retry', async () => {
    const harness = loadDashboardHarness();
    let attempt = 0;
    harness.setFetchImplementation(async () => {
        attempt += 1;
        if (attempt === 1) return response({}, { ok: false, status: 503 });
        return response({ tasks: [], marker: 'retry-ok' });
    });
    harness.dom.window.document.getElementById('dashboardGrid').innerHTML = '<div id="widget-tasks"></div>';

    await harness.api.loadWidgetData('tasks');
    assert.match(harness.dom.window.document.getElementById('widget-tasks').textContent, /Не вдалося|Помилка/);
    assert.equal(harness.api.getPendingRequestCount(), 0);

    await harness.api.loadWidgetData('tasks');
    assert.equal(attempt, 2);
    assert.equal(harness.api.getWidgetData('tasks').marker, 'retry-ok');
    assert.equal(harness.api.getPendingRequestCount(), 0);
    harness.dom.window.close();
});

test('failed refresh keeps last successful widget data with retry instead of empty statistics', async () => {
    const harness = loadDashboardHarness();
    let shouldFail = false;
    harness.setFetchImplementation(async () => {
        if (shouldFail) return response({}, { ok: false, status: 503 });
        return response({ temperature: 11, city: 'Kyiv' });
    });
    harness.dom.window.document.getElementById('dashboardGrid').innerHTML = '<div id="widget-weather"></div>';

    await harness.api.loadWidgetData('weather');
    assert.match(harness.dom.window.document.getElementById('widget-weather').textContent, /11°/);

    shouldFail = true;
    await harness.api.refreshWidget('weather');

    const text = harness.dom.window.document.getElementById('widget-weather').textContent;
    assert.match(text, /11°/);
    assert.match(text, /останн/i);
    assert.ok(harness.dom.window.document.querySelector('#widget-weather .widget-retry-btn'));
    harness.dom.window.close();
});

test('visibility return refreshes only stale visible widgets without request avalanche', async () => {
    const harness = loadDashboardHarness();
    harness.api.setConfig(boardConfig(['tasks', 'weather']));

    harness.api.renderWidgets();
    await flushHydration();
    harness.api.expireWidgetData('weather');
    harness.dom.window.document.dispatchEvent(new harness.dom.window.Event('visibilitychange'));
    await flushHydration();

    const counts = widgetRequestCounts(harness.requests);
    assert.equal(counts['/api/dashboard/widgets/tasks?businessContext=event_genix'], 1);
    assert.equal(counts['/api/dashboard/widgets/weather?businessContext=event_genix'], 2);
    assert.equal(counts['/api/dashboard/widgets/funnel?businessContext=event_genix'] || 0, 0);
    harness.dom.window.close();
});

test('task and alert CRM events refresh existing visible widgets through current event names', async () => {
    const harness = loadDashboardHarness();
    let taskTitle = 'Old task';
    let alertTitle = 'Old alert';
    harness.setFetchImplementation(async url => {
        if (url.includes('/widgets/tasks')) return response({ tasks: [{ id: 1, title: taskTitle, status: 'todo' }] });
        if (url.includes('/widgets/alerts')) return response({ alerts: [{ title: alertTitle, level: 'warning' }] });
        return response({});
    });
    harness.dom.window.document.getElementById('dashboardGrid').innerHTML = `
        <section data-widget="tasks"><div id="widget-tasks"></div></section>
        <section data-widget="alerts"><div id="widget-alerts"></div></section>
        <section data-widget-type="tasks"><div class="board-widget-live"></div></section>
        <section data-widget-type="tasks"><div class="board-widget-live"></div></section>
    `;
    await Promise.all([
        harness.api.loadWidgetData('tasks'),
        harness.api.loadWidgetData('alerts')
    ]);
    assert.match(harness.dom.window.document.getElementById('widget-alerts').textContent, /Old alert/);

    taskTitle = 'New task';
    alertTitle = 'New alert';
    harness.dom.window.dispatchEvent(new harness.dom.window.CustomEvent('crm:tasks-updated'));
    harness.dom.window.dispatchEvent(new harness.dom.window.CustomEvent('crm:alerts-updated'));
    await flushHydration();
    await flushHydration();

    const taskContainers = [
        harness.dom.window.document.getElementById('widget-tasks'),
        ...harness.dom.window.document.querySelectorAll('[data-widget-type="tasks"] .board-widget-live')
    ];
    taskContainers.forEach(container => assert.match(container.textContent, /New task/));
    assert.match(harness.dom.window.document.getElementById('widget-alerts').textContent, /New alert/);
    const counts = widgetRequestCounts(harness.requests);
    assert.equal(counts['/api/dashboard/widgets/tasks?businessContext=event_genix'], 2);
    assert.equal(counts['/api/dashboard/widgets/alerts?businessContext=event_genix'], 2);
    harness.dom.window.close();
});

test('my focus completion uses canonical task status endpoint once and refreshes dependent widgets from the server', async () => {
    const harness = loadDashboardHarness();
    const mutations = [];
    let phase = 'before';
    let resolveMutation;
    const mutationDeferred = new Promise(resolve => { resolveMutation = resolve; });
    harness.setFetchImplementation((url, init = {}) => {
        if (url.includes('/api/tasks/10/status')) {
            mutations.push({ url, init });
            return mutationDeferred;
        }
        if (url.includes('/widgets/my_focus')) {
            return response(phase === 'before'
                ? { tasks: [{ id: 10, title: 'Терміново підготувати реквізит', status: 'todo', priority: 'high' }], overdueCount: 1, waitingCount: 0 }
                : { tasks: [], overdueCount: 0, waitingCount: 0 });
        }
        if (url.includes('/widgets/tasks')) {
            return response({ tasks: phase === 'before' ? [{ id: 10, title: 'Терміново підготувати реквізит', status: 'todo' }] : [] });
        }
        if (url.includes('/widgets/nearest_event')) {
            return response({
                event: { id: 44, time: '15:00', program: 'Laser party', canonicalHref: '/?date=2026-09-13' },
                preparation: { tasks: phase === 'before' ? [{ id: 10, title: 'Терміново підготувати реквізит', status: 'todo' }] : [], totalCount: phase === 'before' ? 1 : 0 },
                confirmation: { status: 'confirmed', label: 'Підтверджено' }
            });
        }
        return response({});
    });
    harness.dom.window.document.getElementById('dashboardGrid').innerHTML = `
        <section data-widget="my_focus"><div id="widget-my_focus"></div></section>
        <section data-widget="tasks"><div id="widget-tasks"></div></section>
        <section data-widget="nearest_event"><div id="widget-nearest_event"></div></section>
    `;

    await Promise.all([
        harness.api.loadWidgetData('my_focus'),
        harness.api.loadWidgetData('tasks'),
        harness.api.loadWidgetData('nearest_event')
    ]);
    const button = harness.dom.window.document.querySelector('[data-dashboard-task-complete="10"]');
    assert.ok(button);

    const first = harness.api.completeFocusTask(10, button, {
        preventDefault() {},
        stopPropagation() {}
    });
    const second = harness.api.completeFocusTask(10, button, {
        preventDefault() {},
        stopPropagation() {}
    });
    await flushHydration();

    assert.equal(mutations.length, 1, 'double click while pending must not send a second mutation');
    assert.equal(button.disabled, true);
    assert.equal(button.hasAttribute('aria-busy'), true);
    assert.equal(harness.notifications.length, 0, 'success is not announced before the server confirms');
    assert.equal(mutations[0].url, '/api/tasks/10/status?businessContext=event_genix');
    assert.equal(mutations[0].init.method, 'PATCH');
    assert.deepEqual(JSON.parse(mutations[0].init.body), {
        status: 'done',
        sourceSurface: 'manager_queue_task_execution_v2'
    });

    phase = 'after';
    resolveMutation(response({}, {
        payload: { success: true, task: { id: 10, status: 'done' }, meta: { durableMutation: true, canonicalField: 'tasks.status' } }
    }));
    await first;
    await second;
    await flushHydration();

    assert.ok(harness.notifications.some(entry => entry.type === 'success' && /Задачу виконано/.test(entry.message)));
    const counts = widgetRequestCounts(harness.requests);
    assert.equal(counts['/api/dashboard/widgets/my_focus?businessContext=event_genix'], 2);
    assert.equal(counts['/api/dashboard/widgets/tasks?businessContext=event_genix'], 2);
    assert.equal(counts['/api/dashboard/widgets/nearest_event?businessContext=event_genix'], 2);
    assert.match(harness.dom.window.document.getElementById('widget-my_focus').textContent, /Доступних актуальних задач немає/);
    assert.equal(harness.dom.window.document.querySelectorAll('#widget-my_focus [data-dashboard-task-action="complete"]').length, 0);
    assert.doesNotMatch(harness.dom.window.document.getElementById('widget-my_focus').textContent, /Терміново підготувати реквізит/);
    harness.dom.window.close();
});

test('my focus completion keeps task open and shows retry when the server denies or fails the mutation', async () => {
    const harness = loadDashboardHarness();
    const mutations = [];
    harness.setFetchImplementation((url, init = {}) => {
        if (url.includes('/api/tasks/12/status')) {
            mutations.push({ url, init });
            return response({}, { ok: false, status: 403, payload: { success: false, error: 'Недостатньо прав для зміни задачі' } });
        }
        if (url.includes('/widgets/my_focus')) {
            return response({ tasks: [{ id: 12, title: 'Закрити підготовку сцени', status: 'todo', priority: 'high' }], overdueCount: 0, waitingCount: 0 });
        }
        if (url.includes('/widgets/tasks') || url.includes('/widgets/nearest_event')) return response({ tasks: [] });
        return response({});
    });
    harness.dom.window.document.getElementById('dashboardGrid').innerHTML = `
        <section data-widget="my_focus"><div id="widget-my_focus"></div></section>
        <section data-widget="tasks"><div id="widget-tasks"></div></section>
        <section data-widget="nearest_event"><div id="widget-nearest_event"></div></section>
    `;

    await harness.api.loadWidgetData('my_focus');
    const button = harness.dom.window.document.querySelector('[data-dashboard-task-complete="12"]');
    const result = await harness.api.completeFocusTask(12, button, {
        preventDefault() {},
        stopPropagation() {}
    });
    await flushHydration();

    assert.equal(result.success, false);
    assert.equal(mutations.length, 1);
    assert.match(harness.dom.window.document.getElementById('widget-my_focus').textContent, /Закрити підготовку сцени/);
    assert.match(harness.dom.window.document.getElementById('widget-my_focus').textContent, /Повторити/);
    assert.match(harness.dom.window.document.getElementById('widget-my_focus').textContent, /Недостатньо прав/);
    const counts = widgetRequestCounts(harness.requests);
    assert.equal(counts['/api/dashboard/widgets/my_focus?businessContext=event_genix'], 1, 'failed mutation must not fake-refresh counters as completed');
    assert.equal(counts['/api/dashboard/widgets/tasks?businessContext=event_genix'] || 0, 0);
    assert.equal(counts['/api/dashboard/widgets/nearest_event?businessContext=event_genix'] || 0, 0);
    assert.equal(harness.notifications.some(entry => entry.type === 'success'), false);
    harness.dom.window.close();
});

test('rank zero allows selection, selected focus hides it, and snooze uses canonical endpoint', async () => {
    const harness = loadDashboardHarness();
    const mutations = [];
    harness.setFetchImplementation((url, init = {}) => {
        if (url.includes('/api/tasks/14/snooze')) {
            mutations.push({ url, init });
            return response({}, { payload: { success: true, task: { id: 14, status: 'todo', snoozedUntil: '2026-09-15T12:00:00Z' } } });
        }
        if (url.includes('/widgets/my_focus')) {
            return response({
                tasks: [
                    { id: 14, title: 'Поставити в особистий фокус', status: 'todo', focus_rank: 0 },
                    { id: 15, title: 'Відкласти не термінове', status: 'todo', focus_rank: 1 }
                ],
                overdueCount: 0,
                waitingCount: 0
            });
        }
        if (url.includes('/widgets/tasks')) return response({ tasks: [] });
        if (url.includes('/widgets/nearest_event')) return response({ event: null, preparation: null, meta: { state: 'empty' } });
        if (url.includes('/widgets/quick_stats')) return response({ bookingsToday: 0, activeTasks: 0, revenueToday: 0 });
        return response({});
    });
    harness.dom.window.document.getElementById('dashboardGrid').innerHTML = `
        <section data-widget="my_focus"><div id="widget-my_focus"></div></section>
        <section data-widget="tasks"><div id="widget-tasks"></div></section>
        <section data-widget="nearest_event"><div id="widget-nearest_event"></div></section>
        <section data-widget="quick_stats"><div id="widget-quick_stats"></div></section>
    `;

    await harness.api.loadWidgetData('my_focus');
    const focusButton = harness.dom.window.document.querySelector('[data-dashboard-task-action="focus"][data-dashboard-task-id="14"]');
    const snoozeButton = harness.dom.window.document.querySelector('[data-dashboard-task-action="snooze"][data-dashboard-task-id="14"]');
    assert.ok(focusButton, 'rank zero is a recommendation, not selected focus');
    assert.equal(harness.dom.window.document.querySelector('[data-dashboard-task-action="focus"][data-dashboard-task-id="15"]'), null, 'rank one is selected and hides redundant focus action');
    assert.ok(snoozeButton);

    const snoozeResult = await harness.api.snoozeDashboardTask(14, snoozeButton, { preventDefault() {}, stopPropagation() {} });
    assert.equal(snoozeResult.success, true);
    assert.equal(mutations.length, 1);
    assert.equal(mutations[0].url, '/api/tasks/14/snooze?businessContext=event_genix');
    assert.deepEqual(JSON.parse(mutations[0].init.body), {
        hours: 24,
        sourceSurface: 'dashboard_my_focus'
    });
    const counts = widgetRequestCounts(harness.requests);
    assert.ok(counts['/api/dashboard/widgets/my_focus?businessContext=event_genix'] >= 2);
    assert.ok(counts['/api/dashboard/widgets/tasks?businessContext=event_genix'] >= 1);
    assert.ok(counts['/api/dashboard/widgets/nearest_event?businessContext=event_genix'] >= 1);
    harness.dom.window.close();
});

test('my focus completion action is isolated from opening task details or dragging cards', () => {
    const source = DASHBOARD_SOURCE;
    assert.match(source, /onclick="DashboardPage\.completeFocusTask\(\$\{id\}, this, event\)"/);
    assert.match(source, /onclick="DashboardPage\.focusDashboardTask\(\$\{id\}, this, event\)"/);
    assert.match(source, /onclick="DashboardPage\.snoozeDashboardTask\(\$\{id\}, this, event\)"/);
    assert.match(source, /onpointerdown="event\.stopPropagation\(\)"/);
    assert.match(source, /onmousedown="event\.stopPropagation\(\)"/);
    assert.match(source, /event\?\.preventDefault\?\.\(\);/);
    assert.match(source, /event\?\.stopPropagation\?\.\(\);/);
    assert.match(source, /class="widget-task-title focus-task-detail-link" href=/);
    assert.match(source, /href: '\/tasks\?open=' \+ encodeURIComponent\(task.id\)/);
    const focusRenderer = source.slice(source.indexOf('    function renderMyFocus('), source.indexOf('    function taskerStatusLabel('));
    assert.doesNotMatch(focusRenderer, /class="widget-task-item" onclick=/, 'details use a keyboard accessible link separate from completion');
});

test('stale in-flight widget response after invalidation cannot restore old data', async () => {
    const harness = loadDashboardHarness();
    const pending = [];
    harness.setFetchImplementation(url => {
        const request = deferred();
        pending.push({ url, ...request });
        return request.promise;
    });
    harness.dom.window.document.getElementById('dashboardGrid').innerHTML = '<div id="widget-alerts"></div>';

    const oldLoad = harness.api.loadWidgetData('alerts');
    assert.equal(pending.length, 1);
    harness.dom.window.dispatchEvent(new harness.dom.window.CustomEvent('crm:alerts-updated'));
    await flushHydration();
    assert.equal(pending.length, 2);

    pending[1].resolve(response({ alerts: [{ title: 'fresh alert', level: 'warning' }] }));
    await pending[1].promise;
    await flushHydration();
    pending[0].resolve(response({ alerts: [{ title: 'old alert', level: 'critical' }] }));
    await oldLoad;

    assert.match(harness.dom.window.document.getElementById('widget-alerts').textContent, /fresh alert/);
    assert.doesNotMatch(harness.dom.window.document.getElementById('widget-alerts').textContent, /old alert/);
    harness.dom.window.close();
});

test('funnel authorization errors render denied state while finance widgets keep access guard', async () => {
    const harness = loadDashboardHarness();
    harness.setFetchImplementation(async url => {
        if (url.includes('/widgets/funnel')) return response({}, { ok: false, status: 403 });
        return response({});
    });
    harness.dom.window.document.getElementById('dashboardGrid').innerHTML = '<div id="widget-funnel"></div>';

    await harness.api.loadWidgetData('funnel');
    assert.match(harness.dom.window.document.getElementById('widget-funnel').textContent, /Воронка недоступна|Недоступно/);

    const employeeHarness = loadDashboardHarness({ role: 'employee' });
    employeeHarness.api.setConfig(boardConfig(['finance_today']));
    employeeHarness.api.renderWidgets();
    await flushHydration();
    assert.equal(employeeHarness.requests.some(url => url.includes('/widgets/finance_today')), false);
    harness.dom.window.close();
    employeeHarness.dom.window.close();
});

test('new context gets one fresh request and stale old response cannot overwrite it', async () => {
    const harness = loadDashboardHarness();
    const pending = [];
    harness.setFetchImplementation(url => {
        const request = deferred();
        pending.push({ url, ...request });
        return request.promise;
    });
    harness.dom.window.document.getElementById('dashboardGrid').innerHTML = '<div id="widget-tasks"></div>';

    const oldLoad = harness.api.loadWidgetData('tasks');
    assert.equal(pending.length, 1);
    harness.setBusiness('maysternya_doli');
    harness.setSessionGeneration('session-2');
    const newLoad = harness.api.loadWidgetData('tasks');
    assert.equal(pending.length, 2);

    pending[1].resolve(response({ tasks: [], marker: 'new-context' }));
    await newLoad;
    pending[0].resolve(response({ tasks: [], marker: 'old-context' }));
    await oldLoad;

    assert.equal(harness.api.getWidgetData('tasks').marker, 'new-context');
    assert.deepEqual(widgetRequestCounts(harness.requests), {
        '/api/dashboard/widgets/tasks?businessContext=event_genix': 1,
        '/api/dashboard/widgets/tasks?businessContext=maysternya_doli': 1
    });
    assert.equal(harness.api.getPendingRequestCount(), 0);
    harness.dom.window.close();
});

test('empty dashboard and denied revenue widget do not issue forbidden reads', async () => {
    const harness = loadDashboardHarness({ role: 'employee' });
    harness.api.setConfig(boardConfig([]));
    harness.api.renderWidgets();
    await flushHydration();
    assert.deepEqual(widgetRequestCounts(harness.requests), {});

    harness.api.setConfig(boardConfig(['finance_today']));
    harness.api.renderWidgets();
    await flushHydration();
    assert.equal(harness.requests.some(url => url.includes('/widgets/finance_today')), false);
    harness.dom.window.close();
});


test('day orientation prioritizes real nearest-event preparation over focus and funnel signals', async () => {
    const harness = loadDashboardHarness({ now: '2026-09-13T10:30:00Z' });
    const orientation = addDayOrientationContainer(harness);
    harness.setFetchImplementation(async url => {
        if (url.includes('/widgets/nearest_event')) return response({
            event: { id: 77, time: '14:30:00', date: '2026-09-13', canonicalHref: '/?date=2026-09-13' },
            confirmation: { status: 'confirmed', label: 'Підтверджено' },
            preparation: { totalCount: 3, openCount: 2, doneCount: 1, overdueCount: 0, tasks: [] }
        });
        if (url.includes('/widgets/my_focus')) return response({
            overdueCount: 4,
            waitingCount: 0,
            tasks: [{ id: 9, title: 'Прострочена задача', status: 'todo', deadline: '2026-09-12T09:00:00Z' }]
        });
        if (url.includes('/widgets/funnel')) return response({
            meta: { funnelInsights: { waitingAction: 6, total: 8, hotStage: { label: 'Нові ліди', href: '/sales-funnel?view=kanban&pipeline_stage=new&lead_type=quality&attention=stale_contact_48h' }, stages: [] } }
        });
        return response({});
    });
    harness.api.setConfig(boardConfig([]));

    harness.api.renderWidgets();
    await flushHydration();
    await flushHydration();

    assert.match(orientation.textContent, /До події о 14:30 залишилися 2 задачі/);
    assert.doesNotMatch(orientation.textContent, /прострочена задача/i);
    assert.doesNotMatch(orientation.textContent, /лідів чекають/);
    assert.equal(orientation.querySelector('a.dashboard-day-orientation-action')?.getAttribute('href'), '/?date=2026-09-13');
    assert.equal(JSON.stringify(harness.api.getConfigWidgets()), '[]');
    assert.equal(widgetRequestCounts(harness.requests)['/api/dashboard/widgets/nearest_event?businessContext=event_genix'], 1);
    assert.equal(widgetRequestCounts(harness.requests)['/api/dashboard/widgets/my_focus?businessContext=event_genix'], 1);
    assert.equal(widgetRequestCounts(harness.requests)['/api/dashboard/widgets/funnel?businessContext=event_genix'], 1);
    harness.dom.window.close();
});

test('nearest event and funnel widgets expose tomorrow context and exact sales attention links', async () => {
    const harness = loadDashboardHarness();
    harness.setFetchImplementation(async url => {
        if (url.includes('/widgets/nearest_event')) return response({
            event: {
                id: 91,
                time: '09:30:00',
                date: '2026-09-15',
                dateScope: 'tomorrow',
                program: 'Test party',
                canonicalHref: '/booking-summary.html?id=91&businessContext=event_genix&return=%2Fdashboard'
            },
            confirmation: { status: 'confirmed', label: 'Підтверджено' },
            preparation: { totalCount: 0, openCount: 0, doneCount: 0, overdueCount: 0, tasks: [], noTasksMeans: 'unknown' },
            meta: { dateScope: 'tomorrow', searchedDates: ['2026-09-14', '2026-09-15'], lookaheadDays: 1 }
        });
        if (url.includes('/widgets/funnel')) return response({
            meta: {
                funnelInsights: {
                    total: 8,
                    waitingAction: 3,
                    href: '/sales-funnel',
                    hotStage: { stage: 'deal', label: 'Угода', total: 4, waitingAction: 3, href: '/sales-funnel?view=kanban&pipeline_stage=deal' },
                    stages: [
                        { stage: 'deal', label: 'Угода', total: 4, waitingAction: 3, href: '/sales-funnel?view=kanban&pipeline_stage=deal' },
                        { stage: 'new', label: 'Нові', total: 4, waitingAction: 0, href: '/sales-funnel?view=kanban&pipeline_stage=new&lead_type=quality&attention=stale_contact_48h' }
                    ]
                }
            }
        });
        return response({});
    });
    harness.dom.window.document.getElementById('dashboardGrid').innerHTML = `
        <section data-widget="nearest_event"><div id="widget-nearest_event"></div></section>
        <section data-widget="funnel"><div id="widget-funnel"></div></section>
    `;

    await Promise.all([
        harness.api.loadWidgetData('nearest_event'),
        harness.api.loadWidgetData('funnel')
    ]);

    const nearest = harness.dom.window.document.getElementById('widget-nearest_event');
    assert.match(nearest.textContent, /Найближча подія завтра/);
    assert.match(nearest.textContent, /Підготовчі задачі не знайдені/);
    assert.match(nearest.textContent, /Це не означає, що все готово/);
    assert.equal(nearest.querySelector('.nearest-event-open')?.getAttribute('href'), '/booking-summary.html?id=91&businessContext=event_genix&return=%2Fdashboard');

    const funnel = harness.dom.window.document.getElementById('widget-funnel');
    const waitingLink = Array.from(funnel.querySelectorAll('a.dashboard-funnel-metric'))
        .find(link => /без контакту 48 год/.test(link.textContent));
    assert.ok(waitingLink);
    assert.equal(waitingLink.getAttribute('href'), '/sales-funnel?view=kanban&lead_type=quality&attention=stale_contact_48h&lifecycle=active&businessContext=event_genix', 'The global counter must include every active stage in the same business');
    const stageLink = funnel.querySelector('.dashboard-funnel-stage-chip.needs-action');
    assert.equal(stageLink.getAttribute('href'), '/sales-funnel?view=kanban&pipeline_stage=deal&lead_type=quality&attention=stale_contact_48h&lifecycle=active&businessContext=event_genix');
    assert.equal(stageLink.querySelector('strong')?.textContent, '3', 'The stage attention link shows only its matching filtered count');
    assert.match(stageLink.textContent, /без контакту/);
    harness.dom.window.close();
});

test('day orientation is honest when a source is unavailable and does not claim readiness', async () => {
    const harness = loadDashboardHarness();
    const orientation = addDayOrientationContainer(harness);
    harness.setFetchImplementation(async url => {
        if (url.includes('/widgets/nearest_event')) return response({}, { ok: false, status: 503 });
        if (url.includes('/widgets/my_focus')) return response({ overdueCount: 0, waitingCount: 0, tasks: [] });
        if (url.includes('/widgets/funnel')) return response({ meta: { funnelInsights: { waitingAction: 0, total: 0, stages: [] } } });
        return response({});
    });
    harness.api.setConfig(boardConfig([]));

    harness.api.renderWidgets();
    await flushHydration();
    await flushHydration();

    assert.match(orientation.textContent, /Частина сигналів дня недоступна/);
    assert.match(orientation.textContent, /Не вдалося оновити: найближча подія/);
    assert.doesNotMatch(orientation.textContent, /все готово/i);
    assert.ok(orientation.querySelector('button.dashboard-day-orientation-action'));
    harness.dom.window.close();
});

test('day orientation refreshes from hidden source widgets after completing a focus task', async () => {
    const harness = loadDashboardHarness({ now: '2026-09-13T10:30:00Z' });
    const orientation = addDayOrientationContainer(harness);
    const mutations = [];
    let phase = 'before';
    let resolveMutation;
    const mutationDeferred = new Promise(resolve => { resolveMutation = resolve; });
    harness.setFetchImplementation((url, init = {}) => {
        if (url.includes('/api/tasks/31/status')) {
            mutations.push({ url, init });
            return mutationDeferred;
        }
        if (url.includes('/widgets/nearest_event')) return response(phase === 'before'
            ? {
                event: { id: 88, time: '14:30:00', date: '2026-09-13', canonicalHref: '/?date=2026-09-13' },
                confirmation: { status: 'confirmed' },
                preparation: { totalCount: 1, openCount: 1, doneCount: 0, overdueCount: 0, tasks: [] }
            }
            : {
                event: { id: 88, time: '14:30:00', date: '2026-09-13', canonicalHref: '/?date=2026-09-13' },
                confirmation: { status: 'confirmed' },
                preparation: { totalCount: 1, openCount: 0, doneCount: 1, overdueCount: 0, tasks: [] }
            });
        if (url.includes('/widgets/my_focus')) return response(phase === 'before'
            ? { overdueCount: 0, waitingCount: 0, tasks: [{ id: 31, title: 'Перевірити тестову залу', status: 'todo' }] }
            : { overdueCount: 0, waitingCount: 0, tasks: [] });
        if (url.includes('/widgets/funnel')) return response({
            meta: { funnelInsights: { waitingAction: phase === 'before' ? 0 : 3, total: 3, hotStage: { label: 'Нові ліди', href: '/sales-funnel?view=kanban&pipeline_stage=new&lead_type=quality&attention=stale_contact_48h' }, stages: [] } }
        });
        return response({});
    });
    harness.api.setConfig(boardConfig([]));
    harness.dom.window.document.getElementById('dashboardGrid').innerHTML = '<div id="widget-my_focus"></div>';

    await harness.api.loadDayOrientationSources({ missingOnly: false });
    harness.api.renderDayOrientation();
    assert.match(orientation.textContent, /До події о 14:30 залишилася 1 задача/);
    harness.dom.window.document.getElementById('widget-my_focus').innerHTML = `
        <button data-dashboard-task-complete="31">Виконати</button>
    `;

    const action = harness.api.completeFocusTask(31, harness.dom.window.document.querySelector('[data-dashboard-task-complete="31"]'));
    assert.equal(mutations.length, 1);
    phase = 'after';
    resolveMutation(response({}, { payload: { success: true, task: { id: 31, status: 'done' } } }));
    const result = await action;
    await flushHydration();
    await flushHydration();

    assert.equal(result.success, true);
    assert.match(orientation.textContent, /лідів без контакту понад 48 год/);
    assert.doesNotMatch(orientation.textContent, /прострочена домовленість/);
    assert.equal(orientation.querySelector('a.dashboard-day-orientation-action')?.getAttribute('href'), '/sales-funnel?view=kanban&pipeline_stage=new&lead_type=quality&attention=stale_contact_48h&lifecycle=active&businessContext=event_genix');
    const counts = widgetRequestCounts(harness.requests);
    assert.ok(counts['/api/dashboard/widgets/nearest_event?businessContext=event_genix'] >= 2);
    assert.ok(counts['/api/dashboard/widgets/my_focus?businessContext=event_genix'] >= 2);
    assert.ok(counts['/api/dashboard/widgets/funnel?businessContext=event_genix'] >= 2);
    assert.equal(JSON.stringify(harness.api.getConfigWidgets()), '[]');
    harness.dom.window.close();
});
