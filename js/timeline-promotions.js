/* Server-backed informational periods. They never participate in booking prices. */
(function () {
    'use strict';
    const M = window.TimelineMarketing;
    const colors = { amber: 'Бурштиновий', violet: 'Фіолетовий', green: 'Зелений', blue: 'Блакитний' };
    let panel = null;
    let view = null;
    let gesture = null;
    let selecting = false;
    let keyStart = null;
    let sequence = 0;
    let marketingOpen = false;
    let expanded = false;
    let afishaExpanded = false;
    const pending = new Set();

    function clearShading() {
        document.querySelectorAll('[data-promotion-color]').forEach(el => el.removeAttribute('data-promotion-color'));
    }
    function cancel() {
        const active = Boolean(gesture);
        if (gesture?.band) gesture.band.style.gridColumn = gesture.column;
        gesture = null;
        panel?.querySelectorAll('.promotion-preview').forEach(el => el.classList.remove('promotion-preview'));
        if (panel && view) {
            const status = panel.querySelector('.timeline-promotion-section .timeline-promotions-status');
            if (status) status.textContent = '';
        }
        return active;
    }
    function beginRender() {
        cancel(); sequence++; view = null; selecting = false; keyStart = null;
        panel?.remove(); panel = null; clearShading();
    }
    function canWrite() { return M.writable('manage_settings'); }
    function showAfisha() { return view?.business === 'event_genix'
        && (typeof timelineShouldRenderAfisha !== 'function' || timelineShouldRenderAfisha()); }
    function occurrence(event) {
        const slot = event.birthday_slots?.[0];
        return slot ? { ...event, time: slot.time, duration: 15, birthdaySlot: slot } : event;
    }
    function greetingStatus(slot) {
        if (!slot) return '';
        if (slot.conflict) return slot.conflict_kind === 'no_available_slot' ? 'Немає вільного часу' : 'Конфлікт часу';
        if (slot.mode === 'manual') return 'Вручну';
        return slot.base_time !== slot.time ? `${slot.base_time} → ${slot.time} · Авто` : 'Авто';
    }

    function renderAfishaSection() {
        if (!showAfisha() || !marketingOpen) return;
        panel.querySelector('.timeline-afisha-summary')?.remove();
        const events = (view.afishaEvents || []).filter(item => item.type !== 'birthday')
            .sort((a, b) => Number(Boolean(b.birthday_slots?.[0]?.conflict)) - Number(Boolean(a.birthday_slots?.[0]?.conflict)));
        const promotions = new Map((view.items || []).map(item => [Number(item.id), item]));
        const visible = afishaExpanded ? events : events.slice(0, 3);
        const hiddenCount = events.length - visible.length;
        const section = document.createElement('section');
        section.className = 'timeline-afisha-summary';
        section.setAttribute('aria-label', 'Афіша');
        section.innerHTML = `<div class="timeline-promotions-toolbar"><strong>Афіша</strong><span class="timeline-promotions-status"></span>
            ${hiddenCount ? `<button type="button" class="btn-secondary" data-more-afisha aria-expanded="false">Ще ${hiddenCount}</button>` : ''}
            ${afishaExpanded && events.length > 3 ? '<button type="button" class="btn-secondary" data-less-afisha aria-expanded="true">Показати менше</button>' : ''}
            ${M.writable('edit_booking') ? '<button type="button" class="btn-secondary" data-add-afisha>Додати захід</button>' : ''}</div>
            <div class="timeline-afisha-summary-list" id="timelineAfishaSummaryList">${visible.map(item => `<button type="button" class="timeline-afisha-summary-event${item.birthday_slots?.[0]?.conflict ? ' timeline-afisha-summary-event--conflict' : ''}"
                data-afisha-id="${Number(item.id)}" aria-label="${M.esc(`${item.title}, ${String(item.date).slice(0, 10)}, ${occurrence(item).time}${item.birthday_slots?.length ? `, ${item.birthday_slots[0].mode === 'manual' ? 'вручну' : 'автоматично'}, ${greetingStatus(item.birthday_slots[0])}` : ''}`)}">
                <span class="timeline-afisha-summary-time">${M.esc(String(item.date).slice(5, 10))} · ${M.esc(String(occurrence(item).time).slice(0, 5))}</span><strong>${M.esc(item.title)}</strong>
                ${item.birthday_slots?.length ? `<small>${M.esc(greetingStatus(item.birthday_slots[0]))}</small>` : ''}
                ${item.promotion_id ? `<small class="timeline-afisha-promotion-name">${item.promotion_active === false ? 'Архівована акція' : 'Акція'}: ${M.esc(item.promotion_title || promotions.get(Number(item.promotion_id))?.title || `#${item.promotion_id}`)}</small>` : ''}
                ${item.line_id || item.second_line_id ? `<small>${[item.line_id, item.second_line_id].filter(Boolean).length} ан.</small>` : ''}</button>`).join('')}</div>`;
        panel.querySelector('.timeline-marketing-body').appendChild(section);
        section.querySelector('[data-more-afisha]')?.addEventListener('click', () => { afishaExpanded = true; renderAfishaSection(); panel.querySelector('[data-less-afisha]')?.focus(); });
        section.querySelector('[data-less-afisha]')?.addEventListener('click', () => { afishaExpanded = false; renderAfishaSection(); panel.querySelector('[data-more-afisha]')?.focus(); });
        section.querySelector('[data-add-afisha]')?.addEventListener('click', e => window.TimelineAfisha?.quickCreate(view.dates, e.currentTarget));
        section.querySelectorAll('[data-afisha-id]').forEach(button => button.addEventListener('click', () => {
            const item = events.find(event => Number(event.id) === Number(button.dataset.afishaId));
            if (item) {
                const shown = occurrence(item);
                if (shown.birthdaySlot) window.TimelineAfisha?.birthdayDetails(shown, button);
                else window.TimelineAfisha?.details(shown, button);
            }
        }));
    }

    async function save(item, values, business) {
        const key = String(item?.id || 'new');
        if (pending.has(key)) throw new Error('Збереження ще триває');
        if (M.context() !== business) throw new Error('Бізнес-контекст змінився. Відкрийте акцію знову.');
        pending.add(key);
        try {
            return await M.request(`/timeline/promotions${item ? `/${item.id}` : ''}`, item ? 'PATCH' : 'POST', {
                ...values, ...(item ? { version: item.version } : {})
            }, business);
        } finally { pending.delete(key); }
    }

    function edit(item, start, end, trigger) {
        const business = M.context();
        const readOnly = !canWrite();
        const value = item || { title: '', description: '', color_key: 'amber', starts_on: start, ends_on: end };
        const modal = M.dialog(item ? 'Акційний період' : 'Додати акцію', `<form class="timeline-marketing-form">
            <label>Назва<input name="title" maxlength="180" required value="${M.esc(value.title)}" ${readOnly ? 'readonly' : ''}></label>
            <label>Умови<textarea name="description" maxlength="4000" rows="3" ${readOnly ? 'readonly' : ''}>${M.esc(value.description)}</textarea></label>
            <div class="timeline-marketing-date-pair"><label>Початок<input type="date" name="starts_on" value="${M.esc(value.starts_on)}" required ${readOnly ? 'readonly' : ''}></label>
            <label>Кінець, включно<input type="date" name="ends_on" value="${M.esc(value.ends_on)}" required ${readOnly ? 'readonly' : ''}></label></div>
            <label>Колір<select name="color_key" ${readOnly ? 'disabled' : ''}>${Object.entries(colors).map(([key, label]) => `<option value="${key}" ${value.color_key === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
            <div role="alert" data-error></div>
            ${readOnly ? '' : `<div class="timeline-marketing-actions"><button type="button" class="btn-secondary" data-week>Увесь тиждень</button><button type="submit" class="btn-primary">Зберегти</button>${item ? '<button type="button" class="btn-secondary" data-archive>Архівувати</button>' : ''}</div>`}
            ${item && showAfisha() && M.writable('edit_booking') ? '<button type="button" class="btn-secondary" data-add-linked-from-dialog>Додати захід до акції</button>' : ''}
        </form>`, trigger);
        const form = modal.querySelector('form');
        modal.querySelector('[data-add-linked-from-dialog]')?.addEventListener('click', () => {
            const dates = view?.dates || [];
            const date = dates.find(value => value >= item.starts_on && value <= item.ends_on);
            closeModal(modal);
            if (date) window.TimelineAfisha?.quickCreate(dates, trigger, { date, promotionId: item.id });
        });
        modal.querySelector('[data-week]')?.addEventListener('click', () => {
            if (!form.elements.starts_on.value) return;
            const week = M.weekOf(form.elements.starts_on.value);
            form.elements.starts_on.value = week.start;
            form.elements.ends_on.value = week.end;
        });
        async function submit(archive) {
            if (readOnly) return;
            const buttons = [...form.querySelectorAll('button')];
            buttons.forEach(button => { button.disabled = true; });
            try {
                const values = archive ? { is_active: false } : {
                    title: form.elements.title.value, description: form.elements.description.value,
                    starts_on: form.elements.starts_on.value, ends_on: form.elements.ends_on.value,
                    color_key: form.elements.color_key.value, is_active: true
                };
                await save(item, values, business);
                closeModal(modal);
                if (M.context() === business) await refresh();
            } catch (error) {
                const message = modal.querySelector('[data-error]');
                message.textContent = error.message;
                if (error.status === 409) {
                    await refresh();
                    // Keep the user's draft visible; reloading is an explicit choice.
                    const reload = document.createElement('button');
                    reload.type = 'button'; reload.className = 'btn-secondary'; reload.textContent = 'Відкрити актуальну версію';
                    reload.addEventListener('click', () => {
                        const latest = view?.items.find(value => value.id === item.id);
                        closeModal(modal);
                        if (latest) edit(latest, latest.starts_on, latest.ends_on, trigger);
                        else showNotification('Акцію архівовано або вона більше не входить у видимий період');
                    });
                    message.appendChild(reload);
                }
            } finally { buttons.forEach(button => { button.disabled = false; }); }
        }
        form.addEventListener('submit', e => { e.preventDefault(); submit(false); });
        modal.querySelector('[data-archive]')?.addEventListener('click', async () => {
            if (await confirmModal('Архівувати акцію? Вона зникне з таймлайну.', { okText: 'Архівувати', cancelText: 'Скасувати' })) submit(true);
        });
    }

    function shade(items) {
        clearShading();
        for (const date of view.dates) {
            const active = items.filter(item => item.starts_on <= date && item.ends_on >= date);
            if (!active.length) continue;
            const color = active.length > 1 ? 'overlap' : active[0].color_key;
            const grids = view.dates.length === 1
                ? view.container.querySelectorAll('.line-grid')
                : view.container.querySelectorAll(`.day-section[data-date="${date}"] .mini-line-grid`);
            grids.forEach(grid => grid.dataset.promotionColor = color);
        }
    }

    function renderAllDayLanes(items) {
        if (!showAfisha()) return;
        for (const date of view.dates) {
            const grid = view.dates.length === 1
                ? view.container.querySelector('.afisha-line-grid[data-line-id="afisha"]')
                : view.container.querySelector(`.day-section[data-date="${date}"] .mini-line-grid[data-line-id="afisha"]`);
            if (!grid) continue;
            grid.querySelector('.afisha-all-day-track')?.remove();
            const active = items.filter(item => item.starts_on <= date && item.ends_on >= date);
            grid.dataset.afishaAllDayCount = String(active.length);
            grid.closest('.timeline-line, .mini-timeline-line')?.classList.toggle('has-afisha-all-day', active.length > 0);
            if (active.length) {
                const track = document.createElement('div');
                track.className = 'afisha-all-day-track';
                track.setAttribute('aria-label', `Акції на весь день, ${date}`);
                for (const item of active) {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'afisha-all-day-card';
                    button.dataset.color = item.color_key;
                    button.setAttribute('aria-label', `Акція ${item.title}, весь день ${date}, ${item.starts_on}–${item.ends_on}`);
                    button.innerHTML = `<span class="afisha-all-day-caption">Акція · Весь день</span><strong>${M.esc(item.title)}</strong>`;
                    button.addEventListener('click', () => edit(item, item.starts_on, item.ends_on, button));
                    track.appendChild(button);
                }
                grid.appendChild(track);
            }
            window.TimelineAfisha?.layout(grid);
        }
    }

    function render(items) {
        const { dates } = view;
        const writable = canWrite();
        const visibleItems = marketingOpen ? (expanded ? items : items.slice(0, 2)) : [];
        const moreCount = marketingOpen ? items.length - visibleItems.length : 0;
        const afishaCount = (view.afishaEvents || []).filter(item => item.type !== 'birthday').length;
        const attentionCount = (view.afishaEvents || []).reduce((count, item) => count + (item.birthday_slots || []).filter(slot => slot.conflict).length, 0);
        const hasAfisha = showAfisha();
        panel.dataset.empty = String(items.length === 0 && (!hasAfisha || afishaCount === 0));
        panel.dataset.visibleFrom = dates[0];
        panel.dataset.visibleTo = dates[dates.length - 1];
        panel.innerHTML = `<div class="timeline-marketing-overview">
            <div class="timeline-marketing-intro"><strong>${hasAfisha ? 'Акції та афіша' : 'Акції'}</strong></div>
            <div class="timeline-marketing-counts"><span class="timeline-marketing-count timeline-marketing-count-promotions">Акції <strong>${items.length}</strong></span>${hasAfisha ? `<span class="timeline-marketing-count timeline-marketing-count-afisha">Афіша <strong>${afishaCount}</strong></span>${attentionCount ? `<span class="timeline-marketing-count timeline-marketing-count--conflict" role="status">Потрібна увага <strong>${attentionCount}</strong></span>` : ''}` : ''}</div>
            <button type="button" class="btn-secondary timeline-marketing-toggle" data-toggle-marketing aria-expanded="${marketingOpen}" aria-controls="timelineMarketingDetails">${marketingOpen ? 'Згорнути' : 'Розгорнути'}<span aria-hidden="true" class="timeline-marketing-chevron"></span></button></div>
            <div class="timeline-marketing-body" id="timelineMarketingDetails" ${marketingOpen ? '' : 'hidden'}>${marketingOpen ? `<section class="timeline-promotion-section" aria-label="Акції"><div class="timeline-promotions-toolbar"><strong>Акції</strong><span class="timeline-promotions-status" aria-live="polite"></span>${moreCount > 0 ? `<button type="button" class="btn-secondary" data-more aria-expanded="false">Ще ${moreCount}</button>` : ''}${expanded && items.length > 2 ? '<button type="button" class="btn-secondary" data-less aria-expanded="true">Показати менше</button>' : ''}${writable ? '<button type="button" class="btn-secondary" data-add>Додати акцію</button>' : ''}${writable && dates.length > 1 ? '<button type="button" class="btn-secondary" data-select aria-pressed="false">Виділити дати</button>' : ''}</div>
            <div class="timeline-promotion-scroll" id="timelinePromotionDetails">${dates.length > 1 ? `<div class="timeline-promotion-dates" style="--promotion-days:${dates.length}">${dates.map((date, index) => `<button type="button" class="timeline-promotion-date" data-date-index="${index}" aria-label="${date}">${date.slice(8)}.${date.slice(5, 7)}</button>`).join('')}</div>` : ''}<div class="timeline-promotion-bands"></div></div></section>` : ''}</div>`;
        panel.querySelector('[data-toggle-marketing]')?.addEventListener('click', () => {
            marketingOpen = !marketingOpen; expanded = false; afishaExpanded = false; selecting = false; keyStart = null;
            render(items); panel.querySelector('[data-toggle-marketing]')?.focus();
        });
        panel.querySelector('[data-add]')?.addEventListener('click', e => edit(null, dates[0], dates[dates.length - 1], e.currentTarget));
        panel.querySelector('[data-more]')?.addEventListener('click', () => { expanded = true; render(items); panel.querySelector('[data-less]')?.focus(); });
        panel.querySelector('[data-less]')?.addEventListener('click', () => { expanded = false; render(items); panel.querySelector('[data-more]')?.focus(); });
        panel.querySelector('[data-select]')?.addEventListener('click', e => {
            selecting = !selecting; keyStart = null;
            e.currentTarget.setAttribute('aria-pressed', String(selecting));
            panel.querySelector('.timeline-promotion-section .timeline-promotions-status').textContent = selecting ? 'Виділіть дати або натисніть початок і кінець' : '';
        });
        const header = panel.querySelector('.timeline-promotion-dates');
        function choose(from, to, trigger) {
            selecting = false; keyStart = null; cancel();
            panel.querySelector('[data-select]')?.setAttribute('aria-pressed', 'false');
            edit(null, dates[Math.min(from, to)], dates[Math.max(from, to)], trigger);
        }
        if (header) {
            const dayAt = x => Math.max(0, Math.min(dates.length - 1, Math.floor((x - header.getBoundingClientRect().left) / (header.getBoundingClientRect().width / dates.length))));
            header.addEventListener('pointerdown', e => {
                if (!selecting || e.button !== 0) return;
                const index = dayAt(e.clientX);
                gesture = { type: 'select', from: index, to: index };
                header.setPointerCapture(e.pointerId);
            });
            header.addEventListener('pointermove', e => {
                if (gesture?.type !== 'select') return;
                gesture.to = dayAt(e.clientX);
                header.querySelectorAll('button').forEach((button, i) => button.classList.toggle('promotion-preview', i >= Math.min(gesture.from, gesture.to) && i <= Math.max(gesture.from, gesture.to)));
            });
            header.addEventListener('pointerup', () => {
                if (gesture?.type === 'select') choose(gesture.from, gesture.to, panel.querySelector('[data-select]'));
            });
            header.addEventListener('pointercancel', cancel);
            header.addEventListener('lostpointercapture', () => { if (gesture?.type === 'select') cancel(); });
            header.querySelectorAll('button').forEach((button, index) => button.addEventListener('click', e => {
                if (!selecting || e.detail !== 0) return;
                if (keyStart === null) { keyStart = index; button.classList.add('promotion-preview'); }
                else choose(keyStart, index, button);
            }));
        }
        for (const item of visibleItems) {
            const row = document.createElement('div');
            row.className = 'timeline-promotion-row';
            row.dataset.promotionId = item.id;
            row.style.setProperty('--promotion-days', dates.length);
            const first = Math.max(0, M.daysBetween(dates[0], item.starts_on));
            const last = Math.min(dates.length - 1, M.daysBetween(dates[0], item.ends_on));
            const linked = (view.afishaEvents || []).filter(event => Number(event.promotion_id) === Number(item.id));
            row.innerHTML = `<div class="timeline-promotion-band" data-color="${M.esc(item.color_key)}" style="grid-column:${first + 1}/${last + 2}">
                ${writable && dates.length > 1 && item.starts_on >= dates[0] ? '<button type="button" class="promotion-handle" data-edge="start" aria-label="Змінити початок акції">⋮</button>' : ''}
                <button type="button" class="promotion-label" title="${M.esc(`${item.title}, ${item.starts_on}–${item.ends_on}, весь день`)}" aria-label="${M.esc(`${item.title}, ${item.starts_on}–${item.ends_on}, весь день`)}"><strong>${M.esc(item.title)}</strong><span>${M.esc(item.starts_on)}–${M.esc(item.ends_on)}</span><em>Весь день</em></button>
                ${linked.length ? `<span class="promotion-afisha-links">${linked.map(event => `<button type="button" data-linked-afisha="${Number(event.id)}" title="${M.esc(event.title)}">⚑ ${M.esc(event.title)}</button>`).join('')}</span>` : ''}
                ${showAfisha() && M.writable('edit_booking') ? '<button type="button" class="promotion-add-afisha" data-add-linked-afisha title="Додати захід до акції" aria-label="Додати захід до акції"><span aria-hidden="true">+</span><span class="promotion-add-afisha-text">Захід</span></button>' : ''}
                ${writable && dates.length > 1 && item.ends_on <= dates[dates.length - 1] ? '<button type="button" class="promotion-handle" data-edge="end" aria-label="Змінити кінець акції">⋮</button>' : ''}</div>`;
            panel.querySelector('.timeline-promotion-bands').appendChild(row);
            row.querySelectorAll('[data-linked-afisha]').forEach(button => button.addEventListener('click', () => {
                const event = linked.find(value => Number(value.id) === Number(button.dataset.linkedAfisha));
                if (event) {
                    const shown = occurrence(event);
                    if (shown.birthdaySlot) window.TimelineAfisha?.birthdayDetails(shown, button);
                    else window.TimelineAfisha?.details(shown, button);
                }
            }));
            row.querySelector('[data-add-linked-afisha]')?.addEventListener('click', e => {
                const date = dates.find(value => value >= item.starts_on && value <= item.ends_on);
                window.TimelineAfisha?.quickCreate(dates, e.currentTarget, { date, promotionId: item.id });
            });
            const label = row.querySelector('.promotion-label');
            let suppress = false;
            label.addEventListener('click', () => { if (!suppress) edit(item, item.starts_on, item.ends_on, label); suppress = false; });
            if (!writable) continue;
            async function move(delta, edge, keyboardTrigger) {
                if (!delta) return;
                const values = {
                    starts_on: edge === 'end' ? item.starts_on : M.addDays(item.starts_on, delta),
                    ends_on: edge === 'start' ? item.ends_on : M.addDays(item.ends_on, delta)
                };
                if (values.ends_on < values.starts_on) { showNotification('Кінець не може бути раніше початку', 'error'); return; }
                const business = view?.business;
                try {
                    await save(item, values, business); await refresh();
                    if (keyboardTrigger && M.context() === business && (document.activeElement === document.body || document.activeElement === keyboardTrigger)) {
                        const updated = panel?.querySelector(`[data-promotion-id="${Number(item.id)}"]`);
                        updated?.querySelector(edge ? `[data-edge="${edge}"]` : '.promotion-label')?.focus();
                    }
                }
                catch (error) { showNotification(error.message, 'error'); if (error.status === 409) await refresh(); }
            }
            row.querySelectorAll('.promotion-label, .promotion-handle').forEach(button => {
                button.addEventListener('pointerdown', e => {
                    if (e.button !== 0 || dates.length === 1 || pending.has(String(item.id))) return;
                    const band = row.querySelector('.timeline-promotion-band');
                    gesture = { type: 'band', x: e.clientX, delta: 0, button, edge: button.dataset.edge, item, moved: false,
                        band, column: band.style.gridColumn };
                    suppress = false; button.setPointerCapture(e.pointerId);
                });
                button.addEventListener('pointermove', e => {
                    if (gesture?.button !== button) return;
                    gesture.delta = Math.round((e.clientX - gesture.x) / (header.getBoundingClientRect().width / dates.length));
                    gesture.moved = gesture.moved || Math.abs(e.clientX - gesture.x) > 6;
                    const start = gesture.edge === 'end' ? item.starts_on : M.addDays(item.starts_on, gesture.delta);
                    const end = gesture.edge === 'start' ? item.ends_on : M.addDays(item.ends_on, gesture.delta);
                    panel.querySelector('.timeline-promotion-section .timeline-promotions-status').textContent = `${start}–${end}`;
                    if (end >= start) {
                        const from = Math.max(0, Math.min(dates.length - 1, M.daysBetween(dates[0], start)));
                        const to = Math.max(from, Math.min(dates.length - 1, M.daysBetween(dates[0], end)));
                        gesture.band.style.gridColumn = `${from + 1}/${to + 2}`;
                    }
                    row.classList.add('promotion-preview');
                });
                button.addEventListener('pointerup', () => {
                    if (gesture?.button !== button) return;
                    const state = gesture; suppress = state.moved; cancel();
                    if (state.moved) move(state.delta, state.edge);
                });
                button.addEventListener('pointercancel', cancel);
                button.addEventListener('lostpointercapture', () => { if (gesture?.button === button) cancel(); });
                button.addEventListener('keydown', e => {
                    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                        e.preventDefault(); move(e.key === 'ArrowLeft' ? -1 : 1, button.dataset.edge, button);
                    }
                });
            });
        }
        shade(items);
        renderAllDayLanes(items);
        renderAfishaSection();
    }

    async function refresh() {
        if (!view || !panel) return;
        const current = view;
        const requestSequence = ++sequence;
        panel.setAttribute('aria-busy', 'true');
        try {
            const result = await M.request(`/timeline/promotions?from=${current.dates[0]}&to=${current.dates[current.dates.length - 1]}`, 'GET', null, current.business);
            if (sequence !== requestSequence || view !== current || !timelineRequestTokenIsCurrent(current.token)) return;
            if (!Array.isArray(result.promotions)) throw new Error('Invalid promotions response');
            view.items = result.promotions;
            render(view.items);
        } catch (error) {
            if (sequence !== requestSequence || view !== current || !timelineRequestTokenIsCurrent(current.token)) return;
            clearShading();
            panel.innerHTML = `<div class="timeline-promotions-toolbar"><span role="alert">Не вдалося завантажити акції</span><button type="button" class="btn-secondary">Повторити</button></div><div class="timeline-marketing-body"></div>`;
            panel.querySelector('button').addEventListener('click', refresh);
            renderAfishaSection();
        } finally { if (view === current) panel?.removeAttribute('aria-busy'); }
    }

    function mount(container, dates, token, afishaEvents = []) {
        if (!timelineRequestTokenIsCurrent(token)) return;
        panel?.remove();
        panel = document.createElement('section');
        panel.className = 'timeline-promotions';
        panel.setAttribute('aria-label', 'Акції та афіша');
        panel.innerHTML = '<div class="timeline-promotions-toolbar" role="status">Завантаження акцій…</div>';
        const scroll = document.getElementById('timelineScroll');
        scroll.insertBefore(panel, document.getElementById('timeScale'));
        view = { container, dates: dates.map(formatDate), token, business: M.context(), items: [], afishaEvents };
        refresh();
    }
    document.addEventListener('keydown', e => { if (e.key === 'Escape') cancel(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
    window.addEventListener('blur', cancel);
    window.addEventListener('timeline:business-context-changed', () => {
        marketingOpen = false; expanded = false; afishaExpanded = false;
        beginRender();
    });
    window.TimelinePromotions = { mount, cancel, beginRender, currentPromotions: () => view?.items || [], dragging: () => Boolean(gesture) };
})();
