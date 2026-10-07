#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { preflightFinanceQaPlan, createFinanceQaRun, finishFinanceQaRun } = require('../services/financeMoneyQa');

function argument(name) {
    const index = process.argv.indexOf(name);
    return index < 0 ? '' : String(process.argv[index + 1] || '').trim();
}

async function main() {
    const { pool } = require('../db');
    const mode = argument('--mode') || 'plan';
    const client = await pool.connect();
    let privateTokenPath = '';
    let tokenWritten = false;
    try {
        if (mode === 'finish') {
            const runId = argument('--run-id');
            if (!/^[a-zA-Z0-9_-]{8,64}$/.test(runId)) throw new Error('An exact --run-id is required.');
            await client.query('BEGIN');
            const result = await finishFinanceQaRun(client, runId);
            await client.query('COMMIT');
            console.log(JSON.stringify(result));
            return;
        }
        const planPath = argument('--plan-file');
        if (!path.isAbsolute(planPath)) throw new Error('--plan-file must be an absolute path.');
        const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
        if (mode === 'plan') {
            await client.query('BEGIN READ ONLY');
            const result = await preflightFinanceQaPlan(client, plan);
            await client.query('ROLLBACK');
            console.log(JSON.stringify(result, null, 2));
            return;
        }
        if (mode !== 'create' || argument('--confirm') !== 'CREATE_EXACT_FINANCE_QA_RUN') {
            throw new Error('Create requires --confirm CREATE_EXACT_FINANCE_QA_RUN and an approved plan hash.');
        }
        privateTokenPath = argument('--token-file');
        const repository = path.resolve(__dirname, '..');
        if (!path.isAbsolute(privateTokenPath) || path.resolve(privateTokenPath).toLowerCase().startsWith(`${repository.toLowerCase()}${path.sep}`)) {
            throw new Error('The private token file must be outside the repository.');
        }
        const token = crypto.randomBytes(32).toString('base64url');
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        const created = await createFinanceQaRun(client, plan, { approvedHash: argument('--approved-hash'), token });
        fs.writeFileSync(privateTokenPath, token, { flag: 'wx', mode: 0o600 });
        tokenWritten = true;
        await client.query('COMMIT');
        console.log(JSON.stringify({ runId: created.run.run_id, expiresAt: created.run.expires_at,
            tokenFile: privateTokenPath, planHash: created.planHash }));
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        // Preserve a token after an unknown commit outcome; an operator can reconcile the exact run.
        if (tokenWritten) console.error(`The exact private token file is retained for run reconciliation: ${privateTokenPath}`);
        throw error;
    } finally { client.release(); await pool.end(); }
}

if (require.main === module) main().catch(error => {
    console.error(`${error.code || 'FINANCE_QA_OPERATOR_ERROR'}: ${error.message}`);
    process.exitCode = 1;
});

module.exports = { main };
