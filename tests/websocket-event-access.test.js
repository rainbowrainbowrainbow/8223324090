'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

function membership(context, role = 'director') {
    return {
        organization_id: 7, organization_slug: 'fixture', organization_name: 'Fixture', organization_role: 'member',
        business_id: context === 'event_genix' ? 11 : 12, context_key: context,
        business_label: context, business_short_label: context, business_modules: [], access_mode: 'membership',
        role, extra_roles: [], page_allowlist: [], page_denylist: [], action_allowlist: [], action_denylist: [],
        is_default: context === 'event_genix'
    };
}

function fixture(t) {
    const user = { id: 42, username: 'fixture_member', name: 'Fixture Member', role: 'director',
        business_contexts: ['event_genix', 'dar'], default_business_context: 'event_genix', is_active: true };
    const state = {
        storedDefault: 'event_genix', accountExists: true,
        calls: [], memberships: [membership('event_genix'), membership('dar', 'animator')],
        registry: ['event_genix', 'dar'].map(context => ({ business_id: context === 'event_genix' ? 11 : 12,
            organization_id: 7, context_key: context, access_mode: 'membership', business_status: 'active', organization_status: 'active' })),
        tasks: [{ id: 51, business_context: 'event_genix' }], taskVisible: true,
        channels: [{ id: 4, type: 'general', is_archived: false }], channelMember: true,
        bookings: [{ id: 'BK-TEST-1', business_context: 'event_genix', created_by: 'other_fixture' }],
        sharedOrganization: true, organizations: [{ id: 7 }], attendance: [{ id: 61, business_context: 'event_genix' }],
        fail: null, membershipFail: null
    };
    const pool = { async query(sql, params = []) {
        const text = String(sql).replace(/\s+/g, ' ').trim();
        state.calls.push({ sql: text, params: structuredClone(params) });
        if (state.fail) throw state.fail;
        if (text === 'SELECT default_business_context FROM users WHERE id = $1') {
            assert.equal(params[0], user.id);
            return { rows: state.accountExists ? [{ default_business_context: state.storedDefault }] : [] };
        }
        if (text.includes('FROM organization_memberships om')) {
            if (state.membershipFail) throw state.membershipFail;
            return { rows: structuredClone(state.memberships) };
        }
        if (text.includes('FROM businesses b JOIN organizations')) return { rows: structuredClone(state.registry.filter(row => params[0].includes(row.context_key))) };
        if (text.startsWith('SELECT id, business_context FROM tasks')) return { rows: state.tasks.filter(row => row.id === params[0]) };
        if (text.startsWith('SELECT t.id FROM tasks t')) return { rows: state.taskVisible ? state.tasks.filter(row => row.id === params[0] && row.business_context === params[1]) : [] };
        if (text.includes('FROM chat_channels c JOIN chat_channel_members cm')) {
            assert.equal(params[1], user.id);
            assert.match(text, /COALESCE\(c.is_archived, false\) = false/);
            return { rows: state.channelMember ? state.channels.filter(row => row.id === params[0] && !row.is_archived) : [] };
        }
        if (text.startsWith('SELECT b.* FROM bookings b')) return { rows: state.bookings.filter(row => row.id === params[0]) };
        if (text.includes('FROM organization_memberships recipient')) {
            assert.match(text, /recipient.is_active IS TRUE AND subject.is_active IS TRUE/);
            assert.match(text, /o.status = 'active'/);
            return { rows: state.sharedOrganization ? [{}] : [] };
        }
        if (text === 'SELECT id FROM organizations LIMIT 1') return { rows: state.organizations.slice(0, 1) };
        if (text.startsWith('SELECT business_context FROM hr_time_records')) return { rows: state.attendance.filter(row => row.id === params[0]) };
        throw new Error(`Unsupported event-access fixture SQL: ${text}`);
    } };
    const dbId = require.resolve('../db');
    const serviceId = require.resolve('../services/websocketEventAccess');
    const previousDb = require.cache[dbId];
    const previousService = require.cache[serviceId];
    require.cache[dbId] = { id: dbId, filename: dbId, loaded: true, exports: { pool } };
    delete require.cache[serviceId];
    const service = require('../services/websocketEventAccess');
    t.after(() => {
        if (previousDb) require.cache[dbId] = previousDb;
        else delete require.cache[dbId];
        if (previousService) require.cache[serviceId] = previousService;
        else delete require.cache[serviceId];
    });
    return { user, state, ...service };
}

function preCutoverPark(f) {
    f.state.memberships = [];
    f.state.registry[0].access_mode = 'compatibility';
}

