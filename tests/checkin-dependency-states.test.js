'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'checkin.html'), 'utf8');

function response(status, body) {
    return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

async function harness(fetchRequest, camera = async () => ({ getTracks: () => [] })) {
    const dom = new JSDOM(html, { url: 'https://fixture.local/checkin', runScripts: 'outside-only' });
    const win = dom.window;
    const calls = [];
    win.API_BASE = '/api';
    win.console = { error() {}, log() {}, warn() {} };
    win.setInterval = () => 0;
    win.requestAnimationFrame = () => 0;
    win.apiVerifyToken = async () => ({ id: 1, role: 'director' });
    win.hydrateActionPermissions = async () => ({ allowed: true });
    win.canAccessPage = () => true;
    win.getStoredAuthToken = () => 'fixture-token';
    win.getAuthHeaders = () => ({});
    win.faceapi = { nets: {
        tinyFaceDetector: { loadFromUri: async () => {} },
        faceLandmark68TinyNet: { loadFromUri: async () => {} },
        faceRecognitionNet: { loadFromUri: async () => {} }
    } };
    Object.defineProperty(win.navigator, 'mediaDevices', { configurable: true, value: {
        getUserMedia: async () => { calls.push('camera'); return camera(); }
    } });
    win.fetch = async url => { calls.push(String(url)); return fetchRequest(String(url)); };
    win.eval(Array.from(win.document.querySelectorAll('script')).at(-1).textContent);
    for (let i = 0; i < 20 && !/Готово|недоступний|Немає доступу|Не вдалося|не надано|зареєстрованих облич/.test(win.document.getElementById('statusMsg').textContent); i++) {
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    return { dom, win, calls };
}

test('descriptor 403 blocks camera and recognition, then retry reads dependencies again', async () => {
    let denied = true;
    const { dom, win, calls } = await harness(url => url.endsWith('/face-descriptors')
        ? denied ? response(403, { code: 'staff_not_migrated' }) : response(200, [])
        : response(200, []));
    try {
        assert.match(win.document.getElementById('statusMsg').textContent, /staff-дані ще не перенесені/);
        assert.equal(win.document.getElementById('statusActions').hidden, false);
        assert.equal(calls.includes('camera'), false);
        denied = false;
        await win.retryCheckinInitialization();
        assert.match(win.document.getElementById('statusMsg').textContent, /Немає зареєстрованих облич/);
        assert.equal(calls.filter(call => call.endsWith('/face-descriptors')).length, 2);
        assert.equal(calls.includes('camera'), true);
    } finally { dom.window.close(); }
});

test('journal 403 and malformed descriptor payload cannot become empty log or ready state', async () => {
    for (const mode of ['journal-403', 'malformed-descriptors']) {
        const { dom, win, calls } = await harness(url => {
            if (url.endsWith('/face-descriptors')) return response(200, mode === 'malformed-descriptors' ? { error: 'bad shape' } : []);
            return response(403, { code: 'staff_not_migrated' });
        });
        try {
            assert.equal(calls.includes('camera'), false);
            assert.doesNotMatch(win.document.getElementById('statusMsg').textContent, /Готово/);
            if (mode === 'journal-403') {
                assert.match(win.document.getElementById('logEntries').textContent, /Журнал недоступний/);
                assert.doesNotMatch(win.document.getElementById('logEntries').textContent, /Ще ніхто/);
            }
        } finally { dom.window.close(); }
    }
});

test('network descriptor failure and server journal failure remain retryable errors', async () => {
    for (const phase of ['descriptors', 'log']) {
        const { dom, win, calls } = await harness(url => {
            if (url.endsWith('/face-descriptors')) {
                if (phase === 'descriptors') throw new Error('Synthetic offline');
                return response(200, []);
            }
            return response(500, { error: 'Synthetic server error' });
        });
        try {
            assert.match(win.document.getElementById('statusMsg').textContent, phase === 'descriptors' ? /дані облич/ : /журнал відміток/);
            assert.equal(win.document.getElementById('statusActions').hidden, false);
            assert.equal(calls.includes('camera'), false);
            if (phase === 'log') assert.equal(win.document.getElementById('logEntries').getAttribute('role'), 'alert');
        } finally { dom.window.close(); }
    }
});

test('camera denial stays distinct from dependency errors', async () => {
    const { dom, win } = await harness(() => response(200, []), async () => {
        const error = new Error('denied'); error.name = 'NotAllowedError'; throw error;
    });
    try {
        assert.match(win.document.getElementById('statusMsg').textContent, /Доступ до камери не надано/);
        assert.equal(win.document.getElementById('statusActions').hidden, false);
    } finally { dom.window.close(); }
});

test('registration roster denial is visible and retry restores the selector', async () => {
    let denied = true;
    const { dom, win } = await harness(url => url.endsWith('/staff')
        ? denied ? response(403, { code: 'staff_not_migrated' }) : response(200, [{ id: 4, name: 'QA Staff', is_active: true }])
        : response(200, []));
    try {
        await win.showRegister();
        assert.match(win.document.getElementById('registerStaffState').textContent, /Немає доступу/);
        assert.equal(win.document.getElementById('staffSelect').disabled, true);
        denied = false;
        await win.showRegister();
        assert.equal(win.document.getElementById('staffSelect').disabled, false);
        assert.match(win.document.getElementById('staffSelect').textContent, /QA Staff/);
    } finally { dom.window.close(); }
});

test('registration HTTP 403 never reports success even with a misleading payload', async () => {
    const { dom, win, calls } = await harness(url => url.endsWith('/staff')
        ? response(200, [{ id: 4, name: 'QA Staff', is_active: true }])
        : url.endsWith('/face-descriptor') ? response(403, { success: true, code: 'staff_not_migrated' })
            : response(200, []));
    try {
        await win.showRegister();
        win.document.getElementById('staffSelect').value = '4';
        win.faceapi.TinyFaceDetectorOptions = function() {};
        win.faceapi.detectSingleFace = () => ({ withFaceLandmarks: () => ({ withFaceDescriptor: async () => ({ descriptor: new Float32Array(128) }) }) });
        await win.registerFace();
        assert.match(win.document.getElementById('statusMsg').textContent, /Немає доступу до реєстрації/);
        assert.equal(win.document.getElementById('registerPanel').style.display, 'block');
        assert.equal(calls.filter(call => call.endsWith('/face-descriptor')).length, 1);
    } finally { dom.window.close(); }
});
