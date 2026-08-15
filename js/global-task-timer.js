(function () {
    'use strict';

    const CHANNEL_NAME = 'eventgenix:my-day-timer:v1';
    const CONTRACT_VERSION = 'global_task_timer_signal_v1';
    const STORAGE_SIGNAL_KEY = 'eventgenix:my-day-timer:v1:signal';
    const TIMER_ENDPOINT = '/api/my-day/timer';
    const TIMER_STOP_ENDPOINT = '/api/my-day/timer/stop';
    const TICK_MS = 1000;
    const RECONCILE_MS = 60 * 1000;
    const ACTIVE_TIMER_WARNING_SECONDS = 8 * 60 * 60;

    const state = {
        timer: null,
        hydrated: false,
        loading: false,
        mounted: false,
        inFlight: false,
        panelOpen: false,
        lastSignalId: null,
        pendingHydrate: false
    };

    let tickInterval = null;
    let reconcileInterval = null;
    let activeRequest = null;
    let activeHydratePromise = null;
    let channel = null;
    let initialized = false;

    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));

    function nowMs() {
        return Date.now();
    }

    function getAuthHeaders(withContentType = true) {
        if (typeof window.getAuthHeaders === 'function') {
            return window.getAuthHeaders(withContentType);
        }
        const token = localStorage.getItem('pzp_access_token') || localStorage.getItem('pzp_token') || '';
        const headers = withContentType ? { 'Content-Type': 'application/json' } : {};
        if (token) headers.Authorization = `Bearer ${token}`;
        return headers;
    }

    function hasRuntimeSession() {
        if (typeof window.isAuthenticatedRuntimeReady === 'function') {
            return window.isAuthenticatedRuntimeReady();
        }
        return Boolean(localStorage.getItem('pzp_access_token') || localStorage.getItem('pzp_token'));
    }

    function secondsLabel(value, options = {}) {
        const totalSeconds = Math.max(0, Math.floor(Number(value || 0)));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        if (options.live || hours || totalSeconds < 60) {
            if (hours) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            return `${minutes}:${String(seconds).padStart(2, '0')}`;
        }
        return `${hours}:${String(minutes).padStart(2, '0')}`;
    }

    function businessLabel(value) {
        const key = String(value || '').trim();
        if (!key) return '';
        const labels = {
            event_genix: 'Event Genix',
            maysternya_doli: 'Майстерня',
            park: 'Парк',
            crm: 'CRM',
            hermes: 'Hermes'
        };
        return labels[key] || key.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function normalizeTimer(timer) {
        if (!timer) return null;
        const endedAt = timer.endedAt || timer.ended_at || null;
        const task = timer.task || null;
        const businessContext = timer.businessContext
            || timer.business_context
            || task?.businessContext
            || task?.business_context
            || '';
        return {
            id: timer.id ? Number(timer.id) : null,
            taskId: Number(timer.taskId || timer.task_id || task?.id || 0),
            startedAt: timer.startedAt || timer.started_at || null,
            endedAt,
            durationSeconds: Math.max(0, Number(timer.durationSeconds ?? timer.duration_seconds ?? 0)),
            isActive: timer.isActive !== false && !endedAt,
            warning: timer.warning || null,
            taskUnavailable: timer.taskUnavailable === true,
            businessContext,
            task: task && timer.taskUnavailable !== true ? {
                id: Number(task.id || timer.taskId || timer.task_id || 0),
                title: task.title || '',
                status: task.status || '',
                businessContext
            } : null,
            clientSyncedAt: nowMs()
        };
    }

    function currentDurationSeconds(timer = state.timer) {
        if (!timer) return 0;
        const base = Math.max(0, Number(timer.durationSeconds || 0));
        if (timer.isActive === false || timer.endedAt) return base;
        return base + Math.max(0, Math.floor((nowMs() - Number(timer.clientSyncedAt || nowMs())) / 1000));
    }

    function isLongRunning(timer = state.timer) {
        return currentDurationSeconds(timer) >= ACTIVE_TIMER_WARNING_SECONDS || timer?.warning === 'long_running';
    }

    function buildSignalPayload(action) {
        return {
            contract: CONTRACT_VERSION,
            eventId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
            action: String(action || 'refresh').slice(0, 32),
            emittedAt: new Date().toISOString()
        };
    }

    function isValidSignal(payload) {
        return Boolean(
            payload
            && payload.contract === CONTRACT_VERSION
            && typeof payload.eventId === 'string'
            && typeof payload.action === 'string'
            && typeof payload.emittedAt === 'string'
            && !('taskId' in payload)
            && !('title' in payload)
            && !('userId' in payload)
            && !('businessId' in payload)
            && !('businessContext' in payload)
        );
    }

    function emitSignal(action) {
        const payload = buildSignalPayload(action);
        state.lastSignalId = payload.eventId;
        try {
            channel?.postMessage(payload);
        } catch {}
        try {
            localStorage.setItem(STORAGE_SIGNAL_KEY, JSON.stringify(payload));
            localStorage.removeItem(STORAGE_SIGNAL_KEY);
        } catch {}
        return payload;
    }

    function handleSignal(payload) {
        if (!isValidSignal(payload) || payload.eventId === state.lastSignalId) return;
        state.lastSignalId = payload.eventId;
        return hydrate({ reason: 'signal' }).then(() => {
            try {
                window.dispatchEvent(new CustomEvent('crm:timer-updated', { detail: { source: 'global', action: payload.action, reason: 'signal' } }));
            } catch {}
        });
    }

    function timerTitle(timer = state.timer) {
        if (!timer) return '';
        if (timer.taskUnavailable) return 'Таймер активний';
        return timer.task?.title || 'Активна задача';
    }

    function ensureNode(id, tagName, className, parent, before = null) {
        if (!parent) return null;
        let node = document.getElementById(id);
        if (!node) {
            node = document.createElement(tagName);
            node.id = id;
            if (className) node.className = className;
        }
        if (node.parentElement !== parent) {
            parent.insertBefore(node, before || null);
        }
        return node;
    }

    function removeNode(id) {
        document.getElementById(id)?.remove();
    }

    function sidebarExpandedHost() {
        const deck = document.getElementById('sidebarCommandDeck');
        if (!deck) return null;
        return ensureNode('globalTaskTimerSidebar', 'section', 'global-task-timer global-task-timer--sidebar', deck, document.getElementById('sidebarFocusDeck'));
    }

    function sidebarRailHost() {
        const rail = document.getElementById('sidebarMiniRail');
        if (!rail) return null;
        return ensureNode('globalTaskTimerRail', 'div', 'global-task-timer-rail-host', rail, rail.firstElementChild);
    }

    function headerHost() {
        const headerContent = document.querySelector('.header .header-content');
        if (!headerContent) return null;
        const userPanel = headerContent.querySelector('.user-panel');
        return ensureNode('globalTaskTimerHeader', 'div', 'global-task-timer-header-host', headerContent, userPanel || null);
    }

    function renderInactive() {
        removeNode('globalTaskTimerPanel');
        removeNode('globalTaskTimerSidebar');
        removeNode('globalTaskTimerRail');
        removeNode('globalTaskTimerHeader');
        state.panelOpen = false;
        document.body?.classList?.remove('global-task-timer-active');
    }

    function renderSidebar(timer) {
        const host = sidebarExpandedHost();
        if (!host) return;
        const elapsed = secondsLabel(currentDurationSeconds(timer), { live: true });
        const business = businessLabel(timer.businessContext);
        host.dataset.state = timer.taskUnavailable ? 'unavailable' : 'active';
        host.dataset.warning = isLongRunning(timer) ? 'true' : 'false';
        host.innerHTML = `
            <span class="global-task-timer__dot" aria-hidden="true"></span>
            <span class="global-task-timer__copy">
                <span class="global-task-timer__label">Таймер</span>
                <strong class="global-task-timer__elapsed" data-global-task-timer-elapsed>${escapeHtml(elapsed)}</strong>
                <span class="global-task-timer__title" title="${escapeHtml(timerTitle(timer))}">${escapeHtml(timerTitle(timer))}</span>
                ${business ? `<span class="global-task-timer__business">${escapeHtml(business)}</span>` : ''}
            </span>
            <button type="button" class="global-task-timer__stop" data-global-task-timer-stop ${state.inFlight ? 'disabled aria-busy="true"' : ''}>Стоп</button>
            ${isLongRunning(timer) ? '<span class="global-task-timer__warning">Понад 8 годин</span>' : ''}
        `;
    }

    function renderRail(timer) {
        const host = sidebarRailHost();
        if (!host) return;
        const elapsed = secondsLabel(currentDurationSeconds(timer), { live: true });
        host.innerHTML = `
            <button type="button" class="global-task-timer-rail" data-global-task-timer-panel-trigger aria-label="Активний таймер ${escapeHtml(elapsed)}" aria-expanded="${state.panelOpen ? 'true' : 'false'}">
                <span class="global-task-timer-rail__icon" aria-hidden="true">⏱</span>
                <span class="global-task-timer-rail__dot" aria-hidden="true"></span>
                <span class="global-task-timer-rail__elapsed" data-global-task-timer-elapsed>${escapeHtml(elapsed)}</span>
            </button>
        `;
    }

    function renderHeader(timer) {
        const host = headerHost();
        if (!host) return;
        const elapsed = secondsLabel(currentDurationSeconds(timer), { live: true });
        host.innerHTML = `
            <button type="button" class="global-task-timer-chip" data-global-task-timer-panel-trigger aria-label="Активний таймер ${escapeHtml(elapsed)}" aria-expanded="${state.panelOpen ? 'true' : 'false'}">
                <span class="global-task-timer-chip__dot" aria-hidden="true"></span>
                <span class="global-task-timer-chip__icon" aria-hidden="true">⏱</span>
                <span class="global-task-timer-chip__elapsed" data-global-task-timer-elapsed>${escapeHtml(elapsed)}</span>
            </button>
        `;
    }

    function panelHtml(timer) {
        const elapsed = secondsLabel(currentDurationSeconds(timer), { live: true });
        const business = businessLabel(timer.businessContext);
        return `
            <div class="global-task-timer-panel__card" role="dialog" aria-modal="false" aria-label="Активний таймер">
                <div class="global-task-timer-panel__header">
                    <span class="global-task-timer-panel__kicker">Активний таймер</span>
                    <button type="button" class="global-task-timer-panel__close" data-global-task-timer-panel-close aria-label="Закрити">×</button>
                </div>
                <strong class="global-task-timer-panel__elapsed" data-global-task-timer-elapsed>${escapeHtml(elapsed)}</strong>
                <span class="global-task-timer-panel__title">${escapeHtml(timerTitle(timer))}</span>
                ${timer.taskUnavailable ? '<span class="global-task-timer-panel__notice">Задача недоступна в цьому контексті. Назву приховано.</span>' : ''}
                ${business ? `<span class="global-task-timer-panel__business">${escapeHtml(business)}</span>` : ''}
                ${isLongRunning(timer) ? '<span class="global-task-timer-panel__warning">Понад 8 годин — перевірте таймер.</span>' : ''}
                <button type="button" class="global-task-timer-panel__stop" data-global-task-timer-stop ${state.inFlight ? 'disabled aria-busy="true"' : ''}>Зупинити таймер</button>
            </div>
        `;
    }

    function renderPanel(timer) {
        if (!state.panelOpen || !timer) {
            removeNode('globalTaskTimerPanel');
            return;
        }
        let host = document.getElementById('globalTaskTimerPanel');
        if (!host) {
            host = document.createElement('div');
            host.id = 'globalTaskTimerPanel';
            host.className = 'global-task-timer-panel';
            document.body.appendChild(host);
        }
        host.innerHTML = panelHtml(timer);
    }

    function render() {
        state.mounted = true;
        if (!state.timer?.isActive) {
            renderInactive();
            stopTickers();
            return;
        }
        renderSidebar(state.timer);
        renderRail(state.timer);
        renderHeader(state.timer);
        renderPanel(state.timer);
        document.body?.classList?.add('global-task-timer-active');
        bindDom();
        startTickers();
    }

    function updateElapsedDom() {
        if (!state.timer?.isActive) return;
        const elapsed = secondsLabel(currentDurationSeconds(state.timer), { live: true });
        document.querySelectorAll('[data-global-task-timer-elapsed]').forEach(node => {
            node.textContent = elapsed;
        });
        document.querySelectorAll('[data-global-task-timer-panel-trigger]').forEach(node => {
            node.setAttribute('aria-label', `Активний таймер ${elapsed}`);
        });
    }

    function startTickers() {
        if (tickInterval || !state.timer?.isActive) return;
        updateElapsedDom();
        tickInterval = window.setInterval(updateElapsedDom, TICK_MS);
        reconcileInterval = window.setInterval(() => {
            void hydrate({ reason: 'reconcile' });
        }, RECONCILE_MS);
    }

    function stopTickers() {
        if (tickInterval) window.clearInterval(tickInterval);
        if (reconcileInterval) window.clearInterval(reconcileInterval);
        tickInterval = null;
        reconcileInterval = null;
    }

    async function hydrate(options = {}) {
        if (!hasRuntimeSession()) return state.timer;
        if (state.loading) {
            state.pendingHydrate = true;
            return activeHydratePromise || state.timer;
        }
        state.loading = true;
        activeRequest?.abort?.();
        activeRequest = typeof AbortController !== 'undefined' ? new AbortController() : null;
        activeHydratePromise = (async () => {
            const response = await fetch(TIMER_ENDPOINT, {
                headers: getAuthHeaders(false),
                signal: activeRequest?.signal
            });
            if (response.status === 401 || response.status === 403) {
                clear('auth');
                return null;
            }
            const body = await response.json().catch(() => ({}));
            if (!response.ok || body.success === false) throw new Error(body.error || 'Timer hydrate failed');
            state.timer = normalizeTimer(body.timer || null);
            state.hydrated = true;
            render();
            return state.timer;
        })();
        try {
            return await activeHydratePromise;
        } catch (error) {
            if (error?.name !== 'AbortError') {
                console.warn('[global-task-timer] hydrate failed', { reason: options.reason || 'manual' });
            }
            return state.timer;
        } finally {
            state.loading = false;
            activeRequest = null;
            activeHydratePromise = null;
            if (state.pendingHydrate) {
                state.pendingHydrate = false;
                setTimeout(() => void hydrate({ reason: 'queued' }), 0);
            }
        }
    }

    async function stopTimer() {
        if (state.inFlight) return;
        state.inFlight = true;
        render();
        try {
            const response = await fetch(TIMER_STOP_ENDPOINT, {
                method: 'POST',
                headers: getAuthHeaders(true)
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok || body.success === false) throw new Error(body.error || 'Timer stop failed');
            state.timer = normalizeTimer(body.timer || null);
            if (!state.timer?.isActive) state.timer = null;
            state.panelOpen = false;
            emitSignal('stop');
            window.dispatchEvent(new CustomEvent('crm:timer-updated', { detail: { source: 'global', action: 'stop' } }));
            render();
        } catch (error) {
            console.warn('[global-task-timer] stop failed');
            window.showNotification?.(error.message || 'Не вдалося зупинити таймер.', 'error');
            render();
        } finally {
            state.inFlight = false;
            render();
        }
    }

    function openPanel(trigger) {
        if (!state.timer?.isActive) return;
        state.panelOpen = true;
        render();
        const closeButton = document.querySelector('[data-global-task-timer-panel-close]');
        (closeButton || document.querySelector('[data-global-task-timer-stop]'))?.focus?.();
        if (trigger) document.getElementById('globalTaskTimerPanel')?.setAttribute('data-return-focus', trigger.id || '');
    }

    function closePanel(options = {}) {
        if (!state.panelOpen) return;
        const trigger = document.querySelector('[data-global-task-timer-panel-trigger][aria-expanded="true"]');
        state.panelOpen = false;
        render();
        if (options.returnFocus !== false && trigger?.isConnected && trigger.offsetParent !== null) trigger.focus?.();
    }

    function bindDom() {
        document.querySelectorAll('[data-global-task-timer-stop]').forEach(button => {
            if (button.dataset.globalTaskTimerBound === 'true') return;
            button.dataset.globalTaskTimerBound = 'true';
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                void stopTimer();
            });
        });
        document.querySelectorAll('[data-global-task-timer-panel-trigger]').forEach(button => {
            if (button.dataset.globalTaskTimerBound === 'true') return;
            button.dataset.globalTaskTimerBound = 'true';
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                if (state.panelOpen) closePanel();
                else openPanel(button);
            });
        });
        document.querySelectorAll('[data-global-task-timer-panel-close]').forEach(button => {
            if (button.dataset.globalTaskTimerBound === 'true') return;
            button.dataset.globalTaskTimerBound = 'true';
            button.addEventListener('click', event => {
                event.preventDefault();
                closePanel();
            });
        });
    }

    function clear(reason = 'manual') {
        activeRequest?.abort?.();
        activeRequest = null;
        state.timer = null;
        state.hydrated = false;
        state.loading = false;
        state.inFlight = false;
        state.panelOpen = false;
        stopTickers();
        renderInactive();
        document.body?.classList?.remove('global-task-timer-active');
        if (reason === 'auth') emitSignal('auth-cleared');
    }

    function notifyLocalChange(action = 'refresh') {
        emitSignal(action);
        void hydrate({ reason: `local:${action}` });
    }

    function initChannel() {
        if (channel || typeof BroadcastChannel === 'undefined') return;
        try {
            channel = new BroadcastChannel(CHANNEL_NAME);
            channel.addEventListener('message', event => handleSignal(event.data));
        } catch {
            channel = null;
        }
    }

    function bindGlobalEvents() {
        if (document.documentElement.dataset.globalTaskTimerEventsBound === 'true') return;
        document.documentElement.dataset.globalTaskTimerEventsBound = 'true';
        window.addEventListener('focus', () => void hydrate({ reason: 'focus' }));
        window.addEventListener('online', () => void hydrate({ reason: 'online' }));
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') void hydrate({ reason: 'visibility' });
        });
        window.addEventListener('crmBusinessContextChanged', () => void hydrate({ reason: 'business-context' }));
        window.addEventListener('crmBusinessContextHydrated', () => void hydrate({ reason: 'business-context-hydrated' }));
        window.addEventListener('crm:sidebar-shell-changed', () => render());
        window.addEventListener('crm:timer-updated', event => {
            if (event.detail?.source === 'global') return;
            void hydrate({ reason: `event:${event.detail?.action || 'refresh'}` });
        });
        window.addEventListener('crm:auth-cleared', () => clear('auth-cleared'));
        window.addEventListener('storage', event => {
            if (['pzp_access_token', 'pzp_token', 'pzp_refresh_token'].includes(event.key) && !event.newValue) {
                clear('auth-storage');
                return;
            }
            if (event.key !== STORAGE_SIGNAL_KEY || !event.newValue) return;
            try {
                handleSignal(JSON.parse(event.newValue));
            } catch {}
        });
        document.addEventListener('click', event => {
            if (!state.panelOpen) return;
            const panel = document.getElementById('globalTaskTimerPanel');
            if (panel?.contains(event.target) || event.target?.closest?.('[data-global-task-timer-panel-trigger]')) return;
            closePanel({ returnFocus: false });
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') closePanel();
        });
    }

    function init() {
        if (initialized) {
            render();
            return true;
        }
        initialized = true;
        initChannel();
        bindGlobalEvents();
        render();
        if (hasRuntimeSession()) void hydrate({ reason: 'init' });
        return true;
    }

    const api = {
        state,
        init,
        mount: render,
        hydrate,
        clear,
        notifyLocalChange,
        stopTimer,
        _test: {
            CHANNEL_NAME,
            CONTRACT_VERSION,
            STORAGE_SIGNAL_KEY,
            buildSignalPayload,
            handleSignal,
            isValidSignal,
            normalizeTimer,
            currentDurationSeconds,
            secondsLabel
        }
    };

    window.GlobalTaskTimer = api;

    if (typeof window.isAuthenticatedRuntimeReady === 'function' && window.isAuthenticatedRuntimeReady()) {
        init();
    } else {
        window.addEventListener('crm:authenticated-runtime-ready', init, { once: true });
    }
}());
