const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    collectVersionedAssetFiles,
    shouldSkipVersionedAssetDir
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
    assert.equal(shouldSkipVersionedAssetDir('public'), false);

    assert.deepEqual(
        collectVersionedAssetFiles(root, [], root),
        ['index.html', 'js/app.js', 'public/page.html']
    );
});
