'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const zlib = require('node:zlib');

const {
    RECOVERY_BUNDLE_FORMAT,
    RECOVERY_ENVELOPE_FORMAT,
    RECOVERY_ENVELOPE_CIPHER,
    ARTIFACT_ERROR_CODES,
    ArtifactValidationError,
    canonicalJson,
    canonicalJsonHash,
    createRecoveryBundle,
    parseRecoveryBundle,
    encryptRecoveryBundle,
    decryptRecoveryBundle,
    isValidRecoveryPassphrase,
    DEFAULT_MAX_ARTIFACT_BYTES,
    DEFAULT_MAX_ENVELOPE_BYTES,
    DEFAULT_MAX_OUTPUT_BYTES
} = require('../services/backupArtifact');

function assertArtifactError(fn, code) {
    assert.throws(fn, error => {
        assert.ok(error instanceof ArtifactValidationError);
        assert.equal(error.code, code);
        return true;
    });
}

function fixture() {
    return {
        manifest: {
            schemaVersion: '0.79.30',
            createdAt: '2026-07-15T10:00:00.000Z',
            tables: ['staff', 'staff_checkins']
        },
        payload: {
            tables: {
                staff_checkins: [{ id: 7, staff_id: 3, date: '2026-07-15' }],
                staff: [{ position: 'Animator', id: 3, name: 'Fictional Person' }]
            }
        }
    };
}

test('canonical JSON and hash are stable across object insertion order', () => {
    const first = { z: 1, nested: { b: true, a: 'value' }, a: [3, 2, 1] };
    const second = { a: [3, 2, 1], nested: { a: 'value', b: true }, z: 1 };

    assert.equal(
        canonicalJson(first),
        '{"a":[3,2,1],"nested":{"a":"value","b":true},"z":1}'
    );
    assert.equal(canonicalJson(first), canonicalJson(second));
    assert.equal(canonicalJsonHash(first), canonicalJsonHash(second));

    assertArtifactError(
        () => canonicalJson({ invalid: Number.POSITIVE_INFINITY }),
        ARTIFACT_ERROR_CODES.INVALID_INPUT
    );
    const circular = {};
    circular.self = circular;
    assertArtifactError(() => canonicalJson(circular), ARTIFACT_ERROR_CODES.INVALID_INPUT);
});

test('recovery bundle stores canonical gzip+base64 payload and round-trips clones', () => {
    const input = fixture();
    const artifact = createRecoveryBundle(input);

    assert.equal(RECOVERY_BUNDLE_FORMAT, 'eventgenix.backup');
    assert.equal(artifact.format, RECOVERY_BUNDLE_FORMAT);
    assert.equal(artifact.version, 2);
    assert.equal(artifact.encoding, 'gzip+base64');
    assert.match(artifact.payload, /^[A-Za-z0-9+/]+={0,2}$/);
    assert.equal(
        zlib.gunzipSync(Buffer.from(artifact.payload, 'base64')).toString('utf8'),
        canonicalJson(input.payload)
    );

    input.manifest.tables.push('mutated_after_create');
    input.payload.tables.staff[0].name = 'Mutated';
    const parsed = parseRecoveryBundle(artifact);
    assert.deepEqual(parsed, fixture());

    const parsedFromJson = parseRecoveryBundle(JSON.stringify(artifact));
    assert.deepEqual(parsedFromJson, fixture());
});

test('recovery bundle rejects tampering, invalid base64 and decompression bombs by stable code', () => {
    const artifact = createRecoveryBundle(fixture());
    const badHash = structuredClone(artifact);
    badHash.integrity.payloadSha256 = '0'.repeat(64);
    assertArtifactError(
        () => parseRecoveryBundle(badHash),
        ARTIFACT_ERROR_CODES.INTEGRITY_MISMATCH
    );

    const badBase64 = structuredClone(artifact);
    badBase64.payload = 'not base64';
    assertArtifactError(
        () => parseRecoveryBundle(badBase64),
        ARTIFACT_ERROR_CODES.INVALID_BASE64
    );

    assertArtifactError(
        () => parseRecoveryBundle(artifact, { maxOutputBytes: 8 }),
        ARTIFACT_ERROR_CODES.OUTPUT_LIMIT_EXCEEDED
    );
});

