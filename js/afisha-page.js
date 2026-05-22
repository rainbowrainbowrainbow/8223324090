/**
 * afisha-page.js — standalone Afisha workspace.
 */
(function initAfishaPage() {
    const state = {
        items: [],
        templates: [],
        editingId: null,
        filterDate: '',
        filterType: ''
    };

    const TYPE_META = {
        event: { label: 'Подія', tone: 'event', icon: '🎭' },
        birthday: { label: 'День народження', tone: 'birthday', icon: '🎂' },
        regular: { label: 'Постійна', tone: 'regular', icon: '🔁' }
    };

    function $(id) {
        return document.getElementById(id);
    }

    function esc(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function notify(message, type = 'info') {
        if (typeof showNotification === 'function') showNotification(message, type);
    }

    async function confirmAfishaAction(message, okText = 'Видалити') {
        if (typeof confirmModal === 'function') {
            return confirmModal(message, { type: 'danger', okText, cancelText: 'Скасувати' });
        }
        if (typeof customConfirm === 'function') {
            return customConfirm(message, 'Підтвердження');
        }
        return typeof window.confirm === 'function' ? window.confirm(message) : false;
    }

    function todayIso() {
        return new Date().toISOString().slice(0, 10);
    }

    function queryParam(name) {
        return new URLSearchParams(window.location.search).get(name) || '';
    }

    function getHeaders(withJson = true) {
        if (typeof getAuthHeaders === 'function') return getAuthHeaders(withJson);
        const token = localStorage.getItem('pzp_token');
        const headers = {};
        if (withJson) headers['Content-Type'] = 'application/json';
        if (token) headers.Authorization = `Bearer ${token}`;
        return headers;
    }

    async function api(method, path, body = null) {
        const options = { method, headers: getHeaders(method !== 'GET') };
        if (body && method !== 'GET') options.body = JSON.stringify(body);
        const response = await fetch(`/api${path}`, options);
        if (typeof handleAuthError === 'function' && handleAuthError(response)) return null;
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            const err = new Error(data.error || `HTTP ${response.status}`);
            err.status = response.status;
            throw err;
        }
        return response.json();
    }

    function normalizeEvent(item = {}) {
        return {
            id: item.id,
            date: String(item.date || '').slice(0, 10),
            time: String(item.time || '').slice(0, 5),
            title: item.title || '',
            duration: Number(item.duration || 60),
            type: TYPE_META[item.type] ? item.type : 'event',
            description: item.description || '',
            lineId: item.line_id || null,
            templateId: item.template_id || null
        };
    }

    function visibleItems() {
        return state.items.filter(item => {
            if (state.filterDate && item.date !== state.filterDate) return false;
            if (state.filterType && item.type !== state.filterType) return false;
            return true;
        }).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    }

    function typeBadge(type) {
        const meta = TYPE_META[type] || TYPE_META.event;
        return `<span class="afisha-type-badge afisha-type-badge--${esc(meta.tone)}">${esc(meta.icon)} ${esc(meta.label)}</span>`;
    }

    function formatDuration(item) {
        if (item.type === 'birthday') return '15 хв';
        return `${Number(item.duration || 60)} хв`;
    }

    function renderStats() {
        const total = state.items.length;
        const today = state.items.filter(item => item.date === todayIso()).length;
        const birthdays = state.items.filter(item => item.type === 'birthday').length;
        const templates = state.templates.length;
        const container = $('afishaStats');
        if (!container) return;
        container.innerHTML = [
            ['Усього подій', total],
            ['Сьогодні', today],
            ['Дні народження', birthdays],
            ['Шаблони', templates]
        ].map(([label, value]) => `
            <div class="afisha-stat-card">
                <span>${esc(label)}</span>
                <strong>${esc(value)}</strong>
            </div>
        `).join('');
    }

    function renderList() {
        const container = $('afishaPageList');
        if (!container) return;
        const items = visibleItems();
        if (!items.length) {
            container.innerHTML = '<div class="empty-state">Подій за цим фільтром немає. Додайте першу подію у формі зліва.</div>';
            return;
        }
        container.innerHTML = items.map(item => `
            <article class="afisha-page-item" data-afisha-id="${esc(item.id)}">
                <div class="afisha-item-main">
                    <div class="afisha-item-topline">
                        ${typeBadge(item.type)}
                        <span>${esc(item.date)} · ${esc(item.time)} · ${esc(formatDuration(item))}</span>
                    </div>
                    <h3>${esc(item.title)}</h3>
                    ${item.description ? `<p>${esc(item.description)}</p>` : ''}
                    <div class="afisha-item-meta">
                        ${item.lineId ? `<span>Лінійка: ${esc(item.lineId)}</span>` : '<span>Без лінійки</span>'}
                        ${item.templateId ? `<span>Шаблон #${esc(item.templateId)}</span>` : ''}
                    </div>
                </div>
                <div class="afisha-item-actions">
                    <button type="button" data-afisha-action="tasks" data-id="${esc(item.id)}">Задачі</button>
                    <button type="button" data-afisha-action="edit" data-id="${esc(item.id)}">Редагувати</button>
                    <button type="button" data-afisha-action="delete" data-id="${esc(item.id)}">Видалити</button>
                </div>
            </article>
        `).join('');
    }

    function renderTemplates() {
        const container = $('afishaTemplateList');
        if (!container) return;
        if (!state.templates.length) {
            container.innerHTML = '<div class="empty-state compact">Шаблонів ще немає.</div>';
            return;
        }
        const labels = {
            daily: 'щодня',
            weekdays: 'будні',
            weekends: 'вихідні',
            weekly: 'щосуботи',
            custom: 'свої дні'
        };
        container.innerHTML = state.templates.map(tpl => `
            <article class="afisha-template-item" data-template-id="${esc(tpl.id)}">
                <div>
                    <strong>${esc(tpl.title)}</strong>
                    <span>${esc(tpl.time?.slice(0, 5) || '')} · ${esc(tpl.duration || 60)} хв · ${esc(labels[tpl.recurrence_pattern] || tpl.recurrence_pattern || 'weekly')}</span>
                </div>
                <button type="button" data-template-action="delete" data-id="${esc(tpl.id)}">Видалити</button>
            </article>
        `).join('');
    }

    function renderAll() {
        renderStats();
        renderList();
        renderTemplates();
    }

    async function loadData() {
        try {
            const [items, templates] = await Promise.all([
                api('GET', '/afisha'),
                api('GET', '/afisha/templates/list')
            ]);
            state.items = Array.isArray(items) ? items.map(normalizeEvent) : [];
            state.templates = Array.isArray(templates) ? templates : [];
            renderAll();
        } catch (err) {
            console.error('[afisha-page] load failed', err);
            notify(`Не вдалося завантажити афішу: ${err.message}`, 'error');
            $('afishaPageList').innerHTML = '<div class="empty-state">Не вдалося завантажити афішу. Спробуйте оновити сторінку.</div>';
        }
    }

    function resetForm() {
        state.editingId = null;
        $('afishaPageEditId').value = '';
        $('afishaPageTitle').value = '';
        $('afishaPageDescription').value = '';
        $('afishaPageDuration').value = '60';
        $('afishaPageType').value = 'event';
        $('afishaFormKicker').textContent = 'Нова подія';
        $('afishaFormTitle').textContent = 'Додати в афішу';
        $('afishaPageSubmitBtn').textContent = 'Додати подію';
        $('afishaCancelEditBtn').classList.add('hidden');
    }

    function collectFormPayload() {
        const type = $('afishaPageType').value || 'event';
        const duration = type === 'birthday' ? 15 : Number($('afishaPageDuration').value || 60);
        return {
            type,
            date: $('afishaPageDate').value,
            time: $('afishaPageTime').value,
            duration,
            title: $('afishaPageTitle').value.trim(),
            description: $('afishaPageDescription').value.trim()
        };
    }

    async function submitEvent(event) {
        event.preventDefault();
        const payload = collectFormPayload();
        if (!payload.date || !payload.time || !payload.title) {
            notify('Заповніть дату, час і назву події', 'error');
            return;
        }
        try {
            if (state.editingId) {
                await api('PUT', `/afisha/${encodeURIComponent(state.editingId)}`, payload);
                notify('Подію оновлено', 'success');
            } else {
                await api('POST', '/afisha', payload);
                notify('Подію додано в афішу', 'success');
            }
            resetForm();
            await loadData();
        } catch (err) {
            notify(`Не вдалося зберегти подію: ${err.message}`, 'error');
        }
    }

    function startEdit(id) {
        const item = state.items.find(entry => String(entry.id) === String(id));
        if (!item) return;
        state.editingId = item.id;
        $('afishaPageEditId').value = item.id;
        $('afishaPageType').value = item.type;
        $('afishaPageDate').value = item.date;
        $('afishaPageTime').value = item.time;
        $('afishaPageDuration').value = item.duration || 60;
        $('afishaPageTitle').value = item.title;
        $('afishaPageDescription').value = item.description || '';
        $('afishaFormKicker').textContent = 'Редагування';
        $('afishaFormTitle').textContent = 'Оновити подію';
        $('afishaPageSubmitBtn').textContent = 'Зберегти зміни';
        $('afishaCancelEditBtn').classList.remove('hidden');
        $('afishaPageTitle').focus();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    async function deleteEvent(id) {
        if (!(await confirmAfishaAction('Видалити цю подію з афіші?'))) return;
        try {
            await api('DELETE', `/afisha/${encodeURIComponent(id)}`);
            notify('Подію видалено', 'success');
            await loadData();
        } catch (err) {
            notify(`Не вдалося видалити: ${err.message}`, 'error');
        }
    }

    async function generateTasks(id) {
        try {
            const result = await api('POST', `/afisha/${encodeURIComponent(id)}/generate-tasks`);
            notify(`Задачі створено: ${result?.count || result?.tasks?.length || 0}`, 'success');
        } catch (err) {
            if (err.status === 409) notify('Задачі для цієї події вже створені', 'warning');
            else notify(`Не вдалося створити задачі: ${err.message}`, 'error');
        }
    }

    function handleListClick(event) {
        const button = event.target.closest('[data-afisha-action]');
        if (!button) return;
        const id = button.dataset.id;
        if (button.dataset.afishaAction === 'edit') startEdit(id);
        if (button.dataset.afishaAction === 'delete') deleteEvent(id);
        if (button.dataset.afishaAction === 'tasks') generateTasks(id);
    }

    async function distribute(reset = false) {
        const date = state.filterDate || $('afishaFilterDate').value || $('afishaPageDate').value;
        if (!date) {
            notify('Оберіть дату для розподілу', 'error');
            return;
        }
        try {
            const path = reset ? `/afisha/undistribute/${encodeURIComponent(date)}` : `/afisha/distribute/${encodeURIComponent(date)}`;
            const result = await api('POST', path);
            notify(reset ? `Розподіл скинуто: ${result?.reset || 0}` : `Розподіл виконано: ${result?.distribution?.length || 0}`, 'success');
            await loadData();
        } catch (err) {
            notify(`Розподіл не виконано: ${err.message}`, 'error');
        }
    }

    function importRows() {
        const text = $('afishaImportText').value.trim();
        if (!text) return notify('Вставте рядки для імпорту', 'error');
        const rows = text.split(/\n+/).map(line => line.trim()).filter(Boolean);
        return rows.reduce((chain, line) => chain.then(async count => {
            const [date, time, durationRaw, title, description = '', type = 'event'] = line.split(';').map(part => part.trim());
            if (!date || !time || !title) return count;
            await api('POST', '/afisha', {
                date,
                time,
                title,
                description,
                type: TYPE_META[type] ? type : 'event',
                duration: Number(durationRaw || 60)
            });
            return count + 1;
        }), Promise.resolve(0)).then(async count => {
            notify(`Імпортовано подій: ${count}`, 'success');
            $('afishaImportText').value = '';
            await loadData();
        }).catch(err => notify(`Імпорт зупинено: ${err.message}`, 'error'));
    }

    function exportCsv() {
        const rows = visibleItems();
        if (!rows.length) return notify('Немає подій для експорту', 'warning');
        const csv = ['date;time;duration;title;description;type']
            .concat(rows.map(item => [
                item.date,
                item.time,
                item.duration,
                item.title,
                item.description,
                item.type
            ].map(value => `"${String(value || '').replace(/"/g, '""')}"`).join(';')))
            .join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `afisha-${state.filterDate || 'all'}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    async function submitTemplate(event) {
        event.preventDefault();
        const payload = {
            title: $('afishaTplTitle').value.trim(),
            time: $('afishaTplTime').value,
            duration: Number($('afishaTplDuration').value || 60),
            recurrence_pattern: $('afishaTplPattern').value || 'weekly',
            recurrence_days: $('afishaTplDays').value.trim() || null,
            type: 'event'
        };
        if (!payload.title || !payload.time) return notify('Заповніть назву і час шаблону', 'error');
        try {
            await api('POST', '/afisha/templates', payload);
            $('afishaTemplateForm').reset();
            $('afishaTplTime').value = '12:00';
            $('afishaTplDuration').value = '60';
            $('afishaTplDays').classList.add('hidden');
            notify('Шаблон додано', 'success');
            await loadData();
        } catch (err) {
            notify(`Не вдалося створити шаблон: ${err.message}`, 'error');
        }
    }

    async function handleTemplateClick(event) {
        const button = event.target.closest('[data-template-action]');
        if (!button) return;
        if (button.dataset.templateAction !== 'delete') return;
        if (!(await confirmAfishaAction('Видалити шаблон афіші?'))) return;
        try {
            await api('DELETE', `/afisha/templates/${encodeURIComponent(button.dataset.id)}`);
            notify('Шаблон видалено', 'success');
            await loadData();
        } catch (err) {
            notify(`Не вдалося видалити шаблон: ${err.message}`, 'error');
        }
    }

    function syncTypeUi() {
        const isBirthday = $('afishaPageType').value === 'birthday';
        $('afishaPageDuration').disabled = isBirthday;
        if (isBirthday) $('afishaPageDuration').value = '15';
        $('afishaPageTitle').placeholder = isBirthday ? "Ім'я іменинника" : 'Назва події';
    }

    function bindEvents() {
        $('afishaPageForm')?.addEventListener('submit', submitEvent);
        $('afishaPageType')?.addEventListener('change', syncTypeUi);
        $('afishaCancelEditBtn')?.addEventListener('click', resetForm);
        $('afishaRefreshBtn')?.addEventListener('click', loadData);
        $('afishaFocusCreateBtn')?.addEventListener('click', () => $('afishaPageTitle')?.focus());
        $('afishaPageList')?.addEventListener('click', handleListClick);
        $('afishaFilterDate')?.addEventListener('change', event => {
            state.filterDate = event.target.value;
            renderList();
        });
        $('afishaFilterType')?.addEventListener('change', event => {
            state.filterType = event.target.value;
            renderList();
        });
        $('afishaDistributeBtn')?.addEventListener('click', () => distribute(false));
        $('afishaUndistributeBtn')?.addEventListener('click', () => distribute(true));
        $('afishaImportBtn')?.addEventListener('click', importRows);
        $('afishaExportBtn')?.addEventListener('click', exportCsv);
        $('afishaTemplateForm')?.addEventListener('submit', submitTemplate);
        $('afishaTemplateList')?.addEventListener('click', handleTemplateClick);
        $('afishaTplPattern')?.addEventListener('change', event => {
            $('afishaTplDays')?.classList.toggle('hidden', event.target.value !== 'custom');
        });
    }

    function initDefaults() {
        const date = queryParam('date') || todayIso();
        const time = queryParam('time') || '12:00';
        state.filterDate = queryParam('date') || '';
        $('afishaPageDate').value = date;
        $('afishaPageTime').value = time;
        $('afishaFilterDate').value = state.filterDate;
        syncTypeUi();
    }

    document.addEventListener('DOMContentLoaded', () => {
        initDefaults();
        bindEvents();
        loadData();
        if (window.Sidebar && typeof window.Sidebar.markShellReady === 'function') {
            window.Sidebar.markShellReady();
        }
    });
})();
