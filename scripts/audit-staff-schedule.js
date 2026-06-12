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

async function tableColumns(tableName) {
    const result = await pool.query(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_name = $1`,
        [tableName]
    );
    return new Set(result.rows.map(row => row.column_name));
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
    if (!hasAudit) {
        issues.push('missing_schedule_audit');
    }
    if (!hasAudit && hasShift && workLike && scheduleStart === shiftStart && scheduleEnd === shiftEnd) {
        issues.push('possible_read_backfill_candidate');
    }
    return issues;
}

function summarize(findings) {
    const byIssue = {};
    for (const finding of findings) {
        for (const issue of finding.issues) {
            byIssue[issue] = (byIssue[issue] || 0) + 1;
        }
    }
    return byIssue;
}

function formatFinding(finding) {
    const row = finding.row;
    const who = `${row.staff_name || 'unknown'} (#${row.staff_id})`;
    const schedule = `${row.date} ${normalizeStatus(row.raw_status)} ${time5(row.shift_start) || '-'}-${time5(row.shift_end) || '-'}`;
    const shift = row.hr_shift_id
        ? `hr_shift=${row.hr_shift_id} ${row.shift_type || '-'} ${time5(row.planned_start) || '-'}-${time5(row.planned_end) || '-'}`
        : 'hr_shift=none';
    return `${finding.issues.join(', ')} | ${who} | ${schedule} | ${shift}`;
}

async function main() {
    if (!hasDbConfig()) {
        throw new Error('No DATABASE_URL/PGHOST/PGDATABASE/PGUSER found. Configure DB env or .env first.');
    }

    const scheduleColumns = await tableColumns('staff_schedule');
    const staffColumns = await tableColumns('staff');
    const shiftColumns = await tableColumns('hr_shifts');
    const hasScheduleContext = scheduleColumns.has('business_context');
    const hasProfession = scheduleColumns.has('profession_key');
    const hasPoolStatus = staffColumns.has('hr_pool_status');
    const hasShiftProfession = shiftColumns.has('profession_key');
    const hasOriginalStaff = shiftColumns.has('original_staff_id');
    const hasReplacementReason = shiftColumns.has('replacement_reason');

    const contextSelect = hasScheduleContext ? 'ss.business_context' : "'event_genix' AS business_context";
    const contextWhere = hasScheduleContext ? 'AND COALESCE(ss.business_context, $3) = $3' : '';
    const professionSelect = hasProfession ? 'ss.profession_key' : 'NULL AS profession_key';
    const poolStatusSelect = hasPoolStatus ? 's.hr_pool_status' : "'core' AS hr_pool_status";
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
                ${poolStatusSelect},
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

    const findings = [];
    for (const row of rows.rows) {
        const issues = issueForRow(row);
        if (issues.length) findings.push({ issues, row });
    }
    const examples = findings.slice(0, LIMIT);
    const result = {
        readOnly: true,
        context: CONTEXT,
        from: FROM,
        to: TO,
        scannedRows: rows.rowCount,
        findingRows: findings.length,
        byIssue: summarize(findings),
        examples: examples.map(finding => ({
            issues: finding.issues,
            scheduleId: finding.row.schedule_id,
            staffId: finding.row.staff_id,
            staffName: finding.row.staff_name,
            date: finding.row.date,
            status: normalizeStatus(finding.row.raw_status),
            rawStatus: finding.row.raw_status,
            shiftStart: time5(finding.row.shift_start),
            shiftEnd: time5(finding.row.shift_end),
            hrShiftId: finding.row.hr_shift_id,
            hrShiftStart: time5(finding.row.planned_start),
            hrShiftEnd: time5(finding.row.planned_end),
            hrShiftType: finding.row.shift_type,
            hasScheduleAudit: Boolean(finding.row.has_schedule_audit)
        }))
    };

    if (JSON_OUTPUT) {
        console.log(JSON.stringify(result, null, 2));
    } else {
        console.log('Staff schedule audit (read-only)');
        console.log(`context=${CONTEXT} from=${FROM} to=${TO} scanned=${result.scannedRows} findingRows=${result.findingRows}`);
        console.log('Issues:');
        for (const [issue, count] of Object.entries(result.byIssue).sort((a, b) => b[1] - a[1])) {
            console.log(`  ${issue}: ${count}`);
        }
        if (!Object.keys(result.byIssue).length) {
            console.log('  none');
        }
        console.log(`Examples (limit=${LIMIT}):`);
        for (const finding of examples) {
            console.log(`  - ${formatFinding(finding)}`);
        }
    }

    if (STRICT && findings.length) {
        process.exitCode = 1;
    }
}

main()
    .catch(err => {
        console.error(`Staff schedule audit failed: ${err.message}`);
        process.exitCode = 1;
    })
    .finally(() => pool.end().catch(() => {}));
