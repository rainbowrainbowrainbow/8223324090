#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { manifestHash, readPlan, stableValue } = require('./trusted-qa-run');

const DEFAULTS = Object.freeze({
    liveUrl: 'https://8223324090-production.up.railway.app',
    liveVersion: '0.80.148',
    liveCommit: 'cede1f8c0cab181828d753520b0d01ae3cffc8ca',
    sourceBranch: 'codex/checkbox-hardening-release-v080103',
    businessContext: 'event_genix',
    testAccountId: 48,
    roomResourceId: 'room-marvel',
    lineId: '932',
    date: '2026-08-19',
    from: '12:00',
    to: '18:00',
    ttlMinutes: 30,
    maxEntityCount: 40
});

const PREVIOUS_BOOKING_IDS = Object.freeze([
    'BK-2026-1095',
    'BK-2026-1096',
    'BK-2026-1097',
    'BK-2026-1098',
    'BK-2026-1099',
    'BK-2026-1100'
]);

const PREVIOUS_GROUP_IDS = Object.freeze([
    'BQ-MSU8882M-7AFA8523',
    'BQ-MSU888AG-22351CC8'
]);

function argValue(args, name, fallback = null) {
    const exact = args.find(value => value.startsWith(`${name}=`));
    if (exact) return exact.slice(name.length + 1);
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')
        ? args[index + 1]
        : fallback;
}

function sha256(value) {
    const payload = typeof value === 'string' ? value : JSON.stringify(stableValue(value));
    return crypto.createHash('sha256').update(payload).digest('hex');
}

function valueHash(value) {
    if (value === null || value === undefined || value === '') return null;
    return sha256(String(value)).slice(0, 16);
}

function parseOptions(argv = process.argv.slice(2)) {
    if (argv.includes('--apply') || argv.includes('--create')) {
        throw new Error('This manifest task is read-only and refuses apply/create flags.');
    }
    return {
        outputDir: argValue(argv, '--output-dir', 'output/task1-trusted-qa-plan-20260815'),
        liveUrl: argValue(argv, '--live-url', DEFAULTS.liveUrl),
        liveVersion: argValue(argv, '--live-version', DEFAULTS.liveVersion),
        liveCommit: argValue(argv, '--live-commit', DEFAULTS.liveCommit),
        sourceBranch: argValue(argv, '--source-branch', DEFAULTS.sourceBranch)
    };
}

async function tableReadable(client, tableName) {
    const result = await client.query(
        `WITH target AS (
            SELECT to_regclass($1) AS regclass
        )
        SELECT regclass,
               CASE
                   WHEN regclass IS NULL THEN false
                   ELSE has_table_privilege(current_user, regclass, 'SELECT')
               END AS can_select
          FROM target`,
        [`public.${tableName}`]
    );
    return Boolean(result.rows?.[0]?.regclass && result.rows?.[0]?.can_select);
}

async function optionalNeedleCount(client, tableName, needles) {
    if (!await tableReadable(client, tableName)) {
        return { table: tableName, readable: false, count: null };
    }
    const result = await client.query(
        `SELECT COUNT(*)::int AS count
           FROM ${tableName}
          WHERE ${needles.map((_, index) => `to_jsonb(${tableName})::text LIKE $${index + 1}`).join(' OR ')}`,
        needles.map(value => `%${value}%`)
    );
    return { table: tableName, readable: true, count: Number(result.rows?.[0]?.count || 0) };
}

async function optionalExactBookingCount(client, tableName, bookingIds, columnName = 'booking_id') {
    if (!await tableReadable(client, tableName)) {
        return { table: tableName, readable: false, count: null };
    }
    const result = await client.query(
        `SELECT COUNT(*)::int AS count
           FROM ${tableName}
          WHERE ${columnName} = ANY($1::text[])`,
        [bookingIds]
    );
    return { table: tableName, readable: true, count: Number(result.rows?.[0]?.count || 0) };
}

