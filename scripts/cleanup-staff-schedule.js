#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const CONFIRM_TOKEN = 'I_CONFIRM_FUTURE_STAFF_SCHEDULE_CLEANUP';

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

function maxIsoDate(a, b) {
    return a > b ? a : b;
}

function parseLimit(value) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 100;
    return Math.min(parsed, 1000);
}

function hasDbConfig() {
    return Boolean(process.env.DATABASE_URL || process.env.PGHOST || process.env.PGDATABASE || process.env.PGUSER);
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

const today = new Date();
const FROM = argValue('--from', isoDate(addDays(today, -14)));
const TO = argValue('--to', isoDate(addDays(today, 45)));
const EFFECTIVE_FROM = maxIsoDate(FROM, isoDate(new Date()));
const CONTEXT = argValue('--context', 'event_genix');
const LIMIT = parseLimit(argValue('--limit', '100'));
const APPLY = flags.has('--apply');
const CONFIRM = argValue('--confirm', '');
const JSON_OUTPUT = flags.has('--json');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
    max: 4,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000
});

async function hasTable(client, tableName) {
    const result = await client.query(
        `SELECT 1
           FROM information_schema.tables
          WHERE table_schema = ANY (current_schemas(false))
            AND table_name = $1
          LIMIT 1`,
        [tableName]
    );
    return result.rowCount > 0;
}

