#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require('pg');
const { startCheckboxLocalManualUiMock } = require('./lib/checkbox-local-manual-ui-mock');

const ROOT = path.join(__dirname, '..');
const OWNER = 'PARK-DAR-LOCAL-MANUAL-UI-PREP';
const RESULT_PREFIX = 'EVENTGENIX_MANUAL_QA_RESULT=';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const DATABASES = Object.freeze({
    event_genix: 'eventgenix_park_manual_ui_test_20260904',
    dar: 'eventgenix_dar_manual_ui_test_20260904'
});
const SCOPES = Object.freeze({
    event_genix: Object.freeze({
        locationAlias: 'park',
        registerAlias: 'middle',
        registerName: 'Середня каса',
        ref: 'PARK_MANUAL_UI',
        catalogCount: 140,
        admissionCount: 6,
        discountCount: 0
    }),
    dar: Object.freeze({
        locationAlias: 'dar',
        registerAlias: 'dar',
        registerName: 'Студія / Каса ДАР',
        ref: 'DAR_MANUAL_UI',
        catalogCount: 21,
        admissionCount: 0,
        discountCount: 2
    })
});

class ManualUiQaError extends Error {
    constructor(code, message) {
        super(message || code);
        this.name = 'ManualUiQaError';
        this.code = code;
    }
}

function fail(code, message) {
    throw new ManualUiQaError(code, message);
}

function isLoopback(value) {
    return LOOPBACK_HOSTS.has(String(value || '').trim().toLowerCase());
}

function assertManualQaEnvironment(env = process.env) {
    const host = String(env.PGHOST || '127.0.0.1').trim().toLowerCase();
    const port = Number(env.PGPORT || env.EVENTGENIX_LOCAL_PG_PROXY_PORT || 55443);
    if (!isLoopback(host)) fail('manual_qa_database_not_loopback', 'Manual QA PostgreSQL host must be loopback');
    if (!Number.isSafeInteger(port) || port <= 0 || port > 65535) fail('manual_qa_database_port_invalid', 'Manual QA PostgreSQL port is invalid');
    if (env.NODE_ENV === 'production' || env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID || env.RAILWAY_SERVICE_ID) {
        fail('manual_qa_production_environment_forbidden', 'Production and Railway environments are forbidden');
    }
    if (String(env.DATABASE_URL || '').trim()) {
        fail('manual_qa_database_url_forbidden', 'DATABASE_URL must be unset; exact local PG fields are required');
    }
    return { host, port, user: String(env.PGUSER || 'postgres'), password: String(env.PGPASSWORD || '') };
}

function assertExactDatabaseName(value) {
    const name = String(value || '').trim();
    if (!Object.values(DATABASES).includes(name)) fail('manual_qa_database_name_forbidden', 'Database name is outside the exact manual-QA allowlist');
    return name;
}

function requirePlaywright() {
    try { return require('playwright'); }
    catch (error) {
        const entries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
        for (const entry of entries) {
            const normalized = entry.replace(/[\\/]+$/, '');
            if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
            const packageDir = path.join(path.dirname(normalized), 'playwright');
            if (fs.existsSync(packageDir)) return require(packageDir);
        }
        throw error;
    }
}

function safeChildEnvironment(base, overrides = {}) {
    const env = { ...base, ...overrides };
    for (const key of Object.keys(env)) {
        const inheritedSecret = /(?:^|_)(?:TOKEN|SECRET|PASSWORD|PASS|PIN|API_KEY|ACCESS_KEY|LICENSE_KEY|CREDENTIALS?)(?:_|$)/i.test(key);
        if (/^(?:DATABASE_URL|PRODUCTION_DATABASE_URL|LIVE_DATABASE_URL|RAILWAY_|CHECKBOX_)/.test(key) || inheritedSecret) delete env[key];
    }
    return { ...env, ...overrides };
}

