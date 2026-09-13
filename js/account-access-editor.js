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

    function pageCanonicalMap(pages = []) {
        const mapping = Object.create(null);
        pages.forEach(page => {
            const canonical = String(page?.canonicalPath || page?.key || '').trim();
            if (!canonical) return;
            [page.key, canonical, ...(Array.isArray(page.aliases) ? page.aliases : [])].forEach(value => {
                const raw = String(value || '').trim();
                if (!raw) return;
                mapping[raw] = canonical;
                const withoutHash = raw.split('#')[0].split('?')[0].replace(/\/$/, '') || '/';
                mapping[withoutHash] = canonical;
            });
        });
        return mapping;
    }

    function canonicalPageList(value, mapping = {}) {
        return uniqueStrings(value).map(item => {
            const withoutHash = item.split('#')[0].split('?')[0].replace(/\/$/, '') || '/';
            return mapping[item] || mapping[withoutHash] || item;
        }).filter(Boolean).filter((item, index, list) => list.indexOf(item) === index);
    }

    function normalizeState(value = {}, config = {}) {
        const pageMapping = config.pageCanonicalMap || config;
        const businesses = uniqueStrings(value.businessContexts || value.business_contexts);
        const fallbackBusiness = businesses[0] || 'event_genix';
        const pageDenylist = canonicalPageList(value.pageDenylist || value.page_denylist, pageMapping);
        const actionDenylist = uniqueStrings(value.actionDenylist || value.action_denylist);
        return {
            role: String(value.role || (config.membershipScope ? '' : 'animator')),
            extraRoles: uniqueStrings(value.extraRoles || value.extra_roles).filter(role => role !== value.role),
            pageAllowlist: canonicalPageList(value.pageAllowlist || value.page_allowlist, pageMapping).filter(key => !pageDenylist.includes(key)),
            pageDenylist,
            actionAllowlist: uniqueStrings(value.actionAllowlist || value.action_allowlist).filter(key => !actionDenylist.includes(key)),
            actionDenylist,
            businessContexts: businesses.length ? businesses : [fallbackBusiness],
            defaultBusinessContext: String(value.defaultBusinessContext || value.default_business_context || fallbackBusiness),
            ...(config.membershipScope ? {
                isDefault: value.isDefault === true,
                isActive: value.isActive === true,
                organizationRole: String(value.organizationRole || '')
            } : {})
        };
    }

    function cloneState(value, config = {}) {
        return normalizeState(JSON.parse(JSON.stringify(value || {})), config);
    }

    function stableState(value, config = {}) {
        const state = normalizeState(value, config);
        return JSON.stringify({
            role: state.role,
            extraRoles: state.extraRoles.slice().sort(),
            pageAllowlist: state.pageAllowlist.slice().sort(),
            pageDenylist: state.pageDenylist.slice().sort(),
            actionAllowlist: state.actionAllowlist.slice().sort(),
            actionDenylist: state.actionDenylist.slice().sort(),
            businessContexts: state.businessContexts.slice().sort(),
            defaultBusinessContext: state.defaultBusinessContext,
            ...(config.membershipScope ? { isDefault: state.isDefault, isActive: state.isActive, organizationRole: state.organizationRole } : {})
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
        if (definition.type === 'page') {
            if (state.pageDenylist.includes(key)) return 'deny';
            return state.pageAllowlist.includes(key) ? 'allow' : 'inherited';
        }
        if (state.actionDenylist.includes(key)) return 'deny';
        if (state.actionAllowlist.includes(key)) return 'allow';
        return 'inherited';
    }

    function setCapabilityMode(state, definition, mode, config = {}) {
        const next = cloneState(state, config);
        const key = definition.key;
        if (definition.type === 'page') {
            next.pageAllowlist = next.pageAllowlist.filter(item => item !== key);
            next.pageDenylist = next.pageDenylist.filter(item => item !== key);
            if (mode === 'allow' && definition.explicitAllow !== false) next.pageAllowlist.push(key);
            if (mode === 'deny') next.pageDenylist.push(key);
            return normalizeState(next, config);
        }
        next.actionAllowlist = next.actionAllowlist.filter(item => item !== key);
        next.actionDenylist = next.actionDenylist.filter(item => item !== key);
        if (mode === 'allow' && definition.delegable !== false && definition.explicitAllow !== false) next.actionAllowlist.push(key);
        if (mode === 'deny') next.actionDenylist.push(key);
        return normalizeState(next, config);
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
            pageDenylist: state.pageDenylist,
            page_denylist: state.pageDenylist,
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

    function modeLabel(mode) {
        return ({ inherited: '\u0423\u0441\u043f\u0430\u0434\u043a\u043e\u0432\u0430\u043d\u043e', allow: 'Allow', deny: 'Deny' })[mode] || '\u0423\u0441\u043f\u0430\u0434\u043a\u043e\u0432\u0430\u043d\u043e';
    }

    function decisionSummary(decision, labels) {
        return (decision?.allowed ? 'Allow' : 'Deny') + ' · ' + sourceLabel(decision, labels);
    }

    function renderEffectiveDiff(model, changes) {
        if (!changes.length) return '';
        return '<h4>Effective access \u0437\u043c\u0456\u043d\u0438\u0442\u044c\u0441\u044f</h4><ul class="aae-effective-diff" data-effective-diff>'
            + changes.slice(0, 30).map(change => '<li><code>' + escapeHtml(change.definition.key) + '</code>'
                + '<span>Stored: ' + escapeHtml(modeLabel(change.previousMode)) + ' \u2192 ' + escapeHtml(modeLabel(change.nextMode)) + '</span>'
                + '<span>Effective: ' + escapeHtml(decisionSummary(change.previous, model.config.roleLabels)) + ' \u2192 ' + escapeHtml(decisionSummary(change.next, model.config.roleLabels)) + '</span>'
                + '</li>').join('') + '</ul>';
    }

    function renderGroupPreview(model, items) {
        const pending = model.pendingGroupAction;
        const token = items.map(item => item.type + ':' + item.key).join('|');
        if (!pending || pending.token !== token) return '';
        return '<div class="aae-group-preview" data-group-preview role="status" aria-live="polite"><span><strong>\u041f\u043e\u043f\u0435\u0440\u0435\u0434\u043d\u0456\u0439 \u043f\u0435\u0440\u0435\u0433\u043b\u044f\u0434:</strong> '
            + escapeHtml(modeLabel(pending.mode)) + ' \u0434\u043b\u044f ' + pending.changedCount + ' \u043c\u043e\u0436\u043b\u0438\u0432\u043e\u0441\u0442\u0435\u0439; effective \u0437\u043c\u0456\u043d: '
            + pending.effectiveChanges.length + '.</span><div><button type="button" data-action="cancel-group-action">\u0421\u043a\u0430\u0441\u0443\u0432\u0430\u0442\u0438</button><button type="button" class="aae-primary" data-action="apply-group-action">\u0417\u0430\u0441\u0442\u043e\u0441\u0443\u0432\u0430\u0442\u0438</button></div></div>';
    }

    function fieldDiff(before, after) {
        const fields = [
            ['role', 'Основна роль'], ['extraRoles', 'Додаткові ролі'],
            ['pageAllowlist', 'Явно дозволені сторінки'], ['pageDenylist', 'Явно заборонені сторінки'], ['actionAllowlist', 'Явно дозволені дії'],
            ['actionDenylist', 'Явно заборонені дії'], ['businessContexts', 'Бізнеси'],
            ['defaultBusinessContext', 'Бізнес за замовченням'], ['isDefault', 'Основний бізнес організації'],
            ['isActive', 'Членство активне'], ['organizationRole', 'Роль в організації']
        ];
        const valueForDiff = value => Array.isArray(value)
            ? uniqueStrings(value).slice().sort().join(', ') || '\u2014'
            : value == null || value === '' ? '\u2014' : String(value);
        return fields.map(([key, label]) => {
            const previous = valueForDiff(before[key]);
            const next = valueForDiff(after[key]);
            return previous === next ? null : { key, label, before: previous, after: next };
        }).filter(Boolean);
    }

    function effectiveDiff(config, before, after) {
        return config.capabilities.map(definition => {
            const previous = decisionFor(config, before, definition);
            const next = decisionFor(config, after, definition);
            const previousMode = capabilityMode(before, definition);
            const nextMode = capabilityMode(after, definition);
            const decisionChanged = previous.allowed !== next.allowed
                || previous.source !== next.source
                || previous.sourceRole !== next.sourceRole;
            return previousMode === nextMode && !decisionChanged
                ? null
                : { definition, previous, next, previousMode, nextMode };
        }).filter(Boolean);
    }

    function previewGroupAction(config, state, definitions, mode, group = '') {
        let nextState = cloneState(state, config);
        let changedCount = 0;
        definitions.forEach(definition => {
            const beforeMode = capabilityMode(nextState, definition);
            nextState = setCapabilityMode(nextState, definition, mode, config);
            if (beforeMode !== capabilityMode(nextState, definition)) changedCount += 1;
        });
        const effectiveChanges = effectiveDiff(config, state, nextState);
        return {
            group,
            mode,
            token: definitions.map(item => item.type + ':' + item.key).join('|'),
            definitions: definitions.map(item => ({ key: item.key, type: item.type })),
            nextState,
            changedCount,
            effectiveChanges
        };
    }

    function createModel(options = {}) {
        const pages = (options.pages || []).map(item => ({ ...item, type: 'page', group: item.group || 'Сторінки' }));
        const actions = (options.actions || []).map(item => ({ ...item, type: 'action', group: item.group || 'Інші дії' }));
        const config = { ...options, capabilities: [...pages, ...actions], pageCanonicalMap: pageCanonicalMap(pages) };
        const initial = normalizeState(options.initial || options.user || {}, config);
        const model = {
            config,
            initial,
            accountInitial: cloneState(initial, config),
            draft: cloneState(initial, config),
            scope: 'account',
            accessProfile: null,
            businessRows: [],
            profileLoading: false,
            profileError: '',
            pendingScope: null,
            activeTab: 'overview',
            search: '',
            selectedOnly: false,
            pendingPreset: null,
            pendingGroupAction: null,
            confirmClose: false,
            saving: false,
            saveError: '',
            isDirty() { return stableState(this.initial, config) !== stableState(this.draft, config); },
            decision(definition, state = this.draft) { return decisionFor(config, state, definition); },
            setMode(definition, mode) { this.draft = setCapabilityMode(this.draft, definition, mode, config); },
            diff(state = this.draft) { return fieldDiff(this.initial, state); },
            effectiveDiff(state = this.draft) { return effectiveDiff(config, this.initial, state); },
            previewGroup(definitions, mode, group) { return previewGroupAction(config, this.draft, definitions, mode, group); }
        };
        if (options.accessProfile) applyAccessProfile(model, options.accessProfile);
        return model;
    }

    function selectedBusiness(model) {
        return model.businessRows.find(row => row.scope === model.scope) || null;
    }

    function canEditDraft(model) {
        if (model.profileLoading || model.saving) return false;
        const business = selectedBusiness(model);
        return business
            ? business.canEdit === true && business.status === 'active' && model.draft.isActive === true
            : model.accessProfile?.canEditAccount !== false && model.config.canEditAccount !== false;
    }

    function switchScope(model, scope) {
        const business = model.businessRows.find(row => row.scope === scope);
        if (scope !== 'account' && !business) return false;
        if (scope === 'account' && (model.accessProfile?.canEditAccount === false || model.config.canEditAccount === false)) return false;
        model.scope = scope;
        model.config.membershipScope = Boolean(business);
        model.initial = business ? normalizeState({
            ...(business.membership || {}),
            role: business.membership?.role || '',
            businessContexts: [business.contextKey],
            defaultBusinessContext: business.contextKey
        }, model.config) : cloneState(model.accountInitial, model.config);
        model.draft = cloneState(model.initial, model.config);
        model.pendingPreset = null;
        model.pendingGroupAction = null;
        model.confirmClose = false;
        model.pendingScope = null;
        model.saveError = '';
        model.search = '';
        model.selectedOnly = false;
        return true;
    }

    function requestScope(model, scope) {
        if (scope === model.scope) return true;
        if (model.isDirty()) {
            model.pendingScope = scope;
            model.confirmClose = true;
            return false;
        }
        return switchScope(model, scope);
    }

    function applyAccessProfile(model, profile) {
        const targetId = Number(model.config.user?.id || 0);
        if (!profile || !Array.isArray(profile.organizations) || (targetId && Number(profile.userId) !== targetId)) {
            throw new Error('Профіль доступу не відповідає вибраному акаунту');
        }
        model.accessProfile = profile;
        model.businessRows = profile.organizations.flatMap(organization => (organization.businesses || [])
            .filter(business => business.accessMode === 'membership')
            .map(business => ({ ...business, organizationId: organization.id, organizationName: organization.name,
                scope: `business:${organization.id}:${business.id}` })));
        model.profileLoading = false;
        model.profileError = '';
        if (profile.canEditAccount === false || model.config.canEditAccount === false) {
            const first = model.businessRows.find(row => row.canEdit && row.status === 'active') || model.businessRows[0];
            if (first) switchScope(model, first.scope);
            else model.activeTab = 'businesses';
        }
    }

    async function accessRequest(model, url, method = 'GET', body) {
        const headers = typeof global.getAuthHeaders === 'function' ? global.getAuthHeaders(true) : { 'Content-Type': 'application/json' };
        Object.keys(headers).forEach(key => {
            if (['x-business-context', 'x-business-scope', 'x-business-contexts'].includes(key.toLowerCase())) delete headers[key];
        });
        const request = { method, headers, authBusinessScope: false, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
        const fetcher = global.apiFetchWithAuthRetry || global.fetch;
        if (typeof fetcher !== 'function') throw new Error('API доступу недоступне. Оновіть сторінку.');
        const response = await fetcher.call(global, url, request);
        if (!response) throw new Error('Сесію змінено. Оновіть профіль доступу.');
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.success === false) throw new Error(result.error || `Не вдалося оновити доступ (HTTP ${response.status})`);
        return result;
    }

    function globalSaveState(model) {
        const draft = cloneState(model.draft, model.config);
        const locked = new Set(model.accessProfile?.membershipContextKeys || []);
        const initial = model.accountInitial;
        if (model.config.canEditBusinesses === false || (model.config.user?.id && !model.accessProfile)) {
            draft.businessContexts = initial.businessContexts.slice();
            draft.defaultBusinessContext = initial.defaultBusinessContext;
        } else {
            draft.businessContexts = uniqueStrings([
                ...draft.businessContexts.filter(key => !locked.has(key)),
                ...initial.businessContexts.filter(key => locked.has(key))
            ]);
            if (locked.has(draft.defaultBusinessContext) && draft.defaultBusinessContext !== initial.defaultBusinessContext) {
                draft.defaultBusinessContext = initial.defaultBusinessContext;
            }
        }
        return draft;
    }

    async function saveDraft(model) {
        if (model.profileLoading) throw new Error('Дочекайтеся завантаження профілю доступу.');
        const business = selectedBusiness(model);
        if (!business) {
            if (model.accessProfile?.canEditAccount === false || model.config.canEditAccount === false) throw new Error('Зміна глобального доступу недоступна.');
            if (typeof model.config.onSave !== 'function') throw new Error('Збереження доступу акаунта недоступне.');
            const state = globalSaveState(model);
            const response = await model.config.onSave(state);
            if (response === false || response?.success === false) throw new Error(response?.error || 'Не вдалося зберегти доступ');
            return { saved: true, scope: 'account', state, response };
        }
        const path = `/api/organizations/${encodeURIComponent(business.organizationId)}/members/${encodeURIComponent(model.config.user.id)}`;
        if (!model.draft.isActive) {
            if (!business.membership?.isActive || !business.canDeactivate) throw new Error('Деактивація цього членства недоступна.');
            const response = await accessRequest(model, `${path}/${encodeURIComponent(business.id)}`, 'DELETE');
            return { saved: true, scope: 'business', businessId: business.id, deactivated: true, response };
        }
        if (!business.canEdit || business.status !== 'active') throw new Error('Зміна доступу до цього бізнесу недоступна.');
        const draft = model.draft;
        const inheritedCreatorRole = draft.role === 'creator' && model.initial.role === 'creator';
        const inheritedCreatorExtras = draft.extraRoles.includes('creator')
            && JSON.stringify(draft.extraRoles.slice().sort()) === JSON.stringify(model.initial.extraRoles.slice().sort());
        if (!draft.role || (draft.role === 'creator' && !inheritedCreatorRole)
            || (draft.extraRoles.includes('creator') && !inheritedCreatorExtras)) throw new Error('Оберіть бізнес-роль без платформного creator-доступу.');
        const body = { businessId: business.id, ...(!inheritedCreatorRole ? { role: draft.role } : {}),
            ...(!inheritedCreatorExtras ? { extraRoles: draft.extraRoles } : {}),
            pageAllowlist: draft.pageAllowlist, pageDenylist: draft.pageDenylist,
            actionAllowlist: draft.actionAllowlist, actionDenylist: draft.actionDenylist, isDefault: draft.isDefault };
        if (business.canManageOrganizationRole && draft.organizationRole && draft.organizationRole !== model.initial.organizationRole) {
            body.organizationRole = draft.organizationRole;
        }
        if (business.membership) {
            const compare = value => JSON.stringify(Array.isArray(value) ? value.slice().sort() : value);
            Object.keys(body).forEach(key => {
                if (key !== 'businessId' && compare(body[key]) === compare(model.initial[key])) delete body[key];
            });
        }
        const response = await accessRequest(model, path, 'PUT', body);
        return { saved: true, scope: 'business', businessId: business.id, state: cloneState(draft, model.config), response };
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
        const denySupported = definition.type === 'page' || definition.type === 'action';
        const editable = canEditDraft(model);
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
                <button type="button" data-mode="inherited" aria-pressed="${mode === 'inherited'}" ${editable ? '' : 'disabled'}>Успадковано</button>
                <button type="button" data-mode="allow" aria-pressed="${mode === 'allow'}" ${allowSupported && editable ? '' : 'disabled'}>Дозволити</button>
                <button type="button" data-mode="deny" aria-pressed="${mode === 'deny'}" ${denySupported && editable ? '' : 'disabled'}>Заборонити</button>
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
                    <button type="button" data-group-mode="allow" ${canEditDraft(model) ? '' : 'disabled'}>Дозволити все</button>
                    <button type="button" data-group-mode="deny" ${canEditDraft(model) ? '' : 'disabled'}>Заборонити все</button>
                    <button type="button" data-group-mode="inherited" ${canEditDraft(model) ? '' : 'disabled'}>Скинути</button>
                </div>
            </header>
            ${renderGroupPreview(model, items)}
            <div class="aae-capability-list">${items.map(item => renderCapabilityCard(model, item)).join('')}</div>
        </section>`).join('');
    }

    function renderOverview(model) {
        const decisions = model.config.capabilities.map(definition => model.decision(definition));
        const allowed = decisions.filter(item => item.allowed).length;
        const denied = decisions.length - allowed;
        const explicitAllow = model.draft.pageAllowlist.length + model.draft.actionAllowlist.length;
        const explicitDeny = model.draft.pageDenylist.length + model.draft.actionDenylist.length;
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
            ${renderEffectiveDiff(model, effectiveChanges)}
        </section>`;
    }

    function renderRoles(model) {
        const business = selectedBusiness(model);
        const roleOptions = (model.config.roles || []).filter(role => !business || role.value !== 'creator');
        const disabled = canEditDraft(model) ? '' : 'disabled';
        const selected = new Set(model.draft.extraRoles);
        return `<section class="aae-form-section"><h3>Основна роль</h3><label class="aae-field"><span>${business ? 'Роль у вибраному бізнесі' : 'Роль акаунта'}</span><select data-field="role" ${disabled}>${business && !model.draft.role ? '<option value="" selected>Оберіть роль</option>' : ''}${business && model.draft.role === 'creator' ? '<option value="creator" selected disabled>Creator · успадкований доступ</option>' : ''}${roleOptions.map(role => `<option value="${escapeHtml(role.value)}" ${role.value === model.draft.role ? 'selected' : ''}>${escapeHtml(role.label)}</option>`).join('')}</select></label></section>
        <section class="aae-form-section"><h3>Додаткові ролі</h3><div class="aae-choice-grid">${roleOptions.filter(role => role.value !== model.draft.role).map(role => `<label><input type="checkbox" data-extra-role value="${escapeHtml(role.value)}" ${selected.has(role.value) ? 'checked' : ''} ${disabled}><span>${escapeHtml(role.label)}</span></label>`).join('')}</div></section>
        ${business ? '<p>Роль та винятки застосовуються лише до вибраного бізнесу.</p>' : `<section class="aae-form-section"><h3>Presets</h3><p>Preset спочатку відкривається в Overview як preview і не змінює draft без окремого підтвердження.</p><div class="aae-preset-grid">${(model.config.presets || []).map((preset, index) => `<button type="button" data-preset="${index}" ${disabled}><strong>${escapeHtml(preset.label)}</strong><span>${escapeHtml(preset.hint || '')}</span></button>`).join('')}</div></section>`}`;
    }

    function renderBusinesses(model) {
        const business = selectedBusiness(model);
        if (model.profileLoading) return '<div class="aae-empty" role="status">Завантаження членств у бізнесах…</div>';
        const membershipList = model.accessProfile ? `<section class="aae-form-section"><h3>Членства в бізнесах</h3>${model.businessRows.length ? `<div class="aae-business-grid">${model.businessRows.map(row => `<article><strong>${escapeHtml(row.organizationName)} · ${escapeHtml(row.label || row.contextKey)}</strong><p>${row.status !== 'active' ? 'Бізнес деактивований' : row.membership?.isActive ? 'Членство активне' : row.membership ? 'Членство вимкнено' : 'Членства немає'}</p><button type="button" data-business-scope="${escapeHtml(row.scope)}" ${model.saving ? 'disabled' : ''}>${model.scope === row.scope ? 'Вибраний бізнес' : 'Переглянути доступ'}</button></article>`).join('')}</div>` : '<p>Немає бізнесів, доступних для керування цим акаунтом.</p>'}</section>` : '';
        if (business) {
            const canToggle = business.membership?.isActive ? business.canDeactivate : business.canEdit && business.status === 'active';
            return `<section class="aae-form-section"><h3>${escapeHtml(business.label || business.contextKey)}</h3><p>${escapeHtml(business.organizationName)} · ${escapeHtml(business.contextKey)}</p>
                <div class="aae-choice-grid"><label><input type="checkbox" data-membership-active ${model.draft.isActive ? 'checked' : ''} ${canToggle && !model.saving ? '' : 'disabled'}><span>Членство активне</span></label>
                <label><input type="checkbox" data-membership-default ${model.draft.isDefault ? 'checked' : ''} ${canEditDraft(model) ? '' : 'disabled'}><span>Основний бізнес у цій організації</span></label></div>
                ${business.canManageOrganizationRole ? `<label class="aae-field"><span>Роль в організації</span><select data-organization-role ${canEditDraft(model) ? '' : 'disabled'}><option value="">Без зміни</option>${['member', 'admin', 'owner'].map(role => `<option value="${role}" ${model.draft.organizationRole === role ? 'selected' : ''}>${role}</option>`).join('')}</select></label>` : ''}
                <p>${!business.canEdit ? 'Сервер дозволяє лише перегляд цього членства.' : !model.draft.isActive ? 'Увімкніть членство й оберіть роль у вкладці «Ролі». Вимкнення буде застосоване після збереження.' : 'Ролі, модулі й дії у вкладках належать лише цьому бізнесу. Основний бізнес змінюється лише в межах цієї організації.'}</p></section>${membershipList}`;
        }
        if (model.config.canEditBusinesses === false) return '<div class="aae-empty">Поточний адміністратор не може змінювати бізнес-контексти цього акаунта.</div>';
        const selected = new Set(model.draft.businessContexts);
        const locked = new Set(model.accessProfile?.membershipContextKeys || []);
        const unavailable = Boolean(model.config.user?.id && !model.accessProfile);
        return `${model.profileError ? `<p role="alert">${escapeHtml(model.profileError)} Бізнес-доступ тимчасово недоступний.</p>` : ''}${membershipList}<section class="aae-form-section"><h3>${model.accessProfile ? 'Сумісні бізнеси акаунта' : 'Доступні бізнеси'}</h3><p>${model.accessProfile ? 'Бізнеси з членствами керуються окремо вище. Тут зберігається сумісний доступ до інших бізнесів.' : 'Принаймні один бізнес має лишитися вибраним.'}</p><div class="aae-business-grid">${(model.config.businesses || []).map(item => {
            const disabled = unavailable || locked.has(item.key) || !canEditDraft(model);
            return `<article><label><input type="checkbox" data-business value="${escapeHtml(item.key)}" ${selected.has(item.key) ? 'checked' : ''} ${disabled ? 'disabled' : ''}><strong>${escapeHtml(item.label || item.key)}</strong></label>${locked.has(item.key) ? '<p>Доступ визначається членством</p>' : ''}<label class="aae-default-business"><input type="radio" name="aae-default-business" data-default-business value="${escapeHtml(item.key)}" ${model.draft.defaultBusinessContext === item.key ? 'checked' : ''} ${selected.has(item.key) && !disabled ? '' : 'disabled'}><span>За замовченням</span></label></article>`;
        }).join('')}</div></section>`;
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

    function renderScopePicker(model) {
        if (!model.config.user?.id && !model.accessProfile) return '';
        const accountAllowed = model.accessProfile?.canEditAccount !== false && model.config.canEditAccount !== false;
        return `<label class="aae-field"><span>Область доступу</span><select data-access-scope ${model.profileLoading || model.saving ? 'disabled' : ''}>
            ${accountAllowed ? `<option value="account" ${model.scope === 'account' ? 'selected' : ''}>Акаунт і сумісні бізнеси</option>` : ''}
            ${model.businessRows.map(row => `<option value="${escapeHtml(row.scope)}" ${model.scope === row.scope ? 'selected' : ''}>${escapeHtml(row.organizationName)} → ${escapeHtml(row.label || row.contextKey)}</option>`).join('')}
            ${!accountAllowed && !model.businessRows.length ? '<option value="" selected>Немає доступних бізнесів</option>' : ''}</select></label>
            ${model.profileLoading ? '<p role="status">Завантаження бізнес-доступу…</p>' : model.profileError ? `<p role="alert">${escapeHtml(model.profileError)} <button type="button" data-action="retry-profile">Повторити</button></p>` : ''}`;
    }

    function renderEditor(model, root) {
        const dirty = model.isDirty();
        const capabilityTab = model.activeTab === 'modules' || model.activeTab === 'actions';
        root.innerHTML = `<div class="aae-backdrop" aria-hidden="true"></div>
            <section class="aae-sheet" role="dialog" aria-modal="true" aria-labelledby="aaeTitle" aria-describedby="aaeDescription">
                <header class="aae-header">
                    <div><span class="aae-eyebrow">Effective access editor</span><h2 id="aaeTitle">Доступ · ${escapeHtml(model.config.user?.username || model.config.user?.name || '')}</h2><p id="aaeDescription">${selectedBusiness(model) ? 'Зміни стосуються лише вибраного бізнесу.' : 'Редагуйте результат доступу, а не набір неповʼязаних checkbox.'}</p>${renderScopePicker(model)}</div>
                    <div class="aae-header-actions"><span class="aae-dirty ${dirty ? 'is-dirty' : ''}" aria-live="polite">${dirty ? 'Є незбережені зміни' : 'Змін немає'}</span><button type="button" class="aae-close" data-action="close" aria-label="Закрити редактор доступу">×</button></div>
                </header>
                <nav class="aae-tabs" aria-label="Розділи редактора" role="tablist">${TAB_DEFINITIONS.map(([key, label]) => `<button type="button" role="tab" id="aaeTab-${key}" aria-controls="aaePanel" aria-selected="${model.activeTab === key}" tabindex="${model.activeTab === key ? '0' : '-1'}" data-tab="${key}">${label}</button>`).join('')}</nav>
                ${capabilityTab ? `<div class="aae-tools"><label><span class="sr-only">Пошук можливостей</span><input type="search" data-search value="${escapeHtml(model.search)}" placeholder="Пошук за назвою або ключем…"></label><label class="aae-selected-only"><input type="checkbox" data-selected-only ${model.selectedOnly ? 'checked' : ''}><span>Лише налаштовані</span></label></div>` : '<div aria-hidden="true"></div>'}
                <main class="aae-content" id="aaePanel" role="tabpanel" aria-labelledby="aaeTab-${model.activeTab}" tabindex="0">${selectedBusiness(model) && !model.draft.isActive && model.activeTab !== 'businesses' ? '<p role="status">Членство не активне. Увімкніть його у вкладці «Бізнеси», щоб налаштувати доступ.</p>' : ''}${renderMain(model)}</main>
                <footer class="aae-footer"><div class="aae-save-state" role="status" aria-live="polite" tabindex="-1">${model.saveError ? escapeHtml(model.saveError) : dirty ? 'Перевірте Before / after перед збереженням.' : 'Збережений стан актуальний.'}</div><div><button type="button" data-action="close">Закрити</button><button type="button" class="aae-primary" data-action="save" ${!dirty || model.saving || model.profileLoading ? 'disabled' : ''}>${model.saving ? 'Збереження…' : 'Зберегти доступ'}</button></div></footer>
                ${model.confirmClose ? `<div class="aae-confirm-layer"><div class="aae-confirm" role="alertdialog" aria-modal="true" aria-labelledby="aaeConfirmTitle" aria-describedby="aaeConfirmText"><h3 id="aaeConfirmTitle">${model.pendingScope ? 'Перейти без збереження змін?' : 'Відкинути незбережені зміни?'}</h3><p id="aaeConfirmText">Draft буде втрачено. Збережений доступ не зміниться.</p><div><button type="button" data-action="continue-editing">Продовжити редагування</button><button type="button" class="aae-danger" data-action="discard">${model.pendingScope ? 'Відкинути й перейти' : 'Відкинути зміни'}</button></div></div></div>` : ''}
            </section>`;
    }

    function open(options = {}) {
        if (!global.document) throw new Error('AccountAccessEditor requires a browser document');
        const existing = global.document.getElementById('accountAccessEditorRoot');
        if (existing) existing.remove();
        const model = createModel(options);
        model.profileLoading = Boolean(options.user?.id && !options.accessProfile);
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
                preset: active.dataset?.preset ?? '',
                field: active.dataset?.field || '',
                scope: active.matches?.('[data-access-scope]'),
                membershipActive: active.matches?.('[data-membership-active]'),
                membershipDefault: active.matches?.('[data-membership-default]'),
                organizationRole: active.matches?.('[data-organization-role]')
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
            else if (focusToken?.field) nextFocus = root.querySelector(`[data-field="${focusToken.field}"]`);
            else if (focusToken?.scope) nextFocus = root.querySelector('[data-access-scope]');
            else if (focusToken?.membershipActive) nextFocus = root.querySelector('[data-membership-active]');
            else if (focusToken?.membershipDefault) nextFocus = root.querySelector('[data-membership-default]');
            else if (focusToken?.organizationRole) nextFocus = root.querySelector('[data-organization-role]');
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
                model.pendingScope = null;
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
                cleanup(await saveDraft(model));
            } catch (error) {
                model.saving = false;
                model.saveError = error?.message || 'Не вдалося зберегти доступ. Draft збережено у редакторі.';
                rerender();
                root.querySelector('.aae-save-state')?.focus?.();
            }
        }

        async function loadProfile() {
            model.profileLoading = true;
            model.profileError = '';
            rerender();
            try {
                const response = await accessRequest(model, `/api/organizations/members/${encodeURIComponent(options.user.id)}/access-profile`);
                if (closed) return;
                applyAccessProfile(model, response.accessProfile);
            } catch (error) {
                if (closed) return;
                model.profileError = error?.message || 'Не вдалося завантажити членства';
                model.profileLoading = false;
            }
            rerender();
        }

        function selectScope(scope) {
            requestScope(model, scope);
            rerender({ preserveFocus: false });
            if (model.confirmClose) focusPrimary();
            else root.querySelector('[data-access-scope]')?.focus();
        }

        function capabilityFromElement(element) {
            const card = element.closest('[data-capability]');
            return model.config.capabilities.find(item => item.key === card?.dataset.capability && item.type === card?.dataset.type);
        }

        function onClick(event) {
            const button = event.target.closest('button');
            if (!button || !root.contains(button) || button.disabled || model.saving) return;
            if (button.dataset.businessScope) { selectScope(button.dataset.businessScope); return; }
            if (button.dataset.tab) {
                model.activeTab = button.dataset.tab;
                model.confirmClose = false;
                model.pendingGroupAction = null;
                rerender({ preserveFocus: false });
                root.querySelector(`[data-tab="${model.activeTab}"]`)?.focus();
                return;
            }
            if (button.dataset.mode) {
                if (!canEditDraft(model)) return;
                const definition = capabilityFromElement(button);
                if (definition) model.setMode(definition, button.dataset.mode);
                model.pendingGroupAction = null;
                rerender();
                return;
            }
            if (button.dataset.groupMode) {
                if (!canEditDraft(model)) return;
                const group = button.closest('[data-group]');
                const definitions = Array.from(group?.querySelectorAll('[data-capability]') || []).map(card => (
                    model.config.capabilities.find(item => item.key === card.dataset.capability && item.type === card.dataset.type)
                )).filter(Boolean);
                model.pendingGroupAction = model.previewGroup(definitions, button.dataset.groupMode, group?.dataset.group || '');
                rerender({ preserveFocus: false });
                root.querySelector('[data-action="apply-group-action"]')?.focus();
                return;
            }
            if (button.dataset.preset !== undefined) {
                if (!canEditDraft(model) || selectedBusiness(model)) return;
                model.pendingPreset = model.config.presets?.[Number(button.dataset.preset)] || null;
                model.activeTab = 'overview';
                rerender({ preserveFocus: false });
                root.querySelector('[data-action="apply-preset"]')?.focus();
                return;
            }
            const action = button.dataset.action;
            if (action === 'close') requestClose();
            if (action === 'save') void save();
            if (action === 'retry-profile') void loadProfile();
            if (action === 'cancel-group-action') { model.pendingGroupAction = null; rerender(); }
            if (action === 'apply-group-action' && model.pendingGroupAction) {
                model.draft = cloneState(model.pendingGroupAction.nextState, model.config);
                model.pendingGroupAction = null;
                rerender({ preserveFocus: false });
            }
            if (action === 'continue-editing') { model.confirmClose = false; model.pendingScope = null; rerender({ preserveFocus: false }); focusPrimary(); }
            if (action === 'discard') {
                if (model.pendingScope) { switchScope(model, model.pendingScope); rerender({ preserveFocus: false }); root.querySelector('[data-access-scope]')?.focus(); }
                else cleanup({ saved: false, discarded: true });
            }
            if (action === 'cancel-preset') { model.pendingPreset = null; rerender(); }
            if (action === 'apply-preset' && model.pendingPreset) {
                model.draft = normalizeState({ ...model.draft, ...model.pendingPreset.values }, model.config);
                model.pendingPreset = null;
                model.pendingGroupAction = null;
                rerender();
            }
        }

        function onChange(event) {
            const target = event.target;
            if (model.saving || target.disabled) return;
            if (target.matches('[data-access-scope]')) { selectScope(target.value); return; }
            model.pendingGroupAction = null;
            const business = selectedBusiness(model);
            if (target.matches('[data-membership-active]') && business) {
                const allowed = business.membership?.isActive ? business.canDeactivate : business.canEdit && business.status === 'active';
                if (allowed) model.draft.isActive = target.checked;
                rerender();
                return;
            }
            if (!canEditDraft(model) && !target.matches('[data-selected-only]')) return;
            if (target.matches('[data-membership-default]') && business) model.draft.isDefault = target.checked;
            if (target.matches('[data-organization-role]') && business?.canManageOrganizationRole) model.draft.organizationRole = target.value;
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
                if (model.accessProfile?.membershipContextKeys?.includes(target.value)) return;
                const next = target.checked
                    ? uniqueStrings([...model.draft.businessContexts, target.value])
                    : model.draft.businessContexts.filter(key => key !== target.value);
                if (!next.length) { target.checked = true; return; }
                model.draft.businessContexts = next;
                if (!next.includes(model.draft.defaultBusinessContext)) model.draft.defaultBusinessContext = next[0];
            }
            if (target.matches('[data-default-business]') && !model.accessProfile?.membershipContextKeys?.includes(target.value)) model.draft.defaultBusinessContext = target.value;
            if (target.matches('[data-selected-only]')) model.selectedOnly = target.checked;
            model.saveError = '';
            rerender();
        }

        function onInput(event) {
            if (!event.target.matches('[data-search]')) return;
            model.search = event.target.value;
            model.pendingGroupAction = null;
            rerender();
        }

        function onKeydown(event) {
            if (!root.isConnected) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                if (model.confirmClose) { model.confirmClose = false; model.pendingScope = null; rerender({ preserveFocus: false }); focusPrimary(); }
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
        if (model.profileLoading) void loadProfile();
        return resultPromise;
    }

    global.AccountAccessEditor = { open, createModel, normalizeState, setCapabilityMode, applyAccessProfile, requestScope, switchScope, saveDraft };
})(typeof window !== 'undefined' ? window : globalThis);
