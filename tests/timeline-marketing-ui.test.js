'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

function fixture() {
    const dom = new JSDOM('<main><div id="timelineScroll"><div id="timelineLines"><div class="line-grid"></div></div></div></main>', { url: 'http://localhost', runScripts: 'outside-only' });
    const w = dom.window;
    const state = { context: 'event_genix', token: 1, renders: 0, writes: [], notices: [] };
    w.TimelineBusinessContext = { current: () => ({ key: state.context }) };
    w.getCrmBusinessState = () => ({ businessScopeReadOnly: false });
    w.canAccess = () => true;
    w.CONFIG = { TIMELINE: { CELL_MINUTES: 15 } };
    w.getTimelineCellWidth = () => 30;
    w.getAuthHeaders = () => ({});
    w.apiFetchWithAuthRetry = async () => response({ promotions: [] });
    w.formatDate = date => typeof date === 'string' ? date : date.toISOString().slice(0, 10);
    w.invalidateTimelineDateCache = date => state.writes.push(date);
    w.timelineRequestTokenIsCurrent = token => token === state.token;
    w.renderTimeline = async () => { state.renders++; };
    w.showNotification = text => state.notices.push(text);
    w.hideTooltip = () => {};
    w.AppState = { selectedDate: new Date('2026-10-19T12:00:00Z') };
    w.openModal = element => element.classList.remove('hidden');
    w.closeModal = element => element.remove();
    w.HTMLElement.prototype.setPointerCapture = () => {};
    w.document.elementFromPoint = () => null;
    for (const name of ['timeline-marketing', 'afisha-import-form', 'timeline-afisha', 'timeline-promotions']) {
        w.eval(fs.readFileSync(path.join(__dirname, '../js', `${name}.js`), 'utf8'));
    }
    return { w, state, close: () => dom.window.close() };
}
const event = { id: 1, title: '<img src=x onerror=alert(1)>', date: '2026-10-19', time: '14:00', duration: 60, type: 'event', original_time: '14:00' };

test('the timeline opens a batch draft alongside the single-event form and refreshes all affected dates', async () => {
    const f = fixture();
    try {
        const requests = [];
        const days = ['2026-10-20', '2026-10-21'];
        f.w.apiFetchWithAuthRetry = async (url, options) => {
            const draft = JSON.parse(options.body);
            requests.push({ url, draft });
            return response(draft.commit ? { created: 2, skipped: 0 } : {
                items: days.map(date => ({ date, time: '14:00', title: '<img>', duration: 60 }))
            });
        };
        f.w.TimelineAfisha.quickCreate(days, null);
        const modal = f.w.document.querySelector('.timeline-marketing-modal');
        const single = modal.querySelector('[data-create-form]');
        const batch = modal.querySelector('[data-batch-form]');
        assert.equal(batch.hidden, true);
        single.elements.date.value = days[1];
        modal.querySelector('[data-afisha-mode="batch"]').click();
        assert.equal(single.hidden, true);
        assert.equal(batch.elements.importDate.value, days[1]);
        batch.elements.importDate.value = days[0];
        batch.elements.importText.value = '14:00;Шоу\n21;14:00;Квест';
        batch.dispatchEvent(new f.w.Event('submit', { cancelable: true }));
        await flush();
        assert.equal(batch.querySelectorAll('ol li').length, 2);
        assert.equal(batch.querySelector('img'), null);
        modal.querySelector('[data-afisha-mode="single"]').click();
        modal.querySelector('[data-afisha-mode="batch"]').click();
        assert.equal(batch.elements.importDate.value, days[0]);
        batch.querySelector('[data-import-save]').click();
        await flush();
        assert.deepEqual(requests.map(request => request.url), [
            '/api/afisha/timeline/import?businessContext=event_genix',
            '/api/afisha/timeline/import?businessContext=event_genix'
        ]);
        assert.deepEqual(requests[1].draft, { ...requests[0].draft, commit: true });
        assert.deepEqual(f.state.writes, days);
        assert.equal(f.state.renders, 1);
        assert.equal(modal.isConnected, false);
    } finally { f.close(); }
});

