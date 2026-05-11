const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
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

        const uploadText = await fetch(`${baseUrl}/uploads/example.txt`);
        assert.equal(uploadText.status, 200);
        assert.equal(await uploadText.text(), 'upload text ok');
    });
});
