/* Compact Afisha flags. Booking identity and detail rendering remain owned by timeline.js. */
(function () {
    'use strict';
    const M = window.TimelineMarketing;
    const pending = new Set();
    let activeDrag = null;
    const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
    const timeString = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
    const canMove = event => event.type !== 'birthday' && M.context() === 'event_genix' && M.writable('edit_booking');
    const crossDay = event => event.type === 'event' && !event.template_id;
    const ratio = grid => grid.classList.contains('mini-line-grid') ? 2 : getTimelineCellWidth(grid) / CONFIG.TIMELINE.CELL_MINUTES;

    function layout(grid) {
        const flags = [...grid.querySelectorAll('.afisha-flag')].sort((a, b) => parseFloat(a.style.left) - parseFloat(b.style.left));
        if (!flags.length) return;
        const rect = grid.getBoundingClientRect();
        let baseline = 5;
        grid.querySelectorAll('.booking-block:not(.afisha-flag), .mini-booking-block').forEach(block => {
            const bookingRect = block.getBoundingClientRect();
            const birthday = block.classList.contains('afisha-type-birthday');
            const top = birthday ? 5 : bookingRect.top - rect.top - grid.clientTop;
            baseline = Math.max(baseline, birthday ? top + bookingRect.height + 5 : bookingRect.bottom - rect.top + 5);
            // Preserve the existing booking height while adding annotation lanes below it.
            block.style.setProperty('--afisha-neighbor-height', `${bookingRect.height}px`);
            block.style.setProperty('--afisha-neighbor-top', `${top}px`);
            block.classList.add('afisha-neighbor-booking');
        });
        const ends = [];
        for (const flag of flags) {
            const left = parseFloat(flag.style.left);
            let lane = ends.findIndex(end => end + 6 <= left);
            if (lane < 0) lane = ends.length;
            ends[lane] = left + (flag.offsetWidth || 170);
            flag.style.top = `${baseline + lane * 34}px`;
        }
        grid.style.minHeight = `${baseline + ends.length * 34 + 5}px`;
        grid.closest('.timeline-line, .mini-timeline-line')?.classList.add('has-afisha-flags');
    }

    function cancel() {
        if (!activeDrag) return false;
        const state = activeDrag;
        activeDrag = null;
        state.block.style.left = state.left;
        state.block.classList.remove('dragging');
        state.block.querySelector('.afisha-flag-time').textContent = state.event.time;
        document.querySelectorAll('.afisha-date-target').forEach(el => el.classList.remove('afisha-date-target'));
        return true;
    }

    async function save(event, date, time, business) {
        if (pending.has(String(event.id))) throw new Error('Збереження цієї події ще триває');
        if (business !== M.context()) throw new Error('Бізнес-контекст змінився. Повторіть дію.');
        pending.add(String(event.id));
        document.querySelectorAll(`[data-afisha-id="${Number(event.id)}"]`).forEach(el => { el.disabled = true; });
        const oldDate = event.date;
        try {
            const result = await M.request(`/afisha/${encodeURIComponent(event.id)}/schedule`, 'PATCH', {
                date, time, expectedDate: event.date, expectedTime: event.time
            }, business);
            Object.assign(event, result.item);
            for (const value of new Set([oldDate, date])) invalidateTimelineDateCache(value, { businessContext: business });
            return result.item;
        } catch (error) {
            if (error.status === 409 && business === M.context()) {
                invalidateTimelineDateCache(oldDate);
                await renderTimeline();
            }
            throw error;
        } finally {
            pending.delete(String(event.id));
            document.querySelectorAll(`[data-afisha-id="${Number(event.id)}"]`).forEach(el => { el.disabled = false; });
        }
    }

    function details(event, trigger) {
        hideTooltip();
        const business = M.context();
        const modal = M.dialog(event.title, `<p>${M.esc(event.date)} · ${M.esc(event.time)} · ${Number(event.duration || 60)} хв</p>
            <p class="timeline-marketing-description">${M.esc(event.description || 'Без опису')}</p>
            <div class="timeline-marketing-actions"><a class="btn-secondary" href="/afisha?event=${encodeURIComponent(event.id)}&date=${encodeURIComponent(event.date)}">Відкрити в афіші</a>
            ${canMove(event) ? '<button type="button" class="btn-primary" data-move>Перенести</button>' : ''}</div>
            <form data-move-form hidden class="timeline-marketing-form">
                <label>Дата<input name="date" type="date" value="${M.esc(event.date)}" required ${crossDay(event) ? '' : 'readonly'}></label>
                <label>Час<input name="time" type="time" value="${M.esc(event.time)}" step="300" required></label>
                <p>Крок — 5 хв. Межі — ±${event.template_id ? 90 : 120} хв від ${M.esc(event.original_time || event.time)}.${crossDay(event) ? ' На іншій даті лінію потрібно призначити знову.' : ' Регулярна подія: лише поточний день.'}</p>
                <div role="alert" data-error></div><button type="submit" class="btn-primary">Зберегти</button>
            </form>`, trigger);
        modal.querySelector('[data-move]')?.addEventListener('click', () => {
            modal.querySelector('form').hidden = false;
            modal.querySelector('input[name="time"]').focus();
        });
        modal.querySelector('form').addEventListener('submit', async e => {
            e.preventDefault();
            const form = e.currentTarget;
            const submit = form.querySelector('[type="submit"]');
            submit.disabled = true;
            try {
                await save(event, form.elements.date.value, form.elements.time.value, business);
                closeModal(modal);
                if (M.context() === business) await renderTimeline();
                showNotification('Розклад афіші збережено');
            } catch (error) {
                modal.querySelector('[data-error]').textContent = error.message;
            } finally { submit.disabled = false; }
        });
    }

    function create(event, startHour, grid) {
        const item = { ...event, date: String(event.date || formatDate(AppState.selectedDate)).slice(0, 10), time: String(event.time).slice(0, 5) };
        const start = minutes(item.time) - startHour * 60;
        if (start < 0) return null;
        const block = document.createElement('button');
        block.type = 'button';
        block.className = `afisha-flag afisha-type-${item.type === 'regular' ? 'regular' : 'event'}`;
        block.dataset.afishaId = item.id;
        block.dataset.eventTime = item.time;
        block.dataset.eventDate = item.date;
        block.style.left = `${start * ratio(grid)}px`;
        block.innerHTML = `<span aria-hidden="true">${item.type === 'regular' ? '↻' : '⚑'}</span><span class="afisha-flag-time">${M.esc(item.time)}</span><span class="afisha-flag-title">${M.esc(item.title)}</span>`;
        block.setAttribute('aria-label', `${item.title}, ${item.date}, ${item.time}. Відкрити афішу`);
        block.disabled = pending.has(String(item.id));
        let suppressClick = false;
        block.addEventListener('click', e => { e.stopPropagation(); if (!suppressClick) details(item, block); suppressClick = false; });
        block.addEventListener('contextmenu', e => {
            if (!canMove(item)) return;
            e.preventDefault();
            if (grid.classList.contains('mini-line-grid')) { details(item, block); return; }
            _showAfishaLineMenu(e, item);
        });
        block.addEventListener('pointerdown', e => {
            if (e.button !== 0 || !canMove(item) || pending.has(String(item.id))) return;
            e.stopPropagation();
            cancel();
            suppressClick = false;
            activeDrag = { block, event: item, grid, startHour, x: e.clientX, y: e.clientY,
                left: block.style.left, date: item.date, time: item.time, moved: false, business: M.context() };
            block.setPointerCapture(e.pointerId);
        });
        block.addEventListener('pointermove', e => {
            const s = activeDrag;
            if (!s || s.block !== block) return;
            if (Math.hypot(e.clientX - s.x, e.clientY - s.y) < 8 && !s.moved) return;
            s.moved = true;
            block.classList.add('dragging');
            hideTooltip();
            const section = document.elementFromPoint(e.clientX, e.clientY)?.closest('.day-section');
            document.querySelectorAll('.afisha-date-target').forEach(el => el.classList.remove('afisha-date-target'));
            s.date = section?.dataset.date || item.date;
            if (s.date !== item.date) {
                section.classList.add('afisha-date-target');
                s.time = item.time;
                block.querySelector('.afisha-flag-time').textContent = s.date;
                return;
            }
            const original = minutes(item.original_time || item.time);
            const limit = item.template_id ? 90 : 120;
            const next = Math.round((minutes(item.time) + (e.clientX - s.x) / ratio(grid)) / 5) * 5;
            const lower = Math.ceil(Math.max(original - limit, startHour * 60) / 5) * 5;
            const upper = Math.floor(Math.min(original + limit, 1435) / 5) * 5;
            const value = Math.max(lower, Math.min(upper, next));
            s.time = timeString(value);
            block.style.left = `${(value - startHour * 60) * ratio(grid)}px`;
            block.querySelector('.afisha-flag-time').textContent = s.time;
        });
        block.addEventListener('pointerup', async () => {
            const s = activeDrag;
            if (!s || s.block !== block) return;
            suppressClick = s.moved;
            cancel();
            if (!s.moved || (s.date === item.date && s.time === item.time)) return;
            if (s.date !== item.date && !crossDay(item)) {
                showNotification('Регулярну подію можна рухати лише в межах дня', 'error');
                return;
            }
            try {
                await save(item, s.date, s.time, s.business);
                if (s.business === M.context()) await renderTimeline();
                showNotification('Розклад афіші збережено');
            } catch (error) { showNotification(error.message, 'error'); }
        });
        block.addEventListener('pointercancel', cancel);
        block.addEventListener('lostpointercapture', () => { if (activeDrag?.block === block) cancel(); });
        return block;
    }

    async function mountWeek(container, dates, token) {
        if (!timelineShouldRenderAfisha()) return;
        const results = await Promise.all(dates.map(date => apiGetAfishaByDate(formatDate(date))));
        if (!timelineRequestTokenIsCurrent(token)) return;
        dates.forEach((date, index) => {
            const dateStr = formatDate(date);
            const section = container.querySelector(`.day-section[data-date="${dateStr}"]`);
            if (!section) return;
            const body = section.querySelector('.mini-timeline-lines');
            const start = date.getDay() === 0 || date.getDay() === 6 ? CONFIG.TIMELINE.WEEKEND_START : CONFIG.TIMELINE.WEEKDAY_START;
            const end = date.getDay() === 0 || date.getDay() === 6 ? CONFIG.TIMELINE.WEEKEND_END : CONFIG.TIMELINE.WEEKDAY_END;
            const row = document.createElement('div');
            row.className = 'mini-timeline-line';
            row.style.setProperty('--mini-hour-width', '120px');
            row.style.setProperty('--mini-grid-width', `${(end - start) * 120}px`);
            row.innerHTML = '<div class="mini-line-header">Афіша</div><div class="mini-line-grid" data-line-id="afisha"></div>';
            body.prepend(row);
            const general = row.querySelector('.mini-line-grid');
            (Array.isArray(results[index]) ? results[index] : []).forEach(event => {
                // Room projections do not own animator assignments; show each event once on the Afisha row.
                const assigned = event.line_id && !isRoomTimelineView()
                    ? [...body.querySelectorAll('.mini-line-grid')].find(el => el.dataset.lineId === String(event.line_id)) : null;
                const grid = assigned || general;
                const events = event.type === 'birthday' ? ['14:00', '18:00'].map(time => ({ ...event, time, duration: 15 })) : [event];
                events.forEach(value => {
                    const flag = create({ ...value, date: dateStr }, start, grid);
                    if (flag) grid.appendChild(flag);
                });
            });
            body.querySelectorAll('.mini-line-grid').forEach(layout);
        });
    }

    document.addEventListener('keydown', e => { if (e.key === 'Escape') cancel(); });
    window.addEventListener('blur', cancel);
    window.addEventListener('timeline:business-context-changed', () => {
        cancel();
        document.querySelectorAll('.timeline-marketing-modal').forEach(modal => closeModal(modal));
    });
    window.TimelineAfisha = { create, layout, details, save, mountWeek, cancel, dragging: () => Boolean(activeDrag) };
})();
