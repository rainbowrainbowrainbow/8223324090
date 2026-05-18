const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const chatSource = fs.readFileSync(path.join(ROOT, 'js/chat-page.js'), 'utf8');
const guardianSource = fs.readFileSync(path.join(ROOT, 'services/guardian.js'), 'utf8');
const chatRouteSource = fs.readFileSync(path.join(ROOT, 'routes/chat.js'), 'utf8');

function loadHooks() {
    const dom = new JSDOM(
        '<!doctype html><html><body>' +
            '<div id="mainApp"></div>' +
            '<button id="guardianDigestBtn" type="button"></button>' +
            '<div id="guardianDigestPanel"></div>' +
            '<div id="guardianDigestContent"></div>' +
            '<input id="guardianDigestDate">' +
            '<button id="guardianDigestClose" type="button"></button>' +
            '<button id="guardianDigestPrev" type="button"></button>' +
            '<button id="guardianDigestNext" type="button"></button>' +
        '</body></html>',
        {
        url: 'https://event-genix.test/chat.html',
        runScripts: 'outside-only',
        pretendToBeVisual: true
        }
    );

    const { window } = dom;
    window.__EVENT_GENIX_CHAT_RENDER_TEST__ = true;
    window.SoundEngine = { init() {}, play() {} };
    window.ParkWS = { connect() {}, disconnect() {}, sendChatTyping() {} };
    window.Audio = function AudioStub() {
        return {
            volume: 0,
            load() {},
            cloneNode() { return this; },
            play() { return Promise.resolve(); },
            pause() {}
        };
    };
    window.fetch = async () => new window.Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json' }
    });
    window.setTimeout = () => 0;
    window.clearTimeout = () => {};
    window.setInterval = () => 0;
    window.clearInterval = () => {};
    window.Notification = { requestPermission: async () => 'denied' };
    window.navigator.serviceWorker = { ready: Promise.resolve({}) };
    window.navigator.mediaDevices = { getUserMedia: async () => { throw new Error('not available'); } };

    vm.runInContext(chatSource, dom.getInternalVMContext(), { filename: 'js/chat-page.js' });

    assert.ok(window.__chatRenderSafetyHooks, 'chat render test hooks should be exposed in test mode');
    return { dom, hooks: window.__chatRenderSafetyHooks };
}

function fragment(dom, html) {
    const template = dom.window.document.createElement('template');
    template.innerHTML = html;
    return template.content;
}

function assertNoExecutableNodes(root) {
    assert.equal(root.querySelector('script, iframe, object, embed'), null);
}

