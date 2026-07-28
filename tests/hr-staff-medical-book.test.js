const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    createStaffMedicalBook,
    listStaffMedicalBooks,
    medicalBookStatusForExpiry,
    updateStaffMedicalBook
} = require('../services/hrStaffMedicalBook');

const HR_ROUTE = fs.readFileSync(path.join(__dirname, '..', 'routes', 'hr.js'), 'utf8');

function createFakeMedicalBookDb() {
    let nextId = 100;
    const documents = [
        { id: 7, staff_id: 42, title: 'Medical scan', original_name: 'medical.pdf', status: 'active' },
        { id: 8, staff_id: 99, title: 'Other staff scan', original_name: 'other.pdf', status: 'active' }
    ];
    const certifications = [];
    const queries = [];

    return {
        certifications,
        queries,
        async query(sql, params = []) {
            queries.push({ sql, params: [...params] });
            if (/FROM staff_documents/i.test(sql)) {
                const [documentId, staffId] = params.map(Number);
                const row = documents.find(item => item.id === documentId && item.staff_id === staffId);
                return { rows: row ? [{ ...row }] : [] };
            }
            if (/FROM staff_certifications sc/i.test(sql) && /WHERE sc\.id = \$1/i.test(sql)) {
                const [certificationId, staffId] = params.map(Number);
                const row = certifications.find(item => item.id === certificationId
                    && item.staff_id === staffId
                    && item.category === 'medical_book');
                const document = row ? documents.find(item => item.id === row.document_id) : null;
                return { rows: row ? [{ ...row, document_title: document?.title || null }] : [] };
            }
            if (/status = 'active'/i.test(sql) && /IS NOT DISTINCT FROM/i.test(sql)) {
                const [staffId, issuedAt, expiresAt, excludeId] = params;
                const row = certifications.find(item => item.staff_id === Number(staffId)
                    && item.category === 'medical_book'
                    && item.status === 'active'
                    && item.issued_at === issuedAt
                    && item.expires_at === expiresAt
                    && (!excludeId || item.id !== Number(excludeId)));
                return { rows: row ? [{ ...row }] : [] };
            }
            if (/INSERT INTO staff_certifications/i.test(sql)) {
                const [staffId, issuedAt, expiresAt, status, notes, documentId, businessContext] = params;
                const row = {
                    id: nextId++,
                    staff_id: Number(staffId),
                    name: 'Медкнижка',
                    category: 'medical_book',
                    issued_at: issuedAt,
                    expires_at: expiresAt,
                    status,
                    notes,
                    document_id: documentId,
                    business_context: businessContext,
                    created_at: '2026-07-28T10:00:00.000Z'
                };
                certifications.push(row);
                return { rows: [{ ...row }] };
            }
            if (/UPDATE staff_certifications/i.test(sql) && /SET status = 'revoked'/i.test(sql)) {
                const [certificationId, staffId] = params.map(Number);
                const row = certifications.find(item => item.id === certificationId
                    && item.staff_id === staffId
                    && item.category === 'medical_book'
                    && item.status !== 'revoked');
                if (!row) return { rows: [] };
                row.status = 'revoked';
                return { rows: [{ ...row }] };
            }
            if (/UPDATE staff_certifications/i.test(sql)) {
                const [certificationId, staffId, issuedAt, expiresAt, status, notes, documentId] = params;
                const row = certifications.find(item => item.id === Number(certificationId)
                    && item.staff_id === Number(staffId)
                    && item.category === 'medical_book'
                    && item.status !== 'revoked');
                if (!row) return { rows: [] };
                Object.assign(row, { issued_at: issuedAt, expires_at: expiresAt, status, notes, document_id: documentId });
                return { rows: [{ ...row }] };
            }
            if (/FROM staff_certifications sc/i.test(sql)) {
                const staffId = Number(params[0]);
                return {
                    rows: certifications
                        .filter(item => item.staff_id === staffId && item.category === 'medical_book')
                        .map(item => ({
                            ...item,
                            document_title: documents.find(document => document.id === item.document_id)?.title || null
                        }))
                };
            }
            throw new Error(`Unexpected query: ${sql}`);
        }
    };
}

