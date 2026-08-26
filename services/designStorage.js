/**
 * services/designStorage.js - Postgres-backed design upload storage with legacy disk fallback.
 */
const crypto = require('crypto');

const PUBLIC_PREFIX = '/uploads/designs';
const DESIGN_STORAGE_PROVIDER = 'postgres';

function checksumSha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function safeFilename(filename) {
    const basename = String(filename || 'design-file').split(/[\\/]/).pop();
    return basename
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^\.+/, '')
        .replace(/^-|-$/g, '')
        .slice(0, 180) || 'design-file';
}

function designStorageKey(designId, filename) {
    const id = Number(designId);
    if (!Number.isInteger(id) || id <= 0) {
        throw new Error('Valid designId is required for design storage');
    }
    return `designs/${id}/${safeFilename(filename)}`;
}

function publicDesignUrl(filename) {
    return `${PUBLIC_PREFIX}/${encodeURIComponent(safeFilename(filename))}`;
}

async function storeDesignBlob(query, designId, storageKey, buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new Error('Non-empty design file buffer is required');
    }
    const checksum = checksumSha256(buffer);
    await query.query(
        `INSERT INTO design_file_blobs (design_id, storage_key, data, checksum_sha256)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (storage_key)
         DO UPDATE SET data = EXCLUDED.data,
                       checksum_sha256 = EXCLUDED.checksum_sha256,
                       updated_at = NOW()`,
        [designId, storageKey, buffer, checksum]
    );
    return { provider: DESIGN_STORAGE_PROVIDER, storageKey, checksum };
}

async function markDesignStored(query, designId, storageKey) {
    const result = await query.query(
        `UPDATE designs
         SET storage_provider = $2,
             storage_key = $3,
             storage_migrated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [designId, DESIGN_STORAGE_PROVIDER, storageKey]
    );
    return result.rows[0] || null;
}

async function readDesignBlob(query, design = {}) {
    const designId = Number(design.id);
    if (!Number.isInteger(designId) || designId <= 0) return null;

    const params = [designId];
    let storageCondition = '';
    if (design.storage_key) {
        params.push(design.storage_key);
        storageCondition = `AND storage_key = $${params.length}`;
    }

    const result = await query.query(
        `SELECT data, checksum_sha256, storage_key
         FROM design_file_blobs
         WHERE design_id = $1 ${storageCondition}
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`,
        params
    );
    return result.rows[0] || null;
}

async function readDesignBlobByFilename(query, filename) {
    const result = await query.query(
        `SELECT d.id, d.filename, d.original_name, d.mime_type, d.storage_key,
                b.data, b.checksum_sha256, b.storage_key AS blob_storage_key
         FROM designs d
         JOIN design_file_blobs b ON b.design_id = d.id
            AND (d.storage_key IS NULL OR b.storage_key = d.storage_key)
         WHERE d.filename = $1
         ORDER BY b.updated_at DESC, b.id DESC
         LIMIT 1`,
        [filename]
    );
    return result.rows[0] || null;
}

function buildDesignBlobFallbackHandler(query, logger = null) {
    return async (req, res, next) => {
        try {
            const row = await readDesignBlobByFilename(query, req.params?.filename);
            if (!row?.data) return next();
            const data = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);
            const inlineName = safeFilename(row.original_name || row.filename || 'design-file');
            res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
            res.setHeader('Content-Length', String(data.length));
            res.setHeader('Content-Disposition', `inline; filename="${inlineName}"`);
            res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400');
            return res.send(data);
        } catch (err) {
            if (logger && typeof logger.warn === 'function') {
                logger.warn(`Design Postgres upload fallback skipped: ${err.message}`);
            }
            return next();
        }
    };
}

async function deleteDesignBlob(query, designId) {
    await query.query('DELETE FROM design_file_blobs WHERE design_id = $1', [designId]);
}

module.exports = {
    DESIGN_STORAGE_PROVIDER,
    PUBLIC_PREFIX,
    buildDesignBlobFallbackHandler,
    checksumSha256,
    designStorageKey,
    deleteDesignBlob,
    markDesignStored,
    publicDesignUrl,
    readDesignBlob,
    readDesignBlobByFilename,
    safeFilename,
    storeDesignBlob
};
