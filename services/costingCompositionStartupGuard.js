'use strict';

// Check the original composition only. Later revisions may intentionally differ.
const MISSING_INITIAL_HISTORY_SQL = `
    SELECT EXISTS (
        SELECT 1
        FROM costing_execution_groups g
        WHERE NOT EXISTS (
            SELECT 1 FROM costing_group_revisions r
            WHERE r.group_id=g.id AND r.business_context=g.business_context
              AND r.revision_number=1
        )
        OR EXISTS (
            SELECT 1 FROM costing_group_members m
            WHERE m.group_id=g.id AND m.business_context=g.business_context
              AND NOT EXISTS (
                  SELECT 1
                  FROM costing_group_revisions r
                  JOIN costing_group_revision_members rm
                    ON rm.revision_id=r.id AND rm.business_context=r.business_context
                  WHERE r.group_id=g.id AND r.business_context=g.business_context
                    AND r.revision_number=1 AND rm.plan_id=m.plan_id
                    AND rm.include_plan_revenue=m.include_plan_revenue
                    AND rm.include_plan_direct_cost=m.include_plan_direct_cost
              )
        )
        LIMIT 1
    ) AS incomplete
`;

async function assertCostingCompositionReady(pool) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '10s'");
        await client.query(`LOCK TABLE costing_execution_groups, costing_group_members,
            costing_group_revisions, costing_group_revision_members IN SHARE MODE`);
        const result = await client.query(MISSING_INITIAL_HISTORY_SQL);
        if (result.rows[0]?.incomplete !== false) {
            const error = new Error('Costing group initial composition is incomplete; reviewed backfill required');
            error.code = 'COSTING_INITIAL_HISTORY_INCOMPLETE';
            throw error;
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { assertCostingCompositionReady };
