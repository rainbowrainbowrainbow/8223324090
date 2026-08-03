#!/usr/bin/env node
'use strict';

/**
 * Read-only live/staging browser smoke for Profile -> My Day.
 *
 * Read-only guarantee:
 * - Uses POST only for authentication when token auth is not provided.
 * - Never creates, edits, completes, reschedules, or deletes tasks.
 * - Fails the run if a task mutation endpoint is requested by the browser.
 *
 * Usage:
 *   npm run smoke:my-day -- https://example.up.railway.app
 *   LIVE_SMOKE_URL=https://example.up.railway.app LIVE_SMOKE_USER=... LIVE_SMOKE_PASS=... npm run smoke:my-day
 *   LIVE_SMOKE_TOKEN=<jwt> npm run smoke:my-day -- https://example.up.railway.app
 *   LIVE_MY_DAY_VERIFY_DRAFT=true npm run smoke:my-day -- https://example.up.railway.app
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TARGET_URL = process.argv.find(arg => /^https?:\/\//i.test(arg))
    || readEnv('LIVE_MY_DAY_URL', 'LIVE_SMOKE_URL', 'TEST_URL');
const BUSINESS_CONTEXT = readEnv('LIVE_MY_DAY_BUSINESS_CONTEXT', 'LIVE_SMOKE_BUSINESS_CONTEXT') || 'event_genix';
const HEADLESS = readEnv('LIVE_MY_DAY_HEADLESS', 'LIVE_SMOKE_HEADLESS') !== 'false';
const VERIFY_DRAFT = readEnv('LIVE_MY_DAY_VERIFY_DRAFT') === 'true';
const TIMEOUT_MS = Number(readEnv('LIVE_MY_DAY_TIMEOUT_MS', 'LIVE_SMOKE_TIMEOUT_MS') || 30000);
const RUN_ID = `my-day-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const OUTPUT_DIR = path.join(ROOT, 'output', 'playwright', 'live-my-day-smoke', RUN_ID);

const VIEWPORTS = Object.freeze({
    desktop: Object.freeze({ width: 1440, height: 900 }),
    mobile: Object.freeze({ width: 390, height: 844 })
});

function readEnv(...names) {
    for (const name of names) {
        const value = process.env[name];
        if (String(value || '').trim()) return String(value).trim();
    }
    return '';
}

function fail(message) {
    console.error(`Live My Day smoke failed: ${message}`);
    process.exit(1);
}

function normalizeBase(url) {
    try {
        return new URL(url).origin;
    } catch {
        fail(`invalid URL "${url || ''}"`);
    }
}

async function readBody(res) {
    const text = await res.text();
    try {
        return text ? JSON.parse(text) : null;
    } catch {
        return text;
    }
}

function responseDetail(body) {
    return body?.error || body?.message || body?.code || (typeof body === 'string' ? body : '') || '';
}

async function fetchJson(base, routePath, options = {}) {
    const res = await fetch(`${base}${routePath}`, {
        method: options.method || 'GET',
        headers: {
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    const body = await readBody(res);
    if (!res.ok) {
        throw new Error(`${routePath} returned ${res.status}${responseDetail(body) ? `: ${responseDetail(body)}` : ''}`);
    }
    return body;
}

function extractToken(body = {}) {
    return body.accessToken
        || body.access_token
        || body.token
        || body.jwt
        || body.data?.accessToken
        || body.data?.access_token
        || body.data?.token
        || '';
}

async function login(base) {
    const token = readEnv('LIVE_MY_DAY_TOKEN', 'LIVE_SMOKE_TOKEN', 'LIVE_SMOKE_BEARER_TOKEN');
    if (token) {
        const verified = await fetchJson(base, '/api/auth/verify', { token });
        return { token, user: verified.user || verified, source: 'token' };
    }

    const username = readEnv('LIVE_MY_DAY_USER', 'LIVE_SMOKE_USER', 'LIVE_SMOKE_USERNAME', 'TEST_USER');
    const password = readEnv('LIVE_MY_DAY_PASS', 'LIVE_MY_DAY_PASSWORD', 'LIVE_SMOKE_PASS', 'LIVE_SMOKE_PASSWORD', 'TEST_PASS', 'TEST_PASSWORD');
    if (!username || !password) {
        throw new Error('provide LIVE_SMOKE_TOKEN or LIVE_SMOKE_USER/LIVE_SMOKE_PASS or TEST_USER/TEST_PASS');
    }

    const body = await fetchJson(base, '/api/auth/login', {
        method: 'POST',
        body: { username, password }
    });
    const accessToken = extractToken(body);
    if (!accessToken) throw new Error('/api/auth/login did not return an access token');
    return {
        token: accessToken,
        refreshToken: body.refreshToken || '',
        refreshExpiresAt: body.refreshExpiresAt || '',
        user: body.user || null,
        source: 'login'
    };
}

async function hydrateSessionPermissions(base, session) {
    if (!session?.token) throw new Error('authenticated smoke session is missing an access token');
    if (!session?.user || typeof session.user !== 'object') {
        throw new Error('authenticated smoke session is missing a user profile');
    }
    const payload = await fetchJson(base, '/api/auth/permissions', { token: session.token });
    const permissions = payload?.permissions && !payload?.capabilities
        ? payload.permissions
        : payload;
    return {
        ...session,
        user: {
            ...session.user,
            permissions
        }
    };
}
function requirePlaywright() {
    try {
        return require('playwright');
    } catch (err) {
        const pathEntries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
        for (const entry of pathEntries) {
            const normalized = entry.replace(/[\\/]+$/, '');
            if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
            const nodeModulesDir = path.dirname(normalized);
            const packageDir = path.join(nodeModulesDir, 'playwright');
            if (fs.existsSync(packageDir)) return require(packageDir);
        }
        throw err;
    }
}

function profileUrl(base, tab = '') {
    const url = new URL('/profile', base);
    if (tab) url.searchParams.set('tab', tab);
    url.searchParams.set('businessContext', BUSINESS_CONTEXT);
    url.searchParams.set('smoke', RUN_ID);
    return url.toString();
}

async function openAuthenticatedContext(browser, session, viewport) {
    const context = await browser.newContext({ viewport });
    await context.addInitScript(({ token, refreshToken, refreshExpiresAt, user, businessContext }) => {
        localStorage.setItem('pzp_token', token);
        localStorage.setItem('pzp_access_token', token);
        if (refreshToken) localStorage.setItem('pzp_refresh_token', refreshToken);
        if (refreshExpiresAt) localStorage.setItem('pzp_refresh_expires_at', String(refreshExpiresAt));
        if (user) localStorage.setItem('pzp_current_user', JSON.stringify(user));
        localStorage.setItem('pzp_crm_business_context', businessContext);
        localStorage.setItem('pzp_dark_mode', 'true');
    }, {
        token: session.token,
        refreshToken: session.refreshToken || '',
        refreshExpiresAt: session.refreshExpiresAt || '',
        user: session.user || null,
        businessContext: BUSINESS_CONTEXT
    });

    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT_MS);
    await page.route('https://www.clarity.ms/**', route => route.abort());
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await page.route('https://fonts.gstatic.com/**', route => route.abort());
    return { context, page };
}

function isForbiddenTaskMutation(method, pathname) {
    const normalizedMethod = String(method || '').toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(normalizedMethod)) return false;
    if (pathname === '/api/auth/login' || pathname === '/api/auth/refresh' || pathname === '/api/auth/logout') return false;
    if (/^\/api\/tasks(?:\/|$)/.test(pathname)) return true;
    return false;
}

function attachReadOnlyGuard(page, label) {
    const forbidden = [];
    page.on('request', request => {
        const url = new URL(request.url());
        if (isForbiddenTaskMutation(request.method(), url.pathname)) {
            forbidden.push(`${label}: ${request.method()} ${url.pathname}`);
        }
    });
    return forbidden;
}

function assertNoForbiddenTaskWrites(forbidden, label) {
    assert.deepEqual(forbidden, [], `${label}: browser sent forbidden task mutation request(s)`);
}

async function waitForProfileShell(page, base, tab = '') {
    await page.goto(profileUrl(base, tab), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.profile-page.profile-work-mode');
    await page.waitForSelector('#tabContent');
}

async function assertFullProfileHeader(page) {
    await page.waitForSelector('.profile-header.profile-work-header');
    assert.equal(await page.locator('[data-profile-my-day-capsule]').count(), 0, 'normal profile route does not use My Day capsule');
    assert.ok(await page.locator('.profile-identity-block').count() > 0, 'normal profile route keeps full identity header');
    assert.ok(await page.locator('.profile-friendly-shell:not(.profile-work-header--myday)').count() > 0, 'normal profile route keeps full header class path');
}

async function assertNoReplacementCharacters(page, label) {
    const hasReplacement = await page.evaluate(() => document.body.innerText.includes('\uFFFD'));
    assert.equal(hasReplacement, false, `${label}: page text has no replacement characters`);
}

async function assertMyDayLifeModes(page, label) {
    await page.waitForSelector('.my-day-life-tabs [role="tab"]');
    const labels = await page.$$eval('.my-day-life-tabs [role="tab"]', nodes => nodes.map(node => node.textContent.trim()));
    assert.deepEqual(labels, ['День', 'Звички', 'Внесок'], `${label}: My Day mode labels are canonical`);
    const modes = [
        { key: 'day', panel: '#myDayDayPanel', name: 'День' },
        { key: 'habits', panel: '#myDayHabitsPanel', name: 'Звички' },
        { key: 'contribution', panel: '#myDayContributionPanel', name: 'Внесок' }
    ];
    for (const mode of modes) {
        await page.locator(`[data-my-day-life-mode="${mode.key}"]`).click();
        await page.waitForSelector(`${mode.panel}[role="tabpanel"]`);
        await assertNoReplacementCharacters(page, `${label}: ${mode.name}`);
        await assertNoHorizontalOverflow(page, `${label}: ${mode.name}`);
    }
}
async function assertMyDayShell(page) {
    await page.waitForSelector('[data-profile-my-day-capsule]');
    await page.waitForSelector('.cabinet-shell.cabinet-command-center');
    await page.waitForSelector('[data-cabinet-my-day-layout="today-overdue"]');
    await page.waitForSelector('.cabinet-day-column--today');
    await page.waitForSelector('.cabinet-day-column--overdue');
    await page.waitForSelector('[data-cabinet-composer-toggle]');
    await page.waitForSelector('.cabinet-completed-strip--compact details.cabinet-completed-details');
    await page.waitForSelector('[data-cabinet-overdue-triage]');

    assert.equal(await page.locator('.cabinet-day-command-bar').count(), 0, 'old My Day command bar is absent');
    assert.equal(await page.locator('[data-cabinet-my-day-sound-settings]').count(), 0, 'old visible sound shortcut is absent');
    assert.equal(await page.locator('.cabinet-day-action--settings').count(), 0, 'old settings action is absent');
    assert.equal(await page.locator('.cabinet-support-panel').count(), 0, 'CRM signal/support panels do not push down My Day focus');

    const shell = await page.evaluate(() => {
        const workspace = document.querySelector('[data-cabinet-my-day-layout="today-overdue"], #myDayHabitsPanel, #myDayContributionPanel');
        const today = document.querySelector('.cabinet-day-column--today');
        const overdue = document.querySelector('.cabinet-day-column--overdue');
        const completed = document.querySelector('.cabinet-completed-details');
        const composerToggle = document.querySelector('[data-cabinet-composer-toggle]');
        return {
            layout: workspace?.getAttribute('data-cabinet-my-day-layout') || '',
            activeToday: Number(workspace?.getAttribute('data-active-today') || 0),
            activeOverdue: Number(workspace?.getAttribute('data-active-overdue') || 0),
            todayTitle: today?.textContent?.trim().slice(0, 200) || '',
            overdueTitle: overdue?.textContent?.trim().slice(0, 200) || '',
            completedOpen: Boolean(completed?.hasAttribute('open')),
            composerExpanded: composerToggle?.getAttribute('aria-expanded') || ''
        };
    });
    assert.equal(shell.layout, 'today-overdue', 'My Day uses the two-column today/overdue layout');
    assert.match(shell.todayTitle, /Сьогодні|РЎСЊРѕРіРѕРґРЅС–/, 'today column renders today copy');
    assert.match(shell.overdueTitle, /Прострочено|РџСЂРѕСЃС‚СЂРѕС‡РµРЅРѕ|Немає прострочених|РќРµРјР°С” РїСЂРѕСЃС‚СЂРѕС‡РµРЅРёС…/, 'overdue column renders overdue copy');
    assert.equal(shell.completedOpen, false, 'completed history is collapsed by default');
    assert.equal(shell.composerExpanded, 'false', 'quick-add composer starts collapsed');
}

async function assertCompletedHistoryDisclosure(page) {
    const details = page.locator('.cabinet-completed-details').first();
    await details.locator('summary').click();
    await page.waitForFunction(() => document.querySelector('.cabinet-completed-details')?.hasAttribute('open'));
    assert.equal(await details.evaluate(node => node.hasAttribute('open')), true, 'completed history details can open');
}

async function assertOverdueTriageSurface(page) {
    const rows = page.locator('[data-cabinet-overdue-triage-row]');
    const count = await rows.count();
    if (!count) {
        await page.locator('[data-cabinet-overdue-triage] .cabinet-empty').first().waitFor({ state: 'visible' });
        return { rows: 0 };
    }

    const first = rows.first();
    await first.locator('[data-cabinet-task-action="move-to-today"]').waitFor({ state: 'visible' });
    await first.locator('[data-cabinet-task-action="reschedule-overdue"][data-reschedule-option="custom"]').waitFor({ state: 'visible' });
    await first.locator('[data-cabinet-task-action="done"]').waitFor({ state: 'visible' });
    await first.locator('[data-cabinet-task-action="move-target"][data-cabinet-move-target="no_date"][data-cabinet-move-method="triage"]').waitFor({ state: 'visible' });
    assert.ok(await first.locator('.cabinet-task-more').count() > 0, 'overdue row keeps more-menu fallback');
    return { rows: count };
}

async function assertNoHorizontalOverflow(page, label) {
    const metrics = await page.evaluate(() => {
        const profile = document.querySelector('.profile-page');
        const workspace = document.querySelector('[data-cabinet-my-day-layout="today-overdue"], #myDayHabitsPanel, #myDayContributionPanel');
        const profileBox = profile?.getBoundingClientRect();
        const workspaceBox = workspace?.getBoundingClientRect();
        return {
            viewportWidth: window.innerWidth,
            pageScrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
            profileWidth: profileBox?.width || 0,
            workspaceWidth: workspaceBox?.width || 0,
            workspaceRight: workspaceBox?.right || 0
        };
    });
    assert.ok(metrics.profileWidth > 0, `${label}: profile page is measurable`);
    assert.ok(metrics.workspaceWidth > 0, `${label}: My Day workspace is measurable`);
    assert.ok(metrics.pageScrollWidth <= metrics.viewportWidth + 4, `${label}: page has no global horizontal overflow`);
    assert.ok(metrics.workspaceRight <= metrics.viewportWidth + 4, `${label}: workspace stays inside viewport`);
}

async function assertComposerDraftSurvivesDueChanges(page) {
    const title = page.locator('#cabinetTaskTitle');
    const date = page.locator('#cabinetTaskDate');
    const draft = `Smoke draft ${RUN_ID} — do not create`;
    await title.evaluate((input, value) => { input.value = value; }, draft);

    for (const preset of ['today', 'tomorrow', 'day_after_tomorrow', 'plus_3_days', 'month_end', 'no_date', 'custom']) {
        const button = page.locator(`[data-cabinet-due-preset="${preset}"]`);
        await button.click();
        assert.equal(await title.inputValue(), draft, `${preset}: due change keeps the typed draft`);
        assert.equal(await button.getAttribute('aria-pressed'), 'true', `${preset}: due chip is selected`);
    }

    const focusedProjection = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === '/api/tasks/my-cabinet' && url.searchParams.get('focusDate') === '2099-05-31';
    });
    await date.fill('2099-05-31');
    await focusedProjection;
    await page.waitForTimeout(180);
    assert.equal(await title.inputValue(), draft, 'custom date background refresh keeps the typed draft');
    assert.equal(await date.inputValue(), '2099-05-31', 'custom date remains selected');
    return true;
}
async function runViewport(browser, base, session, viewport, label) {
    let context;
    let page;
    let forbidden = [];
    try {
        ({ context, page } = await openAuthenticatedContext(browser, session, viewport));
        forbidden = attachReadOnlyGuard(page, label);
        await waitForProfileShell(page, base);
        await assertFullProfileHeader(page);
        await waitForProfileShell(page, base, 'myday');
        await assertMyDayShell(page);
        const draftVerified = VERIFY_DRAFT ? await assertComposerDraftSurvivesDueChanges(page) : false;
        const overdue = await assertOverdueTriageSurface(page);
        await assertCompletedHistoryDisclosure(page);
        await assertNoHorizontalOverflow(page, label);
        await assertMyDayLifeModes(page, label);
        await page.screenshot({ path: path.join(OUTPUT_DIR, `${label}.png`), fullPage: true });
        assertNoForbiddenTaskWrites(forbidden, label);
        return {
            viewport: `${viewport.width}x${viewport.height}`,
            overdueRows: overdue.rows,
            draftVerified
        };
    } finally {
        await page?.close().catch(() => {});
        await context?.close().catch(() => {});
    }
}

async function run() {
    if (!TARGET_URL) fail('provide URL argument or LIVE_MY_DAY_URL/LIVE_SMOKE_URL/TEST_URL');
    const base = normalizeBase(TARGET_URL);
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    let playwright;
    try {
        playwright = requirePlaywright();
    } catch {
        fail('Playwright is not available. Run through: npx --yes --package playwright node scripts/live-my-day-smoke.js');
    }

    const session = await hydrateSessionPermissions(base, await login(base));
    const browser = await playwright.chromium.launch({ headless: HEADLESS });
    try {
        const desktop = await runViewport(browser, base, session, VIEWPORTS.desktop, 'desktop');
        const mobile = await runViewport(browser, base, session, VIEWPORTS.mobile, 'mobile');

        console.log(`Live My Day smoke OK: ${base}`);
        console.log(`  OK desktop: ${desktop.viewport}, overdueRows=${desktop.overdueRows}`);
        console.log(`  OK mobile: ${mobile.viewport}, overdueRows=${mobile.overdueRows}`);
        if (VERIFY_DRAFT) console.log('  OK composer draft: all due presets and custom date preserve input');
        console.log('  OK read-only guard: no task mutation requests');
        console.log(`  OK screenshots: ${path.relative(ROOT, OUTPUT_DIR)}`);
    } finally {
        await browser.close().catch(() => {});
    }
}

run().catch(error => {
    fail(error?.stack || error?.message || String(error));
});
