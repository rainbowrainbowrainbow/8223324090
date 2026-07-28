const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { pool } = require('../db');

const STAFF_DOCUMENT_UPLOAD_LIMIT_BYTES = 10 * 1024 * 1024;
const STAFF_DOCUMENT_TYPES = new Set(['passport', 'tax_id', 'contract', 'medical_book', 'certificate', 'training', 'other']);
const STAFF_DOCUMENT_STATUSES = new Set(['active', 'archived', 'expired', 'revoked']);
const STAFF_DOCUMENT_ALLOWED_EXTENSIONS = new Set([
    '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt'
]);
const STAFF_DOCUMENT_ALLOWED_MIME_TYPES = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'text/plain',
    'application/octet-stream'
]);
const STAFF_DOCUMENT_PREVIEW_MIME_BY_EXTENSION = new Map([
    ['.pdf', 'application/pdf'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.png', 'image/png'],
    ['.webp', 'image/webp']
]);

function cleanStaffDocumentText(value, limit = 1000) {
    if (value === null || value === undefined) return null;
    const normalized = String(value).replace(/\u0000/g, '').trim();
    return normalized ? normalized.slice(0, limit) : null;
}

function cleanStaffDocumentDate(value) {
    const normalized = cleanStaffDocumentText(value, 20);
    return normalized && /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function staffDocumentFileExt(file) {
    return path.extname(file?.originalname || '').toLowerCase();
}

function validateStaffDocumentUploadFile(file) {
    const ext = staffDocumentFileExt(file);
    const mime = String(file?.mimetype || '').toLowerCase();
    if (!STAFF_DOCUMENT_ALLOWED_EXTENSIONS.has(ext)) {
        const err = new Error('Непідтримуваний формат HR-документа');
        err.statusCode = 400;
        throw err;
    }
    if (mime && !mime.startsWith('text/') && !STAFF_DOCUMENT_ALLOWED_MIME_TYPES.has(mime)) {
        const err = new Error('Непідтримуваний MIME-тип HR-документа');
        err.statusCode = 400;
        throw err;
    }
}

const staffDocumentUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: STAFF_DOCUMENT_UPLOAD_LIMIT_BYTES,
        files: 1
    },
    fileFilter: (req, file, cb) => {
        try {
            validateStaffDocumentUploadFile(file);
            cb(null, true);
        } catch (err) {
            cb(err);
        }
    }
});

function handleStaffDocumentUpload(req, res, next) {
    staffDocumentUpload.single('document')(req, res, (err) => {
        if (!err) return next();
        const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : (err.statusCode || 400);
        const error = err.code === 'LIMIT_FILE_SIZE'
            ? 'HR-документ завеликий. Максимум 10 МБ'
            : (err.message || 'Не вдалося завантажити HR-документ');
        res.status(status).json({ success: false, error });
    });
}

function normalizeStaffDocumentType(value) {
    const type = cleanStaffDocumentText(value, 64) || 'other';
    return STAFF_DOCUMENT_TYPES.has(type) ? type : 'other';
}

function normalizeStaffDocumentStatus(value) {
    const status = cleanStaffDocumentText(value, 32) || 'active';
    return STAFF_DOCUMENT_STATUSES.has(status) ? status : 'active';
}

