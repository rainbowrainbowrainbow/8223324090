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

function fullModalVersions() {
    return [...`${read('index.html')}\n${read('changelog-history.fragment')}`.matchAll(/<h4>v([0-9.]+)/g)].map(match => match[1]);
}

function currentReleasePrefix() {
    const pkg = JSON.parse(read('package.json'));
    const [major, minor] = String(pkg.version || '').split('.');
    return `${major}.${minor}.`;
}

function currentPackageVersion() {
    return String(JSON.parse(read('package.json')).version || '');
}

function versionSyncScript() {
    return read('scripts/version-sync.js');
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
        const visible = new Set(fullModalVersions());

        const missing = source.filter(version => !visible.has(version));
        assert.deepEqual(missing, []);
    });

    it('does not skip current or legacy active patch versions in the visible top chain', () => {
        const visibleActive = fullModalVersions().filter(isVisibleContinuityTrain);
        const sourceActive = new Set(changelogVersions().filter(isVisibleContinuityTrain));
        assert.ok(visibleActive.length > 10);

        const visible = new Set(visibleActive);
        for (const version of visibleActive) {
            const prev = previousPatch(version);
            if (!prev || version === '0.60.0') continue;
            if (!sourceActive.has(prev)) continue;
            assert.ok(visible.has(prev), `visible changelog skips ${prev} before ${version}`);
        }
    });

    it('keeps the latest current release train patches present in source and visible changelog', () => {
        const [major, minor, patch] = versionParts(currentPackageVersion());
        assert.ok(Number.isInteger(patch), 'package.json version must include a numeric patch');

        const source = new Set(changelogVersions());
        const visible = new Set(fullModalVersions());
        const oldestPatch = Math.max(0, patch - 5);

        for (let currentPatch = patch; currentPatch >= oldestPatch; currentPatch -= 1) {
            const version = `${major}.${minor}.${currentPatch}`;
            assert.ok(source.has(version), `CHANGELOG.md missing ${version}`);
            assert.ok(visible.has(version), `index.html modal missing ${version}`);
        }
    });

    it('keeps version sync from dropping labels or overwriting previous changelog entries', () => {
        const script = versionSyncScript();

        assert.match(script, /function readReleaseLabelArg/);
        assert.match(script, /function readTrailingReleaseLabel/);
        assert.match(script, /readArgWords\('--label'\)/);
        assert.match(script, /readArgWords\('--release-label'\)/);
        assert.match(script, /buildDefaultChangelogModalSection\(version, releaseLabel\)/);
        assert.match(script, /buildDefaultMarkdownChangelogEntry\(version, releaseLabel\)/);
        assert.match(script, /actualVersion === version/);
    });

    it('keeps only recent releases inline and lazy-loads the complete static history', () => {
        const index = read('index.html');
        const app = read('js/app.js');
        const history = read('changelog-history.fragment');

        assert.match(index, /id="changelogHistory"[^>]+data-src="changelog-history\.fragment\?v=/);
        assert.match(index, /<h4>v0\.78\.101/);
        assert.doesNotMatch(index, /<h4>v0\.78\.98/);
        assert.match(history, /<h4>v0\.78\.98/);
        assert.match(app, /loadChangelogHistory/);
        assert.match(app, /fetch\(host\.dataset\.src, \{ credentials: 'same-origin' \}\)/);
    });
});
