'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const { Client } = require('pg');
const { REQUIRED_ENTRY_FAMILIES } = require('../config/businessCompatibilityTelemetry');

const ENTRY_FAMILIES = Object.freeze([...new Set(Object.values(REQUIRED_ENTRY_FAMILIES).flat())]);
const AUTHORITY_SOURCES = Object.freeze(['membership', 'compatibility', 'machine_principal', 'missing_context', 'unknown']);
const OUTCOMES = Object.freeze(['allowed', 'denied', 'unavailable']);
const DEFAULT_CONTEXTS = Object.freeze(Object.keys(REQUIRED_ENTRY_FAMILIES));
const THRESHOLDS = Object.freeze({ completeUtcDays: 14, allowedOperations: 30, activeDays: 5 });

function hash(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }
function cleanContext(value) {
    const context = String(value || '').trim().toLowerCase();
    return /^[a-z][a-z0-9_]{2,63}$/.test(context) ? context : 'unknown';
}
function positiveInteger(value, maximum = 24 * 90) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1 || number > maximum) throw new Error('INVALID_TELEMETRY_GATE_VALUE');
    return number;
}
function utcDay(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}
function completeUtcDaysBetween(start, end) {
    const dayMs = 24 * 60 * 60 * 1000;
    const firstFullDay = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
        + (start.getUTCHours() || start.getUTCMinutes() || start.getUTCSeconds() || start.getUTCMilliseconds() ? dayMs : 0);
    const endBoundary = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
    return Math.max(0, Math.floor((endBoundary - firstFullDay) / dayMs));
}

