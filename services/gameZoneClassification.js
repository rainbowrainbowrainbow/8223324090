'use strict';

const { createHash } = require('node:crypto');
const RESOURCE_IDS = Object.freeze(['room-marvel','room-ninja','room-minecraft','room-monster-high','room-elza',
    'room-rastishka','room-rock','room-minion','room-pony','room-foodcourt','room-yellow-table',
    'room-sofa-1','room-sofa-2','room-sofa-3','room-sofa-4']);
const PAIRS = Object.freeze(RESOURCE_IDS.map((resourceId, index) => Object.freeze({ id: index + 8, resourceId })));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function guard(value, code = 'GAME_ZONE_CLASSIFICATION_DRIFT') {
    if (!value) throw Object.assign(new Error(code), { code });
}
function describeClassificationPlan(input) {
    guard(input && Object.keys(input).length === 3 && Object.keys(input).every(key => ['releaseSha','resources','snapshotHash'].includes(key))
        && /^[a-f0-9]{40}$/.test(input.releaseSha) && /^[a-f0-9]{64}$/.test(input.snapshotHash)
        && JSON.stringify(input.resources) === JSON.stringify(PAIRS), 'GAME_ZONE_CLASSIFICATION_PLAN_INVALID');
    const plan = { releaseSha: input.releaseSha, resources: PAIRS, snapshotHash: input.snapshotHash };
    return { plan, planHash: hash(plan) };
}
async function readClassificationRows(db, { lock = false, classified = false } = {}) {
    const result = await db.query(`SELECT id,resource_id,business_context,type,is_active,metadata
        FROM timeline_resources WHERE id=ANY($1::int[]) ORDER BY id${lock ? ' FOR UPDATE' : ''}`, [PAIRS.map(row => row.id)]);
    guard(result.rowCount === PAIRS.length && result.rows.every((row, index) => {
        const metadata = row.metadata;
        return Number(row.id) === PAIRS[index].id && row.resource_id === PAIRS[index].resourceId
            && row.business_context === 'event_genix' && row.type === 'room' && row.is_active === true
            && metadata && typeof metadata === 'object' && !Array.isArray(metadata)
            && (classified ? metadata.workArea === 'game_zone' : !Object.hasOwn(metadata, 'workArea'));
    }));
    return result.rows;
}
function snapshotHash(rows, classified = false) {
    return hash(rows.map(row => {
        const metadata = { ...row.metadata };
        if (classified) delete metadata.workArea;
        // PostgreSQL jsonb key order is stable; explicit sorting also makes
        // snapshots independent of JavaScript object insertion order.
        const stable = value => Array.isArray(value) ? value.map(stable)
            : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key,stable(value[key])])) : value;
        return { id: Number(row.id), resourceId: row.resource_id, metadata: stable(metadata) };
    }));
}
async function prepareClassificationPlan(db, releaseSha) {
    return describeClassificationPlan({ releaseSha, resources: PAIRS, snapshotHash: snapshotHash(await readClassificationRows(db)) });
}
// Caller owns a transaction. Any mismatch rolls back the complete 15-row block.
async function executeClassificationPlan(db, input, approvedHash, { rollback = false } = {}) {
    const description = describeClassificationPlan(input);
    guard(description.planHash === approvedHash, 'GAME_ZONE_CLASSIFICATION_APPROVAL_REQUIRED');
    const rows = await readClassificationRows(db, { lock: true, classified: rollback });
    guard(snapshotHash(rows, rollback) === description.plan.snapshotHash);
    const result = await db.query(`UPDATE timeline_resources SET metadata=${rollback
        ? "metadata-'workArea'" : "jsonb_set(metadata,'{workArea}','\"game_zone\"'::jsonb,true)"}
        WHERE id=ANY($1::int[]) AND business_context='event_genix' RETURNING id`, [PAIRS.map(row => row.id)]);
    guard(result.rowCount === PAIRS.length);
    const after = await readClassificationRows(db, { classified: !rollback });
    guard(snapshotHash(after, !rollback) === description.plan.snapshotHash);
    return { success: true, action: rollback ? 'rollback' : 'apply', resourceCount: PAIRS.length, planHash: description.planHash };
}
module.exports = { PAIRS, describeClassificationPlan, prepareClassificationPlan, executeClassificationPlan };