test('birthday slot editor labels the source and saves only the selected occurrence', async () => {
    const f = fixture();
    try {
        const slot = { key: 'first', base_time: '14:00', time: '15:30', mode: 'auto',
            reason: 'Перенесено з 14:00 через захід', duration: 15 };
        const item = { ...event, type: 'birthday', time: slot.time, birthdaySlot: slot };
        const trigger = f.w.document.createElement('button');
        f.w.document.body.appendChild(trigger);
        let payload;
        f.w.apiFetchWithAuthRetry = async (_url, options) => {
            payload = JSON.parse(options.body);
            return response({ slots: [{ ...slot, time: '15:45', mode: 'manual' }] });
        };
        f.w.TimelineAfisha.birthdayDetails(item, trigger);
        const modal = f.w.document.querySelector('.timeline-marketing-modal');
        assert.match(modal.textContent, /Автоматично/);
        assert.match(modal.textContent, /Перенесено з 14:00/);
        modal.querySelector('input[name="time"]').value = '15:45';
        modal.querySelector('[data-birthday-form]').dispatchEvent(new f.w.Event('submit', { bubbles: true, cancelable: true }));
        await flush(); await flush();
        assert.deepEqual(payload, { mode: 'manual', time: '15:45', expectedMode: 'auto', expectedTime: '15:30' });
        assert.equal(f.state.renders, 1);
        assert.equal(item.birthdaySlot.mode, 'manual');
    } finally { f.close(); }
});

test('ordinary fifteen-minute Іменинники event uses its own slot editor', async () => {
    const f = fixture();
    try {
        const slot = { key: 'single', base_time: '14:00', time: '15:30', mode: 'auto',
            reason: 'Перенесено з 14:00: Захід', duration: 15 };
        const item = { ...event, title: 'Іменинники', type: 'greeting', duration: 15, template_id: 6,
            time: slot.time, birthdaySlot: slot };
        const grid = f.w.document.querySelector('.line-grid');
        const flag = f.w.TimelineAfisha.create(item, 12, grid);
        grid.appendChild(flag);
        flag.click();
        const modal = f.w.document.querySelector('.timeline-marketing-modal');
        assert.match(modal.textContent, /15:30–15:45/);
        assert.match(modal.textContent, /Автоматично/);
        assert.ok(modal.querySelector('[data-birthday-form]'));
        assert.ok(modal.querySelector('[data-assign-form]'));
        assert.match(flag.getAttribute('aria-label'), /15 хв, автоматично/);
    } finally { f.close(); }
});

test('unavailable greeting is red and visibly calls for attention in both timeline and overview', async () => {
    const f = fixture();
    try {
        const slot = { key: 'single', base_time: '14:00', time: '14:00', mode: 'auto',
            duration: 15, conflict: true, conflict_kind: 'no_available_slot',
            reason: 'Немає вільних 15 хвилин у межах ±90 хв' };
        const item = { ...event, type: 'greeting', title: 'Іменинники', duration: 15,
            birthday_slots: [slot], birthdaySlot: slot };
        const flag = f.w.TimelineAfisha.create(item, 12, f.w.document.querySelector('.line-grid'));
        assert.ok(flag.classList.contains('afisha-birthday--conflict'));
        assert.match(flag.textContent, /Немає вільного часу/);
        assert.match(flag.getAttribute('aria-label'), /Немає вільних 15 хвилин/);
        f.w.TimelinePromotions.mount(f.w.document.getElementById('timelineLines'), [item.date], 1, [item]);
        await flush();
        assert.match(f.w.document.querySelector('.timeline-marketing-count--conflict').textContent, /Потрібна увага 1/);
        f.w.document.querySelector('[data-toggle-marketing]').click();
        const summary = f.w.document.querySelector('.timeline-afisha-summary-event--conflict');
        assert.match(summary.textContent, /Немає вільного часу/);
        flag.click();
        assert.match(f.w.document.querySelector('.afisha-birthday-warning').textContent, /Немає вільних 15 хвилин/);
    } finally { f.close(); }
});

test('expanded marketing overview survives a timeline redraw in the same business', async () => {
    const f = fixture();
    try {
        const lines = f.w.document.getElementById('timelineLines');
        f.w.TimelinePromotions.mount(lines, ['2026-10-19'], 1);
        await flush();
        f.w.document.querySelector('[data-toggle-marketing]').click();
        f.w.TimelinePromotions.beginRender();
        f.w.TimelinePromotions.mount(lines, ['2026-10-20'], 1);
        await flush();
        assert.equal(f.w.document.querySelector('[data-toggle-marketing]').getAttribute('aria-expanded'), 'true');
    } finally { f.close(); }
});