describe('chat render safety helpers', () => {
    it('keeps Guardian blocked-word details private to owner role', () => {
        assert.match(guardianSource, /function buildGuardianBlockedResponse/);
        assert.match(guardianSource, /function canSeeBlockedWordDetails/);
        assert.match(guardianSource, /GUARDIAN_PROFANITY_PUBLIC_REASON/);
        assert.doesNotMatch(guardianSource, /Нецензурна лексика:\s*\$\{toxicWords/);
        assert.match(chatRouteSource, /canSeeBlockedWordDetails\(req\.user\)/);
        assert.match(chatRouteSource, /preCheck\.ownerMessage/);
        assert.match(chatSource, /guardianErrMsg/);
        assert.match(chatSource, /replace\(\^?\//);
    });

    it('escapes plain text while preserving safe http links', () => {
        const { dom, hooks } = loadHooks();
        try {
            const html = hooks.formatContent(
                'Hello <img src=x onerror=alert(1)> https://example.test/" onclick="alert(2)\n<script>alert(3)</script>'
            );
            const root = fragment(dom, html);

            assertNoExecutableNodes(root);
            assert.equal(root.querySelector('img'), null);

            const link = root.querySelector('a');
            assert.ok(link, 'http URL should render as a link');
            assert.match(link.getAttribute('href'), /^https:\/\/example\.test\//);
            assert.equal(link.getAttribute('target'), '_blank');
            assert.equal(link.getAttribute('rel'), 'noopener');
            assert.equal(link.getAttribute('onclick'), null);
            assert.equal(root.textContent.includes('<script>alert(3)</script>'), true);
        } finally {
            dom.window.close();
        }
    });

    it('allows only the intended bot formatting tags and escapes injected HTML', () => {
        const { dom, hooks } = loadHooks();
        try {
            const root = fragment(dom, hooks.formatBotContent(
                '<b>Bold</b><ul><li>Allowed</li></ul><img src=x onerror=alert(1)><script>alert(2)</script>'
            ));

            assertNoExecutableNodes(root);
            assert.equal(root.querySelector('b')?.textContent, 'Bold');
            assert.equal(root.querySelector('ul li')?.textContent, 'Allowed');
            assert.equal(root.querySelector('img'), null);
            assert.equal(root.textContent.includes('<img src=x onerror=alert(1)>'), true);
        } finally {
            dom.window.close();
        }
    });

    it('escapes file names and strips unsafe attachment URLs', () => {
        const { dom, hooks } = loadHooks();
        try {
            const imageRoot = fragment(dom, hooks.renderFileAttachment({
                metadata: {
                    file: {
                        type: 'image',
                        url: 'javascript:alert(1)',
                        name: 'photo" onerror="alert(1).png'
                    }
                }
            }));
            const image = imageRoot.querySelector('img');
            assert.ok(image);
            assert.equal(image.getAttribute('src'), '');
            assert.equal(image.getAttribute('alt'), 'photo" onerror="alert(1).png');
            assert.equal(image.getAttribute('onerror'), null);

            const fileRoot = fragment(dom, hooks.renderFileAttachment({
                id: 10,
                metadata: {
                    file: {
                        url: 'javascript:alert(1)',
                        name: 'invoice <script>alert(1)</script>.pdf',
                        size: 2048
                    }
                }
            }));
            const fileLink = fileRoot.querySelector('a.chat-file-attachment');
            assert.ok(fileLink);
            assert.equal(fileLink.getAttribute('href'), '');
            assert.equal(
                fileRoot.querySelector('.chat-file-name')?.textContent,
                'invoice <script>alert(1)</script>.pdf'
            );
            assertNoExecutableNodes(fileRoot);
        } finally {
            dom.window.close();
        }
    });

    it('keeps link previews safe and rejects non-http preview URLs', () => {
        const { dom, hooks } = loadHooks();
        try {
            const unsafePreview = hooks.renderLinkPreview({
                metadata: {
                    linkPreview: {
                        url: 'javascript:alert(1)',
                        title: 'Unsafe'
                    }
                }
            });
            assert.equal(unsafePreview, '');

            const safeRoot = fragment(dom, hooks.renderLinkPreview({
                metadata: {
                    linkPreview: {
                        url: 'https://preview.example/path',
                        image: 'javascript:alert(1)',
                        siteName: 'site <script>alert(1)</script>',
                        title: '<img src=x onerror=alert(2)>',
                        description: '<script>alert(3)</script>'
                    }
                }
            }));

            assertNoExecutableNodes(safeRoot);
            const previewLink = safeRoot.querySelector('a.chat-link-preview');
            assert.equal(previewLink?.getAttribute('href'), 'https://preview.example/path');
            assert.equal(previewLink?.getAttribute('target'), '_blank');
            assert.equal(previewLink?.getAttribute('rel'), 'noopener');
            assert.equal(safeRoot.querySelector('img'), null);
            assert.equal(safeRoot.querySelector('.chat-link-preview-title')?.textContent, '<img src=x onerror=alert(2)>');
            assert.equal(safeRoot.querySelector('.chat-link-preview-desc')?.textContent, '<script>alert(3)</script>');
        } finally {
            dom.window.close();
        }
    });

    it('renders full message bubbles without activating injected text, file, or preview markup', () => {
        const { dom, hooks } = loadHooks();
        try {
            const messageEl = hooks.createMessageEl({
                id: 501,
                seq: 9,
                userId: 42,
                username: 'attacker',
                displayName: 'Attacker <svg onload=alert(1)>',
                role: 'animator',
                createdAt: '2026-05-11T12:00:00.000Z',
                content: 'Look <img src=x onerror=alert(1)> https://safe.example/" onclick="alert(2)',
                metadata: {
                    file: {
                        url: 'javascript:alert(3)',
                        name: 'payload <script>alert(4)</script>.pdf',
                        size: 1024
                    },
                    linkPreview: {
                        url: 'https://preview.example/safe',
                        title: '<script>alert(5)</script>',
                        description: '<img src=x onerror=alert(6)>'
                    }
                },
                reactions: []
            }, false);

            assertNoExecutableNodes(messageEl);
            assert.equal(messageEl.querySelector('.chat-bubble-content img'), null);
            assert.equal(messageEl.querySelector('.chat-bubble-username')?.textContent, 'Attacker <svg onload=alert(1)>');
            assert.equal(messageEl.querySelector('a.chat-file-attachment')?.getAttribute('href'), '');
            assert.equal(messageEl.querySelector('.chat-file-name')?.textContent, 'payload <script>alert(4)</script>.pdf');
            assert.equal(messageEl.querySelector('.chat-link-preview-title')?.textContent, '<script>alert(5)</script>');
            assert.equal(messageEl.querySelector('.chat-link-preview-desc')?.textContent, '<img src=x onerror=alert(6)>');
        } finally {
            dom.window.close();
        }
    });
});
