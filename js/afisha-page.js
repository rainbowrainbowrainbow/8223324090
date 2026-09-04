/**
 * afisha-page.js - standalone event-centric Afisha workspace.
 */
(function initAfishaPage() {
    const MATERIAL_FILE_LIMIT_BYTES = 8 * 1024 * 1024;

    const state = {
        items: [],
        templates: [],
        editingId: null,
        filterDate: '',
        filterType: '',
        selectedId: null,
        materialsByEvent: {},
        loadingMaterialsId: null
    };

    const TYPE_META = {
        event: { label: 'Подія', tone: 'event', icon: '🎭' },
        birthday: { label: 'День народження', tone: 'birthday', icon: '🎂' },
        regular: { label: 'Постійна', tone: 'regular', icon: '🔁' }
    };

    const MATERIAL_META = {
        note: { label: 'Нотатка', tone: 'note' },
        link: { label: 'Посилання', tone: 'link' },
        file: { label: 'Файл', tone: 'file' }
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
        notify('Підтвердження недоступне. Оновіть сторінку і повторіть дію.', 'error');
        return false;
    }

    function todayIso() {
        return new Date().toISOString().slice(0, 10);
    }

    function queryParam(name) {
        return new URLSearchParams(window.location.search).get(name) || '';
    }

    function leadPrefillFromUrl() {
        const leadId = queryParam('leadId') || queryParam('lead');
        const customerName = queryParam('customerName').trim();
        const customerPhone = queryParam('customerPhone').trim();
        const date = (queryParam('eventDate') || queryParam('date')).trim();
        if (!leadId && !customerName && !customerPhone) return null;
        return {
            leadId,
            customerName,
            customerPhone,
            date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : ''
        };
    }

    function applyLeadPrefillToAfishaForm(prefill) {
        if (!prefill) return;
        const title = $('afishaPageTitle');
        const description = $('afishaPageDescription');
        const date = $('afishaPageDate');
        const filterDate = $('afishaFilterDate');
        if (prefill.customerName && title && !title.value) title.value = prefill.customerName;
        if (prefill.date) {
            if (date) date.value = prefill.date;
            if (filterDate) filterDate.value = prefill.date;
            state.filterDate = prefill.date;
        }
        if (description && !description.value) {
            description.value = [
                prefill.leadId ? `Lead #${prefill.leadId}` : '',
                prefill.customerPhone ? `Phone: ${prefill.customerPhone}` : ''
            ].filter(Boolean).join('\n');
        }
    }

    function getHeaders(withJson = true) {
        if (typeof getAuthHeaders === 'function') return getAuthHeaders(withJson);
        const token = localStorage.getItem('pzp_token');
        const headers = {};
        if (withJson) headers['Content-Type'] = 'application/json';
        if (token) headers.Authorization = `Bearer ${token}`;
        return headers;
    }

    async function parseApiResponse(response) {
        if (!response || (typeof handleAuthError === 'function' && handleAuthError(response))) return null;
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            const err = new Error(data.error || `HTTP ${response.status}`);
            err.status = response.status;
            throw err;
        }
        return response.json();
    }

    async function api(method, path, body = null) {
        const options = { method, headers: getHeaders(method !== 'GET') };
        if (body && method !== 'GET') options.body = JSON.stringify(body);
        return parseApiResponse(await apiFetchWithAuthRetry(`/api${path}`, options));
    }

    async function apiForm(method, path, formData) {
        return parseApiResponse(await apiFetchWithAuthRetry(`/api${path}`, {
            method,
            headers: getHeaders(false),
            body: formData
        }));
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

    function normalizeMaterial(item = {}) {
        return {
            id: item.id,
            eventId: item.event_id,
            kind: MATERIAL_META[item.kind] ? item.kind : 'note',
            title: item.title || '',
            description: item.description || '',
            url: item.url || '',
            originalName: item.original_name || '',
            mimeType: item.mime_type || '',
            fileSize: Number(item.file_size || 0),
            uploadedBy: item.uploaded_by || '',
            createdAt: item.created_at || '',
            downloadUrl: item.download_url || ''
        };
    }

    function visibleItems() {
        return state.items.filter(item => {
            if (state.filterDate && item.date !== state.filterDate) return false;
            if (state.filterType && item.type !== state.filterType) return false;
            return true;
        }).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    }

    function selectedItem() {
        return state.items.find(item => String(item.id) === String(state.selectedId)) || null;
    }

    function selectedMaterials() {
        if (!state.selectedId) return [];
        return state.materialsByEvent[String(state.selectedId)] || [];
    }

    function ensureSelection() {
        const visible = visibleItems();
        if (visible.some(item => String(item.id) === String(state.selectedId))) return false;
        const previous = state.selectedId;
        state.selectedId = visible[0]?.id || state.items[0]?.id || null;
        return String(previous || '') !== String(state.selectedId || '');
    }

    function typeBadge(type) {
        const meta = TYPE_META[type] || TYPE_META.event;
        return `<span class="afisha-type-badge afisha-type-badge--${esc(meta.tone)}">${esc(meta.icon)} ${esc(meta.label)}</span>`;
    }

    function materialBadge(kind) {
        const meta = MATERIAL_META[kind] || MATERIAL_META.note;
        return `<span class="afisha-material-badge afisha-material-badge--${esc(meta.tone)}">${esc(meta.label)}</span>`;
    }

    function formatDuration(item) {
        if (item.type === 'birthday') return '15 хв';
        return `${Number(item.duration || 60)} хв`;
    }

    function formatFileSize(size) {
        const bytes = Number(size || 0);
        if (!bytes) return '';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    function renderStats() {
        const total = state.items.length;
        const today = state.items.filter(item => item.date === todayIso()).length;
        const folders = Object.keys(state.materialsByEvent).length;
        const currentMaterials = selectedMaterials().length;
        const container = $('afishaStats');
        if (!container) return;
        container.innerHTML = [
            ['Усього подій', total],
            ['Сьогодні', today],
            ['Відкрито папок', folders],
            ['Матеріалів у події', currentMaterials]
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
            container.innerHTML = '<div class="empty-state">Подій за цим фільтром немає. Створіть нову подію або змініть фільтри.</div>';
            return;
        }
        container.innerHTML = items.map(item => {
            const materials = state.materialsByEvent[String(item.id)];
            const isActive = String(item.id) === String(state.selectedId);
            return `
                <article class="afisha-page-item ${isActive ? 'is-active' : ''}" data-afisha-id="${esc(item.id)}">
                    <button type="button" class="afisha-event-select" data-afisha-action="select" data-id="${esc(item.id)}" aria-pressed="${isActive ? 'true' : 'false'}">
                        ${window.EventCards.renderEventCardImage(item, { modifier: 'compact' })}
                        <div class="afisha-item-main">
                            <div class="afisha-item-topline">
                                ${typeBadge(item.type)}
                                <span>${esc(item.date)} · ${esc(item.time)} · ${esc(formatDuration(item))}</span>
                            </div>
                            <h3>${esc(item.title)}</h3>
                            ${item.description ? `<p>${esc(item.description)}</p>` : ''}
                            <div class="afisha-item-meta">
                                ${item.lineId ? `<span>Лінійка: ${esc(item.lineId)}</span>` : '<span>Без лінійки</span>'}
                                <span>Папка: ${materials ? esc(materials.length) : '...'}</span>
                                ${item.templateId ? `<span>Шаблон #${esc(item.templateId)}</span>` : ''}
                            </div>
                        </div>
                    </button>
                    <div class="afisha-item-actions">
                        <button type="button" data-afisha-action="tasks" data-id="${esc(item.id)}">Задачі</button>
                        <button type="button" data-afisha-action="edit" data-id="${esc(item.id)}">Редагувати</button>
                    </div>
                </article>
            `;
        }).join('');
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

    function renderEventWorkspace() {
        const container = $('afishaEventWorkspace');
        if (!container) return;
        const item = selectedItem();
        if (!item) {
            container.innerHTML = `
                <div class="afisha-empty-workspace">
                    <span>Event workspace</span>
                    <h2>Оберіть подію або створіть нову</h2>
                    <p>Після вибору тут зʼявляться деталі події, генерація задач і папка матеріалів.</p>
                </div>
            `;
            return;
        }
        const materials = selectedMaterials();
        container.innerHTML = `
            <article class="afisha-event-hero-card">
                ${window.EventCards.renderEventCardImage(item, { modifier: 'workspace' })}
                <div class="afisha-event-hero-main">
                    <div class="afisha-item-topline">
                        ${typeBadge(item.type)}
                        <span>${esc(item.date)} · ${esc(item.time)} · ${esc(formatDuration(item))}</span>
                    </div>
                    <h2>${esc(item.title)}</h2>
                    ${item.description ? `<p>${esc(item.description)}</p>` : '<p>Опис для команди ще не додано.</p>'}
                    <div class="afisha-event-facts">
                        <span>Папка матеріалів: ${String(state.loadingMaterialsId || '') === String(item.id) ? 'оновлюється' : materials.length}</span>
                        <span>${item.lineId ? `Лінійка: ${esc(item.lineId)}` : 'Лінійку не призначено'}</span>
                        ${item.templateId ? `<span>Recurring шаблон #${esc(item.templateId)}</span>` : '<span>Manual event</span>'}
                    </div>
                </div>
                <div class="afisha-event-actions">
                    <button type="button" class="btn-page-secondary" data-afisha-action="tasks" data-id="${esc(item.id)}">Згенерувати задачі</button>
                    <button type="button" class="btn-page-secondary" data-afisha-action="edit" data-id="${esc(item.id)}">Редагувати</button>
                    <button type="button" class="btn-page-secondary" data-afisha-action="delete" data-id="${esc(item.id)}">Видалити</button>
                </div>
            </article>
            <div class="afisha-date-actions">
                <button type="button" class="btn-page-secondary" id="afishaDistributeBtn">Розподілити по аніматорах</button>
                <button type="button" class="btn-page-secondary" id="afishaUndistributeBtn">Скинути розподіл</button>
            </div>
        `;
        $('afishaDistributeBtn')?.addEventListener('click', () => distribute(false));
        $('afishaUndistributeBtn')?.addEventListener('click', () => distribute(true));
    }

    function renderMaterials() {
        const title = $('afishaMaterialTitle');
        const list = $('afishaMaterialList');
        const form = $('afishaMaterialForm');
        const reload = $('afishaReloadMaterialsBtn');
        if (!list || !form) return;

        const item = selectedItem();
        const disabled = !item;
        form.querySelectorAll('input, select, textarea, button').forEach(control => {
            control.disabled = disabled;
        });
        if (reload) reload.disabled = disabled;

        if (!item) {
            if (title) title.textContent = 'Матеріали';
            list.innerHTML = '<div class="empty-state compact">Оберіть подію, щоб відкрити її папку матеріалів.</div>';
            return;
        }

        if (title) title.textContent = `Матеріали: ${item.title}`;
        if (String(state.loadingMaterialsId || '') === String(item.id)) {
            list.innerHTML = '<div class="empty-state compact">Оновлюємо папку матеріалів...</div>';
            return;
        }

        const materials = selectedMaterials();
        if (!materials.length) {
            list.innerHTML = '<div class="empty-state compact">У цій події ще немає матеріалів. Додайте нотатку, посилання або файл.</div>';
            return;
        }

        list.innerHTML = materials.map(material => `
            <article class="afisha-material-item" data-material-id="${esc(material.id)}">
                <div>
                    <div class="afisha-material-topline">
                        ${materialBadge(material.kind)}
                        ${material.fileSize ? `<span>${esc(formatFileSize(material.fileSize))}</span>` : ''}
                        ${material.uploadedBy ? `<span>${esc(material.uploadedBy)}</span>` : ''}
                    </div>
                    <h3>${esc(material.title)}</h3>
                    ${material.description ? `<p>${esc(material.description)}</p>` : ''}
                    ${material.kind === 'link' && material.url ? `<a href="${esc(material.url)}" target="_blank" rel="noopener">Відкрити посилання</a>` : ''}
                    ${material.kind === 'file' && material.downloadUrl ? `<a href="${esc(material.downloadUrl)}">Завантажити ${esc(material.originalName || 'файл')}</a>` : ''}
                </div>
                <button type="button" data-material-action="delete" data-id="${esc(material.id)}">Видалити</button>
            </article>
        `).join('');
    }

    function renderAll() {
        ensureSelection();
        renderStats();
        renderList();
        renderTemplates();
        renderEventWorkspace();
        renderMaterials();
        syncMaterialMode();
    }

    async function loadMaterials(eventId) {
        if (!eventId) return;
        state.loadingMaterialsId = eventId;
        renderStats();
        renderMaterials();
        try {
            const result = await api('GET', `/afisha/${encodeURIComponent(eventId)}/materials`);
            state.materialsByEvent[String(eventId)] = Array.isArray(result?.materials)
                ? result.materials.map(normalizeMaterial)
                : [];
        } catch (err) {
            notify(`Не вдалося завантажити матеріали: ${err.message}`, 'error');
            state.materialsByEvent[String(eventId)] = [];
        } finally {
            state.loadingMaterialsId = null;
            renderAll();
        }
    }

    async function loadData() {
        try {
            const [items, templates] = await Promise.all([
                api('GET', '/afisha'),
                api('GET', '/afisha/templates/list')
            ]);
            state.items = Array.isArray(items) ? items.map(normalizeEvent) : [];
            state.templates = Array.isArray(templates) ? templates : [];
            const selectionChanged = ensureSelection();
            renderAll();
            if (state.selectedId && (selectionChanged || !state.materialsByEvent[String(state.selectedId)])) {
                await loadMaterials(state.selectedId);
            }
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
        $('afishaFormTitle').textContent = 'Додати подію';
        $('afishaPageSubmitBtn').textContent = 'Додати подію';
        $('afishaCancelEditBtn').classList.add('hidden');
        syncTypeUi();
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
            let savedId = state.editingId;
            if (state.editingId) {
                await api('PUT', `/afisha/${encodeURIComponent(state.editingId)}`, payload);
                notify('Подію оновлено', 'success');
            } else {
                const result = await api('POST', '/afisha', payload);
                savedId = result?.item?.id || null;
                notify('Подію додано в афішу', 'success');
            }
            resetForm();
            if (savedId) state.selectedId = savedId;
            await loadData();
        } catch (err) {
            notify(`Не вдалося зберегти подію: ${err.message}`, 'error');
        }
    }

    function startEdit(id) {
        const item = state.items.find(entry => String(entry.id) === String(id));
        if (!item) return;
        state.selectedId = item.id;
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
        syncTypeUi();
        renderAll();
        $('afishaPageTitle').focus();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    async function deleteEvent(id) {
        if (!(await confirmAfishaAction('Видалити цю подію з афіші?'))) return;
        try {
            await api('DELETE', `/afisha/${encodeURIComponent(id)}`);
            notify('Подію видалено', 'success');
            if (String(state.selectedId) === String(id)) state.selectedId = null;
            delete state.materialsByEvent[String(id)];
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

    async function selectEvent(id) {
        state.selectedId = id;
        renderAll();
        if (!state.materialsByEvent[String(id)]) await loadMaterials(id);
    }

    function handleListClick(event) {
        const button = event.target.closest('[data-afisha-action]');
        if (!button) return;
        const id = button.dataset.id;
        if (button.dataset.afishaAction === 'select') selectEvent(id);
        if (button.dataset.afishaAction === 'edit') startEdit(id);
        if (button.dataset.afishaAction === 'delete') deleteEvent(id);
        if (button.dataset.afishaAction === 'tasks') generateTasks(id);
    }

    async function distribute(reset = false) {
        const item = selectedItem();
        const date = state.filterDate || item?.date || $('afishaFilterDate').value || $('afishaPageDate').value;
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
        const filename = `afisha-${state.filterDate || 'all'}.csv`;
        const touchWindow = typeof openTouchDownloadWindow === 'function'
            ? openTouchDownloadWindow('Afisha CSV')
            : null;
        if (typeof finishBlobDownload === 'function') {
            finishBlobDownload(blob, filename, { touchWindow, successMessage: 'CSV підготовлено' });
        } else {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
        }
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

    function syncMaterialMode() {
        const kind = $('afishaMaterialKind')?.value || 'note';
        $('afishaMaterialUrlWrap')?.classList.toggle('hidden', kind !== 'link');
        $('afishaMaterialFileWrap')?.classList.toggle('hidden', kind !== 'file');
    }

    async function submitMaterial(event) {
        event.preventDefault();
        const item = selectedItem();
        if (!item) return notify('Спочатку оберіть подію', 'error');

        const kind = $('afishaMaterialKind').value || 'note';
        const file = $('afishaMaterialFile').files?.[0] || null;
        let title = $('afishaMaterialName').value.trim();
        if (kind === 'file' && !title && file) title = file.name;
        const description = $('afishaMaterialDescription').value.trim();
        const url = $('afishaMaterialUrl').value.trim();

        if (!title) return notify('Назва матеріалу обовʼязкова', 'error');
        if (kind === 'link' && !url) return notify('Для посилання потрібен URL', 'error');
        if (kind === 'file' && !file) return notify('Додайте файл матеріалу', 'error');
        if (file && file.size > MATERIAL_FILE_LIMIT_BYTES) return notify('Матеріал завеликий. Максимум 8 МБ', 'error');

        try {
            if (kind === 'file') {
                const form = new FormData();
                form.append('title', title);
                form.append('description', description);
                form.append('file', file);
                await apiForm('POST', `/afisha/${encodeURIComponent(item.id)}/materials/upload`, form);
            } else {
                await api('POST', `/afisha/${encodeURIComponent(item.id)}/materials`, { kind, title, description, url });
            }
            $('afishaMaterialForm').reset();
            $('afishaMaterialKind').value = 'note';
            syncMaterialMode();
            notify('Матеріал додано в папку події', 'success');
            await loadMaterials(item.id);
        } catch (err) {
            notify(`Не вдалося додати матеріал: ${err.message}`, 'error');
        }
    }

    async function handleMaterialClick(event) {
        const button = event.target.closest('[data-material-action]');
        if (!button) return;
        const item = selectedItem();
        if (!item) return;
        if (button.dataset.materialAction !== 'delete') return;
        if (!(await confirmAfishaAction('Видалити матеріал з папки події?'))) return;
        try {
            await api('DELETE', `/afisha/${encodeURIComponent(item.id)}/materials/${encodeURIComponent(button.dataset.id)}`);
            notify('Матеріал видалено', 'success');
            await loadMaterials(item.id);
        } catch (err) {
            notify(`Не вдалося видалити матеріал: ${err.message}`, 'error');
        }
    }

    function handleFilterChange(event) {
        if (event.target.id === 'afishaFilterDate') state.filterDate = event.target.value;
        if (event.target.id === 'afishaFilterType') state.filterType = event.target.value;
        const changed = ensureSelection();
        renderAll();
        if (changed && state.selectedId && !state.materialsByEvent[String(state.selectedId)]) {
            loadMaterials(state.selectedId);
        }
    }

    function bindEvents() {
        $('afishaPageForm')?.addEventListener('submit', submitEvent);
        $('afishaPageType')?.addEventListener('change', syncTypeUi);
        $('afishaCancelEditBtn')?.addEventListener('click', resetForm);
        $('afishaRefreshBtn')?.addEventListener('click', loadData);
        $('afishaFocusCreateBtn')?.addEventListener('click', () => {
            resetForm();
            $('afishaPageTitle')?.focus();
            $('afishaPageForm')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        $('afishaPageList')?.addEventListener('click', handleListClick);
        $('afishaEventWorkspace')?.addEventListener('click', handleListClick);
        $('afishaFilterDate')?.addEventListener('change', handleFilterChange);
        $('afishaFilterType')?.addEventListener('change', handleFilterChange);
        $('afishaImportBtn')?.addEventListener('click', importRows);
        $('afishaExportBtn')?.addEventListener('click', exportCsv);
        $('afishaTemplateForm')?.addEventListener('submit', submitTemplate);
        $('afishaTemplateList')?.addEventListener('click', handleTemplateClick);
        $('afishaTplPattern')?.addEventListener('change', event => {
            $('afishaTplDays')?.classList.toggle('hidden', event.target.value !== 'custom');
        });
        $('afishaMaterialKind')?.addEventListener('change', syncMaterialMode);
        $('afishaMaterialForm')?.addEventListener('submit', submitMaterial);
        $('afishaMaterialList')?.addEventListener('click', handleMaterialClick);
        $('afishaReloadMaterialsBtn')?.addEventListener('click', () => {
            if (state.selectedId) loadMaterials(state.selectedId);
        });
    }

    async function bootstrapAfishaShell() {

        try {
            const user = await apiVerifyToken();
            if (!user) throw new Error('Auth check failed');
            if (typeof AppState !== 'undefined') AppState.currentUser = user;
            if (typeof showAuthenticatedPageShell === 'function') {
                showAuthenticatedPageShell();
            } else {
                $('mainApp')?.classList.remove('hidden');
                if (window.Sidebar && typeof window.Sidebar.markShellReady === 'function') {
                    window.Sidebar.markShellReady();
                }
            }
            return true;
        } catch (err) {
            console.error('[afisha-page] auth bootstrap failed', err);
            if (typeof handleTransientAuthSessionBootstrap === 'function'
                && handleTransientAuthSessionBootstrap({ retry: () => window.location.reload(), containerId: 'main-content' })) {
                return false;
            }
            if (typeof clearAuthenticatedPageShell === 'function') clearAuthenticatedPageShell();
            window.location.href = '/';
            return false;
        }
    }

    function initDefaults() {
        const date = queryParam('date') || todayIso();
        const time = queryParam('time') || '12:00';
        state.filterDate = queryParam('date') || '';
        state.selectedId = queryParam('event') || null;
        $('afishaPageDate').value = date;
        $('afishaPageTime').value = time;
        $('afishaFilterDate').value = state.filterDate;
        applyLeadPrefillToAfishaForm(leadPrefillFromUrl());
        syncTypeUi();
        syncMaterialMode();
    }

    document.addEventListener('DOMContentLoaded', async () => {
        const shellReady = await bootstrapAfishaShell();
        if (!shellReady) return;
        initDefaults();
        bindEvents();
        loadData();
    });
})();
