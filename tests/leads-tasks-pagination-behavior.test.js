const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const repoRoot = path.resolve(__dirname, '..');
const tasksSource = fs.readFileSync(path.join(repoRoot, 'js', 'tasks-page.js'), 'utf8');
const leadsSource = fs.readFileSync(path.join(repoRoot, 'js', 'leads-page.js'), 'utf8');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function routeHandler(router, routePath = '/') {
    const layer = router.stack.find(item => item.route?.path === routePath && item.route.methods.get);
    assert.ok(layer, `GET ${routePath} handler exists`);
    return layer.route.stack.at(-1).handle;
}

function responseCapture() {
    return {
        statusCode: 200,
        body: undefined,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
}

function request(query = {}) {
    return {
        query,
        body: {},
        headers: {},
        user: {
            id: 7,
            userId: 7,
            username: 'qa-user',
            name: 'QA User',
            role: 'creator',
            business_contexts: ['event_genix']
        }
    };
}

test('Tasks and Leads route contracts preserve boundaries and apply filters before pagination', async () => {
    const { pool } = require('../db');
    const tasksRouter = require('../routes/tasks');
    const leadsRouter = require('../routes/leads');
    const tasksHandler = routeHandler(tasksRouter);
    const leadsHandler = routeHandler(leadsRouter);
    const originalQuery = pool.query;

    try {
        for (const total of [0, 1, 499, 500, 501, 1201]) {
            const rows = Array.from({ length: total }, (_, index) => ({
                id: index + 1,
                title: `Task ${index + 1}`,
                status: 'todo',
                category: 'admin',
                visibility: 'team'
            }));
            const sqlCalls = [];
            pool.query = async (sql, params = []) => {
                sqlCalls.push({ sql: String(sql), params: [...params] });
                if (/SELECT COUNT\(\*\)::int AS total FROM tasks t/i.test(sql)) return { rows: [{ total }] };
                const limit = Number(params.at(-2));
                const offset = Number(params.at(-1));
                return { rows: rows.slice(offset, offset + limit) };
            };

            const paged = responseCapture();
            await tasksHandler(request({ pagination: '1', view: 'inbox', page: '1', limit: '500' }), paged);
            assert.equal(paged.statusCode, 200);
            assert.equal(paged.body.success, true);
            assert.equal(paged.body.tasks.length, Math.min(total, 500));
            assert.equal(paged.body.pagination.total, total);
            assert.equal(paged.body.pagination.hasMore, total > 500);

            if (total > 500) {
                const next = responseCapture();
                await tasksHandler(request({ pagination: '1', view: 'inbox', page: '2', limit: '500' }), next);
                assert.equal(next.body.tasks.length, Math.min(total - 500, 500));
            }

            const countSql = sqlCalls.find(call => /SELECT COUNT\(\*\)::int AS total FROM tasks t/i.test(call.sql))?.sql || '';
            const selectSql = sqlCalls.find(call => /SELECT t\.\*/i.test(call.sql) && /LIMIT \$/i.test(call.sql))?.sql || '';
            assert.match(countSql, /workflow_state[\s\S]*inbox/i, 'view filter participates in COUNT');
            assert.match(selectSql, /workflow_state[\s\S]*inbox/i, 'view filter participates in SELECT');
            assert.ok(selectSql.indexOf('workflow_state') < selectSql.lastIndexOf('LIMIT'), 'view filter is before LIMIT');

            const legacy = responseCapture();
            await tasksHandler(request({ view: 'inbox', limit: '500' }), legacy);
            assert.ok(Array.isArray(legacy.body), 'legacy Tasks call remains an array');
        }

        for (const total of [0, 1, 499, 500, 501, 1201]) {
            const rows = Array.from({ length: total }, (_, index) => ({
                id: index + 1,
                client_name: `Lead ${index + 1}`,
                pipeline_stage: 'new',
                lead_type: 'quality',
                event_preference: null
            }));
            pool.query = async (sql, params = []) => {
                if (/SELECT COUNT\(\*\)::int AS total[\s\S]*FROM leads l/i.test(sql)) return { rows: [{ total }] };
                const limit = Number(params.at(-2));
                const offset = Number(params.at(-1));
                return { rows: rows.slice(offset, offset + limit) };
            };
            const res = responseCapture();
            await leadsHandler(request({ limit: '500', offset: '0', pipeline_stage: 'new' }), res);
            assert.equal(res.statusCode, 200);
            assert.equal(res.body.leads.length, Math.min(total, 500));
            assert.equal(res.body.pagination.total, total);
            assert.equal(res.body.pagination.hasMore, total > 500);
            if (total > 500) {
                const next = responseCapture();
                await leadsHandler(request({ limit: '500', offset: '500', pipeline_stage: 'new' }), next);
                assert.equal(next.body.leads.length, Math.min(total - 500, 500));
            }
        }
    } finally {
        pool.query = originalQuery;
    }
});

function tasksHarness(url = 'https://crm.test/tasks') {
    const loadStart = tasksSource.indexOf('async function loadAllTasks');
    const loadEnd = tasksSource.indexOf('async function apiCreateOperationPack', loadStart);
    const deepIdStart = tasksSource.indexOf('function getTaskDeepLinkId');
    const deepIdEnd = tasksSource.indexOf('function getTasksCurrentUser', deepIdStart);
    const deepOpenStart = tasksSource.indexOf('function openTaskDeepLink');
    const deepOpenEnd = tasksSource.indexOf('function showTaskCreateSuccessToast', deepOpenStart);
    assert.ok(loadStart >= 0 && loadEnd > loadStart && deepOpenEnd > deepOpenStart);

    const dom = new JSDOM('<main id="boardContent"></main>', { runScripts: 'outside-only', url });
    const context = dom.getInternalVMContext();
    const pending = [];
    const opened = [];
    const notifications = [];
    context.apiGetTasksPage = args => {
        const item = deferred();
        pending.push({ args, ...item });
        return item.promise;
    };
    context.updateCounts = () => {};
    context.showNotification = (...args) => notifications.push(args);
    context.openTaskDetail = id => opened.push(id);
    context.console = { error() {}, warn() {}, log() {} };
    vm.runInContext(`
        let currentView = 'inbox';
        let allTasks = [];
        let taskLoadSeq = 0;
        let taskPagination = { page: 0, limit: 100, total: 0, hasMore: false, loadingMore: false, view: 'inbox' };
        function escapeHtml(value) { return String(value); }
        function renderBoard() {
            const board = document.getElementById('boardContent');
            board.innerHTML = '<div data-rendered-count="' + allTasks.length + '"></div>';
            renderTaskPagination(board);
        }
        ${tasksSource.slice(loadStart, loadEnd)}
        ${tasksSource.slice(deepIdStart, deepIdEnd)}
        ${tasksSource.slice(deepOpenStart, deepOpenEnd)}
        this.__hooks = {
            loadAllTasks, renderTaskPagination, openTaskDeepLink,
            getTasks: () => allTasks,
            getPagination: () => taskPagination,
            setView: value => { currentView = value; }
        };
    `, context, { filename: 'js/tasks-page.js' });
    return { dom, context, pending, opened, notifications, hooks: context.__hooks };
}

function taskPage(tasks, { page = 1, limit = 100, total = tasks.length, hasMore = false } = {}) {
    return { success: true, tasks, pagination: { page, limit, total, nextPage: page + 1, hasMore } };
}

test('Tasks frontend appends without duplicates and exposes loading/error/retry states', async () => {
    const harness = tasksHarness();
    const first = harness.hooks.loadAllTasks();
    harness.pending[0].resolve(taskPage([{ id: 1 }, { id: 2 }], { total: 3, hasMore: true }));
    await first;

    const append = harness.hooks.loadAllTasks({ append: true });
    assert.equal(harness.hooks.getPagination().loadingMore, true);
    assert.ok(harness.dom.window.document.querySelector('[data-task-load-more][disabled]'));
    harness.pending[1].resolve(taskPage([{ id: 2 }, { id: 3 }], { page: 2, total: 3 }));
    await append;
    assert.deepEqual(Array.from(harness.hooks.getTasks(), task => task.id), [1, 2, 3]);

    harness.context.taskPagination = { ...harness.hooks.getPagination(), hasMore: true };
    const failed = harness.hooks.loadAllTasks({ append: true });
    harness.pending[2].reject(new Error('temporary'));
    await failed;
    assert.equal(harness.hooks.getPagination().loadingMore, false);
    assert.ok(harness.dom.window.document.querySelector('[data-task-retry]'));
    harness.dom.window.close();
});

test('Tasks stale view response is ignored and deep link opens a task outside page one', async () => {
    const harness = tasksHarness('https://crm.test/tasks?open=501');
    const oldLoad = harness.hooks.loadAllTasks();
    harness.hooks.setView('team');
    const newLoad = harness.hooks.loadAllTasks();
    harness.pending[0].resolve(taskPage([{ id: 1 }], { total: 501, hasMore: true }));
    await oldLoad;
    harness.pending[1].resolve(taskPage([{ id: 500 }], { total: 1 }));
    await newLoad;
    assert.deepEqual(Array.from(harness.hooks.getTasks(), task => task.id), [500]);
    harness.hooks.openTaskDeepLink();
    assert.deepEqual(harness.opened, [501]);
    harness.dom.window.close();
});

function leadsHarness() {
    const start = leadsSource.indexOf('function leadListParams');
    const end = leadsSource.indexOf('function normalizeLeadCount', start);
    assert.ok(start >= 0 && end > start, 'lead pagination lifecycle exists');
    const dom = new JSDOM('<input id="leadsSearch"><div id="leadsTableBody"></div>', {
        runScripts: 'outside-only',
        url: 'https://crm.test/sales-funnel'
    });
    const context = dom.getInternalVMContext();
    const requests = [];
    const renders = [];
    context.apiFetch = url => {
        const item = deferred();
        requests.push({ url: String(url), ...item });
        return item.promise;
    };
    context.renderKanban = () => renders.push('kanban');
    context.renderTable = () => renders.push('table');
    context.showNotification = () => {};
    context.escapeHtml = value => String(value);
    context.console = { error() {}, warn() {}, log() {} };
    vm.runInContext(`
        let currentView = 'table';
        let currentFilter = '';
        let currentTypeFilter = '';
        let currentDateFilter = '';
        let currentPipelineStage = '';
        let leadsData = [];
        let leadLoadSeq = 1;
        const LEAD_TABLE_PAGE_SIZE = 100;
        const LEAD_KANBAN_PAGE_SIZE = 100;
        const PIPELINE_STAGES = [{ key: 'new' }, { key: 'contacted' }];
        let leadPagination = { total: 0, limit: 100, offset: 0, nextOffset: 0, hasMore: false, loadingMore: false };
        let leadKanbanPagination = {};
        ${leadsSource.slice(start, end)}
        this.__hooks = {
            fetchLeadPage, fetchKanbanLeadPages, loadMoreLeads,
            getLeads: () => leadsData,
            getTablePage: () => leadPagination,
            getKanbanPages: () => leadKanbanPagination,
            setState: values => {
                if ('view' in values) currentView = values.view;
                if ('filter' in values) currentFilter = values.filter;
                if ('type' in values) currentTypeFilter = values.type;
                if ('date' in values) currentDateFilter = values.date;
                if ('stage' in values) currentPipelineStage = values.stage;
                if ('leads' in values) leadsData = values.leads;
                if ('tablePage' in values) leadPagination = values.tablePage;
                if ('kanbanPages' in values) leadKanbanPagination = values.kanbanPages;
                if (values.invalidate) leadLoadSeq += 1;
            }
        };
    `, context, { filename: 'js/leads-page.js' });
    return { dom, context, requests, renders, hooks: context.__hooks };
}

function leadResponse(leads, pagination) {
    return { ok: true, status: 200, json: async () => ({ success: true, leads, pagination }) };
}

test('Leads table keeps filters/counts and requests bounded pages across dataset boundaries', async () => {
    for (const total of [0, 1, 499, 500, 501, 1201]) {
        const harness = leadsHarness();
        harness.dom.window.document.getElementById('leadsSearch').value = 'Serhii';
        harness.hooks.setState({
            filter: 'active', type: 'quality', date: '2026-07-12',
            tablePage: { total, limit: 100, offset: 0, nextOffset: 100, hasMore: total > 100, loadingMore: false }
        });
        const load = harness.hooks.loadMoreLeads();
        if (total > 100) {
            assert.match(harness.requests[0].url, /limit=100/);
            assert.match(harness.requests[0].url, /offset=100/);
            assert.match(harness.requests[0].url, /status=active/);
            assert.match(harness.requests[0].url, /lead_type=quality/);
            assert.match(harness.requests[0].url, /event_date=2026-07-12/);
            assert.match(harness.requests[0].url, /search=Serhii/);
            harness.requests[0].resolve(leadResponse([{ id: 101 }], { total, limit: 100, offset: 100, nextOffset: 101, hasMore: total > 101 }));
            await load;
            assert.equal(harness.hooks.getTablePage().total, total);
        } else {
            await load;
            assert.equal(harness.requests.length, 0);
        }
        harness.dom.window.close();
    }
});

test('Leads Kanban keeps column ordering and completes parallel load-more requests', async () => {
    const harness = leadsHarness();
    harness.hooks.setState({
        view: 'kanban',
        leads: [{ id: 1, pipeline_stage: 'new' }, { id: 2, pipeline_stage: 'contacted' }],
        kanbanPages: {
            new: { total: 2, limit: 100, offset: 0, nextOffset: 1, hasMore: true, loadingMore: false },
            contacted: { total: 2, limit: 100, offset: 0, nextOffset: 1, hasMore: true, loadingMore: false }
        }
    });
    const newColumn = harness.hooks.loadMoreLeads({ stage: 'new' });
    const contactedColumn = harness.hooks.loadMoreLeads({ stage: 'contacted' });
    assert.equal(harness.requests.length, 2);
    harness.requests[1].resolve(leadResponse([{ id: 4, pipeline_stage: 'contacted' }], { total: 2, limit: 100, offset: 1, nextOffset: 2, hasMore: false }));
    harness.requests[0].resolve(leadResponse([{ id: 3, pipeline_stage: 'new' }], { total: 2, limit: 100, offset: 1, nextOffset: 2, hasMore: false }));
    await Promise.all([newColumn, contactedColumn]);

    const loaded = Array.from(harness.hooks.getLeads(), lead => ({ id: lead.id, stage: lead.pipeline_stage }));
    assert.deepEqual(loaded.filter(lead => lead.stage === 'new').map(lead => lead.id), [1, 3]);
    assert.deepEqual(loaded.filter(lead => lead.stage === 'contacted').map(lead => lead.id), [2, 4]);
    assert.equal(harness.hooks.getKanbanPages().new.loadingMore, false);
    assert.equal(harness.hooks.getKanbanPages().contacted.loadingMore, false);
    harness.dom.window.close();
});

test('Leads stale filter response cannot replace the active dataset', async () => {
    const harness = leadsHarness();
    harness.hooks.setState({
        leads: [{ id: 1 }],
        tablePage: { total: 2, limit: 100, offset: 0, nextOffset: 1, hasMore: true, loadingMore: false }
    });
    const oldLoad = harness.hooks.loadMoreLeads();
    harness.hooks.setState({ invalidate: true, filter: 'won', leads: [{ id: 99 }] });
    harness.requests[0].resolve(leadResponse([{ id: 2 }], { total: 2, limit: 100, offset: 1, nextOffset: 2, hasMore: false }));
    await oldLoad;
    assert.deepEqual(Array.from(harness.hooks.getLeads(), lead => lead.id), [99]);
    harness.dom.window.close();
});
