/* Account effective-access editor. Access-specific UI; intentionally independent from formModal. */
(function accountAccessEditorModule(global) {
    'use strict';

    const TAB_DEFINITIONS = [
        ['overview', 'Огляд'],
        ['modules', 'Модулі та вкладки'],
        ['actions', 'Дії'],
        ['roles', 'Ролі'],
        ['businesses', 'Бізнеси'],
        ['history', 'Історія']
    ];
    const FOCUSABLE_SELECTOR = [
        'a[href]', 'button:not([disabled])', 'input:not([disabled])',
        'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])'
    ].join(',');

    function uniqueStrings(value) {
        const list = Array.isArray(value) ? value : [];
        return Array.from(new Set(list.map(item => String(item || '').trim()).filter(Boolean)));
    }

    function normalizeState(value = {}) {
        const businesses = uniqueStrings(value.businessContexts || value.business_contexts);
        const fallbackBusiness = businesses[0] || 'event_genix';
        return {
            role: String(value.role || 'animator'),
            extraRoles: uniqueStrings(value.extraRoles || value.extra_roles).filter(role => role !== value.role),
            pageAllowlist: uniqueStrings(value.pageAllowlist || value.page_allowlist),
            actionAllowlist: uniqueStrings(value.actionAllowlist || value.action_allowlist),
            actionDenylist: uniqueStrings(value.actionDenylist || value.action_denylist),
            businessContexts: businesses.length ? businesses : [fallbackBusiness],
            defaultBusinessContext: String(value.defaultBusinessContext || value.default_business_context || fallbackBusiness)
        };
    }

    function cloneState(value) {
        return normalizeState(JSON.parse(JSON.stringify(value || {})));
    }

    function stableState(value) {
        const state = normalizeState(value);
        return JSON.stringify({
            role: state.role,
            extraRoles: state.extraRoles.slice().sort(),
            pageAllowlist: state.pageAllowlist.slice().sort(),
            actionAllowlist: state.actionAllowlist.slice().sort(),
            actionDenylist: state.actionDenylist.slice().sort(),
            businessContexts: state.businessContexts.slice().sort(),
            defaultBusinessContext: state.defaultBusinessContext
        });
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function capabilityMode(state, definition) {
        const key = definition.key;
        if (definition.type === 'page') return state.pageAllowlist.includes(key) ? 'allow' : 'inherited';
        if (state.actionDenylist.includes(key)) return 'deny';
        if (state.actionAllowlist.includes(key)) return 'allow';
        return 'inherited';
    }

    function setCapabilityMode(state, definition, mode) {
        const next = cloneState(state);
        const key = definition.key;
        if (definition.type === 'page') {
            next.pageAllowlist = next.pageAllowlist.filter(item => item !== key);
            if (mode === 'allow' && definition.explicitAllow !== false) next.pageAllowlist.push(key);
            return normalizeState(next);
        }
        next.actionAllowlist = next.actionAllowlist.filter(item => item !== key);
        next.actionDenylist = next.actionDenylist.filter(item => item !== key);
        if (mode === 'allow' && definition.delegable !== false && definition.explicitAllow !== false) next.actionAllowlist.push(key);
        if (mode === 'deny') next.actionDenylist.push(key);
        return normalizeState(next);
    }

    function effectiveUser(baseUser, state) {
        return {
            ...(baseUser || {}),
            role: state.role,
            roles: [state.role, ...state.extraRoles],
            extraRoles: state.extraRoles,
            extra_roles: state.extraRoles,
            pageAllowlist: state.pageAllowlist,
            page_allowlist: state.pageAllowlist,
            actionAllowlist: state.actionAllowlist,
            action_allowlist: state.actionAllowlist,
            actionDenylist: state.actionDenylist,
            action_denylist: state.actionDenylist
        };
    }

    function fallbackDecision(state, definition) {
        const roles = [state.role, ...state.extraRoles];
        const allowedRoles = Array.isArray(definition.defaultRoles) ? definition.defaultRoles : [];
        const mode = capabilityMode(state, definition);
        if (mode === 'deny') return { allowed: false, source: 'explicit_deny', sourceRole: null, reason: 'listed_in_explicit_deny' };
        if (mode === 'allow' && definition.delegable !== false && definition.explicitAllow !== false) return { allowed: true, source: 'explicit_allow', sourceRole: null, reason: 'listed_in_explicit_allow' };
        const sourceRole = roles.find(role => allowedRoles.includes(role));
        return sourceRole
            ? { allowed: true, source: 'role_preset', sourceRole, reason: 'granted_by_role_preset' }
            : { allowed: false, source: 'default_deny', sourceRole: null, reason: 'no_matching_grant' };
    }

    function decisionFor(config, state, definition) {
        if (typeof config.resolveCapability !== 'function') return fallbackDecision(state, definition);
        return config.resolveCapability(effectiveUser(config.user, state), definition.key, {
            type: definition.type,
            ignoreServer: true,
            primaryRole: state.role,
            roles: [state.role, ...state.extraRoles]
        });
    }

    function sourceLabel(decision, labels = {}) {
        const role = decision?.sourceRole ? ` · ${labels[decision.sourceRole] || decision.sourceRole}` : '';
        const sources = {
            explicit_deny: 'Явна заборона',
            explicit_allow: 'Явний дозвіл',
            role_preset: 'Успадковано від ролі',
            default_deny: 'Заборонено за замовченням',
            server_effective: 'Розраховано сервером'
        };
        return `${sources[decision?.source] || decision?.source || 'Невідоме джерело'}${role}`;
    }

    function fieldDiff(before, after) {
        const fields = [
            ['role', 'Основна роль'], ['extraRoles', 'Додаткові ролі'],
            ['pageAllowlist', 'Явно дозволені сторінки'], ['actionAllowlist', 'Явно дозволені дії'],
            ['actionDenylist', 'Явно заборонені дії'], ['businessContexts', 'Бізнеси'],
            ['defaultBusinessContext', 'Бізнес за замовченням']
        ];
        return fields.filter(([key]) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).map(([key, label]) => ({
            key,
            label,
            before: Array.isArray(before[key]) ? before[key].join(', ') || '—' : before[key] || '—',
            after: Array.isArray(after[key]) ? after[key].join(', ') || '—' : after[key] || '—'
        }));
    }

    function effectiveDiff(config, before, after) {
        return config.capabilities.map(definition => {
            const previous = decisionFor(config, before, definition);
            const next = decisionFor(config, after, definition);
            return previous.allowed === next.allowed ? null : { definition, previous, next };
        }).filter(Boolean);
    }

    function createModel(options = {}) {
        const initial = normalizeState(options.initial || options.user || {});
        const pages = (options.pages || []).map(item => ({ ...item, type: 'page', group: item.group || 'Сторінки' }));
        const actions = (options.actions || []).map(item => ({ ...item, type: 'action', group: item.group || 'Інші дії' }));
        const config = { ...options, capabilities: [...pages, ...actions] };
        return {
            config,
            initial,
            draft: cloneState(initial),
            activeTab: 'overview',
            search: '',
            selectedOnly: false,
            pendingPreset: null,
            confirmClose: false,
            saving: false,
            saveError: '',
            isDirty() { return stableState(this.initial) !== stableState(this.draft); },
            decision(definition, state = this.draft) { return decisionFor(config, state, definition); },
            setMode(definition, mode) { this.draft = setCapabilityMode(this.draft, definition, mode); },
            diff(state = this.draft) { return fieldDiff(this.initial, state); },
            effectiveDiff(state = this.draft) { return effectiveDiff(config, this.initial, state); }
        };
    }

    function capabilityMatches(model, definition) {
        const query = model.search.trim().toLocaleLowerCase('uk');
        if (model.selectedOnly && capabilityMode(model.draft, definition) === 'inherited') return false;
        if (!query) return true;
        return [definition.key, definition.label, definition.group].some(value => String(value || '').toLocaleLowerCase('uk').includes(query));
    }

    function renderCapabilityCard(model, definition) {
        const mode = capabilityMode(model.draft, definition);
        const decision = model.decision(definition);
        const denySupported = definition.type === 'action';
        const allowSupported = definition.explicitAllow !== false
            && (definition.type === 'page' || definition.delegable !== false);
        return `<article class="aae-capability" data-capability="${escapeHtml(definition.key)}" data-type="${definition.type}">
            <div class="aae-capability-copy">
                <div class="aae-capability-title"><strong>${escapeHtml(definition.label || definition.key)}</strong><code>${escapeHtml(definition.key)}</code></div>
                <div class="aae-effective ${decision.allowed ? 'is-allowed' : 'is-denied'}">
                    <span>${decision.allowed ? 'Доступ є' : 'Доступу немає'}</span>
                    <small>${escapeHtml(sourceLabel(decision, model.config.roleLabels))}</small>
                </div>
            </div>
            <div class="aae-segmented" role="group" aria-label="Налаштування: ${escapeHtml(definition.label || definition.key)}">
                <button type="button" data-mode="inherited" aria-pressed="${mode === 'inherited'}">Успадковано</button>
                <button type="button" data-mode="allow" aria-pressed="${mode === 'allow'}" ${allowSupported ? '' : 'disabled title="Цей дозвіл не делегується вручну"'}>Дозволити</button>
                <button type="button" data-mode="deny" aria-pressed="${mode === 'deny'}" ${denySupported ? '' : 'disabled title="Page deny не підтримується поточною схемою"'}>Заборонити</button>
            </div>
        </article>`;
    }

    function renderCapabilityWorkspace(model, type) {
        const definitions = model.config.capabilities.filter(definition => {
            const isModuleAction = definition.type === 'action' && /^hr\.(today|schedule|staff|reports|payroll)\./.test(definition.key);
            return type === 'modules' ? definition.type === 'page' || isModuleAction : definition.type === 'action' && !isModuleAction;
        }).filter(definition => capabilityMatches(model, definition));
        const groups = new Map();
        definitions.forEach(definition => {
            const group = definition.group || (definition.type === 'page' ? 'Сторінки та модулі' : 'Інші');
            if (!groups.has(group)) groups.set(group, []);
            groups.get(group).push(definition);
        });
        if (!definitions.length) return '<div class="aae-empty">Нічого не знайдено за поточним фільтром.</div>';
        return Array.from(groups.entries()).map(([group, items]) => `<section class="aae-group" data-group="${escapeHtml(group)}">
            <header><div><h3>${escapeHtml(group)}</h3><span>${items.length} можливостей</span></div>
                <div class="aae-group-actions" role="group" aria-label="Групові дії: ${escapeHtml(group)}">
                    <button type="button" data-group-mode="allow">Дозволити все</button>
                    ${items.some(item => item.type === 'action') ? '<button type="button" data-group-mode="deny">Заборонити все</button>' : ''}
                    <button type="button" data-group-mode="inherited">Скинути</button>
                </div>
            </header>
            <div class="aae-capability-list">${items.map(item => renderCapabilityCard(model, item)).join('')}</div>
        </section>`).join('');
    }

    function renderOverview(model) {
        const decisions = model.config.capabilities.map(definition => model.decision(definition));
        const allowed = decisions.filter(item => item.allowed).length;
        const denied = decisions.length - allowed;
        const explicitAllow = model.draft.pageAllowlist.length + model.draft.actionAllowlist.length;
        const explicitDeny = model.draft.actionDenylist.length;
        const changes = model.diff();
        const effectiveChanges = model.effectiveDiff();
        const pending = model.pendingPreset;
        return `<div class="aae-overview-grid">
            <section class="aae-summary-card"><span>Effective allow</span><strong>${allowed}</strong><small>із ${decisions.length} можливостей</small></section>
            <section class="aae-summary-card is-denied"><span>Effective deny</span><strong>${denied}</strong><small>включно з default deny</small></section>
            <section class="aae-summary-card"><span>Явні винятки</span><strong>${explicitAllow + explicitDeny}</strong><small>${explicitAllow} allow · ${explicitDeny} deny</small></section>
            <section class="aae-summary-card"><span>Зміни draft</span><strong>${changes.length}</strong><small>${effectiveChanges.length} effective результатів зміняться</small></section>
        </div>
        ${pending ? `<section class="aae-preset-preview" aria-labelledby="aaePresetPreviewTitle">
            <div><h3 id="aaePresetPreviewTitle">Preview preset: ${escapeHtml(pending.label)}</h3><p>${escapeHtml(pending.hint || 'Перевірте зміни перед застосуванням до draft.')}</p></div>
            <div class="aae-preset-actions"><button type="button" data-action="cancel-preset">Скасувати</button><button class="aae-primary" type="button" data-action="apply-preset">Застосувати до draft</button></div>
        </section>` : ''}
        <section class="aae-diff" aria-labelledby="aaeDiffTitle"><h3 id="aaeDiffTitle">Before / after</h3>
            ${changes.length ? `<div class="aae-diff-list">${changes.map(change => `<div><strong>${escapeHtml(change.label)}</strong><span>${escapeHtml(change.before)}</span><b>→</b><span>${escapeHtml(change.after)}</span></div>`).join('')}</div>` : '<p class="aae-empty">Draft поки не відрізняється від збереженого доступу.</p>'}
            ${effectiveChanges.length ? `<h4>Effective access зміниться</h4><ul>${effectiveChanges.slice(0, 30).map(change => `<li><code>${escapeHtml(change.definition.key)}</code><span>${change.previous.allowed ? 'Allow' : 'Deny'} → ${change.next.allowed ? 'Allow' : 'Deny'}</span></li>`).join('')}</ul>` : ''}
        </section>`;
    }

    function renderRoles(model) {
        const roleOptions = model.config.roles || [];
        const selected = new Set(model.draft.extraRoles);
        return `<section class="aae-form-section"><h3>Основна роль</h3><label class="aae-field"><span>Роль акаунта</span><select data-field="role">${roleOptions.map(role => `<option value="${escapeHtml(role.value)}" ${role.value === model.draft.role ? 'selected' : ''}>${escapeHtml(role.label)}</option>`).join('')}</select></label></section>
        <section class="aae-form-section"><h3>Додаткові ролі</h3><div class="aae-choice-grid">${roleOptions.filter(role => role.value !== model.draft.role).map(role => `<label><input type="checkbox" data-extra-role value="${escapeHtml(role.value)}" ${selected.has(role.value) ? 'checked' : ''}><span>${escapeHtml(role.label)}</span></label>`).join('')}</div></section>
        <section class="aae-form-section"><h3>Presets</h3><p>Preset спочатку відкривається в Overview як preview і не змінює draft без окремого підтвердження.</p><div class="aae-preset-grid">${(model.config.presets || []).map((preset, index) => `<button type="button" data-preset="${index}"><strong>${escapeHtml(preset.label)}</strong><span>${escapeHtml(preset.hint || '')}</span></button>`).join('')}</div></section>`;
    }

    function renderBusinesses(model) {
        if (model.config.canEditBusinesses === false) return '<div class="aae-empty">Поточний адміністратор не може змінювати бізнес-контексти цього акаунта.</div>';
        const selected = new Set(model.draft.businessContexts);
        return `<section class="aae-form-section"><h3>Доступні бізнеси</h3><p>Принаймні один бізнес має лишитися вибраним.</p><div class="aae-business-grid">${(model.config.businesses || []).map(item => `<article><label><input type="checkbox" data-business value="${escapeHtml(item.key)}" ${selected.has(item.key) ? 'checked' : ''}><strong>${escapeHtml(item.label || item.key)}</strong></label><label class="aae-default-business"><input type="radio" name="aae-default-business" data-default-business value="${escapeHtml(item.key)}" ${model.draft.defaultBusinessContext === item.key ? 'checked' : ''} ${selected.has(item.key) ? '' : 'disabled'}><span>За замовченням</span></label></article>`).join('')}</div></section>`;
    }

    function renderHistory(model) {
        const history = model.config.history || [];
        if (!history.length) return '<div class="aae-empty">Історії змін доступу ще немає.</div>';
        return `<ol class="aae-history">${history.map(event => `<li><div><strong>${escapeHtml(event.event_type || event.eventType || 'Подія')}</strong><time>${escapeHtml(event.created_at || event.createdAt || '')}</time></div><p>${escapeHtml(event.actor_username || event.actorUsername || 'system')} · ${escapeHtml(event.reason || '')}</p></li>`).join('')}</ol>`;
    }

    function renderMain(model) {
        if (model.activeTab === 'overview') return renderOverview(model);
        if (model.activeTab === 'modules' || model.activeTab === 'actions') return renderCapabilityWorkspace(model, model.activeTab);
        if (model.activeTab === 'roles') return renderRoles(model);
        if (model.activeTab === 'businesses') return renderBusinesses(model);
        return renderHistory(model);
    }

    function renderEditor(model, root) {
        const dirty = model.isDirty();
        const capabilityTab = model.activeTab === 'modules' || model.activeTab === 'actions';
        root.innerHTML = `<div class="aae-backdrop" aria-hidden="true"></div>
            <section class="aae-sheet" role="dialog" aria-modal="true" aria-labelledby="aaeTitle" aria-describedby="aaeDescription">
                <header class="aae-header">
                    <div><span class="aae-eyebrow">Effective access editor</span><h2 id="aaeTitle">Доступ · ${escapeHtml(model.config.user?.username || model.config.user?.name || '')}</h2><p id="aaeDescription">Редагуйте результат доступу, а не набір неповʼязаних checkbox.</p></div>
                    <div class="aae-header-actions"><span class="aae-dirty ${dirty ? 'is-dirty' : ''}" aria-live="polite">${dirty ? 'Є незбережені зміни' : 'Змін немає'}</span><button type="button" class="aae-close" data-action="close" aria-label="Закрити редактор доступу">×</button></div>
                </header>
                <nav class="aae-tabs" aria-label="Розділи редактора" role="tablist">${TAB_DEFINITIONS.map(([key, label]) => `<button type="button" role="tab" id="aaeTab-${key}" aria-controls="aaePanel" aria-selected="${model.activeTab === key}" tabindex="${model.activeTab === key ? '0' : '-1'}" data-tab="${key}">${label}</button>`).join('')}</nav>
                ${capabilityTab ? `<div class="aae-tools"><label><span class="sr-only">Пошук можливостей</span><input type="search" data-search value="${escapeHtml(model.search)}" placeholder="Пошук за назвою або ключем…"></label><label class="aae-selected-only"><input type="checkbox" data-selected-only ${model.selectedOnly ? 'checked' : ''}><span>Лише налаштовані</span></label></div>` : ''}
                <main class="aae-content" id="aaePanel" role="tabpanel" aria-labelledby="aaeTab-${model.activeTab}" tabindex="0">${renderMain(model)}</main>
                <footer class="aae-footer"><div class="aae-save-state" role="status" aria-live="polite">${model.saveError ? escapeHtml(model.saveError) : dirty ? 'Перевірте Before / after перед збереженням.' : 'Збережений стан актуальний.'}</div><div><button type="button" data-action="close">Закрити</button><button type="button" class="aae-primary" data-action="save" ${!dirty || model.saving ? 'disabled' : ''}>${model.saving ? 'Збереження…' : 'Зберегти доступ'}</button></div></footer>
                ${model.confirmClose ? `<div class="aae-confirm-layer"><div class="aae-confirm" role="alertdialog" aria-modal="true" aria-labelledby="aaeConfirmTitle" aria-describedby="aaeConfirmText"><h3 id="aaeConfirmTitle">Відкинути незбережені зміни?</h3><p id="aaeConfirmText">Draft буде втрачено. Збережений доступ акаунта не зміниться.</p><div><button type="button" data-action="continue-editing">Продовжити редагування</button><button type="button" class="aae-danger" data-action="discard">Відкинути зміни</button></div></div></div>` : ''}
            </section>`;
    }

    function open(options = {}) {
        if (!global.document) throw new Error('AccountAccessEditor requires a browser document');
        const existing = global.document.getElementById('accountAccessEditorRoot');
        if (existing) existing.remove();
        const model = createModel(options);
        const root = global.document.createElement('div');
        root.id = 'accountAccessEditorRoot';
        root.className = 'account-access-editor-root';
        const opener = options.opener || global.document.activeElement;
        const inertRecords = [];
        Array.from(global.document.body.children).forEach(element => {
            if (element === root || element.tagName === 'SCRIPT') return;
            inertRecords.push({ element, inert: element.inert, ariaHidden: element.getAttribute('aria-hidden') });
            element.inert = true;
            element.setAttribute('aria-hidden', 'true');
        });
        global.document.body.appendChild(root);
        global.document.body.classList.add('account-access-editor-open');
        const previousOverflow = global.document.body.style.overflow;
        global.document.body.style.overflow = 'hidden';
        let closed = false;
        let resolveResult;
        const resultPromise = new Promise(resolve => { resolveResult = resolve; });

        function cleanup(result) {
            if (closed) return;
            closed = true;
            root.removeEventListener('click', onClick);
            root.removeEventListener('change', onChange);
            root.removeEventListener('input', onInput);
            global.document.removeEventListener('keydown', onKeydown, true);
            root.remove();
            inertRecords.forEach(record => {
                record.element.inert = record.inert;
                if (record.ariaHidden === null) record.element.removeAttribute('aria-hidden');
                else record.element.setAttribute('aria-hidden', record.ariaHidden);
            });
            global.document.body.classList.remove('account-access-editor-open');
            global.document.body.style.overflow = previousOverflow;
            if (opener && typeof opener.focus === 'function' && opener.isConnected) opener.focus();
            resolveResult(result);
        }

        function focusPrimary() {
            global.requestAnimationFrame(() => {
                const target = model.confirmClose
                    ? root.querySelector('[data-action="continue-editing"]')
                    : root.querySelector('[role="tab"][aria-selected="true"]');
                target?.focus();
            });
        }

        function rerender({ preserveFocus = true } = {}) {
            const active = preserveFocus ? global.document.activeElement : null;
            const card = active?.closest?.('[data-capability]');
            const group = active?.closest?.('[data-group]');
            const focusToken = active ? {
                action: active.dataset?.action || '',
                tab: active.dataset?.tab || '',
                mode: active.dataset?.mode || '',
                groupMode: active.dataset?.groupMode || '',
                capability: card?.dataset?.capability || '',
                capabilityType: card?.dataset?.type || '',
                group: group?.dataset?.group || '',
                preset: active.dataset?.preset ?? ''
            } : null;
            const searchSelection = active?.matches?.('[data-search]') ? [active.selectionStart, active.selectionEnd] : null;
            renderEditor(model, root);
            let nextFocus = null;
            if (focusToken?.action) nextFocus = root.querySelector(`[data-action="${focusToken.action}"]`);
            else if (focusToken?.tab) nextFocus = root.querySelector(`[data-tab="${focusToken.tab}"]`);
            else if (focusToken?.mode) {
                nextFocus = Array.from(root.querySelectorAll(`[data-mode="${focusToken.mode}"]`)).find(button => {
                    const nextCard = button.closest('[data-capability]');
                    return nextCard?.dataset.capability === focusToken.capability && nextCard?.dataset.type === focusToken.capabilityType;
                });
            } else if (focusToken?.groupMode) {
                nextFocus = Array.from(root.querySelectorAll(`[data-group-mode="${focusToken.groupMode}"]`)).find(button => button.closest('[data-group]')?.dataset.group === focusToken.group);
            } else if (focusToken && focusToken.preset !== '') nextFocus = root.querySelector(`[data-preset="${focusToken.preset}"]`);
            if (nextFocus) nextFocus.focus();
            else if (searchSelection) {
                const search = root.querySelector('[data-search]');
                search?.focus();
                search?.setSelectionRange(searchSelection[0], searchSelection[1]);
            }
        }

        function requestClose() {
            if (model.saving) return;
            if (model.isDirty()) {
                model.confirmClose = true;
                rerender({ preserveFocus: false });
                focusPrimary();
                return;
            }
            cleanup({ saved: false });
        }

        async function save() {
            if (!model.isDirty() || model.saving) return;
            model.saving = true;
            model.saveError = '';
            rerender();
            try {
                const response = await options.onSave?.(cloneState(model.draft));
                if (response === false || response?.success === false) throw new Error(response?.error || 'Не вдалося зберегти доступ');
                model.initial = cloneState(model.draft);
                cleanup({ saved: true, state: cloneState(model.draft), response });
            } catch (error) {
                model.saving = false;
                model.saveError = error?.message || 'Не вдалося зберегти доступ. Draft збережено у редакторі.';
                rerender();
                root.querySelector('.aae-save-state')?.focus?.();
            }
        }

        function capabilityFromElement(element) {
            const card = element.closest('[data-capability]');
            return model.config.capabilities.find(item => item.key === card?.dataset.capability && item.type === card?.dataset.type);
        }

        function onClick(event) {
            const button = event.target.closest('button');
            if (!button || !root.contains(button)) return;
            if (button.dataset.tab) {
                model.activeTab = button.dataset.tab;
                model.confirmClose = false;
                rerender({ preserveFocus: false });
                root.querySelector(`[data-tab="${model.activeTab}"]`)?.focus();
                return;
            }
            if (button.dataset.mode) {
                const definition = capabilityFromElement(button);
                if (definition) model.setMode(definition, button.dataset.mode);
                rerender();
                return;
            }
            if (button.dataset.groupMode) {
                const group = button.closest('[data-group]');
                group?.querySelectorAll('[data-capability]').forEach(card => {
                    const definition = model.config.capabilities.find(item => item.key === card.dataset.capability && item.type === card.dataset.type);
                    if (!definition) return;
                    if (button.dataset.groupMode === 'deny' && definition.type !== 'action') return;
                    model.setMode(definition, button.dataset.groupMode);
                });
                rerender();
                return;
            }
            if (button.dataset.preset !== undefined) {
                model.pendingPreset = model.config.presets?.[Number(button.dataset.preset)] || null;
                model.activeTab = 'overview';
                rerender({ preserveFocus: false });
                root.querySelector('[data-action="apply-preset"]')?.focus();
                return;
            }
            const action = button.dataset.action;
            if (action === 'close') requestClose();
            if (action === 'save') void save();
            if (action === 'continue-editing') { model.confirmClose = false; rerender({ preserveFocus: false }); focusPrimary(); }
            if (action === 'discard') cleanup({ saved: false, discarded: true });
            if (action === 'cancel-preset') { model.pendingPreset = null; rerender(); }
            if (action === 'apply-preset' && model.pendingPreset) {
                model.draft = normalizeState({ ...model.draft, ...model.pendingPreset.values });
                model.pendingPreset = null;
                rerender();
            }
        }

        function onChange(event) {
            const target = event.target;
            if (target.matches('[data-field="role"]')) {
                model.draft.role = target.value;
                model.draft.extraRoles = model.draft.extraRoles.filter(role => role !== target.value);
            }
            if (target.matches('[data-extra-role]')) {
                model.draft.extraRoles = target.checked
                    ? uniqueStrings([...model.draft.extraRoles, target.value]).slice(0, 3)
                    : model.draft.extraRoles.filter(role => role !== target.value);
            }
            if (target.matches('[data-business]')) {
                const next = target.checked
                    ? uniqueStrings([...model.draft.businessContexts, target.value])
                    : model.draft.businessContexts.filter(key => key !== target.value);
                if (!next.length) { target.checked = true; return; }
                model.draft.businessContexts = next;
                if (!next.includes(model.draft.defaultBusinessContext)) model.draft.defaultBusinessContext = next[0];
            }
            if (target.matches('[data-default-business]')) model.draft.defaultBusinessContext = target.value;
            if (target.matches('[data-selected-only]')) model.selectedOnly = target.checked;
            model.saveError = '';
            rerender();
        }

        function onInput(event) {
            if (!event.target.matches('[data-search]')) return;
            model.search = event.target.value;
            rerender();
        }

        function onKeydown(event) {
            if (!root.isConnected) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                if (model.confirmClose) { model.confirmClose = false; rerender({ preserveFocus: false }); focusPrimary(); }
                else requestClose();
                return;
            }
            const tabs = Array.from(root.querySelectorAll('[role="tab"]'));
            if (tabs.includes(event.target) && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const current = tabs.indexOf(event.target);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
                tabs[next].click();
                return;
            }
            if (event.key !== 'Tab') return;
            const scope = model.confirmClose ? root.querySelector('.aae-confirm') : root.querySelector('.aae-sheet');
            const focusable = Array.from(scope?.querySelectorAll(FOCUSABLE_SELECTOR) || []).filter(element => element.offsetParent !== null || element === global.document.activeElement);
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && global.document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && global.document.activeElement === last) { event.preventDefault(); first.focus(); }
        }

        root.addEventListener('click', onClick);
        root.addEventListener('change', onChange);
        root.addEventListener('input', onInput);
        global.document.addEventListener('keydown', onKeydown, true);
        renderEditor(model, root);
        focusPrimary();
        return resultPromise;
    }

    global.AccountAccessEditor = { open, createModel, normalizeState, setCapabilityMode };
})(typeof window !== 'undefined' ? window : globalThis);