function safeStaffDocumentDownloadFilename(value, fallback = 'staff-document') {
    const raw = cleanStaffDocumentText(value, 180) || fallback;
    return raw.replace(/[\r\n"\\]/g, '_');
}

function staffDocumentPreviewMimeType(document = {}) {
    const ext = String(document.file_ext || path.extname(document.original_name || '')).toLowerCase();
    const expectedMime = STAFF_DOCUMENT_PREVIEW_MIME_BY_EXTENSION.get(ext) || null;
    const actualMime = String(document.mime_type || '').toLowerCase();
    return expectedMime && actualMime === expectedMime ? expectedMime : null;
}

function isStaffDocumentPreviewable(document = {}) {
    return Boolean(staffDocumentPreviewMimeType(document));
}

function staffDocumentMeta(row) {
    if (!row) return null;
    return {
        id: row.id,
        staff_id: row.staff_id,
        document_type: row.document_type,
        title: row.title,
        original_name: row.original_name,
        mime_type: row.mime_type,
        file_ext: row.file_ext,
        file_size: row.file_size,
        file_sha256: row.file_sha256,
        issued_at: row.issued_at,
        expires_at: row.expires_at,
        status: row.status,
        notes: row.notes,
        uploaded_by: row.uploaded_by,
        archived_at: row.archived_at,
        archived_by: row.archived_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
        download_url: `/api/hr/staff/${row.staff_id}/documents/${row.id}/download`,
        preview_url: isStaffDocumentPreviewable(row)
            ? `/api/hr/staff/${row.staff_id}/documents/${row.id}/preview`
            : null
    };
}

async function listStaffDocuments(staffId, options = {}, db = pool) {
    let sql = `SELECT id, staff_id, document_type, title, original_name, mime_type, file_ext, file_size,
                      file_sha256, issued_at, expires_at, status, notes, uploaded_by,
                      archived_at, archived_by, created_at, updated_at
               FROM staff_documents
               WHERE staff_id = $1`;
    if (options.includeArchived !== true) sql += ` AND status = 'active'`;
    sql += ` ORDER BY expires_at ASC NULLS LAST, created_at DESC, id DESC`;
    const result = await db.query(sql, [staffId]);
    return result.rows.map(staffDocumentMeta);
}

async function createStaffDocument(staffId, file, body = {}, uploadedBy = null, db = pool) {
    if (!file?.buffer?.length) {
        const err = new Error('Файл обовʼязковий');
        err.statusCode = 400;
        throw err;
    }

    const documentType = normalizeStaffDocumentType(body.document_type || body.documentType);
    const originalName = cleanStaffDocumentText(file.originalname, 255) || 'document';
    const title = cleanStaffDocumentText(body.title, 160) || path.basename(originalName, staffDocumentFileExt(file)) || 'HR-документ';
    const mimeType = cleanStaffDocumentText(file.mimetype, 120) || 'application/octet-stream';
    const fileExt = staffDocumentFileExt(file).slice(0, 16) || null;
    const fileSha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
    const issuedAt = cleanStaffDocumentDate(body.issued_at || body.issuedAt);
    const expiresAt = cleanStaffDocumentDate(body.expires_at || body.expiresAt);
    const notes = cleanStaffDocumentText(body.notes, 2000);

    const result = await db.query(
        `INSERT INTO staff_documents
            (staff_id, document_type, title, original_name, mime_type, file_ext, file_size,
             file_sha256, file_data, issued_at, expires_at, notes, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING id, staff_id, document_type, title, original_name, mime_type, file_ext, file_size,
                   file_sha256, issued_at, expires_at, status, notes, uploaded_by,
                   archived_at, archived_by, created_at, updated_at`,
        [
            staffId,
            documentType,
            title,
            originalName,
            mimeType,
            fileExt,
            file.size,
            fileSha256,
            file.buffer,
            issuedAt,
            expiresAt,
            notes,
            uploadedBy
        ]
    );
    const row = result.rows[0];
    return {
        row,
        data: staffDocumentMeta(row),
        audit: {
            document_id: row.id,
            document_type: documentType,
            title,
            original_name: originalName,
            file_size: file.size
        }
    };
}

async function loadStaffDocumentDownload(staffId, documentId, db = pool) {
    const result = await db.query(
        `SELECT id, staff_id, original_name, mime_type, file_ext, file_size, file_data
         FROM staff_documents
         WHERE id = $1 AND staff_id = $2`,
        [documentId, staffId]
    );
    return result.rows[0] || null;
}

async function archiveStaffDocument(staffId, documentId, archivedBy = null, db = pool) {
    const result = await db.query(
        `UPDATE staff_documents
         SET status = 'archived', archived_at = NOW(), archived_by = $3, updated_at = NOW()
         WHERE id = $1 AND staff_id = $2
         RETURNING id, staff_id, document_type, title, original_name, mime_type, file_ext, file_size,
                   file_sha256, issued_at, expires_at, status, notes, uploaded_by,
                   archived_at, archived_by, created_at, updated_at`,
        [documentId, staffId, archivedBy]
    );
    const row = result.rows[0] || null;
    return row ? {
        row,
        data: staffDocumentMeta(row),
        audit: {
            document_id: row.id,
            title: row.title
        }
    } : null;
}

async function restoreStaffDocument(staffId, documentId, restoredBy = null, db = pool) {
    const result = await db.query(
        `UPDATE staff_documents
         SET status = 'active', archived_at = NULL, archived_by = NULL, updated_at = NOW()
         WHERE id = $1 AND staff_id = $2 AND status = 'archived'
         RETURNING id, staff_id, document_type, title, original_name, mime_type, file_ext, file_size,
                   file_sha256, issued_at, expires_at, status, notes, uploaded_by,
                   archived_at, archived_by, created_at, updated_at`,
        [documentId, staffId]
    );
    const row = result.rows[0] || null;
    return row ? {
        row,
        data: staffDocumentMeta(row),
        audit: {
            document_id: row.id,
            title: row.title,
            restored_by: restoredBy
        }
    } : null;
}

module.exports = {
    archiveStaffDocument,
    createStaffDocument,
    handleStaffDocumentUpload,
    isStaffDocumentPreviewable,
    listStaffDocuments,
    loadStaffDocumentDownload,
    normalizeStaffDocumentStatus,
    normalizeStaffDocumentType,
    restoreStaffDocument,
    safeStaffDocumentDownloadFilename,
    staffDocumentPreviewMimeType,
    staffDocumentMeta,
    validateStaffDocumentUploadFile
};
