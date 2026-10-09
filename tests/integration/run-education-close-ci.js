'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { acquireIsolatedDatabaseLock, runSuite } = require('../../scripts/run-isolated-postgres-tests');
const { DATABASES } = require('../../scripts/lib/education-ready-dataset');
const { inventory, hash, assertChecks, validateAttempt } = require('../helpers/education-close-evidence');
const contracts = require('../helpers/education-close-contracts.json');
const suite = process.argv[2], engine = process.argv[3] || 'chromium';
function playwrightPath() {
    if (process.env.EDU_QA_PLAYWRIGHT) return process.env.EDU_QA_PLAYWRIGHT;
    try { return require.resolve('playwright'); } catch {}
    for (const entry of String(process.env.PATH || '').split(path.delimiter)) {
        if (!/node_modules[\\/]\.bin[\\/]?$/.test(entry)) continue;
        const candidate = path.join(path.dirname(entry), 'playwright');
        if (fs.existsSync(candidate)) return candidate;
    }
    throw new Error('Playwright unavailable: run with npm exec --package=playwright');
}
function findProofs(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(item => {
        const file = path.join(directory, item.name);
        return item.isDirectory() ? findProofs(file) : item.name === 'verification.json' ? [file] : [];
    });
}
async function worker(contract, directory) {
    const database = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
    assert.ok(database.isLocal); assert.equal(database.hostname, '127.0.0.1'); assert.equal(database.databaseName, DATABASES.fixed);
    const lock = await acquireIsolatedDatabaseLock(database);
    Object.assign(process.env, { TZ: 'Europe/Kyiv', NODE_ENV: 'test', DATABASE_URL: '', PGHOST: database.hostname,
        PGPORT: database.url.port || '5432', PGDATABASE: database.databaseName,
        PGUSER: decodeURIComponent(database.url.username), PGPASSWORD: decodeURIComponent(database.url.password),
        EDU_CLOSE_PORTABLE: 'OWNED_DISPOSABLE_EDUCATION_CI', EDU_READY_LOCAL_CONFIRM: 'SEED_OWNED_LOCAL_EDUCATION',
        EDU_READY_STAGE: '08', EDU_READY_MODE: 'fixed', ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER: 'true',
        EDU_CLOSE_ATTEMPT_ID: path.basename(directory), EDU_CLOSE_SUITE: suite, EDU_MOBILE_ENGINE: engine,
        EDU_QA_PLAYWRIGHT: playwrightPath(), EDU_READY_OUTPUT: path.join(directory, 'artifacts'),
        EDU_READY_RUN_ROOT: path.join(directory, 'artifacts'), EDU_ACCEPTANCE_OUTPUT: path.join(directory, 'artifacts'),
        EDU_GROUPS_PHASE: 'postfix', EDU_LIFECYCLE_PHASE: 'postfix', EDU_DATE_PHASE: 'postfix', EDU_ASYNC_PHASE: 'postfix',
        EDU_TEACHERS_PHASE: 'postfix', EDU_MOBILE_PHASE: 'final', EDU_READY_REPORT_NOW: '2026-10-03T09:00:00Z', BACKUP_OUTBOUND_HOLD: 'true',
        NODE_OPTIONS: ['scripts/lib/education-ready-loopback.js', 'tests/helpers/education-ready-report-clock.js'].map(file => `--require="${path.resolve(file).replace(/\\/g, '/')}"`).join(' ') });
    for (const key of ['EDU_CLOSE_ONLY','EDU_LIFECYCLE_ONLY','EDU_MOBILE_PROFILE']) delete process.env[key];
    process.env.EDU_CLOSE_PG_FILE=contract.file;
    try {
        await runSuite(database, contract.file.startsWith('tests/browser/')?contract.file:'tests/browser/education-close-pg-wrapper.js', 'education-close-' + suite);
        const pool = new Pool({ host: database.hostname, port: Number(database.url.port || 5432), database: database.databaseName,
            user: decodeURIComponent(database.url.username), password: decodeURIComponent(database.url.password), ssl: false });
        try { assert.equal((await pool.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n, 0, 'Disposable cleanup'); }
        finally { await pool.end(); }
        const files=findProofs(path.join(directory,'artifacts'));assert.equal(files.length,1,'Exactly one proof per attempt');const proofFile=files[0];
        const proof = JSON.parse(fs.readFileSync(proofFile, 'utf8')); assert.equal(proof.attemptId, path.basename(directory)); assert.equal(proof.suite, suite); assertChecks(proof, contract);
        fs.writeFileSync(path.join(directory, 'proof-reference.json'), JSON.stringify({ proof: path.relative(directory, proofFile).replace(/\\/g, '/') }));
        console.log(`EDUCATION_EVIDENCE_COMPLETE ${path.basename(directory)} ${suite} ${hash(proofFile)}`);
    } finally { await lock.release(); }
}
async function main() {
    const contract = contracts[suite]; assert.ok(contract, 'Specify a known education suite'); assert.ok(['chromium', 'webkit'].includes(engine));
    if (process.argv[4] === '--worker') {
        const deadline=setTimeout(()=>{console.error('Education suite deadline exceeded');process.exit(1);},1200000);
        try{return await worker(contract,path.resolve(process.argv[5]));}finally{clearTimeout(deadline);}
    }
    const root = path.resolve(process.env.EDU_CLOSE_OUTPUT || 'output/education-ready/close04');
    assert.ok(root.startsWith(path.resolve('output/education-ready') + path.sep), 'Evidence must stay in education output');
    const attemptId = 'attempt-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + suite + '-' + engine + '-' + crypto.randomBytes(3).toString('hex');
    const directory = path.join(root, attemptId); fs.mkdirSync(directory, { recursive: true });
    const record = { schema: 'education-evidence-v2', attemptId, suite, engine, startedAt: new Date().toISOString(), status: 'NOT RUN', ...inventory() };
    let log = '';
    const secrets = Object.entries(process.env).filter(([key, value]) => /PASS|TOKEN|SECRET|API_KEY/.test(key) && value?.length > 5).map(([, value]) => value);
    const redact = text => secrets.reduce((value, secret) => value.split(secret).join('[REDACTED]'), text);
    const code = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [__filename, suite, engine, '--worker', directory], { env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        child.on('error', reject); for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { const text = redact(String(chunk)); log += text; process.stdout.write(text); });
        child.on('close', code => resolve(code ?? 1));
    });
    record.exitCode = code; record.finishedAt = new Date().toISOString(); record.log = 'run.log'; fs.writeFileSync(path.join(directory, record.log), log); record.logHash = hash(path.join(directory, record.log));
    try {
        assert.equal(code, 0, 'Suite failed/blocked; see attempt run.log');
        record.proof = JSON.parse(fs.readFileSync(path.join(directory, 'proof-reference.json'), 'utf8')).proof;
        record.proofHash = hash(path.join(directory, record.proof)); record.status = 'PASS';
        const verified = validateAttempt(record, directory, contract); record.executedChecks = verified.executedChecks; record.classification = contract.classification;
    } catch (error) { record.status = 'FAIL_OR_BLOCKED'; record.error = error.message; record.exitCode = 1; process.exitCode = 1; }
    fs.writeFileSync(path.join(directory, 'record.json'), JSON.stringify(record, null, 2));
    console.log(`${record.status}: ${directory}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
