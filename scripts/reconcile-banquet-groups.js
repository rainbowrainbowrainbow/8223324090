#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
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

loadEnvFile();

const { pool } = require('../db');
const { BANQUET_SERVICE_LINE_ID } = require('../services/booking');
const { DEFAULT_TIMELINE_CONTEXT } = require('../services/timelineContext');
const { reconcileBanquetGroupForBooking } = require('../services/banquetGroups');

const SCRIPT_USER = Object.freeze({
    id: null,
    username: 'banquet-repair-script',
    name: 'Banquet repair script',
    role: 'system'
});

function argValue(args, name, fallback = null) {
    const exact = args.find(arg => arg.startsWith(`${name}=`));
    if (exact) return exact.slice(name.length + 1);
    const index = args.indexOf(name);
    if (index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')) return args[index + 1];
    return fallback;
}

function parseArgs(argv = process.argv.slice(2)) {
    const flags = new Set(argv.filter(arg => arg.startsWith('--') && !arg.includes('=')));
    const from = argValue(argv, '--from');
    const to = argValue(argv, '--to', from);
    const context = argValue(argv, '--context', argValue(argv, '--business-context', DEFAULT_TIMELINE_CONTEXT));
    const limit = Math.max(0, parseInt(argValue(argv, '--limit', '0'), 10) || 0);
    return {
        from,
        to,
        context: String(context || DEFAULT_TIMELINE_CONTEXT).trim() || DEFAULT_TIMELINE_CONTEXT,
        allContexts: String(context || '').trim().toLowerCase() === 'all',
        limit,
        apply: flags.has('--apply'),
        json: flags.has('--json')
    };
}

function validateDateArg(value, name) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
        throw new Error(`${name} must be YYYY-MM-DD`);
    }
}

function parseExtraData(row = {}) {
    const raw = row.extra_data ?? row.extraData;
    if (!raw) return {};
    if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
    try {
        return JSON.parse(raw) || {};
    } catch {
        return {};
    }
}

function bookingPackageFromRow(row = {}) {
    const extra = parseExtraData(row);
    return row.bookingPackage
        || row.booking_package
        || extra.bookingPackage
        || extra.booking_package
        || {};
}

function packageArray(bookingPackage, camelKey, snakeKey) {
    return bookingPackage?.[camelKey] || bookingPackage?.[snakeKey] || [];
}

function menuPositionCount(row = {}) {
    const positions = packageArray(bookingPackageFromRow(row), 'menuPositions', 'menu_positions');
    return Array.isArray(positions) ? positions.length : 0;
}

function bookingPackageHasBanquetData(row = {}) {
    const bookingPackage = bookingPackageFromRow(row);
    if (!bookingPackage || typeof bookingPackage !== 'object') return false;
    const positions = packageArray(bookingPackage, 'menuPositions', 'menu_positions');
    const serviceEvents = packageArray(bookingPackage, 'serviceEvents', 'service_events');
    return (Array.isArray(positions) && positions.length > 0)
        || (Array.isArray(serviceEvents) && serviceEvents.length > 0);
}

function isKitchenCandidate(row = {}) {
    return menuPositionCount(row) > 0
        || Boolean(String(row.banquet_menu || row.banquetMenu || '').trim())
        || row.banquet_guests != null
        || row.banquetGuests != null
        || row.banquet_adults != null
        || row.banquetAdults != null
        || row.banquet_tables != null
        || row.banquetTables != null;
}

function cleanId(value) {
    const id = String(value || '').trim();
    return id || null;
}

function normalizeRole(value) {
    const role = String(value || 'manual').trim().toLowerCase();
    return role || 'manual';
}

function isRootBooking(row = {}) {
    return !String(row.linked_to || row.linkedTo || '').trim();
}

function isActiveBookingRow(row = {}) {
    return String(row.status || 'confirmed').trim().toLowerCase() !== 'cancelled';
}

