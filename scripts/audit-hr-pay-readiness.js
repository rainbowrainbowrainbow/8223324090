#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildHrPayReadiness, validateDate } = require('../services/hrPayReadiness');
const LIVE_ORIGIN = 'https://8223324090-production.up.railway.app';
const ALLOWED_GET = /^\/api\/(?:version$|hr\/(?:staff\?|professions\?|payroll-profiles\?|staff\/\d+\/payroll-profile-assignments\?))/;

function options(argv) {
    const result = { date: '', output: '', context: 'park', source: 'api' };
    for (let index = 0; index < argv.length; index++) {
        if (!['--date', '--output', '--source'].includes(argv[index]) || !argv[index + 1]) throw new Error('READ_ONLY_AUDIT_ARGUMENT_INVALID');
        result[argv[index].slice(2)] = argv[++index];
    }
    if (!result.date || !result.output) throw new Error('DATE_AND_OUTPUT_REQUIRED');
    validateDate(result.date);
    if (!['api', 'database'].includes(result.source)) throw new Error('READ_ONLY_AUDIT_SOURCE_INVALID');
    const outputRoot = path.resolve(__dirname, '../output/hr-pay');
    const output = path.resolve(result.output);
    if (!output.startsWith(outputRoot + path.sep) || path.extname(output) !== '.json') throw new Error('OUTPUT_MUST_STAY_IN_HR_PAY_AUDIT_DIRECTORY');
    return { ...result, output };
}

async function runReadOnlyAudit(args, env = process.env) {
    validateDate(args.date);
    if (args.source === 'database') return runReadOnlyDatabaseAudit(args, env);
    const username = env.HR_PAY_QA_USER || env.LIVE_CREATOR_USER;
    const password = env.HR_PAY_QA_PASS || env.LIVE_CREATOR_PASS;
    if (!username || !password) throw new Error('TEST_ACCOUNT_CREDENTIALS_REQUIRED');
    const login = await fetch(LIVE_ORIGIN + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }), signal: AbortSignal.timeout(20000) });
    if (!login.ok) throw new Error('TEST_ACCOUNT_LOGIN_FAILED');
    const auth = await login.json();
    const token = auth.accessToken || auth.token;
    if (!token) throw new Error('TEST_ACCOUNT_TOKEN_UNAVAILABLE');
    const sourceErrors = [];
    async function get(endpoint, source) {
        if (!ALLOWED_GET.test(endpoint)) throw new Error('NON_READ_ENDPOINT_BLOCKED');
        try {
            const response = await fetch(LIVE_ORIGIN + endpoint, { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(20000) });
            if (!response.ok) {
                const failure = await response.json().catch(() => ({}));
                const code = /^[a-zA-Z_]{3,80}$/.test(failure.code || '') ? failure.code : null;
                sourceErrors.push({ source, status: response.status, code }); return null;
            }
            const body = await response.json();
            if (body.success !== true) { sourceErrors.push({ source, status: 'unsuccessful_response' }); return null; }
            return body;
        } catch { sourceErrors.push({ source, status: 'load_error' }); return null; }
    }
    const version = await get('/api/version', 'version');
    if (!version?.commitSha || version.sourceBranch !== 'codex/eventgenix-production') throw new Error('LIVE_RELEASE_IDENTITY_UNVERIFIED');
    const query = '?businessContext=park';
    const roster = await get('/api/hr/staff' + query + '&active=true', 'staff');
    const catalog = await get('/api/hr/professions' + query, 'professions');
    if (!Array.isArray(roster?.data) || !Array.isArray(catalog?.data)) throw new Error('ROSTER_OR_CATALOG_UNAVAILABLE');
    const profiles = await get('/api/hr/payroll-profiles' + query + '&include_archived=true&as_of_date=' + encodeURIComponent(args.date), 'profiles');
    const assignments = [];
    let assignmentsAvailable = Boolean(profiles);
    if (profiles) {
        for (const person of roster.data) {
            const result = await get('/api/hr/staff/' + Number(person.id) + '/payroll-profile-assignments' + query + '&include_past=true', 'assignments');
            if (!Array.isArray(result?.data?.assignments)) assignmentsAvailable = false;
            else assignments.push(...result.data.assignments);
        }
    }
    const after = await get('/api/version', 'version_after');
    if (!after || after.commitSha !== version.commitSha || after.sourceBranch !== version.sourceBranch) throw new Error('LIVE_RELEASE_DRIFT_DURING_AUDIT');
    const report = buildHrPayReadiness({ staff: roster.data, professions: catalog.data, profiles: profiles?.data || [], assignments,
        date: args.date, profilesAvailable: Boolean(profiles), assignmentsAvailable,
        catalogPartial: catalog.professionCatalogAccess?.partial === true,
        payrollAmountsAvailable: catalog.professionCatalogAccess?.payrollDataAccess === true,
        liveProof: { version: version.version, commitSha: version.commitSha, sourceBranch: version.sourceBranch }, sourceErrors });
    report.checkedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ status: report.status, coverage: report.coverage, counts: report.counts, sourceErrors: report.sourceErrors, output: args.output }));
    return report;
}

