'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FULL_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const SOURCE_BRANCH_MAX_LENGTH = 255;
const DEPLOYMENT_MANIFEST_FILENAME = 'eventgenix-release-deployment.json';
const DEPLOYMENT_MANIFEST_FORMAT = 'eventgenix.release-deployment';
const DEPLOYMENT_MANIFEST_SCHEMA_VERSION = 1;
const DEPLOYMENT_MANIFEST_KEYS = Object.freeze([
    'applicationVersion',
    'commitSha',
    'format',
    'schemaVersion',
    'sourceBranch'
]);

function normalizeCommitSha(value) {
    const commitSha = String(value || '').trim();
    return FULL_COMMIT_SHA_PATTERN.test(commitSha) ? commitSha.toLowerCase() : null;
}

function normalizeSourceBranch(value) {
    const sourceBranch = String(value || '').trim();
    if (!sourceBranch
        || sourceBranch.length > SOURCE_BRANCH_MAX_LENGTH
        || /[\u0000-\u001f\u007f]/.test(sourceBranch)) {
        return null;
    }
    return sourceBranch;
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateDeploymentManifest(value, options = {}) {
    if (!isPlainObject(value)) return { valid: false, reason: 'manifest_not_object' };
    const keys = Object.keys(value).sort();
    const expectedKeys = [...DEPLOYMENT_MANIFEST_KEYS].sort();
    if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
        return { valid: false, reason: 'manifest_keys_invalid' };
    }
    if (value.format !== DEPLOYMENT_MANIFEST_FORMAT) {
        return { valid: false, reason: 'manifest_format_invalid' };
    }
    if (value.schemaVersion !== DEPLOYMENT_MANIFEST_SCHEMA_VERSION) {
        return { valid: false, reason: 'manifest_schema_invalid' };
    }

    const commitSha = normalizeCommitSha(value.commitSha);
    const sourceBranch = normalizeSourceBranch(value.sourceBranch);
    const applicationVersion = typeof value.applicationVersion === 'string' ? value.applicationVersion.trim() : '';
    if (!commitSha) return { valid: false, reason: 'manifest_commit_invalid' };
    if (!sourceBranch) return { valid: false, reason: 'manifest_branch_invalid' };
    if (!applicationVersion) return { valid: false, reason: 'manifest_version_invalid' };
    if (options.expectedVersion && applicationVersion !== options.expectedVersion) {
        return { valid: false, reason: 'manifest_version_mismatch' };
    }

    return {
        valid: true,
        manifest: {
            format: DEPLOYMENT_MANIFEST_FORMAT,
            schemaVersion: DEPLOYMENT_MANIFEST_SCHEMA_VERSION,
            applicationVersion,
            commitSha,
            sourceBranch
        }
    };
}

function buildDeploymentManifest({ commitSha, sourceBranch, applicationVersion }) {
    const checked = validateDeploymentManifest({
        format: DEPLOYMENT_MANIFEST_FORMAT,
        schemaVersion: DEPLOYMENT_MANIFEST_SCHEMA_VERSION,
        applicationVersion,
        commitSha,
        sourceBranch
    });
    if (!checked.valid) throw new Error(`Invalid deployment manifest: ${checked.reason}`);
    return checked.manifest;
}

function deploymentManifestPath(rootDir = path.join(__dirname, '..')) {
    return path.join(rootDir, DEPLOYMENT_MANIFEST_FILENAME);
}

function readDeploymentManifest(options = {}) {
    const filePath = options.filePath || deploymentManifestPath(options.rootDir);
    let raw;
    try {
        raw = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        if (error?.code === 'ENOENT') return { state: 'absent', filePath, manifest: null, reason: null };
        return { state: 'invalid', filePath, manifest: null, reason: 'manifest_unreadable' };
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { state: 'invalid', filePath, manifest: null, reason: 'manifest_json_invalid' };
    }

    const checked = validateDeploymentManifest(parsed, { expectedVersion: options.expectedVersion || null });
    return checked.valid
        ? { state: 'valid', filePath, manifest: checked.manifest, reason: null }
        : { state: 'invalid', filePath, manifest: null, reason: checked.reason };
}

function writeDeploymentManifest(rootDir, fields) {
    const manifest = buildDeploymentManifest(fields);
    const filePath = deploymentManifestPath(rootDir);
    fs.writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return { filePath, manifest };
}

module.exports = {
    FULL_COMMIT_SHA_PATTERN,
    SOURCE_BRANCH_MAX_LENGTH,
    DEPLOYMENT_MANIFEST_FILENAME,
    DEPLOYMENT_MANIFEST_FORMAT,
    DEPLOYMENT_MANIFEST_SCHEMA_VERSION,
    normalizeCommitSha,
    normalizeSourceBranch,
    validateDeploymentManifest,
    buildDeploymentManifest,
    deploymentManifestPath,
    readDeploymentManifest,
    writeDeploymentManifest
};