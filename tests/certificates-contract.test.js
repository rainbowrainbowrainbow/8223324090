const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    mapCertificateRow,
    normalizeCertificateIdentity,
    certificateIdentityKey,
    validateCertificateInput
} = require('../services/certificates');

test('certificate row mapping exposes durable issue source metadata', () => {
    const mapped = mapCertificateRow({
        id: 7,
        cert_code: 'CERT-2099-00001',
        display_mode: 'fio',
        display_value: 'Тест',
        type_text: 'на одноразовий вхід',
        issued_at: '2099-01-01T10:30:00.000Z',
        valid_until: '2099-02-15',
        issued_by_user_id: 3,
        issued_by_name: 'Оператор',
        issue_source: 'batch',
        batch_group_id: 'cert_batch_example',
        status: 'active',
        season: 'winter'
    });

    assert.equal(mapped.issueSource, 'batch');
    assert.equal(mapped.batchGroupId, 'cert_batch_example');
    assert.equal(mapped.issuedByName, 'Оператор');
    assert.equal(mapped.issuedAt, '2099-01-01T10:30:00.000Z');
});

test('certificate row mapping defaults missing issue source to single', () => {
    const mapped = mapCertificateRow({
        id: 8,
        cert_code: 'CERT-2099-00002',
        display_mode: 'fio',
        display_value: '',
        type_text: 'на одноразовий вхід',
        status: 'active'
    });

    assert.equal(mapped.issueSource, 'single');
    assert.equal(mapped.batchGroupId, null);
});

test('certificate identity normalization trims values for uniqueness checks', () => {
    assert.equal(normalizeCertificateIdentity('  Марія Іваненко  '), 'Марія Іваненко');
    assert.equal(certificateIdentityKey('  DUPLICATE  '), 'duplicate');
});

test('single certificate validation requires fio recipient identity when enabled', () => {
    const errors = validateCertificateInput({ displayMode: 'fio', displayValue: '   ' }, { requireIdentity: true });
    assert.ok(errors.some(error => error.includes('ПІБ отримувача')), `Expected fio required error, got: ${errors.join(', ')}`);
});

test('single certificate validation requires number identity when enabled', () => {
    const errors = validateCertificateInput({ displayMode: 'number', displayValue: '' }, { requireIdentity: true });
    assert.ok(errors.some(error => error.includes('Номер або ідентифікатор')), `Expected number required error, got: ${errors.join(', ')}`);
});

test('batch/legacy certificate validation can still map placeholder identity when not required', () => {
    const errors = validateCertificateInput({ displayMode: 'fio', displayValue: '' });
    assert.deepEqual(errors, []);
});

test('animators can issue single and batch certificates without receiving lifecycle management access', () => {
    const routeCode = fs.readFileSync(path.join(__dirname, '..', 'routes', 'certificates.js'), 'utf8');

    assert.match(routeCode, /const CERTIFICATE_ISSUER_ROLES = \['admin', 'user', 'animator'\];/);
    assert.match(routeCode, /router\.post\('\/', requireRole\(\.\.\.CERTIFICATE_ISSUER_ROLES\)/);
    assert.match(routeCode, /router\.post\('\/batch', requireRole\(\.\.\.CERTIFICATE_ISSUER_ROLES\)/);
    assert.match(routeCode, /router\.patch\('\/:id\/status', requireRole\('admin', 'user'\)/);
    assert.match(routeCode, /router\.delete\('\/:id', requireRole\('admin', 'user'\)/);
});

test('certificate page requests use the shared refresh-safe auth wrapper', () => {
    const apiCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'api.js'), 'utf8');
    const pageCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'certificates-page.js'), 'utf8');
    const apiStart = apiCode.indexOf('// v8.4: Certificates API');
    const apiEnd = apiCode.indexOf('// v11.0: Kleshnya API', apiStart);
    const certificateApi = apiCode.slice(apiStart, apiEnd);

    assert.match(certificateApi, /apiFetchWithAuthRetry/);
    assert.doesNotMatch(certificateApi, /await fetch\(/);
    assert.doesNotMatch(certificateApi, /handleAuthError\(/);
    assert.match(pageCode, /apiFetchWithAuthRetry\(`\$\{API_BASE\}\/certificates\/\$\{encodeURIComponent\(id\)\}`/);
    assert.match(pageCode, /data-cert-load-retry/);
});
