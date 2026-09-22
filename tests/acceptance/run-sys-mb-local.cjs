'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const root = path.resolve(__dirname, '../..');
const runId = 'd06_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
const database = 'eventgenix_d06_test_' + crypto.randomUUID().replaceAll('-', '');
const outputDir = path.join(root, '.codex-temp/sys-mb-d06/runs', runId);
const records = [];
const secretValues = [];
const fixture = { runId, database, date: '2026-09-16', contexts: {
    park: 'event_genix', dar: 'dar', maysternya: 'maysternya_doli', crm: 'crm', other: 'd06_other'
},
    actors: {}, records: {}, organizations: {}, businesses: {}, markers: {} };
fixture.accounts = fixture.actors;
const randomSecret = () => { const value = crypto.randomBytes(32).toString('base64url'); secretValues.push(value); return value; };
function redact(value) {
    let text = typeof value === 'string' ? value : JSON.stringify(value);
    for (const secret of secretValues) text = text.split(secret).join('[REDACTED]');
    return text.replace(/Bearer\s+[A-Za-z0-9_.-]+/g, 'Bearer [REDACTED]')
        .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]');
}
function writeJson(file, value) { fs.writeFileSync(path.join(outputDir, file), redact(JSON.stringify(value, null, 2)) + '\n'); }
function record(item) {
    const safe = JSON.parse(redact(item));
    records.push(safe);
    writeJson('records-in-progress.json', records);
    process.stdout.write(`[D06] ${safe.id || safe.domain}: ${safe.status}\n`);
}
function windowsPath(file) {
    const match = /^\/mnt\/([a-z])\/(.*)$/.exec(file);
    assert.ok(match, 'Windows interop requires a mounted drive');
    return match[1].toUpperCase() + ':/' + match[2];
}
async function reservePort() {
    const server = net.createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    return port;
}
async function stop(child) {
    if (!child || child.exitCode !== null) return;
    const closed = new Promise(resolve => child.once('close', resolve));
    child.kill('SIGTERM');
    const timeout = setTimeout(() => child.kill('SIGKILL'), 20000);
    await closed;
    clearTimeout(timeout);
}
async function main() {
    assert.equal(process.env.SYS_MB_D06_LOCAL, 'true');
    assert.equal(process.platform, 'linux');
    assert.match(process.version, /^v22\./);
    for (const key of ['RAILWAY_ENVIRONMENT', 'RAILWAY_PROJECT_ID', 'RAILWAY_SERVICE_ID']) assert.ok(!process.env[key]);
    assert.notEqual(process.env.NODE_ENV, 'production');
    assert.equal(fs.existsSync(path.join(root, '.env')), false, 'No local credentials file may be loaded');
    assert.equal(fs.existsSync(path.join(root, '.env.local')), false, 'No local credentials file may be loaded');
    fs.mkdirSync(outputDir, { recursive: true });
    const checkpoint = JSON.parse(fs.readFileSync(path.join(root, 'docs/workstreams/sys-multibusiness/D05_VERIFICATION.json'), 'utf8'));
    const sourcePaths = [...new Set([...checkpoint.sourceFiles, ...checkpoint.auditSources].map(entry => entry.path)
        .concat(['server.js', 'db/index.js', 'routes/contractors.js', 'routes/procurement.js', 'routes/quests.js', 'tests/d06-products-context.test.js'],
            fs.readdirSync(__dirname).filter(file => file.endsWith('.cjs')).map(file => 'tests/acceptance/' + file)))].sort();
    const hash = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
    const sourceState = sourcePaths.map(file => ({ path: file, sha256: hash(file) }));
    writeJson('source-state.json', { capturedAtUtc: new Date().toISOString(), entries: sourceState });
    const admin = new Pool({ host: '/var/run/postgresql', user: 'postgres', database: 'postgres', max: 1 });
    let db, server, browserChild, created = false;
    let serverLog = '';
    const lifecycle = { databaseCreated: false, appStarted: false, bootstrap: false, cleanupVerified: false };
    const bootstrap = { username: `${runId}_creator`, password: randomSecret() };
    try {
        assert.match(database, /^eventgenix_d06_test_[a-f0-9]{32}$/);
        await admin.query(`CREATE DATABASE "${database}"`);
        created = lifecycle.databaseCreated = true;
        db = new Pool({ host: '/var/run/postgresql', user: 'postgres', database, max: 8,
            statement_timeout: 20000, connectionTimeoutMillis: 5000 });
        assert.equal((await db.query('SELECT current_database() AS name')).rows[0].name, database);
        const port = await reservePort();
        const baseUrl = `http://127.0.0.1:${port}`;
        const env = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8',
            NODE_ENV: 'test', SYS_MB_D06_LOCAL: 'true', PORT: String(port), LOG_LEVEL: 'warn',
            PGHOST: '/var/run/postgresql', PGUSER: 'postgres', PGDATABASE: database, PGPORT: '5432', PGPASSWORD: '', DATABASE_URL: '',
            JWT_SECRET: randomSecret(), BOOTSTRAP_CREATOR_USERNAME: bootstrap.username,
            BOOTSTRAP_CREATOR_PASSWORD: bootstrap.password, BOOTSTRAP_CREATOR_NAME: 'D06 Synthetic Platform Creator',
            BACKUP_OUTBOUND_HOLD: 'true', SKIP_TELEGRAM_BOT_STARTUP_CONFIG: 'true',
            RATE_LIMIT_MAX: '20000', LOGIN_RATE_LIMIT_MAX: '2000',
            TELEGRAM_BOT_TOKEN: '', REPORT_BOT_TOKEN: '', KLESHNYA_WEBHOOK_SECRET: '',
            NODE_OPTIONS: '--require=./tests/acceptance/sys-mb-local-preload.cjs' };
        server = spawn(process.execPath, ['server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
        const capture = chunk => {
            serverLog += redact(String(chunk));
            fs.writeFileSync(path.join(outputDir, 'server.log'), serverLog);
        };
        server.stdout.on('data', capture); server.stderr.on('data', capture);
        let spawnError;
        server.on('error', error => { spawnError = error; });
        for (let attempt = 0; attempt < 360; attempt++) {
            if (spawnError) throw spawnError;
            if (server.exitCode !== null) throw new Error('Actual server exited during startup: ' + server.exitCode);
            try {
                const response = await fetch(baseUrl + '/api/health', { signal: AbortSignal.timeout(1000) });
                if (response.ok) { lifecycle.appStarted = true; break; }
            } catch {}
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        assert.ok(lifecycle.appStarted, 'Actual server startup timed out');
        const ledger = (await db.query('SELECT version FROM schema_migrations')).rows.map(row => row.version);
        const expected = fs.readdirSync(path.join(root, 'db/migrations')).filter(file => file.endsWith('.sql')).map(file => file.slice(0, -4));
        const missing = expected.filter(file => !ledger.includes(file));
        writeJson('schema.json', (await db.query(`SELECT table_name,column_name,data_type,is_nullable,column_default
            FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`)).rows);
        record({ id: 'startup-full-schema', domain: 'startup', status: missing.length ? 'FAIL' : 'PASS',
            expected: 'All existing SQL migrations applied by actual server startup', observed: { count: ledger.length, missing } });
        async function login(account) {
            const response = await fetch(baseUrl + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: account.username, password: account.password }) });
            const body = await response.json();
            assert.equal(response.status, 200, 'Synthetic account login failed: ' + (body.code || response.status));
            account.id = Number(body.user.id); account.token = body.token || body.accessToken;
            assert.ok(account.token); secretValues.push(account.token);
            if (body.accessToken) secretValues.push(body.accessToken);
            if (body.refreshToken) secretValues.push(body.refreshToken);
            return account;
        }
        fixture.actors.platformCreator = await login(bootstrap);
        async function request({ actor = 'owner', method = 'GET', path: apiPath, context, body }) {
            assert.ok(apiPath.startsWith('/api/'), 'Acceptance requests stay on the local API');
            const account = typeof actor === 'string' ? fixture.actors[actor] : actor;
            assert.ok(account?.token, 'A synthetic logged-in account is required');
            const headers = { Authorization: `Bearer ${account.token}`, 'Content-Type': 'application/json' };
            if (context !== undefined) headers['X-Business-Context'] = context;
            const response = await fetch(baseUrl + apiPath, { method, headers,
                ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
            const raw = await response.text();
            let data; try { data = JSON.parse(raw); } catch { data = { nonJson: true, preview: raw.slice(0, 160) }; }
            return { status: response.status, body: data, headers: Object.fromEntries(response.headers) };
        }
        const boot = await request({ actor: 'platformCreator', method: 'POST', path: '/api/organizations/bootstrap',
            body: { name: 'D06 Synthetic Organization', slug: runId.replaceAll('_', '-') } });
        assert.equal(boot.status, 201, 'Actual organization bootstrap: ' + JSON.stringify(boot.body));
        lifecycle.bootstrap = true;
        fixture.organizations.primaryId = Number(boot.body.organization.id);
        const org2 = await db.query('INSERT INTO organizations (slug,name,created_by_user_id) VALUES ($1,$2,$3) RETURNING id',
            [runId + '-other', 'D06 Other Organization', bootstrap.id]);
        fixture.organizations.secondaryId = Number(org2.rows[0].id);
        const modules = ['dashboard','timeline','tasks','customers','leads','finance','programs','warehouse','settings','omni'];
        await db.query("UPDATE businesses SET modules=$1::jsonb WHERE organization_id=$2", [JSON.stringify([...modules,'graduation']), fixture.organizations.primaryId]);
        const other = await db.query(`INSERT INTO businesses(organization_id,context_key,label,short_label,access_mode,modules)
            VALUES($1,'d06_other','D06 Other Business','D06 Other','membership',$2::jsonb) RETURNING id`,
            [fixture.organizations.secondaryId, JSON.stringify(modules)]);
        const maysternya = await db.query(`INSERT INTO businesses(organization_id,context_key,label,short_label,access_mode,modules)
            VALUES($1,'maysternya_doli','Майстерня долі','МД','membership',$2::jsonb) RETURNING id`,
            [fixture.organizations.primaryId, JSON.stringify(['dashboard','timeline','tasks','customers','leads','omni','finance','programs','settings'])]);
        const crm = await db.query(`INSERT INTO businesses(organization_id,context_key,label,short_label,access_mode,modules)
            VALUES($1,'crm','CRM продажі','CRM','membership',$2::jsonb) RETURNING id`,
            [fixture.organizations.primaryId, JSON.stringify(['dashboard','tasks','customers','leads','omni','finance','settings'])]);
        const businesses = (await db.query('SELECT id,context_key FROM businesses')).rows;
        fixture.businesses = { parkId: Number(businesses.find(row => row.context_key === 'event_genix').id),
            darId: Number(businesses.find(row => row.context_key === 'dar').id),
            maysternyaId: Number(maysternya.rows[0].id), crmId: Number(crm.rows[0].id),
            customId: Number(other.rows[0].id), customKey: 'd06_other' };
        async function addAccount(key, contexts = ['event_genix','dar'], defaultContext = contexts[0]) {
            const account = { username: `${runId}_${key}`, password: randomSecret() };
            const hash = await bcrypt.hash(account.password, 10);
            const row = await db.query(`INSERT INTO users(username,password_hash,name,role,business_contexts,default_business_context)
                VALUES($1,$2,$3,'director',$4,$5) RETURNING id`, [account.username,hash,`D06 ${key}`,contexts,defaultContext]);
            account.id = Number(row.rows[0].id); fixture.actors[key] = account;
        }
        for (const key of ['owner','admin','manager','worker','multiOrg','revocable','unassigned']) await addAccount(key);
        await addAccount('otherOrg',['d06_other']);
        async function membership(key, organizationId, businessId, role, orgRole = 'member', isDefault = false) {
            const actor = fixture.actors[key];
            await db.query(`INSERT INTO organization_memberships(organization_id,user_id,role)
                VALUES($1,$2,$3) ON CONFLICT(organization_id,user_id) DO UPDATE SET role=EXCLUDED.role`, [organizationId,actor.id,orgRole]);
            await db.query(`INSERT INTO business_memberships(organization_id,business_id,user_id,role,is_default)
                VALUES($1,$2,$3,$4,$5)`,[organizationId,businessId,actor.id,role,isDefault]);
        }
        for (const key of ['owner','admin','worker','multiOrg','revocable']) {
            await membership(key,fixture.organizations.primaryId,fixture.businesses.parkId,key === 'admin' ? 'manager':'director',key === 'owner'?'owner':key === 'admin'?'admin':'member',true);
            await membership(key,fixture.organizations.primaryId,fixture.businesses.darId,['worker','multiOrg'].includes(key)?'animator':key==='admin'?'manager':'director',key==='owner'?'owner':key==='admin'?'admin':'member');
        }
        await membership('owner',fixture.organizations.primaryId,fixture.businesses.maysternyaId,'director','owner');
        await membership('owner',fixture.organizations.primaryId,fixture.businesses.crmId,'director','owner');
        await membership('admin',fixture.organizations.primaryId,fixture.businesses.maysternyaId,'admin','admin');
        await membership('admin',fixture.organizations.primaryId,fixture.businesses.crmId,'admin','admin');
        await membership('manager',fixture.organizations.primaryId,fixture.businesses.maysternyaId,'manager','member');
        await membership('worker',fixture.organizations.primaryId,fixture.businesses.maysternyaId,'animator','member');
        await membership('worker',fixture.organizations.primaryId,fixture.businesses.crmId,'animator','member');
        await membership('otherOrg',fixture.organizations.secondaryId,fixture.businesses.customId,'director','owner',true);
        await membership('multiOrg',fixture.organizations.secondaryId,fixture.businesses.customId,'manager','member',true);
        await db.query("UPDATE organization_memberships SET role='member' WHERE user_id=$1 AND organization_id=$2",[bootstrap.id,fixture.organizations.primaryId]);
        for (const account of Object.values(fixture.actors)) if (account !== bootstrap) await login(account);
        record({ id:'bootstrap-two-organizations',domain:'lifecycle',status:'PASS',expected:'Actual creator bootstrap, explicit synthetic memberships',
            observed:{ organizations:2,businesses:5,targetBusinesses:4,accounts:Object.keys(fixture.actors).length,ownerPlatformRole:'director' } });
        if (process.argv.includes('--startup-only')) return;
        const domain = require('./sys-mb-domain-scenarios.cjs');
        const readiness = require('./sys-mb-readiness-scenarios.cjs');
        await domain.seed({db,fixture});
        process.stdout.write('[D06] Domain fixtures prepared\n');
        await readiness.seed({db,fixture});
        process.stdout.write('[D06] Readiness fixtures prepared\n');
        const catalogCutover = require('../../services/catalogOwnershipCutover');
        const { recordCompatibilityTelemetry, sha256 } = require('../../services/businessCutover');
        const missingCatalogs = [
            ['d06-122112', '122112', true], ['d06-21312', '21312', false],
            ['d06-4214', '4214', false], ['d06-mushroom-cakes', 'Торти з грибів', false]
        ];
        for (const [id, name, hasToken] of missingCatalogs) await db.query(
            `INSERT INTO catalog_definitions(id,name,is_active,status,public_token)
             VALUES($1,$2,false,'draft',CASE WHEN $3 THEN $4 ELSE NULL END)
             ON CONFLICT(id) DO NOTHING`, [id, name, hasToken, hasToken ? randomSecret() : null]
        );
        await db.query("UPDATE catalog_definitions SET public_token=COALESCE(public_token,$2) WHERE id=$1", ['cake', randomSecret()]);
        await db.query("UPDATE catalog_definitions SET public_token=COALESCE(public_token,$2) WHERE id=$1", ['graduation', randomSecret()]);
        const catalogRows = (await db.query(
            'SELECT id,name FROM catalog_definitions WHERE name=ANY($1::text[]) ORDER BY id',
            [catalogCutover.EXPECTED_CATALOG_NAMES]
        )).rows;
        const approvedCatalogMapping = { businessContext: 'event_genix',
            decisionRef: 'SYS-MB-CLOSE-01:disposable-acceptance',
            catalogs: catalogRows.map(row => ({ id: row.id, name: row.name })),
            publicCatalogNames: [...catalogCutover.PUBLIC_CATALOG_NAMES] };
        const catalogPayload = { approvedMapping: approvedCatalogMapping,
            mappingSha256: sha256(approvedCatalogMapping), decisionRef: approvedCatalogMapping.decisionRef };
        const preparedCatalogs = await catalogCutover.prepareCatalogOwnershipCutover(db, fixture.actors.owner, catalogPayload);
        const appliedCatalogs = await catalogCutover.applyCatalogOwnershipCutover(db, fixture.actors.owner,
            { ...catalogPayload, sourceFingerprintSha256: preparedCatalogs.sourceFingerprintSha256 });
        const replayedCatalogs = await catalogCutover.applyCatalogOwnershipCutover(db, fixture.actors.owner,
            { ...catalogPayload, sourceFingerprintSha256: preparedCatalogs.sourceFingerprintSha256 });
        const verifiedCatalogs = await db.query(
            `SELECT COUNT(*)::int AS roots,
                    COUNT(*) FILTER (WHERE ownership_status='approved' AND business_context='event_genix')::int AS approved,
                    COUNT(*) FILTER (WHERE publication_visibility='public_existing_token')::int AS public_links
               FROM catalog_definitions WHERE name=ANY($1::text[])`, [catalogCutover.EXPECTED_CATALOG_NAMES]
        );
        const publicCatalogs = (await db.query(
            `SELECT id,public_token FROM catalog_definitions
              WHERE name=ANY($1::text[]) ORDER BY id`, [catalogCutover.PUBLIC_CATALOG_NAMES]
        )).rows;
        const publicStatuses = [];
        for (const catalog of publicCatalogs) {
            const response = await fetch(`${baseUrl}/catalog/${encodeURIComponent(catalog.id)}/${encodeURIComponent(catalog.public_token)}`,
                { signal: AbortSignal.timeout(30000) });
            publicStatuses.push(response.status);
        }
        const privateResponse = await fetch(`${baseUrl}/catalog/d06-21312/${randomSecret()}`,
            { signal: AbortSignal.timeout(30000) });
        record({ id: 'catalog.ownership.atomic_apply_replay', domain: 'catalogs',
            status: Number(verifiedCatalogs.rows[0].roots) === 9 && Number(verifiedCatalogs.rows[0].approved) === 9
                && Number(verifiedCatalogs.rows[0].public_links) === 3 && replayedCatalogs.replay
                && publicStatuses.every(status => status === 200) && privateResponse.status === 404 ? 'PASS' : 'FAIL',
            expected: 'Exact nine Park catalogs and children apply atomically, preserve three links and replay idempotently',
            observed: { roots: Number(verifiedCatalogs.rows[0].roots), approved: Number(verifiedCatalogs.rows[0].approved),
                publicLinks: Number(verifiedCatalogs.rows[0].public_links), childCounts: preparedCatalogs.childCounts,
                publicLinkStatuses: publicStatuses, privateLinkStatus: privateResponse.status,
                replay: replayedCatalogs.replay, assets: appliedCatalogs.assets } });
        const telemetryDeployment = 'a'.repeat(40);
        await recordCompatibilityTelemetry(db, { businessContext: 'maysternya_doli', entryFamily: 'provider',
            decisionStage: 'admission', authoritySource: 'machine_principal', outcome: 'allowed',
            deploymentSha: telemetryDeployment });
        await recordCompatibilityTelemetry(db, { businessContext: 'maysternya_doli', entryFamily: 'provider',
            decisionStage: 'admission', authoritySource: 'machine_principal', outcome: 'allowed',
            deploymentSha: telemetryDeployment });
        const telemetryProof = await db.query(
            `SELECT (SELECT SUM(eligible_count)::int FROM business_compatibility_telemetry_v2_hourly
                      WHERE deployment_sha=$1) AS decision_eligible,
                    (SELECT SUM(collected_count)::int FROM business_compatibility_telemetry_v2_hourly
                      WHERE deployment_sha=$1) AS decision_collected,
                    (SELECT SUM(eligible_count)::int FROM business_compatibility_telemetry_runtime
                      WHERE deployment_sha=$1) AS runtime_eligible,
                    (SELECT SUM(persisted_count)::int FROM business_compatibility_telemetry_runtime
                      WHERE deployment_sha=$1) AS runtime_persisted`, [telemetryDeployment]
        );
        const telemetryCounts = telemetryProof.rows[0];
        record({ id: 'telemetry.v2.persistence_reconciliation', domain: 'telemetry',
            status: Object.values(telemetryCounts).every(value => Number(value) === 2) ? 'PASS' : 'FAIL',
            expected: 'Eligible, collected and runtime persisted counters reconcile across a repeated decision',
            observed: Object.fromEntries(Object.entries(telemetryCounts).map(([key, value]) => [key, Number(value)])) });
        const context = {baseUrl,fixture,request,db,record};
        const readinessResult = await readiness.run(context);
        if (readinessResult) writeJson('readiness.json',readinessResult);
        await domain.run(context);
        if (!process.argv.includes('--no-browser')) {
            const browserOptions = { baseUrl,fixture,outputDir:windowsPath(path.join(root,'output/playwright/sys-mb-d06',runId)),
                playwrightModule:'C:/Users/Plotva/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright',
                executablePath:'C:/Users/Plotva/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe' };
            const interfaceAddress = Object.values(os.networkInterfaces()).flat().find(address =>
                address.family === 'IPv4' && !address.internal && /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(address.address));
            assert.ok(interfaceAddress, 'A local WSL interface is required for the Windows browser TCP bridge');
            browserOptions.localForwardTarget = { host: interfaceAddress.address, port };
            browserChild = spawn('/mnt/c/Users/Plotva/.local/eventgenix-node22-runtime/node_modules/node/bin/node.exe',
                [windowsPath(path.join(__dirname,'sys-mb-browser-worker.cjs'))], {cwd:root,
                    env:{...process.env,SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows',USERPROFILE:'C:\\Users\\Plotva',
                        LOCALAPPDATA:'C:\\Users\\Plotva\\AppData\\Local',TEMP:'C:\\Users\\Plotva\\AppData\\Local\\Temp'},
                    stdio:['pipe','pipe','pipe'],windowsHide:true});
            let browserText=''; browserChild.stdout.on('data',chunk=>{
                const text = String(chunk); browserText += text;
                for (const line of text.split(/\r?\n/)) if (/^D06_BROWSER_PROGRESS [A-Za-z0-9_-]+ (PASS|FAIL|NOT_TESTABLE)$/.test(line)) {
                    process.stdout.write(line + '\n');
                }
            });
            browserChild.stderr.on('data',chunk=>{browserText+=String(chunk);});
            const browserClosed = new Promise((resolve,reject)=>{browserChild.once('close',resolve);browserChild.once('error',reject);});
            browserChild.stdin.end(JSON.stringify(browserOptions));
            const timer=setTimeout(()=>browserChild.kill('SIGTERM'),15*60*1000);
            const browserExit=await browserClosed;clearTimeout(timer);
            const line=browserText.split(/\r?\n/).find(text=>text.startsWith('D06_BROWSER_RESULT='));
            fs.writeFileSync(path.join(outputDir,'browser-worker.log'),redact(browserText));
            if(line){const result=JSON.parse(line.slice('D06_BROWSER_RESULT='.length)); for(const item of result.records||[])record(item);writeJson('browser.json',result);
                if(result.error)record({id:'browser-runner',domain:'browser',status:'FAIL',observed:result.error});}
            else record({id:'browser-runner',domain:'browser',status:'NOT_TESTABLE',observed:{exitCode:browserExit,reason:'No browser result received'}});
        }
        const postOwnership = await readiness.collectOwnershipReadiness(db, fixture);
        writeJson('ownership-after-scenarios.json', postOwnership);
        const regressions = [];
        for (const [edge, after] of Object.entries(postOwnership.relationships || {})) {
            const before = readinessResult?.ownership?.relationships?.[edge];
            for (const metric of ['orphanRows', 'crossContextRows', 'unknownContextRows']) {
                if (before?.counts && after?.counts && after.counts[metric] > before.counts[metric]) {
                    regressions.push({ edge, metric, before: before.counts[metric], after: after.counts[metric] });
                }
            }
        }
        record({ id: 'D06-OWNERSHIP-AFTER-SCENARIOS', domain: 'ownership_collection',
            status: postOwnership.collectionStatus !== 'COMPLETE' ? 'NOT_TESTABLE' : regressions.length ? 'FAIL' : 'PASS',
            expected: 'No new orphan/cross-context relationships across the declared edges after acceptance mutations',
            observed: { collectionStatus: postOwnership.collectionStatus, regressions,
                scope: 'Declared SQL edges only; intentional pre-existing sentinels retained' } });
    } catch(error) {
        record({id:'harness-stage',domain:'harness',status:'FAIL',observed:{name:error.name,message:redact(error.message),stack:redact(error.stack).split('\n').slice(0,6)}});
        process.exitCode=1;
    } finally {
        await stop(browserChild); await stop(server);
        if(db)await db.end();
        if(created){
            assert.match(database,/^eventgenix_d06_test_[a-f0-9]{32}$/);
            await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[database]);
            await admin.query(`DROP DATABASE "${database}"`);
            assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount,0);
            lifecycle.cleanupVerified=true;
        }
        await admin.end();
        record({ id: 'acceptance-source-stability', domain: 'harness',
            status: sourceState.every(entry => hash(entry.path) === entry.sha256) ? 'PASS' : 'FAIL',
            expected: 'No source modifications while actual-app acceptance is running',
            observed: { changed: sourceState.filter(entry => hash(entry.path) !== entry.sha256).map(entry => entry.path) } });
        fs.writeFileSync(path.join(outputDir,'server.log'),redact(serverLog));
        writeJson('result.json',{runId,node:process.version,entrypoint:'server.js',lifecycle,records,
            limitations:['Disposable fixture source only','Startup schedulers held; real provider calls forbidden',
                'Actual WebSocket module attached by test-only preload after outbound-hold startup',
                'No production counts or compatibility zero-usage claim'],
            outboundDeniedHosts:[...new Set([...serverLog.matchAll(/\[D06_OUTBOUND_DENIED\] ([^\r\n]+)/g)].map(match=>match[1]))]});
        process.stdout.write(`D06_RESULT ${path.relative(root,path.join(outputDir,'result.json'))}\n`);
    }
}
main().catch(error=>{process.stderr.write(redact(error.stack)+'\n');process.exitCode=1;});
