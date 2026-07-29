'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function createClassList() {
    const values = new Set();
    return {
        add(...tokens) {
            tokens.filter(Boolean).forEach(token => values.add(token));
        },
        remove(...tokens) {
            tokens.forEach(token => values.delete(token));
        },
        toggle(token, force) {
            if (force === undefined) {
                if (values.has(token)) values.delete(token);
                else values.add(token);
                return values.has(token);
            }
            if (force) values.add(token);
            else values.delete(token);
            return Boolean(force);
        },
        contains(token) {
            return values.has(token);
        }
    };
}

function createFocusable(name, document) {
    const attrs = new Map();
    return {
        name,
        disabled: false,
        isConnected: true,
        focusCalls: 0,
        setAttribute(key, value) {
            attrs.set(key, String(value));
        },
        getAttribute(key) {
            return attrs.has(key) ? attrs.get(key) : null;
        },
        getBoundingClientRect() {
            return { top: 120, right: 360, bottom: 148, left: 240, width: 120, height: 28 };
        },
        focus() {
            this.focusCalls += 1;
            document.activeElement = this;
        }
    };
}

function loadTaskUiHarness({ mobile = true } = {}) {
    let mountedRoot = null;
    const documentListeners = {};
    const rootListeners = {};
    const document = {
        activeElement: null,
        documentElement: { classList: createClassList() },
        body: {
            classList: createClassList(),
            appendChild(node) {
                mountedRoot = node;
                node.isConnected = true;
            }
        },
        addEventListener(type, handler) {
            documentListeners[type] = handler;
        },
        getElementById(id) {
            return mountedRoot?.id === id ? mountedRoot : null;
        },
        createElement() {
            const closeButton = createFocusable('close', document);
            const historyLink = createFocusable('history', document);
            const panel = {
                style: {},
                getBoundingClientRect() {
                    return { width: 360, height: 280 };
                }
            };
            const root = {
                id: '',
                className: '',
                classList: createClassList(),
                isConnected: false,
                innerHTML: '',
                addEventListener(type, handler) {
                    rootListeners[type] = handler;
                },
                querySelector(selector) {
                    return selector === '.task-ui-action-panel' ? panel : null;
                },
                querySelectorAll() {
                    return [closeButton, historyLink];
                },
                remove() {
                    this.isConnected = false;
                    if (mountedRoot === this) mountedRoot = null;
                },
                _focusable: [closeButton, historyLink],
                _panel: panel
            };
            return root;
        }
    };
    const anchor = createFocusable('anchor', document);
    document.activeElement = anchor;
    const sandbox = {
        console,
        document,
        requestAnimationFrame(callback) {
            callback();
        },
        innerWidth: mobile ? 390 : 1280,
        innerHeight: mobile ? 844 : 800,
        matchMedia() {
            return { matches: mobile };
        },
        addEventListener() {},
        window: null
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'task-ui.js'), 'utf8'), sandbox);
    return {
        anchor,
        document,
        documentListeners,
        getRoot: () => mountedRoot,
        rootListeners,
        TaskUI: sandbox.TaskUI
    };
}

function keyboardEvent(root, key, shiftKey = false) {
    return {
        key,
        shiftKey,
        currentTarget: root,
        prevented: false,
        stopped: false,
        preventDefault() {
            this.prevented = true;
        },
        stopPropagation() {
            this.stopped = true;
        }
    };
}

test('shared task action surface synchronizes expanded state and traps keyboard focus', () => {
    const harness = loadTaskUiHarness({ mobile: true });
    const root = harness.TaskUI.openActionMenu(
        harness.anchor,
        '<a href="/tasks">History</a>',
        {
            title: 'Why moved',
            surfaceClassName: 'task-ui-action-surface--postponement'
        }
    );

    assert.equal(harness.anchor.getAttribute('aria-expanded'), 'true');
    assert.equal(harness.anchor.getAttribute('aria-controls'), 'taskUiActionSurface');
    assert.match(root.className, /is-sheet/);
    assert.equal(root.classList.contains('task-ui-action-surface--postponement'), true);
    assert.equal(root._focusable[0].focusCalls, 1);

    harness.document.activeElement = root._focusable[1];
    const tabForward = keyboardEvent(root, 'Tab');
    harness.rootListeners.keydown(tabForward);
    assert.equal(tabForward.prevented, true);
    assert.equal(harness.document.activeElement, root._focusable[0]);

    harness.document.activeElement = root._focusable[0];
    const tabBackward = keyboardEvent(root, 'Tab', true);
    harness.rootListeners.keydown(tabBackward);
    assert.equal(tabBackward.prevented, true);
    assert.equal(harness.document.activeElement, root._focusable[1]);

    const escape = keyboardEvent(root, 'Escape');
    harness.rootListeners.keydown(escape);
    assert.equal(escape.prevented, true);
    assert.equal(escape.stopped, true);
    assert.equal(harness.getRoot(), null);
    assert.equal(harness.anchor.getAttribute('aria-expanded'), 'false');
    assert.equal(harness.document.activeElement, harness.anchor);
});

test('shared task action surface closes on outside backdrop click and restores focus', () => {
    const harness = loadTaskUiHarness({ mobile: false });
    const root = harness.TaskUI.openActionMenu(harness.anchor, '<button>Action</button>', {
        title: 'Task actions'
    });

    assert.match(root.className, /is-popover/);
    const click = {
        target: {
            closest(selector) {
                return selector === '[data-task-ui-close]' ? {} : null;
            }
        },
        preventDefaultCalled: false,
        preventDefault() {
            this.preventDefaultCalled = true;
        }
    };
    harness.rootListeners.click(click);

    assert.equal(click.preventDefaultCalled, true);
    assert.equal(harness.getRoot(), null);
    assert.equal(harness.anchor.getAttribute('aria-expanded'), 'false');
    assert.equal(harness.document.activeElement, harness.anchor);
});
