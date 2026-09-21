'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const migrationPath = path.join(repoRoot, 'db', 'migrations', '367_lead_conversation_links.sql');

test('lead conversation link migration declares canonical pair, primary, origin, and business-scope guards', () => {
    const migration = fs.readFileSync(migrationPath, 'utf8');

    assert.match(migration, /CREATE TABLE IF NOT EXISTS lead_conversation_links/i);
    assert.match(migration, /UNIQUE INDEX IF NOT EXISTS uq_lead_conversation_links_pair_v367[\s\S]*business_context, lead_id, conversation_id/i);
    assert.match(migration, /UNIQUE INDEX IF NOT EXISTS uq_lead_conversation_links_primary_v367[\s\S]*WHERE is_primary/i);
    assert.match(migration, /UNIQUE INDEX IF NOT EXISTS uq_lead_conversation_links_origin_v367[\s\S]*WHERE is_origin/i);
    assert.match(migration, /enforce_lead_conversation_link_scope_v367/i);
    assert.match(migration, /prevent_lead_conversation_link_scope_drift_v367/i);
    assert.match(migration, /FOR KEY SHARE/i);
});

test('lead conversation link service exposes transaction-safe write and confirmed-link read operations', () => {
    const service = require('../services/leadConversationLinks');

    assert.equal(typeof service.linkLeadConversation, 'function');
    assert.equal(typeof service.setLeadPrimaryConversation, 'function');
    assert.equal(typeof service.listLeadConversationLinks, 'function');
    assert.equal(typeof service.listConversationLeadLinks, 'function');

    const source = fs.readFileSync(path.join(repoRoot, 'services', 'leadConversationLinks.js'), 'utf8');
    assert.match(source, /pg_advisory_xact_lock/);
});

function createPrimaryLinkDb() {
    const queries = [];
    const primaryRow = {
        id: 8,
        business_context: 'event_genix',
        lead_id: 15,
        conversation_id: 23,
        is_origin: true,
        is_primary: true,
        source: 'omni_lead_assistant',
        metadata: {},
        created_by: null,
        created_at: '2026-09-21T00:00:00.000Z',
        updated_at: '2026-09-21T00:00:00.000Z',
    };
    const client = {
        async query(text, params = []) {
            const sql = String(text).replace(/\s+/g, ' ').trim();
            queries.push({ sql, params });
            if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || /pg_advisory_xact_lock/.test(sql)) return { rows: [] };
            if (/FROM leads l JOIN conversations c/.test(sql)) return { rows: [{ lead_id: 15, conversation_id: 23 }] };
            if (/SELECT \* FROM lead_conversation_links/.test(sql)) return { rows: [primaryRow] };
            if (/SET is_primary = FALSE/.test(sql)) return { rows: [] };
            if (/SET is_primary = TRUE/.test(sql)) return { rows: [primaryRow] };
            throw new Error(`Unexpected query: ${sql}`);
        },
        release() {},
    };
    return { db: { connect: async () => client }, queries };
}

test('changing the primary conversation owns a transaction and does not rewrite origin', async () => {
    const { setLeadPrimaryConversation } = require('../services/leadConversationLinks');
    const fixture = createPrimaryLinkDb();

    const link = await setLeadPrimaryConversation({
        businessContext: 'event_genix',
        leadId: 15,
        conversationId: 23,
    }, { db: fixture.db });

    assert.equal(link.isPrimary, true);
    assert.equal(link.isOrigin, true);
    assert.ok(fixture.queries.some(query => query.sql === 'BEGIN'));
    assert.ok(fixture.queries.some(query => query.sql === 'COMMIT'));
    assert.ok(fixture.queries.some(query => /pg_advisory_xact_lock/.test(query.sql)));
    assert.equal(fixture.queries.some(query => /SET is_origin/.test(query.sql)), false);
});
