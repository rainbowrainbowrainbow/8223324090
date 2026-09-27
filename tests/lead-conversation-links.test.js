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

    assert.equal(typeof service.lockLeadConversationLinks, 'function');
    assert.equal(typeof service.linkLeadConversation, 'function');
    assert.equal(typeof service.linkManualConversationPreservingLegacyOrigin, 'function');
    assert.equal(typeof service.setLeadPrimaryConversation, 'function');
    assert.equal(typeof service.listLeadConversationLinks, 'function');
    assert.equal(typeof service.listConversationLeadLinks, 'function');

    const source = fs.readFileSync(path.join(repoRoot, 'services', 'leadConversationLinks.js'), 'utf8');
    assert.match(source, /pg_advisory_xact_lock/);
    const routeSource = fs.readFileSync(path.join(repoRoot, 'routes', 'leads.js'), 'utf8');
    assert.match(routeSource, /linkManualConversationPreservingLegacyOrigin/);
});

function createManualTransitionDb(existingRows = []) {
    const events = [];
    const client = {
        async query(text) {
            const sql = String(text).replace(/\s+/g, ' ').trim();
            events.push(sql);
            if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || /pg_advisory_xact_lock/.test(sql)) return { rows: [] };
            if (/SELECT conversation_id, is_origin, is_primary FROM lead_conversation_links/.test(sql)) {
                return { rows: existingRows.map(row => ({ ...row })) };
            }
            throw new Error(`Unexpected query: ${sql}`);
        },
        release() {},
    };
    return { client, db: { connect: async () => client }, events };
}

test('manual linking atomically preserves legacy origin without silently changing primary', async () => {
    const { linkManualConversationPreservingLegacyOrigin } = require('../services/leadConversationLinks');
    const fixture = createManualTransitionDb();
    const state = [];
    const writeEvents = [];
    const linkWriter = async (candidate, { client }) => {
        assert.equal(client, fixture.client);
        writeEvents.push(candidate.conversationId);
        let row = state.find(item => item.conversationId === candidate.conversationId);
        if (!row) {
            row = {
                id: state.length + 1,
                conversationId: candidate.conversationId,
                channel: candidate.conversationId === 10 ? 'instagram' : 'telegram',
                isOrigin: false,
                isPrimary: false,
                source: candidate.source,
            };
            state.push(row);
        }
        if (candidate.isOrigin) {
            state.forEach(item => { item.isOrigin = false; });
            row.isOrigin = true;
        }
        if (candidate.isPrimary) {
            state.forEach(item => { item.isPrimary = false; });
            row.isPrimary = true;
        }
        return { ...row };
    };

    await linkManualConversationPreservingLegacyOrigin({
        businessContext: 'event_genix', leadId: 137, conversationId: 20, source: 'lead_workspace_manual',
    }, {
        db: fixture.db,
        resolveLegacyOrigin: async () => ({ conversationId: 10, evidence: ['lead.external_id', 'lead.raw_payload'] }),
        linkWriter,
    });

    assert.deepEqual(writeEvents, [10, 20]);
    assert.deepEqual(state.map(item => ({ id: item.conversationId, origin: item.isOrigin, primary: item.isPrimary })), [
        { id: 10, origin: true, primary: true },
        { id: 20, origin: false, primary: false },
    ]);
    assert.ok(fixture.events.includes('BEGIN'));
    assert.ok(fixture.events.includes('COMMIT'));
    assert.equal(fixture.events.includes('ROLLBACK'), false);

    state.forEach(item => { item.isPrimary = item.conversationId === 20; });
    const { resolveLeadConversationContext } = require('../services/leadConversationResolver');
    const reloaded = await resolveLeadConversationContext({
        leadId: 137,
        businessContext: 'event_genix',
        lead: { id: 137, business_context: 'event_genix', client_name: 'Changed name', phone: '+380000000000' },
    }, {
        db: { query: async () => ({ rows: [] }) },
        listConfirmedLinks: async () => state.map(item => ({
            ...item,
            leadId: 137,
            conversationStatus: 'open',
        })),
    });
    assert.deepEqual(reloaded.confirmedLinks.map(item => ({ id: item.id, origin: item.isOrigin, primary: item.isPrimary })), [
        { id: 10, origin: true, primary: false },
        { id: 20, origin: false, primary: true },
    ]);
    assert.deepEqual(reloaded.resolution, { action: 'open', reason: 'primary', conversationId: 20 });
});

test('manual link failure rolls back legacy-origin preservation', async () => {
    const { linkManualConversationPreservingLegacyOrigin } = require('../services/leadConversationLinks');
    const fixture = createManualTransitionDb();
    await assert.rejects(linkManualConversationPreservingLegacyOrigin({
        businessContext: 'event_genix', leadId: 137, conversationId: 20, source: 'lead_workspace_manual',
    }, {
        db: fixture.db,
        resolveLegacyOrigin: async () => ({ conversationId: 10, evidence: ['lead.external_id', 'lead.raw_payload'] }),
        linkWriter: async candidate => {
            if (candidate.conversationId === 20) throw new Error('manual link failed');
            return { id: 1 };
        },
    }), /manual link failed/);
    assert.ok(fixture.events.includes('ROLLBACK'));
    assert.equal(fixture.events.includes('COMMIT'), false);
});

test('legacy transition never replaces an existing explicit primary selection', async () => {
    const { linkManualConversationPreservingLegacyOrigin } = require('../services/leadConversationLinks');
    const fixture = createManualTransitionDb([{
        conversation_id: 20, is_origin: false, is_primary: true,
    }]);
    const writes = [];
    await linkManualConversationPreservingLegacyOrigin({
        businessContext: 'event_genix', leadId: 137, conversationId: 30, source: 'lead_workspace_manual',
    }, {
        db: fixture.db,
        resolveLegacyOrigin: async () => ({ conversationId: 10, evidence: ['lead.external_id', 'lead.raw_payload'] }),
        linkWriter: async candidate => {
            writes.push(candidate);
            return { id: candidate.conversationId };
        },
    });
    assert.equal(writes[0].conversationId, 10);
    assert.equal(writes[0].isOrigin, true);
    assert.equal(writes[0].isPrimary, false);
    assert.equal(writes[1].conversationId, 30);
    assert.equal(writes[1].isPrimary, false);
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
