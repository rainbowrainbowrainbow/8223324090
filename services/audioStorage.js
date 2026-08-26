/**
 * services/audioStorage.js — Durable sound upload storage on the CRM upload surface.
 *
 * New sound uploads are stored in Postgres sound_upload_blobs while keeping the
 * public URL under /uploads/sounds. Legacy local files remain readable through
 * the static /uploads fallback.
 */
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { createLogger } = require('../utils/logger');

const log = createLogger('AudioStorage');
const DEFAULT_LOCAL_DIR = path.join(__dirname, '..', 'uploads', 'sounds');
const PUBLIC_PREFIX = '/uploads/sounds';
const DEFAULT_FOLDER = 'sounds';
const SOUND_STORAGE_PROVIDER = 'postgres';
const SOUND_STORAGE_BUCKET = 'sound_upload_blobs';
const MAX_SOUND_UPLOAD_BYTES = 50 * 1024 * 1024;
const AUDIO_CONTENT_TYPES = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    webm: 'audio/webm'
};
const AUDIO_MIME_ALIASES = new Set([
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

const _tr = {'а':'a','б':'b','в':'v','г':'h','ґ':'g','д':'d','е':'e','є':'ye','ж':'zh','з':'z','и':'y','і':'i','ї':'yi','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ь':'','ю':'yu','я':'ya'};

function transliterate(text) {
    return (text || '').toLowerCase().split('').map(c => _tr[c] || c).join('');
}

function makeAudioFilename(category, name, ext = 'mp3') {
    const slug = transliterate(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 40);
    const safeCat = (category || 'general').replace(/[^a-z0-9-]+/gi, '');
    return `${safeCat}-${slug}-${Date.now()}.${ext}`;
}

function checksumSha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function _normalizeMime(value) {
    return String(value || '').split(';')[0].trim().toLowerCase();
}

function _extensionOf(filename) {
    return path.extname(filename || '').slice(1).toLowerCase();
}

function _contentTypeFor(filename, fallback) {
    const ext = _extensionOf(filename);
    const normalized = _normalizeMime(fallback);
    if (normalized && AUDIO_MIME_ALIASES.has(normalized)) return normalized;
    return AUDIO_CONTENT_TYPES[ext] || 'audio/mpeg';
}

function _safeFolder(folder) {
    return (folder || DEFAULT_FOLDER)
        .split('/')
        .map(part => part.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g, ''))
        .filter(Boolean)
        .join('/') || DEFAULT_FOLDER;
}

function _safeFilename(filename) {
    const safe = (filename || makeAudioFilename('general', 'audio'))
        .split(/[\\/]/)
        .pop()
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^\.+/, '')
        .replace(/^-|-$/g, '')
        .slice(0, 180);
    return safe || makeAudioFilename('general', 'audio');
}

function _resolveQuery(options = {}) {
    const queryLike = options.query || options.client || options.pool || null;
    return queryLike && typeof queryLike.query === 'function' ? queryLike : null;
}

function _ensureBuffer(buffer, options = {}) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        const err = new Error('Empty audio buffer');
        err.statusCode = 400;
        throw err;
    }
    const maxBytes = Number(options.maxBytes || MAX_SOUND_UPLOAD_BYTES);
    if (Number.isFinite(maxBytes) && maxBytes > 0 && buffer.length > maxBytes) {
        const err = new Error('Audio file exceeds maximum size');
        err.statusCode = 413;
        throw err;
    }
}

function normalizeSoundUploadRequestPath(requestPath) {
    let normalized = String(requestPath || '')
        .split('?')[0]
        .split('#')[0]
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .replace(/\/{2,}/g, '/')
        .trim();
    if (!normalized) return '';
    if (normalized.startsWith('uploads/sounds/')) {
        normalized = normalized.slice('uploads/sounds/'.length);
    }
    try {
        normalized = decodeURIComponent(normalized);
    } catch {
        return '';
    }
    return normalized.replace(/^\/+/, '').replace(/\/{2,}/g, '/').trim();
}

function publicSoundUploadUrl(storageKey) {
    const normalized = normalizeSoundUploadRequestPath(storageKey);
    if (!normalized) return PUBLIC_PREFIX;
    return `${PUBLIC_PREFIX}/${normalized.split('/').map(encodeURIComponent).join('/')}`;
}

function prepareSoundUploadBlob(buffer, filename, options = {}) {
    _ensureBuffer(buffer, options);
    const safeFilename = _safeFilename(filename);
    const folder = _safeFolder(options.folder);
    const storagePath = `${folder}/${safeFilename}`;
    const storageKey = normalizeSoundUploadRequestPath(options.storageKey) || storagePath;
    const contentType = _contentTypeFor(safeFilename, options.contentType);
    return {
        provider: SOUND_STORAGE_PROVIDER,
        bucket: SOUND_STORAGE_BUCKET,
        path: storageKey,
        key: storageKey,
        publicUrl: publicSoundUploadUrl(storageKey),
        filename: path.posix.basename(storageKey) || safeFilename,
        contentType,
        fileSize: buffer.length,
        checksum: checksumSha256(buffer),
        buffer
    };
}

