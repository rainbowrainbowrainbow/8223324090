#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_BUSINESS_CONTEXT = 'event_genix';

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

function parseExtraData(value) {
    if (!value) return {};
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value !== 'string') return {};
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function activityIdsFromExtraData(value) {
    const extra = parseExtraData(value);
    const multi = extra.multiActivity || extra.multi_activity || null;
    const ids = multi?.activityIds || multi?.activity_ids;
    return Array.isArray(ids) ? ids.map(id => String(id || '').trim()).filter(Boolean) : [];
}

function primaryIsActivity(row = {}) {
    const category = String(row.primary_category || '').trim().toLowerCase();
    if (['activity', 'animation', 'show', 'quest', 'masterclass', 'pinata', 'photo', 'graduation'].includes(category)) {
        return true;
    }
    if (String(row.primary_line_id || '').trim() === 'banquet-service') return false;
    const hasKitchenData = Boolean(
        String(row.primary_banquet_menu || '').trim()
        || row.primary_banquet_guests != null
        || row.primary_banquet_adults != null
        || row.primary_banquet_tables != null
    );
    if (hasKitchenData) return false;
    return Boolean(
        String(row.primary_program_id || '').trim()
        || String(row.primary_program_code || '').trim()
        || String(row.primary_program_name || '').trim()
        || Number(row.primary_price || 0) > 0
    );
}

function multisetDifference(left = [], right = []) {
    const remaining = new Map();
    for (const value of right) remaining.set(value, (remaining.get(value) || 0) + 1);
    const difference = [];
    for (const value of left) {
        const count = remaining.get(value) || 0;
        if (count > 0) remaining.set(value, count - 1);
        else difference.push(value);
    }
    return difference;
}

function arraysEqual(left = [], right = []) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function buildBanquetActivityConsistencyReport(rows = [], businessContext = DEFAULT_BUSINESS_CONTEXT) {
    const groups = new Map();
    for (const row of rows) {
        const groupId = String(row.group_id || '').trim();
        const primaryBookingId = String(row.primary_booking_id || '').trim();
        if (!groupId || !primaryBookingId) continue;
        if (!groups.has(groupId)) {
            groups.set(groupId, {
                groupId,
                primaryBookingId,
                primaryRow: row,
                activityMembers: []
            });
        }
        if (String(row.member_role || '').trim().toLowerCase() === 'activity') {
            groups.get(groupId).activityMembers.push({
                bookingId: String(row.member_booking_id || '').trim(),
                programId: String(row.member_program_id || '').trim(),
                sortOrder: Number(row.member_sort_order || 0)
            });
        }
    }

    const mismatches = [];
    for (const group of groups.values()) {
        group.activityMembers.sort((left, right) => left.sortOrder - right.sortOrder || left.bookingId.localeCompare(right.bookingId));
        const canonicalActivityIds = [];
        if (primaryIsActivity(group.primaryRow)) {
            const primaryProgramId = String(group.primaryRow.primary_program_id || '').trim();
            if (primaryProgramId) canonicalActivityIds.push(primaryProgramId);
        }
        canonicalActivityIds.push(...group.activityMembers.map(member => member.programId).filter(Boolean));
        const expectedExtraActivityIds = canonicalActivityIds.length > 1 ? canonicalActivityIds : [];
        const extraActivityIds = activityIdsFromExtraData(group.primaryRow.primary_extra_data);
        const missingActivityIds = multisetDifference(expectedExtraActivityIds, extraActivityIds);
        const unexpectedActivityIds = multisetDifference(extraActivityIds, expectedExtraActivityIds);
        const orderMismatch = missingActivityIds.length === 0
            && unexpectedActivityIds.length === 0
            && !arraysEqual(expectedExtraActivityIds, extraActivityIds);
        if (!missingActivityIds.length && !unexpectedActivityIds.length && !orderMismatch) continue;
        mismatches.push({
            groupId: group.groupId,
            primaryBookingId: group.primaryBookingId,
            activityBookingIds: group.activityMembers.map(member => member.bookingId).filter(Boolean),
            membershipActivityCount: canonicalActivityIds.length,
            extraActivityCount: extraActivityIds.length,
            missingActivityCount: missingActivityIds.length,
            unexpectedActivityCount: unexpectedActivityIds.length,
            orderMismatch
        });
    }

    return {
        readOnly: true,
        businessContext,
        summary: {
            groupsScanned: groups.size,
            consistentGroups: groups.size - mismatches.length,
            mismatchedGroups: mismatches.length,
            missingActivityReferences: mismatches.reduce((sum, item) => sum + item.missingActivityCount, 0),
            unexpectedActivityReferences: mismatches.reduce((sum, item) => sum + item.unexpectedActivityCount, 0),
            orderMismatches: mismatches.filter(item => item.orderMismatch).length
        },
        mismatches
    };
}

