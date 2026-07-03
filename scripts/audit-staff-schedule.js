#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function loadEnvFile() {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
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

const args = process.argv.slice(2);
const flags = new Set(args.filter(arg => arg.startsWith('--') && !arg.includes('=')));

function argValue(name, fallback = null) {
    const exact = args.find(arg => arg.startsWith(`${name}=`));
    if (exact) return exact.slice(name.length + 1);
    const index = args.indexOf(name);
    if (index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')) return args[index + 1];
    return fallback;
}

function isoDate(date) {
    return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
    const next = new Date(date.getTime());
    next.setUTCDate(next.getUTCDate() + days);
    return next;
}

function parseLimit(value) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 100;
    return Math.min(parsed, 1000);
}

function normalizeStatus(status) {
    const raw = String(status || '').trim().toLowerCase();
    if (raw === 'day_off') return 'dayoff';
    return raw;
}

function time5(value) {
    if (value === null || value === undefined) return null;
    const raw = String(value);
    const match = raw.match(/^(\d{2}:\d{2})/);
    return match ? match[1] : raw.slice(0, 5);
}

function date10(value) {
    if (value === null || value === undefined) return null;
    const raw = String(value);
    const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : raw.slice(0, 10);
}

function boolValue(value) {
    return value === true || value === 'true' || value === 1 || value === '1';
}

function poolValue(value) {
    return String(value || 'core').trim().toLowerCase() || 'core';
}

function hasDbConfig() {
    return Boolean(process.env.DATABASE_URL || process.env.PGHOST || process.env.PGDATABASE || process.env.PGUSER);
}

const today = new Date();
const FROM = argValue('--from', isoDate(addDays(today, -14)));
const TO = argValue('--to', isoDate(addDays(today, 45)));
const CONTEXT = argValue('--context', 'event_genix');
const LIMIT = parseLimit(argValue('--limit', '100'));
const JSON_OUTPUT = flags.has('--json');
const STRICT = flags.has('--strict');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
    max: 4,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000
});

async function hasTable(tableName) {
    const result = await pool.query(
        `SELECT 1
           FROM information_schema.tables
          WHERE table_schema = ANY (current_schemas(false))
            AND table_name = $1
          LIMIT 1`,
        [tableName]
    );
    return result.rowCount > 0;
}

