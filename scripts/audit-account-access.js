#!/usr/bin/env node
'use strict';

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

const {
    ACTION_PERMISSIONS,
    NON_DELEGABLE_ACTIONS,
    ROLE_LEVEL,
    canUseAction
} = require('../middleware/auth');
const { BUSINESS_CONTEXT_SWITCH_ROLES } = require('../services/businessContext');

const DEFAULT_CONTEXT = 'event_genix';
const args = new Set(process.argv.slice(2));
const STRICT = args.has('--strict');
const REQUIRE_DB = args.has('--require-db');
const NON_DELEGABLE = Array.from(NON_DELEGABLE_ACTIONS || []);
const BUSINESS_SWITCH_ROLES = Array.from(BUSINESS_CONTEXT_SWITCH_ROLES || []);

function asArray(value) {
    if (Array.isArray(value)) return value.filter(Boolean).map(String);
    if (typeof value === 'string') return value.split(/[,;\s]+/).filter(Boolean);
    return [];
}

function roleLevel(role) {
    return ROLE_LEVEL[String(role || '').trim()] ?? -1;
}

function hasExplicitDbConfig() {
    return Boolean(process.env.DATABASE_URL || process.env.PGHOST || process.env.PGDATABASE || process.env.PGUSER);
}

function formatDbAuditError(err) {
    const messages = [];
    if (err?.message) messages.push(err.message);
    if (Array.isArray(err?.errors)) {
        for (const nested of err.errors) {
            if (nested?.message && !messages.includes(nested.message)) messages.push(nested.message);
        }
    }
    const summary = messages.filter(Boolean).slice(0, 4).join(' | ') || String(err || 'unknown error');
    if (!hasExplicitDbConfig()) {
        return `${summary} (no DATABASE_URL/PGHOST/PGDATABASE/PGUSER found in environment or .env)`;
    }
    return summary;
}

function inspectUser(row) {
    const issues = [];
    const actionAllowlist = asArray(row.action_allowlist);
    const extraRoles = asArray(row.extra_roles);
    const businessContexts = asArray(row.business_contexts);
    const nonDelegableAllow = actionAllowlist.filter(action => NON_DELEGABLE.includes(action));
    const highExtraRoles = extraRoles.filter(role => roleLevel(role) >= roleLevel('director'));

    if (nonDelegableAllow.length) {
        issues.push(`non-delegable allowlist: ${nonDelegableAllow.join(',')}`);
    }
    if (row.role !== 'creator' && highExtraRoles.length) {
        issues.push(`high extra_roles on non-creator: ${highExtraRoles.join(',')}`);
    }
    if (row.role === 'art_director' && canUseAction(row, 'manage_accounts')) {
        issues.push('art_director still has effective manage_accounts');
    }
    if (!BUSINESS_SWITCH_ROLES.includes(row.role)) {
        const nonDefaultContexts = businessContexts.filter(ctx => ctx !== DEFAULT_CONTEXT);
        if (nonDefaultContexts.length) {
            issues.push(`non-switch-role business_contexts ignored by policy: ${businessContexts.join(',')}`);
        }
    }
    return issues;
}

async function tableColumns(pool, tableName) {
    const result = await pool.query(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_name = $1`,
        [tableName]
    );
    return new Set(result.rows.map(row => row.column_name));
}

async function main() {
    console.log('Account access static policy audit');
    console.log(`nonDelegableActions=${NON_DELEGABLE.join(',')}`);
    console.log(`manage_accounts roles=${(ACTION_PERMISSIONS.manage_accounts || []).join(',')}`);
    console.log(`businessContextSwitchRoles=${BUSINESS_SWITCH_ROLES.join(',')}`);

    let findings = 0;
    try {
        const { pool } = require('../db');
        const userColumns = await tableColumns(pool, 'users');
        const selectedUserColumns = [
            'id',
            'username',
            'name',
            'role',
            'extra_roles',
            'action_allowlist',
            'action_denylist',
            'business_contexts',
            'default_business_context',
            'is_active'
        ].filter(column => userColumns.has(column));
        const users = await pool.query(
            `SELECT ${selectedUserColumns.map(column => `u.${column}`).join(', ')}
               FROM users u
              ORDER BY COALESCE(u.is_active, true) DESC, lower(COALESCE(NULLIF(u.name, ''), u.username)), u.id`
        );
        console.log(`DB users audited=${users.rows.length}`);
        for (const user of users.rows) {
            const issues = inspectUser(user);
            if (!issues.length) continue;
            findings += issues.length;
            console.log(`WARN user=${user.username} role=${user.role}: ${issues.join(' | ')}`);
        }

        const staffColumns = await tableColumns(pool, 'staff');
        const profileColumns = await tableColumns(pool, 'employee_profiles');
        if (staffColumns.has('is_active') && profileColumns.has('user_id') && profileColumns.has('staff_id')) {
            const staffName = staffColumns.has('name') ? 's.name' : 's.id::text';
            const inactivePredicates = ['COALESCE(s.is_active, true) = false'];
            if (staffColumns.has('termination_date')) inactivePredicates.push('s.termination_date IS NOT NULL');
            if (staffColumns.has('hr_pool_status')) inactivePredicates.push("COALESCE(s.hr_pool_status, 'core') = 'blacklisted'");
            const inactiveStaff = await pool.query(
                `SELECT u.username, u.role, ${staffName} AS staff_name, s.id AS staff_id
                   FROM users u
                   JOIN employee_profiles ep ON ep.user_id = u.id
                   JOIN staff s ON s.id = ep.staff_id
                  WHERE COALESCE(u.is_active, true) = true
                    AND COALESCE(ep.is_active, true) = true
                    AND (${inactivePredicates.join(' OR ')})
                  ORDER BY u.username`
            );
            for (const row of inactiveStaff.rows) {
                findings += 1;
                console.log(`WARN active CRM account linked to inactive staff: user=${row.username} staff=${row.staff_name} staff_id=${row.staff_id}`);
            }
        } else {
            console.log('DB staff linkage audit skipped: required staff/employee_profiles columns are missing.');
        }
        await pool.end().catch(() => {});
    } catch (err) {
        console.log(`DB account audit skipped: ${formatDbAuditError(err)}`);
        if (REQUIRE_DB) process.exitCode = 1;
        return;
    }

    if (findings) {
        console.log(`Account access audit findings=${findings}`);
        if (STRICT) process.exitCode = 1;
    } else {
        console.log('Account access audit found no issues.');
    }
}

main().catch(err => {
    console.error(err.stack || err.message || err);
    process.exitCode = 1;
});
