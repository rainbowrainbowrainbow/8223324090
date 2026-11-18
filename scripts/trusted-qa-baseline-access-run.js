#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { createHash } = require('node:crypto');
const { Client } = require('pg');
const { assertSafeTestDatabaseUrl, assertSafeIsolatedTestUrl } = require('./test-db-safety');
const { describeBaselineQaPlan, preflightBaselineQaPlan, createBaselineQaRun, finishBaselineQaRun } = require('../services/baselineAccessQa');
const { createBaselineBookingRun, finishBaselineBookingRun } = require('../services/baselineBookingQa');

const LIVE_URL = 'https://8223324090-production.up.railway.app';
const TARGET_HASH = '6fb86cf6959f026d7c55b6c65edffc3499e5bb581d51840a730f915fef0e9cfd';

function fail(condition, code) { if (!condition) { const error = new Error(code); error.code = code; throw error; } }

function resolveEnvironment(values, env) {
    if (values.local) {
        fail(env.TEST_DATABASE_RESET_CONFIRM === 'RESET_DISPOSABLE_TEST_DATABASE', 'BASELINE_QA_LOCAL_CONFIRMATION_REQUIRED');
        const target = assertSafeTestDatabaseUrl(env.TEST_DATABASE_URL, env);
        fail(target.isLocal, 'BASELINE_QA_LOCAL_TARGET_REQUIRED');
        const origin = assertSafeIsolatedTestUrl(env.TEST_URL).origin;
        return { connectionString: target.url.toString(), origin, ssl: false };
    }
    const connectionString = values.mode === 'plan'
        ? env.PRODUCTION_READONLY_DATABASE_URL || env.TRUSTED_QA_OPERATOR_DATABASE_URL
        : env.TRUSTED_QA_OPERATOR_DATABASE_URL;
    fail(Boolean(connectionString), 'BASELINE_QA_OPERATOR_CREDENTIAL_REQUIRED');
    const target = new URL(connectionString);
    fail(['postgres:','postgresql:'].includes(target.protocol)
        && [...target.searchParams.keys()].every(key => ['sslmode','channel_binding'].includes(key))
        && createHash('sha256').update(`${target.hostname}:${target.port}${target.pathname}`).digest('hex') === TARGET_HASH,
        'BASELINE_QA_PRODUCTION_TARGET_MISMATCH');
    return { connectionString, origin: LIVE_URL };
}

