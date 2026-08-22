'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    assertPreDeployLiveSafety,
    compareVersions,
    fetchLiveVersionSnapshot,
    parseArgs
} = require('../scripts/railway-release-up');

const HEAD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const RELEASE_HEAD = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const RECOVERY_HEAD = 'dddddddddddddddddddddddddddddddddddddddd';
const LIVE = {
    version: '0.80.124',
    commitSha: HEAD,
    sourceBranch: 'codex/checkbox-hardening-release-v080103',
    deploymentMetadata: {
        status: 'manifest',
        complete: true,
        commitShaSource: 'manifest',
        sourceBranchSource: 'manifest',
        invalidSources: [],
        warnings: []
    }
};

test('Railway release predeploy guard accepts exact live SHA redeploy on the confirmed branch', () => {
    const result = assertPreDeployLiveSafety({
        live: LIVE,
        localVersion: '0.80.124',
        head: HEAD,
        branch: LIVE.sourceBranch,
        remoteSha: HEAD
    });
    assert.equal(result.liveCommit, HEAD);
    assert.equal(result.liveBranch, LIVE.sourceBranch);
});

test('Railway release predeploy guard blocks stale, colliding, incomplete, and divergent releases before upload', () => {
    assert.equal(compareVersions('0.80.125', '0.80.124'), 1);
    assert.equal(compareVersions('0.80.124', '0.80.124'), 0);
    assert.equal(compareVersions('0.80.123', '0.80.124'), -1);

    assert.throws(() => assertPreDeployLiveSafety({
        live: { ...LIVE, version: '0.80.125' },
        localVersion: '0.80.124',
        head: HEAD,
        branch: LIVE.sourceBranch,
        remoteSha: HEAD
    }), /newer live v0\.80\.125/);

    assert.throws(() => assertPreDeployLiveSafety({
        live: { ...LIVE, commitSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
        localVersion: '0.80.124',
        head: HEAD,
        branch: LIVE.sourceBranch,
        remoteSha: HEAD
    }), /same-version deploy/);

    assert.throws(() => assertPreDeployLiveSafety({
        live: { ...LIVE, deploymentMetadata: { ...LIVE.deploymentMetadata, complete: false } },
        localVersion: '0.80.125',
        head: HEAD,
        branch: LIVE.sourceBranch,
        remoteSha: HEAD
    }), /metadata is not complete/);

    assert.throws(() => assertPreDeployLiveSafety({
        live: { ...LIVE, sourceBranch: 'codex/other-production-branch' },
        localVersion: '0.80.125',
        head: HEAD,
        branch: LIVE.sourceBranch,
        remoteSha: HEAD
    }), /Live source branch/);

    assert.throws(() => assertPreDeployLiveSafety({
        live: LIVE,
        localVersion: '0.80.124',
        head: HEAD,
        branch: LIVE.sourceBranch,
        remoteSha: 'cccccccccccccccccccccccccccccccccccccccc'
    }), /Remote release branch/);
});

test('Railway release predeploy guard allows explicit metadata recovery for a newer release only', () => {
    const incompleteLive = {
        version: '0.80.164',
        commitSha: null,
        sourceBranch: null,
        deploymentMetadata: {
            status: 'unavailable',
            complete: false
        }
    };
    const result = assertPreDeployLiveSafety({
        live: incompleteLive,
        localVersion: '0.81.0',
        head: HEAD,
        branch: LIVE.sourceBranch,
        remoteSha: HEAD,
        recoverMissingLiveMetadataCommit: RECOVERY_HEAD
    });
    assert.equal(result.liveCommit, RECOVERY_HEAD);
    assert.equal(result.liveBranch, LIVE.sourceBranch);
    assert.equal(result.recoveredMissingLiveMetadata, true);

    assert.throws(() => assertPreDeployLiveSafety({
        live: incompleteLive,
        localVersion: '0.80.164',
        head: HEAD,
        branch: LIVE.sourceBranch,
        remoteSha: HEAD,
        recoverMissingLiveMetadataCommit: RECOVERY_HEAD
    }), /newer than live/);

    assert.throws(() => assertPreDeployLiveSafety({
        live: LIVE,
        localVersion: '0.80.165',
        head: HEAD,
        branch: LIVE.sourceBranch,
        remoteSha: HEAD,
        recoverMissingLiveMetadataCommit: RECOVERY_HEAD
    }), /metadata recovery override/);
});

test('Railway release predeploy guard allows one exact newer-version source branch migration', () => {
    const targetBranch = 'codex/eventgenix-production';
    const result = assertPreDeployLiveSafety({
        live: LIVE,
        localVersion: '0.80.125',
        head: RELEASE_HEAD,
        branch: targetBranch,
        remoteSha: RELEASE_HEAD,
        migrateLiveSourceBranchFrom: LIVE.sourceBranch,
        migrateLiveSourceBranchCommit: HEAD
    });

    assert.equal(result.liveCommit, HEAD);
    assert.equal(result.liveBranch, LIVE.sourceBranch);
    assert.equal(result.migratingLiveSourceBranch, true);
    assert.equal(result.previousLiveBranch, LIVE.sourceBranch);
    assert.equal(result.branch, targetBranch);
});

test('Railway source branch migration fails closed on incomplete, stale, partial, or combined proof', () => {
    const targetBranch = 'codex/eventgenix-production';
    const base = {
        live: LIVE,
        localVersion: '0.80.125',
        head: RELEASE_HEAD,
        branch: targetBranch,
        remoteSha: RELEASE_HEAD,
        migrateLiveSourceBranchFrom: LIVE.sourceBranch,
        migrateLiveSourceBranchCommit: HEAD
    };

    assert.throws(() => assertPreDeployLiveSafety({
        ...base,
        migrateLiveSourceBranchCommit: ''
    }), /requires both the previous branch and its exact 40-character live commit/);

    assert.throws(() => assertPreDeployLiveSafety({
        ...base,
        migrateLiveSourceBranchFrom: 'codex/not-the-live-branch'
    }), /expected migration source/);

    assert.throws(() => assertPreDeployLiveSafety({
        ...base,
        migrateLiveSourceBranchCommit: RECOVERY_HEAD
    }), /migration commit is .* expected/);

    assert.throws(() => assertPreDeployLiveSafety({
        ...base,
        localVersion: LIVE.version
    }), /unless local release version is newer than live/);

    assert.throws(() => assertPreDeployLiveSafety({
        ...base,
        branch: LIVE.sourceBranch
    }), /target must differ from the previous branch/);

    assert.throws(() => assertPreDeployLiveSafety({
        ...base,
        recoverMissingLiveMetadataCommit: RECOVERY_HEAD
    }), /cannot be combined with missing metadata recovery/);

    assert.throws(() => assertPreDeployLiveSafety({
        ...base,
        live: {
            ...LIVE,
            deploymentMetadata: { ...LIVE.deploymentMetadata, complete: false }
        }
    }), /deployment metadata is not complete|requires complete live deployment metadata/);
});

test('Railway release predeploy guard reads live /api/version without Railway variables or upload', async () => {
    const calls = [];
    const snapshot = await fetchLiveVersionSnapshot('https://crm.example.test', {
        fetchImpl: async (url, options) => {
            calls.push({ url, accept: options.headers.Accept });
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify(LIVE)
            };
        }
    });
    assert.deepEqual(snapshot, LIVE);
    assert.deepEqual(calls, [{
        url: 'https://crm.example.test/api/version',
        accept: 'application/json'
    }]);
});

