/**
 * Timeline element visibility constructor.
 *
 * Keeps one timeline engine, but lets elevated users tune which controls are
 * visible for each business context. Settings are client-side and scoped by
 * TimelineBusinessContext.storageKey().
 */
(function () {
    const STORAGE_NAME = 'timeline_element_visibility';
    const DISABLED_ATTR = 'data-timeline-visibility-prev-disabled';

    const TIMELINE_VISIBILITY_ELEMENTS = [
        { key: 'dateControls', label: 'Дата і навігація', selector: '.date-controls', area: 'Верхня панель' },
        { key: 'statusFilters', label: 'Фільтри статусів', selector: '.status-filter-controls', area: 'Верхня панель' },
        { key: 'viewModes', label: 'День / тиждень', selector: '.view-mode-controls', area: 'Верхня панель' },
        { key: 'zoomControls', label: 'Масштаб 15/30/60 хв', selector: '.zoom-controls', area: 'Верхня панель' },
        { key: 'compactToggle', label: 'Компактний режим', selector: '#compactModeToggle', area: 'Верхня панель', targetWrapper: true },
        { key: 'undo', label: 'Скасувати дію', selector: '#undoBtn', area: 'Верхня панель' },
        { key: 'roomLoad', label: 'Кімнати / кабінети', selector: '#roomLoadBtn', area: 'Верхня панель' },
        { key: 'productSales', label: 'Продажі', selector: '#productSalesBtn', area: 'Верхня панель' },
        { key: 'export', label: 'Експорт', selector: '#exportTimelineBtn', area: 'Верхня панель' },
        { key: 'actionMenu', label: 'Меню дій', selector: '#adminDropdown', area: 'Верхня панель' },
        { key: 'history', label: 'Історія змін', selector: '#historyBtn', area: 'Меню дій' },
        { key: 'digest', label: 'Дайджест дня', selector: '#digestBtn', area: 'Меню дій' },
        { key: 'quickStats', label: 'Швидка статистика', selector: '#quickStatsBar', area: 'Робоча зона' },
        { key: 'assistantWidget', label: 'Помічник', selector: '#kleshnyaWidget', area: 'Робоча зона' },
        { key: 'warnings', label: 'Попередження', selector: '#warningBanner, #filterModeBanner', area: 'Робоча зона' },
        { key: 'timelineScale', label: 'Шкала часу', selector: '#timeScale', area: 'Таймлайн' },
        { key: 'timelineGrid', label: 'Сітка таймлайну', selector: '#timelineScroll, #timelineLines', area: 'Таймлайн' },
        { key: 'addLine', label: 'Додати лінію / спеціаліста', selector: '#addLineBtn', area: 'Таймлайн' },
        { key: 'legend', label: 'Легенда', selector: '.legend', area: 'Таймлайн' },
        { key: 'minimap', label: 'Мінімапа', selector: '#minimapContainer', area: 'Таймлайн' },
        { key: 'roomLoadPanel', label: 'Панель навантаження кімнат', selector: '#roomLoadPanel', area: 'Таймлайн' },
        { key: 'bookingPanel', label: 'Панель бронювання', selector: '#bookingPanel', area: 'Форма бронювання' },
        { key: 'bookingClose', label: 'Закрити панель бронювання', selector: '#closePanel', area: 'Форма бронювання' },
        { key: 'bookingSelectedInfo', label: 'Обрані дата / час / лінія', selector: '#bookingPanel .selected-info', area: 'Форма бронювання' },
        { key: 'bookingRoom', label: 'Кімната', selector: '#roomSelect', area: 'Форма бронювання', targetWrapper: true },
        { key: 'freeRooms', label: 'Вільні кімнати', selector: '#freeRoomsBtn', area: 'Форма бронювання' },
        { key: 'freeRoomsPanel', label: 'Панель вільних кімнат', selector: '#freeRoomsPanel', area: 'Форма бронювання' },
        { key: 'costume', label: 'Костюм', selector: '#costumeSelect', area: 'Форма бронювання', targetWrapper: true },
        { key: 'extraHost', label: 'Додатковий ведучий', selector: '#extraHostSection', area: 'Форма бронювання' },
        { key: 'secondAnimator', label: 'Другий аніматор', selector: '#secondAnimatorSection', area: 'Форма бронювання' },
        { key: 'hostsWarning', label: 'Попередження про ведучих', selector: '#hostsWarning', area: 'Форма бронювання' },
        { key: 'notes', label: 'Примітки', selector: '#bookingNotes', area: 'Форма бронювання', targetWrapper: true },
        { key: 'groupName', label: 'Група / банкет', selector: '#bookingGroupName', area: 'Форма бронювання', targetWrapper: true },
        { key: 'customerToggle', label: 'Перемикач даних клієнта', selector: '#customerDataToggle', area: 'Форма бронювання', targetWrapper: true },
        { key: 'customerData', label: 'Дані клієнта', selector: '#customerDataSection', area: 'Форма бронювання' },
        { key: 'customerSearch', label: 'Пошук клієнта', selector: '#customerSearch', area: 'Форма бронювання', targetWrapper: true },
        { key: 'customerFields', label: 'Поля клієнта', selector: '#customerName, #customerPhone, #customerInstagram, #customerChildName, #customerChildBirthday, #customerSource', area: 'Форма бронювання', targetWrapper: true },
        { key: 'customerInfo', label: 'Інфо про клієнта', selector: '#customerInfo', area: 'Форма бронювання' },
        { key: 'programSearch', label: 'Пошук програми / консультації', selector: '#programSearch', area: 'Форма бронювання', targetWrapper: true },
        { key: 'programs', label: 'Картки програм / консультацій', selector: '#programsIcons', area: 'Форма бронювання' },
        { key: 'programDetails', label: 'Деталі програми', selector: '#programDetails', area: 'Форма бронювання' },
        { key: 'customProgram', label: 'Кастомна програма', selector: '#customProgramSection', area: 'Форма бронювання' },
        { key: 'customProgramFields', label: 'Поля кастомної позиції', selector: '#customName, #customDuration', area: 'Форма бронювання', targetWrapper: true },
        { key: 'pinata', label: 'Піньята', selector: '#pinataModeSection, #pinataSharedFields, #clientPinataServiceFields, #pinataFillerSection', area: 'Форма бронювання' },
        { key: 'kidsCount', label: 'Кількість дітей', selector: '#kidsCountSection', area: 'Форма бронювання' },
        { key: 'tshirtSizes', label: 'Розміри футболок', selector: '#tshirtSizesSection', area: 'Форма бронювання' },
        { key: 'bookingStatus', label: 'Статус бронювання', selector: '#bookingPanel .status-section', area: 'Форма бронювання' },
        { key: 'skipNotification', label: 'Без сповіщень', selector: '#skipNotificationToggle', area: 'Форма бронювання', targetWrapper: true },
        { key: 'bookingSubmit', label: 'Кнопка збереження бронювання', selector: '#bookingSubmitBtn', area: 'Форма бронювання' }
    ];

    const state = {
        initialized: false,
        constructorActive: false,
        panel: null,
        toggleBtn: null,
        accessTimer: null,
        serverSettings: new Map(),
        serverLoadPromise: null,
        serverSaveTimer: null
    };

    function contextApi() {
        return window.TimelineBusinessContext || null;
    }

    function currentContext() {
        return contextApi()?.current?.() || { key: 'event_genix', productName: 'Таймлайн ПАРК', storagePrefix: 'pzp' };
    }

    function storageKey() {
        return contextApi()?.storageKey?.(STORAGE_NAME) || `${currentContext().storagePrefix || 'pzp'}_${STORAGE_NAME}`;
    }

    function apiUrl(path) {
        const base = window.API_BASE || '/api';
        const url = `${base}${path}`;
        return contextApi()?.appendApiContext?.(url) || url;
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

    function canConfigure() {
        const api = contextApi();
        if (!api?.canUseAction) return false;
        return api.canUseAction('settings', window.AppState?.currentUser || null);
    }

    function safeParseJson(raw) {
        try {
            return raw ? JSON.parse(raw) : null;
        } catch (error) {
            console.warn('[TimelineVisibility] Failed to parse visibility settings', error);
            return null;
        }
    }

    function normalizeSettings(parsed) {
        return {
            version: 1,
            overrides: parsed?.overrides && typeof parsed.overrides === 'object' ? parsed.overrides : {},
            updatedAt: parsed?.updatedAt || null,
            updatedBy: parsed?.updatedBy || null
        };
    }

    function loadSettings() {
        const contextKey = currentContext().key;
        if (state.serverSettings.has(contextKey)) return normalizeSettings(state.serverSettings.get(contextKey));
        return normalizeSettings(safeParseJson(localStorage.getItem(storageKey())));
    }

    function saveSettings(settings) {
        const payload = {
            version: 1,
            overrides: settings.overrides || {},
            updatedAt: new Date().toISOString()
        };
        localStorage.setItem(storageKey(), JSON.stringify(payload));
        state.serverSettings.set(currentContext().key, payload);
        scheduleServerSave(payload);
    }

    async function loadServerSettings() {
        const contextKey = currentContext().key;
        if (state.serverLoadPromise) return state.serverLoadPromise;
        state.serverLoadPromise = fetch(apiUrl('/settings/timeline-visibility'), {
            headers: authHeaders(false)
        })
            .then(response => response.ok ? response.json() : null)
            .then(data => {
                if (data) {
                    const normalized = normalizeSettings(data);
                    state.serverSettings.set(contextKey, normalized);
                    localStorage.setItem(storageKey(), JSON.stringify(normalized));
                }
                return data;
            })
            .catch(error => {
                console.warn('[TimelineVisibility] Server visibility settings unavailable', error);
                return null;
            })
            .finally(() => {
                state.serverLoadPromise = null;
            });
        return state.serverLoadPromise;
    }

    function scheduleServerSave(settings) {
        if (!canConfigure()) return;
        window.clearTimeout(state.serverSaveTimer);
        state.serverSaveTimer = window.setTimeout(async () => {
            try {
                const response = await fetch(apiUrl('/settings/timeline-visibility'), {
                    method: 'PUT',
                    headers: authHeaders(true),
                    body: JSON.stringify({ overrides: settings.overrides || {} })
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                state.serverSettings.set(currentContext().key, normalizeSettings(data));
            } catch (error) {
                console.warn('[TimelineVisibility] Failed to save server visibility settings', error);
            }
        }, 250);
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

    function isHidden(key) {
        const settings = loadSettings();
        if (Object.prototype.hasOwnProperty.call(settings.overrides, key)) {
            return Boolean(settings.overrides[key]);
        }
        return defaultHiddenKeys().has(key);
    }

    function setHidden(key, hidden) {
        const settings = loadSettings();
        settings.overrides[key] = Boolean(hidden);
        saveSettings(settings);
        applyVisibility();
        renderPanelList();
        notify(`${hidden ? 'Приховано' : 'Показано'}: ${labelForKey(key)}`);
    }

    function resetSettings() {
        localStorage.removeItem(storageKey());
        state.serverSettings.set(currentContext().key, { version: 1, overrides: {}, updatedAt: new Date().toISOString() });
        scheduleServerSave({ overrides: {} });
        applyVisibility();
        renderPanelList();
        notify('Видимість таймлайну повернено до стандартних налаштувань');
    }

    function labelForKey(key) {
        return TIMELINE_VISIBILITY_ELEMENTS.find(item => item.key === key)?.label || key;
    }

    function getElementTargets(item) {
        const nodes = Array.from(document.querySelectorAll(item.selector));
        return nodes.map(node => {
            if (!item.targetWrapper) return node;
            return node.closest('.form-section') || node.closest('label') || node;
        }).filter(Boolean);
    }

    function markConfigurableElements() {
        TIMELINE_VISIBILITY_ELEMENTS.forEach(item => {
            getElementTargets(item).forEach(el => {
                if (el.dataset.timelineVisibilityKey && el.dataset.timelineVisibilityKey !== item.key) return;
                el.dataset.timelineVisibilityKey = item.key;
                el.dataset.timelineVisibilityLabel = item.label;
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

    function ensureVisibilityChip(el, item, hidden) {
        const isControlTarget = el.matches('button,input,select,textarea,a[href]');
        const host = isControlTarget ? el.parentElement : el;
        if (!host) return;
        let chip = Array.from(host.children).find(child =>
            child.classList?.contains('timeline-visibility-chip') && child.dataset.key === item.key
        );
        if (!chip) {
            chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'timeline-visibility-chip';
            chip.dataset.key = item.key;
            chip.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                setHidden(item.key, !isHidden(item.key));
            });
            if (isControlTarget) {
                el.insertAdjacentElement('afterend', chip);
            } else {
                host.appendChild(chip);
            }
        }
        chip.classList.toggle('is-inline', isControlTarget);
        chip.textContent = hidden ? 'Показати' : 'Сховати';
        chip.setAttribute('aria-label', `${hidden ? 'Показати' : 'Сховати'} ${item.label}`);
    }

    function applyVisibility() {
        markConfigurableElements();
        if (!state.constructorActive) removeVisibilityChips();

        TIMELINE_VISIBILITY_ELEMENTS.forEach(item => {
            const hidden = isHidden(item.key);
            getElementTargets(item).forEach(el => {
                el.classList.toggle('timeline-hidden-by-config', hidden && !state.constructorActive);
                el.classList.toggle('timeline-constructor-disabled', hidden && state.constructorActive);
                el.classList.toggle('timeline-constructor-visible', !hidden && state.constructorActive);
                el.setAttribute('data-timeline-visibility-state', hidden ? 'hidden' : 'visible');
                setNestedDisabled(el, hidden);
                if (state.constructorActive) ensureVisibilityChip(el, item, hidden);
            });
        });

        document.body?.classList.toggle('timeline-constructor-active', state.constructorActive);
        if (typeof window.refreshTimelineActionMenuVisibility === 'function') {
            window.refreshTimelineActionMenuVisibility();
        }
    }

    function removeBusinessSwitcher() {
        document.getElementById('timelineBusinessSwitch')?.remove();
    }

    function createConstructorButton() {
        if (document.getElementById('timelineConstructorBtn')) {
            state.toggleBtn = document.getElementById('timelineConstructorBtn');
            bindConstructorButton(state.toggleBtn);
            return;
        }
        const actionButtons = document.querySelector('.action-buttons') || document.querySelector('.control-panel');
        if (!actionButtons) return;

        const button = document.createElement('button');
        button.type = 'button';
        button.id = 'timelineConstructorBtn';
        button.className = 'timeline-constructor-btn hidden';
        button.title = 'Налаштувати видимість елементів таймлайну';
        button.setAttribute('aria-label', 'Налаштувати видимість елементів таймлайну');
        button.setAttribute('aria-pressed', 'false');
        button.innerHTML = '<span class="timeline-constructor-btn-icon" aria-hidden="true">⚙</span><span class="timeline-constructor-btn-label">Видимість</span>';
        bindConstructorButton(button);
        actionButtons.appendChild(button);
        state.toggleBtn = button;
    }

    function bindConstructorButton(button) {
        if (!button || button.dataset.timelineConstructorBound === '1') return;
        button.dataset.timelineConstructorBound = '1';
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            toggleConstructorMode(!state.constructorActive);
        });
    }

    function createPanel() {
        if (document.getElementById('timelineConstructorPanel')) {
            state.panel = document.getElementById('timelineConstructorPanel');
            return;
        }

        const panel = document.createElement('section');
        panel.id = 'timelineConstructorPanel';
        panel.className = 'timeline-constructor-panel hidden';
        panel.setAttribute('aria-label', 'Конструктор видимості таймлайну');
        panel.innerHTML = `
            <div class="timeline-constructor-panel-header">
                <div>
                    <strong>Конструктор таймлайну</strong>
                    <span id="timelineConstructorContext"></span>
                </div>
                <button type="button" id="timelineConstructorClose" class="timeline-constructor-close" aria-label="Закрити конструктор">✕</button>
            </div>
            <div class="timeline-constructor-panel-body">
                <p>Вимикай елементи тут або прямо на сторінці. У звичайному режимі вимкнені елементи зникнуть.</p>
                <div id="timelineConstructorList" class="timeline-constructor-list"></div>
            </div>
            <div class="timeline-constructor-panel-actions">
                <button type="button" id="timelineConstructorReset" class="timeline-constructor-secondary">Скинути</button>
                <button type="button" id="timelineConstructorDone" class="timeline-constructor-primary">Готово</button>
            </div>
        `;
        document.body.appendChild(panel);
        panel.querySelector('#timelineConstructorClose')?.addEventListener('click', () => toggleConstructorMode(false));
        panel.querySelector('#timelineConstructorDone')?.addEventListener('click', () => toggleConstructorMode(false));
        panel.querySelector('#timelineConstructorReset')?.addEventListener('click', resetSettings);
        state.panel = panel;
    }

    function groupedElements() {
        return TIMELINE_VISIBILITY_ELEMENTS.reduce((groups, item) => {
            const area = item.area || 'Інше';
            if (!groups[area]) groups[area] = [];
            groups[area].push(item);
            return groups;
        }, {});
    }

    function renderPanelList() {
        const list = document.getElementById('timelineConstructorList');
        const contextLabel = document.getElementById('timelineConstructorContext');
        if (contextLabel) contextLabel.textContent = currentContext().productName || currentContext().navLabel || '';
        if (!list) return;

        const groups = groupedElements();
        list.innerHTML = Object.entries(groups).map(([area, items]) => `
            <div class="timeline-constructor-group">
                <div class="timeline-constructor-group-title">${escapeHtml(area)}</div>
                ${items.map(item => {
                    const hidden = isHidden(item.key);
                    return `
                        <label class="timeline-constructor-row">
                            <span>${escapeHtml(item.label)}</span>
                            <input type="checkbox" data-key="${item.key}" ${hidden ? '' : 'checked'} aria-label="${escapeHtml(item.label)}">
                        </label>
                    `;
                }).join('')}
            </div>
        `).join('');

        list.querySelectorAll('input[type="checkbox"][data-key]').forEach(input => {
            input.addEventListener('change', event => {
                setHidden(event.target.dataset.key, !event.target.checked);
            });
        });
    }

    function toggleConstructorMode(active) {
        if (active && !canConfigure()) return;
        state.constructorActive = Boolean(active);
        document.body?.classList.toggle('timeline-constructor-active', state.constructorActive);
        state.toggleBtn?.classList.toggle('is-active', state.constructorActive);
        state.toggleBtn?.setAttribute('aria-pressed', String(state.constructorActive));
        if (state.toggleBtn) {
            state.toggleBtn.title = state.constructorActive ? 'Завершити налаштування видимості' : 'Налаштувати видимість елементів таймлайну';
            state.toggleBtn.setAttribute('aria-label', state.toggleBtn.title);
            state.toggleBtn.innerHTML = state.constructorActive
                ? '<span class="timeline-constructor-btn-icon" aria-hidden="true">✓</span><span class="timeline-constructor-btn-label">Готово</span>'
                : '<span class="timeline-constructor-btn-icon" aria-hidden="true">⚙</span><span class="timeline-constructor-btn-label">Видимість</span>';
        }
        state.panel?.classList.toggle('hidden', !state.constructorActive);
        renderPanelList();
        applyVisibility();
    }

    function refreshAccess() {
        removeBusinessSwitcher();
        const allowed = canConfigure();
        if (state.toggleBtn) state.toggleBtn.classList.toggle('hidden', !allowed);
        if (!allowed && state.constructorActive) toggleConstructorMode(false);
        loadServerSettings().then(data => {
            if (!data) return;
            applyVisibility();
            renderPanelList();
        });
    }

    function notify(message) {
        if (typeof window.showNotification === 'function') {
            window.showNotification(message);
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
        loadServerSettings().then(data => {
            if (!data) return;
            applyVisibility();
            renderPanelList();
        });
        refreshAccess();
        window.addEventListener('app:user-changed', refreshAccess);
        window.addEventListener('timeline:visibility-refresh', applyVisibility);
        state.accessTimer = window.setInterval(() => {
            refreshAccess();
            if (window.AppState?.currentUser) {
                window.clearInterval(state.accessTimer);
                state.accessTimer = null;
            }
        }, 500);
    }

    window.TimelineVisibility = {
        init,
        applyVisibility,
        refreshAccess,
        toggleConstructorMode,
        setHidden,
        resetSettings,
        isHidden,
        registry: TIMELINE_VISIBILITY_ELEMENTS
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
