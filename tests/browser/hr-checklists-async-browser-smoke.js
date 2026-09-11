'use strict';

// Controlled browser audit of existing UI handlers. All requests are intercepted locally.
// npm exec --offline --package=playwright -c "node tests/browser/hr-checklists-async-browser-smoke.js"
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');
const browserOption = process.argv.indexOf('--browser');
const browserName = browserOption < 0 ? 'chromium' : process.argv[browserOption + 1];
assert.ok(['chromium', 'firefox', 'webkit'].includes(browserName), 'Use chromium, firefox or webkit');
const OUT = path.join(ROOT, 'output/hr-checklists-quality', browserName === 'chromium' ? 'async' : `async-${browserName}`);
const VERIFY_LOCAL_FIXES = process.argv.includes('--verify-local-fixes');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
function requirePlaywright() {
    try { return require('playwright'); } catch (error) {
        for (const entry of String(process.env.PATH || '').split(path.delimiter)) {
            if (!/node_modules[\\/]\.bin[\\/]?$/i.test(entry)) continue;
            const candidate = path.join(path.dirname(entry), 'playwright');
            if (fs.existsSync(candidate)) return require(candidate);
        }
        throw error;
    }
}
const source = read('hr.html');
const styles = [...source.matchAll(/href="(css\/[^?" ]+)/g)].map(match => `<link rel="stylesheet" href="/${match[1]}">`).join('');
const html = source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '').replace('</head>', `${styles}</head>`);
const authSource = read('js/auth.js');
const themeStart = authSource.indexOf('function isCrmDarkThemeActive()');
const themeEnd = authSource.indexOf('function initHeaderThemeToggle()', themeStart);

