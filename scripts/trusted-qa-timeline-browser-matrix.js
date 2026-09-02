'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_SECRET_FILE = path.join(os.homedir(), '.eventgenix', 'codex-crm-secrets.ps1');
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ALLOWED_POST_PATHS = new Set(['/api/auth/login', '/api/auth/refresh']);
const VIEWPORTS = Object.freeze([
    { name: 'desktop', width: 1440, height: 960 },
    { name: 'tablet', width: 900, height: 900 },
    { name: 'mobile', width: 390, height: 844 }
]);
const ZOOMS = Object.freeze([15, 30, 60]);
const MIN_COMPACT_IDENTITY_FONT_PX = 9;

function argValue(args, name, fallback = null) {
    const inline = args.find(arg => arg.startsWith(`${name}=`));
    if (inline) return inline.slice(name.length + 1);
    const index = args.indexOf(name);
    return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}

function fail(condition, message, code = 'TIMELINE_BROWSER_MATRIX_FAILED') {
    if (!condition) {
        const error = new Error(message);
        error.code = code;
        throw error;
    }
}

function requirePlaywright() {
    try { return require('playwright'); } catch {}
    const explicitModule = process.env.PLAYWRIGHT_MODULE_PATH;
    if (explicitModule && fs.existsSync(explicitModule)) return require(explicitModule);
    for (const entry of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
        const normalized = entry.replace(/[\\/]+$/, '');
        if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
        const packageDirectory = path.join(path.dirname(normalized), 'playwright');
        if (fs.existsSync(packageDirectory)) return require(packageDirectory);
    }
    const npmCache = process.env.npm_config_cache
        || (process.platform === 'win32' && process.env.LOCALAPPDATA
            ? path.join(process.env.LOCALAPPDATA, 'npm-cache')
            : path.join(os.homedir(), '.npm'));
    const npxCache = path.join(npmCache, '_npx');
    if (fs.existsSync(npxCache)) {
        const cachedPackages = fs.readdirSync(npxCache, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => path.join(npxCache, entry.name, 'node_modules', 'playwright'))
            .filter(candidate => fs.existsSync(path.join(candidate, 'package.json')))
            .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
        if (cachedPackages[0]) return require(cachedPackages[0]);
    }
    throw Object.assign(new Error('Playwright is unavailable; run through npm exec --package=playwright'), {
        code: 'TIMELINE_BROWSER_MATRIX_PLAYWRIGHT_MISSING'
    });
}

function parseSecrets(file) {
    fail(fs.existsSync(file), 'EventGenix QA secret file is unavailable', 'TIMELINE_BROWSER_MATRIX_SECRET_MISSING');
    const values = Object.create(null);
    const source = fs.readFileSync(file, 'utf8');
    const pattern = /^\s*\$env:(LIVE_SMOKE_USER|LIVE_SMOKE_PASS|LIVE_CREATOR_USER|LIVE_CREATOR_PASS)\s*=\s*(['"])(.*?)\2\s*$/gm;
    for (const match of source.matchAll(pattern)) values[match[1]] = match[3];
    const username = values.LIVE_CREATOR_USER || values.LIVE_SMOKE_USER;
    const password = values.LIVE_CREATOR_PASS || values.LIVE_SMOKE_PASS;
    fail(username && password, 'EventGenix browser credentials are incomplete', 'TIMELINE_BROWSER_MATRIX_CREDENTIALS_MISSING');
    return { username, password };
}

async function login(base, credentials) {
    const response = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials)
    });
    fail(response.ok, `Login failed with HTTP ${response.status}`, 'TIMELINE_BROWSER_MATRIX_LOGIN_FAILED');
    const body = await response.json();
    const accessToken = body.accessToken || body.token;
    fail(typeof accessToken === 'string' && accessToken.length > 20,
        'Login did not return an access token', 'TIMELINE_BROWSER_MATRIX_TOKEN_MISSING');
    return {
        accessToken,
        refreshToken: body.refreshToken || null,
        refreshExpiresAt: body.refreshExpiresAt || null,
        user: body.user || null
    };
}

function readBookingIds(stateFile) {
    fail(fs.existsSync(stateFile), 'Controller state file is unavailable', 'TIMELINE_BROWSER_MATRIX_STATE_MISSING');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    return [...new Set((state.fixtures || []).flatMap(item => item.bookingIds || []).map(String))].sort();
}

