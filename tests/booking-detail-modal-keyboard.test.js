const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const uiSource = fs.readFileSync('js/ui.js', 'utf8');
const bookingSource = fs.readFileSync('js/booking.js', 'utf8');
const start = bookingSource.indexOf('async function showBookingDetails(bookingId, options = {})');
const end = bookingSource.indexOf('function selectedBanquetCandidateRole(bookingId)', start);
assert.ok(start >= 0 && end > start);

function setup() {
    const dom = new JSDOM('<button id="opener">Open</button><button id="other">Other</button><div id="bookingModal" class="modal hidden"><div class="modal-content"><button class="modal-close">Close</button><div id="bookingDetails"></div></div></div>', { runScripts: 'outside-only', url: 'http://localhost/' });
    const { window } = dom;
    Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', { get() { return this.closest('.hidden') ? null : this.parentElement; } });
    window.requestAnimationFrame = cb => window.setTimeout(cb, 0);
    window.eval(uiSource);
    window.eval(bookingSource.slice(start, end));
    window.resolveBookingDetailsRecord = async () => ({ booking: { id: 'slot', date: '2026-12-15', time: '12:00', duration: 45, lineId: 'line1' }, bookings: [] });
    window.addMinutesToTime = () => '12:45';
    window.getLinesForDate = async () => [{ id: 'line1', name: 'QA Line' }];
    window.isMaysternyaClosedSlotBooking = () => true;
    window.canDeleteTimelineBooking = () => true;
    window.escapeHtml = String;
    window.renderBookingCommentDetailRow = () => '';
    return { dom, window, modal: window.document.getElementById('bookingModal'), opener: window.document.getElementById('opener') };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 10));
const escape = (window, modal) => modal.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

test('canonical read-only detail closes with Escape and returns focus to its opener', async () => {
    const { dom, window, modal, opener } = setup();
    try {
        opener.focus(); await window.showBookingDetails('slot'); await settle();
        assert.equal(modal.contains(window.document.activeElement), true);
        escape(window, modal);
        assert.equal(modal.classList.contains('hidden'), true);
        assert.equal(window.document.activeElement, opener);
    } finally { dom.window.close(); }
});

test('canonical detail captures the opener before async lookup and retains it across refresh', async () => {
    const { dom, window, modal, opener } = setup();
    try {
        const resolve = window.resolveBookingDetailsRecord;
        let release;
        window.resolveBookingDetailsRecord = () => new Promise(done => { release = () => resolve().then(done); });
        opener.focus(); const opening = window.showBookingDetails('slot');
        window.document.getElementById('other').focus(); release(); await opening; await settle();
        window.resolveBookingDetailsRecord = resolve;
        modal.querySelector('button').focus();
        await window.showBookingDetails('slot'); await settle();
        escape(window, modal);
        assert.equal(modal.classList.contains('hidden'), true);
        assert.equal(window.document.activeElement, opener);
    } finally { dom.window.close(); }
});

test('canonical detail traps Tab and Shift+Tab and its close control restores focus', async () => {
    const { dom, window, modal, opener } = setup();
    try {
        opener.focus(); await window.showBookingDetails('slot'); await settle();
        const buttons = modal.querySelectorAll('button');
        buttons[buttons.length - 1].focus();
        const tab = new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
        buttons[buttons.length - 1].dispatchEvent(tab);
        assert.equal(tab.defaultPrevented, true);
        assert.equal(window.document.activeElement, buttons[0]);
        buttons[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
        assert.equal(window.document.activeElement, buttons[buttons.length - 1]);
        buttons[0].click();
        assert.equal(modal.classList.contains('hidden'), true);
        assert.equal(window.document.activeElement, opener);
    } finally { dom.window.close(); }
});

test('ordinary shared modal reopening still replaces the opener by default', async () => {
    const { dom, window, modal, opener } = setup();
    try {
        const other = window.document.getElementById('other');
        window.openModal(modal, opener); window.openModal(modal, other); window.closeModal(modal);
        assert.equal(window.document.activeElement, other);
    } finally { dom.window.close(); }
});

test('shared modal traps around collapsed and expanded details without hidden action targets', async () => {
    const { dom, window, modal, opener } = setup();
    try {
        modal.querySelector('#bookingDetails').innerHTML = '<details id="actions"><summary id="summary">More</summary><button id="action">Action</button></details>';
        const first = modal.querySelector('.modal-close');
        const summary = modal.querySelector('summary');
        const action = modal.querySelector('#action');
        window.openModal(modal, opener); await settle();
        const tab = (target, shiftKey = false) => target.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true }));
        first.focus(); tab(first, true);
        assert.equal(window.document.activeElement, summary, 'closed details summary is the last tabbable control');
        tab(summary);
        assert.equal(window.document.activeElement, first);
        modal.querySelector('details').open = true;
        first.focus(); tab(first, true);
        assert.equal(window.document.activeElement, action, 'expanded details exposes its action');
        tab(action);
        assert.equal(window.document.activeElement, first);
    } finally { dom.window.close(); }
});

test('read-only shared modal without controls keeps Tab focus on its content', async () => {
    const { dom, window, modal, opener } = setup();
    try {
        modal.querySelector('.modal-close').remove();
        window.openModal(modal, opener); await settle();
        const content = modal.querySelector('.modal-content');
        assert.equal(window.document.activeElement, content);
        for (const shiftKey of [false, true]) {
            const tab = new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
            content.dispatchEvent(tab);
            assert.equal(tab.defaultPrevented, true);
            assert.equal(window.document.activeElement, content);
        }
        escape(window, modal);
        assert.equal(window.document.activeElement, opener);
    } finally { dom.window.close(); }
});

test('nested details keep hidden inner summaries out of the modal focus boundary', async () => {
    const { dom, window, modal, opener } = setup();
    try {
        modal.querySelector('#bookingDetails').innerHTML = '<details id="outer"><summary id="outerSummary">Outer</summary><details id="inner"><summary id="innerSummary">Inner</summary><button id="innerAction">Action</button></details></details>';
        const first = modal.querySelector('.modal-close');
        const backwards = () => {
            first.focus();
            first.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
        };
        window.openModal(modal, opener); await settle(); backwards();
        assert.equal(window.document.activeElement.id, 'outerSummary');
        modal.querySelector('#outer').open = true; backwards();
        assert.equal(window.document.activeElement.id, 'innerSummary');
        modal.querySelector('#inner').open = true; backwards();
        assert.equal(window.document.activeElement.id, 'innerAction');
    } finally { dom.window.close(); }
});
