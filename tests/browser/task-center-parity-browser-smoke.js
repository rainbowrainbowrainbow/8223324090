#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { buildCapabilitySnapshot } = require('../../services/accountAccessPolicy');

const ROOT = path.resolve(__dirname, '..', '..');
const HEADLESS = process.env.TASK_CENTER_BROWSER_SMOKE_HEADLESS !== 'false';
const MIME = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2'
};

const USER = {
    id: 901,
    username: 'task.center.qa',
    name: 'Task Center QA',
    role: 'creator',
    businessContexts: ['event_genix'],
    business_contexts: ['event_genix'],
    defaultBusinessContext: 'event_genix',
    default_business_context: 'event_genix',
    pageAllowlist: ['/tasks'],
    page_allowlist: ['/tasks'],
    actionAllowlist: [],
    action_allowlist: []
};

const AUTH_PERMISSIONS = (() => {
    const snapshot = buildCapabilitySnapshot(USER);
    return {
        role: USER.role,
        roles: [USER.role],
        pageAllowlist: ['/tasks'],
        actionAllowlist: [],
        actionDenylist: [],
        pages: snapshot.pages,
        actions: snapshot.actions,
        capabilities: snapshot.decisions,
        capabilityCatalog: snapshot.catalog
    };
})();

const BUSINESS_PROFILE = {
    activeBusinessId: 'event_genix',
    activeBusinessContext: 'event_genix',
    scope: { mode: 'single', activeContext: 'event_genix', selectedContexts: ['event_genix'], readOnly: false },
    businesses: [{
        key: 'event_genix',
        id: 'event_genix',
        businessContext: 'event_genix',
        modules: { enabled: { tasks: true } }
    }]
};

const TASK_PERMISSIONS = {
    success: true,
    role: 'creator',
    permissions: {
        canCreateTasks: false,
        canDeleteTasks: false,
        canAssignAnyone: false,
        canEditOwnTasks: true,
        canEditAllTasks: false,
        taskVisibility: 'own'
    },
    capabilities: {
        create: { allowed: false, reasonCode: 'TASK_CREATE_FORBIDDEN' },
        delete: { allowed: false, reasonCode: 'TASK_DELETE_FORBIDDEN' },
        review: { allowed: false, reasonCode: 'TASK_REVIEW_FORBIDDEN' }
    }
};

const DRAWER_ACTIONS = {
    view: true,
    edit: false,
    save: false,
    complete: false,
    reassign: false,
    reschedule: false,
    manageObservers: false,
    manageSubtasks: false,
    review: false,
    delete: false,
    readHistory: true,
    openSource: true
};

const DRAWER_REASONS = {
    edit: 'TASK_MUTATION_FORBIDDEN',
    save: 'TASK_MUTATION_FORBIDDEN',
    complete: 'TASK_MUTATION_FORBIDDEN',
    reassign: 'TASK_REASSIGN_FORBIDDEN',
    reschedule: 'TASK_RESCHEDULE_FORBIDDEN',
    manageObservers: 'TASK_OBSERVERS_FORBIDDEN',
    manageSubtasks: 'TASK_MUTATION_FORBIDDEN',
    review: 'TASK_REVIEW_FORBIDDEN',
    delete: 'TASK_DELETE_FORBIDDEN'
};

const TASK = {
    id: 42,
    version: 3,
    title: 'QA permission boundary task',
    description: 'Read-only local fixture task',
    expectedResult: 'Parity is verified without mutations',
    status: 'todo',
    workflowState: 'blocked',
    priority: 'urgent',
    taskMode: 'work',
    taskKind: 'action',
    visibility: 'team',
    category: 'admin',
    date: '2026-07-30',
    deadline: '2026-07-30T10:00:00.000Z',
    ownerUserId: USER.id,
    ownerLabel: USER.name,
    owner_name: USER.name,
    assigned_to: USER.name,
    creatorUserId: 902,
    creatorName: 'Fixture Manager',
    businessContext: 'event_genix',
    effortMinutes: 60,
    subtasks: [],
    observers: [],
    dependencies: [],
    sourceType: 'lead',
    sourceId: 'LEAD-QA-42',
    drawer: {
        contract: 'task_drawer_v1',
        actions: DRAWER_ACTIONS,
        actionReasons: DRAWER_REASONS,
        source: {
            type: 'lead',
            label: 'Lead',
            id: 'LEAD-QA-42',
            module: 'sales',
            surface: 'task_center_smoke',
            href: '/sales-funnel?open=LEAD-QA-42'
        },
        completion: { reportRequired: true, reportId: null }
    }
};

