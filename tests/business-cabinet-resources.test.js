'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTimelineContext, canAccessTimelineContext } = require('../services/timelineContext');
const {
    initializeTimelineResources, listTimelineResources, timelineResourceLinesForMode,
    timelineResourceAvailability, normalizeTimelineDisplaySettings
} = require('../services/timelineResources');
const { buildMembershipAccess, applyMembershipAccess } = require('../services/businessMembership');
const graduation = require('../routes/graduation').__test;

function actor(context = 'fixture_studio', modules = ['timeline']) {
    const user = { id: 1, role: 'creator', business_contexts: ['event_genix'], default_business_context: context };
    const rows = [{ id: 1, business_id: 1, organization_id: 1, context_key: context,
        organization_name: 'Fixture Organization', organization_role: 'owner', business_label: 'Fixture Studio',
        business_short_label: 'Studio', business_modules: modules, access_mode: 'membership', role: 'director',
        is_default: true, business_status: 'active', organization_status: 'active' }];
    return applyMembershipAccess(user, buildMembershipAccess(user, rows, context, rows));
}

test('custom timeline context uses its own partition and module capability without inheriting Park defaults', () => {
    assert.equal(normalizeTimelineContext('FIXTURE_STUDIO'), 'fixture_studio');
    assert.equal(normalizeTimelineContext('park'), 'event_genix');
    assert.throws(() => normalizeTimelineContext('../studio'), /Invalid timeline business context/);
    assert.equal(canAccessTimelineContext(actor(), 'fixture_studio'), true);
    assert.equal(canAccessTimelineContext(actor(), 'event_genix'), false);
    assert.equal(canAccessTimelineContext(actor('fixture_studio', []), 'fixture_studio'), false);
    assert.equal(normalizeTimelineDisplaySettings({}, 'fixture_studio').mode, 'simple');
});

test('resource reads, availability and mode lines never initialize missing resources', async () => {
    const queries = [];
    const db = { async query(sql, params) {
        queries.push({ sql, params });
        assert.match(sql.trim(), /^SELECT \*/);
        assert.equal(params[0], 'fixture_studio');
        return { rows: [], rowCount: 0 };
    } };
    assert.deepEqual(await listTimelineResources(db, { context: 'fixture_studio', type: 'cabinet', ensureDefault: true }), []);
    assert.deepEqual(await timelineResourceLinesForMode(db, 'fixture_studio', 'education'), []);
    assert.equal((await timelineResourceAvailability(db, { context: 'fixture_studio', date: '2026-09-12', time: '10:00' })).total, 0);
    assert.equal(queries.length, 3);
});

test('initializer requires an explicit validated context and types before SQL', async () => {
    const db = { query() { assert.fail('Invalid initialization reached SQL'); } };
    await assert.rejects(initializeTimelineResources(db), /explicit business context/);
    await assert.rejects(initializeTimelineResources(db, '../studio'), /Invalid timeline business context/);
    await assert.rejects(initializeTimelineResources(db, 'dar', { types: ['bogus'] }), /Resource types/);
    await assert.rejects(initializeTimelineResources(db, 'dar', { types: [] }), /Resource types/);
});

test('custom resource initialization reports no defaults without INSERT or copying names/capacities', async () => {
    const queries = [];
    const result = await initializeTimelineResources({ async query(sql, params) {
        queries.push(sql);
        assert.match(sql.trim(), /^SELECT /);
        assert.ok(params[0].includes('fixture_studio'));
        return { rows: [{ count: 0 }], rowCount: 1 };
    } }, 'fixture_studio');
    assert.equal(result.created, 0);
    assert.equal(result.resourceTypes.length, 3);
    assert.ok(result.resourceTypes.every(item => item.status === 'no_defaults'));
    assert.equal(queries.length, 6);
});

test('graduation explicit and omitted custom context are consistently unavailable, including configured unsupported module', () => {
    for (const modules of [['timeline'], ['graduation']]) {
        const user = actor('fixture_studio', modules);
        for (const query of [{}, { businessContext: 'fixture_studio' }]) {
            const response = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
            assert.equal(graduation.requireGraduationBusinessContext({ user, query }, response), null);
            assert.equal(response.statusCode, 403);
            assert.equal(response.body.code, 'graduation_business_context_unavailable');
            assert.equal(response.body.businessContext, 'fixture_studio');
        }
    }
});

test('graduation presentation uses registry names and unknown business never gains Park conversion or contact', () => {
    const user = actor();
    const presentation = graduation.graduationBusinessPresentation('fixture_studio', user);
    assert.equal(presentation.businessLabel, 'Fixture Studio');
    assert.equal(presentation.catalogFooterContact, '');
    assert.doesNotMatch(JSON.stringify(presentation), /Закревського|0800|050/);
    for (const key of ['fixture_studio', 'dar', 'unknown', 'bad/key', '']) {
        const conversion = graduation.graduationBookingConversionStatus(key);
        assert.equal(conversion.supported, false);
        assert.notEqual(conversion.businessContext, 'event_genix');
    }
    assert.equal(graduation.graduationBookingConversionStatus('event_genix').supported, true);
});
