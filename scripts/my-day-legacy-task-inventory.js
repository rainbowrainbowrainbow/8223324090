#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { Pool } = require('pg');

const LEGACY_ROWS_SQL = `
    WITH subtasks AS (
        SELECT task_id, COUNT(*)::int AS count FROM public.task_subtasks GROUP BY task_id
    ), duplicates AS (
        SELECT business_context, owner_user_id, lower(btrim(title)) AS title_key
        FROM public.tasks WHERE COALESCE(btrim(title), '') <> ''
        GROUP BY 1, 2, 3 HAVING COUNT(*) > 1
    )
    SELECT t.id, t.business_context, t.status, t.task_kind, t.source_type, t.source_module,
        COALESCE(s.count, 0) AS subtask_count, t.archived_at IS NOT NULL AS archived,
        t.duplicate_of_task_id, d.title_key IS NOT NULL AS duplicate_title,
        (NULLIF(t.source_id, '') IS NOT NULL OR NULLIF(t.source_entity_id, '') IS NOT NULL
            OR NULLIF(t.related_entity_id, '') IS NOT NULL) AS external_link,
        (LOWER(COALESCE(t.created_by, '')) IN ('system', 'scheduler', 'rule_engine', 'kleshnya', 'task_lifecycle', 'attendance-review-scheduler')
            OR LOWER(COALESCE(t.type, '')) IN ('auto', 'auto_complete', 'recurring')
            OR LOWER(COALESCE(t.source_type, '')) IN ('booking', 'recurring', 'attendance', 'hermes', 'integration', 'automation', 'trigger', 'onboarding')
            OR LOWER(COALESCE(t.source_module, '')) IN ('booking', 'recurring', 'attendance', 'hermes', 'integration', 'automation', 'trigger', 'hr_onboarding')
            OR t.control_meta->>'systemGenerated' = 'true') AS system
    FROM public.tasks t
    LEFT JOIN subtasks s ON s.task_id = t.id
    LEFT JOIN duplicates d ON d.business_context IS NOT DISTINCT FROM t.business_context
        AND d.owner_user_id IS NOT DISTINCT FROM t.owner_user_id AND d.title_key = lower(btrim(t.title))
    ORDER BY t.id
`;

const REFERENCES_SQL = `
    WITH fks AS (
        SELECT c.conrelid AS table_id, a.attname AS column_name,
            CASE WHEN cardinality(c.conkey) = 1 AND target.attname = 'id' THEN c.confdeltype::text ELSE 'manual' END AS action
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        JOIN pg_attribute target ON target.attrelid = c.confrelid AND target.attnum = c.confkey[1]
        WHERE c.contype = 'f' AND c.confrelid = 'public.tasks'::regclass
    ), soft_links AS (
        SELECT a.attrelid AS table_id, a.attname AS column_name, 'application' AS action
        FROM pg_attribute a
        JOIN pg_class r ON r.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace AND n.nspname = 'public'
        WHERE a.attnum > 0 AND NOT a.attisdropped AND (r.relname, a.attname) IN (
            ('meeting_action_items', 'task_id'), ('event_reviews', 'follow_up_task_id'),
            ('task_watchdog_events', 'task_id'), ('notification_outbox', 'task_id'),
            ('trusted_qa_run_side_effects', 'task_id'), ('hr_onboarding_progress', 'task_id')
        ) AND NOT EXISTS (SELECT 1 FROM fks WHERE table_id = a.attrelid AND column_name = a.attname)
    )
    SELECT n.nspname AS schema_name, r.relname AS table_name, l.column_name, l.action,
        has_table_privilege(r.oid, 'SELECT') AS readable
    FROM (SELECT * FROM fks UNION ALL SELECT * FROM soft_links) l
    JOIN pg_class r ON r.oid = l.table_id
    JOIN pg_namespace n ON n.oid = r.relnamespace
    ORDER BY 1, 2, 3
`;

