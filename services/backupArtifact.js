'use strict';

const crypto = require('node:crypto');
const zlib = require('node:zlib');
const {
    BACKUP_MAX_ARTIFACT_BYTES,
    BACKUP_MAX_ENVELOPE_BYTES,
    BACKUP_MAX_PAYLOAD_BYTES
} = require('../config/backupRestorePolicy');

const RECOVERY_BUNDLE_FORMAT = 'eventgenix.backup';
const RECOVERY_BUNDLE_VERSION = 2;
const RECOVERY_ENVELOPE_FORMAT = 'eventgenix.backup.encrypted';
const RECOVERY_ENVELOPE_VERSION = 2;
const RECOVERY_PAYLOAD_ENCODING = 'gzip+base64';
const RECOVERY_ENVELOPE_ENCODING = 'base64';
const RECOVERY_ENVELOPE_CIPHER = 'aes-256-gcm';
const RECOVERY_ENVELOPE_KDF = 'scrypt';

const DEFAULT_MAX_OUTPUT_BYTES = BACKUP_MAX_PAYLOAD_BYTES;
const DEFAULT_MAX_ARTIFACT_BYTES = BACKUP_MAX_ARTIFACT_BYTES;
const DEFAULT_MAX_ENVELOPE_BYTES = BACKUP_MAX_ENVELOPE_BYTES;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const MIN_PASSPHRASE_BYTES = 16;
const SCRYPT_PARAMS = Object.freeze({
    N: 16384,
    r: 8,
    p: 1,
    keyLength: 32
});

const ARTIFACT_ERROR_CODES = Object.freeze({
    INVALID_INPUT: 'BACKUP_ARTIFACT_INVALID_INPUT',
    INVALID_JSON: 'BACKUP_ARTIFACT_INVALID_JSON',
    INVALID_STRUCTURE: 'BACKUP_ARTIFACT_INVALID_STRUCTURE',
    INVALID_FORMAT: 'BACKUP_ARTIFACT_INVALID_FORMAT',
    UNSUPPORTED_VERSION: 'BACKUP_ARTIFACT_UNSUPPORTED_VERSION',
    INVALID_BASE64: 'BACKUP_ARTIFACT_INVALID_BASE64',
    INVALID_PAYLOAD: 'BACKUP_ARTIFACT_INVALID_PAYLOAD',
    DECOMPRESSION_FAILED: 'BACKUP_ARTIFACT_DECOMPRESSION_FAILED',
    OUTPUT_LIMIT_EXCEEDED: 'BACKUP_ARTIFACT_OUTPUT_LIMIT_EXCEEDED',
    ARTIFACT_LIMIT_EXCEEDED: 'BACKUP_ARTIFACT_SIZE_LIMIT_EXCEEDED',
    ENVELOPE_LIMIT_EXCEEDED: 'BACKUP_ENVELOPE_SIZE_LIMIT_EXCEEDED',
    INTEGRITY_MISMATCH: 'BACKUP_ARTIFACT_INTEGRITY_MISMATCH',
    INVALID_PASSPHRASE: 'BACKUP_ARTIFACT_INVALID_PASSPHRASE',
    UNSUPPORTED_CIPHER: 'BACKUP_ARTIFACT_UNSUPPORTED_CIPHER',
    UNSUPPORTED_KDF: 'BACKUP_ARTIFACT_UNSUPPORTED_KDF',
    DECRYPTION_FAILED: 'BACKUP_ARTIFACT_DECRYPTION_FAILED'
});

class ArtifactValidationError extends Error {
    constructor(code, message, options = {}) {
        super(message, options);
        this.name = 'ArtifactValidationError';
        this.code = code;
    }
}

function validationError(code, message, cause) {
    return new ArtifactValidationError(code, message, cause ? { cause } : undefined);
}

