const test = require('node:test');
const assert = require('node:assert/strict');
const { mapCertificateRow } = require('../services/certificates');

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