const quote = name => '"' + name.replaceAll('"', '""') + '"';
const DELETE_ACTION = { a: 'no_action', r: 'restrict', c: 'cascade', n: 'set_null', d: 'set_default' };

async function inventory(pool) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await client.query("SET LOCAL statement_timeout = '30s'");
        if ((await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only !== 'on') {
            throw new Error('Transaction is not read only.');
        }
        const { rows } = await client.query(LEGACY_ROWS_SQL);
        const { rows: constraints } = await client.query(REFERENCES_SQL);
        const missing = constraints.filter(entry => !entry.readable || entry.action === 'manual');
        const refsById = new Map();
        const ids = rows.filter(row => row.system || row.subtask_count || row.task_kind === 'checklist').map(row => row.id);
        for (const entry of constraints) {
            if (!entry.readable || entry.action === 'manual' || !ids.length) continue;
            const column = quote(entry.column_name);
            const table = quote(entry.schema_name) + '.' + quote(entry.table_name);
            const { rows: refs } = await client.query(`
                SELECT ${column} AS task_id, COUNT(*)::int AS count
                FROM ${table} WHERE ${column} = ANY($1::int[]) GROUP BY ${column}
            `, [ids]);
            for (const row of refs) {
                const id = Number(row.task_id);
                const links = refsById.get(id) || [];
                links.push({ table: entry.table_name, column: entry.column_name,
                    action: DELETE_ACTION[entry.action] || entry.action, count: row.count });
                refsById.set(id, links);
            }
        }
        const counts = { hasSubtasks: 0, checklistWithoutSubtasks: 0, linkedSystem: 0 };
        const tasks = [];
        for (const row of rows) {
            const references = refsById.get(row.id) || [];
            const linked = row.external_link || references.some(ref => ref.table !== 'task_subtasks');
            const cohorts = [];
            if (row.subtask_count) cohorts.push('hasSubtasks');
            else if (row.task_kind === 'checklist') cohorts.push('checklistWithoutSubtasks');
            if (row.system && linked) cohorts.push('linkedSystem');
            if (!cohorts.length) continue;
            for (const cohort of cohorts) counts[cohort]++;

            const exclusions = [];
            if (row.system) exclusions.push('system provenance');
            if (linked) exclusions.push('application or database links');
            if (row.duplicate_of_task_id || row.duplicate_title) exclusions.push('duplicate link or matching title in the same scope');
            if (row.archived || ['done', 'completed', 'cancelled', 'canceled', 'archived'].includes(row.status)) exclusions.push('terminal history');
            if (row.subtask_count) exclusions.push('historical checklist contents');
            if (missing.length) exclusions.push('incomplete foreign-key visibility');
            tasks.push({ ...row, references, cohorts, disposition: exclusions.length ? 'protect' : 'review-type-only',
                reasons: exclusions.length ? exclusions : ['legacy kind only; review business purpose before further action'] });
        }
        return { readOnly: true, counts, missingReferences: missing, tasks };
    } finally {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
    }
}

async function main() {
    if (!process.env.MY_DAY_INVENTORY_DATABASE_URL) throw new Error('An approved SELECT-only connection is required.');
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/my-day-legacy-task-inventory.js <new-output.json>');
    const pool = new Pool({ connectionString: process.env.MY_DAY_INVENTORY_DATABASE_URL, max: 1, connectionTimeoutMillis: 8000 });
    try {
        const result = await inventory(pool);
        fs.writeFileSync(process.argv[2], JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
        console.log(JSON.stringify({ readOnly: result.readOnly, counts: result.counts, missingReferences: result.missingReferences.length }));
    } finally {
        await pool.end();
    }
}

if (require.main === module) main().catch(error => {
    console.error(`Inventory did not complete (${error.code || error.name}). Check approved access and output path.`);
    process.exitCode = 1;
});

module.exports = { inventory };
