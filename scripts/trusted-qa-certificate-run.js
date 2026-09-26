#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../db');
const { DEFAULT_BUSINESS_CONTEXT } = require('../services/businessContext');
const { isQaLeaseCandidate } = require('../services/qaCreatorLease');
const { createTrustedQaRun, cleanupTrustedQaRun } = require('../services/trustedQaRuns');

function argument(name) {
    const index = process.argv.indexOf(name);
    return index < 0 ? '' : String(process.argv[index + 1] || '').trim();
}

function planFromFile() {
    const file = argument('--plan-file');
    if (!file) throw new Error('--plan-file is required');
    const raw = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
    const plan = {
        runId: String(raw.runId || '').trim(),
        testAccountId: Number(raw.testAccountId),
        businessContext: String(raw.businessContext || '').trim(),
        ttlMinutes: Number(raw.ttlMinutes)
    };
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(plan.runId)
        || !Number.isSafeInteger(plan.testAccountId) || plan.testAccountId < 1
        || plan.businessContext !== DEFAULT_BUSINESS_CONTEXT
        || !Number.isInteger(plan.ttlMinutes) || plan.ttlMinutes < 1 || plan.ttlMinutes > 30) {
        throw new Error('Certificate QA plan must name one run, exact account, Park context and 1–30 minute TTL');
    }
    return plan;
}

function planHash(plan) {
    return crypto.createHash('sha256').update(JSON.stringify(plan)).digest('hex');
}

async function accountPreflight(client, plan, { lock = false } = {}) {
    const result = await client.query(
        `SELECT u.id, u.username, u.name, u.role, u.is_active,
                EXISTS (SELECT 1 FROM employee_profiles ep WHERE ep.user_id = u.id AND COALESCE(ep.is_active, true)) AS has_staff_profile
           FROM users u WHERE u.id = $1 ${lock ? 'FOR SHARE' : ''}`,
        [plan.testAccountId]
    );
    const account = result.rows?.[0];
    if (!account || account.is_active !== true || account.has_staff_profile
        || !isQaLeaseCandidate(account)
        || !['admin', 'user', 'animator'].includes(account.role)) {
        throw new Error('Exact active isolated QA certificate issuer is unavailable');
    }
    const otherRuns = await client.query(
        `SELECT COUNT(*)::int AS count FROM trusted_qa_runs
          WHERE state IN ('active', 'cleanup_pending') AND allowed_endpoints @> $1::jsonb`,
        [JSON.stringify(['POST /api/certificates'])]
    );
    if (Number(otherRuns.rows?.[0]?.count || 0) > 0) throw new Error('Another certificate QA run is open');
    const existingRecipient = await client.query(
        `SELECT 1 FROM certificates WHERE LOWER(BTRIM(display_value)) = LOWER($1) LIMIT 1`,
        [`${plan.runId}:certificate:disposable`]
    );
    if (existingRecipient.rowCount) throw new Error('Certificate QA recipient marker already exists');
    return { accountId: account.id, isolated: true, openCertificateRuns: 0 };
}

async function main() {
    const mode = argument('--mode') || 'plan';
    if (mode === 'finish') {
        const runId = argument('--run-id');
        if (!/^[a-zA-Z0-9_-]{8,80}$/.test(runId)) throw new Error('--run-id is required');
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const run = await client.query(
                `SELECT id FROM trusted_qa_runs WHERE run_id = $1 AND allowed_endpoints @> $2::jsonb FOR UPDATE`,
                [runId, JSON.stringify(['POST /api/certificates'])]
            );
            if (run.rowCount !== 1) throw new Error('Exact certificate QA run is missing');
            const result = await cleanupTrustedQaRun(client, run.rows[0].id, { forUpdate: true });
            await client.query('COMMIT');
            console.log(JSON.stringify({ runId, status: result.status, state: result.state, entityCount: result.entityCount }));
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }
        return;
    }
    const plan = planFromFile();
    const hash = planHash(plan);
    const client = await pool.connect();
    let tokenFile = '';
    let tokenWritten = false;
    try {
        await client.query(mode === 'plan' ? 'BEGIN READ ONLY' : 'BEGIN ISOLATION LEVEL SERIALIZABLE');
        const readiness = await accountPreflight(client, plan, { lock: mode === 'create' });
        if (mode === 'plan') {
            await client.query('ROLLBACK');
            console.log(JSON.stringify({ plan, planHash: hash, readiness }, null, 2));
            return;
        }
        if (mode !== 'create' || argument('--confirm') !== 'CREATE_EXACT_CERTIFICATE_QA_RUN'
            || argument('--approved-hash') !== hash) {
            throw new Error('Create requires exact confirmation and approved plan hash');
        }
        tokenFile = path.resolve(argument('--token-file'));
        if (!path.isAbsolute(argument('--token-file')) || tokenFile.toLowerCase().startsWith(`${path.resolve(__dirname, '..').toLowerCase()}${path.sep}`)) {
            throw new Error('Token file must be an absolute path outside the repository');
        }
        const token = crypto.randomBytes(32).toString('base64url');
        fs.writeFileSync(tokenFile, token, { flag: 'wx', mode: 0o600 });
        tokenWritten = true;
        const created = await createTrustedQaRun(client, {
            token,
            runId: plan.runId,
            source: 'trusted_qa',
            businessContext: plan.businessContext,
            operatorUserId: plan.testAccountId,
            requiredOperatorUserId: plan.testAccountId,
            requiredUserId: plan.testAccountId,
            testCustomerMarker: `${plan.runId}:certificate:disposable`,
            allowedEndpoints: ['POST /api/certificates'],
            maxEntityCount: 1,
            ttlMinutes: plan.ttlMinutes
        });
        await client.query('COMMIT');
        console.log(JSON.stringify({ runId: created.run.run_id, expiresAt: created.run.expires_at, tokenFile, planHash: hash }));
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (tokenWritten) try { fs.unlinkSync(tokenFile); } catch {}
        throw error;
    } finally {
        client.release();
    }
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
}).finally(() => pool.end());
