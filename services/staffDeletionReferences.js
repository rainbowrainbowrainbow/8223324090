'use strict';

const quoteIdentifier = value => `"${String(value).replace(/"/g, '""')}"`;

// Catch new CASCADE/SET NULL dependencies as well as RESTRICT references. Only
// the existing, explicitly reported cleanup is permitted to disappear/unlink.
async function loadAdditionalStaffDeletionBlockers(db, staffId, knownChecks, cleanupChecks) {
    const covered = new Set([...knownChecks, ...cleanupChecks]
        .filter(check => check.where === 'staff_id = $1')
        .map(check => JSON.stringify(['public', check.table, 'staff_id'])));
    const references = await db.query(`
        SELECT DISTINCT ns.nspname AS schema_name, rel.relname AS table_name, attr.attname AS column_name
        FROM pg_constraint fk
        JOIN pg_class rel ON rel.oid = fk.conrelid
        JOIN pg_namespace ns ON ns.oid = rel.relnamespace
        CROSS JOIN LATERAL unnest(fk.conkey, fk.confkey) AS keys(local_num, foreign_num)
        JOIN pg_attribute attr ON attr.attrelid = fk.conrelid AND attr.attnum = keys.local_num
        JOIN pg_attribute target ON target.attrelid = fk.confrelid AND target.attnum = keys.foreign_num
        WHERE fk.contype = 'f' AND fk.confrelid = 'public.staff'::regclass AND target.attname = 'id'
        ORDER BY ns.nspname, rel.relname, attr.attname`);
    let count = 0;
    for (const ref of references.rows) {
        if (covered.has(JSON.stringify([ref.schema_name, ref.table_name, ref.column_name]))) continue;
        const result = await db.query(
            `SELECT COUNT(*)::int AS count FROM ${quoteIdentifier(ref.schema_name)}.${quoteIdentifier(ref.table_name)} WHERE ${quoteIdentifier(ref.column_name)} = $1`,
            [staffId]
        );
        count += Number(result.rows[0].count);
    }
    return count > 0 ? [{ key: 'additional_references', label: 'інші пов’язані записи', count }] : [];
}

module.exports = { loadAdditionalStaffDeletionBlockers };
