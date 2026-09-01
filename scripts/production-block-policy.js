'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const SCHEMA_VERSION = 1;
const MAX_VALIDITY_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 3;
const TARGET = Object.freeze({
    branch: 'codex/eventgenix-production',
    railwayProjectId: 'bc28b46c-d4bc-491c-893a-d8401c633668',
    railwayEnvironment: 'production',
    railwayServiceId: '8223324090',
    liveUrl: 'https://8223324090-production.up.railway.app'
});
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const BLOCK_ID_PATTERN = /^EG-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$/;
const SENSITIVE_KEY = /(secret|token|password|database.?url|authorization|cookie)/i;
const RED_PATH_PATTERNS = Object.freeze([
    /^\.github\/workflows\//,
    /(^|\/)railway(?:\.json|\.toml|\/)/i,
    /(^|\/)(?:\.env|secrets?)(?:\.|$)/i,
    /^config\/timelineProtectedSurface\.js$/,
    /^middleware\/auth\.js$/,
    /^routes\/(?:auth|payments?|payroll|finance)\.js$/
]);

class ProductionBlockError extends Error {
    constructor(message, code = 'PRODUCTION_BLOCK_FAILED', details = {}) {
        super(message);
        this.name = 'ProductionBlockError';
        this.code = code;
        this.details = details;
    }
}

