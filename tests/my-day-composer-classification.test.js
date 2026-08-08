'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function read(file) {
    return fs.readFileSync(path.join(root, file), 'utf8');
}

function loadClassificationUi() {
    const code = read('js/my-day-classification.js');
    const context = {
        console,
        fetch: async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }),
        window: {
            getAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
            escapeHtml: value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])),
            showNotification: () => {}
        },
        document: { getElementById: () => null, querySelectorAll: () => [] },
        FormData
    };
    vm.createContext(context);
    vm.runInContext(code, context);
    return context;
}

function composerBody(source) {
    const match = source.match(/function renderComposerFields\(\) \{([\s\S]*?)function readComposerClassification\(\)/);
    assert.ok(match, 'renderComposerFields body should be discoverable');
    return match[1];
}

test('My Day composer renders only impact chip controls', () => {
    const context = loadClassificationUi();
    const api = context.window.MyDayClassification;
    api.state.impacts = [
        { id: 20, name: 'System', icon: 'S', color: '#2563eb', isActive: true },
        { id: 21, name: 'Health', icon: 'H', color: '#ef4444', isActive: true }
    ];

    const html = api.renderComposerFields();
    const source = read('js/my-day-classification.js');

    assert.match(html, /my-day-composer-classification/);
    assert.match(html, /my-day-composer-impact-chip/);
    assert.match(html, /type="checkbox" name="composerImpactIds"/);
    assert.match(html, /data-my-day-composer-impact-chip/);
    assert.doesNotMatch(html, /my-day-composer-tag-field|data-my-day-tag-input|cabinetTaskDirection/);
    assert.doesNotMatch(source, /data-my-day-composer-tag-value|renderTagInput|normalizeTags|bindTagInputs/);
    assert.doesNotMatch(composerBody(source), /<select[^>]+multiple/);
});

test('My Day composer payload sends only impactIds', () => {
    const context = loadClassificationUi();
    const api = context.window.MyDayClassification;
    context.document = {
        getElementById: () => null,
        querySelectorAll: selector => selector === '[data-my-day-composer-impact-chip]:checked'
            ? [{ value: '20' }, { value: '21' }, { value: '22' }]
            : []
    };

    const payload = api.readComposerClassification();
    assert.deepEqual(JSON.parse(JSON.stringify(payload)), { impactIds: [20, 21, 22] });
});

test('My Day composer guards max three impacts and preserves create integration', () => {
    const context = loadClassificationUi();
    const api = context.window.MyDayClassification;
    const profile = read('js/profile-page.js');
    context.document = {
        getElementById: () => null,
        querySelectorAll: selector => selector === '[data-my-day-composer-impact-chip]:checked'
            ? [{ value: '20' }, { value: '21' }, { value: '22' }, { value: '23' }]
            : []
    };

    assert.throws(() => api.readComposerClassification());
    assert.match(profile, /readComposerClassification\?\.\(\)/);
    assert.match(profile, /myDayClassification\?\.impactIds\?\.length/);
    assert.doesNotMatch(profile, /myDayClassification\?\.tags\?\.length/);
    assert.match(profile, /saveTaskClassification\?\.\(verification\.taskId, myDayClassification\)/);
});

test('My Day composer CSS isolates impacts layout without task tag styles', () => {
    const css = read('css/pages-profile.css');
    assert.match(css, /cabinet-task-composer-meta-advanced > \.my-day-composer-classification\s*\{[\s\S]*grid-column:\s*1 \/ -1/);
    assert.match(css, /\.my-day-composer-classification\s*\{[\s\S]*grid-template-columns:\s*1fr/);
    assert.match(css, /\.my-day-composer-impact-grid\s*\{[\s\S]*flex-wrap:\s*wrap/);
    assert.match(css, /body\.dark-mode \.profile-page\.profile-work-mode \.my-day-composer-classification/);
    assert.doesNotMatch(css, /\.my-day-tag|\.my-day-task-tags|my-day-composer-direction-select/);
});

test('My Day composer chip binder disables unselected impacts after the third selection', () => {
    const source = read('js/my-day-classification.js');
    assert.match(source, /data-my-day-composer-impact-chip/);
    assert.match(source, /input\.disabled = atLimit && !input\.checked/);
    assert.match(source, /data-my-day-composer-impact-selected/);
});

test('My Day task impact chips expose hidden third impact with tooltip and accessible label', () => {
    const context = loadClassificationUi();
    const api = context.window.MyDayClassification;
    const html = api.renderTaskBadges({
        impacts: [
            { id: 1, name: 'CRM', icon: 'C', color: '#2563eb' },
            { id: 2, name: 'Hermes', icon: 'H', color: '#0f766e' },
            { id: 3, name: 'Парк', icon: 'P', color: '#f59e0b' }
        ]
    });

    assert.match(html, /CRM/);
    assert.match(html, /Hermes/);
    assert.match(html, /my-day-task-chip--more/);
    assert.match(html, /title="Парк"/);
    assert.match(html, /aria-label="Ще впливи: Парк"/);
});
