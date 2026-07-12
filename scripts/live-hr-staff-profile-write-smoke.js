#!/usr/bin/env node
'use strict';

/**
 * Opt-in live HR profile write acceptance smoke.
 *
 * Default scenarios: reversible one-field main/work writes on QA staff #818.
 * Extra scenarios are explicitly opt-in through LIVE_HR_PROFILE_WRITE_SCENARIOS:
 *   shift,rates,payroll
 *
 * Never touches roles, permissions, documents, resources, offboarding, pool status,
 * company structure, real schedule rows, or production fixtures other than the
 * explicitly allowed QA staff record.
 */

const assert = require('node:assert/strict');
const path = require('node:path');

const CONFIRM_TOKEN = 'I_CONFIRM_HR_PROFILE_QA_WRITES';
const TARGET_URL = process.argv.find(arg => /^https?:\/\//i.test(arg)) || env('LIVE_HR_PROFILE_WRITE_URL', 'TEST_URL');
const QA_STAFF_ID = positiveInt(env('LIVE_HR_PROFILE_QA_STAFF_ID'));
const DISPOSABLE_FIXTURE = env('LIVE_HR_PROFILE_DISPOSABLE_FIXTURE') === 'true';
const TIMEOUT_MS = Number(env('LIVE_HR_PROFILE_WRITE_TIMEOUT_MS') || 30000);
const BUSINESS_CONTEXT = env('LIVE_HR_PROFILE_BUSINESS_CONTEXT') || 'event_genix';
const SCENARIOS = new Set((env('LIVE_HR_PROFILE_WRITE_SCENARIOS') || 'main,work').split(',').map(value => value.trim()).filter(Boolean));
const RUN_ID = `hr-write-${Date.now()}`;

const FIELD_MATRIX = [
    { scenario: 'main', key: 'name', selector: '#editStaffName', tab: 'main', save: '#editSave', value: original => `${String(original || 'QA Staff').slice(0, 120)} QA` },
    { scenario: 'main', key: 'phone', selector: '#editPhone', tab: 'main', save: '#editSave', value: () => `+380000${String(Date.now()).slice(-6)}` },
    { scenario: 'main', key: 'photo_url', selector: '#editPhotoUrl', tab: 'main', save: '#editSave', value: original => original ? `${original}${original.includes('?') ? '&' : '?'}qa=${Date.now()}` : `https://example.invalid/hr-qa-${Date.now()}.png` },
    { scenario: 'work', key: 'address', selector: '#editAddress', tab: 'work', save: '#editSaveWork', value: () => `QA address ${RUN_ID}` },
    { scenario: 'work', key: 'birth_date', selector: '#editBirthDate', tab: 'work', save: '#editSaveWork', value: original => original === '2000-01-01' ? '2000-01-02' : '2000-01-01' },
    { scenario: 'work', key: 'emergency_contact', selector: '#editEmergencyContact', tab: 'work', save: '#editSaveWork', value: () => `QA Contact ${RUN_ID}` },
    { scenario: 'work', key: 'emergency_phone', selector: '#editEmergencyPhone', tab: 'work', save: '#editSaveWork', value: () => `+380001${String(Date.now()).slice(-6)}` },
    { scenario: 'work', key: 'telegram_username', selector: '#editTelegramUsername', tab: 'work', save: '#editSaveWork', value: () => `qa_${String(Date.now()).slice(-8)}` },
    { scenario: 'work', key: 'telegram_id', selector: '#editTelegramId', tab: 'work', save: '#editSaveWork', value: () => String(Date.now()).slice(-9) },
    { scenario: 'work', key: 'skills', selector: '#editSkills', tab: 'work', save: '#editSaveWork', value: () => `QA skill ${RUN_ID}`, payloadValue: value => [value] },
    { scenario: 'work', key: 'notes', selector: '#editNotes', tab: 'work', save: '#editSaveWork', value: () => `QA reversible ${RUN_ID}` }
];

function env(...names) {
    for (const name of names) if (String(process.env[name] || '').trim()) return String(process.env[name]).trim();
    return '';
}

function positiveInt(value) {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeBase(value) {
    try { return new URL(value).origin; } catch { throw new Error('set a valid LIVE_HR_PROFILE_WRITE_URL'); }
}

function assertConfigured() {
    if (env('LIVE_HR_PROFILE_WRITE_CONFIRM') !== CONFIRM_TOKEN) throw new Error(`set LIVE_HR_PROFILE_WRITE_CONFIRM=${CONFIRM_TOKEN}`);
    if (!TARGET_URL) throw new Error('set LIVE_HR_PROFILE_WRITE_URL');
    if (!QA_STAFF_ID) throw new Error('set LIVE_HR_PROFILE_QA_STAFF_ID');
    if (QA_STAFF_ID !== 818 && !DISPOSABLE_FIXTURE) throw new Error('writes are restricted to #818 unless LIVE_HR_PROFILE_DISPOSABLE_FIXTURE=true');
    for (const scenario of SCENARIOS) {
        if (!['main', 'work', 'shift', 'rates', 'payroll'].includes(scenario)) throw new Error(`unsupported scenario: ${scenario}`);
    }
}

async function readBody(response) {
    const text = await response.text();
    try { return text ? JSON.parse(text) : null; } catch { return text; }
}

async function fetchJson(base, route, options = {}) {
    const hasBody = Object.prototype.hasOwnProperty.call(options, 'body');
    const response = await fetch(`${base}${route}`, {
        method: options.method || 'GET',
        headers: { Accept: 'application/json', ...(hasBody ? { 'Content-Type': 'application/json' } : {}), ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
        body: hasBody ? JSON.stringify(options.body) : undefined
    });
    const body = await readBody(response);
    if (!response.ok) throw new Error(`${route} returned ${response.status}: ${body?.error || body?.message || ''}`);
    return body;
}

async function login(base) {
    const existing = env('LIVE_HR_PROFILE_WRITE_TOKEN');
    if (existing) return { token: existing, user: (await fetchJson(base, '/api/auth/verify', { token: existing })).user || null };
    const username = env('LIVE_HR_PROFILE_WRITE_USER', 'TEST_USER');
    const password = env('LIVE_HR_PROFILE_WRITE_PASS', 'TEST_PASS');
    if (!username || !password) throw new Error('provide write token or QA username/password');
    const body = await fetchJson(base, '/api/auth/login', { method: 'POST', body: { username, password } });
    const token = body.accessToken || body.access_token || body.token;
    if (!token) throw new Error('login did not return an access token');
    return { token, refreshToken: body.refreshToken || '', refreshExpiresAt: body.refreshExpiresAt || '', user: body.user || null };
}

async function loadProfile(base, token) {
    const body = await fetchJson(base, `/api/hr/staff/${QA_STAFF_ID}`, { token });
    assert.ok(body?.success && body.data, 'QA staff profile loads');
    assert.match([body.data.name, body.data.display_name, body.data.username].filter(Boolean).join(' '), /QA|Codex|Test|Smoke/i, 'target must be visibly marked as QA');
    return body.data;
}

function nullable(value) { return value === null || value === undefined || value === '' ? null : String(value); }
function comparable(value) { return Array.isArray(value) ? JSON.stringify(value.map(String)) : nullable(value); }

function requirePlaywright() {
    try { return require('playwright'); } catch (error) {
        for (const entry of String(process.env.PATH || '').split(path.delimiter)) {
            if (/node_modules[\\/]?\.bin[\\/]?$/i.test(entry)) {
                try { return require(path.join(path.dirname(entry), 'playwright')); } catch { /* keep looking */ }
            }
        }
        throw error;
    }
}

function pageUrl(base) {
    const url = new URL('/hr', base);
    url.hash = 'team';
    url.searchParams.set('businessContext', BUSINESS_CONTEXT);
    url.searchParams.set('smoke', RUN_ID);
    return url.toString();
}

async function openAuthenticatedPage(browser, base, session) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(data => {
        localStorage.setItem('pzp_token', data.token);
        localStorage.setItem('pzp_access_token', data.token);
        if (data.refreshToken) localStorage.setItem('pzp_refresh_token', data.refreshToken);
        if (data.refreshExpiresAt) localStorage.setItem('pzp_refresh_expires_at', String(data.refreshExpiresAt));
        if (data.user) localStorage.setItem('pzp_current_user', JSON.stringify(data.user));
        localStorage.setItem('pzp_crm_business_context', data.businessContext);
    }, { ...session, businessContext: BUSINESS_CONTEXT });
    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT_MS);
    await page.route('https://www.clarity.ms/**', route => route.abort());
    await page.goto(pageUrl(base), { waitUntil: 'domcontentloaded' });
    return { context, page };
}

async function openDrawer(page, tab, selector, expected) {
    await page.waitForFunction(() => typeof window.openStaffEdit === 'function');
    await page.evaluate(id => window.openStaffEdit(id), QA_STAFF_ID);
    await page.waitForFunction(id => Number(document.getElementById('editStaffId')?.value) === Number(id) && document.getElementById('staffEditModal')?.getAttribute('aria-hidden') === 'false', QA_STAFF_ID);
    await page.locator(`[data-staff-profile-tab="${tab}"]`).click();
    await page.waitForFunction(({ selector, expected }) => {
        const element = document.querySelector(selector);
        return element && !element.disabled && String(element.value || '') === String(expected ?? '');
    }, { selector, expected: expected ?? '' });
}

async function assertDrawerPersistence(page, field, expected) {
    await page.evaluate(() => closeHrEditableModal('staffEditModal', true));
    await openDrawer(page, field.tab, field.selector, expected);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openDrawer(page, field.tab, field.selector, expected);
}

async function restoreField(base, token, field, original) {
    const body = await fetchJson(base, `/api/hr/staff/${QA_STAFF_ID}`, { method: 'PUT', token, body: { [field.key]: original } });
    assert.ok(body?.success, `${field.key} restore is accepted`);
    const restored = await loadProfile(base, token);
    assert.equal(comparable(restored[field.key]), comparable(original), `${field.key} restore persists`);
}

async function runFieldScenario(page, base, token, profile, field) {
    const original = profile[field.key] ?? null;
    const next = field.value(original);
    const expectedPayloadValue = field.payloadValue ? field.payloadValue(next) : next;
    let writeMayHaveOccurred = false;
    let restoreError = null;
    try {
        await openDrawer(page, field.tab, field.selector, original);
        const payloads = [];
        const listener = request => {
            if (request.method() !== 'PUT' || new URL(request.url()).pathname !== `/api/hr/staff/${QA_STAFF_ID}`) return;
            try { payloads.push(JSON.parse(request.postData() || '{}')); } catch { payloads.push(null); }
        };
        page.on('request', listener);
        await page.locator(field.selector).fill(String(next));
        writeMayHaveOccurred = true;
        await page.evaluate(selector => {
            const button = document.querySelector(selector);
            button.click();
            button.click();
        }, field.save);
        await page.waitForFunction(selector => document.querySelector(selector)?.dataset.actionState === 'success', field.save);
        page.off('request', listener);
        assert.equal(payloads.length, 1, `${field.key}: double-click sends one request`);
        assert.deepEqual(payloads[0], { [field.key]: expectedPayloadValue }, `${field.key}: exact one-field payload`);
        const persisted = await loadProfile(base, token);
        assert.equal(comparable(persisted[field.key]), comparable(expectedPayloadValue), `${field.key}: API persistence`);
        await assertDrawerPersistence(page, field, next);
    } finally {
        if (writeMayHaveOccurred) {
            try { await restoreField(base, token, field, original); } catch (error) { restoreError = error; }
        }
    }
    if (restoreError) throw new Error(`${field.key} restore failed: ${restoreError.message || restoreError}`);
}

async function reversibleApiScenario(name, load, mutate, save, restore, verify) {
    const snapshot = await load();
    let writeMayHaveOccurred = false;
    let mainError = null;
    let restoreError = null;
    try {
        const changed = mutate(snapshot);
        writeMayHaveOccurred = true;
        await save(changed);
        await verify(changed);
    } catch (error) { mainError = error; } finally {
        if (writeMayHaveOccurred) {
            try { await restore(snapshot); await verify(snapshot); } catch (error) { restoreError = error; }
        }
    }
    if (restoreError) throw new Error(`${name} restore failed: ${restoreError.message || restoreError}`);
    if (mainError) throw mainError;
}

function shiftTime(value) {
    const [hour, minute] = String(value || '09:00').slice(0, 5).split(':').map(Number);
    return `${String((hour + 1) % 24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizePreferences(rows = []) {
    return rows.map(row => ({
        professionKey: row.profession_key || row.professionKey,
        dayType: row.day_type || row.dayType,
        startTime: String(row.start_time || row.startTime || '').slice(0, 5),
        endTime: String(row.end_time || row.endTime || '').slice(0, 5),
        isActive: row.is_active ?? row.isActive ?? true
    })).sort((a, b) => `${a.professionKey}:${a.dayType}`.localeCompare(`${b.professionKey}:${b.dayType}`));
}

function normalizeRates(profile = {}) {
    return {
        hourly_rate: Number(profile.hourly_rate || 0),
        rate_unit: profile.rate_unit || 'hour',
        profession_rates: (profile.profession_rates || []).map(row => ({ profession_key: row.profession_key, hourly_rate: Number(row.hourly_rate || 0) })).sort((a, b) => String(a.profession_key).localeCompare(String(b.profession_key)))
    };
}

async function runOptInScenarios(base, token) {
    if (SCENARIOS.has('shift')) {
        const route = `/api/staff/${QA_STAFF_ID}/shift-preferences`;
        await reversibleApiScenario('shift', async () => normalizePreferences((await fetchJson(base, route, { token })).data), rows => {
            assert.ok(rows.length, 'shift opt-in requires an existing preference to mutate safely');
            return rows.map((row, index) => ({ professionKey: row.profession_key || row.professionKey, dayType: row.day_type || row.dayType, startTime: index ? (row.start_time || row.startTime) : shiftTime(row.start_time || row.startTime), endTime: row.end_time || row.endTime, isActive: row.is_active ?? row.isActive ?? true }));
        }, preferences => fetchJson(base, route, { method: 'PUT', token, body: { preferences } }), preferences => fetchJson(base, route, { method: 'PUT', token, body: { preferences } }), async expected => assert.deepEqual(normalizePreferences((await fetchJson(base, route, { token })).data), normalizePreferences(expected)));
    }
    if (SCENARIOS.has('rates')) {
        await reversibleApiScenario('rates', async () => normalizeRates(await loadProfile(base, token)), profile => ({ ...profile, hourly_rate: Number(profile.hourly_rate || 0) + 1 }), body => fetchJson(base, `/api/hr/staff/${QA_STAFF_ID}`, { method: 'PUT', token, body }), profile => fetchJson(base, `/api/hr/staff/${QA_STAFF_ID}`, { method: 'PUT', token, body: profile }), async expected => assert.deepEqual(normalizeRates(await loadProfile(base, token)), normalizeRates(expected)));
    }
    if (SCENARIOS.has('payroll')) {
        const route = `/api/hr/staff/${QA_STAFF_ID}/payroll-scheme`;
        const schemePayload = workspace => {
            const scheme = workspace.active_scheme || workspace.activeScheme;
            assert.ok(scheme, 'payroll opt-in requires an existing active scheme for reversible restore');
            return { scheme_type: scheme.scheme_type, amount: Number(scheme.amount || 0), config: scheme.config || {}, title: scheme.title, effective_from: scheme.effective_from || null, effective_to: scheme.effective_to || null };
        };
        await reversibleApiScenario('payroll', async () => schemePayload((await fetchJson(base, route, { token })).data), snapshot => ({ ...snapshot, title: `${snapshot.title || 'QA'} ${RUN_ID}` }), body => fetchJson(base, route, { method: 'PUT', token, body }), snapshot => fetchJson(base, route, { method: 'PUT', token, body: snapshot }), async expected => assert.equal((await fetchJson(base, route, { token })).data.active_scheme.title, expected.title));
    }
}

async function main() {
    let browser;
    let context;
    let base;
    let session;
    let originalProfile;
    let mainError = null;
    let defensiveRestoreError = null;
    try {
        assertConfigured();
        base = normalizeBase(TARGET_URL);
        session = await login(base);
        originalProfile = await loadProfile(base, session.token);
        const { chromium } = requirePlaywright();
        browser = await chromium.launch({ headless: true });
        const opened = await openAuthenticatedPage(browser, base, session);
        context = opened.context;
        for (const field of FIELD_MATRIX.filter(item => SCENARIOS.has(item.scenario))) {
            await runFieldScenario(opened.page, base, session.token, originalProfile, field);
        }
        await runOptInScenarios(base, session.token);
    } catch (error) { mainError = error; } finally {
        if (base && session?.token && originalProfile) {
            const safeSnapshot = Object.fromEntries(FIELD_MATRIX.map(field => [field.key, originalProfile[field.key] ?? null]));
            try {
                await fetchJson(base, `/api/hr/staff/${QA_STAFF_ID}`, { method: 'PUT', token: session.token, body: safeSnapshot });
                const restored = await loadProfile(base, session.token);
                for (const [key, value] of Object.entries(safeSnapshot)) assert.equal(comparable(restored[key]), comparable(value), `defensive restore: ${key}`);
            } catch (error) { defensiveRestoreError = error; }
        }
        if (context) await context.close().catch(() => {});
        if (browser) await browser.close().catch(() => {});
    }
    if (defensiveRestoreError) throw new Error(`defensive profile restore failed: ${defensiveRestoreError.message || defensiveRestoreError}`);
    if (mainError) throw mainError;
    console.log(`Live HR write matrix OK: ${base} / staff #${QA_STAFF_ID} / ${Array.from(SCENARIOS).join(',')}`);
}

main().catch(error => {
    console.error(`Live HR write matrix failed: ${error.stack || error.message || String(error)}`);
    process.exit(1);
});