async function fingerprint(client, tableName, whereSql = '', params = []) {
    const result = await client.query(
        `SELECT COUNT(*)::int AS count,
                md5(COALESCE(string_agg(md5(to_jsonb(${tableName})::text), ',' ORDER BY ctid::text), '')) AS hash
           FROM ${tableName}
          ${whereSql}`,
        params
    );
    return { table: tableName, ...result.rows[0] };
}

async function loadState(client) {
    const needles = [...PREVIOUS_BOOKING_IDS, ...PREVIOUS_GROUP_IDS, 'qa-banquet-cancellation-20260819-04'];
    const previousBookings = await client.query(
        `SELECT id, status, COALESCE(business_context, $2) AS business_context,
                LEFT(date::text, 10) AS date, time, line_id, room_resource_id,
                linked_to, program_id, customer_id, updated_at
           FROM bookings
          WHERE id = ANY($1::text[])
          ORDER BY id`,
        [PREVIOUS_BOOKING_IDS, DEFAULTS.businessContext]
    );
    const previousGroups = await client.query(
        `SELECT id, status, primary_booking_id, LEFT(date::text, 10) AS date,
                room_resource_id, updated_at
           FROM banquet_groups
          WHERE id = ANY($1::text[])
          ORDER BY id`,
        [PREVIOUS_GROUP_IDS]
    );
    const products = await client.query(
        `SELECT id, is_active, updated_at
           FROM products
          WHERE id LIKE 'qa-banquet-cancel-20260819-%'
          ORDER BY id`
    );
    const customerCandidates = await client.query(
        `SELECT id, COALESCE(business_context, $1) AS business_context,
                COALESCE(source, '') AS source,
                md5(COALESCE(notes, '')) AS notes_hash
           FROM customers
          WHERE COALESCE(business_context, $1) = $1
            AND (
                LOWER(COALESCE(notes, '')) LIKE '%codex%qa%'
                OR LOWER(COALESCE(notes, '')) LIKE '%smoke%'
                OR LOWER(COALESCE(source, '')) LIKE '%test%'
            )
          ORDER BY id
          LIMIT 50`,
        [DEFAULTS.businessContext]
    );
    const line = await client.query(
        `SELECT line_id, LEFT(date::text, 10) AS date, name IS NOT NULL AS has_name, from_sheet
           FROM lines_by_date
          WHERE COALESCE(business_context, $1) = $1
            AND LEFT(date::text, 10) = $2
            AND line_id = $3`,
        [DEFAULTS.businessContext, DEFAULTS.date, DEFAULTS.lineId]
    );
    const room = await client.query(
        `SELECT resource_id, type, is_active
           FROM timeline_resources
          WHERE business_context = $1
            AND resource_id = $2`,
        [DEFAULTS.businessContext, DEFAULTS.roomResourceId]
    );
    const overlap = await client.query(
        `SELECT COUNT(*)::int AS count
           FROM bookings
          WHERE COALESCE(business_context, $1) = $1
            AND LEFT(date::text, 10) = $2
            AND LOWER(COALESCE(NULLIF(BTRIM(status), ''), 'confirmed')) NOT IN ('cancelled', 'canceled')
            AND (line_id = $3 OR room_resource_id = $4)
            AND time::time < $6::time
            AND (time::time + (COALESCE(duration, 0)::text || ' minutes')::interval) > $5::time`,
        [DEFAULTS.businessContext, DEFAULTS.date, DEFAULTS.lineId, DEFAULTS.roomResourceId, DEFAULTS.from, DEFAULTS.to]
    );
    const trustedQaRunsReadable = await tableReadable(client, 'trusted_qa_runs');
    const trustedQaEntitiesReadable = await tableReadable(client, 'trusted_qa_run_entities');
    const openTasks = await client.query(
        `SELECT COUNT(*)::int AS count
           FROM tasks
          WHERE (
                (source_type = 'booking' AND source_id = ANY($1::text[]))
                OR (source_entity_type = 'booking' AND source_entity_id = ANY($1::text[]))
                OR (related_entity_type = 'booking' AND related_entity_id = ANY($1::text[]))
            )
            AND LOWER(COALESCE(NULLIF(BTRIM(status), ''), 'todo')) NOT IN ('done', 'archived', 'cancelled')`,
        [PREVIOUS_BOOKING_IDS]
    );
    const activeBookings = await client.query(
        `SELECT COUNT(*)::int AS count
           FROM bookings
          WHERE id = ANY($1::text[])
            AND LOWER(COALESCE(NULLIF(BTRIM(status), ''), 'confirmed')) NOT IN ('cancelled', 'canceled')`,
        [PREVIOUS_BOOKING_IDS]
    );
    const activeGroups = await client.query(
        `SELECT COUNT(*)::int AS count
           FROM banquet_groups
          WHERE id = ANY($1::text[])
            AND LOWER(COALESCE(NULLIF(BTRIM(status), ''), 'active')) NOT IN ('cancelled', 'canceled')`,
        [PREVIOUS_GROUP_IDS]
    );
    const activeProducts = await client.query(
        `SELECT COUNT(*)::int AS count
           FROM products
          WHERE id = 'qa-banquet-cancel-20260819-04'
            AND COALESCE(is_active, true) IS TRUE`
    );
    const sideEffectCounts = [
        { table: 'bookings_active', readable: true, count: Number(activeBookings.rows?.[0]?.count || 0) },
        { table: 'banquet_groups_active', readable: true, count: Number(activeGroups.rows?.[0]?.count || 0) },
        { table: 'products_active', readable: true, count: Number(activeProducts.rows?.[0]?.count || 0) },
        { table: 'open_tasks', readable: true, count: Number(openTasks.rows?.[0]?.count || 0) },
        await optionalExactBookingCount(client, 'finance_transactions', PREVIOUS_BOOKING_IDS),
        await optionalExactBookingCount(client, 'receipts', PREVIOUS_BOOKING_IDS),
        await optionalNeedleCount(client, 'certificates', needles),
        await optionalNeedleCount(client, 'outbox_events', needles),
        await optionalNeedleCount(client, 'event_queue', needles),
        await optionalNeedleCount(client, 'rule_execution_log', needles),
        await optionalNeedleCount(client, 'notification_outbox', needles),
        await optionalNeedleCount(client, 'warehouse_stock_movements', needles),
        await optionalNeedleCount(client, 'loyalty_transactions', needles),
        await optionalNeedleCount(client, 'gamification_events', needles),
        await optionalNeedleCount(client, 'chat_channels', needles),
        await optionalNeedleCount(client, 'announcements', needles),
        await optionalNeedleCount(client, 'print_jobs', needles)
    ];
    return {
        previousBookings: previousBookings.rows,
        previousGroups: previousGroups.rows,
        products: products.rows,
        customerCandidates: customerCandidates.rows,
        line: line.rows,
        room: room.rows,
        overlap: overlap.rows[0],
        privileges: {
            trustedQaRunsReadable,
            trustedQaEntitiesReadable
        },
        previousRunPostconditions: {
            sideEffectCounts,
            readableCountsMatchedZero: sideEffectCounts
                .filter(row => row.readable)
                .every(row => Number(row.count || 0) === 0)
        }
    };
}

