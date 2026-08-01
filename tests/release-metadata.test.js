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
const {
    buildDeploymentManifest,
    DEPLOYMENT_MANIFEST_FORMAT,
    DEPLOYMENT_MANIFEST_SCHEMA_VERSION
} = require('../services/releaseDeploymentManifest');
const {
    assertDeploymentMetadata,
    resolveExpectedDeploymentTarget
} = require('../scripts/live-version-smoke');

const ROOT = path.resolve(__dirname, '..');
const EMPTY_MANIFEST_PATH = path.join(ROOT, '.missing-release-manifest-for-test.json');

function manifest(commitSha = 'abcdef0123456789abcdef0123456789abcdef01', sourceBranch = 'codex/production') {
    return buildDeploymentManifest({
        applicationVersion: pkg.version,
        commitSha,
        sourceBranch
    });
}

test('release metadata exposes normalized Railway commit and source branch', () => {
    const commitSha = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01';
    const metadata = getReleaseMetadata({
        TEST_MODE: 'true',
        RAILWAY_GIT_COMMIT_SHA: commitSha,
        RAILWAY_GIT_BRANCH: ' codex/production '
    }, { manifestPath: EMPTY_MANIFEST_PATH });

    assert.deepEqual(metadata, {
        success: true,
        version: pkg.version,
        releaseLabel: pkg.eventGenix.releaseLabel,
        name: 'Event Genix',
        testMode: true,
        commitSha: commitSha.toLowerCase(),
        sourceBranch: 'codex/production',
        deploymentMetadata: {
            status: 'railway',
            complete: true,
            commitShaSource: 'RAILWAY_GIT_COMMIT_SHA',
            sourceBranchSource: 'RAILWAY_GIT_BRANCH',
            invalidSources: [],
            warnings: []
        }
    });
    assert.doesNotThrow(() => assertDeploymentMetadata(metadata));
});

test('release metadata trusts the deployment artifact when platform metadata is unavailable', () => {
    const commitSha = '1111111111111111111111111111111111111111';
    const metadata = getReleaseMetadata({}, { deploymentManifest: manifest(commitSha) });

    assert.equal(metadata.commitSha, commitSha);
    assert.equal(metadata.sourceBranch, 'codex/production');
    assert.deepEqual(metadata.deploymentMetadata, {
        status: 'manifest',
        complete: true,
        commitShaSource: 'DEPLOYMENT_MANIFEST',
        sourceBranchSource: 'DEPLOYMENT_MANIFEST',
        invalidSources: [],
        warnings: []
    });
    assert.doesNotThrow(() => assertDeploymentMetadata(metadata, {
        expectedCommit: commitSha,
        expectedBranch: 'codex/production'
    }));
});

test('stale manual metadata cannot conceal an artifact-backed release', () => {
    const artifactCommit = '1111111111111111111111111111111111111111';
    const metadata = getReleaseMetadata({
        RELEASE_DEPLOY_COMMIT: '2222222222222222222222222222222222222222',
        RELEASE_DEPLOY_BRANCH: 'codex/stale-release'
    }, { deploymentManifest: manifest(artifactCommit, 'codex/production') });

    assert.equal(metadata.commitSha, artifactCommit);
    assert.equal(metadata.sourceBranch, 'codex/production');
    assert.deepEqual(metadata.deploymentMetadata, {
        status: 'conflict',
        complete: false,
        commitShaSource: 'DEPLOYMENT_MANIFEST',
        sourceBranchSource: 'DEPLOYMENT_MANIFEST',
        invalidSources: [],
        warnings: ['manual_metadata_conflicts_with_deployment_manifest']
    });
    assert.throws(() => assertDeploymentMetadata(metadata), /not complete: conflict/);
});

test('platform metadata remains primary and conflicts fail closed', () => {
    const railwayCommit = '3333333333333333333333333333333333333333';
    const metadata = getReleaseMetadata({
        RAILWAY_GIT_COMMIT_SHA: railwayCommit,
        RAILWAY_GIT_BRANCH: 'main'
    }, { deploymentManifest: manifest('4444444444444444444444444444444444444444', 'codex/production') });

    assert.equal(metadata.commitSha, railwayCommit);
    assert.equal(metadata.sourceBranch, 'main');
    assert.equal(metadata.deploymentMetadata.status, 'conflict');
    assert.equal(metadata.deploymentMetadata.complete, false);
    assert.deepEqual(metadata.deploymentMetadata.warnings, ['manifest_conflicts_with_railway_metadata']);
    assert.throws(() => assertDeploymentMetadata(metadata), /not complete: conflict/);
});

