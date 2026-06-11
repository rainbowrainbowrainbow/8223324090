#!/usr/bin/env node
/**
 * Prove a deployed CRM timeline release is not stale across both shared contexts.
 *
 * Usage:
 *   npm run release:timeline-proof -- https://example.up.railway.app
 *   TIMELINE_RELEASE_PROOF_URL=https://example.up.railway.app npm run release:timeline-proof
 */

const pkg = require('../package.json');

const TIMELINE_CONTEXTS = [
    { key: 'event_genix', path: '/', label: 'Event Genix timeline' },
    { key: 'maysternya_doli', path: '/maysternya-doli', label: 'Maysternya Doli timeline' }
];

const TIMELINE_ASSETS = [
    {
        path: 'js/timeline-context.js',
        markers: ['const CONTEXTS', '/maysternya-doli', 'appendApiContext', 'withApiContext']
    },
    {
        path: 'js/timeline-interaction-model.js',
        markers: ['buildDragInteractionIntent', 'buildResizeInteractionIntent', 'buildDragUndoAtomicPayload', 'buildResizeUndoAtomicPayload']
    },
    {
        path: 'js/timeline.js',
        markers: ['buildDragInteractionIntent', 'buildResizeInteractionIntent', 'cancelActiveTimelineInteractions']
    }
];

function configuredDeployBranch() {
    return process.env.RELEASE_DEPLOY_BRANCH
        || process.env.RAILWAY_DEPLOY_BRANCH
        || process.env.DEPLOY_BRANCH
        || 'codex/timeline-leads-hardening';
}

function fail(message) {
    console.error(`Timeline release proof failed: ${message}`);
    process.exit(1);
}

function expectedRelease(options = {}) {
    return {
        version: options.version || pkg.version,
        releaseLabel: options.releaseLabel || String(pkg.eventGenix?.releaseLabel || pkg.releaseLabel || '').trim()
    };
}

function normalizeBase(url) {
    try {
        return new URL(url).origin;
    } catch {
        throw new Error(`invalid URL "${url || ''}"`);
    }
}

async function fetchText(url, accept = 'text/html,application/javascript,application/json,text/plain,*/*') {
    const res = await fetch(url, {
        headers: {
            Accept: accept,
            'Cache-Control': 'no-cache',
            Pragma: 'no-cache'
        }
    });
    if (!res.ok) {
        throw new Error(`${url} returned HTTP ${res.status}`);
    }
    return {
        url: res.url,
        text: await res.text()
    };
}

function ensureIncludes(text, needle, label) {
    if (!text.includes(needle)) {
        throw new Error(`${label} missing "${needle}"`);
    }
}

function staleVersionMatches(text, expectedVersion, label) {
    const stale = [];
    const regex = /(?:href|src)=["'][^"']+\?v=([\d.]+)/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        if (match[1] !== expectedVersion) stale.push(match[1]);
    }
    if (stale.length) {
        throw new Error(`${label} contains stale asset version(s): ${[...new Set(stale)].join(', ')}`);
    }
}

async function proveApiVersion(base, release) {
    const { text } = await fetchText(`${base}/api/version`, 'application/json');
    let json;
    try {
        json = JSON.parse(text);
    } catch {
        throw new Error('/api/version did not return JSON');
    }
    if (json.version !== release.version) {
        throw new Error(`/api/version is ${json.version}, expected ${release.version}`);
    }
    if (release.releaseLabel && json.releaseLabel !== release.releaseLabel) {
        throw new Error(`/api/version releaseLabel is "${json.releaseLabel}", expected "${release.releaseLabel}"`);
    }
    return json;
}

async function proveContextHtml(base, context, release) {
    const { text, url } = await fetchText(`${base}${context.path}`);
    ensureIncludes(text, `v${release.version}`, `${context.path} release text`);
    if (release.releaseLabel) ensureIncludes(text, release.releaseLabel, `${context.path} release label`);
    for (const asset of TIMELINE_ASSETS) {
        ensureIncludes(text, `${asset.path}?v=${release.version}`, `${context.path} HTML`);
    }
    staleVersionMatches(text, release.version, `${context.path} HTML`);
    return {
        key: context.key,
        path: context.path,
        resolvedUrl: url,
        assets: TIMELINE_ASSETS.map(asset => `${asset.path}?v=${release.version}`)
    };
}

async function proveAsset(base, asset, release) {
    const url = `${base}/${asset.path}?v=${release.version}`;
    const { text } = await fetchText(url);
    for (const marker of asset.markers) {
        ensureIncludes(text, marker, asset.path);
    }
    return {
        path: asset.path,
        url,
        markers: asset.markers
    };
}

async function proveServiceWorker(base, release) {
    const url = `${base}/sw.js?v=${release.version}`;
    const { text } = await fetchText(url, 'application/javascript,text/plain,*/*');
    ensureIncludes(text, `CACHE_NAME = 'event-genix-v${release.version}'`, 'sw.js');
    ensureIncludes(text, `API_CACHE_NAME = 'event-genix-api-v${release.version}'`, 'sw.js');
    return {
        url,
        cacheName: `event-genix-v${release.version}`,
        apiCacheName: `event-genix-api-v${release.version}`
    };
}

async function runTimelineReleaseProof(target, options = {}) {
    const release = expectedRelease(options);
    const base = normalizeBase(target);
    const deployBranch = options.deployBranch || configuredDeployBranch();
    const apiVersion = await proveApiVersion(base, release);
    const contexts = [];
    for (const context of TIMELINE_CONTEXTS) {
        contexts.push(await proveContextHtml(base, context, release));
    }
    const assets = [];
    for (const asset of TIMELINE_ASSETS) {
        assets.push(await proveAsset(base, asset, release));
    }
    const serviceWorker = await proveServiceWorker(base, release);

    return {
        base,
        expectedVersion: release.version,
        releaseLabel: release.releaseLabel,
        apiVersion,
        contexts,
        assets,
        serviceWorker,
        rollback: {
            deployBranch,
            identifyLiveCommit: `git ls-remote origin ${deployBranch}`,
            fallback: `git revert <bad-release-commit>, push HEAD:${deployBranch}, then rerun npm run release:timeline-proof -- <live-url>`
        }
    };
}

async function main() {
    const target = process.argv[2] || process.env.TIMELINE_RELEASE_PROOF_URL || process.env.VERSION_SMOKE_URL || process.env.TEST_URL;
    if (!target) {
        fail('provide a URL as an argument or TIMELINE_RELEASE_PROOF_URL/VERSION_SMOKE_URL/TEST_URL');
    }

    const report = await runTimelineReleaseProof(target);
    console.log(`Timeline release proof OK: ${report.base} -> v${report.expectedVersion}${report.releaseLabel ? ` — ${report.releaseLabel}` : ''}`);
    for (const context of report.contexts) {
        console.log(`  OK ${context.path}: ${context.assets.join(', ')}`);
    }
    console.log(`  OK sw.js: ${report.serviceWorker.cacheName}, ${report.serviceWorker.apiCacheName}`);
    console.log(`  Rollback note: ${report.rollback.fallback}`);
}

if (require.main === module) {
    main().catch(err => fail(err.message || String(err)));
}

module.exports = {
    TIMELINE_ASSETS,
    TIMELINE_CONTEXTS,
    configuredDeployBranch,
    runTimelineReleaseProof
};