test('medical-book routes keep create and patch mutations behind manage_staff', () => {
    assert.match(HR_ROUTE, /router\.get\('\/staff\/:id\/medical-book', requireHrManage/);
    assert.match(HR_ROUTE, /router\.post\('\/staff\/:id\/medical-book', requireHrManage/);
    assert.match(HR_ROUTE, /router\.patch\('\/staff\/:id\/medical-book\/:certificationId', requireHrManage/);
    assert.match(HR_ROUTE, /createStaffMedicalBook/);
    assert.match(HR_ROUTE, /updateStaffMedicalBook/);
});

test('medical-book create links only an owned document and emits a create audit contract', async () => {
    const db = createFakeMedicalBookDb();
    const created = await createStaffMedicalBook(42, {
        issued_at: '2026-07-01',
        expires_at: '2027-07-01',
        document_id: 7,
        notes: 'Initial record'
    }, 'qa-hr', db);

    assert.equal(created.data.status, 'active');
    assert.equal(created.data.document_title, 'Medical scan');
    assert.equal(created.auditEvent, 'medical_book_create');
    assert.equal(created.audit.created_by, 'qa-hr');
    assert.equal(db.certifications.length, 1);

    await assert.rejects(
        createStaffMedicalBook(42, {
            issued_at: '2026-08-01',
            expires_at: '2027-08-01',
            document_id: 8
        }, 'qa-hr', db),
        error => error.statusCode === 400 && error.code === 'medical_book_document_mismatch'
    );
    assert.equal(db.certifications.length, 1, 'foreign staff document is rejected before insert');
});

test('medical-book duplicate guard blocks a second active record with identical dates', async () => {
    const db = createFakeMedicalBookDb();
    await createStaffMedicalBook(42, {
        issued_at: '2026-07-01',
        expires_at: '2027-07-01'
    }, 'qa-hr', db);

    await assert.rejects(
        createStaffMedicalBook(42, {
            issued_at: '2026-07-01',
            expires_at: '2027-07-01'
        }, 'qa-hr', db),
        error => error.statusCode === 409
            && error.code === 'medical_book_duplicate'
            && error.duplicate?.id === 100
    );
    assert.equal(db.certifications.length, 1);
});

test('medical-book update verifies certification ownership and edits instead of inserting', async () => {
    const db = createFakeMedicalBookDb();
    const created = await createStaffMedicalBook(42, {
        issued_at: '2026-07-01',
        expires_at: '2027-07-01',
        notes: 'Before'
    }, 'qa-hr', db);

    const updated = await updateStaffMedicalBook(42, created.data.id, {
        issued_at: '2026-07-02',
        expires_at: '2027-07-02',
        document_id: 7,
        notes: 'After'
    }, 'qa-hr', db);

    assert.equal(updated.data.notes, 'After');
    assert.equal(updated.data.document_id, 7);
    assert.equal(updated.auditEvent, 'medical_book_update');
    assert.equal(updated.audit.previous_issued_at, '2026-07-01');
    assert.equal(db.certifications.length, 1, 'patch updates the existing row');
    await assert.rejects(
        updateStaffMedicalBook(99, created.data.id, { notes: 'Wrong owner' }, 'qa-hr', db),
        error => error.statusCode === 404 && error.code === 'medical_book_not_found'
    );
});

test('medical-book revoke preserves the row and emits a dedicated audit contract', async () => {
    const db = createFakeMedicalBookDb();
    const created = await createStaffMedicalBook(42, {
        issued_at: '2026-07-01',
        expires_at: '2027-07-01'
    }, 'qa-hr', db);
    const revoked = await updateStaffMedicalBook(42, created.data.id, { status: 'revoked' }, 'qa-hr', db);

    assert.equal(revoked.data.status, 'revoked');
    assert.equal(revoked.auditEvent, 'medical_book_revoke');
    assert.equal(revoked.audit.revoked_by, 'qa-hr');
    assert.equal(db.certifications.length, 1);
    assert.equal((await listStaffMedicalBooks(42, db))[0].status, 'revoked');
    await assert.rejects(
        updateStaffMedicalBook(42, created.data.id, { notes: 'Cannot edit' }, 'qa-hr', db),
        error => error.statusCode === 409 && error.code === 'medical_book_revoked'
    );
});

test('medical-book status derives expired state from the Kyiv business date', () => {
    assert.equal(medicalBookStatusForExpiry('2026-07-27', '2026-07-28'), 'expired');
    assert.equal(medicalBookStatusForExpiry('2026-07-28', '2026-07-28'), 'active');
    assert.equal(medicalBookStatusForExpiry(null, '2026-07-28'), 'active');
});
