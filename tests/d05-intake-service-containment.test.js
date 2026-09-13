'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

function fixture(t) {
    const ids = ['../db', '../services/telegram', '../services/warehousePhotoIntake'].map(require.resolve);
    const previous = new Map(ids.map(id => [id, require.cache[id]]));
    const state = { calls: [], connections: 0, providers: 0, failRead: false,
        registry: [{ access_mode: 'compatibility', business_status: 'active', organization_status: 'active' }] };
    const pool = { async query(sql) {
        state.calls.push(String(sql));
        if (/FROM businesses/.test(sql)) {
            if (state.failRead) throw new Error('SENSITIVE_DRIVER_SENTINEL');
            return { rows: state.registry, rowCount: state.registry.length };
        }
        throw new Error('Blocked intake reached operational SQL');
    }, connect() { state.connections++; throw new Error('Blocked intake connected for warehouse writes'); } };
    const provider = () => { state.providers++; throw new Error('Blocked intake reached a provider'); };
    const install = (id, exports) => { require.cache[id] = { id, filename: id, loaded: true, exports }; };
    install(ids[0], { pool });
    install(ids[1], { downloadTelegramFileById: provider, getTelegramBotConfigStatus: provider });
    delete require.cache[ids[2]];
    const service = require(ids[2]);
    t.after(() => { for (const [id, entry] of previous) {
        if (entry) require.cache[id] = entry;
        else delete require.cache[id];
    } });
    return { service, state };
}

async function denied(service, options, status = 403, code = 'warehouse_photo_intake_not_migrated') {
    for (const operation of [() => service.findMatchCandidates({ name: 'Fixture' }, options),
        () => service.getIntake(91, options), () => service.listIntakes(options), () => service.getIntakeStatus(options)]) {
        await assert.rejects(operation, error => error.status === status && error.code === code
            && !error.message.includes('SENSITIVE_DRIVER_SENTINEL'));
    }
    assert.deepEqual(await service.confirmIntake(91, options), { success: false, status, error: code });
    assert.deepEqual(await service.cancelIntake(91, options), { success: false, status, error: code });
    assert.deepEqual(await service.createTelegramPhotoIntake({ chat: { id: 91 }, message_id: 1,
        photo: [{ file_id: 'synthetic_file' }] }, options), { ok: false, status, reason: code });
}

test('missing and non-Park service contexts deny every data/provider entrypoint before any SQL or connection', async t => {
    const { service, state } = fixture(t);
    for (const options of [undefined, {}, { businessContext: null }, { businessContext: '' },
        { businessContext: 'dar' }, { businessContext: 'custom_business' }, { businessContext: 'crm' }]) {
        await denied(service, options);
    }
    assert.equal(state.calls.length, 0);
    assert.equal(state.connections, 0);
    assert.equal(state.providers, 0);
});

test('membership/inactive registry and organization deny all operations before intake data or provider work', async t => {
    const { service, state } = fixture(t);
    for (const patch of [{ access_mode: 'membership' }, { business_status: 'inactive' },
        { organization_status: 'inactive' }, { organization_status: null }]) {
        state.registry = [{ access_mode: 'compatibility', business_status: 'active', organization_status: 'active', ...patch }];
        await denied(service, { businessContext: 'event_genix' });
    }
    assert.ok(state.calls.every(sql => /FROM businesses/.test(sql)));
    assert.equal(state.connections, 0);
    assert.equal(state.providers, 0);
});

test('registry failures produce sanitized503 and retries re-evaluate authority', async t => {
    const { service, state } = fixture(t);
    state.failRead = true;
    await denied(service, { businessContext: 'event_genix' }, 503, 'warehouse_photo_intake_scope_unavailable');
    state.failRead = false;
    state.registry[0].access_mode = 'membership';
    await denied(service, { businessContext: 'event_genix' });
    assert.ok(state.calls.every(sql => /FROM businesses/.test(sql)));
    assert.equal(state.connections, 0);
    assert.equal(state.providers, 0);
});
