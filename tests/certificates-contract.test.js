const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PAGE_PERMISSION_BY_KEY } = require('../config/permissionRegistry');
const { resolveCapability } = require('../services/accountAccessPolicy');
const {
    mapCertificateRow,
    normalizeCertificateIdentity,
    certificateIdentityKey,
    validateCertificateInput,
    buildCertificateCheckUrl,
    getCertificateEffectiveStatus
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

test('new certificate QR payload opens the authenticated CRM check route', () => {
    const checkUrl = buildCertificateCheckUrl('https://crm.example.test/some-path', ' cert-2099-00007 ');
    const parsed = new URL(checkUrl);

    assert.equal(parsed.origin, 'https://crm.example.test');
    assert.equal(parsed.pathname, '/certificates/check');
    assert.equal(parsed.searchParams.get('code'), 'CERT-2099-00007');
});

test('certificate remains valid through its Kyiv expiry date', () => {
    const cert = { status: 'active', valid_until: '2026-09-23' };
    assert.equal(getCertificateEffectiveStatus(cert, new Date('2026-09-23T20:59:59Z')), 'active');
    assert.equal(getCertificateEffectiveStatus(cert, new Date('2026-09-23T21:00:00Z')), 'expired');
    assert.equal(getCertificateEffectiveStatus({ ...cert, status: 'used' }, new Date('2026-09-23T21:00:00Z')), 'used');
});

test('certificate date handling preserves PostgreSQL dates across winter and DST boundaries', () => {
    for (const [day, lastInstant, nextDay] of [
        ['2026-01-15', '2026-01-15T21:59:59Z', '2026-01-15T22:00:00Z'],
        ['2026-03-29', '2026-03-29T20:59:59Z', '2026-03-29T21:00:00Z'],
        ['2026-10-25', '2026-10-25T21:59:59Z', '2026-10-25T22:00:00Z']
    ]) {
        const [year, month, date] = day.split('-').map(Number);
        const cert = { status: 'active', valid_until: new Date(year, month - 1, date) };
        assert.equal(mapCertificateRow(cert).validUntil, day);
        assert.equal(getCertificateEffectiveStatus(cert, new Date(lastInstant)), 'active');
        assert.equal(getCertificateEffectiveStatus(cert, new Date(nextDay)), 'expired');
    }
});

test('mobile certificate check grants only the designated Park operational roles', () => {
    const entry = PAGE_PERMISSION_BY_KEY['/certificates/check'];
    const allowedRoles = ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'admin', 'security', 'reception', 'animator'];

    assert.deepEqual(entry.defaultRoles, allowedRoles);
    assert.equal(entry.explicitAllow, false);
    for (const role of allowedRoles) {
        assert.equal(resolveCapability({ role }, '/certificates/check', { type: 'page' }).allowed, true, `${role} must be allowed`);
    }
    for (const role of ['dishwasher', 'cleaning', 'maintenance', 'barista', 'wardrobe', 'cook', 'instructor']) {
        assert.equal(resolveCapability({ role }, '/certificates/check', { type: 'page' }).allowed, false, `${role} must be denied`);
    }
    assert.equal(resolveCapability({ role: 'dishwasher', page_allowlist: ['/certificates/check'] }, '/certificates/check', { type: 'page' }).allowed, false);
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

test('mobile certificate check separates lookup from confirmed canonical redemption', () => {
    const pageCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'certificates-page.js'), 'utf8');
    const apiCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'api.js'), 'utf8');
    const routeCode = fs.readFileSync(path.join(__dirname, '..', 'routes', 'certificates.js'), 'utf8');

    assert.match(pageCode, /path\.endsWith\('\/check'\)/);
    assert.match(pageCode, /getKyivDateKey/);
    assert.match(pageCode, /CHECK_STATE_META/);
    assert.match(apiCode, /async function apiLookupCertificateByCode/);
    assert.match(routeCode, /buildCertificateCheckUrl/);
    assert.match(routeCode, /function requireCertificateCheckAccess/);
    assert.match(routeCode, /router\.get\('\/code\/:code', requireCertificateCheckAccess/);
    assert.match(pageCode, /data-cert-redeem/);
    assert.match(pageCode, /await confirmCertificateAction/);
    assert.match(routeCode, /router\.post\('\/:id\/redeem'/);
});
