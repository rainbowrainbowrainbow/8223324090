const { pool } = require('../db');
const { getKyivDateStr } = require('./booking');

function cleanMedicalBookText(value, limit = 2000) {
    if (value === null || value === undefined) return null;
    const normalized = String(value).replace(/\u0000/g, '').trim();
    return normalized ? normalized.slice(0, limit) : null;
}

function normalizeMedicalBookDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    const normalized = cleanMedicalBookText(value, 20);
    return normalized && /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function normalizeMedicalBookDocumentId(value) {
    if (value === null || value === undefined || value === '') return null;
    const id = Number(value);
    if (Number.isInteger(id) && id > 0) return id;
    const err = new Error('Некоректний документ медкнижки');
    err.statusCode = 400;
    err.code = 'medical_book_document_invalid';
    throw err;
}

function medicalBookStatusForExpiry(expiresAt, today = getKyivDateStr()) {
    return expiresAt && expiresAt < today ? 'expired' : 'active';
}

function medicalBookMeta(row) {
    if (!row) return null;
    const issuedAt = normalizeMedicalBookDate(row.issued_at);
    const expiresAt = normalizeMedicalBookDate(row.expires_at);
    return {
        ...row,
        issued_at: issuedAt,
        expires_at: expiresAt,
        status: row.status === 'revoked' ? 'revoked' : medicalBookStatusForExpiry(expiresAt)
    };
}

async function listStaffMedicalBooks(staffId, db = pool) {
    const result = await db.query(
        `SELECT sc.*, sd.title AS document_title
         FROM staff_certifications sc
         LEFT JOIN staff_documents sd ON sd.id = sc.document_id
         WHERE sc.staff_id = $1 AND sc.category = 'medical_book'
         ORDER BY
            CASE sc.status WHEN 'active' THEN 0 WHEN 'expired' THEN 1 ELSE 2 END,
            sc.expires_at DESC NULLS LAST,
            sc.created_at DESC,
            sc.id DESC`,
        [staffId]
    );
    return result.rows.map(medicalBookMeta);
}

async function loadStaffMedicalBook(staffId, certificationId, db = pool) {
    const result = await db.query(
        `SELECT sc.*, sd.title AS document_title
         FROM staff_certifications sc
         LEFT JOIN staff_documents sd ON sd.id = sc.document_id
         WHERE sc.id = $1 AND sc.staff_id = $2 AND sc.category = 'medical_book'`,
        [certificationId, staffId]
    );
    return medicalBookMeta(result.rows[0]);
}

async function requireOwnedMedicalBookDocument(staffId, documentId, db = pool) {
    if (documentId === null) return null;
    const result = await db.query(
        `SELECT id, staff_id, title, original_name, status
         FROM staff_documents
         WHERE id = $1 AND staff_id = $2`,
        [documentId, staffId]
    );
    const document = result.rows[0] || null;
    if (!document) {
        const err = new Error('Документ не знайдено в картці цього працівника');
        err.statusCode = 400;
        err.code = 'medical_book_document_mismatch';
        throw err;
    }
    return document;
}

async function findActiveMedicalBookDuplicate(staffId, issuedAt, expiresAt, excludeId = null, db = pool) {
    const result = await db.query(
        `SELECT id, staff_id, issued_at, expires_at, status, notes, document_id, created_at
         FROM staff_certifications
         WHERE staff_id = $1
           AND category = 'medical_book'
           AND status = 'active'
           AND issued_at IS NOT DISTINCT FROM $2::date
           AND expires_at IS NOT DISTINCT FROM $3::date
           AND ($4::bigint IS NULL OR id <> $4)
         ORDER BY id DESC
         LIMIT 1`,
        [staffId, issuedAt, expiresAt, excludeId]
    );
    return medicalBookMeta(result.rows[0]);
}

function assertMedicalBookDates(issuedAt, expiresAt) {
    if (issuedAt || expiresAt) return;
    const err = new Error('Вкажіть дату видачі або дату завершення медкнижки');
    err.statusCode = 400;
    err.code = 'medical_book_date_required';
    throw err;
}

async function assertNoActiveMedicalBookDuplicate(staffId, issuedAt, expiresAt, excludeId, status, db = pool) {
    if (status !== 'active') return null;
    const duplicate = await findActiveMedicalBookDuplicate(staffId, issuedAt, expiresAt, excludeId, db);
    if (!duplicate) return null;
    const err = new Error('Активна медкнижка з такими датами вже існує');
    err.statusCode = 409;
    err.code = 'medical_book_duplicate';
    err.duplicate = duplicate;
    throw err;
}

