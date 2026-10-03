#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildHrPayReadiness } = require('../services/hrPayReadiness');
const LIVE_ORIGIN = 'https://8223324090-production.up.railway.app';
const ALLOWED_GET = /^\/api\/(?:version$|hr\/(?:staff\?|professions\?|payroll-profiles\?|staff\/\d+\/payroll-profile-assignments\?))/;

function options(argv) {
    const result = { date: '', output: '', context: 'park' };
    for (let index = 0; index < argv.length; index++) {
        if (!['--date', '--output'].includes(argv[index]) || !argv[index + 1]) throw new Error('READ_ONLY_AUDIT_ARGUMENT_INVALID');
        result[argv[index].slice(2)] = argv[++index];
    }
    if (!result.date || !result.output) throw new Error('DATE_AND_OUTPUT_REQUIRED');
    const outputRoot = path.resolve(__dirname, '../output/hr-pay');
    const output = path.resolve(result.output);
    if (!output.startsWith(outputRoot + path.sep) || path.extname(output) !== '.json') throw new Error('OUTPUT_MUST_STAY_IN_HR_PAY_AUDIT_DIRECTORY');
    return { ...result, output };
}

async function runReadOnlyAudit(args, env = process.env) {
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
            if (!response.ok) { sourceErrors.push({ source, status: response.status }); return null; }
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

if (require.main === module) runReadOnlyAudit(options(process.argv.slice(2))).catch(error => {
    const safeCode = /^[A-Z_]+$/.test(error.message) ? error.message : 'HR_PAY_READINESS_AUDIT_FAILED';
    console.error(safeCode);
    process.exitCode = 1;
});
module.exports = { options, runReadOnlyAudit };
