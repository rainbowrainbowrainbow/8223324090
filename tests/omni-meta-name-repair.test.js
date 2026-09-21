'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { runRepair, parseArgs, validateOptions, main } = require('../scripts/repair-omni-meta-names');
const saved = new Map();
function mock(name, exports) {
    const id = require.resolve(name);
    if (!saved.has(id)) saved.set(id, require.cache[id]);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}
afterEach(() => {
    for (const [id, value] of saved) { if (value) require.cache[id] = value; else delete require.cache[id]; }
    saved.clear();
});
const dates = ['2026-09-20 15:12:32.92626', '2026-09-20 16:00:15.952587', '2026-09-20 17:31:00.791277'];
const base = { businessContext: 'event_genix', cohort: 'diagnosis-2026-09-21', limit: 3 };
function harness() {
    const rows = dates.map((createdAt, i) => ({ id: String(91001 + i), externalId: String(9900000001 + i),
        channel: i === 2 ? 'instagram' : 'facebook', businessContext: 'event_genix', customerName: 'Unknown',
        createdAt, updatedAt: createdAt, customerId: 'fixture-customer-link' }));
    const queries = [], lookups = [], state = { beforeRead: null, beforeUpdate: null, provenance: null, duplicates: false };
    const runtime = { pageId: '8800000001', pageToken: 'fixture-secret-token' };
    const client = { async query(query) {
        const text = typeof query === 'string' ? query : query.text;
        const values = query.values || [];
        queries.push({ text, values });
        if (text.startsWith('SHOW transaction_read_only')) return { rows: [{ transaction_read_only: 'on' }] };
        if (/^(BEGIN|ROLLBACK|SET)/.test(text)) return { rows: [] };
        if (text.includes('FROM conversation_messages')) {
            const row = rows.find(r => r.id === values[0]);
            return { rows: state.provenance || [{ sender: row.externalId, recipient: runtime.pageId,
                messageId: 'fixture-message', webhookMessageId: 'fixture-message', echo: 'false' }] };
        }
        if (text.includes('FROM conversations WHERE COALESCE')) {
            assert.match(text, /created_at::text = \$3/);
            assert.equal(typeof values[2], 'string');
            const matched = rows.filter(r => r.businessContext === values[0] && r.channel === values[1]
                && r.createdAt === values[2] && (!values[3] || r.id === values[3]));
            return { rows: state.duplicates ? [...matched, ...matched] : matched.map(r => ({ ...r })) };
        }
        if (text.includes('FROM conversations WHERE id')) {
            if (state.beforeRead) state.beforeRead();
            return { rows: rows.filter(r => r.id === values[0] && r.channel === values[1] && r.businessContext === values[2]).map(r => ({ ...r })) };
        }
        if (text.startsWith('UPDATE conversations')) {
            if (state.beforeUpdate) state.beforeUpdate();
            assert.match(text, /channel = \$5 AND external_id = \$3/);
            assert.match(text, /COALESCE\(business_context, 'event_genix'\) = \$4/);
            assert.match(text, /LOWER\(BTRIM\(customer_name\)\) = 'unknown'/);
            assert.match(text, /created_at::text = \$6 AND updated_at::text IS NOT DISTINCT FROM \$7/);
            const row = rows.find(r => r.id === values[1] && r.externalId === values[2] && r.businessContext === values[3]
                && r.channel === values[4] && r.createdAt === values[5] && r.updatedAt === values[6]
                && (!r.customerName || !r.customerName.trim() || r.customerName.trim().toLowerCase() === 'unknown'));
            if (!row) return { rows: [] };
            row.customerName = values[0]; row.updatedAt = '2026-09-21 12:00:00';
            return { rows: [{ id: row.id }] };
        }
        throw new Error('Unexpected fixture query');
    } };
    const deps = { resolveRuntime: async (channel, options) => {
        assert.equal(options.ownershipClient, client); assert.equal(options.strict, true);
        assert.equal(options.businessContext, 'event_genix');
        return { ...runtime };
    }, lookup: async (target, options) => {
        assert.equal(options.ownershipClient, client); lookups.push(target.id);
        return { success: true, profileId: target.externalId, name: 'Private Fixture Name' };
    } };
    return { client, rows, queries, lookups, deps, runtime, state };
}
const writes = h => h.queries.filter(q => /^(UPDATE|INSERT|DELETE)/.test(q.text));
async function digest(h) { return (await runRepair(h.client, { ...base, inspectOnly: true }, h.deps)).scopeDigest; }

