const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const repoRoot = path.resolve('.');
const uiCode = fs.readFileSync(path.join(repoRoot, 'js', 'ui.js'), 'utf8');

function createDom(confirmResult = false) {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
        runScripts: 'outside-only',
        url: 'http://localhost/'
    });
    dom.window.confirmModal = async () => confirmResult;
    dom.window.confirm = () => confirmResult;
    dom.window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    dom.window.eval(uiCode);
    return dom;
}

function createEditableSurface(window) {
    const modal = window.document.createElement('div');
    modal.id = 'editableSurface';
    modal.className = 'modal';
    modal.innerHTML = '<input id="surfaceName" value="initial">';
    window.document.body.appendChild(modal);
    const input = modal.querySelector('#surfaceName');
    return { modal, input };
}

async function flushAsyncHandlers() {
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
}

test('UnsafeDismissGuard blocks dirty backdrop close when discard is rejected', async () => {
    const dom = createDom(false);
    const { modal, input } = createEditableSurface(dom.window);
    let closed = false;

    dom.window.UnsafeDismissGuard.remember(modal);
    input.value = 'changed';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    dom.window.UnsafeDismissGuard.bindBackdropClose(modal, () => {
        closed = true;
        modal.classList.add('hidden');
    });

    modal.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await flushAsyncHandlers();
    dom.window.document.querySelector('.confirm-cancel')?.click();
    await flushAsyncHandlers();

    assert.equal(closed, false);
    assert.equal(modal.classList.contains('hidden'), false);
});

test('UnsafeDismissGuard blocks dirty Escape close when discard is rejected', async () => {
    const dom = createDom(false);
    const { modal, input } = createEditableSurface(dom.window);
    let closed = false;

    dom.window.UnsafeDismissGuard.remember(modal);
    input.value = 'changed';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    dom.window.UnsafeDismissGuard.bindEscapeClose(modal, () => {
        closed = true;
        modal.classList.add('hidden');
    });

    modal.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true
    }));
    await flushAsyncHandlers();
    dom.window.document.querySelector('.confirm-cancel')?.click();
    await flushAsyncHandlers();

    assert.equal(closed, false);
    assert.equal(modal.classList.contains('hidden'), false);
});

test('UnsafeDismissGuard blocks dirty route or selection transition before DOM removal', async () => {
    const dom = createDom(false);
    const { modal, input } = createEditableSurface(dom.window);
    let transitioned = false;

    dom.window.UnsafeDismissGuard.remember(modal);
    input.value = 'changed';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

    dom.window.UnsafeDismissGuard.attemptCloseEditableSurface(modal, () => {
        transitioned = true;
        modal.remove();
    }, { reason: 'route-transition' });
    await flushAsyncHandlers();
    dom.window.document.querySelector('.confirm-cancel')?.click();
    await flushAsyncHandlers();

    assert.equal(transitioned, false);
    assert.equal(dom.window.document.getElementById('editableSurface'), modal);
});

test('closeModal routes dirty editable surfaces through the guard before hiding', async () => {
    const dom = createDom(false);
    const { modal, input } = createEditableSurface(dom.window);

    dom.window.UnsafeDismissGuard.remember(modal);
    input.value = 'changed';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

    const result = dom.window.closeModal(modal);
    await flushAsyncHandlers();
    dom.window.document.querySelector('.confirm-cancel')?.click();
    await flushAsyncHandlers();

    assert.equal(result, false);
    assert.equal(modal.classList.contains('hidden'), false);
});

test('closeModal hides dirty editable surfaces after confirmed discard', async () => {
    const dom = createDom(true);
    const { modal, input } = createEditableSurface(dom.window);

    dom.window.UnsafeDismissGuard.remember(modal);
    input.value = 'changed';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

    dom.window.closeModal(modal);
    await flushAsyncHandlers();
    dom.window.document.querySelector('.confirm-ok')?.click();
    await flushAsyncHandlers();

    assert.equal(modal.classList.contains('hidden'), true);
});

test('read-only modal still dismisses without dirty confirmation', async () => {
    const dom = createDom(false);
    const modal = dom.window.document.createElement('div');
    modal.id = 'readOnlySurface';
    modal.className = 'modal';
    modal.innerHTML = '<div>Read only details</div>';
    dom.window.document.body.appendChild(modal);

    dom.window.closeModal(modal);
    await flushAsyncHandlers();

    assert.equal(modal.classList.contains('hidden'), true);
    assert.equal(dom.window.document.querySelector('.confirm-overlay'), null);
});
