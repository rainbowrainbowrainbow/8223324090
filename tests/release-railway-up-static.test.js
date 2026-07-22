'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');

test('Railway release helper deploys the pushed clean worktree as root', () => {
    const scriptPath = path.join(ROOT, 'scripts', 'railway-release-up.js');
    const script = fs.readFileSync(scriptPath, 'utf8');
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

    assert.match(pkg.scripts['release:railway-up'], /scripts\/railway-release-up\.js/);
    assert.match(script, /git\(\['status', '--porcelain'\]\)/);
    assert.match(script, /git\(\['ls-remote', 'origin'/);
    assert.match(script, /RELEASE_DEPLOY_BRANCH/);
    assert.match(script, /RELEASE_DEPLOY_COMMIT/);
    assert.match(script, /'up',\s*\n\s*'\.',\s*\n\s*'--path-as-root'/);
    assert.match(script, /'variable',\s*\n\s*'set'/);
});
