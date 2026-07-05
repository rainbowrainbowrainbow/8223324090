#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BUSINESS_CONTEXT = process.env.CUSTOMER_CHILD_BROWSER_SMOKE_BUSINESS_CONTEXT || 'event_genix';
const TARGET_URL = process.argv.find(arg => /^https?:\/\//i.test(arg))
    || process.env.CUSTOMER_CHILD_BROWSER_SMOKE_URL
    || process.env.LIVE_SMOKE_URL
    || process.env.TEST_URL;
const HEADLESS = process.env.CUSTOMER_CHILD_BROWSER_SMOKE_HEADLESS !== 'false';
const CLEANUP = process.env.CUSTOMER_CHILD_BROWSER_SMOKE_CLEANUP !== 'false';
const ALLOW_NON_LOCAL = process.env.CUSTOMER_CHILD_BROWSER_SMOKE_ALLOW_PRODUCTION === 'true';
const RUN_ID = `customer-child-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

function fail(message) {
    console.error(`Customer child browser smoke failed: ${message}`);
    process.exit(1);
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

function normalizeBase(url) {
    try {
        return new URL(url).origin;
    } catch {
        fail(`invalid URL "${url || ''}"`);
    }
}

function isLocalBase(base) {
    const host = new URL(base).hostname;
    return ['localhost', '127.0.0.1', '::1'].includes(host);
}

function authHeader(token) {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

function scopedPath(routePath, params = {}) {
    const url = new URL(routePath, 'http://local');
    if (!url.searchParams.has('businessContext')) {
        url.searchParams.set('businessContext', BUSINESS_CONTEXT);
    }
    Object.entries(params || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            url.searchParams.set(key, String(value));
        }
    });
    return `${url.pathname}${url.search}`;
}

async function readBody(res) {
    const text = await res.text();
    try {
        return text ? JSON.parse(text) : null;
    } catch {
        return text;
    }
}

async function fetchJson(base, routePath, options = {}) {
    const res = await fetch(`${base}${routePath}`, {
        method: options.method || 'GET',
        headers: {
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...authHeader(options.token)
        },
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    const body = await readBody(res);
    if (!res.ok) {
        const detail = body?.error || body?.message || body?.code || (typeof body === 'string' ? body : '') || `HTTP ${res.status}`;
        throw new Error(`${routePath} returned ${res.status}: ${detail}`);
    }
    return body;
}

async function login(base) {
    const envToken = process.env.CUSTOMER_CHILD_BROWSER_SMOKE_TOKEN || process.env.LIVE_SMOKE_TOKEN;
    if (envToken) {
        const verified = await fetchJson(base, '/api/auth/verify', { token: envToken });
        return { token: envToken, user: verified.user || verified };
    }

    const username = process.env.CUSTOMER_CHILD_BROWSER_SMOKE_USER || process.env.LIVE_SMOKE_USER || process.env.TEST_USER;
    const password = process.env.CUSTOMER_CHILD_BROWSER_SMOKE_PASS || process.env.LIVE_SMOKE_PASS || process.env.TEST_PASS;
    if (!username || !password) {
        fail('set CUSTOMER_CHILD_BROWSER_SMOKE_TOKEN or CUSTOMER_CHILD_BROWSER_SMOKE_USER/CUSTOMER_CHILD_BROWSER_SMOKE_PASS');
    }

    const body = await fetchJson(base, '/api/auth/login', {
        method: 'POST',
        body: { username, password }
    });
    const token = body.accessToken || body.token;
    if (!token) throw new Error('/api/auth/login did not return access token');
    return {
        token,
        refreshToken: body.refreshToken || '',
        refreshExpiresAt: body.refreshExpiresAt || '',
        user: body.user
    };
}

async function deleteCustomer(base, token, customerId) {
    if (!customerId || !CLEANUP) return;
    await fetchJson(base, scopedPath(`/api/customers/${encodeURIComponent(customerId)}`), {
        method: 'DELETE',
        token
    }).catch(err => console.warn(`cleanup customer ${customerId} failed: ${err.message}`));
}

async function assertSearchContains(base, token, query, customerId) {
    const rows = await fetchJson(base, scopedPath('/api/customers/search', { q: query }), { token });
    assert.ok(Array.isArray(rows), 'customer search returns array');
    assert.ok(rows.some(row => Number(row.id) === Number(customerId)), 'created customer is searchable');
    return rows;
}

async function assertSearchDeleted(base, token, query, customerId) {
    const rows = await fetchJson(base, scopedPath('/api/customers/search', { q: query }), { token });
    assert.ok(Array.isArray(rows), 'post-cleanup customer search returns array');
    assert.equal(rows.some(row => Number(row.id) === Number(customerId)), false, 'created customer was cleaned up');
}

async function openAuthenticatedCustomersPage(browser, base, session) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    await context.addInitScript(({ token, refreshToken, refreshExpiresAt, user }) => {
        localStorage.setItem('pzp_token', token);
        localStorage.setItem('pzp_access_token', token);
        if (refreshToken) localStorage.setItem('pzp_refresh_token', refreshToken);
        if (refreshExpiresAt) localStorage.setItem('pzp_refresh_expires_at', String(refreshExpiresAt));
        if (user) localStorage.setItem('pzp_current_user', JSON.stringify(user));
        localStorage.setItem('pzp_dark_mode', 'true');
    }, session);

    const page = await context.newPage();
    page.setDefaultTimeout(Number(process.env.CUSTOMER_CHILD_BROWSER_SMOKE_TIMEOUT_MS || 20000));
    await page.route('https://www.clarity.ms/**', route => route.abort());
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await page.route('https://fonts.gstatic.com/**', route => route.abort());
    await page.goto(`${base}/customers.html?businessContext=${encodeURIComponent(BUSINESS_CONTEXT)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#addCustomerBtn', { state: 'visible' });
    return { context, page };
}

async function fillAndSubmitCustomer(page, customerName, childName) {
    const addButton = page.locator('#addCustomerBtn');
    assert.equal(await addButton.isVisible(), true, 'add customer button is visible for smoke user');
    await addButton.click();
    await page.waitForSelector('#customerEditModal:not(.hidden) #editName');

    await page.fill('#editName', customerName);
    await page.fill('#editPhone', `+38099${String(Date.now()).slice(-7)}`);
    await page.selectOption('#editSource', 'manual');
    await page.click('#editAddChildBtn');
    await page.fill('#editChildName0', childName);
    await page.fill('#editChildBirthday0', '2019-05-20');
    await page.fill('#editChildNote0', `browser smoke ${RUN_ID}`);
    await page.fill('#editNotes', `QA browser smoke ${RUN_ID}`);

    const createResponsePromise = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === '/api/customers' && response.request().method() === 'POST';
    });
    await page.click('#saveCustomerBtn');
    const createResponse = await createResponsePromise;
    const body = await createResponse.json().catch(() => ({}));
    assert.equal(createResponse.ok(), true, `customer create response is ${createResponse.status()}: ${body?.error || ''}`);
    assert.ok(body.id, 'customer create returns id');
    assert.ok(Array.isArray(body.children), 'customer create returns children array');
    assert.ok(body.children.some(child => child.name === childName), 'customer create response includes child');
    return body;
}

