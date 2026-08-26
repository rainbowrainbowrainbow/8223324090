#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');

const {
    CHAT_UPLOAD_TYPES,
    MAX_CHAT_UPLOAD_BYTES,
    normalizeChatUploadRequestPath,
    safeFilename: safeChatFilename
} = require('../services/chatUploadStorage');
const {
    AUDIO_CONTENT_TYPES,
    MAX_SOUND_UPLOAD_BYTES,
    normalizeSoundUploadRequestPath,
    publicSoundUploadUrl
} = require('../services/audioStorage');
const {
    MAX_AVATAR_BYTES,
    PROFILE_AVATAR_TYPES,
    normalizeAvatarRequestPath,
    safeFilename: safeAvatarFilename
} = require('../services/profileAvatarStorage');
const {
    ALLOWED_IMAGE_MIME_TYPES,
    DEFAULT_MAX_IMAGE_BYTES,
    normalizeCatalogImageRequestFilename,
    safeImageFilename
} = require('../services/imageStorage');
const {
    designStorageKey,
    safeFilename: safeDesignFilename
} = require('../services/designStorage');

const ROOT = path.resolve(__dirname, '..');
const APPLY_CONFIRMATION = 'BACKFILL_LEGACY_UPLOAD_BLOBS';
const DEFAULT_SOURCE_ROOT = ROOT;
const VALID_SEGMENTS = Object.freeze([
    'chat',
    'sounds',
    'profile-avatars',
    'catalog-images',
    'designs'
]);
const LOCAL_DIRS = Object.freeze({
    chat: 'uploads/chat',
    sounds: 'uploads/sounds',
    'profile-avatars': 'uploads/profile-avatars',
    'catalog-images': 'uploads/catalog-images',
    designs: 'uploads/designs'
});
const VERDICTS = Object.freeze({
    WRITE_CANDIDATE: 'WRITE_CANDIDATE',
    WRITTEN: 'WRITTEN',
    EXISTING_EXACT_BLOB: 'EXISTING_EXACT_BLOB',
    EXISTING_BLOB_SOURCE_MISSING: 'EXISTING_BLOB_SOURCE_MISSING',
    CHECKSUM_CONFLICT: 'CHECKSUM_CONFLICT',
    UNRECOVERABLE_SOURCE_MISSING: 'UNRECOVERABLE_SOURCE_MISSING',
    INVALID_METADATA: 'INVALID_METADATA',
    INVALID_MIME: 'INVALID_MIME',
    OVERSIZE: 'OVERSIZE',
    INSERT_RACE_EXACT: 'INSERT_RACE_EXACT',
    INSERT_RACE_CONFLICT: 'INSERT_RACE_CONFLICT',
    APPLY_FAILED_ROLLED_BACK: 'APPLY_FAILED_ROLLED_BACK'
});
const IMAGE_EXT_MIME = Object.freeze({
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif'
});
const DESIGN_ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'pdf']);
const DESIGN_MAX_BYTES = 20 * 1024 * 1024;