test('malformed or missing artifact metadata fails closed without falling back to manual assertions', () => {
    const malformed = getReleaseMetadata({
        RELEASE_DEPLOY_COMMIT: '1111111111111111111111111111111111111111',
        RELEASE_DEPLOY_BRANCH: 'codex/production'
    }, { deploymentManifest: { malformed: true } });
    assert.equal(malformed.commitSha, null);
    assert.equal(malformed.sourceBranch, null);
    assert.deepEqual(malformed.deploymentMetadata, {
        status: 'unavailable',
        complete: false,
        commitShaSource: null,
        sourceBranchSource: null,
        invalidSources: ['DEPLOYMENT_MANIFEST'],
        warnings: ['deployment_manifest_invalid:manifest_keys_invalid']
    });
    assert.throws(() => assertDeploymentMetadata(malformed), /not complete: unavailable/);

    const missing = getReleaseMetadata({}, { manifestPath: EMPTY_MANIFEST_PATH });
    assert.equal(missing.deploymentMetadata.status, 'unavailable');
    assert.equal(missing.deploymentMetadata.complete, false);
    assert.throws(() => assertDeploymentMetadata(missing), /not complete: unavailable/);
});

test('legacy manual metadata is explicitly incomplete even when it matches the expected target', () => {
    const commitSha = '1111111111111111111111111111111111111111';
    const metadata = getReleaseMetadata({
        RELEASE_DEPLOY_COMMIT: commitSha,
        RELEASE_DEPLOY_BRANCH: 'codex/production'
    }, { manifestPath: EMPTY_MANIFEST_PATH });

    assert.equal(metadata.deploymentMetadata.status, 'manual');
    assert.equal(metadata.deploymentMetadata.complete, false);
    assert.throws(() => assertDeploymentMetadata(metadata, {
        expectedCommit: commitSha,
        expectedBranch: 'codex/production'
    }), /not complete: manual/);
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
    }, { manifestPath: EMPTY_MANIFEST_PATH });
    assert.equal(metadata.commitSha, null);
    assert.equal(metadata.sourceBranch, null);
    assert.deepEqual(metadata.deploymentMetadata.invalidSources, [
        'RAILWAY_GIT_COMMIT_SHA',
        'RAILWAY_GIT_BRANCH'
    ]);
    assert.equal(metadata.deploymentMetadata.status, 'partial');
});

test('version smoke requires an exact expected target and accepts only complete artifact metadata', () => {
    const commitSha = 'abcdef0123456789abcdef0123456789abcdef01';
    assert.throws(() => resolveExpectedDeploymentTarget({}), /VERSION_SMOKE_EXPECT_COMMIT/);
    assert.throws(
        () => resolveExpectedDeploymentTarget({ VERSION_SMOKE_EXPECT_COMMIT: commitSha }),
        /VERSION_SMOKE_EXPECT_BRANCH/
    );
    assert.deepEqual(resolveExpectedDeploymentTarget({
        VERSION_SMOKE_EXPECT_COMMIT: commitSha.toUpperCase(),
        VERSION_SMOKE_EXPECT_BRANCH: ' codex/production '
    }), {
        expectedCommit: commitSha,
        expectedBranch: 'codex/production'
    });
    assert.deepEqual(resolveExpectedDeploymentTarget({}, { allowMissing: true }), {
        expectedCommit: null,
        expectedBranch: null
    });

    const complete = getReleaseMetadata({}, { deploymentManifest: manifest(commitSha) });
    assert.doesNotThrow(() => assertDeploymentMetadata(complete, {
        expectedCommit: commitSha,
        expectedBranch: 'codex/production'
    }));
});

test('version smoke keeps retry and artifact expectations in the runtime contract', () => {
    const script = fs.readFileSync(path.join(ROOT, 'scripts', 'live-version-smoke.js'), 'utf8');
    assert.match(script, /VERSION_SMOKE_RETRIES/);
    assert.match(script, /VERSION_SMOKE_TIMEOUT_MS/);
    assert.match(script, /VERSION_SMOKE_RETRY_DELAY_MS/);
    assert.match(script, /AbortController/);
    assert.match(script, /VERSION_SMOKE_EXPECT_COMMIT/);
    assert.match(script, /COMPLETE_METADATA_STATUSES = new Set\(\['railway', 'manifest'\]\)/);
    assert.doesNotMatch(script, /manualVerification/);
    assert.doesNotMatch(script, /process\.env\.RELEASE_DEPLOY_(COMMIT|BRANCH)/);
});

test('/api/version remains a public response from the canonical release service', () => {
    const route = fs.readFileSync(path.join(ROOT, 'routes', 'settings.js'), 'utf8');
    const routeBlock = route.match(/router\.get\('\/version'[\s\S]*?\n\}\);/)?.[0] || '';
    assert.match(routeBlock, /res\.json\(getReleaseMetadata\(\)\)/);
    assert.doesNotMatch(routeBlock, /process\.env|RAILWAY_|GITHUB_|COMMIT|BRANCH/);
});

test('manifest format remains explicit and version-bound', () => {
    const value = manifest();
    assert.equal(value.format, DEPLOYMENT_MANIFEST_FORMAT);
    assert.equal(value.schemaVersion, DEPLOYMENT_MANIFEST_SCHEMA_VERSION);
    assert.equal(value.applicationVersion, pkg.version);
});