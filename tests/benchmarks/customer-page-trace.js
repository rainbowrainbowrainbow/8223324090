'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const base = new URL(process.env.BENCHMARK_URL);
assert.equal(base.protocol, 'http:');
assert.equal(base.hostname, '127.0.0.1');
assert.match(process.env.PGDATABASE || '', /^eventgenix_perf(?:_small)?_test$/);
assert.equal(process.env.NODE_ENV, 'test');
assert.ok(!process.env.DATABASE_URL && !process.env.RAILWAY_PROJECT_ID);
const seconds = Number(process.env.BENCHMARK_TRACE_SECONDS);
assert.ok(Number.isInteger(seconds) && seconds >= 15 && seconds <= 300);
assert.ok(path.isAbsolute(process.env.BENCHMARK_BROWSER_MODULE || ''));
const screenshotDir = process.env.BENCHMARK_TRACE_SCREENSHOT_DIR;
const version = process.env.BENCHMARK_TRACE_VERSION;
if (screenshotDir) {
    assert.ok(path.isAbsolute(screenshotDir));
    assert.ok(['before', 'after'].includes(version));
}

async function main() {
    const { chromium } = require(process.env.BENCHMARK_BROWSER_MODULE);
    const browser = await chromium.launch({
        headless: true, executablePath: process.env.BENCHMARK_BROWSER_EXECUTABLE || undefined
    });
    try {
        const context = await browser.newContext({
            serviceWorkers: 'block',
            ...(screenshotDir ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {})
        });
        await context.route('**/*', route => {
            const request = route.request();
            const url = new URL(request.url());
            if (url.origin !== base.origin) return route.abort();
            if (['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || url.pathname === '/api/auth/login') {
                return route.continue();
            }
            return route.abort();
        });
        if (context.routeWebSocket) await context.routeWebSocket('**/*', socket => socket.close());
        const loginPage = await context.newPage();
        await loginPage.goto(new URL('/', base).href);
        await loginPage.locator('#username').fill('bench_creator');
        await loginPage.locator('#password').fill(process.env.BOOTSTRAP_CREATOR_PASSWORD);
        await loginPage.locator('#loginForm button[type="submit"]').click();
        await loginPage.waitForFunction(() => window.isAuthenticatedRuntimeReady?.());
        await loginPage.waitForLoadState('networkidle');
        await loginPage.close();

        // A fresh page keeps login and timeline bootstrap requests out of the trace.
        const page = await context.newPage();
        let phase = 'open';
        const phases = {};
        const jobs = [];
        const bookingInitiators = [];
        const session = await context.newCDPSession(page);
        await session.send('Network.enable');
        session.on('Network.requestWillBeSent', ({ request, initiator }) => {
            const url = new URL(request.url);
            if (url.origin !== base.origin || !/^\/api\/bookings\/\d{4}-\d{2}-\d{2}$/.test(url.pathname)) return;
            const frames = initiator.stack?.callFrames || [];
            bookingInitiators.push({ phase, mode: url.searchParams.get('timelineView'), frames: frames.slice(0, 10)
                .map(frame => `${path.posix.basename(new URL(frame.url || base).pathname)}:${frame.lineNumber + 1}:${frame.functionName}`) });
        });
        const requestPhases = new WeakMap();
        function collect(name) {
            return phases[name] ||= { requests: 0, failed: 0, bodyBytes: 0, jsBodyBytes: 0, api: {}, bookingScopes: {} };
        }
        page.on('request', request => requestPhases.set(request, phase));
        page.on('requestfailed', request => {
            if (new URL(request.url()).origin === base.origin) collect(requestPhases.get(request) || phase).failed++;
        });
        page.on('requestfinished', request => {
            const url = new URL(request.url());
            if (url.origin !== base.origin) return;
            const bucket = collect(requestPhases.get(request) || phase);
            bucket.requests++;
            jobs.push(request.sizes().then(({ responseBodySize }) => {
                bucket.bodyBytes += responseBodySize;
                if (request.resourceType() === 'script') bucket.jsBodyBytes += responseBodySize;
                if (url.pathname.startsWith('/api/')) {
                    const key = request.method() + ' ' + url.pathname.replace(/\/\d+(?=\/|$)/g, '/:id');
                    const api = bucket.api[key] ||= { requests: 0, bodyBytes: 0 };
                    api.requests++;
                    api.bodyBytes += responseBodySize;
                    if (/^\/api\/bookings\/\d{4}-\d{2}-\d{2}$/.test(url.pathname)) {
                        const view = url.searchParams.get('timelineView') || 'default';
                        const context = url.searchParams.get('businessContext') || 'default';
                        assert.match(view, /^(default|animators|rooms)$/);
                        assert.match(context, /^(default|event_genix|dar|maysternya)$/);
                        const scope = `${context}/${view}`;
                        bucket.bookingScopes[scope] = (bucket.bookingScopes[scope] || 0) + 1;
                    }
                }
            }).catch(() => { bucket.failed++; }));
        });

        await page.goto(new URL('/customers?tab=list', base).href, { waitUntil: 'networkidle' });
        await page.locator('#customerTableBody tr').first().waitFor({ state: 'attached' });
        phase = 'search';
        const searched = page.waitForResponse(response => {
            const url = new URL(response.url());
            return url.pathname === '/api/customers' && url.searchParams.has('search') && response.ok();
        });
        await page.locator('#customerSearchInput').click();
        await page.locator('#customerSearchInput').fill('Bench Family 02347');
        await searched;
        await page.waitForLoadState('networkidle');
        phase = 'visible';
        assert.equal(await page.evaluate(() => document.visibilityState), 'visible');
        await delay(seconds * 1000);
        phase = 'hidden';
        const front = await context.newPage();
        await front.bringToFront();
        const nativeHidden = await page.evaluate(() => document.visibilityState === 'hidden');
        if (!nativeHidden) {
            // A headless engine can keep every tab visible. Exercise the
            // application visibility handlers without claiming native throttling.
            await page.evaluate(() => {
                Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
                Object.defineProperty(document, 'hidden', { configurable: true, value: true });
                document.dispatchEvent(new Event('visibilitychange'));
            });
        }
        await delay(seconds * 1000);
        let mobile;
        if (screenshotDir) {
            phase = 'controls';
            await front.close();
            await page.bringToFront();
            if (!nativeHidden) {
                await page.evaluate(() => {
                    delete document.visibilityState;
                    delete document.hidden;
                    document.dispatchEvent(new Event('visibilitychange'));
                });
            }
            await page.locator('#sidebarToggle').click();
            await page.waitForFunction(() => document.querySelector('#sidebarNav')?.classList.contains('open'));
            assert.equal(await page.locator('#sidebarToggle').getAttribute('aria-expanded'), 'true');
            const counts = await page.locator('#sidebarNav [data-sidebar-timeline-count-mode]').evaluateAll(nodes =>
                nodes.map(node => ({ mode: node.dataset.sidebarTimelineCountMode, status: node.dataset.sidebarTimelineCountStatus,
                    text: node.textContent.trim() })));
            assert.ok(counts.some(row => row.status === 'ready' && /^\d+$/.test(row.text)), 'Expected a rendered timeline count');
            const screenshot = path.join(screenshotDir, `customer-sidebar-${version}-390.png`);
            await page.screenshot({ path: screenshot, animations: 'disabled' });
            await page.locator('#sidebarOverlay').click({ position: { x: 380, y: 30 } });
            await page.waitForFunction(() => !document.querySelector('#sidebarNav')?.classList.contains('open'));
            assert.equal(await page.locator('#sidebarToggle').getAttribute('aria-expanded'), 'false');
            mobile = { width: 390, counts, screenshot: path.basename(screenshot) };
        }
        await Promise.all(jobs);
        console.log(JSON.stringify({ seconds, nativeHidden, mobile, bookingInitiators, phases: {
            open: collect('open'), search: collect('search'), visible: collect('visible'), hidden: collect('hidden')
        } }));
    } finally {
        await browser.close();
    }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