async function waitForTimeline(page, date) {
    await page.waitForFunction(expectedDate => {
        const input = document.getElementById('timelineDate');
        return Boolean(window.AppState && input && document.querySelector('.timeline-container'))
            && (!input.value || input.value === expectedDate);
    }, date, { timeout: 30_000 });
    await page.evaluate(async selectedDate => {
        AppState.selectedDate = new Date(`${selectedDate}T00:00:00`);
        const input = document.getElementById('timelineDate');
        if (input) input.value = selectedDate;
        if (typeof setTimelineDateInUrl === 'function') setTimelineDateInUrl(selectedDate);
        if (window.TimelineView?.set) await window.TimelineView.set('animators', { render: false });
        if (typeof loadBookings === 'function') await loadBookings({ force: true });
        if (typeof renderTimeline === 'function') await renderTimeline();
    }, date);
    await page.waitForFunction(() => !document.querySelector('.timeline-loading') && document.querySelectorAll('.booking-block').length > 0,
        null, { timeout: 30_000 });
}

async function captureCase(page, outputDirectory, bookingIds, viewport, zoom, theme) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.evaluate(nextTheme => {
        document.documentElement.dataset.theme = nextTheme;
        document.body.dataset.theme = nextTheme;
        localStorage.setItem('pzp_dark_mode', nextTheme === 'dark' ? 'true' : 'false');
    }, theme);
    await page.evaluate(expected => {
        const button = document.querySelector(`.zoom-btn[data-zoom="${expected}"]`);
        if (!(button instanceof HTMLButtonElement)) throw new Error(`Zoom control ${expected} is unavailable`);
        button.click();
    }, zoom);
    await page.waitForFunction(expected => document.querySelector(`.zoom-btn[data-zoom="${expected}"]`)?.getAttribute('aria-pressed') === 'true', zoom);
    await page.waitForTimeout(150);
    const metrics = await page.evaluate(ids => {
        const wanted = new Set(ids.map(String));
        const categoryPrefixes = {
            quest: 'КВ',
            animation: 'АН',
            show: 'ШОУ',
            masterclass: 'МК',
            photo: 'ФОТО',
            pinata: 'П',
            custom: 'ІНШ'
        };
        return [...document.querySelectorAll('.booking-block[data-booking-id]')]
            .filter(node => wanted.has(String(node.dataset.bookingId)))
            .map(node => {
                const rect = node.getBoundingClientRect();
                const style = getComputedStyle(node);
                const identity = node.querySelector('.timeline-micro-booking-code, .timeline-compact-booking-label, .timeline-room-activity-title, .title');
                const identityRect = identity?.getBoundingClientRect?.() || null;
                const identityStyle = identity ? getComputedStyle(identity) : null;
                const density = ['micro', 'tiny', 'short', 'medium', 'wide']
                    .find(value => node.classList.contains(`booking-block--${value}`)) || '';
                const category = Object.keys(categoryPrefixes).find(value => node.classList.contains(value)) || '';
                const expectedPrefix = categoryPrefixes[category] || '';
                const identityText = String(identity?.textContent || '').replace(/\s+/g, ' ').trim();
                const escapedPrefix = expectedPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const duplicateCategoryPattern = expectedPrefix
                    ? new RegExp(`^${escapedPrefix}\\s*(?:[|:]\\s*)?${escapedPrefix}(?:\\s|$)`, 'iu')
                    : null;
                return {
                    bookingId: String(node.dataset.bookingId),
                    width: Math.round(rect.width * 100) / 100,
                    height: Math.round(rect.height * 100) / 100,
                    fontSize: style.fontSize,
                    density,
                    category,
                    expectedPrefix,
                    identityText,
                    identityFontPx: Number.parseFloat(identityStyle?.fontSize || '0') || 0,
                    identityMissing: !identity,
                    identityOverflow: Boolean(identity && (identity.scrollWidth > identity.clientWidth + 1 || identity.scrollHeight > identity.clientHeight + 1)),
                    identityOutsideCard: Boolean(identityRect && (
                        identityRect.left < rect.left - 1
                        || identityRect.right > rect.right + 1
                        || identityRect.top < rect.top - 1
                        || identityRect.bottom > rect.bottom + 1
                    )),
                    stackedCenterOffsetPx: identityRect && (density === 'micro' || density === 'tiny')
                        ? Math.round(Math.abs((identityRect.top + identityRect.height / 2) - (rect.top + rect.height / 2)) * 100) / 100
                        : 0,
                    genericOnly: Boolean(expectedPrefix && identityText.toLocaleUpperCase('uk-UA') === expectedPrefix),
                    categoryMismatch: Boolean(expectedPrefix && !identityText.toLocaleUpperCase('uk-UA').startsWith(expectedPrefix)),
                    duplicatedCategory: Boolean(duplicateCategoryPattern?.test(identityText)),
                    duplicateDurationBadge: node.querySelectorAll('.duration-badge').length > 1,
                    overflowX: node.scrollWidth > node.clientWidth + 1,
                    overflowY: node.scrollHeight > node.clientHeight + 1,
                    ariaLabelPresent: Boolean(node.getAttribute('aria-label') || node.getAttribute('title'))
                };
            });
    }, bookingIds);
    const metricIds = new Set(metrics.map(item => item.bookingId));
    const missingBookingIds = bookingIds.filter(id => !metricIds.has(String(id)));
    const file = path.join(outputDirectory, `timeline-${viewport.name}-${theme}-${zoom}.png`);
    await page.screenshot({ path: file, fullPage: true });
    const scrollState = await page.evaluate(() => {
        const scroll = document.getElementById('timelineScroll');
        if (!scroll) return { maxScrollLeft: 0, previousScrollLeft: 0 };
        const state = {
            maxScrollLeft: Math.max(0, scroll.scrollWidth - scroll.clientWidth),
            previousScrollLeft: scroll.scrollLeft
        };
        scroll.scrollLeft = state.maxScrollLeft;
        return state;
    });
    let endScreenshot = null;
    if (scrollState.maxScrollLeft > 1) {
        await page.waitForTimeout(80);
        endScreenshot = path.join(outputDirectory, `timeline-${viewport.name}-${theme}-${zoom}-end.png`);
        await page.screenshot({ path: endScreenshot, fullPage: true });
        await page.evaluate(previous => {
            const scroll = document.getElementById('timelineScroll');
            if (scroll) scroll.scrollLeft = previous;
        }, scrollState.previousScrollLeft);
    }
    const compactMetrics = metrics.filter(item => ['micro', 'tiny', 'short'].includes(item.density));
    return {
        viewport: viewport.name,
        theme,
        zoom,
        visibleBookingCount: metrics.length,
        missingBookingIds,
        overflowBookingIds: metrics.filter(item => item.overflowX || item.overflowY).map(item => item.bookingId),
        identityOverflowBookingIds: metrics.filter(item => item.identityOverflow || item.identityOutsideCard).map(item => item.bookingId),
        tinyFontBookingIds: compactMetrics.filter(item => item.identityFontPx < MIN_COMPACT_IDENTITY_FONT_PX).map(item => item.bookingId),
        offCenterStackedBookingIds: compactMetrics.filter(item => ['micro', 'tiny'].includes(item.density) && item.stackedCenterOffsetPx > 8).map(item => item.bookingId),
        missingIdentityBookingIds: metrics.filter(item => item.identityMissing).map(item => item.bookingId),
        genericOnlyBookingIds: metrics.filter(item => item.genericOnly).map(item => item.bookingId),
        categoryMismatchBookingIds: metrics.filter(item => item.categoryMismatch).map(item => item.bookingId),
        duplicatedCategoryBookingIds: metrics.filter(item => item.duplicatedCategory).map(item => item.bookingId),
        duplicateDurationBookingIds: metrics.filter(item => item.duplicateDurationBadge).map(item => item.bookingId),
        missingAccessibleNameBookingIds: metrics.filter(item => !item.ariaLabelPresent).map(item => item.bookingId),
        horizontalScrollAvailable: scrollState.maxScrollLeft > 1,
        screenshot: file,
        endScreenshot
    };
}