function chooseCustomerId(state) {
    const previousCustomerIds = [...new Set(state.previousBookings
        .map(row => Number(row.customer_id))
        .filter(value => Number.isInteger(value) && value > 0))];
    if (previousCustomerIds.length === 1) {
        const candidate = state.customerCandidates.find(row => Number(row.id) === previousCustomerIds[0]);
        if (candidate) return previousCustomerIds[0];
    }
    if (previousCustomerIds.length === 0 && state.customerCandidates.length === 1) {
        return Number(state.customerCandidates[0].id);
    }
    throw new Error('Unable to derive exact QA customer from previous QA records and sanitized customer evidence.');
}

function nextQaProductId(products) {
    const next = products.reduce((max, row) => {
        const match = String(row.id || '').match(/^qa-banquet-cancel-20260819-(\d+)$/);
        return match ? Math.max(max, Number(match[1])) : max;
    }, 4) + 1;
    return `qa-banquet-cancel-20260819-${String(next).padStart(2, '0')}`;
}

function buildPlan(state, options, generatedAt) {
    const productId = nextQaProductId(state.products);
    return {
        schemaVersion: 1,
        generatedAt,
        sourceCommit: options.liveCommit,
        sourceBranch: options.sourceBranch,
        liveUrl: options.liveUrl,
        liveVersion: options.liveVersion,
        runId: productId.replace('qa-banquet-cancel-', 'qa-banquet-cancellation-'),
        businessContext: DEFAULTS.businessContext,
        testAccountId: DEFAULTS.testAccountId,
        operatorUserId: DEFAULTS.testAccountId,
        customerId: chooseCustomerId(state),
        programId: productId,
        roomResourceId: DEFAULTS.roomResourceId,
        lineId: DEFAULTS.lineId,
        timeWindow: { date: DEFAULTS.date, from: DEFAULTS.from, to: DEFAULTS.to },
        ttlMinutes: DEFAULTS.ttlMinutes,
        maxEntityCount: DEFAULTS.maxEntityCount,
        allowedEndpoints: [
            'POST /api/bookings',
            'POST /api/bookings/full'
        ],
        expectedEntityTypes: [
            'banquet_group',
            'banquet_membership',
            'booking',
            'booking_banquet_link',
            'product'
        ],
        qaProduct: {
            create: true,
            id: productId,
            code: `QABQ${productId.slice(-2)}`,
            label: `QA Banquet Cancel ${productId.slice(-2)}`,
            category: 'animation',
            duration: 60,
            stockRequirementsAllowed: false
        },
        scenarios: {
            api: [
                'standalone cancellation',
                'payment-method-only cancellation',
                'priced unpaid activity',
                'canonical unpaid finance row',
                'banquet activity removal',
                'full unpaid banquet cancellation',
                'generic delete returns BANQUET_ROUTE_REQUIRED',
                'repeated cancellation no-op',
                'fake client marker returns 403'
            ],
            browser: [
                'group-aware CTAs',
                'fail-closed readiness',
                'structured 409',
                'double-click single-flight',
                'Escape confirm',
                'two-tab WebSocket invalidation'
            ]
        },
        cleanupPolicy: 'exact_registered_entities_v1',
        cleanupPostconditions: [
            'zero active QA bookings/groups/products',
            'zero open tasks/subtasks/observers',
            'zero finance/receipt/certificate leftovers',
            'zero outbox/event/rule/notification leftovers',
            'zero stock/customer/loyalty/gamification/chat/announcement/print leftovers',
            'repeated cleanup is success no-op'
        ],
        recoveryPlan: 'If any mutation phase fails, stop further mutation, run scripts/trusted-qa-run.js --mode cleanup for the exact run database id, then repeat cleanup once for idempotency.',
        stopConditions: [
            'live version or commit drift',
            'time window overlap',
            'trusted QA registry unavailable for create preflight',
            'token replay or invalid token',
            'unexpected side effect',
            'cleanup transport failure without exact recovery handoff'
        ]
    };
}

