#!/usr/bin/env node
'use strict';

/**
 * Controlled live/staging browser write acceptance smoke for the HR staff profile.
 *
 * Safety contract:
 * - Requires LIVE_HR_PROFILE_WRITE_CONFIRM=I_CONFIRM_HR_PROFILE_QA_WRITES.
 * - Requires an explicit QA staff id and rejects non-QA-looking names by default.
 * - Changes only the phone field through the real "Save main" browser action.
 * - Verifies the exact main-scope payload and restores the original phone in finally.
 * - The two update audit entries are intentional and remain in the staff history.
 * - It never touches documents, resources, payroll, or the offboarding flow.
 *
 * PowerShell usage:
 *   $env:LIVE_HR_PROFILE_WRITE_CONFIRM = 'I_CONFIRM_HR_PROFILE_QA_WRITES'
 *   $env:LIVE_HR_PROFILE_QA_STAFF_ID = '123'
 *   $env:LIVE_HR_PROFILE_WRITE_URL = 'https://example.up.railway.app'
 *   npm run smoke:hr-team:write
 */

const assert = require('node:assert/strict');
const path = require('node:path');

const TARGET_URL = process.argv.find(arg => /^https?:\/\//i.test(arg))
    || readEnv('LIVE_HR_PROFILE_WRITE_URL', 'LIVE_HR_PROFILE_URL', 'LIVE_SMOKE_URL', 'TEST_URL');
const BUSINESS_CONTEXT = readEnv('LIVE_HR_PROFILE_BUSINESS_CONTEXT', 'LIVE_SMOKE_BUSINESS_CONTEXT') || 'event_genix';
const TIMEOUT_MS = Number(readEnv('LIVE_HR_PROFILE_WRITE_TIMEOUT_MS', 'LIVE_SMOKE_TIMEOUT_MS') || 30000);
const CONFIRM_TOKEN = 'I_CONFIRM_HR_PROFILE_QA_WRITES';
const QA_STAFF_ID = parsePositiveInt(readEnv('LIVE_HR_PROFILE_QA_STAFF_ID', 'HR_PROFILE_QA_STAFF_ID'));
const QA_NAME_PATTERN = readEnv('LIVE_HR_PROFILE_QA_NAME_PATTERN', 'HR_PROFILE_QA_NAME_PATTERN') || '\\b(QA|Codex|Test|Smoke)\\b';
const ALLOW_NON_QA_STAFF = readEnv('LIVE_HR_PROFILE_ALLOW_NON_QA_STAFF') === 'true';
const RUN_ID = `hr-profile-write-${new Date().toISOString().replace(/[:.]/g, '-')}`;

function readEnv(...names) {
    for (const name of names) {
        const value = process.env[name];
        if (String(value || '').trim()) return String(value).trim();
    }
    return '';
}

function parsePositiveInt(value) {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeBase(url) {
    try {
        return new URL(url).origin;
    } catch {
        throw new Error('provide a valid target URL or LIVE_HR_PROFILE_WRITE_URL/LIVE_SMOKE_URL/TEST_URL');
    }
}

function assertConfigured() {
    if (readEnv('LIVE_HR_PROFILE_WRITE_CONFIRM') !== CONFIRM_TOKEN) {
        throw new Error(`set LIVE_HR_PROFILE_WRITE_CONFIRM=${CONFIRM_TOKEN}`);
    }
    if (!QA_STAFF_ID) throw new Error('set LIVE_HR_PROFILE_QA_STAFF_ID to an explicit QA staff id');
    if (!TARGET_URL) throw new Error('provide target URL or LIVE_HR_PROFILE_WRITE_URL/LIVE_SMOKE_URL/TEST_URL');
}

async function readBody(response) {
    const text = await response.text();
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
    const hasBody = Object.prototype.hasOwnProperty.call(options, 'body');
    const response = await fetch(`${base}${routePath}`, {
        method: options.method || 'GET',
        headers: {
            Accept: 'application/json',
            ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
            ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
        },
        body: hasBody ? JSON.stringify(options.body) : undefined
    });
    const body = await readBody(response);
    if (!response.ok) {
        throw new Error(`${routePath} returned ${response.status}${responseDetail(body) ? `: ${responseDetail(body)}` : ''}`);
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
    const token = readEnv('LIVE_HR_PROFILE_WRITE_TOKEN', 'LIVE_HR_PROFILE_TOKEN', 'LIVE_SMOKE_TOKEN', 'LIVE_SMOKE_BEARER_TOKEN');
    if (token) {
        const verified = await fetchJson(base, '/api/auth/verify', { token });
        return { token, user: verified.user || verified };
    }

    const username = readEnv('LIVE_HR_PROFILE_WRITE_USER', 'LIVE_HR_PROFILE_USER', 'LIVE_SMOKE_USER', 'LIVE_SMOKE_USERNAME', 'TEST_USER');
    const password = readEnv('LIVE_HR_PROFILE_WRITE_PASS', 'LIVE_HR_PROFILE_WRITE_PASSWORD', 'LIVE_HR_PROFILE_PASS', 'LIVE_HR_PROFILE_PASSWORD', 'LIVE_SMOKE_PASS', 'LIVE_SMOKE_PASSWORD', 'TEST_PASS', 'TEST_PASSWORD');
    if (!username || !password) throw new Error('provide a live smoke token or username/password credentials');

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
        user: body.user || null
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
            const packageDir = path.join(path.dirname(normalized), 'playwright');
            try {
                return require(packageDir);
            } catch {
                // Continue through the npx package paths.
            }
        }
        throw err;
    }
}

function staffName(staff = {}) {
    return String(staff.display_name || staff.name || staff.username || '').trim();
}

function assertQaStaff(staff) {
    assert.ok(staff, 'QA staff was found');
    if (ALLOW_NON_QA_STAFF) return;
    const haystack = [staff.name, staff.display_name, staff.username, staff.position, staff.role_type]
        .filter(Boolean)
        .join(' ');
    assert.match(haystack, new RegExp(QA_NAME_PATTERN, 'i'), `staff name/metadata must match QA pattern ${QA_NAME_PATTERN}`);
}

function nullable(value) {
    return value === null || value === undefined || value === '' ? null : String(value);
}

async function loadStaffProfile(base, token, staffId) {
    const body = await fetchJson(base, `/api/hr/staff/${staffId}`, { token });
    if (!body?.success || !body.data) throw new Error(body?.error || 'staff profile did not load');
    return body.data;
}

async function restoreOriginalPhone(base, token, staffId, originalPhone) {
    const body = await fetchJson(base, `/api/hr/staff/${staffId}`, {
        method: 'PUT',
        token,
        body: { phone: originalPhone }
    });
    if (!body?.success) throw new Error(body?.error || 'phone restore was rejected');
    const restored = await loadStaffProfile(base, token, staffId);
    assert.equal(nullable(restored.phone), nullable(originalPhone), 'original phone is restored');
}

function testPhoneValue() {
    return `+380000${String(Date.now()).slice(-6)}`;
}

function staffPageUrl(base) {
    const url = new URL('/hr', base);
    url.hash = 'team';
    url.searchParams.set('businessContext', BUSINESS_CONTEXT);
    url.searchParams.set('smoke', RUN_ID);
    return url.toString();
}

async function openAuthenticatedPage(browser, session) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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

async function savePhoneThroughDrawer(page, base, staffId, profile, phone, options = {}) {
    const updatePayloads = [];
    const staffRoute = `/api/hr/staff/${staffId}`;
    page.on('request', request => {
        if (request.method() !== 'PUT') return;
        if (new URL(request.url()).pathname !== staffRoute) return;
        try {
            updatePayloads.push(JSON.parse(request.postData() || '{}'));
        } catch {
            updatePayloads.push(null);
        }
    });

    await page.goto(staffPageUrl(base), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.openStaffEdit === 'function' && Boolean(document.getElementById('staffEditModal')));
    await page.evaluate(id => window.openStaffEdit(id), staffId);
    await page.waitForFunction(id => {
        const modal = document.getElementById('staffEditModal');
        const currentId = document.getElementById('editStaffId');
        const phoneInput = document.getElementById('editPhone');
        return modal?.style.display !== 'none'
            && modal?.getAttribute('aria-hidden') === 'false'
            && Number(currentId?.value) === Number(id)
            && !phoneInput?.disabled;
    }, staffId);

    await page.locator('#editPhone').fill(phone);
    const save = page.locator('#editSave');
    options.onWriteStarted?.();
    await Promise.all([
        page.waitForResponse(response => response.request().method() === 'PUT'
            && new URL(response.url()).pathname === staffRoute
            && response.ok()),
        save.click()
    ]);
    await page.waitForFunction(() => {
        const button = document.getElementById('editSave');
        return button?.dataset.actionState === 'success';
    });
    await page.waitForFunction(() => {
        const button = document.getElementById('editSave');
        return !button?.dataset.actionState && button?.disabled === false;
    });

    assert.equal(updatePayloads.length, 1, 'one profile update request is sent');
    const payload = updatePayloads[0];
    assert.ok(payload && typeof payload === 'object', 'profile update request has JSON payload');
    const expectedPayloadFields = ['name', 'phone', 'photo_url'];
    assert.deepEqual(Object.keys(payload).sort(), expectedPayloadFields.sort(), 'main save sends only its declared scope');
    assert.equal(payload.phone, phone, 'main save sends the changed phone');
    assert.equal(nullable(payload.name), nullable(profile.name), 'main save preserves the current name');
    assert.equal(nullable(payload.photo_url), nullable(profile.photo_url), 'main save preserves the current photo');
}

async function main() {
    let browser;
    let context;
    let base;
    let session;
    let profile;
    let writeMayHaveOccurred = false;
    let mainError = null;
    let restoreError = null;

    try {
        assertConfigured();
        base = normalizeBase(TARGET_URL);
        session = await login(base);
        profile = await loadStaffProfile(base, session.token, QA_STAFF_ID);
        assertQaStaff(profile);

        const { chromium } = requirePlaywright();
        browser = await chromium.launch({ headless: true });
        const opened = await openAuthenticatedPage(browser, session);
        context = opened.context;
        const nextPhone = testPhoneValue();
        await savePhoneThroughDrawer(opened.page, base, QA_STAFF_ID, profile, nextPhone, {
            onWriteStarted: () => { writeMayHaveOccurred = true; }
        });

        const fresh = await loadStaffProfile(base, session.token, QA_STAFF_ID);
        assert.equal(nullable(fresh.phone), nullable(nextPhone), 'saved phone persists through the API');
        assert.equal(nullable(fresh.notes), nullable(profile.notes), 'main save does not alter work notes');
    } catch (error) {
        mainError = error;
    } finally {
        if (writeMayHaveOccurred && base && session?.token && profile) {
            try {
                await restoreOriginalPhone(base, session.token, QA_STAFF_ID, profile.phone);
            } catch (error) {
                restoreError = error;
            }
        }
        if (context) await context.close().catch(() => {});
        if (browser) await browser.close().catch(() => {});
    }

    if (restoreError) throw new Error(`original phone restore failed: ${restoreError.message || restoreError}`);
    if (mainError) throw mainError;
    console.log(`Live HR staff profile write smoke OK: ${base}`);
    console.log(`  OK QA staff: #${QA_STAFF_ID} ${staffName(profile)}`);
    console.log('  OK browser main-save action -> exact scope payload -> API persistence -> restore');
}

main().catch(error => {
    console.error(`Live HR staff profile write smoke failed: ${error.stack || error.message || String(error)}`);
    process.exit(1);
});