function fail(condition, message, code, details = {}) {
    if (!condition) throw new ProductionBlockError(message, code, details);
}

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function stableJson(value) {
    return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function hashValue(value) {
    return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function hashableManifest(manifest) {
    const { manifestHash, runtimeState, ...signed } = manifest || {};
    return signed;
}

function manifestHash(manifest) {
    return hashValue(hashableManifest(manifest));
}

function sanitize(value, key = '') {
    if (SENSITIVE_KEY.test(key)) return '[redacted]';
    if (Array.isArray(value)) return value.map(item => sanitize(item));
    if (value && typeof value === 'object') {
        if (value instanceof Date) return value.toISOString();
        return Object.fromEntries(Object.entries(value).map(([nextKey, nextValue]) => [nextKey, sanitize(nextValue, nextKey)]));
    }
    if (typeof value === 'string') {
        return value
            .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
            .replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted-database-url]');
    }
    return value;
}

function migrationNumber(file) {
    const match = path.basename(file).match(/^(\d{3})_/);
    return match ? Number(match[1]) : null;
}

function migrationHeader(sql, name) {
    const match = String(sql || '').match(new RegExp(`^\\s*--\\s*${name}:\\s*(.+)$`, 'im'));
    return match ? match[1].trim() : '';
}

function classifyMigration(file, sql) {
    const headerKind = migrationHeader(sql, 'MIGRATION_KIND').toLowerCase();
    const normalized = String(sql || '')
        .replace(/--.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .toLowerCase();
    const destructive = /\b(drop|truncate|delete\s+from)\b/.test(normalized)
        || /\balter\s+table\b[\s\S]*?\bdrop\b/.test(normalized);
    const dataMutation = /\b(insert\s+into|update\s+|delete\s+from|merge\s+into)\b/.test(normalized);
    const schemaMutation = /\b(create|alter|drop)\s+(table|index|type|function|trigger|view|extension)\b/.test(normalized);
    let kind = headerKind || (schemaMutation && dataMutation ? 'mixed' : schemaMutation ? 'schema' : dataMutation ? 'data-fix' : 'unknown');
    if (destructive) kind = 'cleanup';
    const safety = migrationHeader(sql, 'SAFETY');
    const rollback = migrationHeader(sql, 'ROLLBACK');
    const dataScope = migrationHeader(sql, 'DATA_SCOPE');
    const sensitiveDataScope = /\b(customer|client|booking|staff|employee|finance|payroll|payment|auth|session|role|permission)\b/i.test(dataScope);
    const incompleteDataFix = kind === 'data-fix' && (!safety || !rollback || !dataScope);
    const redReason = kind === 'cleanup'
        ? 'cleanup/destructive migration'
        : (kind === 'mixed'
            ? 'mixed schema/data migration'
            : (kind === 'unknown'
                ? 'unknown migration classification'
                : (sensitiveDataScope
                    ? 'real or protected data scope'
                    : (incompleteDataFix ? 'data-fix migration lacks SAFETY, ROLLBACK, or DATA_SCOPE evidence' : ''))));
    return {
        file: file.replaceAll('\\', '/'),
        number: migrationNumber(file),
        kind,
        safety,
        rollback,
        dataScope: dataScope || null,
        destructive,
        red: Boolean(redReason),
        redReason: redReason || null
    };
}

function redChangedPaths(paths = []) {
    return paths.map(file => file.replaceAll('\\', '/')).filter(file => RED_PATH_PATTERNS.some(pattern => pattern.test(file)));
}

function validateQaScope(scope) {
    const value = scope || { enabled: false };
    fail(value && typeof value === 'object' && !Array.isArray(value),
        'QA scope must be an object', 'PRODUCTION_BLOCK_QA_SCOPE_INVALID');
    if (value.enabled !== true) {
        fail(value.enabled === false && Object.keys(value).length === 1,
            'Disabled QA scope may not contain executable options', 'PRODUCTION_BLOCK_QA_SCOPE_INVALID');
        return value;
    }
    const allowedKeys = new Set(['enabled', 'kind', 'date', 'ttlMinutes', 'animators', 'fixtureLimit']);
    fail(Object.keys(value).every(key => allowedKeys.has(key)),
        'QA scope contains unsupported options', 'PRODUCTION_BLOCK_QA_SCOPE_INVALID');
    fail(['timeline', 'canary'].includes(value.kind),
        'QA kind must be timeline or canary', 'PRODUCTION_BLOCK_QA_SCOPE_INVALID');
    fail(/^\d{4}-\d{2}-\d{2}$/.test(String(value.date || '')),
        'QA scope requires an exact YYYY-MM-DD date', 'PRODUCTION_BLOCK_QA_SCOPE_INVALID');
    fail(Number.isInteger(value.ttlMinutes) && value.ttlMinutes >= 5 && value.ttlMinutes <= 240,
        'QA TTL must be 5-240 minutes', 'PRODUCTION_BLOCK_QA_SCOPE_INVALID');
    fail(/^[1-5](?:,[1-5]){0,4}$/.test(String(value.animators || ''))
        && new Set(String(value.animators).split(',')).size === String(value.animators).split(',').length,
    'QA animators must be a unique comma-separated subset of 1-5', 'PRODUCTION_BLOCK_QA_SCOPE_INVALID');
    if (value.kind === 'canary') fail(value.fixtureLimit === 1,
        'Canary QA scope must be limited to exactly one fixture', 'PRODUCTION_BLOCK_QA_SCOPE_INVALID');
    if (value.kind === 'timeline') fail(value.fixtureLimit === undefined,
        'Timeline QA scope does not accept a fixture limit', 'PRODUCTION_BLOCK_QA_SCOPE_INVALID');
    return value;
}

function buildBlockId(now, head) {
    const timestamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    return `EG-${timestamp}-${head.slice(0, 8)}`;
}

function buildManifest(facts, options = {}) {
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const validityMinutes = Number(options.validityMinutes || 360);
    fail(Number.isInteger(validityMinutes) && validityMinutes >= 5 && validityMinutes <= 360,
        'Production block validity must be 5-360 minutes', 'PRODUCTION_BLOCK_VALIDITY_INVALID');
    const head = String(facts.head || '').toLowerCase();
    const baseLiveSha = String(facts.live?.commitSha || facts.baseLiveSha || '').toLowerCase();
    fail(SHA_PATTERN.test(head) && SHA_PATTERN.test(baseLiveSha),
        'Prepare requires exact candidate and live SHAs', 'PRODUCTION_BLOCK_SHA_INVALID');
    const migrations = (facts.migrations || []).map(item => classifyMigration(item.file, item.sql));
    const redPaths = redChangedPaths(facts.changedPaths || []);
    const redMigrations = migrations.filter(item => item.red);
    fail(facts.descendsFromLive === true, 'Candidate HEAD is not a descendant of live SHA', 'PRODUCTION_BLOCK_NOT_DESCENDANT');
    fail(redPaths.length === 0, 'Candidate changes include Red protected paths', 'PRODUCTION_BLOCK_RED_PATHS', { paths: redPaths });
    fail(redMigrations.length === 0, 'Candidate includes a Red migration', 'PRODUCTION_BLOCK_RED_MIGRATION', {
        migrations: redMigrations.map(item => ({ file: item.file, reason: item.redReason }))
    });
    const manifest = {
        schemaVersion: SCHEMA_VERSION,
        blockId: buildBlockId(now, head),
        createdAt: now.toISOString(),
        validUntil: new Date(now.valueOf() + (validityMinutes * 60_000)).toISOString(),
        baseLiveSha,
        initialHeadSha: head,
        allowedBranch: TARGET.branch,
        railwayProjectId: TARGET.railwayProjectId,
        railwayEnvironment: TARGET.railwayEnvironment,
        railwayServiceId: TARGET.railwayServiceId,
        liveUrl: TARGET.liveUrl,
        allowedMigrationFiles: migrations.map(item => item.file).sort(),
        migrationClassifications: migrations.sort((left, right) => left.file.localeCompare(right.file)),
        allowedQaScope: validateQaScope(options.qaScope || { enabled: false }),
        releaseLabel: String(options.releaseLabel || 'Autonomy Hardening').trim().slice(0, 120),
        maxReleaseAttempts: Number(options.maxReleaseAttempts || DEFAULT_MAX_ATTEMPTS),
        realDataMutationAllowed: false,
        settingsMutationAllowed: false,
        secretsMutationAllowed: false,
        protectedContractMutationAllowed: false,
        rollbackReference: options.rollbackReference || {
            previousProductionSha: baseLiveSha,
            migrations: Object.fromEntries(migrations.map(item => [item.file, item.rollback || 'No automatic rollback documented']))
        },
        changedPaths: [...new Set((facts.changedPaths || []).map(file => file.replaceAll('\\', '/')))].sort(),
        runtimeState: { releaseAttempts: 0, lastAttemptAt: null, lastFailureCode: null }
    };
    fail(Number.isInteger(manifest.maxReleaseAttempts) && manifest.maxReleaseAttempts >= 1 && manifest.maxReleaseAttempts <= 3,
        'Release attempt budget must be 1-3', 'PRODUCTION_BLOCK_ATTEMPTS_INVALID');
    manifest.manifestHash = manifestHash(manifest);
    return manifest;
}

function validateManifest(manifest, options = {}) {
    fail(manifest && typeof manifest === 'object' && !Array.isArray(manifest),
        'Production block manifest is invalid', 'PRODUCTION_BLOCK_MANIFEST_INVALID');
    fail(manifest.schemaVersion === SCHEMA_VERSION && BLOCK_ID_PATTERN.test(String(manifest.blockId || '')),
        'Production block schema or block ID is invalid', 'PRODUCTION_BLOCK_MANIFEST_INVALID');
    fail(manifest.manifestHash === manifestHash(manifest),
        'Production block manifest hash differs', 'PRODUCTION_BLOCK_HASH_MISMATCH');
    const createdAt = new Date(manifest.createdAt);
    const validUntil = new Date(manifest.validUntil);
    fail(!Number.isNaN(createdAt.valueOf()) && !Number.isNaN(validUntil.valueOf())
        && validUntil > createdAt && validUntil.valueOf() - createdAt.valueOf() <= MAX_VALIDITY_MS,
    'Production block validity envelope is invalid', 'PRODUCTION_BLOCK_VALIDITY_INVALID');
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    if (options.requireUnexpired !== false) fail(now <= validUntil,
        'Production block has expired', 'PRODUCTION_BLOCK_EXPIRED');
    fail(manifest.allowedBranch === TARGET.branch
        && manifest.railwayProjectId === TARGET.railwayProjectId
        && manifest.railwayEnvironment === TARGET.railwayEnvironment
        && manifest.railwayServiceId === TARGET.railwayServiceId
        && manifest.liveUrl === TARGET.liveUrl,
    'Production target differs from the fixed EventGenix envelope', 'PRODUCTION_BLOCK_TARGET_MISMATCH');
    fail(manifest.realDataMutationAllowed === false
        && manifest.settingsMutationAllowed === false
        && manifest.secretsMutationAllowed === false
        && manifest.protectedContractMutationAllowed === false,
    'Production block attempts to permit a Red action', 'PRODUCTION_BLOCK_RED_PERMISSION');
    validateQaScope(manifest.allowedQaScope);
    return manifest;
}

function confirmationValue(manifest) {
    validateManifest(manifest, { requireUnexpired: false });
    return `ALLOW_PRODUCTION_BLOCK:${manifest.blockId}:${manifest.manifestHash.slice(0, 12)}`;
}

function warningText(manifest) {
    const migrations = manifest.allowedMigrationFiles.length ? manifest.allowedMigrationFiles.join(', ') : 'none';
    const qa = manifest.allowedQaScope?.enabled
        ? `${manifest.allowedQaScope.kind || 'trusted QA'}, TTL ${manifest.allowedQaScope.ttlMinutes || '?'} хв`
        : 'none';
    return [
        `УВАГА · ${manifest.blockId}`,
        '',
        `Дія: випуск ${manifest.releaseLabel}.`,
        '',
        'Наслідки:',
        `1. Push SHA ${manifest.initialHeadSha} у ${manifest.allowedBranch}.`,
        '2. Запуск exact-SHA GitHub CI.',
        `3. Deploy у Railway service ${manifest.railwayServiceId}.`,
        `4. Застосування migrations: ${migrations}.`,
        `5. Disposable QA: ${qa}.`,
        '',
        'Межі: тільки зафіксовані branch/service/migrations/QA scope; real data, settings і secrets заборонені.',
        `Відкат: production SHA ${manifest.baseLiveSha}; migration mapping у block manifest; exact QA cleanup.`,
        `Потрібний дозвіл: «Дозволяю блок ${manifest.blockId}» або exact controller confirmation ${confirmationValue(manifest)}.`
    ].join('\n');
}

module.exports = {
    DEFAULT_MAX_ATTEMPTS,
    MAX_VALIDITY_MS,
    ProductionBlockError,
    RED_PATH_PATTERNS,
    SCHEMA_VERSION,
    TARGET,
    buildManifest,
    classifyMigration,
    confirmationValue,
    manifestHash,
    redChangedPaths,
    sanitize,
    stableJson,
    validateManifest,
    validateQaScope,
    warningText
};
