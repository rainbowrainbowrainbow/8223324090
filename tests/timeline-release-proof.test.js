const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const pkg = require('../package.json');
const { runTimelineReleaseProof } = require('../scripts/timeline-release-proof');

const ROOT = path.join(__dirname, '..');

function contentType(file) {
    if (file.endsWith('.html')) return 'text/html; charset=utf-8';
    if (file.endsWith('.js')) return 'application/javascript; charset=utf-8';
    if (file.endsWith('.json')) return 'application/json; charset=utf-8';
    return 'text/plain; charset=utf-8';
}

function serveText(res, status, type, body) {
    res.writeHead(status, { 'Content-Type': type });
    res.end(body);
}

function createProofServer(options = {}) {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname === '/api/version') {
            const version = options.staleApiVersion ? '0.0.0' : pkg.version;
            serveText(res, 200, 'application/json; charset=utf-8', JSON.stringify({
                success: true,
                version,
                releaseLabel: pkg.eventGenix.releaseLabel,
                name: pkg.name
            }));
            return;
        }

        if (url.pathname === '/' || url.pathname === '/maysternya-doli') {
            let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
            if (options.staleMaysternyaAsset && url.pathname === '/maysternya-doli') {
                const staleTimelineSrc = 'js/timeline.js?' + 'v=0.0.0';
                html = html.replace(`js/timeline.js?v=${pkg.version}`, staleTimelineSrc);
            }
            serveText(res, 200, 'text/html; charset=utf-8', html);
            return;
        }

        const relative = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
        const filePath = path.resolve(ROOT, relative);
        if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
            serveText(res, 404, 'text/plain; charset=utf-8', 'Not found');
            return;
        }

        serveText(res, 200, contentType(relative), fs.readFileSync(filePath));
    });

    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => {
            resolve({
                baseUrl: `http://127.0.0.1:${server.address().port}`,
                close: () => new Promise((done, reject) => server.close(err => err ? reject(err) : done()))
            });
        });
    });
}

test('timeline release proof validates both shared contexts, assets, and service worker cache names', async () => {
    const app = await createProofServer();
    try {
        const report = await runTimelineReleaseProof(app.baseUrl);

        assert.equal(report.expectedVersion, pkg.version);
        assert.equal(report.contexts.length, 2);
        assert.deepEqual(report.contexts.map(item => item.path), ['/', '/maysternya-doli']);
        assert.ok(report.assets.some(item => item.path === 'js/timeline.js'));
        assert.ok(report.assets.some(item => item.path === 'js/timeline-interaction-model.js'));
        assert.equal(report.serviceWorker.cacheName, `event-genix-v${pkg.version}`);
        assert.match(report.rollback.fallback, /git revert/);
    } finally {
        await app.close();
    }
});

test('timeline release proof rejects stale timeline asset tags in Maysternya Doli', async () => {
    const app = await createProofServer({ staleMaysternyaAsset: true });
    try {
        await assert.rejects(
            () => runTimelineReleaseProof(app.baseUrl),
            /\/maysternya-doli HTML missing "js\/timeline\.js\?v=/
        );
    } finally {
        await app.close();
    }
});

test('timeline release guardrails are documented and exposed as a repo command', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    const docs = fs.readFileSync(path.join(ROOT, 'docs', 'TIMELINE_RELEASE_GUARDRAILS.md'), 'utf8');

    assert.equal(packageJson.scripts['release:timeline-proof'], 'node scripts/timeline-release-proof.js');
    assert.match(readme, /release:timeline-proof/);
    assert.match(docs, /npm run release:timeline-proof -- <live-url>/);
    assert.match(docs, /git ls-remote origin deployed/);
    assert.match(docs, /git revert <bad-release-commit>/);
});