function canonicalJson(value) {
    const ancestors = new Set();

    function serialize(current, path) {
        if (current === null) return 'null';

        switch (typeof current) {
        case 'string':
        case 'boolean':
            return JSON.stringify(current);
        case 'number':
            if (!Number.isFinite(current)) {
                throw validationError(
                    ARTIFACT_ERROR_CODES.INVALID_INPUT,
                    `Non-finite number is not valid JSON at ${path}`
                );
            }
            return JSON.stringify(current);
        case 'object':
            break;
        default:
            throw validationError(
                ARTIFACT_ERROR_CODES.INVALID_INPUT,
                `Unsupported JSON value at ${path}`
            );
        }

        if (ancestors.has(current)) {
            throw validationError(
                ARTIFACT_ERROR_CODES.INVALID_INPUT,
                `Circular JSON value at ${path}`
            );
        }
        ancestors.add(current);

        try {
            if (Array.isArray(current)) {
                const items = [];
                for (let index = 0; index < current.length; index++) {
                    if (!Object.prototype.hasOwnProperty.call(current, index)) {
                        throw validationError(
                            ARTIFACT_ERROR_CODES.INVALID_INPUT,
                            `Sparse arrays are not valid recovery JSON at ${path}[${index}]`
                        );
                    }
                    items.push(serialize(current[index], `${path}[${index}]`));
                }
                return `[${items.join(',')}]`;
            }

            const prototype = Object.getPrototypeOf(current);
            if (prototype !== Object.prototype && prototype !== null) {
                throw validationError(
                    ARTIFACT_ERROR_CODES.INVALID_INPUT,
                    `Only plain JSON objects are supported at ${path}`
                );
            }
            if (Object.getOwnPropertySymbols(current).length > 0) {
                throw validationError(
                    ARTIFACT_ERROR_CODES.INVALID_INPUT,
                    `Symbol keys are not valid JSON at ${path}`
                );
            }

            const keys = Object.keys(current).sort();
            const members = keys.map(key => {
                const descriptor = Object.getOwnPropertyDescriptor(current, key);
                if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
                    throw validationError(
                        ARTIFACT_ERROR_CODES.INVALID_INPUT,
                        `Accessor properties are not valid recovery JSON at ${path}.${key}`
                    );
                }
                return `${JSON.stringify(key)}:${serialize(descriptor.value, `${path}.${key}`)}`;
            });
            return `{${members.join(',')}}`;
        } finally {
            ancestors.delete(current);
        }
    }

    return serialize(value, '$');
}

function sha256Hex(input) {
    if (typeof input !== 'string' && !Buffer.isBuffer(input) && !ArrayBuffer.isView(input)) {
        throw validationError(
            ARTIFACT_ERROR_CODES.INVALID_INPUT,
            'SHA-256 input must be a string, Buffer, or typed array'
        );
    }
    return crypto.createHash('sha256').update(input).digest('hex');
}

function canonicalJsonHash(value) {
    return sha256Hex(canonicalJson(value));
}

function cloneCanonicalJson(value) {
    return JSON.parse(canonicalJson(value));
}

function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, label) {
    if (!isPlainObject(value)) {
        throw validationError(
            ARTIFACT_ERROR_CODES.INVALID_STRUCTURE,
            `${label} must be a plain object`
        );
    }
}

function assertExactKeys(value, expectedKeys, label) {
    const actualKeys = Object.keys(value).sort();
    const expected = [...expectedKeys].sort();
    if (actualKeys.length !== expected.length
        || actualKeys.some((key, index) => key !== expected[index])) {
        throw validationError(
            ARTIFACT_ERROR_CODES.INVALID_STRUCTURE,
            `${label} contains missing or unsupported fields`
        );
    }
}

function parseJsonInput(input, label) {
    if (isPlainObject(input)) return input;
    if (Buffer.isBuffer(input) || typeof input === 'string') {
        const text = Buffer.isBuffer(input) ? input.toString('utf8') : input;
        try {
            const parsed = JSON.parse(text);
            assertPlainObject(parsed, label);
            return parsed;
        } catch (error) {
            if (error instanceof ArtifactValidationError) throw error;
            throw validationError(
                ARTIFACT_ERROR_CODES.INVALID_JSON,
                `${label} is not valid JSON`,
                error
            );
        }
    }
    throw validationError(
        ARTIFACT_ERROR_CODES.INVALID_INPUT,
        `${label} must be an object, JSON string, or Buffer`
    );
}

