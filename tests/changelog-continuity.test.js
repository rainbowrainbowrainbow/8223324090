const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function read(file) {
    return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function changelogVersions() {
    return [...read('CHANGELOG.md').matchAll(/^## v([0-9.]+)\s+[-—]\s+(.+)$/gm)].map(match => match[1]);
}

function indexModalVersions() {
    return [...read('index.html').matchAll(/<h4>v([0-9.]+)\s+[—-]\s+[\s\S]*?<\/h4>/g)].map(match => match[1]);
}

function versionParts(version) {
    return version.split('.').map(Number);
}

function currentReleasePrefix() {
    const pkg = JSON.parse(read('package.json'));
    const [major, minor] = String(pkg.version || '').split('.');
    return `${major}.${minor}.`;
}

function isVisibleContinuityTrain(version) {
    return version.startsWith(currentReleasePrefix())
        || version.startsWith('0.61.')
        || version.startsWith('0.60.');
}

function previousPatch(version) {
    const [major, minor, patch] = versionParts(version);
    if (patch <= 0) return null;
    return `${major}.${minor}.${patch - 1}`;
}

describe('visible changelog version continuity', () => {
    it('keeps current and legacy active release notes present in the login changelog modal', () => {
        const source = changelogVersions().filter(isVisibleContinuityTrain);
        const visible = new Set(indexModalVersions());

        const missing = source.filter(version => !visible.has(version));
        assert.deepEqual(missing, []);
    });

    it('does not skip current or legacy active patch versions in the visible top chain', () => {
        const visibleActive = indexModalVersions().filter(isVisibleContinuityTrain);
        assert.ok(visibleActive.length > 10);

        const visible = new Set(visibleActive);
        for (const version of visibleActive) {
            const prev = previousPatch(version);
            if (!prev || version === '0.60.0') continue;
            assert.ok(visible.has(prev), `visible changelog skips ${prev} before ${version}`);
        }
    });
});