test('business events reject missing, malformed, aggregate and unregistered context instead of defaulting to Park', async t => {
    const f = fixture(t);
    for (const context of [undefined, '', 'all', 'all_business', 'overview', 'multi', 'selected', '../dar', ['dar']]) {
        assert.equal(await f.loadBusinessEventUser(f.user, context), null, String(context));
    }
    assert.equal(f.state.calls.length, 0);
    assert.equal(await f.loadBusinessEventUser(f.user, 'unregistered_fixture'), null);
});

test('every event resolves fresh membership roles and rejects revoked or inactive business access', async t => {
    const f = fixture(t);
    assert.equal((await f.loadBusinessEventUser(f.user, 'dar')).role, 'animator');
    f.state.memberships[1].role = 'reception';
    assert.equal((await f.loadBusinessEventUser(f.user, 'dar')).role, 'reception');
    f.state.memberships.pop();
    assert.equal(await f.loadBusinessEventUser(f.user, 'dar'), null);
    assert.equal((await f.loadBusinessEventUser(f.user, 'event_genix')).role, 'director');
    f.state.registry[0].organization_status = 'inactive';
    assert.equal(await f.loadBusinessEventUser(f.user, 'event_genix'), null);
});

test('registered custom-only businesses retain their own role and page overrides', async t => {
    const f = fixture(t);
    f.state.memberships = [membership('fixture_custom', 'manager')];
    f.state.memberships[0].page_denylist = ['/omni'];
    f.state.registry = [{ ...f.state.registry[1], context_key: 'fixture_custom' }];
    assert.equal((await f.loadBusinessEventUser(f.user, 'fixture_custom')).role, 'manager');
    assert.equal(await f.canReceiveEvent(f.user, 'omni:message', { businessContext: 'fixture_custom' }, { page: '/omni' }), false);
    f.state.memberships[0].page_allowlist = ['/omni'];
    f.state.memberships[0].page_denylist = [];
    assert.equal(await f.canReceiveEvent(f.user, 'omni:message', { businessContext: 'fixture_custom' }, { page: '/omni' }), true);
});

test('task events use canonical task context and current SQL visibility, not recipient identity or payload context', async t => {
    const f = fixture(t);
    for (const event of ['task:assigned', 'task:schedule_changed', 'task:slot_missed']) {
        assert.equal(await f.canReceiveEvent(f.user, event, { task: { id: 51 } }, { delivery: 'user' }), true);
    }
    assert.equal(await f.canReceiveEvent(f.user, 'task:assigned', { task: { id: 51, businessContext: 'dar' } }), false);
    assert.equal(await f.canReceiveEvent(f.user, 'task:assigned', { task: { id: 999 } }), false);
    f.state.taskVisible = false;
    assert.equal(await f.canReceiveEvent(f.user, 'task:schedule_changed', { task: { id: 51 } }), false);
    f.state.taskVisible = true;
    f.state.memberships.shift();
    assert.equal(await f.canReceiveEvent(f.user, 'task:slot_missed', { task: { id: 51 } }), false);
});

test('generic and addressed Omni delivery cannot omit or substitute its required page capability', async t => {
    const f = fixture(t);
    f.state.memberships[0].page_denylist = ['/omni'];
    for (const delivery of ['broadcast', 'user', 'username']) {
        for (const page of [undefined, '/tasks', '/omni']) {
            assert.equal(await f.canReceiveEvent(f.user, 'omni:message', { businessContext: 'event_genix' }, { delivery, page }), false);
        }
    }
    f.state.memberships[0].page_denylist = [];
    assert.equal(await f.canReceiveEvent(f.user, 'omni:conversation', { businessContext: 'event_genix' }), true);
    assert.equal(await f.canReceiveEvent(f.user, 'omni:conversation', { businessContext: 'event_genix' }, { businessContext: 'dar' }), false);
    f.state.memberships[0].page_denylist = ['/tasks'];
    assert.equal(await f.canReceiveEvent(f.user, 'omni:conversation', { businessContext: 'event_genix' }, { page: '/tasks' }), false);
});

test('task query retains department and private/observer guards under the active business role', async t => {
    const f = fixture(t);
    f.state.memberships[0].role = 'manager';
    assert.equal(await f.canReceiveEvent(f.user, 'task:assigned', { task: { id: 51 } }), true);
    const query = f.state.calls.find(row => row.sql.startsWith('SELECT t.id FROM tasks t'));
    assert.match(query.sql, /t.business_context = \$2/);
    assert.match(query.sql, /ep.department/);
    assert.match(query.sql, /task_observers/);
    assert.match(query.sql, /COALESCE\(t.visibility, 'team'\)/);
    assert.deepEqual(query.params.slice(0, 2), [51, 'event_genix']);
    f.state.tasks[0].business_context = null;
    assert.equal(await f.canReceiveEvent(f.user, 'task:assigned', { task: { id: 51 } }), false);
});