function caseAcceptanceFailures(result) {
    return [
        'missingBookingIds',
        'identityOverflowBookingIds',
        'tinyFontBookingIds',
        'offCenterStackedBookingIds',
        'missingIdentityBookingIds',
        'genericOnlyBookingIds',
        'categoryMismatchBookingIds',
        'duplicatedCategoryBookingIds',
        'duplicateDurationBookingIds',
        'missingAccessibleNameBookingIds'
    ].flatMap(key => (result[key] || []).map(bookingId => `${key}:${bookingId}`));
}

async function run(options = {}) {
    const base = new URL(options.liveUrl).origin;
    const credentials = parseSecrets(options.secretFile || DEFAULT_SECRET_FILE);
    const bookingIds = readBookingIds(options.stateFile);
    fail(bookingIds.length > 0, 'Controller state has no registered booking IDs', 'TIMELINE_BROWSER_MATRIX_EMPTY_STATE');
    fs.mkdirSync(options.outputDirectory, { recursive: true });
    const session = await login(base, credentials);
    const { chromium } = requirePlaywright();
    const browser = await chromium.launch({ headless: true });
    const blockedWrites = [];
    const suppressedExternalWrites = [];
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', async route => {
        const request = route.request();
        const method = request.method().toUpperCase();
        const requestUrl = new URL(request.url());
        const pathname = requestUrl.pathname;
        if (!WRITE_METHODS.has(method)) return route.continue();
        if (requestUrl.origin === base && method === 'POST' && ALLOWED_POST_PATHS.has(pathname)) return route.continue();
        if (requestUrl.origin !== base) {
            suppressedExternalWrites.push(`${method} ${pathname}`);
            return route.abort('blockedbyclient');
        }
        blockedWrites.push(`${method} ${pathname}`);
        return route.abort('blockedbyclient');
    });
    await context.addInitScript(state => {
        localStorage.setItem('pzp_token', state.accessToken);
        localStorage.setItem('pzp_access_token', state.accessToken);
        if (state.refreshToken) localStorage.setItem('pzp_refresh_token', state.refreshToken);
        if (state.refreshExpiresAt) localStorage.setItem('pzp_refresh_expires_at', String(state.refreshExpiresAt));
        if (state.user) localStorage.setItem('pzp_current_user', JSON.stringify(state.user));
        localStorage.setItem('pzp_dark_mode', 'true');
    }, session);
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    try {
        await page.goto(`${base}/?businessContext=event_genix&date=${encodeURIComponent(options.date)}&timelineView=animators`, {
            waitUntil: 'domcontentloaded'
        });
        await waitForTimeline(page, options.date);
        const cases = [];
        for (const viewport of VIEWPORTS) {
            for (const zoom of ZOOMS) cases.push(await captureCase(page, options.outputDirectory, bookingIds, viewport, zoom, 'dark'));
        }
        cases.push(await captureCase(page, options.outputDirectory, bookingIds, VIEWPORTS[0], 30, 'light'));
        const acceptanceFailures = cases.flatMap(result => caseAcceptanceFailures(result)
            .map(failure => `${result.viewport}/${result.theme}/${result.zoom}:${failure}`));
        fail(acceptanceFailures.length === 0,
            `Timeline presentation matrix failed: ${acceptanceFailures.slice(0, 30).join(', ')}`,
            'TIMELINE_BROWSER_MATRIX_PRESENTATION_FAILED');
        const blockedWriteInventory = [...new Set(blockedWrites)].sort();
        fail(blockedWriteInventory.length === 0,
            `Browser matrix attempted a write request: ${blockedWriteInventory.join(', ')}`,
            'TIMELINE_BROWSER_MATRIX_WRITE_ATTEMPTED');
        return {
            success: true,
            runId: options.runId,
            bookingCount: bookingIds.length,
            cases,
            blockedWriteCount: blockedWrites.length,
            suppressedExternalWriteCount: suppressedExternalWrites.length
        };
    } finally {
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
    }
}

function publicError(error) {
    return {
        success: false,
        code: error?.code || 'TIMELINE_BROWSER_MATRIX_FAILED',
        message: String(error?.message || 'Browser matrix failed').slice(0, 500)
    };
}

async function main() {
    const args = process.argv.slice(2);
    const options = {
        liveUrl: argValue(args, '--live-url'),
        date: argValue(args, '--date'),
        runId: argValue(args, '--run-id'),
        stateFile: path.resolve(argValue(args, '--state-file')),
        outputDirectory: path.resolve(argValue(args, '--output-dir')),
        secretFile: path.resolve(argValue(args, '--secret-file', DEFAULT_SECRET_FILE))
    };
    return run(options);
}

if (require.main === module) {
    main()
        .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
        .catch(error => {
            process.stderr.write(`${JSON.stringify(publicError(error))}\n`);
            process.exitCode = 1;
        });
}

module.exports = {
    ALLOWED_POST_PATHS,
    MIN_COMPACT_IDENTITY_FONT_PX,
    VIEWPORTS,
    ZOOMS,
    caseAcceptanceFailures,
    publicError,
    readBookingIds,
    run
};
