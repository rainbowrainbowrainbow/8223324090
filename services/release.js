const pkg = require('../package.json');

const FULL_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const SOURCE_BRANCH_MAX_LENGTH = 255;

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

function getReleaseMetadata(env = process.env) {
    return {
        success: true,
        version: pkg.version,
        releaseLabel: getReleaseLabel(),
        name: 'Event Genix',
        testMode: env.TEST_MODE === 'true',
        commitSha: normalizeCommitSha(env.RAILWAY_GIT_COMMIT_SHA),
        sourceBranch: normalizeSourceBranch(env.RAILWAY_GIT_BRANCH)
    };
}

module.exports = {
    FULL_COMMIT_SHA_PATTERN,
    getReleaseLabel,
    getReleaseMetadata,
    normalizeCommitSha,
    normalizeSourceBranch
};
