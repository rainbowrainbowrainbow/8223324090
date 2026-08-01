'use strict';

const pkg = require('../package.json');
const {
    FULL_COMMIT_SHA_PATTERN,
    normalizeCommitSha,
    normalizeSourceBranch,
    validateDeploymentManifest,
    readDeploymentManifest
} = require('./releaseDeploymentManifest');

const METADATA_STATUSES = new Set([
    'railway',
    'manifest',
    'manual',
    'partial',
    'unavailable',
    'conflict'
]);

function getReleaseLabel() {
    return String(pkg.eventGenix?.releaseLabel || pkg.releaseLabel || '').trim();
}

function normalizedEnvValue(env, name, normalizer) {
    if (!Object.prototype.hasOwnProperty.call(env, name)) {
        return { name, rawPresent: false, value: null };
    }
    const rawValue = env[name];
    const rawText = String(rawValue || '').trim();
    return {
        name,
        rawPresent: rawText.length > 0,
        value: normalizer(rawValue)
    };
}

function readEnvPair(env, commitName, branchName) {
    const commit = normalizedEnvValue(env, commitName, normalizeCommitSha);
    const branch = normalizedEnvValue(env, branchName, normalizeSourceBranch);
    return {
        commit,
        branch,
        rawPresent: commit.rawPresent || branch.rawPresent,
        complete: Boolean(commit.value && branch.value),
        invalidSources: [commit, branch]
            .filter(item => item.rawPresent && !item.value)
            .map(item => item.name)
    };
}

function resolveManifest(options = {}) {
    if (Object.prototype.hasOwnProperty.call(options, 'deploymentManifest')) {
        const checked = validateDeploymentManifest(options.deploymentManifest, { expectedVersion: pkg.version });
        return checked.valid
            ? { state: 'valid', manifest: checked.manifest, reason: null }
            : { state: 'invalid', manifest: null, reason: checked.reason };
    }
    return readDeploymentManifest({
        rootDir: options.manifestRoot,
        filePath: options.manifestPath,
        expectedVersion: pkg.version
    });
}

function samePair(left, right) {
    return left.commit.value === right.commit.value && left.branch.value === right.branch.value;
}

function selectedPair(source, commitSha, sourceBranch, commitSource, branchSource) {
    return { source, commitSha, sourceBranch, commitSource, branchSource };
}

function getReleaseMetadata(env = process.env, options = {}) {
    const railway = readEnvPair(env, 'RAILWAY_GIT_COMMIT_SHA', 'RAILWAY_GIT_BRANCH');
    const manual = readEnvPair(env, 'RELEASE_DEPLOY_COMMIT', 'RELEASE_DEPLOY_BRANCH');
    const manifestResult = resolveManifest(options);
    const manifest = manifestResult.state === 'valid'
        ? {
            commit: { value: manifestResult.manifest.commitSha },
            branch: { value: manifestResult.manifest.sourceBranch },
            complete: true
        }
        : null;
    const warnings = [];
    const invalidSources = [...railway.invalidSources, ...manual.invalidSources];
    if (manifestResult.state === 'invalid') invalidSources.push('DEPLOYMENT_MANIFEST');

    let selected = null;
    let status = 'unavailable';

    if (railway.rawPresent) {
        if (!railway.complete) {
            status = 'partial';
            warnings.push('railway_metadata_partial');
        } else {
            selected = selectedPair(
                'railway',
                railway.commit.value,
                railway.branch.value,
                railway.commit.name,
                railway.branch.name
            );
            status = 'railway';
            if (manifest && !samePair(railway, manifest)) {
                status = 'conflict';
                warnings.push('manifest_conflicts_with_railway_metadata');
            }
            if (manual.complete && !samePair(railway, manual)) {
                status = 'conflict';
                warnings.push('manual_metadata_conflicts_with_railway_metadata');
            }
        }
    } else if (manifest) {
        selected = selectedPair(
            'manifest',
            manifest.commit.value,
            manifest.branch.value,
            'DEPLOYMENT_MANIFEST',
            'DEPLOYMENT_MANIFEST'
        );
        status = 'manifest';
        if (manual.complete && !samePair(manifest, manual)) {
            status = 'conflict';
            warnings.push('manual_metadata_conflicts_with_deployment_manifest');
        }
    } else if (manifestResult.state === 'invalid') {
        status = 'unavailable';
        warnings.push(`deployment_manifest_invalid:${manifestResult.reason}`);
    } else if (manual.rawPresent) {
        if (manual.complete) {
            selected = selectedPair(
                'manual',
                manual.commit.value,
                manual.branch.value,
                manual.commit.name,
                manual.branch.name
            );
            status = 'manual';
            warnings.push('manual_metadata_unverified');
        } else {
            status = 'partial';
            warnings.push('manual_metadata_partial');
        }
    }

    if (!METADATA_STATUSES.has(status)) {
        throw new Error(`Unsupported release metadata status: ${status}`);
    }

    return {
        success: true,
        version: pkg.version,
        releaseLabel: getReleaseLabel(),
        name: 'Event Genix',
        testMode: env.TEST_MODE === 'true',
        commitSha: selected?.commitSha || null,
        sourceBranch: selected?.sourceBranch || null,
        deploymentMetadata: {
            status,
            complete: status === 'railway' || status === 'manifest',
            commitShaSource: selected?.commitSource || null,
            sourceBranchSource: selected?.branchSource || null,
            invalidSources: [...new Set(invalidSources)],
            warnings: [...new Set(warnings)]
        }
    };
}

module.exports = {
    FULL_COMMIT_SHA_PATTERN,
    METADATA_STATUSES,
    getReleaseLabel,
    getReleaseMetadata,
    normalizeCommitSha,
    normalizeSourceBranch
};