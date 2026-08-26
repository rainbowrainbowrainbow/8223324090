const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
    APPLY_CONFIRMATION,
    VERDICTS,
    applyBackfill,
    buildBackfillManifest,
    parseArgs,
    safeErrorReason,
    sha256
} = require('../scripts/backfill-legacy-upload-blobs');

async function makeTempSourceRoot() {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'eventgenix-upload-backfill-'));
    const files = {
        chat: ['uploads/chat/channels/7/chat-file.txt', Buffer.from('legacy-chat-bytes')],
        sounds: ['uploads/sounds/legacy-sound.mp3', Buffer.from('legacy-sound-bytes')],
        avatar: ['uploads/profile-avatars/users/qa/avatar.png', Buffer.from('legacy-avatar-bytes')],
        catalog: ['uploads/catalog-images/items/menu-photo.png', Buffer.from('legacy-catalog-bytes')],
        design: ['uploads/designs/design-file.pdf', Buffer.from('legacy-design-bytes')]
    };
    for (const [relative, buffer] of Object.values(files)) {
        const full = path.join(root, relative);
        await fsp.mkdir(path.dirname(full), { recursive: true });
        await fsp.writeFile(full, buffer);
    }
    return { root, files };
}

class FakeUploadBackfillDb {
    constructor({ failInsert = null, existing = {} } = {}) {
        this.failInsert = failInsert;
        this.tables = new Set([
            'chat_messages',
            'sounds',
            'user_profiles_ext',
            'catalog_items',
            'catalog_definitions',
            'catalog_pages',
            'products',
            'designs',
            'chat_upload_blobs',
            'sound_upload_blobs',
            'profile_avatar_blobs',
            'catalog_image_blobs',
            'design_file_blobs'
        ]);
        this.columns = new Set([
            'user_profiles_ext.avatar_url',
            'catalog_items.image_url',
            'catalog_definitions.cover_image_url',
            'catalog_pages.background_url',
            'catalog_pages.image_url',
            'products.icon_url',
            'designs.storage_key'
        ]);
        this.blobs = {
            chat_upload_blobs: new Map(existing.chat_upload_blobs || []),
            sound_upload_blobs: new Map(existing.sound_upload_blobs || []),
            profile_avatar_blobs: new Map(existing.profile_avatar_blobs || []),
            catalog_image_blobs: new Map(existing.catalog_image_blobs || []),
            design_file_blobs: new Map(existing.design_file_blobs || [])
        };
        this.calls = [];
        this.rows = {
            chat_messages: [{
                id: 1001,
                channel_id: 7,
                user_id: 9,
                metadata: {
                    file: {
                        url: '/uploads/chat/channels/7/chat-file.txt',
                        name: 'chat-file.txt',
                        size: Buffer.byteLength('legacy-chat-bytes'),
                        mimeType: 'text/plain'
                    }
                }
            }],
            sounds: [{
                id: 2001,
                filename: 'legacy-sound.mp3',
                file_path: '/uploads/sounds/legacy-sound.mp3',
                url: '/uploads/sounds/legacy-sound.mp3',
                file_size: Buffer.byteLength('legacy-sound-bytes'),
                uploaded_by: 'qa'
            }],
            user_profiles_ext: [{
                username: 'qa-user',
                avatar_url: '/uploads/profile-avatars/users/qa/avatar.png'
            }],
            catalog_items: [{
                id: 3001,
                url: '/uploads/catalog-images/items/menu-photo.png',
                image_url: '/uploads/catalog-images/items/menu-photo.png'
            }],
            catalog_definitions: [],
            catalog_pages: [],
            products: [],
            designs: [{
                id: 4001,
                filename: 'design-file.pdf',
                original_name: 'original-design.pdf',
                mime_type: 'application/pdf',
                file_size: Buffer.byteLength('legacy-design-bytes'),
                storage_key: null
            }]
        };
    }

    async connect() {
        return {
            query: this.query.bind(this),
            release: () => this.calls.push({ op: 'release' })
        };
    }

