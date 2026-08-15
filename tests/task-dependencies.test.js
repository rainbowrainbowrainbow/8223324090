'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const {
    addTaskDependency,
    emptyDependencyState,
    loadTaskDependencyStates,
    removeTaskDependency
} = require('../services/taskDependencies');

test('dependency projection computes blocked state from canonical task_dependencies only', async () => {
    const states = await loadTaskDependencyStates({
        async query(sql, params) {
            assert.match(sql, /FROM task_dependencies/);
            assert.deepEqual(params, [[10, 11]]);
            return { rows: [
                { task_id: 10, depends_on_task_id: 4, title: 'Find charger', status: 'todo', is_open: true },
                { task_id: 10, depends_on_task_id: 5, title: 'Old prerequisite', status: 'done', is_open: false }
            ] };
        }
    }, [10, 11]);
    assert.equal(states.get(10).dependencyCount, 2);
    assert.equal(states.get(10).openDependencyCount, 1);
    assert.equal(states.get(10).isBlocked, true);
    assert.deepEqual(states.get(11), emptyDependencyState());
});

test('link and unlink synchronize canonical rows with the legacy array in the same service path', async () => {
    const calls = [];
    const queryable = {
        async query(sql, params) {
            calls.push({ sql, params });
            if (sql.includes('SELECT source.id')) return { rows: [{ task_id: 10, depends_on_task_id: 4 }] };
            if (sql.includes('WITH RECURSIVE')) return { rows: [] };
            if (sql.includes('SELECT d.depends_on_task_id')) return { rows: [] };
            return { rows: [] };
        }
    };
    await addTaskDependency(queryable, { taskId: 10, dependsOnTaskId: 4 });
    await removeTaskDependency(queryable, { taskId: 10, dependsOnTaskId: 4 });
    assert.equal(calls.filter(call => call.sql.includes('INSERT INTO task_dependencies')).length, 1);
    assert.equal(calls.filter(call => call.sql.includes('DELETE FROM task_dependencies')).length, 1);
    assert.equal(calls.filter(call => call.sql.includes('SET dependency_ids')).length, 2);
});

test('self links and cycles are rejected before a canonical insert', async () => {
    await assert.rejects(() => addTaskDependency({ query: async () => ({ rows: [] }) }, { taskId: 10, dependsOnTaskId: 10 }), { code: 'TASK_DEPENDENCY_SELF_REFERENCE' });
    const calls = [];
    await assert.rejects(() => addTaskDependency({
        async query(sql) {
            calls.push(sql);
            if (sql.includes('SELECT source.id')) return { rows: [{ task_id: 10, depends_on_task_id: 4 }] };
            if (sql.includes('WITH RECURSIVE')) return { rows: [{ task_id: 10 }] };
            return { rows: [] };
        }
    }, { taskId: 10, dependsOnTaskId: 4 }), { code: 'TASK_DEPENDENCY_CYCLE' });
    assert.equal(calls.some(sql => sql.includes('INSERT INTO task_dependencies')), false);
});

