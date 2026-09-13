'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const { Client } = require('pg');

const ENTRY_FAMILIES = Object.freeze(['http', 'profile', 'service', 'websocket', 'provider', 'job', 'operator', 'public']);
const AUTHORITY_SOURCES = Object.freeze(['membership', 'compatibility', 'machine_principal', 'missing_context', 'unknown']);
const OUTCOMES = Object.freeze(['allowed', 'denied', 'unavailable']);
const DEFAULT_CONTEXTS = Object.freeze(['event_genix', 'dar', 'maysternya_doli', 'crm']);

function hash(value) {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function positiveHours(value) {
    const hours = Number(value || 24);
    if (!Number.isInteger(hours) || hours < 1 || hours > 168) throw new Error('INVALID_WINDOW_HOURS');
    return hours;
}

function cleanContext(value) {
    const context = String(value || '').trim().toLowerCase();
    return /^[a-z][a-z0-9_]{2,63}$/.test(context) ? context : 'unknown';
}

function buildCompatibilityTelemetryReport(rows = [], options = {}) {
    const expectedContexts = [...new Set((options.contexts || DEFAULT_CONTEXTS).map(cleanContext))].sort();
    const families = [...ENTRY_FAMILIES];
    const matrix = [];
    let legacyAllowed = 0;
    let missingContextAllowed = 0;
    let unknownAllowed = 0;
    for (const context of expectedContexts) {
        for (const family of families) {
            const matching = rows.filter(row => cleanContext(row.business_context ?? row.businessContext) === context
                && row.entry_family === family);
            const counts = Object.fromEntries(OUTCOMES.map(outcome => [outcome, 0]));
            const byAuthority = Object.fromEntries(AUTHORITY_SOURCES.map(source => [source, 0]));
            for (const row of matching) {
                const count = Number(row.decision_count ?? row.decisionCount ?? 0) || 0;
                if (OUTCOMES.includes(row.outcome)) counts[row.outcome] += count;
                if (AUTHORITY_SOURCES.includes(row.authority_source ?? row.authoritySource)) {
                    byAuthority[row.authority_source ?? row.authoritySource] += count;
                }
                if ((row.authority_source ?? row.authoritySource) === 'compatibility' && row.outcome === 'allowed') legacyAllowed += count;
                if ((row.authority_source ?? row.authoritySource) === 'missing_context' && row.outcome === 'allowed') missingContextAllowed += count;
                if ((row.authority_source ?? row.authoritySource) === 'unknown' && row.outcome === 'allowed') unknownAllowed += count;
            }
            matrix.push({ context, family, observed: matching.length > 0, counts, byAuthority });
        }
    }
    const unobserved = matrix.filter(item => !item.observed).map(item => `${item.context}:${item.family}`);
    const status = legacyAllowed === 0 && missingContextAllowed === 0 && unknownAllowed === 0 && unobserved.length === 0
        ? 'PASS_MEASURED'
        : 'HOLD';
    return {
        status,
        generatedAt: new Date().toISOString(),
        windowHours: positiveHours(options.windowHours || 24),
        contexts: expectedContexts,
        entryFamilies: families,
        legacyAllowed,
        missingContextAllowed,
        unknownAllowed,
        unobserved,
        matrix,
        notes: status === 'PASS_MEASURED'
            ? 'Every required family/context was observed and no allowed legacy/unknown/missing-context authority remained in the measured window.'
            : 'Compatibility exit is blocked until every required family/context has measured coverage and allowed legacy/unknown/missing-context counts are zero.'
    };
}

async function collect(client, options = {}) {
    const hours = positiveHours(options.windowHours || process.env.SYS_MB_TELEMETRY_WINDOW_HOURS || 24);
    const contexts = options.contexts || String(process.env.SYS_MB_TELEMETRY_CONTEXTS || DEFAULT_CONTEXTS.join(','))
        .split(',').map(item => item.trim()).filter(Boolean);
    await client.query('BEGIN READ ONLY');
    try {
        await client.query("SET LOCAL statement_timeout='10s'");
        await client.query("SET LOCAL lock_timeout='1s'");
        const result = await client.query(
            `SELECT business_context, entry_family, authority_source, outcome,
                    deployment_sha, SUM(decision_count)::bigint AS decision_count
               FROM business_compatibility_telemetry_hourly
              WHERE observed_hour >= date_trunc('hour', clock_timestamp()) - ($1::int * interval '1 hour')
                AND business_context = ANY($2::text[])
              GROUP BY business_context, entry_family, authority_source, outcome, deployment_sha
              ORDER BY business_context, entry_family, authority_source, outcome, deployment_sha`,
            [hours, contexts.map(cleanContext)]
        );
        return buildCompatibilityTelemetryReport(result.rows, { contexts, windowHours: hours });
    } finally {
        await client.query('ROLLBACK').catch(() => {});
    }
}

async function main() {
    const connectionString = process.env.MULTIBUSINESS_AUDIT_DATABASE_URL || process.env.TASK_AI_ROLLOUT_DATABASE_URL;
    if (!connectionString) throw new Error('READONLY_DATABASE_URL_REQUIRED');
    const url = new URL(connectionString);
    const endpointHash = hash(`${url.hostname}:${url.port}${url.pathname}`);
    const client = new Client({ connectionString, connectionTimeoutMillis: 8000, query_timeout: 15000,
        statement_timeout: 10000, application_name: 'sys-mb-compatibility-telemetry-report' });
    try {
        await client.connect();
        const report = await collect(client);
        const output = { ...report, endpointHash, productionWrites: 0, operationalRowsRead: 0 };
        const outFile = process.env.SYS_MB_TELEMETRY_REPORT_FILE;
        if (outFile) fs.writeFileSync(outFile, JSON.stringify(output, null, 2) + '\n');
        console.log(JSON.stringify(output, null, 2));
    } finally {
        await client.end().catch(() => {});
    }
}

module.exports = { ENTRY_FAMILIES, buildCompatibilityTelemetryReport, collect };
if (require.main === module) main().catch(error => {
    const postgresCode = /^[0-9A-Z]{5}$/.test(error?.code || '') ? error.code : '';
    const code = /^[A-Z0-9_]{3,80}$/.test(error.message) ? error.message
        : (postgresCode ? `SYS_MB_TELEMETRY_REPORT_FAILED_${postgresCode}` : 'SYS_MB_TELEMETRY_REPORT_FAILED');
    console.error(code);
    process.exitCode = 1;
});