test('Railway release parser accepts npm PowerShell value-forwarding shape', () => {
    const previous = {
        branch: process.env.npm_config_branch,
        commit: process.env.npm_config_commit,
        liveUrl: process.env.npm_config_live_url
    };
    process.env.npm_config_branch = 'true';
    process.env.npm_config_commit = 'true';
    process.env.npm_config_live_url = 'true';
    try {
        const parsed = parseArgs([
            '--dry-run',
            '--skip-remote-check',
            'codex/forwarding-check',
            HEAD,
            RECOVERY_HEAD,
            'https://crm.example.test'
        ]);
        assert.equal(parsed.branch, 'codex/forwarding-check');
        assert.equal(parsed.commit, HEAD);
        assert.equal(parsed.recoverMissingLiveMetadataCommit, RECOVERY_HEAD);
        assert.equal(parsed.liveUrl, 'https://crm.example.test');
        assert.equal(parsed.dryRun, true);
        assert.equal(parsed.skipRemoteCheck, true);
    } finally {
        for (const [key, value] of Object.entries({
            npm_config_branch: previous.branch,
            npm_config_commit: previous.commit,
            npm_config_live_url: previous.liveUrl
        })) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
});

test('Railway release npm wrapper documents the canonical PowerShell command shape', () => {
    const pkg = require('../package.json');
    assert.match(pkg.scripts['release:railway-up'], /node scripts\/railway-release-up\.js/);
    assert.doesNotMatch(pkg.scripts['release:railway-up'], /--branch$/);
    const parsed = parseArgs([
        '--dry-run',
        '--skip-remote-check',
        '--branch',
        'codex/forwarding-check',
        '--commit',
        HEAD,
        '--recover-missing-live-metadata-commit',
        RECOVERY_HEAD,
        '--live-url',
        'https://crm.example.test'
    ]);
    assert.equal(parsed.branch, 'codex/forwarding-check');
    assert.equal(parsed.recoverMissingLiveMetadataCommit, RECOVERY_HEAD);
});

test('Railway release parser accepts explicit source branch migration proof without making it default', () => {
    const pkg = require('../package.json');
    assert.doesNotMatch(pkg.scripts['release:railway-up'], /migrate-live-source-branch/);

    const parsed = parseArgs([
        '--dry-run',
        '--skip-remote-check',
        '--branch',
        'codex/eventgenix-production',
        '--commit',
        RELEASE_HEAD,
        '--migrate-live-source-branch-from',
        LIVE.sourceBranch,
        '--migrate-live-source-branch-commit',
        HEAD,
        '--live-url',
        'https://crm.example.test'
    ]);

    assert.equal(parsed.migrateLiveSourceBranchFrom, LIVE.sourceBranch);
    assert.equal(parsed.migrateLiveSourceBranchCommit, HEAD);
    assert.equal(parsed.recoverMissingLiveMetadataCommit, '');
});