async function verifyCreatedCustomerUi(page, customerName, childName) {
    await page.waitForSelector('#customerDetailModal:not(.hidden) #customerDetailContent', { timeout: 20000 });
    await page.waitForFunction(({ customerName, childName }) => {
        const text = document.querySelector('#customerDetailContent')?.innerText || '';
        return text.includes(customerName) && text.includes(childName);
    }, { customerName, childName }, { timeout: 20000 });
    const detailText = await page.locator('#customerDetailContent').textContent();
    assert.ok(String(detailText || '').includes(customerName), 'detail modal includes created customer name');
    assert.ok(String(detailText || '').includes(childName), 'detail modal includes child name');

    await page.locator('#customerDetailModal .modal-close').click();
    await page.waitForFunction(() => document.getElementById('customerDetailModal')?.classList.contains('hidden'));

    await page.fill('#searchInput', customerName);
    await page.waitForTimeout(450);
    await page.waitForFunction(name => document.body.innerText.includes(name), customerName);
    const bodyText = await page.locator('body').textContent();
    assert.ok(String(bodyText || '').includes(customerName), 'customer list search includes created customer');
}

async function run() {
    if (!TARGET_URL) fail('set CUSTOMER_CHILD_BROWSER_SMOKE_URL, LIVE_SMOKE_URL, TEST_URL, or pass a URL argument');
    const base = normalizeBase(TARGET_URL);
    if (!isLocalBase(base) && !ALLOW_NON_LOCAL) {
        fail(`refusing non-local browser smoke for ${base}; set CUSTOMER_CHILD_BROWSER_SMOKE_ALLOW_PRODUCTION=true for an explicitly approved protected run`);
    }

    let playwright;
    try {
        playwright = requirePlaywright();
    } catch {
        fail('Playwright is not available. Run through: npx --yes --package playwright node tests/browser/customer-child-create-browser-smoke.js');
    }

    const session = await login(base);
    const browser = await playwright.chromium.launch({ headless: HEADLESS });
    let context;
    let page;
    let createdId = null;
    const customerName = `QA Codex Child ${RUN_ID}`;
    const childName = `QA Child ${RUN_ID}`;
    const network500 = [];
    const consoleErrors = [];

    try {
        ({ context, page } = await openAuthenticatedCustomersPage(browser, base, session));
        page.on('response', response => {
            if (response.status() >= 500 && response.url().includes('/api/customers')) {
                network500.push(`${response.request().method()} ${new URL(response.url()).pathname} ${response.status()}`);
            }
        });
        page.on('console', message => {
            if (message.type() === 'error') consoleErrors.push(message.text());
        });

        const created = await fillAndSubmitCustomer(page, customerName, childName);
        createdId = created.id;
        await verifyCreatedCustomerUi(page, customerName, childName);
        await assertSearchContains(base, session.token, customerName, createdId);
        await deleteCustomer(base, session.token, createdId);
        if (CLEANUP) {
            await assertSearchDeleted(base, session.token, customerName, createdId);
            createdId = null;
        }

        assert.deepEqual(network500, [], 'no /api/customers 500 responses');
        assert.deepEqual(consoleErrors, [], 'no browser console errors');
        console.log(`Customer child browser smoke passed: created and cleaned QA customer on ${base}`);
    } finally {
        if (createdId) await deleteCustomer(base, session.token, createdId);
        await page?.close().catch(() => {});
        await context?.close().catch(() => {});
        await browser.close().catch(() => {});
    }
}

run().catch(error => {
    fail(error?.stack || error?.message || String(error));
});
