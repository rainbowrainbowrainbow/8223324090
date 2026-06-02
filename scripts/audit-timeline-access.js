#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function loadEnvFile() {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
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

const { ACTION_PERMISSIONS } = require('../middleware/auth');
const { DEFAULT_TIMELINE_CONTEXT, canUseTimelineAction } = require('../services/timelineContext');
const { canEditBooking } = require('../services/bookingVisibility');

const args = new Set(process.argv.slice(2));
const REQUIRE_DB = args.has('--require-db');
const REQUIRE_NAMED = args.has('--require-named');

const OPERATIONAL_BOOKING_ROLES = [
    'creator',
    'director',
    'vice_director',
    'senior_manager',
    'manager',
    'accountant',
    'hr',
    'admin'
];

const NAMED_ACCOUNT_TERMS = [
    'dasha',
    'daria',
    'даша',
    'дар',
    'vital',
    'vitalina',
    'віт',
    'витал'
];

function roleAudit(role) {
    const actor = { id: 1000, username: `${role}-audit`, name: role, role };
    const booking = { id: 'BK-AUDIT', created_by: 'other', linked_to: null };
    return {
        role,
        createBooking: ACTION_PERMISSIONS.create_booking.includes(role),
        editBooking: ACTION_PERMISSIONS.edit_booking.includes(role),
        softDeleteBooking: ACTION_PERMISSIONS.delete_booking.includes(role),
        parkDeleteAction: canUseTimelineAction(actor, DEFAULT_TIMELINE_CONTEXT, 'delete'),
        bookingEditGuard: canEditBooking(actor, booking)
    };
}

function passesTimelineAccess(row) {
    return row.createBooking
        && row.editBooking
        && row.softDeleteBooking
        && row.parkDeleteAction
        && row.bookingEditGuard;
}

function pickUserColumns(columns) {
    return [
        'id',
        'username',
        'name',
        'role',
        'roles',
        'extra_roles',
        'page_allowlist',
        'business_contexts',
        'business_context',
        'default_business_context',
        'forced_business_context',
        'is_active'
    ].filter(column => columns.has(column));
}

async function queryUsers() {
    const { pool } = require('../db');
    try {
        const columnRows = await pool.query(
            `SELECT column_name
               FROM information_schema.columns
              WHERE table_name = 'users'
              ORDER BY ordinal_position`
        );
        const columns = new Set(columnRows.rows.map(row => row.column_name));
        const selected = pickUserColumns(columns);
        if (!selected.includes('username') || !selected.includes('role')) {
            return { users: [], warning: 'users table does not expose username/role columns' };
        }

        const terms = NAMED_ACCOUNT_TERMS.map(term => `%${term}%`);
        const result = await pool.query(
            `SELECT ${selected.map(column => `u.${column}`).join(', ')}
               FROM users u
              WHERE u.role = ANY($1)
                 OR LOWER(COALESCE(u.username, '')) LIKE ANY($2)
                 OR LOWER(COALESCE(u.name, '')) LIKE ANY($2)
              ORDER BY u.role, u.username`,
            [OPERATIONAL_BOOKING_ROLES, terms]
        );
        return { users: result.rows, columns: selected };
    } finally {
        await pool.end().catch(() => {});
    }
}

async function main() {
    const staticAudit = OPERATIONAL_BOOKING_ROLES.map(roleAudit);
    const staticFailures = staticAudit.filter(row => !passesTimelineAccess(row));

    console.log('Timeline access static audit');
    for (const row of staticAudit) {
        console.log(`${passesTimelineAccess(row) ? 'OK' : 'FAIL'} ${row.role} create=${row.createBooking} edit=${row.editBooking} softDelete=${row.softDeleteBooking} parkDelete=${row.parkDeleteAction} editGuard=${row.bookingEditGuard}`);
    }

    if (staticFailures.length) {
        process.exitCode = 1;
        return;
    }

    try {
        const { users, warning } = await queryUsers();
        if (warning) console.log(`DB warning: ${warning}`);
        const named = [];
        console.log(`DB user audit rows=${users.length}`);
        for (const user of users) {
            const audit = roleAudit(user.role);
            const nameText = `${user.username || ''} ${user.name || ''}`.toLowerCase();
            const isNamed = NAMED_ACCOUNT_TERMS.some(term => nameText.includes(term));
            if (isNamed) named.push(user);
            console.log(`${passesTimelineAccess(audit) ? 'OK' : 'FAIL'} user=${user.username} name="${user.name || ''}" role=${user.role} named=${isNamed}`);
            if (OPERATIONAL_BOOKING_ROLES.includes(user.role) && !passesTimelineAccess(audit)) process.exitCode = 1;
        }
        if (!named.length) {
            console.log('Named account audit: no Dasha/Vitalina-like accounts found in this DB query.');
            if (REQUIRE_NAMED) process.exitCode = 1;
        }
    } catch (err) {
        console.log(`DB user audit skipped: ${err.message || err}`);
        if (REQUIRE_DB) process.exitCode = 1;
    }
}

main().catch(err => {
    console.error(err.stack || err.message || err);
    process.exitCode = 1;
});