function buildCompatibilityTelemetryReport(rows = [], options = {}) {
    const contexts = [...new Set((options.contexts || DEFAULT_CONTEXTS).map(cleanContext))].sort();
    const now = new Date(options.now || Date.now());
    const longestEnabledCycleHours = options.longestEnabledCycleHours == null
        ? null : positiveInteger(options.longestEnabledCycleHours);
    const requiredWindowHours = longestEnabledCycleHours == null
        ? THRESHOLDS.completeUtcDays * 24
        : Math.max(THRESHOLDS.completeUtcDays * 24, longestEnabledCycleHours + 24);
    const observationStartedAt = options.observationStartedAt ? new Date(options.observationStartedAt) : null;
    const validStart = observationStartedAt && Number.isFinite(observationStartedAt.getTime());
    const elapsedHours = validStart ? Math.max(0, (now - observationStartedAt) / 3600000) : 0;
    const completeUtcDays = validStart ? completeUtcDaysBetween(observationStartedAt, now) : 0;
    const matrix = [];
    const contextTraffic = [];
    let legacyAllowed = 0, missingContextAllowed = 0, unknownAllowed = 0, telemetryGaps = 0;

    for (const context of contexts) {
        const contextRows = rows.filter(row => cleanContext(row.business_context ?? row.businessContext) === context);
        const allowedRows = contextRows.filter(row => row.entry_family === 'http'
            && row.decision_stage === 'admission' && row.authority_source === 'membership' && row.outcome === 'allowed');
        const allowedOperations = allowedRows.reduce((sum, row) => sum + Number(row.collected_count ?? row.decision_count ?? 0), 0);
        const activeDays = new Set(allowedRows.map(row => utcDay(row.observed_hour ?? row.observedHour)).filter(Boolean)).size;
        const domainAllowed = contextRows.some(row => row.entry_family === 'service'
            && row.decision_stage === 'domain' && row.authority_source === 'membership'
            && row.outcome === 'allowed' && Number(row.collected_count ?? row.decision_count ?? 0) > 0);
        contextTraffic.push({ context, allowedOperations, activeDays,
            domainAllowed, sufficient: allowedOperations >= THRESHOLDS.allowedOperations
                && activeDays >= THRESHOLDS.activeDays && domainAllowed });
        for (const family of REQUIRED_ENTRY_FAMILIES[context] || []) {
            const matching = contextRows.filter(row => row.entry_family === family);
            const counts = Object.fromEntries(OUTCOMES.map(outcome => [outcome, 0]));
            const byAuthority = Object.fromEntries(AUTHORITY_SOURCES.map(source => [source, 0]));
            let eligible = 0, collected = 0, gaps = 0;
            for (const row of matching) {
                const count = Number(row.collected_count ?? row.decision_count ?? 0) || 0;
                eligible += Number(row.eligible_count ?? count) || 0;
                collected += count;
                gaps += Number(row.gap_count || 0) || 0;
                if (OUTCOMES.includes(row.outcome)) counts[row.outcome] += count;
                const source = row.authority_source ?? row.authoritySource;
                if (AUTHORITY_SOURCES.includes(source)) byAuthority[source] += count;
                if (source === 'compatibility' && row.outcome === 'allowed') legacyAllowed += count;
                if (source === 'missing_context' && row.outcome === 'allowed') missingContextAllowed += count;
                if (source === 'unknown' && row.outcome === 'allowed') unknownAllowed += count;
            }
            telemetryGaps += gaps + Math.max(0, eligible - collected - gaps);
            matrix.push({ context, family, observed: matching.length > 0 && collected > 0,
                reconciled: eligible === collected + gaps, eligible, collected, gaps, counts, byAuthority });
        }
    }
    const runtime = (options.runtimeRows || []).map(row => ({
        eligible: Number(row.eligible_count ?? row.eligibleCount ?? 0),
        persisted: Number(row.persisted_count ?? row.persistedCount ?? 0),
        failed: Number(row.failed_count ?? row.failedCount ?? 0)
    }));
    const runtimeReconciled = runtime.length > 0 && runtime.every(row => row.eligible === row.persisted + row.failed);
    const runtimeFailures = runtime.reduce((sum, row) => sum + row.failed, 0);
    const unobserved = matrix.filter(item => !item.observed).map(item => `${item.context}:${item.family}`);
    const unreconciled = matrix.filter(item => !item.reconciled).map(item => `${item.context}:${item.family}`);
    const insufficientTraffic = contextTraffic.filter(item => !item.sufficient).map(item => item.context);
    const blockers = [];
    if (!validStart) blockers.push('observation_start_missing');
    if (longestEnabledCycleHours == null) blockers.push('longest_enabled_cycle_unknown');
    if (!validStart || completeUtcDays < THRESHOLDS.completeUtcDays
        || (longestEnabledCycleHours != null && elapsedHours < longestEnabledCycleHours + 24)) {
        blockers.push('observation_window_incomplete');
    }
    if (unobserved.length) blockers.push('entry_family_coverage_incomplete');
    if (insufficientTraffic.length) blockers.push('real_traffic_insufficient');
    if (legacyAllowed || missingContextAllowed || unknownAllowed) blockers.push('legacy_or_implicit_authority_observed');
    if (telemetryGaps || unreconciled.length || !runtimeReconciled || runtimeFailures) blockers.push('telemetry_reconciliation_failed');
    return {
        status: blockers.length ? 'HOLD' : 'PASS_MEASURED', generatedAt: now.toISOString(), schemaVersion: 2,
        observationStartedAt: validStart ? observationStartedAt.toISOString() : null, elapsedHours, completeUtcDays,
        longestEnabledCycleHours, requiredWindowHours, thresholds: THRESHOLDS, contexts,
        requiredEntryFamilies: Object.fromEntries(contexts.map(context => [context, REQUIRED_ENTRY_FAMILIES[context] || []])),
        legacyAllowed, missingContextAllowed, unknownAllowed, telemetryGaps, runtimeReconciled, runtimeFailures,
        unobserved, unreconciled, insufficientTraffic, blockers, contextTraffic, matrix,
        notes: blockers.length
            ? 'Legacy operational authorization must remain enabled until every blocker is cleared by measured production evidence.'
            : 'The measured exit gate passed every duration, traffic, coverage, authority and reconciliation condition.'
    };
}

