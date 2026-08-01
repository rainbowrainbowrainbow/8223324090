'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    DEPLOYMENT_MANIFEST_FILENAME,
    DEPLOYMENT_MANIFEST_FORMAT,
    DEPLOYMENT_MANIFEST_SCHEMA_VERSION,
    buildDeploymentManifest,
    readDeploymentManifest,
    writeDeploymentManifest
} = require('../services/releaseDeploymentManifest');

const COMMIT = 'abcdef0123456789abcdef0123456789abcdef01';
const BRANCH = 'codex/production';
const VERSION = '0.80.55';

test('deployment manifest round-trips only the exact release artifact target', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eventgenix-release-manifest-test-'));
    try {
        const written = writeDeploymentManifest(root, {
            applicationVersion: VERSION,
            commitSha: COMMIT.toUpperCase(),
            sourceBranch: ` ${BRANCH} `
        });
        assert.equal(path.basename(written.filePath), DEPLOYMENT_MANIFEST_FILENAME);
        assert.deepEqual(written.manifest, {
            format: DEPLOYMENT_MANIFEST_FORMAT,
            schemaVersion: DEPLOYMENT_MANIFEST_SCHEMA_VERSION,
            applicationVersion: VERSION,
            commitSha: COMMIT,
            sourceBranch: BRANCH
        });
        assert.deepEqual(readDeploymentManifest({ rootDir: root, expectedVersion: VERSION }), {
            state: 'valid',
            filePath: written.filePath,
            manifest: written.manifest,
            reason: null
        });
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('deployment manifest fails closed for stale version, malformed JSON, and extra fields', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eventgenix-release-manifest-test-'));
    const filePath = path.join(root, DEPLOYMENT_MANIFEST_FILENAME);
    try {
        fs.writeFileSync(filePath, '{bad json', 'utf8');
        assert.equal(readDeploymentManifest({ rootDir: root, expectedVersion: VERSION }).state, 'invalid');

        fs.writeFileSync(filePath, JSON.stringify({
            ...buildDeploymentManifest({ applicationVersion: VERSION, commitSha: COMMIT, sourceBranch: BRANCH }),
            applicationVersion: '0.0.1'
        }), 'utf8');
        assert.deepEqual(readDeploymentManifest({ rootDir: root, expectedVersion: VERSION }), {
            state: 'invalid',
            filePath,
            manifest: null,
            reason: 'manifest_version_mismatch'
        });

        fs.writeFileSync(filePath, JSON.stringify({
            ...buildDeploymentManifest({ applicationVersion: VERSION, commitSha: COMMIT, sourceBranch: BRANCH }),
            injected: true
        }), 'utf8');
        assert.equal(readDeploymentManifest({ rootDir: root, expectedVersion: VERSION }).reason, 'manifest_keys_invalid');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});