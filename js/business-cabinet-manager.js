(function businessCabinetManagerModule(global) {
    'use strict';

    const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
    const canManage = user => (user?.businessProfile?.organizations || []).some(organization => ['owner', 'admin'].includes(organization.role));

    async function request(path, method = 'GET', body) {
        const source = global.getAuthHeaders?.(Boolean(body)) || {};
        const headers = Object.fromEntries(Object.entries(source).filter(([key]) => !/^x-business-/i.test(key)));
        if (body) headers['Content-Type'] = 'application/json';
        const response = await global.apiFetchWithAuthRetry(path, { method, headers, authBusinessScope: false, ...(body ? { body: JSON.stringify(body) } : {}) });
        if (!response) throw new Error('Сесія змінилася. Оновіть сторінку.');
        const payload = await response.json();
        if (!response.ok || payload.success === false) {
            const error = new Error(response.status === 403 ? 'Керування кабінетами більше недоступне. Оновіть доступ.'
                : response.status === 409 ? 'Цю зміну не можна застосувати: запис уже існує або порушується правило власників.'
                    : response.status === 400 ? 'Перевірте назву, ключ бізнесу та дозволені модулі.' : 'Не вдалося виконати дію. Спробуйте ще раз.');
            error.status = response.status;
            error.code = payload.code;
            throw error;
        }
        return payload;
    }

    function moduleOptions(catalog, selected) {
        const modules = Array.isArray(catalog) ? catalog : [];
        function renderModule(module) {
            const supported = module.canEnable === true;
            return `<label class="business-cabinet-module"><input type="checkbox" data-cabinet-module="${escape(module.key)}" ${selected.includes(module.key) ? 'checked' : ''} ${supported ? '' : 'disabled'}><span>${escape(module.label || module.key)}${module.reason ? `<small>${escape(module.reason)}</small>` : supported ? '' : '<small>Модуль ще не підтримує ізоляцію бізнесів.</small>'}</span></label>`;
        }
        const unavailable = modules.filter(module => module.canEnable !== true);
        return modules.filter(module => module.canEnable === true).map(renderModule).join('')
            + (unavailable.length ? `<details data-cabinet-unavailable><summary>Недоступні модулі (${unavailable.length})</summary>${unavailable.map(renderModule).join('')}</details>` : '');
    }

    function mount(container, user) {
        if (!container) return;
        container.__businessCabinetCleanup?.();
        container.replaceChildren();
        container.hidden = !canManage(user);
        if (container.hidden) return;
        container.className = 'profile-work-panel profile-settings-panel business-cabinet-manager';
        container.setAttribute('aria-label', 'Організації та кабінети');
        let data = null;
        let organizationId = '';
        let draft = null;
        let dirty = false;
        let busy = false;
        let sequence = 0;
        let message = '';
        const identity = Number(user.id);
        const connected = () => container.isConnected && Number(global.AppState?.currentUser?.id) === identity;
        const current = ticket => connected() && ticket === sequence;
        const organization = () => data?.organizations?.find(item => String(item.id) === organizationId);
        const business = id => organization()?.businesses?.find(item => String(item.id) === String(id));
        const allowDiscard = () => !dirty || global.confirm('Відкинути незбережені зміни кабінету?');
        const focus = selector => container.querySelector(selector)?.focus();

        function render() {
            const org = organization();
            container.innerHTML = '<div class="profile-panel-head"><div><span class="profile-kicker">Організація</span><h2>Кабінети та модулі</h2></div></div>'
                + '<p>Назва й модулі належать бізнесу. Роль працівника налаштовується окремо в розділі «Команда та доступи».</p>'
                + `<div class="profile-avatar-action-row"><button type="button" data-cabinet-action="load" ${busy ? 'disabled' : ''}>${data ? 'Оновити кабінети' : 'Відкрити кабінети'}</button></div>`
                + `<p role="status" aria-live="polite" tabindex="-1" data-cabinet-status>${escape(message)}</p>`
                + (data ? `<label class="business-cabinet-field">Організація<select data-cabinet-organization ${busy ? 'disabled' : ''}>${data.organizations.map(item => `<option value="${escape(item.id)}" ${String(item.id) === organizationId ? 'selected' : ''}>${escape(item.name)}</option>`).join('')}</select></label>` : '')
                + (org ? `<p>${org.canEditBusinesses ? 'Ви можете створювати й налаштовувати кабінети цієї організації.' : 'Налаштування кабінетів змінює власник. Доступи працівників доступні нижче.'}</p>`
                    + `<div class="profile-avatar-action-row">${org.canCreateBusiness ? `<button type="button" data-cabinet-action="create" ${busy ? 'disabled' : ''}>Створити бізнес</button>` : ''}</div>`
                    + `<div class="business-cabinet-list">${(org.businesses || []).map(item => `<article class="profile-avatar-section"><h3>${escape(item.label)}</h3><p>${escape(item.shortLabel || item.label)} · ${item.status === 'active' ? 'Активний' : 'Неактивний'}</p><p><small>Ключ: ${escape(item.contextKey)}</small></p><p>${(item.moduleCatalog || []).filter(module => module.enabled && module.canEnable).map(module => escape(module.label || module.key)).join(', ') || 'Немає увімкнених підтримуваних модулів.'}</p><div class="profile-avatar-action-row">${org.canEditBusinesses ? `<button type="button" data-cabinet-action="edit" data-business-id="${escape(item.id)}" ${busy ? 'disabled' : ''}>Налаштувати</button><button type="button" data-cabinet-action="status" data-business-id="${escape(item.id)}" ${busy ? 'disabled' : ''}>${item.status === 'active' ? 'Деактивувати' : 'Активувати'}</button>` : ''}${org.canEditBusinesses && item.canInitializeResources ? `<button type="button" data-cabinet-action="initialize" data-business-id="${escape(item.id)}" ${busy ? 'disabled' : ''}>Ініціалізувати ресурси</button>` : ''}</div></article>`).join('') || '<p>У цій організації ще немає бізнесів.</p>'}</div>` : '')
                + (draft ? `<form data-cabinet-form class="profile-avatar-section"><h3>${draft.id ? 'Налаштування бізнесу' : 'Новий бізнес'}</h3><label class="business-cabinet-field">Назва<input name="label" maxlength="160" required value="${escape(draft.label)}"></label><label class="business-cabinet-field">Коротка назва<input name="shortLabel" maxlength="80" required value="${escape(draft.shortLabel)}"></label>${draft.id ? `<p>Ключ: ${escape(draft.contextKey)}. Його не можна змінити.</p>` : `<label class="business-cabinet-field">Стабільний ключ<input name="contextKey" pattern="[a-z][a-z0-9_]{2,63}" minlength="3" maxlength="64" required value="${escape(draft.contextKey)}" aria-describedby="business-cabinet-key-hint"></label><p id="business-cabinet-key-hint">Від 3 до 64 латинських малих літер, цифр або _. Перший символ — літера. Після створення ключ не змінюється.</p>`}<fieldset ${busy ? 'disabled' : ''}><legend>Модулі бізнесу</legend><p>Позначте потрібні модулі. Порожній вибір означає, що робочі модулі вимкнені. Права працівника не розширюються автоматично.</p>${moduleOptions(draft.moduleCatalog, draft.modules)}</fieldset><div class="profile-avatar-action-row"><button type="submit" class="profile-settings-primary" ${busy ? 'disabled' : ''}>Зберегти бізнес</button><button type="button" data-cabinet-action="cancel" ${busy ? 'disabled' : ''}>Скасувати</button></div></form>` : '');
            if (busy) container.querySelectorAll('input, select, button').forEach(element => { element.disabled = true; });
        }

        async function load(statusMessage = '') {
            const ticket = ++sequence;
            busy = true;
            message = 'Завантаження кабінетів…';
            render();
            try {
                const payload = await request('/api/organizations/management');
                if (!current(ticket)) return;
                data = payload;
                if (!organization()) organizationId = String(data.organizations[0]?.id || '');
                draft = null;
                dirty = false;
                message = statusMessage || (data.organizations.length ? '' : 'Немає організацій, якими ви можете керувати.');
            } catch (error) {
                if (!current(ticket)) return;
                data = null;
                draft = null;
                dirty = false;
                message = error.message;
            } finally {
                if (current(ticket)) {
                    busy = false;
                    render();
                    focus(statusMessage || !data ? '[data-cabinet-status]' : '[data-cabinet-organization]');
                }
            }
        }

        async function mutate(path, method, body) {
            const ticket = ++sequence;
            busy = true;
            message = 'Збереження…';
            render();
            try {
                const result = await request(path, method, body);
                if (!current(ticket)) return;
                const initialization = result.initialization;
                const text = initialization ? initialization.created > 0 ? 'Ресурси ініціалізовано.' : 'Нові ресурси не створені: наявні збережено, а для цього бізнесу може не бути стандартного набору.'
                    : 'Зміни збережено. Для роботи в новому бізнесі призначте собі окрему бізнес-роль у «Команда та доступи».';
                dirty = false;
                draft = null;
                await load(text);
                if (connected() && typeof global.hydrateBusinessOperatingProfile === 'function') {
                    await global.hydrateBusinessOperatingProfile(global.AppState.currentUser);
                }
            } catch (error) {
                if (!current(ticket)) return;
                if (error.status === 403) { data = null; draft = null; dirty = false; }
                message = error.message;
                busy = false;
                render();
                focus('[data-cabinet-status]');
            }
        }

        async function click(event) {
            const button = event.target.closest('[data-cabinet-action]');
            if (!button || !container.contains(button) || busy || !connected()) return;
            const action = button.dataset.cabinetAction;
            if (!allowDiscard()) return;
            const org = organization();
            const entry = business(button.dataset.businessId);
            if (action === 'load') return load();
            if (action === 'cancel') { draft = null; dirty = false; render(); focus('[data-cabinet-action="create"]'); }
            if (action === 'create' && org?.canCreateBusiness) {
                draft = { id: null, label: '', shortLabel: '', contextKey: '', modules: [], moduleCatalog: data.moduleRegistry || [] };
                dirty = false; render(); focus('[name="label"]');
            }
            if (action === 'edit' && org?.canEditBusinesses && entry) {
                draft = { ...entry, modules: [...(entry.modules || [])], moduleCatalog: entry.moduleCatalog || [], modulesChanged: false };
                dirty = false; render(); focus('[name="label"]');
            }
            if (action === 'status' && org?.canEditBusinesses && entry) {
                if (entry.status === 'active' && !global.confirm(`Деактивувати «${entry.label}»? Працівники втратять доступ до цього бізнесу.`)) return;
                return mutate(`/api/organizations/businesses/${encodeURIComponent(entry.id)}`, 'PATCH', { status: entry.status === 'active' ? 'inactive' : 'active' });
            }
            if (action === 'initialize' && org?.canEditBusinesses && entry?.canInitializeResources) return mutate(`/api/organizations/businesses/${encodeURIComponent(entry.id)}/initialize-resources`, 'POST', {});
        }

        function input(event) {
            if (!draft || busy || !event.target.closest('[data-cabinet-form]')) return;
            const form = container.querySelector('[data-cabinet-form]');
            draft.label = form.elements.label.value;
            draft.shortLabel = form.elements.shortLabel.value;
            if (!draft.id) draft.contextKey = form.elements.contextKey.value;
            if (event.target.matches('[data-cabinet-module]') && !event.target.disabled) {
                const key = event.target.dataset.cabinetModule;
                draft.modules = draft.modules.filter(item => item !== key);
                if (event.target.checked) draft.modules.push(key);
                draft.modulesChanged = true;
            }
            dirty = true;
        }

        function change(event) {
            if (!event.target.matches('[data-cabinet-organization]') || busy) return;
            if (!allowDiscard()) { event.target.value = organizationId; return; }
            organizationId = event.target.value;
            draft = null; dirty = false; message = ''; render(); focus('[data-cabinet-organization]');
        }

        async function submit(event) {
            if (!event.target.matches('[data-cabinet-form]')) return;
            event.preventDefault();
            if (!draft || busy || !connected() || !organization()?.canEditBusinesses || !event.target.reportValidity()) return;
            const body = { label: draft.label.trim(), shortLabel: draft.shortLabel.trim() };
            if (!draft.id || draft.modulesChanged) body.modules = draft.modules;
            if (!body.label || !body.shortLabel) { message = 'Вкажіть назву й коротку назву.'; render(); return; }
            const path = draft.id ? `/api/organizations/businesses/${encodeURIComponent(draft.id)}/configuration` : `/api/organizations/${encodeURIComponent(organizationId)}/businesses`;
            if (!draft.id) body.contextKey = draft.contextKey;
            return mutate(path, draft.id ? 'PATCH' : 'POST', body);
        }

        function invalidate() {
            if (!container.isConnected) { cleanup(); return; }
            const restoreFocus = container.contains(global.document.activeElement);
            sequence += 1;
            data = null; draft = null; dirty = false; busy = false;
            message = 'Доступ або бізнес змінився. Оновіть кабінети перед наступною дією.';
            container.hidden = Number(global.AppState?.currentUser?.id) !== identity || !canManage(global.AppState?.currentUser);
            render();
            if (restoreFocus && !container.hidden) focus('[data-cabinet-action="load"]');
        }

        function beforeUnload(event) {
            if (!connected() || !dirty) return;
            event.preventDefault(); event.returnValue = '';
        }
        const events = ['crmBusinessProfileChanged', 'crmBusinessContextChanged', 'crmBusinessScopeChanged'];
        function cleanup() {
            sequence += 1;
            container.removeEventListener('click', click);
            container.removeEventListener('input', input);
            container.removeEventListener('change', change);
            container.removeEventListener('submit', submit);
            events.forEach(name => global.removeEventListener(name, invalidate));
            global.removeEventListener('beforeunload', beforeUnload);
        }
        container.__businessCabinetCleanup = cleanup;
        container.addEventListener('click', click);
        container.addEventListener('input', input);
        container.addEventListener('change', change);
        container.addEventListener('submit', submit);
        events.forEach(name => global.addEventListener(name, invalidate));
        global.addEventListener('beforeunload', beforeUnload);
        render();
    }

    global.BusinessCabinetManager = { canManage, moduleOptions, mount, request };
})(typeof window !== 'undefined' ? window : globalThis);
