const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'js', 'designs-page.js'), 'utf8');

function extractFunction(name) {
    const functionStart = SOURCE.indexOf(`function ${name}`);
    const asyncStart = SOURCE.indexOf(`async function ${name}`);
    const starts = [functionStart, asyncStart].filter(index => index >= 0);
    assert.ok(starts.length > 0, `${name} must exist`);
    const start = Math.min(...starts);
    let bodyStart = -1;
    let parenDepth = 0;
    for (let index = start; index < SOURCE.length; index += 1) {
        const char = SOURCE[index];
        if (char === '(') parenDepth += 1;
        else if (char === ')') parenDepth -= 1;
        else if (char === '{' && parenDepth === 0) {
            bodyStart = index;
            break;
        }
    }
    assert.ok(bodyStart >= 0, `${name} must have a body`);
    let depth = 0;
    for (let index = bodyStart; index < SOURCE.length; index += 1) {
        const char = SOURCE[index];
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        if (depth === 0) return SOURCE.slice(start, index + 1);
    }
    throw new Error(`Could not extract ${name}`);
}

function createHarness(fetchImpl = async () => new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 })) {
    const dom = new JSDOM(`<!doctype html><html><body>
        <input id="searchInput">
        <select id="collectionFilter"><option value=""></option></select>
        <button id="pinFilter"></button>
        <div id="tagChips"></div>
        <div id="designGrid"></div>
        <span id="countDesigns"></span>
        <div id="loadMore"></div>
        <div id="lightbox" aria-hidden="true">
            <button class="lightbox-close"></button>
            <img id="lightboxImg" hidden>
            <iframe id="lightboxPdf" hidden></iframe>
            <div id="lightboxError" hidden></div>
            <button id="lightboxDownload" hidden></button>
            <div id="lightboxInfo"></div>
        </div>
    </body></html>`, { url: 'https://crm.test/designs', runScripts: 'outside-only' });
    const calls = [];
    let objectUrlCounter = 0;
    const context = vm.createContext({
        ...dom.window,
        window: dom.window,
        document: dom.window.document,
        localStorage: {
            getItem: key => key === 'pzp_token' ? 'test-token' : null,
            removeItem: () => {}
        },
        fetch: async (url, options) => {
            calls.push({ url: String(url), options: options || {} });
            return fetchImpl(url, options || {});
        },
        Response,
        Blob,
        URLSearchParams,
        Number,
        setTimeout,
        console
    });
    context.URL = {
        createObjectURL: () => `blob:test-${++objectUrlCounter}`,
        revokeObjectURL: () => {}
    };
    context.finishBlobDownload = (blob, filename) => {
        calls.push({ type: 'download', blob, filename });
    };
    context.showNotification = (message, type) => {
        calls.push({ type: 'notification', message, tone: type });
    };
    vm.runInContext(`
        const API = '/api/designs';
        let designs = [];
        let allTags = [];
        let totalDesigns = 0;
        let currentOffset = 0;
        const PAGE_SIZE = 50;
        let activeTagFilter = null;
        let activePinFilter = false;
        let designLoadSequence = 0;
        let activeLightboxObjectUrl = null;
        let lastLightboxTrigger = null;
        let lightboxRequestSequence = 0;
        ${[
            'authHeaders',
            'apiFetch',
            'loadDesigns',
            'renderDesignLoading',
            'renderDesignError',
            'renderDesignGrid',
            'esc',
            'setupDesignGridActions',
            'designDownloadUrl',
            'designFilenameFromDisposition',
            'fetchDesignBlob',
            'downloadDesign',
            'clearLightboxPreview',
            'setLightboxError',
            'openLightbox',
            'renderTagChips',
            'filterByTag'
        ].map(extractFunction).join('\n')}
        window.__setDesigns = value => { designs = value; };
        window.__setTags = value => { allTags = value; };
        window.__getState = () => ({ designs, allTags, activeTagFilter, totalDesigns, currentOffset });
    `, context, { filename: 'js/designs-page.js' });
    return { dom, context, calls };
}

test('Design Board list shows a recoverable error instead of throwing on failed payloads', async () => {
    const { dom, context } = createHarness(async () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 }));
    await context.loadDesigns();
    const alert = dom.window.document.querySelector('[role="alert"]');
    assert.ok(alert);
    assert.match(alert.textContent, /Не вдалося завантажити дизайни/);
    assert.ok(dom.window.document.querySelector('[data-design-retry]'));
});

test('Design Board renders cards and tag chips without inline data handlers', () => {
    const { dom, context } = createHarness();
    context.window.__setTags([{ tag: "O'Hara <b>", count: 2 }]);
    context.renderTagChips();
    const chip = dom.window.document.querySelector('.tag-chip');
    assert.equal(chip.getAttribute('onclick'), null);
    assert.equal(chip.textContent.trim(), "#O'Hara <b> 2");

    context.window.__setDesigns([{
        id: 42,
        title: '<Sale>',
        originalName: 'sale.png',
        filename: 'sale.png',
        mimeType: 'image/png',
        fileSize: 2048,
        createdAt: '2026-09-12T10:00:00.000Z',
        tags: ['x<script>'],
        isPinned: false
    }]);
    context.renderDesignGrid();
    assert.ok(dom.window.document.querySelector('[data-design-preview="42"]'));
    assert.equal(dom.window.document.querySelector('[data-design-preview="42"]').getAttribute('onclick'), null);
    assert.equal(dom.window.document.querySelector('[data-design-download="42"]').getAttribute('onclick'), null);
    assert.match(dom.window.document.querySelector('.design-card-tags').textContent, /#x<script>/);
});

test('Design Board download uses the authenticated API response as a Blob', async () => {
    const { context, calls } = createHarness(async () => new Response(new Blob(['file'], { type: 'image/png' }), {
        status: 200,
        headers: { 'Content-Disposition': 'attachment; filename="poster.png"' }
    }));
    context.window.__setDesigns([{ id: 7, title: 'Poster', filename: 'poster.png', mimeType: 'image/png' }]);
    await context.downloadDesign(7);
    assert.equal(calls[0].url, '/api/designs/7/download');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
    assert.equal(calls.find(call => call.type === 'download')?.filename, 'poster.png');
});

test('Design Board lightbox previews PDF bytes and reports missing files honestly', async () => {
    const { dom, context } = createHarness(async () => new Response(new Blob(['%PDF'], { type: 'application/pdf' }), { status: 200 }));
    context.window.__setDesigns([{ id: 9, title: 'Guide', filename: 'guide.pdf', mimeType: 'application/pdf' }]);
    await context.openLightbox(9);
    assert.equal(dom.window.document.getElementById('lightbox').getAttribute('aria-hidden'), 'false');
    assert.equal(dom.window.document.getElementById('lightboxPdf').hidden, false);
    assert.equal(dom.window.document.getElementById('lightboxImg').hidden, true);
    assert.equal(dom.window.document.getElementById('lightboxDownload').hidden, false);

    const missing = createHarness(async () => new Response('missing', { status: 404 }));
    missing.context.window.__setDesigns([{ id: 10, title: 'Missing', filename: 'missing.jpg', mimeType: 'image/jpeg' }]);
    await missing.context.openLightbox(10);
    assert.equal(missing.dom.window.document.getElementById('lightboxError').hidden, false);
    assert.doesNotMatch(missing.dom.window.document.body.innerHTML, /favicon-512/);
});