function isBanquetServiceLine(row = {}) {
    return cleanId(row.line_id || row.lineId) === BANQUET_SERVICE_LINE_ID;
}

function normalizedBookingCategory(row = {}) {
    return String(row.category || row.bookingCategory || '').trim().toLowerCase();
}

function hasActivityCategory(row = {}) {
    return ['activity', 'animation', 'show', 'quest', 'masterclass', 'pinata', 'photo', 'graduation']
        .includes(normalizedBookingCategory(row));
}

function hasActivityProgramSignal(row = {}) {
    return Boolean(
        row.program_id
        || row.programId
        || String(row.program_name || row.programName || '').trim()
        || String(row.program_code || row.programCode || '').trim()
        || Number(row.price || 0) > 0
    );
}

function textMatchesBanquetIdentity(row = {}) {
    const text = [
        row.category,
        row.label,
        row.program_name,
        row.programName,
        row.program_code,
        row.programCode,
        row.group_name,
        row.groupName
    ].map(value => String(value || '').trim().toLowerCase()).filter(Boolean).join(' ');
    return /\b(banquet|kitchen)\b|банкет|кух/i.test(text);
}

function isBanquetAnchor(row = {}) {
    return isRootBooking(row)
        && isActiveBookingRow(row)
        && (
            isBanquetServiceLine(row)
            || isKitchenCandidate(row)
            || bookingPackageHasBanquetData(row)
            || normalizedBookingCategory(row) === 'banquet'
            || textMatchesBanquetIdentity(row)
        );
}

function isBanquetActivityCandidate(row = {}) {
    if (isBanquetServiceLine(row)) return false;
    if (hasActivityCategory(row)) return true;
    if (isKitchenCandidate(row)) return false;
    return hasActivityProgramSignal(row);
}

function timeKey(row = {}) {
    return `${row.date || ''} ${row.time || ''} ${row.id || ''}`;
}

function selectPrimary(candidates = []) {
    const roots = candidates.filter(row => isRootBooking(row) && isActiveBookingRow(row));
    const byTime = [...roots].sort((a, b) => timeKey(a).localeCompare(timeKey(b)));
    return byTime.find(isBanquetServiceLine)
        || byTime.find(isKitchenCandidate)
        || byTime.find(bookingPackageHasBanquetData)
        || byTime.find(row => normalizedBookingCategory(row) === 'banquet')
        || byTime.find(isBanquetAnchor)
        || null;
}

function roleFor(row = {}, primaryBookingId = null) {
    if (cleanId(row.id) === cleanId(primaryBookingId)) return 'primary';
    if (isBanquetActivityCandidate(row)) return 'activity';
    if (isKitchenCandidate(row) || bookingPackageHasBanquetData(row)) return 'kitchen';
    if (isBanquetServiceLine(row)) return 'service';
    return 'manual';
}

function hashCustomerId(value) {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 10);
}

function groupKey(row = {}) {
    return [
        row.business_context || DEFAULT_TIMELINE_CONTEXT,
        row.date,
        String(row.room || '').trim(),
        String(row.customer_id || '')
    ].join('\u0001');
}

function groupRows(rows) {
    const groups = new Map();
    for (const row of rows) {
        const key = groupKey(row);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    }
    return [...groups.values()];
}