    async query(sql, params = []) {
        const text = String(sql);
        this.calls.push({ sql: text, params });
        if (/^BEGIN\b/i.test(text) || /^COMMIT\b/i.test(text) || /^ROLLBACK\b/i.test(text) || /pg_advisory_xact_lock/i.test(text)) {
            return { rows: [], rowCount: 0 };
        }
        if (/to_regclass/i.test(text)) {
            const table = String(params[0] || '').replace(/^public\./, '');
            return { rows: [{ table_name: this.tables.has(table) ? table : null }], rowCount: 1 };
        }
        if (/information_schema\.columns/i.test(text)) {
            return { rows: this.columns.has(`${params[0]}.${params[1]}`) ? [{ ok: 1 }] : [], rowCount: this.columns.has(`${params[0]}.${params[1]}`) ? 1 : 0 };
        }
        for (const table of ['chat_messages', 'sounds', 'user_profiles_ext', 'catalog_items', 'catalog_definitions', 'catalog_pages', 'products', 'designs']) {
            if (new RegExp(`FROM ${table}\\b`, 'i').test(text)) {
                return { rows: this.rows[table] || [], rowCount: (this.rows[table] || []).length };
            }
        }
        const selectBlob = text.match(/FROM\s+(chat_upload_blobs|sound_upload_blobs|profile_avatar_blobs|catalog_image_blobs|design_file_blobs)\b/i);
        if (selectBlob) {
            const table = selectBlob[1];
            const key = params[0];
            const row = this.blobs[table].get(key);
            return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
        }
        const insertBlob = text.match(/INSERT INTO\s+(chat_upload_blobs|sound_upload_blobs|profile_avatar_blobs|catalog_image_blobs|design_file_blobs)\b/i);
        if (insertBlob) {
            const table = insertBlob[1];
            if (this.failInsert === table) throw new Error('simulated insert failure');
            let key;
            let data;
            let checksum;
            let fileSize;
            if (table === 'catalog_image_blobs') {
                key = params[0];
                data = params[2];
                fileSize = params[3];
                checksum = sha256(data);
                this.blobs[table].set(key, { storage_key: key, file_size: fileSize, data, checksum_sha256: checksum });
            } else if (table === 'design_file_blobs') {
                key = params[1];
                data = params[2];
                checksum = params[3];
                fileSize = data.length;
                this.blobs[table].set(key, { storage_key: key, file_size: fileSize, checksum_sha256: checksum });
            } else if (table === 'chat_upload_blobs') {
                key = params[2];
                data = params[6];
                checksum = params[7];
                fileSize = params[5];
                this.blobs[table].set(key, { storage_key: key, file_size: fileSize, checksum_sha256: checksum });
            } else {
                key = params[1];
                data = params[5];
                checksum = params[6];
                fileSize = params[4];
                this.blobs[table].set(key, { storage_key: key, file_size: fileSize, checksum_sha256: checksum });
            }
            return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected query: ${text}`);
    }
}

test('legacy upload backfill args default to dry-run and require supported segments', () => {
    assert.deepEqual(parseArgs([]).segments, ['chat', 'sounds', 'profile-avatars', 'catalog-images', 'designs']);
    assert.equal(parseArgs(['--segment', 'chat,sounds']).dryRun, true);
    assert.throws(() => parseArgs(['--segment', 'unknown']), /Unsupported --segment=unknown/);
});

test('legacy upload backfill dry-run covers all segments and redacts filenames/content', async () => {
    const { root } = await makeTempSourceRoot();
    const db = new FakeUploadBackfillDb();
    const manifest = await buildBackfillManifest(db, {
        sourceRoot: root,
        segments: ['chat', 'sounds', 'profile-avatars', 'catalog-images', 'designs'],
        generatedAt: '2026-08-26T00:00:00.000Z'
    });

    assert.equal(manifest.dryRun, true);
    assert.equal(manifest.summary.scanned, 5);
    assert.equal(manifest.summary.writeCandidates, 5, JSON.stringify(manifest.entries));
    assert.match(manifest.manifestHash, /^[a-f0-9]{64}$/);
    const serialized = JSON.stringify(manifest);
    assert.equal(serialized.includes('chat-file.txt'), false);
    assert.equal(serialized.includes('legacy-chat-bytes'), false);
    assert.equal(serialized.includes('/uploads/chat/'), false);
    assert.equal(manifest.piiIncluded, false);
    assert.equal(manifest.binaryIncluded, false);
    assert.equal(manifest.filenamesIncluded, false);
});

test('legacy upload backfill apply requires confirmation, expected count and manifest hash', async () => {
    const { root } = await makeTempSourceRoot();
    const db = new FakeUploadBackfillDb();
    const manifest = await buildBackfillManifest(db, { sourceRoot: root, segments: ['chat'] });

    await assert.rejects(() => applyBackfill(db, manifest, {
        sourceRoot: root,
        expectedCount: manifest.summary.writeCandidates,
        manifestHash: manifest.manifestHash
    }), /--confirm=BACKFILL_LEGACY_UPLOAD_BLOBS/);
    await assert.rejects(() => applyBackfill(db, manifest, {
        sourceRoot: root,
        confirmation: APPLY_CONFIRMATION,
        expectedCount: 999,
        manifestHash: manifest.manifestHash
    }), /--expected-count=1/);
    await assert.rejects(() => applyBackfill(db, manifest, {
        sourceRoot: root,
        confirmation: APPLY_CONFIRMATION,
        expectedCount: manifest.summary.writeCandidates,
        manifestHash: 'bad'
    }), /--manifest-hash/);
});

test('legacy upload backfill apply writes blob rows and retry becomes exact existing', async () => {
    const { root } = await makeTempSourceRoot();
    const db = new FakeUploadBackfillDb();
    const manifest = await buildBackfillManifest(db, { sourceRoot: root, segments: ['chat', 'designs'] });
    const applied = await applyBackfill(db, manifest, {
        sourceRoot: root,
        confirmation: APPLY_CONFIRMATION,
        expectedCount: manifest.summary.writeCandidates,
        manifestHash: manifest.manifestHash
    });

    assert.equal(applied.summary.written, 2, JSON.stringify(applied.entries));
    assert.equal(applied.summary.blocked, 0);
    assert.equal(db.blobs.chat_upload_blobs.size, 1);
    assert.equal(db.blobs.design_file_blobs.size, 1);

    const retry = await buildBackfillManifest(db, { sourceRoot: root, segments: ['chat', 'designs'] });
    assert.equal(retry.summary.writeCandidates, 0);
    assert.equal(retry.summary.byVerdict[VERDICTS.EXISTING_EXACT_BLOB], 2);
});

test('legacy upload backfill refuses checksum conflicts without overwrite', async () => {
    const { root } = await makeTempSourceRoot();
    const db = new FakeUploadBackfillDb({
        existing: {
            chat_upload_blobs: [[
                'channels/7/chat-file.txt',
                { storage_key: 'channels/7/chat-file.txt', file_size: 5, checksum_sha256: sha256(Buffer.from('other')) }
            ]]
        }
    });
    const manifest = await buildBackfillManifest(db, { sourceRoot: root, segments: ['chat'] });

    assert.equal(manifest.summary.checksumConflicts, 1);
    await assert.rejects(() => applyBackfill(db, manifest, {
        sourceRoot: root,
        confirmation: APPLY_CONFIRMATION,
        expectedCount: manifest.summary.writeCandidates,
        manifestHash: manifest.manifestHash
    }), /checksum conflicts/);
    assert.equal(db.blobs.chat_upload_blobs.get('channels/7/chat-file.txt').checksum_sha256, sha256(Buffer.from('other')));
});

test('legacy upload backfill records rollback verdict on blob insert failure', async () => {
    const { root } = await makeTempSourceRoot();
    const db = new FakeUploadBackfillDb({ failInsert: 'sound_upload_blobs' });
    const manifest = await buildBackfillManifest(db, { sourceRoot: root, segments: ['sounds'] });
    const applied = await applyBackfill(db, manifest, {
        sourceRoot: root,
        confirmation: APPLY_CONFIRMATION,
        expectedCount: manifest.summary.writeCandidates,
        manifestHash: manifest.manifestHash
    });

    assert.equal(applied.summary.blocked, 1);
    assert.equal(applied.entries[0].verdict, VERDICTS.APPLY_FAILED_ROLLED_BACK);
    assert.ok(db.calls.some(call => /^ROLLBACK\b/i.test(call.sql)));
    assert.equal(db.blobs.sound_upload_blobs.size, 0);
});

test('legacy upload backfill reports missing sources as unrecoverable manifest records', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'eventgenix-upload-backfill-missing-'));
    const db = new FakeUploadBackfillDb();
    const manifest = await buildBackfillManifest(db, { sourceRoot: root, segments: ['profile-avatars'] });

    assert.equal(manifest.summary.unrecoverableSourceMissing, 1);
    assert.equal(manifest.entries[0].verdict, VERDICTS.UNRECOVERABLE_SOURCE_MISSING);
    assert.equal(JSON.stringify(manifest).includes('avatar.png'), false);
});

test('legacy upload backfill redacts database error details from manifest reasons', () => {
    const err = new Error('duplicate key value violates unique constraint "chat_upload_blobs_storage_key_key" Detail: Key (storage_key)=(channels/7/private-file.txt) already exists.');
    err.code = '23505';
    const reason = safeErrorReason(err);
    assert.equal(reason, 'database_unique_conflict');
    assert.equal(reason.includes('private-file'), false);
    assert.equal(reason.includes('channels/7'), false);
});