test('collapsed overview opens a recurring greeting at its effective time and shows its source', async () => {
    const f = fixture();
    try {
        f.w.TimelinePromotions.mount(f.w.document.getElementById('timelineLines'), ['2026-10-19'], 1, [{
            ...event, title: 'Іменинники', type: 'greeting', duration: 15, birthday_slots: [{ key: 'single',
                time: '15:30', base_time: '14:00', mode: 'auto', duration: 15 }]
        }]);
        await flush();
        f.w.document.querySelector('[data-toggle-marketing]').click();
        const button = f.w.document.querySelector('.timeline-afisha-summary-event');
        assert.match(button.textContent, /10-19 · 15:30/);
        assert.match(button.textContent, /Авто/);
        assert.match(button.getAttribute('aria-label'), /15:30, автоматично/);
        button.click();
        assert.match(f.w.document.querySelector('.timeline-marketing-modal').textContent, /15:30–15:45/);
    } finally { f.close(); }
});

test('overlapping flags receive distinct lanes below bookings and text cannot inject HTML', () => {
    const f = fixture();
    try {
        const grid = f.w.document.querySelector('.line-grid');
        const booking = f.w.document.createElement('div'); booking.className = 'booking-block';
        booking.getBoundingClientRect = () => ({ bottom: 80 }); grid.appendChild(booking);
        const first = f.w.TimelineAfisha.create(event, 12, grid);
        const second = f.w.TimelineAfisha.create({ ...event, id: 2, time: '14:05' }, 12, grid);
        grid.append(first, second); f.w.TimelineAfisha.layout(grid);
        assert.equal(grid.querySelector('img'), null);
        assert.equal(first.textContent.includes(event.title), true);
        assert.equal(first.style.top, '85px');
        assert.equal(second.style.top, '119px');
        assert.equal(grid.style.minHeight, '158px');
    } finally { f.close(); }
});
test('a pending move blocks another save of the same event and failure releases the lock', async () => {
    const f = fixture();
    try {
        const wait = deferred(); f.w.apiFetchWithAuthRetry = () => wait.promise;
        const save = f.w.TimelineAfisha.save({ ...event }, event.date, '14:05', 'event_genix');
        await assert.rejects(f.w.TimelineAfisha.save({ ...event }, event.date, '14:10', 'event_genix'), /ще триває/);
        wait.resolve(response({ error: 'Server failure' }, 500));
        await assert.rejects(save, /Server failure/);
        f.w.apiFetchWithAuthRetry = async () => response({ item: { ...event, time: '14:10' } });
        const item = await f.w.TimelineAfisha.save({ ...event }, event.date, '14:10', 'event_genix');
        assert.equal(item.time, '14:10');
    } finally { f.close(); }
});
test('conflict refreshes the current view but a stale business cannot start a mutation', async () => {
    const f = fixture();
    try {
        f.w.apiFetchWithAuthRetry = async () => response({ error: 'Conflict' }, 409);
        await assert.rejects(f.w.TimelineAfisha.save({ ...event }, event.date, '14:05', 'event_genix'), /Conflict/);
        assert.equal(f.state.renders, 1);
        f.state.context = 'dar';
        await assert.rejects(f.w.TimelineAfisha.save({ ...event }, event.date, '14:05', 'event_genix'), /контекст/);
    } finally { f.close(); }
});
test('pointer cancellation restores the position without saving or opening a dialog', () => {
    const f = fixture();
    try {
        const grid = f.w.document.querySelector('.line-grid');
        const block = f.w.TimelineAfisha.create(event, 12, grid); grid.appendChild(block);
        const initial = block.style.left;
        block.dispatchEvent(new f.w.MouseEvent('pointerdown', { button: 0, clientX: 100, clientY: 10 }));
        block.dispatchEvent(new f.w.MouseEvent('pointermove', { clientX: 160, clientY: 10 }));
        assert.notEqual(block.style.left, initial);
        block.dispatchEvent(new f.w.MouseEvent('pointercancel'));
        assert.equal(block.style.left, initial);
        assert.equal(f.w.TimelineAfisha.dragging(), false);
        assert.equal(f.w.document.querySelector('.timeline-marketing-modal'), null);
    } finally { f.close(); }
});
test('stale promotion responses cannot replace a newer date range', async () => {
    const f = fixture();
    try {
        const first = deferred(); const second = deferred(); let n = 0;
        f.w.apiFetchWithAuthRetry = () => (++n === 1 ? first : second).promise;
        const container = f.w.document.getElementById('timelineLines');
        f.w.TimelinePromotions.mount(container, ['2026-10-19'], 1);
        f.state.token = 2; f.w.TimelinePromotions.beginRender();
        f.w.TimelinePromotions.mount(container, ['2026-10-26'], 2);
        second.resolve(response({ promotions: [] })); await flush();
        first.resolve(response({ promotions: [{ id: 1, title: 'Old', color_key: 'amber', starts_on: '2026-10-19', ends_on: '2026-10-19' }] })); await flush();
        assert.equal(f.w.document.querySelector('.timeline-promotions').textContent.includes('Old'), false);
        assert.equal(f.w.document.querySelector('.timeline-promotions').dataset.visibleFrom, '2026-10-26');
    } finally { f.close(); }
});
test('a promotion failure preserves booking content and retries independently', async () => {
    const f = fixture();
    try {
        const container = f.w.document.getElementById('timelineLines');
        container.querySelector('.line-grid').textContent = 'Booking remains';
        f.w.apiFetchWithAuthRetry = async () => response({ error: 'Unavailable' }, 500);
        f.w.TimelinePromotions.mount(container, ['2026-10-19'], 1); await flush();
        assert.equal(container.textContent, 'Booking remains');
        assert.ok(f.w.document.querySelector('.timeline-promotions [role="alert"]'));
        f.w.apiFetchWithAuthRetry = async () => response({ promotions: [] });
        f.w.document.querySelector('.timeline-promotions button').click(); await flush();
        assert.ok(f.w.document.querySelector('[data-toggle-marketing]'));
        f.w.document.querySelector('[data-toggle-marketing]').click();
        assert.ok(f.w.document.querySelector('[data-add]'));
    } finally { f.close(); }
});

