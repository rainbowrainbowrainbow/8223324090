'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Client } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../scripts/test-db-safety');
const { runInventory } = require('../scripts/audit-chat-scope');

test('chat inventory rolls back and exposes neither raw database fields nor inferred ownership', async () => {
    const calls = [];
    const report = await runInventory({ async query(sql) {
        calls.push(sql);
        return { rows: sql.startsWith('WITH') ? [{ id: 7, type: 'private-content', is_archived: false,
            principal_count: '2', unclassified_principal_count: '1', multi_business_principal_count: '0',
            business_ids: [3], message_count: '8', non_text_message_count: '1', cross_channel_reply_count: '0',
            content: 'private message', name: 'private name', metadata: { password: 'private' } }] : [] };
    } });
    assert.match(calls[0], /REPEATABLE READ READ ONLY$/);
    assert.equal(calls.at(-1), 'ROLLBACK');
    assert.equal(report.inferredOwnership, false);
    assert.equal(report.channels[0].type, 'other');
    assert.equal(report.channels[0].needsOwnerClassification, true);
    assert.doesNotMatch(JSON.stringify(report), /private/);
    const failed = [];
    await assert.rejects(runInventory({ async query(sql) {
        failed.push(sql);
        if (sql.startsWith('WITH')) throw new Error('fixture failure');
    } }), /fixture failure/);
    assert.equal(failed.at(-1), 'ROLLBACK');
});

test('chat scope inventory uses actual PostgreSQL memberships and historical principals without reading content', {
    skip: !process.env.CHAT_SCOPE_INVENTORY_TEST_DATABASE_URL
}, async () => {
    const raw = process.env.CHAT_SCOPE_INVENTORY_TEST_DATABASE_URL;
    const target = assertSafeTestDatabaseUrl(raw);
    assert.equal(target.isLocal, true);
    const db = new Client({ connectionString: raw });
    const schema = 'chat_scope_test_' + crypto.randomUUID().replaceAll('-', '');
    await db.connect();
    try {
        await db.query(`CREATE SCHEMA "${schema}"`);
        await db.query(`SET search_path TO "${schema}"`);
        // Minimal synthetic schema intentionally omits content, names, metadata,
        // credentials and file URLs: the inventory cannot depend on those fields.
        await db.query(`CREATE TABLE chat_channels (id INT, type TEXT, is_archived BOOLEAN, created_by INT, dm_user_ids INT[]);
            CREATE TABLE chat_channel_members (channel_id INT, user_id INT);
            CREATE TABLE chat_messages (id INT, channel_id INT, user_id INT, content_type TEXT, reply_to INT);
            CREATE TABLE users (id INT, is_active BOOLEAN);
            CREATE TABLE organizations (id INT, status TEXT);
            CREATE TABLE businesses (id INT, organization_id INT, status TEXT);
            CREATE TABLE organization_memberships (user_id INT, organization_id INT, is_active BOOLEAN);
            CREATE TABLE business_memberships (user_id INT, business_id INT, organization_id INT, is_active BOOLEAN);
            INSERT INTO organizations VALUES (1, 'active');
            INSERT INTO businesses VALUES (11, 1, 'active'), (22, 1, 'active'), (33, 1, 'inactive');
            INSERT INTO users VALUES (1, true), (2, true), (3, true), (4, false);
            INSERT INTO organization_memberships VALUES (1, 1, true), (2, 1, true), (3, 1, false), (4, 1, true);
            INSERT INTO business_memberships VALUES (1, 11, 1, true), (2, 11, 1, true), (2, 22, 1, true),
                (3, 22, 1, true), (4, 11, 1, true), (1, 33, 1, true);
            INSERT INTO chat_channels VALUES (1, 'general', false, 1, NULL), (2, 'dm', false, 1, ARRAY[1,2,3]),
                (3, 'room', true, NULL, NULL);
            INSERT INTO chat_channel_members VALUES (1, 1), (1, 4);
            INSERT INTO chat_messages VALUES (10, 1, 1, 'text', NULL), (11, 2, 2, 'file', 10), (12, 1, 3, 'text', NULL);`);
        const report = await runInventory(db);
        assert.deepEqual(report.channels[0], { channelId: 1, type: 'general', archived: false,
            principalCount: 3, unclassifiedPrincipalCount: 2, multiBusinessPrincipalCount: 0,
            activePrincipalBusinessIds: [11], messageCount: 2, nonTextMessageCount: 0,
            crossChannelReplyCount: 0, needsOwnerClassification: true });
        assert.equal(report.channels[1].principalCount, 3, 'DM recipients count even without member rows');
        assert.equal(report.channels[1].multiBusinessPrincipalCount, 1);
        assert.equal(report.channels[1].unclassifiedPrincipalCount, 1, 'revoked organization membership grants nothing');
        assert.deepEqual(report.channels[1].activePrincipalBusinessIds, [11, 22]);
        assert.equal(report.channels[1].crossChannelReplyCount, 1);
        assert.equal(report.channels[1].nonTextMessageCount, 1);
        assert.equal(report.channels[2].principalCount, 0);
        assert.equal(report.channels[2].needsOwnerClassification, true, 'empty channels have no inferred owner');
        await db.query('BEGIN READ ONLY');
        await assert.rejects(db.query('DELETE FROM chat_channels'), { code: '25006' });
        await db.query('ROLLBACK');
        assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM chat_channels')).rows[0].count, 3);
    } finally {
        await db.query('ROLLBACK').catch(() => {});
        await db.query('SET search_path TO public');
        await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await db.end();
    }
});