async function loadCandidateRows(db, options) {
    const params = [options.from, options.to];
    const contextFilter = options.allContexts
        ? ''
        : `AND COALESCE(NULLIF(BTRIM(b.business_context), ''), '${DEFAULT_TIMELINE_CONTEXT}') = $3`;
    if (!options.allContexts) params.push(options.context);

    const limitSql = options.limit > 0 ? `LIMIT ${options.limit}` : '';
    const result = await db.query(
        `SELECT b.id,
                COALESCE(NULLIF(BTRIM(b.business_context), ''), '${DEFAULT_TIMELINE_CONTEXT}') AS business_context,
                b.date, b.time, b.line_id, b.program_id, b.program_code, b.label, b.program_name, b.category,
                b.duration, b.price, b.room, b.linked_to, b.status, b.group_name, b.extra_data,
                b.customer_id, b.banquet_guests, b.banquet_adults, b.banquet_tables, b.banquet_menu
           FROM bookings b
          WHERE b.date >= $1
            AND b.date <= $2
            ${contextFilter}
            AND LOWER(COALESCE(NULLIF(BTRIM(b.status), ''), 'confirmed')) != 'cancelled'
            AND NULLIF(COALESCE(b.linked_to, ''), '') IS NULL
            AND b.customer_id IS NOT NULL
            AND NULLIF(BTRIM(COALESCE(b.room, '')), '') IS NOT NULL
          ORDER BY business_context ASC, b.date ASC, b.room ASC, b.customer_id ASC, b.time ASC, b.id ASC
          ${limitSql}`,
        params
    );
    return result.rows || [];
}

async function loadMembershipRows(db, bookingIds, context, allContexts) {
    const uniqueIds = [...new Set((bookingIds || []).map(cleanId).filter(Boolean))];
    if (!uniqueIds.length) return [];
    const params = [uniqueIds];
    const contextFilter = allContexts
        ? ''
        : `AND COALESCE(NULLIF(BTRIM(bgb.business_context), ''), '${DEFAULT_TIMELINE_CONTEXT}') = $2
           AND COALESCE(NULLIF(BTRIM(bg.business_context), ''), '${DEFAULT_TIMELINE_CONTEXT}') = $2`;
    if (!allContexts) params.push(context || DEFAULT_TIMELINE_CONTEXT);
    const result = await db.query(
        `SELECT bgb.booking_id, bgb.group_id, bgb.role, bg.primary_booking_id, bg.status AS group_status
           FROM banquet_group_bookings bgb
           JOIN banquet_groups bg ON bg.id = bgb.group_id
          WHERE bgb.booking_id = ANY($1::text[])
            ${contextFilter}`,
        params
    );
    return result.rows || [];
}

function buildPlan(rows, memberships) {
    const membershipByBookingId = new Map(memberships.map(row => [String(row.booking_id), row]));
    const proposed = [];
    const skipped = [];

    for (const candidates of groupRows(rows)) {
        if (candidates.length < 2) continue;
        const sorted = [...candidates].sort((a, b) => timeKey(a).localeCompare(timeKey(b)));
        const anchorExists = sorted.some(isBanquetAnchor);
        const first = sorted[0];
        const base = {
            businessContext: first.business_context || DEFAULT_TIMELINE_CONTEXT,
            date: first.date,
            room: String(first.room || '').trim(),
            customerHash: hashCustomerId(first.customer_id),
            bookingIds: sorted.map(row => row.id)
        };

        if (!anchorExists) {
            skipped.push({ ...base, reason: 'missing_banquet_anchor' });
            continue;
        }

        const groupIds = [...new Set(sorted
            .map(row => membershipByBookingId.get(String(row.id))?.group_id)
            .filter(Boolean)
            .map(String))];
        if (groupIds.length > 1) {
            skipped.push({ ...base, reason: 'multiple_existing_groups', existingGroupIds: groupIds });
            continue;
        }

        const existingGroupId = groupIds[0] || null;
        const primary = existingGroupId
            ? sorted.find(row => cleanId(row.id) === cleanId(membershipByBookingId.get(String(row.id))?.primary_booking_id))
            : selectPrimary(sorted);
        if (!primary) {
            skipped.push({ ...base, reason: 'primary_anchor_not_found', existingGroupId });
            continue;
        }

        const roles = sorted.map(row => {
            const membership = membershipByBookingId.get(String(row.id)) || null;
            return {
                bookingId: row.id,
                role: roleFor(row, primary.id),
                currentRole: membership ? normalizeRole(membership.role) : null,
                alreadyMember: Boolean(membership),
                groupId: membership?.group_id || null
            };
        });
        const membershipsToAdd = roles.filter(item => !item.alreadyMember).map(item => item.bookingId);
        const roleUpdates = roles
            .filter(item => item.alreadyMember && item.currentRole && item.currentRole !== item.role)
            .map(item => ({
                bookingId: item.bookingId,
                currentRole: item.currentRole,
                expectedRole: item.role,
                groupId: item.groupId || existingGroupId
            }));
        if (existingGroupId && membershipsToAdd.length === 0 && roleUpdates.length === 0) {
            skipped.push({ ...base, reason: 'already_grouped', existingGroupId });
            continue;
        }

        proposed.push({
            ...base,
            existingGroupId,
            primaryBookingId: primary.id,
            anchorBookingIds: sorted.filter(isBanquetAnchor).map(row => row.id),
            roles,
            membershipsToAdd,
            roleUpdates,
            willCreateGroup: !existingGroupId
        });
    }

    return { proposed, skipped };
}

