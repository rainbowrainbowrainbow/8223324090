/**
 * services/profileAvatarStorage.js - Durable profile avatar uploads.
 *
 * Profile photos are stored under /uploads/profile-avatars and referenced from
 * Postgres profile rows. SVG is intentionally blocked.
 */
const crypto = require('crypto');
const fsp = require('fs/promises');
const path = require('path');

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
        const err = new Error('РџС–РґС‚СЂРёРјСѓСЋС‚СЊСЃСЏ С‚С–Р»СЊРєРё JPG, PNG, WebP Р°Р±Рѕ GIF');
        err.statusCode = 400;
        throw err;
    }

    const policy = PROFILE_AVATAR_TYPES[ext];
    if (!policy) {
        const err = new Error('РџС–РґС‚СЂРёРјСѓСЋС‚СЊСЃСЏ С‚С–Р»СЊРєРё JPG, PNG, WebP Р°Р±Рѕ GIF');
        err.statusCode = 400;
        throw err;
    }

    const size = Number(file?.size || file?.buffer?.length || 0);
    if (size > MAX_AVATAR_BYTES) {
        const err = new Error('Р¤РѕС‚Рѕ РїСЂРѕС„С–Р»СЋ РјР°С” Р±СѓС‚Рё РґРѕ 5 РњР‘');
        err.statusCode = 413;
        throw err;
    }

    const mimeType = _normalizeMime(file?.mimetype);
    if (mimeType && !policy.mimes.includes(mimeType)) {
        const err = new Error('РўРёРї С„Р°Р№Р»Сѓ РЅРµ Р·Р±С–РіР°С”С‚СЊСЃСЏ Р· СЂРѕР·С€РёСЂРµРЅРЅСЏРј');
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

async function saveProfileAvatarLocally(file, options = {}) {
    const policy = validateProfileAvatarFile(file);
    if (!file?.buffer || file.buffer.length === 0) {
        const err = new Error('РџРѕСЂРѕР¶РЅС–Р№ С„Р°Р№Р»');
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
    return saveProfileAvatarLocally(file, options);
}

module.exports = {
    DEFAULT_LOCAL_DIR,
    MAX_AVATAR_BYTES,
    PROFILE_AVATAR_TYPES,
    validateProfileAvatarFile,
    saveProfileAvatarLocally,
    uploadProfileAvatarWithFallback
};
