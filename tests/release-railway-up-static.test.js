'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');

test('Railway release helper deploys a pushed clean artifact with manifest and mandatory live proof', () => {
    const scriptPath = path.join(ROOT, 'scripts', 'railway-release-up.js');
    const script = fs.readFileSync(scriptPath, 'utf8');
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

    assert.match(pkg.scripts['release:railway-up'], /scripts\/railway-release-up\.js/);
    assert.match(pkg.scripts['release:railway-up:branch'], /scripts\/railway-release-up\.js --branch$/);
    assert.match(pkg.scripts['release:railway-up:dry-run:branch'], /scripts\/railway-release-up\.js --dry-run --branch$/);
    assert.match(script, /git\(\['status', '--porcelain'\]\)/);
    assert.match(script, /git\(\['ls-remote', 'origin'/);
    assert.match(script, /writeDeploymentManifest\(sourceDir/);
    assert.match(script, /readDeploymentManifest\(\{ rootDir: sourceDir/);
    assert.match(script, /DEPLOYMENT_MANIFEST_FILENAME/);
    assert.match(script, /runPostDeploySmoke\(liveUrl, head, options\.branch\)/);
    assert.match(script, /RELEASE_RAILWAY_UP_PARSE_ONLY/);
    assert.match(script, /options\.parseOnly/);
    assert.match(script, /const DEFAULT_POST_DEPLOY_SMOKE_ATTEMPTS = 36;/);
    assert.match(script, /const DEFAULT_POST_DEPLOY_SMOKE_DELAY_MS = 5000;/);
    assert.match(script, /const DEFAULT_PROJECT = '[0-9a-f-]{36}';/);
    assert.match(script, /RELEASE_RAILWAY_PROJECT \|\| process\.env\.RAILWAY_PROJECT_ID \|\| DEFAULT_PROJECT/);
    assert.match(script, /assertSafeRailwayTarget\(options\)/);
    assert.match(script, /fetchLiveVersionSnapshot\(liveUrl\)/);
    assert.match(script, /assertPreDeployLiveSafety\(\{/);
    assert.match(script, /assertReleaseDescendsFromLive\(preDeploy\.liveCommit, head\)/);
    assert.match(script, /merge-base', '--is-ancestor'/);
    assert.match(script, /Refusing same-version deploy/);
    assert.match(script, /Refusing to deploy v\$\{localVersion\} over newer live/);
    assert.match(script, /Live deployment metadata is not complete/);
    assert.match(script, /VERSION_SMOKE_EXPECT_COMMIT: head/);
    assert.match(script, /VERSION_SMOKE_EXPECT_BRANCH: branch/);
    assert.match(script, /git archive/);
    assert.match(script, /createCleanExport/);
    assert.match(script, /validateExport/);
    assert.match(script, /'up',\s*\n\s*exportInfo\.sourceDir,\s*\n\s*'--path-as-root',\s*\n\s*'--project',\s*\n\s*options\.project/);
    assert.match(script, /shell:\s*false/);
    assert.doesNotMatch(script, /'variable',\s*\n\s*'set'/);
    assert.doesNotMatch(script, /RELEASE_DEPLOY_COMMIT=\$\{head\}/);
    assert.doesNotMatch(script, /RELEASE_DEPLOY_BRANCH=\$\{options\.branch\}/);
    assert.doesNotMatch(script, /--skip-variable-set|--no-clean-export/);
});