function dateRange() {
    const from = new Date();
    const key = date => date.toISOString().slice(0, 10);
    const first = key(from);
    from.setUTCDate(from.getUTCDate() + 1);
    return [first, key(from)];
}

function overviewPayload({ empty = false, partial = false } = {}) {
    const queue = empty ? [] : [{
        task: TASK,
        reasons: [
            { code: 'overdue', label: 'Overdue', riskDays: 1 },
            { code: 'blocked', label: 'Blocked', riskDays: 1 }
        ],
        recommendedAction: 'Open details and resolve the blocker'
    }];
    return {
        success: true,
        counts: {
            overdue: empty ? 0 : 1,
            urgent: empty ? 0 : 1,
            blocked: empty ? 0 : 1,
            unassigned: 0,
            stale: 0,
            due_today: 0
        },
        queue,
        meta: {
            activeTotal: empty ? 0 : 1,
            exceptionTotal: partial ? 3 : queue.length,
            returned: queue.length,
            hasMore: partial,
            partial,
            paginationIndependent: true
        }
    };
}

function teamPayload() {
    const dates = dateRange();
    const day = (date, scheduledTasks = []) => ({
        date,
        capacity: { status: 'unavailable', minutes: null },
        scheduledEffortMinutes: scheduledTasks.length ? 60 : 0,
        overloadMinutes: scheduledTasks.length ? 30 : 0,
        scheduledTasks
    });
    const metrics = {
        active: 1,
        overdue: 1,
        urgent: 1,
        blocked: 1,
        dueSoon: 1,
        noDate: 0,
        knownEffortMinutes: 60,
        unknownEffortTasks: 0,
        scheduledEffortMinutes: 60,
        unscheduledTasks: 1
    };
    return {
        success: true,
        dates,
        owners: [{
            ownerUserId: USER.id,
            ownerLabel: USER.name,
            department: null,
            metrics,
            overloadDays: 0,
            tasks: [{ task: TASK, facts: { effortMinutes: 60 }, exceptions: ['overdue', 'blocked'] }],
            days: [day(dates[0], [{ task: TASK, facts: { effortMinutes: 60 } }]), day(dates[1])]
        }],
        unscheduled: [{ task: TASK, ownerLabel: USER.name, facts: { effortMinutes: 60 } }],
        meta: {
            from: dates[0],
            to: dates[1],
            capacityAvailable: false,
            paginationIndependent: true
        }
    };
}

function requirePlaywright() {
    try {
        return require('playwright');
    } catch (error) {
        for (const entry of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
            const normalized = entry.replace(/[\\/]+$/, '');
            if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
            const packageDir = path.join(path.dirname(normalized), 'playwright');
            if (fs.existsSync(packageDir)) return require(packageDir);
        }
        throw error;
    }
}

function staticFilePath(requestUrl) {
    const url = new URL(requestUrl, 'http://fixture');
    let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    if (relative === 'tasks') relative = 'tasks.html';
    const file = path.resolve(ROOT, relative);
    return file.startsWith(`${ROOT}${path.sep}`) ? file : null;
}

function createStaticServer() {
    const server = http.createServer((req, res) => {
        const file = staticFilePath(req.url || '/');
        if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            res.writeHead(file ? 404 : 403);
            res.end();
            return;
        }
        res.writeHead(200, {
            'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'cache-control': 'no-store'
        });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve({
            server,
            baseUrl: `http://127.0.0.1:${server.address().port}`
        }));
    });
}

function json(route, payload, status = 200) {
    return route.fulfill({
        status,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(payload)
    });
}