test('AES-256-GCM envelopes use fresh salt and IV and decrypt to the validated artifact', () => {
    const artifact = createRecoveryBundle(fixture());
    const first = encryptRecoveryBundle(artifact, 'correct horse battery staple');
    const second = encryptRecoveryBundle(artifact, 'correct horse battery staple');

    assert.equal(RECOVERY_ENVELOPE_FORMAT, 'eventgenix.backup.encrypted');
    assert.equal(first.format, RECOVERY_ENVELOPE_FORMAT);
    assert.equal(first.version, 2);
    assert.equal(first.cipher, RECOVERY_ENVELOPE_CIPHER);
    assert.notEqual(first.salt, second.salt);
    assert.notEqual(first.iv, second.iv);
    assert.notEqual(first.ciphertext, second.ciphertext);

    const decrypted = decryptRecoveryBundle(first, 'correct horse battery staple');
    assert.deepEqual(decrypted, artifact);
    assert.deepEqual(parseRecoveryBundle(decrypted), fixture());
    assert.deepEqual(
        decryptRecoveryBundle(JSON.stringify(first), 'correct horse battery staple'),
        artifact
    );
});

test('envelope authentication fails closed and legacy CBC metadata is never accepted', () => {
    const artifact = createRecoveryBundle(fixture());
    const envelope = encryptRecoveryBundle(artifact, 'primary passphrase');

    assertArtifactError(
        () => decryptRecoveryBundle(envelope, 'wrong passphrase'),
        ARTIFACT_ERROR_CODES.DECRYPTION_FAILED
    );

    const tampered = structuredClone(envelope);
    const bytes = Buffer.from(tampered.ciphertext, 'base64');
    bytes[0] ^= 0x01;
    tampered.ciphertext = bytes.toString('base64');
    assertArtifactError(
        () => decryptRecoveryBundle(tampered, 'primary passphrase'),
        ARTIFACT_ERROR_CODES.DECRYPTION_FAILED
    );

    const legacy = { ...envelope, cipher: 'aes-256-cbc' };
    assertArtifactError(
        () => decryptRecoveryBundle(legacy, 'primary passphrase'),
        ARTIFACT_ERROR_CODES.UNSUPPORTED_CIPHER
    );
});

test('bundle and envelope validators reject unknown fields and empty passphrases', () => {
    const artifact = createRecoveryBundle(fixture());
    assertArtifactError(
        () => parseRecoveryBundle({ ...artifact, unexpected: true }),
        ARTIFACT_ERROR_CODES.INVALID_STRUCTURE
    );
    assertArtifactError(
        () => encryptRecoveryBundle(artifact, ''),
        ARTIFACT_ERROR_CODES.INVALID_PASSPHRASE
    );
    assertArtifactError(
        () => encryptRecoveryBundle(artifact, 'too-short'),
        ARTIFACT_ERROR_CODES.INVALID_PASSPHRASE
    );
    assert.equal(isValidRecoveryPassphrase('too-short'), false);
    assert.equal(isValidRecoveryPassphrase('long-enough-test-key'), true);
    assert.ok(DEFAULT_MAX_OUTPUT_BYTES > DEFAULT_MAX_ARTIFACT_BYTES);
    assert.ok(DEFAULT_MAX_ENVELOPE_BYTES > DEFAULT_MAX_ARTIFACT_BYTES);
    assertArtifactError(
        () => parseRecoveryBundle(artifact, { maxArtifactBytes: 8 }),
        ARTIFACT_ERROR_CODES.ARTIFACT_LIMIT_EXCEEDED
    );
    const envelope = encryptRecoveryBundle(artifact, 'long-enough-test-key');
    assertArtifactError(
        () => decryptRecoveryBundle(envelope, 'long-enough-test-key', { maxEnvelopeBytes: 8 }),
        ARTIFACT_ERROR_CODES.ENVELOPE_LIMIT_EXCEEDED
    );
});
