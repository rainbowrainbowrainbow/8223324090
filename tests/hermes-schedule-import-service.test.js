'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    buildPreviewHash,
    buildSourceDedupeKey,
    cancelHermesScheduleImport,
    createHermesScheduleImport,
    expireHermesScheduleImports,
    getHermesScheduleImport,
    markHermesScheduleImportApplied,
    sanitizeSourceReference,
    saveHermesScheduleImportPreview
} = require('../services/hermesScheduleImport');

function telegramReference() {
    return {
        telegram: {
            chat_id: '-100123',
            message_id: '456',
            file_unique_id: 'file-789'
        }
    };
}

test('Telegram dedupe is stable across key order and changes with the source reference', () => {
    const first = buildSourceDedupeKey('telegram', telegramReference());
    const second = buildSourceDedupeKey('TELEGRAM', {
        telegram: {
            file_unique_id: 'file-789',
            message_id: 456,
            chat_id: -100123
        }
    });
    const changed = buildSourceDedupeKey('telegram', {
        telegram: { chat_id: '-100123', message_id: '457', file_unique_id: 'file-789' }
    });

    assert.match(first, /^[a-f0-9]{64}$/);
    assert.equal(first, second);
    assert.notEqual(first, changed);
});

test('source and persisted JSON guards reject secrets, headers, cookies, and binary values', () => {
    for (const value of [
        { telegram_bot_token: 'secret' },
        { nested: { apiKey: 'secret' } },
        { cookies: ['session=secret'] },
        { rawHeaders: { authorization: 'secret' } },
        { photo: Buffer.from('binary') }
    ]) {
        assert.throws(
            () => sanitizeSourceReference(value),
            error => error.code === 'HERMES_SCHEDULE_IMPORT_SOURCE_SENSITIVE'
        );
    }
});

test('preview hash covers extracted rows, preview rows, date, and current-state snapshot', () => {
    const base = {
        documentDate: '2026-07-15',
        extractedRows: [{ employeeName: 'Славицька Анна' }],
        previewRows: [{ action: 'create', staffId: 746 }],
        currentStateSnapshot: [{ staffId: 746, currentSchedule: [] }]
    };
    const hash = buildPreviewHash(base);
    assert.match(hash, /^[a-f0-9]{64}$/);
    assert.equal(hash, buildPreviewHash({
        currentStateSnapshot: base.currentStateSnapshot,
        previewRows: base.previewRows,
        extractedRows: base.extractedRows,
        documentDate: base.documentDate
    }));
    assert.notEqual(hash, buildPreviewHash({
        ...base,
        currentStateSnapshot: [{ staffId: 746, currentSchedule: [{ status: 'working' }] }]
    }));
});

test('repeated source reference returns the existing import without creating a duplicate', async () => {
    let stored = null;
    let insertCount = 0;
    const db = {
        async query(sql, params) {
            if (/INSERT INTO hermes_schedule_imports/.test(sql)) {
                insertCount += 1;
                if (stored) return { rows: [] };
                stored = {
                    id: 1,
                    public_id: params[0],
                    business_context: params[1],
                    status: params[2],
                    source: params[3],
                    source_reference: JSON.parse(params[4]),
                    source_dedupe_key: params[5]
                };
                return { rows: [stored] };
            }
            if (/WHERE business_context = \$1[\s\S]*source_dedupe_key = \$2/.test(sql)) {
                return { rows: [stored] };
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        }
    };
    const input = { source: 'telegram', sourceReference: telegramReference(), createdByUserId: 9 };

    const first = await createHermesScheduleImport(db, input);
    const replay = await createHermesScheduleImport(db, input);

    assert.equal(first.created, true);
    assert.equal(replay.created, false);
    assert.equal(replay.import.id, first.import.id);
    assert.equal(insertCount, 2);
});

test('service supports read, preview seal, expiry, apply result, and cancellation lifecycle operations', async () => {
    const calls = [];
    const publicId = 'hsi_1234567890abcdef';
    const db = {
        async query(sql, params) {
            calls.push({ sql, params });
            if (/^\s*SELECT \* FROM hermes_schedule_imports WHERE public_id/.test(sql)) {
                return { rows: [{ public_id: publicId, status: 'draft' }] };
            }
            if (/SET document_date/.test(sql)) {
                return { rows: [{ public_id: publicId, status: params[6], preview_hash: params[5] }] };
            }
            if (/SET status = 'expired'/.test(sql)) {
                return { rows: [{ public_id: publicId, status: 'expired' }] };
            }
            if (/SET status = 'applied'/.test(sql)) {
                return { rows: [{ public_id: publicId, status: 'applied', preview_hash: params[1] }] };
            }
            if (/SET status = 'cancelled'/.test(sql)) {
                return { rows: [{ public_id: publicId, status: 'cancelled' }] };
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        }
    };

    assert.equal((await getHermesScheduleImport(db, publicId)).status, 'draft');
    const ready = await saveHermesScheduleImportPreview(db, publicId, {
        status: 'ready',
        documentDate: '2026-07-15',
        extractedRows: [{ employeeName: 'Пасенко Женя' }],
        previewRows: [{ action: 'update', staffId: 748 }],
        currentStateSnapshot: [{ staffId: 748, status: 'dayoff' }]
    });
    assert.equal(ready.status, 'ready');
    assert.match(ready.preview_hash, /^[a-f0-9]{64}$/);

    assert.equal((await expireHermesScheduleImports(db, { now: '2026-07-16T00:00:00Z' }))[0].status, 'expired');
    assert.equal((await markHermesScheduleImportApplied(db, publicId, {
        previewHash: ready.preview_hash,
        appliedByUserId: 9,
        applyResult: { created: 1, updated: 1 }
    })).status, 'applied');
    assert.equal((await cancelHermesScheduleImport(db, publicId, { reason: 'QA cleanup' })).status, 'cancelled');

    const applyCall = calls.find(call => /SET status = 'applied'/.test(call.sql));
    assert.match(applyCall.sql, /status = 'ready'/);
    assert.match(applyCall.sql, /preview_hash = \$2/);
    assert.match(applyCall.sql, /expires_at > NOW\(\)/);
    assert.deepEqual(JSON.parse(applyCall.params[3]), { created: 1, updated: 1 });
});
