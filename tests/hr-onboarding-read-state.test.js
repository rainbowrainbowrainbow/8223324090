'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const HR_CODE = fs.readFileSync(path.join(__dirname, '..', 'js', 'hr-page.js'), 'utf8');

function harness() {
    const dom = new JSDOM(`<!doctype html><html><body>
        <button id="btnStartOnboarding">Start</button>
        <div id="onboardingList"></div>
    </body></html>`, { url: 'http://localhost/hr#onboarding', runScripts: 'outside-only' });
    const { window } = dom;
    window.console = console;
    window.AppState = { currentUser: { id: 1, role: 'director', activeBusinessContext: 'event_genix' } };
    const originalAddEventListener = window.document.addEventListener.bind(window.document);
    window.document.addEventListener = (type, listener, options) => type === 'DOMContentLoaded'
        ? undefined : originalAddEventListener(type, listener, options);
    vm.runInContext(`${HR_CODE}
        canManage = true;
        salaryAccessContext = () => window.__context || 'park';
        hrFetch = (...args) => window.__fetch(...args);
        window.__onboardingTest = {
            load: loadOnboarding,
            readOnly: () => onboardingListReadOnly,
            start: () => window.showStartOnboarding(),
            candidates: force => ensureOnboardingResponsibleCandidates(force)
        };
    `, dom.getInternalVMContext());
    return { window, api: window.__onboardingTest, list: window.document.getElementById('onboardingList'),
        button: window.document.getElementById('btnStartOnboarding'), close: () => window.close() };
}

test('Park onboarding partial read is visible without write controls and errors remain retryable', async () => {
    const h = harness();
    try {
        const writes = [];
        h.window.__fetch = async (...args) => {
            writes.push(args);
            return { success: true, onboardingAccess: { readOnly: true, partial: true, scope: 'general' },
                data: [{ id: 41, staff_id: 9, staff_name: 'Synthetic Worker', status: 'in_progress',
                    training_status: 'in_progress', responsible_restricted: true,
                    items: [{ id: 1, title: 'Safe step', done: false }], total_items: 1,
                    completed_items: 0, task_summary: { active: 1, completed: 0 } }] };
        };
        await h.api.load();
        assert.equal(h.api.readOnly(), true);
        assert.equal(h.button.hidden, true);
        assert.match(h.list.textContent, /загальний онбординг Парку/i);
        assert.match(h.list.textContent, /дані відповідального недоступні/i);
        assert.equal(h.list.querySelector('input[type="checkbox"]'), null);
        assert.equal(h.list.getAttribute('aria-busy'), 'false');
        assert.deepEqual(writes.map(call => call[0]), ['/onboarding']);

        h.window.__fetch = async () => ({ success: false, status: 403, code: 'staff_not_migrated' });
        await h.api.load();
        assert.equal(h.button.hidden, true);
        assert.equal(h.list.getAttribute('aria-busy'), 'false');
        assert.ok(h.list.querySelector('[role="alert"]'));
        assert.ok(h.list.querySelector('button[onclick="loadOnboarding()"]'));
        assert.doesNotMatch(h.list.textContent, /Synthetic Worker/);
    } finally { h.close(); }
});

test('late owner candidates from another business never repopulate the cache', async () => {
    const h = harness();
    try {
        let finishOld;
        h.window.__fetch = () => new Promise(resolve => { finishOld = resolve; });
        const pending = h.api.candidates(true);
        h.window.__context = 'dar';
        h.window.dispatchEvent(new h.window.Event('crmBusinessContextChanged'));
        finishOld({ success: true, data: [{ id: 1, name: 'Old Park Owner' }] });
        await assert.rejects(pending, /Бізнес або доступ змінився/);
        h.window.__fetch = async () => ({ success: true, data: [{ id: 2, name: 'Current Owner' }] });
        const current = await h.api.candidates();
        assert.equal(current[0].name, 'Current Owner');
        assert.equal((await h.api.candidates())[0].name, 'Current Owner');
    } finally { h.close(); }
});