test('promotions and Afisha share one collapsed overview and one accessible toggle', async () => {
    const f = fixture();
    try {
        f.w.apiFetchWithAuthRetry = async () => response({ promotions: Array.from({ length: 5 }, (_, index) => ({
            id: index + 1, title: `Promotion ${index + 1}`, description: '', color_key: 'amber',
            starts_on: '2026-10-19', ends_on: '2026-10-25', version: 1
        })) });
        f.w.TimelinePromotions.mount(f.w.document.getElementById('timelineLines'), Array.from({ length: 7 }, (_, index) => `2026-10-${String(19 + index).padStart(2, '0')}`), 1);
        await flush();
        const panel = f.w.document.querySelector('.timeline-promotions');
        assert.equal(panel.querySelector('[data-toggle-marketing]').getAttribute('aria-expanded'), 'false');
        assert.equal(panel.querySelector('[data-toggle-marketing]').getAttribute('aria-controls'), 'timelineMarketingDetails');
        assert.equal(panel.querySelectorAll('.timeline-marketing-toggle').length, 1);
        assert.equal(panel.querySelector('.timeline-marketing-body').hidden, true);
        assert.equal(panel.querySelectorAll('.timeline-promotion-row').length, 0);
        panel.querySelector('[data-toggle-marketing]').click();
        assert.equal(panel.querySelector('[data-toggle-marketing]').getAttribute('aria-expanded'), 'true');
        assert.equal(panel.querySelector('.timeline-marketing-body').hidden, false);
        assert.equal(panel.querySelectorAll('.timeline-promotion-row').length, 2);
        assert.equal(panel.querySelector('[data-more]').textContent, 'Ще 3');
        panel.querySelector('[data-more]').click();
        assert.equal(panel.querySelectorAll('.timeline-promotion-row').length, 5);
        panel.querySelector('[data-less]').click();
        assert.equal(panel.querySelectorAll('.timeline-promotion-row').length, 2);
        panel.querySelector('[data-toggle-marketing]').click();
        assert.equal(panel.querySelectorAll('.timeline-promotion-row').length, 0);
        assert.equal(panel.querySelector('.timeline-marketing-body').hidden, true);
    } finally { f.close(); }
});