function argValue(args, name, fallback = null) {
    const exact = args.find(arg => arg.startsWith(`${name}=`));
    if (exact) return exact.slice(name.length + 1);
    const index = args.indexOf(name);
    if (index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')) return args[index + 1];
    return fallback;
}

function parseArgs(argv = process.argv.slice(2)) {
    const flags = new Set(argv.filter(arg => arg.startsWith('--') && !arg.includes('=')));
    const segmentRaw = String(argValue(argv, '--segment', argValue(argv, '--segments', 'all')) || 'all');
    const segments = segmentRaw === 'all'
        ? [...VALID_SEGMENTS]
        : segmentRaw.split(',').map(item => item.trim()).filter(Boolean);
    for (const segment of segments) {
        if (!VALID_SEGMENTS.includes(segment)) {
            throw new Error(`Unsupported --segment=${segment}; expected one of ${VALID_SEGMENTS.join(', ')} or all`);
        }
    }
    const expectedCountRaw = argValue(argv, '--expected-count', null);
    return {
        apply: flags.has('--apply'),
        dryRun: flags.has('--dry-run') || !flags.has('--apply'),
        json: flags.has('--json'),
        segments,
        sourceRoot: path.resolve(String(argValue(argv, '--source-root', DEFAULT_SOURCE_ROOT) || DEFAULT_SOURCE_ROOT)),
        confirmation: String(argValue(argv, '--confirm', '') || '').trim(),
        expectedCount: expectedCountRaw === null ? null : Number(expectedCountRaw),
        manifestHash: String(argValue(argv, '--manifest-hash', '') || '').trim(),
        operator: String(argValue(argv, '--operator', process.env.USERNAME || process.env.USER || 'operator') || 'operator').trim()
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
    const connectionString = env.DATABASE_PUBLIC_URL || env.DATABASE_URL || env.TEST_DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_PUBLIC_URL, DATABASE_URL, or TEST_DATABASE_URL is required');
    return {
        connectionString,
        ssl: /railway|proxy|amazonaws|render|neon|supabase/i.test(connectionString)
            ? { rejectUnauthorized: false }
            : false,
        max: 2,
        connectionTimeoutMillis: 10_000
    };
}

function sha256(bufferOrText) {
    return crypto.createHash('sha256').update(bufferOrText).digest('hex');
}

function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function normalizeMime(value) {
    return String(value || '').split(';')[0].trim().toLowerCase();
}

function extOf(value) {
    return path.extname(String(value || '')).slice(1).toLowerCase();
}

function parseJsonObject(value) {
    if (!value) return {};
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value !== 'string') return {};
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function opaqueId(...parts) {
    return sha256(parts.map(part => String(part ?? '')).join('\u001f')).slice(0, 20);
}

function safePositiveInt(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}

function redactedEntry(candidate, patch = {}) {
    return {
        segment: candidate.segment,
        source: candidate.source,
        opaqueSourceId: opaqueId(candidate.segment, candidate.source, candidate.sourceId),
        storageKeySha256: sha256(candidate.storageKey || ''),
        ...patch
    };
}

function safeJoin(root, localDir, relativePath) {
    const base = path.resolve(root, localDir);
    const full = path.resolve(base, String(relativePath || '').replace(/\\/g, '/'));
    if (full !== base && !full.startsWith(base + path.sep)) {
        return null;
    }
    return full;
}

function localPathFor(candidate, sourceRoot) {
    if (!candidate.localRelativePath) return null;
    return safeJoin(sourceRoot, LOCAL_DIRS[candidate.segment], candidate.localRelativePath);
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

function chatContentPolicy(storageKey, metadata = {}) {
    const ext = extOf(storageKey || metadata.name);
    const policy = CHAT_UPLOAD_TYPES[ext];
    if (!policy) return null;
    const mime = normalizeMime(metadata.mimeType || metadata.mime_type || metadata.contentType || metadata.content_type);
    if (mime && !policy.mimes.includes(mime)) return null;
    return mime && policy.mimes.includes(mime) ? mime : policy.contentType;
}

function soundContentType(storageKey, fallback) {
    const mime = normalizeMime(fallback);
    const allowed = new Set([
        'audio/aac',
        'audio/mp3',
        'audio/mp4',
        'audio/mpeg',
        'audio/ogg',
        'audio/wav',
        'audio/webm',
        'audio/x-m4a',
        'audio/x-wav',
        'application/ogg',
        'application/octet-stream'
    ]);
    if (allowed.has(mime)) return mime;
    return AUDIO_CONTENT_TYPES[extOf(storageKey)] || null;
}

function avatarContentType(storageKey, fallback) {
    const ext = extOf(storageKey);
    const policy = PROFILE_AVATAR_TYPES[ext];
    if (!policy) return null;
    const mime = normalizeMime(fallback);
    if (mime && !policy.mimes.includes(mime)) return null;
    return mime && policy.mimes.includes(mime) ? mime : policy.contentType;
}

function catalogContentType(filename, fallback) {
    const mime = normalizeMime(fallback) || IMAGE_EXT_MIME[extOf(filename)];
    const canonical = mime === 'image/jpg' ? 'image/jpeg' : mime;
    return ALLOWED_IMAGE_MIME_TYPES.has(canonical) ? canonical : null;
}

function designMimeOk(filename, mime) {
    const ext = extOf(filename);
    if (!DESIGN_ALLOWED_EXT.has(ext)) return false;
    const normalized = normalizeMime(mime);
    if (!normalized) return true;
    if (ext === 'pdf') return normalized === 'application/pdf' || normalized === 'application/octet-stream';
    if (ext === 'svg') return normalized === 'image/svg+xml' || normalized === 'application/octet-stream';
    return normalized.startsWith('image/') || normalized === 'application/octet-stream';
}

function safeErrorReason(err) {
    const message = String(err?.message || err || '').toLowerCase();
    if (message.includes('manifest_source_changed')) return 'manifest_source_changed';
    if (message.includes('unsafe_source_path')) return 'unsafe_source_path';
    if (message.includes('insert_verification_failed')) return 'insert_verification_failed';
    if (message.includes('candidate_not_found')) return 'candidate_not_found';
    if (message.includes('duplicate') || err?.code === '23505') return 'database_unique_conflict';
    if (message.includes('violates foreign key') || err?.code === '23503') return 'database_foreign_key_violation';
    if (message.includes('check constraint') || err?.code === '23514') return 'database_check_constraint_violation';
    if (message.includes('simulated insert failure')) return 'simulated_insert_failure';
    return err?.code ? `database_error_${String(err.code).replace(/[^a-zA-Z0-9_-]+/g, '_')}` : 'database_error';
}

function extractChatFileMetadata(row) {
    const metadata = parseJsonObject(row.metadata);
    const file = parseJsonObject(metadata.file);
    const storageKey = normalizeChatUploadRequestPath(file.storageKey || file.storagePath || file.storage_key || file.url || file.storageUrl);
    if (!storageKey) return null;
    return {
        url: file.url || file.storageUrl || null,
        storageKey,
        name: file.name || path.posix.basename(storageKey),
        mimeType: file.mimeType || file.mime_type || file.contentType || null,
        size: safePositiveInt(file.size)
    };
}

async function loadChatCandidates(db) {
    if (!(await tableExists(db, 'chat_messages'))) return [];
    const result = await db.query(
        `SELECT id, channel_id, user_id, metadata
           FROM chat_messages
          WHERE metadata IS NOT NULL
            AND metadata::text LIKE '%/uploads/chat/%'
          ORDER BY id`
    );
    return (result.rows || []).map(row => {
        const file = extractChatFileMetadata(row);
        if (!file) {
            return { segment: 'chat', source: 'chat_messages', sourceId: row.id, invalidReason: 'missing_upload_metadata' };
        }
        const storageKey = normalizeChatUploadRequestPath(file.storageKey || file.url || file.name);
        return {
            segment: 'chat',
            source: 'chat_messages',
            sourceId: row.id,
            storageKey,
            localRelativePath: storageKey,
            channelId: safePositiveInt(row.channel_id),
            messageId: safePositiveInt(row.id),
            createdByUserId: safePositiveInt(row.user_id),
            originalName: safeChatFilename(file.name || path.posix.basename(storageKey)),
            contentType: chatContentPolicy(storageKey, file),
            metadataSize: file.size,
            maxBytes: MAX_CHAT_UPLOAD_BYTES
        };
    });
}

async function loadSoundCandidates(db) {
    if (!(await tableExists(db, 'sounds'))) return [];
    const result = await db.query(
        `SELECT id, filename, file_path, url, category, file_size, uploaded_by, storage_key, storage_url
           FROM sounds
          WHERE COALESCE(storage_key, '') <> ''
             OR COALESCE(file_path, '') LIKE '/uploads/sounds/%'
             OR COALESCE(url, '') LIKE '/uploads/sounds/%'
          ORDER BY id`
    );
    return (result.rows || []).map(row => {
        const storageKey = normalizeSoundUploadRequestPath(row.storage_key || row.storage_url || row.file_path || row.url || row.filename);
        if (!storageKey) {
            return { segment: 'sounds', source: 'sounds', sourceId: row.id, invalidReason: 'missing_upload_metadata' };
        }
        return {
            segment: 'sounds',
            source: 'sounds',
            sourceId: row.id,
            storageKey,
            localRelativePath: storageKey,
            soundId: safePositiveInt(row.id),
            originalName: path.posix.basename(storageKey),
            contentType: soundContentType(storageKey),
            metadataSize: safePositiveInt(row.file_size),
            uploadedBy: row.uploaded_by || null,
            maxBytes: MAX_SOUND_UPLOAD_BYTES
        };
    });
}

async function loadProfileAvatarCandidates(db) {
    if (!(await tableExists(db, 'user_profiles_ext'))) return [];
    if (!(await columnExists(db, 'user_profiles_ext', 'avatar_url'))) return [];
    const result = await db.query(
        `SELECT username, avatar_url
           FROM user_profiles_ext
          WHERE COALESCE(avatar_url, '') LIKE '/uploads/profile-avatars/%'
          ORDER BY username`
    );
    return (result.rows || []).map(row => {
        const storageKey = normalizeAvatarRequestPath(row.avatar_url);
        if (!storageKey || !row.username) {
            return { segment: 'profile-avatars', source: 'user_profiles_ext', sourceId: row.username || 'unknown', invalidReason: 'missing_upload_metadata' };
        }
        return {
            segment: 'profile-avatars',
            source: 'user_profiles_ext',
            sourceId: row.username,
            storageKey,
            localRelativePath: storageKey,
            username: String(row.username),
            originalName: safeAvatarFilename(path.posix.basename(storageKey)),
            contentType: avatarContentType(storageKey),
            metadataSize: null,
            maxBytes: MAX_AVATAR_BYTES
        };
    });
}

async function loadCatalogImageCandidates(db) {
    const queries = [];
    const addUrlColumn = async (table, column, source) => {
        if (await tableExists(db, table) && await columnExists(db, table, column)) {
            queries.push({ table, column, source });
        }
    };
    await addUrlColumn('catalog_items', 'image_url', 'catalog_items');
    await addUrlColumn('catalog_definitions', 'cover_image_url', 'catalog_definitions');
    await addUrlColumn('catalog_pages', 'background_url', 'catalog_pages_background');
    await addUrlColumn('catalog_pages', 'image_url', 'catalog_pages_image');
    await addUrlColumn('products', 'icon_url', 'products');

    const candidates = [];
    for (const query of queries) {
        const result = await db.query(
            `SELECT id, ${query.column} AS url
               FROM ${query.table}
              WHERE COALESCE(${query.column}, '') LIKE '/uploads/catalog-images/items/%'
              ORDER BY id`
        );
        for (const row of result.rows || []) {
            const filename = normalizeCatalogImageRequestFilename(String(row.url || '').replace(/^\/uploads\/catalog-images\/items\/?/, ''));
            if (!filename) {
                candidates.push({ segment: 'catalog-images', source: query.source, sourceId: row.id, invalidReason: 'missing_upload_metadata' });
                continue;
            }
            candidates.push({
                segment: 'catalog-images',
                source: query.source,
                sourceId: row.id,
                storageKey: filename,
                localRelativePath: `items/${filename}`,
                filename: safeImageFilename(filename),
                contentType: catalogContentType(filename),
                metadataSize: null,
                maxBytes: DEFAULT_MAX_IMAGE_BYTES
            });
        }
    }
    return candidates;
}

async function loadDesignCandidates(db) {
    if (!(await tableExists(db, 'designs'))) return [];
    const hasStorageKey = await columnExists(db, 'designs', 'storage_key');
    const result = await db.query(
        `SELECT id, filename, original_name, mime_type, file_size${hasStorageKey ? ', storage_key' : ''}
           FROM designs
          WHERE COALESCE(filename, '') <> ''
          ORDER BY id`
    );
    return (result.rows || []).map(row => {
        const filename = safeDesignFilename(row.filename);
        let storageKey = null;
        try {
            storageKey = row.storage_key || designStorageKey(row.id, filename);
        } catch {
            return { segment: 'designs', source: 'designs', sourceId: row.id, invalidReason: 'missing_upload_metadata' };
        }
        return {
            segment: 'designs',
            source: 'designs',
            sourceId: row.id,
            storageKey,
            localRelativePath: filename,
            designId: safePositiveInt(row.id),
            originalName: safeDesignFilename(row.original_name || filename),
            contentType: normalizeMime(row.mime_type) || null,
            metadataSize: safePositiveInt(row.file_size),
            maxBytes: DESIGN_MAX_BYTES
        };
    });
}

async function loadCandidates(db, segments) {
    const loaders = {
        chat: loadChatCandidates,
        sounds: loadSoundCandidates,
        'profile-avatars': loadProfileAvatarCandidates,
        'catalog-images': loadCatalogImageCandidates,
        designs: loadDesignCandidates
    };
    const all = [];
    for (const segment of segments) {
        const rows = await loaders[segment](db);
        all.push(...rows);
    }
    return all;
}

async function readExistingBlob(db, candidate) {
    if (!candidate.storageKey) return null;
    const normalizeRow = row => {
        if (!row) return null;
        const data = row.data ? (Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data)) : null;
        return {
            ...row,
            file_size: Number(row.file_size || row.size_bytes || data?.length || 0),
            checksum_sha256: row.checksum_sha256 || (data ? sha256(data) : null)
        };
    };
    if (candidate.segment === 'catalog-images') {
        const result = await db.query(
            'SELECT filename AS storage_key, size_bytes AS file_size, data FROM catalog_image_blobs WHERE filename = $1 LIMIT 1',
            [candidate.filename || candidate.storageKey]
        );
        return normalizeRow(result.rows?.[0]);
    }
    if (candidate.segment === 'designs') {
        const result = await db.query(
            'SELECT storage_key, octet_length(data)::int AS file_size, checksum_sha256 FROM design_file_blobs WHERE storage_key = $1 LIMIT 1',
            [candidate.storageKey]
        );
        return normalizeRow(result.rows?.[0]);
    }
    const table = {
        chat: 'chat_upload_blobs',
        sounds: 'sound_upload_blobs',
        'profile-avatars': 'profile_avatar_blobs'
    }[candidate.segment];
    const result = await db.query(
        `SELECT storage_key, file_size, checksum_sha256
           FROM ${table}
          WHERE storage_key = $1
          LIMIT 1`,
        [candidate.storageKey]
    );
    return normalizeRow(result.rows?.[0]);
}

function existingMatches(existing, checksum, size) {
    if (!existing) return false;
    const existingChecksum = String(existing.checksum_sha256 || '').toLowerCase();
    const expected = String(checksum || '').toLowerCase();
    const existingSize = Number(existing.file_size || existing.size_bytes || 0);
    return existingChecksum === expected
        && existingSize === Number(size || 0);
}

function existingConflicts(existing, checksum, size) {
    if (!existing) return false;
    return !existingMatches(existing, checksum, size);
}

function validateCandidate(candidate) {
    if (candidate.invalidReason || !candidate.storageKey) return candidate.invalidReason || 'missing_upload_metadata';
    if (candidate.segment === 'chat' && (!candidate.channelId || !candidate.contentType)) return 'invalid_chat_metadata';
    if (candidate.segment === 'sounds' && !candidate.contentType) return 'invalid_sound_metadata';
    if (candidate.segment === 'profile-avatars' && (!candidate.username || !candidate.contentType)) return 'invalid_avatar_metadata';
    if (candidate.segment === 'catalog-images' && (!candidate.filename || !candidate.contentType)) return 'invalid_catalog_metadata';
    if (candidate.segment === 'designs' && (!candidate.designId || !designMimeOk(candidate.localRelativePath, candidate.contentType))) return 'invalid_design_metadata';
    return null;
}

async function evaluateCandidate(db, candidate, options = {}) {
    const invalid = validateCandidate(candidate);
    if (invalid) {
        return redactedEntry(candidate, { verdict: VERDICTS.INVALID_METADATA, reason: invalid });
    }

    const existing = await readExistingBlob(db, candidate);
    const fullPath = localPathFor(candidate, options.sourceRoot || DEFAULT_SOURCE_ROOT);
    const stat = fullPath ? await fsp.stat(fullPath).catch(() => null) : null;
    if (!stat || !stat.isFile()) {
        return redactedEntry(candidate, {
            verdict: existing ? VERDICTS.EXISTING_BLOB_SOURCE_MISSING : VERDICTS.UNRECOVERABLE_SOURCE_MISSING,
            byteLength: existing ? Number(existing.file_size || existing.size_bytes || 0) : null,
            checksumSha256: existing ? String(existing.checksum_sha256 || '') || null : null
        });
    }
    if (stat.size <= 0) {
        return redactedEntry(candidate, { verdict: VERDICTS.INVALID_METADATA, reason: 'empty_source_file', byteLength: stat.size });
    }
    if (candidate.maxBytes && stat.size > candidate.maxBytes) {
        return redactedEntry(candidate, { verdict: VERDICTS.OVERSIZE, byteLength: stat.size, maxBytes: candidate.maxBytes });
    }
    if (candidate.metadataSize && Number(candidate.metadataSize) !== Number(stat.size)) {
        return redactedEntry(candidate, {
            verdict: VERDICTS.INVALID_METADATA,
            reason: 'metadata_size_mismatch',
            byteLength: stat.size,
            metadataSize: Number(candidate.metadataSize)
        });
    }
    const buffer = await fsp.readFile(fullPath);
    const checksum = sha256(buffer);
    if (existingMatches(existing, checksum, buffer.length)) {
        return redactedEntry(candidate, {
            verdict: VERDICTS.EXISTING_EXACT_BLOB,
            byteLength: buffer.length,
            checksumSha256: checksum
        });
    }
    if (existingConflicts(existing, checksum, buffer.length)) {
        return redactedEntry(candidate, {
            verdict: VERDICTS.CHECKSUM_CONFLICT,
            byteLength: buffer.length,
            checksumSha256: checksum
        });
    }
    return redactedEntry(candidate, {
        verdict: VERDICTS.WRITE_CANDIDATE,
        byteLength: buffer.length,
        checksumSha256: checksum
    });
}

function summarize(entries) {
    const bySegment = {};
    const byVerdict = {};
    for (const entry of entries) {
        byVerdict[entry.verdict] = (byVerdict[entry.verdict] || 0) + 1;
        bySegment[entry.segment] ||= { scanned: 0, writeCandidates: 0, written: 0, existing: 0, missing: 0, conflicts: 0, blocked: 0 };
        const summary = bySegment[entry.segment];
        summary.scanned += 1;
        if (entry.verdict === VERDICTS.WRITE_CANDIDATE) summary.writeCandidates += 1;
        if (entry.verdict === VERDICTS.WRITTEN) summary.written += 1;
        if ([VERDICTS.EXISTING_EXACT_BLOB, VERDICTS.EXISTING_BLOB_SOURCE_MISSING, VERDICTS.INSERT_RACE_EXACT].includes(entry.verdict)) summary.existing += 1;
        if (entry.verdict === VERDICTS.UNRECOVERABLE_SOURCE_MISSING) summary.missing += 1;
        if ([VERDICTS.CHECKSUM_CONFLICT, VERDICTS.INSERT_RACE_CONFLICT].includes(entry.verdict)) summary.conflicts += 1;
        if ([VERDICTS.INVALID_METADATA, VERDICTS.INVALID_MIME, VERDICTS.OVERSIZE, VERDICTS.APPLY_FAILED_ROLLED_BACK].includes(entry.verdict)) summary.blocked += 1;
    }
    return {
        scanned: entries.length,
        writeCandidates: entries.filter(entry => entry.verdict === VERDICTS.WRITE_CANDIDATE).length,
        written: entries.filter(entry => entry.verdict === VERDICTS.WRITTEN).length,
        unrecoverableSourceMissing: entries.filter(entry => entry.verdict === VERDICTS.UNRECOVERABLE_SOURCE_MISSING).length,
        checksumConflicts: entries.filter(entry => [VERDICTS.CHECKSUM_CONFLICT, VERDICTS.INSERT_RACE_CONFLICT].includes(entry.verdict)).length,
        blocked: entries.filter(entry => [VERDICTS.INVALID_METADATA, VERDICTS.INVALID_MIME, VERDICTS.OVERSIZE, VERDICTS.APPLY_FAILED_ROLLED_BACK].includes(entry.verdict)).length,
        byVerdict,
        bySegment
    };
}

function manifestHashFor(entries, options = {}) {
    const stableEntries = entries
        .map(entry => ({
            segment: entry.segment,
            source: entry.source,
            opaqueSourceId: entry.opaqueSourceId,
            storageKeySha256: entry.storageKeySha256,
            verdict: entry.verdict,
            byteLength: entry.byteLength ?? null,
            checksumSha256: entry.checksumSha256 || null,
            reason: entry.reason || null
        }))
        .sort((a, b) => stableJson(a).localeCompare(stableJson(b)));
    return sha256(stableJson({
        kind: 'legacy_upload_blob_backfill_manifest_v1',
        segments: [...(options.segments || [])].sort(),
        entries: stableEntries
    }));
}

async function buildBackfillManifest(db, options = {}) {
    const segments = options.segments || [...VALID_SEGMENTS];
    const candidates = await loadCandidates(db, segments);
    const dedup = new Map();
    for (const candidate of candidates) {
        const key = `${candidate.segment}:${candidate.storageKey || `${candidate.source}:${candidate.sourceId}`}`;
        if (!dedup.has(key)) dedup.set(key, candidate);
    }
    const entries = [];
    for (const candidate of dedup.values()) {
        entries.push(await evaluateCandidate(db, candidate, options));
    }
    const summary = summarize(entries);
    const manifestHash = manifestHashFor(entries, { segments });
    return {
        kind: 'legacy_upload_blob_backfill_manifest_v1',
        dryRun: options.apply !== true,
        generatedAt: options.generatedAt || new Date().toISOString(),
        sourceRootSha256: sha256(path.resolve(options.sourceRoot || DEFAULT_SOURCE_ROOT)),
        piiIncluded: false,
        binaryIncluded: false,
        filenamesIncluded: false,
        segments,
        summary,
        manifestHash,
        entries
    };
}

async function readCandidateBuffer(candidate, sourceRoot) {
    const fullPath = localPathFor(candidate, sourceRoot);
    if (!fullPath) throw new Error('unsafe_source_path');
    const buffer = await fsp.readFile(fullPath);
    const checksum = sha256(buffer);
    return { buffer, checksum };
}

async function applyOne(db, candidate, plannedEntry, options = {}) {
    let client = null;
    try {
        const connectable = db && typeof db.connect === 'function';
        client = connectable ? await db.connect() : db;
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`legacy-upload-backfill:${candidate.segment}:${candidate.storageKey}`]);
        const existing = await readExistingBlob(client, candidate);
        const { buffer, checksum } = await readCandidateBuffer(candidate, options.sourceRoot || DEFAULT_SOURCE_ROOT);
        if (checksum !== plannedEntry.checksumSha256 || buffer.length !== plannedEntry.byteLength) {
            throw new Error('manifest_source_changed');
        }
        if (existingMatches(existing, checksum, buffer.length)) {
            await client.query('COMMIT');
            return { ...plannedEntry, verdict: VERDICTS.INSERT_RACE_EXACT };
        }
        if (existingConflicts(existing, checksum, buffer.length)) {
            await client.query('ROLLBACK');
            return { ...plannedEntry, verdict: VERDICTS.INSERT_RACE_CONFLICT };
        }

        if (candidate.segment === 'chat') {
            await client.query(
                `INSERT INTO chat_upload_blobs
                    (channel_id, message_id, storage_key, original_name, content_type, file_size, data, checksum_sha256, created_by_user_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 ON CONFLICT (storage_key) DO NOTHING`,
                [
                    candidate.channelId,
                    candidate.messageId || null,
                    candidate.storageKey,
                    candidate.originalName,
                    candidate.contentType,
                    buffer.length,
                    buffer,
                    checksum,
                    candidate.createdByUserId || null
                ]
            );
        } else if (candidate.segment === 'sounds') {
            await client.query(
                `INSERT INTO sound_upload_blobs
                    (sound_id, storage_key, original_name, content_type, file_size, data, checksum_sha256, created_by_username)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT (storage_key) DO NOTHING`,
                [
                    candidate.soundId || null,
                    candidate.storageKey,
                    candidate.originalName,
                    candidate.contentType,
                    buffer.length,
                    buffer,
                    checksum,
                    candidate.uploadedBy || null
                ]
            );
        } else if (candidate.segment === 'profile-avatars') {
            await client.query(
                `INSERT INTO profile_avatar_blobs
                    (username, storage_key, original_name, content_type, file_size, data, checksum_sha256)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (storage_key) DO NOTHING`,
                [candidate.username, candidate.storageKey, candidate.originalName, candidate.contentType, buffer.length, buffer, checksum]
            );
        } else if (candidate.segment === 'catalog-images') {
            await client.query(
                `INSERT INTO catalog_image_blobs
                    (filename, content_type, data, size_bytes, source_url, metadata)
                 VALUES ($1, $2, $3, $4, NULL, $5::jsonb)
                 ON CONFLICT (filename) DO NOTHING`,
                [
                    candidate.filename,
                    candidate.contentType,
                    buffer,
                    buffer.length,
                    JSON.stringify({ backfill: 'legacy_upload_blob_backfill_v1' })
                ]
            );
        } else if (candidate.segment === 'designs') {
            await client.query(
                `INSERT INTO design_file_blobs
                    (design_id, storage_key, data, checksum_sha256)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (storage_key) DO NOTHING`,
                [candidate.designId, candidate.storageKey, buffer, checksum]
            );
        } else {
            throw new Error(`unsupported_segment:${candidate.segment}`);
        }

        const after = await readExistingBlob(client, candidate);
        if (!existingMatches(after, checksum, buffer.length)) {
            throw new Error('insert_verification_failed');
        }
        await client.query('COMMIT');
        return { ...plannedEntry, verdict: VERDICTS.WRITTEN };
    } catch (err) {
        if (client) {
            try { await client.query('ROLLBACK'); } catch {}
        }
        return { ...plannedEntry, verdict: VERDICTS.APPLY_FAILED_ROLLED_BACK, reason: safeErrorReason(err) };
    } finally {
        if (client && db && client !== db && typeof client.release === 'function') client.release();
    }
}

