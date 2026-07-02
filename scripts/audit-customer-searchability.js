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
const { auditCustomerSearchability } = require('../services/customerDataAudits');

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
    console.log('Customer searchability audit');
    if (report.options.businessContext) console.log(`Business context: ${report.options.businessContext}`);
    if (report.options.leadId) console.log(`Lead ID: ${report.options.leadId}`);
    console.log(`Include candidates: ${report.options.includeCandidates ? 'yes' : 'no'}`);
    console.log(`Scanned customers: ${report.scanned}`);
    console.log(`ok: ${report.ok}`);
    console.log(`not_searchable: ${report.notSearchable}`);

    const failures = report.results.filter(item => item.classification !== 'ok');
    if (!failures.length) {
        console.log('No searchability issues found.');
        return;
    }

    console.log('');
    for (const item of failures) {
        console.log(`[not_searchable] customer=${item.customerId} lead=${item.leadId || '-'} context=${item.businessContext} name="${item.name || ''}" sources=${item.sourceKinds.join(',')}`);
        for (const check of item.failedChecks) {
            console.log(`  ${check.type}: q="${check.query}" resultIds=${check.resultIds.join(',') || '-'}`);
        }
    }
}

async function main() {
    const report = await auditCustomerSearchability(pool, {
        businessContext: argValue('--business-context') || argValue('--context'),
        leadId: argValue('--lead-id') || argValue('--leadId'),
        limit: argValue('--limit'),
        includeCandidates: boolFlag('--include-candidates'),
        includeSocialIdentities: !boolFlag('--no-social-identities')
    });

    const format = String(argValue('--format', boolFlag('--json') ? 'json' : 'text')).toLowerCase();
    if (format === 'json') {
        console.log(JSON.stringify(report, null, 2));
    } else {
        printTextReport(report);
    }

    if (boolFlag('--strict') && report.notSearchable > 0) {
        process.exitCode = 1;
    }
}

main().catch(error => {
    console.error(`Customer searchability audit failed: ${error.message}`);
    process.exitCode = 1;
}).finally(async () => {
    await pool.end().catch(() => {});
});
