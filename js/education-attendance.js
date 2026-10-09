(function (global) {
    'use strict';

    const byId = id => document.getElementById(id);
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
    const context = () => global.TimelineBusinessContext?.current?.()?.apiValue || 'event_genix';
    const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' });
    const state = { journal: null, stale: false, draftRevision: null, lessons: [], loading: false, loadVersion: 0, journalLoading: false, saving: false, reportLoading: false, business: null };
    let generation = 0;
    let journalVersion = 0;
    let reportVersion = 0;
    let lessonRequest = null;
    let reportRequest = null;
    let reportWaitingForGroups = false;
    let journalBusiness = null;
    let workspaceBusiness = null;
    const drafts = new Map();
    let draftStorageAvailable = true;
    const capture = () => ({ business: context(), generation });
    const isCurrent = request => request.generation === generation && request.business === context();

    function draftKey(bookingId, business = journalBusiness || context()) {
        const user = global.AppState?.currentUser;
        return `education-attendance-draft:${user?.id || user?.username || 'anonymous'}:${business}:${bookingId}`;
    }

    function marksFromForm() {
        return [...(byId('educationAttendanceJournal')?.querySelectorAll('[data-attendance-child-id]') || [])]
            .map(select => ({ childId: Number(select.dataset.attendanceChildId), status: select.value || null }));
    }

    function isDirty() {
        return Boolean(state.journal && marksFromForm().some(mark => state.journal.members.find(member => Number(member.child_id) === mark.childId)?.status !== mark.status));
    }

    function rememberDraft() {
        if (!state.journal || state.saving) return;
        const key = draftKey(state.journal.booking.id);
        const changed = marksFromForm().filter(mark => state.journal.members.find(member => Number(member.child_id) === mark.childId)?.status !== mark.status);
        const marks = changed.length || state.stale ? { marks: changed, revision: state.draftRevision } : null;
        if (marks) drafts.set(key, marks); else drafts.delete(key);
        try { if (marks) global.sessionStorage.setItem(key, JSON.stringify(marks)); else global.sessionStorage.removeItem(key); } catch { draftStorageAvailable = false; }
    }

    function clearDraft(bookingId, business) {
        const key = draftKey(bookingId, business);
        drafts.delete(key);
        try { global.sessionStorage.removeItem(key); } catch { /* Storage can be unavailable. */ }
    }

    function restoreDraft() {
        if (!state.journal || state.journal.cancelled) return false;
        const key = draftKey(state.journal.booking.id);
        let draft = drafts.get(key);
        try { draft ||= JSON.parse(global.sessionStorage.getItem(key) || 'null'); } catch { draft = null; }
        const marks = Array.isArray(draft) ? draft : draft?.marks;
        if (!Array.isArray(marks)) return false;
        // Never silently adopt a fresh revision for an older draft.
        state.draftRevision = draft.revision || null;
        state.stale = !state.draftRevision || state.draftRevision !== state.journal.revision;
        for (const select of byId('educationAttendanceJournal').querySelectorAll('[data-attendance-child-id]')) {
            const mark = marks.find(item => item.childId === Number(select.dataset.attendanceChildId));
            if (mark && [null, 'present', 'absent', 'excused'].includes(mark.status)) select.value = mark.status || '';
        }
        return isDirty() || state.stale;
    }

    function syncControls() {
        const busy = state.saving || state.journalLoading;
        for (const id of ['educationAttendanceSave', 'educationAttendanceReload', 'educationAttendanceDate', 'educationAttendanceLesson']) {
            if (byId(id)) byId(id).disabled = busy;
        }
        if (byId('educationAttendanceSave')) byId('educationAttendanceSave').disabled = busy || state.stale;
        byId('educationAttendanceJournal')?.querySelectorAll('[data-attendance-child-id]').forEach(select => { select.disabled = busy || state.journal?.cancelled === true; });
    }

    function updateUrl(values) {
        const url = new URL(global.location.href);
        for (const [key, value] of Object.entries(values)) {
            if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
        }
        global.history.replaceState(global.history.state, '', url);
    }

    function lessonOf(booking) {
        return global.EducationScheduleWorkspace?.lessonFromBooking(booking) || null;
    }

    function status(message, id = 'educationAttendanceStatus', kind = 'info') {
        if (byId(id)) {
            byId(id).textContent = message;
            byId(id).dataset.state = kind;
        }
    }

    async function api(path, options = {}) {
        const controller = new global.AbortController();
        const timeout = global.setTimeout(() => controller.abort(), 20000);
        try {
        const response = await fetch(`${API_BASE}/education${path}`, {
            ...options,
            signal: controller.signal,
            headers: { ...getAuthHeaders(), ...(options.headers || {}) },
            body: options.body === undefined ? undefined : JSON.stringify({
                ...options.body, businessContext: context()
            })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(data.error || 'HTTP ' + response.status);
            error.status = response.status;
            error.code = data.code;
            throw error;
        }
        return data;
        } catch (error) {
            if (error.name === 'AbortError') throw new Error('Час очікування вичерпано. Спробуйте знову.');
            throw error;
        } finally { global.clearTimeout(timeout); }
    }

    function syncGroupOptions() {
        const select = byId('educationReportGroup');
        if (!select) return;
        const current = select.value;
        const groups = global.EducationGroups?.state.groups || [];
        select.innerHTML = '<option value="">Усі групи</option>' + groups
            .map(group => `<option value="${Number(group.id)}">${escape(group.name)}${group.status === 'archived' ? ' (архів)' : ''}</option>`).join('');
        select.value = current || new URLSearchParams(global.location.search).get('educationReportGroup') || '';
    }

    async function loadLessons(date = byId('educationAttendanceDate')?.value || today(), options = {}) {
        if (!byId('educationAttendanceLesson') || typeof global.getBookingsForDate !== 'function') return;
        if (!options.force && lessonRequest?.date === date && isCurrent(lessonRequest)) return lessonRequest.promise;
        const requestState = capture();
        requestState.date = date;
        lessonRequest = requestState;
        const version = ++state.loadVersion;
        state.loading = true;
        byId('educationAttendanceDate').value = date;
        if (!state.journal) status('Завантажуємо заняття…');
        const controller = new global.AbortController();
        const timeout = global.setTimeout(() => controller.abort(), 20000);
        requestState.promise = (async () => {
        try {
            const bookings = await global.getBookingsForDate(date, { throwOnError: true, force: options.force === true, signal: controller.signal });
            if (!isCurrent(requestState) || version !== state.loadVersion) return;
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
            if (!state.journal) status(`${state.lessons.length} занять з групою`);
        } catch (error) {
            if (!isCurrent(requestState) || version !== state.loadVersion) return;
            state.lessons = [];
            byId('educationAttendanceLesson').innerHTML = '<option value="">Оберіть заняття</option>';
            status(`Не вдалося завантажити заняття: ${error.name === 'AbortError' ? 'Час очікування вичерпано. Спробуйте знову.' : error.message}`, 'educationAttendanceStatus', 'error');
        } finally {
            global.clearTimeout(timeout);
            if (isCurrent(requestState) && version === state.loadVersion) {
                state.loading = false;
                lessonRequest = null;
            }
        }
        })();
        await requestState.promise;
        const requested = new URLSearchParams(global.location.search).get('educationJournal');
        if (isCurrent(requestState) && version === state.loadVersion && !state.journal && !state.journalLoading && requested && state.lessons.some(booking => String(booking.id) === requested)) await openBooking(requested);
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
                    ? `<ul class="education-attendance-history" aria-label="Історія відвідування">${member.history.map(change => `<li><span>Автор: ${escape(change.changed_by)} · ${escape(new Date(change.changed_at).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' }))}</span><br><span>${escape(statusLabel(change.previous_status))} → ${escape(statusLabel(change.new_status))}</span></li>`).join('')}</ul>`
                    : '';
                return `<div class="education-attendance-row"><div><strong>${escape(member.child_name || `ID ${member.child_id}`)}</strong><small>${escape(member.parent_name || '')}</small>${history}</div>
                    <label>Відвідування<select data-attendance-child-id="${Number(member.child_id)}" ${journal.cancelled ? 'disabled' : ''}>
                        <option value="" ${member.status == null ? 'selected' : ''}>Не відмічено</option>
                        <option value="present" ${member.status === 'present' ? 'selected' : ''}>Присутній</option>
                        <option value="absent" ${member.status === 'absent' ? 'selected' : ''}>Відсутній</option>
                        <option value="excused" ${member.status === 'excused' ? 'selected' : ''}>Поважна причина</option>
                    </select></label></div>`;
            }).join('')}</div>`;
        save.hidden = journal.cancelled || journal.members.length === 0;
    }

    async function openBooking(bookingId, options = {}) {
        if (state.saving) return;
        rememberDraft();
        const requestState = capture();
        const version = ++journalVersion;
        if (!options.refresh) {
            state.journal = null;
            renderJournal();
        }
        if (!bookingId) {
            updateUrl({ educationJournal: '' });
            return;
        }
        state.journalLoading = true;
        syncControls();
        status('Завантажуємо журнал…');
        try {
            const { journal } = await api(`/attendance/${encodeURIComponent(bookingId)}?businessContext=${encodeURIComponent(requestState.business)}`);
            if (!isCurrent(requestState) || version !== journalVersion) return;
            if (options.refresh) clearDraft(bookingId, requestState.business);
            state.journal = journal;
            state.stale = false;
            state.draftRevision = journal.revision;
            journalBusiness = requestState.business;
            byId('educationAttendanceDate').value = journal.booking.date;
            renderJournal();
            const restored = restoreDraft();
            status(state.stale ? 'Журнал змінив інший оператор. Чернетка відновлена, але застаріла. Натисніть «Оновити», перечитайте журнал і явно повторіть потрібні зміни.'
                : restored ? 'Відновлено незбережені відмітки. Збережіть їх або натисніть «Оновити», щоб відкинути.' : journal.frozen ? 'Журнал збережено.' : 'Журнал ще не розпочато.', 'educationAttendanceStatus', state.stale ? 'error' : 'info');
            updateUrl({ educationJournal: bookingId, educationAttendanceDate: journal.booking.date });
            if (!state.lessons.some(booking => String(booking.id) === String(bookingId))) await loadLessons(journal.booking.date);
            if (!isCurrent(requestState) || version !== journalVersion) return;
            if (!state.lessons.some(booking => String(booking.id) === String(bookingId))) {
                const option = document.createElement('option');
                option.value = bookingId;
                option.textContent = `${journal.booking.time} · ${journal.booking.title}`;
                byId('educationAttendanceLesson').appendChild(option);
            }
            byId('educationAttendanceLesson').value = bookingId;
        } catch (error) {
            if (!isCurrent(requestState) || version !== journalVersion) return;
            if (!options.refresh) { state.journal = null; renderJournal(); }
            status(`Не вдалося відкрити журнал: ${error.message}`, 'educationAttendanceStatus', 'error');
        } finally {
            if (isCurrent(requestState) && version === journalVersion) {
                state.journalLoading = false;
                syncControls();
            }
        }
    }

    async function refreshJournal() {
        if (state.saving || state.journalLoading) return;
        const requestState = capture();
        const version = journalVersion;
        const bookingId = state.journal?.booking.id;
        if (isDirty() || state.stale) {
            const confirmed = await global.confirmModal?.('Відкинути незбережені відмітки та завантажити журнал знову?', { okText: 'Відкинути й оновити', cancelText: 'Залишити відмітки' });
            if (!confirmed || !isCurrent(requestState) || version !== journalVersion) return;
        }
        if (bookingId) await openBooking(bookingId, { refresh: true });
        if (isCurrent(requestState)) await loadLessons(undefined, { force: true });
    }

    async function saveJournal() {
        const bookingId = state.journal?.booking?.id;
        if (!bookingId || state.journal.cancelled || state.stale || state.saving || state.journalLoading) return;
        const requestState = capture();
        const version = journalVersion;
        const marks = marksFromForm();
        rememberDraft();
        state.saving = true;
        syncControls();
        try {
            const result = await api(`/attendance/${encodeURIComponent(bookingId)}`, {
                method: 'PUT', body: { marks, revision: state.draftRevision }
            });
            if (!isCurrent(requestState) || version !== journalVersion) return;
            clearDraft(bookingId, requestState.business);
            state.journal = result.journal;
            state.draftRevision = result.journal.revision;
            state.stale = false;
            renderJournal();
            status(result.changes ? `${result.changes} відміток змінено.` : 'Без змін; повторний запис не створено.');
        } catch (error) {
            if (isCurrent(requestState) && version === journalVersion) {
                if (error.code === 'EDUCATION_JOURNAL_STALE') {
                    state.stale = true;
                    status('Журнал змінив інший оператор. Ваші відмітки залишилися в чернетці. Натисніть «Оновити», перечитайте журнал і явно повторіть потрібні зміни.', 'educationAttendanceStatus', 'error');
                    const message = byId('educationAttendanceStatus');
                    if (message) {
                        message.tabIndex = -1;
                        message.focus({ preventScroll: true });
                        message.scrollIntoView?.({ block: 'center' });
                    }
                } else status('Не вдалося зберегти журнал: ' + error.message, 'educationAttendanceStatus', 'error');
            }
        } finally {
            if (isCurrent(requestState) && version === journalVersion) { state.saving = false; syncControls(); }
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
        ${report.lessons.length ? `<div class="education-report-table-wrap" tabindex="0" role="region" aria-label="Звіт занять: таблиця з горизонтальним прокручуванням"><table class="education-report-table"><caption>Заняття за обраний період</caption><thead><tr><th scope="col">Дата і час</th><th scope="col">Заняття / група</th><th scope="col">Стан</th><th scope="col">Присутні / відсутні / поважна / не відмічено</th></tr></thead><tbody>
            ${report.lessons.map(item => `<tr><td>${escape(item.date)} ${escape(item.time)}</td><td>${escape(item.title)}<br><small>${escape(item.groupName)}</small></td><td>${escape(({ held: 'Проведено', cancelled: 'Скасовано', scheduled: 'Заплановано' })[item.phase])}${item.journalStarted ? '' : ' · журнал не відкрито'}</td><td>${item.journalStarted ? reportCounts(item.counts) : '—'}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="education-today-empty">За цей період занять немає.</div>'}`;
    }

    async function runReport() {
        if (!byId('educationReportFrom') || !byId('educationReportTo')) return;
        const requestState = capture();
        const requestedGroup = new URLSearchParams(global.location.search).get('educationReportGroup');
        if (requestedGroup && !byId('educationReportGroup').value) {
            const groupStatus = global.EducationGroups?.state.listStatus;
            state.reportLoading = groupStatus !== 'ready' && groupStatus !== 'error';
            reportWaitingForGroups = state.reportLoading;
            status(groupStatus === 'ready' ? 'Обрана група недоступна. Оберіть іншу групу.'
                : groupStatus === 'error' ? 'Не вдалося завантажити групи. Оновіть сторінку та спробуйте знову.'
                : 'Завантажуємо групи для звіту…', 'educationReportStatus');
            return;
        }
        reportWaitingForGroups = false;
        const from = byId('educationReportFrom').value;
        const to = byId('educationReportTo').value;
        if (!from || !to || from > to) {
            reportVersion += 1;
            reportRequest = null;
            state.reportLoading = false;
            byId('educationReportResult')?.replaceChildren();
            status('Оберіть коректний період звіту.', 'educationReportStatus', 'error');
            return;
        }
        const params = new URLSearchParams({ businessContext: requestState.business, from, to });
        const groupId = byId('educationReportGroup').value;
        if (groupId) params.set('groupId', groupId);
        const signature = params.toString();
        if (reportRequest?.signature === signature && isCurrent(reportRequest)) return reportRequest.promise;
        const version = ++reportVersion;
        requestState.signature = signature;
        reportRequest = requestState;
        state.reportLoading = true;
        byId('educationReportResult')?.replaceChildren();
        status('Завантажуємо звіт…', 'educationReportStatus');
        updateUrl({ educationReportFrom: from, educationReportTo: to, educationReportGroup: groupId });
        requestState.promise = (async () => {
        try {
            const { report } = await api(`/reports?${params}`);
            if (!isCurrent(requestState) || version !== reportVersion) return;
            renderReport(report);
            status(`${report.lessons.length} занять у періоді.`, 'educationReportStatus');
        } catch (error) {
            if (!isCurrent(requestState) || version !== reportVersion) return;
            byId('educationReportResult').replaceChildren();
            status(`Не вдалося завантажити звіт: ${error.message}`, 'educationReportStatus', 'error');
        } finally {
            if (isCurrent(requestState) && version === reportVersion) { state.reportLoading = false; reportRequest = null; }
        }
        })();
        return requestState.promise;
    }

    document.addEventListener('DOMContentLoaded', () => {
        const params = new URLSearchParams(global.location.search);
        byId('educationAttendanceDate').value = params.get('educationAttendanceDate') || params.get('date') || today();
        byId('educationReportTo').value = params.get('educationReportTo') || today();
        const from = new Date(`${today()}T00:00:00Z`);
        from.setUTCDate(from.getUTCDate() - 30);
        byId('educationReportFrom').value = params.get('educationReportFrom') || from.toISOString().slice(0, 10);
        byId('educationAttendanceDate').addEventListener('change', () => {
            rememberDraft();
            journalVersion += 1;
            state.journalLoading = false;
            state.journal = null;
            renderJournal();
            if (byId('educationAttendanceLesson')) byId('educationAttendanceLesson').innerHTML = '<option value="">Оберіть заняття</option>';
            updateUrl({ educationAttendanceDate: byId('educationAttendanceDate').value, educationJournal: '' });
            syncControls();
            void loadLessons();
        });
        byId('educationAttendanceLesson').addEventListener('change', event => void openBooking(event.target.value));
        byId('educationAttendanceJournal').addEventListener('change', () => {
            rememberDraft();
            status(isDirty() ? 'Є незбережені відмітки.' : 'Відмітки не змінено.');
        });
        byId('educationAttendanceReload').addEventListener('click', () => void refreshJournal());
        byId('educationAttendanceSave').addEventListener('click', () => void saveJournal());
        byId('educationReportRun').addEventListener('click', () => void runReport());
        for (const id of ['educationReportFrom', 'educationReportTo', 'educationReportGroup']) {
            byId(id)?.addEventListener('change', () => {
                if (id === 'educationReportGroup') updateUrl({ educationReportGroup: byId(id).value });
                void runReport();
            });
        }
        document.addEventListener('education:groups-updated', () => {
            syncGroupOptions();
            if (reportWaitingForGroups && global.EducationScheduleWorkspace?.state.activeView === 'reports') void runReport();
        });
        syncGroupOptions();
    });

    document.addEventListener('click', async event => {
        const bookingId = event.target.closest('[data-education-attendance-booking]')?.dataset.educationAttendanceBooking;
        if (!bookingId) return;
        const requestState = capture();
        if (typeof global.closeAllModals === 'function') await global.closeAllModals();
        else byId('bookingModal')?.classList.add('hidden');
        if (!isCurrent(requestState)) return;
        global.EducationScheduleWorkspace?.setView('attendance');
        await openBooking(bookingId);
    });
    global.addEventListener('timeline:business-context-changed', () => {
        const changedBusiness = workspaceBusiness !== null && workspaceBusiness !== context();
        workspaceBusiness = context();
        state.business = context();
        generation += 1;
        journalVersion += 1;
        reportVersion += 1;
        state.journal = null;
        state.stale = false;
        state.draftRevision = null;
        state.lessons = [];
        state.loadVersion += 1;
        state.loading = false;
        state.journalLoading = false;
        state.saving = false;
        state.reportLoading = false;
        lessonRequest = null;
        reportRequest = null;
        reportWaitingForGroups = false;
        journalBusiness = null;
        renderJournal();
        syncControls();
        if (byId('educationAttendanceLesson')) byId('educationAttendanceLesson').innerHTML = '<option value="">Оберіть заняття</option>';
        if (byId('educationReportGroup')) byId('educationReportGroup').value = '';
        if (changedBusiness) updateUrl({ educationJournal: '', educationReportGroup: '' });
        byId('educationReportResult')?.replaceChildren();
        status('');
        status('', 'educationReportStatus');
        // The workspace activates the selected view after all context listeners finish.
    });
    global.addEventListener('beforeunload', event => {
        if (draftStorageAvailable || (!isDirty() && drafts.size === 0)) return;
        event.preventDefault();
        event.returnValue = '';
    });
    global.EducationAttendance = Object.freeze({ loadLessons, openBooking, runReport, state });
})(window);