test('general/room/DM channels preserve pre-cutover Park membership compatibility and recheck channel revocation', async t => {
    const f = fixture(t);
    preCutoverPark(f);
    for (const type of ['general', 'room', 'assistant', 'dm']) {
        f.state.channels[0].type = type;
        assert.equal(await f.canReceiveEvent(f.user, 'chat:message', { channelId: 4, message: { content: 'Fixture' } }), true, type);
    }
    assert.equal(f.state.calls.some(row => /FROM businesses/.test(row.sql)), true, 'Recipient compatibility is refreshed; channel ownership is not assigned');
    assert.equal(await f.canReceiveEvent(f.user, 'chat:joined', {}, { channelId: 4, delivery: 'user' }), true);
    f.state.channelMember = false;
    assert.equal(await f.canReceiveEvent(f.user, 'chat:message', { channelId: 4 }), false);
    assert.equal(await f.canReceiveEvent(f.user, 'chat:mention', { channelId: 4 }, { delivery: 'user' }), false);
});

test('channel IDs and archived channels fail closed for messages, mentions and invitations', async t => {
    const f = fixture(t);
    for (const event of ['chat:message', 'chat:mention', 'chat:channel-invite']) {
        assert.equal(await f.canReceiveEvent(f.user, event, { channelId: 5 }, { channelId: 4 }), false);
        for (const channelId of [-1, true, [4], {}]) {
            assert.equal(await f.canReceiveEvent(f.user, event, {}, { channelId }), false);
        }
    }
    f.state.channels[0].is_archived = true;
    assert.equal(await f.canReceiveEvent(f.user, 'chat:message', { channelId: 4 }), false);
});

test('booking-linked chat requires membership and booking visibility with both durable link forms', async t => {
    const f = fixture(t);
    f.state.channels[0] = { id: 4, type: 'booking', linked_booking_id: 'BK-TEST-1' };
    assert.equal(await f.canReceiveEvent(f.user, 'chat:message', { channelId: 4 }), true);
    f.state.memberships[0].role = 'animator';
    assert.equal(await f.canReceiveEvent(f.user, 'chat:message', { channelId: 4 }), false);
    f.state.memberships[0].role = 'director';
    f.state.channels[0] = { id: 4, type: 'booking', linked_entity_type: 'booking', linked_entity_id: 101 };
    f.state.bookings = [{ id: '101', business_context: 'event_genix' }];
    assert.equal(await f.canReceiveEvent(f.user, 'chat:message', { channelId: 4 }), true);
    f.state.channels[0].linked_booking_id = 'BK-CONFLICT';
    assert.equal(await f.canReceiveEvent(f.user, 'chat:message', { channelId: 4 }), false);
    f.state.channels[0] = { id: 4, type: 'booking' };
    assert.equal(await f.canReceiveEvent(f.user, 'chat:message', { channelId: 4 }), false);
});

test('direct and embedded booking previews cannot expose another business through a legacy channel', async t => {
    const f = fixture(t);
    preCutoverPark(f);
    const preview = { id: 'BK-TEST-1', price: 100 };
    const payloads = [
        ['chat:booking-preview', { channelId: 4, bookingPreview: preview }],
        ['chat:message', { channelId: 4, message: { metadata: { bookingPreview: preview } } }],
        ['chat:edit', { channelId: 4, message: { metadata: JSON.stringify({ bookingPreview: preview }) } }]
    ];
    for (const [event, data] of payloads) assert.equal(await f.canReceiveEvent(f.user, event, data), true);
    f.state.registry[0].access_mode = 'membership';
    for (const [event, data] of payloads) assert.equal(await f.canReceiveEvent(f.user, event, data), false);
    assert.equal(await f.canReceiveEvent(f.user, 'chat:message', { channelId: 4, message: { metadata: '{' } }), false);
});

test('chat task IDs are channel-local and must not be looked up in canonical tasks', async t => {
    const f = fixture(t);
    preCutoverPark(f);
    assert.equal(await f.canReceiveEvent(f.user, 'chat:task', { channelId: 4, task: { id: 999, title: 'Chat fixture' } }), true);
    assert.equal(f.state.calls.some(row => /FROM tasks/.test(row.sql)), false);
});