test('Task 3 route, projection, UI, and compatibility migration retain the blocker contract', () => {
    const root = path.resolve(__dirname, '..');
    const routes = fs.readFileSync(path.join(root, 'routes', 'tasks.js'), 'utf8');
    const projection = fs.readFileSync(path.join(root, 'services', 'taskCabinetProjection.js'), 'utf8');
    const profile = fs.readFileSync(path.join(root, 'js', 'profile-page.js'), 'utf8');
    const ui = fs.readFileSync(path.join(root, 'js', 'my-day-dependencies.js'), 'utf8');
    assert.match(routes, /router\.get\('\/:id\/dependencies'/);
    assert.match(routes, /router\.post\('\/:id\/dependencies\/quick-create'/);
    assert.match(routes, /router\.delete\('\/:id\/dependencies\/:dependsOnTaskId'/);
    assert.match(routes, /BEGIN/);
    assert.match(routes, /my_day_task_metadata/);
    assert.match(projection, /loadTaskDependencyStates/);
    assert.match(profile, /data-cabinet-task-action': 'dependencies'/);
    assert.match(profile, /complete-despite-blocker/);
    assert.match(ui, /Спочатку:/);
});

test('My Day dependency manager keeps backend flow while using the styled dependency surface contract', () => {
    const root = path.resolve(__dirname, '..');
    const ui = fs.readFileSync(path.join(root, 'js', 'my-day-dependencies.js'), 'utf8');
    const profile = fs.readFileSync(path.join(root, 'js', 'profile-page.js'), 'utf8');
    const taskUi = fs.readFileSync(path.join(root, 'js', 'task-ui.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'css', 'pages-profile.css'), 'utf8');

    assert.match(ui, /surfaceClassName: 'task-ui-action-surface--dependencies'/);
    assert.match(ui, /Поточні передумови[\s\S]*Пошук задачі[\s\S]*Швидке створення/);
    assert.match(ui, /data-dependency-current[\s\S]*data-dependency-search[\s\S]*data-dependency-create/);
    assert.match(ui, /const MIN_SEARCH_CHARS = 2/);
    assert.match(ui, /const SEARCH_DEBOUNCE_MS = 220/);
    assert.match(ui, /query\.length < MIN_SEARCH_CHARS[\s\S]*Введіть мінімум 2 символи/);
    assert.ok(ui.indexOf('Збігів немає') > ui.indexOf('query.length < MIN_SEARCH_CHARS'), 'empty state is only after a real search branch');
    assert.match(ui, /const Params = typeof URLSearchParams !== 'undefined' \? URLSearchParams : window\.URLSearchParams/);
    assert.match(ui, /const params = new Params\(\{[\s\S]*search: String\(query \|\| ''\)\.trim\(\)/);
    assert.match(ui, /searchAbortController\.abort\(\)/);
    assert.match(ui, /sequence !== searchSequence/);
    assert.match(ui, /task-ui:surface-close/);
    assert.match(ui, /data-dependency-quick-create disabled aria-disabled="true"/);
    assert.match(ui, /quickCreateButton\.disabled = disabled/);
    assert.match(ui, /class="my-day-dependency-result-row"/);
    assert.doesNotMatch(ui, /role="listbox"/);
    assert.doesNotMatch(ui, /role="option"/);
    assert.match(ui, /let pending = false/);
    assert.match(ui, /root\.setAttribute\('aria-busy', pending \? 'true' : 'false'\)/);
    assert.match(ui, /if \(pending\) return/);
    assert.match(ui, /const DEPENDENCY_REQUEST_TIMEOUT_MS = 12000/);
    assert.match(ui, /Запит передумов зайняв забагато часу/);
    assert.match(ui, /data-dependency-retry/);
    assert.match(ui, /Введіть мінімум 2 символи/);
    assert.match(ui, /🔗/);
    assert.match(ui, /request\(taskSearchPath\(query\), \{ signal: searchAbortController\?\.signal \}\)/);
    assert.match(ui, /request\('\/' \+ taskId \+ '\/dependencies'/);
    assert.match(ui, /request\('\/' \+ taskId \+ '\/dependencies\/quick-create'/);
    assert.match(ui, /request\('\/' \+ taskId \+ '\/dependencies\/' \+ encodeURIComponent/);
    assert.doesNotMatch(profile, /my-day-dependency-manager/);

    assert.match(css, /\.task-ui-action-surface--dependencies\.is-popover \.task-ui-action-panel\s*\{[\s\S]*width:\s*min\(430px, calc\(100vw - 24px\)\)/);
    assert.match(css, /\.my-day-dependency-section\s*\{[\s\S]*border-radius:\s*16px/);
    assert.match(css, /\.my-day-dependency-field input\s*\{[\s\S]*min-height:\s*40px/);
    assert.match(css, /\.my-day-dependency-results\s*\{[\s\S]*max-height:\s*210px;[\s\S]*overflow-y:\s*auto/);
    assert.match(css, /\.cabinet-task-dependency-action,[\s\S]*\.cabinet-task-blocker-badge\s*\{[\s\S]*color:\s*#334155/);
    assert.match(css, /body\.dark-mode[\s\S]*\.task-ui-action-surface--dependencies \.my-day-dependency-section/);
    assert.match(css, /@media \(max-width: 680px\)[\s\S]*\.task-ui-action-surface--dependencies/);

    assert.match(taskUi, /if \(event\.key === 'Escape'\)[\s\S]*closeActionMenu\(\)/);
    assert.match(taskUi, /aria-label="\$\{escapeHtml\(title\)\}"/);
    assert.match(taskUi, /actionMenuFocusableElements\(root\)\[0\]\?\.focus/);
    assert.match(taskUi, /stableActionAnchor/);
    assert.match(taskUi, /MutationObserver/);
    assert.match(taskUi, /task-ui:surface-close/);
});

test('dependency manager opens immediately with a loading state before current dependencies resolve', async () => {
    const root = path.resolve(__dirname, '..');
    const dom = new JSDOM('<!doctype html><body><button id="anchor" data-task-id="10">Deps</button></body>', {
        pretendToBeVisual: true,
        url: 'https://crm.test/profile.html'
    });
    let resolveDependencies;
    const context = vm.createContext({
        console,
        window: dom.window,
        document: dom.window.document,
        AbortController,
        fetch: async (url, options = {}) => {
            const method = String(options.method || 'GET').toUpperCase();
            if (String(url).includes('/api/tasks/10/dependencies') && method === 'GET') {
                return new Promise(resolve => {
                    resolveDependencies = () => resolve({ ok: true, json: async () => ({ dependencies: [] }) });
                });
            }
            throw new Error(`Unexpected fetch ${method} ${url}`);
        }
    });
    context.window.setTimeout = () => 1;
    context.window.clearTimeout = () => {};
    context.window.TaskUI = {
        escapeHtml: value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])),
        openActionMenu: (anchor, html) => {
            const rootNode = context.document.createElement('div');
            rootNode.innerHTML = html;
            context.document.body.appendChild(rootNode);
            return rootNode;
        }
    };
    context.window.getAuthHeaders = () => ({ 'Content-Type': 'application/json' });
    context.window.showNotification = () => {};

    vm.runInContext(fs.readFileSync(path.join(root, 'js', 'my-day-dependencies.js'), 'utf8'), context);
    const rootNode = await context.window.MyDayDependencies.openManager(context.document.getElementById('anchor'), { id: 10 }, async () => {});

    assert.match(rootNode.innerHTML, /Завантажую передумови/);
    assert.doesNotMatch(rootNode.innerHTML, /Передумов ще немає/);
    resolveDependencies();
    await new Promise(resolve => setImmediate(resolve));
    assert.match(rootNode.innerHTML, /Передумов ще немає/);
});

test('TaskUI reanchors submenu surfaces to stable task controls instead of detached menu buttons', async () => {
    const root = path.resolve(__dirname, '..');
    const dom = new JSDOM('<!doctype html><body><button id="stable">More</button></body>', {
        pretendToBeVisual: true,
        url: 'https://crm.test/profile.html'
    });
    const context = vm.createContext(dom.window);
    context.console = console;
    context.requestAnimationFrame = callback => {
        callback();
        return 1;
    };
    context.cancelAnimationFrame = () => {};
    dom.window.innerWidth = 1024;
    dom.window.innerHeight = 768;
    const stable = dom.window.document.getElementById('stable');
    stable.getBoundingClientRect = () => ({ top: 100, bottom: 124, left: 200, right: 240, width: 40, height: 24 });

    vm.runInContext(fs.readFileSync(path.join(root, 'js', 'task-ui.js'), 'utf8'), context);
    const firstRoot = context.window.TaskUI.openActionMenu(stable, '<button id="menuAction" type="button">Impacts</button>', { title: 'Menu' });
    const detachedAction = firstRoot.querySelector('#menuAction');
    context.window.TaskUI.openActionMenu(detachedAction, '<button type="button">Save</button>', { title: 'Impacts' });

    const panel = dom.window.document.querySelector('.task-ui-action-panel');
    assert.notEqual(panel.style.left, '50%');
    assert.equal(stable.getAttribute('aria-controls'), 'taskUiActionSurface');
    context.window.TaskUI.closeActionMenu();
    assert.equal(dom.window.document.activeElement, stable);
});

test('dependency manager disables mutation buttons during an in-flight request', async () => {
    const root = path.resolve(__dirname, '..');
    const dom = new JSDOM('<!doctype html><body><button id="anchor" data-task-id="10">Deps</button></body>', {
        pretendToBeVisual: true,
        url: 'https://crm.test/profile.html'
    });
    let postResolve;
    let postCalls = 0;
    const context = vm.createContext({
        console,
        window: dom.window,
        document: dom.window.document,
        fetch: async (url, options = {}) => {
            const method = String(options.method || 'GET').toUpperCase();
            if (String(url).includes('/api/tasks?mine=1') && String(url).includes('search=Candidate')) {
                return { ok: true, json: async () => ({ tasks: [{ id: 20, title: 'Candidate task' }] }) };
            }
            if (String(url).includes('/api/tasks/10/dependencies') && method === 'GET') {
                return { ok: true, json: async () => ({ dependencies: [] }) };
            }
            if (String(url).includes('/api/tasks/10/dependencies') && method === 'POST') {
                postCalls += 1;
                return new Promise(resolve => {
                    postResolve = () => resolve({ ok: true, json: async () => ({ success: true }) });
                });
            }
            throw new Error(`Unexpected fetch ${method} ${url}`);
        }
    });
    context.window.setTimeout = callback => {
        callback();
        return 1;
    };
    context.window.clearTimeout = () => {};
    context.window.TaskUI = {
        escapeHtml: value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])),
        openActionMenu: (anchor, html) => {
            const rootNode = context.document.createElement('div');
            rootNode.innerHTML = html;
            context.document.body.appendChild(rootNode);
            return rootNode;
        }
    };
    context.window.getAuthHeaders = () => ({ 'Content-Type': 'application/json' });
    context.window.showNotification = () => {};

    vm.runInContext(fs.readFileSync(path.join(root, 'js', 'my-day-dependencies.js'), 'utf8'), context);
    const rootNode = await context.window.MyDayDependencies.openManager(context.document.getElementById('anchor'), { id: 10 }, async () => {});
    await new Promise(resolve => setImmediate(resolve));
    const search = rootNode.querySelector('[data-dependency-search]');
    search.value = 'Candidate';
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await new Promise(resolve => setImmediate(resolve));
    const link = rootNode.querySelector('[data-dependency-link]');
    assert.ok(link, 'search should render a link button');

    link.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    link.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(postCalls, 1);
    assert.equal(rootNode.getAttribute('aria-busy'), 'true');
    assert.equal(link.disabled, true);
    postResolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(rootNode.getAttribute('aria-busy'), 'false');
});

test('dependency manager uses server search and ignores stale responses', async () => {
    const root = path.resolve(__dirname, '..');
    const dom = new JSDOM('<!doctype html><body><button id="anchor" data-task-id="10">Deps</button></body>', {
        pretendToBeVisual: true,
        url: 'https://crm.test/profile.html'
    });
    const pendingSearches = new Map();
    const context = vm.createContext({
        console,
        window: dom.window,
        document: dom.window.document,
        fetch: async (url, options = {}) => {
            const method = String(options.method || 'GET').toUpperCase();
            const text = String(url);
            if (text.includes('/api/tasks/10/dependencies') && method === 'GET') {
                return { ok: true, json: async () => ({ dependencies: [] }) };
            }
            if (text.includes('/api/tasks?mine=1')) {
                return new Promise(resolve => {
                    pendingSearches.set(decodeURIComponent(text), resolve);
                });
            }
            throw new Error(`Unexpected fetch ${method} ${url}`);
        }
    });
    context.window.setTimeout = callback => {
        callback();
        return 1;
    };
    context.window.clearTimeout = () => {};
    context.window.TaskUI = {
        escapeHtml: value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])),
        openActionMenu: (anchor, html) => {
            const rootNode = context.document.createElement('div');
            rootNode.innerHTML = html;
            context.document.body.appendChild(rootNode);
            return rootNode;
        }
    };
    context.window.getAuthHeaders = () => ({ 'Content-Type': 'application/json' });
    context.window.showNotification = () => {};

    vm.runInContext(fs.readFileSync(path.join(root, 'js', 'my-day-dependencies.js'), 'utf8'), context);
    const rootNode = await context.window.MyDayDependencies.openManager(context.document.getElementById('anchor'), { id: 10 }, async () => {});
    const search = rootNode.querySelector('[data-dependency-search]');

    search.value = 'Slow';
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    search.value = 'Latest';
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await new Promise(resolve => setImmediate(resolve));

    const latestKey = Array.from(pendingSearches.keys()).find(key => key.includes('search=Latest'));
    const slowKey = Array.from(pendingSearches.keys()).find(key => key.includes('search=Slow'));
    assert.ok(latestKey, 'latest search should be requested from server');
    assert.ok(slowKey, 'slow search should also be requested so stale behavior is covered');

    pendingSearches.get(latestKey)({ ok: true, json: async () => ({ tasks: [{ id: 21, title: 'Latest task' }] }) });
    await new Promise(resolve => setImmediate(resolve));
    assert.match(rootNode.innerHTML, /Latest task/);

    pendingSearches.get(slowKey)({ ok: true, json: async () => ({ tasks: [{ id: 22, title: 'Slow task' }] }) });
    await new Promise(resolve => setImmediate(resolve));
    assert.match(rootNode.innerHTML, /Latest task/);
    assert.doesNotMatch(rootNode.innerHTML, /Slow task/);
});