async function install(page, dark, { userId = 9901, reload = false, storageBlocked = false } = {}) {
    await page.unroute('**/*');
    await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.href === 'http://127.0.0.1:47849/hr') return route.fulfill({ contentType: 'text/html', body: html });
        if (url.origin === 'http://127.0.0.1:47849' && /^\/css\/[a-z0-9-]+\.css$/i.test(url.pathname)) return route.fulfill({ contentType: 'text/css', body: read(url.pathname.slice(1)) });
        return route.abort();
    });
    if (reload) await page.reload();
    else await page.goto('http://127.0.0.1:47849/hr');
    await page.evaluate(({ userId, storageBlocked }) => {
        if (storageBlocked) {
            Storage.prototype.getItem = Storage.prototype.setItem = Storage.prototype.removeItem = () => { throw new DOMException('QA blocked storage', 'SecurityError'); };
        }
        window.AppState = { currentUser: { id: userId, role: 'creator', name: 'QA Synthetic' } };
        window.canAccess = () => true;
        window.resolveCapability = () => ({ allowed: true });
    }, { userId, storageBlocked });
    await page.addScriptTag({ content: read('js/ui.js') });
    await page.addScriptTag({ content: authSource.slice(themeStart, themeEnd) });
    await page.addScriptTag({ content: read('js/hr-pulse-switcher.js') });
    await page.addScriptTag({ content: read('js/hr-page.js') });
    await page.evaluate(dark => {
        window.qa = { writes: [], requests: [], pending: null, hold: false, fail: false };
        qa.professions = ['qa_a', 'qa_b'].map((key, index) => ({ id: 9901 + index, key, title: `QA Profession ${key}`, department: 'QA', source: 'db', responsibilities: [] }));
        qa.items = Object.fromEntries(qa.professions.map(({ key }) => [key, [1, 2].map(index => ({ itemKey: `${key}_${index}`, title: `${key} Item ${index}`, isActive: true }))]));
        qa.template = key => ({ professionKey: key, source: 'hr_profession_checklist_items', items: structuredClone(qa.items[key]), activeItems: structuredClone(qa.items[key].filter(item => item.isActive)), archivedItems: structuredClone(qa.items[key].filter(item => !item.isActive)) });
        hrProfessions = structuredClone(qa.professions);
        professionCatalogLoadState = 'ready';
        hrFetch = async (request, options = {}) => {
            qa.requests.push({ request, method: options.method || 'GET' });
            if (request === '/professions') return { success: true, data: structuredClone(qa.professions) };
            if (request.startsWith('/checklists/dashboard')) {
                if (qa.count === undefined) return { success: true, data: { summary: {}, assignments: [], professionsWithoutTemplate: qa.professions.map(p => ({ professionKey: p.key, professionTitle: p.title, department: p.department, status: 'without_template' })), archived: [], orphaned: [] } };
                const query = new URLSearchParams(request.split('?')[1]);
                const offset = Number(query.get('offset')) || 0;
                if (qa.dashboardCounts?.length) qa.count = qa.dashboardCounts.shift();
                const count = query.get('search') ? Math.min(1, qa.count) : qa.count;
                const historyCount = qa.historyCount || 0;
                const rows = (total, status) => Array.from({ length: total }, (_, i) => ({ staffId: i + 1, staffName: `QA Person ${i + 1}`, professionKey: 'qa_a', professionTitle: 'QA Profession', status, total: 2, completed: 0, percent: 0 })).slice(offset, offset + 200);
                const data = {
                    filters: { search: query.get('search') || '' }, summary: { not_started: count, archived: historyCount },
                    assignments: rows(count, 'not_started'), archived: rows(historyCount, 'archived'), orphaned: [], professionsWithoutTemplate: [],
                    pagination: Object.fromEntries([['assignments', count], ['archived', historyCount], ['orphaned', 0]].map(([feed, total]) => [feed, { limit: 200, offset, total }]))
                };
                if (qa.failDashboard || qa.failDashboardOffset === offset) { qa.failDashboard = false; delete qa.failDashboardOffset; return { success: false, error: 'QA dashboard failure' }; }
                if (qa.holdDashboard) {
                    qa.holdDashboard = false;
                    await new Promise(resolve => { qa.releaseDashboard = resolve; });
                }
                return { success: true, data };
            }
            if (request.startsWith('/professions/workspace/')) {
                const key = request.split('/').at(-1);
                return { success: true, data: { profession: structuredClone(qa.professions.find(p => p.key === key)), people: [], checklistTemplate: qa.template(key), checklistProgress: {} } };
            }
            const key = request.split('/')[2];
            if (!options.method && request.includes('/checklist?')) return { success: true, data: qa.template(key) };
            if (options.method) {
                qa.writes.push({ request, ...options });
                if (qa.hold) await new Promise(resolve => { qa.pending = resolve; });
                if (qa.fail) { qa.fail = false; return { success: false, error: 'QA controlled failure' }; }
                if (request.endsWith('/archive')) qa.items[key].find(item => request.includes(item.itemKey)).isActive = false;
                else if (options.method === 'POST') qa.items[key].push({ itemKey: `${key}_added_${qa.writes.length}`, title: options.body.title, isActive: true });
                else qa.items[key].find(item => request.endsWith(item.itemKey)).title = options.body.title;
                return { success: true };
            }
            throw new Error(`Unexpected local fixture request: ${request}`);
        };
        document.querySelector('#mainApp').classList.remove('hidden');
        document.body.classList.add('shell-ready');
        document.querySelector('#currentUser').textContent = 'QA Synthetic';
        document.querySelector('#sidebarUserName').textContent = 'QA Synthetic';
        document.querySelectorAll('.hr-tab-content').forEach(el => el.classList.remove('active'));
        document.querySelector('#tab-checklists').classList.add('active');
        applyCrmThemeMode(dark, false);
        renderHrNav('checklists');
        bindHrNavClicks();
        window.qaOpen = key => openProfessionWorkspace({ key, initialTab: 'checklist', historyMode: 'none', returnContext: { tab: 'checklists' } });
    }, dark);
    await page.evaluate(() => loadProfessionChecklists());
}
const open = (page, key = 'qa_a') => page.evaluate(key => qaOpen(key), key);
async function close(page) {
    await page.locator('#professionWorkspaceClose').click();
    await page.locator('#professionWorkspaceOverlay').waitFor({ state: 'hidden' });
}
const settleMutation = page => page.waitForFunction(() => !professionChecklistMutationPromise);
const focused = page => page.evaluate(() => ({ id: document.activeElement.id, tag: document.activeElement.tagName, insideWorkspace: Boolean(document.activeElement.closest('#professionWorkspace')), insideConfirm: Boolean(document.activeElement.closest('.confirm-overlay')) }));
const release = page => page.evaluate(() => { qa.hold = false; qa.pending(); qa.pending = null; });
const hold = page => page.evaluate(() => { qa.hold = true; });
const pending = page => page.waitForFunction(() => Boolean(qa.pending));
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true, animations: 'disabled' });

