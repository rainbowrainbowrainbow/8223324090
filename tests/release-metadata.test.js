'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pkg = require('../package.json');
const {
    getReleaseMetadata,
    normalizeCommitSha,
    normalizeSourceBranch
} = require('../services/release');
const { assertDeploymentMetadata } = require('../scripts/live-version-smoke');

const ROOT = path.resolve(__dirname, '..');

test('release metadata exposes normalized Railway commit and source branch', () => {
    const commitSha = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01';
    const metadata = getReleaseMetadata({
        TEST_MODE: 'true',
        RAILWAY_GIT_COMMIT_SHA: commitSha,
        RAILWAY_GIT_BRANCH: ' codex/production '
    });

    assert.deepEqual(metadata, {
        success: true,
        version: pkg.version,
        releaseLabel: pkg.eventGenix.releaseLabel,
        name: 'Event Genix',
        testMode: true,
        commitSha: commitSha.toLowerCase(),
        sourceBranch: 'codex/production'
    });
    assert.doesNotThrow(() => assertDeploymentMetadata(metadata));
});

test('release metadata returns null when Railway git metadata is unavailable', () => {
    const metadata = getReleaseMetadata({
        GITHUB_SHA: '1111111111111111111111111111111111111111',
        COMMIT_SHA: '2222222222222222222222222222222222222222',
        GIT_BRANCH: 'local-branch'
    });

    assert.equal(metadata.commitSha, null);
    assert.equal(metadata.sourceBranch, null);
    assert.doesNotThrow(() => assertDeploymentMetadata(metadata));
});

test('release metadata rejects malformed SHA and unsafe branch values', () => {
    assert.equal(normalizeCommitSha('abc123'), null);
    assert.equal(normalizeCommitSha('g'.repeat(40)), null);
    assert.equal(normalizeSourceBranch(''), null);
    assert.equal(normalizeSourceBranch('codex/production\nINTERNAL=value'), null);
    assert.equal(normalizeSourceBranch('x'.repeat(256)), null);

    const metadata = getReleaseMetadata({
        RAILWAY_GIT_COMMIT_SHA: 'abc123',
        RAILWAY_GIT_BRANCH: 'codex/production\nINTERNAL=value'
    });
    assert.equal(metadata.commitSha, null);
    assert.equal(metadata.sourceBranch, null);
});

test('version smoke requires stable metadata fields and validates SHA format when present', () => {
    assert.throws(
        () => assertDeploymentMetadata({ sourceBranch: null }),
        /missing commitSha/
    );
    assert.throws(
        () => assertDeploymentMetadata({ commitSha: null }),
        /missing sourceBranch/
    );
    assert.throws(
        () => assertDeploymentMetadata({ commitSha: 'abc123', sourceBranch: 'codex/production' }),
        /invalid format/
    );
    assert.throws(
        () => assertDeploymentMetadata({
            commitSha: 'a'.repeat(40),
            sourceBranch: 'codex/production\nSECRET=value'
        }),
        /sourceBranch has invalid format/
    );
});

test('/api/version remains a public response from the canonical release service', () => {
    const route = fs.readFileSync(path.join(ROOT, 'routes', 'settings.js'), 'utf8');
    const routeBlock = route.match(/router\.get\('\/version'[\s\S]*?\n\}\);/)?.[0] || '';

    assert.match(routeBlock, /res\.json\(getReleaseMetadata\(\)\)/);
    assert.doesNotMatch(routeBlock, /process\.env|RAILWAY_|GITHUB_|COMMIT|BRANCH/);
});