async function installFixtureRoutes(context, baseUrl, state) {
    await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== baseUrl) return route.abort('blockedbyclient');
        if (url.pathname === '/' && request.isNavigationRequest()) {
            state.rootNavigations.push(request.url());
            return route.abort('blockedbyclient');
        }
        const method = request.method();
        if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
            state.mutations.push(`${method} ${url.pathname}${url.search}`);
            return route.abort('blockedbyclient');
        }
        if (!url.pathname.startsWith('/api/')) return route.continue();
        state.requests.push(`${method} ${url.pathname}${url.search}`);
        if (url.pathname === '/api/auth/verify') return json(route, { user: USER });
        if (url.pathname === '/api/auth/permissions') return json(route, AUTH_PERMISSIONS);
        if (url.pathname === '/api/business/profile') return json(route, { businessProfile: BUSINESS_PROFILE });
        if (url.pathname === '/api/tasks/owners') return json(route, { success: true, users: [{ id: USER.id, name: USER.name, label: USER.name, role: USER.role }] });
        if (url.pathname === '/api/tasks/permissions') return json(route, TASK_PERMISSIONS);
        if (url.pathname === '/api/tasks/preferences') return json(route, {
            success: true,
            preferences: {
                savedTaskViewsRevision: 4,
                savedTaskViews: [{
                    id: 'qa-overview',
                    name: 'QA Overview',
                    state: { mode: 'overview', queue: 'inbox', ownerUserId: '', dateFrom: '', dateTo: '', status: [], priority: ['urgent'], category: '', source: '', search: '' }
                }]
            }
        });
        if (url.pathname === '/api/tasks/decomposition-saved-templates') return json(route, { success: true, templates: [] });
        if (url.pathname === '/api/tasks/overview') {
            if (state.overview === 'loading') await new Promise(resolve => setTimeout(resolve, 500));
            if (state.overview === 'error') return json(route, { success: false, error: 'fixture error' }, 500);
            if (state.overview === 'empty') return json(route, overviewPayload({ empty: true }));
            return json(route, overviewPayload({ partial: state.overview === 'partial' }));
        }
        if (url.pathname === '/api/tasks/team-control') return json(route, teamPayload());
        if (url.pathname === '/api/tasks/42/history') return json(route, { success: true, history: [] });
        if (url.pathname === '/api/tasks/42/observers') return json(route, { success: true, observers: [] });
        if (url.pathname === '/api/tasks/42/subtasks') return json(route, { success: true, subtasks: [] });
        if (url.pathname === '/api/tasks/42') return json(route, { success: true, task: TASK });
        if (url.pathname === '/api/task-templates') return json(route, []);
        if (url.pathname === '/api/dashboard/alerts') return json(route, { alerts: [] });
        if (url.pathname === '/api/tasks') return json(route, {
            success: true,
            tasks: [TASK],
            pagination: { page: 1, limit: 100, total: 1, hasMore: false, nextPage: null }
        });
        return json(route, { success: true });
    });
}

async function waitForMode(page, mode) {
    await page.waitForFunction(expected => {
        const shell = document.getElementById('taskCenterShell');
        const tab = document.querySelector(`.task-center-mode-tab[data-task-mode="${expected}"]`);
        return shell?.dataset.taskMode === expected && tab?.getAttribute('aria-selected') === 'true';
    }, mode);
}

