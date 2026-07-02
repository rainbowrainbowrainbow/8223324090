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
const { auditCustomerDuplicateRisks } = require('../services/customerDataAudits');

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
    console.log('Customer duplicate risk audit');
    if (report.options.businessContext) console.log(`Business context: ${report.options.businessContext}`);
    console.log(`Manual-review risks: ${report.manualReviewCount}`);
    Object.keys(report.byType).sort().forEach(type => {
        console.log(`${type}: ${report.byType[type]}`);
    });

    if (!report.risks.length) {
        console.log('No duplicate risks found.');
        return;
    }

    console.log('');
    for (const risk of report.risks) {
        console.log(`[${risk.riskType}] action=${risk.action} context=${risk.businessContext} lead=${risk.leadId || '-'} key=${risk.matchKey || '-'} count=${risk.riskCount}`);
        if (Array.isArray(risk.details)) {
            const preview = risk.details.slice(0, 5).map(item => `#${item.id} ${item.name || '(no name)'}`).join('; ');
            if (preview) console.log(`  customers: ${preview}`);
        } else if (risk.details && typeof risk.details === 'object') {
            const linked = Array.isArray(risk.details.linkedCustomers)
                ? risk.details.linkedCustomers.map(item => `#${item.linkedCustomerId} ${item.linkedCustomerName || '(no name)'}`).join('; ')
                : '';
            const candidates = Array.isArray(risk.details.phoneCandidates)
                ? risk.details.phoneCandidates.map(item => `#${item.id} ${item.name || '(no name)'}`).join('; ')
                : '';
            if (risk.details.leadName) console.log(`  lead: ${risk.details.leadName} ${risk.details.leadPhone || ''}`.trim());
            if (linked) console.log(`  linked: ${linked}`);
            if (candidates) console.log(`  candidates: ${candidates}`);
        }
    }
}

async function main() {
    const report = await auditCustomerDuplicateRisks(pool, {
        businessContext: argValue('--business-context') || argValue('--context')
    });

    const format = String(argValue('--format', boolFlag('--json') ? 'json' : 'text')).toLowerCase();
    if (format === 'json') {
        console.log(JSON.stringify(report, null, 2));
    } else {
        printTextReport(report);
    }

    if (boolFlag('--strict') && report.manualReviewCount > 0) {
        process.exitCode = 1;
    }
}

main().catch(error => {
    console.error(`Customer duplicate risk audit failed: ${error.message}`);
    process.exitCode = 1;
}).finally(async () => {
    await pool.end().catch(() => {});
});
