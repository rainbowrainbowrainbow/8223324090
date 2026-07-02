#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function loadEnvFile() {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!match) continue;
        const key = match[1];
        if (Object.prototype.hasOwnProperty.call(process.env, key)) continue;
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        process.env[key] = value;
    }
}

loadEnvFile();

const { pool } = require('../db');
const {
    CHILDREN_REPAIR_ACTIONS,
    repairLeadCustomerChildren
} = require('../services/leadCustomerRepair');

const args = process.argv.slice(2);
const flags = new Set(args.filter(arg => arg.startsWith('--') && !arg.includes('=')));

function argValue(name, fallback = null) {
    const exact = args.find(arg => arg.startsWith(`${name}=`));
    if (exact) return exact.slice(name.length + 1);
    const index = args.indexOf(name);
    if (index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')) return args[index + 1];
    return fallback;
}

function boolFlag(name) {
    return flags.has(name);
}

function printTextReport(report) {
    console.log('Lead customer children repair');
    console.log(`Mode: ${report.mode}`);
    console.log(`Scanned lead/customer pairs: ${report.scanned}`);
    console.log(`Planned safe syncs: ${report.plannedCount}`);
    console.log(`Repaired: ${report.repairedCount}`);
    console.log(`Skipped/manual-review: ${report.skippedCount}`);
    console.log(`Manual-review: ${report.manualReviewCount}`);

    if (report.actions.length) {
        console.log('');
        for (const action of report.actions) {
            const label = action.action === CHILDREN_REPAIR_ACTIONS.MANUAL_REVIEW ? 'skip' : action.action;
            const customer = action.customerId ? ` customer=${action.customerId}` : '';
            console.log(`[${label}] lead=${action.leadId}${customer} context=${action.businessContext} reason=${action.reason}`);
        }
    }

    if (report.repaired.length) {
        console.log('');
        for (const item of report.repaired) {
            console.log(`repaired lead=${item.leadId} customer=${item.customerId} syncedChildren=${item.result?.syncedChildren || 0}`);
        }
    }

    if (report.skipped.length) {
        console.log('');
        for (const item of report.skipped) {
            console.log(`skipped lead=${item.leadId} customer=${item.customerId || '-'} reason=${item.reason || item.detail || 'manual_review'}`);
        }
    }
}

async function main() {
    const apply = boolFlag('--apply');
    const report = await repairLeadCustomerChildren(pool, {
        apply,
        dryRun: !apply,
        businessContext: argValue('--business-context') || argValue('--context'),
        leadId: argValue('--lead-id') || argValue('--leadId'),
        limit: argValue('--limit')
    });

    const format = String(argValue('--format', boolFlag('--json') ? 'json' : 'text')).toLowerCase();
    if (format === 'json') {
        console.log(JSON.stringify(report, null, 2));
    } else {
        printTextReport(report);
    }
}

main().catch(error => {
    console.error(`Lead customer children repair failed: ${error.message}`);
    process.exitCode = 1;
}).finally(async () => {
    await pool.end().catch(() => {});
});
