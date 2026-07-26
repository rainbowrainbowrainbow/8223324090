#!/usr/bin/env node
/**
 * Verify a deployed/local CRM URL reports the same version contract as package.json.
 *
 * Usage:
 *   npm run version:smoke -- https://example.up.railway.app
 *   VERSION_SMOKE_URL=https://example.up.railway.app npm run version:smoke
 */

const pkg = require('../package.json');

const target = process.argv[2] || process.env.VERSION_SMOKE_URL || process.env.TEST_URL;
const expectedVersion = pkg.version;
const expectedLabel = String(pkg.eventGenix?.releaseLabel || pkg.releaseLabel || '').trim();
const FULL_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const VALID_METADATA_STATUSES = new Set([
    'configured',
    'railway',
    'mixed',
    'partial',
    'unavailable',
    'conflict'
]);
const DEFAULT_FETCH_RETRIES = 3;
const DEFAULT_FETCH_TIMEOUT_MS = 15000;
const DEFAULT_FETCH_RETRY_DELAY_MS = 1500;

function fail(message) {
    console.error(`Version smoke failed: ${message}`);
    process.exit(1);
}

function normalizeBase(url) {
    try {
        return new URL(url).origin;
    } catch {
        fail(`invalid URL "${url || ''}"`);
    }
}

function htmlEscape(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function positiveIntegerEnv(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchTextOnce(url, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            headers: { Accept: 'text/html,application/json' },
            signal: controller.signal
        });
        if (!res.ok) {
            const err = new Error(`${url} returned HTTP ${res.status}`);
            err.statusCode = res.status;
            throw err;
        }
        return await res.text();
    } finally {
        clearTimeout(timeout);
    }
}

async function fetchText(url) {
    const attempts = positiveIntegerEnv('VERSION_SMOKE_RETRIES', DEFAULT_FETCH_RETRIES);
    const timeoutMs = positiveIntegerEnv('VERSION_SMOKE_TIMEOUT_MS', DEFAULT_FETCH_TIMEOUT_MS);
    const retryDelayMs = positiveIntegerEnv('VERSION_SMOKE_RETRY_DELAY_MS', DEFAULT_FETCH_RETRY_DELAY_MS);
    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await fetchTextOnce(url, timeoutMs);
        } catch (err) {
            lastError = err;
            const statusCode = Number(err?.statusCode || 0);
            const retryable = !statusCode || statusCode >= 500;
            if (!retryable || attempt === attempts) break;
            await sleep(retryDelayMs);
        }
    }

    fail(lastError?.message || `${url} request failed`);
}

function assertDeploymentMetadata(versionJson, options = {}) {
    const {
        requireComplete = true,
        expectedCommit = null,
        expectedBranch = null,
        allowUnverifiedManualCommit = false
    } = options;

    if (!Object.prototype.hasOwnProperty.call(versionJson, 'commitSha')) {
        throw new Error('/api/version response is missing commitSha');
    }
    if (!Object.prototype.hasOwnProperty.call(versionJson, 'sourceBranch')) {
        throw new Error('/api/version response is missing sourceBranch');
    }
    if (versionJson.commitSha !== null
        && (typeof versionJson.commitSha !== 'string'
            || !FULL_COMMIT_SHA_PATTERN.test(versionJson.commitSha))) {
        throw new Error(`/api/version commitSha has invalid format: "${versionJson.commitSha}"`);
    }
    if (versionJson.sourceBranch !== null
        && (typeof versionJson.sourceBranch !== 'string'
            || !versionJson.sourceBranch.trim()
            || versionJson.sourceBranch.length > 255
            || /[\u0000-\u001f\u007f]/.test(versionJson.sourceBranch))) {
        throw new Error('/api/version sourceBranch has invalid format');
    }
    if (Object.prototype.hasOwnProperty.call(versionJson, 'deploymentMetadata')) {
        const meta = versionJson.deploymentMetadata;
        if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
            throw new Error('/api/version deploymentMetadata has invalid format');
        }
        if (!VALID_METADATA_STATUSES.has(meta.status)) {
            throw new Error(`/api/version deploymentMetadata has invalid status: "${meta.status}"`);
        }
        if (typeof meta.complete !== 'boolean') {
            throw new Error('/api/version deploymentMetadata.complete has invalid format');
        }
        for (const field of ['commitShaSource', 'sourceBranchSource']) {
            if (meta[field] !== null
                && (typeof meta[field] !== 'string'
                    || !meta[field].trim()
                    || meta[field].length > 255
                    || /[\u0000-\u001f\u007f]/.test(meta[field]))) {
                throw new Error(`/api/version deploymentMetadata.${field} has invalid format`);
            }
        }
        for (const field of ['invalidSources', 'warnings']) {
            if (!Array.isArray(meta[field])
                || meta[field].some(item => typeof item !== 'string'
                    || !item.trim()
                    || item.length > 255
                    || /[\u0000-\u001f\u007f]/.test(item))) {
                throw new Error(`/api/version deploymentMetadata.${field} has invalid format`);
            }
        }
        if (requireComplete && (!meta.complete || ['partial', 'unavailable', 'conflict'].includes(meta.status))) {
            throw new Error(`/api/version deployment metadata is not complete: ${meta.status}`);
        }
        if (requireComplete
            && !expectedCommit
            && meta.commitShaSource === 'RELEASE_DEPLOY_COMMIT'
            && !allowUnverifiedManualCommit) {
            throw new Error('/api/version uses manual RELEASE_DEPLOY_COMMIT metadata; set VERSION_SMOKE_EXPECT_COMMIT to the exact deployed commit');
        }
    }
    if (requireComplete && !versionJson.commitSha) {
        throw new Error('/api/version commitSha is required for release smoke');
    }
    if (requireComplete && !versionJson.sourceBranch) {
        throw new Error('/api/version sourceBranch is required for release smoke');
    }
    if (expectedCommit && versionJson.commitSha !== String(expectedCommit).trim().toLowerCase()) {
        throw new Error(`/api/version commitSha is "${versionJson.commitSha}", expected "${expectedCommit}"`);
    }
    if (expectedBranch && versionJson.sourceBranch !== String(expectedBranch).trim()) {
        throw new Error(`/api/version sourceBranch is "${versionJson.sourceBranch}", expected "${expectedBranch}"`);
    }
}