async function reservePort() {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    const port = Number(address?.port);
    await new Promise(resolve => server.close(resolve));
    if (!Number.isSafeInteger(port) || port <= 0) fail('manual_qa_port_unavailable', 'Could not reserve a loopback port');
    return port;
}

function databaseConfig(connection, database) {
    return {
        host: connection.host,
        port: connection.port,
        user: connection.user,
        password: connection.password,
        database,
        ssl: false
    };
}

async function databaseExists(connection, name) {
    const client = new Client(databaseConfig(connection, 'postgres'));
    await client.connect();
    try {
        const result = await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [name]);
        return result.rowCount === 1;
    } finally {
        await client.end();
    }
}

async function createDatabase(connection, name) {
    assertExactDatabaseName(name);
    const client = new Client(databaseConfig(connection, 'postgres'));
    await client.connect();
    try {
        const existing = await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [name]);
        if (!existing.rowCount) await client.query(`CREATE DATABASE "${name}"`);
    } finally {
        await client.end();
    }
}

async function assertExistingDatabaseOwned(connection, name, businessContext) {
    const client = new Client(databaseConfig(connection, name));
    await client.connect();
    try {
        const table = await client.query("SELECT to_regclass('public.local_manual_qa_registry') AS registry");
        if (!table.rows[0]?.registry) fail('manual_qa_existing_database_unowned', 'Existing database has no manual-QA ownership registry');
        const marker = await client.query(
            'SELECT 1 FROM local_manual_qa_registry WHERE owner_key=$1 AND database_name=$2 AND business_context=$3',
            [OWNER, name, businessContext]
        );
        if (marker.rowCount !== 1) fail('manual_qa_existing_database_owner_mismatch', 'Existing database ownership does not match this QA block');
    } finally {
        await client.end();
    }
}

function parseChildResult(output) {
    const line = String(output || '').split(/\r?\n/).find(value => value.startsWith(RESULT_PREFIX));
    if (!line) fail('manual_qa_prepare_result_missing', 'Manual QA database preparation did not return a result');
    return JSON.parse(line.slice(RESULT_PREFIX.length));
}

async function runPrepareChild({ connection, businessContext, credentials, providerIdentity }) {
    const database = DATABASES[businessContext];
    const env = safeChildEnvironment(process.env, {
        NODE_ENV: 'test',
        PGHOST: connection.host,
        PGPORT: String(connection.port),
        PGUSER: connection.user,
        PGPASSWORD: connection.password,
        PGDATABASE: database,
        BACKUP_OUTBOUND_HOLD: 'true',
        MANUAL_UI_PREP_CHILD: 'true',
        MANUAL_UI_BUSINESS_CONTEXT: businessContext,
        BOOTSTRAP_CREATOR_USERNAME: credentials.username,
        BOOTSTRAP_CREATOR_PASSWORD: credentials.password,
        BOOTSTRAP_CREATOR_NAME: 'Local manual QA owner',
        MANUAL_UI_PROVIDER_ORGANIZATION_ID: providerIdentity.organizationId,
        MANUAL_UI_PROVIDER_REGISTER_ID: providerIdentity.registerId,
        MANUAL_UI_PROVIDER_CASHIER_ID: providerIdentity.cashierId
    });
    const child = spawn(process.execPath, [__filename, 'prepare-child'], {
        cwd: ROOT,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.stderr.on('data', chunk => { output += chunk.toString(); });
    const code = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
    });
    if (code !== 0) fail('manual_qa_prepare_failed', 'Manual QA database preparation failed; sensitive child output was withheld');
    return parseChildResult(output);
}

