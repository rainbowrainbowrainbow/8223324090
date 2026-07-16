#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
    auditBanquetActivityConsistency
} = require('./audit-banquet-activity-consistency');
const {
    persistDerivedBookingSetMetadata
} = require('../services/banquetGroups');

const DEFAULT_BUSINESS_CONTEXT = 'event_genix';
const APPLY_CONFIRMATION = 'REPAIR_BANQUET_ACTIVITY_METADATA';
const REPAIR_ACTOR = 'banquet-activity-metadata-repair';

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

function uniqueTechnicalIds(values = []) {
    return [...new Set(values
        .flatMap(value => String(value || '').split(','))
        .map(value => value.trim())
        .filter(Boolean))];
}

function parseExtraData(value) {
    if (!value) return {};
    if (typeof value === 'object' && !Array.isArray(value)) return { ...value };
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function bookingIsActive(row = {}) {
    return String(row.status || 'confirmed').trim().toLowerCase() !== 'cancelled';
}

function parseArgs(argv = process.argv.slice(2)) {
    const flags = new Set(argv.filter(arg => arg.startsWith('--') && !arg.includes('=')));
    const groupValues = argv
        .filter(arg => arg.startsWith('--group='))
        .map(arg => arg.slice('--group='.length));
    const groupsValue = argValue(argv, '--groups', '');
    return {
        apply: flags.has('--apply'),
        json: flags.has('--json'),
        businessContext: String(
            argValue(argv, '--business-context', argValue(argv, '--context', DEFAULT_BUSINESS_CONTEXT))
                || DEFAULT_BUSINESS_CONTEXT
        ).trim() || DEFAULT_BUSINESS_CONTEXT,
        confirmation: String(argValue(argv, '--confirm', '') || '').trim(),
        groupIds: uniqueTechnicalIds([...groupValues, groupsValue])
    };
}

function validateApplyOptions(options = {}) {
    if (!options.apply) return;
    if (options.confirmation !== APPLY_CONFIRMATION) {
        throw new Error(`Apply requires --confirm=${APPLY_CONFIRMATION}`);
    }
    if (!Array.isArray(options.groupIds) || options.groupIds.length === 0) {
        throw new Error('Apply requires an explicit --groups=<group-id,...> allowlist');
    }
}

function selectReportItems(report = {}, groupIds = []) {
    const allowlist = new Set((groupIds || []).map(String));
    const mismatches = Array.isArray(report.mismatches) ? report.mismatches : [];
    return allowlist.size
        ? mismatches.filter(item => allowlist.has(String(item.groupId)))
        : mismatches;
}

async function loadTechnicalDiagnostics(db, groupIds, businessContext) {
    if (!Array.isArray(groupIds) || groupIds.length === 0) return [];
    const result = await db.query(
        `SELECT bg.id AS group_id,
                bg.status AS group_status,
                bg.primary_booking_id,
                pb.status AS primary_status,
                pb.program_id AS primary_program_id,
                bgb.booking_id AS member_booking_id,
                bgb.role AS member_role,
                bgb.sort_order AS member_sort_order,
                member.status AS member_status,
                member.program_id AS member_program_id
           FROM banquet_groups bg
           LEFT JOIN bookings pb
             ON pb.id = bg.primary_booking_id
            AND COALESCE(NULLIF(BTRIM(pb.business_context), ''), $2) = $2
           LEFT JOIN banquet_group_bookings bgb
             ON bgb.group_id = bg.id
            AND COALESCE(NULLIF(BTRIM(bgb.business_context), ''), $2) = $2
           LEFT JOIN bookings member
             ON member.id = bgb.booking_id
            AND COALESCE(NULLIF(BTRIM(member.business_context), ''), $2) = $2
          WHERE bg.id = ANY($1::text[])
            AND COALESCE(NULLIF(BTRIM(bg.business_context), ''), $2) = $2
          ORDER BY bg.id, bgb.sort_order, bgb.id`,
        [groupIds, businessContext]
    );
    return result.rows || [];
}

async function lockRepairTargets(db, groupIds, businessContext) {
    const groupsResult = await db.query(
        `SELECT bg.*
           FROM banquet_groups bg
          WHERE bg.id = ANY($1::text[])
            AND COALESCE(NULLIF(BTRIM(bg.business_context), ''), $2) = $2
            AND COALESCE(bg.status, 'active') <> 'cancelled'
          ORDER BY bg.id
          FOR UPDATE`,
        [groupIds, businessContext]
    );
    const groups = groupsResult.rows || [];
    const foundIds = new Set(groups.map(row => String(row.id)));
    const missingIds = groupIds.filter(id => !foundIds.has(String(id)));
    if (missingIds.length) {
        throw new Error(`Repair target groups not found or inactive: ${missingIds.join(',')}`);
    }

    const membershipsResult = await db.query(
        `SELECT bgb.*
           FROM banquet_group_bookings bgb
          WHERE bgb.group_id = ANY($1::text[])
            AND COALESCE(NULLIF(BTRIM(bgb.business_context), ''), $2) = $2
          ORDER BY bgb.group_id, bgb.sort_order, bgb.id
          FOR UPDATE`,
        [groupIds, businessContext]
    );
    const memberships = membershipsResult.rows || [];
    const bookingIds = uniqueTechnicalIds([
        ...groups.map(row => row.primary_booking_id),
        ...memberships.map(row => row.booking_id)
    ]);
    let bookingRows = [];
    if (bookingIds.length) {
        const bookingsResult = await db.query(
            `SELECT b.*
               FROM bookings b
              WHERE b.id = ANY($1::text[])
                AND COALESCE(NULLIF(BTRIM(b.business_context), ''), $2) = $2
              ORDER BY b.id
              FOR UPDATE`,
            [bookingIds, businessContext]
        );
        bookingRows = bookingsResult.rows || [];
        const lockedIds = new Set(bookingRows.map(row => String(row.id)));
        const missingBookingIds = bookingIds.filter(id => !lockedIds.has(String(id)));
        if (missingBookingIds.length) {
            throw new Error(`Repair target bookings not found: ${missingBookingIds.join(',')}`);
        }
    }
    return { groups, memberships, bookingIds, bookings: bookingRows };
}

async function clearDetachedBookingMetadata(db, bookingRow, businessContext) {
    if (!bookingRow?.id) return;
    const extraData = parseExtraData(bookingRow.extra_data ?? bookingRow.extraData);
    delete extraData.multiActivity;
    delete extraData.multi_activity;
    delete extraData.banquetGroup;
    delete extraData.banquet_group;
    await db.query(
        `UPDATE bookings
            SET extra_data = $1,
                updated_at = NOW()
          WHERE id = $2
            AND COALESCE(NULLIF(BTRIM(business_context), ''), $3) = $3`,
        [JSON.stringify(extraData), bookingRow.id, businessContext]
    );
}

async function prepareGroupLifecycleForRepair(db, group, locked, businessContext) {
    const memberships = locked.memberships.filter(row => String(row.group_id) === String(group.id));
    const rowById = new Map(locked.bookings.map(row => [String(row.id), row]));
    const memberRows = memberships.map(row => rowById.get(String(row.booking_id))).filter(Boolean);
    const activeRows = memberRows.filter(bookingIsActive);
    const primaryRow = rowById.get(String(group.primary_booking_id)) || null;

    if (activeRows.length === 0) {
        await db.query(
            `UPDATE banquet_groups
                SET status = 'cancelled',
                    updated_at = NOW(),
                    updated_by = $3
              WHERE id = $1
                AND COALESCE(NULLIF(BTRIM(business_context), ''), $2) = $2`,
            [group.id, businessContext, REPAIR_ACTOR]
        );
        await db.query(
            `INSERT INTO history (business_context, action, username, data)
             VALUES ($1, $2, $3, $4::jsonb)`,
            [businessContext, 'banquet_group_cancelled_by_repair', REPAIR_ACTOR, JSON.stringify({
                group_id: group.id,
                primary_booking_id: group.primary_booking_id,
                reason: 'all_group_bookings_cancelled',
                business_context: businessContext
            })]
        );
        return { action: 'cancelled_group', group: { ...group, status: 'cancelled' } };
    }

    if (primaryRow && bookingIsActive(primaryRow)) {
        return { action: 'metadata_only', group };
    }

    const activeMemberships = memberships.filter(row => bookingIsActive(rowById.get(String(row.booking_id)) || {}));
    if (activeMemberships.length !== 1) {
        throw new Error(
            `Inactive primary requires manual repair: group=${group.id} activeMembers=${activeMemberships.length}`
        );
    }
    const promotedMembership = activeMemberships[0];
    const promotedBooking = rowById.get(String(promotedMembership.booking_id));
    if (!promotedBooking) {
        throw new Error(`Promotion target booking not found: group=${group.id}`);
    }
    const oldPrimaryId = String(group.primary_booking_id || '');
    await db.query(
        `DELETE FROM banquet_group_bookings
          WHERE group_id = $1
            AND booking_id = $2
            AND COALESCE(NULLIF(BTRIM(business_context), ''), $3) = $3`,
        [group.id, oldPrimaryId, businessContext]
    );
    await db.query(
        `UPDATE banquet_group_bookings
            SET role = 'primary',
                updated_at = NOW()
          WHERE group_id = $1
            AND booking_id = $2
            AND COALESCE(NULLIF(BTRIM(business_context), ''), $3) = $3`,
        [group.id, promotedBooking.id, businessContext]
    );
    await db.query(
        `UPDATE banquet_groups
            SET primary_booking_id = $4,
                status = 'active',
                updated_at = NOW(),
                updated_by = $3
          WHERE id = $1
            AND COALESCE(NULLIF(BTRIM(business_context), ''), $2) = $2`,
        [group.id, businessContext, REPAIR_ACTOR, promotedBooking.id]
    );
    await db.query(
        `DELETE FROM booking_banquet_links
          WHERE business_context = $1
            AND relation_type = 'banquet_activity'
            AND (booking_a_id = $2 OR booking_b_id = $2)`,
        [businessContext, oldPrimaryId]
    );
    await clearDetachedBookingMetadata(db, primaryRow, businessContext);
    await db.query(
        `INSERT INTO history (business_context, action, username, data)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [businessContext, 'banquet_primary_promoted_by_repair', REPAIR_ACTOR, JSON.stringify({
            group_id: group.id,
            previous_primary_booking_id: oldPrimaryId,
            primary_booking_id: promotedBooking.id,
            detached_booking_id: oldPrimaryId,
            reason: 'previous_primary_cancelled_single_active_member',
            business_context: businessContext
        })]
    );
    return {
        action: 'promoted_primary',
        previousPrimaryBookingId: oldPrimaryId,
        group: { ...group, primary_booking_id: promotedBooking.id, status: 'active' }
    };
}

async function persistPrimaryDerivedMetadata(db, group, businessContext, derived, source = REPAIR_ACTOR) {
    const result = await db.query(
        `SELECT b.*
           FROM bookings b
          WHERE b.id = $1
            AND COALESCE(NULLIF(BTRIM(b.business_context), ''), $2) = $2
            AND LOWER(COALESCE(NULLIF(BTRIM(b.status), ''), 'confirmed')) <> 'cancelled'
          FOR UPDATE`,
        [group.primary_booking_id, businessContext]
    );
    const primary = result.rows?.[0] || null;
    if (!primary) throw new Error(`Active primary booking not found: group=${group.id}`);
    const extraData = parseExtraData(primary.extra_data ?? primary.extraData);
    if (derived.activityIds.length > 1) {
        extraData.multiActivity = {
            schemaVersion: 1,
            role: 'primary',
            activityIndex: 1,
            activityCount: derived.activityIds.length,
            activityIds: derived.activityIds,
            totalDuration: derived.totalDuration,
            totalPrice: derived.totalPrice,
            schedule: derived.schedule,
            source
        };
    } else {
        delete extraData.multiActivity;
    }
    delete extraData.multi_activity;
    extraData.banquetGroup = {
        ...(extraData.banquetGroup || extraData.banquet_group || {}),
        groupId: group.id,
        sourceBookingId: group.primary_booking_id,
        role: 'primary',
        source
    };
    delete extraData.banquet_group;
    await db.query(
        `UPDATE bookings
            SET extra_data = $1,
                updated_at = NOW()
          WHERE id = $2
            AND COALESCE(NULLIF(BTRIM(business_context), ''), $3) = $3`,
        [JSON.stringify(extraData), primary.id, businessContext]
    );
}

async function recordRepairHistory(db, businessContext, item, derived) {
    await db.query(
        `INSERT INTO history (business_context, action, username, data)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [
            businessContext,
            'banquet_activity_metadata_repaired',
            REPAIR_ACTOR,
            JSON.stringify({
                group_id: item.groupId,
                primary_booking_id: item.primaryBookingId,
                activity_booking_ids: item.activityBookingIds,
                previous_membership_activity_count: item.membershipActivityCount,
                previous_extra_activity_count: item.extraActivityCount,
                repaired_activity_ids_count: derived.activityIds.length,
                source: REPAIR_ACTOR,
                business_context: businessContext
            })
        ]
    );
}

async function runDryRun(db, options = {}) {
    await db.query('BEGIN TRANSACTION READ ONLY');
    try {
        const report = await auditBanquetActivityConsistency({
            db,
            businessContext: options.businessContext || DEFAULT_BUSINESS_CONTEXT
        });
        const diagnostics = await loadTechnicalDiagnostics(
            db,
            options.groupIds,
            options.businessContext || DEFAULT_BUSINESS_CONTEXT
        );
        await db.query('ROLLBACK');
        return {
            mode: 'dry-run',
            report,
            selectedMismatches: selectReportItems(report, options.groupIds),
            diagnostics
        };
    } catch (error) {
        await db.query('ROLLBACK').catch(() => {});
        throw error;
    }
}

async function runApply(db, options = {}, dependencies = {}) {
    validateApplyOptions(options);
    const persistDerived = dependencies.persistDerivedBookingSetMetadata || persistDerivedBookingSetMetadata;
    const persistPrimary = dependencies.persistPrimaryDerivedMetadata || persistPrimaryDerivedMetadata;
    const businessContext = options.businessContext || DEFAULT_BUSINESS_CONTEXT;
    await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    try {
        const locked = await lockRepairTargets(db, options.groupIds, businessContext);
        const before = await auditBanquetActivityConsistency({ db, businessContext });
        const selectedMismatches = selectReportItems(before, options.groupIds);
        const mismatchByGroupId = new Map(selectedMismatches.map(item => [String(item.groupId), item]));
        const repaired = [];
        const alreadyConsistent = [];
        const derivedActivityCountByGroupId = new Map();

        for (const group of locked.groups) {
            const item = mismatchByGroupId.get(String(group.id));
            if (!item) {
                alreadyConsistent.push(String(group.id));
                continue;
            }
            const lifecycle = await prepareGroupLifecycleForRepair(db, group, locked, businessContext);
            if (lifecycle.action === 'cancelled_group') {
                repaired.push({
                    groupId: item.groupId,
                    primaryBookingId: item.primaryBookingId,
                    activityBookingIds: item.activityBookingIds,
                    previousExtraActivityCount: item.extraActivityCount,
                    repairedActivityCount: 0,
                    lifecycleAction: lifecycle.action
                });
                continue;
            }
            const repairGroup = lifecycle.group;
            const derived = await persistDerived(db, repairGroup, businessContext, {
                source: REPAIR_ACTOR
            });
            await persistPrimary(db, repairGroup, businessContext, derived, REPAIR_ACTOR);
            derivedActivityCountByGroupId.set(String(group.id), derived.activityIds.length);
            await db.query(
                `UPDATE banquet_groups
                    SET updated_at = NOW(),
                        updated_by = $3
                  WHERE id = $1
                    AND COALESCE(NULLIF(BTRIM(business_context), ''), $2) = $2`,
                [repairGroup.id, businessContext, REPAIR_ACTOR]
            );
            await recordRepairHistory(db, businessContext, item, derived);
            repaired.push({
                groupId: item.groupId,
                primaryBookingId: item.primaryBookingId,
                activityBookingIds: item.activityBookingIds,
                previousExtraActivityCount: item.extraActivityCount,
                repairedActivityCount: derived.activityIds.length,
                lifecycleAction: lifecycle.action
            });
        }

        const after = await auditBanquetActivityConsistency({ db, businessContext });
        const remainingSelected = selectReportItems(after, options.groupIds);
        if (remainingSelected.length) {
            const details = remainingSelected.map(item => (
                `${item.groupId}(derived=${derivedActivityCountByGroupId.get(String(item.groupId)) ?? '-'},`
                + `membership=${item.membershipActivityCount},extra=${item.extraActivityCount})`
            ));
            throw new Error(`Post-repair audit still reports mismatches: ${details.join(',')}`);
        }
        await db.query('COMMIT');
        return {
            mode: 'apply',
            repaired,
            alreadyConsistent,
            beforeSummary: before.summary,
            afterSummary: after.summary
        };
    } catch (error) {
        await db.query('ROLLBACK').catch(() => {});
        throw error;
    }
}

function printResult(result, options = {}) {
    if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
    }
    if (result.mode === 'dry-run') {
        console.log('Banquet activity metadata repair (dry-run, read-only)');
        console.log(`Business context: ${result.report.businessContext}`);
        console.log(`Current mismatched groups: ${result.report.summary.mismatchedGroups}`);
        console.log(`Selected mismatched groups: ${result.selectedMismatches.length}`);
        for (const item of result.selectedMismatches) {
            console.log(
                `group=${item.groupId} primary=${item.primaryBookingId} activityBookings=${item.activityBookingIds.join(',') || '-'} `
                + `membership=${item.membershipActivityCount} extra=${item.extraActivityCount}`
            );
        }
        for (const row of result.diagnostics || []) {
            console.log(
                `diagnostic group=${row.group_id} groupStatus=${row.group_status || '-'} primary=${row.primary_booking_id || '-'} `
                + `primaryStatus=${row.primary_status || '-'} primaryProgram=${row.primary_program_id || '-'} `
                + `member=${row.member_booking_id || '-'} role=${row.member_role || '-'} `
                + `memberStatus=${row.member_status || '-'} memberProgram=${row.member_program_id || '-'}`
            );
        }
        console.log(`dry-run only: use --apply --confirm=${APPLY_CONFIRMATION} with an explicit --groups allowlist.`);
        return;
    }
    console.log('Banquet activity metadata repair (APPLY)');
    console.log(`Repaired groups: ${result.repaired.length}`);
    console.log(`Already consistent: ${result.alreadyConsistent.length}`);
    console.log(`Remaining mismatched groups: ${result.afterSummary.mismatchedGroups}`);
    for (const item of result.repaired) {
        console.log(
            `repaired group=${item.groupId} primary=${item.primaryBookingId} activityBookings=${item.activityBookingIds.join(',') || '-'} `
            + `previousExtra=${item.previousExtraActivityCount} repairedActivities=${item.repairedActivityCount}`
        );
    }
}

async function main(argv = process.argv.slice(2)) {
    loadEnvFile();
    const options = parseArgs(argv);
    validateApplyOptions(options);
    const { pool } = require('../db');
    const client = await pool.connect();
    try {
        const result = options.apply
            ? await runApply(client, options)
            : await runDryRun(client, options);
        printResult(result, options);
        return result;
    } finally {
        client.release();
        await pool.end().catch(() => {});
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error(`Banquet activity metadata repair failed: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    APPLY_CONFIRMATION,
    argValue,
    lockRepairTargets,
    loadTechnicalDiagnostics,
    main,
    parseArgs,
    printResult,
    prepareGroupLifecycleForRepair,
    persistPrimaryDerivedMetadata,
    runApply,
    runDryRun,
    selectReportItems,
    uniqueTechnicalIds,
    validateApplyOptions
};