// This path never loads DATABASE_URL, application startup, migrations or seeds.
// Queries are fixed SELECTs; the transaction and connection both enforce read-only.
const AUDIT_TABLES = ['staff', 'staff_role_assignments', 'staff_profession_rates', 'payroll_profiles',
    'payroll_profile_versions', 'payroll_profile_day_rates', 'staff_payroll_profile_assignments',
    'payroll_schemes', 'payroll_day_exceptions'];
async function readDatabaseInputs(client, date) {
    validateDate(date);
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
        const guard = await client.query("SELECT current_setting('transaction_read_only') AS read_only");
        if (guard.rows[0]?.read_only !== 'on') throw new Error('READ_ONLY_TRANSACTION_REQUIRED');
        const metadata = await client.query(`SELECT name,
            to_regclass('public.' || name) IS NOT NULL AS present,
            COALESCE(has_table_privilege(to_regclass('public.' || name), 'SELECT'), false) AS readable
            FROM unnest($1::text[]) AS names(name)`, [AUDIT_TABLES]);
        const access = new Map(metadata.rows.map(row => [row.name, row]));
        const sourceErrors = [];
        async function select(table, sql, params = []) {
            const state = access.get(table);
            if (!state?.readable) {
                sourceErrors.push({ source: table, status: state?.present ? 'select_denied' : 'schema_missing' });
                return [];
            }
            return (await client.query(sql, params)).rows;
        }
        const staff = await select('staff', `SELECT id, role_type, secondary_professions, is_active, hourly_rate, rate_unit
            FROM staff WHERE is_active = true ORDER BY id`);
        if (!access.get('staff')?.readable) throw new Error('READ_ONLY_HR_TABLE_ACCESS_REQUIRED');
        const ids = staff.map(row => Number(row.id));
        const roleAssignments = await select('staff_role_assignments', `SELECT staff_id, profession_key, status, admission_status
            FROM staff_role_assignments WHERE staff_id = ANY($1::int[])`, [ids]);
        const rates = await select('staff_profession_rates', `SELECT staff_id, profession_key, hourly_rate
            FROM staff_profession_rates WHERE staff_id = ANY($1::int[])`, [ids]);
        const profiles = await select('payroll_profiles', `SELECT id, profession_key, profile_kind, status, is_default_for_profession
            FROM payroll_profiles ORDER BY id`);
        const versions = await select('payroll_profile_versions', `SELECT id, profile_id, version_number, rate_unit, default_rate,
            effective_from::text, effective_to::text FROM payroll_profile_versions ORDER BY effective_from, version_number, id`);
        const dayRates = await select('payroll_profile_day_rates', `SELECT profile_version_id, iso_weekday, rate FROM payroll_profile_day_rates`);
        for (const profile of profiles) profile.versions = versions.filter(row => Number(row.profile_id) === Number(profile.id))
            .map(row => ({ ...row, dayRates: dayRates.filter(day => Number(day.profile_version_id) === Number(row.id)) }));
        const assignments = await select('staff_payroll_profile_assignments', `SELECT id, staff_id, profession_key, profile_id,
            assignment_kind, effective_from::text, effective_to::text FROM staff_payroll_profile_assignments
            WHERE staff_id = ANY($1::int[]) ORDER BY effective_from DESC, id DESC`, [ids]);
        const schemes = await select('payroll_schemes', `SELECT id, staff_id, scheme_type, is_active, config_json, effective_from::text, effective_to::text
            FROM payroll_schemes WHERE staff_id = ANY($1::int[]) ORDER BY effective_from NULLS FIRST, id`, [ids]);
        const journal = await select('payroll_day_exceptions', `SELECT DISTINCT ON (staff_id, profession_key, purpose)
            id, staff_id, profession_key, work_date::text, purpose, version, state, rate, rate_unit
            FROM payroll_day_exceptions WHERE staff_id = ANY($1::int[]) AND work_date = $2::date
            ORDER BY staff_id, profession_key, purpose, version DESC`, [ids, date]);
        const exceptions = journal.map(row => ({ id: Number(row.id), staffId: Number(row.staff_id), professionKey: row.profession_key,
            workDate: row.work_date, purpose: row.purpose, version: Number(row.version), state: row.state,
            rate: row.rate == null ? null : Number(row.rate), rateUnit: row.rate_unit }));
        const readable = table => access.get(table)?.readable === true;
        return { source: 'database', date, staff, roleAssignments, rates, profiles, assignments, schemes, exceptions, sourceErrors,
            payrollAmountsAvailable: true, legacyRatesAvailable: readable('staff_profession_rates'),
            rolesAvailable: readable('staff_role_assignments'),
            profilesAvailable: ['payroll_profiles', 'payroll_profile_versions', 'payroll_profile_day_rates'].every(readable),
            assignmentsAvailable: readable('staff_payroll_profile_assignments'), schemesAvailable: readable('payroll_schemes'),
            exceptionsAvailable: readable('payroll_day_exceptions') };
    } finally { await client.query('ROLLBACK'); }
}

