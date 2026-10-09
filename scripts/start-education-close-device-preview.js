#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Client, Pool } = require('pg');
const { ROOT, OUT, OWNER, DB, APP_PORT, LAN_PORT, hash, inventory, writePolicy, createTemplate } = require('./lib/education-close-device');
const { OWNER_KEY, seedDataset, preflight, assertLocalTarget } = require('./lib/education-ready-dataset');
const { safeEnvironment } = require('./start-education-ready-preview');
const { privateAddress, createGateway } = require('./lib/education-device-gateway');
const CONFIG = { host: '127.0.0.1', port: 55469, user: 'postgres', ssl: false };
const ownerFile = path.join(OUT, 'database-owner.json');
const clusterFile = 'C:/Users/Plotva/.codex/worktrees/education-ready-pack/EventGenix/output/education-ready/02/cluster-owner.json';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const write = (file, value) => fs.writeFileSync(path.join(OUT, file), JSON.stringify(value, null, 2));
let app, gateway, timer, stopping = false;
const stats = {};
function env() {
    const username = process.env.EDU_READY_USERNAME || process.env.LIVE_CREATOR_USER;
    const password = process.env.EDU_READY_PASSWORD || process.env.LIVE_CREATOR_PASS;
    assert.ok(username && password, 'Load private operator test login locally; no secret output');
    return { ...safeEnvironment(DB, { username, password }), PORT: String(APP_PORT), TZ: 'Europe/Kyiv',
        EDU_CLOSE_DEVICE_CONFIRM: 'OWNED_CLOSE_DEVICE_PREVIEW_05' };
}
function owned(marker) {
    assert.equal(marker.owner, OWNER); assert.equal(marker.database, DB);
    assert.equal(path.resolve(marker.worktree), ROOT); assert.equal(marker.postgresPort, 55469);
    return marker;
}
async function preserved() {
    const result = {};
    for (const database of ['eventgenix_education_ready_manual', 'eventgenix_education_ready_devices']) {
        const pool = new Pool({ ...CONFIG, database });
        try {
            result[database] = {};
            const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
            for (const { tablename } of tables) {
                assert.match(tablename, /^[a-zA-Z0-9_]+$/);
                const rows = (await pool.query(`SELECT to_jsonb(t)::text row FROM "${tablename}" t ORDER BY to_jsonb(t)::text`)).rows;
                result[database][tablename] = { count: rows.length, sha256: crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
            }
        } finally { await pool.end(); }
    }
    return result;
}
async function prepareChild() {
    assertLocalTarget('closeDevices');
    const { pool, initDatabase } = require('../db');
    try {
        const { runMigrations } = require('../db/migrate');
        await initDatabase(); await runMigrations(pool); await initDatabase();
        const result = await seedDataset(pool, 'closeDevices');
        const { saveBusinessCabinetSettings } = require('../services/businessCabinet');
        for (const business of ['dar', 'maysternya_doli']) await saveBusinessCabinetSettings(pool, business,
            { businessType: 'education', timelineMode: 'education', resourceModel: 'cabinet' });
        await saveBusinessCabinetSettings(pool, 'event_genix', { businessType: 'entertainment', timelineMode: 'park' });
        await pool.query('INSERT INTO settings(key,value) VALUES($1,$2)', ['education_close:devices:owner', JSON.stringify(owned(read(ownerFile)))]);
        write('dataset.json', result.manifest);
        write('preflight.json', await preflight(pool, result.manifest));
    } finally { await pool.end(); }
}
async function prepare(environment) {
    const admin = new Client({ ...CONFIG, database: 'postgres' }); await admin.connect();
    try {
        const identity = (await admin.query("SELECT current_setting('data_directory') directory, host(inet_server_addr()) host, inet_server_port() port")).rows[0];
        const cluster = read(clusterFile);
        assert.equal(cluster.owner, 'EDU-READY-02-v1'); assert.equal(cluster.port, 55469);
        assert.equal(path.resolve(identity.directory), path.resolve(cluster.dataDirectory));
        assert.equal(identity.host, '127.0.0.1'); assert.equal(identity.port, 55469);
        const exists = (await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [DB])).rowCount;
        if (exists) {
            owned(read(ownerFile));
            const pool = new Pool({ ...CONFIG, database: DB });
            try {
                const marker = (await pool.query('SELECT value FROM settings WHERE key=$1', ['education_close:devices:owner'])).rows[0]?.value;
                assert.ok(marker, 'Partial/unregistered preview; no reset/reseed'); assert.deepEqual(JSON.parse(marker), read(ownerFile));
                const dataset = read(path.join(OUT, 'dataset.json'));
                assert.deepEqual(JSON.parse((await pool.query('SELECT value FROM settings WHERE key=$1', [OWNER_KEY])).rows[0].value), dataset);
                await preflight(pool, dataset);
                return dataset;
            } finally { await pool.end(); }
        }
        assert.ok(!fs.existsSync(ownerFile), 'Stale registry; do not recreate');
        write('database-owner.json', { owner: OWNER, database: DB, worktree: ROOT, postgresPort: 55469, runId: crypto.randomUUID(), createdAt: new Date().toISOString() });
        await admin.query('CREATE DATABASE eventgenix_education_close_devices');
    } finally { await admin.end(); }
    const child = spawn(process.execPath, [__filename, 'prepare-child'], { cwd: ROOT, env: environment, windowsHide: true, stdio: 'ignore' });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    assert.equal(code, 0, 'Fresh preview preparation failed; no automatic reset and no raw secret-bearing logs');
    return read(path.join(OUT, 'dataset.json'));
}
async function unoccupied(port, host = '127.0.0.1') {
    await new Promise((resolve, reject) => { const server = require('node:net').createServer(); server.once('error', reject); server.listen(port, host, () => server.close(resolve)); });
}
async function health() {
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
        assert.equal(app.exitCode, null, 'Preview app exited');
        try { const response = await fetch(`http://127.0.0.1:${APP_PORT}/api/health`, { signal: AbortSignal.timeout(1000) });
            if (response.ok && (await response.json()).database === 'connected') return;
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 250)); // bounded health predicate, never a UI delay
    }
    throw new Error('Preview readiness deadline');
}
async function run() {
    assert.ok(!process.env.DATABASE_URL); assert.notEqual(process.env.NODE_ENV, 'production');
    assert.ok(!Object.entries(process.env).some(([key, value]) => /^RAILWAY_/.test(key) && value));
    fs.mkdirSync(OUT, { recursive: true });
    const before = await preserved(); write('preservation-start.json', before);
    const environment = env(); const dataset = await prepare(environment);
    assert.deepEqual(await preserved(), before); write('preservation-prepared.json', before);
    const manifestFile = path.join(OUT, 'manifest.json');
    if (!fs.existsSync(manifestFile)) {
        const manifest = { owner: OWNER, task: 'EDU-CLOSE-05', attemptId: 'close05-' + crypto.randomUUID(), preparedAt: new Date().toISOString(),
            worktree: ROOT, database: DB, anchorDate: dataset.anchorDate, timezone: 'Europe/Kyiv', ...inventory(ROOT), dataset };
        write('manifest.json', manifest); write('operator-results.json', createTemplate(manifest));
    } else require('../tests/helpers/education-close-evidence').assertInventory(read(manifestFile), ROOT);
    if (process.argv[2] === 'prepare') { console.log('CLOSE05 preview prepared; no listener opened.'); return; }
    assert.equal(process.argv[2], 'start');
    const args = process.argv.slice(3); const hostIndex = args.indexOf('--lan-host'); const host = hostIndex < 0 ? null : args[hostIndex + 1];
    const minutesIndex = args.indexOf('--lease-minutes'); const minutes = minutesIndex < 0 ? 30 : Number(args[minutesIndex + 1]);
    assert.ok(Number.isInteger(minutes) && minutes >= 5 && minutes <= 90);
    let prefix;
    if (host) {
        assert.ok(privateAddress(host));
        const matches = Object.values(os.networkInterfaces()).flat().filter(row => row?.family === 'IPv4' && !row.internal && row.address === host);
        assert.equal(matches.length, 1, 'Explicit existing RFC1918 LAN interface required');
        prefix = Number(matches[0].cidr.split('/')[1]); await unoccupied(LAN_PORT, host);
    }
    await unoccupied(APP_PORT);
    app = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, env: environment, windowsHide: true, stdio: 'ignore' });
    await health();
    if (host) { gateway = createGateway({ host, prefix, appPort: APP_PORT, lanPort: LAN_PORT, writePolicy, stats });
        await new Promise((resolve, reject) => { gateway.once('error', reject); gateway.listen(LAN_PORT, host, resolve); }); }
    const manifest = read(manifestFile); const url = `http://${host || '127.0.0.1'}:${host ? LAN_PORT : APP_PORT}/?businessContext=dar&educationSchedule=today&date=${dataset.anchorDate}`;
    write('preview.json', { owner: OWNER, attemptId: manifest.attemptId, database: DB, worktree: ROOT, url, parentPid: process.pid, serverPid: app.pid,
        appPort: APP_PORT, lanPort: host ? LAN_PORT : null, lanHost: host, prefix, startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + minutes * 60000).toISOString(), status: 'ACTIVE', outbound: 'BLOCKED', authentication: 'Unchanged CRM login' });
    console.log('Owned CLOSE05 preview ready: ' + url);
    const finished = new Promise(resolve => process.once('close-device-stopped', resolve));
    timer = setTimeout(() => void stop('LEASE_EXPIRED', before), minutes * 60000);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void stop(signal, before));
    app.once('exit', () => { if (!stopping) void stop('APP_EXITED', before); });
    await finished;
}
async function stop(reason, before) {
    if (stopping) return; stopping = true; clearTimeout(timer);
    if (gateway) { gateway.closeAllConnections(); await new Promise(resolve => gateway.close(resolve)); }
    if (app && app.exitCode === null) { const ended = new Promise(resolve => app.once('exit', resolve)); app.kill(); await ended; }
    if (before) { const after = await preserved(); assert.deepEqual(after, before); write('preservation-stopped.json', after); }
    write('cleanup.json', { owner: OWNER, status: 'STOPPED', reason, lanListenerOpened: Boolean(gateway), appStopped: true, stoppedAt: new Date().toISOString(), retainedUnchanged: Boolean(before) });
    const file = path.join(OUT, 'preview.json'); if (fs.existsSync(file)) { const preview = read(file); if (preview.parentPid === process.pid) { preview.status = 'STOPPED'; write('preview.json', preview); } }
    process.emit('close-device-stopped');
}
if (require.main === module) (process.argv[2] === 'prepare-child' ? prepareChild() : run()).catch(async error => {
    console.error(error.name + ': ' + error.message); await stop('FAILED'); process.exitCode = 1;
});
module.exports = { owned, preserved };
