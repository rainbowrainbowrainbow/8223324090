/**
 * services/chatUploadStorage.js - Durable chat upload storage on the CRM upload surface.
 *
 * New chat uploads are stored in Postgres chat_upload_blobs while keeping the
 * public URL under /uploads/chat. Legacy local files remain readable through
 * the server fallback path. Remote object storage is intentionally not used.
 */
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const DEFAULT_LOCAL_DIR = path.join(__dirname, '..', 'uploads', 'chat');
const PUBLIC_PREFIX = '/uploads/chat';
const CHAT_UPLOAD_STORAGE_PROVIDER = 'postgres';
const CHAT_UPLOAD_STORAGE_BUCKET = 'chat_upload_blobs';
const MAX_CHAT_UPLOAD_BYTES = 10 * 1024 * 1024;

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

function safeFilename(filename) {
    const basename = String(filename || 'chat-upload').split(/[\\/]/).pop();
    return basename
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^\.+/, '')
        .replace(/^-|-$/g, '')
        .slice(0, 180) || 'chat-upload';
}

function _safeChannelPart(channelId) {
    return String(channelId || 'unknown').replace(/[^a-zA-Z0-9_-]+/g, '-');
}

function _makeStorageKey(file, policy, channelId) {
    const safeName = _safeOriginalName(file.originalname, policy.ext);
    const unique = `${Date.now()}-${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(12).toString('hex')}`;
    return `channels/${_safeChannelPart(channelId)}/${unique}-${safeName}`;
}

function checksumSha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function _ensureBuffer(file) {
    if (!Buffer.isBuffer(file?.buffer) || file.buffer.length === 0) {
        const err = new Error('Empty upload');
        err.statusCode = 400;
        throw err;
    }
}

function _ensureSize(file) {
    const size = Number(file?.size || file?.buffer?.length || 0);
    if (size > MAX_CHAT_UPLOAD_BYTES) {
        const err = new Error('File too large');
        err.statusCode = 413;
        throw err;
    }
    return size;
}

function normalizeChatUploadRequestPath(requestPath) {
    let normalized = String(requestPath || '')
        .split('?')[0]
        .split('#')[0]
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .replace(/\/{2,}/g, '/')
        .trim();
    if (!normalized) return '';
    if (normalized.startsWith('uploads/chat/')) {
        normalized = normalized.slice('uploads/chat/'.length);
    }
    if (normalized.startsWith('chat/')) {
        normalized = normalized.slice('chat/'.length);
    }
    try {
        normalized = decodeURIComponent(normalized);
    } catch {
        return '';
    }
    normalized = normalized.replace(/^\/+/, '').replace(/\/{2,}/g, '/').trim();
    if (!normalized || normalized.includes('..') || normalized.includes('\\')) return '';
    return normalized;
}

function publicChatUploadUrl(storageKey) {
    const normalized = normalizeChatUploadRequestPath(storageKey);
    if (!normalized) return PUBLIC_PREFIX;
    return `${PUBLIC_PREFIX}/${normalized.split('/').map(encodeURIComponent).join('/')}`;
}

function prepareChatUploadBlob(file, options = {}) {
    const policy = validateChatUploadFile(file);
    _ensureBuffer(file);
    const fileSize = _ensureSize(file);
    const storageKey = normalizeChatUploadRequestPath(options.storageKey) || _makeStorageKey(file, policy, options.channelId);
    return {
        provider: CHAT_UPLOAD_STORAGE_PROVIDER,
        bucket: CHAT_UPLOAD_STORAGE_BUCKET,
        key: storageKey,
        storageKey,
        path: storageKey,
        publicUrl: publicChatUploadUrl(storageKey),
        filename: path.posix.basename(storageKey),
        originalName: safeFilename(file.originalname || `upload.${policy.ext}`),
        contentType: policy.contentType,
        kind: policy.kind,
        fileSize,
        checksum: checksumSha256(file.buffer)
    };
}

async function storeChatUploadBlob(query, file, descriptor = {}, options = {}) {
    if (!query || typeof query.query !== 'function') {
        throw new Error('Postgres query client is required for chat upload blob storage');
    }
    const prepared = {
        ...prepareChatUploadBlob(file, options),
        ...descriptor
    };
    const channelId = Number(options.channelId || prepared.channelId);
    if (!Number.isInteger(channelId) || channelId <= 0) {
        throw new Error('Valid channelId is required for chat upload blob storage');
    }
    const messageId = options.messageId ? Number(options.messageId) : null;
    const createdByUserId = options.userId ? Number(options.userId) : null;
    await query.query(
        `INSERT INTO chat_upload_blobs
            (channel_id, message_id, storage_key, original_name, content_type, file_size, data, checksum_sha256, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (storage_key)
         DO UPDATE SET channel_id = EXCLUDED.channel_id,
                       message_id = EXCLUDED.message_id,
                       original_name = EXCLUDED.original_name,
                       content_type = EXCLUDED.content_type,
                       file_size = EXCLUDED.file_size,
                       data = EXCLUDED.data,
                       checksum_sha256 = EXCLUDED.checksum_sha256,
                       created_by_user_id = EXCLUDED.created_by_user_id,
                       updated_at = NOW()`,
        [
            channelId,
            messageId,
            prepared.storageKey || prepared.key,
            prepared.originalName || safeFilename(file.originalname),
            prepared.contentType,
            prepared.fileSize || Number(file.size || file.buffer.length),
            file.buffer,
            prepared.checksum || checksumSha256(file.buffer),
            Number.isInteger(createdByUserId) && createdByUserId > 0 ? createdByUserId : null
        ]
    );
    return prepared;
}