async function collect(client, options = {}) {
    const contexts = options.contexts || String(process.env.SYS_MB_TELEMETRY_CONTEXTS || DEFAULT_CONTEXTS.join(','))
        .split(',').map(item => item.trim()).filter(Boolean);
    const longestEnabledCycleHours = options.longestEnabledCycleHours
        ?? (process.env.SYS_MB_LONGEST_ENABLED_CYCLE_HOURS ? Number(process.env.SYS_MB_LONGEST_ENABLED_CYCLE_HOURS) : null);
    const observationStartedAt = options.observationStartedAt || process.env.SYS_MB_OBSERVATION_STARTED_AT || null;
    const requiredWindowHours = longestEnabledCycleHours == null ? THRESHOLDS.completeUtcDays * 24
        : Math.max(THRESHOLDS.completeUtcDays * 24, Number(longestEnabledCycleHours) + 24);
    const parsedStart = observationStartedAt ? new Date(observationStartedAt) : null;
    const queryStartedAt = parsedStart && Number.isFinite(parsedStart.getTime())
        ? parsedStart.toISOString()
        : new Date(Date.now() - requiredWindowHours * 3600000).toISOString();
    await client.query('BEGIN READ ONLY');
    try {
        await client.query("SET LOCAL statement_timeout='10s'");
        await client.query("SET LOCAL lock_timeout='1s'");
        const decisions = await client.query(
            `SELECT observed_hour,business_context,entry_family,decision_stage,authority_source,outcome,deployment_sha,
                    SUM(eligible_count)::bigint AS eligible_count,SUM(collected_count)::bigint AS collected_count,
                    SUM(gap_count)::bigint AS gap_count
               FROM business_compatibility_telemetry_v2_hourly
              WHERE observed_hour >= $1::timestamptz
                AND business_context=ANY($2::text[])
              GROUP BY observed_hour,business_context,entry_family,decision_stage,authority_source,outcome,deployment_sha`,
            [queryStartedAt, contexts.map(cleanContext)]
        );
        const runtime = await client.query(
            `SELECT deployment_sha,SUM(eligible_count)::bigint AS eligible_count,
                    SUM(persisted_count)::bigint AS persisted_count,SUM(failed_count)::bigint AS failed_count
               FROM business_compatibility_telemetry_runtime
              WHERE last_seen_at >= $1::timestamptz GROUP BY deployment_sha`,
            [queryStartedAt]
        );
        return buildCompatibilityTelemetryReport(decisions.rows, { contexts, longestEnabledCycleHours,
            observationStartedAt, runtimeRows: runtime.rows, now: options.now });
    } finally { await client.query('ROLLBACK').catch(() => {}); }
}

async function main() {
    const connectionString = process.env.MULTIBUSINESS_AUDIT_DATABASE_URL;
    if (!connectionString) throw new Error('READONLY_DATABASE_URL_REQUIRED');
    const url = new URL(connectionString);
    const client = new Client({ connectionString, connectionTimeoutMillis: 8000, query_timeout: 15000,
        statement_timeout: 10000, application_name: 'sys-mb-compatibility-telemetry-report' });
    try {
        await client.connect();
        const readOnly = await client.query('SHOW transaction_read_only');
        if (String(readOnly.rows[0]?.transaction_read_only).toLowerCase() !== 'on') throw new Error('READONLY_DATABASE_ROLE_REQUIRED');
        const report = await collect(client);
        const output = { ...report, endpointHash: hash(`${url.hostname}:${url.port}${url.pathname}`), productionWrites: 0, operationalRowsRead: 0 };
        if (process.env.SYS_MB_TELEMETRY_REPORT_FILE) fs.writeFileSync(process.env.SYS_MB_TELEMETRY_REPORT_FILE, JSON.stringify(output, null, 2) + '\n');
        console.log(JSON.stringify(output, null, 2));
    } finally { await client.end().catch(() => {}); }
}

module.exports = { ENTRY_FAMILIES, REQUIRED_ENTRY_FAMILIES, buildCompatibilityTelemetryReport, collect };
if (require.main === module) main().catch(error => {
    const postgresCode = /^[0-9A-Z]{5}$/.test(error?.code || '') ? error.code : '';
    console.error(/^[A-Z0-9_]{3,80}$/.test(error.message) ? error.message
        : (postgresCode ? `SYS_MB_TELEMETRY_REPORT_FAILED_${postgresCode}` : 'SYS_MB_TELEMETRY_REPORT_FAILED'));
    process.exitCode = 1;
});
