#!/usr/bin/env node
'use strict';

// The CLI prepares a private review artifact only. There is deliberately no production apply command.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { assertSafeTestDatabaseUrl } = require('./test-db-safety');
const TABLES = Object.freeze(['hr_professions', 'hr_profession_checklist_items',
    'hr_staff_profession_checklist_progress', 'staff_role_assignments', 'onboarding_templates', 'onboarding_progress']);
const ORDER = Object.freeze(['hr_professions', 'onboarding_templates', 'hr_profession_checklist_items',
    'staff_role_assignments', 'hr_staff_profession_checklist_progress', 'onboarding_progress']);
const REQUIRED_COLUMNS = Object.freeze({
    hr_professions: ['id', 'key', 'structure_node_id', 'is_active'],
    hr_profession_checklist_items: ['id', 'profession_id', 'is_active'],
    hr_staff_profession_checklist_progress: ['id', 'profession_key', 'staff_id', 'checklist_item_id'],
    staff_role_assignments: ['id', 'profession_key', 'staff_id'],
    onboarding_templates: ['id'],
    onboarding_progress: ['id', 'profession_key', 'staff_id', 'template_id']
});
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identifier = value => {
    if (!/^[a-z_]+$/.test(value)) throw new Error('INVALID_INVENTORY_IDENTIFIER');
    return '"' + value + '"';
};
function targetOwner(input) {
    const owner = { businessId: Number(input.businessId), organizationId: Number(input.organizationId) };
    if (!Object.values(owner).every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('INVALID_OWNER_TARGET');
    return owner;
}
function preparePlan(inventory, input) {
    const owner = targetOwner(input);
    const tables = {};
    for (const table of TABLES) {
        const data = inventory.tables?.[table];
        if (!data || JSON.stringify(data.primaryKey) !== '["id"]' || !data.columns?.includes('id')
            || !Array.isArray(data.rows) || data.count !== data.rows.length || digest(data.rows) !== data.fingerprint) {
            throw new Error('INVENTORY_FINGERPRINT_MISMATCH');
        }
        if (!REQUIRED_COLUMNS[table].every(column => data.columns.includes(column))
            || data.rows.some(row => data.columns.some(column => !Object.hasOwn(row, column)))) {
            throw new Error('INVENTORY_STRUCTURAL_FIELDS_REQUIRED');
        }
        data.columns.forEach(identifier);
        if (!data.rows.every(row => /^[1-9]\d*$/.test(String(row.id)))
            || new Set(data.rows.map(row => String(row.id))).size !== data.count) throw new Error('INVALID_INVENTORY_KEYS');
        tables[table] = { ...data, ids: data.rows.map(row => String(row.id)) };
    }
    return { version: 1, owner, inventoryAtUtc: inventory.atUtc, tables };
}
async function freezeInventory(db) {
    const inventory = { atUtc: new Date().toISOString(), tables: {} };
    for (const table of TABLES) {
        const primaryKey = (await db.query(`SELECT a.attname AS column_name FROM pg_catalog.pg_index i
            JOIN pg_catalog.pg_class t ON t.oid=i.indrelid
            JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
            JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,ord) ON true
            JOIN pg_catalog.pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum
            WHERE n.nspname='public' AND t.relname=$1 AND i.indisprimary ORDER BY k.ord`, [table])).rows.map(row => row.column_name);
        if (JSON.stringify(primaryKey) !== '["id"]') throw new Error('HR_OWNER_PRIMARY_KEY_DRIFT');
        const available = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", [table])).rows.map(row => row.column_name);
        const columns = ['id', ...['key', 'profession_id', 'profession_key', 'staff_id', 'checklist_item_id', 'template_id', 'structure_node_id', 'is_active'].filter(key => available.includes(key))];
        const rows = (await db.query('SELECT ' + columns.map(identifier).join(',') + ' FROM public.' + identifier(table) + ' ORDER BY id')).rows;
        inventory.tables[table] = { primaryKey, columns, count: rows.length, fingerprint: digest(rows), rows };
    }
    return inventory;
}
async function verifyInventory(db, plan) {
    for (const table of TABLES) {
        const entry = plan.tables[table];
        const rows = (await db.query('SELECT ' + entry.columns.map(identifier).join(',') + ' FROM public.' + identifier(table) + ' ORDER BY id')).rows;
        if (rows.length !== entry.count || digest(rows) !== entry.fingerprint) throw new Error('HR_OWNER_INVENTORY_DRIFT');
    }
}
async function verifyTarget(db, plan) {
    const result = await db.query(`SELECT b.id FROM businesses b JOIN organizations o ON o.id=b.organization_id
        WHERE b.id=$1 AND b.organization_id=$2 AND b.context_key='event_genix' AND b.status='active' AND o.status='active'`,
    [plan.owner.businessId, plan.owner.organizationId]);
    if (result.rows.length !== 1) throw new Error('HR_OWNER_REGISTRY_MISMATCH');
}
async function disposableTransaction(pool, env, work) {
    assert.equal(env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assert.notEqual(env.NODE_ENV, 'production');
    assert.ok(!Object.entries(env).some(([key, value]) => key.startsWith('RAILWAY_') && String(value || '').trim()));
    const target = assertSafeTestDatabaseUrl(env.TEST_DATABASE_URL, env);
    assert.equal(target.isLocal, true, 'Ownership write tests are limited to loopback disposable PostgreSQL');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        assert.equal((await client.query('SELECT current_database() AS name')).rows[0].name, target.databaseName);
        await client.query("SELECT pg_advisory_xact_lock(hashtext('park-hr-ownership-v1'))");
        await client.query('LOCK TABLE ' + TABLES.map(table => 'public.' + identifier(table)).join(',') + ' IN SHARE ROW EXCLUSIVE MODE');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally { client.release(); }
}
async function applyDisposablePlan(pool, plan, env, options = {}) {
    return disposableTransaction(pool, env, async db => {
        await verifyTarget(db, plan);
        await verifyInventory(db, plan);
        const receipt = { version: 1, plan, changedIds: {}, atUtc: new Date().toISOString() };
        for (const table of ORDER) {
            const rows = (await db.query('SELECT id, business_id, organization_id FROM public.' + identifier(table) + ' ORDER BY id FOR UPDATE')).rows;
            if (rows.some(row => !(row.business_id == null && row.organization_id == null)
                && !(Number(row.business_id) === plan.owner.businessId && Number(row.organization_id) === plan.owner.organizationId))) {
                throw new Error('HR_OWNER_FOREIGN_OR_AMBIGUOUS_ROW');
            }
            const ids = rows.filter(row => row.business_id == null).map(row => String(row.id));
            receipt.changedIds[table] = ids;
            if (ids.length) {
                const result = await db.query('UPDATE public.' + identifier(table) + ' SET business_id=$1, organization_id=$2 WHERE id=ANY($3::bigint[]) AND business_id IS NULL AND organization_id IS NULL',
                    [plan.owner.businessId, plan.owner.organizationId, ids]);
                if (result.rowCount !== ids.length) throw new Error('HR_OWNER_UPDATE_COUNT_MISMATCH');
            }
            if (options.failAfterTable === table) throw new Error('DISPOSABLE_INJECTED_BACKFILL_FAILURE');
        }
        return receipt;
    });
}
async function rollbackDisposablePlan(pool, receipt, env) {
    return disposableTransaction(pool, env, async db => {
        await verifyTarget(db, receipt.plan);
        await verifyInventory(db, receipt.plan);
        for (const table of [...ORDER].reverse()) {
            const ids = receipt.changedIds[table] || [];
            if (!ids.length) continue;
            const result = await db.query('UPDATE public.' + identifier(table) + ' SET business_id=NULL, organization_id=NULL WHERE id=ANY($1::bigint[]) AND business_id=$2 AND organization_id=$3',
                [ids, receipt.plan.owner.businessId, receipt.plan.owner.organizationId]);
            if (result.rowCount !== ids.length) throw new Error('HR_OWNER_ROLLBACK_COUNT_MISMATCH');
        }
        return { restored: true };
    });
}
function main(args) {
    const readArg = key => { const index = args.indexOf(key); if (index < 0 || !args[index + 1]) throw new Error('EXPECTED_PLAN_ARGUMENT'); return args[index + 1]; };
    if (args[0] !== '--plan' || args.some(arg => /^--apply/.test(arg))) throw new Error('CLI_SUPPORTS_PRIVATE_PLAN_ONLY');
    const inventory = JSON.parse(fs.readFileSync(readArg('--inventory'), 'utf8'));
    const registry = JSON.parse(fs.readFileSync(readArg('--registry-receipt'), 'utf8'));
    const plan = preparePlan(inventory, { businessId: registry.snapshot?.park?.id, organizationId: registry.snapshot?.organizationId });
    const output = path.resolve(readArg('--out'));
    const relative = path.relative(path.resolve(__dirname, '..'), output);
    if (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) throw new Error('PRIVATE_PLAN_MUST_STAY_OUTSIDE_GIT');
    fs.writeFileSync(output, JSON.stringify(plan, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ status: 'PREPARED_NOT_APPLIED', tables: Object.fromEntries(TABLES.map(table => [table, { count: plan.tables[table].count, fingerprint: plan.tables[table].fingerprint }])) }));
}
if (require.main === module) { try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { TABLES, ORDER, REQUIRED_COLUMNS, digest, targetOwner, preparePlan, freezeInventory, verifyInventory, applyDisposablePlan, rollbackDisposablePlan };
