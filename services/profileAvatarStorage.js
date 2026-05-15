/**
 * services/profileAvatarStorage.js - Durable profile avatar uploads.
 *
 * Profile photos prefer Supabase Storage and fall back to local uploads when
 * Supabase is not configured. SVG is intentionally blocked.
 */
const crypto = require('crypto');
const fsp = require('fs/promises');
const path = require('path');
const { getSupabase } = require('../db/supabase');
const { createLogger } = require('../utils/logger');

const log = createLogger('ProfileAvatarStorage');

const BUCKET = process.env.SUPABASE_PROFILE_AVATAR_BUCKET || 'profile-avatars';
const DEFAULT_LOCAL_DIR = path.join(__dirname, '..', 'uploads', 'profile-avatars');
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const PROFILE_AVATAR_TYPES = {
    jpg: { contentType: 'image/jpeg', mimes: ['image/jpeg'] },
    jpeg: { contentType: 'image/jpeg', mimes: ['image/jpeg'] },
    png: { contentType: 'image/png', mimes: ['image/png'] },
    webp: { contentType: 'image/webp', mimes: ['image/webp'] },
    gif: { contentType: 'image/gif', mimes: ['image/gif'] }
};

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

function _safeOriginalName(filename, ext) {
    const parsed = path.parse(filename || `avatar.${ext || 'png'}`);
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

function _storageKey(file, policy, options = {}) {
    const userPart = _safePart(options.username || options.userId, 'user');
    const safeName = _safeOriginalName(file.originalname, policy.ext);
    const unique = `${Date.now()}-${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(12).toString('hex')}`;
    return `users/${userPart}/${unique}-${safeName}`;
}

function _isMissingBucketError(error) {
    const msg = String(error?.message || '').toLowerCase();
    return error?.statusCode === 404 || msg.includes('not found') || msg.includes('bucket');
}

async function uploadProfileAvatarToSupabase(file, options = {}) {
    const policy = validateProfileAvatarFile(file);
    const supabase = getSupabase();
    if (!supabase) {
        log.warn('Supabase not configured - keeping profile avatar upload local');
        return null;
    }
    if (!file?.buffer || file.buffer.length === 0) {
        const err = new Error('Порожній файл');
        err.statusCode = 400;
        throw err;
    }

    const bucket = options.bucket || BUCKET;
    const key = _storageKey(file, policy, options);
    const uploadOptions = {
        contentType: policy.contentType,
        upsert: false
    };

    try {
        const { error } = await supabase.storage.from(bucket).upload(key, file.buffer, uploadOptions);
        if (error) {
            if (_isMissingBucketError(error)) {
                await supabase.storage.createBucket(bucket, { public: true });
                const retry = await supabase.storage.from(bucket).upload(key, file.buffer, uploadOptions);
                if (retry.error) {
                    log.warn(`Supabase profile avatar retry failed: ${retry.error.message}`);
                    return null;
                }
            } else {
                log.warn(`Supabase profile avatar upload failed: ${error.message}`);
                return null;
            }
        }

        const { data } = supabase.storage.from(bucket).getPublicUrl(key);
        const publicUrl = data?.publicUrl;
        if (!publicUrl) {
            log.warn('Supabase profile avatar upload returned no public URL');
            return null;
        }

        return {
            provider: 'supabase',
            bucket,
            key,
            path: key,
            publicUrl,
            filename: path.basename(key),
            contentType: policy.contentType
        };
    } catch (err) {
        log.warn(`Supabase profile avatar upload error: ${err.message}`);
        return null;
    }
}

async function saveProfileAvatarLocally(file, options = {}) {
    const policy = validateProfileAvatarFile(file);
    if (!file?.buffer || file.buffer.length === 0) {
        const err = new Error('Порожній файл');
        err.statusCode = 400;
        throw err;
    }

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
        publicUrl: `/uploads/profile-avatars/${filename}`,
        filename,
        contentType: policy.contentType
    };
}

async function uploadProfileAvatarWithFallback(file, options = {}) {
    const remote = await uploadProfileAvatarToSupabase(file, options);
    if (remote) return remote;
    return saveProfileAvatarLocally(file, options);
}

module.exports = {
    BUCKET,
    DEFAULT_LOCAL_DIR,
    MAX_AVATAR_BYTES,
    PROFILE_AVATAR_TYPES,
    validateProfileAvatarFile,
    uploadProfileAvatarToSupabase,
    saveProfileAvatarLocally,
    uploadProfileAvatarWithFallback
};
