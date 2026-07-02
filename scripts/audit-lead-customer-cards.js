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
    AUDIT_CLASSIFICATIONS,
    auditLeadCustomerCards
} = require('../services/leadCustomerAudit');

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

function issueLine(item) {
    const name = item.clientName ? `"${item.clientName}"` : '(no name)';
    const phone = item.normalizedPhone || '-';
    const instagram = item.normalizedInstagram || '-';
    return [
        `[${item.classification}]`,
        `lead=${item.leadId}`,
        `context=${item.businessContext}`,
        `stage=${item.pipelineStage || '-'}`,
        `name=${name}`,
        `phone=${phone}`,
        `instagram=${instagram}`,
        `customers.lead_id=${item.checks.directCustomerCount}`,
        `lead_customer_links=${item.checks.linkedCustomerCount}`,
        `candidates=${item.checks.sameContextCandidateCount}`,
        `wrong_context=${item.checks.wrongContextCandidateCount}`,
        `broken_links=${item.checks.brokenLinkCount}`
    ].join(' ');
}

function printTextReport(report) {
    console.log('Lead customer card audit');
    if (report.options.businessContext) console.log(`Business context: ${report.options.businessContext}`);
    if (report.options.leadId) console.log(`Lead ID: ${report.options.leadId}`);
    if (report.options.limit) console.log(`Limit: ${report.options.limit}`);
    console.log(`Scanned leads: ${report.scanned}`);
    for (const key of AUDIT_CLASSIFICATIONS) {
        console.log(`${key}: ${report.classifications[key] || 0}`);
    }
    console.log(`Issues: ${report.issueCount}`);

    const issues = report.results.filter(item => item.classification !== 'ok');
    if (!issues.length) {
        console.log('No issues found.');
        return;
    }

    console.log('');
    for (const item of issues) {
        console.log(issueLine(item));
        console.log(`  action: ${item.recommendedAction}`);
        if (item.candidateCustomers.length) {
            const preview = item.candidateCustomers
                .slice(0, 3)
                .map(candidate => `#${candidate.id} ${candidate.name || '(no name)'}`)
                .join('; ');
            console.log(`  candidates: ${preview}`);
        }
        if (item.wrongContextCandidates.length) {
            const preview = item.wrongContextCandidates
                .slice(0, 3)
                .map(candidate => `#${candidate.id} ${candidate.businessContext || '-'} ${candidate.name || '(no name)'}`)
                .join('; ');
            console.log(`  wrong context: ${preview}`);
        }
        if (item.brokenLinks.length) {
            const preview = item.brokenLinks
                .slice(0, 3)
                .map(link => `link #${link.linkId} customer #${link.customerId}`)
                .join('; ');
            console.log(`  broken links: ${preview}`);
        }
    }
}

async function main() {
    const format = String(argValue('--format', boolFlag('--json') ? 'json' : 'text')).toLowerCase();
    const report = await auditLeadCustomerCards(pool, {
        businessContext: argValue('--business-context') || argValue('--context'),
        leadId: argValue('--lead-id') || argValue('--leadId'),
        limit: argValue('--limit')
    });

    if (format === 'json') {
        console.log(JSON.stringify(report, null, 2));
    } else {
        printTextReport(report);
    }

    if (boolFlag('--strict') && report.issueCount > 0) {
        process.exitCode = 1;
    }
}

main().catch(error => {
    console.error(`Lead customer card audit failed: ${error.message}`);
    process.exitCode = 1;
}).finally(async () => {
    await pool.end().catch(() => {});
});