async function tableColumns(client, tableName) {
    const result = await client.query(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = ANY (current_schemas(false))
            AND table_name = $1`,
        [tableName]
    );
    return new Set(result.rows.map(row => row.column_name));
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

function contextPieces(columns, alias) {
    const hasContext = columns.has('business_context');
    return {
        hasContext,
        select: hasContext ? `${alias}.business_context` : "'event_genix' AS business_context",
        where: hasContext ? `AND COALESCE(${alias}.business_context, $3) = $3` : '',
        params: hasContext ? [EFFECTIVE_FROM, TO, CONTEXT] : [EFFECTIVE_FROM, TO]
    };
}

function timeRecordAbsentSql(alias, dateExpression) {
    return `NOT EXISTS (
                    SELECT 1
                      FROM hr_time_records tr
                     WHERE tr.staff_id = ${alias}.staff_id
                       AND tr.record_date::text = ${dateExpression}
                )`;
}

function timeRecordPresentSql(alias, dateExpression) {
    return `EXISTS (
                    SELECT 1
                      FROM hr_time_records tr
                     WHERE tr.staff_id = ${alias}.staff_id
                       AND tr.record_date::text = ${dateExpression}
                )`;
}

function mapScheduleRow(row) {
    return {
        scheduleId: row.schedule_id,
        staffId: row.staff_id,
        staffName: row.staff_name,
        date: date10(row.date),
        status: row.raw_status || null,
        poolStatus: poolValue(row.hr_pool_status),
        isActive: row.is_active,
        terminationDate: date10(row.termination_date),
        isFreelance: boolValue(row.is_freelance),
        businessContext: row.business_context || null
    };
}

function mapShiftRow(row) {
    return {
        hrShiftId: row.hr_shift_id,
        staffId: row.staff_id,
        staffName: row.staff_name,
        date: date10(row.date),
        shiftType: row.shift_type || null,
        poolStatus: poolValue(row.hr_pool_status),
        isActive: row.is_active,
        terminationDate: date10(row.termination_date),
        isFreelance: boolValue(row.is_freelance),
        businessContext: row.business_context || null
    };
}

function mapLineRow(row) {
    return {
        lineRowId: row.line_row_id || null,
        lineId: row.line_id,
        staffId: row.staff_id,
        staffName: row.staff_name,
        date: date10(row.date),
        poolStatus: poolValue(row.hr_pool_status),
        isActive: row.is_active,
        terminationDate: date10(row.termination_date),
        isFreelance: boolValue(row.is_freelance),
        businessContext: row.business_context || null
    };
}

function takeExamples(rows) {
    return rows.slice(0, LIMIT);
}

function canTraceGeneratedLines(tables, columns) {
    const lineColumns = columns.lines_by_date || new Set();
    const bookingColumns = columns.bookings || new Set();
    return tables.lines_by_date
        && tables.bookings
        && lineColumns.has('line_id')
        && lineColumns.has('date')
        && lineColumns.has('from_sheet')
        && bookingColumns.has('line_id')
        && bookingColumns.has('date');
}

function staffScheduleSelectSql(columns, requireTimeRecord) {
    const scheduleColumns = columns.staff_schedule;
    const staffColumns = columns.staff;
    const context = contextPieces(scheduleColumns, 'ss');
    const staffBits = staffSelects(staffColumns, 's');
    const risk = staffRiskSql(staffColumns, 's', "LEFT(ss.date::text, 10)");
    const timeClause = requireTimeRecord
        ? timeRecordPresentSql('ss', "LEFT(ss.date::text, 10)")
        : timeRecordAbsentSql('ss', "LEFT(ss.date::text, 10)");

    return {
        params: context.params,
        sql: `SELECT ss.id AS schedule_id,
                     ss.staff_id,
                     LEFT(ss.date::text, 10) AS date,
                     ss.status AS raw_status,
                     ${context.select},
                     s.name AS staff_name,
                     s.is_active,
                     ${staffBits.poolStatus},
                     ${staffBits.terminationDate},
                     ${staffBits.freelance}
                FROM staff_schedule ss
                JOIN staff s ON s.id = ss.staff_id
               WHERE LEFT(ss.date::text, 10) >= $1
                 AND LEFT(ss.date::text, 10) <= $2
                 ${context.where}
                 AND ${risk}
                 AND ${timeClause}
               ORDER BY LEFT(ss.date::text, 10), s.name, ss.id`
    };
}

function staffScheduleDeleteSql(columns) {
    const scheduleColumns = columns.staff_schedule;
    const staffColumns = columns.staff;
    const context = contextPieces(scheduleColumns, 'ss');
    const staffBits = staffSelects(staffColumns, 's');
    const risk = staffRiskSql(staffColumns, 's', "LEFT(ss.date::text, 10)");

    return {
        params: context.params,
        sql: `DELETE FROM staff_schedule ss
                    USING staff s
                    WHERE s.id = ss.staff_id
                      AND LEFT(ss.date::text, 10) >= $1
                      AND LEFT(ss.date::text, 10) <= $2
                      ${context.where}
                      AND ${risk}
                      AND ${timeRecordAbsentSql('ss', "LEFT(ss.date::text, 10)")}
                 RETURNING ss.id AS schedule_id,
                           ss.staff_id,
                           LEFT(ss.date::text, 10) AS date,
                           ss.status AS raw_status,
                           ${context.select},
                           s.name AS staff_name,
                           s.is_active,
                           ${staffBits.poolStatus},
                           ${staffBits.terminationDate},
                           ${staffBits.freelance}`
    };
}

function hrShiftSelectSql(columns, requireTimeRecord) {
    const shiftColumns = columns.hr_shifts;
    const staffColumns = columns.staff;
    const context = contextPieces(shiftColumns, 'hs');
    const staffBits = staffSelects(staffColumns, 's');
    const risk = staffRiskSql(staffColumns, 's', 'hs.shift_date');
    const timeClause = requireTimeRecord
        ? timeRecordPresentSql('hs', 'hs.shift_date::text')
        : timeRecordAbsentSql('hs', 'hs.shift_date::text');

    return {
        params: context.params,
        sql: `SELECT hs.id AS hr_shift_id,
                     hs.staff_id,
                     hs.shift_date::text AS date,
                     hs.shift_type,
                     ${context.select},
                     s.name AS staff_name,
                     s.is_active,
                     ${staffBits.poolStatus},
                     ${staffBits.terminationDate},
                     ${staffBits.freelance}
                FROM hr_shifts hs
                JOIN staff s ON s.id = hs.staff_id
               WHERE hs.shift_date >= $1::date
                 AND hs.shift_date <= $2::date
                 ${context.where}
                 AND ${risk}
                 AND ${timeClause}
               ORDER BY hs.shift_date, s.name, hs.id`
    };
}

function hrShiftDeleteSql(columns) {
    const shiftColumns = columns.hr_shifts;
    const staffColumns = columns.staff;
    const context = contextPieces(shiftColumns, 'hs');
    const staffBits = staffSelects(staffColumns, 's');
    const risk = staffRiskSql(staffColumns, 's', 'hs.shift_date');

    return {
        params: context.params,
        sql: `DELETE FROM hr_shifts hs
                    USING staff s
                    WHERE s.id = hs.staff_id
                      AND hs.shift_date >= $1::date
                      AND hs.shift_date <= $2::date
                      ${context.where}
                      AND ${risk}
                      AND ${timeRecordAbsentSql('hs', 'hs.shift_date::text')}
                 RETURNING hs.id AS hr_shift_id,
                           hs.staff_id,
                           hs.shift_date::text AS date,
                           hs.shift_type,
                           ${context.select},
                           s.name AS staff_name,
                           s.is_active,
                           ${staffBits.poolStatus},
                           ${staffBits.terminationDate},
                           ${staffBits.freelance}`
    };
}

function bookingExistsSql(columns) {
    const bookingColumns = columns.bookings;
    const lineColumns = columns.lines_by_date;
    if (!bookingColumns.has('date') || !bookingColumns.has('line_id')) return null;
    const contextMatch = bookingColumns.has('business_context') && lineColumns.has('business_context')
        ? 'AND COALESCE(b.business_context, $3) = COALESCE(l.business_context, $3)'
        : '';
    return `EXISTS (
                    SELECT 1
                      FROM bookings b
                     WHERE LEFT(b.date::text, 10) = LEFT(l.date::text, 10)
                       AND b.line_id::text = l.line_id::text
                       ${contextMatch}
                )`;
}

function lineSafetyBlockSql(columns) {
    const bookingExists = bookingExistsSql(columns);
    const timeExists = `EXISTS (
                    SELECT 1
                      FROM hr_time_records tr
                     WHERE tr.staff_id = s.id
                       AND tr.record_date::text = LEFT(l.date::text, 10)
                )`;
    return bookingExists ? `(${timeExists} OR ${bookingExists})` : timeExists;
}

function lineSafetyAllowSql(columns) {
    const bookingExists = bookingExistsSql(columns);
    const timeAbsent = `NOT EXISTS (
                    SELECT 1
                      FROM hr_time_records tr
                     WHERE tr.staff_id = s.id
                       AND tr.record_date::text = LEFT(l.date::text, 10)
                )`;
    return bookingExists ? `(${timeAbsent} AND NOT ${bookingExists})` : timeAbsent;
}

function generatedLineSelectSql(columns, requireSafetyBlock) {
    const lineColumns = columns.lines_by_date;
    const staffColumns = columns.staff;
    const context = contextPieces(lineColumns, 'l');
    const staffBits = staffSelects(staffColumns, 's');
    const risk = staffRiskSql(staffColumns, 's', "LEFT(l.date::text, 10)");
    const lineRowSelect = lineColumns.has('id') ? 'l.id AS line_row_id' : 'NULL AS line_row_id';
    const fromSheetWhere = lineColumns.has('from_sheet') ? 'AND COALESCE(l.from_sheet, false) = true' : '';
    const safetyClause = requireSafetyBlock ? lineSafetyBlockSql(columns) : lineSafetyAllowSql(columns);

    return {
        params: context.params,
        sql: `SELECT ${lineRowSelect},
                     l.line_id,
                     l.line_id::text AS staff_id,
                     LEFT(l.date::text, 10) AS date,
                     ${context.select},
                     s.name AS staff_name,
                     s.is_active,
                     ${staffBits.poolStatus},
                     ${staffBits.terminationDate},
                     ${staffBits.freelance}
                FROM lines_by_date l
                JOIN staff s ON l.line_id::text = s.id::text
               WHERE LEFT(l.date::text, 10) >= $1
                 AND LEFT(l.date::text, 10) <= $2
                 ${context.where}
                 ${fromSheetWhere}
                 AND ${risk}
                 AND ${safetyClause}
               ORDER BY LEFT(l.date::text, 10), s.name, l.line_id`
    };
}

function generatedLineDeleteSql(columns) {
    const lineColumns = columns.lines_by_date;
    const staffColumns = columns.staff;
    const context = contextPieces(lineColumns, 'l');
    const staffBits = staffSelects(staffColumns, 's');
    const risk = staffRiskSql(staffColumns, 's', "LEFT(l.date::text, 10)");
    const lineRowSelect = lineColumns.has('id') ? 'l.id AS line_row_id' : 'NULL AS line_row_id';
    const fromSheetWhere = lineColumns.has('from_sheet') ? 'AND COALESCE(l.from_sheet, false) = true' : '';

    return {
        params: context.params,
        sql: `DELETE FROM lines_by_date l
                    USING staff s
                    WHERE l.line_id::text = s.id::text
                      AND LEFT(l.date::text, 10) >= $1
                      AND LEFT(l.date::text, 10) <= $2
                      ${context.where}
                      ${fromSheetWhere}
                      AND ${risk}
                      AND ${lineSafetyAllowSql(columns)}
                 RETURNING ${lineRowSelect},
                           l.line_id,
                           l.line_id::text AS staff_id,
                           LEFT(l.date::text, 10) AS date,
                           ${context.select},
                           s.name AS staff_name,
                           s.is_active,
                           ${staffBits.poolStatus},
                           ${staffBits.terminationDate},
                           ${staffBits.freelance}`
    };
}

async function runQuery(client, builder, mapper) {
    const query = builder();
    const result = await client.query(query.sql, query.params);
    return result.rows.map(mapper);
}

async function collectScope(client, tables, columns) {
    const targets = {
        staff_schedule: await runQuery(client, () => staffScheduleSelectSql(columns, false), mapScheduleRow),
        hr_shifts: tables.hr_shifts ? await runQuery(client, () => hrShiftSelectSql(columns, false), mapShiftRow) : [],
        lines_by_date: []
    };
    const preserved = {
        staff_schedule_with_time_records: await runQuery(client, () => staffScheduleSelectSql(columns, true), mapScheduleRow),
        hr_shifts_with_time_records: tables.hr_shifts ? await runQuery(client, () => hrShiftSelectSql(columns, true), mapShiftRow) : [],
        generated_lines_with_time_records_or_bookings: []
    };
    const skipped = {};

    if (canTraceGeneratedLines(tables, columns)) {
        targets.lines_by_date = await runQuery(client, () => generatedLineSelectSql(columns, false), mapLineRow);
        preserved.generated_lines_with_time_records_or_bookings = await runQuery(client, () => generatedLineSelectSql(columns, true), mapLineRow);
    } else if (tables.lines_by_date) {
        skipped.lines_by_date = 'generated line cleanup skipped because bookings/from_sheet trace columns are incomplete';
    }

    return {
        targets,
        preserved,
        skipped,
        counts: {
            targets: Object.fromEntries(Object.entries(targets).map(([key, rows]) => [key, rows.length])),
            preserved: Object.fromEntries(Object.entries(preserved).map(([key, rows]) => [key, rows.length]))
        },
        examples: {
            targets: Object.fromEntries(Object.entries(targets).map(([key, rows]) => [key, takeExamples(rows)])),
            preserved: Object.fromEntries(Object.entries(preserved).map(([key, rows]) => [key, takeExamples(rows)]))
        }
    };
}

async function applyCleanup(client, tables, columns) {
    const affected = {
        lines_by_date: canTraceGeneratedLines(tables, columns) ? await runQuery(client, () => generatedLineDeleteSql(columns), mapLineRow) : [],
        hr_shifts: tables.hr_shifts ? await runQuery(client, () => hrShiftDeleteSql(columns), mapShiftRow) : [],
        staff_schedule: await runQuery(client, () => staffScheduleDeleteSql(columns), mapScheduleRow)
    };
    return {
        rows: affected,
        counts: Object.fromEntries(Object.entries(affected).map(([key, rows]) => [key, rows.length]))
    };
}

async function loadSchema(client) {
    const tableNames = [
        'staff_schedule',
        'staff',
        'hr_shifts',
        'hr_time_records',
        'lines_by_date',
        'bookings'
    ];
    const tables = {};
    for (const tableName of tableNames) {
        tables[tableName] = await hasTable(client, tableName);
    }
    if (!tables.staff_schedule || !tables.staff) {
        throw new Error('Required staff_schedule/staff tables are not available.');
    }
    if (!tables.hr_time_records) {
        throw new Error('hr_time_records table is required for safe cleanup.');
    }

    const columns = {};
    for (const tableName of tableNames) {
        columns[tableName] = tables[tableName] ? await tableColumns(client, tableName) : new Set();
    }
    return { tables, columns };
}

function validateArgs() {
    if (APPLY && CONFIRM !== CONFIRM_TOKEN) {
        throw new Error(`Apply mode requires --confirm=${CONFIRM_TOKEN}`);
    }
    if (EFFECTIVE_FROM > TO) {
        throw new Error(`Date range has no future dates: effectiveFrom=${EFFECTIVE_FROM}, to=${TO}`);
    }
    if (!hasDbConfig()) {
        throw new Error('No DATABASE_URL/PGHOST/PGDATABASE/PGUSER found. Configure DB env or .env first.');
    }
}

function output(result) {
    if (JSON_OUTPUT) {
        console.log(JSON.stringify(result, null, 2));
        return;
    }
    console.log(`Staff schedule cleanup ${result.mode}`);
    console.log(`context=${result.context} requestedFrom=${result.requestedFrom} effectiveFrom=${result.effectiveFrom} to=${result.to}`);
    console.log(`targets=${JSON.stringify(result.before.counts.targets)} preserved=${JSON.stringify(result.before.counts.preserved)}`);
    if (result.applied) {
        console.log(`affected=${JSON.stringify(result.applied.counts)} remaining=${JSON.stringify(result.after.counts.targets)}`);
    } else {
        console.log(`dry-run only; pass --apply --confirm=${CONFIRM_TOKEN} to run cleanup`);
    }
    if (Object.keys(result.before.skipped).length) {
        console.log(`skipped=${JSON.stringify(result.before.skipped)}`);
    }
}

async function main() {
    validateArgs();
    const client = await pool.connect();
    try {
        const { tables, columns } = await loadSchema(client);
        if (APPLY) await client.query('BEGIN');
        const before = await collectScope(client, tables, columns);
        const applied = APPLY ? await applyCleanup(client, tables, columns) : null;
        const after = APPLY ? await collectScope(client, tables, columns) : before;
        if (APPLY) await client.query('COMMIT');

        output({
            mode: APPLY ? 'apply' : 'dry-run',
            apply: APPLY,
            confirmRequired: CONFIRM_TOKEN,
            context: CONTEXT,
            requestedFrom: FROM,
            effectiveFrom: EFFECTIVE_FROM,
            to: TO,
            before,
            applied,
            after
        });
    } catch (err) {
        if (APPLY) {
            try {
                await client.query('ROLLBACK');
            } catch (_) {}
        }
        throw err;
    } finally {
        client.release();
    }
}

main()
    .catch(err => {
        console.error(`Staff schedule cleanup failed: ${err.message}`);
        process.exitCode = 1;
    })
    .finally(() => pool.end().catch(() => {}));