async function runReadOnlyDatabaseAudit(args, env = process.env) {
    const connectionString = env.TRUSTED_QA_OPERATOR_DATABASE_URL;
    if (!connectionString) throw new Error('TRUSTED_QA_OPERATOR_DATABASE_URL_REQUIRED');
    const { Client } = require('pg');
    const client = new Client({ connectionString, connectionTimeoutMillis: 10000, query_timeout: 15000,
        options: '-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=1000',
        application_name: 'hr-pay-readiness-readonly' });
    try {
        await client.connect();
        const report = buildHrPayReadiness(await readDatabaseInputs(client, args.date));
        report.checkedAt = new Date().toISOString();
        report.databaseProof = { transaction: 'REPEATABLE READ READ ONLY', rolledBack: true,
            source: 'TRUSTED_QA_OPERATOR_DATABASE_URL', productionWrites: 0 };
        fs.mkdirSync(path.dirname(args.output), { recursive: true });
        fs.writeFileSync(args.output, JSON.stringify(report, null, 2) + '\n');
        console.log(JSON.stringify({ status: report.status, coverage: report.coverage, counts: report.counts,
            sourceErrors: report.sourceErrors, output: args.output }));
        return report;
    } finally { await client.end().catch(() => {}); }
}

if (require.main === module) runReadOnlyAudit(options(process.argv.slice(2))).catch(error => {
    const safeCode = /^[A-Z_]+$/.test(error.message) ? error.message : 'HR_PAY_READINESS_AUDIT_FAILED';
    console.error(safeCode);
    process.exitCode = 1;
});
module.exports = { options, runReadOnlyAudit, runReadOnlyDatabaseAudit, readDatabaseInputs };
