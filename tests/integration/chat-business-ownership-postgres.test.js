'use strict';

const assert = require('node:assert/strict');
const { describe, it, before, after } = require('node:test');
const { Pool } = require('pg');
const { getToken, request } = require('../helpers');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');

describe('business chat on isolated PostgreSQL', () => {
    let pool;
    let userId;
    let token;
    const contexts = ['chat_local_a', 'chat_local_b'];

    before(async () => {
        assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
        assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
        const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
        assert.equal(target.isLocal, true, 'chat integration requires a local disposable database');
        pool = new Pool({ connectionString: target.url.toString(), ssl: false });
        const user = await pool.query('SELECT id FROM users WHERE username = $1', [process.env.TEST_USER]);
        assert.equal(user.rowCount, 1, 'isolated bootstrap creator must exist');
        userId = user.rows[0].id;

        const organization = await pool.query(
            `INSERT INTO organizations (slug, name, created_by_user_id)
             VALUES ('chat-local-fixture', 'Chat local fixture', $1) RETURNING id`, [userId]);
        const organizationId = organization.rows[0].id;
        await pool.query(
            `INSERT INTO organization_memberships (organization_id, user_id, role)
             VALUES ($1, $2, 'owner')`, [organizationId, userId]);
        for (const [index, context] of contexts.entries()) {
            const business = await pool.query(
                `INSERT INTO businesses (organization_id, context_key, label, short_label, access_mode, modules)
                 VALUES ($1, $2, $2, $2, 'membership', '["chat"]'::jsonb) RETURNING id`,
                [organizationId, context]);
            await pool.query(
                `INSERT INTO business_memberships
                    (business_id, organization_id, user_id, role, is_default)
                 VALUES ($1, $2, $3, 'creator', $4)`,
                [business.rows[0].id, organizationId, userId, index === 0]);
        }
        token = await getToken();
    });

    after(async () => {
        if (pool) await pool.end();
    });

    it('opens separate default channels and saves a message only in its owning business', async () => {
        const first = await request('GET', `/api/chat/channels?businessContext=${contexts[0]}`, null, token);
        assert.equal(first.status, 200, JSON.stringify(first.data));
        assert.equal(first.data.length, 4);
        const channelId = first.data[0].id;
        assert.ok(channelId);
        assert.ok(first.data.every(channel => channel.businessContext === contexts[0]));

        const sent = await request('POST', `/api/chat/channels/${channelId}/messages`, {
            businessContext: contexts[0], content: 'Local PostgreSQL chat ownership check'
        }, token);
        assert.equal(sent.status, 201, JSON.stringify(sent.data));
        const stored = await pool.query(
            `SELECT c.business_context, m.content FROM chat_messages m
             JOIN chat_channels c ON c.id = m.channel_id WHERE m.id = $1`, [sent.data.id]);
        assert.equal(stored.rows[0]?.business_context, contexts[0]);
        assert.equal(stored.rows[0]?.content, 'Local PostgreSQL chat ownership check');

        const second = await request('GET', `/api/chat/channels?businessContext=${contexts[1]}`, null, token);
        assert.equal(second.status, 200, JSON.stringify(second.data));
        assert.equal(second.data.length, 4);
        assert.ok(second.data.every(channel => channel.businessContext === contexts[1]));
        assert.ok(second.data.every(channel => channel.id !== channelId));

        const crossRead = await request('GET',
            `/api/chat/channels/${channelId}/messages?businessContext=${contexts[1]}`, null, token);
        assert.equal(crossRead.status, 404, JSON.stringify(crossRead.data));
        const crossWrite = await request('POST', `/api/chat/channels/${channelId}/messages`, {
            businessContext: contexts[1], content: 'Must remain outside the first business'
        }, token);
        assert.equal(crossWrite.status, 404, JSON.stringify(crossWrite.data));
    });

    it('denies chat when its module is disabled or membership is revoked', async () => {
        const context = contexts[0];
        const path = `/api/chat/channels?businessContext=${context}`;
        await pool.query(`UPDATE businesses SET modules = '[]'::jsonb WHERE context_key = $1`, [context]);
        try {
            const disabled = await request('GET', path, null, token);
            assert.equal(disabled.status, 403, JSON.stringify(disabled.data));
            assert.equal(disabled.data?.code, 'business_module_disabled');
        } finally {
            await pool.query(`UPDATE businesses SET modules = '["chat"]'::jsonb WHERE context_key = $1`, [context]);
        }

        await pool.query(
            `UPDATE business_memberships SET is_active = false
             WHERE user_id = $1 AND business_id = (SELECT id FROM businesses WHERE context_key = $2)`,
            [userId, context]);
        try {
            const revoked = await request('GET', path, null, token);
            assert.equal(revoked.status, 403, JSON.stringify(revoked.data));
        } finally {
            await pool.query(
                `UPDATE business_memberships SET is_active = true
                 WHERE user_id = $1 AND business_id = (SELECT id FROM businesses WHERE context_key = $2)`,
                [userId, context]);
        }
    });
});