async function applyBackfill(db, dryRunManifest, options = {}) {
    if (options.confirmation !== APPLY_CONFIRMATION) {
        throw new Error(`Apply requires --confirm=${APPLY_CONFIRMATION}`);
    }
    if (!Number.isInteger(options.expectedCount) || options.expectedCount < 0) {
        throw new Error('--expected-count=<dry-run writeCandidates> is required for apply');
    }
    if (!options.manifestHash || options.manifestHash !== dryRunManifest.manifestHash) {
        throw new Error('--manifest-hash must match the dry-run manifest hash');
    }
    if (options.expectedCount !== dryRunManifest.summary.writeCandidates) {
        throw new Error(`--expected-count=${dryRunManifest.summary.writeCandidates} is required for this manifest`);
    }
    if (dryRunManifest.summary.checksumConflicts > 0 || dryRunManifest.summary.blocked > 0) {
        throw new Error('Apply refused while checksum conflicts or blocked records are present');
    }

    const candidates = await loadCandidates(db, dryRunManifest.segments);
    const candidateByEntry = new Map();
    for (const candidate of candidates) {
        candidateByEntry.set(`${candidate.segment}:${candidate.source}:${opaqueId(candidate.segment, candidate.source, candidate.sourceId)}:${sha256(candidate.storageKey || '')}`, candidate);
    }

    const results = [];
    for (const entry of dryRunManifest.entries.filter(item => item.verdict === VERDICTS.WRITE_CANDIDATE)) {
        const candidate = candidateByEntry.get(`${entry.segment}:${entry.source}:${entry.opaqueSourceId}:${entry.storageKeySha256}`);
        if (!candidate) {
            results.push({ ...entry, verdict: VERDICTS.APPLY_FAILED_ROLLED_BACK, reason: 'candidate_not_found' });
            continue;
        }
        results.push(await applyOne(db, candidate, entry, options));
    }
    const merged = [
        ...dryRunManifest.entries.filter(item => item.verdict !== VERDICTS.WRITE_CANDIDATE),
        ...results
    ];
    return {
        ...dryRunManifest,
        dryRun: false,
        appliedAt: new Date().toISOString(),
        summary: summarize(merged),
        manifestHash: manifestHashFor(merged, { segments: dryRunManifest.segments }),
        entries: merged
    };
}