function decodeStrictBase64(value, label, expectedBytes) {
    if (typeof value !== 'string'
        || value.length === 0
        || value.length % 4 !== 0
        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
        throw validationError(
            ARTIFACT_ERROR_CODES.INVALID_BASE64,
            `${label} must be canonical base64`
        );
    }
    const decoded = Buffer.from(value, 'base64');
    if (decoded.toString('base64') !== value) {
        throw validationError(
            ARTIFACT_ERROR_CODES.INVALID_BASE64,
            `${label} must be canonical base64`
        );
    }
    if (expectedBytes !== undefined && decoded.length !== expectedBytes) {
        throw validationError(
            ARTIFACT_ERROR_CODES.INVALID_STRUCTURE,
            `${label} must decode to ${expectedBytes} bytes`
        );
    }
    return decoded;
}

function validateMaxOutputBytes(maxOutputBytes) {
    if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0) {
        throw validationError(
            ARTIFACT_ERROR_CODES.INVALID_INPUT,
            'maxOutputBytes must be a positive safe integer'
        );
    }
    return maxOutputBytes;
}

function assertJsonByteLimit(value, maxBytes, code, label) {
    validateMaxOutputBytes(maxBytes);
    if (Buffer.byteLength(canonicalJson(value), 'utf8') > maxBytes) {
        throw validationError(code, `${label} exceeds its configured size limit`);
    }
}