test('read-only viewers can open Afisha and promotions without mutation controls', async () => {
    const f = fixture();
    try {
        f.w.canAccess = () => false;
        const grid = f.w.document.querySelector('.line-grid');
        const flag = f.w.TimelineAfisha.create({ ...event, promotion_id: 7, promotion_title: 'Осіння акція',
            promotion_active: false, line_id: '1', line_name: 'Олена', second_line_id: '2', second_line_name: 'Ірина' }, 12, grid);
        grid.appendChild(flag); flag.click();
        assert.ok(f.w.document.querySelector('.timeline-marketing-modal a'));
        assert.match(f.w.document.querySelector('.timeline-marketing-modal').textContent, /Архівована акція: Осіння акція/);
        assert.match(f.w.document.querySelector('.timeline-marketing-modal').textContent, /Аніматори: Олена, Ірина/);
        assert.equal(f.w.document.querySelector('[data-move]'), null);
        f.w.closeModal(f.w.document.querySelector('.timeline-marketing-modal'));
        f.w.apiFetchWithAuthRetry = async () => response({ promotions: [{ id: 1, title: 'Read me', description: '',
            color_key: 'amber', starts_on: '2026-10-19', ends_on: '2026-10-19', version: 1 }] });
        f.w.TimelinePromotions.mount(f.w.document.getElementById('timelineLines'), ['2026-10-19'], 1); await flush();
        assert.equal(f.w.document.querySelector('[data-add]'), null);
        f.w.document.querySelector('[data-toggle-marketing]').click();
        f.w.document.querySelector('.promotion-label').click();
        assert.equal(f.w.document.querySelector('.timeline-marketing-modal input[name="title"]').readOnly, true);
        assert.equal(f.w.document.querySelector('.timeline-marketing-modal button[type="submit"]'), null);
    } finally { f.close(); }
});

test('promotion conflict retains a draft and offers the fresh server version', async () => {
    const f = fixture();
    try {
        let version = 1;
        f.w.apiFetchWithAuthRetry = async (url, options) => {
            if (options.method === 'PATCH') { version = 2; return response({ error: 'Conflict' }, 409); }
            return response({ promotions: [{ id: 1, title: version === 1 ? 'Original' : 'Server title', description: '',
                color_key: 'amber', starts_on: '2026-10-19', ends_on: '2026-10-19', version }] });
        };
        f.w.TimelinePromotions.mount(f.w.document.getElementById('timelineLines'), ['2026-10-19'], 1); await flush();
        f.w.document.querySelector('[data-toggle-marketing]').click();
        f.w.document.querySelector('.promotion-label').click();
        const form = f.w.document.querySelector('.timeline-marketing-form');
        form.elements.title.value = 'My draft';
        form.dispatchEvent(new f.w.Event('submit', { cancelable: true })); await flush(); await flush();
        assert.equal(form.elements.title.value, 'My draft');
        assert.equal(f.w.document.querySelector('.promotion-label').textContent.includes('Server title'), true);
        f.w.document.querySelector('[data-error] button').click();
        assert.equal(f.w.document.querySelector('input[name="title"]').value, 'Server title');
    } finally { f.close(); }
});

test('one toggle reveals Afisha and promotions together, with linked events inside their promotion', async () => {
    const f = fixture();
    try {
        f.w.apiFetchWithAuthRetry = async () => response({ promotions: [{ id: 7, title: 'Акція', description: '',
            color_key: 'amber', starts_on: '2026-10-19', ends_on: '2026-10-19', version: 1 }] });
        f.w.TimelinePromotions.mount(f.w.document.getElementById('timelineLines'), ['2026-10-19'], 1,
            [{ ...event, promotion_id: 7 }, { ...event, id: 2, title: 'Окрема подія' }]);
        await flush();
        const panel = f.w.document.querySelector('.timeline-promotions');
        assert.match(panel.textContent, /Акції/);
        assert.match(panel.textContent, /Афіша/);
        assert.equal(panel.querySelector('[data-toggle-marketing]').getAttribute('aria-expanded'), 'false');
        assert.match(panel.querySelector('.timeline-marketing-counts').textContent, /Акції 1.*Афіша 2/);
        assert.equal(panel.querySelectorAll('.timeline-afisha-summary-event').length, 0);
        panel.querySelector('[data-toggle-marketing]').click();
        assert.equal(panel.querySelectorAll('.timeline-afisha-summary-event').length, 2);
        assert.equal(panel.querySelectorAll('[data-linked-afisha]').length, 1);
        assert.equal(panel.querySelector('[data-linked-afisha]').textContent.includes('Окрема подія'), false);
        panel.querySelector('[data-toggle-marketing]').click();
        assert.equal(panel.querySelectorAll('.timeline-afisha-summary-event, .timeline-promotion-row').length, 0);
    } finally { f.close(); }
});

