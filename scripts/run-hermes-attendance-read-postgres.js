#!/usr/bin/env node
'use strict';

// Reuse the documented disposable Docker lifecycle, without the full CRM server runner.
const crypto = require('node:crypto');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { assertSafeTestDatabaseUrl, RESET_CONFIRMATION } = require('./test-db-safety');

const root = path.resolve(__dirname, '..');
const purpose = 'hermes-attendance-read-postgres';
const container = `eventgenix-attendance-pg-${crypto.randomBytes(6).toString('hex')}`;
const database = 'eventgenix_attendance_disposable_test';
let creationAttempted = false;

function docker(args, env = process.env) {
    try {
        return execFileSync('docker', args, { encoding: 'utf8', timeout: 30_000, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch {
        throw new Error(`Disposable PostgreSQL Docker ${args[0]} failed; no install or pull attempted`);
    }
}

function testEnvironment(url) {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
        if (/^(RAILWAY_|PG|POSTGRES_)/i.test(key)
            || /(DATABASE_URL|TOKEN|SECRET|API[_-]?KEY|WEBHOOK|SMTP|SENDGRID|TWILIO|STRIPE|OPENAI|ANTHROPIC|GEMINI|CLOUDINARY|AWS_|OMNI|TELEGRAM|REPORT_BOT|KLESHNYA)/i.test(key)
            || ['NODE_OPTIONS', 'TEST_URL'].includes(key)) delete env[key];
    }
    return {
        ...env,
        NODE_ENV: 'test',
        TEST_DATABASE_URL: url,
        TEST_DATABASE_RESET_CONFIRM: RESET_CONFIRMATION,
        REQUIRE_ISOLATED_TEST_TARGET: 'true',
        ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER: 'true',
        RUN_HERMES_ATTENDANCE_READ_INTEGRATION: 'true'
    };
}

async function run() {
    if (process.versions.node.split('.')[0] !== '22') throw new Error('Node 22 is required');
    if (process.env.NODE_ENV === 'production' || ['RAILWAY_ENVIRONMENT', 'RAILWAY_PROJECT_ID', 'RAILWAY_SERVICE_ID'].some(key => process.env[key])) {
        throw new Error('Disposable tests are blocked in production/Railway environments');
    }
    if (process.env.DOCKER_HOST || process.env.DOCKER_TLS_VERIFY) throw new Error('Use the local Docker context without connection overrides');
    const endpoint = docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
    if (!endpoint.startsWith('npipe:////./pipe/') && !endpoint.startsWith('unix:///')) throw new Error('Only a local Docker engine is permitted');
    docker(['info', '--format', '{{.ServerVersion}}']);
    const image = docker(['image', 'inspect', '--format', '{{.Id}}', 'postgres:16']);
    if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error('A cached postgres:16 image is required');
    const password = crypto.randomBytes(24).toString('hex');
    console.log('[attendance-pg] Starting cached PostgreSQL 16 with loopback-only port and temporary storage.');
    creationAttempted = true;
    docker([
        'run', '--detach', '--pull=never', '--name', container,
        '--label', 'com.eventgenix.disposable=true', '--label', `com.eventgenix.purpose=${purpose}`,
        '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data:rw',
        '--env', 'POSTGRES_USER=postgres', '--env', 'POSTGRES_PASSWORD', '--env', `POSTGRES_DB=${database}`,
        '--health-cmd', `pg_isready -U postgres -d ${database}`, '--health-interval', '1s',
        '--health-timeout', '2s', '--health-retries', '30', image
    ], { ...process.env, POSTGRES_PASSWORD: password });
    const mapping = docker(['port', container, '5432/tcp']);
    const match = /^127\.0\.0\.1:(\d+)$/.exec(mapping);
    if (!match) throw new Error('Disposable PostgreSQL must bind only to 127.0.0.1');
    const url = `postgresql://postgres:${password}@127.0.0.1:${match[1]}/${database}`;
    const target = assertSafeTestDatabaseUrl(url, { ...process.env, TEST_DATABASE_RESET_CONFIRM: RESET_CONFIRMATION });
    if (!target.isLocal) throw new Error('Remote database is forbidden');
    let healthy = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const status = docker(['inspect', '--format', '{{.State.Health.Status}}', container]);
        if (status === 'healthy') { healthy = true; break; }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!healthy) throw new Error('Disposable PostgreSQL did not become healthy');
    await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--test', 'tests/integration/hermes-attendance-read.integration.test.js'], {
            cwd: root, env: testEnvironment(url), windowsHide: true, stdio: 'inherit', timeout: 60_000
        });
        child.once('error', () => reject(new Error('Could not run isolated attendance test')));
        child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Isolated attendance test exited ${code}`)));
    });
}

run().catch(error => {
    console.error(`[attendance-pg] ${error.message}`);
    process.exitCode = 1;
}).finally(() => {
    if (!creationAttempted) return;
    try {
        const existing = docker(['ps', '--all', '--filter', `name=^/${container}$`, '--format', '{{.Names}}']);
        if (!existing) return;
        if (existing !== container) throw new Error('Refusing cleanup: container name does not match');
        const labels = JSON.parse(docker(['inspect', '--format', '{{json .Config.Labels}}', container]));
        if (labels['com.eventgenix.disposable'] !== 'true' || labels['com.eventgenix.purpose'] !== purpose) {
            throw new Error('Refusing cleanup: disposable container labels do not match');
        }
        docker(['rm', '--force', '--volumes', container]);
        console.log('[attendance-pg] Removed only the created disposable PostgreSQL container.');
    } catch (error) {
        console.error(`[attendance-pg] Cleanup failed for ${container}: ${error.message}`);
        process.exitCode = 1;
    }
});
