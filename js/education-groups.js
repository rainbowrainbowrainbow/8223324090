(function (global) {
    'use strict';

    const byId = id => document.getElementById(id);
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
    const state = { groups: [], current: null };
    const context = () => global.TimelineBusinessContext?.current?.()?.apiValue || 'event_genix';
    const url = path => `${API_BASE}/education/groups${path}`;

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
        try {
            const payload = await request(`?businessContext=${encodeURIComponent(context())}&includeArchived=true`);
            state.groups = payload.groups || [];
            syncOptions();
            status(`${state.groups.length} груп`);
            document.dispatchEvent(new Event('education:groups-updated'));
        } catch (error) {
            state.groups = [];
            syncOptions();
            status(`Не вдалося завантажити групи: ${error.message}`);
        }
    }

    async function showGroup(id) {
        if (!id) {
            state.current = null;
            byId('educationGroupForm')?.reset();
            byId('educationGroupForm')?.querySelectorAll('input, select, button').forEach(input => { input.disabled = false; });
            if (byId('educationGroupArchive')) byId('educationGroupArchive').hidden = true;
            if (byId('educationGroupRoster')) byId('educationGroupRoster').hidden = true;
            return;
        }
        try {
            const { group } = await request(`/${encodeURIComponent(id)}?businessContext=${encodeURIComponent(context())}`);
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
        } catch (error) { status(error.message); }
    }

    async function loadTeachers() {
        try {
            const response = await fetch(`${API_BASE}/staff?active=true`, { headers: getAuthHeaders() });
            if (!response.ok) return;
            const data = await response.json();
            const staff = Array.isArray(data.staff) ? data.staff : Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [];
            byId('educationGroupTeacher').innerHTML = '<option value="">Без викладача</option>' + staff
                .filter(person => person.id && person.is_active !== false)
                .map(person => `<option value="${Number(person.id)}">${escape(person.name)}</option>`).join('');
        } catch { status('Не вдалося завантажити викладачів.'); }
    }

    async function save(event) {
        event.preventDefault();
        const id = state.current?.id;
        try {
            const { group } = await request(id ? `/${id}` : '/', {
                method: id ? 'PUT' : 'POST',
                body: {
                    name: byId('educationGroupName').value.trim(),
                    teacherId: byId('educationGroupTeacher').value || null,
                    capacity: Number(byId('educationGroupCapacity').value)
                }
            });
            await load();
            byId('educationGroupsList').value = group.id;
            await showGroup(group.id);
            status('Групу збережено.');
        } catch (error) { status(error.message); }
    }

    async function searchChildren() {
        const q = byId('educationChildSearch').value.trim();
        if (q.length < 2) return status('Введіть щонайменше 2 символи.');
        try {
            const { children } = await request(`/children/search?businessContext=${encodeURIComponent(context())}&q=${encodeURIComponent(q)}`);
            byId('educationChildSelect').innerHTML = '<option value="">Оберіть дитину</option>' + children
                .map(child => `<option value="${child.id}">${escape(child.name || `ID ${child.id}`)} · ${escape(child.parent_name)}</option>`).join('');
            status(`${children.length} результатів`);
        } catch (error) { status(error.message); }
    }

    async function enroll(event) {
        event.preventDefault();
        if (!state.current) return;
        try {
            await request(`/${state.current.id}/members`, {
                method: 'POST',
                body: {
                    childId: byId('educationChildSelect').value,
                    startDate: byId('educationMemberStart').value,
                    endDate: byId('educationMemberEnd').value || null
                }
            });
            await showGroup(state.current.id);
            await load();
            status('Дитину зараховано.');
        } catch (error) { status(error.message); }
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.addEventListener('click', async event => {
            const id = event.target.closest('[data-education-detail-group]')?.dataset.educationDetailGroup;
            if (!id) return;
            global.EducationScheduleWorkspace?.setView('groups');
            await load();
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
            try {
                await request(`/${state.current.id}/archive`, { method: 'POST', body: {} });
                await load();
                await showGroup(state.current.id);
                status('Групу архівовано.');
            } catch (error) { status(error.message); }
        });
        byId('educationGroupMembers')?.addEventListener('click', async event => {
            const id = event.target.closest('[data-end-member]')?.dataset.endMember;
            if (!id || !state.current) return;
            const endDate = global.prompt('Дата завершення (РРРР-ММ-ДД)', new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' }));
            if (!endDate) return;
            try {
                await request(`/${state.current.id}/members/${id}/end`, { method: 'POST', body: { endDate } });
                await showGroup(state.current.id);
                await load();
                status('Членство завершено.');
            } catch (error) { status(error.message); }
        });
        byId('educationMemberStart').value = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' });
        void loadTeachers();
        void load();
    });
    global.addEventListener('timeline:business-context-changed', () => {
        state.current = null;
        void showGroup(null);
        void load();
    });
    global.EducationGroups = Object.freeze({ load, showGroup, state });
})(window);
