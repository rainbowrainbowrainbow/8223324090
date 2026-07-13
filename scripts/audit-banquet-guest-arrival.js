#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function loadEnvFile() {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const separator = trimmed.indexOf('=');
        if (separator <= 0) continue;
        const key = trimmed.slice(0, separator).trim();
        if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
        let value = trimmed.slice(separator + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        process.env[key] = value;
    }
}

function argValue(args, name, fallback = null) {
    const exact = args.find(arg => arg.startsWith(`${name}=`));
    if (exact) return exact.slice(name.length + 1);
    const index = args.indexOf(name);
    if (index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')) return args[index + 1];
    return fallback;
}

function printSummary(report, businessContext = null) {
    const summary = report.summary || {};
    console.log('Banquet guest arrival audit (read-only)');
    if (businessContext) console.log(`Business context: ${businessContext}`);
    console.log(`Active groups with NULL: ${summary.activeGroupsWithNull || 0}`);
    console.log(`Explicit primary candidates: ${summary.explicitPrimaryCandidates || 0}`);
    console.log(`Group primary candidates: ${summary.groupPrimaryCandidates || 0}`);
    console.log(`Legacy link-only groups: ${summary.legacyLinkOnlyGroups || 0}`);
    console.log(`Single banquet anchors: ${summary.singleBanquetAnchors || 0}`);
    console.log(`Inactive or unsupported legacy flows: ${summary.inactiveOrUnsupportedLegacyFlows || 0}`);
    console.log(`Ambiguous or missing primary: ${summary.ambiguousOrMissingPrimary || 0}`);
    console.log(`Unresolved supported legacy flows: ${summary.unresolvedSupportedLegacyFlows || 0}`);
    console.log(`Ready for required constraint: ${summary.readyForRequiredConstraint ? 'yes' : 'no'}`);
}

async function main(argv = process.argv.slice(2)) {
    loadEnvFile();
    const { pool } = require('../db');
    const { auditBanquetGuestArrival } = require('../services/banquetGroups');
    const businessContext = argValue(argv, '--business-context', argValue(argv, '--context'));
    const client = await pool.connect();
    try {
        await client.query('BEGIN TRANSACTION READ ONLY');
        const report = await auditBanquetGuestArrival({ db: client, businessContext });
        await client.query('ROLLBACK');
        if (argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
        else printSummary(report, businessContext);
        if (argv.includes('--strict') && !report.summary?.readyForRequiredConstraint) process.exitCode = 1;
        return report;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
        await pool.end().catch(() => {});
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error(`Banquet guest arrival audit failed: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    argValue,
    main,
    printSummary
};