test('default CLI mode is dry-run and requires exact bounded scope', () => {
    const parsed = parseArgs(['--business-context', 'event_genix', '--cohort', 'diagnosis-2026-09-21', '--limit', '3']);
    assert.ok(!parsed.apply); assert.equal(validateOptions(parsed).length, 3);
    for (const change of [{ limit: 4 }, { limit: 0 }, { limit: 2 }, { businessContext: 'dar' }, { cohort: 'all' },
        { apply: true }, { apply: 'true' }, { targets: [] }, { expectedScopeDigest: 'bad' }]) {
        assert.throws(() => validateOptions({ ...base, ...change }));
    }
    for (const args of [['--apply', '--dry-run'], ['--apply', '--apply'], ['--unknown'], ['--limit'],
        ['--scope-stdin', '--cohort', 'diagnosis-2026-09-21']]) assert.throws(() => parseArgs(args));
});

test('exact selectors never select an unrelated chat or convert native DB timestamps', async () => {
    const h = harness();
    h.rows.push({ ...h.rows[0], id: '77777', createdAt: '2026-09-20 18:12:32.92626' });
    const report = await runRepair(h.client, base, h.deps);
    assert.equal(report.selected, 3); assert.equal(report.ready, 3);
    assert.deepEqual(h.lookups, ['91001', '91002', '91003']);
    assert.equal(h.rows[3].customerName, 'Unknown');
    const exact = { businessContext: 'event_genix', limit: 1,
        targets: [{ channel: 'instagram', conversationId: '91003', createdAt: dates[2] }] };
    assert.equal((await runRepair(h.client, exact, h.deps)).selected, 1);
    for (const bad of [{ conversationId: 91003 }, { conversationId: '91002' }, { channel: 'facebook' },
        { createdAt: dates[2] + 'Z' }, { createdAt: '2026-09-20 20:31:00.791277' }]) {
        await assert.rejects(runRepair(h.client, { ...exact, targets: [{ ...exact.targets[0], ...bad }] }, h.deps));
    }
});

test('ambiguous, missing or wrong-business cohort fails before lookup', async () => {
    for (const kind of ['ambiguous', 'missing', 'business']) {
        const h = harness();
        if (kind === 'ambiguous') h.state.duplicates = true;
        if (kind === 'missing') h.rows.pop();
        if (kind === 'business') h.rows[0].businessContext = 'dar';
        await assert.rejects(runRepair(h.client, base, h.deps));
        assert.equal(h.lookups.length, 0); assert.equal(writes(h).length, 0);
    }
});