async function jsonRequest(origin, endpoint, { method = 'GET', token, body, qaToken, requestId } = {}) {
    const response = await fetch(origin + endpoint, { method, redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { accept: 'application/json', 'content-type': 'application/json', 'x-business-context': 'event_genix',
            ...(token ? { authorization: 'Bearer ' + token } : {}),
            ...(qaToken ? { 'x-qa-run-token': qaToken, 'x-qa-run-request-id': requestId } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body) });
    // Never return raw error bodies to the CLI's diagnostic output.
    if (!response.ok || !/^application\/json\b/i.test(response.headers.get('content-type') || '')) {
        await response.body?.cancel();
        const error = new Error(`BASELINE_QA_API_READ_FAILED (${method} ${new URL(origin + endpoint).pathname}, HTTP ${response.status})`);
        error.code = 'BASELINE_QA_API_READ_FAILED'; throw error;
    }
    const reader = response.body.getReader();
    const chunks = []; let size = 0;
    try {
        while (true) {
            const { value, done } = await reader.read(); if (done) break;
            size += value.length;
            if (size > 2 * 1024 * 1024) { await reader.cancel(); fail(false, 'BASELINE_QA_RESPONSE_TOO_LARGE'); }
            chunks.push(Buffer.from(value));
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally { reader.releaseLock(); }
}

async function exerciseIdentityApis(origin, actors, { saveProfession = true } = {}) {
    const results = [];
    for (const actor of actors) {
        const login = await jsonRequest(origin, '/api/auth/login', { method: 'POST',
            body: { username: actor.username, password: actor.password } });
        fail(Number(login.user?.id) === actor.id && typeof login.token === 'string', 'BASELINE_QA_LOGIN_IDENTITY_MISMATCH');
        Object.defineProperty(actor, 'session', { value: { token: login.token, user: login.user } });
        const readiness = await jsonRequest(origin, '/api/work-access/check', { method: 'POST', token: login.token, body: {} });
        fail(readiness.success && readiness.readiness?.ready === true
            && readiness.readiness.checks.data.results.length === 6
            && readiness.readiness.checks.data.results.every(read => read.passed && read.probe === 'authenticated_api'),
        'BASELINE_QA_WORK_READS_INCOMPLETE');
        if (actor.role === 'admin' && saveProfession) {
            const result = await jsonRequest(origin, `/api/hr/staff/${actor.staffId}/role-assignments`, { method: 'PUT', token: login.token,
                body: { primary_role: 'host', assignments: [
                    { profession_key: 'host', is_primary: true, status: 'active', admission_status: 'approved', internship_status: 'completed' },
                    { profession_key: 'reception', is_primary: false, status: 'active', admission_status: 'pending', internship_status: 'none' }
                ] } });
            fail(result.success === true && Boolean(result.profile_revision), 'BASELINE_QA_PROFESSION_SAVE_FAILED');
        }
        results.push({ role: actor.role, accountId: actor.id, staffId: actor.staffId, authenticatedReads: 6,
            professionSave: actor.role === 'admin' && saveProfession ? 'passed' : 'not_applicable' });
    }
    return results;
}

async function main(argv = process.argv.slice(2), env = process.env) {
    const { values } = parseArgs({ args: argv, options: { mode: { type: 'string', default: 'plan' },
        'plan-file': { type: 'string' }, 'approved-hash': { type: 'string' }, confirm: { type: 'string' }, local: { type: 'boolean' },
        'output-dir': { type: 'string' } } });
    fail(['plan','run','finish'].includes(values.mode) && path.isAbsolute(values['plan-file'] || ''), 'BASELINE_QA_ARGUMENT_INVALID');
    const { plan, planHash } = describeBaselineQaPlan(JSON.parse(fs.readFileSync(values['plan-file'], 'utf8').replace(/^\uFEFF/, '')));
    if (values.mode !== 'plan') fail(values.confirm === 'EXECUTE_EXACT_BASELINE_ACCESS_QA'
        && values['approved-hash'] === planHash, 'BASELINE_QA_APPROVAL_REQUIRED');
    const target = resolveEnvironment(values, env);
    if (!values.local && values.mode !== 'finish') {
        const live = await jsonRequest(target.origin, '/api/version');
        fail(live.commitSha === plan.releaseSha && live.sourceBranch === 'codex/eventgenix-production'
            && live.deploymentMetadata?.complete === true && plan.businessId === 1, 'BASELINE_QA_RELEASE_DRIFT');
    }
    const db = new Client({ connectionString: target.connectionString, connectionTimeoutMillis: 8000,
        statement_timeout: 15000, ...(values.local ? { ssl: false } : {}) });
    await db.connect();
    const transaction = async (fn, readOnly = false) => {
        await db.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
        try {
            await db.query("SET LOCAL lock_timeout='5s'");
            const result = await fn(); await db.query(readOnly ? 'ROLLBACK' : 'COMMIT'); return result;
        } catch (error) { await db.query('ROLLBACK').catch(() => {}); throw error; }
    };
    try {
        if (values.mode === 'plan') {
            const preview = await transaction(() => preflightBaselineQaPlan(db, plan), true);
            return { ready: !preview.bookingReadiness || preview.bookingReadiness.ready, readOnly: true,
                classificationRequired: preview.bookingReadiness?.classificationRequired || false,
                runId: plan.runId, planHash, accounts: 2, staff: 2, registeredEntities: plan.booking ? 9 : 8, roles: ['instructor','admin'] };
        }
        if (values.mode === 'finish') {
            if (plan.booking) await transaction(() => finishBaselineBookingRun(db, plan, planHash));
            return await transaction(() => finishBaselineQaRun(db, plan, planHash));
        }
        const browserScenario = plan.booking ? require('./baseline-access-qa-browser') : null;
        if (browserScenario) browserScenario.requireBrowserRuntime();
        let created;
        let bookingScope;
        let results;
        let browserResults;
        try {
            created = await transaction(() => createBaselineQaRun(db, plan, planHash));
            results = await exerciseIdentityApis(target.origin, created.actors, { saveProfession: !plan.booking });
            if (plan.booking) {
                bookingScope = await transaction(() => createBaselineBookingRun(db, plan, planHash, created));
                const admin = created.actors.find(actor => actor.role === 'admin');
                const { requestId, ...bookingBody } = plan.booking;
                const response = await jsonRequest(target.origin, '/api/bookings', { method: 'POST', token: admin.session.token,
                    qaToken: bookingScope.token, requestId, body: bookingBody });
                const bookingId = String(response.booking?.id || response.id || '');
                fail(Boolean(bookingId), 'BASELINE_QA_BOOKING_CREATE_FAILED');
                browserResults = await browserScenario.exerciseBaselineBrowser({ origin: target.origin, actors: created.actors,
                    plan, bookingId, outputDirectory: values['output-dir'],
                    api: (actor, endpoint, options = {}) => jsonRequest(target.origin, endpoint, { ...options, token: actor.session.token }) });
            }
        } finally {
            // The expiry watchdog is the recovery path if this process or its
            // database connection disappears before this exact cleanup commits.
            if (bookingScope) await transaction(() => finishBaselineBookingRun(db, plan, planHash));
            if (created) await transaction(() => finishBaselineQaRun(db, plan, planHash));
        }
        return { success: true, runId: plan.runId, results, ...(browserResults ? { browserResults } : {}), cleanup: 'cleaned' };
    } finally { await db.end(); }
}

if (require.main === module) main().then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(/^[A-Z0-9_]{1,90}$/.test(error.code || '') ? error.code : 'BASELINE_QA_TOOL_FAILED');
    process.exitCode = 1;
});

module.exports = { main, resolveEnvironment, exerciseIdentityApis };
