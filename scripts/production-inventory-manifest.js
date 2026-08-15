#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../db');

const SOURCE_BRANCH = 'codex/checkbox-hardening-release-v080103';
const TARGET_BOOKING_IDS = Object.freeze([
    'BK-2026-0662',
    'BK-2026-0663',
    'BK-2026-0664',
    'BK-2026-0665',
    'BK-2026-0666',
    'BK-2026-0667',
    'BK-2026-0668'
]);
const TARGET_GROUP_IDS = Object.freeze([
    'BQ-MROUEOJA-35896807',
    'BQ-MROUMZIF-8E5B247C',
    'BQ-MROUPBKN-63A9E113'
]);
const EXCLUDED_BOOKING_IDS = Object.freeze(['BK-2026-0662']);
const EXCLUDED_DEPOSIT_IDS = Object.freeze(['21']);
const BUSINESS_CONTEXT = 'event_genix';
const ROOM_CONSTRAINTS = Object.freeze([
    'chk_bookings_active_room_identity_v332',
    'chk_banquet_groups_active_room_identity_v332'
]);

function argValue(args, name, fallback = null) {
    const exact = args.find(arg => arg.startsWith(`${name}=`));
    if (exact) return exact.slice(name.length + 1);
    const index = args.indexOf(name);
    if (index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')) return args[index + 1];
    return fallback;
}

function parseArgs(argv = process.argv.slice(2)) {
    if (argv.includes('--apply')) {
        throw new Error('Apply is not supported by this read-only inventory task.');
    }
    return {
        json: argv.includes('--json'),
        outputDir: argValue(argv, '--output-dir', null),
        sourceCommit: argValue(argv, '--source-commit', null),
        liveUrl: argValue(argv, '--live-url', null)
    };
}

function sortObject(value) {
    if (Array.isArray(value)) return value.map(sortObject);
    if (!value || typeof value !== 'object' || value instanceof Date) return value;
    return Object.keys(value).sort().reduce((acc, key) => {
        acc[key] = sortObject(value[key]);
        return acc;
    }, {});
}

function stableJson(value) {
    return JSON.stringify(sortObject(value));
}

function sha256(value) {
    return crypto.createHash('sha256').update(
        typeof value === 'string' ? value : stableJson(value)
    ).digest('hex');
}

function valueHash(value) {
    if (value === null || value === undefined || value === '') return null;
    return sha256(String(value)).slice(0, 16);
}

function safeDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    return String(value);
}

function normalizeRow(row = {}) {
    return Object.keys(row).sort().reduce((acc, key) => {
        const value = row[key];
        if (value instanceof Date) acc[key] = value.toISOString();
        else if (value && typeof value === 'object') acc[key] = sha256(value).slice(0, 24);
        else acc[key] = value;
        return acc;
    }, {});
}

function unique(values = []) {
    return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))].sort();
}

function activeStatus(status, fallback = 'confirmed') {
    return String(status || fallback).trim().toLowerCase() !== 'cancelled';
}

function creatorClass(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return 'unknown';
    if (/system|service|automation|bot|smoke|qa|codex|timeline-browser|rule/.test(text)) return 'machine';
    return 'human_or_named_user';
}

function classifyTask(row = {}) {
    const metaHash = valueHash(row.control_meta || row.metadata || row.meta);
    return {
        id: String(row.id),
        source_type: row.source_type || row.source_entity_type || null,
        source_id: row.source_id || row.source_entity_id || null,
        status: row.status || null,
        created_by_class: creatorClass(row.created_by),
        updated_by_class: creatorClass(row.updated_by),
        assignee_id_hash: valueHash(row.assignee_id),
        meta_hash: metaHash,
        created_at: safeDate(row.created_at),
        updated_at: safeDate(row.updated_at),
        machine_owned_unfinished: creatorClass(row.created_by) === 'machine'
            && !['done', 'archived', 'cancelled'].includes(String(row.status || 'todo').toLowerCase())
    };
}

