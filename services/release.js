const pkg = require('../package.json');

const FULL_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const SOURCE_BRANCH_MAX_LENGTH = 255;
const METADATA_STATUSES = new Set([
    'railway',
    'manual',
    'mixed',
    'partial',
    'unavailable',
    'conflict'
]);

function getReleaseLabel() {
    return String(pkg.eventGenix?.releaseLabel || pkg.releaseLabel || '').trim();
}

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

function chooseCommitSha(env) {
    const configured = normalizedEnvValue(env, 'RELEASE_DEPLOY_COMMIT', normalizeCommitSha);
    const railway = normalizedEnvValue(env, 'RAILWAY_GIT_COMMIT_SHA', normalizeCommitSha);
    const warnings = [];

    if (configured.value && railway.value && configured.value !== railway.value) {
        warnings.push('manual_commit_conflicts_with_railway_commit');
    }

    return {
        // Railway metadata identifies the commit actually running on the platform.
        // RELEASE_DEPLOY_COMMIT is an operator assertion and must never conceal it.
        value: railway.value || configured.value,
        source: railway.value ? railway.name : (configured.value ? configured.name : null),
        warnings,
        invalidSources: [configured, railway]
            .filter(item => item.rawPresent && !item.value)
            .map(item => item.name)
    };
}

function chooseSourceBranch(env) {
    const configured = normalizedEnvValue(env, 'RELEASE_DEPLOY_BRANCH', normalizeSourceBranch);
    const railway = normalizedEnvValue(env, 'RAILWAY_GIT_BRANCH', normalizeSourceBranch);
    const warnings = [];

    if (configured.value && railway.value && configured.value !== railway.value) {
        warnings.push('manual_branch_conflicts_with_railway_branch');
    }

    return {
        value: railway.value || configured.value,
        source: railway.value ? railway.name : (configured.value ? configured.name : null),
        warnings,
        invalidSources: [configured, railway]
            .filter(item => item.rawPresent && !item.value)
            .map(item => item.name)
    };
}

function resolveMetadataStatus(commitSha, sourceBranch, commitSource, branchSource, warnings) {
    if (warnings.some(warning => warning.endsWith('_conflicts_with_railway_commit')
        || warning.endsWith('_conflicts_with_railway_branch'))) {
        return 'conflict';
    }
    if (!commitSha && !sourceBranch) return 'unavailable';
    if (!commitSha || !sourceBranch) return 'partial';
    if (commitSource === 'RAILWAY_GIT_COMMIT_SHA') {
        return branchSource === 'RAILWAY_GIT_BRANCH' ? 'railway' : 'mixed';
    }
    // A manual SHA can be compared by the post-deploy smoke, but it is not
    // evidence from the platform and therefore cannot be complete here.
    if (commitSource === 'RELEASE_DEPLOY_COMMIT') return 'manual';
    return 'unavailable';
}

function getReleaseMetadata(env = process.env) {
    const commitSha = chooseCommitSha(env);
    const sourceBranch = chooseSourceBranch(env);
    const warnings = [...commitSha.warnings, ...sourceBranch.warnings];
    const status = resolveMetadataStatus(
        commitSha.value,
        sourceBranch.value,
        commitSha.source,
        sourceBranch.source,
        warnings
    );
    if (!METADATA_STATUSES.has(status)) {
        throw new Error(`Unsupported release metadata status: ${status}`);
    }
    const manualOnly = commitSha.source === 'RELEASE_DEPLOY_COMMIT';
    if (manualOnly) warnings.push('manual_metadata_unverified');

    return {
        success: true,
        version: pkg.version,
        releaseLabel: getReleaseLabel(),
        name: 'Event Genix',
        testMode: env.TEST_MODE === 'true',
        commitSha: commitSha.value,
        sourceBranch: sourceBranch.value,
        deploymentMetadata: {
            status,
            complete: Boolean(commitSha.value
                && sourceBranch.value
                && !manualOnly
                && status !== 'conflict'
                && status !== 'partial'
                && status !== 'unavailable'),
            commitShaSource: commitSha.source,
            sourceBranchSource: sourceBranch.source,
            invalidSources: [...new Set([...commitSha.invalidSources, ...sourceBranch.invalidSources])],
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
