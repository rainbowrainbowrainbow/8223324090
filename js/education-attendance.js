(function (global) {
    'use strict';

    const byId = id => document.getElementById(id);
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
    const context = () => global.TimelineBusinessContext?.current?.()?.apiValue || 'event_genix';
    const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' });
    const state = { journal: null, lessons: [], loading: false, loadVersion: 0 };

    function lessonOf(booking) {
        return global.EducationScheduleWorkspace?.lessonFromBooking(booking) || null;
    }

    function status(message, id = 'educationAttendanceStatus') {
        if (byId(id)) byId(id).textContent = message;
    }

    async function api(path, options = {}) {
        const response = await fetch(`${API_BASE}/education${path}`, {
            ...options,
            headers: { ...getAuthHeaders(), ...(options.headers || {}) },
            body: options.body === undefined ? undefined : JSON.stringify({
                ...options.body, businessContext: context()
            })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        return data;
    }

    function syncGroupOptions() {
        const select = byId('educationReportGroup');
        if (!select) return;
        const current = select.value;
        const groups = global.EducationGroups?.state.groups || [];
        select.innerHTML = '<option value="">Усі групи</option>' + groups
            .map(group => `<option value="${Number(group.id)}">${escape(group.name)}${group.status === 'archived' ? ' (архів)' : ''}</option>`).join('');
        select.value = current;
    }

    async function loadLessons(date = byId('educationAttendanceDate')?.value || today()) {
        if (!byId('educationAttendanceLesson') || typeof global.getBookingsForDate !== 'function') return;
        const version = ++state.loadVersion;
        state.loading = true;
        byId('educationAttendanceDate').value = date;
        status('Завантажуємо заняття…');
        try {
            const bookings = await global.getBookingsForDate(date, { throwOnError: true });
            if (version !== state.loadVersion) return;
            state.lessons = (Array.isArray(bookings) ? bookings : []).filter(booking => Boolean(lessonOf(booking)?.groupId));
            const selected = byId('educationAttendanceLesson').value;
            byId('educationAttendanceLesson').innerHTML = '<option value="">Оберіть заняття</option>' + state.lessons
                .map(booking => {
                    const lesson = lessonOf(booking);
                    return `<option value="${escape(booking.id)}">${escape(booking.time || '')} · ${escape(lesson.title || booking.programName || 'Заняття')} · ${escape(lesson.groupName || '')}</option>`;
                }).join('');
            if (state.lessons.some(booking => String(booking.id) === selected)) {
                byId('educationAttendanceLesson').value = selected;
            }
            status(`${state.lessons.length} занять з групою`);
        } catch (error) {
            if (version !== state.loadVersion) return;
            state.lessons = [];
            byId('educationAttendanceLesson').innerHTML = '<option value="">Оберіть заняття</option>';
            status(`Не вдалося завантажити заняття: ${error.message}`);
        } finally {
            if (version === state.loadVersion) state.loading = false;
        }
    }

    function statusLabel(value) {
        return ({ present: 'Присутній', absent: 'Відсутній', excused: 'Поважна причина' })[value] || 'Не відмічено';
    }

    function renderJournal() {
        const journal = state.journal;
        const target = byId('educationAttendanceJournal');
        const save = byId('educationAttendanceSave');
        if (!target || !save) return;
        if (!journal) {
            target.replaceChildren();
            save.hidden = true;
            return;
        }
        const lesson = journal.booking;
        const intro = journal.cancelled
            ? 'Заняття скасовано. Історія доступна лише для перегляду.'
            : journal.frozen ? 'Склад журналу зафіксовано.' : 'Попередній склад на дату заняття. Перше збереження зафіксує його.';
        target.innerHTML = `<h3>${escape(lesson.title)} · ${escape(lesson.date)} ${escape(lesson.time)} · ${escape(lesson.groupName)}</h3>
            <p>${escape(intro)}</p>
            <div class="education-attendance-roster">${journal.members.map(member => {
                const history = member.history?.length
                    ? `<ul class="education-attendance-history">${member.history.map(change => `<li>${escape(change.changed_by)} · ${escape(new Date(change.changed_at).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' }))}: ${escape(statusLabel(change.previous_status))} → ${escape(statusLabel(change.new_status))}</li>`).join('')}</ul>`
                    : '';
                return `<div class="education-attendance-row"><div><strong>${escape(member.child_name || `ID ${member.child_id}`)}</strong><small>${escape(member.parent_name || '')}</small>${history}</div>
                    <label>Статус<select data-attendance-child-id="${Number(member.child_id)}" ${journal.cancelled ? 'disabled' : ''}>
                        <option value="" ${member.status == null ? 'selected' : ''}>Не відмічено</option>
                        <option value="present" ${member.status === 'present' ? 'selected' : ''}>Присутній</option>
                        <option value="absent" ${member.status === 'absent' ? 'selected' : ''}>Відсутній</option>
                        <option value="excused" ${member.status === 'excused' ? 'selected' : ''}>Поважна причина</option>
                    </select></label></div>`;
            }).join('')}</div>`;
        save.hidden = journal.cancelled || journal.members.length === 0;
    }

    async function openBooking(bookingId) {
        if (!bookingId) {
            state.journal = null;
            renderJournal();
            return;
        }
        status('Завантажуємо журнал…');
        try {
            const { journal } = await api(`/attendance/${encodeURIComponent(bookingId)}?businessContext=${encodeURIComponent(context())}`);
            state.journal = journal;
            byId('educationAttendanceDate').value = journal.booking.date;
            renderJournal();
            status(journal.frozen ? 'Журнал збережено.' : 'Журнал ще не розпочато.');
            await loadLessons(journal.booking.date);
            if (!state.lessons.some(booking => String(booking.id) === String(bookingId))) {
                const option = document.createElement('option');
                option.value = bookingId;
                option.textContent = `${journal.booking.time} · ${journal.booking.title}`;
                byId('educationAttendanceLesson').appendChild(option);
            }
            byId('educationAttendanceLesson').value = bookingId;
        } catch (error) {
            state.journal = null;
            renderJournal();
            status(`Не вдалося відкрити журнал: ${error.message}`);
        }
    }

    async function saveJournal() {
        const bookingId = state.journal?.booking?.id;
        if (!bookingId || state.journal.cancelled) return;
        const marks = [...byId('educationAttendanceJournal').querySelectorAll('[data-attendance-child-id]')]
            .map(select => ({ childId: Number(select.dataset.attendanceChildId), status: select.value || null }));
        byId('educationAttendanceSave').disabled = true;
        try {
            const result = await api(`/attendance/${encodeURIComponent(bookingId)}`, {
                method: 'PUT', body: { marks }
            });
            state.journal = result.journal;
            renderJournal();
            status(result.changes ? `${result.changes} відміток змінено.` : 'Без змін; повторний запис не створено.');
        } catch (error) {
            status(`Не вдалося зберегти журнал: ${error.message}`);
        } finally {
            byId('educationAttendanceSave').disabled = false;
        }
    }

    function reportCounts(counts) {
        return `${counts.present} / ${counts.absent} / ${counts.excused} / ${counts.unmarked}`;
    }

    function renderReport(report) {
        const target = byId('educationReportResult');
        if (!target) return;
        const s = report.summary;
        target.innerHTML = `<div class="education-report-summary">
            <span>Проведено: <strong>${s.held}</strong></span><span>Скасовано: <strong>${s.cancelled}</strong></span>
            <span>Заплановано: <strong>${s.scheduled}</strong></span><span>Журналів ще немає: <strong>${s.journalsNotStarted}</strong></span>
            <span>Присутні: <strong>${s.present}</strong></span><span>Відсутні: <strong>${s.absent}</strong></span>
            <span>Поважна причина: <strong>${s.excused}</strong></span><span>Не відмічено: <strong>${s.unmarked}</strong></span>
        </div><p>Відмітки підраховано лише із зафіксованих журналів проведених занять; майбутні й скасовані заняття виключено.</p>
        ${report.lessons.length ? `<div class="education-report-table-wrap"><table class="education-report-table"><thead><tr><th>Дата і час</th><th>Заняття / група</th><th>Стан</th><th>Присутні / відсутні / поважна / не відмічено</th></tr></thead><tbody>
            ${report.lessons.map(item => `<tr><td>${escape(item.date)} ${escape(item.time)}</td><td>${escape(item.title)}<br><small>${escape(item.groupName)}</small></td><td>${escape(({ held: 'Проведено', cancelled: 'Скасовано', scheduled: 'Заплановано' })[item.phase])}${item.journalStarted ? '' : ' · журнал не відкрито'}</td><td>${item.journalStarted ? reportCounts(item.counts) : '—'}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="education-today-empty">За цей період занять немає.</div>'}`;
    }

    async function runReport() {
        if (!byId('educationReportFrom') || !byId('educationReportTo')) return;
        const from = byId('educationReportFrom').value;
        const to = byId('educationReportTo').value;
        if (!from || !to) return;
        status('Завантажуємо звіт…', 'educationReportStatus');
        const params = new URLSearchParams({ businessContext: context(), from, to });
        const groupId = byId('educationReportGroup').value;
        if (groupId) params.set('groupId', groupId);
        try {
            const { report } = await api(`/reports?${params}`);
            renderReport(report);
            status(`${report.lessons.length} занять у періоді.`, 'educationReportStatus');
        } catch (error) {
            byId('educationReportResult').replaceChildren();
            status(`Не вдалося завантажити звіт: ${error.message}`, 'educationReportStatus');
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        byId('educationAttendanceDate').value = today();
        byId('educationReportTo').value = today();
        const from = new Date(`${today()}T00:00:00Z`);
        from.setUTCDate(from.getUTCDate() - 30);
        byId('educationReportFrom').value = from.toISOString().slice(0, 10);
        byId('educationAttendanceDate').addEventListener('change', () => {
            state.journal = null;
            renderJournal();
            void loadLessons();
        });
        byId('educationAttendanceLesson').addEventListener('change', event => void openBooking(event.target.value));
        byId('educationAttendanceReload').addEventListener('click', () => void loadLessons());
        byId('educationAttendanceSave').addEventListener('click', () => void saveJournal());
        byId('educationReportRun').addEventListener('click', () => void runReport());
        document.addEventListener('education:groups-updated', syncGroupOptions);
        syncGroupOptions();
    });

    document.addEventListener('click', async event => {
        const bookingId = event.target.closest('[data-education-attendance-booking]')?.dataset.educationAttendanceBooking;
        if (!bookingId) return;
        if (typeof global.closeAllModals === 'function') await global.closeAllModals();
        else byId('bookingModal')?.classList.add('hidden');
        global.EducationScheduleWorkspace?.setView('attendance');
        await openBooking(bookingId);
    });
    global.addEventListener('timeline:business-context-changed', () => {
        state.journal = null;
        state.lessons = [];
        state.loadVersion += 1;
        renderJournal();
        byId('educationReportResult')?.replaceChildren();
        if (global.EducationScheduleWorkspace?.state.activeView === 'attendance') void loadLessons();
    });
    global.EducationAttendance = Object.freeze({ loadLessons, openBooking, runReport, state });
})(window);
