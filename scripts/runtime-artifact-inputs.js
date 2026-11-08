'use strict';

const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { isDeepStrictEqual } = require('node:util');

const manifests = ['package.json', 'package-lock.json'];
const inputs = [
    ...manifests,
    '.gitattributes',
    '.node-version',
    'railpack.json',
    '.github/workflows/runtime-artifact.yml',
    'scripts/railway-release-up.js',
    'scripts/runtime-artifact-inputs.js',
    'services/releaseDeploymentManifest.js',
    'tests/benchmarks/runtime-artifact-smoke.js',
    'tests/fixtures/booking-summary-layout-compact.fixture.json'
];

function withoutVersion(file, source) {
    const manifest = JSON.parse(source);
    delete manifest.version;
    if (file === 'package.json' && manifest.eventGenix) {
        delete manifest.eventGenix.releaseLabel;
    }
    if (file === 'package-lock.json' && manifest.packages?.['']) {
        delete manifest.packages[''].version;
    }
    return manifest;
}

function requiresBuild(base, head, git = args => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) {
    if (![base, head].every(sha => /^[a-f0-9]{40}$/.test(sha || ''))) return true;
    try {
        const changed = git(['diff', '--name-only', '-z', base, head, '--', ...inputs]).split('\0').filter(Boolean);
        return changed.some(file => !manifests.includes(file) || !isDeepStrictEqual(
            withoutVersion(file, git(['show', `${base}:${file}`])),
            withoutVersion(file, git(['show', `${head}:${file}`]))
        ));
    } catch {
        return true;
    }
}

if (require.main === module) {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const base = event.pull_request?.base?.sha || event.before;
    console.log(`build=${requiresBuild(base, process.env.GITHUB_SHA)}`);
}

module.exports = { inputs, requiresBuild };