test('presence requires shared active organization after bootstrap and permits only empty-registry compatibility', async t => {
    const f = fixture(t);
    for (const event of ['user:online', 'user:offline', 'user:status']) assert.equal(await f.canReceiveEvent(f.user, event, { userId: 81 }), true);
    f.state.sharedOrganization = false;
    assert.equal(await f.canReceiveEvent(f.user, 'user:online', { userId: 81 }), false);
    f.state.organizations = [];
    assert.equal(await f.canReceiveEvent(f.user, 'user:offline', { userId: 81 }), true);
    assert.equal(await f.canReceiveEvent(f.user, 'user:online', {}), false);
});

test('only inert guardian mood and empty alert shapes are allowed without business ownership', async t => {
    const f = fixture(t);
    assert.equal(await f.canReceiveEvent(f.user, 'guardian:mood', { emoji: 'x', label: 'Calm', level: 'default', prevEmoji: 'y' }), true);
    assert.equal(await f.canReceiveEvent(f.user, 'guardian:mood', { emoji: 'x', secret: 'fixture' }), false);
    assert.equal(await f.canReceiveEvent(f.user, 'alert:updated', { alerts: [], count: 0 }), true);
    assert.equal(await f.canReceiveEvent(f.user, 'alert:updated', { alerts: [{ title: 'Private fixture' }], count: 1 }), false);
    assert.equal(await f.canReceiveEvent(f.user, 'alert:updated', { alerts: [], count: 0, privateData: true }), false);
    assert.equal(f.state.calls.length, 0);
    preCutoverPark(f);
    assert.equal(await f.canReceiveEvent(f.user, 'guardian:event', { channelId: null, details: 'Fixture' }), false);
    assert.equal(await f.canReceiveEvent(f.user, 'guardian:health', { channelId: 4, score: 50 }), true);
    f.state.channelMember = false;
    assert.equal(await f.canReceiveEvent(f.user, 'guardian:health', { channelId: 4, score: 50 }), false);
});

test('attendance requires explicit matching scope or a durable time record and never guesses from staff ID', async t => {
    const f = fixture(t);
    assert.equal(await f.canReceiveEvent(f.user, 'hr:attendance-updated', { businessContext: 'event_genix', staffIds: [1] }), true);
    assert.equal(await f.canReceiveEvent(f.user, 'hr:attendance-updated', { hrTimeRecord: { id: 61 } }), true);
    assert.equal(await f.canReceiveEvent(f.user, 'hr:attendance-updated', { staffId: 1 }), false);
    assert.equal(await f.canReceiveEvent(f.user, 'hr:attendance-updated', { businessContext: 'dar', hrTimeRecord: { id: 61 } }), false);
    assert.equal(await f.canReceiveEvent(f.user, 'hr:attendance-updated', { hrTimeRecord: { id: 999, business_context: 'event_genix' } }), false);
    f.state.memberships.shift();
    assert.equal(await f.canReceiveEvent(f.user, 'hr:attendance-updated', { hrTimeRecord: { id: 61 } }), false);
});

test('Kleshnya transcripts require pre-cutover Park and username-addressed delivery; protected generic events stay denied', async t => {
    const f = fixture(t);
    preCutoverPark(f);
    for (const event of ['kleshnya:thinking', 'kleshnya:reply', 'kleshnya:media']) {
        assert.equal(await f.canReceiveEvent(f.user, event, {}, { delivery: 'username' }), true);
        assert.equal(await f.canReceiveEvent(f.user, event, {}, { delivery: 'broadcast' }), false);
    }
    for (const event of ['unknown:message', 'booking:updated', 'line:updated', 'banquet:arrival-updated', 'timeline:roster-updated']) {
        assert.equal(await f.canReceiveEvent(f.user, event, { businessContext: 'event_genix' }, { businessContext: 'event_genix' }), false);
    }
    assert.equal(await f.canReceiveEvent({ ...f.user, is_active: false }, 'guardian:mood', {}), false);
});

test('D05 unowned channel join, typing, broadcast and direct notification deny all membership roles and organizations', async t => {
    const f = fixture(t);
    f.state.registry.push({ ...f.state.registry[1], business_id: 13, organization_id: 8, context_key: 'fixture_custom' });
    f.state.memberships.push({ ...membership('fixture_custom', 'manager'), business_id: 13, organization_id: 8 });
    for (const context of ['event_genix', 'dar', 'fixture_custom']) {
        f.state.storedDefault = context;
        for (const role of ['creator', 'director', 'animator']) {
            f.user.role = role;
            for (const type of ['general', 'room', 'assistant', 'dm']) {
                f.state.channels[0].type = type;
                for (const event of ['chat:joined', 'chat:typing', 'chat:message', 'chat:mention']) {
                    assert.equal(await f.canReceiveEvent(f.user, event, { channelId: 4, businessContext: 'event_genix' },
                        { channelId: 4, delivery: event === 'chat:message' ? 'channel' : 'user' }), false, `${context}/${role}/${type}/${event}`);
                }
            }
        }
    }
});