test('a promotion starts a linked event and archived links remain visible in a compact Afisha summary', async () => {
    const f = fixture();
    try {
        f.w.apiFetchWithAuthRetry = async () => response({ promotions: [{ id: 7, title: 'Акція', description: '',
            color_key: 'amber', starts_on: '2026-10-19', ends_on: '2026-10-20', version: 1 }] });
        const events = [
            { ...event, id: 1, promotion_id: 9, promotion_title: 'Минула акція', promotion_active: false },
            ...[2, 3, 4].map(id => ({ ...event, id, title: `Подія ${id}` }))
        ];
        f.w.TimelinePromotions.mount(f.w.document.getElementById('timelineLines'), ['2026-10-19', '2026-10-20'], 1, events);
        await flush();
        const panel = f.w.document.querySelector('.timeline-promotions');
        assert.equal(panel.querySelectorAll('.timeline-afisha-summary-event').length, 0);
        panel.querySelector('[data-toggle-marketing]').click();
        assert.equal(panel.querySelectorAll('.timeline-afisha-summary-event').length, 3);
        assert.match(panel.querySelector('.timeline-afisha-summary').textContent, /Архівована акція: Минула акція/);
        panel.querySelector('[data-more-afisha]').click();
        assert.equal(panel.querySelectorAll('.timeline-afisha-summary-event').length, 4);
        panel.querySelector('[data-less-afisha]').click();
        assert.equal(panel.querySelectorAll('.timeline-afisha-summary-event').length, 3);
        panel.querySelector('[data-add-linked-afisha]').click();
        const form = f.w.document.querySelector('[data-create-form]');
        assert.equal(form.elements.promotion.value, '7');
        assert.equal(form.elements.date.value, '2026-10-19');
        f.w.closeModal(f.w.document.querySelector('.timeline-marketing-modal'));
        panel.querySelector('.promotion-label').click();
        f.w.document.querySelector('[data-add-linked-from-dialog]').click();
        assert.equal(f.w.document.querySelector('[data-create-form]').elements.promotion.value, '7');
    } finally { f.close(); }
});

test('day Afisha lane shows an all-day promotion above timed events', async () => {
    const f = fixture();
    try {
        const grid = f.w.document.querySelector('.line-grid');
        grid.classList.add('afisha-line-grid');
        grid.dataset.lineId = 'afisha';
        const flag = f.w.TimelineAfisha.create(event, 12, grid);
        grid.appendChild(flag);
        f.w.apiFetchWithAuthRetry = async () => response({ promotions: [{ id: 7, title: 'Осіння акція', description: '',
            color_key: 'amber', starts_on: '2026-10-19', ends_on: '2026-10-20', version: 1 }] });
        f.w.TimelinePromotions.mount(f.w.document.getElementById('timelineLines'), ['2026-10-19'], 1,
            [{ ...event, promotion_id: 7 }]);
        await flush();
        const card = grid.querySelector('.afisha-all-day-card');
        assert.ok(card);
        assert.match(card.textContent, /Весь день.*Осіння акція/);
        assert.equal(grid.dataset.afishaAllDayCount, '1');
        assert.equal(flag.style.top, '45px');
        assert.equal(grid.style.minHeight, '84px');
        f.w.document.querySelector('[data-toggle-marketing]').click();
        assert.match(f.w.document.querySelector('.timeline-afisha-summary-event').textContent, /Акція: Осіння акція/);
        f.w.document.querySelector('[data-toggle-marketing]').click();
        assert.ok(grid.querySelector('.afisha-all-day-card'), 'collapsing the summary keeps the all-day timeline band');
        grid.style.setProperty('--afisha-all-day-step', '48px');
        f.w.TimelineAfisha.layout(grid);
        assert.equal(flag.style.top, '57px');
        assert.equal(grid.style.minHeight, '96px');
        card.click();
        assert.equal(f.w.document.querySelector('.timeline-marketing-modal input[name="title"]').value, 'Осіння акція');
    } finally { f.close(); }
});

