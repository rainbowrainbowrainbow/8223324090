#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { Client, Pool } = require('pg');
const { DATABASES, OWNER, OWNER_KEY, assertLocalTarget, seedDataset, preflight } = require('./lib/education-ready-dataset');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'output/education-ready/02');
const DATA = path.join(OUT, 'postgres-data');
const BIN = process.env.EDU_READY_PG_BIN || 'C:/Users/Plotva/AppData/Local/Temp/eventgenix-eduqa-20261001/native/bin';
const PORT = 3012;
const CONFIG = { host: '127.0.0.1', port: 55469, user: 'postgres', ssl: false };
let server;
function safeEnvironment(database, credentials = {}) {
    // An allowlist avoids inheriting credentials, proxies or production provider settings.
    const env = {};
    for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'COMSPEC', 'PATHEXT'])
        if (process.env[key]) env[key] = process.env[key];
    return { ...env, NODE_ENV: 'test', PGHOST: CONFIG.host, PGPORT: String(CONFIG.port), PGDATABASE: database,
        PGUSER: CONFIG.user, PGSSLMODE: 'disable', PORT: String(PORT), LOG_LEVEL: 'warn', BACKUP_OUTBOUND_HOLD: 'true',
        EDU_READY_LOCAL_CONFIRM: 'SEED_OWNED_LOCAL_EDUCATION', JWT_SECRET: crypto.randomBytes(64).toString('hex'),
        BOOTSTRAP_CREATOR_USERNAME: credentials.username || '', BOOTSTRAP_CREATOR_PASSWORD: credentials.password || '',
        BOOTSTRAP_CREATOR_NAME: 'Адміністратор навчального центру',
        NODE_OPTIONS: `--require="${path.join(ROOT, 'scripts/lib/education-ready-loopback.js').replace(/\\/g, '/')}"` };
}
function pgTool(name, args) {
    const result = spawnSync(path.join(BIN, `${name}.exe`), args, { windowsHide: true, encoding: 'utf8', timeout: 60000 });
    assert.equal(result.status, 0, `Owned PostgreSQL ${name} failed; inspect local PostgreSQL log`);
}
async function ensureCluster() {
    const markerPath = path.join(OUT, 'cluster-owner.json');
    fs.mkdirSync(OUT, { recursive: true });
    if (fs.existsSync(DATA)) {
        assert.ok(fs.existsSync(markerPath), 'Unowned data directory; refusing to start');
        const marker = JSON.parse(fs.readFileSync(markerPath));
        assert.equal(marker.owner, OWNER); assert.equal(path.resolve(marker.dataDirectory), DATA); assert.equal(marker.port, 55469);
    } else {
        pgTool('initdb', ['-D', DATA, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C']);
        fs.writeFileSync(markerPath, JSON.stringify({ owner: OWNER, dataDirectory: DATA, port: 55469, loopback: true }, null, 2));
    }
    const status = spawnSync(path.join(BIN, 'pg_ctl.exe'), ['-D', DATA, 'status'], { windowsHide: true, encoding: 'utf8' });
    if (status.status !== 0) pgTool('pg_ctl', ['-D', DATA, '-l', path.join(OUT, 'postgres.log'), '-o', '-p 55469 -h 127.0.0.1', '-w', 'start']);
    const admin = new Client({ ...CONFIG, database: 'postgres' });
    await admin.connect();
    try {
        const identity = (await admin.query("SELECT current_setting('data_directory') directory, host(inet_server_addr()) host, inet_server_port() port")).rows[0];
        assert.equal(path.resolve(identity.directory), DATA); assert.equal(identity.host, '127.0.0.1'); assert.equal(identity.port, 55469);
        const databaseOwnerPath = path.join(OUT, 'database-owner.json');
        const owned = fs.existsSync(databaseOwnerPath) ? JSON.parse(fs.readFileSync(databaseOwnerPath)) : { owner: OWNER, databases: [] };
        assert.equal(owned.owner, OWNER);
        // The independently owned device preview has a separate08C registry/lifecycle.
        for (const database of [DATABASES.demo, DATABASES.fixed]) {
            const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database]);
            if (exists.rowCount) assert.ok(owned.databases.includes(database), 'Existing database is not registry-owned');
            else {
                await admin.query(`CREATE DATABASE "${database}"`);
                owned.databases.push(database);
                fs.writeFileSync(databaseOwnerPath, JSON.stringify(owned, null, 2));
            }
        }
    } finally { await admin.end(); }
}
async function prepare() {
    assertLocalTarget('demo');
    const { pool, initDatabase } = require('../db');
    try {
        const count = (await pool.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n;
        if (count) {
            const marker = await pool.query('SELECT value FROM settings WHERE key=$1', [OWNER_KEY]);
            if (marker.rowCount) assert.equal(JSON.parse(marker.rows[0].value).owner, OWNER);
            else {
                const owned = JSON.parse(fs.readFileSync(path.join(OUT, 'database-owner.json')));
                assert.equal(owned.owner, OWNER); assert.ok(owned.databases.includes(DATABASES.demo));
                for (const table of ['customers', 'customer_children', 'education_groups', 'bookings']) {
                    const exists = (await pool.query('SELECT to_regclass($1) name', [table])).rows[0].name;
                    if (exists) assert.equal((await pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n, 0, 'Unowned manual records found');
                }
            }
        }
        const { runMigrations } = require('../db/migrate');
        await initDatabase(); await runMigrations(pool); await initDatabase();
        const result = await seedDataset(pool, 'demo');
        const { saveBusinessCabinetSettings } = require('../services/businessCabinet');
        if (!result.reused) {
            for (const context of ['dar', 'maysternya_doli']) await saveBusinessCabinetSettings(pool, context,
                { businessType: 'education', timelineMode: 'education', resourceModel: 'cabinet' });
            await saveBusinessCabinetSettings(pool, 'event_genix', { businessType: 'entertainment', timelineMode: 'park' });
        }
        fs.writeFileSync(path.join(OUT, 'demo-manifest.json'), JSON.stringify(result.manifest, null, 2));
        fs.writeFileSync(path.join(OUT, 'demo-preflight.json'), JSON.stringify({ ...await preflight(pool, result.manifest), reused: result.reused }, null, 2));
        console.log(`Local synthetic demo preflight PASS; reused=${result.reused}`);
    } finally { await pool.end(); }
}
async function start() {
    assert.notEqual(process.env.NODE_ENV, 'production');
    for (const key of Object.keys(process.env).filter(key => /^RAILWAY_/.test(key))) assert.ok(!process.env[key], 'Production environment forbidden');
    const credentials = { username: process.env.EDU_READY_USERNAME || process.env.LIVE_CREATOR_USER || process.env.LIVE_SMOKE_USER,
        password: process.env.EDU_READY_PASSWORD || process.env.LIVE_CREATOR_PASS || process.env.LIVE_SMOKE_PASS };
    assert.ok(credentials.username && credentials.password, 'Provide private process-local bootstrap credentials; values will not be printed');
    try { await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(500) }); throw new Error('Preview port3012 is already occupied; no process will be stopped'); }
    catch (error) { if (error.message.includes('already occupied')) throw error; }
    await ensureCluster();
    const env = safeEnvironment(DATABASES.demo, credentials);
    const prepared = spawn(process.execPath, [__filename, 'prepare-child'], { cwd: ROOT, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let preparedOutput = '';
    for (const stream of [prepared.stdout, prepared.stderr]) stream.on('data', chunk => { preparedOutput += chunk.toString(); });
    const prepareCode = await new Promise((resolve, reject) => { prepared.once('error', reject); prepared.once('exit', resolve); });
    if (prepareCode !== 0) {
        // Child output may include bootstrap identifiers; expose only error classes/SQL codes.
        const sanitized = preparedOutput.replaceAll(credentials.username, '[REDACTED]').replaceAll(credentials.password, '[REDACTED]')
            .replace(/Bearer\s+\S+/g, 'Bearer [REDACTED]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED]');
        fs.writeFileSync(path.join(OUT, 'prepare-failed.log'), sanitized);
        const reason = preparedOutput.match(/(?:AssertionError[^\r\n]*|error: [^\r\n]*|Error: [^\r\n]*)/g) || [];
        console.error(reason.map(line => line.replaceAll(credentials.username, '[REDACTED]').replaceAll(credentials.password, '[REDACTED]')).join('\n'));
        throw new Error(`Local preparation failed (exit ${prepareCode}); see sanitized prepare-failed.log; no production or unrelated DB was touched`);
    }
    server = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let serverFailure;
    server.once('error', error => { serverFailure = error; });
    // Suppress raw app logs; fixture/preview diagnostics are separate sanitized artifacts.
    server.stdout.resume(); server.stderr.resume();
    const deadline = Date.now() + 180000;
    let healthy = false;
    while (Date.now() < deadline) {
        if (serverFailure || server.exitCode !== null) throw new Error('Preview server exited before health was ready');
        try { const response = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(1000) });
            if (response.ok && (await response.json()).database === 'connected') { healthy = true; break; }
        } catch { /* Bounded health predicate, not a UI delay. */ }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(healthy, 'Preview health deadline exceeded');
    const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'demo-manifest.json')));
    const url = `http://127.0.0.1:${PORT}/?businessContext=dar&educationSchedule=today&date=${manifest.anchorDate}`;
    fs.writeFileSync(path.join(OUT, 'preview.json'), JSON.stringify({ owner: OWNER, parentPid: process.pid, serverPid: server.pid,
        worktree: ROOT, url, database: DATABASES.demo, postgresPort: 55469, anchorDate: manifest.anchorDate, outbound: 'BLOCKED',
        startedAt: new Date().toISOString(), storage: 'Retained; no disposable cleanup' }, null, 2));
    console.log(`Education preview ready: ${url}`);
    console.log('Use your privately supplied test login. No credentials are persisted. Ctrl+C stops only this app; data remains.');
    await new Promise((resolve, reject) => { server.once('exit', code => code === 0 ? resolve() : reject(new Error('Preview server stopped'))); });
}
async function stop() {
    if (server && server.exitCode === null) server.kill();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void stop().finally(() => process.exit(0)); });
if (require.main === module) (process.argv[2] === 'prepare-child' ? prepare() : start()).catch(async error => {
    console.error(error.message); await stop(); process.exitCode = 1;
});
module.exports = { safeEnvironment };
