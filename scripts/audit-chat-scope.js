#!/usr/bin/env node
'use strict';

const { Client } = require('pg');

// Memberships are evidence for owner review, never inferred channel ownership.
// Include historical authors and declared DM recipients, not only current members.
const INVENTORY_SQL = `WITH principals AS (
    SELECT channel_id, user_id FROM chat_channel_members
    UNION SELECT id, created_by FROM chat_channels WHERE created_by IS NOT NULL
    UNION SELECT id, unnest(dm_user_ids) FROM chat_channels
    UNION SELECT channel_id, user_id FROM chat_messages
), memberships AS (
    SELECT bm.user_id, array_agg(DISTINCT bm.business_id ORDER BY bm.business_id) AS business_ids
    FROM business_memberships bm
    JOIN organization_memberships om ON om.user_id = bm.user_id
        AND om.organization_id = bm.organization_id AND om.is_active IS TRUE
    JOIN users u ON u.id = bm.user_id AND u.is_active IS TRUE
    JOIN businesses b ON b.id = bm.business_id AND b.organization_id = bm.organization_id AND b.status = 'active'
    JOIN organizations o ON o.id = b.organization_id AND o.status = 'active'
    WHERE bm.is_active IS TRUE GROUP BY bm.user_id
), principal_counts AS (
    SELECT p.channel_id, COUNT(*) AS principal_count,
        COUNT(*) FILTER (WHERE COALESCE(cardinality(m.business_ids), 0) = 0) AS unclassified_principal_count,
        COUNT(*) FILTER (WHERE cardinality(m.business_ids) > 1) AS multi_business_principal_count
    FROM principals p LEFT JOIN memberships m ON m.user_id = p.user_id GROUP BY p.channel_id
), business_sets AS (
    SELECT p.channel_id, array_agg(DISTINCT ids.id ORDER BY ids.id) AS business_ids
    FROM principals p JOIN memberships m ON m.user_id = p.user_id
    CROSS JOIN LATERAL unnest(m.business_ids) ids(id) GROUP BY p.channel_id
), message_counts AS (
    SELECT msg.channel_id, COUNT(*) AS message_count,
        COUNT(*) FILTER (WHERE COALESCE(msg.content_type, 'text') <> 'text') AS non_text_message_count,
        COUNT(*) FILTER (WHERE parent.channel_id <> msg.channel_id) AS cross_channel_reply_count
    FROM chat_messages msg LEFT JOIN chat_messages parent ON parent.id = msg.reply_to
    GROUP BY msg.channel_id
)
SELECT c.id, c.type, c.is_archived, COALESCE(pc.principal_count, 0) AS principal_count,
    COALESCE(pc.unclassified_principal_count, 0) AS unclassified_principal_count,
    COALESCE(pc.multi_business_principal_count, 0) AS multi_business_principal_count,
    COALESCE(bs.business_ids, ARRAY[]::integer[]) AS business_ids,
    COALESCE(mc.message_count, 0) AS message_count,
    COALESCE(mc.non_text_message_count, 0) AS non_text_message_count,
    COALESCE(mc.cross_channel_reply_count, 0) AS cross_channel_reply_count
FROM chat_channels c LEFT JOIN principal_counts pc ON pc.channel_id = c.id
LEFT JOIN business_sets bs ON bs.channel_id = c.id LEFT JOIN message_counts mc ON mc.channel_id = c.id
ORDER BY c.id`;

async function collectChatScopeInventory(db) {
    const result = await db.query(INVENTORY_SQL);
    const knownTypes = new Set(['general', 'room', 'dm', 'assistant', 'system', 'department', 'private', 'project']);
    return result.rows.map(row => ({
        channelId: Number(row.id), type: knownTypes.has(row.type) ? row.type : 'other', archived: row.is_archived === true,
        principalCount: Number(row.principal_count), unclassifiedPrincipalCount: Number(row.unclassified_principal_count),
        multiBusinessPrincipalCount: Number(row.multi_business_principal_count),
        activePrincipalBusinessIds: row.business_ids.map(Number), messageCount: Number(row.message_count),
        nonTextMessageCount: Number(row.non_text_message_count), crossChannelReplyCount: Number(row.cross_channel_reply_count),
        needsOwnerClassification: true
    }));
}

async function runInventory(db) {
    await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
        await db.query("SET LOCAL statement_timeout = '30s'");
        await db.query("SET LOCAL lock_timeout = '3s'");
        return { readOnly: true, inferredOwnership: false, channels: await collectChatScopeInventory(db) };
    } finally { await db.query('ROLLBACK'); }
}

async function main() {
    const connectionString = process.env.ACCESS_AUDIT_DATABASE_URL;
    if (!connectionString) throw new Error('Dedicated audit connection required');
    const db = new Client({ connectionString, connectionTimeoutMillis: 10000,
        application_name: 'eventgenix_chat_scope_readonly_audit' });
    await db.connect();
    try { process.stdout.write(JSON.stringify(await runInventory(db), null, 2) + '\n'); }
    finally { await db.end(); }
}

if (require.main === module) main().catch(() => {
    console.error('Read-only chat inventory failed. Check the dedicated local connection and schema; no changes were applied.');
    process.exitCode = 1;
});

module.exports = { collectChatScopeInventory, runInventory };