test('dry-run is write-free, serial, redacted and continues after unavailable Meta object', async () => {
    const h = harness();
    const lookup = h.deps.lookup;
    h.deps.lookup = async (target, options) => target.id === '91001'
        ? { success: false, code: 'PROFILE_OBJECT_UNAVAILABLE', error: 'secret payload 100/33' } : lookup(target, options);
    const report = await runRepair(h.client, base, h.deps);
    assert.equal(report.ready, 2); assert.equal(report.unavailable, 1); assert.equal(report.lookupAttempts, 3);
    assert.equal(writes(h).length, 0); assert.ok(h.rows.every(r => r.customerName === 'Unknown'));
    assert.equal(report.results[0].code, 'PROFILE_OBJECT_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(report), /91001|990000000|880000000|Private Fixture|secret|fixture-message/);
});

test('inspect-only makes zero profile calls and exposes only provenance flags', async () => {
    const h = harness(); const report = await runRepair(h.client, { ...base, inspectOnly: true }, h.deps);
    assert.equal(report.lookupAttempts, 0); assert.equal(h.lookups.length, 0); assert.equal(writes(h).length, 0);
    assert.equal(report.results[0].provenance.senderMatchesExternalId, true);
    assert.ok(h.queries.filter(q => q.text.includes('FROM conversation_messages')).every(q => !/\bcontent\b|SELECT \*/i.test(q.text)));
});

test('apply rejects a changed pinned internal ID, external ID, Page, timestamp or scope digest before GET', async () => {
    for (const kind of ['id', 'externalId', 'page', 'time', 'digest']) {
        const h = harness(); const expectedScopeDigest = await digest(h);
        if (kind === 'id') h.rows[0].id = '91009';
        if (kind === 'externalId') h.rows[0].externalId = '9900000099';
        if (kind === 'page') h.runtime.pageId = '8800000099';
        if (kind === 'time') h.rows[0].createdAt = '2026-09-20 15:12:32.926';
        await assert.rejects(runRepair(h.client, { ...base, apply: true,
            expectedScopeDigest: kind === 'digest' ? 'a'.repeat(64) : expectedScopeDigest }, h.deps));
        assert.equal(h.lookups.length, 0); assert.equal(writes(h).length, 0);
    }
});

test('apply updates only verified names and a repeated apply is a no-op without new GETs', async () => {
    const h = harness(); const expectedScopeDigest = await digest(h);
    const before = h.rows.map(r => ({ ...r }));
    const first = await runRepair(h.client, { ...base, apply: true, expectedScopeDigest }, h.deps);
    assert.equal(first.applied, 3); assert.equal(writes(h).length, 3);
    for (let i = 0; i < 3; i++) {
        assert.equal(h.rows[i].externalId, before[i].externalId);
        assert.equal(h.rows[i].customerId, before[i].customerId);
        assert.equal(h.rows[i].customerName, 'Private Fixture Name');
    }
    const second = await runRepair(h.client, { ...base, apply: true, expectedScopeDigest }, h.deps);
    assert.equal(second.applied, 0); assert.equal(second.lookupAttempts, 0); assert.equal(second.skipped, 3);
    assert.equal(writes(h).length, 3);
});

for (const timing of ['beforeRead', 'beforeUpdate']) {
    test('concurrent manual rename is preserved at ' + timing, async () => {
        const h = harness(); const expectedScopeDigest = await digest(h);
        h.state[timing] = () => { h.rows[0].customerName = 'Manual Name'; h.rows[0].updatedAt = '2026-09-21 11:00:00'; };
        const report = await runRepair(h.client, { ...base, apply: true, expectedScopeDigest }, h.deps);
        assert.equal(h.rows[0].customerName, 'Manual Name'); assert.equal(report.results[0].code, 'CONCURRENT_CHANGE');
        assert.equal(report.applied, 2);
    });
}

for (const field of ['externalId', 'channel', 'businessContext', 'createdAt', 'updatedAt']) {
    test('binding/snapshot change during lookup is rejected: ' + field, async () => {
        const h = harness(); const expectedScopeDigest = await digest(h); const lookup = h.deps.lookup;
        h.deps.lookup = async (target, options) => {
            const result = await lookup(target, options);
            if (target.id === '91001') h.rows[0][field] = 'changed';
            return result;
        };
        const report = await runRepair(h.client, { ...base, apply: true, expectedScopeDigest }, h.deps);
        assert.equal(report.results[0].code, 'CONCURRENT_CHANGE'); assert.equal(h.rows[0].customerName, 'Unknown');
    });
}

test('Page/token binding changed during lookup prevents apply', async () => {
    const h = harness(); const expectedScopeDigest = await digest(h); const lookup = h.deps.lookup;
    h.deps.lookup = async (target, options) => {
        const result = await lookup(target, options); h.runtime.pageToken = 'new-fixture-token'; return result;
    };
    const report = await runRepair(h.client, { ...base, apply: true, expectedScopeDigest }, h.deps);
    assert.equal(report.applied, 0); assert.equal(writes(h).length, 0);
});

test('mismatch ID, empty profile, timeout and arbitrary provider details never write', async () => {
    for (const response of [
        { success: true, profileId: 'wrong', name: 'Wrong name' },
        { success: false, code: 'PROFILE_TIMEOUT' }, { success: false, code: 'sensitive-provider-text' },
        { success: true, profileId: '9900000001', name: ' ' },
    ]) {
        const h = harness(); const expectedScopeDigest = await digest(h); h.deps.lookup = async () => response;
        const report = await runRepair(h.client, { ...base, apply: true, expectedScopeDigest }, h.deps);
        assert.equal(report.applied, 0); assert.equal(writes(h).length, 0);
        assert.doesNotMatch(JSON.stringify(report), /sensitive-provider-text|Wrong name/);
    }
});

test('missing config and unconfirmed message provenance do not issue profile requests', async () => {
    const h = harness(); h.runtime.pageToken = '';
    assert.equal((await runRepair(h.client, base, h.deps)).lookupAttempts, 0);
    h.runtime.pageToken = 'fixture-token'; h.state.provenance = [];
    const report = await runRepair(h.client, base, h.deps);
    assert.equal(report.results[0].code, 'PROVENANCE_UNCONFIRMED');
    assert.equal(report.results[1].code, 'PROVENANCE_UNCONFIRMED');
    assert.equal(report.lookupAttempts, 0);
});

test('Instagram recipient can differ from Page while sender and message identity must match', async () => {
    const h = harness();
    const originalQuery = h.client.query;
    h.client.query = async query => {
        const result = await originalQuery(query);
        if (query.text?.includes('FROM conversation_messages') && query.values[0] === '91003') {
            result.rows[0].recipient = 'instagram-business-fixture';
        }
        return result;
    };
    const report = await runRepair(h.client, base, h.deps);
    assert.equal(report.results[2].provenance.recipientMatchesConfiguredPage, false);
    assert.equal(report.results[2].code, 'READY');
});

test('a throwing Meta lookup leaves that chat unchanged and does not block other targets', async () => {
    const h = harness(); const expectedScopeDigest = await digest(h); const lookup = h.deps.lookup;
    h.deps.lookup = async (target, options) => {
        if (target.id === '91001') throw new Error('private Meta payload');
        return lookup(target, options);
    };
    const report = await runRepair(h.client, { ...base, apply: true, expectedScopeDigest }, h.deps);
    assert.equal(report.applied, 2); assert.equal(report.unavailable, 1);
    assert.equal(h.rows[0].customerName, 'Unknown');
    assert.equal(report.results[0].code, 'PROFILE_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(report), /private Meta/);
});

test('operator uses canonical adapter name selection and exact ownership client', async () => {
    const h = harness(); const calls = [];
    mock('../services/omni-facebook', { getUserProfile: async (id, fields, options) => {
        calls.push({ id, fields, options }); return { success: true, profile: { id, firstName: 'Synthetic', lastName: 'Person' } };
    } });
    mock('../services/omni-instagram', { getUserProfile: async (id, fields, options) => {
        calls.push({ id, fields, options }); return { success: true, profile: { id, name: '', username: 'synthetic_username' } };
    } });
    delete h.deps.lookup;
    const expectedScopeDigest = await digest(h);
    const report = await runRepair(h.client, { ...base, apply: true, expectedScopeDigest }, h.deps);
    assert.equal(report.applied, 3); assert.equal(h.rows[2].customerName, 'synthetic_username');
    assert.ok(calls.every(c => c.options.ownershipClient === h.client && c.options.businessContext === 'event_genix'));
    assert.deepEqual(calls[2].fields, ['name', 'username']);
});

test('CLI dry-run uses explicit readonly DB, READ ONLY transaction and rollback', async t => {
    const h = harness();
    const previous = { ...process.env }; const previousExit = process.exitCode;
    t.after(() => { process.env = previous; process.exitCode = previousExit; });
    process.env.PRODUCTION_READONLY_DATABASE_URL = 'fixture-readonly-url'; process.env.JWT_SECRET = 'fixture-key';
    process.env.DATABASE_URL = 'must-not-be-used';
    const output = [];
    t.mock.method(console, 'log', value => output.push(value)); t.mock.method(console, 'error', value => output.push(value));
    let ended = false;
    mock('pg', { Client: class {
        constructor(config) { assert.equal(config.connectionString, 'fixture-readonly-url'); assert.match(config.options, /default_transaction_read_only=on/); }
        connect = async () => {}; query = h.client.query; end = async () => { ended = true; };
    } });
    mock('../services/omni-accounts', { resolveOmniRuntimeConfig: async () => h.runtime });
    await main(['--business-context', 'event_genix', '--cohort', 'diagnosis-2026-09-21', '--limit', '3', '--inspect-only']);
    assert.equal(JSON.parse(output[0]).mode, 'inspect-only'); assert.ok(ended);
    assert.ok(h.queries.some(q => q.text === 'BEGIN READ ONLY')); assert.ok(h.queries.some(q => q.text === 'ROLLBACK'));
    assert.equal(writes(h).length, 0);
});

test('CLI apply cannot fall back to DATABASE_URL or readonly credentials', async t => {
    const previous = { ...process.env }; const previousExit = process.exitCode;
    t.after(() => { process.env = previous; process.exitCode = previousExit; });
    delete process.env.META_NAMES_APPLY_DATABASE_URL;
    process.env.DATABASE_URL = 'sensitive-db-url'; process.env.PRODUCTION_READONLY_DATABASE_URL = 'sensitive-readonly-url';
    const output = []; t.mock.method(console, 'error', value => output.push(value));
    await main(['--business-context', 'event_genix', '--cohort', 'diagnosis-2026-09-21', '--limit', '3', '--apply', '--expected-scope-digest', 'a'.repeat(64)]);
    assert.equal(JSON.parse(output[0]).error, 'APPLY_DATABASE_URL_REQUIRED'); assert.doesNotMatch(output[0], /sensitive/);
});
