const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const decisionScreenSource = fs.readFileSync(path.join(ROOT, 'js', 'decision-screen.js'), 'utf8');

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function createDecisionScreen() {
    const dom = new JSDOM(`<!doctype html><body>
        <button id="previousFocus">Мій день</button>
        <div id="decisionScreen" class="hidden" role="dialog" aria-modal="true" aria-hidden="true">
            <div class="ds-inner">
                <div class="ds-header">
                    <span id="dsCount"></span>
                    <button type="button" data-decision-screen-dismiss>Закрити</button>
                </div>
                <div id="dsDecisionList"></div>
            </div>
        </div>
    </body>`, {
        runScripts: 'outside-only',
        url: 'https://crm.test/dashboard'
    });
    const { window } = dom;
    const calls = [];
    window.AppState = { currentUser: { id: 7 } };
    window.apiCall = async (method, url) => {
        calls.push({ method, url });
        return {
            decisions: [{
                id: 41,
                priority: 'important',
                title: 'Test decision',
                description: 'Must remain pending after dismissal.',
                created_at: new Date().toISOString(),
                created_by: 'test'
            }]
        };
    };
    window.requestAnimationFrame = callback => callback();
    window.eval(`${decisionScreenSource}\nwindow.__DecisionScreen = DecisionScreen;`);
    return { dom, window, calls, decisionScreen: window.__DecisionScreen };
}

test('Decision Center can be dismissed without resolving pending decisions', async () => {
    const { window, calls, decisionScreen } = createDecisionScreen();
    const previousFocus = window.document.getElementById('previousFocus');
    previousFocus.focus();

    await decisionScreen.init();
    const overlay = window.document.getElementById('decisionScreen');
    assert.equal(overlay.classList.contains('hidden'), false);
    assert.equal(window.document.body.classList.contains('ds-open'), true);

    window.document.querySelector('[data-decision-screen-dismiss]').click();
    await delay(320);

    assert.equal(overlay.classList.contains('hidden'), true);
    assert.equal(window.document.body.classList.contains('ds-open'), false);
    assert.equal(window.document.activeElement, previousFocus);
    assert.deepEqual(calls, [{ method: 'GET', url: '/decisions/pending' }]);
});

test('Escape closes Decision Center so sidebar navigation is no longer blocked', async () => {
    const { window, decisionScreen } = createDecisionScreen();
    await decisionScreen.init();
    const overlay = window.document.getElementById('decisionScreen');

    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await delay(320);

    assert.equal(overlay.classList.contains('hidden'), true);
    assert.equal(window.document.body.classList.contains('ds-open'), false);
});

test('Decision Center traps keyboard focus while open', async () => {
    const { window, decisionScreen } = createDecisionScreen();
    await decisionScreen.init();
    const overlay = window.document.getElementById('decisionScreen');
    const focusable = Array.from(overlay.querySelectorAll('button:not([disabled]), a[href]'));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    first.focus();
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    assert.equal(window.document.activeElement, last);

    last.focus();
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    assert.equal(window.document.activeElement, first);
});

test('Decision Center closes immediately for reduced-motion users', async () => {
    const { window, decisionScreen } = createDecisionScreen();
    window.matchMedia = () => ({ matches: true });
    await decisionScreen.init();
    const overlay = window.document.getElementById('decisionScreen');

    decisionScreen.dismiss();

    assert.equal(overlay.classList.contains('hidden'), true);
    assert.equal(window.document.body.classList.contains('ds-open'), false);
});

test('Dashboard exposes a visible non-mutating Decision Center exit', () => {
    const dashboard = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
    assert.match(dashboard, /data-decision-screen-dismiss/);
    assert.match(dashboard, /Продовжити роботу/);
    assert.doesNotMatch(dashboard, /Прийміть всі рішення щоб продовжити роботу/);
});
