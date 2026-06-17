/**
 * services/profileAvatarStorage.js - Durable profile avatar uploads.
 *
 * New writes use Postgres-backed blob storage and keep the public path under
 * /uploads/profile-avatars. Legacy local files remain readable through the
 * static /uploads fallback.
 */
const crypto = require('crypto');
const fsp = require('fs/promises');
const path = require('path');

const PUBLIC_PREFIX = '/uploads/profile-avatars';
const PROFILE_AVATAR_STORAGE_PROVIDER = 'postgres';
const PROFILE_AVATAR_STORAGE_BUCKET = 'profile_avatar_blobs';
const DEFAULT_LOCAL_DIR = path.join(__dirname, '..', 'uploads', 'profile-avatars');
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const PROFILE_AVATAR_TYPES = {
    jpg: { contentType: 'image/jpeg', mimes: ['image/jpeg'] },
    jpeg: { contentType: 'image/jpeg', mimes: ['image/jpeg'] },
    png: { contentType: 'image/png', mimes: ['image/png'] },
    webp: { contentType: 'image/webp', mimes: ['image/webp'] },
    gif: { contentType: 'image/gif', mimes: ['image/gif'] }
};

function checksumSha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function _normalizeMime(mimeType) {
    return String(mimeType || '').split(';')[0].trim().toLowerCase();
}

function _extensionOf(filename) {
    return path.extname(filename || '').slice(1).toLowerCase();
}

function _safePart(value, fallback = 'user') {
    return String(value || fallback)
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48) || fallback;
}

function safeFilename(filename) {
    const basename = String(filename || 'avatar').split(/[\\/]/).pop();
    return basename
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^\.+/, '')
        .replace(/^-|-$/g, '')
        .slice(0, 180) || 'avatar';
}

function _safeOriginalName(filename, ext) {
    const parsed = path.parse(safeFilename(filename || `avatar.${ext || 'png'}`));
    const base = (parsed.name || 'avatar')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60) || 'avatar';
    return `${base}.${ext}`;
}

function validateProfileAvatarFile(file) {
    const ext = _extensionOf(file?.originalname);
    if (!ext || ext === 'svg') {
        const err = new Error('Підтримуються тільки JPG, PNG, WebP або GIF');
        err.statusCode = 400;
        throw err;
    }

    const policy = PROFILE_AVATAR_TYPES[ext];
    if (!policy) {
        const err = new Error('Підтримуються тільки JPG, PNG, WebP або GIF');
        err.statusCode = 400;
        throw err;
    }

    const size = Number(file?.size || file?.buffer?.length || 0);
    if (size > MAX_AVATAR_BYTES) {
        const err = new Error('Фото профілю має бути до 5 МБ');
        err.statusCode = 413;
        throw err;
    }

    const mimeType = _normalizeMime(file?.mimetype);
    if (mimeType && !policy.mimes.includes(mimeType)) {
        const err = new Error('Тип файлу не збігається з розширенням');
        err.statusCode = 400;
        throw err;
    }

    return {
        ext,
        contentType: mimeType && policy.mimes.includes(mimeType) ? mimeType : policy.contentType
    };
}

function profileAvatarStorageKey(file, options = {}) {
    const policy = validateProfileAvatarFile(file);
    const userPart = _safePart(options.username || options.userId, 'user');
    const safeName = _safeOriginalName(file.originalname, policy.ext);
    const unique = `${Date.now()}-${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(12).toString('hex')}`;
    return `users/${userPart}/${unique}-${safeName}`;
}

function normalizeAvatarRequestPath(requestPath) {
    let normalized = String(requestPath || '')
        .split('?')[0]
        .split('#')[0]
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .replace(/\/{2,}/g, '/')
        .trim();
    if (!normalized) return '';
    if (normalized.startsWith('uploads/profile-avatars/')) {
        normalized = normalized.slice('uploads/profile-avatars/'.length);
    }
    if (normalized.startsWith('profile-avatars/')) {
        normalized = normalized.slice('profile-avatars/'.length);
    }
    try {
        normalized = decodeURIComponent(normalized);
    } catch {}
    return normalized.replace(/^\/+/, '').replace(/\/{2,}/g, '/').trim();
}

function publicProfileAvatarUrl(storageKey) {
    const normalized = normalizeAvatarRequestPath(storageKey);
    if (!normalized) return PUBLIC_PREFIX;
    return `${PUBLIC_PREFIX}/${normalized.split('/').map(part => encodeURIComponent(part)).join('/')}`;
}

function _ensureBuffer(file) {
    if (!Buffer.isBuffer(file?.buffer) || file.buffer.length === 0) {
        const err = new Error('Порожній файл');
        err.statusCode = 400;
        throw err;
    }
}

function _resolveQuery(options = {}) {
    const queryLike = options.query || options.client || options.pool || null;
    if (queryLike && typeof queryLike.query === 'function') return queryLike;
    return null;
}

