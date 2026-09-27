#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Pool } = require('pg');
const { getCertificateTestDatabase } = require('../helpers/certificate-test-database');

function requirePlaywright() {
    try { return require('playwright'); } catch (error) {
        for (const entry of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
            const normalized = entry.replace(/[\\/]+$/, '');
            if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
            const packageDir = path.join(path.dirname(normalized), 'playwright');
            if (fs.existsSync(packageDir)) return require(packageDir);
        }
        throw error;
    }
}

async function freePort() {
    return new Promise((resolve, reject) => {
        const socket = net.createServer();
        socket.once('error', reject);
        socket.listen(0, '127.0.0.1', () => {
            const port = socket.address().port;
            socket.close(error => error ? reject(error) : resolve(port));
        });
    });
}

async function waitForApp(base, child) {
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline && child.exitCode === null) {
        try {
            if ((await fetch(base + '/api/health', { signal: AbortSignal.timeout(1500) })).ok) return;
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('Isolated certificate browser app did not become healthy');
}

async function main() {
    assert.notEqual(process.env.NODE_ENV, 'production');
    assert.equal(process.env.REQUIRE_CERTIFICATE_POSTGRES_TESTS, '1');
    assert.ok(!process.env.RAILWAY_ENVIRONMENT && !process.env.RAILWAY_PROJECT_ID && !process.env.RAILWAY_SERVICE_ID);
    const fixture = getCertificateTestDatabase();
    assert.ok(fixture, 'CERTIFICATE_TEST_DATABASE_URL is required');
    const database = 'eventgenix_certificate_browser_test_' + crypto.randomUUID().replaceAll('-', '');
    assert.match(database, /^eventgenix_certificate_browser_test_[a-f0-9]{32}$/);
    const admin = new Pool({ ...fixture.connection, database: decodeURIComponent(fixture.url.pathname.slice(1)), max: 1 });
    let pool, child, browser, created = false;
    try {
        await admin.query(`CREATE DATABASE "${database}"`);
        created = true;
        pool = new Pool({ ...fixture.connection, database, max: 4 });
        const port = await freePort();
        const username = 'certificate_browser_' + crypto.randomBytes(5).toString('hex');
        const password = crypto.randomBytes(24).toString('base64url');
        const env = {
            PATH: process.env.PATH, HOME: process.env.HOME, NODE_PATH: process.env.NODE_PATH,
            LANG: process.env.LANG || 'C.UTF-8', NODE_ENV: 'test', PORT: String(port),
            PGHOST: fixture.connection.host, PGPORT: String(fixture.connection.port),
            PGUSER: fixture.connection.user, PGPASSWORD: fixture.connection.password,
            PGDATABASE: database, PGSSLMODE: 'disable',
            JWT_SECRET: crypto.randomBytes(64).toString('hex'),
            BOOTSTRAP_CREATOR_USERNAME: username, BOOTSTRAP_CREATOR_PASSWORD: password,
            BOOTSTRAP_CREATOR_NAME: 'Certificate Browser Creator',
            TELEGRAM_BOT_TOKEN: '', REPORT_BOT_TOKEN: '',
            BACKUP_OUTBOUND_HOLD: 'true', PAYMENT_OUTBOX_WAKEUP_DISABLED: 'true',
            RATE_LIMIT_MAX: '10000', LOGIN_RATE_LIMIT_MAX: '1000'
        };
        child = spawn(process.execPath, ['server.js'], {
            cwd: path.resolve(__dirname, '../..'), env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
        });
        // Drain both streams without retaining test credentials or production-like logs.
        child.stdout.resume();
        child.stderr.resume();
        const base = `http://127.0.0.1:${port}`;
        await waitForApp(base, child);
        const creator = (await pool.query('SELECT id FROM users WHERE username=$1', [username])).rows[0];
        assert.ok(creator, 'isolated creator must exist');
        const organizationId = (await pool.query(`INSERT INTO organizations (slug, name, status)
            VALUES ('certificate-browser-park', 'Certificate Browser Park', 'active') RETURNING id`)).rows[0].id;
        const businessId = (await pool.query(`INSERT INTO businesses (organization_id, context_key, label, short_label, access_mode, modules, status)
            VALUES ($1, 'event_genix', 'Certificate Park', 'Park', 'membership', '["timeline","center"]'::jsonb, 'active')
            ON CONFLICT (context_key) DO UPDATE SET organization_id=EXCLUDED.organization_id, access_mode='membership', status='active'
            RETURNING id`, [organizationId])).rows[0].id;
        await pool.query(`INSERT INTO organization_memberships (organization_id, user_id, role)
            VALUES ($1, $2, 'member') ON CONFLICT (organization_id, user_id) DO UPDATE SET is_active=true`, [organizationId, creator.id]);
        await pool.query(`INSERT INTO business_memberships (business_id, organization_id, user_id, role, is_default)
            VALUES ($1, $2, $3, 'creator', true) ON CONFLICT (business_id, user_id)
            DO UPDATE SET role='creator', is_active=true, is_default=true`, [businessId, organizationId, creator.id]);
        const date = '2099-02-13';
        await pool.query(`INSERT INTO timeline_resources (business_context, resource_id, type, name, is_active)
            VALUES ('event_genix', 'certificate-browser-room', 'room', 'Certificate Browser Room', true)`);
        const cases = [
            { name: 'oneTime', typeText: 'на одноразовий вхід', typeCode: 'one_time_admission', status: 'active' },
            { name: 'subscription', typeText: 'Абонемент', typeCode: 'subscription', status: 'active' },
            { name: 'unknown', typeText: 'Legacy unknown type', typeCode: 'verification_only', status: 'active' },
            { name: 'used', typeText: 'на одноразовий вхід', typeCode: 'one_time_admission', status: 'used' }
        ];
        const certificates = {};
        for (const item of cases) {
            const code = 'CERT-' + crypto.randomBytes(6).toString('hex').toUpperCase();
            certificates[item.name] = (await pool.query(`INSERT INTO certificates
                (cert_code, display_mode, display_value, type_text, type_code, valid_until, status, used_at)
                VALUES ($1, 'fio', $2, $3, $4, '2099-12-31', $5, $6) RETURNING id, cert_code`,
            [code, `Synthetic ${item.name}`, item.typeText, item.typeCode, item.status,
                item.status === 'used' ? new Date() : null])).rows[0];
        }
        async function persisted() {
            const ids = Object.values(certificates).map(cert => cert.id);
            const certs = (await pool.query(`SELECT id, status, used_at FROM certificates WHERE id=ANY($1::int[]) ORDER BY id`, [ids])).rows;
            const history = (await pool.query(`SELECT COUNT(*)::int AS count FROM history
                WHERE action='certificate_used' AND data->>'certificateId'=ANY($1::text[])`, [ids.map(String)])).rows[0].count;
            const bookings = (await pool.query('SELECT COUNT(*)::int AS count FROM bookings')).rows[0].count;
            return { certs, history, bookings };
        }
        const before = await persisted();
        const { chromium } = requirePlaywright();
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
        let bookingPosts = 0;
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.origin !== base) return route.abort();
            if (route.request().method() === 'POST' && url.pathname.startsWith('/api/bookings')) {
                bookingPosts++;
                return route.abort();
            }
            return route.continue();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        await page.goto(base + '/?date=' + date);
        await page.locator('#username').fill(username);
        await page.locator('#password').fill(password);
        await page.locator('#loginForm button[type="submit"]').click();
        try {
            await page.locator('#mainApp').waitFor({ state: 'visible', timeout: 30000 });
        } catch (error) {
            const message = await page.locator('#loginError').textContent().catch(() => '');
            throw new Error(`Isolated creator login failed: ${message}`, { cause: error });
        }
        await page.goto(base + '/?date=' + date);
        const cell = page.locator('.grid-cell[data-line="certificate-browser-room"][data-time="13:00"]');
        try {
            await cell.waitFor({ state: 'visible', timeout: 30000 });
        } catch (error) {
            const diagnostic = await page.evaluate(() => ({
                url: location.pathname + location.search,
                loginVisible: !!document.querySelector('#loginScreen')?.getClientRects().length,
                gridCells: document.querySelectorAll('.grid-cell').length,
                roomCells: document.querySelectorAll('.grid-cell[data-line="certificate-browser-room"]').length,
                view: document.body.dataset.currentScheduleViewMode || '',
                timelineText: document.querySelector('#timelineLines')?.textContent?.trim().slice(0, 120) || ''
            }));
            throw new Error(`Expected isolated room grid cell: ${JSON.stringify(diagnostic)}`, { cause: error });
        }
        await cell.click();
        const section = page.locator('#bookingCertificateSection');
        const input = page.locator('#certCodeInput');
        const button = page.locator('#certValidateButton');
        const result = page.locator('#certValidationResult');
        await section.waitFor({ state: 'visible', timeout: 30000 });
        assert.ok(await input.isVisible() && await button.isVisible());
        async function validate(cert, expectedText, expectedCanRedeem) {
            await input.fill(cert.cert_code);
            const responsePromise = page.waitForResponse(response => response.url().includes('/api/certificates/validate/')
                && response.url().endsWith(encodeURIComponent(cert.cert_code)));
            await button.click();
            const response = await responsePromise;
            assert.equal(response.request().headers()['x-business-context'], 'event_genix');
            const body = await response.json();
            assert.equal(body.canRedeem, expectedCanRedeem);
            await page.waitForFunction(text => document.querySelector('#certValidationResult')?.textContent?.includes(text), expectedText);
            const visibleText = await result.textContent();
            assert.match(visibleText, new RegExp(expectedText));
            if (!expectedCanRedeem) assert.ok(!visibleText.includes('✅'), 'denial must never look available');
        }
        await validate(certificates.oneTime, 'Сертифікат дійсний', true);
        await validate(certificates.subscription, 'доступний лише для перевірки', false);
        await validate(certificates.unknown, 'доступний лише для перевірки', false);
        await validate(certificates.used, 'Сертифікат уже використаний', false);

        async function holdNextAvailableResponse() {
            let reached, release;
            const arrived = new Promise(resolve => { reached = resolve; });
            const gate = new Promise(resolve => { release = resolve; });
            await page.route('**/api/certificates/validate/*', async route => {
                const response = await route.fetch(); // Actual Express and PostgreSQL response.
                reached();
                await gate;
                await route.fulfill({ response });
            }, { times: 1 });
            return { arrived, release };
        }
        async function waitForDelayedResponse(hold) {
            let timer;
            try {
                await Promise.race([hold.arrived, new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error('Timed out waiting for delayed validate response')), 15000);
                })]);
            } finally {
                clearTimeout(timer);
            }
        }
        let hold = await holdNextAvailableResponse();
        await input.fill(certificates.oneTime.cert_code);
        const staleCodeValidation = page.evaluate(() => validateCertificate());
        await waitForDelayedResponse(hold);
        await input.fill(certificates.used.cert_code);
        hold.release();
        await staleCodeValidation;
        assert.equal((await result.textContent())?.trim(), '', 'old code response must stay discarded');
        assert.ok(!(await result.isVisible()), 'old code result must remain hidden');

        hold = await holdNextAvailableResponse();
        await input.fill(certificates.oneTime.cert_code);
        const staleContextValidation = page.evaluate(() => validateCertificate());
        await waitForDelayedResponse(hold);
        await page.evaluate(() => {
            window.TimelineBusinessContext.state = () => ({ activeBusinessContext: 'dar' });
            window.TimelineBusinessContext.current = () => ({ apiValue: 'dar' });
            window.dispatchEvent(new CustomEvent('timeline:business-context-changed', {
                detail: { previous: 'event_genix', current: 'dar', source: 'certificate-browser-test' }
            }));
        });
        hold.release();
        await staleContextValidation;
        assert.ok(!(await section.isVisible()), 'certificate controls must hide outside Park');
        assert.equal((await result.textContent())?.trim(), '', 'old-context result must stay discarded');

        await page.reload();
        await cell.waitFor({ state: 'visible', timeout: 30000 });
        await cell.click();
        await section.waitFor({ state: 'visible', timeout: 30000 });
        await page.setViewportSize({ width: 390, height: 844 });
        assert.ok(await input.isVisible() && await button.isVisible(), 'mobile controls must remain visible');
        const width = await page.evaluate(() => document.documentElement.scrollWidth);
        assert.ok(width <= 390, `mobile page must not overflow: ${width}`);
        await input.focus();
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'certValidateButton');
        await validate(certificates.used, 'Сертифікат уже використаний', false);
        const after = await persisted();
        assert.deepEqual(after, before, 'precheck must not change certificates, redemption history, or bookings');
        assert.equal(bookingPosts, 0, 'browser must not submit a booking');
        await context.close();
        console.log('Certificate booking precheck actual-app browser smoke passed');
    } finally {
        if (browser) await browser.close();
        if (child && child.exitCode === null) {
            child.kill('SIGTERM');
            await Promise.race([new Promise(resolve => child.once('close', resolve)), new Promise(resolve => setTimeout(resolve, 10000))]);
            if (child.exitCode === null) child.kill('SIGKILL');
        }
        if (pool) await pool.end();
        try { if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`); }
        finally { await admin.end(); }
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
