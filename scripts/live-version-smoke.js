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

async function fetchText(url) {
    const res = await fetch(url, { headers: { Accept: 'text/html,application/json' } });
    if (!res.ok) fail(`${url} returned HTTP ${res.status}`);
    return res.text();
}

function assertDeploymentMetadata(versionJson) {
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
    assertDeploymentMetadata(versionJson);

    const html = await fetchText(`${base}/`);
    if (!html.includes(`v${expectedVersion}`) && !html.includes(`?v=${expectedVersion}`)) {
        fail(`login HTML does not expose v${expectedVersion} or ?v=${expectedVersion}`);
    }
    if (expectedLabel && !html.includes(expectedLabel) && !html.includes(htmlEscape(expectedLabel))) {
        fail(`login HTML does not expose release label "${expectedLabel}"`);
    }

    const deployedSource = versionJson.commitSha
        ? ` @ ${versionJson.commitSha.slice(0, 12)}${versionJson.sourceBranch ? ` (${versionJson.sourceBranch})` : ''}`
        : ' @ commit metadata unavailable';
    console.log(`Version smoke OK: ${base} -> v${expectedVersion}${expectedLabel ? ` — ${expectedLabel}` : ''}${deployedSource}`);
}

if (require.main === module) {
    main().catch(err => fail(err.message || String(err)));
}

module.exports = {
    FULL_COMMIT_SHA_PATTERN,
    assertDeploymentMetadata,
    main
};
