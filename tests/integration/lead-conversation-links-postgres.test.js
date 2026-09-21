'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');

const migrationPath = path.join(__dirname, '../../db/migrations/367_lead_conversation_links.sql');

// Opt-in, loopback-only disposable database. Never use DATABASE_URL or production credentials.
test('lead conversation links preserve cardinality, concurrency, and business isolation', { timeout: 60000 }, async t => {
    const configuredUrl = process.env.LEAD_CONVERSATION_LINKS_TEST_DATABASE_URL;
    assert.ok(configuredUrl, 'LEAD_CONVERSATION_LINKS_TEST_DATABASE_URL is required');
    assert.equal(process.env.LEAD_CONVERSATION_LINKS_TEST_DATABASE_URL, configuredUrl);
    assert.notEqual(configuredUrl, process.env.DATABASE_URL);
    assert.ok(!process.env.RAILWAY_PROJECT_ID && process.env.NODE_ENV !== 'production');

    const rootUrl = new URL(configuredUrl);
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(rootUrl.hostname), 'test database must use loopback');
    assert.match(rootUrl.pathname, /^\/lead_conversation_links_fixture_test(?:_\d+)?$/);

    const database = `lead_conversation_links_test_${randomUUID().replaceAll('-', '')}`;
    assert.match(database, /^lead_conversation_links_test_[a-f0-9]{32}$/);
    const admin = new Pool({ connectionString: rootUrl.href, connectionTimeoutMillis: 5000 });
    let pool;
    let created = false;

    t.after(async () => {
        await pool?.end().catch(() => {});
        if (created) {
            const cleanup = new Pool({ connectionString: rootUrl.href, connectionTimeoutMillis: 5000 });
            try {
                await cleanup.query(`DROP DATABASE "${database}"`);
            } finally {
                await cleanup.end().catch(() => {});
            }
        }
        await admin.end().catch(() => {});
    });

    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    const testUrl = new URL(rootUrl.href);
    testUrl.pathname = `/${database}`;
    pool = new Pool({ connectionString: testUrl.href, max: 12, connectionTimeoutMillis: 5000 });

    await pool.query(`
        CREATE TABLE users (id SERIAL PRIMARY KEY, username TEXT);
        CREATE TABLE leads (
            id SERIAL PRIMARY KEY,
            business_context VARCHAR(64) NOT NULL,
            client_name TEXT
        );
        CREATE TABLE conversations (
            id SERIAL PRIMARY KEY,
            business_context VARCHAR(64) NOT NULL,
            channel TEXT,
            status TEXT,
            last_message_at TIMESTAMPTZ,
            customer_name TEXT
        );
    `);
    await pool.query(fs.readFileSync(migrationPath, 'utf8'));

    const links = require('../../services/leadConversationLinks');
    const [eventLead, darLead] = (await pool.query(`
        INSERT INTO leads (business_context, client_name)
        VALUES ('event_genix', 'Event lead'), ('dar', 'Dar lead')
        RETURNING id, business_context
    `)).rows;
    const [eventConversationOne, eventConversationTwo, eventConversationThree, darConversation] = (await pool.query(`
        INSERT INTO conversations (business_context, channel, status, customer_name)
        VALUES
            ('event_genix', 'instagram', 'open', 'Origin'),
            ('event_genix', 'telegram', 'open', 'Primary one'),
            ('event_genix', 'viber', 'open', 'Primary two'),
            ('dar', 'instagram', 'open', 'Other business')
        RETURNING id, business_context
    `)).rows;

    const repeated = await Promise.all(Array.from({ length: 12 }, () => links.linkLeadConversation({
        businessContext: 'event_genix',
        leadId: eventLead.id,
        conversationId: eventConversationOne.id,
        source: 'omni_lead_assistant',
        metadata: { fixture: true },
        isOrigin: true,
        isPrimary: true,
    }, { db: pool })));
    assert.equal(new Set(repeated.map(link => link.id)).size, 1, 'retries reuse one pair');
    assert.equal((await pool.query(`SELECT COUNT(*)::int AS count FROM lead_conversation_links WHERE lead_id = $1`, [eventLead.id])).rows[0].count, 1);

    await links.linkLeadConversation({
        businessContext: 'event_genix', leadId: eventLead.id, conversationId: eventConversationTwo.id, source: 'manager_confirmed'
    }, { db: pool });
    await links.linkLeadConversation({
        businessContext: 'event_genix', leadId: eventLead.id, conversationId: eventConversationThree.id, source: 'manager_confirmed'
    }, { db: pool });

    await Promise.all([
        links.setLeadPrimaryConversation({
            businessContext: 'event_genix', leadId: eventLead.id, conversationId: eventConversationTwo.id
        }, { db: pool }),
        links.setLeadPrimaryConversation({
            businessContext: 'event_genix', leadId: eventLead.id, conversationId: eventConversationThree.id
        }, { db: pool }),
    ]);
    const flagCounts = (await pool.query(`
        SELECT COUNT(*) FILTER (WHERE is_primary)::int AS primary_count,
               COUNT(*) FILTER (WHERE is_origin)::int AS origin_count
          FROM lead_conversation_links
         WHERE business_context = 'event_genix' AND lead_id = $1
    `, [eventLead.id])).rows[0];
    assert.deepEqual(flagCounts, { primary_count: 1, origin_count: 1 });

    await links.setLeadPrimaryConversation({
        businessContext: 'event_genix', leadId: eventLead.id, conversationId: eventConversationTwo.id
    }, { db: pool });
    const origin = (await pool.query(`
        SELECT conversation_id FROM lead_conversation_links
         WHERE business_context = 'event_genix' AND lead_id = $1 AND is_origin
    `, [eventLead.id])).rows[0];
    assert.equal(origin.conversation_id, eventConversationOne.id, 'changing primary preserves historical origin');

    await assert.rejects(
        links.linkLeadConversation({
            businessContext: 'event_genix', leadId: eventLead.id, conversationId: darConversation.id, source: 'manual'
        }, { db: pool }),
        error => error.code === 'LEAD_CONVERSATION_LINK_NOT_FOUND' && error.statusCode === 404
    );
    await assert.rejects(
        pool.query(`
            INSERT INTO lead_conversation_links (business_context, lead_id, conversation_id, source)
            VALUES ('event_genix', $1, $2, 'manual')
        `, [eventLead.id, darConversation.id]),
        error => error.code === '23514'
    );
    await assert.rejects(
        pool.query(`UPDATE leads SET business_context = 'dar' WHERE id = $1`, [eventLead.id]),
        error => error.code === '23514'
    );
    await assert.rejects(
        pool.query(`UPDATE conversations SET business_context = 'dar' WHERE id = $1`, [eventConversationOne.id]),
        error => error.code === '23514'
    );
    assert.equal(darLead.business_context, 'dar');
});