async function openPage(page, baseUrl, query = '') {
    await page.goto(`${baseUrl}/tasks${query}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('#taskCenterQueryControls') && !document.querySelector('.page-fatal-error'));
}

async function assertNoHorizontalOverflow(page, label) {
    const result = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        viewport: window.innerWidth,
        protruding: [...document.body.querySelectorAll('*')].map(el => {
            const rect = el.getBoundingClientRect();
            const parent = el.parentElement ? getComputedStyle(el.parentElement) : null;
            return {
                tag: el.tagName.toLowerCase(),
                id: el.id || '',
                classes: String(el.className || '').slice(0, 120),
                left: Math.round(rect.left),
                right: Math.round(rect.right),
                width: Math.round(rect.width),
                parentOverflowX: parent?.overflowX || '',
                insideSidebar: Boolean(el.closest('#sidebarNav'))
            };
        }).filter(item => (
            item.width > window.innerWidth
            || item.right > window.innerWidth + 1
            || item.left < -1
        ) && !['auto', 'scroll'].includes(item.parentOverflowX)
            && !(item.insideSidebar && item.left < -1 && item.right <= window.innerWidth + 1))
            .sort((a, b) => (b.right - window.innerWidth) - (a.right - window.innerWidth))
            .slice(0, 8)
    }));
    assert.ok(result.scrollWidth <= result.clientWidth + 1, `${label}: document has no horizontal overflow (${JSON.stringify(result)})`);
    assert.ok(result.bodyWidth <= result.viewport + 1, `${label}: body has no horizontal overflow (${JSON.stringify(result)})`);
    assert.deepEqual(result.protruding, [], `${label}: no non-scroll-container element protrudes outside viewport`);
}

function parseCssRgb(value) {
    const match = String(value || '').match(/rgba?\(([^)]+)\)/i);
    if (!match) return null;
    const [r, g, b] = match[1].split(',').slice(0, 3).map(item => Number.parseFloat(item.trim()));
    return [r, g, b].every(Number.isFinite) ? { r, g, b } : null;
}

function srgbChannel(value) {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color) {
    return (0.2126 * srgbChannel(color.r)) + (0.7152 * srgbChannel(color.g)) + (0.0722 * srgbChannel(color.b));
}

function contrastRatio(foreground, background) {
    const light = Math.max(relativeLuminance(foreground), relativeLuminance(background));
    const dark = Math.min(relativeLuminance(foreground), relativeLuminance(background));
    return (light + 0.05) / (dark + 0.05);
}

async function collectTaskCenterQueryControlStyles(page) {
    return page.evaluate(() => {
        const controlSelector = '.task-center-query-row input, .task-center-query-row select, .task-center-saved-views-row select';
        return [...document.querySelectorAll(controlSelector)].map((el, index) => {
            const style = getComputedStyle(el);
            const placeholder = el.matches('input')
                ? getComputedStyle(el, '::placeholder')
                : null;
            return {
                index,
                tag: el.tagName.toLowerCase(),
                type: el.getAttribute('type') || '',
                queryKey: el.getAttribute('data-task-center-query') || '',
                savedView: el.hasAttribute('data-task-saved-view'),
                backgroundColor: style.backgroundColor,
                color: style.color,
                borderColor: style.borderColor,
                placeholderColor: placeholder?.color || null,
                colorScheme: style.colorScheme
            };
        });
    });
}

function assertDarkTaskCenterControls(styles, label) {
    const nonDateControls = styles.filter(item => item.type !== 'date');
    const dateControls = styles.filter(item => item.type === 'date');
    assert.equal(nonDateControls.length, 7, `${label}: seven non-date query/saved-view controls are present`);
    assert.equal(dateControls.length, 2, `${label}: date controls remain present`);

    for (const item of styles) {
        const background = parseCssRgb(item.backgroundColor);
        const foreground = parseCssRgb(item.color);
        assert.ok(background, `${label}: ${item.queryKey || item.type || 'saved-view'} background is parseable (${item.backgroundColor})`);
        assert.ok(foreground, `${label}: ${item.queryKey || item.type || 'saved-view'} text color is parseable (${item.color})`);
        assert.ok(Math.max(background.r, background.g, background.b) < 80, `${label}: ${item.queryKey || item.type || 'saved-view'} is dark, not white (${item.backgroundColor})`);
        assert.ok(contrastRatio(foreground, background) >= 4.5, `${label}: ${item.queryKey || item.type || 'saved-view'} text contrast is readable`);
        assert.match(item.colorScheme, /dark/, `${label}: ${item.queryKey || item.type || 'saved-view'} advertises dark color-scheme`);
        if (item.placeholderColor) {
            const placeholder = parseCssRgb(item.placeholderColor);
            assert.ok(placeholder, `${label}: placeholder color is parseable (${item.placeholderColor})`);
            assert.ok(contrastRatio(placeholder, background) >= 4.5, `${label}: search placeholder contrast is readable`);
        }
    }
}

async function assertTaskCenterQueryThemeContract(page, label) {
    const styles = await collectTaskCenterQueryControlStyles(page);
    assertDarkTaskCenterControls(styles, label);

    const focusStyle = await page.locator('[data-task-center-query="search"]').evaluate(el => {
        el.focus();
        const style = getComputedStyle(el);
        return {
            outlineStyle: style.outlineStyle,
            outlineWidth: style.outlineWidth,
            borderColor: style.borderColor,
            boxShadow: style.boxShadow
        };
    });
    assert.notEqual(focusStyle.outlineStyle, 'none', `${label}: search focus outline is visible`);
    assert.notEqual(focusStyle.outlineWidth, '0px', `${label}: search focus outline has width`);
    assert.notEqual(focusStyle.boxShadow, 'none', `${label}: search focus ring uses box-shadow`);

    const disabledStyle = await page.locator('[data-task-saved-view]').evaluate(async el => {
        el.disabled = true;
        await new Promise(resolve => requestAnimationFrame(resolve));
        const style = getComputedStyle(el);
        const result = {
            backgroundColor: style.backgroundColor,
            color: style.color,
            borderColor: style.borderColor,
            cursor: style.cursor,
            matchesDisabled: el.matches(':disabled')
        };
        el.disabled = false;
        return result;
    });
    const disabledBackground = parseCssRgb(disabledStyle.backgroundColor);
    const disabledText = parseCssRgb(disabledStyle.color);
    const disabledBorder = parseCssRgb(disabledStyle.borderColor);
    assert.equal(disabledStyle.matchesDisabled, true, `${label}: saved view test control enters disabled state`);
    assert.ok(disabledBackground && Math.max(disabledBackground.r, disabledBackground.g, disabledBackground.b) < 90, `${label}: disabled saved view remains dark`);
    assert.ok(disabledText && contrastRatio(disabledText, disabledBackground) >= 3, `${label}: disabled saved view remains legible`);
    assert.ok(disabledBorder && Math.max(disabledBorder.r, disabledBorder.g, disabledBorder.b) < 245, `${label}: disabled saved view border is not a white fallback`);
    assert.equal(disabledStyle.cursor, 'not-allowed', `${label}: disabled saved view communicates non-interactive state`);
}

async function collectDarkTaskCenterSurfaceStyles(page, specs) {
    return page.evaluate(input => {
        function visible(el) {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        }
        return input.flatMap(spec => {
            const nodes = [...document.querySelectorAll(spec.selector)].filter(visible);
            return nodes.map((el, index) => {
                const style = getComputedStyle(el);
                const bgEl = spec.background === 'parent'
                    ? el.parentElement
                    : (spec.background ? el.closest(spec.background) : el);
                const bgStyle = getComputedStyle(bgEl || el);
                return {
                    label: spec.label,
                    index,
                    text: (el.innerText || el.textContent || '').trim().slice(0, 80),
                    backgroundColor: bgStyle.backgroundColor,
                    color: style.color,
                    borderColor: style.borderColor,
                    outlineStyle: style.outlineStyle,
                    outlineWidth: style.outlineWidth,
                    boxShadow: style.boxShadow
                };
            });
        });
    }, specs);
}

function assertDarkTaskCenterSurfaceStyles(styles, label) {
    assert.ok(styles.length > 0, `${label}: collected dark operational surfaces`);
    for (const item of styles) {
        const background = parseCssRgb(item.backgroundColor);
        const foreground = parseCssRgb(item.color);
        assert.ok(background, `${label}: ${item.label} background is parseable (${item.backgroundColor})`);
        assert.ok(foreground, `${label}: ${item.label} text color is parseable (${item.color})`);
        assert.ok(Math.min(background.r, background.g, background.b) < 235, `${label}: ${item.label} is not a white surface (${item.backgroundColor})`);
        assert.ok(contrastRatio(foreground, background) >= 4.5, `${label}: ${item.label} text contrast is readable (${item.backgroundColor} / ${item.color})`);
    }
}

async function assertTaskCenterOperationalDarkSurfaces(page, baseUrl) {
    await openPage(page, baseUrl, '?mode=overview');
    await waitForMode(page, 'overview');
    await page.waitForSelector('.task-overview-queue');
    assertDarkTaskCenterSurfaceStyles(await collectDarkTaskCenterSurfaceStyles(page, [
        { label: 'overview count chip', selector: '.task-overview-count' },
        { label: 'overview reason chip', selector: '.task-overview-reason' },
        { label: 'overview action pill', selector: '.task-overview-action' }
    ]), 'overview');

    await page.locator('.task-center-mode-tab[data-task-mode="team"]').click();
    await waitForMode(page, 'team');
    await page.waitForSelector('.task-team-owner-card');
    assertDarkTaskCenterSurfaceStyles(await collectDarkTaskCenterSurfaceStyles(page, [
        { label: 'team owner secondary text', selector: '.task-team-owner-card p', background: '.task-team-owner-card' },
        { label: 'team capacity text', selector: '.task-team-capacity', background: '.task-team-owner-card' },
        { label: 'team metric pill', selector: '.task-team-metric' },
        { label: 'team metric value', selector: '.task-team-metric strong', background: '.task-team-metric' }
    ]), 'team');

    await page.locator('.task-center-mode-tab[data-task-mode="planning"]').click();
    await waitForMode(page, 'planning');
    await page.waitForSelector('.task-planning-table');
    assertDarkTaskCenterSurfaceStyles(await collectDarkTaskCenterSurfaceStyles(page, [
        { label: 'planning table cell', selector: '.task-planning-table td' },
        { label: 'planning table small text', selector: '.task-planning-table td > small', background: 'td' },
        { label: 'planning table effort text', selector: '.task-planning-table td > strong', background: 'td' },
        { label: 'planning overload cell', selector: '.task-planning-table td.is-overload' },
        { label: 'planning overload text', selector: '.task-planning-table td.is-overload b', background: 'td.is-overload' },
        { label: 'planning task button', selector: '.task-planning-day-tasks button' },
        { label: 'planning unscheduled secondary text', selector: '.task-planning-unscheduled small', background: '.task-planning-unscheduled' }
    ]), 'planning');

    const planningButtonFocus = await page.locator('.task-planning-day-tasks button').first().evaluate(el => {
        el.focus();
        const style = getComputedStyle(el);
        return {
            outlineStyle: style.outlineStyle,
            outlineWidth: style.outlineWidth,
            boxShadow: style.boxShadow
        };
    });
    assert.notEqual(planningButtonFocus.outlineStyle, 'none', `planning: task button focus outline is visible (${JSON.stringify(planningButtonFocus)})`);
    assert.notEqual(planningButtonFocus.outlineWidth, '0px', `planning: task button focus outline has width (${JSON.stringify(planningButtonFocus)})`);

    await openPage(page, baseUrl, '?mode=overview');
    await waitForMode(page, 'overview');
}

async function assertTaskCenterLightThemeUnchanged(page) {
    const styles = await collectTaskCenterQueryControlStyles(page);
    assert.equal(styles.filter(item => item.type !== 'date').length, 7, 'light theme still renders seven non-date query/saved-view controls');
    for (const item of styles.filter(entry => entry.type !== 'date')) {
        const background = parseCssRgb(item.backgroundColor);
        assert.ok(background, `light theme ${item.queryKey || 'saved-view'} background is parseable (${item.backgroundColor})`);
        assert.ok(Math.min(background.r, background.g, background.b) >= 245, `light theme ${item.queryKey || 'saved-view'} keeps the existing white control background`);
    }
}

async function verifyModesAndUrl(page, baseUrl) {
    await openPage(page, baseUrl, '?mode=overview&queue=inbox&owner=901&from=2026-07-01&to=2026-07-31&status=todo&priority=urgent&category=admin&source=lead&search=fixture');
    await waitForMode(page, 'overview');
    await page.waitForSelector('.task-overview-queue', { timeout: 8000 });
    const canonical = new URL(page.url());
    assert.equal(canonical.searchParams.get('owner'), '901');
    assert.equal(canonical.searchParams.get('priority'), 'urgent');
    assert.equal(canonical.searchParams.get('source'), 'lead');
    assert.equal(canonical.searchParams.get('search'), 'fixture');
    assert.equal(await page.locator('[data-task-saved-view] option').count(), 2, 'saved view control contains server-backed fixture view');
    assert.equal(await page.locator('#taskCreatePermissionNotice').isVisible(), true, 'create permission reason is visible');
    assert.match(await page.locator('#taskCreatePermissionNotice').textContent(), /\S/, 'create permission reason is non-empty');

    for (const mode of ['team', 'planning', 'library', 'overview']) {
        await page.locator(`.task-center-mode-tab[data-task-mode="${mode}"]`).click();
        await waitForMode(page, mode);
        assert.equal(new URL(page.url()).searchParams.get('mode'), mode, `${mode} is reflected in URL`);
        if (mode === 'team') await page.waitForSelector('.task-team-owner-card');
        if (mode === 'planning') await page.waitForSelector('.task-planning-table');
        if (mode === 'library') assert.equal(await page.locator('#templatesSection').isVisible(), true, 'library renders template surface');
        if (mode === 'overview') await page.waitForSelector('.task-overview');
    }

    const firstTab = page.locator('.task-center-mode-tab').first();
    await firstTab.focus();
    await page.keyboard.press('ArrowRight');
    await waitForMode(page, 'team');
    assert.equal(await page.locator('.task-center-mode-tab[data-task-mode="team"]').evaluate(el => el === document.activeElement), true, 'ArrowRight moves focus and selection');
    await page.keyboard.press('End');
    await waitForMode(page, 'library');
    assert.equal(await page.locator('.task-center-mode-tab[data-task-mode="library"]').evaluate(el => el === document.activeElement), true, 'End moves focus and selection');

    const aria = await page.evaluate(() => ({
        tablist: document.querySelector('.task-center-mode-tabs')?.getAttribute('role'),
        tabs: [...document.querySelectorAll('.task-center-mode-tab')].map(tab => ({ role: tab.getAttribute('role'), selected: tab.getAttribute('aria-selected') }))
    }));
    assert.equal(aria.tablist, 'tablist');
    assert.equal(aria.tabs.length, 4);
    assert.equal(aria.tabs.filter(tab => tab.selected === 'true').length, 1);
    assert.ok(aria.tabs.every(tab => tab.role === 'tab'));
}

async function verifyLegacyLinks(page, baseUrl) {
    const mappings = [
        ['?view=today', 'overview'],
        ['?view=team', 'team'],
        ['?view=board', 'planning'],
        ['?view=templates', 'library'],
        ['?view=archive', 'library']
    ];
    for (const [query, mode] of mappings) {
        await openPage(page, baseUrl, query);
        await waitForMode(page, mode);
    }
}

async function verifyDrawer(page, baseUrl) {
    await openPage(page, baseUrl, '?mode=overview&open=42');
    await page.waitForSelector('#taskDetailOverlay');
    assert.equal(new URL(page.url()).searchParams.get('open'), '42');
    assert.equal(await page.locator('#taskDetailOverlay').getAttribute('data-task-version'), '3');
    const disabledControls = await page.locator('#taskDetailOverlay [disabled][aria-disabled="true"]').count();
    assert.ok(disabledControls >= 3, `drawer exposes permission-disabled controls (${disabledControls})`);
    const permissionHint = page.locator('#taskDetailPermissionHint');
    assert.equal(await permissionHint.isVisible(), true, 'drawer permission explanation is visible');
    assert.match(await permissionHint.textContent(), /\S/, 'drawer permission explanation is non-empty');
    assert.equal(await page.locator('.task-detail-source-card').isVisible(), true, 'drawer shows CRM source');
}

async function verifyStates(page, baseUrl, state) {
    state.overview = 'loading';
    const navigation = page.goto(`${baseUrl}/tasks?mode=overview`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.loading-spinner');
    await navigation;
    await page.waitForSelector('.task-overview');

    state.overview = 'empty';
    await openPage(page, baseUrl, '?mode=overview');
    await page.waitForSelector('.task-overview');
    assert.equal(await page.locator('.task-overview-queue').count(), 0, 'empty overview has no exception queue');

    state.overview = 'partial';
    await openPage(page, baseUrl, '?mode=overview');
    await page.waitForSelector('.task-overview-more');

    state.overview = 'error';
    await openPage(page, baseUrl, '?mode=overview');
    await page.waitForSelector('.page-fatal-error[role=alert]');
    assert.equal(await page.locator('.page-fatal-error[role=alert]').isVisible(), true, 'initial overview error renders an accessible fatal state');
    state.overview = 'normal';
}

async function verifyResponsiveThemesAndMotion(page, baseUrl) {
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    await page.evaluate(() => localStorage.setItem('pzp_dark_mode', 'true'));
    await openPage(page, baseUrl, '?mode=overview');
    await page.evaluate(() => {
        document.body.classList.add('shell-ready');
        document.body.setAttribute('data-page-group', 'crm');
        document.getElementById('sidebarNav')?.classList.add('collapsed');
    });
    assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true, 'reduced motion preference reaches page');
    assert.equal(await page.locator('body').evaluate(body => body.classList.contains('dark-mode')), true, 'dark mode is applied');
    await assertTaskCenterQueryThemeContract(page, 'body.dark-mode');
    await assertTaskCenterOperationalDarkSurfaces(page, baseUrl);
    await page.evaluate(() => {
        document.body.classList.remove('dark-mode');
        document.documentElement.setAttribute('data-theme', 'dark');
    });
    await assertTaskCenterQueryThemeContract(page, 'html[data-theme="dark"]');
    await page.evaluate(() => {
        document.documentElement.removeAttribute('data-theme');
        document.body.classList.add('dark-mode');
    });

    await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'dark' });
    const viewports = [
        { width: 320, height: 700 },
        { width: 360, height: 760 },
        { width: 390, height: 844 },
        { width: 768, height: 900 },
        { width: 1440, height: 900 }
    ];
    for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await page.waitForTimeout(75);
        await assertNoHorizontalOverflow(page, `${viewport.width}x${viewport.height}`);
    }

    await page.evaluate(() => localStorage.setItem('pzp_dark_mode', 'false'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.task-overview');
    assert.equal(await page.locator('body').evaluate(body => body.classList.contains('dark-mode')), false, 'light mode is applied');
    await assertTaskCenterLightThemeUnchanged(page);
    await page.locator('.task-center-mode-tab').first().focus();
    const focusStyle = await page.locator('.task-center-mode-tab').first().evaluate(el => {
        const style = getComputedStyle(el);
        return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
    });
    assert.notEqual(focusStyle.outlineStyle, 'none', `keyboard focus is visible (${JSON.stringify(focusStyle)})`);
}

async function run() {
    const { chromium } = requirePlaywright();
    const fixture = await createStaticServer();
    const browser = await chromium.launch({ headless: HEADLESS });
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
    const state = { overview: 'normal', requests: [], mutations: [], rootNavigations: [] };
    const pageErrors = [];
    await context.addInitScript(user => {
        localStorage.setItem('pzp_token', 'task-center-read-only-fixture');
        localStorage.setItem('pzp_current_user', JSON.stringify(user));
        if (localStorage.getItem('pzp_dark_mode') === null) localStorage.setItem('pzp_dark_mode', 'false');
        localStorage.setItem('pzp_sidebar_collapsed', 'true');
    }, { ...USER, permissions: AUTH_PERMISSIONS });
    await installFixtureRoutes(context, fixture.baseUrl, state);
    const page = await context.newPage();
    page.setDefaultTimeout(25000);
    page.on('pageerror', error => pageErrors.push(error.message));
    try {
        await verifyModesAndUrl(page, fixture.baseUrl);
        await verifyLegacyLinks(page, fixture.baseUrl);
        await verifyDrawer(page, fixture.baseUrl);
        await verifyStates(page, fixture.baseUrl, state);
        await verifyResponsiveThemesAndMotion(page, fixture.baseUrl);
        assert.ok(state.requests.some(item => item.includes('/api/tasks/overview')), 'overview uses mocked API');
        assert.ok(state.requests.some(item => item.includes('/api/tasks/team-control')), 'team/planning use mocked API');
        assert.deepEqual(state.mutations, [], 'browser issued no task or preference mutations');
        assert.deepEqual(state.rootNavigations, [], 'authenticated Task Center never redirects to the root page');
        assert.deepEqual(pageErrors, [], `browser runtime has no uncaught errors: ${pageErrors.join('; ')}`);
        console.log('Task Center parity browser smoke passed');
    } catch (error) {
        const boardHtml = await page.locator('#boardContent').innerHTML().catch(() => 'board unavailable');
        const accessState = await page.evaluate(() => ({
            path: location.pathname,
            canAccessTasks: typeof canAccessPage === 'function' ? canAccessPage('/tasks') : null,
            currentUserRole: window.AppState?.currentUser?.role || null,
            taskPageDecision: window.AppState?.authPermissions?.capabilities?.['page:/tasks'] || null
        })).catch(() => null);
        console.error('Task Center parity diagnostics: url=' + page.url() + ' overview=' + state.overview);
        console.error('Task Center parity API requests: ' + state.requests.slice(-80).join(' | '));
        console.error('Task Center parity access: ' + JSON.stringify(accessState));
        console.error('Task Center parity board: ' + boardHtml.slice(0, 2000));
        throw error;
    } finally {
        await page.close().catch(() => {});
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
        await new Promise(resolve => fixture.server.close(resolve));
    }
}

run().catch(error => {
    console.error(`Task Center parity browser smoke failed: ${error.stack || error.message}`);
    process.exitCode = 1;
});