async function main() {
    const options = parseOptions();
    if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL is required. Map PRODUCTION_READONLY_DATABASE_URL to DATABASE_URL for this read-only task.');
    }
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        max: 2
    });
    const generatedAt = new Date().toISOString();
    const client = await pool.connect();
    try {
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await client.query('SET LOCAL statement_timeout = 30000');
        const before = [
            await fingerprint(client, 'bookings', 'WHERE id = ANY($1::text[])', [PREVIOUS_BOOKING_IDS]),
            await fingerprint(client, 'banquet_groups', 'WHERE id = ANY($1::text[])', [PREVIOUS_GROUP_IDS]),
            await fingerprint(client, 'products', "WHERE id LIKE 'qa-banquet-cancel-20260819-%'")
        ];
        const state = await loadState(client);
        const plan = buildPlan(state, options, generatedAt);
        const after = [
            await fingerprint(client, 'bookings', 'WHERE id = ANY($1::text[])', [PREVIOUS_BOOKING_IDS]),
            await fingerprint(client, 'banquet_groups', 'WHERE id = ANY($1::text[])', [PREVIOUS_GROUP_IDS]),
            await fingerprint(client, 'products', "WHERE id LIKE 'qa-banquet-cancel-20260819-%'")
        ];
        await client.query('ROLLBACK');

        fs.mkdirSync(options.outputDir, { recursive: true });
        const planPath = path.join(options.outputDir, 'trusted-qa-plan.json');
        fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
        const canonical = readPlan(planPath);
        const hash = manifestHash(canonical);
        const sanitizedState = {
            previousBookings: state.previousBookings.map(row => ({
                ...row,
                customer_id_hash: valueHash(row.customer_id),
                customer_id: undefined
            })).map(row => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined))),
            previousGroups: state.previousGroups,
            products: state.products,
            customerCandidates: state.customerCandidates.map(row => ({
                id: row.id,
                business_context: row.business_context,
                source_class: String(row.source || '').toLowerCase().includes('test') ? 'test' : 'other',
                notes_hash: row.notes_hash
            })),
            line: state.line,
            room: state.room,
            overlap: state.overlap,
            privileges: state.privileges,
            previousRunPostconditions: state.previousRunPostconditions
        };
        const zeroMutation = {
            before,
            after,
            beforeHash: sha256(before),
            afterHash: sha256(after),
            matched: sha256(before) === sha256(after)
        };
        const bundle = {
            kind: 'trusted_qa_manifest_bundle',
            productionImpact: true,
            mutationAllowed: false,
            generatedAt,
            approvalText: `APPROVE TRUSTED QA RUN ${hash} FOR ACCOUNT 48, CONTEXT event_genix, ROOM room-marvel, LINE 932, DATE 2026-08-19, WINDOW 12:00-18:00, MAX ENTITIES 40, TTL 30.`,
            manifestHash: hash,
            plan,
            canonicalManifest: canonical,
            state: sanitizedState,
            zeroMutation
        };
        bundle.bundleHash = sha256({ ...bundle, bundleHash: undefined });
        fs.writeFileSync(path.join(options.outputDir, 'trusted-qa-manifest-bundle.json'), `${JSON.stringify(bundle, null, 2)}\n`);
        fs.writeFileSync(path.join(options.outputDir, 'approval.txt'), `${bundle.approvalText}\n`);
        process.stdout.write(JSON.stringify({
            generatedAt,
            manifestHash: hash,
            bundleHash: bundle.bundleHash,
            planPath,
            approvalText: bundle.approvalText,
            liveVersion: options.liveVersion,
            liveCommit: options.liveCommit,
            sourceBranch: options.sourceBranch,
            qaProductId: plan.programId,
            runId: plan.runId,
            customerIdHash: valueHash(plan.customerId),
            preflight: {
                previousBookings: state.previousBookings.length,
                previousGroups: state.previousGroups.length,
                previousProductCount: state.products.length,
                lineCount: state.line.length,
                roomCount: state.room.length,
                overlapCount: Number(state.overlap?.count || 0),
                trustedQaRegistryReadable: state.privileges.trustedQaRunsReadable,
                trustedQaEntitiesReadable: state.privileges.trustedQaEntitiesReadable,
                previousRunReadableCountsMatchedZero: state.previousRunPostconditions.readableCountsMatchedZero,
                previousRunSideEffectCounts: state.previousRunPostconditions.sideEffectCounts
            },
            zeroMutation
        }, null, 2) + '\n');
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
