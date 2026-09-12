const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
    VERDICTS,
    buildDesignStorageAudit,
    parseArgs,
    safeJoinDesignFile
} = require('../scripts/audit-design-material-storage');

const AUDIT_SCRIPT_SOURCE = require('node:fs').readFileSync(
    path.resolve(__dirname, '..', 'scripts', 'audit-design-material-storage.js'),
    'utf8'
);

class FakeDesignAuditDb {
    constructor({ blobTable = true } = {}) {
        this.tables = new Set(['designs']);
        if (blobTable) this.tables.add('design_file_blobs');
        this.columns = new Set(['designs.storage_provider', 'designs.storage_key']);
        this.rows = [{
            id: 1,
            filename: 'ok.png',
            original_name: 'ok.png',
            mime_type: 'image/png',
            file_size: 3,
            storage_provider: 'postgres',
            storage_key: 'designs/1/ok.png'
        }, {
            id: 2,
            filename: 'legacy.pdf',
            original_name: 'legacy.pdf',
            mime_type: 'application/pdf',
            file_size: 6,
            storage_provider: null,
            storage_key: null
        }, {
            id: 3,
            filename: 'missing.jpg',
            original_name: 'missing.jpg',
            mime_type: 'image/jpeg',
            file_size: 9,
            storage_provider: null,
            storage_key: null
        }, {
            id: 4,
            filename: 'mismatch.webp',
            original_name: 'mismatch.webp',
            mime_type: 'image/webp',
            file_size: 4,
            storage_provider: 'postgres',
            storage_key: 'designs/4/current.webp'
        }];
        this.blobs = new Map([
            ['designs/1/ok.png', { storage_key: 'designs/1/ok.png', file_size: 3, checksum_sha256: 'a' }],
            ['designs/4/old.webp', { storage_key: 'designs/4/old.webp', file_size: 4, checksum_sha256: 'b' }]
        ]);
    }

    async query(sql, params = []) {
        const text = String(sql);
        if (/to_regclass/i.test(text)) {
            const table = String(params[0] || '').replace(/^public\./, '');
            return { rows: [{ table_name: this.tables.has(table) ? table : null }], rowCount: 1 };
        }
        if (/information_schema\.columns/i.test(text)) {
            return { rows: this.columns.has(`${params[0]}.${params[1]}`) ? [{ ok: 1 }] : [], rowCount: this.columns.has(`${params[0]}.${params[1]}`) ? 1 : 0 };
        }
        if (/FROM designs\b/i.test(text)) {
            return { rows: this.rows.slice(0, params[0]), rowCount: this.rows.length };
        }
        if (/FROM design_file_blobs\b/i.test(text) && /storage_key = \$2/i.test(text)) {
            const row = this.blobs.get(params[1]);
            return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
        }
        if (/FROM design_file_blobs\b/i.test(text)) {
            const id = Number(params[0]);
            const row = [...this.blobs.values()].find(blob => blob.storage_key.startsWith(`designs/${id}/`));
            return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
        }
        throw new Error(`Unexpected query: ${text}`);
    }
}

async function makeSourceRoot() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eventgenix-design-audit-'));
    await fs.mkdir(path.join(root, 'uploads', 'designs'), { recursive: true });
    await fs.writeFile(path.join(root, 'uploads', 'designs', 'legacy.pdf'), Buffer.from('legacy'));
    return root;
}

test('design material storage audit classifies blob, local recovery, missing source, and key mismatch', async () => {
    const sourceRoot = await makeSourceRoot();
    const manifest = await buildDesignStorageAudit(new FakeDesignAuditDb(), {
        sourceRoot,
        generatedAt: '2026-09-12T00:00:00.000Z'
    });

    assert.equal(manifest.readOnly, true);
    assert.equal(manifest.piiIncluded, false);
    assert.equal(manifest.binaryIncluded, false);
    assert.equal(manifest.filenamesIncluded, false);
    assert.equal(manifest.summary.scanned, 4);
    assert.equal(manifest.summary.byVerdict[VERDICTS.OK_METADATA_BLOB], 1);
    assert.equal(manifest.summary.byVerdict[VERDICTS.LEGACY_DISK_SOURCE_PRESENT], 1);
    assert.equal(manifest.summary.byVerdict[VERDICTS.SOURCE_MISSING], 1);
    assert.equal(manifest.summary.byVerdict[VERDICTS.METADATA_KEY_MISMATCH], 1);
    assert.match(manifest.manifestHash, /^[a-f0-9]{64}$/);
    const serialized = JSON.stringify(manifest);
    assert.equal(serialized.includes('legacy.pdf'), false);
    assert.equal(serialized.includes('missing.jpg'), false);
    assert.equal(serialized.includes('uploads/designs'), false);
});

test('design material storage audit reports missing blob table without filenames', async () => {
    const manifest = await buildDesignStorageAudit(new FakeDesignAuditDb({ blobTable: false }), {
        sourceRoot: await makeSourceRoot(),
        generatedAt: '2026-09-12T00:00:00.000Z'
    });
    assert.equal(manifest.summary.byVerdict[VERDICTS.BLOB_TABLE_MISSING], 4);
    assert.equal(JSON.stringify(manifest).includes('ok.png'), false);
});

test('design audit args and path guard are bounded', () => {
    assert.equal(parseArgs(['--limit', '20']).limit, 20);
    assert.throws(() => parseArgs(['--limit', '0']), /--limit/);
    assert.throws(() => parseArgs(['--limit', '5001']), /--limit/);
    assert.equal(safeJoinDesignFile('C:/repo', '../escape.png'), path.resolve('C:/repo/uploads/designs/escape.png'));
    assert.equal(safeJoinDesignFile('C:/repo', ''), null);
});

test('design material storage audit CLI uses an explicit read-only transaction', () => {
    assert.match(AUDIT_SCRIPT_SOURCE, /BEGIN READ ONLY/);
    assert.match(AUDIT_SCRIPT_SOURCE, /COMMIT/);
});
