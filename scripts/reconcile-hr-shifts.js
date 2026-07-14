#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const APPLY_CONFIRMATION = 'I_CONFIRM_HR_SHIFT_RECONCILIATION';

function loadLocalEnv() {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) continue;
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        process.env[match[1]] = value;
    }
}

function argumentValue(args, name) {
    const inline = args.find(argument => argument.startsWith(`${name}=`));
    if (inline) return inline.slice(name.length + 1);
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : null;
}

async function main() {
    loadLocalEnv();
    const args = process.argv.slice(2);
    const from = argumentValue(args, '--from');
    const to = argumentValue(args, '--to');
    const apply = args.includes('--apply');
    const confirmation = argumentValue(args, '--confirm');
    if (!from || !to) {
        throw new Error('Usage: node scripts/reconcile-hr-shifts.js --from YYYY-MM-DD --to YYYY-MM-DD [--apply --confirm I_CONFIRM_HR_SHIFT_RECONCILIATION]');
    }
    if (apply && confirmation !== APPLY_CONFIRMATION) {
        throw new Error(`Apply mode requires --confirm ${APPLY_CONFIRMATION}`);
    }

    const { pool } = require('../db');
    const { reconcileHrShiftsFromStaffSchedule } = require('../services/hrShiftReconciliation');
    try {
        const result = await reconcileHrShiftsFromStaffSchedule(pool, {
            from,
            to,
            dryRun: !apply,
            actor: process.env.USERNAME || process.env.USER || 'hr_shift_reconciliation_operator'
        });
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } finally {
        await pool.end();
    }
}

main().catch(error => {
    const payload = {
        success: false,
        code: error.code || 'HR_SHIFT_RECONCILIATION_FAILED',
        error: error.message,
        summary: error.summary || undefined
    };
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exitCode = 1;
});
