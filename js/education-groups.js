(function (global) {
    'use strict';

    const byId = id => document.getElementById(id);
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
    const state = { groups: [], current: null };
    const context = () => global.TimelineBusinessContext?.current?.()?.apiValue || 'event_genix';
    const url = path => `${API_BASE}/education/groups${path}`;
    let generation = 0;
    let listVersion = 0;
    let detailVersion = 0;
    let searchVersion = 0;
    let teacherVersion = 0;
    let saveInFlight = null;
    const capture = () => ({ business: context(), generation });
    const isCurrent = request => request.generation === generation && request.business === context();

    async function request(path, options = {}) {
        const response = await fetch(url(path), {
            ...options,
            headers: { ...getAuthHeaders(), ...(options.headers || {}) },
            body: options.body == null ? undefined : JSON.stringify({ ...options.body, businessContext: context() })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        return payload;
    }

    function status(message) {
        if (byId('educationGroupsStatus')) byId('educationGroupsStatus').textContent = message;
    }

    function optionMarkup(groups, emptyLabel, includeArchived = false) {
        return `<option value="">${escape(emptyLabel)}</option>` + groups
            .filter(group => includeArchived || group.status === 'active')
            .map(group => `<option value="${group.id}">${escape(group.name)}${group.status === 'archived' ? ' (архів)' : ''}</option>`).join('');
    }

    function syncOptions() {
        const selected = byId('educationGroupsList')?.value || '';
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
        const requestState = capture();
        const version = ++listVersion;
        try {
            const payload = await request(`?businessContext=${encodeURIComponent(requestState.business)}&includeArchived=true`);
            if (!isCurrent(requestState) || version !== listVersion) return;
            state.groups = payload.groups || [];
            syncOptions();
            status(`${state.groups.length} груп`);
            document.dispatchEvent(new Event('education:groups-updated'));
        } catch (error) {
            if (!isCurrent(requestState) || version !== listVersion) return;
            state.groups = [];
            syncOptions();
            status(`Не вдалося завантажити групи: ${error.message}`);
        }
    }

    async function showGroup(id) {
        const requestState = capture();
        const version = ++detailVersion;
        if (!id) {
            state.current = null;
            byId('educationGroupForm')?.reset();
            byId('educationGroupForm')?.querySelectorAll('input, select, button').forEach(input => { input.disabled = false; });
            if (byId('educationGroupArchive')) byId('educationGroupArchive').hidden = true;
            if (byId('educationGroupRoster')) byId('educationGroupRoster').hidden = true;
            return;
        }
        try {
            const { group } = await request(`/${encodeURIComponent(id)}?businessContext=${encodeURIComponent(requestState.business)}`);
            if (!isCurrent(requestState) || version !== detailVersion) return;
            state.current = group;
            byId('educationGroupName').value = group.name;
            byId('educationGroupTeacher').value = group.teacher_id || '';
            byId('educationGroupCapacity').value = group.capacity;
            byId('educationGroupArchive').hidden = group.status !== 'active';
            byId('educationGroupForm').querySelectorAll('input, select, button').forEach(input => {
                input.disabled = group.status !== 'active';
            });
            byId('educationGroupRoster').hidden = false;
            byId('educationGroupEnrollForm').hidden = group.status !== 'active';
            const active = group.members.filter(member => {
                const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' });
                return member.start_date.slice(0, 10) <= today && (!member.end_date || member.end_date.slice(0, 10) >= today);
            });
            byId('educationGroupOccupancy').textContent = `${active.length} / ${group.capacity} дітей сьогодні`;
            byId('educationGroupMembers').innerHTML = group.members.length
                ? `<ul>${group.members.map(member => `<li>${escape(member.child_name || `ID ${member.child_id}`)} · ${escape(member.parent_name || '')} · ${escape(member.start_date.slice(0, 10))} — ${escape(member.end_date?.slice(0, 10) || 'дотепер')}${!member.end_date && group.status === 'active' ? ` <button type="button" data-end-member="${member.id}">Завершити</button>` : ''}</li>`).join('')}</ul>`
                : '<p>Дітей ще не зараховано.</p>';
        } catch (error) {
            if (isCurrent(requestState) && version === detailVersion) status(error.message);
        }
    }

    async function loadTeachers() {
        const requestState = capture();
        const version = ++teacherVersion;
        try {
            const response = await fetch(`${API_BASE}/staff?active=true`, { headers: getAuthHeaders() });
            if (!isCurrent(requestState) || version !== teacherVersion) return;
            if (!response.ok) return;
            const data = await response.json();
            if (!isCurrent(requestState) || version !== teacherVersion) return;
            const staff = Array.isArray(data.staff) ? data.staff : Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [];
            byId('educationGroupTeacher').innerHTML = '<option value="">Без викладача</option>' + staff
                .filter(person => person.id && person.is_active !== false)
                .map(person => `<option value="${Number(person.id)}">${escape(person.name)}</option>`).join('');
        } catch {
            if (isCurrent(requestState) && version === teacherVersion) status('Не вдалося завантажити викладачів.');
        }
    }

    async function save(event) {
        event.preventDefault();
        if (saveInFlight) return;
        const requestState = capture();
        const version = detailVersion;
        const id = state.current?.id;
        const form = byId('educationGroupForm');
        const submit = form?.querySelector('button[type="submit"]');
        const attempt = { requestState, version };
        saveInFlight = attempt;
        if (submit) submit.disabled = true;
        form?.setAttribute('aria-busy', 'true');
        status('Збереження групи...');
        try {
            const { group } = await request(id ? `/${id}` : '/', {
                method: id ? 'PUT' : 'POST',
                body: {
                    name: byId('educationGroupName').value.trim(),
                    teacherId: byId('educationGroupTeacher').value || null,
                    capacity: Number(byId('educationGroupCapacity').value)
                }
            });
            if (!isCurrent(requestState) || version !== detailVersion) return;
            await load();
            if (!isCurrent(requestState) || version !== detailVersion) return;
            byId('educationGroupsList').value = group.id;
            await showGroup(group.id);
            if (isCurrent(requestState) && String(state.current?.id) === String(group.id)) status('Групу збережено.');
        } catch (error) {
            if (isCurrent(requestState) && version === detailVersion) status(error.message);
        } finally {
            if (saveInFlight === attempt) {
                saveInFlight = null;
                form?.removeAttribute('aria-busy');
                if (submit && isCurrent(requestState) && version === detailVersion) {
                    submit.disabled = state.current?.status === 'archived';
                }
            }
        }
    }

    async function searchChildren() {
        const requestState = capture();
        const version = ++searchVersion;
        const q = byId('educationChildSearch').value.trim();
        if (q.length < 2) return status('Введіть щонайменше 2 символи.');
        try {
            const { children } = await request(`/children/search?businessContext=${encodeURIComponent(requestState.business)}&q=${encodeURIComponent(q)}`);
            if (!isCurrent(requestState) || version !== searchVersion) return;
            byId('educationChildSelect').innerHTML = '<option value="">Оберіть дитину</option>' + children
                .map(child => `<option value="${child.id}">${escape(child.name || `ID ${child.id}`)} · ${escape(child.parent_name)}</option>`).join('');
            status(`${children.length} результатів`);
        } catch (error) {
            if (isCurrent(requestState) && version === searchVersion) status(error.message);
        }
    }

    async function enroll(event) {
        event.preventDefault();
        if (!state.current) return;
        const requestState = capture();
        const version = detailVersion;
        const groupId = state.current.id;
        try {
            await request(`/${groupId}/members`, {
                method: 'POST',
                body: {
                    childId: byId('educationChildSelect').value,
                    startDate: byId('educationMemberStart').value,
                    endDate: byId('educationMemberEnd').value || null
                }
            });
            if (!isCurrent(requestState) || version !== detailVersion) return;
            await showGroup(groupId);
            if (!isCurrent(requestState) || String(state.current?.id) !== String(groupId)) return;
            await load();
            if (isCurrent(requestState) && String(state.current?.id) === String(groupId)) status('Дитину зараховано.');
        } catch (error) {
            if (isCurrent(requestState) && String(state.current?.id) === String(groupId)) status(error.message);
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
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
        byId('educationGroupArchive')?.addEventListener('click', async () => {
            if (!state.current || !global.confirm('Архівувати групу? Історія занять і членства збережеться.')) return;
            const requestState = capture();
            const groupId = state.current.id;
            const version = detailVersion;
            try {
                await request(`/${groupId}/archive`, { method: 'POST', body: {} });
                if (!isCurrent(requestState) || version !== detailVersion) return;
                await load();
                if (!isCurrent(requestState) || version !== detailVersion) return;
                await showGroup(groupId);
                if (isCurrent(requestState) && String(state.current?.id) === String(groupId)) status('Групу архівовано.');
            } catch (error) {
                if (isCurrent(requestState) && version === detailVersion) status(error.message);
            }
        });
        byId('educationGroupMembers')?.addEventListener('click', async event => {
            const id = event.target.closest('[data-end-member]')?.dataset.endMember;
            if (!id || !state.current) return;
            const endDate = global.prompt('Дата завершення (РРРР-ММ-ДД)', new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' }));
            if (!endDate) return;
            const requestState = capture();
            const groupId = state.current.id;
            const version = detailVersion;
            try {
                await request(`/${groupId}/members/${id}/end`, { method: 'POST', body: { endDate } });
                if (!isCurrent(requestState) || version !== detailVersion) return;
                await showGroup(groupId);
                if (!isCurrent(requestState) || String(state.current?.id) !== String(groupId)) return;
                await load();
                if (isCurrent(requestState) && String(state.current?.id) === String(groupId)) status('Членство завершено.');
            } catch (error) {
                if (isCurrent(requestState) && version === detailVersion) status(error.message);
            }
        });
        byId('educationMemberStart').value = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' });
        void loadTeachers();
        void load();
    });
    global.addEventListener('timeline:business-context-changed', () => {
        generation += 1;
        saveInFlight = null;
        byId('educationGroupForm')?.removeAttribute('aria-busy');
        listVersion += 1;
        searchVersion += 1;
        teacherVersion += 1;
        state.groups = [];
        state.current = null;
        void showGroup(null);
        syncOptions();
        if (byId('educationGroupsList')) byId('educationGroupsList').value = '';
        if (byId('educationLessonGroupId')) byId('educationLessonGroupId').value = '';
        if (byId('educationLessonGroup')) byId('educationLessonGroup').value = '';
        if (byId('educationScheduleGroupFilter')) byId('educationScheduleGroupFilter').value = '';
        if (byId('educationChildSearch')) byId('educationChildSearch').value = '';
        if (byId('educationChildSelect')) byId('educationChildSelect').innerHTML = '<option value="">Оберіть дитину</option>';
        if (byId('educationGroupTeacher')) byId('educationGroupTeacher').innerHTML = '<option value="">Без викладача</option>';
        status('');
        document.dispatchEvent(new Event('education:groups-updated'));
        void loadTeachers();
        void load();
    });
    global.EducationGroups = Object.freeze({ load, showGroup, state });
})(window);
