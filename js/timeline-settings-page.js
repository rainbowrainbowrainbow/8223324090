(function () {
    'use strict';

    const FALLBACK_CONTEXTS = [
        { key: 'event_genix', label: 'Таймлайн ПАРК', route: '/', productName: 'Таймлайн ПАРК' },
        { key: 'dar', label: 'Dar', route: '/?businessContext=dar', productName: 'Dar' },
        { key: 'maysternya_doli', label: 'Таймлайн МД', route: '/maysternya-doli', productName: 'Таймлайн МД' }
    ];
    FALLBACK_CONTEXTS.splice(0, 1,
        { id: 'event_genix:animators', key: 'event_genix', view: 'animators', label: '\u041f\u0430\u0440\u043a \u0417\u0430\u043a\u0440\u0435\u0432\u0441\u044c\u043a\u043e\u0433\u043e \u00b7 \u0421\u0432\u044f\u0442\u0430', route: '/?timelineView=animators', productName: '\u0422\u0430\u0439\u043c\u043b\u0430\u0439\u043d \u041f\u0410\u0420\u041a' },
        { id: 'event_genix:rooms', key: 'event_genix', view: 'rooms', label: '\u041f\u0430\u0440\u043a \u0417\u0430\u043a\u0440\u0435\u0432\u0441\u044c\u043a\u043e\u0433\u043e \u00b7 \u041a\u0456\u043c\u043d\u0430\u0442\u0438', route: '/?timelineView=rooms', productName: '\u0422\u0430\u0439\u043c\u043b\u0430\u0439\u043d \u041f\u0410\u0420\u041a' }
    );

    const TIMELINE_VIEW_LABELS = {
        animators: '\u0421\u0432\u044f\u0442\u0430',
        rooms: '\u041a\u0456\u043c\u043d\u0430\u0442\u0438'
    };

    const DENSITY_LABELS = {
        default: 'Стандарт',
        compact: 'Компактно',
        comfortable: 'Вільніше'
    };

    const EMPHASIS_LABELS = {
        normal: 'Звичайний',
        muted: 'Тихий',
        accent: 'Акцент'
    };

    const MODE_LABELS = {
        disabled: 'Без таймлайну',
        simple: 'Простий режим',
        specialist: 'Спеціаліст',
        park: 'Дитячий парк',
        education: 'Навчання'
    };

    const START_PAGE_LABELS = {
        timeline: 'Таймлайн',
        dashboard: 'Дашборд',
        leads: 'Ліди',
        customers: 'Клієнти',
        omni: 'Комунікації',
        tasks: 'Задачі'
    };

    const RESOURCE_MODEL_LABELS = {
        auto: 'Автоматично',
        none: 'Без ресурсів',
        animator: 'Аніматори',
        specialist: 'Спеціалісти',
        cabinet: 'Кабінети',
        room: 'Кімнати',
        online: 'Онлайн'
    };

    const MODULE_LABELS = {
        timeline: 'Таймлайн',
        bookings: 'Бронювання',
        leads: 'Ліди',
        customers: 'Клієнти',
        omni: 'Комунікації',
        tasks: 'Задачі',
        products: 'Продукти',
        afisha: 'Афіша',
        kitchen: 'Кухня',
        resources: 'Ресурси',
        teachers: 'Викладачі',
        lessonSeries: 'Серії занять'
    };

    const FEATURE_LABELS = {
        quickCloseSlot: 'Швидке закриття слотів',
        freeResources: 'Вільні ресурси',
        series: 'Серії',
        afisha: 'Афіша',
        kitchen: 'Кухня',
        compactBlocks: 'Компактні блоки',
        seriesBadge: 'Бейджі серій',
        teacherConflict: 'Конфлікти викладачів',
        resourceCapacity: 'Місткість ресурсів'
    };

    const PRESETS = [
        {
            key: 'business_default',
            label: 'Стандарт бізнесу',
            description: 'Повертає видимість блоків до базового набору поточного бізнес-таймлайну.',
            hidden: null
        },
        {
            key: 'operator_daily',
            label: 'Операторський день',
            description: 'Лишає дату, статуси, сітку, створення бронювання і базові дії.',
            hidden: ['assistantWidget', 'minimap']
        },
        {
            key: 'compact_booking',
            label: 'Компактний запис',
            description: 'Ховає статистику й додаткові блоки, щоб drawer і сітка були головними.',
            hidden: ['quickStats', 'assistantWidget', 'legend', 'minimap', 'productSales', 'export']
        },
        {
            key: 'clean_phone',
            label: 'Телефон / швидкий запис',
            description: 'Мінімальний режим для вузьких екранів і швидкого запису з телефону.',
            hidden: ['quickStats', 'assistantWidget', 'legend', 'minimap', 'productSales', 'export']
        }
    ];

    const state = {
        contexts: [],
        activeContext: 'event_genix',
        activeView: 'animators',
        returnPath: '/',
        activeTab: 'blocks',
        selectedBlockId: '',
        search: '',
        filters: { hidden: false, accent: false, notes: false },
        registry: [],
        blocks: {},
        overrides: {},
        visibilityMeta: {},
        displaySettings: {},
        displayMeta: {},
        visibilityDirty: false,
        displayDirty: false,
        loading: true,
        saving: false
    };

    function $(id) {
        return document.getElementById(id);
    }

    function canManageSystemSettings() {
        if (typeof window.resolveCapability !== 'function') return false;
        return window.resolveCapability(window.AppState?.currentUser || null, 'manage_settings', { type: 'action' }).allowed === true;
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function authHeaders(withContentType = false) {
        if (typeof window.getAuthHeaders === 'function') return window.getAuthHeaders(withContentType);
        if (typeof getAuthHeaders === 'function') return getAuthHeaders(withContentType);
        const token = localStorage.getItem('pzp_token') || localStorage.getItem('authToken') || '';
        const headers = {};
        if (withContentType) headers['Content-Type'] = 'application/json';
        if (token) headers.Authorization = `Bearer ${token}`;
        return headers;
    }

    function isAuthError(err) {
        return err && (err.status === 401 || err.status === 403);
    }

    function handleAuthRequired(response) {
        if (typeof window.handleAuthError === 'function') {
            window.handleAuthError(response || { status: 401 });
            return;
        }
        window.location.href = '/';
    }

    function apiPath(endpoint) {
        const base = window.API_BASE || '/api';
        const joiner = endpoint.includes('?') ? '&' : '?';
        let url = `${base}${endpoint}${joiner}businessContext=${encodeURIComponent(state.activeContext)}`;
        if (state.activeContext === 'event_genix') {
            url += `&timelineView=${encodeURIComponent(state.activeView)}`;
        }
        return url;
    }

    async function request(method, endpoint, body) {
        const response = await fetch(apiPath(endpoint), {
            method,
            headers: authHeaders(body !== undefined),
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        let data = {};
        try { data = await response.json(); } catch (error) { data = {}; }
        if (!response.ok) {
            const err = new Error(data.error || data.message || 'Request failed');
            err.status = response.status;
            err.data = data;
            if (isAuthError(err)) handleAuthRequired(response);
            throw err;
        }
        return data;
    }

    function notify(message, type = 'info') {
        const alert = $('timelineSettingsAlert');
        if (alert) {
            alert.hidden = false;
            alert.textContent = message;
            alert.className = `timeline-settings-alert timeline-settings-alert--${type}`;
            clearTimeout(alert._hideTimer);
            alert._hideTimer = window.setTimeout(() => { alert.hidden = true; }, 5200);
        }
        if (typeof window.showNotification === 'function') window.showNotification(message, type);
    }

    function timelineContextApi() {
        return window.TimelineBusinessContext || null;
    }

    function contextFromKey(key) {
        const normalized = String(key || '').trim() || 'event_genix';
        return timelineContextApi()?.contextForBusiness?.(normalized)
            || timelineContextApi()?.CONTEXTS?.[normalized]
            || fallbackContext(normalized);
    }

    function normalizeTimelineView(value, fallback = 'animators') {
        return String(value || '').trim().toLowerCase() === 'rooms' ? 'rooms' : fallback;
    }

    function contextOptionId(item) {
        const key = item?.key || 'event_genix';
        return key === 'event_genix'
            ? `${key}:${normalizeTimelineView(item?.view)}`
            : key;
    }

    function activeContextOptionId() {
        return contextOptionId({ key: state.activeContext, view: state.activeView });
    }

    function fallbackContext(key, view = null) {
        const optionId = contextOptionId({ key, view });
        return FALLBACK_CONTEXTS.find(item => contextOptionId(item) === optionId)
            || FALLBACK_CONTEXTS.find(item => item.key === key)
            || {
            key,
            label: key,
            route: key === 'event_genix' ? '/' : `/?businessContext=${encodeURIComponent(key)}`,
            productName: key
        };
    }

    function buildContextList() {
        const byKey = new Map();
        FALLBACK_CONTEXTS.forEach(item => byKey.set(contextOptionId(item), item));
        const timelineState = timelineContextApi()?.state?.();
        const crmState = window.CrmBusinessContext?.state?.();
        const dynamic = [
            ...(Array.isArray(timelineState?.availableBusinesses) ? timelineState.availableBusinesses : []),
            ...(Array.isArray(crmState?.availableBusinesses) ? crmState.availableBusinesses : [])
        ];
        dynamic.forEach(item => {
            const key = item.key || item.id || item.businessContext || item.context;
            if (!key) return;
            if (key === 'event_genix') return;
            const context = {
                key,
                label: item.label || item.name || item.productName || key,
                route: item.timelineRoute || item.route || fallbackContext(key).route,
                productName: item.productName || item.label || item.name || key
            };
            byKey.set(contextOptionId(context), context);
        });
        return Array.from(byKey.values());
    }

    function queryParams() {
        return new URLSearchParams(window.location.search || '');
    }

    function parseInitialContext() {
        const params = queryParams();
        return params.get('context')
            || params.get('businessContext')
            || params.get('business_context')
            || window.CrmBusinessContext?.current?.()
            || timelineContextApi()?.current?.()?.key
            || 'event_genix';
    }

    function parseInitialView(context = 'event_genix') {
        if (context !== 'event_genix') return 'animators';
        const params = queryParams();
        return normalizeTimelineView(
            params.get('timelineView')
            || params.get('timeline_view')
            || params.get('view')
            || 'animators'
        );
    }

    function sanitizeReturnPath(value) {
        const raw = String(value || '').trim();
        if (!raw || raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('//')) return '/';
        return raw.startsWith('/') ? raw : '/';
    }

    function setUrlState() {
        const url = new URL(window.location.href);
        url.searchParams.set('context', state.activeContext);
        if (state.activeContext === 'event_genix') url.searchParams.set('timelineView', state.activeView);
        else {
            url.searchParams.delete('timelineView');
            url.searchParams.delete('timeline_view');
            url.searchParams.delete('view');
        }
        url.searchParams.set('return', state.returnPath);
        if (state.selectedBlockId) url.searchParams.set('block', state.selectedBlockId);
        else url.searchParams.delete('block');
        window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }

    function currentContextMeta() {
        return state.contexts.find(item => contextOptionId(item) === activeContextOptionId())
            || fallbackContext(state.activeContext, state.activeView);
    }

    function returnPathForContext() {
        const meta = currentContextMeta();
        if (state.returnPath && state.returnPath !== '/') return state.returnPath;
        return meta.route || '/';
    }

    function defaultOrder(block, index) {
        const explicit = Number(block?.defaultOrder);
        return Number.isFinite(explicit) ? explicit : (index + 1) * 10;
    }

    function normalizeBlockSettings(id) {
        const item = state.registry.find(block => block.id === id) || {};
        const index = Math.max(0, state.registry.findIndex(block => block.id === id));
        const raw = state.blocks[id] || {};
        const hiddenOverride = Object.prototype.hasOwnProperty.call(state.overrides, id) ? state.overrides[id] === true : null;
        const visible = Object.prototype.hasOwnProperty.call(raw, 'visible')
            ? raw.visible !== false
            : hiddenOverride === null
                ? item.defaultVisible !== false
                : !hiddenOverride;
        const order = Number.isFinite(Number(raw.order)) ? Number(raw.order) : defaultOrder(item, index);
        return {
            visible,
            order,
            density: ['default', 'compact', 'comfortable'].includes(raw.density) ? raw.density : 'default',
            emphasis: ['normal', 'muted', 'accent'].includes(raw.emphasis) ? raw.emphasis : 'normal',
            customLabel: String(raw.customLabel || '').slice(0, 80),
            adminNote: String(raw.adminNote || '').slice(0, 280)
        };
    }

    function labelForBlock(item) {
        const settings = normalizeBlockSettings(item.id);
        return settings.customLabel || item.title || item.label || item.id;
    }

    function orderedRegistry() {
        return [...state.registry].sort((a, b) => {
            const settingsA = normalizeBlockSettings(a.id);
            const settingsB = normalizeBlockSettings(b.id);
            if ((a.area || '') !== (b.area || '')) return String(a.area || '').localeCompare(String(b.area || ''), 'uk');
            if (settingsA.order !== settingsB.order) return settingsA.order - settingsB.order;
            return String(labelForBlock(a)).localeCompare(String(labelForBlock(b)), 'uk');
        });
    }

    function buildVisibilityPayload() {
        const blocks = {};
        const overrides = {};
        state.registry.forEach(item => {
            const settings = normalizeBlockSettings(item.id);
            blocks[item.id] = settings;
            overrides[item.id] = settings.visible === false;
        });
        return {
            version: 2,
            timelineId: state.activeContext === 'event_genix'
                ? `timeline:${state.activeContext}:${state.activeView}`
                : `timeline:${state.activeContext}`,
            timelineView: state.activeContext === 'event_genix' ? state.activeView : undefined,
            blocks,
            overrides
        };
    }

    function markDirty(kind) {
        if (kind === 'display') state.displayDirty = true;
        else state.visibilityDirty = true;
        renderSaveStatus();
    }

    function updateBlock(id, patch) {
        if (!state.registry.some(item => item.id === id)) return;
        const next = { ...normalizeBlockSettings(id), ...patch };
        if (Object.prototype.hasOwnProperty.call(patch, 'visible')) next.visible = patch.visible !== false;
        if (Object.prototype.hasOwnProperty.call(patch, 'order')) {
            const order = Number(patch.order);
            next.order = Number.isFinite(order) ? Math.max(-999, Math.min(999, Math.round(order))) : normalizeBlockSettings(id).order;
        }
        if (!['default', 'compact', 'comfortable'].includes(next.density)) next.density = 'default';
        if (!['normal', 'muted', 'accent'].includes(next.emphasis)) next.emphasis = 'normal';
        next.customLabel = String(next.customLabel || '').slice(0, 80);
        next.adminNote = String(next.adminNote || '').slice(0, 280);
        state.blocks[id] = next;
        state.overrides[id] = next.visible === false;
        markDirty('visibility');
        renderBlocks();
        renderVisualEditor();
        renderInspector();
        renderPreview();
    }

    function updateDisplay(patch) {
        state.displaySettings = {
            ...(state.displaySettings || {}),
            ...patch
        };
        markDirty('display');
        renderSystemEditor();
    }

    function updateNestedDisplay(collection, key, value) {
        const current = state.displaySettings || {};
        const next = {
            ...(current[collection] || {}),
            [key]: value !== false
        };
        updateDisplay({ [collection]: next });
    }

    function selectedBlock() {
        return state.registry.find(item => item.id === state.selectedBlockId) || state.registry[0] || null;
    }

    function selectBlock(id) {
        const block = state.registry.find(item => item.id === id);
        if (!block) return;
        state.selectedBlockId = id;
        setUrlState();
        renderBlocks();
        renderVisualEditor();
        renderInspector();
        renderPreview();
    }

    function setTab(tab) {
        state.activeTab = tab || 'blocks';
        document.querySelectorAll('[data-timeline-settings-tab]').forEach(button => {
            const active = button.dataset.timelineSettingsTab === state.activeTab;
            button.classList.toggle('active', active);
            button.setAttribute('aria-selected', String(active));
        });
        document.querySelectorAll('[data-timeline-settings-panel]').forEach(panel => {
            panel.classList.toggle('active', panel.dataset.timelineSettingsPanel === state.activeTab);
        });
    }

    function renderContexts() {
        const list = $('timelineSettingsContextList');
        if (!list) return;
        list.innerHTML = state.contexts.map(ctx => {
            const isPark = ctx.key === 'event_genix';
            const view = normalizeTimelineView(ctx.view || 'animators');
            const viewLabel = isPark ? ` \u00b7 ${escapeHtml(TIMELINE_VIEW_LABELS[view] || view)}` : '';
            return `
                <button type="button" class="timeline-settings-context-btn${contextOptionId(ctx) === activeContextOptionId() ? ' active' : ''}" data-timeline-settings-context="${escapeHtml(ctx.key)}" data-timeline-settings-view="${escapeHtml(isPark ? view : '')}">
                    <strong>${escapeHtml(ctx.label || ctx.productName || ctx.key)}</strong>
                    <span>${escapeHtml(ctx.key)}${viewLabel} \u00b7 ${escapeHtml(ctx.route || '/')}</span>
                </button>
            `;
        }).join('');
        const activeTimelineId = $('timelineSettingsTimelineId');
        if (activeTimelineId) activeTimelineId.textContent = state.activeContext === 'event_genix'
            ? `timeline:${state.activeContext}:${state.activeView}`
            : `timeline:${state.activeContext}`;
        const backLink = $('timelineSettingsBackLink');
        if (backLink) backLink.href = returnPathForContext();
    }

    function blockMatchesFilters(item) {
        const settings = normalizeBlockSettings(item.id);
        const query = state.search.trim().toLowerCase();
        const haystack = `${item.id} ${item.title || ''} ${item.label || ''} ${item.area || ''} ${settings.customLabel || ''}`.toLowerCase();
        if (query && !haystack.includes(query)) return false;
        if (state.filters.hidden && settings.visible !== false) return false;
        if (state.filters.accent && settings.emphasis !== 'accent') return false;
        if (state.filters.notes && !settings.adminNote) return false;
        return true;
    }

    function renderBlocks() {
        const host = $('timelineSettingsBlockGroups');
        if (!host) return;
        const groups = new Map();
        orderedRegistry().filter(blockMatchesFilters).forEach(item => {
            const area = item.area || 'Інше';
            if (!groups.has(area)) groups.set(area, []);
            groups.get(area).push(item);
        });
        if (!groups.size) {
            host.innerHTML = '<div class="timeline-settings-empty">За цими фільтрами блоків немає.</div>';
            return;
        }
        host.innerHTML = Array.from(groups.entries()).map(([area, items]) => `
            <section class="timeline-settings-block-group">
                <div class="timeline-settings-block-group-title">${escapeHtml(area)} · ${items.length}</div>
                ${items.map(item => {
                    const settings = normalizeBlockSettings(item.id);
                    const hidden = settings.visible === false;
                    const selected = item.id === state.selectedBlockId;
                    const badges = [
                        `<button type="button" class="timeline-settings-badge timeline-settings-visibility-toggle${hidden ? ' timeline-settings-badge--hidden' : ''}" data-timeline-settings-visibility-toggle="${escapeHtml(item.id)}" aria-pressed="${hidden ? 'false' : 'true'}" title="${hidden ? 'Показати блок' : 'Приховати блок'}">${hidden ? 'Приховано' : 'Видимо'}</button>`,
                        settings.emphasis === 'accent' ? '<span class="timeline-settings-badge timeline-settings-badge--accent">Акцент</span>' : '',
                        settings.adminNote ? '<span class="timeline-settings-badge">Нотатка</span>' : ''
                    ].filter(Boolean).join('');
                    return `
                        <div class="timeline-settings-block-row${selected ? ' active' : ''}${hidden ? ' is-hidden' : ''}">
                            <button type="button" class="timeline-settings-block-main" data-timeline-settings-block="${escapeHtml(item.id)}">
                                <strong>${escapeHtml(labelForBlock(item))}</strong>
                                <small>${escapeHtml(item.id)} · order ${escapeHtml(settings.order)}</small>
                            </button>
                            <span class="timeline-settings-block-badges">${badges}</span>
                        </div>
                    `;
                }).join('')}
            </section>
        `).join('');
    }

    function renderVisualEditor() {
        const host = $('timelineSettingsVisualEditor');
        if (!host) return;
        const item = selectedBlock();
        if (!item) {
            host.innerHTML = '<div class="timeline-settings-empty">Виберіть блок у вкладці “Блоки”.</div>';
            return;
        }
        const settings = normalizeBlockSettings(item.id);
        host.innerHTML = `
            <label class="timeline-settings-field timeline-settings-field--switch">
                <span>Показувати блок</span>
                <span class="timeline-settings-switch">
                    <input type="checkbox" data-timeline-settings-field="visible" ${settings.visible === false ? '' : 'checked'}>
                    <span aria-hidden="true"></span>
                </span>
                <small>Ховає тільки visual block. Ролі, API і дані бронювань не змінюються.</small>
            </label>
            <label class="timeline-settings-field">
                <span>Порядок</span>
                <input type="number" min="-999" max="999" step="1" value="${escapeHtml(settings.order)}" data-timeline-settings-field="order">
                <small>Менше число ставить блок вище або лівіше в межах його зони.</small>
            </label>
            <label class="timeline-settings-field">
                <span>Щільність</span>
                <select data-timeline-settings-field="density">
                    ${Object.entries(DENSITY_LABELS).map(([value, label]) => `<option value="${escapeHtml(value)}"${settings.density === value ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}
                </select>
                <small>Compact стискає відступи, comfortable додає повітря для важливих зон.</small>
            </label>
            <label class="timeline-settings-field">
                <span>Акцент</span>
                <select data-timeline-settings-field="emphasis">
                    ${Object.entries(EMPHASIS_LABELS).map(([value, label]) => `<option value="${escapeHtml(value)}"${settings.emphasis === value ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}
                </select>
                <small>Акцент підсвічує блок у налаштуваннях і допомагає швидко знайти важливе.</small>
            </label>
            <label class="timeline-settings-field timeline-settings-field--wide">
                <span>Назва в налаштуваннях</span>
                <input type="text" maxlength="80" value="${escapeHtml(settings.customLabel)}" placeholder="${escapeHtml(item.title || item.id)}" data-timeline-settings-field="customLabel">
                <small>Службова назва тільки для цієї сторінки. Бойовий текст кнопок не перейменовується.</small>
            </label>
            <label class="timeline-settings-field timeline-settings-field--wide">
                <span>Внутрішня нотатка</span>
                <textarea maxlength="280" rows="4" placeholder="Наприклад: не ховати у вихідні" data-timeline-settings-field="adminNote">${escapeHtml(settings.adminNote)}</textarea>
                <small>Видима тільки в налаштуваннях. Використовуйте для правил і причин зміни.</small>
            </label>
        `;
    }

    function renderPresets() {
        const host = $('timelineSettingsPresets');
        if (!host) return;
        host.innerHTML = PRESETS.map(preset => `
            <button type="button" class="timeline-settings-preset" data-timeline-settings-preset="${escapeHtml(preset.key)}">
                <strong>${escapeHtml(preset.label)}</strong>
                <span>${escapeHtml(preset.description)}</span>
                <small>${preset.hidden ? `${preset.hidden.length} прихованих блоків` : 'Базова видимість'}</small>
            </button>
        `).join('');
    }

    function renderSystemEditor() {
        const host = $('timelineSettingsSystemEditor');
        if (!host) return;
        const display = state.displaySettings || {};
        const modules = display.enabledModules || {};
        const features = display.timelineFeatures || {};
        const moduleRows = Object.entries(MODULE_LABELS).map(([key, label]) => `
            <label class="timeline-settings-field timeline-settings-field--switch">
                <span>${escapeHtml(label)}</span>
                <span class="timeline-settings-switch">
                    <input type="checkbox" data-timeline-settings-module="${escapeHtml(key)}" ${modules[key] === false ? '' : 'checked'}>
                    <span aria-hidden="true"></span>
                </span>
                <small>Модуль з існуючого timeline-display payload.</small>
            </label>
        `).join('');
        const featureRows = Object.entries(FEATURE_LABELS).map(([key, label]) => `
            <label class="timeline-settings-field timeline-settings-field--switch">
                <span>${escapeHtml(label)}</span>
                <span class="timeline-settings-switch">
                    <input type="checkbox" data-timeline-settings-feature="${escapeHtml(key)}" ${features[key] === false ? '' : 'checked'}>
                    <span aria-hidden="true"></span>
                </span>
                <small>Feature flag з існуючого timeline-display payload.</small>
            </label>
        `).join('');
        host.innerHTML = `
            <label class="timeline-settings-field">
                <span>Режим</span>
                <select data-timeline-settings-display="mode">
                    ${Object.entries(MODE_LABELS).map(([value, label]) => `<option value="${escapeHtml(value)}"${display.mode === value ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}
                </select>
                <small>Визначає презентаційну модель таймлайну.</small>
            </label>
            <label class="timeline-settings-field">
                <span>Стартова сторінка</span>
                <select data-timeline-settings-display="startPage">
                    ${Object.entries(START_PAGE_LABELS).map(([value, label]) => `<option value="${escapeHtml(value)}"${display.startPage === value ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}
                </select>
                <small>Куди вести користувача для цього бізнес-контексту.</small>
            </label>
            <label class="timeline-settings-field">
                <span>Ресурсна модель</span>
                <select data-timeline-settings-display="resourceModel">
                    ${Object.entries(RESOURCE_MODEL_LABELS).map(([value, label]) => `<option value="${escapeHtml(value)}"${display.resourceModel === value ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}
                </select>
                <small>Для park режиму backend нормалізує auto.</small>
            </label>
            <label class="timeline-settings-field">
                <span>Кухня парку</span>
                <select data-timeline-settings-display="parkKitchenMode">
                    <option value="with_kitchen"${display.parkKitchenMode !== 'without_kitchen' ? ' selected' : ''}>З кухнею</option>
                    <option value="without_kitchen"${display.parkKitchenMode === 'without_kitchen' ? ' selected' : ''}>Без кухні</option>
                </select>
                <small>Працює тільки для park timeline.</small>
            </label>
            <label class="timeline-settings-field timeline-settings-field--switch">
                <span>Room timeline</span>
                <span class="timeline-settings-switch">
                    <input type="checkbox" data-timeline-settings-display="roomTimelineEnabled" ${display.roomTimelineEnabled === false ? '' : 'checked'}>
                    <span aria-hidden="true"></span>
                </span>
                <small>Дозволяє перемикання кімнати/аніматори, якщо режим це підтримує.</small>
            </label>
            <label class="timeline-settings-field">
                <span>Default view</span>
                <select data-timeline-settings-display="defaultTimelineView">
                    <option value="animators"${display.defaultTimelineView !== 'rooms' ? ' selected' : ''}>Аніматори</option>
                    <option value="rooms"${display.defaultTimelineView === 'rooms' ? ' selected' : ''}>Кімнати</option>
                </select>
                <small>Початковий вигляд робочої сітки.</small>
            </label>
            <div class="timeline-settings-system-card timeline-settings-field--wide">
                <strong>Модулі</strong>
                <small>Зберігаються в enabledModules без зміни API або ролей.</small>
            </div>
            ${moduleRows}
            <div class="timeline-settings-system-card timeline-settings-field--wide">
                <strong>Features</strong>
                <small>Зберігаються в timelineFeatures без зміни бронювань.</small>
            </div>
            ${featureRows}
        `;
    }

    function renderInspector() {
        const host = $('timelineSettingsInspector');
        if (!host) return;
        const item = selectedBlock();
        if (!item) {
            host.innerHTML = '<div class="timeline-settings-empty">Блок не вибрано.</div>';
            return;
        }
        const settings = normalizeBlockSettings(item.id);
        const updatedAt = state.visibilityMeta.updatedAt || state.displayMeta.updatedAt || null;
        const updatedBy = state.visibilityMeta.updatedBy || state.displayMeta.updatedBy || 'невідомо';
        host.innerHTML = `
            <article class="timeline-settings-detail-card">
                <small>${escapeHtml(item.id)}</small>
                <h3>${escapeHtml(labelForBlock(item))}</h3>
                <p>${escapeHtml(item.description || 'Візуальний блок таймлайну.')}</p>
            </article>
            <article class="timeline-settings-detail-card">
                <small>Як змінювати</small>
                <p>${escapeHtml(item.howToUse || 'Змінюйте тільки візуальні параметри. Дані бронювань не змінюються.')}</p>
            </article>
            <article class="timeline-settings-detail-card">
                <small>Вплив</small>
                <p>${escapeHtml(item.impact || 'Впливає тільки на відображення активного timeline context.')}</p>
            </article>
            <article class="timeline-settings-detail-card">
                <small>Поточний стан</small>
                <p>${settings.visible === false ? 'Приховано' : 'Видимо'} · ${escapeHtml(DENSITY_LABELS[settings.density])} · ${escapeHtml(EMPHASIS_LABELS[settings.emphasis])}</p>
            </article>
            <article class="timeline-settings-detail-card">
                <small>Оновлено</small>
                <p>${updatedAt ? escapeHtml(new Date(updatedAt).toLocaleString('uk-UA')) : 'Ще не збережено на сервері'} · ${escapeHtml(updatedBy)}</p>
            </article>
        `;
    }

    function renderPreview() {
        const host = $('timelineSettingsPreview');
        if (!host) return;
        const groups = new Map();
        orderedRegistry().forEach(item => {
            const area = item.area || 'Інше';
            if (!groups.has(area)) groups.set(area, []);
            groups.get(area).push(item);
        });
        host.innerHTML = Array.from(groups.entries()).map(([area, items]) => `
            <div class="timeline-settings-preview-zone">
                <strong>${escapeHtml(area)}</strong>
                <div class="timeline-settings-preview-blocks">
                    ${items.slice(0, 9).map(item => {
                        const settings = normalizeBlockSettings(item.id);
                        return `<span class="timeline-settings-preview-block${settings.visible === false ? ' is-hidden' : ''}">${escapeHtml(labelForBlock(item))}</span>`;
                    }).join('')}
                    ${items.length > 9 ? `<span class="timeline-settings-preview-block">+${items.length - 9}</span>` : ''}
                </div>
            </div>
        `).join('');
    }

    function renderSaveStatus() {
        const el = $('timelineSettingsSaveStatus');
        const saveBtn = $('timelineSettingsSaveBtn');
        const resetBtn = $('timelineSettingsResetBtn');
        const canManage = canManageSystemSettings();
        if (saveBtn) saveBtn.disabled = !canManage || state.saving || (!state.visibilityDirty && !state.displayDirty);
        if (resetBtn) resetBtn.disabled = !canManage || state.saving;
        if (!el) return;
        if (state.saving) {
            el.dataset.status = 'saving';
            el.textContent = 'Збереження...';
        } else if (state.visibilityDirty || state.displayDirty) {
            el.dataset.status = 'dirty';
            el.textContent = 'Є незбережені зміни.';
        } else {
            el.dataset.status = 'idle';
            el.textContent = 'Все збережено або змін не було.';
        }
    }

    function renderAll() {
        renderContexts();
        renderBlocks();
        renderVisualEditor();
        renderPresets();
        renderSystemEditor();
        renderInspector();
        renderPreview();
        renderSaveStatus();
        setTab(state.activeTab);
    }

    function applyPreset(key) {
        const preset = PRESETS.find(item => item.key === key);
        if (!preset) return;
        const hidden = preset.hidden ? new Set(preset.hidden) : null;
        state.registry.forEach(item => {
            const settings = normalizeBlockSettings(item.id);
            const visible = hidden ? !hidden.has(item.id) : item.defaultVisible !== false;
            state.blocks[item.id] = { ...settings, visible };
            state.overrides[item.id] = visible === false;
        });
        markDirty('visibility');
        renderAll();
        notify(`Пресет “${preset.label}” застосовано. Натисніть “Зберегти”, щоб записати зміни.`, 'info');
    }

    async function saveSettings() {
        if (!canManageSystemSettings()) {
            notify('\u041d\u0435\u0434\u043e\u0441\u0442\u0430\u0442\u043d\u044c\u043e \u043f\u0440\u0430\u0432 \u0434\u043b\u044f \u043a\u0435\u0440\u0443\u0432\u0430\u043d\u043d\u044f \u043d\u0430\u043b\u0430\u0448\u0442\u0443\u0432\u0430\u043d\u043d\u044f\u043c\u0438 \u0442\u0430\u0439\u043c\u043b\u0430\u0439\u043d\u0443.', 'error');
            return;
        }
        if (state.saving) return;
        state.saving = true;
        renderSaveStatus();
        try {
            if (state.visibilityDirty) {
                const visibility = await request('PUT', '/settings/timeline-visibility', buildVisibilityPayload());
                applyVisibilityResponse(visibility);
                state.visibilityDirty = false;
            }
            if (state.displayDirty) {
                const display = await request('PUT', '/settings/timeline-display', state.displaySettings || {});
                state.displaySettings = display || {};
                state.displayMeta = { updatedAt: display?.updatedAt || null, updatedBy: display?.updatedBy || null };
                state.displayDirty = false;
            }
            notify('Налаштування таймлайну збережено.', 'success');
        } catch (err) {
            if (!isAuthError(err)) {
                console.error('[TimelineSettings] save failed', err);
                notify(err.message || 'Не вдалося зберегти налаштування таймлайну.', 'error');
            }
        } finally {
            state.saving = false;
            renderAll();
        }
    }

    async function resetSettings() {
        if (!canManageSystemSettings()) {
            notify('\u041d\u0435\u0434\u043e\u0441\u0442\u0430\u0442\u043d\u044c\u043e \u043f\u0440\u0430\u0432 \u0434\u043b\u044f \u043a\u0435\u0440\u0443\u0432\u0430\u043d\u043d\u044f \u043d\u0430\u043b\u0430\u0448\u0442\u0443\u0432\u0430\u043d\u043d\u044f\u043c\u0438 \u0442\u0430\u0439\u043c\u043b\u0430\u0439\u043d\u0443.', 'error');
            return;
        }
        if (typeof window.confirmModal !== 'function') {
            notify('CRM confirm modal ще не завантажився. Спробуйте ще раз за секунду.', 'error');
            return;
        }
        const confirmed = await window.confirmModal('Скинути visual налаштування цього timeline context до базового набору?', {
            type: 'warning',
            okText: 'Скинути',
            cancelText: 'Скасувати'
        });
        if (!confirmed) return;
        state.saving = true;
        renderSaveStatus();
        try {
            const visibility = await request('PUT', '/settings/timeline-visibility', {
                version: 2,
                timelineId: state.activeContext === 'event_genix'
                    ? `timeline:${state.activeContext}:${state.activeView}`
                    : `timeline:${state.activeContext}`,
                timelineView: state.activeContext === 'event_genix' ? state.activeView : undefined,
                blocks: {},
                overrides: {}
            });
            applyVisibilityResponse(visibility);
            state.visibilityDirty = false;
            notify('Visual налаштування скинуто для поточного timeline.', 'success');
        } catch (err) {
            if (!isAuthError(err)) {
                console.error('[TimelineSettings] reset failed', err);
                notify(err.message || 'Не вдалося скинути налаштування.', 'error');
            }
        } finally {
            state.saving = false;
            renderAll();
        }
    }

    function applyVisibilityResponse(data) {
        const response = data || {};
        state.registry = Array.isArray(response.registry) ? response.registry : [];
        state.blocks = response.blocks && typeof response.blocks === 'object' ? response.blocks : {};
        state.overrides = response.overrides && typeof response.overrides === 'object' ? response.overrides : {};
        state.visibilityMeta = {
            updatedAt: response.updatedAt || null,
            updatedBy: response.updatedBy || null
        };
        const requestedBlock = queryParams().get('block');
        if (requestedBlock && state.registry.some(item => item.id === requestedBlock)) {
            state.selectedBlockId = requestedBlock;
        } else if (!state.registry.some(item => item.id === state.selectedBlockId)) {
            state.selectedBlockId = state.registry[0]?.id || '';
        }
    }

    async function loadContextSettings() {
        state.loading = true;
        renderSaveStatus();
        try {
            const [visibility, display] = await Promise.all([
                request('GET', '/settings/timeline-visibility'),
                request('GET', '/settings/timeline-display')
            ]);
            applyVisibilityResponse(visibility);
            state.displaySettings = display || {};
            state.displayMeta = { updatedAt: display?.updatedAt || null, updatedBy: display?.updatedBy || null };
            state.visibilityDirty = false;
            state.displayDirty = false;
            state.loading = false;
            setUrlState();
            renderAll();
            revealShell();
        } catch (err) {
            state.loading = false;
            revealShell();
            if (!isAuthError(err)) {
                console.error('[TimelineSettings] load failed', err);
                notify(err.message || 'Не вдалося завантажити налаштування таймлайну.', 'error');
                renderAll();
            }
        }
    }

    async function switchContext(nextContext, nextView = null) {
        const normalizedView = nextContext === 'event_genix' ? normalizeTimelineView(nextView || 'animators') : 'animators';
        if (!nextContext || (nextContext === state.activeContext && normalizedView === state.activeView)) return;
        if ((state.visibilityDirty || state.displayDirty) && typeof window.confirmModal === 'function') {
            const ok = await window.confirmModal('Є незбережені зміни. Перемкнути timeline context без збереження?', {
                type: 'warning',
                okText: 'Перемкнути',
                cancelText: 'Залишитись'
            });
            if (!ok) return;
        }
        state.activeContext = nextContext;
        state.activeView = normalizedView;
        const meta = currentContextMeta();
        state.returnPath = meta.route || '/';
        state.selectedBlockId = '';
        setUrlState();
        renderContexts();
        await loadContextSettings();
    }

    function bindEvents() {
        document.addEventListener('click', event => {
            const contextBtn = event.target.closest('[data-timeline-settings-context]');
            if (contextBtn) {
                event.preventDefault();
                switchContext(contextBtn.dataset.timelineSettingsContext, contextBtn.dataset.timelineSettingsView);
                return;
            }
            const tabBtn = event.target.closest('[data-timeline-settings-tab]');
            if (tabBtn) {
                event.preventDefault();
                setTab(tabBtn.dataset.timelineSettingsTab);
                return;
            }
            const filterBtn = event.target.closest('[data-timeline-settings-filter]');
            if (filterBtn) {
                event.preventDefault();
                const key = filterBtn.dataset.timelineSettingsFilter;
                state.filters[key] = !state.filters[key];
                filterBtn.classList.toggle('active', state.filters[key]);
                renderBlocks();
                return;
            }
            const visibilityBtn = event.target.closest('[data-timeline-settings-visibility-toggle]');
            if (visibilityBtn) {
                event.preventDefault();
                const id = visibilityBtn.dataset.timelineSettingsVisibilityToggle;
                const block = state.registry.find(item => item.id === id);
                if (!block) return;
                state.selectedBlockId = id;
                setUrlState();
                const current = normalizeBlockSettings(id);
                updateBlock(id, { visible: current.visible === false });
                return;
            }
            const blockBtn = event.target.closest('[data-timeline-settings-block]');
            if (blockBtn) {
                event.preventDefault();
                selectBlock(blockBtn.dataset.timelineSettingsBlock);
                return;
            }
            const presetBtn = event.target.closest('[data-timeline-settings-preset]');
            if (presetBtn) {
                event.preventDefault();
                applyPreset(presetBtn.dataset.timelineSettingsPreset);
            }
        });

        $('timelineSettingsSearch')?.addEventListener('input', event => {
            state.search = event.target.value || '';
            renderBlocks();
        });

        $('timelineSettingsVisualEditor')?.addEventListener('change', event => {
            const field = event.target.closest('[data-timeline-settings-field]');
            if (!field) return;
            const item = selectedBlock();
            if (!item) return;
            const key = field.dataset.timelineSettingsField;
            const value = field.type === 'checkbox' ? field.checked : field.value;
            updateBlock(item.id, { [key]: value });
        });

        $('timelineSettingsVisualEditor')?.addEventListener('input', event => {
            const field = event.target.closest('[data-timeline-settings-field]');
            if (!field || !['customLabel', 'adminNote', 'order'].includes(field.dataset.timelineSettingsField)) return;
            const item = selectedBlock();
            if (!item) return;
            updateBlock(item.id, { [field.dataset.timelineSettingsField]: field.value });
        });

        $('timelineSettingsSystemEditor')?.addEventListener('change', event => {
            const displayField = event.target.closest('[data-timeline-settings-display]');
            if (displayField) {
                const key = displayField.dataset.timelineSettingsDisplay;
                const value = displayField.type === 'checkbox' ? displayField.checked : displayField.value;
                updateDisplay({ [key]: value });
                return;
            }
            const moduleField = event.target.closest('[data-timeline-settings-module]');
            if (moduleField) {
                updateNestedDisplay('enabledModules', moduleField.dataset.timelineSettingsModule, moduleField.checked);
                return;
            }
            const featureField = event.target.closest('[data-timeline-settings-feature]');
            if (featureField) {
                updateNestedDisplay('timelineFeatures', featureField.dataset.timelineSettingsFeature, featureField.checked);
            }
        });

        $('timelineSettingsSaveBtn')?.addEventListener('click', saveSettings);
        $('timelineSettingsResetBtn')?.addEventListener('click', resetSettings);
    }

    function revealShell() {
        if (typeof window.showAuthenticatedPageShell === 'function') window.showAuthenticatedPageShell();
        else if (typeof window.Sidebar !== 'undefined' && window.Sidebar.markShellReady) window.Sidebar.markShellReady();
    }

    async function hydrateBusinessProfile() {
        if (typeof window.CrmBusinessContext?.hydrateProfile !== 'function') return;
        try {
            await window.CrmBusinessContext.hydrateProfile({ updateUrl: false, emit: true });
        } catch (error) {
            console.warn('[TimelineSettings] business profile hydrate skipped', error);
        }
    }

    async function init() {
        const params = queryParams();
        state.returnPath = sanitizeReturnPath(params.get('return') || '/');
        state.activeContext = parseInitialContext();
        state.activeView = parseInitialView(state.activeContext);
        await hydrateBusinessProfile();
        state.contexts = buildContextList();
        if (!state.contexts.some(item => contextOptionId(item) === activeContextOptionId())) {
            state.contexts.push(fallbackContext(state.activeContext, state.activeView));
        }
        if (!state.returnPath || state.returnPath === '/') {
            state.returnPath = currentContextMeta().route || '/';
        }
        bindEvents();
        renderContexts();
        renderPresets();
        renderSaveStatus();
        window.addEventListener('crm:authenticated-runtime-ready', renderSaveStatus);
        await loadContextSettings();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
