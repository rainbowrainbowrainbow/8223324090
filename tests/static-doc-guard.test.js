const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { staticDocGuard } = require('../middleware/staticDocGuard');

const ROOT = path.join(__dirname, '..');
let servers = [];

function listen(app) {
    return new Promise(resolve => {
        const server = app.listen(0, '127.0.0.1', () => {
            servers.push(server);
            resolve(`http://127.0.0.1:${server.address().port}`);
        });
    });
}

function close(server) {
    return new Promise((resolve, reject) => {
        server.close(err => err ? reject(err) : resolve());
    });
}

describe('static documentation exposure guard', () => {
    after(async () => {
        await Promise.all(servers.map(close));
        servers = [];
    });

    it('blocks markdown and text files before broad root static serving', async () => {
        const app = express();
        app.use(staticDocGuard);
        app.use(express.static(ROOT));
        const baseUrl = await listen(app);

        for (const blockedPath of [
            '/README.md',
            '/docs/archive/CLAUDE.md',
            '/docs/archive/SNAPSHOT.md',
            '/sound-module-proof.txt'
        ]) {
            const response = await fetch(`${baseUrl}${blockedPath}`);
            assert.equal(response.status, 404, `${blockedPath} should not be public static content`);
        }
    });

    it('blocks repository source, config, docs, and package metadata before broad root static serving', async () => {
        const app = express();
        app.use(staticDocGuard);
        app.use(express.static(ROOT));
        const baseUrl = await listen(app);

        for (const blockedPath of [
            '/server.js',
            '/swagger.js',
            '/package.json',
            '/package-lock.json',
            '/routes/auth.js',
            '/services/scheduler.js',
            '/middleware/auth.js',
            '/db/index.js',
            '/config/staticSurface.js',
            '/scripts/check-runtime.js',
            '/tests/static-doc-guard.test.js',
            '/docs/AI_PROVIDER_CONTRACT.md',
            '/utils/logger.js',
            '/lib/marketing-agent.js',
            '/data/battle-cards.json',
            '/prompts/crm-assistant-system.md',
            '/output/playwright/booking-summary-terms-print-qa/harness.html'
        ]) {
            const response = await fetch(`${baseUrl}${blockedPath}`);
            assert.equal(response.status, 404, `${blockedPath} should not be public static content`);
        }
    });

    it('does not block intended public html or assets', async () => {
        const app = express();
        app.use(staticDocGuard);
        app.get('/uploads/example.txt', (req, res) => res.type('text/plain').send('upload text ok'));
        app.use(express.static(ROOT));
        const baseUrl = await listen(app);

        const index = await fetch(`${baseUrl}/index.html`);
        assert.equal(index.status, 200);
        assert.match(await index.text(), /Event Genix/);

        const manifest = await fetch(`${baseUrl}/manifest.json`);
        assert.equal(manifest.status, 200);

        const publicScript = await fetch(`${baseUrl}/js/api.js`);
        assert.equal(publicScript.status, 200);

        const publicStylesheet = await fetch(`${baseUrl}${'/css/' + 'pages.css'}`);
        assert.equal(publicStylesheet.status, 200);

        const publicAsset = await fetch(`${baseUrl}/assets/fonts/Nunito.ttf`);
        assert.equal(publicAsset.status, 200);

        const uploadText = await fetch(`${baseUrl}/uploads/example.txt`);
        assert.equal(uploadText.status, 200);
        assert.equal(await uploadText.text(), 'upload text ok');
    });

    it('keeps root markdown limited to current operating docs', () => {
        const allowedRootDocs = new Set([
            'AGENTS.md',
            'CHANGELOG.md',
            'DB_MIGRATION_GOVERNANCE.md',
            'README.md'
        ]);

        const rootMarkdown = fs.readdirSync(ROOT)
            .filter(name => name.endsWith('.md'))
            .sort();

        assert.deepEqual(rootMarkdown, [...allowedRootDocs].sort());
    });

    it('keeps current-version lookup guarded against stale local branches', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        const script = fs.readFileSync(path.join(ROOT, 'scripts', 'current-version.js'), 'utf8');
        const agents = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');

        assert.equal(pkg.scripts['version:current'], 'node scripts/current-version.js');
        assert.match(script, /process\.platform === 'win32' \? 'git\.exe' : 'git'/);
        assert.match(script, /HEAD\.\.\.\@\{u\}/);
        assert.match(script, /Version guard failed/);
        assert.match(script, /git pull --ff-only/);
        assert.match(agents, /npm run version:current/);
    });
});
