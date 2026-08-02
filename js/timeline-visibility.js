/**
 * Timeline visual settings center.
 *
 * Keeps one timeline engine, but lets elevated users tune visual blocks for
 * each business timeline. Settings are scoped by TimelineBusinessContext.
 */
(function () {
    const STORAGE_NAME = 'timeline_element_visibility';
    const DISABLED_ATTR = 'data-timeline-visibility-prev-disabled';
    const VISUAL_VARIABLES = ['visible', 'order', 'density', 'emphasis', 'customLabel', 'adminNote'];
    const DENSITY_VALUES = ['default', 'compact', 'comfortable'];
    const EMPHASIS_VALUES = ['normal', 'muted', 'accent'];
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

    function visualBlock(id, area, title, selector, options = {}) {
        return {
            id,
            key: id,
            area,
            title,
            label: title,
            selector,
            targetWrapper: options.targetWrapper === true,
            defaultVisible: options.defaultVisible !== false,
            description: options.description || `${title} — візуальний блок таймлайну в зоні "${area}".`,
            howToUse: options.howToUse || 'Міняйте тільки видимість, порядок, щільність, акцент, службову назву та внутрішню нотатку. Це не змінює дані бронювання.',
            impact: options.impact || 'Впливає лише на вигляд цього таймлайну для активного бізнесу; API, ролі та бізнес-логіка не змінюються.',
            variables: [...VISUAL_VARIABLES]
        };
    }

    const TIMELINE_VISIBILITY_ELEMENTS = [
        visualBlock('dateControls', 'Верхня панель', 'Дата і навігація', '.date-controls', {
            description: 'Календарний фокус, сьогоднішня дата та перемикання дня.',
            impact: 'Якщо сховати, оператору складніше перейти на іншу дату без клавіатури або URL.'
        }),
        visualBlock('statusFilters', 'Верхня панель', 'Фільтри статусів', '.status-filter-controls', {
            description: 'Швидке фокусування бронювань за робочими статусами.',
            impact: 'Не змінює статуси, але прибирає швидку фільтрацію дня.'
        }),
        visualBlock('viewModes', 'Верхня панель', 'День / тиждень', '.view-mode-controls'),
        visualBlock('zoomControls', 'Верхня панель', 'Масштаб 15/30/60 хв', '.zoom-controls'),
        visualBlock('compactToggle', 'Верхня панель', 'Компактний режим', '#compactModeToggle', { targetWrapper: true }),
        visualBlock('undo', 'Верхня панель', 'Скасувати дію', '#undoBtn'),
        visualBlock('productSales', 'Верхня панель', 'Продажі', '#productSalesBtn'),
        visualBlock('export', 'Верхня панель', 'Експорт', '#exportTimelineBtn, #exportPdfBtn'),
        visualBlock('actionMenu', 'Верхня панель', 'Меню дій', '#adminDropdown'),
        visualBlock('history', 'Верхня панель', 'Історія змін', '#historyBtn'),
        visualBlock('quickStats', 'Робоча зона', 'Швидка статистика', '#quickStatsBar'),
        visualBlock('assistantWidget', 'Робоча зона', 'Помічник', '#kleshnyaWidget'),
        visualBlock('warnings', 'Робоча зона', 'Попередження', '#warningBanner, #filterModeBanner'),
        visualBlock('timelineScale', 'Таймлайн', 'Шкала часу', '#timeScale'),
        visualBlock('timelineGrid', 'Таймлайн', 'Сітка таймлайну', '#timelineScroll, #timelineLines', {
            description: 'Основна робоча зона з часовою сіткою, рядками і картками бронювань.',
            impact: 'Якщо сховати, сторінка втрачає головну дошку розкладу, але дані бронювань лишаються незмінними.'
        }),
        visualBlock('addLine', 'Таймлайн', 'Додати лінію / спеціаліста', '#addLineBtn'),
        visualBlock('legend', 'Таймлайн', 'Легенда', '.legend'),
        visualBlock('minimap', 'Таймлайн', 'Мінімапа', '#minimapContainer'),
        visualBlock('bookingPanel', 'Форма бронювання', 'Панель бронювання', '#bookingPanel'),
        visualBlock('bookingClose', 'Форма бронювання', 'Закрити панель бронювання', '#closePanel'),
        visualBlock('bookingSelectedInfo', 'Форма бронювання', 'Обрані дата / час / лінія', '#bookingPanel .selected-info'),
        visualBlock('bookingRoom', 'Форма бронювання', 'Кімната', '#roomSelect', { targetWrapper: true }),
        visualBlock('freeRooms', 'Форма бронювання', 'Вільні кімнати', '#freeRoomsBtn'),
        visualBlock('freeRoomsPanel', 'Форма бронювання', 'Панель вільних кімнат', '#freeRoomsPanel'),
        visualBlock('costume', 'Форма бронювання', 'Костюм', '#costumeSelect', { targetWrapper: true }),
        visualBlock('extraHost', 'Форма бронювання', 'Додатковий ведучий', '#extraHostSection'),
        visualBlock('secondAnimator', 'Форма бронювання', 'Другий аніматор', '#secondAnimatorSection'),
        visualBlock('hostsWarning', 'Форма бронювання', 'Попередження про ведучих', '#hostsWarning'),
        visualBlock('notes', 'Форма бронювання', 'Коментар бронювання', '#bookingNotes', { targetWrapper: true }),
        visualBlock('groupName', 'Форма бронювання', 'Назва заявки / група (legacy)', '#bookingGroupName', { targetWrapper: true }),
        visualBlock('customerToggle', 'Форма бронювання', 'Перемикач даних клієнта', '#customerDataToggle', { targetWrapper: true }),
        visualBlock('customerData', 'Форма бронювання', 'Дані клієнта', '#customerDataSection'),
        visualBlock('customerSearch', 'Форма бронювання', 'Пошук клієнта', '#customerSearch', { targetWrapper: true }),
        visualBlock('customerFields', 'Форма бронювання', 'Поля клієнта', '#customerName, #customerPhone, #customerInstagram, #customerChildName, #customerChildBirthday, #customerSource', { targetWrapper: true }),
        visualBlock('customerInfo', 'Форма бронювання', 'Інфо про клієнта', '#customerInfo'),
        visualBlock('programSearch', 'Форма бронювання', 'Пошук програми / консультації', '#programSearch', { targetWrapper: true }),
        visualBlock('programs', 'Форма бронювання', 'Картки програм / консультацій', '#programsIcons'),
        visualBlock('programDetails', 'Форма бронювання', 'Деталі програми', '#programDetails'),
        visualBlock('customProgram', 'Форма бронювання', 'Кастомна програма', '#customProgramSection'),
        visualBlock('customProgramFields', 'Форма бронювання', 'Поля кастомної позиції', '#customName, #customDuration', { targetWrapper: true }),
        visualBlock('pinata', 'Форма бронювання', 'Піньята', '#pinataModeSection, #pinataSharedFields, #clientPinataServiceFields, #pinataFillerSection'),
        visualBlock('kidsCount', 'Форма бронювання', 'Кількість дітей', '#kidsCountSection'),
        visualBlock('tshirtSizes', 'Форма бронювання', 'Розміри футболок', '#tshirtSizesSection'),
        visualBlock('bookingStatus', 'Форма бронювання', 'Статус бронювання', '#bookingPanel .status-section'),
        visualBlock('bookingSubmit', 'Форма бронювання', 'Кнопка збереження бронювання', '#bookingSubmitBtn')
    ].map((item, index) => ({ ...item, defaultOrder: (index + 1) * 10 }));

    const VISIBILITY_PRESETS = [
        {
            key: 'business_default',
            label: 'Стандарт бізнесу',
            description: 'Повертає набір елементів із профілю поточного бізнесу.',
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
        initialized: false,
        constructorActive: false,
        selectedBlockId: TIMELINE_VISIBILITY_ELEMENTS[0]?.id || null,
        panel: null,
        toggleBtn: null,
        accessTimer: null,
        serverSettings: new Map(),
        serverLoadPromise: null,
        serverLoadKey: null,
        serverSaveTimer: null,
        saveStatus: 'idle',
        saveMessage: 'Зміни зберігаються автоматично для цього timeline.'
    };

    function contextApi() {
        return window.TimelineBusinessContext || null;
    }

    function currentContext() {
        return contextApi()?.current?.() || { key: 'event_genix', productName: 'Таймлайн ПАРК', storagePrefix: 'pzp' };
    }

    function currentContextKey() {
        const ctx = currentContext();
        return ctx.key || ctx.apiValue || 'event_genix';
    }

    function currentTimelineViewKey() {
        const apiView = window.TimelineView?.current?.();
        if (apiView === 'rooms') return 'rooms';
        if (document.body?.classList?.contains('timeline-view-rooms')) return 'rooms';
        return 'animators';
    }

    function visibilityScopeKey() {
        const context = currentContextKey();
        return context === 'event_genix'
            ? `${context}:${currentTimelineViewKey()}`
            : context;
    }

    function currentTimelineId() {
        const context = currentContextKey();
        return context === 'event_genix'
            ? `timeline:${context}:${currentTimelineViewKey()}`
            : `timeline:${context}`;
    }

    function baseStorageKey() {
        return contextApi()?.storageKey?.(STORAGE_NAME) || `${currentContext().storagePrefix || 'pzp'}_${STORAGE_NAME}`;
    }

    function storageKey() {
        const base = baseStorageKey();
        return currentContextKey() === 'event_genix'
            ? `${base}_${currentTimelineViewKey()}`
            : base;
    }

    function apiUrl(path) {
        const base = window.API_BASE || '/api';
        const url = `${base}${path}`;
        const withContext = contextApi()?.appendApiContext?.(url) || url;
        if (currentContextKey() !== 'event_genix') return withContext;
        if (/[?&](timelineView|timeline_view|view)=/.test(withContext)) return withContext;
        const joiner = withContext.includes('?') ? '&' : '?';
        return `${withContext}${joiner}timelineView=${encodeURIComponent(currentTimelineViewKey())}`;
    }

    function authHeaders(withContentType = false) {
        if (typeof window.getAuthHeaders === 'function') return window.getAuthHeaders(withContentType);
        if (typeof getAuthHeaders === 'function') return getAuthHeaders(withContentType);
        const token = localStorage.getItem('pzp_token') || localStorage.getItem('token') || localStorage.getItem('authToken');
        const headers = {};
        if (withContentType) headers['Content-Type'] = 'application/json';
        if (token) headers.Authorization = `Bearer ${token}`;
        return headers;
    }

    function hasAuthenticatedTimelineUser() {
        if (typeof window.isAuthenticatedRuntimeReady === 'function') {
            return window.isAuthenticatedRuntimeReady();
        }
        return Boolean(window.AppState?.currentUser);
    }

    function canConfigure() {
        const settingsDecision = typeof window.resolveCapability === 'function'
            ? window.resolveCapability(window.AppState?.currentUser || null, 'manage_settings', { type: 'action' })
            : null;
        if (settingsDecision?.allowed !== true) return false;
        const api = contextApi();
        if (!api?.canUseAction) return false;
        return api.canUseAction('settings', window.AppState?.currentUser || null);
    }

    function safeParseJson(raw) {
        try {
            return raw ? JSON.parse(raw) : null;
        } catch (error) {
            console.warn('[TimelineVisibility] Failed to parse visual settings', error);
            return null;
        }
    }

    function defaultHiddenKeys() {
        const ctx = currentContext();
        const presentation = contextApi()?.presentation?.();
        const keys = [
            ...(Array.isArray(ctx.defaultHiddenElements) ? ctx.defaultHiddenElements : []),
            ...(Array.isArray(presentation?.defaultHiddenElements) ? presentation.defaultHiddenElements : [])
        ];
        return new Set(keys);
    }

    function defaultVisibleFor(item) {
        if (item.defaultVisible === false) return false;
        return !defaultHiddenKeys().has(item.id);
    }

    function hasOwn(source, key) {
        return Object.prototype.hasOwnProperty.call(source || {}, key);
    }

    function safeOrder(value, fallback) {
        const n = Number(value);
        if (!Number.isFinite(n)) return fallback;
        return Math.max(-999, Math.min(999, Math.round(n)));
    }

    function safeText(value, limit) {
        return String(value || '').trim().slice(0, limit);
    }

    function normalizeBlockSettings(item, rawBlock = {}, index = 0, overrides = {}) {
        const raw = rawBlock && typeof rawBlock === 'object' && !Array.isArray(rawBlock) ? rawBlock : {};
        const legacyHidden = hasOwn(overrides, item.id) ? Boolean(overrides[item.id]) : null;
        const visible = hasOwn(raw, 'visible')
            ? raw.visible !== false
            : (legacyHidden === null ? defaultVisibleFor(item) : !legacyHidden);
        const density = DENSITY_VALUES.includes(String(raw.density || '')) ? String(raw.density) : 'default';
        const emphasis = EMPHASIS_VALUES.includes(String(raw.emphasis || '')) ? String(raw.emphasis) : 'normal';
        return {
            visible,
            order: safeOrder(raw.order, item.defaultOrder || ((index + 1) * 10)),
            density,
            emphasis,
            customLabel: safeText(raw.customLabel, 80),
            adminNote: safeText(raw.adminNote, 280)
        };
    }

    function normalizeSettings(parsed) {
        const raw = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        const rawBlocks = raw.blocks && typeof raw.blocks === 'object' && !Array.isArray(raw.blocks) ? raw.blocks : {};
        const rawOverrides = raw.overrides && typeof raw.overrides === 'object' && !Array.isArray(raw.overrides) ? raw.overrides : {};
        const blocks = {};
        const overrides = {};
        TIMELINE_VISIBILITY_ELEMENTS.forEach((item, index) => {
            const block = normalizeBlockSettings(item, rawBlocks[item.id], index, rawOverrides);
            blocks[item.id] = block;
            overrides[item.id] = block.visible === false;
        });
        return {
            version: 2,
            timelineId: raw.timelineId || currentTimelineId(),
            context: raw.context || currentContextKey(),
            blocks,
            overrides,
            updatedAt: raw.updatedAt || null,
            updatedBy: raw.updatedBy || null
        };
    }

    function compactSettingsForSave(settings) {
        const normalized = normalizeSettings(settings);
        const blocks = {};
        const overrides = {};
        TIMELINE_VISIBILITY_ELEMENTS.forEach(item => {
            const block = normalized.blocks[item.id];
            blocks[item.id] = {
                visible: block.visible !== false,
                order: block.order,
                density: block.density,
                emphasis: block.emphasis,
                customLabel: block.customLabel,
                adminNote: block.adminNote
            };
            overrides[item.id] = block.visible === false;
        });
        return {
            version: 2,
            timelineId: currentTimelineId(),
            blocks,
            overrides,
            updatedAt: new Date().toISOString()
        };
    }

    function loadSettings() {
        const contextKey = visibilityScopeKey();
        if (state.serverSettings.has(contextKey)) return normalizeSettings(state.serverSettings.get(contextKey));
        const scoped = localStorage.getItem(storageKey());
        if (scoped) return normalizeSettings(safeParseJson(scoped));
        if (currentContextKey() === 'event_genix' && currentTimelineViewKey() === 'animators') {
            return normalizeSettings(safeParseJson(localStorage.getItem(baseStorageKey())));
        }
        return normalizeSettings(null);
    }

    function saveSettings(settings) {
        const payload = compactSettingsForSave(settings);
        localStorage.setItem(storageKey(), JSON.stringify(payload));
        state.serverSettings.set(visibilityScopeKey(), payload);
        scheduleServerSave(payload);
    }

    async function loadServerSettings() {
        if (!hasAuthenticatedTimelineUser()) return null;
        const contextKey = visibilityScopeKey();
        if (state.serverLoadPromise && state.serverLoadKey === contextKey) return state.serverLoadPromise;
        state.serverLoadKey = contextKey;
        state.serverLoadPromise = fetch(apiUrl('/settings/timeline-visibility'), {
            headers: authHeaders(false)
        })
            .then(response => response.ok ? response.json() : null)
            .then(data => {
                if (data) {
                    mergeServerRegistry(data.registry);
                    const normalized = normalizeSettings(data);
                    state.serverSettings.set(contextKey, normalized);
                    localStorage.setItem(storageKey(), JSON.stringify(normalized));
                    setSaveStatus('saved', 'Серверні налаштування завантажено.');
                }
                return data;
            })
            .catch(error => {
                console.warn('[TimelineVisibility] Server visual settings unavailable', error);
                return null;
            })
            .finally(() => {
                state.serverLoadPromise = null;
                state.serverLoadKey = null;
            });
        return state.serverLoadPromise;
    }

    function mergeServerRegistry(registry) {
        if (!Array.isArray(registry)) return;
        const byId = new Map(registry.map(item => [item?.id, item]).filter(([id]) => id));
        TIMELINE_VISIBILITY_ELEMENTS.forEach(item => {
            const serverItem = byId.get(item.id);
            if (!serverItem) return;
            ['title', 'description', 'howToUse', 'impact', 'defaultVisible', 'variables'].forEach(key => {
                if (serverItem[key] !== undefined) item[key] = serverItem[key];
            });
            item.label = item.title || item.label;
        });
    }

    function scheduleServerSave(settings) {
        if (!canConfigure()) {
            setSaveStatus('saved', 'Збережено локально для поточної сесії.');
            return;
        }
        setSaveStatus('dirty', 'Є незбережені зміни. Синхронізую...');
        window.clearTimeout(state.serverSaveTimer);
        state.serverSaveTimer = window.setTimeout(async () => {
            try {
                setSaveStatus('saving', 'Зберігаю налаштування на сервері...');
                const response = await fetch(apiUrl('/settings/timeline-visibility'), {
                    method: 'PUT',
                    headers: authHeaders(true),
                    body: JSON.stringify({
                        version: 2,
                        timelineId: settings.timelineId || currentTimelineId(),
                        blocks: settings.blocks || {},
                        overrides: settings.overrides || {}
                    })
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                mergeServerRegistry(data.registry);
                const normalized = normalizeSettings(data);
                state.serverSettings.set(visibilityScopeKey(), normalized);
                localStorage.setItem(storageKey(), JSON.stringify(normalized));
                setSaveStatus('saved', `Збережено ${new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}`);
            } catch (error) {
                console.warn('[TimelineVisibility] Failed to save server visual settings', error);
                setSaveStatus('error', 'Не вдалося зберегти на сервері. Локальна копія лишилась.');
            }
        }, 250);
    }

    function setSaveStatus(status, message) {
        state.saveStatus = status || 'idle';
        state.saveMessage = message || 'Зміни зберігаються автоматично для цього timeline.';
        renderSaveStatus();
    }

    function renderSaveStatus() {
        const status = document.getElementById('timelineConstructorSaveStatus');
        if (!status) return;
        status.dataset.status = state.saveStatus || 'idle';
        status.textContent = state.saveMessage || 'Зміни зберігаються автоматично для цього timeline.';
    }

    function blockById(id) {
        return TIMELINE_VISIBILITY_ELEMENTS.find(item => item.id === id) || TIMELINE_VISIBILITY_ELEMENTS[0] || null;
    }

    function blockSettings(id) {
        return loadSettings().blocks[id] || normalizeBlockSettings(blockById(id) || {}, {}, 0, {});
    }

    function isHidden(id) {
        return blockSettings(id).visible === false;
    }

    function updateBlockVariable(id, variable, value, options = {}) {
        const item = blockById(id);
        if (!item || !VISUAL_VARIABLES.includes(variable)) return;
        const settings = loadSettings();
        const block = { ...(settings.blocks[id] || blockSettings(id)) };
        if (variable === 'visible') block.visible = value !== false;
        if (variable === 'order') block.order = safeOrder(value, item.defaultOrder || 10);
        if (variable === 'density') block.density = DENSITY_VALUES.includes(String(value)) ? String(value) : 'default';
        if (variable === 'emphasis') block.emphasis = EMPHASIS_VALUES.includes(String(value)) ? String(value) : 'normal';
        if (variable === 'customLabel') block.customLabel = safeText(value, 80);
        if (variable === 'adminNote') block.adminNote = safeText(value, 280);
        settings.blocks[id] = block;
        settings.overrides[id] = block.visible === false;
        saveSettings(settings);
        applyVisibility();
        renderPanelList();
        if (options.renderEditor !== false) renderBlockEditor();
        renderBlockDetails();
    }

    function setHidden(id, hidden) {
        updateBlockVariable(id, 'visible', !hidden);
        notify(`${hidden ? 'Приховано' : 'Показано'}: ${labelForKey(id)}`);
    }

    async function confirmResetSettings() {
        const label = currentContext().productName || currentContext().navLabel || currentContextKey();
        if (typeof window.confirmModal !== 'function' && typeof confirmModal !== 'function') {
            notify('Підтвердження недоступне. Оновіть сторінку і повторіть reset.', 'error');
            return;
        }
        const confirmFn = window.confirmModal || confirmModal;
        const ok = await confirmFn(`Скинути налаштування таймлайну для "${label}" до стандарту?\nЦе прибере видимість, порядок, щільність, акценти, службові назви та нотатки тільки для цього timeline.`, {
            type: 'warning',
            okText: 'Скинути',
            cancelText: 'Не скидати'
        });
        if (!ok) return;
        resetSettings();
    }

    function resetSettings() {
        const payload = {
            version: 2,
            timelineId: currentTimelineId(),
            blocks: {},
            overrides: {},
            updatedAt: new Date().toISOString()
        };
        localStorage.removeItem(storageKey());
        state.serverSettings.set(visibilityScopeKey(), payload);
        scheduleServerSave(payload);
        applyVisibility();
        renderPanelList();
        renderBlockEditor();
        renderBlockDetails();
        notify('Налаштування таймлайну повернено до стандарту цього бізнесу');
    }

    function applyVisibilityPreset(presetKey) {
        const preset = VISIBILITY_PRESETS.find(item => item.key === presetKey) || VISIBILITY_PRESETS[0];
        const hidden = preset.hidden === null ? defaultHiddenKeys() : new Set(preset.hidden || []);
        const settings = loadSettings();
        TIMELINE_VISIBILITY_ELEMENTS.forEach(item => {
            settings.blocks[item.id] = {
                ...blockSettings(item.id),
                visible: !hidden.has(item.id),
                density: 'default',
                emphasis: 'normal'
            };
            settings.overrides[item.id] = hidden.has(item.id);
        });
        saveSettings(settings);
        applyVisibility();
        renderPanelList();
        renderBlockEditor();
        renderBlockDetails();
        notify(`Застосовано preset: ${preset.label}`);
    }

    function labelForKey(id) {
        const item = blockById(id);
        const settings = blockSettings(id);
        return settings.customLabel || item?.title || item?.label || id;
    }

    function orderedElements() {
        const settings = loadSettings();
        return TIMELINE_VISIBILITY_ELEMENTS
            .slice()
            .sort((a, b) => (settings.blocks[a.id]?.order || a.defaultOrder) - (settings.blocks[b.id]?.order || b.defaultOrder) || a.defaultOrder - b.defaultOrder);
    }

    function getElementTargets(item) {
        const nodes = Array.from(document.querySelectorAll(item.selector));
        return nodes.map(node => {
            if (!item.targetWrapper) return node;
            return node.closest('.form-section') || node.closest('.form-group') || node.closest('label') || node;
        }).filter(Boolean);
    }

    function markConfigurableElements() {
        TIMELINE_VISIBILITY_ELEMENTS.forEach(item => {
            getElementTargets(item).forEach(el => {
                if (el.dataset.timelineVisibilityKey && el.dataset.timelineVisibilityKey !== item.id) return;
                el.dataset.timelineVisibilityKey = item.id;
                el.dataset.timelineBlockId = item.id;
                el.dataset.timelineVisibilityLabel = labelForKey(item.id);
                el.classList.add('timeline-configurable-element');
            });
        });
    }

    function setNestedDisabled(el, disabled) {
        const controls = el.matches('button,input,select,textarea,a[href]')
            ? [el, ...Array.from(el.querySelectorAll('button,input,select,textarea,a[href]'))]
            : Array.from(el.querySelectorAll('button,input,select,textarea,a[href]'));

        controls.forEach(control => {
            if (control.classList.contains('timeline-visibility-chip')) return;
            if (control.id === 'timelineConstructorBtn') return;
            if (disabled) {
                if (!control.hasAttribute(DISABLED_ATTR)) {
                    control.setAttribute(DISABLED_ATTR, control.disabled ? '1' : '0');
                }
                if ('disabled' in control) control.disabled = true;
                if (control.tagName === 'A') control.setAttribute('aria-disabled', 'true');
            } else if (control.hasAttribute(DISABLED_ATTR)) {
                const wasDisabled = control.getAttribute(DISABLED_ATTR) === '1';
                if ('disabled' in control) control.disabled = wasDisabled;
                control.removeAttribute(DISABLED_ATTR);
                if (control.tagName === 'A') control.removeAttribute('aria-disabled');
            }
        });
    }

    function removeVisibilityChips() {
        document.querySelectorAll('.timeline-visibility-chip').forEach(chip => chip.remove());
    }

    function ensureVisibilityChip(el, item) {
        const isControlTarget = el.matches('button,input,select,textarea,a[href]');
        const host = isControlTarget ? el.parentElement : el;
        if (!host) return;
        let chip = Array.from(host.children).find(child =>
            child.classList?.contains('timeline-visibility-chip') && child.dataset.key === item.id
        );
        if (!chip) {
            chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'timeline-visibility-chip';
            chip.dataset.key = item.id;
            chip.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                selectBlock(item.id);
            });
            if (isControlTarget) {
                el.insertAdjacentElement('afterend', chip);
            } else {
                host.appendChild(chip);
            }
        }
        chip.classList.toggle('is-inline', isControlTarget);
        chip.textContent = 'Налаштувати';
        chip.setAttribute('aria-label', `Налаштувати ${labelForKey(item.id)}`);
    }

    function clearVisualClasses(el) {
        DENSITY_VALUES.forEach(value => el.classList.remove(`timeline-block-density-${value}`));
        EMPHASIS_VALUES.forEach(value => el.classList.remove(`timeline-block-emphasis-${value}`));
    }

    function applyVisualVariables(el, item, settings) {
        clearVisualClasses(el);
        el.classList.add(`timeline-block-density-${settings.density || 'default'}`);
        el.classList.add(`timeline-block-emphasis-${settings.emphasis || 'normal'}`);
        el.dataset.timelineBlockDensity = settings.density || 'default';
        el.dataset.timelineBlockEmphasis = settings.emphasis || 'normal';
        if (Number(settings.order) !== Number(item.defaultOrder)) {
            el.style.order = String(settings.order);
        } else {
            el.style.removeProperty('order');
        }
        if (settings.customLabel) {
            el.setAttribute('data-timeline-custom-label', settings.customLabel);
        } else {
            el.removeAttribute('data-timeline-custom-label');
        }
    }

    function applyVisibility() {
        markConfigurableElements();
        if (!state.constructorActive) removeVisibilityChips();

        TIMELINE_VISIBILITY_ELEMENTS.forEach(item => {
            const settings = blockSettings(item.id);
            const hidden = settings.visible === false;
            getElementTargets(item).forEach(el => {
                applyVisualVariables(el, item, settings);
                el.classList.toggle('timeline-hidden-by-config', hidden && !state.constructorActive);
                el.classList.toggle('timeline-constructor-disabled', hidden && state.constructorActive);
                el.classList.toggle('timeline-constructor-visible', !hidden && state.constructorActive);
                el.classList.toggle('timeline-constructor-selected', state.constructorActive && state.selectedBlockId === item.id);
                el.setAttribute('data-timeline-visibility-state', hidden ? 'hidden' : 'visible');
                el.setAttribute('data-timeline-block-id', item.id);
                setNestedDisabled(el, hidden);
                if (state.constructorActive) ensureVisibilityChip(el, item);
            });
        });

        document.body?.classList.toggle('timeline-constructor-active', state.constructorActive);
        document.body?.setAttribute('data-timeline-id', currentTimelineId());
        if (typeof window.refreshTimelineActionMenuVisibility === 'function') {
            window.refreshTimelineActionMenuVisibility();
        }
    }

    function removeBusinessSwitcher() {
        document.getElementById('timelineBusinessSwitch')?.remove();
    }

    function constructorButtonHost() {
        return document.querySelector('.timeline-header-actions')
            || document.querySelector('.action-buttons')
            || document.querySelector('.control-panel');
    }

    function placeConstructorButton(button) {
        const host = constructorButtonHost();
        if (!button || !host) return;
        const themeAction = host.querySelector('#headerThemeToggle');
        if (themeAction && themeAction !== button && themeAction.parentElement === host) {
            host.insertBefore(button, themeAction);
            return;
        }
        const logoutAction = host.querySelector('.timeline-header-logout');
        if (logoutAction && logoutAction !== button && logoutAction.parentElement === host) {
            host.insertBefore(button, logoutAction);
            return;
        }
        if (button.parentElement !== host) host.appendChild(button);
    }

    function createConstructorButton() {
        if (document.getElementById('timelineConstructorBtn')) {
            state.toggleBtn = document.getElementById('timelineConstructorBtn');
            state.toggleBtn.classList.add('timeline-header-settings-btn', 'toolbarIconButton', 'toolbarGhostButton');
            placeConstructorButton(state.toggleBtn);
            bindConstructorButton(state.toggleBtn);
            return;
        }
        const sharedHeaderButton = document.getElementById('headerSettingsBtn');
        if (sharedHeaderButton) {
            sharedHeaderButton.id = 'timelineConstructorBtn';
            sharedHeaderButton.classList.remove('header-settings-btn');
            sharedHeaderButton.classList.add('timeline-constructor-btn', 'timeline-header-settings-btn', 'toolbarIconButton', 'toolbarGhostButton');
            sharedHeaderButton.title = 'Налаштування таймлайну';
            sharedHeaderButton.setAttribute('aria-label', 'Налаштування таймлайну');
            sharedHeaderButton.setAttribute('aria-pressed', 'false');
            sharedHeaderButton.innerHTML = '<span class="timeline-constructor-btn-icon" aria-hidden="true">⚙</span><span class="timeline-constructor-btn-label">Налаштування</span>';
            placeConstructorButton(sharedHeaderButton);
            bindConstructorButton(sharedHeaderButton);
            state.toggleBtn = sharedHeaderButton;
            return;
        }
        const host = constructorButtonHost();
        if (!host) return;

        const button = document.createElement('button');
        button.type = 'button';
        button.id = 'timelineConstructorBtn';
        button.className = 'timeline-constructor-btn timeline-header-settings-btn toolbarIconButton toolbarGhostButton hidden';
        button.title = 'Налаштування';
        button.setAttribute('aria-label', 'Налаштування');
        button.setAttribute('aria-pressed', 'false');
        button.innerHTML = '<span class="timeline-constructor-btn-icon" aria-hidden="true">⚙</span><span class="timeline-constructor-btn-label">Налаштування</span>';
        bindConstructorButton(button);
        placeConstructorButton(button);
        state.toggleBtn = button;
    }

    function bindConstructorButton(button) {
        if (!button || button.dataset.timelineConstructorBound === '1') return;
        button.dataset.timelineConstructorBound = '1';
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            openSettingsCenter();
        });
    }

    function settingsCenterUrl() {
        const url = new URL('/timeline-settings', window.location.origin);
        const returnUrl = new URL(window.location.href);
        if (currentContextKey() === 'event_genix') returnUrl.searchParams.set('timelineView', currentTimelineViewKey());
        url.searchParams.set('context', currentContextKey());
        if (currentContextKey() === 'event_genix') url.searchParams.set('timelineView', currentTimelineViewKey());
        url.searchParams.set('return', `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`);
        if (state.selectedBlockId) url.searchParams.set('block', state.selectedBlockId);
        return `${url.pathname}${url.search}`;
    }

    function openSettingsCenter() {
        if (!canConfigure()) {
            notify('Налаштування таймлайну недоступні для вашої ролі', 'warning');
            return;
        }
        window.location.assign(settingsCenterUrl());
    }

    function createPanel() {
        if (document.getElementById('timelineConstructorPanel')) {
            state.panel = document.getElementById('timelineConstructorPanel');
            return;
        }

        const panel = document.createElement('section');
        panel.id = 'timelineConstructorPanel';
        panel.className = 'timeline-constructor-panel hidden';
        panel.setAttribute('aria-label', 'Налаштування таймлайну');
        panel.innerHTML = `
            <div class="timeline-constructor-panel-header">
                <div>
                    <strong>Налаштування таймлайну</strong>
                    <span id="timelineConstructorContext"></span>
                </div>
                <button type="button" id="timelineConstructorClose" class="timeline-constructor-close" aria-label="Закрити налаштування">✕</button>
            </div>
            <div class="timeline-constructor-panel-body">
                <div class="timeline-constructor-presets" aria-label="Preset-и вигляду таймлайну">
                    ${VISIBILITY_PRESETS.map(preset => `<button type="button" class="timeline-constructor-preset" data-visibility-preset="${preset.key}"><span>${escapeHtml(preset.label)}</span><small>${escapeHtml(preset.description)}</small></button>`).join('')}
                </div>
                <div class="timeline-visual-settings-grid">
                    <section class="timeline-visual-settings-zone timeline-visual-blocks-zone" aria-label="Блоки таймлайну">
                        <div class="timeline-visual-zone-head">
                            <strong>Блоки</strong>
                            <span>Зони та елементи цього таймлайну</span>
                        </div>
                        <div id="timelineConstructorList" class="timeline-constructor-list"></div>
                    </section>
                    <section class="timeline-visual-settings-zone" aria-label="Візуальні змінні">
                        <div class="timeline-visual-zone-head">
                            <strong>Візуал</strong>
                            <span>Параметри вибраного блоку</span>
                        </div>
                        <div id="timelineConstructorVisualEditor" class="timeline-visual-editor"></div>
                    </section>
                    <section class="timeline-visual-settings-zone" aria-label="Опис і вплив">
                        <div class="timeline-visual-zone-head">
                            <strong>Опис і вплив</strong>
                            <span>Що змінюється та як не нашкодити</span>
                        </div>
                        <div id="timelineConstructorDetails" class="timeline-visual-details"></div>
                    </section>
                </div>
            </div>
            <div class="timeline-constructor-panel-actions">
                <span id="timelineConstructorSaveStatus" class="timeline-constructor-save-status" data-status="idle">Зміни зберігаються автоматично для цього timeline.</span>
                <div class="timeline-constructor-action-buttons">
                    <button type="button" id="timelineConstructorReset" class="timeline-constructor-secondary">Скинути</button>
                    <button type="button" id="timelineConstructorDone" class="timeline-constructor-primary">Готово</button>
                </div>
            </div>
        `;
        document.body.appendChild(panel);
        panel.querySelector('#timelineConstructorClose')?.addEventListener('click', () => toggleConstructorMode(false));
        panel.querySelector('#timelineConstructorDone')?.addEventListener('click', () => toggleConstructorMode(false));
        panel.querySelector('#timelineConstructorReset')?.addEventListener('click', confirmResetSettings);
        panel.querySelectorAll('[data-visibility-preset]').forEach(button => {
            button.addEventListener('click', event => applyVisibilityPreset(event.currentTarget.dataset.visibilityPreset));
        });
        panel.addEventListener('click', handlePanelClick);
        panel.addEventListener('change', handlePanelChange);
        panel.addEventListener('input', handlePanelInput);
        state.panel = panel;
        renderSaveStatus();
    }

    function groupedElements() {
        return orderedElements().reduce((groups, item) => {
            const area = item.area || 'Інше';
            if (!groups[area]) groups[area] = [];
            groups[area].push(item);
            return groups;
        }, {});
    }

    function renderPanelList() {
        const list = document.getElementById('timelineConstructorList');
        const contextLabel = document.getElementById('timelineConstructorContext');
        if (contextLabel) {
            const label = currentContext().productName || currentContext().navLabel || currentContextKey();
            contextLabel.textContent = `${label} · ${currentTimelineId()}`;
        }
        if (!list) return;

        const groups = groupedElements();
        list.innerHTML = Object.entries(groups).map(([area, items]) => `
            <div class="timeline-constructor-group">
                <div class="timeline-constructor-group-title">${escapeHtml(area)}</div>
                ${items.map(item => {
                    const settings = blockSettings(item.id);
                    const active = state.selectedBlockId === item.id;
                    return `
                        <div class="timeline-constructor-row${active ? ' is-selected' : ''}" data-block-row="${escapeHtml(item.id)}">
                            <button type="button" class="timeline-constructor-row-main" data-select-block="${escapeHtml(item.id)}">
                                <span>${escapeHtml(labelForKey(item.id))}</span>
                                <small>${escapeHtml(item.id)}</small>
                            </button>
                            <input type="checkbox" data-block-visible="${escapeHtml(item.id)}" ${settings.visible === false ? '' : 'checked'} aria-label="${escapeHtml(labelForKey(item.id))}">
                        </div>
                    `;
                }).join('')}
            </div>
        `).join('');
    }

    function renderBlockEditor() {
        const host = document.getElementById('timelineConstructorVisualEditor');
        const item = blockById(state.selectedBlockId);
        if (!host || !item) return;
        const settings = blockSettings(item.id);
        host.innerHTML = `
            <label class="timeline-visual-field timeline-visual-field--switch">
                <span>Показувати блок</span>
                <input type="checkbox" data-editor-visible="${escapeHtml(item.id)}" ${settings.visible === false ? '' : 'checked'}>
                <small>Ховає тільки visual block. Ролі, API і дані бронювань не змінюються.</small>
            </label>
            <label class="timeline-visual-field">
                <span>Порядок</span>
                <input type="number" min="-999" max="999" step="1" value="${escapeHtml(settings.order)}" data-editor-order="${escapeHtml(item.id)}">
                <small>Менше число ставить блок вище або лівіше в межах його зони.</small>
            </label>
            <label class="timeline-visual-field">
                <span>Щільність</span>
                <select data-editor-density="${escapeHtml(item.id)}">
                    <option value="default"${settings.density === 'default' ? ' selected' : ''}>Стандарт</option>
                    <option value="compact"${settings.density === 'compact' ? ' selected' : ''}>Компактно</option>
                    <option value="comfortable"${settings.density === 'comfortable' ? ' selected' : ''}>Вільніше</option>
                </select>
                <small>Компактно стискає відступи; вільніше додає повітря для важливих зон.</small>
            </label>
            <label class="timeline-visual-field">
                <span>Акцент</span>
                <select data-editor-emphasis="${escapeHtml(item.id)}">
                    <option value="normal"${settings.emphasis === 'normal' ? ' selected' : ''}>Звичайний</option>
                    <option value="muted"${settings.emphasis === 'muted' ? ' selected' : ''}>Тихий</option>
                    <option value="accent"${settings.emphasis === 'accent' ? ' selected' : ''}>Акцент</option>
                </select>
                <small>Тихий зменшує візуальну вагу; акцент підсвічує блок для адміністратора.</small>
            </label>
            <label class="timeline-visual-field">
                <span>Назва в налаштуваннях</span>
                <input type="text" maxlength="80" value="${escapeHtml(settings.customLabel)}" placeholder="${escapeHtml(item.title)}" data-editor-label="${escapeHtml(item.id)}">
                <small>Службова назва тільки для цієї панелі. Бойовий текст кнопок не перейменовується.</small>
            </label>
            <label class="timeline-visual-field">
                <span>Внутрішня нотатка</span>
                <textarea maxlength="280" rows="4" placeholder="Наприклад: не ховати у вихідні" data-editor-note="${escapeHtml(item.id)}">${escapeHtml(settings.adminNote)}</textarea>
                <small>Видима тільки в налаштуваннях. Використовуйте для правил і причин зміни.</small>
            </label>
        `;
    }

    function renderBlockDetails() {
        const host = document.getElementById('timelineConstructorDetails');
        const item = blockById(state.selectedBlockId);
        if (!host || !item) return;
        const settings = blockSettings(item.id);
        host.innerHTML = `
            <div class="timeline-visual-detail-card">
                <span class="timeline-visual-id">${escapeHtml(item.id)}</span>
                <h4>${escapeHtml(labelForKey(item.id))}</h4>
                <p>${escapeHtml(item.description)}</p>
            </div>
            <div class="timeline-visual-detail-card">
                <strong>Як правильно змінювати</strong>
                <p>${escapeHtml(item.howToUse)}</p>
            </div>
            <div class="timeline-visual-detail-card">
                <strong>На що впливає</strong>
                <p>${escapeHtml(item.impact)}</p>
            </div>
            <div class="timeline-visual-detail-card">
                <strong>Змінні v1</strong>
                <p>${escapeHtml((item.variables || VISUAL_VARIABLES).join(', '))}</p>
                <small>Поточний стан: ${settings.visible === false ? 'приховано' : 'видимо'}, ${escapeHtml(DENSITY_LABELS[settings.density] || settings.density)}, ${escapeHtml(EMPHASIS_LABELS[settings.emphasis] || settings.emphasis)}</small>
            </div>
            <div class="timeline-visual-detail-card">
                <strong>Службова назва</strong>
                <p>${settings.customLabel ? escapeHtml(settings.customLabel) : 'Не задано. У списку використовується стандартна назва блоку.'}</p>
            </div>
            <div class="timeline-visual-detail-card">
                <strong>Внутрішня нотатка</strong>
                <p>${settings.adminNote ? escapeHtml(settings.adminNote) : 'Нотатки немає. Додайте коротке пояснення, якщо зміна може вплинути на роботу операторів.'}</p>
            </div>
        `;
    }

    function handlePanelClick(event) {
        const selectButton = event.target.closest('[data-select-block]');
        if (selectButton) {
            event.preventDefault();
            selectBlock(selectButton.dataset.selectBlock);
        }
    }

    function handlePanelChange(event) {
        const target = event.target;
        if (target.matches('[data-block-visible]')) {
            updateBlockVariable(target.dataset.blockVisible, 'visible', target.checked);
        }
        if (target.matches('[data-editor-visible]')) {
            updateBlockVariable(target.dataset.editorVisible, 'visible', target.checked);
        }
        if (target.matches('[data-editor-order]')) {
            updateBlockVariable(target.dataset.editorOrder, 'order', target.value);
        }
        if (target.matches('[data-editor-density]')) {
            updateBlockVariable(target.dataset.editorDensity, 'density', target.value);
        }
        if (target.matches('[data-editor-emphasis]')) {
            updateBlockVariable(target.dataset.editorEmphasis, 'emphasis', target.value);
        }
    }

    function handlePanelInput(event) {
        const target = event.target;
        if (target.matches('[data-editor-label]')) {
            updateBlockVariable(target.dataset.editorLabel, 'customLabel', target.value, { renderEditor: false });
        }
        if (target.matches('[data-editor-note]')) {
            updateBlockVariable(target.dataset.editorNote, 'adminNote', target.value, { renderEditor: false });
        }
    }

    function selectBlock(id) {
        if (!blockById(id)) return;
        state.selectedBlockId = id;
        renderPanelList();
        renderBlockEditor();
        renderBlockDetails();
        applyVisibility();
    }

    function toggleConstructorMode(active) {
        if (active && !canConfigure()) return;
        state.constructorActive = Boolean(active);
        document.body?.classList.toggle('timeline-constructor-active', state.constructorActive);
        state.toggleBtn?.classList.toggle('is-active', state.constructorActive);
        state.toggleBtn?.setAttribute('aria-pressed', String(state.constructorActive));
        if (state.toggleBtn) {
            state.toggleBtn.title = state.constructorActive ? 'Завершити налаштування' : 'Налаштування';
            state.toggleBtn.setAttribute('aria-label', state.toggleBtn.title);
            state.toggleBtn.innerHTML = state.constructorActive
                ? '<span class="timeline-constructor-btn-icon" aria-hidden="true">✓</span><span class="timeline-constructor-btn-label">Готово</span>'
                : '<span class="timeline-constructor-btn-icon" aria-hidden="true">⚙</span><span class="timeline-constructor-btn-label">Налаштування</span>';
        }
        state.panel?.classList.toggle('hidden', !state.constructorActive);
        renderPanelList();
        renderBlockEditor();
        renderBlockDetails();
        applyVisibility();
    }

    function refreshAccess() {
        removeBusinessSwitcher();
        const authenticated = hasAuthenticatedTimelineUser();
        const allowed = authenticated && canConfigure();
        if (state.toggleBtn) {
            state.toggleBtn.classList.toggle('hidden', !allowed);
            state.toggleBtn.dataset.timelineSettingsAllowed = allowed ? 'true' : 'false';
        }
        if (!allowed && state.constructorActive) toggleConstructorMode(false);
        if (!authenticated) {
            state.serverSettings = new Map();
            state.serverLoadPromise = null;
            state.serverLoadKey = null;
            return;
        }
        loadServerSettings().then(data => {
            if (!data) return;
            applyVisibility();
            renderPanelList();
            renderBlockEditor();
            renderBlockDetails();
        });
    }

    function notify(message, type) {
        if (typeof window.showNotification === 'function') {
            window.showNotification(message, type);
        }
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function init() {
        if (state.initialized) return;
        state.initialized = true;
        removeBusinessSwitcher();
        createConstructorButton();
        createPanel();
        markConfigurableElements();
        applyVisibility();
        refreshAccess();
        window.addEventListener('app:user-changed', refreshAccess);
        window.addEventListener('crm:authenticated-runtime-ready', refreshAccess);
        window.addEventListener('timeline:visibility-refresh', applyVisibility);
        window.addEventListener('timeline:view-changed', () => {
            loadServerSettings().then(() => {
                applyVisibility();
                renderPanelList();
                renderBlockEditor();
                renderBlockDetails();
            });
        });
        state.accessTimer = window.setInterval(() => {
            if (!hasAuthenticatedTimelineUser()) return;
            refreshAccess();
            window.clearInterval(state.accessTimer);
            state.accessTimer = null;
        }, 500);
    }

    window.TimelineVisibility = {
        init,
        applyVisibility,
        refreshAccess,
        toggleConstructorMode,
        setHidden,
        resetSettings,
        applyVisibilityPreset,
        openSettingsCenter,
        isHidden,
        registry: TIMELINE_VISIBILITY_ELEMENTS
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
