'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadClassificationUi() {
    const code = fs.readFileSync(path.join(root, 'js', 'my-day-classification.js'), 'utf8');
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

test('My Day composer classification renders CRM chip controls without native multiple select', () => {
    const context = loadClassificationUi();
    const api = context.window.MyDayClassification;
    api.state.directions = [
        { id: 10, name: 'Робота парк', icon: '🎯', color: '#14b8a6', isActive: true }
    ];
    api.state.impacts = [
        { id: 20, name: 'Системність', icon: '⚙️', color: '#2563eb', isActive: true },
        { id: 21, name: 'Здоровʼя', icon: '❤️', color: '#ef4444', isActive: true }
    ];

    const html = api.renderComposerFields();

    assert.match(html, /my-day-composer-classification/);
    assert.match(html, /my-day-composer-direction-select/);
    assert.match(html, /<option value="">Без напряму<\/option>/);
    assert.match(html, /my-day-composer-impact-chip/);
    assert.match(html, /type="checkbox" name="composerImpactIds"/);
    assert.match(html, /data-my-day-composer-impact-chip/);
    assert.match(html, /Впливи <small>до 3<\/small>/);
    assert.doesNotMatch(composerBody(fs.readFileSync(path.join(root, 'js', 'my-day-classification.js'), 'utf8')), /<select[^>]+multiple/);
    assert.doesNotMatch(html, /id="cabinetTaskImpacts"/);
});

test('My Day composer classification payload sends null direction and checked impact ids', () => {
    const context = loadClassificationUi();
    const api = context.window.MyDayClassification;
    context.document = {
        getElementById: id => id === 'cabinetTaskDirection' ? { value: '' } : null,
        querySelectorAll: selector => selector === '[data-my-day-composer-impact-chip]:checked'
            ? [{ value: '20' }, { value: '21' }, { value: '22' }]
            : []
    };

    const payload = api.readComposerClassification();
    assert.equal(payload.directionId, null);
    assert.deepEqual(Array.from(payload.impactIds), [20, 21, 22]);
});

test('My Day composer classification guards max three impacts and preserves create integration', () => {
    const context = loadClassificationUi();
    const api = context.window.MyDayClassification;
    const profile = fs.readFileSync(path.join(root, 'js', 'profile-page.js'), 'utf8');
    context.document = {
        getElementById: id => id === 'cabinetTaskDirection' ? { value: '10' } : null,
        querySelectorAll: selector => selector === '[data-my-day-composer-impact-chip]:checked'
            ? [{ value: '20' }, { value: '21' }, { value: '22' }, { value: '23' }]
            : []
    };

    assert.throws(() => api.readComposerClassification(), /Оберіть не більше трьох впливів/);
    assert.match(profile, /readComposerClassification\?\.\(\)/);
    assert.match(profile, /saveTaskClassification\?\.\(verification\.taskId, myDayClassification\)/);
});

test('My Day composer classification CSS isolates layout, mobile and dark theme', () => {
    const css = fs.readFileSync(path.join(root, 'css', 'pages-profile.css'), 'utf8');
    assert.match(css, /cabinet-task-composer-meta-advanced > \.my-day-composer-classification\s*\{[\s\S]*grid-column:\s*1 \/ -1/);
    assert.match(css, /\.my-day-composer-classification\s*\{[\s\S]*grid-template-columns:\s*minmax\(210px, 0\.8fr\) minmax\(0, 1\.6fr\)/);
    assert.match(css, /\.my-day-composer-impact-grid\s*\{[\s\S]*flex-wrap:\s*wrap/);
    assert.match(css, /@media \(max-width: 680px\)[\s\S]*\.my-day-classification-fields,[\s\S]*\.my-day-taxonomy-grid \{ grid-template-columns: 1fr; \}/);
    assert.match(css, /body\.dark-mode \.profile-page\.profile-work-mode \.my-day-composer-classification/);
    assert.match(css, /html\[data-theme="dark"\] body \.profile-page\.profile-work-mode \.my-day-composer-direction-select/);
});

test('My Day composer chip binder disables unselected impacts after the third selection', () => {
    const source = fs.readFileSync(path.join(root, 'js', 'my-day-classification.js'), 'utf8');
    assert.match(source, /data-my-day-composer-impact-chip/);
    assert.match(source, /input\.disabled = atLimit && !input\.checked/);
    assert.match(source, /Обрано максимум три впливи/);
    assert.match(source, /data-my-day-composer-impact-selected/);
});