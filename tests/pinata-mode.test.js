const test = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizePinataFields,
    buildPinataServices,
    isClientPinataFiller
} = require('../services/pinataMode');

test('client pinata normalizes as service and clears park filler', () => {
    const result = normalizePinataFields({
        pinataMode: 'client',
        pinataFiller: '1M',
        pinataNumber: 'P-014',
        pinataFillerNumber: 'F-008',
        clientPinataServicePrice: '500',
        clientPinataServiceNote: 'client brings own pinata'
    });

    assert.equal(result.error, undefined);
    assert.equal(result.pinataMode, 'client');
    assert.equal(result.pinataNumber, 'P-014');
    assert.equal(result.pinataFillerNumber, 'F-008');
    assert.equal(result.pinataFiller, null);
    assert.equal(result.clientPinataServicePrice, 500);
    assert.equal(result.clientPinataServiceNote, 'client brings own pinata');
});

test('park pinata keeps filler and clears client service fields', () => {
    const result = normalizePinataFields({
        pinataMode: 'park',
        pinataFiller: '2XL',
        pinataNumber: 'P-021',
        pinataFillerNumber: 'F-002',
        clientPinataServicePrice: '300',
        clientPinataServiceNote: 'stale client note'
    });

    assert.equal(result.error, undefined);
    assert.equal(result.pinataMode, 'park');
    assert.equal(result.pinataNumber, 'P-021');
    assert.equal(result.pinataFillerNumber, 'F-002');
    assert.equal(result.pinataFiller, '2XL');
    assert.equal(result.clientPinataServicePrice, null);
    assert.equal(result.clientPinataServiceNote, null);
});

test('legacy exact client filler token infers client service', () => {
    assert.equal(isClientPinataFiller('Клієнта'), true);

    const result = normalizePinataFields({
        pinataFiller: 'Клієнта',
        category: 'pinata'
    });

    assert.equal(result.pinataMode, 'client');
    assert.equal(result.pinataFiller, null);
});

test('pinata_own product infers client service', () => {
    const result = normalizePinataFields({
        programId: 'pinata_own',
        category: 'custom',
        clientPinataServicePrice: 300
    });

    assert.equal(result.pinataMode, 'client');
    assert.equal(result.clientPinataServicePrice, 300);
});

test('none mode clears all pinata-specific fields', () => {
    const result = normalizePinataFields({
        pinataMode: 'none',
        pinataNumber: 'P-999',
        pinataFillerNumber: 'F-999',
        pinataFiller: '1L',
        clientPinataServicePrice: 200,
        clientPinataServiceNote: 'stale'
    });

    assert.equal(result.pinataMode, 'none');
    assert.equal(result.pinataNumber, null);
    assert.equal(result.pinataFillerNumber, null);
    assert.equal(result.pinataFiller, null);
    assert.equal(result.clientPinataServicePrice, null);
    assert.equal(result.clientPinataServiceNote, null);
});

test('negative client service price is rejected', () => {
    const result = normalizePinataFields({
        pinataMode: 'client',
        clientPinataServicePrice: -1
    });

    assert.match(result.error, /non-negative/);
});

test('service breakdown is emitted only for client pinata mode', () => {
    const client = buildPinataServices({
        pinataMode: 'client',
        clientPinataServicePrice: 450,
        clientPinataServiceNote: 'own pinata'
    });
    const park = buildPinataServices({ pinataMode: 'park', pinataFiller: '1M' });

    assert.deepEqual(client, [{
        type: 'client_pinata_service',
        label: 'Клієнтська піньята',
        price: 450,
        note: 'own pinata'
    }]);
    assert.deepEqual(park, []);
});