async function storeSoundUploadBlob(query, buffer, filename, options = {}) {
    if (!query || typeof query.query !== 'function') {
        throw new Error('Postgres query client is required for sound upload blob storage');
    }
    const prepared = Buffer.isBuffer(buffer)
        ? prepareSoundUploadBlob(buffer, filename, options)
        : buffer;
    if (!prepared || !Buffer.isBuffer(prepared.buffer)) {
        throw new Error('Prepared sound upload blob is required');
    }
    const soundId = options.soundId == null ? null : Number(options.soundId);
    await query.query(
        `INSERT INTO sound_upload_blobs
            (sound_id, storage_key, original_name, content_type, file_size, data, checksum_sha256, created_by_username)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (storage_key)
         DO UPDATE SET sound_id = EXCLUDED.sound_id,
                       original_name = EXCLUDED.original_name,
                       content_type = EXCLUDED.content_type,
                       file_size = EXCLUDED.file_size,
                       data = EXCLUDED.data,
                       checksum_sha256 = EXCLUDED.checksum_sha256,
                       created_by_username = EXCLUDED.created_by_username,
                       updated_at = NOW()`,
        [
            Number.isFinite(soundId) ? soundId : null,
            prepared.key,
            _safeFilename(filename || prepared.filename || 'sound.mp3'),
            prepared.contentType,
            prepared.fileSize,
            prepared.buffer,
            prepared.checksum,
            options.uploadedBy || null
        ]
    );
    return {
        provider: SOUND_STORAGE_PROVIDER,
        bucket: SOUND_STORAGE_BUCKET,
        path: prepared.path,
        key: prepared.key,
        publicUrl: prepared.publicUrl,
        filename: prepared.filename,
        contentType: prepared.contentType,
        fileSize: prepared.fileSize,
        checksum: prepared.checksum
    };
}

async function readSoundUploadBlobByPath(query, requestPath) {
    if (!query || typeof query.query !== 'function') {
        throw new Error('Postgres query client is required for sound upload blob reads');
    }
    const storageKey = normalizeSoundUploadRequestPath(requestPath);
    if (!storageKey) return null;
    const result = await query.query(
        `SELECT id, sound_id, storage_key, original_name, content_type, file_size, data, checksum_sha256, created_at, updated_at
         FROM sound_upload_blobs
         WHERE storage_key = $1
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`,
        [storageKey]
    );
    return result.rows[0] || null;
}

function buildSoundUploadBlobFallbackHandler(query, logger = null) {
    return async (req, res, next) => {
        try {
            const requestPath = req.params?.[0] || req.params?.filename || req.path || '';
            const row = await readSoundUploadBlobByPath(query, requestPath);
            if (!row?.data) return next();
            const data = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);
            const inlineName = _safeFilename(row.original_name || path.posix.basename(row.storage_key || 'sound.mp3'));
            res.setHeader('Content-Type', row.content_type || 'application/octet-stream');
            res.setHeader('Content-Length', String(Number(row.file_size || data.length || 0)));
            res.setHeader('Content-Disposition', `inline; filename="${inlineName}"`);
            res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400');
            return res.send(data);
        } catch (err) {
            if (logger && typeof logger.warn === 'function') {
                logger.warn(`Sound Postgres upload fallback skipped: ${err.message}`);
            }
            return next();
        }
    };
}

async function saveAudioBufferLocally(buffer, filename, options = {}) {
    _ensureBuffer(buffer, options);
    const safeFilename = _safeFilename(filename);
    const folder = _safeFolder(options.folder);
    const storagePath = `${folder}/${safeFilename}`;
    const contentType = _contentTypeFor(safeFilename, options.contentType);
    const localRoot = options.localDir || DEFAULT_LOCAL_DIR;
    const localDir = path.join(localRoot, folder);
    await fsp.mkdir(localDir, { recursive: true });
    const fullPath = path.join(localDir, safeFilename);
    if (options.upsert === false && fs.existsSync(fullPath)) {
        log.error(`Audio file already exists: ${fullPath}`);
        return null;
    }
    await fsp.writeFile(fullPath, buffer);

    const publicUrl = publicSoundUploadUrl(storagePath);
    log.info(`Audio stored locally: ${safeFilename} → ${publicUrl}`);
    return {
        provider: 'local',
        bucket: null,
        path: storagePath,
        key: storagePath,
        publicUrl,
        filename: safeFilename,
        contentType,
        localPath: fullPath,
        fileSize: buffer.length,
        checksum: checksumSha256(buffer)
    };
}

