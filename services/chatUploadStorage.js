/**
 * services/chatUploadStorage.js - Durable chat upload storage.
 *
 * New uploads prefer Supabase Storage and fall back to legacy local files when
 * Supabase is not configured or temporarily unavailable.
 */
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { getSupabase } = require('../db/supabase');
const { createLogger } = require('../utils/logger');

const log = createLogger('ChatUploadStorage');

const BUCKET = process.env.SUPABASE_CHAT_BUCKET || 'chat-uploads';
const DEFAULT_LOCAL_DIR = path.join(__dirname, '..', 'uploads', 'chat');

const CHAT_UPLOAD_TYPES = {
    jpg: { kind: 'image', contentType: 'image/jpeg', mimes: ['image/jpeg'] },
    jpeg: { kind: 'image', contentType: 'image/jpeg', mimes: ['image/jpeg'] },
    png: { kind: 'image', contentType: 'image/png', mimes: ['image/png'] },
    gif: { kind: 'image', contentType: 'image/gif', mimes: ['image/gif'] },
    webp: { kind: 'image', contentType: 'image/webp', mimes: ['image/webp'] },
    pdf: { kind: 'file', contentType: 'application/pdf', mimes: ['application/pdf'] },
    doc: { kind: 'file', contentType: 'application/msword', mimes: ['application/msword', 'application/octet-stream'] },
    docx: {
        kind: 'file',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', 'application/octet-stream']
    },
    xls: { kind: 'file', contentType: 'application/vnd.ms-excel', mimes: ['application/vnd.ms-excel', 'application/octet-stream'] },
    xlsx: {
        kind: 'file',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip', 'application/octet-stream']
    },
    txt: { kind: 'file', contentType: 'text/plain', mimes: ['text/plain', 'application/octet-stream'] },
    zip: { kind: 'file', contentType: 'application/zip', mimes: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'] },
    mp3: { kind: 'voice', contentType: 'audio/mpeg', mimes: ['audio/mpeg', 'audio/mp3', 'application/octet-stream'] },
    mp4: { kind: 'file', contentType: 'video/mp4', mimes: ['video/mp4', 'audio/mp4', 'application/mp4', 'application/octet-stream'] },
    ogg: { kind: 'voice', contentType: 'audio/ogg', mimes: ['audio/ogg', 'video/ogg', 'application/ogg', 'application/octet-stream'] },
    wav: { kind: 'voice', contentType: 'audio/wav', mimes: ['audio/wav', 'audio/x-wav', 'application/octet-stream'] },
    webm: { kind: 'voice', contentType: 'audio/webm', mimes: ['audio/webm', 'video/webm', 'application/octet-stream'] },
    m4a: { kind: 'voice', contentType: 'audio/mp4', mimes: ['audio/mp4', 'audio/x-m4a', 'application/octet-stream'] }
};

function _normalizeMime(mimeType) {
    return String(mimeType || '').split(';')[0].trim().toLowerCase();
}

function _extensionOf(filename) {
    return path.extname(filename || '').slice(1).toLowerCase();
}

function validateChatUploadFile(file) {
    const ext = _extensionOf(file?.originalname);
    if (!ext || ext === 'svg') {
        const err = new Error('Unsupported file type');
        err.statusCode = 400;
        throw err;
    }

    const policy = CHAT_UPLOAD_TYPES[ext];
    if (!policy) {
        const err = new Error('Unsupported file type');
        err.statusCode = 400;
        throw err;
    }

    const mimeType = _normalizeMime(file?.mimetype);
    if (mimeType && !policy.mimes.includes(mimeType)) {
        const err = new Error('File extension and MIME type do not match');
        err.statusCode = 400;
        throw err;
    }

    return {
        ext,
        kind: policy.kind,
        contentType: mimeType && policy.mimes.includes(mimeType) ? mimeType : policy.contentType
    };
}

function _safeOriginalName(filename, ext) {
    const parsed = path.parse(filename || `upload.${ext || 'bin'}`);
    const base = (parsed.name || 'upload')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) || 'upload';
    return `${base}.${ext}`;
}

function _safeChannelPart(channelId) {
    return String(channelId || 'unknown').replace(/[^a-zA-Z0-9_-]+/g, '-');
}