async function run() {
    fs.mkdirSync(OUT, { recursive: true });
    const browser = await requirePlaywright()[browserName].launch({ headless: true });
    const results = { scope: 'Synthetic local requests; real HTML/CSS/UI handlers. No production or PostgreSQL.', node: process.version, engine: browserName, browser: browser.version(), verifiedLocalFixes: VERIFY_LOCAL_FIXES, checks: [], pageErrors: [] };
    let activePage;
    const record = (theme, name, passed, evidence) => results.checks.push({ theme, name, status: passed ? 'PASS' : 'DEFECT', evidence });
    try {
        for (const dark of [false, true]) {
            const theme = dark ? 'dark' : 'light';
            const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
            const page = await context.newPage();
            activePage = page;
            page.on('pageerror', error => results.pageErrors.push(error.message));
            await install(page, dark);
            await page.evaluate(() => { qa.count = 2; return loadProfessionChecklists(); });
            const returnTrigger = page.locator('[data-checklist-feed="assignments"] [data-checklist-open-profession]').nth(1);
            await returnTrigger.focus();
            await page.evaluate(() => {
                qa.returnTrigger = document.activeElement;
                qa.returnFocusContext = captureProfessionReturnContext({ tab: 'checklists' });
                qa.returnStaffId = qa.returnTrigger.closest('.hr-checklist-dashboard-row').querySelector('[data-checklist-open-staff]').dataset.checklistOpenStaff;
                return openProfessionWorkspace({
                    key: qa.returnTrigger.dataset.checklistOpenProfession,
                    initialTab: 'checklist', historyMode: 'none',
                    returnContext: qa.returnFocusContext
                });
            });
            await close(page);
            await page.waitForFunction(() => professionChecklistDashboardState.loadState === 'ready');
            record(theme, 'workspace_return_focus_survives_dashboard_reload', await page.evaluate(() =>
                document.activeElement.matches('[data-checklist-open-profession]')
                && document.activeElement.dataset.checklistOpenProfession === qa.returnTrigger.dataset.checklistOpenProfession
                && document.activeElement.closest('.hr-checklist-dashboard-row').querySelector('[data-checklist-open-staff]')?.dataset.checklistOpenStaff === qa.returnStaffId
                && document.activeElement !== qa.returnTrigger
            ), await focused(page));
            record(theme, 'workspace_return_does_not_steal_new_user_focus', await page.evaluate(async () => {
                const search = document.getElementById('professionChecklistDashboardSearch');
                search.focus();
                await restoreProfessionReturnContext(qa.returnFocusContext);
                return document.activeElement === search;
            }), {});
            record(theme, 'workspace_missing_return_row_focuses_search', await page.evaluate(async () => {
                qa.count = 0;
                await loadProfessionChecklists();
                document.activeElement.blur();
                await restoreProfessionReturnContext(qa.returnFocusContext);
                return document.activeElement.id === 'professionChecklistDashboardSearch';
            }), {});
            await page.evaluate(() => { qa.count = undefined; return loadProfessionChecklists(); });
            const trigger = page.locator('[data-checklist-open-profession]').first();
            await trigger.focus();
            await open(page);
            await page.waitForFunction(() => document.activeElement.closest('#professionWorkspace'));
            record(theme, 'workspace_covers_viewport', await page.locator('#professionWorkspaceOverlay').evaluate(el => {
                const rect = el.getBoundingClientRect();
                return rect.top === 0 && rect.bottom === innerHeight && rect.left === 0 && rect.right === innerWidth;
            }), {});
            record(theme, 'workspace_initial_focus', (await focused(page)).insideWorkspace, await focused(page));
            await page.locator('[data-profession-workspace-tab="checklist"]').focus();
            await page.keyboard.press('ArrowRight');
            record(theme, 'workspace_tab_arrow_navigation', await page.locator('[data-profession-workspace-tab="usage"]').getAttribute('aria-selected') === 'true', await focused(page));
            await page.locator('#professionWorkspaceBack').focus();
            await page.keyboard.press('Shift+Tab');
            record(theme, 'workspace_focus_trap', (await focused(page)).insideWorkspace, await focused(page));
            await page.locator('[data-profession-workspace-tab="checklist"]').click();
            await page.locator('[data-checklist-item-action="archive"]').first().click();
            await page.locator('.confirm-ok').waitFor();
            await page.waitForFunction(() => document.activeElement.classList.contains('confirm-ok'));
            await page.keyboard.press('Tab');
            record(theme, 'confirmation_focus_trap', (await focused(page)).insideConfirm, await focused(page));
            await page.keyboard.press('Escape');
            await page.locator('.confirm-overlay').waitFor({ state: 'detached' });
            record(theme, 'escape_closes_only_top_confirmation', await page.locator('#professionWorkspaceOverlay').isVisible(), { workspaceVisible: await page.locator('#professionWorkspaceOverlay').isVisible(), writes: await page.evaluate(() => qa.writes.length) });
            await open(page);
            const first = page.locator('[data-checklist-item-title]').first();
            await first.fill('QA rename one');
            await first.press('Enter');
            await settleMutation(page);
            record(theme, 'rename_preserves_keyboard_focus', (await focused(page)).insideWorkspace, await focused(page));
            await hold(page);
            await first.fill('QA saved A title');
            await first.press('Enter');
            await pending(page);
            const writes = await page.evaluate(() => qa.writes.length);
            await first.focus();
            await page.keyboard.press('ControlOrMeta+A');
            await page.keyboard.type('QA typed during pending');
            await page.keyboard.press('Enter');
            record(theme, 'pending_prevents_duplicate_request', await page.evaluate(() => qa.writes.length) === writes, { writes });
            const pendingDraft = await first.inputValue();
            await release(page);
            await settleMutation(page);
            record(theme, 'pending_preserves_keyboard_draft', await first.inputValue() === pendingDraft, { pendingDraft, actual: await first.inputValue(), inputDisabled: await first.isDisabled() });
            await hold(page);
            await first.fill('QA A B A persisted');
            await first.press('Enter');
            await pending(page);
            await close(page);
            await open(page, 'qa_b');
            record(theme, 'pending_other_workspace_explains_lock', (await page.locator('#professionWorkspaceChecklistState').innerText()).length > 0, { state: await page.locator('#professionWorkspaceChecklistState').innerText(), pointerEvents: await page.locator('#professionWorkspaceChecklistEditor').evaluate(el => getComputedStyle(el).pointerEvents) });
            await close(page);
            await open(page);
            await release(page);
            await settleMutation(page);
            record(theme, 'A_B_A_refresh_targets_correct_profession', await first.inputValue() === 'QA A B A persisted', { current: await page.evaluate(() => professionWorkspaceState.data.profession.key), actual: await first.inputValue() });
            await page.locator('#professionWorkspaceChecklistNewTitle').fill('QA A pending add');
            await hold(page);
            await page.locator('#professionWorkspaceChecklistAddButton').click();
            await pending(page);
            await close(page);
            await open(page, 'qa_b');
            const add = page.locator('#professionWorkspaceChecklistNewTitle');
            const inheritedDraft = await add.inputValue();
            record(theme, 'new_item_draft_scoped_to_profession', inheritedDraft === '', { inheritedDraft });
            const editableB = await add.evaluate(el => !el.disabled && !el.readOnly);
            await add.focus();
            await page.keyboard.press('ControlOrMeta+A');
            await page.keyboard.type('QA B new draft');
            await page.locator('[data-checklist-item-title]').first().focus();
            const focusBeforeRelease = await focused(page);
            await release(page);
            await settleMutation(page);
            const focusAfterRelease = await focused(page);
            record(theme, 'completed_add_preserves_other_profession_draft_and_focus', await add.inputValue() === (editableB ? 'QA B new draft' : inheritedDraft) && focusAfterRelease.id === focusBeforeRelease.id && focusAfterRelease.tag === focusBeforeRelease.tag, { editableB, actualDraft: await add.inputValue(), focusBeforeRelease, focus: focusAfterRelease, currentKey: await page.evaluate(() => professionWorkspaceState.data.profession.key), serverB: await page.evaluate(() => qa.items.qa_b) });
            await shot(page, `pending-add-other-profession-${theme}`);
            await page.evaluate(() => { qa.fail = true; });
            await first.fill('QA retry');
            await first.press('Enter');
            await settleMutation(page);
            assert.match(await page.locator('#professionWorkspaceChecklistState').innerText(), /QA controlled failure/);
            await first.press('Enter');
            await settleMutation(page);
            record(theme, 'failed_save_can_retry', await first.inputValue() === 'QA retry' && await page.locator('#professionWorkspaceChecklistState').getAttribute('data-state') === 'saved', { actual: await first.inputValue(), writes: await page.evaluate(() => qa.writes.length) });
            await add.fill('QA B parked draft');
            await close(page);
            await open(page, 'qa_a');
            assert.notEqual(await add.inputValue(), 'QA B parked draft');
            await close(page);
            await open(page, 'qa_b');
            record(theme, 'draft_restored_only_for_its_profession', await add.inputValue() === 'QA B parked draft', {});
            await hold(page);
            await page.locator('#professionWorkspaceChecklistAddButton').click();
            await pending(page);
            await close(page);
            await open(page, 'qa_a');
            await close(page);
            await open(page, 'qa_b');
            await release(page);
            await settleMutation(page);
            record(theme, 'completed_add_clears_reopened_matching_draft', await add.inputValue() === '', {});
            await close(page);
            await page.evaluate(() => {
                void confirmModal('QA replaced confirmation').then(value => { qa.replacedConfirmation = value; });
                void confirmModal('QA active confirmation').then(value => { qa.activeConfirmation = value; });
            });
            await page.locator('.confirm-ok').click();
            await page.waitForFunction(() => qa.activeConfirmation === true);
            record(theme, 'shared_confirmation_replacement_resolves_once', await page.evaluate(() => qa.replacedConfirmation === false && qa.activeConfirmation === true), {});
            await page.locator('.confirm-overlay').waitFor({ state: 'detached' });
            await page.evaluate(() => { void confirmModal('QA content deletion', { confirmText: 'Видалити', danger: true }).then(value => { qa.legacyConfirmed = value; }); });
            record(theme, 'shared_confirmation_accessible_name', await page.getByRole('dialog', { name: 'QA content deletion', exact: true }).count() === 1, {});
            record(theme, 'shared_confirmation_legacy_content_options', await page.locator('.confirm-ok').textContent() === 'Видалити' && await page.locator('.confirm-dialog').evaluate(el => el.classList.contains('danger')), {});
            await page.locator('.confirm-cancel').click();
            await page.waitForFunction(() => qa.legacyConfirmed === false);
            await page.locator('.confirm-overlay').waitFor({ state: 'detached' });
            await page.evaluate(() => { void confirmModal('QA explicit options', { okText: 'Continue', confirmText: 'Ignored', type: 'success', danger: true }); });
            record(theme, 'shared_confirmation_explicit_options_precedence', await page.locator('.confirm-ok').textContent() === 'Continue' && await page.locator('.confirm-dialog').evaluate(el => el.classList.contains('success')), {});
            await page.locator('.confirm-cancel').click();
            await page.locator('.confirm-overlay').waitFor({ state: 'detached' });
            const deferredFocus = await page.evaluate(async () => {
                void confirmModal('QA deferred initial focus');
                const cancel = document.querySelector('.confirm-cancel');
                cancel.focus();
                await new Promise(requestAnimationFrame);
                const retained = document.activeElement === cancel;
                cancel.click();
                return retained;
            });
            record(theme, 'shared_dialog_respects_focus_before_animation_frame', deferredFocus, {});
            await page.locator('.confirm-overlay').waitFor({ state: 'detached' });
            for (const count of [0, 1, 199, 200, 201, 401]) {
                await page.evaluate(async count => { qa.count = count; await loadProfessionChecklists({ preserveCatalog: true }); }, count);
                const ids = [];
                let offset = 0;
                do {
                    const visible = await page.locator('[data-checklist-feed="assignments"] [data-checklist-open-staff]').evaluateAll(buttons => buttons.map(button => Number(button.dataset.checklistOpenStaff)));
                    assert.ok(visible.length <= 200);
                    ids.push(...visible);
                    if (offset + visible.length >= count) break;
                    offset += 200;
                    await page.locator(`[data-checklist-page-feed="assignments"][data-checklist-page-offset="${offset}"]`).click();
                    await page.waitForFunction(offset => professionChecklistDashboardState.data?.pagination?.assignments?.offset === offset, offset);
                } while (offset < count);
                record(theme, `pagination_${count}`, ids.length === count && new Set(ids).size === count, { returned: ids.length, unique: new Set(ids).size });
            }
            await page.evaluate(async () => { qa.count = 401; qa.historyCount = 201; await loadProfessionChecklists(); });
            await page.locator('[data-checklist-page-feed="archived"][data-checklist-page-offset="200"]').click();
            await page.waitForFunction(() => professionChecklistDashboardState.data.pagination.archived.offset === 200);
            await page.locator('[data-checklist-page-feed="assignments"][data-checklist-page-offset="200"]').click();
            await page.waitForFunction(() => professionChecklistDashboardState.data.pagination.assignments.offset === 200);
            record(theme, 'independent_feed_pages', await page.evaluate(() => professionChecklistDashboardState.data.pagination.archived.offset === 200 && professionChecklistDashboardState.data.archived.length === 1), {});
            await page.evaluate(() => { qa.failDashboard = true; });
            await page.locator('[data-checklist-page-feed="assignments"][data-checklist-page-offset="400"]').click();
            await page.locator('#professionChecklistDashboardRetry').click();
            await page.waitForFunction(() => professionChecklistDashboardState.loadState === 'ready' && professionChecklistDashboardState.data.pagination.assignments.offset === 400);
            record(theme, 'pagination_failed_page_retry', await page.evaluate(() => professionChecklistDashboardState.data.assignments.length === 1 && professionChecklistDashboardState.data.archived.length === 1), {});
            for (const [count, expectedOffset] of [[201, 200], [200, 0], [0, 0]]) {
                const before = await page.evaluate(() => qa.requests.length);
                await page.evaluate(async count => { qa.count = count; await loadProfessionChecklists({ feed: 'assignments', offset: 400, preserveCatalog: true }); }, count);
                record(theme, `pagination_shrink_${count}`, await page.evaluate(({ count, expectedOffset }) => {
                    const data = professionChecklistDashboardState.data;
                    return data.pagination.assignments.offset === expectedOffset && data.assignments.length === Math.min(200, count - expectedOffset) && data.archived.length === 1;
                }, { count, expectedOffset }), { requests: await page.evaluate(() => qa.requests.length) - before });
            }
            const shrinkingRequests = await page.evaluate(async () => {
                qa.dashboardCounts = [201, 1, 0];
                const before = qa.requests.length;
                await loadProfessionChecklists({ feed: 'assignments', offset: 400, preserveCatalog: true });
                return qa.requests.length - before;
            });
            record(theme, 'pagination_continuous_shrink_is_bounded', shrinkingRequests === 3 && await page.evaluate(() => professionChecklistDashboardState.data.pagination.assignments.offset === 0 && professionChecklistDashboardState.data.assignments.length === 0), { requests: shrinkingRequests });
            await page.evaluate(async () => {
                qa.count = 401;
                await loadProfessionChecklists({ feed: 'assignments', offset: 400, preserveCatalog: true });
                qa.count = 200;
                qa.failDashboardOffset = 0;
                await loadProfessionChecklists({ feed: 'assignments', offset: 400, preserveCatalog: true });
            });
            record(theme, 'failed_recovery_preserves_data_and_retry_offset', await page.evaluate(() => professionChecklistDashboardState.loadState === 'error' && professionChecklistDashboardState.data.assignments.length === 1 && professionChecklistDashboardState.retry.offset === 0), {});
            await page.locator('#professionChecklistDashboardRetry').click();
            await page.waitForFunction(() => professionChecklistDashboardState.loadState === 'ready');
            record(theme, 'failed_recovery_can_retry', await page.evaluate(() => professionChecklistDashboardState.data.assignments.length === 200 && professionChecklistDashboardState.data.pagination.assignments.offset === 0), {});
            await page.evaluate(() => { qa.count = 401; });
            const search = page.locator('#professionChecklistDashboardSearch');
            const beforeTyping = await page.evaluate(() => qa.requests.filter(r => r.request.startsWith('/checklists/dashboard')).length);
            await search.pressSequentially('hello', { delay: 10 });
            await page.waitForFunction(() => professionChecklistDashboardState.data?.filters?.search === 'hello');
            const afterTyping = await page.evaluate(() => qa.requests.filter(r => r.request.startsWith('/checklists/dashboard')).length);
            record(theme, 'search_debounce_and_page_reset', afterTyping - beforeTyping === 1 && await page.evaluate(() => professionChecklistDashboardState.data.pagination.assignments.offset === 0), { requestsForFiveCharacters: afterTyping - beforeTyping });
            await page.evaluate(() => { qa.holdDashboard = true; void loadProfessionChecklists(); });
            await page.waitForFunction(() => Boolean(qa.releaseDashboard));
            await search.fill('latest');
            await search.press('Enter');
            await page.waitForFunction(() => professionChecklistDashboardState.data?.filters?.search === 'latest');
            await page.evaluate(() => { qa.releaseDashboard(); qa.releaseDashboard = null; });
            await page.waitForFunction(() => professionChecklistDashboardState.loadState === 'ready');
            record(theme, 'stale_dashboard_response_ignored', await page.evaluate(() => professionChecklistDashboardState.data.filters.search === 'latest'), {});
            await shot(page, `dashboard-pagination-${theme}`);
            await open(page);
            await add.fill('QA reload draft');
            await install(page, dark, { reload: true });
            await open(page);
            record(theme, 'draft_survives_reload', await add.inputValue() === 'QA reload draft', {});
            await install(page, dark, { reload: true, userId: 9902 });
            await open(page);
            record(theme, 'draft_account_isolation', await add.inputValue() === '', {});
            await add.fill('QA other account');
            await install(page, dark, { reload: true });
            await open(page);
            record(theme, 'draft_original_account_restored', await add.inputValue() === 'QA reload draft', {});
            await add.fill('QA submitted draft');
            await add.press('Enter');
            await settleMutation(page);
            await install(page, dark, { reload: true });
            await open(page);
            record(theme, 'saved_draft_does_not_return_after_reload', await add.inputValue() === '', {});
            await add.fill('QA discarded draft');
            await add.fill('');
            await install(page, dark, { reload: true });
            await open(page);
            record(theme, 'cleared_draft_does_not_return_after_reload', await add.inputValue() === '', {});
            await install(page, dark, { reload: true, storageBlocked: true });
            await open(page);
            await add.fill('QA memory fallback');
            await close(page);
            await open(page);
            record(theme, 'blocked_storage_keeps_in_page_draft', await add.inputValue() === 'QA memory fallback', await page.evaluate(() => ({ value: document.getElementById('professionWorkspaceChecklistNewTitle').value, owner: professionChecklistDraftOwner, workspaceOwner: professionWorkspaceState.draftOwner, drafts: [...professionChecklistDrafts], open: professionWorkspaceState.open })));
            await add.press('Enter');
            await settleMutation(page);
            record(theme, 'blocked_storage_does_not_prevent_save', await add.inputValue() === '' && await page.evaluate(() => qa.writes.length === 1), await page.evaluate(() => ({ value: document.getElementById('professionWorkspaceChecklistNewTitle').value, writes: qa.writes, state: document.getElementById('professionWorkspaceChecklistState').textContent })));
            await context.close();
        }
        assert.deepEqual(results.pageErrors, [], 'No uncaught browser errors');
        if (VERIFY_LOCAL_FIXES) {
            const failures = results.checks.filter(check => check.status !== 'PASS');
            assert.deepEqual(failures, [], 'All checklist interaction and pagination regressions must pass');
        }
    } catch (error) {
        if (activePage && !activePage.isClosed()) {
            await shot(activePage, 'failure');
            results.failure = await activePage.evaluate(() => {
                const button = document.getElementById('professionWorkspaceChecklistAddButton');
                const rect = button.getBoundingClientRect();
                return { message: 'Pointer hit test and viewport at failure', button: rect.toJSON(), scrollY,
                    hits: document.elementsFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2).slice(0, 8).map(el => ({ tag: el.tagName, id: el.id, className: el.className, zIndex: getComputedStyle(el).zIndex })) };
            });
        }
        throw error;
    } finally {
        fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
        await browser.close();
    }
    console.log(JSON.stringify({ checks: results.checks.length, passed: results.checks.filter(r => r.status === 'PASS').length, defects: results.checks.filter(r => r.status === 'DEFECT').length, output: OUT }));
}
run().catch(error => { console.error(error); process.exitCode = 1; });
