const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { staticDocGuard } = require('../middleware/staticDocGuard');

const ROOT = path.join(__dirname, '..');
const LANDING = path.join(ROOT, 'landing');

const DUPLICATE_MEDIA = [
    ['banner-designs-v2.png', 'images/banners/banner-designs-v2.png'],
    ['banner-invite-v2.png', 'images/banners/banner-invite-v2.png'],
    ['banner-programs-v2.png', 'images/banners/banner-programs-v2.png'],
    ['banner-staff-v2.png', 'images/banners/banner-staff-v2.png'],
    ['banner-tasks-v2.png', 'images/banners/banner-tasks-v2.png'],
    ['slide10-partnership.png', 'images/branding/slide10-partnership.png'],
    ['slide1-baton.png', 'images/branding/slide1-baton.png'],
    ['slide1-hero.png', 'images/branding/slide1-hero.png'],
    ['slide3-train.png', 'images/branding/slide3-train.png'],
    ['slide4-human-robot.png', 'images/branding/slide4-human-robot.png'],
    ['slide5-dashboard.png', 'images/branding/slide5-dashboard.png'],
    ['slide8-shield.png', 'images/branding/slide8-shield.png'],
    ['slide9-rocket.png', 'images/branding/slide9-rocket.png'],
    ['style-reference.png', 'images/branding/style-reference.png']
];

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

function redirectLegacyLanding(target) {
    return (req, res) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.redirect(302, target);
    };
}

function createStaticApp() {
    const app = express();
    app.use(staticDocGuard);
    app.use(express.static(ROOT));
    app.use('/landing', express.static(LANDING));
    app.get('/landing', (req, res) => {
        res.sendFile(path.join(LANDING, 'index.html'));
    });
    app.get(['/manager-guide', '/manager-guide.html'], redirectLegacyLanding('/landing/manager-guide.html'));
    app.get(['/sales-deck', '/sales-deck.html'], redirectLegacyLanding('/landing/sales-deck.html'));
    app.get('/landing/sales-deck', (req, res) => {
        res.sendFile(path.join(LANDING, 'sales-deck.html'));
    });
    return app;
}

describe('static cleanup routing', () => {
    after(async () => {
        await Promise.all(servers.map(close));
        servers = [];
    });

    it('keeps canonical media and removes exact duplicate root copies', () => {
        for (const [rootFile, canonicalFile] of DUPLICATE_MEDIA) {
            assert.equal(fs.existsSync(path.join(ROOT, canonicalFile)), true, `${canonicalFile} should remain canonical`);
            assert.equal(fs.existsSync(path.join(ROOT, rootFile)), false, `${rootFile} should not remain at repo root`);
        }
    });

    it('keeps landing guide/deck pages canonical outside the repo root', () => {
        assert.equal(fs.existsSync(path.join(ROOT, 'manager-guide.html')), false);
        assert.equal(fs.existsSync(path.join(ROOT, 'sales-deck.html')), false);
        assert.equal(fs.existsSync(path.join(LANDING, 'manager-guide.html')), true);
        assert.equal(fs.existsSync(path.join(LANDING, 'sales-deck.html')), true);
    });

    it('redirects legacy root guide and deck URLs to landing pages', async () => {
        const baseUrl = await listen(createStaticApp());

        for (const [legacyPath, target] of [
            ['/manager-guide', '/landing/manager-guide.html'],
            ['/manager-guide.html', '/landing/manager-guide.html'],
            ['/sales-deck', '/landing/sales-deck.html'],
            ['/sales-deck.html', '/landing/sales-deck.html']
        ]) {
            const response = await fetch(`${baseUrl}${legacyPath}`, { redirect: 'manual' });
            assert.equal(response.status, 302, `${legacyPath} should redirect`);
            assert.equal(response.headers.get('location'), target);
        }
    });

    it('serves canonical landing guide and sales deck pages', async () => {
        const baseUrl = await listen(createStaticApp());

        for (const canonicalPath of [
            '/landing/manager-guide.html',
            '/landing/sales-deck.html',
            '/landing/sales-deck'
        ]) {
            const response = await fetch(`${baseUrl}${canonicalPath}`);
            assert.equal(response.status, 200, `${canonicalPath} should be public landing material`);
            assert.match(await response.text(), /Event Genix/);
        }
    });
});