function _makeStorageKey(file, policy, channelId) {
    const safeName = _safeOriginalName(file.originalname, policy.ext);
    const unique = `${Date.now()}-${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(12).toString('hex')}`;
    return `channels/${_safeChannelPart(channelId)}/${unique}-${safeName}`;
}

function _isMissingBucketError(error) {
    const msg = String(error?.message || '').toLowerCase();
    return error?.statusCode === 404 || msg.includes('not found') || msg.includes('bucket');
}

async function uploadChatFileToSupabase(file, options = {}) {
    const policy = validateChatUploadFile(file);
    const supabase = getSupabase();
    if (!supabase) {
        log.warn('Supabase not configured - keeping chat upload local');
        return null;
    }
    if (!file?.buffer || file.buffer.length === 0) {
        const err = new Error('Empty upload');
        err.statusCode = 400;
        throw err;
    }

    const bucket = options.bucket || BUCKET;
    const storageKey = _makeStorageKey(file, policy, options.channelId);
    const uploadOptions = {
        contentType: policy.contentType,
        upsert: false
    };

    try {
        const { error } = await supabase.storage.from(bucket).upload(storageKey, file.buffer, uploadOptions);
        if (error) {
            if (_isMissingBucketError(error)) {
                await supabase.storage.createBucket(bucket, { public: true });
                const retry = await supabase.storage.from(bucket).upload(storageKey, file.buffer, uploadOptions);
                if (retry.error) {
                    log.warn(`Supabase chat upload retry failed: ${retry.error.message}`);
                    return null;
                }
            } else {
                log.warn(`Supabase chat upload failed: ${error.message}`);
                return null;
            }
        }

        const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(storageKey);
        const publicUrl = urlData?.publicUrl;
        if (!publicUrl) {
            log.warn('Supabase chat upload returned no public URL');
            return null;
        }

        return {
            provider: 'supabase',
            bucket,
            key: storageKey,
            path: storageKey,
            publicUrl,
            filename: path.basename(storageKey),
            contentType: policy.contentType,
            kind: policy.kind
        };
    } catch (err) {
        log.warn(`Supabase chat upload error: ${err.message}`);
        return null;
    }
}

async function saveChatFileLocally(file, options = {}) {
    const policy = validateChatUploadFile(file);
    if (!file?.buffer || file.buffer.length === 0) {
        const err = new Error('Empty upload');
        err.statusCode = 400;
        throw err;
    }

    const localDir = options.localDir || DEFAULT_LOCAL_DIR;
    await fsp.mkdir(localDir, { recursive: true });
    const safeName = _safeOriginalName(file.originalname, policy.ext);
    const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeName}`;
    const fullPath = path.join(localDir, filename);
    await fsp.writeFile(fullPath, file.buffer);

    return {
        provider: 'local',
        bucket: null,
        key: filename,
        path: fullPath,
        publicUrl: `/uploads/chat/${filename}`,
        filename,
        contentType: policy.contentType,
        kind: policy.kind
    };
}

async function uploadChatFileWithFallback(file, options = {}) {
    const remote = await uploadChatFileToSupabase(file, options);
    if (remote) return remote;
    return saveChatFileLocally(file, options);
}

async function removeChatUploadObject(storageKey, bucket = BUCKET) {
    if (!storageKey) return false;
    const supabase = getSupabase();
    if (!supabase) return false;

    try {
        const { error } = await supabase.storage.from(bucket || BUCKET).remove([storageKey]);
        if (error) {
            log.warn(`Supabase chat upload delete failed for ${storageKey}: ${error.message}`);
            return false;
        }
        return true;
    } catch (err) {
        log.warn(`Supabase chat upload delete error for ${storageKey}: ${err.message}`);
        return false;
    }
}

function removeLegacyLocalChatFile(fileUrl, localDir = DEFAULT_LOCAL_DIR) {
    if (!fileUrl || !String(fileUrl).startsWith('/uploads/chat/')) return false;
    const filename = path.basename(String(fileUrl));
    const fullPath = path.join(localDir, filename);
    try {
        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
            return true;
        }
    } catch {
        return false;
    }
    return false;
}

module.exports = {
    CHAT_UPLOAD_TYPES,
    BUCKET,
    validateChatUploadFile,
    uploadChatFileToSupabase,
    uploadChatFileWithFallback,
    saveChatFileLocally,
    removeChatUploadObject,
    removeLegacyLocalChatFile
};