function safeHashEqual(actual, expected) {
    if (typeof actual !== 'string' || typeof expected !== 'string'
        || !/^[a-f0-9]{64}$/.test(actual)
        || !/^[a-f0-9]{64}$/.test(expected)) {
        return false;
    }
    return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function createRecoveryBundle(input = {}) {
    assertPlainObject(input, 'Recovery bundle input');
    assertExactKeys(input, ['manifest', 'payload'], 'Recovery bundle input');
    const { manifest, payload } = input;
    assertPlainObject(manifest, 'Recovery manifest');
    const normalizedManifest = cloneCanonicalJson(manifest);
    const payloadJson = canonicalJson(payload);
    if (Buffer.byteLength(payloadJson, 'utf8') > DEFAULT_MAX_OUTPUT_BYTES) {
        throw validationError(
            ARTIFACT_ERROR_CODES.OUTPUT_LIMIT_EXCEEDED,
            'Recovery payload exceeds the configured output limit'
        );
    }
    const compressedPayload = zlib.gzipSync(Buffer.from(payloadJson, 'utf8'), {
        level: zlib.constants.Z_BEST_COMPRESSION
    });

    const artifact = {
        format: RECOVERY_BUNDLE_FORMAT,
        version: RECOVERY_BUNDLE_VERSION,
        encoding: RECOVERY_PAYLOAD_ENCODING,
        manifest: normalizedManifest,
        payload: compressedPayload.toString('base64'),
        integrity: {
            algorithm: 'sha256',
            manifestSha256: canonicalJsonHash(normalizedManifest),
            payloadSha256: sha256Hex(payloadJson)
        }
    };
    assertJsonByteLimit(
        artifact,
        DEFAULT_MAX_ARTIFACT_BYTES,
        ARTIFACT_ERROR_CODES.ARTIFACT_LIMIT_EXCEEDED,
        'Recovery artifact'
    );
    return artifact;
}

function parseRecoveryBundle(input, {
    maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
    maxArtifactBytes = DEFAULT_MAX_ARTIFACT_BYTES
} = {}) {
    const limit = validateMaxOutputBytes(maxOutputBytes);
    const artifact = parseJsonInput(input, 'Recovery bundle');
    assertJsonByteLimit(
        artifact,
        maxArtifactBytes,
        ARTIFACT_ERROR_CODES.ARTIFACT_LIMIT_EXCEEDED,
        'Recovery artifact'
    );

    assertExactKeys(
        artifact,
        ['format', 'version', 'encoding', 'manifest', 'payload', 'integrity'],
        'Recovery bundle'
    );
    if (artifact.format !== RECOVERY_BUNDLE_FORMAT) {
        throw validationError(
            ARTIFACT_ERROR_CODES.INVALID_FORMAT,
            'Unsupported recovery bundle format'
        );
    }
    if (artifact.version !== RECOVERY_BUNDLE_VERSION) {
        throw validationError(
            ARTIFACT_ERROR_CODES.UNSUPPORTED_VERSION,
            'Unsupported recovery bundle version'
        );
    }
    if (artifact.encoding !== RECOVERY_PAYLOAD_ENCODING) {
        throw validationError(
            ARTIFACT_ERROR_CODES.INVALID_STRUCTURE,
            'Unsupported recovery payload encoding'
        );
    }
    assertPlainObject(artifact.manifest, 'Recovery manifest');
    assertPlainObject(artifact.integrity, 'Recovery integrity metadata');
    assertExactKeys(
        artifact.integrity,
        ['algorithm', 'manifestSha256', 'payloadSha256'],
        'Recovery integrity metadata'
    );
    if (artifact.integrity.algorithm !== 'sha256') {
        throw validationError(
            ARTIFACT_ERROR_CODES.INVALID_STRUCTURE,
            'Unsupported recovery integrity algorithm'
        );
    }
    if (!safeHashEqual(canonicalJsonHash(artifact.manifest), artifact.integrity.manifestSha256)) {
        throw validationError(
            ARTIFACT_ERROR_CODES.INTEGRITY_MISMATCH,
            'Recovery manifest hash mismatch'
        );
    }

    const compressedPayload = decodeStrictBase64(artifact.payload, 'Recovery payload');
    let payloadBytes;
    try {
        payloadBytes = zlib.gunzipSync(compressedPayload, { maxOutputLength: limit });
    } catch (error) {
        if (error?.code === 'ERR_BUFFER_TOO_LARGE'
            || /maxOutputLength|larger than/i.test(String(error?.message || ''))) {
            throw validationError(
                ARTIFACT_ERROR_CODES.OUTPUT_LIMIT_EXCEEDED,
                'Recovery payload exceeds maxOutputBytes',
                error
            );
        }
        throw validationError(
            ARTIFACT_ERROR_CODES.DECOMPRESSION_FAILED,
            'Recovery payload could not be decompressed',
            error
        );
    }

    let payload;
    try {
        payload = JSON.parse(payloadBytes.toString('utf8'));
    } catch (error) {
        throw validationError(
            ARTIFACT_ERROR_CODES.INVALID_PAYLOAD,
            'Recovery payload is not valid JSON',
            error
        );
    }

    const canonicalPayload = canonicalJson(payload);
    if (!Buffer.from(canonicalPayload, 'utf8').equals(payloadBytes)) {
        throw validationError(
            ARTIFACT_ERROR_CODES.INVALID_PAYLOAD,
            'Recovery payload JSON is not canonical'
        );
    }
    if (!safeHashEqual(sha256Hex(payloadBytes), artifact.integrity.payloadSha256)) {
        throw validationError(
            ARTIFACT_ERROR_CODES.INTEGRITY_MISMATCH,
            'Recovery payload hash mismatch'
        );
    }

    return {
        manifest: cloneCanonicalJson(artifact.manifest),
        payload: cloneCanonicalJson(payload)
    };
}

function normalizePassphrase(passphrase) {
    const bytes = typeof passphrase === 'string'
        ? Buffer.from(passphrase, 'utf8')
        : (Buffer.isBuffer(passphrase) ? Buffer.from(passphrase) : null);
    if (bytes && bytes.length >= MIN_PASSPHRASE_BYTES) return bytes;
    if (bytes) bytes.fill(0);
    throw validationError(
        ARTIFACT_ERROR_CODES.INVALID_PASSPHRASE,
        `Recovery passphrase must contain at least ${MIN_PASSPHRASE_BYTES} bytes`
    );
}

function isValidRecoveryPassphrase(passphrase) {
    if (typeof passphrase !== 'string' && !Buffer.isBuffer(passphrase)) return false;
    return Buffer.byteLength(passphrase) >= MIN_PASSPHRASE_BYTES;
}

function envelopeAuthenticatedData() {
    return Buffer.from(canonicalJson({
        format: RECOVERY_ENVELOPE_FORMAT,
        version: RECOVERY_ENVELOPE_VERSION,
        cipher: RECOVERY_ENVELOPE_CIPHER,
        kdf: RECOVERY_ENVELOPE_KDF,
        kdfParams: SCRYPT_PARAMS,
        encoding: RECOVERY_ENVELOPE_ENCODING
    }), 'utf8');
}

function deriveEnvelopeKey(passphrase, salt) {
    return crypto.scryptSync(passphrase, salt, SCRYPT_PARAMS.keyLength, {
        N: SCRYPT_PARAMS.N,
        r: SCRYPT_PARAMS.r,
        p: SCRYPT_PARAMS.p,
        maxmem: 64 * 1024 * 1024
    });
}

function normalizeRecoveryBundle(input) {
    const parsed = parseRecoveryBundle(input);
    return createRecoveryBundle(parsed);
}

function encryptRecoveryBundle(artifact, passphrase) {
    const normalizedArtifact = normalizeRecoveryBundle(artifact);
    const plaintext = Buffer.from(canonicalJson(normalizedArtifact), 'utf8');
    const passphraseBytes = normalizePassphrase(passphrase);
    const salt = crypto.randomBytes(SALT_BYTES);
    const iv = crypto.randomBytes(IV_BYTES);
    let key;

    try {
        key = deriveEnvelopeKey(passphraseBytes, salt);
        const cipher = crypto.createCipheriv(RECOVERY_ENVELOPE_CIPHER, key, iv, {
            authTagLength: AUTH_TAG_BYTES
        });
        cipher.setAAD(envelopeAuthenticatedData());
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        const tag = cipher.getAuthTag();

        const envelope = {
            format: RECOVERY_ENVELOPE_FORMAT,
            version: RECOVERY_ENVELOPE_VERSION,
            cipher: RECOVERY_ENVELOPE_CIPHER,
            kdf: RECOVERY_ENVELOPE_KDF,
            kdfParams: { ...SCRYPT_PARAMS },
            encoding: RECOVERY_ENVELOPE_ENCODING,
            salt: salt.toString('base64'),
            iv: iv.toString('base64'),
            tag: tag.toString('base64'),
            ciphertext: ciphertext.toString('base64')
        };
        assertJsonByteLimit(
            envelope,
            DEFAULT_MAX_ENVELOPE_BYTES,
            ARTIFACT_ERROR_CODES.ENVELOPE_LIMIT_EXCEEDED,
            'Recovery envelope'
        );
        return envelope;
    } finally {
        passphraseBytes.fill(0);
        if (key) key.fill(0);
    }
}

function parseRecoveryEnvelope(input, {
    maxEnvelopeBytes = DEFAULT_MAX_ENVELOPE_BYTES
} = {}) {
    const envelope = parseJsonInput(input, 'Recovery envelope');
    assertJsonByteLimit(
        envelope,
        maxEnvelopeBytes,
        ARTIFACT_ERROR_CODES.ENVELOPE_LIMIT_EXCEEDED,
        'Recovery envelope'
    );
    assertExactKeys(
        envelope,
        [
            'format', 'version', 'cipher', 'kdf', 'kdfParams', 'encoding',
            'salt', 'iv', 'tag', 'ciphertext'
        ],
        'Recovery envelope'
    );
    if (envelope.format !== RECOVERY_ENVELOPE_FORMAT) {
        throw validationError(
            ARTIFACT_ERROR_CODES.INVALID_FORMAT,
            'Unsupported recovery envelope format'
        );
    }
    if (envelope.version !== RECOVERY_ENVELOPE_VERSION) {
        throw validationError(
            ARTIFACT_ERROR_CODES.UNSUPPORTED_VERSION,
            'Unsupported recovery envelope version'
        );
    }
    if (envelope.cipher !== RECOVERY_ENVELOPE_CIPHER) {
        throw validationError(
            ARTIFACT_ERROR_CODES.UNSUPPORTED_CIPHER,
            'Only AES-256-GCM recovery envelopes are supported'
        );
    }
    if (envelope.kdf !== RECOVERY_ENVELOPE_KDF) {
        throw validationError(
            ARTIFACT_ERROR_CODES.UNSUPPORTED_KDF,
            'Unsupported recovery envelope KDF'
        );
    }
    assertPlainObject(envelope.kdfParams, 'Recovery envelope KDF parameters');
    assertExactKeys(envelope.kdfParams, Object.keys(SCRYPT_PARAMS), 'Recovery envelope KDF parameters');
    if (Object.entries(SCRYPT_PARAMS).some(([key, value]) => envelope.kdfParams[key] !== value)) {
        throw validationError(
            ARTIFACT_ERROR_CODES.UNSUPPORTED_KDF,
            'Unsupported recovery envelope KDF parameters'
        );
    }
    if (envelope.encoding !== RECOVERY_ENVELOPE_ENCODING) {
        throw validationError(
            ARTIFACT_ERROR_CODES.INVALID_STRUCTURE,
            'Unsupported recovery envelope encoding'
        );
    }

    return {
        envelope,
        salt: decodeStrictBase64(envelope.salt, 'Recovery envelope salt', SALT_BYTES),
        iv: decodeStrictBase64(envelope.iv, 'Recovery envelope IV', IV_BYTES),
        tag: decodeStrictBase64(envelope.tag, 'Recovery envelope authentication tag', AUTH_TAG_BYTES),
        ciphertext: decodeStrictBase64(envelope.ciphertext, 'Recovery envelope ciphertext')
    };
}

function decryptRecoveryBundle(envelopeInput, passphrase, options = {}) {
    const { envelope, salt, iv, tag, ciphertext } = parseRecoveryEnvelope(envelopeInput, options);
    const passphraseBytes = normalizePassphrase(passphrase);
    let key;
    let plaintext;

    try {
        key = deriveEnvelopeKey(passphraseBytes, salt);
        const decipher = crypto.createDecipheriv(RECOVERY_ENVELOPE_CIPHER, key, iv, {
            authTagLength: AUTH_TAG_BYTES
        });
        decipher.setAAD(envelopeAuthenticatedData());
        decipher.setAuthTag(tag);
        plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch (error) {
        throw validationError(
            ARTIFACT_ERROR_CODES.DECRYPTION_FAILED,
            'Recovery envelope authentication failed',
            error
        );
    } finally {
        passphraseBytes.fill(0);
        if (key) key.fill(0);
    }

    const artifact = parseJsonInput(plaintext, 'Decrypted recovery bundle');
    parseRecoveryBundle(artifact, options);
    return cloneCanonicalJson(artifact);
}

module.exports = {
    RECOVERY_BUNDLE_FORMAT,
    RECOVERY_BUNDLE_VERSION,
    RECOVERY_ENVELOPE_FORMAT,
    RECOVERY_ENVELOPE_VERSION,
    RECOVERY_PAYLOAD_ENCODING,
    RECOVERY_ENVELOPE_CIPHER,
    DEFAULT_MAX_OUTPUT_BYTES,
    DEFAULT_MAX_ARTIFACT_BYTES,
    DEFAULT_MAX_ENVELOPE_BYTES,
    MIN_PASSPHRASE_BYTES,
    ARTIFACT_ERROR_CODES,
    ArtifactValidationError,
    canonicalJson,
    sha256Hex,
    canonicalJsonHash,
    createRecoveryBundle,
    parseRecoveryBundle,
    encryptRecoveryBundle,
    decryptRecoveryBundle,
    isValidRecoveryPassphrase
};