async function readChatUploadBlobByPath(query, requestPath) {
    if (!query || typeof query.query !== 'function') {
        throw new Error('Postgres query client is required for chat upload blob reads');
    }
    const storageKey = normalizeChatUploadRequestPath(requestPath);
    if (!storageKey) return null;
    const result = await query.query(
        `SELECT id, channel_id, message_id, storage_key, original_name, content_type, file_size, data, checksum_sha256, created_at, updated_at
         FROM chat_upload_blobs
         WHERE storage_key = $1
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`,
        [storageKey]
    );
    return result.rows[0] || null;
}

function buildChatUploadBlobFallbackHandler(query, logger = null) {
    return async (req, res, next) => {
        try {
            const requestPath = req.params?.[0] || req.params?.filename || '';
            const row = await readChatUploadBlobByPath(query, requestPath);
            if (!row?.data) return next();
            const data = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);
            const inlineName = safeFilename(row.original_name || path.posix.basename(row.storage_key || 'chat-upload'));
            res.setHeader('Content-Type', row.content_type || 'application/octet-stream');
            res.setHeader('Content-Length', String(Number(row.file_size || data.length || 0)));
            res.setHeader('Content-Disposition', `inline; filename="${inlineName}"`);
            res.setHeader('Cache-Control', 'private, max-age=300, stale-while-revalidate=86400');
            return res.send(data);
        } catch (err) {
            if (logger && typeof logger.warn === 'function') {
                logger.warn(`Chat Postgres upload fallback skipped: ${err.message}`);
            }
            return next();
        }
    };
}

async function saveChatFileLocally(file, options = {}) {
    const policy = validateChatUploadFile(file);
    _ensureBuffer(file);
    _ensureSize(file);

    const localDir = options.localDir || DEFAULT_LOCAL_DIR;
    const storageKey = _makeStorageKey(file, policy, options.channelId);
    const fullPath = path.join(localDir, storageKey);
    await fsp.mkdir(path.dirname(fullPath), { recursive: true });
    await fsp.writeFile(fullPath, file.buffer);

    return {
        provider: 'local',
        bucket: null,
        key: storageKey,
        path: fullPath,
        publicUrl: publicChatUploadUrl(storageKey),
        filename: path.basename(storageKey),
        contentType: policy.contentType,
        kind: policy.kind
    };
}

async function uploadChatFileWithFallback(file, options = {}) {
    const query = options.query || options.client || options.pool || null;
    if (query && typeof query.query === 'function') {
        return storeChatUploadBlob(query, file, options.storage || {}, options);
    }
    return saveChatFileLocally(file, options);
}

async function removeChatUploadObject(storageKey, options = {}) {
    if (!storageKey) return false;
    const query = options.query || options.client || options.pool || null;
    if (query && typeof query.query === 'function') {
        const normalized = normalizeChatUploadRequestPath(storageKey);
        if (!normalized) return false;
        const result = await query.query('DELETE FROM chat_upload_blobs WHERE storage_key = $1', [normalized]);
        return result.rowCount > 0;
    }

    try {
        const normalized = normalizeChatUploadRequestPath(storageKey);
        if (!normalized) return false;
        const fullPath = path.resolve(DEFAULT_LOCAL_DIR, normalized);
        if (!fullPath.startsWith(path.resolve(DEFAULT_LOCAL_DIR))) return false;
        if (!fs.existsSync(fullPath)) return false;
        await fsp.unlink(fullPath);
        return true;
    } catch (err) {
        return false;
    }
}

function removeLegacyLocalChatFile(fileUrl, localDir = DEFAULT_LOCAL_DIR) {
    if (!fileUrl || !String(fileUrl).startsWith('/uploads/chat/')) return false;
    const relative = decodeURIComponent(String(fileUrl).replace(/^\/uploads\/chat\/?/, ''));
    const fullPath = path.resolve(localDir, relative);
    if (!fullPath.startsWith(path.resolve(localDir))) return false;
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
    CHAT_UPLOAD_STORAGE_BUCKET,
    CHAT_UPLOAD_STORAGE_PROVIDER,
    DEFAULT_LOCAL_DIR,
    MAX_CHAT_UPLOAD_BYTES,
    PUBLIC_PREFIX,
    buildChatUploadBlobFallbackHandler,
    checksumSha256,
    normalizeChatUploadRequestPath,
    prepareChatUploadBlob,
    publicChatUploadUrl,
    readChatUploadBlobByPath,
    validateChatUploadFile,
    uploadChatFileWithFallback,
    saveChatFileLocally,
    safeFilename,
    storeChatUploadBlob,
    removeChatUploadObject,
    removeLegacyLocalChatFile
};
