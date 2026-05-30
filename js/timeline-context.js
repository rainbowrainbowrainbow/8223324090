/**
 * Timeline business context.
 *
 * The root timeline keeps the legacy Event Genix context. /maysternya-doli
 * reuses the same timeline UI with isolated API/storage namespaces and a
 * smaller role-aware action surface.
 */
(function () {
    const CONTEXTS = {
        event_genix: {
            key: 'event_genix',
            path: '/',
            pageAccessPath: '/',
            title: 'Таймлайн ПАРК | Бронювання',
            navLabel: 'Таймлайн',
            switchLabel: 'Таймлайн ПАРК',
            productName: 'Таймлайн ПАРК',
            brandName: 'Парк Закревського Періоду',
            subtitle: 'AI First CRM',
            storagePrefix: 'pzp',
            apiValue: 'event_genix',
            isPrivateSurface: false,
            showAfisha: true,
            defaultHiddenElements: [],
            actionRoles: {
                create: ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'accountant', 'art_director', 'marketer', 'it_specialist', 'hr', 'admin', 'reception'],
                edit: ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'accountant', 'art_director', 'marketer', 'it_specialist', 'hr', 'admin', 'reception'],
                delete: ['creator', 'director'],
                export: ['creator', 'director', 'vice_director', 'senior_manager', 'manager'],
                sales: ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'accountant'],
                settings: ['creator', 'director']
            }
        },
        maysternya_doli: {
            key: 'maysternya_doli',
            path: '/maysternya-doli',
            pageAccessPath: '/maysternya-doli',
            title: 'Таймлайн МД | Записи',
            navLabel: 'Таймлайн МД',
            switchLabel: 'Таймлайн МД',
            productName: 'Таймлайн МД',
            brandName: 'Майстерня долі',
            subtitle: 'Записи психолога',
            storagePrefix: 'md',
            apiValue: 'maysternya_doli',
            isPrivateSurface: true,
            showAfisha: false,
            defaultHiddenElements: ['productSales', 'costume', 'extraHost', 'secondAnimator', 'hostsWarning', 'pinata', 'kidsCount', 'tshirtSizes', 'skipNotification'],
            actionRoles: {
                create: ['creator'],
                edit: ['creator'],
                delete: ['creator'],
                export: ['creator'],
                sales: [],
                settings: ['creator']
            }
        }
    };

    const DISPLAY_STORAGE_NAME = 'timeline_display_settings';
    const DISPLAY_MODES = {
        disabled: {
            key: 'disabled',
            label: 'Без таймлайну',
            shortLabel: 'Вимкнено',
            bodyClass: 'timeline-mode-disabled',
            resourceType: null,
            showAfisha: false,
            showProductSales: false,
            roomLoadLabel: 'Ресурси',
            roomLoadTitle: 'Таймлайн вимкнено для цього бізнесу',
            addLineLabel: 'Ресурс',
            addLineTitle: 'Таймлайн вимкнено для цього бізнесу',
            selectedLineLabel: 'Ресурс:',
            lineTypeLabel: 'ресурс',
            bookingTitle: 'Запис',
            submitLabel: 'Зберегти',
            programLabel: 'Послуга',
            programSearchPlaceholder: 'Пошук послуги...',
            roomLabel: 'Ресурс',
            roomOptionLabel: 'Ресурс',
            groupLabel: 'Група / тема',
            notesLabel: 'Коментар',
            customerNameLabel: 'Імʼя клієнта',
            phoneLabel: 'Телефон',
            emptyLineName: 'Ресурс',
            legendHtml: '<span class="legend-item"><span class="dot custom"></span>Таймлайн вимкнено</span>',
            defaultHiddenElements: ['productSales', 'costume', 'extraHost', 'secondAnimator', 'hostsWarning', 'pinata', 'kidsCount', 'tshirtSizes', 'skipNotification', 'bookingPackageSummary']
        },
        simple: {
            key: 'simple',
            label: 'Простий режим',
            shortLabel: 'Простий',
            bodyClass: 'timeline-mode-simple',
            resourceType: 'specialist',
            showAfisha: false,
            showProductSales: false,
            roomLoadLabel: 'Кабінети',
            roomLoadTitle: 'Навантаження кабінетів',
            addLineLabel: 'Додати спеціаліста',
            addLineTitle: 'Додати лінію спеціаліста',
            selectedLineLabel: 'Спеціаліст:',
            lineTypeLabel: 'спеціаліст',
            bookingTitle: 'Новий запис',
            submitLabel: 'Записати',
            programLabel: 'Послуга',
            programSearchPlaceholder: 'Пошук послуги...',
            roomLabel: 'Кабінет / канал',
            roomOptionLabel: 'Кабінет',
            groupLabel: 'Тема запиту (опційно)',
            notesLabel: 'Коментар (опційно)',
            customerNameLabel: 'Імʼя клієнта',
            phoneLabel: 'Телефон / WhatsApp',
            emptyLineName: 'Спеціаліст',
            legendHtml: `
                <span class="legend-item"><span class="dot custom"></span>Записи</span>
                <span class="legend-item"><span class="dot preliminary-dot"></span>Попередній запис</span>
            `,
            defaultHiddenElements: ['productSales', 'costume', 'extraHost', 'secondAnimator', 'hostsWarning', 'pinata', 'kidsCount', 'tshirtSizes', 'skipNotification']
        },
        specialist: {
            key: 'specialist',
            label: 'Спеціаліст',
            shortLabel: 'Спеціаліст',
            bodyClass: 'timeline-mode-specialist',
            resourceType: 'specialist',
            showAfisha: false,
            showProductSales: false,
            roomLoadLabel: 'Кабінети',
            roomLoadTitle: 'Навантаження кабінетів',
            addLineLabel: 'Додати спеціаліста',
            addLineTitle: 'Додати лінію спеціаліста',
            selectedLineLabel: 'Спеціаліст:',
            lineTypeLabel: 'спеціаліст',
            bookingTitle: 'Новий запис',
            submitLabel: 'Записати',
            programLabel: 'Послуга',
            programSearchPlaceholder: 'Пошук послуги...',
            roomLabel: 'Кабінет / канал',
            roomOptionLabel: 'Кабінет',
            groupLabel: 'Тема / послуга',
            notesLabel: 'Коментар',
            customerNameLabel: 'Імʼя клієнта',
            phoneLabel: 'Телефон',
            emptyLineName: 'Спеціаліст',
            legendHtml: `
                <span class="legend-item"><span class="dot custom"></span>Послуги</span>
                <span class="legend-item"><span class="dot preliminary-dot"></span>Попередній запис</span>
            `,
            defaultHiddenElements: ['productSales', 'costume', 'extraHost', 'secondAnimator', 'hostsWarning', 'pinata', 'kidsCount', 'tshirtSizes']
        },
        park: {
            key: 'park',
            label: 'Дитячий розважальний парк',
            shortLabel: 'Парк',
            bodyClass: 'timeline-mode-park',
            resourceType: 'animator',
            showAfisha: true,
            showProductSales: true,
            roomLoadLabel: 'Кімнати',
            roomLoadTitle: 'Навантаження кімнат',
            addLineLabel: 'Додати аніматора',
            addLineTitle: 'Надіслати запит на додавання аніматора через Telegram',
            selectedLineLabel: 'Лінія:',
            lineTypeLabel: 'аніматор',
            bookingTitle: 'Нове бронювання',
            submitLabel: 'Додати бронювання',
            programLabel: 'Програма',
            programSearchPlaceholder: 'Пошук програми...',
            roomLabel: 'Кімната',
            roomOptionLabel: 'Кімната',
            groupLabel: 'Група / банкет',
            notesLabel: 'Примітки',
            customerNameLabel: 'Імʼя клієнта',
            phoneLabel: 'Телефон',
            emptyLineName: 'Аніматор',
            legendHtml: `
                <span class="legend-item"><span class="dot quest"></span>Квести</span>
                <span class="legend-item"><span class="dot animation"></span>Анімація</span>
                <span class="legend-item"><span class="dot show"></span>Шоу</span>
                <span class="legend-item"><span class="dot photo"></span>Фото</span>
                <span class="legend-item"><span class="dot masterclass"></span>МК</span>
                <span class="legend-item"><span class="dot pinata"></span>Піньята</span>
                <span class="legend-item"><span class="dot custom"></span>Інше</span>
                <span class="legend-item"><span class="dot preliminary-dot"></span>Попереднє</span>
            `,
            defaultHiddenElements: []
        },
        education: {
            key: 'education',
            label: 'Навчальний заклад',
            shortLabel: 'Навчання',
            bodyClass: 'timeline-mode-education',
            resourceType: 'cabinet',
            showAfisha: false,
            showProductSales: false,
            roomLoadLabel: 'Кабінети',
            roomLoadTitle: 'Зайнятість кабінетів',
            addLineLabel: 'Додати кабінет',
            addLineTitle: 'Додати кабінет / аудиторію',
            selectedLineLabel: 'Кабінет:',
            lineTypeLabel: 'кабінет',
            bookingTitle: 'Нове заняття',
            submitLabel: 'Запланувати заняття',
            programLabel: 'Заняття',
            programSearchPlaceholder: 'Пошук заняття...',
            roomLabel: 'Кабінет',
            roomOptionLabel: 'Кабінет',
            groupLabel: 'Група / клас',
            notesLabel: 'Тема заняття / примітки',
            customerNameLabel: 'Контакт / відповідальний',
            phoneLabel: 'Телефон контакту',
            emptyLineName: 'Кабінет',
            legendHtml: `
                <span class="legend-item"><span class="dot custom"></span>Заняття</span>
                <span class="legend-item"><span class="dot masterclass"></span>Практика</span>
                <span class="legend-item"><span class="dot preliminary-dot"></span>Попереднє</span>
            `,
            defaultHiddenElements: ['productSales', 'costume', 'extraHost', 'secondAnimator', 'hostsWarning', 'pinata', 'kidsCount', 'tshirtSizes', 'skipNotification']
        }
    };
    const VALID_DISPLAY_MODES = new Set(Object.keys(DISPLAY_MODES));
    const VALID_PARK_KITCHEN_MODES = new Set(['with_kitchen', 'without_kitchen']);
    const VALID_START_PAGES = new Set(['timeline', 'dashboard', 'leads', 'customers', 'omni', 'tasks']);
    const VALID_RESOURCE_MODELS = new Set(['auto', 'none', 'animator', 'specialist', 'cabinet', 'room', 'online']);
    const RESOURCE_TYPES = new Set(['animator', 'specialist', 'cabinet', 'room', 'online']);
    const MODULE_KEYS = ['timeline', 'bookings', 'leads', 'customers', 'omni', 'tasks', 'products', 'afisha', 'kitchen', 'resources', 'teachers', 'lessonSeries'];
    const FEATURE_KEYS = ['quickCloseSlot', 'freeResources', 'series', 'afisha', 'kitchen', 'compactBlocks', 'seriesBadge', 'teacherConflict', 'resourceCapacity'];
    const POLICY_KEYS = ['allowLessonsWithoutTeacher', 'allowLessonsWithoutGroup', 'enforceTeacherConflict', 'enforceResourceCapacity', 'notifyFirstOccurrenceOnly'];

    function normalizedPath() {
        return (window.location.pathname || '/').replace(/\.html$/, '').replace(/\/$/, '') || '/';
    }

    function currentContext() {
        const path = normalizedPath();
        if (path === CONTEXTS.maysternya_doli.path) return CONTEXTS.maysternya_doli;
        return CONTEXTS.event_genix;
    }

    function userRoles(user) {
        const roles = [];
        if (user && user.role) roles.push(user.role);
        if (Array.isArray(user?.roles)) roles.push(...user.roles);
        if (Array.isArray(user?.extraRoles)) roles.push(...user.extraRoles);
        if (Array.isArray(user?.extra_roles)) roles.push(...user.extra_roles);
        return Array.from(new Set(roles.filter(Boolean).map(String)));
    }

    function userPageAllowlist(user) {
        const values = [];
        if (Array.isArray(user?.pageAllowlist)) values.push(...user.pageAllowlist);
        if (Array.isArray(user?.page_allowlist)) values.push(...user.page_allowlist);
        return Array.from(new Set(values.filter(Boolean).map(String)));
    }

    function hasAnyRole(user, allowedRoles) {
        if (!Array.isArray(allowedRoles) || allowedRoles.length === 0) return false;
        const roles = userRoles(user);
        return roles.includes('creator') || roles.some(role => allowedRoles.includes(role));
    }

    function canAccessContext(user, ctx = currentContext()) {
        if (!ctx?.isPrivateSurface) return Boolean(user);
        if (!user) return false;
        return userRoles(user).includes('creator');
    }

    function canUseAction(action, user, ctx = currentContext()) {
        if (!canAccessContext(user, ctx)) return false;
        return hasAnyRole(user, ctx.actionRoles?.[action] || []);
    }

    function storageKey(name) {
        const ctx = currentContext();
        return `${ctx.storagePrefix}_${name}`;
    }

    function displayStorageKey(ctx = currentContext()) {
        return `${ctx.storagePrefix}_${DISPLAY_STORAGE_NAME}`;
    }

    function defaultDisplayMode(ctx = currentContext()) {
        return ctx.key === 'maysternya_doli' ? 'simple' : 'park';
    }

    function safeJson(raw) {
        try {
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    function defaultResourceModelForMode(mode) {
        if (mode === 'disabled') return 'none';
        if (mode === 'education') return 'cabinet';
        if (mode === 'simple' || mode === 'specialist') return 'specialist';
        return 'auto';
    }

    function defaultModulesForMode(mode, parkKitchenMode = 'with_kitchen') {
        const base = Object.fromEntries(MODULE_KEYS.map(key => [key, false]));
        if (mode === 'disabled') {
            return { ...base, leads: true, customers: true, omni: true, tasks: true };
        }
        const common = {
            ...base,
            timeline: true,
            bookings: true,
            leads: true,
            customers: true,
            omni: true,
            tasks: true,
            resources: mode !== 'park'
        };
        if (mode === 'park') {
            return {
                ...common,
                products: true,
                afisha: true,
                kitchen: parkKitchenMode !== 'without_kitchen',
                resources: false
            };
        }
        if (mode === 'education') {
            return {
                ...common,
                teachers: true,
                lessonSeries: true
            };
        }
        return common;
    }

    function defaultFeaturesForMode(mode, parkKitchenMode = 'with_kitchen') {
        const base = Object.fromEntries(FEATURE_KEYS.map(key => [key, false]));
        if (mode === 'disabled') return base;
        const common = {
            ...base,
            quickCloseSlot: true,
            freeResources: mode !== 'park',
            compactBlocks: mode !== 'park'
        };
        if (mode === 'park') {
            return { ...common, afisha: true, kitchen: parkKitchenMode !== 'without_kitchen' };
        }
        if (mode === 'education') {
            return {
                ...common,
                series: true,
                seriesBadge: true,
                teacherConflict: true,
                resourceCapacity: true
            };
        }
        return common;
    }

    function defaultBookingPolicyForMode(mode) {
        return {
            allowLessonsWithoutTeacher: mode === 'education',
            allowLessonsWithoutGroup: true,
            enforceTeacherConflict: mode === 'education',
            enforceResourceCapacity: mode === 'education',
            notifyFirstOccurrenceOnly: mode === 'education'
        };
    }

    function normalizeToggleRecord(value, defaults, keys) {
        const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        const normalized = { ...defaults };
        keys.forEach(key => {
            if (Object.prototype.hasOwnProperty.call(source, key)) {
                normalized[key] = Boolean(source[key]);
            }
        });
        return normalized;
    }

    function normalizeDisplaySettings(value, ctx = currentContext()) {
        const fallbackMode = defaultDisplayMode(ctx);
        const rawMode = String(value?.mode || '');
        const mode = value?.timelineEnabled === false || rawMode === 'disabled'
            ? 'disabled'
            : VALID_DISPLAY_MODES.has(rawMode)
            ? String(value.mode)
            : fallbackMode;
        const parkKitchenMode = VALID_PARK_KITCHEN_MODES.has(String(value?.parkKitchenMode || ''))
            ? String(value.parkKitchenMode)
            : 'with_kitchen';
        const startPage = VALID_START_PAGES.has(String(value?.startPage || ''))
            ? String(value.startPage)
            : (mode === 'disabled' ? 'dashboard' : 'timeline');
        let resourceModel = VALID_RESOURCE_MODELS.has(String(value?.resourceModel || ''))
            ? String(value.resourceModel)
            : defaultResourceModelForMode(mode);
        if (mode === 'park') resourceModel = 'auto';
        const enabledModules = normalizeToggleRecord(value?.enabledModules, defaultModulesForMode(mode, parkKitchenMode), MODULE_KEYS);
        const timelineFeatures = normalizeToggleRecord(value?.timelineFeatures, defaultFeaturesForMode(mode, parkKitchenMode), FEATURE_KEYS);
        const bookingPolicy = normalizeToggleRecord(value?.bookingPolicy, defaultBookingPolicyForMode(mode), POLICY_KEYS);
        if (mode === 'park' && parkKitchenMode === 'without_kitchen') {
            enabledModules.kitchen = false;
            timelineFeatures.kitchen = false;
        }
        if (mode === 'disabled') {
            enabledModules.timeline = false;
            enabledModules.bookings = false;
        }
        return {
            version: 2,
            timelineEnabled: mode !== 'disabled',
            mode,
            parkKitchenMode,
            startPage,
            resourceModel,
            enabledModules,
            timelineFeatures,
            bookingPolicy,
            updatedAt: value?.updatedAt || null,
            updatedBy: value?.updatedBy || null
        };
    }

    function readDisplaySettings(ctx = currentContext()) {
        const parsed = safeJson(localStorage.getItem(displayStorageKey(ctx)));
        return normalizeDisplaySettings(parsed, ctx);
    }

    function saveDisplaySettings(next, options = {}) {
        const ctx = options.context || currentContext();
        const normalized = normalizeDisplaySettings({
            ...readDisplaySettings(ctx),
            ...(next || {}),
            updatedAt: new Date().toISOString()
        }, ctx);
        localStorage.setItem(displayStorageKey(ctx), JSON.stringify(normalized));
        window.dispatchEvent(new CustomEvent('timeline:display-settings-changed', {
            detail: { context: ctx.key, settings: normalized }
        }));
        return normalized;
    }

    function presentation(ctx = currentContext()) {
        const settings = readDisplaySettings(ctx);
        const mode = DISPLAY_MODES[settings.mode] || DISPLAY_MODES[defaultDisplayMode(ctx)];
        const enabledModules = settings.enabledModules || defaultModulesForMode(mode.key, settings.parkKitchenMode);
        const timelineFeatures = settings.timelineFeatures || defaultFeaturesForMode(mode.key, settings.parkKitchenMode);
        const kitchenEnabled = mode.key === 'park'
            && settings.parkKitchenMode !== 'without_kitchen'
            && enabledModules.kitchen !== false
            && timelineFeatures.kitchen !== false;
        const hidden = new Set([
            ...(Array.isArray(ctx.defaultHiddenElements) ? ctx.defaultHiddenElements : []),
            ...(Array.isArray(mode.defaultHiddenElements) ? mode.defaultHiddenElements : [])
        ]);
        if (mode.key !== 'park' || !kitchenEnabled) {
            hidden.add('bookingPackageSummary');
        }
        if (mode.key === 'disabled' || enabledModules.bookings === false) {
            hidden.add('bookingPanel');
            hidden.add('bookingPackageSummary');
        }
        return {
            ...mode,
            mode: mode.key,
            context: ctx.key,
            settings,
            parkKitchenEnabled: mode.key === 'park' && kitchenEnabled,
            timelineEnabled: settings.timelineEnabled !== false && mode.key !== 'disabled',
            startPage: settings.startPage || 'timeline',
            resourceModel: settings.resourceModel || defaultResourceModelForMode(mode.key),
            enabledModules,
            timelineFeatures,
            bookingPolicy: settings.bookingPolicy || defaultBookingPolicyForMode(mode.key),
            showAfisha: mode.showAfisha === true && ctx.showAfisha !== false && enabledModules.afisha !== false && timelineFeatures.afisha !== false,
            showProductSales: mode.showProductSales === true && enabledModules.products !== false,
            defaultHiddenElements: Array.from(hidden)
        };
    }

    function resourceTypeForMode(mode, settings = null) {
        const displayMode = DISPLAY_MODES[String(mode || '')] || DISPLAY_MODES[defaultDisplayMode(currentContext())];
        if (displayMode?.key === 'park') return null;
        const resourceModel = VALID_RESOURCE_MODELS.has(String(settings?.resourceModel || ''))
            ? String(settings.resourceModel)
            : defaultResourceModelForMode(displayMode.key);
        if (resourceModel === 'none') return null;
        if (RESOURCE_TYPES.has(resourceModel)) return resourceModel;
        return displayMode?.key === 'park' ? null : (displayMode?.resourceType || null);
    }

    function appendApiContext(url) {
        const ctx = currentContext();
        if (ctx.key === 'event_genix') return url;
        const joiner = url.includes('?') ? '&' : '?';
        return `${url}${joiner}businessContext=${encodeURIComponent(ctx.apiValue)}`;
    }

    function withApiContext(payload) {
        const ctx = currentContext();
        if (ctx.key === 'event_genix') return payload;
        return { ...(payload || {}), businessContext: ctx.apiValue };
    }

    function setControlText(el, text) {
        if (!el) return;
        const label = Array.from(el.children || []).find(child => child.tagName === 'SPAN' && !child.classList.contains('timeline-control-icon'))
            || el.querySelector('span:last-child');
        if (label) label.textContent = text;
        else el.textContent = text;
    }

    function setFieldLabel(selector, text, html = false) {
        const label = document.querySelector(selector)?.closest('.form-section')?.querySelector('label');
        if (!label) return;
        if (html) label.innerHTML = text;
        else label.textContent = text;
    }

    function applyLabels() {
        const ctx = currentContext();
        const view = presentation(ctx);
        document.title = ctx.title;
        if (document.body) {
            document.body.classList.toggle('timeline-context-maysternya', ctx.key === 'maysternya_doli');
            Object.values(DISPLAY_MODES).forEach(mode => {
                document.body.classList.toggle(mode.bodyClass, mode.key === view.mode);
            });
            document.body.classList.toggle('timeline-park-with-kitchen', view.parkKitchenEnabled);
            document.body.classList.toggle('timeline-park-without-kitchen', view.mode === 'park' && !view.parkKitchenEnabled);
            document.body.classList.toggle('timeline-disabled', view.timelineEnabled === false);
            document.body.setAttribute('data-timeline-context', ctx.key);
            document.body.setAttribute('data-timeline-display-mode', view.mode);
            document.body.setAttribute('data-timeline-park-kitchen', view.parkKitchenEnabled ? 'with_kitchen' : 'without_kitchen');
            document.body.setAttribute('data-timeline-start-page', view.startPage || 'timeline');
            document.body.setAttribute('data-timeline-resource-model', view.resourceModel || 'auto');
        }

        const titleEl = document.querySelector('.em-logo-title');
        if (titleEl) titleEl.textContent = ctx.productName;
        const subEl = document.querySelector('.em-logo-sub');
        if (subEl) subEl.textContent = ctx.subtitle;

        const salesBtn = document.getElementById('productSalesBtn');
        if (salesBtn) salesBtn.classList.toggle('hidden', !view.showProductSales);
        const roomBtn = document.getElementById('roomLoadBtn');
        setControlText(roomBtn, view.roomLoadLabel);
        if (roomBtn) {
            roomBtn.title = view.roomLoadTitle;
            roomBtn.classList.toggle('hidden', view.timelineEnabled === false || view.enabledModules?.resources === false);
        }
        const addLineBtn = document.getElementById('addLineBtn');
        if (addLineBtn) {
            const addLabel = addLineBtn.querySelector('span:last-child');
            if (addLabel) addLabel.textContent = view.addLineLabel;
            else addLineBtn.textContent = view.addLineLabel;
            addLineBtn.title = view.addLineTitle;
            addLineBtn.classList.toggle('hidden', view.timelineEnabled === false || view.enabledModules?.resources === false);
        }
        const selectedLineLabel = document.querySelector('#selectedLineDisplay')?.previousElementSibling;
        if (selectedLineLabel) selectedLineLabel.textContent = view.selectedLineLabel;
        setFieldLabel('#bookingNotes', view.notesLabel);
        setFieldLabel('#bookingGroupName', view.groupLabel);
        setFieldLabel('#customerName', view.customerNameLabel, true);
        setFieldLabel('#customerPhone', view.phoneLabel);
        setFieldLabel('#programsIcons', view.programLabel);
        setFieldLabel('#roomSelect', view.roomLabel);
        const roomHeading = document.querySelector('.booking-room-first-heading strong');
        if (roomHeading) roomHeading.textContent = view.roomLabel;
        const roomHeadingHint = document.querySelector('.booking-room-first-heading small');
        if (roomHeadingHint) {
            roomHeadingHint.textContent = view.mode === 'education'
                ? 'Кабінет береться з лінії таймлайну, щоб було видно зайнятість аудиторій'
                : view.mode === 'park'
                    ? 'Оберіть кімнату перед клієнтом, програмою або кухнею'
                    : 'Ресурс запису заповнюється автоматично для простого режиму';
        }
        const roomHint = document.getElementById('bookingRoomHint');
        if (roomHint) roomHint.textContent = view.mode === 'education'
            ? 'Заняття зберігається у вибраному кабінеті.'
            : view.mode === 'park'
                ? 'Без кімнати бронювання не зберігається.'
                : 'Для простого запису ресурс можна не заповнювати вручну.';
        const roomSelect = document.getElementById('roomSelect');
        if (roomSelect?.options?.[0]) roomSelect.options[0].textContent = `Оберіть ${view.roomOptionLabel.toLowerCase()}`;
        const programSearch = document.getElementById('programSearch');
        if (programSearch) programSearch.placeholder = view.programSearchPlaceholder;
        const legend = document.querySelector('.legend');
        if (legend) legend.innerHTML = view.legendHtml;
        document.querySelector('.timeline-container')?.classList.toggle('timeline-container--disabled', view.timelineEnabled === false);
        document.querySelectorAll('[title*="Афіша"], a[href="/programs"]').forEach(el => {
            el.classList.toggle('hidden', !view.showAfisha);
        });
        document.querySelectorAll('[title*="програм"]').forEach(el => {
            el.classList.toggle('hidden', view.mode !== 'park');
        });
        if (typeof window !== 'undefined' && window.TimelineVisibility?.applyVisibility) {
            window.TimelineVisibility.applyVisibility();
        }
    }

    const api = {
        CONTEXTS,
        DISPLAY_MODES,
        current: currentContext,
        displaySettings: readDisplaySettings,
        saveDisplaySettings,
        presentation,
        resourceTypeForMode,
        userRoles,
        userPageAllowlist,
        hasAnyRole,
        canAccessContext,
        canUseAction,
        storageKey,
        appendApiContext,
        withApiContext,
        applyLabels
    };

    window.TimelineBusinessContext = api;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyLabels, { once: true });
    } else {
        applyLabels();
    }
})();