async function main() {
    if (!target) {
        fail('provide a URL as an argument or VERSION_SMOKE_URL/TEST_URL');
    }

    const base = normalizeBase(target);
    const versionText = await fetchText(`${base}/api/version`);
    let versionJson;
    try {
        versionJson = JSON.parse(versionText);
    } catch {
        fail('/api/version did not return JSON');
    }

    if (versionJson.version !== expectedVersion) {
        fail(`/api/version is ${versionJson.version}, expected ${expectedVersion}`);
    }
    if (expectedLabel && versionJson.releaseLabel !== expectedLabel) {
        fail(`/api/version releaseLabel is "${versionJson.releaseLabel}", expected "${expectedLabel}"`);
    }
    assertDeploymentMetadata(versionJson, {
        requireComplete: process.env.VERSION_SMOKE_ALLOW_MISSING_METADATA !== 'true',
        expectedCommit: process.env.VERSION_SMOKE_EXPECT_COMMIT || process.env.RELEASE_DEPLOY_COMMIT || null,
        expectedBranch: process.env.VERSION_SMOKE_EXPECT_BRANCH || process.env.RELEASE_DEPLOY_BRANCH || null,
        allowUnverifiedManualCommit: process.env.VERSION_SMOKE_ALLOW_UNVERIFIED_MANUAL_COMMIT === 'true'
    });

    const html = await fetchText(`${base}/`);
    if (!html.includes(`v${expectedVersion}`) && !html.includes(`?v=${expectedVersion}`)) {
        fail(`login HTML does not expose v${expectedVersion} or ?v=${expectedVersion}`);
    }
    if (expectedLabel && !html.includes(expectedLabel) && !html.includes(htmlEscape(expectedLabel))) {
        fail(`login HTML does not expose release label "${expectedLabel}"`);
    }

    const metadataStatus = versionJson.deploymentMetadata?.status
        ? ` [metadata:${versionJson.deploymentMetadata.status}]`
        : '';
    const deployedSource = versionJson.commitSha
        ? ` @ ${versionJson.commitSha.slice(0, 12)} (${versionJson.sourceBranch})${metadataStatus}`
        : ' @ commit metadata unavailable';
    console.log(`Version smoke OK: ${base} -> v${expectedVersion}${expectedLabel ? ` — ${expectedLabel}` : ''}${deployedSource}`);
}

if (require.main === module) {
    main().catch(err => fail(err.message || String(err)));
}

module.exports = {
    FULL_COMMIT_SHA_PATTERN,
    VALID_METADATA_STATUSES,
    assertDeploymentMetadata,
    main
};
