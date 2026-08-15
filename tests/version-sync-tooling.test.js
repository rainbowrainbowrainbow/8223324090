const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    collectVersionedAssetFiles,
    shouldSkipVersionedAssetDir,
    syncCheckboxStatusText
} = require('../scripts/version-sync');

function versionedAsset(ref, version) {
    return `${ref}?${'v='}${version}`;
}

test('version asset scanner skips generated dirs and inaccessible directories', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'event-genix-version-sync-'));

    for (const dir of [
        'js',
        'public',
        'tmp/pymupdf/bin',
        'output/playwright',
        'test-results/run',
        '.codex-temp/release-copy',
        'node_modules/pkg',
        '.git/hooks',
        'locked'
    ]) {
        fs.mkdirSync(path.join(root, dir), { recursive: true });
    }

    fs.writeFileSync(path.join(root, 'index.html'), `<script src="${versionedAsset('js/app.js', '1.2.3')}"></script>`);
    fs.writeFileSync(path.join(root, 'js/app.js'), `import "${versionedAsset('./feature.js', '1.2.3')}";`);
    fs.writeFileSync(path.join(root, 'public/page.html'), `<link href="${versionedAsset('page.css', '1.2.3')}">`);
    fs.writeFileSync(path.join(root, 'tmp/pymupdf/bin/stale.html'), `<script src="${versionedAsset('old.js', '0.0.1')}"></script>`);
    fs.writeFileSync(path.join(root, 'output/playwright/harness.html'), `<script src="${versionedAsset('old.js', '0.0.1')}"></script>`);
    fs.writeFileSync(path.join(root, 'test-results/run/harness.html'), `<script src="${versionedAsset('old.js', '0.0.1')}"></script>`);
    fs.writeFileSync(path.join(root, '.codex-temp/release-copy/index.html'), `<script src="${versionedAsset('old.js', '0.0.1')}"></script>`);
    fs.writeFileSync(path.join(root, 'node_modules/pkg/index.js'), 'module.exports = "ignored";');
    fs.writeFileSync(path.join(root, '.git/hooks/pre-commit.js'), 'module.exports = "ignored";');

    const originalReaddirSync = fs.readdirSync;
    fs.readdirSync = function guardedReaddirSync(dir, options) {
        if (path.normalize(dir) === path.join(root, 'locked')) {
            const err = new Error('Access denied');
            err.code = 'EACCES';
            throw err;
        }
        return originalReaddirSync.call(this, dir, options);
    };
    t.after(() => {
        fs.readdirSync = originalReaddirSync;
    });
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    assert.equal(shouldSkipVersionedAssetDir('tmp'), true);
    assert.equal(shouldSkipVersionedAssetDir('output'), true);
    assert.equal(shouldSkipVersionedAssetDir('test-results'), true);
    assert.equal(shouldSkipVersionedAssetDir('.codex-temp'), true);
    assert.equal(shouldSkipVersionedAssetDir('public'), false);

    assert.deepEqual(
        collectVersionedAssetFiles(root, [], root),
        ['index.html', 'js/app.js', 'public/page.html']
    );
});

test('version sync owns both Checkbox release package markers', () => {
    const stale = [
        '- Release package baseline prepared for this handoff: `0.80.141` (`Old Release`).',
        '- Release `0.80.141` is the package baseline prepared in this handoff.'
    ].join('\n');

    const synced = syncCheckboxStatusText(stale, '0.80.142', 'Trusted QA Lifecycle Hardening');

    assert.match(synced, /Release package baseline prepared for this handoff: `0\.80\.142` \(`Trusted QA Lifecycle Hardening`\)\./);
    assert.match(synced, /Release `0\.80\.142` is the package baseline prepared in this handoff\./);
    assert.doesNotMatch(synced, /0\.80\.141/);
});