async function prepareChild() {
    const connection = assertManualQaEnvironment(process.env);
    const businessContext = String(process.env.MANUAL_UI_BUSINESS_CONTEXT || '').trim();
    const scope = SCOPES[businessContext];
    if (!scope) fail('manual_qa_business_context_invalid', 'Unknown manual QA business context');
    const database = assertExactDatabaseName(process.env.PGDATABASE);
    if (database !== DATABASES[businessContext]) fail('manual_qa_database_scope_mismatch', 'Database does not match business context');
    const { pool, initDatabase } = require('../db');
    const { runMigrations } = require('../db/migrate');
    const { APPLY_CONFIRM_ENV, applyCatalogSaleMappings } = require('../services/payments/catalogSaleMappingConfigurator');
    await initDatabase();
    await runMigrations(pool);
    await initDatabase();
    await runMigrations(pool);

    const actor = await pool.query('SELECT id FROM users WHERE username=$1 AND is_active=TRUE', [process.env.BOOTSTRAP_CREATOR_USERNAME]);
    if (actor.rowCount !== 1) fail('manual_qa_local_login_unavailable', 'Normal disposable bootstrap login was not created');
    const userId = Number(actor.rows[0].id);
    const organizationId = String(process.env.MANUAL_UI_PROVIDER_ORGANIZATION_ID || '').trim();
    const registerProviderId = String(process.env.MANUAL_UI_PROVIDER_REGISTER_ID || '').trim();
    const cashierProviderId = String(process.env.MANUAL_UI_PROVIDER_CASHIER_ID || '').trim();
    if (!organizationId || !registerProviderId || !cashierProviderId) fail('manual_qa_mock_identity_missing', 'Local mock identity is incomplete');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`CREATE TABLE IF NOT EXISTS local_manual_qa_registry (
            owner_key text NOT NULL,
            database_name text NOT NULL,
            business_context text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT NOW(),
            PRIMARY KEY (owner_key, database_name, business_context)
        )`);
        await client.query(
            'INSERT INTO local_manual_qa_registry (owner_key,database_name,business_context) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
            [OWNER, database, businessContext]
        );
        const profile = await client.query(
            `INSERT INTO fiscal_profiles (
                crm_profile_key,legal_entity_key,legal_entity_name,provider,provider_organization_id,currency,status,settings
             ) VALUES ($1,'local_manual_qa','LOCAL QA','checkbox',$2,'UAH','active',$3::jsonb)
             ON CONFLICT (crm_profile_key,legal_entity_key) DO UPDATE SET
                provider_organization_id=EXCLUDED.provider_organization_id,status='active',settings=EXCLUDED.settings,updated_at=NOW()
             RETURNING id`,
            [businessContext, organizationId, JSON.stringify({ qa_owner: OWNER, expected_is_test: true })]
        );
        const profileId = Number(profile.rows[0].id);
        const location = await client.query(
            `INSERT INTO fiscal_locations (fiscal_profile_id,crm_profile_key,location_alias,display_name,status)
             VALUES ($1,$2,$3,$4,'active')
             ON CONFLICT (fiscal_profile_id,location_alias) DO UPDATE SET display_name=EXCLUDED.display_name,status='active',updated_at=NOW()
             RETURNING id`,
            [profileId, businessContext, scope.locationAlias, scope.registerName]
        );
        const locationId = Number(location.rows[0].id);
        const register = await client.query(
            `INSERT INTO fiscal_registers (
                fiscal_profile_id,fiscal_location_id,crm_profile_key,register_alias,display_name,provider,
                provider_register_id,provider_license_ref,status,feature_enabled,metadata
             ) VALUES ($1,$2,$3,$4,$5,'checkbox',$6,$7,'active',TRUE,$8::jsonb)
             ON CONFLICT (fiscal_profile_id,register_alias) DO UPDATE SET
                fiscal_location_id=EXCLUDED.fiscal_location_id,display_name=EXCLUDED.display_name,
                provider_register_id=EXCLUDED.provider_register_id,provider_license_ref=EXCLUDED.provider_license_ref,
                status='active',feature_enabled=TRUE,metadata=EXCLUDED.metadata,updated_at=NOW()
             RETURNING id`,
            [profileId, locationId, businessContext, scope.registerAlias, scope.registerName,
                registerProviderId, scope.ref, JSON.stringify({ qa_owner: OWNER, expected_is_test: true, provider_mode: 'loopback_mock' })]
        );
        const registerId = Number(register.rows[0].id);
        await client.query(
            `INSERT INTO fiscal_cashier_bindings (
                fiscal_profile_id,fiscal_register_id,fiscal_location_id,crm_profile_key,user_id,provider,
                provider_cashier_id,provider_cashier_login_ref,capability_scope,status,cashier_name,cashier_login
             ) VALUES ($1,$2,$3,$4,$5,'checkbox',$6,$7,$8::text[],'active',$9,NULL)
             ON CONFLICT (fiscal_profile_id,fiscal_register_id,user_id) DO UPDATE SET
                fiscal_location_id=EXCLUDED.fiscal_location_id,crm_profile_key=EXCLUDED.crm_profile_key,
                provider_cashier_id=EXCLUDED.provider_cashier_id,provider_cashier_login_ref=EXCLUDED.provider_cashier_login_ref,
                capability_scope=EXCLUDED.capability_scope,status='active',cashier_name=EXCLUDED.cashier_name,cashier_login=NULL,updated_at=NOW()`,
            [profileId, registerId, locationId, businessContext, userId, cashierProviderId, scope.ref,
                ['payments.view', 'payments.create', 'payments.confirm_received', 'fiscal.shift.open', 'fiscal.shift.close', 'fiscal.audit.view'],
                businessContext === 'event_genix' ? 'Локальний касир ПАРК' : 'Локальний касир ДАР']
        );
        if (businessContext === 'event_genix') {
            await client.query(
                `INSERT INTO fiscal_item_mappings (
                    fiscal_profile_id,fiscal_register_id,crm_profile_key,source_type,item_type,item_code,
                    fiscal_item_name,provider,provider_tax_id,tax_code,tax_rate_bps,tax_mode,status
                 ) SELECT $1,$2,'event_genix','admission_ticket','admission_ticket',type.code,type.name,
                          'checkbox',NULL,NULL,NULL,'untaxed','active'
                     FROM admission_ticket_types type
                    WHERE type.business_context='event_genix' AND type.is_active=TRUE
                 ON CONFLICT (fiscal_profile_id,fiscal_register_id,source_type,item_type,item_code,provider)
                 DO UPDATE SET fiscal_item_name=EXCLUDED.fiscal_item_name,provider_tax_id=NULL,tax_code=NULL,
                               tax_rate_bps=NULL,tax_mode='untaxed',status='active',updated_at=NOW()`,
                [profileId, registerId]
            );
        }
        await client.query('COMMIT');
        await applyCatalogSaleMappings(client, { [APPLY_CONFIRM_ENV]: 'true' }, { businessContexts: [businessContext] });

        const counts = await client.query(
            `SELECT
                COUNT(*) FILTER (WHERE source_type='catalog_sale' AND status='active')::integer AS catalog,
                COUNT(*) FILTER (WHERE source_type='admission_ticket' AND status='active')::integer AS admission,
                COUNT(*) FILTER (WHERE status='active' AND (tax_mode<>'untaxed' OR provider_tax_id IS NOT NULL OR tax_code IS NOT NULL OR tax_rate_bps IS NOT NULL))::integer AS tax_violations
             FROM fiscal_item_mappings WHERE fiscal_profile_id=$1 AND fiscal_register_id=$2`,
            [profileId, registerId]
        );
        const discounts = await client.query('SELECT COUNT(*)::integer AS count FROM sales_discount_rules WHERE business_context=$1 AND is_active=TRUE', [businessContext]);
        const bindings = await client.query(
            `SELECT COUNT(*)::integer AS count FROM fiscal_cashier_bindings
              WHERE fiscal_profile_id=$1 AND fiscal_register_id=$2 AND status='active'
                AND NULLIF(BTRIM(provider_cashier_login_ref),'') IS NOT NULL`,
            [profileId, registerId]
        );
        const pending = await client.query(
            `SELECT
                (SELECT COUNT(*) FROM payment_orders)::integer AS orders,
                (SELECT COUNT(*) FROM fiscal_shifts WHERE status IN ('opening','open','closing'))::integer AS shifts,
                (SELECT COUNT(*) FROM payment_outbox_jobs WHERE status IN ('queued','failed','dead','claimed','running'))::integer AS jobs,
                ((SELECT COUNT(*) FROM payment_orders WHERE payment_status='unknown' OR fiscal_status='unknown')
                 +(SELECT COUNT(*) FROM fiscal_operations WHERE status='unknown'))::integer AS unknown`
        );
        const row = counts.rows[0];
        const queue = pending.rows[0];
        const ready = Number(row.catalog) === scope.catalogCount
            && Number(row.admission) === scope.admissionCount
            && Number(row.tax_violations) === 0
            && Number(discounts.rows[0].count) === scope.discountCount
            && Number(bindings.rows[0].count) === 1
            && Object.values(queue).every(value => Number(value) === 0);
        if (!ready) fail('manual_qa_database_not_ready', 'Manual QA database invariants are not ready');
        process.stdout.write(`${RESULT_PREFIX}${JSON.stringify({
            ready: true,
            businessContext,
            database,
            catalog: Number(row.catalog),
            admission: Number(row.admission),
            discounts: Number(discounts.rows[0].count),
            bindings: Number(bindings.rows[0].count),
            taxViolations: Number(row.tax_violations),
            queues: { jobs: Number(queue.jobs), unknown: Number(queue.unknown) },
            shifts: Number(queue.shifts),
            orders: Number(queue.orders)
        })}\n`);
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