function formatPlanLine(item, index = 0) {
    const roles = item.roles.map(role => {
        const current = role.currentRole && role.currentRole !== role.role ? `(${role.currentRole}->${role.role})` : '';
        return `${role.bookingId}:${role.role}${role.alreadyMember ? ':existing' : ''}${current}`;
    }).join(', ');
    const roleUpdates = (item.roleUpdates || [])
        .map(update => `${update.bookingId}:${update.currentRole}->${update.expectedRole}`)
        .join(',') || '-';
    const existing = item.existingGroupId ? ` reuse=${item.existingGroupId}` : ' create=yes';
    return [
        `candidate #${index + 1}: ${item.room} / ${item.date}`,
        `context=${item.businessContext}`,
        `customer=hash:${item.customerHash}`,
        `primary=${item.primaryBookingId}`,
        `anchors=${item.anchorBookingIds.join(',') || '-'}`,
        `bookings=${item.bookingIds.join(',')}`,
        `roles=${roles}`,
        `toAttach=${item.membershipsToAdd.join(',') || '-'}`,
        `roleUpdates=${roleUpdates}`,
        existing.trim()
    ].join(' | ');
}

function printPlan(plan, options) {
    if (options.json) {
        console.log(JSON.stringify({
            mode: options.apply ? 'apply' : 'dry-run',
            from: options.from,
            to: options.to,
            context: options.allContexts ? 'all' : options.context,
            proposed: plan.proposed,
            skipped: plan.skipped
        }, null, 2));
        return;
    }
    console.log(`Banquet group reconciliation ${options.apply ? 'APPLY' : 'dry-run'}`);
    console.log(`range=${options.from}..${options.to} context=${options.allContexts ? 'all' : options.context}`);
    console.log(`proposed=${plan.proposed.length} skipped=${plan.skipped.length}`);
    for (const [index, item] of plan.proposed.entries()) {
        console.log(formatPlanLine(item, index));
    }
    for (const item of plan.skipped) {
        console.log(`skip: ${item.room} / ${item.date} | context=${item.businessContext} | customer=hash:${item.customerHash} | reason=${item.reason} | bookings=${item.bookingIds.join(',')}`);
    }
}

async function applyRoleUpdates(db, item) {
    const updates = Array.isArray(item.roleUpdates) ? item.roleUpdates : [];
    const applied = [];
    if (!updates.length) return applied;

    for (const update of updates) {
        const groupId = update.groupId || item.existingGroupId;
        if (!groupId || !update.bookingId || !update.expectedRole) continue;
        const result = await db.query(
            `UPDATE banquet_group_bookings
                SET role = $4,
                    updated_at = NOW()
              WHERE group_id = $1
                AND booking_id = $2
                AND COALESCE(NULLIF(BTRIM(business_context), ''), '${DEFAULT_TIMELINE_CONTEXT}') = $3
                AND role IS DISTINCT FROM $4
              RETURNING booking_id, role`,
            [groupId, update.bookingId, item.businessContext || DEFAULT_TIMELINE_CONTEXT, update.expectedRole]
        );
        if (result.rowCount > 0) {
            applied.push({
                bookingId: update.bookingId,
                previousRole: update.currentRole,
                role: update.expectedRole
            });
        }
    }

    if (applied.length && item.existingGroupId) {
        await db.query(
            `UPDATE banquet_groups
                SET updated_at = NOW(),
                    updated_by = $3
              WHERE id = $1
                AND COALESCE(NULLIF(BTRIM(business_context), ''), '${DEFAULT_TIMELINE_CONTEXT}') = $2`,
            [item.existingGroupId, item.businessContext || DEFAULT_TIMELINE_CONTEXT, SCRIPT_USER.username]
        );
    }

    return applied;
}

