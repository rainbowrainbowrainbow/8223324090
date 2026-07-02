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
const { auditBusinessContextIsolation } = require('../services/customerDataAudits');

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
    console.log('Business context isolation audit');
    if (report.options.businessContext) console.log(`Business context: ${report.options.businessContext}`);
    if (report.options.leadId) console.log(`Lead ID: ${report.options.leadId}`);
    if (report.options.limit) console.log(`Limit: ${report.options.limit}`);
    console.log(`Context mismatches: ${report.contextMismatchCount}`);

    if (!report.results.length) {
        console.log('No cross-business customer candidates found.');
        return;
    }

    console.log('');
    for (const item of report.results) {
        console.log([
            'reason=context_mismatch',
            `lead=${item.leadId}`,
            `lead_context=${item.leadContext}`,
            `customer=${item.customerId}`,
            `customer_context=${item.customerContext}`,
            `matches=${item.matchSources.join(',') || '-'}`
        ].join(' '));
    }
}

async function main() {
    const report = await auditBusinessContextIsolation(pool, {
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

    if (boolFlag('--strict') && report.contextMismatchCount > 0) {
        process.exitCode = 1;
    }
}

main().catch(error => {
    console.error(`Business context isolation audit failed: ${error.message}`);
    process.exitCode = 1;
}).finally(async () => {
    await pool.end().catch(() => {});
});