test('all-day promotion keeps birthday greetings below its band', async () => {
    const f = fixture();
    try {
        const grid = f.w.document.querySelector('.line-grid');
        grid.classList.add('afisha-line-grid');
        grid.dataset.lineId = 'afisha';
        const birthday = f.w.document.createElement('div');
        birthday.className = 'booking-block afisha-type-birthday';
        birthday.getBoundingClientRect = () => ({ top: 0, bottom: 28, height: 28 });
        grid.appendChild(birthday);
        const flag = f.w.TimelineAfisha.create(event, 12, grid);
        grid.appendChild(flag);
        f.w.apiFetchWithAuthRetry = async () => response({ promotions: [{ id: 7, title: 'Акція', color_key: 'amber',
            starts_on: '2026-10-19', ends_on: '2026-10-19' }] });
        f.w.TimelinePromotions.mount(f.w.document.getElementById('timelineLines'), ['2026-10-19'], 1);
        await flush();
        assert.equal(birthday.style.getPropertyValue('--afisha-neighbor-top'), '45px');
        assert.equal(flag.style.top, '78px');
        assert.equal(grid.style.minHeight, '117px');
    } finally { f.close(); }
});

test('week Afisha lanes show each active day and stack overlapping promotions', async () => {
    const f = fixture();
    try {
        const container = f.w.document.getElementById('timelineLines');
        container.innerHTML = ['19', '20', '21'].map(day => `<section class="day-section" data-date="2026-10-${day}">
            <div class="mini-timeline-line"><div class="mini-line-grid" data-line-id="afisha"></div></div></section>`).join('');
        f.w.apiFetchWithAuthRetry = async () => response({ promotions: [
            { id: 7, title: 'Осіння акція', color_key: 'amber', starts_on: '2026-10-19', ends_on: '2026-10-20' },
            { id: 8, title: 'Друга акція', color_key: 'blue', starts_on: '2026-10-20', ends_on: '2026-10-20' }
        ] });
        f.w.TimelinePromotions.mount(container, ['2026-10-19', '2026-10-20', '2026-10-21'], 1);
        await flush();
        const grids = [...container.querySelectorAll('.mini-line-grid')];
        assert.deepEqual(grids.map(grid => grid.querySelectorAll('.afisha-all-day-card').length), [1, 2, 0]);
        assert.equal(grids[1].style.minHeight, '86px');
        assert.equal(grids[2].closest('.mini-timeline-line').classList.contains('has-afisha-all-day'), false);
    } finally { f.close(); }
});

test('quick create sends one Afisha event with optional promotion and two animator IDs', async () => {
    const f = fixture();
    try {
        f.w.AppState.linesByDate = { '2026-10-19': [{ id: '1', name: 'Перший' }, { id: '2', name: 'Другий' }] };
        const calls = [];
        f.w.apiFetchWithAuthRetry = async (url, options) => {
            if (options.method === 'POST') { calls.push(JSON.parse(options.body)); return response({ item: { id: 8 } }, 201); }
            return response({ promotions: [{ id: 7, title: 'Акція', description: '', color_key: 'amber',
                starts_on: '2026-10-19', ends_on: '2026-10-19', version: 1 }] });
        };
        f.w.TimelinePromotions.mount(f.w.document.getElementById('timelineLines'), ['2026-10-19'], 1, []);
        await flush();
        f.w.document.querySelector('[data-toggle-marketing]').click();
        f.w.document.querySelector('[data-add-afisha]').click();
        const form = f.w.document.querySelector('[data-create-form]');
        form.elements.title.value = 'Новий захід';
        form.elements.promotion.value = '7';
        form.querySelectorAll('[data-lines] input').forEach(input => { input.checked = true; });
        form.dispatchEvent(new f.w.Event('submit', { cancelable: true }));
        await flush();
        assert.equal(calls.length, 1);
        assert.equal(calls[0].promotionId, 7);
        assert.deepEqual(calls[0].lineIds, ['1', '2']);
        assert.equal(f.state.renders, 1);
    } finally { f.close(); }
});

