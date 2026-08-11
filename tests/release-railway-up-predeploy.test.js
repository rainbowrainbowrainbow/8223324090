'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    assertPreDeployLiveSafety,
    compareVersions,
    fetchLiveVersionSnapshot
} = require('../scripts/railway-release-up');

const HEAD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
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
