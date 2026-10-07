(function (global) {
    'use strict';

    const byId = id => document.getElementById(id);
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
    const state = { groups: [], current: null, selectedId: '', detailStatus: 'new', listStatus: 'idle', teachers: [], teacherStatus: 'idle' };
    const context = () => global.TimelineBusinessContext?.current?.()?.apiValue || 'event_genix';
    const url = path => `${API_BASE}/education/groups${path}`;
    let generation = 0;
    let listVersion = 0;
    let detailVersion = 0;
    let searchVersion = 0;
    let teacherVersion = 0;
    let saveInFlight = null;
    let teacherManagerBusy = null;
    let teacherManagerVersion = 0;
    const capture = () => ({ business: context(), generation });
    const isCurrent = request => request.generation === generation && request.business === context();
    const selectionMatches = () => String(byId('educationGroupsList')?.value || '') === state.selectedId;
    const actionable = () => selectionMatches() && (state.selectedId
        ? state.detailStatus === 'ready' && String(state.current?.id) === state.selectedId && state.current.status === 'active'
        : state.detailStatus === 'new');
    const selectionRequest = () => ({ ...capture(), version: detailVersion, id: state.selectedId });
    const sameSelection = request => isCurrent(request) && request.version === detailVersion
        && request.id === state.selectedId && selectionMatches();

    function controls() {
        const disabled = !actionable() || Boolean(saveInFlight);
        byId('educationGroupForm')?.querySelectorAll('input, select, button[type="submit"]').forEach(input => { input.disabled = disabled; });
        if (byId('educationGroupTeacher')) byId('educationGroupTeacher').disabled = disabled || state.teacherStatus !== 'ready';
        if (byId('educationGroupArchive')) byId('educationGroupArchive').disabled = disabled;
        byId('educationGroupEnrollForm')?.querySelectorAll('input, select, button').forEach(input => { input.disabled = disabled || !state.current; });
        byId('educationGroupMembers')?.querySelectorAll('button').forEach(button => { button.disabled = disabled; });
        const form = byId('educationGroupForm');
        if (saveInFlight || state.detailStatus === 'loading') form?.setAttribute('aria-busy', 'true');
        else form?.removeAttribute('aria-busy');
        if (byId('educationGroupRetry')) byId('educationGroupRetry').hidden = state.detailStatus !== 'error' && state.listStatus !== 'error';
        teacherManagerControls();
    }

    function teacherManagerControls() {
        const busy = Boolean(teacherManagerBusy);
        const canCreate = typeof global.canUseAction !== 'function' || global.canUseAction('create_booking');
        const canEdit = typeof global.canUseAction !== 'function' || global.canUseAction('edit_booking');
        const form = byId('educationTeacherCreateForm');
        form?.querySelectorAll('input,button').forEach(control => { control.disabled = busy || !canCreate; });
        if (busy) form?.setAttribute('aria-busy','true'); else form?.removeAttribute('aria-busy');
        byId('educationTeacherManagerList')?.querySelectorAll('button').forEach(button => { button.disabled = busy || !canEdit; });
        if (byId('educationTeacherManagerRefresh')) byId('educationTeacherManagerRefresh').disabled = busy;
    }

    function managerStatus(message, kind='info') {
        const node = byId('educationTeacherManagerStatus');
        if (node) { node.textContent = message; node.dataset.state = kind; }
    }

    async function loadTeacherManager() {
        const target = capture(), version = ++teacherManagerVersion;
        managerStatus('Завантаження викладачів...');
        try {
            const data = await request(`/teachers?businessContext=${encodeURIComponent(target.business)}&includeInactive=true`);
            if (!isCurrent(target) || version !== teacherManagerVersion) return false;
            if (!Array.isArray(data.teachers)) throw new Error('Некоректний довідник викладачів');
            byId('educationTeacherManagerList').innerHTML = data.teachers.map(person => `<li><div class="education-member-copy"><strong>${escape(person.name)}</strong><small>${person.is_active ? 'Працює в цьому центрі' : 'Неактивний у цьому центрі'}</small></div><button type="button" class="btn-secondary education-action${person.is_active ? ' education-action--danger' : ''}" data-teacher-active="${person.id}" data-next-active="${!person.is_active}">${person.is_active ? 'Завершити роботу' : 'Відновити роботу'}</button></li>`).join('');
            managerStatus(data.teachers.length ? `${data.teachers.length} викладачів` : 'Викладачів ще немає. Додайте першого.');
            teacherManagerControls(); return true;
        } catch (error) {
            if (isCurrent(target) && version === teacherManagerVersion) managerStatus(error.message,'error');
            return false;
        }
    }

    async function teacherMutation(write, success) {
        if (teacherManagerBusy) return;
        const target = capture(); teacherManagerBusy = target; teacherManagerControls(); managerStatus('Збереження викладача...');
        try {
            const result = await write();
            if (!isCurrent(target)) return;
            if (success === 'Викладача додано.') byId('educationTeacherCreateForm').reset();
            global.dispatchEvent(new CustomEvent('education:teachers-updated', {detail:{business:target.business}}));
            await loadTeachers();
            const refreshed = await loadTeacherManager();
            if (isCurrent(target)) managerStatus(refreshed ? success : `${success} Не вдалося оновити список; натисніть «Оновити викладачів».`,refreshed?'success':'error');
            return result;
        } catch (error) { if (isCurrent(target)) managerStatus(error.message,'error'); }
        finally { if (teacherManagerBusy === target) { teacherManagerBusy = null; teacherManagerControls(); } }
    }

    function teacherOptions(value = byId('educationGroupTeacher')?.value || '') {
        const select = byId('educationGroupTeacher');
        if (!select) return;
        select.innerHTML = '<option value="">Без викладача</option>' + state.teachers
            .map(person => `<option value="${Number(person.id)}">${escape(person.name)}</option>`).join('');
        if (value && !Array.from(select.options).some(option => option.value === String(value))) {
            const option = document.createElement('option');
            option.value = String(value); option.textContent = state.current?.teacher_name || `Призначений викладач (${value})`;
            select.appendChild(option);
        }
        select.value = value;
    }

    async function mutate(message, write) {
        if (!actionable() || saveInFlight) return;
        const attempt = selectionRequest();
        saveInFlight = attempt; controls(); status('Збереження змін...');
        try {
            const result = await write(attempt);
            if (!sameSelection(attempt)) return;
            const listed = await load();
            if (!listed && isCurrent(attempt) && attempt.version === detailVersion && attempt.id === state.selectedId) {
                const id = String(result?.group?.id || attempt.id);
                // The write succeeded. Retain its identity so retry cannot create a duplicate group.
                state.selectedId = id; state.current = null; state.detailStatus = 'error';
                const select = byId('educationGroupsList');
                if (id && select && !Array.from(select.options).some(option => option.value === id)) {
                    const option = document.createElement('option'); option.value = id; option.textContent = result?.group?.name || 'Вибрана група'; select.appendChild(option);
                }
                if (select) select.value = id;
                if (byId('educationGroupRoster')) byId('educationGroupRoster').hidden = true;
                controls(); status(`${message} Не вдалося оновити список; повторіть завантаження.`); return;
            }
            if (!sameSelection(attempt)) return;
            const id = result?.group?.id || attempt.id;
            if (byId('educationGroupsList')) byId('educationGroupsList').value = String(id);
            await showGroup(id);
            if (isCurrent(attempt) && String(state.current?.id) === String(id) && state.detailStatus === 'ready') status(message);
        } catch (error) {
            if (sameSelection(attempt)) status(error.message, 'error');
        } finally {
            if (saveInFlight === attempt) { saveInFlight = null; controls(); }
        }
    }

    async function request(path, options = {}) {
        const controller = !options.method || options.method === 'GET' ? new global.AbortController() : null;
        const timeout = controller ? global.setTimeout(() => controller.abort(), 20000) : null;
        try {
        const response = await fetch(url(path), {
            ...options,
            ...(controller ? { signal: controller.signal } : {}),
            headers: { ...getAuthHeaders(), ...(options.headers || {}) },
            body: options.body == null ? undefined : JSON.stringify({ ...options.body, businessContext: context() })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        return payload;
        } catch (error) {
            if (error.name === 'AbortError') throw new Error('Час очікування вичерпано. Спробуйте знову.');
            throw error;
        } finally { if (timeout !== null) global.clearTimeout(timeout); }
    }

    function status(message, kind = 'info') {
        if (byId('educationGroupsStatus')) {
            byId('educationGroupsStatus').textContent = message;
            byId('educationGroupsStatus').dataset.state = kind;
        }
    }

    function optionMarkup(groups, emptyLabel, includeArchived = false) {
        return `<option value="">${escape(emptyLabel)}</option>` + groups
            .filter(group => includeArchived || group.status === 'active')
            .map(group => `<option value="${group.id}">${escape(group.name)}${group.status === 'archived' ? ' (архів)' : ''}</option>`).join('');
    }

    function syncOptions() {
        const selected = state.selectedId;
        const formSelection = byId('educationLessonGroupId')?.value || '';
        const filter = byId('educationScheduleGroupFilter')?.value || '';
        if (byId('educationGroupsList')) {
            byId('educationGroupsList').innerHTML = optionMarkup(state.groups, 'Нова група', true);
            byId('educationGroupsList').value = selected;
        }
        if (byId('educationLessonGroupId')) {
            byId('educationLessonGroupId').innerHTML = optionMarkup(
                state.groups.filter(group => group.status === 'active' || String(group.id) === formSelection),
                'Без повʼязаної групи', true
            );
            byId('educationLessonGroupId').value = formSelection;
        }
        if (byId('educationScheduleGroupFilter')) {
            byId('educationScheduleGroupFilter').innerHTML = optionMarkup(state.groups, 'Усі групи', true);
            byId('educationScheduleGroupFilter').value = filter;
        }
    }

    async function load() {
        if (typeof global.hasAuthenticatedRuntimeSession === 'function' && !global.hasAuthenticatedRuntimeSession()) return;
        if (state.teacherStatus === 'idle') void loadTeachers();
        const requestState = capture();
        const version = ++listVersion;
        try {
            const payload = await request(`?businessContext=${encodeURIComponent(requestState.business)}&includeArchived=true`);
            if (!isCurrent(requestState) || version !== listVersion) return;
            state.groups = payload.groups || [];
            state.listStatus = 'ready';
            syncOptions();
            controls();
            status(`${state.groups.length} груп`);
            document.dispatchEvent(new Event('education:groups-updated'));
            return true;
        } catch (error) {
            if (!isCurrent(requestState) || version !== listVersion) return;
            state.groups = [];
            state.listStatus = 'error';
            syncOptions();
            controls();
            status(`Не вдалося завантажити групи: ${error.message}`, 'error');
            return false;
        }
    }

    async function showGroup(id) {
        id = String(id || '');
        const requestState = capture();
        const version = ++detailVersion;
        searchVersion += 1;
        state.selectedId = id;
        state.current = null;
        state.detailStatus = id ? 'loading' : 'new';
        if (byId('educationGroupsList')) byId('educationGroupsList').value = id;
        byId('educationGroupForm')?.reset();
        teacherOptions('');
        if (byId('educationGroupArchive')) byId('educationGroupArchive').hidden = true;
        if (byId('educationGroupRoster')) byId('educationGroupRoster').hidden = true;
        if (byId('educationChildSelect')) byId('educationChildSelect').innerHTML = '<option value="">Оберіть дитину</option>';
        if (byId('educationChildSearch')) byId('educationChildSearch').value = '';
        if (byId('educationGroupMembers')) byId('educationGroupMembers').innerHTML = '';
        controls();
        if (!id) {
            status('Нова група.');
            return;
        }
        status('Завантаження групи...');
        try {
            const { group } = await request(`/${encodeURIComponent(id)}?businessContext=${encodeURIComponent(requestState.business)}`);
            if (!isCurrent(requestState) || version !== detailVersion || state.selectedId !== id || !selectionMatches()) return;
            if (String(group?.id) !== id) throw new Error('Отримано іншу групу. Повторіть завантаження.');
            state.current = group;
            state.detailStatus = 'ready';
            byId('educationGroupName').value = group.name;
            teacherOptions(group.teacher_id ? String(group.teacher_id) : '');
            byId('educationGroupCapacity').value = group.capacity;
            byId('educationGroupArchive').hidden = group.status !== 'active';
            byId('educationGroupRoster').hidden = false;
            byId('educationGroupEnrollForm').hidden = group.status !== 'active';
            const active = group.members.filter(member => {
                const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' });
                return member.start_date.slice(0, 10) <= today && (!member.end_date || member.end_date.slice(0, 10) >= today);
            });
            byId('educationGroupOccupancy').textContent = `${active.length} / ${group.capacity} дітей сьогодні`;
            byId('educationGroupMembers').innerHTML = group.members.length
                ? `<ul class="education-member-list">${group.members.map(member => `<li><div class="education-member-copy"><strong>${escape(member.child_name || `Учень ${member.child_id}`)}</strong><small>Представник: ${escape(member.parent_name || 'не вказаний')}</small><small>Участь: ${escape(member.start_date.slice(0, 10))} — ${escape(member.end_date?.slice(0, 10) || 'дотепер')}</small></div>${!member.end_date && group.status === 'active' ? ` <button type="button" class="btn-secondary education-action education-action--danger" data-end-member="${member.id}" aria-label="Завершити участь: ${escape(member.child_name || member.child_id)}">Завершити</button>` : ''}</li>`).join('')}</ul>`
                : '<p>Дітей ще не зараховано.</p>';
            controls();
            status(group.status === 'active' ? 'Групу завантажено.' : 'Архівна група.');
        } catch (error) {
            if (isCurrent(requestState) && version === detailVersion && state.selectedId === id) {
                state.detailStatus = 'error'; controls(); status(`Не вдалося завантажити групу: ${error.message}`, 'error');
            }
        }
    }

    async function loadTeachers() {
        if (typeof global.hasAuthenticatedRuntimeSession === 'function' && !global.hasAuthenticatedRuntimeSession()) return;
        const requestState = capture();
        const version = ++teacherVersion;
        state.teacherStatus = 'loading'; controls();
        if (byId('educationGroupTeacherStatus')) byId('educationGroupTeacherStatus').textContent = 'Завантаження довідника викладачів...';
        if (byId('educationTeachersRetry')) byId('educationTeachersRetry').hidden = true;
        try {
            const data = await request(`/teachers?businessContext=${encodeURIComponent(requestState.business)}`);
            if (!isCurrent(requestState) || version !== teacherVersion) return;
            if (!Array.isArray(data.teachers)) throw new Error('Некоректний довідник викладачів');
            state.teachers = data.teachers; state.teacherStatus = 'ready'; teacherOptions(); controls();
            if (byId('educationGroupTeacherStatus')) byId('educationGroupTeacherStatus').textContent = '';
        } catch {
            if (isCurrent(requestState) && version === teacherVersion) {
                state.teacherStatus = 'error'; controls();
                if (byId('educationGroupTeacherStatus')) byId('educationGroupTeacherStatus').textContent = 'Довідник викладачів не завантажився. Призначення збережено; зміна викладача тимчасово недоступна.';
                if (byId('educationTeachersRetry')) byId('educationTeachersRetry').hidden = false;
            }
        }
    }

    async function save(event) {
        event.preventDefault();
        if (!actionable() || saveInFlight) return;
        const id = state.current?.id;
        const draft = { name: byId('educationGroupName').value.trim(),
            teacherId: byId('educationGroupTeacher').value || null,
            capacity: Number(byId('educationGroupCapacity').value) };
        await mutate('Групу збережено.', () => request(id ? `/${id}` : '/', {
                method: id ? 'PUT' : 'POST',
                body: draft
            }));
    }

    async function searchChildren() {
        if (!actionable() || !state.current || saveInFlight) return;
        const requestState = selectionRequest();
        const version = ++searchVersion;
        const q = byId('educationChildSearch').value.trim();
        byId('educationChildSelect').innerHTML = '<option value="">Оберіть дитину</option>';
        if (q.length < 2) return status('Введіть щонайменше 2 символи.');
        try {
            const { children } = await request(`/children/search?businessContext=${encodeURIComponent(requestState.business)}&q=${encodeURIComponent(q)}`);
            if (!sameSelection(requestState) || version !== searchVersion || byId('educationChildSearch').value.trim() !== q) return;
            byId('educationChildSelect').innerHTML = '<option value="">Оберіть дитину</option>' + children
                .map(child => `<option value="${child.id}">${escape(child.name || `ID ${child.id}`)} · ${escape(child.parent_name)}</option>`).join('');
            status(`${children.length} результатів`);
        } catch (error) {
            if (sameSelection(requestState) && version === searchVersion) status(error.message);
        }
    }

    async function enroll(event) {
        event.preventDefault();
        if (!actionable() || !state.current || saveInFlight) return;
        const groupId = state.current.id;
        const body = { childId: byId('educationChildSelect').value, startDate: byId('educationMemberStart').value,
            endDate: byId('educationMemberEnd').value || null };
        await mutate('Дитину зараховано.', () => request(`/${groupId}/members`, {
                method: 'POST',
                body
            }));
    }

    document.addEventListener('DOMContentLoaded', () => {
        byId('educationTeacherManager')?.addEventListener('toggle', () => {
            if (byId('educationTeacherManager').open) void loadTeacherManager();
        });
        byId('educationTeacherManagerRefresh')?.addEventListener('click', async () => { await loadTeachers(); await loadTeacherManager(); });
        byId('educationTeacherCreateForm')?.addEventListener('submit', event => {
            event.preventDefault();
            const name = byId('educationTeacherName').value.trim();
            if (!name || !byId('educationTeacherCreateForm').reportValidity()) return;
            void teacherMutation(() => request('/teachers',{method:'POST',body:{name}}),'Викладача додано.');
        });
        byId('educationTeacherManagerList')?.addEventListener('click', event => {
            const button = event.target.closest('[data-teacher-active]');
            if (!button || button.disabled) return;
            const id = button.dataset.teacherActive, isActive = button.dataset.nextActive === 'true';
            void teacherMutation(() => request(`/teachers/${id}`,{method:'PUT',body:{isActive}}),isActive?'Роботу викладача відновлено.':'Роботу викладача завершено.');
        });
        document.addEventListener('click', async event => {
            const id = event.target.closest('[data-education-detail-group]')?.dataset.educationDetailGroup;
            if (!id) return;
            const requestState = capture();
            if (typeof global.closeAllModals === 'function') await global.closeAllModals();
            else byId('bookingModal')?.classList.add('hidden');
            if (!isCurrent(requestState)) return;
            global.EducationScheduleWorkspace?.setView('groups');
            await load();
            if (!isCurrent(requestState)) return;
            byId('educationGroupsList').value = id;
            await showGroup(id);
        });
        byId('educationLessonGroupId')?.addEventListener('change', event => {
            const group = state.groups.find(item => String(item.id) === event.target.value);
            if (group && byId('educationLessonGroup')) {
                byId('educationLessonGroup').value = group.name;
                byId('educationLessonGroup').dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
        byId('educationGroupsList')?.addEventListener('change', event => void showGroup(event.target.value));
        byId('educationGroupForm')?.addEventListener('submit', save);
        byId('educationGroupEnrollForm')?.addEventListener('submit', enroll);
        byId('educationChildFind')?.addEventListener('click', () => void searchChildren());
        byId('educationGroupRetry')?.addEventListener('click', async () => {
            const target = selectionRequest();
            if (state.listStatus === 'error') await load();
            if (isCurrent(target) && target.id === state.selectedId && state.listStatus !== 'error') await showGroup(target.id);
        });
        byId('educationTeachersRetry')?.addEventListener('click', () => void loadTeachers());
        byId('educationChildSearch')?.addEventListener('input', () => {
            searchVersion += 1;
            byId('educationChildSelect').innerHTML = '<option value="">Оберіть дитину</option>';
        });
        byId('educationGroupArchive')?.addEventListener('click', async () => {
            if (!actionable() || !state.current || saveInFlight) return;
            const target = selectionRequest();
            if (!global.confirm('Архівувати групу? Історія занять і членства збережеться.') || !sameSelection(target)) return;
            await mutate('Групу архівовано.', () => request(`/${target.id}/archive`, { method: 'POST', body: {} }));
        });
        byId('educationGroupMembers')?.addEventListener('click', async event => {
            const id = event.target.closest('[data-end-member]')?.dataset.endMember;
            if (!id || !actionable() || !state.current || saveInFlight || !state.current.members.some(member => String(member.id) === id)) return;
            const target = selectionRequest();
            const endDate = global.prompt('Дата завершення (РРРР-ММ-ДД)', new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' }));
            if (!endDate || !sameSelection(target)) return;
            await mutate('Членство завершено.', () => request(`/${target.id}/members/${id}/end`, { method: 'POST', body: { endDate } }));
        });
        byId('educationMemberStart').value = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' });
        controls();
    });
    global.addEventListener('timeline:business-context-changed', () => {
        generation += 1;
        saveInFlight = null;
        teacherManagerBusy = null;
        teacherManagerVersion += 1;
        byId('educationTeacherCreateForm')?.reset();
        if (byId('educationTeacherManagerList')) byId('educationTeacherManagerList').innerHTML = '';
        managerStatus('');
        if (byId('educationTeacherManager')) byId('educationTeacherManager').open = false;
        byId('educationGroupForm')?.removeAttribute('aria-busy');
        listVersion += 1;
        searchVersion += 1;
        teacherVersion += 1;
        state.groups = [];
        state.listStatus = 'idle';
        state.teachers = [];
        state.teacherStatus = 'idle';
        void showGroup(null);
        syncOptions();
        if (byId('educationGroupsList')) byId('educationGroupsList').value = '';
        if (byId('educationLessonGroupId')) byId('educationLessonGroupId').value = '';
        if (byId('educationLessonGroup')) byId('educationLessonGroup').value = '';
        if (byId('educationScheduleGroupFilter')) byId('educationScheduleGroupFilter').value = '';
        if (byId('educationChildSearch')) byId('educationChildSearch').value = '';
        if (byId('educationChildSelect')) byId('educationChildSelect').innerHTML = '<option value="">Оберіть дитину</option>';
        status('');
        document.dispatchEvent(new Event('education:groups-updated'));
        void loadTeachers();
        void load();
    });
    global.addEventListener('crm:authenticated-runtime-ready', () => { void loadTeachers(); void load(); });
    global.EducationGroups = Object.freeze({ load, showGroup, state });
})(window);