async function storeProfileAvatarBlob(query, file, options = {}) {
    if (!query || typeof query.query !== 'function') {
        throw new Error('Postgres query client is required for profile avatar blob storage');
    }
    const policy = validateProfileAvatarFile(file);
    _ensureBuffer(file);

    const username = String(options.username || options.userId || '').trim();
    if (!username) {
        throw new Error('username is required for profile avatar blob storage');
    }

    const storageKey = normalizeAvatarRequestPath(options.storageKey) || profileAvatarStorageKey(file, options);
    const originalName = safeFilename(file.originalname || `avatar.${policy.ext}`);
    const checksum = checksumSha256(file.buffer);
    const fileSize = Number(file.size || file.buffer.length || 0);

    await query.query(
        `INSERT INTO profile_avatar_blobs
            (username, storage_key, original_name, content_type, file_size, data, checksum_sha256)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (storage_key)
         DO UPDATE SET username = EXCLUDED.username,
                       original_name = EXCLUDED.original_name,
                       content_type = EXCLUDED.content_type,
                       file_size = EXCLUDED.file_size,
                       data = EXCLUDED.data,
                       checksum_sha256 = EXCLUDED.checksum_sha256,
                       updated_at = NOW()`,
        [username, storageKey, originalName, policy.contentType, fileSize, file.buffer, checksum]
    );

    return {
        provider: PROFILE_AVATAR_STORAGE_PROVIDER,
        bucket: PROFILE_AVATAR_STORAGE_BUCKET,
        key: storageKey,
        storageKey,
        filename: path.posix.basename(storageKey),
        publicUrl: publicProfileAvatarUrl(storageKey),
        contentType: policy.contentType,
        checksum,
        fileSize
    };
}

async function readProfileAvatarBlobByPath(query, requestPath) {
    if (!query || typeof query.query !== 'function') {
        throw new Error('Postgres query client is required for profile avatar blob reads');
    }
    const storageKey = normalizeAvatarRequestPath(requestPath);
    if (!storageKey) return null;

    const result = await query.query(
        `SELECT id, username, storage_key, original_name, content_type, file_size, data, checksum_sha256, created_at, updated_at
         FROM profile_avatar_blobs
         WHERE storage_key = $1
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`,
        [storageKey]
    );
    return result.rows[0] || null;
}

function buildProfileAvatarBlobFallbackHandler(query, logger = null) {
    return async (req, res, next) => {
        try {
            const requestPath = req.params?.[0] || req.params?.filename || '';
            const row = await readProfileAvatarBlobByPath(query, requestPath);
            if (!row?.data) return next();
            const data = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);
            const inlineName = safeFilename(row.original_name || path.posix.basename(row.storage_key || 'avatar'));
            res.setHeader('Content-Type', row.content_type || 'application/octet-stream');
            res.setHeader('Content-Length', String(Number(row.file_size || data.length || 0)));
            res.setHeader('Content-Disposition', `inline; filename="${inlineName}"`);
            res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400');
            return res.send(data);
        } catch (err) {
            if (logger && typeof logger.warn === 'function') {
                logger.warn(`Profile avatar Postgres upload fallback skipped: ${err.message}`);
            }
            return next();
        }
    };
}

async function saveProfileAvatarLocally(file, options = {}) {
    const policy = validateProfileAvatarFile(file);
    _ensureBuffer(file);

    const localDir = options.localDir || DEFAULT_LOCAL_DIR;
    await fsp.mkdir(localDir, { recursive: true });
    const userPart = _safePart(options.username || options.userId, 'user');
    const safeName = _safeOriginalName(file.originalname, policy.ext);
    const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${userPart}-${safeName}`;
    const fullPath = path.join(localDir, filename);
    await fsp.writeFile(fullPath, file.buffer);

    return {
        provider: 'local',
        bucket: null,
        key: filename,
        path: fullPath,
        publicUrl: `${PUBLIC_PREFIX}/${filename}`,
        filename,
        contentType: policy.contentType
    };
}

async function uploadProfileAvatarWithFallback(file, options = {}) {
    const query = _resolveQuery(options);
    if (query) return storeProfileAvatarBlob(query, file, options);
    return saveProfileAvatarLocally(file, options);
}

module.exports = {
    DEFAULT_LOCAL_DIR,
    MAX_AVATAR_BYTES,
    PROFILE_AVATAR_STORAGE_BUCKET,
    PROFILE_AVATAR_STORAGE_PROVIDER,
    PROFILE_AVATAR_TYPES,
    PUBLIC_PREFIX,
    buildProfileAvatarBlobFallbackHandler,
    checksumSha256,
    normalizeAvatarRequestPath,
    profileAvatarStorageKey,
    publicProfileAvatarUrl,
    readProfileAvatarBlobByPath,
    safeFilename,
    saveProfileAvatarLocally,
    storeProfileAvatarBlob,
    uploadProfileAvatarWithFallback,
    validateProfileAvatarFile
};