async function waitForHealthy(baseUrl, child) {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) fail('manual_qa_server_start_failed', 'Local EventGenix process exited during startup');
        try {
            const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1500) });
            if (response.ok) return;
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    fail('manual_qa_server_timeout', 'Local EventGenix server did not become healthy');
}

function serverEnvironment({ connection, database, port, credentials, mockPort, scope, providerIdentity }) {
    const prefix = `CHECKBOX_${scope.ref}`;
    const mockSecret = suffix => `${suffix}-${crypto.randomBytes(18).toString('base64url')}`;
    return safeChildEnvironment(process.env, {
        NODE_ENV: 'test',
        PORT: String(port),
        PGHOST: connection.host,
        PGPORT: String(connection.port),
        PGUSER: connection.user,
        PGPASSWORD: connection.password,
        PGDATABASE: database,
        BOOTSTRAP_CREATOR_USERNAME: credentials.username,
        BOOTSTRAP_CREATOR_PASSWORD: credentials.password,
        BOOTSTRAP_CREATOR_NAME: 'Local manual QA owner',
        JWT_SECRET: crypto.randomBytes(48).toString('base64url'),
        BACKUP_OUTBOUND_HOLD: 'true',
        REQUIRE_ISOLATED_TEST_TARGET: 'true',
        ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER: 'true',
        EVENTGENIX_LOCAL_MANUAL_QA: 'true',
        CHECKBOX_LOCAL_QA_MOCK_PORT: String(mockPort),
        CHECKBOX_INTEGRATION_ENABLED: 'true',
        CHECKBOX_ACCEPT_PAYMENTS_ENABLED: 'true',
        CHECKBOX_EXPECT_IS_TEST: 'true',
        CHECKBOX_WEBHOOK_ENABLED: 'false',
        EVENTGENIX_CASHIER_PRO_ENABLED: 'false',
        PAYMENT_OUTBOX_WAKEUP_DISABLED: 'false',
        NODE_OPTIONS: [String(process.env.NODE_OPTIONS || ''), '--require=./tests/helpers/checkbox-loopback-only-fetch-shim.js'].filter(Boolean).join(' '),
        [`${prefix}_BASE_URL`]: 'https://api.checkbox.ua',
        [`${prefix}_LOGIN`]: providerIdentity.login,
        [`${prefix}_PASSWORD`]: providerIdentity.password,
        [`${prefix}_LICENSE_KEY`]: providerIdentity.licenseKey,
        [`${prefix}_ACCESS_KEY`]: providerIdentity.accessKey,
        [`${prefix}_DEVICE_ID`]: providerIdentity.deviceId
    });
}

