'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');

const migrationPath = path.join(__dirname, '../../db/migrations/367_lead_conversation_links.sql');

// Opt-in, loopback-only disposable database. Never use DATABASE_URL or production credentials.
test('lead conversation links preserve cardinality, concurrency, and business isolation', { timeout: 60000 }, async t => {
    const configuredUrl = process.env.LEAD_CONVERSATION_LINKS_TEST_DATABASE_URL;
    assert.ok(configuredUrl, 'LEAD_CONVERSATION_LINKS_TEST_DATABASE_URL is required');
    assert.equal(process.env.LEAD_CONVERSATION_LINKS_TEST_DATABASE_URL, configuredUrl);
    assert.ok(!process.env.RAILWAY_PROJECT_ID && process.env.NODE_ENV !== 'production');

    const rootUrl = new URL(configuredUrl);
    const socketHost = rootUrl.searchParams.get('host');
    const verifiedByRunner = process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER === 'true';
    if (verifiedByRunner) {
        assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
        assertSafeTestDatabaseUrl(configuredUrl, process.env);
    } else {
        assert.notEqual(configuredUrl, process.env.DATABASE_URL);
        assert.ok(
            ['127.0.0.1', 'localhost', '[::1]'].includes(rootUrl.hostname)
                || socketHost === '/var/run/postgresql',
            'test database must use loopback or the local PostgreSQL Unix socket'
        );
        assert.match(rootUrl.pathname, /^\/lead_conversation_links_fixture_test(?:_\d+)?$/);
    }

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
            client_name TEXT,
            source_channel TEXT,
            external_id TEXT,
            raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb
        );
        CREATE TABLE conversations (
            id SERIAL PRIMARY KEY,
            business_context VARCHAR(64) NOT NULL,
            channel TEXT,
            status TEXT,
            last_message_at TIMESTAMPTZ,
            customer_name TEXT,
            meta JSONB NOT NULL DEFAULT '{}'::jsonb
        );
    `);
    await pool.query(fs.readFileSync(migrationPath, 'utf8'));

    const links = require('../../services/leadConversationLinks');
    const backfill = require('../../services/leadConversationLinkBackfill');

    async function createLegacyCase(businessContext, { count = 1, sharedConversation = false } = {}) {
        const leads = [];
        for (let index = 0; index < count; index += 1) {
            const inserted = await pool.query(
                `INSERT INTO leads (business_context, client_name, source_channel)
                 VALUES ($1, $2, 'instagram')
                 RETURNING id`,
                [businessContext, `Fixture lead ${index + 1}`]
            );
            leads.push(inserted.rows[0]);
        }
        const conversations = [];
        const conversationCount = sharedConversation ? 1 : count;
        for (let index = 0; index < conversationCount; index += 1) {
            const leadIds = sharedConversation ? leads.map(item => item.id) : [leads[index].id];
            const inserted = await pool.query(
                `INSERT INTO conversations (business_context, channel, status, customer_name, meta)
                 VALUES ($1, 'instagram', 'open', $2, $3::jsonb)
                 RETURNING id`,
                [businessContext, `Fixture conversation ${index + 1}`, JSON.stringify({ leadIds })]
            );
            conversations.push(inserted.rows[0]);
        }
        for (let index = 0; index < leads.length; index += 1) {
            const conversationId = conversations[sharedConversation ? 0 : index].id;
            await pool.query(
                `UPDATE leads
                    SET external_id = $2,
                        raw_payload = $3::jsonb
                  WHERE id = $1`,
                [leads[index].id, `omni_conv_${conversationId}`, JSON.stringify({ conversationId })]
            );
        }
        return { leads, conversations };
    }

    async function applyApprovedPlan(plan, options = {}) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const result = await backfill.applyLeadConversationLinkBackfill(plan, {
                client,
                approval: plan.approval,
                maxCandidates: plan.ready.length || 1,
                ...options,
            });
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
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

    await t.test('stale plan preserves a manager-selected primary and manual source', async () => {
        const businessContext = 'omni_stale_plan_fixture';
        const fixture = await createLegacyCase(businessContext);
        const legacyLead = fixture.leads[0];
        const originConversation = fixture.conversations[0];
        const manualConversation = (await pool.query(
            `INSERT INTO conversations (business_context, channel, status, customer_name)
             VALUES ($1, 'telegram', 'open', 'Manager choice')
             RETURNING id`,
            [businessContext]
        )).rows[0];
        const stalePlan = await backfill.readLeadConversationLinkBackfillPlan({
            businessContext, batchSize: 1,
        }, pool);
        assert.deepEqual(stalePlan.ready.map(item => [item.leadId, item.conversationId]), [[legacyLead.id, originConversation.id]]);

        await links.linkManualConversationPreservingLegacyOrigin({
            businessContext,
            leadId: legacyLead.id,
            conversationId: manualConversation.id,
            source: 'lead_workspace_manual',
        }, { db: pool });
        await links.setLeadPrimaryConversation({
            businessContext,
            leadId: legacyLead.id,
            conversationId: manualConversation.id,
            source: 'lead_workspace_manual_primary',
        }, { db: pool });

        const report = await applyApprovedPlan(stalePlan);
        assert.deepEqual(report.totals, { added: 0, alreadyExisted: 1, skipped: 0, conflicts: 0 });
        const rows = (await pool.query(
            `SELECT conversation_id, is_origin, is_primary, source
               FROM lead_conversation_links
              WHERE business_context = $1 AND lead_id = $2
              ORDER BY conversation_id`,
            [businessContext, legacyLead.id]
        )).rows;
        assert.deepEqual(rows, [
            {
                conversation_id: originConversation.id,
                is_origin: true,
                is_primary: false,
                source: 'omni_legacy_transition',
            },
            {
                conversation_id: manualConversation.id,
                is_origin: false,
                is_primary: true,
                source: 'lead_workspace_manual',
            },
        ]);

        const repeated = await applyApprovedPlan(stalePlan);
        assert.deepEqual(repeated.totals, { added: 0, alreadyExisted: 1, skipped: 0, conflicts: 0 });
    });

    await t.test('rollback removes every write when a later approved candidate fails', async () => {
        const businessContext = 'omni_rollback_fixture';
        const fixture = await createLegacyCase(businessContext, { count: 2 });
        const plan = await backfill.readLeadConversationLinkBackfillPlan({ businessContext, batchSize: 1 }, pool);
        assert.equal(plan.ready.length, 2);
        let writes = 0;
        await assert.rejects(applyApprovedPlan(plan, {
            linkWriter: async (candidate, { client }) => {
                const link = await links.linkLeadConversation(candidate, { client });
                writes += 1;
                if (writes === 2) throw new Error('fixture apply failure');
                return link;
            },
        }), /fixture apply failure/);
        const count = (await pool.query(
            `SELECT COUNT(*)::int AS count
               FROM lead_conversation_links
              WHERE business_context = $1
                AND lead_id = ANY($2::int[])`,
            [businessContext, fixture.leads.map(item => item.id)]
        )).rows[0].count;
        assert.equal(count, 0);
    });

    await t.test('one conversation can be backfilled for two leads and rerun without changes', async () => {
        const businessContext = 'omni_shared_chat_fixture';
        const fixture = await createLegacyCase(businessContext, { count: 2, sharedConversation: true });
        const plan = await backfill.readLeadConversationLinkBackfillPlan({ businessContext, batchSize: 1 }, pool);
        assert.equal(plan.ready.length, 2);
        const first = await applyApprovedPlan(plan);
        assert.deepEqual(first.totals, { added: 2, alreadyExisted: 0, skipped: 0, conflicts: 0 });
        const repeated = await applyApprovedPlan(plan);
        assert.deepEqual(repeated.totals, { added: 0, alreadyExisted: 2, skipped: 0, conflicts: 0 });
        const rows = (await pool.query(
            `SELECT lead_id, conversation_id, is_origin, is_primary
               FROM lead_conversation_links
              WHERE business_context = $1
              ORDER BY lead_id`,
            [businessContext]
        )).rows;
        assert.equal(rows.length, 2);
        assert.ok(rows.every(row => row.conversation_id === fixture.conversations[0].id && row.is_origin && row.is_primary));
    });

    await t.test('conflicting IDs and another business stay out of the approved list', async () => {
        const businessContext = 'omni_conflict_fixture';
        const fixture = await createLegacyCase(businessContext);
        const otherConversation = (await pool.query(
            `INSERT INTO conversations (business_context, channel, status, customer_name, meta)
             VALUES ($1, 'instagram', 'open', 'Conflicting conversation', $2::jsonb)
             RETURNING id`,
            [businessContext, JSON.stringify({ leadIds: [fixture.leads[0].id] })]
        )).rows[0];
        await pool.query(
            `UPDATE leads SET raw_payload = $2::jsonb WHERE id = $1`,
            [fixture.leads[0].id, JSON.stringify({ conversationId: otherConversation.id })]
        );
        const conflictPlan = await backfill.readLeadConversationLinkBackfillPlan({ businessContext }, pool);
        assert.equal(conflictPlan.ready.length, 0);
        assert.equal(conflictPlan.conflicts[0].reason, 'lead_external_id_conflicts_with_raw_payload');

        const crossContext = 'omni_cross_business_fixture';
        const crossLead = (await pool.query(
            `INSERT INTO leads (business_context, client_name, source_channel)
             VALUES ($1, 'Cross business lead', 'instagram') RETURNING id`,
            [crossContext]
        )).rows[0];
        const foreignConversation = (await pool.query(
            `INSERT INTO conversations (business_context, channel, status, customer_name, meta)
             VALUES ('dar', 'instagram', 'open', 'Foreign chat', $1::jsonb) RETURNING id`,
            [JSON.stringify({ leadIds: [crossLead.id] })]
        )).rows[0];
        await pool.query(
            `UPDATE leads SET external_id = $2, raw_payload = $3::jsonb WHERE id = $1`,
            [crossLead.id, `omni_conv_${foreignConversation.id}`, JSON.stringify({ conversationId: foreignConversation.id })]
        );
        const crossPlan = await backfill.readLeadConversationLinkBackfillPlan({ businessContext: crossContext }, pool);
        assert.equal(crossPlan.ready.length, 0);
        assert.equal(crossPlan.conflicts[0].reason, 'business_context_mismatch');
    });
});
