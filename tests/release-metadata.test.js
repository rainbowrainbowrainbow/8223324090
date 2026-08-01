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
    assertDeploymentMetadata,
    resolveExpectedDeploymentTarget
} = require('../scripts/live-version-smoke');

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

test('release metadata exposes the platform commit and fails closed on stale manual metadata', () => {
    const manualCommit = '1111111111111111111111111111111111111111';
    const railwayCommit = '2222222222222222222222222222222222222222';
    const metadata = getReleaseMetadata({
        RELEASE_DEPLOY_COMMIT: manualCommit,
        RELEASE_DEPLOY_BRANCH: 'codex/stale-release',
        RAILWAY_GIT_COMMIT_SHA: railwayCommit,
        RAILWAY_GIT_BRANCH: 'main'
    });

    assert.equal(metadata.commitSha, railwayCommit);
    assert.equal(metadata.sourceBranch, 'main');
    assert.equal(metadata.deploymentMetadata.commitShaSource, 'RAILWAY_GIT_COMMIT_SHA');
    assert.equal(metadata.deploymentMetadata.sourceBranchSource, 'RAILWAY_GIT_BRANCH');
    assert.deepEqual(metadata.deploymentMetadata, {
        status: 'conflict',
        complete: false,
        commitShaSource: 'RAILWAY_GIT_COMMIT_SHA',
        sourceBranchSource: 'RAILWAY_GIT_BRANCH',
        invalidSources: [],
        warnings: [
            'manual_commit_conflicts_with_railway_commit',
            'manual_branch_conflicts_with_railway_branch'
        ]
    });
    assert.throws(() => assertDeploymentMetadata(metadata), /not complete: conflict/);
});

test('manual-only release metadata remains unverified until the smoke receives an exact target', () => {
    const commitSha = '1111111111111111111111111111111111111111';
    const metadata = getReleaseMetadata({
        RELEASE_DEPLOY_COMMIT: commitSha,
        RELEASE_DEPLOY_BRANCH: 'codex/production'
    });

    assert.deepEqual(metadata.deploymentMetadata, {
        status: 'manual',
        complete: false,
        commitShaSource: 'RELEASE_DEPLOY_COMMIT',
        sourceBranchSource: 'RELEASE_DEPLOY_BRANCH',
        invalidSources: [],
        warnings: ['manual_metadata_unverified']
    });
    assert.throws(
        () => assertDeploymentMetadata(metadata),
        /set VERSION_SMOKE_EXPECT_COMMIT and VERSION_SMOKE_EXPECT_BRANCH/
    );
    assert.doesNotThrow(() => assertDeploymentMetadata(metadata, {
        expectedCommit: commitSha,
        expectedBranch: 'codex/production'
    }));
});

test('release metadata returns null when Railway git metadata is unavailable', () => {
    const metadata = getReleaseMetadata({
        GITHUB_SHA: '1111111111111111111111111111111111111111',
        COMMIT_SHA: '2222222222222222222222222222222222222222',
        GIT_BRANCH: 'local-branch'
    });

    assert.equal(metadata.commitSha, null);
    assert.equal(metadata.sourceBranch, null);
    assert.deepEqual(metadata.deploymentMetadata, {
        status: 'unavailable',
        complete: false,
        commitShaSource: null,
        sourceBranchSource: null,
        invalidSources: [],
        warnings: []
    });
    assert.throws(
        () => assertDeploymentMetadata(metadata),
        /deployment metadata is not complete: unavailable/
    );
    assert.doesNotThrow(() => assertDeploymentMetadata(metadata, { requireComplete: false }));
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
    assert.deepEqual(metadata.deploymentMetadata.invalidSources, [
        'RAILWAY_GIT_COMMIT_SHA',
        'RAILWAY_GIT_BRANCH'
    ]);
});

test('version smoke requires stable complete metadata by default', () => {
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
    assert.throws(
        () => assertDeploymentMetadata({
            commitSha: 'a'.repeat(40),
            sourceBranch: 'codex/production',
            deploymentMetadata: {
                status: 'conflict',
                complete: false,
                commitShaSource: 'RELEASE_DEPLOY_COMMIT',
                sourceBranchSource: 'RELEASE_DEPLOY_BRANCH',
                invalidSources: [],
                warnings: ['manual_commit_conflicts_with_railway_commit']
            }
        }),
        /deployment metadata is not complete: conflict/
    );
    assert.throws(
        () => assertDeploymentMetadata({
            commitSha: 'a'.repeat(40),
            sourceBranch: 'codex/production',
            deploymentMetadata: {
                status: 'configured',
                complete: true,
                commitShaSource: 'RELEASE_DEPLOY_COMMIT',
                sourceBranchSource: 'RELEASE_DEPLOY_BRANCH',
                invalidSources: [],
                warnings: []
            }
        }),
        /not complete: configured/
    );
    assert.throws(
        () => assertDeploymentMetadata({
            commitSha: 'a'.repeat(40),
            sourceBranch: 'codex/production',
            deploymentMetadata: {
                status: 'manual',
                complete: false,
                commitShaSource: 'RELEASE_DEPLOY_COMMIT',
                sourceBranchSource: 'RELEASE_DEPLOY_BRANCH',
                invalidSources: [],
                warnings: ['manual_metadata_unverified']
            }
        }, {
            expectedCommit: 'b'.repeat(40),
            expectedBranch: 'codex/production'
        }),
        /expected/
    );
});

test('version smoke requires an explicit exact deployment target outside diagnostic mode', () => {
    const commitSha = 'abcdef0123456789abcdef0123456789abcdef01';

    assert.throws(
        () => resolveExpectedDeploymentTarget({}),
        /VERSION_SMOKE_EXPECT_COMMIT/
    );
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
});


test('version smoke retries transient fetch failures with timeout controls', () => {
    const script = fs.readFileSync(path.join(ROOT, 'scripts', 'live-version-smoke.js'), 'utf8');

    assert.match(script, /VERSION_SMOKE_RETRIES/);
    assert.match(script, /VERSION_SMOKE_TIMEOUT_MS/);
    assert.match(script, /VERSION_SMOKE_RETRY_DELAY_MS/);
    assert.match(script, /AbortController/);
    assert.match(script, /async function fetchTextOnce/);
    assert.match(script, /statusCode >= 500/);
    assert.match(script, /resolveExpectedDeploymentTarget\(process\.env/);
    assert.match(script, /VERSION_SMOKE_EXPECT_COMMIT/);
    assert.doesNotMatch(script, /process\.env\.RELEASE_DEPLOY_(COMMIT|BRANCH)/);
});
test('/api/version remains a public response from the canonical release service', () => {
    const route = fs.readFileSync(path.join(ROOT, 'routes', 'settings.js'), 'utf8');
    const routeBlock = route.match(/router\.get\('\/version'[\s\S]*?\n\}\);/)?.[0] || '';

    assert.match(routeBlock, /res\.json\(getReleaseMetadata\(\)\)/);
    assert.doesNotMatch(routeBlock, /process\.env|RAILWAY_|GITHUB_|COMMIT|BRANCH/);
});