async function tableColumns(tableName) {
    const result = await pool.query(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = ANY (current_schemas(false))
            AND table_name = $1`,
        [tableName]
    );
    return new Set(result.rows.map(row => row.column_name));
}

function staffBucketNames(row, dateField = 'date') {
    const buckets = [];
    const poolStatus = poolValue(row.hr_pool_status);
    const rowDate = date10(row[dateField]);
    const terminationDate = date10(row.termination_date);

    if (row.is_active === false) {
        buckets.push('inactive_staff_in_schedule');
    }
    if (poolStatus === 'blacklisted') {
        buckets.push('blacklisted_staff_in_schedule');
    }
    if (poolStatus === 'reserve') {
        buckets.push('reserve_staff_in_schedule');
    }
    if (['offboarded', 'dismissed', 'terminated'].includes(poolStatus) || (terminationDate && rowDate && terminationDate <= rowDate)) {
        buckets.push('terminated_staff_in_schedule');
    }
    if (poolStatus && poolStatus !== 'core' && !['blacklisted', 'reserve', 'offboarded', 'dismissed', 'terminated'].includes(poolStatus)) {
        buckets.push('non_core_staff_in_schedule');
    }
    if (boolValue(row.is_freelance)) {
        buckets.push('freelance_without_explicit_mode');
    }

    return buckets;
}

function issueForRow(row) {
    const issues = [];
    const rawStatus = String(row.raw_status || '').trim().toLowerCase();
    const status = normalizeStatus(row.raw_status);
    const scheduleStart = time5(row.shift_start);
    const scheduleEnd = time5(row.shift_end);
    const shiftStart = time5(row.planned_start);
    const shiftEnd = time5(row.planned_end);
    const hasShift = Boolean(row.hr_shift_id);
    const hasAudit = Boolean(row.has_schedule_audit);
    const workLike = ['working', 'remote'].includes(status);
    const nonWorkLike = ['dayoff', 'vacation', 'sick'].includes(status);

    if (rawStatus === 'day_off') {
        issues.push('legacy_day_off_status');
    }
    if (!['working', 'remote', 'dayoff', 'vacation', 'sick'].includes(status)) {
        issues.push('unknown_schedule_status');
    }
    if (workLike && (!scheduleStart || !scheduleEnd)) {
        issues.push('working_without_time');
    }
    if (nonWorkLike && (scheduleStart || scheduleEnd)) {
        issues.push('non_working_with_time');
    }
    if (workLike && !hasShift) {
        issues.push('working_without_hr_shift');
    }
    if (nonWorkLike && hasShift) {
        issues.push('non_working_with_hr_shift');
    }
    if (hasShift && workLike && (scheduleStart !== shiftStart || scheduleEnd !== shiftEnd)) {
        issues.push('schedule_hr_time_mismatch');
    }
    if (hasShift && status === 'remote' && String(row.shift_type || '') !== 'remote') {
        issues.push('remote_schedule_regular_hr_shift');
    }
    if (hasShift && status === 'working' && String(row.shift_type || '') === 'remote') {
        issues.push('working_schedule_remote_hr_shift');
    }
    if (row.is_active === false) {
        issues.push('inactive_staff_in_schedule');
    }
    if (['reserve', 'blacklisted'].includes(String(row.hr_pool_status || '').toLowerCase())) {
        issues.push(`staff_pool_${String(row.hr_pool_status).toLowerCase()}_in_schedule`);
    }
    for (const bucket of staffBucketNames(row)) {
        if (!issues.includes(bucket)) issues.push(bucket);
    }
    if (!hasAudit) {
        issues.push('missing_schedule_audit');
    }
    if (!hasAudit && hasShift && workLike && scheduleStart === shiftStart && scheduleEnd === shiftEnd) {
        issues.push('possible_read_backfill_candidate');
    }
    return issues;
}

function addFinding(state, source, row, issues) {
    if (!issues.length) return;
    state.findings.push({ source, issues, row });
    for (const issue of issues) {
        state.byIssue[issue] = (state.byIssue[issue] || 0) + 1;
        if (!state.buckets[issue]) state.buckets[issue] = [];
        state.buckets[issue].push(compactRow(source, row));
    }
}

function compactRow(source, row) {
    return {
        source,
        scheduleId: row.schedule_id || null,
        hrShiftId: row.hr_shift_id || row.shift_id || null,
        lineRowId: row.line_row_id || null,
        employeeProfileId: row.employee_profile_id || null,
        userId: row.user_id || null,
        staffId: row.staff_id,
        staffName: row.staff_name || row.full_name || null,
        date: date10(row.date || row.shift_date),
        status: row.raw_status ? normalizeStatus(row.raw_status) : null,
        poolStatus: poolValue(row.hr_pool_status),
        isActive: row.is_active,
        terminationDate: date10(row.termination_date),
        isFreelance: boolValue(row.is_freelance),
        hasTimeRecord: row.has_time_record === undefined ? undefined : Boolean(row.has_time_record),
        businessContext: row.business_context || null
    };
}

function formatFinding(finding) {
    const row = finding.row;
    const who = `${row.staff_name || row.full_name || 'unknown'} (#${row.staff_id || '-'})`;
    const date = date10(row.date || row.shift_date) || '-';
    const schedule = `${date} ${normalizeStatus(row.raw_status) || '-'} ${time5(row.shift_start) || '-'}-${time5(row.shift_end) || '-'}`;
    const shift = row.hr_shift_id || row.shift_id
        ? `hr_shift=${row.hr_shift_id || row.shift_id} ${row.shift_type || '-'} ${time5(row.planned_start) || '-'}-${time5(row.planned_end) || '-'}`
        : 'hr_shift=none';
    return `${finding.source} | ${finding.issues.join(', ')} | ${who} | ${schedule} | ${shift}`;
}

function staffSelects(staffColumns, alias = 's') {
    return {
        poolStatus: staffColumns.has('hr_pool_status') ? `${alias}.hr_pool_status` : "'core' AS hr_pool_status",
        terminationDate: staffColumns.has('termination_date') ? `${alias}.termination_date` : 'NULL AS termination_date',
        freelance: staffColumns.has('is_freelance') ? `${alias}.is_freelance` : 'false AS is_freelance'
    };
}

function staffRiskSql(staffColumns, alias, dateExpression) {
    const parts = [`${alias}.is_active = false`];
    if (staffColumns.has('hr_pool_status')) {
        parts.push(`LOWER(COALESCE(${alias}.hr_pool_status, 'core')) <> 'core'`);
    }
    if (staffColumns.has('termination_date')) {
        parts.push(`(${alias}.termination_date IS NOT NULL AND ${alias}.termination_date::date <= ${dateExpression}::date)`);
    }
    if (staffColumns.has('is_freelance')) {
        parts.push(`COALESCE(${alias}.is_freelance, false) = true`);
    }
    return `(${parts.join(' OR ')})`;
}

async function auditStaffSchedule(state, columns) {
    const scheduleColumns = columns.staff_schedule;
    const staffColumns = columns.staff;
    const shiftColumns = columns.hr_shifts;
    const hasScheduleContext = scheduleColumns.has('business_context');
    const hasProfession = scheduleColumns.has('profession_key');
    const hasShiftProfession = shiftColumns.has('profession_key');
    const hasOriginalStaff = shiftColumns.has('original_staff_id');
    const hasReplacementReason = shiftColumns.has('replacement_reason');
    const staffBits = staffSelects(staffColumns, 's');

    const contextSelect = hasScheduleContext ? 'ss.business_context' : "'event_genix' AS business_context";
    const contextWhere = hasScheduleContext ? 'AND COALESCE(ss.business_context, $3) = $3' : '';
    const professionSelect = hasProfession ? 'ss.profession_key' : 'NULL AS profession_key';
    const shiftProfessionSelect = hasShiftProfession ? 'hs.profession_key AS hr_profession_key' : 'NULL AS hr_profession_key';
    const originalStaffSelect = hasOriginalStaff ? 'hs.original_staff_id' : 'NULL AS original_staff_id';
    const replacementReasonSelect = hasReplacementReason ? 'hs.replacement_reason' : 'NULL AS replacement_reason';

    const rows = await pool.query(
        `SELECT ss.id AS schedule_id,
                ss.staff_id,
                LEFT(ss.date::text, 10) AS date,
                ss.status AS raw_status,
                ss.shift_start,
                ss.shift_end,
                ss.note,
                ${contextSelect},
                ${professionSelect},
                s.name AS staff_name,
                s.department,
                s.position,
                s.is_active,
                ${staffBits.poolStatus},
                ${staffBits.terminationDate},
                ${staffBits.freelance},
                hs.id AS hr_shift_id,
                hs.planned_start,
                hs.planned_end,
                hs.shift_type,
                hs.created_by AS hr_shift_created_by,
                hs.created_at AS hr_shift_created_at,
                hs.updated_at AS hr_shift_updated_at,
                ${shiftProfessionSelect},
                ${originalStaffSelect},
                ${replacementReasonSelect},
                EXISTS (
                    SELECT 1
                      FROM hr_time_records tr
                     WHERE tr.staff_id = ss.staff_id
                       AND tr.record_date::text = LEFT(ss.date::text, 10)
                ) AS has_time_record,
                EXISTS (
                    SELECT 1
                      FROM hr_audit_log h
                     WHERE h.staff_id = ss.staff_id
                       AND h.action LIKE 'staff_schedule%'
                       AND (
                            h.details->>'date' = LEFT(ss.date::text, 10)
                            OR h.details#>>'{before,date}' = LEFT(ss.date::text, 10)
                            OR h.details#>>'{after,date}' = LEFT(ss.date::text, 10)
                       )
                ) AS has_schedule_audit
           FROM staff_schedule ss
           JOIN staff s ON s.id = ss.staff_id
           LEFT JOIN hr_shifts hs
             ON hs.staff_id = ss.staff_id
            AND hs.shift_date::text = LEFT(ss.date::text, 10)
          WHERE LEFT(ss.date::text, 10) >= $1
            AND LEFT(ss.date::text, 10) <= $2
            ${contextWhere}
          ORDER BY LEFT(ss.date::text, 10), s.department, s.name`,
        hasScheduleContext ? [FROM, TO, CONTEXT] : [FROM, TO]
    );

    state.scanned.staff_schedule = rows.rowCount;
    for (const row of rows.rows) {
        addFinding(state, 'staff_schedule', row, issueForRow(row));
    }
}

async function auditHrShifts(state, columns, tables) {
    if (!tables.hr_shifts) return;
    const staffColumns = columns.staff;
    const shiftColumns = columns.hr_shifts;
    const staffBits = staffSelects(staffColumns, 's');
    const hasShiftContext = shiftColumns.has('business_context');
    const contextSelect = hasShiftContext ? 'hs.business_context' : "'event_genix' AS business_context";
    const contextWhere = hasShiftContext ? 'AND COALESCE(hs.business_context, $3) = $3' : '';
    const timeRecordSelect = tables.hr_time_records
        ? `EXISTS (
                    SELECT 1
                      FROM hr_time_records tr
                     WHERE tr.staff_id = hs.staff_id
                       AND tr.record_date::text = hs.shift_date::text
                ) AS has_time_record`
        : 'false AS has_time_record';

    const rows = await pool.query(
        `SELECT hs.id AS shift_id,
                hs.id AS hr_shift_id,
                hs.staff_id,
                hs.shift_date::text AS date,
                hs.planned_start,
                hs.planned_end,
                hs.shift_type,
                ${contextSelect},
                s.name AS staff_name,
                s.department,
                s.position,
                s.is_active,
                ${staffBits.poolStatus},
                ${staffBits.terminationDate},
                ${staffBits.freelance},
                ${timeRecordSelect}
           FROM hr_shifts hs
           JOIN staff s ON s.id = hs.staff_id
          WHERE hs.shift_date >= $1::date
            AND hs.shift_date <= $2::date
            ${contextWhere}
          ORDER BY hs.shift_date, s.department, s.name`,
        hasShiftContext ? [FROM, TO, CONTEXT] : [FROM, TO]
    );

    state.scanned.hr_shifts = rows.rowCount;
    for (const row of rows.rows) {
        addFinding(state, 'hr_shifts', row, staffBucketNames(row));
    }
}

async function auditEmployeeProfiles(state, columns, tables) {
    if (!tables.employee_profiles) return;
    const profileColumns = columns.employee_profiles;
    const staffColumns = columns.staff;
    const staffBits = staffSelects(staffColumns, 's');
    const profileActive = profileColumns.has('is_active') ? 'COALESCE(ep.is_active, true) = true' : 'true';
    const profileName = profileColumns.has('full_name') ? 'ep.full_name' : 'NULL AS full_name';
    const hasUserId = profileColumns.has('user_id');
    const userIdSelect = hasUserId ? 'ep.user_id' : 'NULL AS user_id';
    const riskSql = staffRiskSql(staffColumns, 's', '$1');

    const rows = await pool.query(
        `SELECT ep.id AS employee_profile_id,
                ep.staff_id,
                ${userIdSelect},
                ${profileName},
                s.name AS staff_name,
                s.is_active,
                ${staffBits.poolStatus},
                ${staffBits.terminationDate},
                ${staffBits.freelance},
                $1::date AS date
           FROM employee_profiles ep
           JOIN staff s ON s.id = ep.staff_id
          WHERE ep.staff_id IS NOT NULL
            AND ${profileActive}
            AND ${riskSql}
          ORDER BY s.name, ep.id`,
        [TO]
    );

    state.scanned.employee_profiles = rows.rowCount;
    for (const row of rows.rows) {
        addFinding(state, 'employee_profiles', row, ['active_profile_for_inactive_staff']);
    }
}

async function auditUsers(state, columns, tables) {
    if (!tables.employee_profiles || !tables.users) return;
    const profileColumns = columns.employee_profiles;
    const userColumns = columns.users;
    if (!profileColumns.has('user_id')) return;
    const staffColumns = columns.staff;
    const staffBits = staffSelects(staffColumns, 's');
    const userActive = userColumns.has('is_active') ? 'COALESCE(u.is_active, true) = true' : 'true';
    const riskSql = staffRiskSql(staffColumns, 's', '$1');

    const rows = await pool.query(
        `SELECT u.id AS user_id,
                ep.id AS employee_profile_id,
                ep.staff_id,
                s.name AS staff_name,
                s.is_active,
                ${staffBits.poolStatus},
                ${staffBits.terminationDate},
                ${staffBits.freelance},
                $1::date AS date
           FROM users u
           JOIN employee_profiles ep ON ep.user_id = u.id
           JOIN staff s ON s.id = ep.staff_id
          WHERE ${userActive}
            AND ${riskSql}
          ORDER BY s.name, u.id`,
        [TO]
    );

    state.scanned.users = rows.rowCount;
    for (const row of rows.rows) {
        addFinding(state, 'users', row, ['active_user_for_offboarded_staff']);
    }
}

async function auditGeneratedLines(state, columns, tables) {
    if (!tables.lines_by_date) return;
    const lineColumns = columns.lines_by_date;
    if (!lineColumns.has('line_id') || !lineColumns.has('date')) return;
    const staffColumns = columns.staff;
    const staffBits = staffSelects(staffColumns, 's');
    const hasLineContext = lineColumns.has('business_context');
    const hasFromSheet = lineColumns.has('from_sheet');
    const lineRowSelect = lineColumns.has('id') ? 'l.id AS line_row_id' : 'NULL AS line_row_id';
    const contextSelect = hasLineContext ? 'l.business_context' : "'event_genix' AS business_context";
    const contextWhere = hasLineContext ? 'AND COALESCE(l.business_context, $3) = $3' : '';
    const fromSheetWhere = hasFromSheet ? 'AND COALESCE(l.from_sheet, false) = true' : '';
    const riskSql = staffRiskSql(staffColumns, 's', "LEFT(l.date::text, 10)");

    const rows = await pool.query(
        `SELECT ${lineRowSelect},
                l.line_id,
                s.id AS staff_id,
                LEFT(l.date::text, 10) AS date,
                ${contextSelect},
                s.name AS staff_name,
                s.is_active,
                ${staffBits.poolStatus},
                ${staffBits.terminationDate},
                ${staffBits.freelance}
           FROM lines_by_date l
           JOIN staff s ON l.line_id::text = s.id::text
          WHERE LEFT(l.date::text, 10) >= $1
            AND LEFT(l.date::text, 10) <= $2
            ${contextWhere}
            ${fromSheetWhere}
            AND ${riskSql}
          ORDER BY LEFT(l.date::text, 10), s.name`,
        hasLineContext ? [FROM, TO, CONTEXT] : [FROM, TO]
    );

    state.scanned.lines_by_date = rows.rowCount;
    for (const row of rows.rows) {
        addFinding(state, 'lines_by_date', row, ['generated_timeline_lines_for_invalid_staff']);
    }
}

async function main() {
    if (!hasDbConfig()) {
        throw new Error('No DATABASE_URL/PGHOST/PGDATABASE/PGUSER found. Configure DB env or .env first.');
    }

    const tables = {
        staff_schedule: await hasTable('staff_schedule'),
        staff: await hasTable('staff'),
        hr_shifts: await hasTable('hr_shifts'),
        hr_time_records: await hasTable('hr_time_records'),
        employee_profiles: await hasTable('employee_profiles'),
        users: await hasTable('users'),
        lines_by_date: await hasTable('lines_by_date')
    };
    if (!tables.staff_schedule || !tables.staff) {
        throw new Error('Required staff_schedule/staff tables are not available.');
    }

    const columns = {};
    for (const [tableName, present] of Object.entries(tables)) {
        columns[tableName] = present ? await tableColumns(tableName) : new Set();
    }

    const state = {
        findings: [],
        byIssue: {},
        buckets: {
            inactive_staff_in_schedule: [],
            blacklisted_staff_in_schedule: [],
            reserve_staff_in_schedule: [],
            terminated_staff_in_schedule: [],
            freelance_without_explicit_mode: [],
            active_profile_for_inactive_staff: [],
            active_user_for_offboarded_staff: [],
            generated_timeline_lines_for_invalid_staff: []
        },
        scanned: {
            staff_schedule: 0,
            hr_shifts: 0,
            employee_profiles: 0,
            users: 0,
            lines_by_date: 0
        }
    };

    await auditStaffSchedule(state, columns);
    await auditHrShifts(state, columns, tables);
    await auditEmployeeProfiles(state, columns, tables);
    await auditUsers(state, columns, tables);
    await auditGeneratedLines(state, columns, tables);

    const examples = state.findings.slice(0, LIMIT);
    const bucketCounts = Object.fromEntries(Object.entries(state.buckets).map(([key, rows]) => [key, rows.length]));
    const result = {
        readOnly: true,
        context: CONTEXT,
        from: FROM,
        to: TO,
        scannedRows: state.scanned.staff_schedule,
        scanned: state.scanned,
        findingRows: state.findings.length,
        byIssue: state.byIssue,
        bucketCounts,
        buckets: state.buckets,
        examples: examples.map(finding => ({
            source: finding.source,
            issues: finding.issues,
            ...compactRow(finding.source, finding.row),
            rawStatus: finding.row.raw_status,
            shiftStart: time5(finding.row.shift_start),
            shiftEnd: time5(finding.row.shift_end),
            hrShiftStart: time5(finding.row.planned_start),
            hrShiftEnd: time5(finding.row.planned_end),
            hrShiftType: finding.row.shift_type,
            hasScheduleAudit: finding.row.has_schedule_audit === undefined ? undefined : Boolean(finding.row.has_schedule_audit)
        }))
    };

    if (JSON_OUTPUT) {
        console.log(JSON.stringify(result, null, 2));
    } else {
        console.log('Staff schedule audit (read-only)');
        console.log(`context=${CONTEXT} from=${FROM} to=${TO} scanned=${JSON.stringify(result.scanned)} findingRows=${result.findingRows}`);
        console.log('Issues:');
        for (const [issue, count] of Object.entries(result.byIssue).sort((a, b) => b[1] - a[1])) {
            console.log(`  ${issue}: ${count}`);
        }
        if (!Object.keys(result.byIssue).length) {
            console.log('  none');
        }
        console.log('Buckets:');
        for (const [bucket, count] of Object.entries(result.bucketCounts).sort((a, b) => b[1] - a[1])) {
            console.log(`  ${bucket}: ${count}`);
        }
        console.log(`Examples (limit=${LIMIT}):`);
        for (const finding of examples) {
            console.log(`  - ${formatFinding(finding)}`);
        }
    }

    if (STRICT && state.findings.length) {
        process.exitCode = 1;
    }
}

main()
    .catch(err => {
        console.error(`Staff schedule audit failed: ${err.message}`);
        process.exitCode = 1;
    })
    .finally(() => pool.end().catch(() => {}));
