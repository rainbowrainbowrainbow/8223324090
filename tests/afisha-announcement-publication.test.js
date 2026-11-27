'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { prepareAfishaPublication, verifyAfishaPublication } = require('../services/afishaAnnouncementPublication');

const targets = [
    { id: 2, name: 'Staff', platform: 'telegram', active: true, afishaMode: 'publication',
        destinationKey: 'telegram:-10020:1', version: 1 },
    { id: 1, name: 'Managers', platform: 'google_chat', active: true, afishaMode: 'publication',
        destinationKey: 'google_chat:space', version: 3, webhook: 'do not disclose' },
    { id: 3, name: 'Monthly', platform: 'telegram', active: true, afishaMode: 'monthly' }
];
const input = { business: 'event_genix', from: '2026-11-01', to: '2026-11-30', recipients: targets };

function fixture(title) {
    return { async query(sql) {
        if (sql.includes('FROM afisha WHERE')) {
            return { rows: [{ id: 1, date: '2026-11-27', time: '14:00', title, type: 'event' }] };
        }
        return { rows: [] };
    } };
}

test('publication preview is stable across query ordering and exposes only the receiving groups and actual text', async () => {
    const pool = fixture('Program');
    const preview = await prepareAfishaPublication(pool, input);
    const reordered = await prepareAfishaPublication(pool, { ...input, recipients: [...targets].reverse() });
    assert.deepEqual(reordered, preview);
    assert.deepEqual(preview.recipients, [
        { id: '1', name: 'Managers', platform: 'google_chat' },
        { id: '2', name: 'Staff', platform: 'telegram' }
    ]);
    assert.equal(preview.key, 'publication:2026-11-01:2026-11-30');
    assert.match(preview.parts[0], /Program/);
    assert.equal(JSON.stringify(preview).includes('do not disclose'), false);
    assert.deepEqual(await verifyAfishaPublication(pool, { ...input, token: preview.previewToken }), preview);
});

test('confirming stale preview fails after content, destination, business or eligibility changes', async () => {
    const pool = fixture('Program');
    const preview = await prepareAfishaPublication(pool, input);
    const verify = { ...input, token: preview.previewToken };
    await assert.rejects(verifyAfishaPublication(fixture('Updated'), verify), { statusCode: 409 });
    await assert.rejects(verifyAfishaPublication(pool, { ...verify, business: 'another' }), { statusCode: 409 });
    await assert.rejects(verifyAfishaPublication(pool, { ...verify, recipients: targets.slice(0, 1) }), { statusCode: 409 });
    const changed = [{ ...targets[0], destinationKey: 'telegram:-10020:2' }, ...targets.slice(1)];
    await assert.rejects(verifyAfishaPublication(pool, { ...verify, recipients: changed }), { statusCode: 409 });
});