async function _uploadAudioBufferToStorage(buffer, filename, options = {}) {
    try {
        const query = _resolveQuery(options);
        if (query) {
            const stored = await storeSoundUploadBlob(query, buffer, filename, options);
            log.info(`Audio stored in Postgres: ${stored.filename} → ${stored.publicUrl}`);
            return stored;
        }
        return await saveAudioBufferLocally(buffer, filename, options);
    } catch (err) {
        log.error('uploadAudioBufferToStorage error:', err.message);
        return null;
    }
}

async function downloadAudioFromUrlWithMetadata(sourceUrl, options = {}) {
    return _download(sourceUrl, options);
}

async function uploadAudioFromUrlWithMetadata(sourceUrl, filename, options = {}) {
    try {
        const downloaded = await downloadAudioFromUrlWithMetadata(sourceUrl, options);
        const buffer = downloaded.buffer;
        if (!buffer || buffer.length === 0) { log.error('Empty audio download'); return null; }
        log.info(`Downloaded audio: ${Math.round(buffer.length / 1024)}KB`);

        return _uploadAudioBufferToStorage(buffer, filename, {
            ...options,
            contentType: options.contentType || downloaded.contentType
        });
    } catch (err) { log.error('uploadAudioFromUrlWithMetadata error:', err.message); return null; }
}

async function uploadAudioFromUrl(sourceUrl, filename, options = {}) {
    const uploaded = await uploadAudioFromUrlWithMetadata(sourceUrl, filename, options);
    return uploaded?.publicUrl || null;
}

async function uploadAudioBuffer(buffer, filename) {
    const uploaded = await _uploadAudioBufferToStorage(buffer, filename);
    return uploaded?.publicUrl || null;
}

async function uploadAudioBufferWithMetadata(buffer, filename, options = {}) {
    return _uploadAudioBufferToStorage(buffer, filename, options);
}

async function removeAudioObject(storageKey, options = {}) {
    if (!storageKey) return false;
    const normalized = normalizeSoundUploadRequestPath(storageKey);
    if (!normalized) return false;
    const query = _resolveQuery(options);
    if (query) {
        const result = await query.query('DELETE FROM sound_upload_blobs WHERE storage_key = $1', [normalized]);
        if (result.rowCount > 0) return true;
    }
    try {
        const fullPath = path.join(DEFAULT_LOCAL_DIR, normalized);
        if (!fullPath.startsWith(DEFAULT_LOCAL_DIR)) return false;
        if (!fs.existsSync(fullPath)) return false;
        await fsp.unlink(fullPath);
        return true;
    } catch (err) {
        log.warn(`Audio delete error for ${storageKey}: ${err.message}`);
        return false;
    }
}

function _download(url, options = {}) {
    const maxBytes = Number(options.maxBytes || MAX_SOUND_UPLOAD_BYTES);
    const timeoutMs = Number(options.timeoutMs || 60000);
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, { timeout: timeoutMs }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                return _download(res.headers.location, options).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            const chunks = [];
            let totalBytes = 0;
            res.on('data', c => {
                totalBytes += c.length;
                if (Number.isFinite(maxBytes) && maxBytes > 0 && totalBytes > maxBytes) {
                    req.destroy(new Error('Audio file exceeds maximum size'));
                    return;
                }
                chunks.push(c);
            });
            res.on('end', () => resolve({
                buffer: Buffer.concat(chunks),
                contentType: _normalizeMime(res.headers['content-type'])
            }));
            res.on('error', reject);
        });
        req.on('timeout', () => req.destroy(new Error('Audio download timeout')));
        req.on('error', reject);
    });
}

module.exports = {
    AUDIO_CONTENT_TYPES,
    DEFAULT_LOCAL_DIR,
    MAX_SOUND_UPLOAD_BYTES,
    PUBLIC_PREFIX,
    SOUND_STORAGE_BUCKET,
    SOUND_STORAGE_PROVIDER,
    buildSoundUploadBlobFallbackHandler,
    checksumSha256,
    downloadAudioFromUrlWithMetadata,
    makeAudioFilename,
    normalizeSoundUploadRequestPath,
    prepareSoundUploadBlob,
    publicSoundUploadUrl,
    readSoundUploadBlobByPath,
    removeAudioObject,
    saveAudioBufferLocally,
    storeSoundUploadBlob,
    transliterate,
    uploadAudioBuffer,
    uploadAudioBufferWithMetadata,
    uploadAudioFromUrl,
    uploadAudioFromUrlWithMetadata
};