async function createStaffMedicalBook(staffId, payload = {}, actor = null, db = pool) {
    const issuedAt = normalizeMedicalBookDate(payload.issued_at ?? payload.issuedAt);
    const expiresAt = normalizeMedicalBookDate(payload.expires_at ?? payload.expiresAt);
    const notes = cleanMedicalBookText(payload.notes, 2000);
    const documentId = normalizeMedicalBookDocumentId(payload.document_id ?? payload.documentId);
    const businessContext = cleanMedicalBookText(payload.business_context ?? payload.businessContext, 64);
    assertMedicalBookDates(issuedAt, expiresAt);
    const document = await requireOwnedMedicalBookDocument(staffId, documentId, db);
    const status = medicalBookStatusForExpiry(expiresAt);
    await assertNoActiveMedicalBookDuplicate(staffId, issuedAt, expiresAt, null, status, db);

    const result = await db.query(
        `INSERT INTO staff_certifications
            (staff_id, name, category, issued_at, expires_at, status, notes, document_id, business_context)
         VALUES ($1, 'Медкнижка', 'medical_book', $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [staffId, issuedAt, expiresAt, status, notes, documentId, businessContext]
    );
    const row = medicalBookMeta({ ...result.rows[0], document_title: document?.title || null });
    return {
        data: row,
        auditEvent: 'medical_book_create',
        audit: {
            certification_id: row.id,
            issued_at: issuedAt,
            expires_at: expiresAt,
            status,
            document_id: documentId,
            created_by: actor
        }
    };
}

async function updateStaffMedicalBook(staffId, certificationId, payload = {}, actor = null, db = pool) {
    const current = await loadStaffMedicalBook(staffId, certificationId, db);
    if (!current) {
        const err = new Error('Медкнижку не знайдено в картці цього працівника');
        err.statusCode = 404;
        err.code = 'medical_book_not_found';
        throw err;
    }
    if (current.status === 'revoked') {
        const err = new Error('Відкликаний запис медкнижки не можна змінювати');
        err.statusCode = 409;
        err.code = 'medical_book_revoked';
        throw err;
    }

    const requestedStatus = cleanMedicalBookText(payload.status, 32);
    if (requestedStatus === 'revoked') {
        const result = await db.query(
            `UPDATE staff_certifications
             SET status = 'revoked'
             WHERE id = $1 AND staff_id = $2 AND category = 'medical_book' AND status <> 'revoked'
             RETURNING *`,
            [certificationId, staffId]
        );
        if (!result.rows[0]) {
            const err = new Error('Запис медкнижки вже змінено');
            err.statusCode = 409;
            err.code = 'medical_book_write_conflict';
            throw err;
        }
        const row = medicalBookMeta({ ...result.rows[0], document_title: current.document_title || null });
        return {
            data: row,
            auditEvent: 'medical_book_revoke',
            audit: {
                certification_id: row.id,
                previous_status: current.status,
                status: 'revoked',
                revoked_by: actor
            }
        };
    }

    const hasIssuedAt = Object.prototype.hasOwnProperty.call(payload, 'issued_at') || Object.prototype.hasOwnProperty.call(payload, 'issuedAt');
    const hasExpiresAt = Object.prototype.hasOwnProperty.call(payload, 'expires_at') || Object.prototype.hasOwnProperty.call(payload, 'expiresAt');
    const hasNotes = Object.prototype.hasOwnProperty.call(payload, 'notes');
    const hasDocumentId = Object.prototype.hasOwnProperty.call(payload, 'document_id') || Object.prototype.hasOwnProperty.call(payload, 'documentId');
    const issuedAt = hasIssuedAt ? normalizeMedicalBookDate(payload.issued_at ?? payload.issuedAt) : current.issued_at;
    const expiresAt = hasExpiresAt ? normalizeMedicalBookDate(payload.expires_at ?? payload.expiresAt) : current.expires_at;
    const notes = hasNotes ? cleanMedicalBookText(payload.notes, 2000) : current.notes;
    const documentId = hasDocumentId
        ? normalizeMedicalBookDocumentId(payload.document_id ?? payload.documentId)
        : normalizeMedicalBookDocumentId(current.document_id);
    assertMedicalBookDates(issuedAt, expiresAt);
    const document = await requireOwnedMedicalBookDocument(staffId, documentId, db);
    const status = medicalBookStatusForExpiry(expiresAt);
    await assertNoActiveMedicalBookDuplicate(staffId, issuedAt, expiresAt, certificationId, status, db);

    const result = await db.query(
        `UPDATE staff_certifications
         SET issued_at = $3, expires_at = $4, status = $5, notes = $6, document_id = $7
         WHERE id = $1 AND staff_id = $2 AND category = 'medical_book' AND status <> 'revoked'
         RETURNING *`,
        [certificationId, staffId, issuedAt, expiresAt, status, notes, documentId]
    );
    if (!result.rows[0]) {
        const err = new Error('Запис медкнижки вже змінено');
        err.statusCode = 409;
        err.code = 'medical_book_write_conflict';
        throw err;
    }
    const row = medicalBookMeta({ ...result.rows[0], document_title: document?.title || null });
    return {
        data: row,
        auditEvent: 'medical_book_update',
        audit: {
            certification_id: row.id,
            previous_issued_at: current.issued_at,
            previous_expires_at: current.expires_at,
            previous_status: current.status,
            issued_at: issuedAt,
            expires_at: expiresAt,
            status,
            document_id: documentId,
            updated_by: actor
        }
    };
}

module.exports = {
    createStaffMedicalBook,
    findActiveMedicalBookDuplicate,
    listStaffMedicalBooks,
    loadStaffMedicalBook,
    medicalBookStatusForExpiry,
    normalizeMedicalBookDate,
    updateStaffMedicalBook
};