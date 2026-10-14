'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('syntax gate ignores root QA archives and still rejects actual and nested output source errors', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eventgenix-syntax-output-'));
    const checker = path.join(directory, 'scripts/check-js-syntax.js');
    const current = path.join(directory, 'current.js');
    const nested = path.join(directory, 'services/output/current.js');
    const archive = path.join(directory, 'output/archived-source.js');
    const valid = 'const currentSource = true;\n';
    const invalid = 'const = invalidSource;\n';
    try {
        for (const folder of ['scripts', 'output', 'services', 'services/output']) fs.mkdirSync(path.join(directory, folder));
        fs.copyFileSync(path.join(__dirname, '../scripts/check-js-syntax.js'), checker);
        fs.writeFileSync(current, valid);
        fs.writeFileSync(nested, valid);
        fs.writeFileSync(archive, invalid);
        const run = () => {
            const child = spawnSync(process.execPath, [checker], { encoding: 'utf8', cwd: directory,
                windowsHide: true, shell: false, timeout: 30000 });
            assert.ifError(child.error);
            return child;
        };
        let child = run();
        assert.equal(child.status, 0, 'Generated root QA archive is outside release source: ' + child.stderr);
        assert.match(child.stdout, /syntax check passed: 3 files/);
        fs.writeFileSync(nested, invalid);
        child = run();
        assert.equal(child.status, 1);
        assert.match(child.stderr, /FAIL services\/output\/current\.js/);
        assert.doesNotMatch(child.stderr, /FAIL output\/archived-source\.js/);
        fs.writeFileSync(nested, valid);
        fs.writeFileSync(current, invalid);
        child = run();
        assert.equal(child.status, 1);
        assert.match(child.stderr, /FAIL current\.js/);
    } finally {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('eventgenix-syntax-output-'));
        for (const file of [checker, current, nested, archive]) if (fs.existsSync(file)) fs.unlinkSync(file);
        for (const folder of ['services/output', 'services', 'scripts', 'output', '']) {
            const target = path.join(directory, folder);
            if (fs.existsSync(target)) fs.rmdirSync(target);
        }
    }
});