#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const {
    designStorageKey,
    safeFilename
} = require('../services/designStorage');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_SOURCE_ROOT = ROOT;
const VERDICTS = Object.freeze({
    OK_METADATA_BLOB: 'OK_METADATA_BLOB',
    OK_ANY_BLOB: 'OK_ANY_BLOB',
    METADATA_KEY_MISMATCH: 'METADATA_KEY_MISMATCH',
    LEGACY_DISK_SOURCE_PRESENT: 'LEGACY_DISK_SOURCE_PRESENT',
    SOURCE_MISSING: 'SOURCE_MISSING',
    INVALID_METADATA: 'INVALID_METADATA',
    DESIGNS_TABLE_MISSING: 'DESIGNS_TABLE_MISSING',
    BLOB_TABLE_MISSING: 'BLOB_TABLE_MISSING'
});

function argValue(args, name, fallback = null) {
    const exact = args.find(arg => arg.startsWith(`${name}=`));
    if (exact) return exact.slice(name.length + 1);
    const index = args.indexOf(name);
    if (index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')) return args[index + 1];
    return fallback;
}

function parseArgs(argv = process.argv.slice(2)) {
    const flags = new Set(argv.filter(arg => arg.startsWith('--') && !arg.includes('=')));
    const limit = Number(argValue(argv, '--limit', '500'));
    if (!Number.isInteger(limit) || limit <= 0 || limit > 5000) {
        throw new Error('--limit must be an integer from 1 to 5000');
    }
    return {
        json: flags.has('--json'),
        limit,
        sourceRoot: path.resolve(String(argValue(argv, '--source-root', DEFAULT_SOURCE_ROOT) || DEFAULT_SOURCE_ROOT))
    };
}

function loadEnvFile() {
    const envPath = path.join(ROOT, '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const separator = trimmed.indexOf('=');
        if (separator <= 0) continue;
        const key = trimmed.slice(0, separator).trim();
        if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
        let value = trimmed.slice(separator + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        process.env[key] = value;
    }
}

function poolConfig(env = process.env) {
    const connectionString = env.DESIGN_AUDIT_DATABASE_URL
        || env.PRODUCTION_READONLY_DATABASE_URL
        || env.DATABASE_PUBLIC_URL
        || env.DATABASE_URL
        || env.TEST_DATABASE_URL;
    if (!connectionString) {
        throw new Error('DESIGN_AUDIT_DATABASE_URL, PRODUCTION_READONLY_DATABASE_URL, DATABASE_PUBLIC_URL, DATABASE_URL, or TEST_DATABASE_URL is required');
    }
    return {
        connectionString,
        ssl: /railway|proxy|amazonaws|render|neon|supabase/i.test(connectionString)
            ? { rejectUnauthorized: false }
            : false,
        max: 2,
        connectionTimeoutMillis: 10_000
    };
}

function sha256(value) {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function opaqueDesignId(id) {
    return sha256(`design:${id}`).slice(0, 20);
}

function safeJoinDesignFile(sourceRoot, filename) {
    const base = path.resolve(sourceRoot, 'uploads', 'designs');
    const localName = path.basename(String(filename || ''));
    if (!localName) return null;
    const full = path.resolve(base, localName);
    if (full === base || !full.startsWith(base + path.sep)) return null;
    return full;
}

async function tableExists(db, table) {
    const result = await db.query('SELECT to_regclass($1) AS table_name', [`public.${table}`]);
    return Boolean(result.rows?.[0]?.table_name);
}

async function columnExists(db, table, column) {
    const result = await db.query(
        `SELECT 1
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = $1
            AND column_name = $2
          LIMIT 1`,
        [table, column]
    );
    return result.rowCount > 0;
}

async function loadDesignRows(db, limit) {
    const hasStorageProvider = await columnExists(db, 'designs', 'storage_provider');
    const hasStorageKey = await columnExists(db, 'designs', 'storage_key');
    const result = await db.query(
        `SELECT id, filename, original_name, mime_type, file_size
                ${hasStorageProvider ? ', storage_provider' : ', NULL::text AS storage_provider'}
                ${hasStorageKey ? ', storage_key' : ', NULL::text AS storage_key'}
           FROM designs
          WHERE COALESCE(filename, '') <> ''
          ORDER BY id
          LIMIT $1`,
        [limit]
    );
    return result.rows || [];
}

async function readExactBlob(db, designId, storageKey) {
    if (!storageKey) return null;
    const result = await db.query(
        `SELECT storage_key, octet_length(data)::int AS file_size, checksum_sha256
           FROM design_file_blobs
          WHERE design_id = $1
            AND storage_key = $2
          LIMIT 1`,
        [designId, storageKey]
    );
    return result.rows?.[0] || null;
}

async function readAnyBlob(db, designId) {
    const result = await db.query(
        `SELECT storage_key, octet_length(data)::int AS file_size, checksum_sha256
           FROM design_file_blobs
          WHERE design_id = $1
          ORDER BY updated_at DESC, id DESC
          LIMIT 1`,
        [designId]
    );
    return result.rows?.[0] || null;
}

async function statLocalSource(sourceRoot, filename) {
    const full = safeJoinDesignFile(sourceRoot, filename);
    if (!full) return null;
    try {
        const stat = await fs.promises.stat(full);
        return stat.isFile() ? { file_size: stat.size } : null;
    } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
    }
}

function metadataSizeMatches(row, source) {
    const expected = Number(row.file_size || 0);
    if (!expected || !source) return null;
    return Number(source.file_size || 0) === expected;
}

async function auditDesignRow(db, row, options) {
    const id = Number(row.id);
    const filename = String(row.filename || '');
    if (!Number.isInteger(id) || id <= 0 || !filename.trim()) {
        return {
            verdict: VERDICTS.INVALID_METADATA,
            opaqueDesignId: opaqueDesignId(row.id),
            mimeType: row.mime_type || null,
            metadataBytes: Number(row.file_size || 0) || null
        };
    }

    const normalizedFilename = safeFilename(filename);
    let expectedStorageKey = null;
    try {
        expectedStorageKey = row.storage_key || designStorageKey(id, normalizedFilename);
    } catch {
        return {
            verdict: VERDICTS.INVALID_METADATA,
            opaqueDesignId: opaqueDesignId(id),
            mimeType: row.mime_type || null,
            metadataBytes: Number(row.file_size || 0) || null
        };
    }

    const exactBlob = await readExactBlob(db, id, expectedStorageKey);
    const anyBlob = exactBlob || await readAnyBlob(db, id);
    const localSource = exactBlob ? null : await statLocalSource(options.sourceRoot, filename);
    let verdict = VERDICTS.SOURCE_MISSING;
    if (exactBlob) verdict = VERDICTS.OK_METADATA_BLOB;
    else if (anyBlob && row.storage_key) verdict = VERDICTS.METADATA_KEY_MISMATCH;
    else if (anyBlob) verdict = VERDICTS.OK_ANY_BLOB;
    else if (localSource) verdict = VERDICTS.LEGACY_DISK_SOURCE_PRESENT;

    return {
        verdict,
        opaqueDesignId: opaqueDesignId(id),
        storageProvider: row.storage_provider || null,
        hasStorageKey: Boolean(row.storage_key),
        expectedStorageKeySha256: sha256(expectedStorageKey),
        actualBlobStorageKeySha256: anyBlob?.storage_key ? sha256(anyBlob.storage_key) : null,
        filenameSha256: sha256(normalizedFilename),
        mimeType: row.mime_type || null,
        metadataBytes: Number(row.file_size || 0) || null,
        blobBytes: anyBlob ? Number(anyBlob.file_size || 0) : null,
        localBytes: localSource ? Number(localSource.file_size || 0) : null,
        metadataSizeMatchesBlob: metadataSizeMatches(row, anyBlob),
        metadataSizeMatchesLocal: metadataSizeMatches(row, localSource)
    };
}

function summarize(entries) {
    const byVerdict = {};
    for (const entry of entries) {
        byVerdict[entry.verdict] = (byVerdict[entry.verdict] || 0) + 1;
    }
    return {
        scanned: entries.length,
        ok: entries.filter(entry => entry.verdict === VERDICTS.OK_METADATA_BLOB || entry.verdict === VERDICTS.OK_ANY_BLOB).length,
        recoverableFromLocal: byVerdict[VERDICTS.LEGACY_DISK_SOURCE_PRESENT] || 0,
        keyMismatches: byVerdict[VERDICTS.METADATA_KEY_MISMATCH] || 0,
        missingSources: byVerdict[VERDICTS.SOURCE_MISSING] || 0,
        invalidMetadata: byVerdict[VERDICTS.INVALID_METADATA] || 0,
        byVerdict
    };
}

async function buildDesignStorageAudit(db, options = {}) {
    const limit = options.limit || 500;
    const sourceRoot = path.resolve(String(options.sourceRoot || DEFAULT_SOURCE_ROOT));
    const generatedAt = options.generatedAt || new Date().toISOString();
    if (!(await tableExists(db, 'designs'))) {
        const entries = [{ verdict: VERDICTS.DESIGNS_TABLE_MISSING }];
        return finalizeAudit({ generatedAt, sourceRoot, limit, entries });
    }
    if (!(await tableExists(db, 'design_file_blobs'))) {
        const rows = await loadDesignRows(db, limit);
        const entries = rows.map(row => ({
            verdict: VERDICTS.BLOB_TABLE_MISSING,
            opaqueDesignId: opaqueDesignId(row.id),
            mimeType: row.mime_type || null,
            metadataBytes: Number(row.file_size || 0) || null
        }));
        return finalizeAudit({ generatedAt, sourceRoot, limit, entries });
    }
    const rows = await loadDesignRows(db, limit);
    const entries = [];
    for (const row of rows) {
        entries.push(await auditDesignRow(db, row, { sourceRoot }));
    }
    return finalizeAudit({ generatedAt, sourceRoot, limit, entries });
}

function finalizeAudit({ generatedAt, sourceRoot, limit, entries }) {
    const manifest = {
        generatedAt,
        sourceRootSha256: sha256(path.resolve(sourceRoot)),
        limit,
        summary: summarize(entries),
        entries,
        piiIncluded: false,
        binaryIncluded: false,
        filenamesIncluded: false,
        readOnly: true
    };
    manifest.manifestHash = sha256(stableJson({
        limit: manifest.limit,
        summary: manifest.summary,
        entries: manifest.entries,
        readOnly: manifest.readOnly
    }));
    return manifest;
}

function printText(manifest) {
    console.log('Design material storage audit');
    console.log(`readOnly: ${manifest.readOnly}`);
    console.log(`manifestHash: ${manifest.manifestHash}`);
    console.log(`scanned: ${manifest.summary.scanned}`);
    console.log(`ok: ${manifest.summary.ok}`);
    console.log(`recoverableFromLocal: ${manifest.summary.recoverableFromLocal}`);
    console.log(`keyMismatches: ${manifest.summary.keyMismatches}`);
    console.log(`missingSources: ${manifest.summary.missingSources}`);
    console.log(`invalidMetadata: ${manifest.summary.invalidMetadata}`);
    for (const [verdict, count] of Object.entries(manifest.summary.byVerdict)) {
        console.log(`${verdict}: ${count}`);
    }
}

async function main() {
    const options = parseArgs();
    loadEnvFile();
    const pool = new Pool(poolConfig());
    let client = null;
    try {
        client = await pool.connect();
        await client.query('BEGIN READ ONLY');
        const manifest = await buildDesignStorageAudit(client, options);
        await client.query('COMMIT');
        if (options.json) console.log(JSON.stringify(manifest, null, 2));
        else printText(manifest);
    } finally {
        if (client) {
            try { await client.query('ROLLBACK'); } catch (_) {}
            client.release();
        }
        await pool.end();
    }
}

if (require.main === module) {
    main().catch(err => {
        console.error(`Design material storage audit failed: ${err.message}`);
        process.exit(1);
    });
}

module.exports = {
    VERDICTS,
    buildDesignStorageAudit,
    parseArgs,
    poolConfig,
    safeJoinDesignFile,
    sha256
};