test('D05 unowned delivery uses the stored default and never payload context or normalized account fallbacks', async t => {
    const f = fixture(t);
    preCutoverPark(f);
    for (const context of [undefined, null, '', 'all', 'crm', 'maysternya_doli', 'dar', 'unknown_fixture']) {
        f.state.storedDefault = context;
        const normalizedUser = { ...f.user, defaultBusinessContext: 'event_genix' };
        assert.equal(await f.canReceiveEvent(normalizedUser, 'chat:message', { channelId: 4, businessContext: 'event_genix' }), false);
        assert.equal(await f.canReceiveEvent(normalizedUser, 'kleshnya:reply', { businessContext: 'event_genix' }, { delivery: 'username' }), false);
    }
    f.state.storedDefault = 'event_genix';
    assert.equal(await f.canReceiveEvent({ ...f.user, defaultBusinessContext: 'dar' }, 'chat:message', { channelId: 4 }), true,
        'Explicit DB default, not stale profile aliases, chooses the compatibility request scope');
    f.state.accountExists = false;
    assert.equal(await f.canReceiveEvent(f.user, 'chat:message', { channelId: 4 }), false);
});

test('D05 transcript and channel recipients recheck cutover, membership revocation and inactive registry on every event', async t => {
    const f = fixture(t);
    preCutoverPark(f);
    async function delivery(expected) {
        assert.equal(await f.canReceiveEvent(f.user, 'chat:message', { channelId: 4 }), expected);
        for (const event of ['kleshnya:thinking', 'kleshnya:reply', 'kleshnya:media']) {
            assert.equal(await f.canReceiveEvent(f.user, event, {}, { delivery: 'username' }), expected);
        }
    }
    await delivery(true);
    f.state.registry[0].access_mode = 'membership';
    f.state.memberships = [membership('event_genix')];
    await delivery(false);
    f.state.memberships = [];
    await delivery(false);
    f.state.registry[0].access_mode = 'compatibility';
    f.state.registry[0].organization_status = 'inactive';
    await delivery(false);
    f.state.registry[0].organization_status = 'active';
    f.state.registry[0].business_status = 'inactive';
    await delivery(false);
});

test('D05 unavailable membership storage cannot recover unowned events using stale account fields', async t => {
    const f = fixture(t);
    preCutoverPark(f);
    f.state.fail = new Error('Fixture database unavailable');
    await assert.rejects(f.canReceiveEvent(f.user, 'kleshnya:reply', {}, { delivery: 'username' }), f.state.fail);
    f.state.fail = null;
    f.state.membershipFail = new Error('Unexpected event fixture query: SELECT organization membership');
    assert.equal(await f.canReceiveEvent(f.user, 'kleshnya:reply', {}, { delivery: 'username' }), false);
});

test('attendance authorization requires the current business hr.today.view capability and honors explicit denial', async t => {
    const f = fixture(t);
    const payload = { hrTimeRecord: { id: 61 } };
    assert.equal(await f.canReceiveEvent(f.user, 'hr:attendance-updated', payload), true, 'Director membership can view HR today');
    f.state.memberships[0].role = 'animator';
    assert.equal(await f.canReceiveEvent(f.user, 'hr:attendance-updated', payload), false, 'Legacy director account cannot replace animator membership rights');
    f.state.memberships[0].role = 'director';
    f.state.memberships[0].action_denylist = ['hr.today.view'];
    assert.equal(await f.canReceiveEvent(f.user, 'hr:attendance-updated', payload), false, 'Explicit business action deny wins');
    f.state.memberships[0].action_denylist = [];
    assert.equal(await f.canReceiveEvent(f.user, 'hr:attendance-updated', payload), true);
});

test('SQL/schema failures and explicit membership test-double fallbacks never grant business event access', async t => {
    const f = fixture(t);
    for (const error of [Object.assign(new Error('Fixture missing schema'), { code: '42P01' }), new Error('Fixture database unavailable')]) {
        f.state.fail = error;
        await assert.rejects(f.loadBusinessEventUser(f.user, 'event_genix'), error);
        await assert.rejects(f.canReceiveEvent(f.user, 'user:online', { userId: 81 }), error);
    }
    f.state.fail = new Error('Unexpected event fixture query: SELECT organization membership');
    assert.equal(await f.loadBusinessEventUser(f.user, 'event_genix'), null);
});