test('dragging a general Afisha flag to an animator adds a linked assignment', async () => {
    const f = fixture();
    try {
        const general = f.w.document.querySelector('.line-grid');
        general.dataset.lineId = 'afisha';
        const target = f.w.document.createElement('div');
        target.className = 'line-grid'; target.dataset.lineId = '1';
        f.w.document.getElementById('timelineLines').appendChild(target);
        f.w.document.elementFromPoint = () => target;
        let payload;
        f.w.apiFetchWithAuthRetry = async (url, options) => {
            payload = JSON.parse(options.body);
            return response({ item: { ...event, line_id: '1', second_line_id: null, promotion_id: null } });
        };
        const flag = f.w.TimelineAfisha.create(event, 12, general);
        general.appendChild(flag);
        flag.dispatchEvent(new f.w.MouseEvent('pointerdown', { button: 0, clientX: 100, clientY: 10 }));
        flag.dispatchEvent(new f.w.MouseEvent('pointermove', { clientX: 100, clientY: 100 }));
        flag.dispatchEvent(new f.w.MouseEvent('pointerup', { clientX: 100, clientY: 100 }));
        await flush();
        assert.deepEqual(payload.lineIds, ['1']);
        assert.deepEqual(payload.expectedLineIds, []);
        assert.equal(f.state.renders, 1);
    } finally { f.close(); }
});

test('dragging an animator copy moves or removes only that assignment', async () => {
    for (const { targetId, expected } of [
        { targetId: '3', expected: ['2', '3'] }, { targetId: 'afisha', expected: ['2'] }
    ]) {
        const f = fixture();
        try {
            const source = f.w.document.querySelector('.line-grid');
            source.dataset.lineId = '1';
            const target = f.w.document.createElement('div');
            target.className = 'line-grid'; target.dataset.lineId = targetId;
            f.w.document.getElementById('timelineLines').appendChild(target);
            f.w.document.elementFromPoint = () => target;
            const item = { ...event, line_id: '1', second_line_id: '2', promotion_id: null };
            let payload;
            f.w.apiFetchWithAuthRetry = async (url, options) => {
                payload = JSON.parse(options.body);
                return response({ item: { ...item, line_id: expected[0], second_line_id: expected[1] || null } });
            };
            const flag = f.w.TimelineAfisha.create(item, 12, source);
            source.appendChild(flag);
            flag.dispatchEvent(new f.w.MouseEvent('pointerdown', { button: 0, clientX: 100, clientY: 10 }));
            flag.dispatchEvent(new f.w.MouseEvent('pointermove', { clientX: 100, clientY: 100 }));
            flag.dispatchEvent(new f.w.MouseEvent('pointerup', { clientX: 100, clientY: 100 }));
            await flush();
            assert.deepEqual(payload.lineIds, expected);
            assert.deepEqual(payload.expectedLineIds, ['1', '2']);
        } finally { f.close(); }
    }
});

test('week view keeps the Afisha anchor and both animator copies', async () => {
    const f = fixture();
    try {
        f.w.CONFIG.TIMELINE.WEEKDAY_START = 12;
        f.w.CONFIG.TIMELINE.WEEKDAY_END = 20;
        f.w.timelineShouldRenderAfisha = () => true;
        f.w.isRoomTimelineView = () => false;
        f.w.apiGetAfishaByDate = async () => [{ ...event, line_id: '1', second_line_id: '2' }];
        const container = f.w.document.getElementById('timelineLines');
        container.innerHTML = '<section class="day-section" data-date="2026-10-19"><div class="mini-timeline-lines">'
            + '<div class="mini-timeline-line"><div class="mini-line-grid" data-line-id="1"></div></div>'
            + '<div class="mini-timeline-line"><div class="mini-line-grid" data-line-id="2"></div></div>'
            + '</div></section>';
        const items = await f.w.TimelineAfisha.mountWeek(container, [new Date('2026-10-19T12:00:00Z')], 1);
        assert.equal(items.length, 1);
        assert.equal(container.querySelectorAll('.mini-line-grid[data-line-id="afisha"] .afisha-flag').length, 1);
        assert.equal(container.querySelectorAll('.mini-line-grid[data-line-id="1"] .afisha-flag').length, 1);
        assert.equal(container.querySelectorAll('.mini-line-grid[data-line-id="2"] .afisha-flag').length, 1);
    } finally { f.close(); }
});
