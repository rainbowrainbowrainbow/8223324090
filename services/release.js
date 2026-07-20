const pkg = require('../package.json');

const FULL_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const SOURCE_BRANCH_MAX_LENGTH = 255;
const METADATA_STATUSES = new Set([
    'configured',
    'railway',
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
        warnings.push('release_commit_overrides_railway_commit');
    }

    return {
        value: configured.value || railway.value,
        source: configured.value ? configured.name : (railway.value ? railway.name : null),
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
        warnings.push('release_branch_overrides_railway_branch');
    }

    return {
        value: configured.value || railway.value,
        source: configured.value ? configured.name : (railway.value ? railway.name : null),
        warnings,
        invalidSources: [configured, railway]
            .filter(item => item.rawPresent && !item.value)
            .map(item => item.name)
    };
}

function resolveMetadataStatus(commitSha, sourceBranch, commitSource, branchSource, warnings) {
    if (warnings.includes('release_commit_overrides_railway_commit')) {
        return 'conflict';
    }
    if (commitSha && sourceBranch) {
        if (commitSource === 'RELEASE_DEPLOY_COMMIT' && branchSource === 'RELEASE_DEPLOY_BRANCH') return 'configured';
        if (commitSource === 'RAILWAY_GIT_COMMIT_SHA' && branchSource === 'RAILWAY_GIT_BRANCH') return 'railway';
        return 'mixed';
    }
    if (commitSha || sourceBranch) return 'partial';
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
            complete: Boolean(commitSha.value && sourceBranch.value && status !== 'conflict'),
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