async function applyPlan(plan, options) {
    const summary = {
        groupsCreated: 0,
        membershipsAdded: 0,
        rolesUpdated: 0,
        skippedConflicts: plan.skipped.length,
        warnings: []
    };
    for (const item of plan.proposed) {
        try {
            const result = await reconcileBanquetGroupForBooking({
                bookingId: item.primaryBookingId,
                businessContext: item.businessContext,
                user: SCRIPT_USER,
                source: 'production_repair_script'
            });
            if (result.createdGroup) summary.groupsCreated += 1;
            summary.membershipsAdded += result.attachedBookingIds?.length || 0;
            const appliedRoleUpdates = await applyRoleUpdates(pool, item);
            summary.rolesUpdated += appliedRoleUpdates.length;
            if (result.skipped) {
                summary.warnings.push({
                    bookingId: item.primaryBookingId,
                    reason: result.reason || 'skipped'
                });
            }
            if (!options.json) {
                const roleUpdateLabel = appliedRoleUpdates
                    .map(update => `${update.bookingId}:${update.previousRole}->${update.role}`)
                    .join(',') || '-';
                console.log(`applied: ${item.room} / ${item.date} | group=${result.groupId || item.existingGroupId || '-'} | created=${Boolean(result.createdGroup)} | added=${(result.attachedBookingIds || []).join(',') || '-'} | rolesUpdated=${roleUpdateLabel}`);
            }
        } catch (err) {
            summary.skippedConflicts += 1;
            summary.warnings.push({
                bookingId: item.primaryBookingId,
                reason: err.message || 'apply_failed'
            });
            if (!options.json) {
                console.log(`WARN apply failed: ${item.room} / ${item.date} | primary=${item.primaryBookingId} | ${err.message}`);
            }
        }
    }
    return summary;
}

async function main() {
    const options = parseArgs();
    validateDateArg(options.from, '--from');
    validateDateArg(options.to, '--to');
    if (options.from > options.to) throw new Error('--from must be before or equal to --to');

    const rows = await loadCandidateRows(pool, options);
    const memberships = await loadMembershipRows(pool, rows.map(row => row.id), options.context, options.allContexts);
    const plan = buildPlan(rows, memberships);
    printPlan(plan, options);

    if (!options.apply) {
        if (!options.json) console.log('dry-run only: add --apply to write banquet_groups and memberships.');
        return;
    }

    const summary = await applyPlan(plan, options);
    if (options.json) {
        console.log(JSON.stringify({ applySummary: summary }, null, 2));
    } else {
        console.log(`apply summary: groupsCreated=${summary.groupsCreated} membershipsAdded=${summary.membershipsAdded} rolesUpdated=${summary.rolesUpdated} skippedConflicts=${summary.skippedConflicts} warnings=${summary.warnings.length}`);
        for (const warning of summary.warnings) {
            console.log(`WARN ${warning.bookingId}: ${warning.reason}`);
        }
    }
}

if (require.main === module) {
    main()
        .catch(err => {
            console.error(err.stack || err.message || err);
            process.exitCode = 1;
        })
        .finally(() => pool.end().catch(() => {}));
}

module.exports = {
    applyRoleUpdates,
    buildPlan,
    parseArgs
};
