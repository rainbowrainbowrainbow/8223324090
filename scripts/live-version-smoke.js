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

async function fetchText(url) {
    const res = await fetch(url, { headers: { Accept: 'text/html,application/json' } });
    if (!res.ok) fail(`${url} returned HTTP ${res.status}`);
    return res.text();
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

    const html = await fetchText(`${base}/`);
    if (!html.includes(`v${expectedVersion}`) && !html.includes(`?v=${expectedVersion}`)) {
        fail(`login HTML does not expose v${expectedVersion} or ?v=${expectedVersion}`);
    }
    if (expectedLabel && !html.includes(expectedLabel)) {
        fail(`login HTML does not expose release label "${expectedLabel}"`);
    }

    console.log(`Version smoke OK: ${base} -> v${expectedVersion}${expectedLabel ? ` — ${expectedLabel}` : ''}`);
}

main().catch(err => fail(err.message || String(err)));
