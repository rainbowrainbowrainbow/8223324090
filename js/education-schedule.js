(function (global) {
    'use strict';

    const state = { activeView: 'today', date: '', bookings: [], loading: false, error: null };
    let generation = 0;
    let activeRequest = null;
    let activationVersion = 0;
    const business = () => global.TimelineBusinessContext?.current?.()?.apiValue || 'event_genix';

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[char]);
    }

    function lessonFromBooking(booking = {}) {
        let extra = booking.extraData || booking.extra_data || {};
        if (typeof extra === 'string') {
            try { extra = JSON.parse(extra) || {}; } catch { extra = {}; }
        }
        return extra.educationLesson || extra.education_lesson || extra.bookingWorkspace?.lesson || null;
    }

    function isEducationMode() {
        return global.TimelineBusinessContext?.presentation?.()?.mode === 'education';
    }

    function dateKey() {
        if (typeof global.AppState !== 'undefined' && global.AppState.selectedDate && typeof global.formatDate === 'function') {
            return global.formatDate(global.AppState.selectedDate);
        }
        return document.getElementById('timelineDate')?.value || '';
    }

    function dateLabel(value) {
        const date = new Date(`${value}T00:00:00`);
        if (Number.isNaN(date.getTime())) return value;
        return new Intl.DateTimeFormat('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
    }

    function lessonFields(booking) {
        const lesson = lessonFromBooking(booking) || {};
        return {
            lesson,
            title: lesson.title || booking.programName || booking.program_name || booking.label || 'Заняття',
            teacherId: String(lesson.teacherId || lesson.teacher_id || ''),
            groupId: String(lesson.groupId || ''),
            teacher: lesson.teacherName || lesson.teacher_name || '',
            group: lesson.groupName || lesson.group_name || booking.groupName || booking.group_name || '',
            cabinet: lesson.resourceName || lesson.resource_name || booking.room || '',
            students: Number(lesson.studentCount || lesson.student_count || booking.kidsCount || booking.kids_count || 0)
        };
    }

    function currentLessons() {
        return state.bookings.filter(booking => Boolean(lessonFromBooking(booking)));
    }

    function ensureFilterOptions(select, values, defaultLabel) {
        if (!select) return;
        const selected = select.value;
        const unique = new Map();
        values.filter(item => item.value && item.label).forEach(item => unique.set(item.value, item.label));
        select.innerHTML = `<option value="">${escapeHtml(defaultLabel)}</option>` + [...unique.entries()]
            .sort((a, b) => a[1].localeCompare(b[1], 'uk'))
            .map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('');
        if ([...unique.keys()].includes(selected)) select.value = selected;
    }

    function visibleLessons() {
        const teacher = document.getElementById('educationScheduleTeacherFilter')?.value || '';
        const cabinet = document.getElementById('educationScheduleCabinetFilter')?.value || '';
        const groupId = document.getElementById('educationScheduleGroupFilter')?.value || '';
        return currentLessons().filter(booking => {
            const fields = lessonFields(booking);
            return (!teacher || fields.teacherId === teacher)
                && (!cabinet || fields.cabinet === cabinet)
                && (!groupId || fields.groupId === groupId);
        }).sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
    }

    function syncFilters(lessons) {
        ensureFilterOptions(document.getElementById('educationScheduleTeacherFilter'), lessons.map(booking => {
            const fields = lessonFields(booking);
            return { value: fields.teacherId, label: fields.teacher || fields.teacherId };
        }), 'Усі викладачі');
        ensureFilterOptions(document.getElementById('educationScheduleCabinetFilter'), lessons.map(booking => {
            const fields = lessonFields(booking);
            return { value: fields.cabinet, label: fields.cabinet };
        }), 'Усі кабінети');
    }

    function render() {
        const panel = document.getElementById('educationTodayPanel');
        const list = document.getElementById('educationTodayList');
        const status = document.getElementById('educationTodayStatus');
        if (!panel || !list || !status) return;
        const heading = document.getElementById('educationTodayHeading');
        if (heading) heading.textContent = state.date ? `Заняття · ${dateLabel(state.date)}` : 'Заняття на вибрану дату';
        if (state.loading) {
            status.textContent = 'Завантажуємо заняття…';
            list.replaceChildren();
            return;
        }
        if (state.error) {
            status.textContent = 'Не вдалося завантажити список.';
            list.innerHTML = '<button type="button" class="btn-secondary education-action education-today-empty" data-education-retry>Повторити завантаження</button>';
            return;
        }
        const lessons = currentLessons();
        syncFilters(lessons);
        const filtered = visibleLessons();
        status.textContent = `${filtered.length} ${filtered.length === 1 ? 'заняття' : 'занять'}`;
        if (!filtered.length) {
            list.innerHTML = `<div class="education-today-empty">${lessons.length ? 'За вибраними фільтрами занять немає.' : 'На цю дату занять ще немає.'}</div>`;
            return;
        }
        list.innerHTML = filtered.map(booking => {
            const fields = lessonFields(booking);
            const count = fields.students > 0 ? `<span class="education-lesson-count">Учнів: ${fields.students}</span>` : '';
            const meta = [fields.teacher && `Викладач: ${fields.teacher}`, fields.group && `Група: ${fields.group}`, fields.cabinet && `Кабінет: ${fields.cabinet}`].filter(Boolean).join(' · ');
            return `<button type="button" class="education-lesson-card" data-education-booking-id="${escapeHtml(booking.id)}" aria-label="Відкрити заняття ${escapeHtml(fields.title)}, ${escapeHtml(booking.time || '')}">
                <span class="education-lesson-time">${escapeHtml(booking.time || '—')}</span>
                <span class="education-lesson-copy"><strong>${escapeHtml(fields.title)}</strong><small>${escapeHtml(meta || 'Деталі не вказані')}</small></span>${count}
            </button>`;
        }).join('');
    }

    async function load(date = dateKey(), options = {}) {
        if (!isEducationMode() || !date || typeof global.getBookingsForDate !== 'function') return;
        if (activeRequest?.date === date && activeRequest.business === business() && activeRequest.generation === generation) return activeRequest.promise;
        const request = { date, business: business(), generation };
        activeRequest = request;
        const current = () => activeRequest === request && request.generation === generation && request.business === business() && isEducationMode();
        state.date = date;
        state.loading = true;
        state.error = null;
        render();
        const controller = new global.AbortController();
        const timeout = global.setTimeout(() => controller.abort(), 20000);
        request.promise = (async () => {
        try {
            const bookings = await global.getBookingsForDate(date, { throwOnError: true, force: options.force === true, signal: controller.signal });
            if (!current()) return;
            state.bookings = Array.isArray(bookings) ? bookings : [];
        } catch (error) {
            if (!current()) return;
            state.error = error.name === 'AbortError' ? new Error('Час очікування вичерпано. Спробуйте знову.') : error;
            state.bookings = [];
        } finally {
            global.clearTimeout(timeout);
            if (current()) {
                activeRequest = null;
                state.loading = false;
                render();
            }
        }
        })();
        return request.promise;
    }

    function setView(view, updateUrl = true) {
        state.activeView = ['schedule', 'groups', 'attendance', 'reports'].includes(view) ? view : 'today';
        const today = state.activeView === 'today';
        document.body.classList.toggle('education-schedule-today', state.activeView !== 'schedule' && isEducationMode());
        // The shared height may have been measured while education hid the grid.
        if (state.activeView === 'schedule' && isEducationMode()) global.scheduleTimelineViewHeightSync?.('education-schedule-reveal');
        document.querySelectorAll('[data-education-schedule-tab]').forEach(button => {
            const active = button.dataset.educationScheduleTab === state.activeView;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        // Keep direct-URL selections within the horizontal strip without moving the page.
        global.requestAnimationFrame(() => {
            const tabs = document.querySelector('.education-schedule-tabs');
            const active = tabs?.querySelector('.education-schedule-tab.active');
            if (!active || tabs.scrollWidth <= tabs.clientWidth) return;
            const viewport = tabs.getBoundingClientRect();
            const button = active.getBoundingClientRect();
            if (button.left < viewport.left + 4) tabs.scrollLeft += button.left - viewport.left - 4;
            else if (button.right > viewport.right - 4) tabs.scrollLeft += button.right - viewport.right + 4;
        });
        const panel = document.getElementById('educationTodayPanel');
        if (panel) panel.hidden = !today;
        const groups = document.getElementById('educationGroupsPanel');
        if (groups) groups.hidden = state.activeView !== 'groups';
        const attendance = document.getElementById('educationAttendancePanel');
        if (attendance) attendance.hidden = state.activeView !== 'attendance';
        const reports = document.getElementById('educationReportsPanel');
        if (reports) reports.hidden = state.activeView !== 'reports';
        if (updateUrl && global.history?.replaceState) {
            const url = new URL(global.location.href);
            url.searchParams.set('educationSchedule', state.activeView);
            global.history.replaceState(global.history.state, '', url);
        }
        const viewGeneration = generation;
        const activeView = state.activeView;
        const activation = ++activationVersion;
        // Context listeners must finish resetting their state before starting a new request.
        void Promise.resolve().then(async () => {
            if (activation !== activationVersion || viewGeneration !== generation || activeView !== state.activeView || !isEducationMode()) return;
            if (today) void load();
            if (activeView === 'groups') void global.EducationGroups?.load();
            if (activeView === 'attendance') void global.EducationAttendance?.loadLessons();
            if (activeView === 'reports') {
                void global.EducationAttendance?.runReport();
                await global.EducationGroups?.load();
                if (activation === activationVersion && viewGeneration === generation && activeView === state.activeView && isEducationMode()
                    && new URLSearchParams(global.location.search).get('educationReportGroup')
                    && !document.getElementById('educationReportGroup')?.value) void global.EducationAttendance?.runReport();
            }
        });
    }

    function syncWorkspace() {
        const workspace = document.getElementById('educationScheduleWorkspace');
        if (!workspace) return;
        const enabled = isEducationMode();
        document.querySelectorAll('[data-education-copy]').forEach(element => {
            if (!Object.hasOwn(element.dataset, 'originalCopy')) element.dataset.originalCopy = element.textContent;
            element.textContent = enabled ? element.dataset.educationCopy : element.dataset.originalCopy;
        });
        workspace.classList.toggle('hidden', !enabled);
        if (!enabled) {
            document.body.classList.remove('education-schedule-today');
            return;
        }
        setView(new URLSearchParams(global.location.search || '').get('educationSchedule') || state.activeView, false);
    }

    document.addEventListener('click', event => {
        const tab = event.target.closest('[data-education-schedule-tab]');
        if (tab) setView(tab.dataset.educationScheduleTab);
        if (event.target.closest('[data-education-retry]')) void load(state.date || dateKey(), { force: true });
        const card = event.target.closest('[data-education-booking-id]');
        if (card && typeof global.showBookingDetails === 'function') {
            void global.showBookingDetails(card.dataset.educationBookingId, { source: 'education-today-list', triggerEl: card });
        }
    });
    document.getElementById('educationScheduleTeacherFilter')?.addEventListener('change', render);
    document.getElementById('educationScheduleCabinetFilter')?.addEventListener('change', render);
    document.getElementById('educationScheduleGroupFilter')?.addEventListener('change', render);
    global.addEventListener('timeline:summary-changed', event => {
        if (state.activeView === 'today') void load(event.detail?.date || dateKey());
    });
    global.addEventListener('timeline:business-context-changed', () => {
        generation += 1;
        activeRequest = null;
        state.bookings = [];
        state.loading = false;
        state.error = null;
        syncWorkspace();
    });
    global.addEventListener('popstate', syncWorkspace);
    global.addEventListener('crmBusinessProfileChanged', syncWorkspace);
    global.addEventListener('crm:authenticated-runtime-ready', syncWorkspace);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncWorkspace, { once: true });
    else syncWorkspace();

    global.EducationScheduleWorkspace = Object.freeze({
        lessonFromBooking,
        lessonFields,
        visibleLessons,
        syncWorkspace,
        setView,
        load,
        state
    });
})(window);