async function loadBanquetActivityConsistencyRows(db, businessContext = DEFAULT_BUSINESS_CONTEXT) {
    const result = await db.query(
        `SELECT bg.id AS group_id,
                bg.primary_booking_id,
                pb.program_id AS primary_program_id,
                pb.program_code AS primary_program_code,
                pb.program_name AS primary_program_name,
                pb.category AS primary_category,
                pb.line_id AS primary_line_id,
                pb.price AS primary_price,
                pb.banquet_menu AS primary_banquet_menu,
                pb.banquet_guests AS primary_banquet_guests,
                pb.banquet_adults AS primary_banquet_adults,
                pb.banquet_tables AS primary_banquet_tables,
                pb.extra_data AS primary_extra_data,
                bgb.role AS member_role,
                bgb.booking_id AS member_booking_id,
                bgb.sort_order AS member_sort_order,
                member.program_id AS member_program_id
           FROM banquet_groups bg
           JOIN bookings pb
             ON pb.id = bg.primary_booking_id
            AND COALESCE(pb.business_context, $1) = $1
           LEFT JOIN banquet_group_bookings bgb
             ON bgb.group_id = bg.id
            AND COALESCE(bgb.business_context, $1) = $1
           LEFT JOIN bookings member
             ON member.id = bgb.booking_id
            AND COALESCE(member.business_context, $1) = $1
          WHERE COALESCE(bg.business_context, $1) = $1
            AND COALESCE(bg.status, 'active') <> 'cancelled'
            AND bg.primary_booking_id IS NOT NULL
          ORDER BY bg.id, bgb.sort_order, bgb.booking_id`,
        [businessContext]
    );
    return result.rows || [];
}

async function auditBanquetActivityConsistency({ db, businessContext = DEFAULT_BUSINESS_CONTEXT } = {}) {
    if (!db || typeof db.query !== 'function') throw new Error('Database query interface is required');
    const rows = await loadBanquetActivityConsistencyRows(db, businessContext);
    return buildBanquetActivityConsistencyReport(rows, businessContext);
}

function printSummary(report) {
    const summary = report.summary || {};
    console.log('Banquet activity consistency audit (read-only)');
    console.log(`Business context: ${report.businessContext}`);
    console.log(`Groups scanned: ${summary.groupsScanned || 0}`);
    console.log(`Mismatched groups: ${summary.mismatchedGroups || 0}`);
    console.log(`Missing activity references: ${summary.missingActivityReferences || 0}`);
    console.log(`Unexpected activity references: ${summary.unexpectedActivityReferences || 0}`);
    for (const item of report.mismatches || []) {
        console.log(
            `group=${item.groupId} primary=${item.primaryBookingId} activityBookings=${item.activityBookingIds.join(',') || '-'} `
            + `membership=${item.membershipActivityCount} extra=${item.extraActivityCount} `
            + `missing=${item.missingActivityCount} unexpected=${item.unexpectedActivityCount} orderMismatch=${item.orderMismatch ? 'yes' : 'no'}`
        );
    }
}

async function main(argv = process.argv.slice(2)) {
    loadEnvFile();
    const businessContext = argValue(argv, '--business-context', argValue(argv, '--context', DEFAULT_BUSINESS_CONTEXT));
    const { pool } = require('../db');
    const client = await pool.connect();
    try {
        await client.query('BEGIN TRANSACTION READ ONLY');
        const report = await auditBanquetActivityConsistency({ db: client, businessContext });
        await client.query('ROLLBACK');
        if (argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
        else printSummary(report);
        if (argv.includes('--strict') && report.summary.mismatchedGroups > 0) process.exitCode = 1;
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
        console.error(`Banquet activity consistency audit failed: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    activityIdsFromExtraData,
    argValue,
    auditBanquetActivityConsistency,
    buildBanquetActivityConsistencyReport,
    loadBanquetActivityConsistencyRows,
    main,
    printSummary
};
