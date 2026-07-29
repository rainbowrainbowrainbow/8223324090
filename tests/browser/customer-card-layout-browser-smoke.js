#!/usr/bin/env node
'use strict';

/**
 * Read-only customer-card layout regression smoke.
 *
 * Default: starts a deterministic local fixture built from the real
 * customers.html inline styles and customer CSS files.
 *
 * Live/staging: pass a URL and CUSTOMER_CARD_LAYOUT_SMOKE_CUSTOMER_ID.
 * Non-local runs additionally require CUSTOMER_CARD_LAYOUT_SMOKE_ALLOW_PRODUCTION=true.
 * The browser blocks every non-read API request.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const TARGET_URL = process.argv.find(arg => /^https?:\/\//i.test(arg))
    || readEnv('CUSTOMER_CARD_LAYOUT_SMOKE_URL', 'LIVE_SMOKE_URL', 'TEST_URL');
const TEST_CUSTOMER_ID = readEnv('CUSTOMER_CARD_LAYOUT_SMOKE_CUSTOMER_ID');
const EXPECTED_NAME = readEnv('CUSTOMER_CARD_LAYOUT_SMOKE_EXPECT_NAME');
const ALLOW_NON_LOCAL = readEnv('CUSTOMER_CARD_LAYOUT_SMOKE_ALLOW_PRODUCTION') === 'true';
const HEADLESS = readEnv('CUSTOMER_CARD_LAYOUT_SMOKE_HEADLESS', 'LIVE_SMOKE_HEADLESS') !== 'false';
const TIMEOUT_MS = Number(readEnv('CUSTOMER_CARD_LAYOUT_SMOKE_TIMEOUT_MS', 'LIVE_SMOKE_TIMEOUT_MS') || 30000);
const BUSINESS_CONTEXT = readEnv('CUSTOMER_CARD_LAYOUT_SMOKE_BUSINESS_CONTEXT', 'LIVE_SMOKE_BUSINESS_CONTEXT') || 'event_genix';
const SIMULATE_REGRESSION = readEnv('CUSTOMER_CARD_LAYOUT_SMOKE_SIMULATE_REGRESSION') === 'true';
const OUTPUT_DIR = path.join(ROOT, 'output', 'playwright', 'customer-card-layout-smoke');

const VIEWPORTS = Object.freeze([
    Object.freeze({ label: '1440', width: 1440, height: 900, minTitleWidth: 160 }),
    Object.freeze({ label: '1024', width: 1024, height: 900, minTitleWidth: 160 }),
    Object.freeze({ label: '720', width: 720, height: 900, minTitleWidth: 150 }),
    Object.freeze({ label: '390', width: 390, height: 844, minTitleWidth: 128 })
]);
const THEMES = Object.freeze(['dark', 'light']);

function readEnv(...names) {
    for (const name of names) {
        const value = process.env[name];
        if (String(value || '').trim()) return String(value).trim();
    }
    return '';
}

function fail(message) {
    console.error(`Customer card layout browser smoke failed: ${message}`);
    process.exit(1);
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

function normalizeBase(value) {
    try {
        return new URL(value).origin;
    } catch {
        throw new Error(`invalid URL "${value || ''}"`);
    }
}

function isLocalBase(base) {
    return ['localhost', '127.0.0.1', '::1'].includes(new URL(base).hostname);
}

function localCustomerStyles() {
    const html = fs.readFileSync(path.join(ROOT, 'customers.html'), 'utf8');
    const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] || '';
    const tags = head.match(/<style\b[^>]*>[\s\S]*?<\/style>|<link\b[^>]*>/gi) || [];
    const styles = [];

    for (const tag of tags) {
        if (/^<style\b/i.test(tag)) {
            styles.push(tag);
            continue;
        }
        if (!/\brel=["']stylesheet["']/i.test(tag)) continue;
        const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1] || '';
        const pathname = href.split(/[?#]/, 1)[0].replace(/^\/+/, '');
        if (!pathname.startsWith('css/')) continue;
        const absolute = path.resolve(ROOT, pathname);
        assert.equal(absolute.startsWith(path.join(ROOT, 'css') + path.sep), true, `safe CSS path: ${pathname}`);
        styles.push(`<style data-source="${pathname}">${fs.readFileSync(absolute, 'utf8')}</style>`);
    }

    assert.ok(styles.some(style => style.includes('customer-detail-hero')), 'customer page styles were collected');
    return styles.join('\n');
}

function fixtureHtml() {
    const regression = SIMULATE_REGRESSION
        ? '<style>.customer-detail-hero.entity-card-header{display:flex!important}.customer-detail-hero .customer-hero-title h3{position:absolute!important}</style>'
        : '';
    return `<!doctype html>
<html lang="uk" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${localCustomerStyles()}
<style data-smoke-stability>*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}</style>
${regression}
</head>
<body class="dark-mode" data-page-group="mgmt">
<div id="customerDetailModal" class="modal" role="dialog" aria-modal="true" aria-label="Деталі тестового клієнта">
  <div class="modal-content modal-medium entity-card-modal" role="document">
    <button type="button" class="modal-close" data-customer-detail-close aria-label="Закрити картку клієнта">&times;</button>
    <div id="customerDetailContent">
      <div class="entity-card-shell entity-card-shell-view entity-card-customer" data-entity-card-mode="customer">
        <div class="customer-detail-header entity-card-header customer-detail-hero">
          <div class="customer-hero-identity">
            <div class="customer-hero-avatar" aria-hidden="true">ТК</div>
            <div class="entity-card-title-block customer-hero-title">
              <h3>Тестовий Клієнт Із Надзвичайно Довгим Горизонтальним Іменем</h3>
              <div class="entity-card-meta customer-hero-contact-summary"><span>+380991234567890123456789</span><span>@test_customer_with_a_very_long_handle</span></div>
            </div>
          </div>
          <div class="customer-hero-summary" aria-label="Операційний контекст клієнта">
            <div class="customer-hero-tile customer-hero-stage"><span>Етап воронки</span><strong>Постійний тестовий клієнт</strong><small>Лід #700000</small></div>
            <div class="customer-hero-tile customer-hero-booking muted"><span>Бронювання</span><strong>Бронювань немає</strong><small>Історія порожня</small></div>
          </div>
          <div class="entity-card-actions customer-hero-actions" aria-label="Дії клієнта">
            <div class="customer-hero-action-group"><span class="btn-page-secondary entity-card-action customer-hero-omni search">Omni: пошук</span><button type="button" class="btn-page-secondary entity-card-action">Редагувати</button></div>
            <div class="customer-hero-action-group customer-hero-danger-group"><button type="button" class="btn-page-secondary entity-card-action danger">Видалити</button></div>
          </div>
        </div>
        <div class="detail-section"><h4>Контакти</h4><div class="detail-grid customer-contact-grid">
          <div class="detail-field"><div class="field-label">Телефон</div><div class="field-value">+380991234567890123456789</div></div>
          <div class="detail-field"><div class="field-label">Instagram</div><div class="field-value">@test_customer_with_a_very_long_handle</div></div>
          <div class="detail-field"><div class="field-label">Джерело</div><div class="field-value">Надзвичайно довга назва тестового джерела клієнта</div></div>
        </div></div>
      </div>
    </div>
  </div>
</div>
</body>
</html>`;
}

function startFixtureServer() {
    const html = fixtureHtml();
    const requests = [];
    const server = http.createServer((req, res) => {
        const pathname = new URL(req.url, 'http://fixture').pathname;
        requests.push(`${req.method} ${pathname}`);
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
            res.writeHead(405).end();
            return;
        }
        if (pathname === '/' || pathname === '/customers.html') {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
            res.end(req.method === 'HEAD' ? '' : html);
            return;
        }
        if (pathname === '/favicon.ico') {
            res.writeHead(204).end();
            return;
        }
        res.writeHead(404).end();
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve({
            server,
            requests,
            base: `http://127.0.0.1:${server.address().port}`
        }));
    });
}

async function readBody(response) {
    const text = await response.text();
    try {
        return text ? JSON.parse(text) : null;
    } catch {
        return text;
    }
}

async function fetchJson(base, routePath, options = {}) {
    const response = await fetch(`${base}${routePath}`, {
        method: options.method || 'GET',
        headers: {
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    const body = await readBody(response);
    if (!response.ok) {
        const detail = body?.error || body?.message || body?.code || (typeof body === 'string' ? body : '');
        throw new Error(`${routePath} returned ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    return body;
}

function extractToken(body = {}) {
    return body.accessToken || body.access_token || body.token || body.jwt || body.data?.accessToken || body.data?.token || '';
}

async function login(base) {
    const token = readEnv('CUSTOMER_CARD_LAYOUT_SMOKE_TOKEN', 'LIVE_SMOKE_TOKEN', 'LIVE_SMOKE_BEARER_TOKEN');
    if (token) {
        const verified = await fetchJson(base, '/api/auth/verify', { token });
        return { token, user: verified.user || verified, source: 'token' };
    }
    const username = readEnv('CUSTOMER_CARD_LAYOUT_SMOKE_USER', 'LIVE_SMOKE_USER', 'LIVE_SMOKE_USERNAME', 'TEST_USER');
    const password = readEnv('CUSTOMER_CARD_LAYOUT_SMOKE_PASS', 'LIVE_SMOKE_PASS', 'LIVE_SMOKE_PASSWORD', 'TEST_PASS', 'TEST_PASSWORD');
    if (!username || !password) throw new Error('provide CUSTOMER_CARD_LAYOUT_SMOKE_TOKEN or CUSTOMER_CARD_LAYOUT_SMOKE_USER/CUSTOMER_CARD_LAYOUT_SMOKE_PASS');
    const body = await fetchJson(base, '/api/auth/login', { method: 'POST', body: { username, password } });
    const tokenValue = extractToken(body);
    if (!tokenValue) throw new Error('/api/auth/login did not return an access token');
    return {
        token: tokenValue,
        refreshToken: body.refreshToken || '',
        refreshExpiresAt: body.refreshExpiresAt || '',
        user: body.user || null,
        source: 'login'
    };
}

async function openLiveCustomer(page, base, customerId) {
    const url = new URL('/customers.html', base);
    url.searchParams.set('businessContext', BUSINESS_CONTEXT);
    url.searchParams.set('customerCardLayoutSmoke', 'true');
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.showCustomerDetail === 'function');
    await page.evaluate(id => window.showCustomerDetail(id), Number(customerId));
    await page.waitForSelector('#customerDetailModal:not(.hidden) .customer-detail-hero');
    if (EXPECTED_NAME) {
        const name = await page.locator('.customer-detail-hero .customer-hero-title h3').textContent();
        assert.ok(String(name || '').includes(EXPECTED_NAME), `opened expected safe test record: ${EXPECTED_NAME}`);
    }
}

async function setTheme(page, theme) {
    await page.evaluate(nextTheme => {
        const dark = nextTheme === 'dark';
        if (typeof window.applyCrmThemeMode === 'function') window.applyCrmThemeMode(dark, true);
        document.body.classList.toggle('dark-mode', dark);
        document.documentElement.setAttribute('data-theme', nextTheme);
        document.documentElement.style.colorScheme = nextTheme;
        localStorage.setItem('pzp_dark_mode', String(dark));
    }, theme);
    await page.waitForTimeout(60);
}

async function layoutMetrics(page) {
    return page.evaluate(() => {
        const header = document.querySelector('.customer-detail-hero.entity-card-header');
        const title = header?.querySelector('.customer-hero-title');
        const heading = title?.querySelector('h3');
        const modalContent = document.querySelector('#customerDetailModal .entity-card-modal');
        const editAction = header?.querySelector('button.entity-card-action:not(.danger):not(:disabled):not([aria-disabled="true"])');
        let disabledAction = header?.querySelector('[data-smoke-disabled-action]');
        if (!disabledAction && editAction && location.hostname === '127.0.0.1') {
            disabledAction = editAction.cloneNode(true);
            disabledAction.disabled = true;
            disabledAction.hidden = true;
            disabledAction.dataset.smokeDisabledAction = '';
            disabledAction.style.setProperty('display', 'none', 'important');
            editAction.after(disabledAction);
        }
        if (!header || !title || !heading || !modalContent || !editAction) return null;
        const rect = element => {
            const value = element.getBoundingClientRect();
            return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height };
        };
        const appearance = element => {
            if (!element) return null;
            const style = getComputedStyle(element);
            return { color: style.color, background: style.backgroundColor, opacity: style.opacity };
        };
        const longValues = [...document.querySelectorAll('.customer-hero-contact-summary span, .customer-contact-grid .field-value')].map(element => {
            const style = getComputedStyle(element);
            return { text: element.textContent.trim(), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, overflowX: style.overflowX, textOverflow: style.textOverflow, whiteSpace: style.whiteSpace };
        });
        return {
            display: getComputedStyle(header).display,
            headingPosition: getComputedStyle(heading).position,
            headingBackground: getComputedStyle(heading).backgroundColor,
            header: rect(header),
            title: rect(title),
            heading: rect(heading),
            modal: rect(modalContent),
            headerClientWidth: header.clientWidth,
            headerScrollWidth: header.scrollWidth,
            titleClientWidth: title.clientWidth,
            titleScrollWidth: title.scrollWidth,
            modalClientWidth: modalContent.clientWidth,
            modalScrollWidth: modalContent.scrollWidth,
            viewportWidth: window.innerWidth,
            documentScrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
            editAction: appearance(editAction),
            disabledAction: appearance(disabledAction),
            disabledNative: disabledAction?.disabled === true,
            longValues
        };
    });
}

function contrastRatio(foreground, background) {
    const parse = value => (String(value).match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const luminance = value => parse(value)
        .map(channel => channel / 255)
        .map(channel => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
        .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const first = luminance(foreground);
    const second = luminance(background);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function assertLayout(metrics, viewport, theme) {
    const label = `${theme}-${viewport.label}`;
    assert.ok(metrics, `${label}: customer header and active edit action exist`);
    assert.equal(metrics.display, 'grid', `${label}: computed customer header display is grid`);
    assert.equal(metrics.headingPosition, 'static', `${label}: computed customer name position is static`);
    assert.match(metrics.headingBackground, /^(?:transparent|rgba\(0, 0, 0, 0\))$/, `${label}: customer name background is transparent`);
    assert.ok(metrics.title.width >= viewport.minTitleWidth, `${label}: title width ${metrics.title.width}px >= ${viewport.minTitleWidth}px`);
    assert.ok(metrics.heading.width >= viewport.minTitleWidth, `${label}: heading width ${metrics.heading.width}px >= ${viewport.minTitleWidth}px`);
    assert.ok(metrics.headerScrollWidth <= metrics.headerClientWidth + 1, `${label}: header has no horizontal overflow`);
    assert.ok(metrics.titleScrollWidth <= metrics.titleClientWidth + 1, `${label}: title has no horizontal overflow`);
    assert.ok(metrics.modalScrollWidth <= metrics.modalClientWidth + 1, `${label}: modal has no horizontal overflow`);
    assert.ok(metrics.documentScrollWidth <= metrics.viewportWidth + 2, `${label}: document has no horizontal overflow`);
    assert.ok(metrics.header.left >= metrics.modal.left - 1, `${label}: header stays inside modal left edge`);
    assert.ok(metrics.header.right <= metrics.modal.right + 1, `${label}: header stays inside modal right edge`);
    assert.ok(contrastRatio(metrics.editAction.color, metrics.editAction.background) >= 4.5, `${label}: active Edit action has at least 4.5:1 text contrast`);
    assert.equal(metrics.editAction.opacity, '1', `${label}: active Edit action is not visually disabled`);
    assert.ok(metrics.longValues.length >= 3, `${label}: long contact values are covered`);
    metrics.longValues.forEach((value, index) => {
        assert.ok(value.scrollWidth <= value.clientWidth + 1, `${label}: long value ${index + 1} has no horizontal overflow`);
        assert.notEqual(value.overflowX, 'hidden', `${label}: long value ${index + 1} is not clipped`);
        assert.notEqual(value.textOverflow, 'ellipsis', `${label}: long value ${index + 1} is not ellipsized`);
        assert.equal(value.whiteSpace, 'normal', `${label}: long value ${index + 1} can wrap`);
    });
    if (theme === 'dark' && metrics.disabledAction) {
        assert.equal(metrics.disabledNative, true, `${label}: disabled fixture remains natively disabled`);
        assert.notEqual(metrics.editAction.color, metrics.disabledAction.color, `${label}: active Edit action does not inherit disabled appearance`);
    }
}

async function runVariants(page) {
    const results = [];
    for (const theme of THEMES) {
        await setTheme(page, theme);
        for (const viewport of VIEWPORTS) {
            await page.setViewportSize({ width: viewport.width, height: viewport.height });
            await page.waitForTimeout(100);
            const metrics = await layoutMetrics(page);
            assertLayout(metrics, viewport, theme);
            const screenshot = path.join(OUTPUT_DIR, `customer-card-${theme}-${viewport.label}.png`);
            await page.screenshot({ path: screenshot, fullPage: false });
            results.push({ theme, viewport: `${viewport.width}x${viewport.height}`, titleWidth: Math.round(metrics.title.width), editContrast: Math.round(contrastRatio(metrics.editAction.color, metrics.editAction.background) * 100) / 100, screenshot });
        }
    }
    return results;
}

async function run() {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const { chromium } = requirePlaywright();
    let fixture = null;
    let base = '';
    let session = null;

    if (TARGET_URL) {
        base = normalizeBase(TARGET_URL);
        if (!TEST_CUSTOMER_ID) throw new Error('live/staging mode requires CUSTOMER_CARD_LAYOUT_SMOKE_CUSTOMER_ID for a safe test record');
        if (!isLocalBase(base) && !ALLOW_NON_LOCAL) {
            throw new Error(`refusing non-local smoke for ${base}; set CUSTOMER_CARD_LAYOUT_SMOKE_ALLOW_PRODUCTION=true after approving the safe test record`);
        }
        session = await login(base);
    } else {
        fixture = await startFixtureServer();
        base = fixture.base;
    }

    const browser = await chromium.launch({ headless: HEADLESS });
    const context = await browser.newContext({ viewport: VIEWPORTS[0], serviceWorkers: 'block' });
    const blockedMutations = [];
    const serverErrors = [];
    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT_MS);

    if (session) {
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
    }

    await page.route('https://www.clarity.ms/**', route => route.abort());
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await page.route('https://fonts.gstatic.com/**', route => route.abort());
    await page.route('**/api/**', route => {
        const method = route.request().method().toUpperCase();
        if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return route.continue();
        blockedMutations.push(`${method} ${new URL(route.request().url()).pathname}`);
        return route.abort('blockedbyclient');
    });
    page.on('response', response => {
        if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`);
    });

    try {
        if (session) await openLiveCustomer(page, base, TEST_CUSTOMER_ID);
        else await page.goto(`${base}/customers.html`, { waitUntil: 'domcontentloaded' });
        const results = await runVariants(page);
        assert.deepEqual(blockedMutations, [], 'no customer mutation requests were attempted');
        assert.deepEqual(serverErrors, [], 'no server errors occurred');
        if (fixture) assert.deepEqual(fixture.requests.filter(request => !request.startsWith('GET ') && !request.startsWith('HEAD ')), [], 'fixture received read-only requests only');
        console.log(JSON.stringify({
            ok: true,
            mode: session ? 'live-read-only' : 'local-fixture',
            base,
            customerId: session ? TEST_CUSTOMER_ID : 'synthetic-safe-record',
            results: results.map(result => ({ ...result, screenshot: path.relative(ROOT, result.screenshot) })),
            blockedMutations
        }, null, 2));
    } finally {
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
        if (fixture) await new Promise(resolve => fixture.server.close(resolve));
    }
}

run().catch(error => fail(error?.stack || error?.message || String(error)));
