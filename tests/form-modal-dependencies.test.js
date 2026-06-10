const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const uiCode = fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8');

function createDom() {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
        url: 'http://localhost/hr',
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });
    dom.window.requestAnimationFrame = cb => setTimeout(cb, 0);
    dom.window.eval(uiCode);
    return dom;
}

function contextOptions(selected = [], current = '') {
    const selectedSet = new Set(Array.isArray(selected) ? selected : []);
    const options = [
        { value: 'event_genix', label: 'Event Genix' },
        { value: 'maysternya_doli', label: 'Maysternya Doli' },
        { value: 'crm', label: 'CRM' }
    ].filter(option => selectedSet.has(option.value));
    return options.map(option => ({
        ...option,
        selected: option.value === current
    }));
}

function accessFields() {
    const businessVisible = values => ['creator', 'director'].includes(values.role);
    return [
        {
            key: 'rolePreset',
            label: 'Quick pack',
            type: 'presetButtons',
            presets: [{
                label: 'MD director',
                values: {
                    role: 'director',
                    extraRoles: ['manager'],
                    businessContexts: ['event_genix', 'maysternya_doli'],
                    defaultBusinessContext: 'maysternya_doli'
                }
            }]
        },
        {
            key: 'role',
            label: 'Role',
            type: 'select',
            defaultValue: 'animator',
            options: [
                { value: 'animator', label: 'Animator' },
                { value: 'director', label: 'Director' }
            ]
        },
        {
            key: 'extraRoles',
            label: 'Extra roles',
            type: 'checkboxGroup',
            defaultValue: [],
            dependsOn: 'role',
            options: [{ value: 'admin', label: 'Admin' }],
            optionsFor: role => role === 'director'
                ? [{ value: 'manager', label: 'Manager' }]
                : [{ value: 'admin', label: 'Admin' }]
        },
        {
            key: 'businessContexts',
            label: 'Businesses',
            type: 'checkboxGroup',
            required: true,
            defaultValue: [],
            options: [
                { value: 'event_genix', label: 'Event Genix' },
                { value: 'maysternya_doli', label: 'Maysternya Doli' },
                { value: 'crm', label: 'CRM' }
            ],
            visibleWhen: businessVisible
        },
        {
            key: 'defaultBusinessContext',
            label: 'Default business',
            type: 'select',
            defaultValue: 'event_genix',
            dependsOn: 'businessContexts',
            options: contextOptions(['event_genix'], 'event_genix'),
            optionsFor: (_, values) => contextOptions(values.businessContexts || [], values.defaultBusinessContext || 'event_genix'),
            visibleWhen: businessVisible
        }
    ];
}

test('formModal preset applies dependent checkbox and select values together', async () => {
    const { window } = createDom();
    const resultPromise = window.formModal('Access', accessFields(), { type: 'info' });
    const overlay = window.document.querySelector('.form-modal-overlay');

    overlay.querySelector('[data-fm-preset-index="0"]').click();

    assert.equal(overlay.querySelector('#fm_role').value, 'director');
    assert.equal(overlay.querySelector('#fm_extraRoles input[value="manager"]').checked, true);
    assert.equal(overlay.querySelector('[data-fm-field-wrap="businessContexts"]').hidden, false);
    assert.equal(overlay.querySelector('#fm_businessContexts input[value="event_genix"]').checked, true);
    assert.equal(overlay.querySelector('#fm_businessContexts input[value="maysternya_doli"]').checked, true);
    assert.equal(overlay.querySelector('#fm_defaultBusinessContext').value, 'maysternya_doli');

    overlay.querySelector('.confirm-ok').click();
    const result = await resultPromise;

    assert.equal(result.role, 'director');
    assert.deepEqual(Array.from(result.extraRoles), ['manager']);
    assert.deepEqual(Array.from(result.businessContexts), ['event_genix', 'maysternya_doli']);
    assert.equal(result.defaultBusinessContext, 'maysternya_doli');
});

test('formModal ignores required hidden conditional fields on submit', async () => {
    const { window } = createDom();
    const resultPromise = window.formModal('Access', accessFields(), { type: 'info' });
    const overlay = window.document.querySelector('.form-modal-overlay');

    assert.equal(overlay.querySelector('#fm_role').value, 'animator');
    assert.equal(overlay.querySelector('[data-fm-field-wrap="businessContexts"]').hidden, true);

    overlay.querySelector('.confirm-ok').click();
    const result = await resultPromise;

    assert.equal(result.role, 'animator');
    assert.deepEqual(Array.from(result.businessContexts), []);
});