async function getColumns(client, table) {
    const result = await client.query(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = $1
          ORDER BY ordinal_position`,
        [table]
    );
    return new Set((result.rows || []).map(row => row.column_name));
}

async function tableExists(client, table) {
    const result = await client.query(
        `SELECT to_regclass($1) AS regclass`,
        [`public.${table}`]
    );
    return Boolean(result.rows?.[0]?.regclass);
}

async function tableSelectAllowed(client, table) {
    if (!await tableExists(client, table)) return false;
    const result = await client.query(
        `SELECT has_table_privilege(current_user, $1, 'SELECT') AS allowed`,
        [`public.${table}`]
    );
    return result.rows?.[0]?.allowed === true;
}

async function optionalSelect(client, table, wantedColumns, whereSql, params = [], orderSql = '') {
    if (!await tableExists(client, table)) return [];
    const columns = await getColumns(client, table);
    const selected = wantedColumns.filter(column => columns.has(column));
    if (!selected.length) return [];
    const result = await client.query(
        `SELECT ${selected.map(column => `"${column}"`).join(', ')}
           FROM ${table}
          ${whereSql}
          ${orderSql}`,
        params
    );
    return (result.rows || []).map(normalizeRow);
}

async function optionalCountByText(client, table, needles, labelColumns = []) {
    if (!await tableExists(client, table)) return [];
    const columns = await getColumns(client, table);
    const labels = labelColumns.filter(column => columns.has(column));
    const idSelect = columns.has('id') ? 'id::text AS id' : 'ctid::text AS row_key';
    const timestampSelect = [
        columns.has('created_at') ? 'created_at' : null,
        columns.has('updated_at') ? 'updated_at' : null
    ].filter(Boolean);
    const stateSelect = [
        columns.has('status') ? 'status' : null,
        columns.has('state') ? 'state' : null
    ].filter(Boolean);
    const optionalSelects = [...labels, ...timestampSelect, ...stateSelect]
        .map(column => `"${column}"`)
        .join(', ');
    const selectSql = [idSelect, optionalSelects, `md5(to_jsonb(${table})::text) AS row_hash`]
        .filter(Boolean)
        .join(', ');
    const result = await client.query(
        `SELECT ${selectSql}
           FROM ${table}
          WHERE ${needles.map((_, index) => `to_jsonb(${table})::text LIKE $${index + 1}`).join(' OR ')}
          ORDER BY ${columns.has('id') ? 'id::text' : 'ctid::text'}
          LIMIT 500`,
        needles.map(value => `%${value}%`)
    );
    return (result.rows || []).map(normalizeRow);
}

async function queryScalar(client, sql, params = []) {
    const result = await client.query(sql, params);
    return result.rows?.[0] || {};
}

async function schemaFingerprint(client, table, whereSql = '', params = []) {
    if (!await tableExists(client, table)) return { table, exists: false, count: 0, hash: null };
    const columns = await getColumns(client, table);
    const latestExpr = columns.has('updated_at') && columns.has('created_at')
        ? "COALESCE(MAX(updated_at)::text, MAX(created_at)::text, '')"
        : (columns.has('updated_at')
            ? "COALESCE(MAX(updated_at)::text, '')"
            : (columns.has('created_at') ? "COALESCE(MAX(created_at)::text, '')" : "''"));
    const orderExpr = columns.has('id') ? 'id::text' : 'ctid::text';
    const result = await client.query(
        `SELECT COUNT(*)::int AS count,
                ${latestExpr} AS latest,
                md5(COALESCE(string_agg(md5(to_jsonb(${table})::text), ',' ORDER BY ${orderExpr}), '')) AS hash
           FROM ${table}
          ${whereSql}`,
        params
    );
    return { table, exists: true, ...normalizeRow(result.rows?.[0] || {}) };
}

async function buildBookingCleanupManifest(client, context) {
    const bookings = await optionalSelect(client, 'bookings', [
        'id', 'business_context', 'status', 'date', 'time', 'room', 'room_resource_id',
        'linked_to', 'price', 'paid_amount', 'payment_status', 'payment_method',
        'certificate_id', 'checkbox_receipt_id', 'program_id', 'program_code',
        'created_by', 'created_at', 'updated_at', 'customer_id'
    ], 'WHERE id = ANY($1::text[])', [TARGET_BOOKING_IDS], 'ORDER BY id');
    const bookingIds = unique([
        ...TARGET_BOOKING_IDS,
        ...bookings.map(row => row.id),
        ...bookings.map(row => row.linked_to)
    ]);
    const customerIds = unique(bookings.map(row => row.customer_id));
    const memberships = await optionalSelect(client, 'banquet_group_bookings', [
        'group_id', 'business_context', 'booking_id', 'role', 'sort_order', 'created_by', 'created_at'
    ], 'WHERE group_id = ANY($1::text[]) OR booking_id = ANY($2::text[])', [TARGET_GROUP_IDS, TARGET_BOOKING_IDS], 'ORDER BY group_id, sort_order, booking_id');
    const groupIds = unique([...TARGET_GROUP_IDS, ...memberships.map(row => row.group_id)]);
    const groups = await optionalSelect(client, 'banquet_groups', [
        'id', 'business_context', 'status', 'primary_booking_id', 'date', 'room',
        'room_resource_id', 'source', 'created_by', 'created_at', 'updated_at'
    ], 'WHERE id = ANY($1::text[]) OR primary_booking_id = ANY($2::text[])', [groupIds, TARGET_BOOKING_IDS], 'ORDER BY id');
    const links = await optionalSelect(client, 'booking_banquet_links', [
        'id', 'business_context', 'booking_a_id', 'booking_b_id', 'relation_type', 'created_by', 'created_at'
    ], 'WHERE booking_a_id = ANY($1::text[]) OR booking_b_id = ANY($1::text[])', [bookingIds], 'ORDER BY id');
    const linkedBookingIds = unique([
        ...bookingIds,
        ...links.flatMap(row => [row.booking_a_id, row.booking_b_id])
    ]);
    const children = await optionalSelect(client, 'bookings', [
        'id', 'business_context', 'status', 'date', 'time', 'room', 'room_resource_id',
        'linked_to', 'price', 'paid_amount', 'payment_status', 'payment_method',
        'certificate_id', 'checkbox_receipt_id', 'created_by', 'created_at', 'updated_at', 'customer_id'
    ], 'WHERE linked_to = ANY($1::text[]) AND id <> ALL($1::text[])', [linkedBookingIds], 'ORDER BY id');
    const allBookingIds = unique([...linkedBookingIds, ...children.map(row => row.id)]);
    const allGroupIds = unique([...groupIds, ...groups.map(row => row.id)]);
    const financeRows = await optionalSelect(client, 'finance_transactions', [
        'id', 'business_context', 'booking_id', 'type', 'amount', 'payment_method',
        'certificate_id', 'source', 'status', 'created_by', 'created_at', 'updated_at'
    ], 'WHERE booking_id = ANY($1::text[])', [allBookingIds], 'ORDER BY booking_id, id');
    const receipts = await optionalSelect(client, 'receipts', [
        'id', 'business_context', 'booking_id', 'transaction_id', 'amount', 'status',
        'fiscal_receipt_id', 'checkbox_receipt_id', 'created_at', 'updated_at'
    ], 'WHERE booking_id = ANY($1::text[]) OR transaction_id::text = ANY($2::text[])', [
        allBookingIds,
        unique(financeRows.map(row => row.id))
    ], 'ORDER BY booking_id, id');
    const certificateIds = unique([
        ...bookings.map(row => row.certificate_id),
        ...children.map(row => row.certificate_id),
        ...financeRows.map(row => row.certificate_id)
    ]);
    const certificates = certificateIds.length
        ? await optionalSelect(client, 'certificates', [
            'id', 'business_context', 'status', 'amount', 'balance', 'used_amount', 'created_at', 'updated_at'
        ], 'WHERE id = ANY($1::text[])', [certificateIds], 'ORDER BY id')
        : [];
    const deposits = await optionalSelect(client, 'banquet_deposits', [
        'id', 'business_context', 'banquet_group_id', 'primary_booking_id', 'status',
        'expected_amount', 'amount', 'paid_amount', 'payment_method', 'finance_transaction_id',
        'accountant_task_id', 'accounting_status', 'verified_at', 'verified_by', 'created_at', 'updated_at'
    ], 'WHERE banquet_group_id = ANY($1::text[]) OR primary_booking_id = ANY($2::text[])', [allGroupIds, allBookingIds], 'ORDER BY id');
    const tasksRaw = await optionalSelect(client, 'tasks', [
        'id', 'business_context', 'source_type', 'source_id', 'source_entity_type', 'source_entity_id',
        'related_entity_type', 'related_entity_id', 'status', 'created_by', 'updated_by',
        'assignee_id', 'control_meta', 'metadata', 'created_at', 'updated_at'
    ], `WHERE (source_type = 'booking' AND source_id = ANY($1::text[]))
          OR (source_entity_type = 'booking' AND source_entity_id = ANY($1::text[]))
          OR (related_entity_type = 'booking' AND related_entity_id = ANY($1::text[]))`, [allBookingIds], 'ORDER BY id');
    const tasks = tasksRaw.map(classifyTask);
    const taskIds = unique(tasks.map(row => row.id));
    const subtasks = taskIds.length ? await optionalSelect(client, 'task_subtasks', [
        'id', 'task_id', 'status', 'created_at', 'updated_at'
    ], 'WHERE task_id = ANY($1::int[])', [taskIds.map(Number).filter(Number.isFinite)], 'ORDER BY task_id, id') : [];
    const observers = taskIds.length ? await optionalSelect(client, 'task_observers', [
        'id', 'task_id', 'user_id', 'created_at'
    ], 'WHERE task_id = ANY($1::int[])', [taskIds.map(Number).filter(Number.isFinite)], 'ORDER BY task_id, user_id') : [];
    const taskHistory = taskIds.length ? await optionalSelect(client, 'task_action_history', [
        'id', 'task_id', 'action', 'actor_id', 'actor_username', 'created_at'
    ], 'WHERE task_id = ANY($1::int[])', [taskIds.map(Number).filter(Number.isFinite)], 'ORDER BY task_id, id') : [];
    const history = await optionalCountByText(client, 'history', [...allBookingIds, ...allGroupIds], ['action']);
    const stock = await optionalCountByText(client, 'warehouse_stock_movements', [...allBookingIds, ...allGroupIds], ['source_type', 'source_id', 'movement_type', 'reason']);
    const productStock = await optionalSelect(client, 'product_stock_requirements', [
        'product_id', 'stock_id', 'quantity'
    ], `WHERE product_id::text IN (
            SELECT DISTINCT program_id::text FROM bookings WHERE id = ANY($1::text[]) AND program_id IS NOT NULL
        )`, [allBookingIds], 'ORDER BY product_id, stock_id');
    const outbox = await optionalCountByText(client, 'outbox_events', [...allBookingIds, ...allGroupIds], ['aggregate_type', 'aggregate_id', 'event_type', 'published_at']);
    const eventQueue = await optionalCountByText(client, 'event_queue', [...allBookingIds, ...allGroupIds], ['event_type', 'status', 'processed_at']);
    const ruleExecutions = await optionalCountByText(client, 'rule_execution_log', [...allBookingIds, ...allGroupIds], ['rule_id', 'status', 'event_type']);
    const notificationOutbox = await optionalCountByText(client, 'notification_outbox', [...allBookingIds, ...allGroupIds], ['channel', 'status', 'event_type']);
    const chat = await optionalCountByText(client, 'chat_channels', [...allBookingIds, ...allGroupIds], ['type', 'linked_booking_id']);
    const announcements = await optionalCountByText(client, 'announcements', [...allBookingIds, ...allGroupIds], ['status', 'type']);
    const printJobs = await optionalCountByText(client, 'print_jobs', [...allBookingIds, ...allGroupIds], ['status', 'template_id']);
    const loyalty = await optionalCountByText(client, 'loyalty_transactions', [...allBookingIds, ...allGroupIds, ...customerIds], ['type', 'status']);
    const gamification = await optionalCountByText(client, 'gamification_events', [...allBookingIds, ...allGroupIds, ...customerIds], ['event_type', 'status']);
    const customerAggregates = customerIds.length ? await optionalSelect(client, 'customers', [
        'id', 'business_context', 'total_visits', 'total_spent', 'loyalty_points', 'updated_at'
    ], 'WHERE id = ANY($1::int[])', [customerIds.map(Number).filter(Number.isFinite)], 'ORDER BY id') : [];

    const sanitizedBookings = [...bookings, ...children].map(row => ({
        ...row,
        customer_id_hash: valueHash(row.customer_id),
        customer_id: undefined,
        created_by_class: creatorClass(row.created_by),
        created_by: undefined
    })).map(row => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined)));
    const manifest = {
        kind: 'booking_cleanup',
        productionImpact: true,
        mutationAllowed: false,
        sourceCommit: context.sourceCommit,
        sourceBranch: SOURCE_BRANCH,
        generatedAt: context.generatedAt,
        targetBookingIds: TARGET_BOOKING_IDS,
        targetGroupIds: TARGET_GROUP_IDS,
        excludedNoApproval: {
            bookingIds: EXCLUDED_BOOKING_IDS,
            depositIds: EXCLUDED_DEPOSIT_IDS
        },
        records: {
            bookings: sanitizedBookings,
            memberships,
            groups,
            links,
            deposits,
            financeRows,
            receipts,
            certificates,
            tasks,
            subtasks: subtasks.map(row => ({ ...row, title: undefined })),
            observers: observers.map(row => ({ ...row, user_id_hash: valueHash(row.user_id), user_id: undefined })),
            taskHistory: taskHistory.map(row => ({
                ...row,
                actor_id_hash: valueHash(row.actor_id),
                actor_username_class: creatorClass(row.actor_username),
                actor_id: undefined,
                actor_username: undefined
            })).map(row => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined))),
            history,
            stock,
            productStock,
            outbox,
            eventQueue,
            ruleExecutions,
            notificationOutbox,
            chat,
            announcements,
            printJobs,
            loyalty,
            gamification,
            customerAggregates: customerAggregates.map(row => ({
                ...row,
                id_hash: valueHash(row.id),
                id: undefined
            })).map(row => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined)))
        },
        summary: {
            bookings: sanitizedBookings.length,
            activeBookings: sanitizedBookings.filter(row => activeStatus(row.status)).length,
            groups: groups.length,
            activeGroups: groups.filter(row => activeStatus(row.status, 'active')).length,
            deposits: deposits.length,
            financeRows: financeRows.length,
            receipts: receipts.length,
            certificates: certificates.length,
            tasks: tasks.length,
            machineOwnedUnfinishedTasks: tasks.filter(row => row.machine_owned_unfinished).length,
            sideEffectRows: outbox.length + eventQueue.length + ruleExecutions.length + notificationOutbox.length
                + chat.length + announcements.length + printJobs.length + loyalty.length + gamification.length + stock.length
        },
        futurePlan: {
            blocked: [{
                bookingId: 'BK-2026-0662',
                depositId: '21',
                status: 'EXCLUDED_NO_APPROVAL'
            }],
            cleanupCandidates: TARGET_BOOKING_IDS.filter(id => !EXCLUDED_BOOKING_IDS.includes(id))
        }
    };
    manifest.hash = sha256({ ...manifest, hash: undefined });
    return manifest;
}

async function buildRoomManifest(client, context) {
    const activeBookingsMissing = await optionalSelect(client, 'bookings', [
        'id', 'business_context', 'status', 'date', 'room', 'room_resource_id', 'linked_to', 'created_at', 'updated_at'
    ], `WHERE COALESCE(NULLIF(BTRIM(business_context), ''), $1) = $1
          AND LOWER(COALESCE(NULLIF(BTRIM(status), ''), 'confirmed')) <> 'cancelled'
          AND COALESCE(BTRIM(room_resource_id), '') = ''`, [BUSINESS_CONTEXT], 'ORDER BY date, id');
    const activeBookingsCorrupt = await optionalSelect(client, 'bookings', [
        'id', 'business_context', 'status', 'date', 'room', 'room_resource_id', 'linked_to', 'created_at', 'updated_at'
    ], `WHERE COALESCE(NULLIF(BTRIM(business_context), ''), $1) = $1
          AND LOWER(COALESCE(NULLIF(BTRIM(status), ''), 'confirmed')) <> 'cancelled'
          AND (BTRIM(COALESCE(room, '')) ~ '^[?]+$' OR room LIKE '%' || chr(65533) || '%')`, [BUSINESS_CONTEXT], 'ORDER BY date, id');
    const activeGroupsMissing = await optionalSelect(client, 'banquet_groups', [
        'id', 'business_context', 'status', 'primary_booking_id', 'date', 'room', 'room_resource_id', 'created_at', 'updated_at'
    ], `WHERE COALESCE(NULLIF(BTRIM(business_context), ''), $1) = $1
          AND LOWER(COALESCE(NULLIF(BTRIM(status), ''), 'active')) <> 'cancelled'
          AND COALESCE(BTRIM(room_resource_id), '') = ''`, [BUSINESS_CONTEXT], 'ORDER BY date, id');
    const activeGroupsCorrupt = await optionalSelect(client, 'banquet_groups', [
        'id', 'business_context', 'status', 'primary_booking_id', 'date', 'room', 'room_resource_id', 'created_at', 'updated_at'
    ], `WHERE COALESCE(NULLIF(BTRIM(business_context), ''), $1) = $1
          AND LOWER(COALESCE(NULLIF(BTRIM(status), ''), 'active')) <> 'cancelled'
          AND (BTRIM(COALESCE(room, '')) ~ '^[?]+$' OR room LIKE '%' || chr(65533) || '%')`, [BUSINESS_CONTEXT], 'ORDER BY date, id');
    const groupPrimaryMismatch = await client.query(
        `SELECT bg.id AS group_id, bg.primary_booking_id,
                bg.room_resource_id AS group_room_resource_id,
                b.room_resource_id AS booking_room_resource_id,
                bg.business_context AS group_business_context,
                b.business_context AS booking_business_context,
                bg.status AS group_status,
                b.status AS booking_status
           FROM banquet_groups bg
           LEFT JOIN bookings b ON b.id = bg.primary_booking_id
          WHERE COALESCE(NULLIF(BTRIM(bg.business_context), ''), $1) = $1
            AND LOWER(COALESCE(NULLIF(BTRIM(bg.status), ''), 'active')) <> 'cancelled'
            AND (
                b.id IS NULL
                OR COALESCE(NULLIF(BTRIM(b.business_context), ''), $1) IS DISTINCT FROM COALESCE(NULLIF(BTRIM(bg.business_context), ''), $1)
                OR NULLIF(BTRIM(bg.room_resource_id), '') IS DISTINCT FROM NULLIF(BTRIM(b.room_resource_id), '')
            )
          ORDER BY bg.id`,
        [BUSINESS_CONTEXT]
    );
    const primaryMembershipIssues = await client.query(
        `SELECT bg.id AS group_id,
                bg.primary_booking_id,
                COUNT(bgb.booking_id) FILTER (WHERE LOWER(COALESCE(NULLIF(BTRIM(bgb.role), ''), '')) = 'primary')::int AS primary_memberships,
                COUNT(bgb.booking_id) FILTER (WHERE bgb.booking_id = bg.primary_booking_id AND LOWER(COALESCE(NULLIF(BTRIM(bgb.role), ''), '')) = 'primary')::int AS matching_primary_memberships
           FROM banquet_groups bg
           LEFT JOIN banquet_group_bookings bgb ON bgb.group_id = bg.id
          WHERE COALESCE(NULLIF(BTRIM(bg.business_context), ''), $1) = $1
            AND LOWER(COALESCE(NULLIF(BTRIM(bg.status), ''), 'active')) <> 'cancelled'
          GROUP BY bg.id, bg.primary_booking_id
         HAVING COUNT(bgb.booking_id) FILTER (WHERE LOWER(COALESCE(NULLIF(BTRIM(bgb.role), ''), '')) = 'primary') <> 1
             OR COUNT(bgb.booking_id) FILTER (WHERE bgb.booking_id = bg.primary_booking_id AND LOWER(COALESCE(NULLIF(BTRIM(bgb.role), ''), '')) = 'primary') <> 1
          ORDER BY bg.id`,
        [BUSINESS_CONTEXT]
    );
    const constraints = await client.query(
        `SELECT c.conname, c.convalidated, c.contype, n.nspname, cls.relname
           FROM pg_constraint c
           JOIN pg_class cls ON cls.oid = c.conrelid
           JOIN pg_namespace n ON n.oid = cls.relnamespace
          WHERE c.conname = ANY($1::text[])
          ORDER BY c.conname`,
        [ROOM_CONSTRAINTS]
    );
    const manifest = {
        kind: 'room_identity',
        productionImpact: true,
        mutationAllowed: false,
        sourceCommit: context.sourceCommit,
        sourceBranch: SOURCE_BRANCH,
        generatedAt: context.generatedAt,
        businessContext: BUSINESS_CONTEXT,
        inventory: {
            activeBookingsMissingRoomResourceId: activeBookingsMissing,
            activeBookingsCorruptRoomText: activeBookingsCorrupt,
            activeBanquetGroupsMissingRoomResourceId: activeGroupsMissing,
            activeBanquetGroupsCorruptRoomText: activeGroupsCorrupt,
            groupPrimaryMismatch: (groupPrimaryMismatch.rows || []).map(normalizeRow),
            primaryMembershipIssues: (primaryMembershipIssues.rows || []).map(normalizeRow),
            constraints: (constraints.rows || []).map(normalizeRow)
        },
        summary: {
            activeBookingsMissingRoomResourceId: activeBookingsMissing.length,
            activeBookingsCorruptRoomText: activeBookingsCorrupt.length,
            activeBanquetGroupsMissingRoomResourceId: activeGroupsMissing.length,
            activeBanquetGroupsCorruptRoomText: activeGroupsCorrupt.length,
            groupPrimaryMismatch: groupPrimaryMismatch.rowCount,
            primaryMembershipIssues: primaryMembershipIssues.rowCount,
            unvalidatedConstraints: (constraints.rows || []).filter(row => row.convalidated === false).length
        },
        policy: {
            doNotInventRoomIds: true,
            mutationRequiresExactApproval: true,
            constraintValidationRequiresZeroInvalidActiveRows: true
        }
    };
    manifest.hash = sha256({ ...manifest, hash: undefined });
    return manifest;
}

async function buildTrustedQaManifest(client, context) {
    const registryReadable = await tableSelectAllowed(client, 'trusted_qa_runs');
    const entitiesReadable = await tableSelectAllowed(client, 'trusted_qa_run_entities');
    const inspectionBlockers = [];
    if (!registryReadable) inspectionBlockers.push('trusted_qa_runs_select_denied_or_missing');
    if (!entitiesReadable) inspectionBlockers.push('trusted_qa_run_entities_select_denied_or_missing');
    const qaRuns = registryReadable ? await optionalSelect(client, 'trusted_qa_runs', [
        'id', 'run_id', 'source', 'business_context', 'operator_user_id',
        'test_customer_marker', 'max_entity_count', 'state', 'expires_at', 'created_at', 'updated_at'
    ], 'WHERE true', [], 'ORDER BY id') : [];
    const runIds = qaRuns.map(row => Number(row.id)).filter(Number.isFinite);
    const entities = entitiesReadable && runIds.length ? await optionalSelect(client, 'trusted_qa_run_entities', [
        'id', 'run_id', 'entity_type', 'entity_id', 'cleanup_state', 'created_at', 'updated_at'
    ], 'WHERE run_id = ANY($1::int[])', [runIds], 'ORDER BY run_id, entity_type, entity_id') : [];
    const states = qaRuns.reduce((acc, row) => {
        acc[row.state || 'unknown'] = (acc[row.state || 'unknown'] || 0) + 1;
        return acc;
    }, {});
    const entityStates = entities.reduce((acc, row) => {
        acc[row.cleanup_state || 'unknown'] = (acc[row.cleanup_state || 'unknown'] || 0) + 1;
        return acc;
    }, {});
    const sideEffectNeedles = unique([
        ...qaRuns.map(row => row.run_id),
        ...qaRuns.map(row => row.test_customer_marker),
        ...entities.map(row => row.entity_id)
    ]);
    const leftovers = sideEffectNeedles.length ? {
        outbox: await optionalCountByText(client, 'outbox_events', sideEffectNeedles, ['aggregate_type', 'event_type', 'published_at']),
        eventQueue: await optionalCountByText(client, 'event_queue', sideEffectNeedles, ['event_type', 'status', 'processed_at']),
        notificationOutbox: await optionalCountByText(client, 'notification_outbox', sideEffectNeedles, ['channel', 'status', 'event_type']),
        ruleExecutions: await optionalCountByText(client, 'rule_execution_log', sideEffectNeedles, ['rule_id', 'status', 'event_type'])
    } : { outbox: [], eventQueue: [], notificationOutbox: [], ruleExecutions: [] };
    const manifest = {
        kind: 'trusted_qa',
        productionImpact: true,
        mutationAllowed: false,
        sourceCommit: context.sourceCommit,
        sourceBranch: SOURCE_BRANCH,
        generatedAt: context.generatedAt,
        summary: {
            inspectionBlocked: inspectionBlockers.length > 0,
            inspectionBlockers,
            runs: qaRuns.length,
            states,
            entities: entities.length,
            entityStates,
            sideEffectLeftovers: Object.values(leftovers).reduce((sum, rows) => sum + rows.length, 0)
        },
        runs: qaRuns.map(row => ({
            ...row,
            operator_user_id_hash: valueHash(row.operator_user_id),
            test_customer_marker_hash: valueHash(row.test_customer_marker),
            operator_user_id: undefined,
            test_customer_marker: undefined
        })).map(row => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined))),
        entities,
        sideEffectLeftovers: leftovers,
        policy: {
            clientMarkerIsNotAuthorization: true,
            rawTokensStored: false,
            mutationRequiresExactApproval: true,
            zeroRunsIsAuthoritative: inspectionBlockers.length === 0
        }
    };
    manifest.hash = sha256({ ...manifest, hash: undefined });
    return manifest;
}

async function buildConstraintManifest(roomManifest, context) {
    const constraintNames = roomManifest.inventory.constraints.map(row => row.conname);
    const invalidActiveCount = roomManifest.summary.activeBookingsMissingRoomResourceId
        + roomManifest.summary.activeBookingsCorruptRoomText
        + roomManifest.summary.activeBanquetGroupsMissingRoomResourceId
        + roomManifest.summary.activeBanquetGroupsCorruptRoomText
        + roomManifest.summary.groupPrimaryMismatch
        + roomManifest.summary.primaryMembershipIssues;
    const manifest = {
        kind: 'constraint_validation',
        productionImpact: true,
        mutationAllowed: false,
        sourceCommit: context.sourceCommit,
        sourceBranch: SOURCE_BRANCH,
        generatedAt: context.generatedAt,
        constraints: constraintNames,
        invalidActiveCount,
        allowedOperation: invalidActiveCount === 0 ? 'VALIDATE_CONSTRAINT_AFTER_EXACT_APPROVAL' : 'BLOCKED_UNTIL_ROOM_CLEANUP',
        blockerSummary: roomManifest.summary,
        policy: {
            validationRequiresExactApproval: true,
            validationRequiresZeroInvalidActiveRows: true
        }
    };
    manifest.hash = sha256({ ...manifest, hash: undefined });
    return manifest;
}

async function captureTargetFingerprints(client) {
    const targetNeedles = unique([...TARGET_BOOKING_IDS, ...TARGET_GROUP_IDS]);
    return {
        targetNeedles,
        fingerprints: [
        await schemaFingerprint(client, 'bookings', 'WHERE id = ANY($1::text[])', [TARGET_BOOKING_IDS]),
        await schemaFingerprint(client, 'banquet_groups', 'WHERE id = ANY($1::text[])', [TARGET_GROUP_IDS]),
        await schemaFingerprint(client, 'banquet_group_bookings', 'WHERE group_id = ANY($1::text[]) OR booking_id = ANY($2::text[])', [TARGET_GROUP_IDS, TARGET_BOOKING_IDS]),
        await schemaFingerprint(client, 'banquet_deposits', 'WHERE banquet_group_id = ANY($1::text[]) OR primary_booking_id = ANY($2::text[])', [TARGET_GROUP_IDS, TARGET_BOOKING_IDS]),
        await schemaFingerprint(client, 'finance_transactions', 'WHERE booking_id = ANY($1::text[])', [TARGET_BOOKING_IDS]),
        await schemaFingerprint(client, 'tasks', `WHERE source_type = 'booking' AND source_id = ANY($1::text[])`, [TARGET_BOOKING_IDS])
        ]
    };
}

async function buildZeroMutationProof(context, manifests, before, after) {
    const beforeHash = sha256(before);
    const afterHash = sha256(after);
    const manifestHashes = Object.fromEntries(Object.entries(manifests).map(([key, value]) => [key, value.hash]));
    return {
        kind: 'zero_mutation_proof',
        generatedAt: context.generatedAt,
        sourceCommit: context.sourceCommit,
        transactionMode: 'READ ONLY',
        before,
        after,
        beforeHash,
        afterHash,
        matched: beforeHash === afterHash,
        manifestHashes,
        proofHash: sha256({ beforeHash, afterHash, manifestHashes })
    };
}

function approvalText(manifests) {
    const cleanupIds = TARGET_BOOKING_IDS.filter(id => !EXCLUDED_BOOKING_IDS.includes(id)).join(', ');
    const roomIds = unique([
        ...manifests.rooms.inventory.activeBookingsMissingRoomResourceId.map(row => row.id),
        ...manifests.rooms.inventory.activeBookingsCorruptRoomText.map(row => row.id),
        ...manifests.rooms.inventory.activeBanquetGroupsMissingRoomResourceId.map(row => row.id),
        ...manifests.rooms.inventory.activeBanquetGroupsCorruptRoomText.map(row => row.id),
        ...manifests.rooms.inventory.groupPrimaryMismatch.map(row => row.group_id),
        ...manifests.rooms.inventory.primaryMembershipIssues.map(row => row.group_id)
    ]).join(', ') || '<none>';
    const constraints = manifests.constraints.constraints.join(', ') || '<none>';
    return {
        cleanup: `APPROVE CLEANUP MANIFEST ${manifests.bookingCleanup.hash} FOR EXACT IDS ${cleanupIds}. EXCLUDE BK-2026-0662 AND DEPOSIT 21.`,
        roomMutation: `APPROVE ROOM MUTATION MANIFEST ${manifests.rooms.hash} FOR EXACT IDS ${roomIds}. DO NOT INVENT ROOM IDS.`,
        validation: `APPROVE VALIDATION MANIFEST ${manifests.constraints.hash} FOR EXACT CONSTRAINTS ${constraints}.`
    };
}

async function main() {
    const options = parseArgs();
    if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL is required. Use PRODUCTION_READONLY_DATABASE_URL mapped to DATABASE_URL.');
    }
    const generatedAt = new Date().toISOString();
    const context = {
        generatedAt,
        sourceCommit: options.sourceCommit || 'unknown',
        liveUrl: options.liveUrl || null
    };
        const client = await pool.connect();
    try {
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await client.query('SET LOCAL statement_timeout = 30000');
        const beforeFingerprints = await captureTargetFingerprints(client);
        const bookingCleanup = await buildBookingCleanupManifest(client, context);
        const rooms = await buildRoomManifest(client, context);
        const trustedQa = await buildTrustedQaManifest(client, context);
        const constraints = await buildConstraintManifest(rooms, context);
        const manifests = { bookingCleanup, rooms, constraints, trustedQa };
        const afterFingerprints = await captureTargetFingerprints(client);
        const zeroMutation = await buildZeroMutationProof(context, manifests, beforeFingerprints, afterFingerprints);
        await client.query('ROLLBACK');
        const bundle = {
            kind: 'production_inventory_bundle',
            productionImpact: true,
            mutationAllowed: false,
            generatedAt,
            liveUrl: options.liveUrl,
            sourceCommit: context.sourceCommit,
            sourceBranch: SOURCE_BRANCH,
            manifests,
            zeroMutation,
            approvals: approvalText(manifests)
        };
        bundle.hash = sha256({ ...bundle, hash: undefined });
        if (options.outputDir) {
            fs.mkdirSync(options.outputDir, { recursive: true });
            fs.writeFileSync(path.join(options.outputDir, 'production-inventory-bundle.json'), `${JSON.stringify(bundle, null, 2)}\n`);
            for (const [name, manifest] of Object.entries(manifests)) {
                fs.writeFileSync(path.join(options.outputDir, `${name}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
            }
            fs.writeFileSync(path.join(options.outputDir, 'zero-mutation-proof.json'), `${JSON.stringify(zeroMutation, null, 2)}\n`);
            fs.writeFileSync(path.join(options.outputDir, 'approval-texts.txt'), `${Object.values(bundle.approvals).join('\n')}\n`);
        }
        process.stdout.write(JSON.stringify({
            generatedAt,
            bundleHash: bundle.hash,
            manifestHashes: Object.fromEntries(Object.entries(manifests).map(([key, value]) => [key, value.hash])),
            zeroMutationProofHash: zeroMutation.proofHash,
            summaries: {
                bookingCleanup: bookingCleanup.summary,
                rooms: rooms.summary,
                constraints: {
                    invalidActiveCount: constraints.invalidActiveCount,
                    allowedOperation: constraints.allowedOperation
                },
                trustedQa: trustedQa.summary
            },
            approvals: bundle.approvals,
            outputDir: options.outputDir || null
        }, null, 2) + '\n');
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch {}
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch(err => {
    console.error(process.env.PRODUCTION_INVENTORY_DEBUG === '1' ? (err.stack || err.message) : err.message);
    process.exit(1);
});
