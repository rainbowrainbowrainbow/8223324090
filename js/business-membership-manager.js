(function businessMembershipManagerModule(global) {
    'use strict';

    function canManage(user) {
        return (user?.businessProfile?.organizations || []).some(organization => ['owner', 'admin'].includes(organization.role));
    }

    async function read(path) {
        const originalHeaders = typeof global.getAuthHeaders === 'function' ? global.getAuthHeaders(false) : {};
        const headers = Object.fromEntries(Object.entries(originalHeaders).filter(([key]) => !/^x-business-/i.test(key)));
        const response = typeof global.apiFetchWithAuthRetry === 'function'
            ? await global.apiFetchWithAuthRetry(path, { headers, authBusinessScope: false })
            : await global.fetch(path, { headers });
        if (!response) throw new Error('Сесія змінилася. Оновіть сторінку.');
        const payload = await response.json();
        if (!response.ok || payload.success === false) {
            const error = new Error(response.status === 403 ? 'Керування доступом більше недоступне.' : 'Не вдалося завантажити доступи. Спробуйте ще раз.');
            error.status = response.status;
            throw error;
        }
        return payload;
    }

    function editorOptions(member, accessProfile, opener) {
        const catalog = accessProfile.permissionCatalog || {};
        return {
            user: member, opener, accessProfile,
            canEditAccount: false,
            roles: (catalog.roles || []).filter(role => role !== 'creator').map(role => ({
                value: role, label: typeof global.profileRoleLabel === 'function' ? global.profileRoleLabel(role) : role
            })),
            pages: catalog.pages || [], actions: catalog.actions || [],
            resolveCapability: global.resolveCapability
        };
    }

    function mount(container, user) {
        if (!container) return;
        container.__businessMembershipCleanup?.();
        container.replaceChildren();
        container.hidden = !canManage(user);
        if (container.hidden) return;
        container.className = 'profile-work-panel profile-settings-panel';
        container.setAttribute('aria-label', 'Команда та доступи до бізнесів');
        container.innerHTML = '<div class="profile-panel-head"><div><span class="profile-kicker">Організація</span><h2>Команда та доступи</h2></div></div>'
            + '<p>Ролі й дозволи працівників у кожному бізнесі.</p>'
            + '<div class="profile-avatar-action-row"><button type="button" class="profile-settings-primary" data-members-load>Працівники та доступи</button></div>'
            + '<p role="status" aria-live="polite" data-members-status></p>'
            + '<div hidden data-members-picker><label style="display:block">Працівник <select data-members-select aria-label="Працівник організації" style="max-width:100%"></select></label> '
            + '<button type="button" class="profile-settings-primary" data-members-edit>Відкрити доступи</button></div>'
            + '<div class="profile-avatar-section" style="margin-top:12px"><label class="business-cabinet-field">ID наявного акаунта <input data-members-account-id type="number" min="1" step="1" inputmode="numeric"></label><p>Для нового працівника в організації вкажіть ID його вже створеного акаунта. Роль і бізнес потрібно призначити явно; запрошення не надсилається.</p><div class="profile-avatar-action-row"><button type="button" data-members-add>Призначити доступ акаунту</button></div></div>';
        const loadButton = container.querySelector('[data-members-load]');
        const editButton = container.querySelector('[data-members-edit]');
        const status = container.querySelector('[data-members-status]');
        const picker = container.querySelector('[data-members-picker]');
        const select = container.querySelector('[data-members-select]');
        const accountId = container.querySelector('[data-members-account-id]');
        const addButton = container.querySelector('[data-members-add]');
        let members = [];
        let sequence = 0;
        const currentIdentity = () => Boolean(global.AppState?.currentUser && Number(global.AppState.currentUser.id) === Number(user.id));
        const current = request => container.isConnected && request === sequence && currentIdentity();

        loadButton.addEventListener('click', async () => {
            if (loadButton.disabled || !currentIdentity()) return;
            const request = ++sequence;
            loadButton.disabled = true;
            addButton.disabled = true;
            picker.hidden = true;
            status.textContent = 'Завантаження команди…';
            try {
                const directory = await read('/api/organizations/members');
                if (!current(request)) return;
                members = directory.members || [];
                select.replaceChildren();
                members.forEach(member => {
                    const option = global.document.createElement('option');
                    option.value = String(member.id);
                    option.textContent = member.name || member.username;
                    select.appendChild(option);
                });
                picker.hidden = !members.length;
                status.textContent = members.length ? '' : 'Немає працівників, доступ яких ви можете редагувати.';
                if (members.length) select.focus();
            } catch (error) {
                if (current(request)) status.textContent = error.message;
            } finally {
                if (current(request)) { loadButton.disabled = false; addButton.disabled = false; }
            }
        });

        async function openMember(member, opener) {
            if (opener.disabled || !member || !currentIdentity()) return;
            const request = ++sequence;
            let restoreFocus = false;
            editButton.disabled = true;
            loadButton.disabled = true;
            addButton.disabled = true;
            status.textContent = 'Завантаження доступів…';
            try {
                const payload = await read(`/api/organizations/members/${encodeURIComponent(member.id)}/access-profile`);
                if (!current(request)) return;
                if (!global.AccountAccessEditor?.open) throw new Error('Редактор не завантажився. Оновіть сторінку.');
                status.textContent = '';
                const result = await global.AccountAccessEditor.open(editorOptions(member, payload.accessProfile, opener));
                restoreFocus = true;
                if (current(request) && result?.saved) {
                    status.textContent = 'Доступ до бізнесу оновлено.';
                    if (Number(member.id) === Number(user.id)) global.location.reload();
                }
            } catch (error) {
                if (current(request)) status.textContent = error.message;
            } finally {
                if (current(request)) {
                    editButton.disabled = false;
                    loadButton.disabled = false;
                    addButton.disabled = false;
                    if (restoreFocus) opener.focus();
                }
            }
        }
        editButton.addEventListener('click', () => openMember(members.find(item => String(item.id) === select.value), editButton));
        addButton.addEventListener('click', () => {
            const id = Number(accountId.value);
            if (!Number.isSafeInteger(id) || id <= 0) { status.textContent = 'Вкажіть додатний цілий ID наявного акаунта.'; accountId.focus(); return; }
            return openMember({ id, name: `Акаунт №${id}` }, addButton);
        });
        function invalidate() {
            sequence += 1;
            members = [];
            select.replaceChildren();
            picker.hidden = true;
            accountId.value = '';
            status.textContent = 'Доступ або бізнес змінився. Завантажте команду повторно.';
            container.hidden = !currentIdentity() || !canManage(global.AppState?.currentUser);
            loadButton.disabled = false;
            editButton.disabled = false;
            addButton.disabled = false;
        }
        const events = ['crmBusinessProfileChanged', 'crmBusinessContextChanged', 'crmBusinessScopeChanged'];
        events.forEach(name => global.addEventListener?.(name, invalidate));
        container.__businessMembershipCleanup = () => {
            sequence += 1;
            events.forEach(name => global.removeEventListener?.(name, invalidate));
        };
    }

    global.BusinessMembershipManager = { canManage, editorOptions, mount };
    global.openBusinessMembershipManager = (user, container) => mount(container, user);
})(typeof window !== 'undefined' ? window : globalThis);