function startEventGenixServer(options) {
    const child = spawn(process.execPath, ['server.js'], {
        cwd: ROOT,
        env: serverEnvironment(options),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.resume();
    child.stderr.resume();
    return child;
}

async function authenticatePage(page, baseUrl, credentials) {
    const response = await page.request.post(`${baseUrl}/api/auth/login`, {
        data: { username: credentials.username, password: credentials.password }
    });
    if (!response.ok()) fail('manual_qa_browser_login_failed', 'Normal local login failed');
    const payload = await response.json();
    if (!payload.token) fail('manual_qa_browser_token_missing', 'Normal local login returned no token');
    await page.addInitScript(token => {
        localStorage.setItem('pzp_token', token);
        localStorage.setItem('pzp_dark_mode', 'false');
    }, payload.token);
}

async function verifyManualPage(page, { baseUrl, businessContext, expectedCatalog }) {
    await page.goto(`${baseUrl}/cashier-payments.html?businessContext=${encodeURIComponent(businessContext)}&saleMode=catalog&localQa=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(count => window.CashierPaymentsPage?.state?.catalogItems?.length === count, expectedCatalog);
    const proof = await page.evaluate(() => ({
        banner: document.querySelector('#localQaBanner')?.textContent || '',
        business: document.querySelector('#cashierScopeBusiness')?.textContent || '',
        register: document.querySelector('#cashierScopeRegister')?.textContent || '',
        catalog: window.CashierPaymentsPage.state.catalogItems.length,
        cashiers: window.CashierPaymentsPage.state.selectableCashiers.length,
        localQa: window.CashierPaymentsPage.state.localQa,
        registerInputs: document.querySelectorAll('input[name*="register" i],select[name*="register" i]').length,
        priceInputs: document.querySelectorAll('input[name*="price" i],input[data-catalog-price]').length
    }));
    if (!/LOCAL QA/.test(proof.banner) || !/MOCK CHECKBOX/.test(proof.banner)) fail('manual_qa_banner_missing', 'LOCAL QA banner is missing');
    if (proof.business !== businessContext || proof.catalog !== expectedCatalog || proof.cashiers !== 1) fail('manual_qa_browser_scope_mismatch', 'Manual page scope, catalog or cashier list is incorrect');
    if (proof.localQa?.externalNetwork !== false || proof.localQa?.providerMode !== 'loopback_mock') fail('manual_qa_browser_network_not_isolated', 'Manual page did not confirm loopback isolation');
    if (proof.registerInputs !== 0 || proof.priceInputs !== 0) fail('manual_qa_browser_mutable_scope_or_price', 'Browser exposes mutable register or price fields');
    return proof;
}

async function stopChild(child) {
    if (!child || child.exitCode !== null) return;
    const closed = new Promise(resolve => child.once('close', resolve));
    child.kill('SIGTERM');
    await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 5000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
}

async function startManualHarness() {
    const connection = assertManualQaEnvironment(process.env);
    const contexts = {};
    const providerIdentity = {
        organizationId: `local-manual-org-${crypto.randomUUID()}`,
        registerId: `local-manual-register-${crypto.randomUUID()}`,
        cashierId: `local-manual-cashier-${crypto.randomUUID()}`
    };
    for (const businessContext of Object.keys(SCOPES)) {
        const database = DATABASES[businessContext];
        const existed = await databaseExists(connection, database);
        if (existed) await assertExistingDatabaseOwned(connection, database, businessContext);
        else await createDatabase(connection, database);
        const credentials = {
            username: `manual_qa_${businessContext}_${crypto.randomBytes(6).toString('hex')}`,
            password: crypto.randomBytes(24).toString('base64url')
        };
        const mockCredentials = {
            ...providerIdentity,
            businessContext,
            login: `local-${businessContext}-${crypto.randomBytes(8).toString('hex')}`,
            password: crypto.randomBytes(24).toString('base64url'),
            licenseKey: crypto.randomBytes(24).toString('base64url'),
            accessKey: crypto.randomBytes(24).toString('base64url'),
            deviceId: `local-device-${crypto.randomUUID()}`,
            token: `local-token-${businessContext}-${crypto.randomBytes(20).toString('base64url')}`,
            safeFiscalNumber: businessContext === 'event_genix' ? 'LOCAL-PARK' : 'LOCAL-DAR'
        };
        const prepared = await runPrepareChild({ connection, businessContext, credentials, providerIdentity });
        contexts[businessContext] = { businessContext, database, credentials, mockCredentials, prepared };
    }

    const mockPort = await reservePort();
    const mock = await startCheckboxLocalManualUiMock({
        contexts: Object.fromEntries(Object.entries(contexts).map(([key, value]) => [key, value.mockCredentials])),
        port: mockPort
    });
    const servers = [];
    let browser;
    try {
        for (const businessContext of Object.keys(SCOPES)) {
            const context = contexts[businessContext];
            const port = await reservePort();
            const child = startEventGenixServer({
                connection,
                database: context.database,
                port,
                credentials: context.credentials,
                mockPort,
                scope: SCOPES[businessContext],
                providerIdentity: context.mockCredentials
            });
            const baseUrl = `http://127.0.0.1:${port}`;
            servers.push({ businessContext, child, baseUrl });
            await waitForHealthy(baseUrl, child);
        }
        const { chromium } = requirePlaywright();
        browser = await chromium.launch({ headless: process.env.MANUAL_UI_HEADLESS === 'true' });
        const browserContext = await browser.newContext();
        for (const server of servers) {
            const page = await browserContext.newPage();
            await authenticatePage(page, server.baseUrl, contexts[server.businessContext].credentials);
            const proof = await verifyManualPage(page, {
                baseUrl: server.baseUrl,
                businessContext: server.businessContext,
                expectedCatalog: SCOPES[server.businessContext].catalogCount
            });
            contexts[server.businessContext].proof = proof;
        }
        const summary = {
            status: 'READY_FOR_MANUAL_LOCAL_UI_QA',
            externalNetwork: false,
            checkboxCalled: false,
            acceptance: 'process_local_only',
            processes: ['EventGenix PARK local server', 'EventGenix DAR local server', 'Checkbox loopback mock', 'Chromium manual QA'],
            databases: { park: DATABASES.event_genix, dar: DATABASES.dar },
            urls: Object.fromEntries(servers.map(server => [server.businessContext, `${server.baseUrl}/cashier-payments.html?businessContext=${server.businessContext}&saleMode=catalog&localQa=1`])),
            checks: Object.fromEntries(Object.entries(contexts).map(([key, value]) => [key, value.prepared]))
        };
        process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
        process.stdout.write('Стенд працює. Не закривайте це вікно термінала; для безпечної зупинки натисніть Ctrl+C.\n');

        await new Promise(resolve => {
            const finish = () => resolve();
            process.once('SIGINT', finish);
            process.once('SIGTERM', finish);
            browser.once('disconnected', finish);
        });
    } finally {
        if (browser?.isConnected()) await browser.close().catch(() => {});
        await Promise.all(servers.map(server => stopChild(server.child)));
        await mock.close().catch(() => {});
        process.env.CHECKBOX_ACCEPT_PAYMENTS_ENABLED = 'false';
    }
}

async function main() {
    if (process.argv[2] === 'prepare-child') return prepareChild();
    if (process.argv.slice(2).length) fail('manual_qa_mode_invalid', 'Use the launcher without arguments');
    return startManualHarness();
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || 'manual_qa_failed', message: error.message })}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    DATABASES,
    OWNER,
    SCOPES,
    ManualUiQaError,
    assertExactDatabaseName,
    assertManualQaEnvironment,
    isLoopback,
    safeChildEnvironment
};