async function main() {
    const options = parseArgs();
    loadEnvFile();
    const pool = new Pool(poolConfig());
    try {
        const dryRunManifest = await buildBackfillManifest(pool, options);
        const output = options.apply
            ? await applyBackfill(pool, dryRunManifest, options)
            : dryRunManifest;
        if (options.json) {
            console.log(JSON.stringify(output, null, 2));
        } else {
            console.log(`Legacy upload blob backfill ${output.dryRun ? 'dry-run' : 'apply'}: segments=${output.segments.join(',')}`);
            console.log(`manifestHash=${output.manifestHash}`);
            console.log(`scanned=${output.summary.scanned} writeCandidates=${output.summary.writeCandidates} written=${output.summary.written} missing=${output.summary.unrecoverableSourceMissing} conflicts=${output.summary.checksumConflicts} blocked=${output.summary.blocked}`);
            for (const [segment, summary] of Object.entries(output.summary.bySegment)) {
                console.log(`${segment}: scanned=${summary.scanned} writeCandidates=${summary.writeCandidates} written=${summary.written} existing=${summary.existing} missing=${summary.missing} conflicts=${summary.conflicts} blocked=${summary.blocked}`);
            }
        }
        if (!output.dryRun && (output.summary.checksumConflicts > 0 || output.summary.blocked > 0)) {
            process.exitCode = 1;
        }
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    main().catch(err => {
        console.error(`Legacy upload blob backfill failed: ${err.message}`);
        process.exit(1);
    });
}

module.exports = {
    APPLY_CONFIRMATION,
    VALID_SEGMENTS,
    VERDICTS,
    applyBackfill,
    buildBackfillManifest,
    chatContentPolicy,
    loadCandidates,
    manifestHashFor,
    parseArgs,
    poolConfig,
    safeErrorReason,
    safeJoin,
    sha256,
    soundContentType
};
