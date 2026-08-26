const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');

const {
    APPLY_CONFIRMATION,
    VERDICTS,
    applyBackfill,
    buildBackfillManifest,
    sha256
} = require('../../scripts/backfill-legacy-upload-blobs');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');

const enabled = process.env.RUN_LEGACY_UPLOAD_BACKFILL_INTEGRATION === 'true';

function testDatabaseUrl() {
    assert.ok(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL is required');
    return assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
}

function createPool() {
    const testDb = testDatabaseUrl();
    return new Pool({
        connectionString: testDb.url.toString(),
        ssl: testDb.isLocal ? false : { rejectUnauthorized: false },
        max: 2,
        connectionTimeoutMillis: 10_000
    });
}

async function createChatFixture(pool, sourceRoot, suffix, bytes = Buffer.from('legacy-chat-integration-bytes')) {
    const uploadRelative = `uploads/chat/channels/900/${suffix}.txt`;
    const uploadPath = path.join(sourceRoot, uploadRelative);
    await fs.mkdir(path.dirname(uploadPath), { recursive: true });
    await fs.writeFile(uploadPath, bytes);

    const user = await pool.query(
        `INSERT INTO users (username, password_hash, role, name)
         VALUES ($1, 'test-hash', 'manager', $2)
         ON CONFLICT (username) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [`legacy-upload-backfill-${suffix}`, `Legacy Upload Backfill ${suffix}`]
    );
    const channel = await pool.query(
        `INSERT INTO chat_channels (slug, name, description, type, created_by)
         VALUES ($1, $2, 'Backfill fixture', 'general', $3)
         RETURNING id`,
        [`backfill-${suffix}`, `Backfill ${suffix}`, user.rows[0].id]
    );
    const message = await pool.query(
        `INSERT INTO chat_messages (channel_id, user_id, seq, content, content_type, metadata)
         VALUES ($1, $2, 1, 'redacted fixture', 'file', $3::jsonb)
         RETURNING id`,
        [
            channel.rows[0].id,
            user.rows[0].id,
            JSON.stringify({
                file: {
                    url: `/uploads/chat/channels/900/${suffix}.txt`,
                    name: `${suffix}.txt`,
                    size: bytes.length,
                    mimeType: 'text/plain'
                }
            })
        ]
    );
    return {
        userId: user.rows[0].id,
        channelId: channel.rows[0].id,
        messageId: message.rows[0].id,
        storageKey: `channels/900/${suffix}.txt`,
        bytes
    };
}

test('legacy upload backfill isolated PostgreSQL dry-run/apply/retry/conflict', { skip: !enabled, timeout: 120_000 }, async () => {
    const pool = createPool();
    const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eventgenix-upload-backfill-pg-'));
    try {
        const fixture = await createChatFixture(pool, sourceRoot, `chat-${Date.now()}`);
        const dryRun = await buildBackfillManifest(pool, { sourceRoot, segments: ['chat'] });
        assert.equal(dryRun.summary.writeCandidates, 1);
        assert.equal(dryRun.summary.checksumConflicts, 0);
        assert.equal(dryRun.summary.blocked, 0);

        const applied = await applyBackfill(pool, dryRun, {
            sourceRoot,
            confirmation: APPLY_CONFIRMATION,
            expectedCount: dryRun.summary.writeCandidates,
            manifestHash: dryRun.manifestHash
        });
        assert.equal(applied.summary.written, 1);

        const stored = await pool.query(
            'SELECT channel_id, message_id, storage_key, file_size, checksum_sha256 FROM chat_upload_blobs WHERE storage_key = $1',
            [fixture.storageKey]
        );
        assert.equal(stored.rowCount, 1);
        assert.equal(stored.rows[0].channel_id, fixture.channelId);
        assert.equal(stored.rows[0].message_id, fixture.messageId);
        assert.equal(stored.rows[0].file_size, fixture.bytes.length);
        assert.equal(stored.rows[0].checksum_sha256, sha256(fixture.bytes));

        const retry = await buildBackfillManifest(pool, { sourceRoot, segments: ['chat'] });
        assert.equal(retry.summary.writeCandidates, 0);
        assert.equal(retry.summary.byVerdict[VERDICTS.EXISTING_EXACT_BLOB], 1);

        await pool.query(
            `UPDATE chat_upload_blobs
                SET checksum_sha256 = $2,
                    file_size = 1
              WHERE storage_key = $1`,
            [fixture.storageKey, sha256(Buffer.from('different'))]
        );
        const conflict = await buildBackfillManifest(pool, { sourceRoot, segments: ['chat'] });
        assert.equal(conflict.summary.checksumConflicts, 1);
        await assert.rejects(() => applyBackfill(pool, conflict, {
            sourceRoot,
            confirmation: APPLY_CONFIRMATION,
            expectedCount: conflict.summary.writeCandidates,
            manifestHash: conflict.manifestHash
        }), /checksum conflicts/);
    } finally {
        await pool.end();
    }
});
