#!/usr/bin/env node
'use strict';

const { pool } = require('../db');

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

function count(rows) {
    return Array.isArray(rows) ? rows.length : 0;
}

async function optionalQuery(client, sql, params = []) {
    try {
        const result = await client.query(sql, params);
        return result.rows || [];
    } catch (err) {
        if (/does not exist|undefined_table|undefined_column/i.test(String(err.message || err.code || ''))) {
            return [];
        }
        throw err;
    }
}

async function main() {
    if (process.argv.includes('--apply')) {
        throw new Error('Apply is intentionally not implemented. Production cleanup requires exact manifest approval.');
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN READ ONLY');
        const bookings = await optionalQuery(client, `
            SELECT id, status, business_context, date, room, room_resource_id, linked_to,
                   price, paid_amount, payment_status, payment_method, certificate_id,
                   created_by, created_at, updated_at
              FROM bookings
             WHERE id = ANY($1::text[])
             ORDER BY id
        `, [TARGET_BOOKING_IDS]);
        const memberships = await optionalQuery(client, `
            SELECT group_id, booking_id, role, sort_order
              FROM banquet_group_bookings
             WHERE group_id = ANY($1::text[]) OR booking_id = ANY($2::text[])
             ORDER BY group_id, sort_order, booking_id
        `, [TARGET_GROUP_IDS, TARGET_BOOKING_IDS]);
        const groups = await optionalQuery(client, `
            SELECT id, status, business_context, primary_booking_id, date, room, room_resource_id, updated_at
              FROM banquet_groups
             WHERE id = ANY($1::text[])
             ORDER BY id
        `, [TARGET_GROUP_IDS]);
        const finance = await optionalQuery(client, `
            SELECT id, booking_id, type, amount, payment_method, certificate_id, created_at
              FROM finance_transactions
             WHERE booking_id = ANY($1::text[])
             ORDER BY booking_id, id
        `, [TARGET_BOOKING_IDS]);
        const receipts = await optionalQuery(client, `
            SELECT id, booking_id, transaction_id, amount, created_at
              FROM receipts
             WHERE booking_id = ANY($1::text[])
             ORDER BY booking_id, id
        `, [TARGET_BOOKING_IDS]);
        const deposits = await optionalQuery(client, `
            SELECT id, banquet_group_id, primary_booking_id, status, paid_amount,
                   accountant_task_id, verified_at, verified_by
              FROM banquet_deposits
             WHERE banquet_group_id = ANY($1::text[]) OR primary_booking_id = ANY($2::text[])
             ORDER BY id
        `, [TARGET_GROUP_IDS, TARGET_BOOKING_IDS]);
        const tasks = await optionalQuery(client, `
            SELECT id, source_type, source_id, status, created_by, updated_at, control_meta
              FROM tasks
             WHERE source_type = 'booking'
               AND source_id = ANY($1::text[])
             ORDER BY source_id, id
        `, [TARGET_BOOKING_IDS]);
        const stock = await optionalQuery(client, `
            SELECT psr.product_id, psr.stock_id, psr.quantity
              FROM product_stock_requirements psr
              JOIN bookings b ON b.program_id::text = psr.product_id::text
             WHERE b.id = ANY($1::text[])
             ORDER BY b.id, psr.stock_id
        `, [TARGET_BOOKING_IDS]);
        const outbox = await optionalQuery(client, `
            SELECT id, aggregate_type, aggregate_id, event_type, published_at
              FROM outbox_events
             WHERE aggregate_id = ANY($1::text[])
             ORDER BY id
        `, [TARGET_BOOKING_IDS]);
        const activeBookings = bookings.filter(row => String(row.status || 'confirmed').toLowerCase() !== 'cancelled');
        const machineTodoTasks = tasks.filter(row => (
            !['done', 'archived', 'cancelled'].includes(String(row.status || 'todo').toLowerCase())
            && /system|codex|automation|smoke|rule|service/i.test(String(row.created_by || '') + ' ' + JSON.stringify(row.control_meta || {}))
        ));
        const manifest = {
            mode: 'dry-run',
            targetBookingIds: TARGET_BOOKING_IDS,
            targetGroupIds: TARGET_GROUP_IDS,
            counts: {
                bookings: count(bookings),
                activeBookings: count(activeBookings),
                memberships: count(memberships),
                groups: count(groups),
                financeRows: count(finance),
                receipts: count(receipts),
                deposits: count(deposits),
                bookingTasks: count(tasks),
                machineTodoTasks: count(machineTodoTasks),
                stockDependencies: count(stock),
                outboxEvents: count(outbox)
            },
            plan: {
                alreadyCancelledReviewOnly: ['BK-2026-0666', 'BK-2026-0667', 'BK-2026-0668'],
                canonicalCancellationCandidates: ['BK-2026-0663', 'BK-2026-0664', 'BK-2026-0665'],
                blockedUntilOwnerDecision: [{
                    bookingId: 'BK-2026-0662',
                    groupId: 'BQ-MROUEOJA-35896807',
                    reason: 'deposit_21_owner_decision_required'
                }]
            },
            postcondition: 'No mutations were executed.'
        };
        await client.query('ROLLBACK');
        process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch(err => {
    console.error(err.message);
    process.exit(1);
});
