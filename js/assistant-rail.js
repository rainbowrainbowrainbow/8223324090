/**
 * js/assistant-rail.js — shared CRM assistant rail
 *
 * Mounted at runtime from auth.js so every authenticated CRM page gets one
 * consistent rail without copying HTML into each page.
 */
(function () {
    const MODES = new Set(['idle', 'thinking', 'busy', 'listening', 'speaking', 'muted', 'error', 'working', 'streaming', 'action', 'success']);
    const LABELS = {
        idle: 'ГОТОВА',
        thinking: 'ОБДУМУЮ',
        busy: 'ПРАЦЮЮ',
        working: 'ПРАЦЮЮ',
        streaming: 'ВІДПОВІДАЮ',
        action: 'ПРОПОЗИЦІЯ',
        success: 'ГОТОВО',
        listening: 'СЛУХАЮ',
        speaking: 'ВІДПОВІДАЮ',
        muted: 'Тиша',
        error: 'ПОМИЛКА'
    };
    const UI_STATES = {
        idle: 'ready',
        thinking: 'thinking',
        busy: 'working',
        working: 'working',
        listening: 'listening',
        speaking: 'streaming',
        streaming: 'streaming',
        action: 'action',
        success: 'success',
        muted: 'ready',
        error: 'error'
    };
    const PAGE_HELP_INTENTS = {
        dashboard: 'Поясни dashboard, bottlenecks і наступну найкориснішу дію.',
        tasks: 'Поясни що найважливіше на сторінці задач і що користувач може зробити далі.',
        staff: 'Поясни коротко як допомогти з графіком, змінами, конфліктами і годинами.',
        customers: 'Поясни як допомогти знайти клієнтів, дублікати або контекст по комунікаціях.',
        finance: 'Поясни на що звернути увагу у фінансах саме зараз.',
        analytics: 'Поясни які сигнали в аналітиці найважливіші.',
        chat: 'Поясни як допомогти з повідомленнями, діалогами і відповідями.',
        kleshnya: 'Поясни як користувач може працювати з AI-помічником у CRM.',
        leads: 'Поясни як допомогти з новими лідами, статусами і наступною дією.',
        training: 'Поясни як допомогти з навчанням, тестами і прогресом команди.',
        warehouse: 'Поясни як допомогти знайти залишки, низький сток або історію руху.',
        programs: 'Поясни як допомогти з програмами, пакетами і підбором послуг.',
        hr: 'Поясни як допомогти з персоналом, графіками і HR задачами.',
        designs: 'Поясни як допомогти з дизайнами, каталогами і production pipeline.',
        'art-director': 'Поясни як допомогти з контентом, дизайнами і творчим пайплайном.',
        graduation: 'Поясни як допомогти з випускними подіями, задачами і підготовкою.',
        center: 'Поясни як допомогти керувати операційним центром і контрольними точками.',
        copilot: 'Поясни як допомогти з продажами, follow-up і next best action.',
        sound: 'Поясни як допомогти з аудіо, треками і матеріалами.',
        reports: 'Поясни як допомогти зі звітами, ризиками і контрольними висновками.',
        timeline: 'Поясни як допомогти з таймлайном бронювань і поточним днем.'
    };

    const ASSISTANT_CHAT_RETURN_URL_KEY = 'eg_assistant_chat_return_url';
    const ASSISTANT_CHAT_RETURN_LABEL_KEY = 'eg_assistant_chat_return_label';
    const ASSISTANT_CHAT_REOPEN_KEY = 'eg_assistant_chat_reopen_panel';
    const ASSISTANT_CHAT_TRANSCRIPT_KEY = 'eg_assistant_chat_transcript_v1';
    const ASSISTANT_CHAT_SYNC_CHANNEL_KEY = 'eg_assistant_chat_synced_channel_id';
    const ASSISTANT_CHAT_SESSION_KEY = 'eg_crm_assistant_session_id';
    const ASSISTANT_CHAT_HISTORY_KEY = 'eg_crm_assistant_history_v2';
    const ASSISTANT_CHAT_CONVERSATION_KEY = 'eg_crm_assistant_conversation_id_v2';
    const ASSISTANT_CHAT_HISTORY_LIMIT = 80;

    let state = {
        mode: localStorage.getItem('eg_crm_assistant_voice') === 'off' ? 'muted' : 'idle',
        subtitle: 'Я поруч, якщо треба допомога по сторінці.',
        tickerText: '',
        lastSpokenLine: '',
        voiceEnabled: localStorage.getItem('eg_crm_assistant_voice') !== 'off',
        playbackState: 'idle',
        voiceBlocked: false,
        subtitleMode: 'static',
        updatedAt: new Date().toISOString()
    };

    function foundation() {
        return window.CrmAssistantFoundation || null;
    }

    function syncFoundationState(patch = {}, source = 'rail') {
        const api = foundation();
        if (!api?.store?.setState) return;
        const nextMode = normalizeMode(patch.mode ?? state.mode);
        const playbackState = patch.playbackState || state.playbackState || (nextMode === 'speaking' ? 'speaking' : 'idle');
        api.store.setState({
            mode: nextMode,
            pageId: getCurrentPageKey(),
            roleSnapshot: api.store.getState?.().roleSnapshot,
            lastAssistantSummaryLine: patch.lastSpokenLine || patch.subtitle || state.lastSpokenLine || state.subtitle || '',
            voiceEnabled: Object.prototype.hasOwnProperty.call(patch, 'voiceEnabled') ? patch.voiceEnabled === true : state.voiceEnabled,
            muted: nextMode === 'muted',
            speaking: nextMode === 'speaking' || playbackState === 'playing',
            playbackState
        }, { source });
    }

    function getFoundationContext(extra = {}) {
        const api = foundation();
        if (!api?.buildContext) return null;
        try {
            return api.buildContext({ page: getCurrentPageKey(), ...extra });
        } catch (err) {
            console.warn('[crm-assistant] foundation context failed:', err);
            emitTelemetry('foundation_context_failed', {
                module: 'rail:getFoundationContext',
                failureReason: err.message || String(err),
                fallbackShown: true
            });
            return null;
        }
    }

    async function refreshFoundationContext(options = {}) {
        const api = foundation();
        if (!api?.refreshContext) return null;
        try {
            return await api.refreshContext({ page: getCurrentPageKey(), ...options });
        } catch (err) {
            console.warn('[crm-assistant] foundation snapshot refresh failed:', err);
            emitTelemetry('snapshot_failed', {
                module: 'rail:refreshFoundationContext',
                failureReason: err.message || String(err),
                fallbackShown: true
            });
            return null;
        }
    }

    function normalizeReply(reply, context = {}) {
        const api = foundation();
        if (!api?.normalizeReply) return reply;
        try {
            return api.normalizeReply(reply, context);
        } catch (err) {
            console.warn('[crm-assistant] reply normalization failed:', err);
            return reply;
        }
    }

    function emitTelemetry(eventType, details = {}) {
        const api = foundation();
        if (api?.telemetry?.emit) {
            return api.telemetry.emit(eventType, { module: 'rail', page: getCurrentPageKey(), ...details });
        }
        const token = localStorage.getItem('pzp_token');
        if (!token || typeof fetch !== 'function') return false;
        fetch('/api/crm-assistant/telemetry', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({
                eventType,
                page: getCurrentPageKey(),
                module: details.module || 'rail',
                assistantState: details.assistantState || state.mode,
                playbackState: details.playbackState || state.playbackState,
                failureReason: details.failureReason || details.reason || '',
                fallbackShown: details.fallbackShown === true,
                actionId: details.actionId || '',
                targetId: details.targetId || '',
                snapshotKey: details.snapshotKey || '',
                source: 'assistant-rail'
            }),
            keepalive: true
        }).catch(() => {});
        return true;
    }
    let mediaRecorder = null;
    let audioChunks = [];
    let listeningStream = null;
    let audioPlayer = null;
    let audioUrl = null;
    let speechSynthesisUtterance = null;
    let history = [];
    let assistantConversationId = sessionStorage.getItem('eg_crm_assistant_conversation_id') || '';
    let assistantHistoryLoadedForKey = '';
    let assistantSessionId = '';
    let proactiveTimer = null;
    let proactiveShownForPage = null;
    let pageInteractionDetected = false;
    let interactionWatchersBound = false;
    let speakingIdleTimer = null;
    let playbackRunId = 0;
    let assistantTurnQueue = Promise.resolve();
    let assistantTurnActive = false;
    let assistantTurnSerial = 0;
    let cancelledTurnSerial = 0;
    let listeningAudioContext = null;
    let listeningAnalyser = null;
    let listeningSource = null;
    let listeningMonitorFrame = 0;
    let listeningStartedAt = 0;
    let listeningLastVoiceAt = 0;
    let listeningSpeechStarted = false;
    let listeningNoiseFloor = 0;
    let listeningStopReason = '';
    let initCount = 0;
    let windowBridgeObserver = null;
    const windowBridgePulseMap = new WeakMap();
    const WINDOW_BRIDGE_EFFECTS_ENABLED = false;
    const VOICE_MIN_RECORD_MS = 700;
    const VOICE_START_GRACE_MS = 1700;
    const VOICE_SILENCE_MS = 1150;
    const VOICE_MAX_RECORD_MS = 16000;
    const VOICE_RMS_FLOOR = 0.018;
    const SPEECH_TTS_TIMEOUT_MS = 12000;

    function escapeHtml(value) {
        const div = document.createElement('div');
        div.textContent = String(value ?? '');
        return div.innerHTML;
    }

    function assistantOutputFormatter() {
        return window.CrmAssistantOutputFormat || null;
    }

    function assistantDisplayText(value) {
        const formatter = assistantOutputFormatter();
        if (formatter?.toDisplayText) return formatter.toDisplayText(value);
        return String(value ?? '').replace(/\*\*([^\n]+?)\*\*/g, '$1').trim();
    }

    function renderAssistantInlineOutput(value) {
        const formatter = assistantOutputFormatter();
        if (formatter?.formatInline) return formatter.formatInline(value);
        return escapeHtml(value);
    }

    function renderAssistantHistoryBody(role, value) {
        if (role === 'user') return `<p>${escapeHtml(value)}</p>`;
        const formatter = assistantOutputFormatter();
        if (formatter?.formatReadable) {
            const html = formatter.formatReadable(value);
            if (html) return html;
        }
        return `<p>${escapeHtml(value)}</p>`;
    }

    function normalizeMode(value) {
        return MODES.has(value) ? value : 'idle';
    }

    function getCurrentPageKey() {
        const raw = window.location.pathname.replace(/^\/+/, '').replace(/\.html$/, '').replace(/\/$/, '');
        if (!raw || raw === 'index') return 'timeline';
        return raw;
    }

    function getRole() {
        if (typeof getUserRole === 'function') return getUserRole();
        return window.AppState?.currentUser?.role || null;
    }

    function getAssistantUserScope() {
        const candidates = [window.AppState?.currentUser];
        try {
            const saved = JSON.parse(localStorage.getItem('pzp_current_user') || 'null');
            if (saved) candidates.push(saved);
        } catch {}
        const user = candidates.find(item => item && (item.id || item.userId || item.username || item.name)) || {};
        const raw = user.id || user.userId || user.username || user.name || 'local';
        return String(raw).toLowerCase().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'local';
    }

    function assistantScopedKey(base) {
        return `${base}:${getAssistantUserScope()}`;
    }

    function getAssistantSessionId() {
        if (assistantSessionId) return assistantSessionId;
        const key = assistantScopedKey(ASSISTANT_CHAT_SESSION_KEY);
        try {
            assistantSessionId = sessionStorage.getItem(key) || '';
            if (!assistantSessionId) {
                assistantSessionId = `asst-session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
                sessionStorage.setItem(key, assistantSessionId);
            }
            sessionStorage.setItem(ASSISTANT_CHAT_SESSION_KEY, assistantSessionId);
        } catch {
            assistantSessionId = assistantSessionId || `asst-session-${Date.now().toString(36)}`;
        }
        return assistantSessionId;
    }

    function roleLabel(role) {
        if (!role) return '';
        if (window.ROLE_NAMES && window.ROLE_NAMES[role]) return window.ROLE_NAMES[role];
        return role;
    }

    function getAssetVersion() {
        const script = Array.from(document.scripts).find(item => /(^|\/)js\/auth\.js/.test(item.getAttribute('src') || ''));
        if (!script) return '';
        try {
            return new URL(script.src, window.location.href).searchParams.get('v') || '';
        } catch {
            return '';
        }
    }

    function ensureAssistantRailHost(headerContent) {
        let status = headerContent.querySelector('#crmAssistantTopStatus');
        if (!status) {
            status = document.createElement('div');
            status.id = 'crmAssistantTopStatus';
            status.className = 'crm-assistant-top-status';
            status.innerHTML = `
                <span class="crm-assistant-top-status-dot" aria-hidden="true"></span>
                <span>Помічник</span>
                <span aria-hidden="true">·</span>
                <strong id="crmAssistantTopStatusLabel">готова</strong>
            `;
            const firstControl = headerContent.querySelector('.btn-search, .user-panel');
            if (firstControl) headerContent.insertBefore(status, firstControl);
            else headerContent.prepend(status);
        }

        let host = document.getElementById('crmAssistantRailHost');
        if (!host) {
            host = document.createElement('div');
            host.id = 'crmAssistantRailHost';
            host.className = 'crm-assistant-rail-host';
            host.setAttribute('aria-hidden', 'false');
        }
        host.dataset.mount = 'top-menu';
        const firstHeaderControl = headerContent.querySelector('#globalHeaderSearchBtn, .btn-search, .user-panel');
        if (host.parentElement !== headerContent) {
            if (firstHeaderControl) headerContent.insertBefore(host, firstHeaderControl);
            else headerContent.appendChild(host);
        } else if (firstHeaderControl && firstHeaderControl.previousElementSibling !== host) {
            headerContent.insertBefore(host, firstHeaderControl);
        }
        headerContent.classList.add('assistant-rail-mounted');
        return host;
    }

    function ensureMounted() {
        const headerContent = document.querySelector('.header .header-content');
        if (!headerContent) return false;

        const legacyDashboardRail = document.getElementById('dashboardAssistantRail');
        if (legacyDashboardRail) legacyDashboardRail.remove();

        const host = ensureAssistantRailHost(headerContent);
        const existingRail = document.getElementById('crmAssistantRail');
        if (existingRail) {
            if (existingRail.parentElement !== host) host.appendChild(existingRail);
            bindRailControls();
            render();
            return true;
        }

        const rail = document.createElement('div');
        rail.id = 'crmAssistantRail';
        rail.className = 'crm-assistant-rail';
        rail.setAttribute('data-mode', state.mode);
        rail.setAttribute('data-ai-state', UI_STATES[state.mode] || 'ready');
        rail.setAttribute('aria-live', 'polite');
        rail.setAttribute('aria-label', 'Стан голосового AI-помічника');
        rail.innerHTML = `
            <div class="assistant-rail-presence">
                <button type="button" class="assistant-rail-avatar assistant-rail-avatar-btn" id="crmAssistantRailAvatar" title="Відкрити повну AI-картку" aria-label="Відкрити повну AI-картку">
                    <span class="assistant-rail-avatar-core" aria-hidden="true">
                        <span class="assistant-rail-avatar-screen">
                            <span class="assistant-rail-avatar-eye assistant-rail-avatar-eye--left"></span>
                            <span class="assistant-rail-avatar-eye assistant-rail-avatar-eye--right"></span>
                            <span class="assistant-rail-avatar-mouth"></span>
                        </span>
                    </span>
                </button>
                <div class="assistant-rail-presence-copy">
                    <div class="assistant-rail-topline">
                        <span class="assistant-rail-name">Помічник</span>
                        <span class="assistant-rail-state assistant-state-idle" id="crmAssistantRailState">Готовий</span>
                        <span class="assistant-rail-signal-chip" aria-hidden="true"><strong id="crmAssistantSignalCount">0</strong><small>сигн.</small></span>
                        <span class="assistant-rail-engine">CRM guide</span>
                    </div>
                    <div class="assistant-rail-context-strip" aria-label="Контекст AI-помічника">
                        <button type="button" class="assistant-rail-context-chip" data-crm-assistant-context-prompt="Поясни, що найважливіше на поточній сторінці">
                            <span>Екран</span><strong id="crmAssistantPageChip">Сторінка</strong>
                        </button>
                        <button type="button" class="assistant-rail-context-chip" data-crm-assistant-context-prompt="Що мені робити далі в моїй ролі?">
                            <span>Роль</span><strong id="crmAssistantRoleChip">CRM</strong>
                        </button>
                        <button type="button" class="assistant-rail-context-chip" data-crm-assistant-context-prompt="Покажи ризики, сигнали і наступну дію">
                            <span>Фокус</span><strong id="crmAssistantFocusChip">Готово</strong>
                        </button>
                    </div>
                    <div class="assistant-rail-prompts" aria-label="Швидкі запити до Помічника">
                        <button type="button" data-crm-assistant-inline-prompt="Брифінг на сьогодні">› Брифінг</button>
                        <button type="button" data-crm-assistant-inline-prompt="Хто гарячі ліди?">› Гарячі ліди</button>
                        <button type="button" data-crm-assistant-inline-prompt="Скласти зміну">› Зміна</button>
                    </div>
                </div>
            </div>
            <div class="assistant-rail-subtitles-wrap" id="crmAssistantRailSubtitlesWrap" role="button" tabindex="0" title="Відкрити відповідь у чаті" aria-label="Відкрити відповідь Помічника у чаті">
                <div class="assistant-rail-subtitles" id="crmAssistantRailSubtitles">Я поруч, якщо треба допомога по сторінці.</div>
            </div>
            <div class="assistant-rail-actions" aria-label="Керування AI-помічником">
                <form class="assistant-rail-inline-form" id="crmAssistantInlineForm" role="search">
                    <span class="assistant-rail-inline-search" aria-hidden="true">⌕</span>
                    <input id="crmAssistantInlineInput" type="text" maxlength="240" autocomplete="off" placeholder="Запитати або /команда">
                    <span class="assistant-rail-inline-hint" aria-hidden="true">/</span>
                </form>
                <button type="button" class="assistant-rail-btn assistant-rail-btn-primary" id="crmAssistantMicBtn" title="Голосовий ввід з авто-паузою" aria-label="Голосовий ввід з авто-паузою">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z"/><path d="M19 11a7 7 0 0 1-14 0"/><path d="M12 18v3"/><path d="M8 21h8"/></svg>
                </button>
                <button type="button" class="assistant-rail-btn" id="crmAssistantStopBtn" title="Зупинити голос або відповідь" aria-label="Зупинити голос або відповідь" disabled>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8h8v8H8z"/></svg>
                </button>
                <button type="button" class="assistant-rail-btn" id="crmAssistantVoiceToggle" title="Увімкнути або вимкнути озвучення" aria-label="Увімкнути або вимкнути озвучення">
                    <svg class="assistant-rail-icon-sound" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15 9.5a4 4 0 0 1 0 5"/><path d="M18 7a8 8 0 0 1 0 10"/></svg>
                    <svg class="assistant-rail-icon-muted" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="m19 9-5 5"/><path d="m14 9 5 5"/></svg>
                </button>
                <button type="button" class="assistant-rail-btn" id="crmAssistantReplayBtn" title="Повторити останню репліку" aria-label="Повторити останню репліку">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 1 2.34 5.66"/><path d="M4 18v-6h6"/></svg>
                </button>
                <button type="button" class="assistant-rail-btn" id="crmAssistantExpandBtn" title="Розгорнути AI-помічника" aria-label="Розгорнути AI-помічника">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
                </button>
            </div>
        `;

        host.appendChild(rail);

        bindRailControls();
        render();
        return true;
    }

    function bindRailControls() {
        const rail = document.getElementById('crmAssistantRail');
        if (!rail || rail.dataset.controlsBound === 'true') return;
        rail.dataset.controlsBound = 'true';
        rail.addEventListener('pointerdown', primeAssistantVoicePlayback, { passive: true });
        rail.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') primeAssistantVoicePlayback();
        });
        document.getElementById('crmAssistantRailAvatar')?.addEventListener('click', expand);
        document.getElementById('crmAssistantMicBtn')?.addEventListener('click', toggleListening);
        document.getElementById('crmAssistantStopBtn')?.addEventListener('click', stopAssistantActivity);
        document.getElementById('crmAssistantVoiceToggle')?.addEventListener('click', toggleVoice);
        document.getElementById('crmAssistantReplayBtn')?.addEventListener('click', replayLastLine);
        document.getElementById('crmAssistantExpandBtn')?.addEventListener('click', expand);
        const subtitlesWrap = document.getElementById('crmAssistantRailSubtitlesWrap');
        subtitlesWrap?.addEventListener('click', openAssistantChatFromText);
        subtitlesWrap?.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            openAssistantChatFromText();
        });
        document.getElementById('crmAssistantInlineForm')?.addEventListener('submit', event => {
            event.preventDefault();
            primeAssistantVoicePlayback();
            const input = document.getElementById('crmAssistantInlineInput');
            const text = String(input?.value || '').trim();
            if (input) input.value = '';
            submitPromptText(text);
        });
        rail.querySelectorAll('[data-crm-assistant-inline-prompt]').forEach(btn => {
            btn.addEventListener('click', () => runQuickPrompt(btn.dataset.crmAssistantInlinePrompt || btn.textContent || ''));
        });
        rail.querySelectorAll('[data-crm-assistant-context-prompt]').forEach(btn => {
            btn.addEventListener('click', () => runQuickPrompt(btn.dataset.crmAssistantContextPrompt || btn.textContent || ''));
        });
    }

    function openAssistantChatFromText() {
        const line = String(state.tickerText || state.subtitle || '').trim();
        if (line && !history.some(item => item.role === 'assistant' && item.text === line)) {
            appendHistory('assistant', line);
        }
        expand();
        window.setTimeout(() => {
            const historyPanel = document.getElementById('crmAssistantHistory');
            const input = document.getElementById('crmAssistantPromptInput');
            historyPanel?.scrollIntoView?.({ block: 'nearest' });
            input?.focus();
        }, 50);
    }

    function assistantTickerThreshold(mode = state.mode) {
        if (mode === 'speaking' || mode === 'streaming') return 70;
        if (mode === 'action' || mode === 'success' || mode === 'error') return 76;
        if (mode === 'thinking' || mode === 'busy' || mode === 'working') return 84;
        return 92;
    }

    function shouldSubtitleScroll(text = '', wrap = null, el = null, mode = state.mode) {
        const normalized = String(text).trim();
        if (!normalized || mode === 'listening' || mode === 'muted') return false;
        if (normalized.length >= assistantTickerThreshold(mode)) return true;
        const overflows = !!(wrap && el && (
            el.scrollWidth > wrap.clientWidth + 32 ||
            el.scrollHeight > wrap.clientHeight + 8
        ));
        return overflows;
    }

    function clearSpeakingIdleTimer() {
        if (!speakingIdleTimer) return;
        window.clearTimeout(speakingIdleTimer);
        speakingIdleTimer = null;
    }

    function scheduleSpeakingIdleFallback(text) {
        clearSpeakingIdleTimer();
        const holdMs = Math.min(9000, Math.max(3800, String(text || '').length * 55));
        speakingIdleTimer = window.setTimeout(() => {
            speakingIdleTimer = null;
            if (state.mode === 'speaking' && state.lastSpokenLine === text) {
                playbackRunId += 1;
                releaseAudioPlayer();
                setState({ mode: 'idle', playbackState: 'timeout', tickerText: '' });
            }
        }, holdMs);
    }

    function isLiveMode(mode) {
        return ['thinking', 'listening', 'speaking', 'busy', 'working', 'streaming', 'action'].includes(mode);
    }

    function isAssistantTurnCancelled(turnId) {
        return Number(turnId || 0) <= cancelledTurnSerial;
    }

    function enqueueAssistantTurn(runTurn, options = {}) {
        const turnId = ++assistantTurnSerial;
        const label = String(options.label || 'запит').trim();
        if (assistantTurnActive) {
            setState({
                mode: 'busy',
                subtitle: `Додав у чергу: ${label}. Завершу поточний крок і відповім.`,
                tickerText: '',
                playbackState: 'queued'
            });
        }
        assistantTurnQueue = assistantTurnQueue
            .catch(() => {})
            .then(async () => {
                if (isAssistantTurnCancelled(turnId)) return;
                assistantTurnActive = true;
                render();
                try {
                    await runTurn(turnId);
                } finally {
                    assistantTurnActive = false;
                    render();
                }
            });
        return assistantTurnQueue;
    }

    function cancelQueuedAssistantTurns() {
        cancelledTurnSerial = assistantTurnSerial;
    }

    function stopAssistantActivity() {
        cancelProactiveHelp();
        cancelQueuedAssistantTurns();
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            requestRecorderStop('cancelled');
        }
        stopAudioPlayback({ setIdle: false, reason: 'stopped' });
        cleanupListeningAnalysis();
        stopListeningStream();
        setState({
            mode: state.voiceEnabled ? 'idle' : 'muted',
            subtitle: 'Зупинено. Можна продовжити текстом або голосом.',
            tickerText: '',
            playbackState: 'stopped'
        });
    }

    function render() {
        const rail = document.getElementById('crmAssistantRail');
        const stateEl = document.getElementById('crmAssistantRailState');
        const subtitlesWrap = document.getElementById('crmAssistantRailSubtitlesWrap');
        const subtitlesEl = document.getElementById('crmAssistantRailSubtitles');
        const voiceBtn = document.getElementById('crmAssistantVoiceToggle');
        const micBtn = document.getElementById('crmAssistantMicBtn');
        const stopBtn = document.getElementById('crmAssistantStopBtn');
        const replayBtn = document.getElementById('crmAssistantReplayBtn');
        if (!rail || !stateEl || !subtitlesEl || !voiceBtn) return;

        const text = state.tickerText || state.subtitle || '...';
        const displayText = assistantDisplayText(text) || '...';
        const snapshot = buildAssistantSnapshot();
        rail.dataset.mode = state.mode;
        rail.dataset.aiState = UI_STATES[state.mode] || 'ready';
        rail.dataset.live = isLiveMode(state.mode) ? 'true' : 'false';
        rail.dataset.playbackState = state.playbackState || 'idle';
        rail.dataset.subtitleMode = state.subtitleMode || 'static';
        rail.dataset.voice = state.voiceEnabled ? 'on' : 'off';
        rail.dataset.turnActive = assistantTurnActive ? 'true' : 'false';
        stateEl.textContent = LABELS[state.mode] || LABELS.idle;
        stateEl.className = `assistant-rail-state assistant-state-${state.mode}`;
        const signalCount = document.getElementById('crmAssistantSignalCount');
        const pageChip = document.getElementById('crmAssistantPageChip');
        const roleChip = document.getElementById('crmAssistantRoleChip');
        const focusChip = document.getElementById('crmAssistantFocusChip');
        if (signalCount) signalCount.textContent = String(snapshot.signalCount);
        if (pageChip) {
            pageChip.textContent = snapshot.page;
            pageChip.title = snapshot.pageFull;
        }
        if (roleChip) {
            roleChip.textContent = snapshot.role;
            roleChip.title = snapshot.role;
        }
        if (focusChip) {
            focusChip.textContent = snapshot.focus;
            focusChip.title = snapshot.focusFull;
        }
        renderPanelSnapshot();
        const topStatus = document.getElementById('crmAssistantTopStatus');
        const topStatusLabel = document.getElementById('crmAssistantTopStatusLabel');
        if (topStatus) topStatus.dataset.aiState = UI_STATES[state.mode] || 'ready';
        if (topStatusLabel) topStatusLabel.textContent = (LABELS[state.mode] || LABELS.idle).toLowerCase();
        if (subtitlesWrap) {
            subtitlesWrap.title = displayText;
            subtitlesWrap.setAttribute('aria-label', `Відкрити відповідь Помічника у чаті: ${displayText}`);
        }
        subtitlesEl.innerHTML = renderAssistantInlineOutput(text);
        subtitlesEl.setAttribute('aria-label', displayText);
        subtitlesEl.classList.remove('is-ticker', 'is-live-line');
        subtitlesEl.removeAttribute('data-ticker-text');
        subtitlesEl.style.removeProperty('--assistant-ticker-duration');
        voiceBtn.setAttribute('aria-pressed', state.voiceEnabled ? 'true' : 'false');
        voiceBtn.title = state.voiceBlocked
            ? 'Озвучення заблоковано браузером. Натисни після взаємодії, щоб спробувати знову.'
            : 'Увімкнути або вимкнути озвучення';
        if (micBtn) {
            const listening = mediaRecorder?.state === 'recording' || state.mode === 'listening';
            micBtn.classList.toggle('active', listening);
            micBtn.setAttribute('aria-pressed', listening ? 'true' : 'false');
            micBtn.title = listening ? 'Завершити запис зараз' : 'Голосовий ввід з авто-паузою';
            micBtn.disabled = assistantTurnActive && !listening;
        }
        if (stopBtn) {
            const stoppable = ['thinking', 'busy', 'working', 'listening', 'speaking', 'streaming'].includes(state.mode)
                || Boolean(audioPlayer)
                || Boolean(mediaRecorder && mediaRecorder.state === 'recording')
                || assistantTurnActive;
            stopBtn.disabled = !stoppable;
            stopBtn.classList.toggle('active', stoppable);
            stopBtn.title = mediaRecorder?.state === 'recording' ? 'Скасувати запис' : 'Зупинити поточну відповідь';
        }
        if (replayBtn) {
            replayBtn.disabled = !(state.lastSpokenLine || state.subtitle);
            replayBtn.title = state.voiceEnabled ? 'Повторити останню репліку голосом' : 'Показати останню репліку ще раз';
        }

        requestAnimationFrame(() => {
            const liveLine = isLiveMode(state.mode);
            const ticker = shouldSubtitleScroll(displayText, subtitlesWrap, subtitlesEl, state.mode);
            const subtitleMode = ticker ? 'ticker' : liveLine ? 'live' : 'static';
            subtitlesEl.classList.toggle('is-live-line', liveLine);
            subtitlesEl.classList.toggle('is-ticker', ticker);
            subtitlesWrap?.classList.toggle('is-ticker-wrap', ticker);
            rail.dataset.subtitleMode = subtitleMode;
            state.subtitleMode = subtitleMode;
            if (ticker) {
                subtitlesEl.setAttribute('data-ticker-text', displayText);
                const duration = Math.min(34, Math.max(18, Math.ceil(String(displayText).length / 7)));
                subtitlesEl.style.setProperty('--assistant-ticker-duration', `${duration}s`);
            } else {
                subtitlesEl.removeAttribute('data-ticker-text');
                subtitlesEl.style.removeProperty('--assistant-ticker-duration');
            }
        });
    }

    function setState(patch = {}) {
        const nextMode = normalizeMode(patch.mode ?? state.mode);
        state = {
            ...state,
            ...patch,
            mode: nextMode,
            subtitle: Object.prototype.hasOwnProperty.call(patch, 'subtitle') ? String(patch.subtitle || '') : state.subtitle,
            tickerText: Object.prototype.hasOwnProperty.call(patch, 'tickerText') ? String(patch.tickerText || '') : state.tickerText,
            updatedAt: new Date().toISOString()
        };
        syncFoundationState(patch, 'rail:setState');
        render();
    }

    function bindInteractionWatchers() {
        if (interactionWatchersBound) return;
        interactionWatchersBound = true;
        const mark = event => {
            if (event?.target?.closest?.('#crmAssistantRail, #crmAssistantPanelOverlay')) return;
            pageInteractionDetected = true;
            cancelProactiveHelp();
        };
        window.addEventListener('pointerdown', mark, { passive: true });
        window.addEventListener('keydown', mark);
        window.addEventListener('input', mark, { capture: true });
    }

    function isVisibleBridgeWindow(el) {
        if (!el || el.id === 'crmAssistantPanelOverlay' || el.closest?.('#crmAssistantPanelOverlay')) return false;
        if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
        const style = window.getComputedStyle?.(el);
        if (style && (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)) return false;
        const rect = el.getBoundingClientRect?.();
        return !!rect && rect.width > 80 && rect.height > 60;
    }

    function activeBridgeWindows() {
        const selectors = [
            '.lead-workspace.active',
            '.lead-modal-overlay.active',
            '.modal:not(.hidden)',
            '.confirm-overlay',
            '.alerts-panel-v4.open',
            '.achievement-overlay-visible',
            '[role="dialog"]:not(.hidden)'
        ];
        const windows = [];
        selectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(el => {
                if (isVisibleBridgeWindow(el) && !windows.includes(el)) windows.push(el);
            });
        });
        return windows;
    }

    function bridgePulseAllowed(target) {
        const now = Date.now();
        const prev = windowBridgePulseMap.get(target) || 0;
        if (now - prev < 1800) return false;
        windowBridgePulseMap.set(target, now);
        return true;
    }

    function bridgeVisualTarget(target) {
        if (!target?.querySelector) return target;
        if (target.id === 'crmAssistantPanelOverlay') return target.querySelector('.crm-assistant-panel') || target;
        return target.querySelector('.lead-modal, .modal-content, .confirm-modal, .achievement-modal, .alerts-panel-v4') || target;
    }

    function renderWindowBridgeBurst(target) {
        if (!WINDOW_BRIDGE_EFFECTS_ENABLED) return;
        if (!target || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
        const rect = target.getBoundingClientRect?.();
        if (!rect || rect.width < 1 || rect.height < 1) return;
        const burst = document.createElement('div');
        burst.className = 'crm-assistant-magic-burst';
        burst.setAttribute('aria-hidden', 'true');
        burst.style.setProperty('--bridge-x', `${Math.max(0, rect.left)}px`);
        burst.style.setProperty('--bridge-y', `${Math.max(0, rect.top)}px`);
        burst.style.setProperty('--bridge-w', `${Math.max(1, rect.width)}px`);
        burst.style.setProperty('--bridge-h', `${Math.max(1, rect.height)}px`);
        burst.innerHTML = Array.from({ length: 12 }, (_, idx) => `<span class="crm-assistant-magic-dot crm-assistant-magic-dot--${idx + 1}"></span>`).join('');
        document.body.appendChild(burst);
        window.setTimeout(() => burst.remove(), 1200);
    }

    function pulseAssistantWindowBridge(target, options = {}) {
        if (!WINDOW_BRIDGE_EFFECTS_ENABLED) return false;
        const rawTarget = target?.nodeType === 1 ? target : document.getElementById('crmAssistantPanelOverlay');
        const bridgeTarget = bridgeVisualTarget(rawTarget);
        if (!bridgeTarget || !bridgePulseAllowed(bridgeTarget)) return false;

        const rail = document.getElementById('crmAssistantRail');
        const panelOverlay = document.getElementById('crmAssistantPanelOverlay');
        const panel = panelOverlay?.querySelector('.crm-assistant-panel');
        [rail, panelOverlay, panel].forEach(el => el?.classList.add('is-window-bridge'));
        if (!bridgeTarget.closest?.('#crmAssistantPanelOverlay')) {
            bridgeTarget.classList.add('crm-assistant-linked-window', 'crm-assistant-window-entering');
        }

        renderWindowBridgeBurst(bridgeTarget.closest?.('#crmAssistantPanelOverlay') ? (panel || bridgeTarget) : bridgeTarget);

        const holdMs = Number(options.holdMs) || 1200;
        window.setTimeout(() => {
            [rail, panelOverlay, panel].forEach(el => el?.classList.remove('is-window-bridge'));
            bridgeTarget.classList.remove('crm-assistant-window-entering');
        }, holdMs);
        window.setTimeout(() => {
            bridgeTarget.classList.remove('crm-assistant-linked-window');
        }, holdMs + 650);
        return true;
    }

    function scanAssistantWindowBridge() {
        if (!WINDOW_BRIDGE_EFFECTS_ENABLED) return;
        const target = activeBridgeWindows().pop();
        if (target) pulseAssistantWindowBridge(target);
    }

    function initAssistantWindowBridge() {
        if (!WINDOW_BRIDGE_EFFECTS_ENABLED) return;
        if (windowBridgeObserver || !document.body || typeof MutationObserver === 'undefined') return;
        windowBridgeObserver = new MutationObserver(() => scanAssistantWindowBridge());
        windowBridgeObserver.observe(document.body, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['class', 'hidden', 'style', 'aria-hidden']
        });
        window.setTimeout(scanAssistantWindowBridge, 80);
    }

    function scheduleProactiveHelp(context = {}) {
        cancelProactiveHelp();
        const pageKey = getCurrentPageKey();
        if (proactiveShownForPage === pageKey) return;
        if (['thinking', 'busy', 'listening', 'speaking'].includes(state.mode)) return;

        pageInteractionDetected = false;
        bindInteractionWatchers();
        proactiveTimer = window.setTimeout(async () => {
            proactiveTimer = null;
            if (pageInteractionDetected || document.hidden) return;
            if (['thinking', 'busy', 'listening', 'speaking'].includes(state.mode)) return;
            proactiveShownForPage = pageKey;
            await announcePageContext({ ...context, proactive: true, textOnly: !state.voiceEnabled });
        }, 5000);
    }

    function cancelProactiveHelp() {
        if (!proactiveTimer) return;
        clearTimeout(proactiveTimer);
        proactiveTimer = null;
    }

    function collectDashboardContext() {
        const getDashboardContext = window.DashboardPage?.getAssistantContext;
        if (typeof getDashboardContext === 'function') {
            try { return getDashboardContext() || {}; } catch {}
        }
        const widgets = Array.from(document.querySelectorAll('#dashboardGrid [data-widget]'))
            .map(el => el.dataset.widget)
            .filter(Boolean)
            .slice(0, 30);
        return widgets.length ? { widgets } : {};
    }

    function collectPageHints() {
        const activeTab = document.querySelector('[aria-selected="true"], .tab-btn.active, .nav-tab.active, .period-btn.active, .filter-btn.active');
        const badges = Array.from(document.querySelectorAll('.badge, .status-badge, .count-badge, .alert-badge'))
            .map(el => el.textContent?.trim())
            .filter(Boolean)
            .slice(0, 8);
        return {
            activeTab: activeTab?.textContent?.trim() || '',
            badges
        };
    }

    function compactText(value, fallback = '', limit = 36) {
        const text = String(value || fallback || '').replace(/\s+/g, ' ').trim();
        if (text.length <= limit) return text;
        return `${text.slice(0, Math.max(0, limit - 1)).trim()}…`;
    }

    function visibleText(selector, limit = 6) {
        return Array.from(document.querySelectorAll(selector))
            .filter(el => {
                const rect = el.getBoundingClientRect?.();
                return !rect || (rect.width > 0 && rect.height > 0);
            })
            .map(el => el.textContent?.replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .slice(0, limit);
    }

    function formatAssistantLocalDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function normalizeAssistantDate(value) {
        if (!value) return '';
        if (value instanceof Date && !Number.isNaN(value.getTime())) return formatAssistantLocalDate(value);
        const raw = String(value || '').trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
        const parsed = new Date(raw);
        return Number.isNaN(parsed.getTime()) ? '' : formatAssistantLocalDate(parsed);
    }

    function formatAssistantDisplayDate(dateStr = '') {
        const raw = normalizeAssistantDate(dateStr);
        if (!raw) return '';
        const [year, month, day] = raw.split('-');
        return `${day}.${month}.${year}`;
    }

    function getVisibleTimelineDate() {
        const stateDate = normalizeAssistantDate(window.AppState?.selectedDate);
        const inputDate = normalizeAssistantDate(document.getElementById('timelineDate')?.value);
        const date = stateDate || inputDate || formatAssistantLocalDate(new Date());
        return {
            date,
            source: stateDate || inputDate ? 'visible_timeline_date' : 'local_today'
        };
    }

    function getRelativeTimelineDate(raw = '') {
        const text = String(raw || '').toLowerCase();
        const date = new Date();
        if (/післязавтра|after tomorrow/i.test(text)) {
            date.setDate(date.getDate() + 2);
            return { date: formatAssistantLocalDate(date), label: 'післязавтра', explicit: true };
        }
        if (/завтра|tomorrow/i.test(text)) {
            date.setDate(date.getDate() + 1);
            return { date: formatAssistantLocalDate(date), label: 'завтра', explicit: true };
        }
        if (/сьогодні|today/i.test(text)) {
            return { date: formatAssistantLocalDate(date), label: 'сьогодні', explicit: true };
        }
        return null;
    }

    function getTimelineScheduleQueryDate(raw = '') {
        const text = String(raw || '').toLowerCase();
        const explicit = getRelativeTimelineDate(text);
        const visible = getVisibleTimelineDate();
        const asksVisiblePage = /(видим|екран|сторін|відкрит|поточн|зараз|visible|screen|page|current|opened)/i.test(text);

        if ((!explicit || asksVisiblePage) && visible.date) {
            const today = formatAssistantLocalDate(new Date());
            return {
                date: visible.date,
                label: visible.date === today ? 'сьогодні' : `видимій даті ${formatAssistantDisplayDate(visible.date)}`,
                source: visible.source,
                visibleDateUsed: true
            };
        }

        return explicit || { date: visible.date || formatAssistantLocalDate(new Date()), label: 'сьогодні', source: 'local_today' };
    }

    function isTimelineScheduleQuery(raw = '') {
        if (getCurrentPageKey() !== 'timeline') return false;
        const text = String(raw || '').toLowerCase();
        const asksSchedule = /(заход|захор|поді[яї]|брон|івент|event|booking|афіш)/i.test(text);
        const asksDate = /(сьогодні|завтра|післязавтра|today|tomorrow|after tomorrow)/i.test(text);
        const asksVisiblePage = /(видим|екран|сторін|відкрит|поточн|зараз|visible|screen|page|current|opened|таймлайн|timeline)/i.test(text);
        const asksReadOnly = /(які|що|скажи|покажи|розкажи|список|є|скільки|what|show|tell|list)/i.test(text);
        return asksSchedule && asksReadOnly && (asksDate || asksVisiblePage);
    }

    function assistantReadonlyHeaders() {
        if (typeof getAuthHeaders === 'function') return getAuthHeaders(false);
        const token = localStorage.getItem('pzp_token') || '';
        return token ? { Authorization: `Bearer ${token}` } : {};
    }

    function normalizeAssistantScheduleResponse(data, preferredKeys = []) {
        if (Array.isArray(data)) return data;
        if (!data || typeof data !== 'object') return [];
        const keys = [...preferredKeys, 'bookings', 'afisha', 'items', 'events', 'data', 'rows', 'results'];
        for (const key of keys) {
            if (Array.isArray(data[key])) return data[key];
        }
        return [];
    }

    async function fetchAssistantScheduleJson(url, preferredKeys = []) {
        const response = await fetch(url, { headers: assistantReadonlyHeaders() });
        if (!response.ok) throw new Error(`timeline_schedule_http_${response.status}`);
        const data = await response.json().catch(() => []);
        return normalizeAssistantScheduleResponse(data, preferredKeys);
    }

    function isVisibleAssistantTimelineBlock(el) {
        if (!el || el.classList?.contains('status-hidden')) return false;
        const rect = el.getBoundingClientRect?.();
        return !rect || (rect.width > 0 && rect.height > 0);
    }

    function collectVisibleTimelineBlocks(selector, type = 'booking') {
        return Array.from(document.querySelectorAll(selector))
            .filter(isVisibleAssistantTimelineBlock)
            .map((el, index) => {
                const title = compactText(el.querySelector('.title')?.textContent || el.getAttribute('aria-label') || el.textContent || '', '', 90);
                const subtitle = compactText(el.querySelector('.subtitle')?.textContent || '', '', 36);
                const time = (subtitle.match(/\b\d{1,2}:\d{2}\b/) || title.match(/\b\d{1,2}:\d{2}\b/) || [])[0] || '';
                return {
                    id: el.dataset.bookingId || el.dataset.afishaId || `${type}-dom-${index}`,
                    label: title,
                    title,
                    time,
                    status: type === 'booking' && el.classList.contains('preliminary') ? 'preliminary' : '',
                    source: 'timeline_schedule_visible_dom'
                };
            })
            .filter(item => item.title || item.time);
    }

    function collectVisibleTimelineBookings() {
        return collectVisibleTimelineBlocks('#timelineLines .booking-block:not(.afisha-block)', 'booking');
    }

    function collectVisibleTimelineAfisha() {
        return collectVisibleTimelineBlocks('#timelineLines .afisha-block', 'afisha');
    }

    function mergeScheduleItems(apiItems = [], domItems = [], type = 'booking') {
        const merged = [];
        const seen = new Set();
        [...apiItems, ...domItems].forEach((item, index) => {
            const id = item?.id || item?.bookingId || item?.booking_id || item?.afishaId || item?.afisha_id;
            const title = item?.title || item?.label || item?.programName || item?.program || item?.name || '';
            const time = item?.time || item?.startTime || item?.starts_at || '';
            const domSyntheticTime = item?.source === 'timeline_schedule_visible_dom' && type === 'afisha' && time ? `:${time}` : '';
            const key = id ? `${type}:id:${id}${domSyntheticTime}` : `${type}:text:${time}:${title}:${index}`;
            if (seen.has(key)) return;
            seen.add(key);
            merged.push(item);
        });
        return merged;
    }

    function scheduleItemTime(item = {}) {
        return compactText(item.time || item.startTime || item.starts_at || item.start || '', '', 8);
    }

    function scheduleItemTitle(item = {}, fallback = 'Подія') {
        return compactText(
            item.label || item.title || item.name || item.programName || item.program || item.programCode || item.groupName || fallback,
            fallback,
            58
        );
    }

    function formatTimelineScheduleItem(item = {}, type = 'booking') {
        const time = scheduleItemTime(item);
        const title = scheduleItemTitle(item, type === 'afisha' ? 'Подія афіші' : 'Бронювання');
        const room = compactText(item.room || item.hall || item.location || '', '', 28);
        const status = compactText(item.status || item.state || '', '', 24);
        const kids = Number(item.kidsCount ?? item.childrenCount ?? item.children ?? 0);
        const details = [room, kids > 0 ? `${kids} дітей` : '', status].filter(Boolean).join(', ');
        return `${time ? `${time} — ` : ''}${title}${details ? ` (${details})` : ''}`;
    }

    function buildTimelineScheduleReply({ label, bookings = [], afisha = [] } = {}) {
        const bookingCount = bookings.length;
        const afishaCount = afisha.length;
        const total = bookingCount + afishaCount;
        if (!total) {
            return `На ${label} у видимому таймлайні немає бронювань або подій афіші. Дій не виконую — це тільки перегляд розкладу.`;
        }
        const lines = [
            ...bookings.map(item => formatTimelineScheduleItem(item, 'booking')),
            ...afisha.map(item => formatTimelineScheduleItem(item, 'afisha'))
        ].filter(Boolean).slice(0, 6);
        const more = total > lines.length ? ` Ще ${total - lines.length} елемент(и) не показую, щоб не перевантажувати.` : '';
        return `На ${label} у видимому таймлайні: ${bookingCount} бронювань і ${afishaCount} подій афіші. ${lines.join('; ')}.${more}`;
    }

    async function tryAnswerTimelineScheduleQuery(prompt) {
        if (!isTimelineScheduleQuery(prompt)) return false;
        const query = getTimelineScheduleQueryDate(prompt);
        setState({
            mode: 'thinking',
            subtitle: `Читаю таймлайн на ${query.label}...`,
            tickerText: '',
            playbackState: 'idle'
        });
        try {
            const [bookings, afisha] = await Promise.all([
                fetchAssistantScheduleJson(`/api/bookings/${encodeURIComponent(query.date)}`, ['bookings']),
                fetchAssistantScheduleJson(`/api/afisha/${encodeURIComponent(query.date)}`, ['afisha', 'events'])
            ]);
            const visibleDate = getVisibleTimelineDate();
            const canUseVisibleDom = query.date === visibleDate.date;
            const visibleBookings = canUseVisibleDom ? collectVisibleTimelineBookings() : [];
            const visibleAfisha = canUseVisibleDom ? collectVisibleTimelineAfisha() : [];
            const scheduleBookings = canUseVisibleDom
                ? mergeScheduleItems(bookings, visibleBookings, 'booking')
                : bookings;
            const scheduleAfisha = canUseVisibleDom
                ? mergeScheduleItems(afisha, visibleAfisha, 'afisha')
                : afisha;
            const line = buildTimelineScheduleReply({ label: query.label, bookings: scheduleBookings, afisha: scheduleAfisha });
            await playReply({
                mode: 'guide',
                summary: line,
                subtitle: line,
                text: line,
                evidence: [],
                riskLevel: 'none',
                confidence: 'exact',
                recommendation: null,
                actionProposal: null,
                teachingTarget: null,
                fallbackReason: ''
            });
        } catch (err) {
            emitTelemetry('reply_failed', {
                module: 'rail:timelineScheduleQuery',
                failureReason: err.message || String(err),
                fallbackShown: true
            });
            const line = `Не зміг прочитати таймлайн на ${query.label}: дані зараз недоступні. Дій не виконую — це був лише запит на перегляд розкладу.`;
            await playReply({
                mode: 'guide',
                summary: line,
                subtitle: line,
                text: line,
                fallbackReason: 'timeline_schedule_unavailable'
            }, { textOnly: true });
        }
        return true;
    }

    function buildAssistantSnapshot(context = null) {
        const ctx = context || buildPageGuideContext();
        const foundationSignals = Array.isArray(ctx.signals) ? ctx.signals : [];
        const warningTexts = visibleText('.alert, .warning, .danger, .error, .is-overdue, .status-danger, .guardian-alert, .chat-alert', 8);
        const actionTexts = visibleText('.btn-page-primary, .dashboard-btn.primary, button.primary, .primary-action', 5);
        const rowCount = document.querySelectorAll('tbody tr, .task-card, .lead-card, .booking-card, .report-row, .chat-channel-item').length;
        const signalCount = foundationSignals.length + (ctx.badges || []).length + warningTexts.length;
        const firstSignal = foundationSignals.find(item => item?.label)?.label || '';
        const focus = ctx.contextSummary?.headline || firstSignal || ctx.activeTab || warningTexts[0] || actionTexts[0] || ctx.title || 'Готово';
        return {
            page: compactText(ctx.title || ctx.page || 'Сторінка', 'Сторінка', 34),
            pageFull: ctx.title || ctx.page || 'Сторінка',
            role: compactText(ctx.displayRole || roleLabel(ctx.role) || 'CRM', 'CRM', 28),
            mode: LABELS[state.mode] || LABELS.idle,
            voice: state.voiceEnabled ? 'Голос увімкнено' : 'Текстовий режим',
            focus: compactText(focus, 'Готово', 34),
            focusFull: focus,
            signalCount,
            badges: (ctx.badges || []).slice(0, 6),
            warnings: foundationSignals.map(item => item.evidence || item.label).filter(Boolean).slice(0, 4).concat(warningTexts).slice(0, 8),
            actions: actionTexts,
            rows: rowCount,
            updated: new Date(state.updatedAt || Date.now()).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
        };
    }

    function buildPageGuideContext(extra = {}) {
        const page = getCurrentPageKey();
        const role = getRole();
        const title = document.querySelector('main h1, main h2, h1, h2')?.textContent?.trim() || document.title || page;
        const dashboardContext = page === 'dashboard' ? collectDashboardContext() : {};
        const foundationContext = getFoundationContext({ ...extra, page });
        const roleSnapshot = foundationContext?.roleSnapshot || {};
        return {
            page,
            role: roleSnapshot.permissionRole || roleSnapshot.role || role,
            displayRole: roleSnapshot.displayRole || roleLabel(dashboardContext.scenePreset || role),
            roleSnapshot,
            title,
            view: document.body?.dataset?.view || '',
            intent: PAGE_HELP_INTENTS[page] || 'Допоможи коротко і контекстно по цій сторінці CRM.',
            ...collectPageHints(),
            ...dashboardContext,
            adapterId: foundationContext?.adapterId || '',
            contextSummary: foundationContext?.contextSummary || null,
            signals: foundationContext?.signals || [],
            actions: foundationContext?.actions || [],
            teachingTargets: foundationContext?.teachingTargets || [],
            actionProposal: foundationContext?.actionProposal || null,
            teachingTarget: foundationContext?.teachingTarget || null,
            fallbackReason: foundationContext?.fallbackReason || '',
            ...extra
        };
    }

    function buildRequestPayload(input = {}) {
        const context = buildPageGuideContext(input);
        return {
            userMessage: context.userMessage || context.intent,
            role: context.role,
            displayRole: context.displayRole,
            page: context.page,
            title: context.title,
            view: context.view,
            widgets: context.widgets || [],
            scenePreset: context.scenePreset || '',
            sceneTitle: context.sceneTitle || '',
            intent: context.intent,
            proactive: context.proactive === true,
            activeTab: context.activeTab || '',
            badges: context.badges || [],
            adapterId: context.adapterId || '',
            contextSummary: context.contextSummary || null,
            signals: context.signals || [],
            evidence: context.signals || [],
            actions: context.actions || [],
            teachingTargets: context.teachingTargets || [],
            actionProposal: context.actionProposal || null,
            teachingTarget: context.teachingTarget || null,
            fallbackReason: context.fallbackReason || '',
            roleSnapshot: context.roleSnapshot || null,
            chatHistory: history.slice(-12).map(item => ({
                role: item.role,
                text: item.text,
                at: item.at
            })),
            voiceMode: context.voiceMode === true,
            recentState: {
                mode: state.mode,
                voiceEnabled: state.voiceEnabled,
                previewRole: context.previewRole || localStorage.getItem('pzp_test_role') || ''
            }
        };
    }

    async function requestGuideReply(payloadOrText = {}) {
        await refreshFoundationContext({ force: true });
        const freshInput = typeof payloadOrText === 'string' ? payloadOrText : { ...payloadOrText };
        if (freshInput && typeof freshInput === 'object') {
            ['adapterId', 'contextSummary', 'signals', 'evidence', 'actions', 'teachingTargets', 'actionProposal', 'teachingTarget', 'fallbackReason'].forEach(key => {
                delete freshInput[key];
            });
        }
        const payload = typeof freshInput === 'string'
            ? buildRequestPayload({ userMessage: payloadOrText })
            : buildRequestPayload(freshInput);
        const resp = await fetch('/api/crm-assistant/reply', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + localStorage.getItem('pzp_token')
            },
            body: JSON.stringify(payload)
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.success) throw new Error(data.error || `crm_assistant_reply_http_${resp.status}`);
        return normalizeReply(data.reply, payload);
    }

    function localPageHelpText(context = {}) {
        const page = context.page || getCurrentPageKey();
        const title = context.title || document.querySelector('main h1, main h2, h1, h2')?.textContent?.trim() || 'цій сторінці';
        const role = context.displayRole || roleLabel(getRole());
        const suffix = role ? ` для ролі ${role}` : '';
        const phrase = {
            tasks: 'Бачу сторінку задач. Можу допомогти розібрати пріоритети, прострочене і наступні кроки.',
            finance: 'Бачу фінансовий модуль. Можу підсвітити важливі суми, ризики і контрольні точки.',
            chat: 'Бачу чат. Можу допомогти знайти діалоги, які чекають відповіді або дії.',
            staff: 'Бачу командний модуль. Можу допомогти з графіком, змінами і конфліктами.',
            dashboard: 'Бачу dashboard. Можу коротко пояснити віджети, bottlenecks і наступну найкориснішу дію.'
        }[page];
        return phrase || `Бачу ${title}${suffix}. Можу коротко підказати, що тут важливо і з чого почати.`;
    }

    async function announcePageContext(options = {}) {
        const context = buildPageGuideContext(options);
        const thinking = options.proactive
            ? 'Я на сторінці вже кілька секунд. Готую коротку підказку...'
            : 'Готую підказку по цій сторінці...';
        setState({ mode: 'thinking', subtitle: thinking, tickerText: '' });

        let reply;
        try {
            reply = await requestGuideReply({
                ...context,
                proactive: options.proactive === true,
                voiceMode: state.voiceEnabled && !options.textOnly
            });
        } catch (err) {
            if (String(err?.message || '').includes('openai_not_configured')) {
                reply = { text: localPageHelpText(context), subtitle: localPageHelpText(context) };
            } else {
                emitTelemetry('reply_failed', {
                    module: 'rail:announcePageContext',
                    failureReason: err.message || String(err),
                    fallbackShown: true
                });
                handleError(err, 'Не вдалося підготувати підказку по сторінці.');
                return;
            }
        }

        await playReply(normalizeReply(reply, context), { textOnly: options.textOnly === true });
    }

    function releaseAudioPlayer() {
        if (audioPlayer) {
            try {
                audioPlayer.pause();
                audioPlayer.src = '';
            } catch {}
            audioPlayer = null;
        }
        if (audioUrl) {
            URL.revokeObjectURL(audioUrl);
            audioUrl = null;
        }
        stopBrowserSpeechPlayback();
    }

    function getBrowserSpeechSynthesis() {
        return window.speechSynthesis || null;
    }

    function stopBrowserSpeechPlayback() {
        const synth = getBrowserSpeechSynthesis();
        if (synth && speechSynthesisUtterance) {
            try { synth.cancel(); } catch {}
        }
        speechSynthesisUtterance = null;
    }

    function primeAssistantVoicePlayback() {
        try { getBrowserSpeechSynthesis()?.resume?.(); } catch {}
    }

    function stopAudioPlayback(options = {}) {
        const { setIdle = false, reason = 'interrupted' } = options;
        playbackRunId += 1;
        releaseAudioPlayer();
        clearSpeakingIdleTimer();
        if (setIdle && state.mode === 'speaking') {
            setState({
                mode: state.voiceEnabled ? 'idle' : 'muted',
                playbackState: reason,
                tickerText: ''
            });
        }
    }

    function isPlaybackBlocked(error) {
        const name = String(error?.name || '').toLowerCase();
        const message = String(error?.message || '').toLowerCase();
        return name.includes('notallowed') || name.includes('security') || /autoplay|gesture|user activation|not allowed/.test(message);
    }

    function handlePlaybackFailure(error, line) {
        if (isPlaybackBlocked(error)) {
            emitTelemetry('playback_blocked', {
                module: 'rail:playback',
                playbackState: 'blocked',
                failureReason: error?.message || error?.name || 'playback_blocked',
                fallbackShown: true
            });
            localStorage.setItem('eg_crm_assistant_voice', 'off');
            localStorage.setItem('eg_dashboard_assistant_voice', 'off');
            setState({
                voiceEnabled: false,
                voiceBlocked: true,
                mode: 'muted',
                playbackState: 'blocked',
                subtitle: line,
                tickerText: ''
            });
            return;
        }
        if (String(error?.message || '').includes('speech_synthesis_no_ukrainian_voice')) {
            emitTelemetry('playback_failed', {
                module: 'rail:playback',
                playbackState: 'text-fallback',
                failureReason: 'browser_has_no_ukrainian_voice',
                fallbackShown: true
            });
            setState({
                mode: state.voiceEnabled ? 'idle' : 'muted',
                playbackState: 'text-fallback',
                subtitle: line,
                tickerText: ''
            });
            return;
        }
        emitTelemetry('playback_failed', {
            module: 'rail:playback',
            playbackState: 'error',
            failureReason: error?.message || error?.name || 'playback_failed',
            fallbackShown: true
        });
        setState({
            mode: state.voiceEnabled ? 'idle' : 'muted',
            playbackState: 'error',
            subtitle: line,
            tickerText: ''
        });
    }

    function normalizeBrowserSpeechText(value) {
        return String(value || '')
            .replace(/```[\s\S]*?```/g, ' ')
            .replace(/`([^`]+)`/g, '$1')
            .replace(/\[([^\]]+)\]\((?:https?:\/\/|\/)[^)]+\)/g, '$1')
            .replace(/https?:\/\/\S+/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, ' і ')
            .replace(/\*\*([^*]+)\*\*/g, '$1')
            .replace(/__([^_]+)__/g, '$1')
            .replace(/[*_~#>`]+/g, ' ')
            .replace(/[•·]/g, ', ')
            .replace(/[→⇒]/g, ', ')
            .replace(/\bCRM\b/g, 'сі-ер-ем')
            .replace(/\bAI\b/g, 'ей-ай')
            .replace(/\bAPI\b/g, 'ей-пі-ай')
            .replace(/\bP&L\b/g, 'прибутки і витрати')
            .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, ' ')
            .replace(/\s+([,.!?;:])/g, '$1')
            .replace(/([,.!?;:]){3,}/g, '$1')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    function waitForBrowserSpeechVoices(synth) {
        return new Promise(resolve => {
            let settled = false;
            const readVoices = () => (typeof synth?.getVoices === 'function' ? synth.getVoices() : []);
            const finish = () => {
                if (settled) return;
                settled = true;
                window.clearTimeout(timer);
                try {
                    if (typeof synth.removeEventListener === 'function') synth.removeEventListener('voiceschanged', finish);
                    else if (synth.onvoiceschanged === finish) synth.onvoiceschanged = null;
                } catch {}
                resolve(readVoices());
            };
            const timer = window.setTimeout(finish, 700);
            try {
                if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', finish, { once: true });
                else synth.onvoiceschanged = finish;
                readVoices();
            } catch {
                finish();
            }
        });
    }

    async function getBrowserSpeechVoices(synth) {
        const voices = typeof synth?.getVoices === 'function' ? synth.getVoices() : [];
        if (voices.length) return voices;
        return waitForBrowserSpeechVoices(synth);
    }

    function scoreBrowserSpeechVoice(voice) {
        const lang = String(voice?.lang || '').toLowerCase();
        const name = String(voice?.name || '').toLowerCase();
        let score = 0;
        if (/^uk([-_]|$)/i.test(lang)) score = 100;
        else if (/ukrain|україн/i.test(`${name} ${lang}`)) score = 96;
        else if (/^ru([-_]|$)/i.test(lang)) score = 72;
        else if (/russian|русск|русский/i.test(`${name} ${lang}`)) score = 68;
        else if (/^pl([-_]|$)/i.test(lang)) score = 52;
        if (!score) return 0;
        if (/natural|neural|online|microsoft|google/i.test(name)) score += 4;
        if (voice?.localService === false) score += 2;
        return score;
    }

    async function fetchSpeechBlob(line, runId) {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeoutId = controller
            ? window.setTimeout(() => controller.abort(), SPEECH_TTS_TIMEOUT_MS)
            : 0;
        try {
            const resp = await fetch('/api/crm-assistant/speak', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + localStorage.getItem('pzp_token')
                },
                body: JSON.stringify({ text: line }),
                signal: controller?.signal
            });
            if (runId !== playbackRunId) return null;
            if (!resp.ok) {
                const data = await resp.json().catch(() => ({}));
                throw new Error(data.error || `crm_assistant_speak_http_${resp.status}`);
            }
            const blob = await resp.blob();
            if (!blob || blob.size < 64) throw new Error('speech_audio_empty');
            return blob;
        } finally {
            if (timeoutId) window.clearTimeout(timeoutId);
        }
    }

    async function pickBrowserSpeechVoice(synth) {
        const voices = await getBrowserSpeechVoices(synth);
        const ranked = voices
            .map(voice => ({ voice, score: scoreBrowserSpeechVoice(voice) }))
            .filter(item => item.score >= 50)
            .sort((a, b) => b.score - a.score);
        return ranked[0]?.voice || null;
    }

    async function speakWithBrowserVoice(line, runId) {
        const synth = getBrowserSpeechSynthesis();
        if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
            throw new Error('speech_synthesis_unavailable');
        }
        const speechLine = normalizeBrowserSpeechText(line).slice(0, 2200);
        if (!speechLine) throw new Error('speech_synthesis_empty_text');
        const selectedVoice = await pickBrowserSpeechVoice(synth);
        if (!selectedVoice) throw new Error('speech_synthesis_no_ukrainian_voice');
        return new Promise((resolve, reject) => {
            let settled = false;
            let started = false;
            const utterance = new SpeechSynthesisUtterance(speechLine);
            const settle = (result, error) => {
                if (settled) return;
                settled = true;
                window.clearTimeout(startTimer);
                if (speechSynthesisUtterance === utterance) speechSynthesisUtterance = null;
                if (error) reject(error);
                else resolve(result);
            };
            const startTimer = window.setTimeout(() => {
                if (!started) {
                    try { synth.cancel(); } catch {}
                    settle(null, new Error('speech_synthesis_start_timeout'));
                }
            }, 4500);
            utterance.lang = selectedVoice.lang || 'uk-UA';
            utterance.rate = /^uk[-_]?/i.test(selectedVoice.lang || '') ? 0.94 : 0.91;
            utterance.pitch = 0.98;
            utterance.volume = 1;
            utterance.voice = selectedVoice;
            utterance.onstart = () => {
                if (runId !== playbackRunId) return settle({ interrupted: true });
                started = true;
                setState({ mode: 'speaking', playbackState: 'browser-speech', subtitle: line, tickerText: line });
                scheduleSpeakingIdleFallback(line);
            };
            utterance.onend = () => {
                if (runId !== playbackRunId) return settle({ interrupted: true });
                clearSpeakingIdleTimer();
                if (state.mode === 'speaking') setState({ mode: 'idle', playbackState: 'ended', tickerText: '' });
                settle({ success: true, fallback: 'browser-speech' });
            };
            utterance.onerror = event => {
                settle(null, new Error(event?.error || 'speech_synthesis_failed'));
            };
            speechSynthesisUtterance = utterance;
            try {
                synth.cancel();
                synth.resume?.();
                synth.speak(utterance);
            } catch (error) {
                settle(null, error);
            }
        });
    }

    async function playSpeechBlob(blob, line, runId) {
        audioUrl = URL.createObjectURL(blob);
        audioPlayer = new Audio(audioUrl);
        audioPlayer.preload = 'auto';
        let audioElementErrorHandled = false;
        audioPlayer.onended = () => {
            if (runId !== playbackRunId) return;
            releaseAudioPlayer();
            clearSpeakingIdleTimer();
            if (state.mode === 'speaking') setState({ mode: 'idle', playbackState: 'ended', tickerText: '' });
        };
        audioPlayer.onerror = () => {
            if (runId !== playbackRunId || audioElementErrorHandled) return;
            audioElementErrorHandled = true;
            releaseAudioPlayer();
            clearSpeakingIdleTimer();
            speakWithBrowserVoice(line, runId).catch(error => handlePlaybackFailure(error, line));
        };
        try {
            await audioPlayer.play();
        } catch (error) {
            audioElementErrorHandled = true;
            throw error;
        }
        if (runId === playbackRunId) {
            setState({ mode: 'speaking', playbackState: 'playing', subtitle: line, tickerText: line });
            scheduleSpeakingIdleFallback(line);
        }
        return { success: true };
    }

    async function speakText(text) {
        const line = String(text || '').trim();
        if (!line) return;
        playbackRunId += 1;
        const runId = playbackRunId;
        releaseAudioPlayer();
        primeAssistantVoicePlayback();
        try {
            const blob = await fetchSpeechBlob(line, runId);
            if (runId !== playbackRunId) return { interrupted: true };
            if (blob) return playSpeechBlob(blob, line, runId);
            return { interrupted: true };
        } catch (primaryError) {
            if (runId !== playbackRunId) return;
            emitTelemetry('playback_failed', {
                module: 'rail:playback',
                playbackState: 'browser-fallback',
                failureReason: primaryError?.message || primaryError?.name || 'tts_playback_failed',
                fallbackShown: true
            });
            return speakWithBrowserVoice(line, runId);
        }
    }

    async function playReply(reply, options = {}) {
        const text = String(reply?.subtitle || reply?.summary || reply?.text || '').trim();
        if (!text) return;
        if (options.addToHistory !== false) appendHistory('assistant', text);
        const shouldPlayAudio = state.voiceEnabled && !options.textOnly;
        clearSpeakingIdleTimer();
        stopAudioPlayback();
        setState({
            mode: shouldPlayAudio ? 'thinking' : state.voiceEnabled ? 'idle' : 'muted',
            subtitle: text,
            tickerText: '',
            lastSpokenLine: text,
            playbackState: shouldPlayAudio ? 'voice-loading' : state.voiceEnabled ? 'text' : 'muted'
        });
        renderHistory();
        if (!shouldPlayAudio) {
            return;
        }
        try {
            await speakText(text);
        } catch (err) {
            console.warn('[crm-assistant] speech playback failed:', err);
            handlePlaybackFailure(err, text);
        }
    }

    function handleError(error, fallback = 'Не вдалося отримати відповідь асистента.') {
        stopAudioPlayback({ setIdle: false, reason: 'error' });
        const code = String(error?.message || '');
        const subtitle = code.includes('openai_not_configured')
            ? 'OpenAI ще не налаштовано на сервері. Потрібен OPENAI_API_KEY у backend env.'
            : fallback;
        setState({ mode: 'error', subtitle, tickerText: subtitle, playbackState: 'error' });
        appendHistory('assistant', subtitle);
        renderHistory();
    }

    function pickAudioMimeType() {
        if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
        return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
            .find(type => MediaRecorder.isTypeSupported(type)) || '';
    }

    async function transcribeAudioBlob(blob) {
        const formData = new FormData();
        formData.append('audio', blob, 'crm-assistant.webm');
        const resp = await fetch('/api/crm-assistant/transcribe', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + localStorage.getItem('pzp_token') },
            body: formData
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.success) throw new Error(data.error || `crm_assistant_transcribe_http_${resp.status}`);
        return String(data.text || '').trim();
    }

    function cleanupListeningAnalysis() {
        if (listeningMonitorFrame) {
            cancelAnimationFrame(listeningMonitorFrame);
            listeningMonitorFrame = 0;
        }
        try { listeningSource?.disconnect?.(); } catch {}
        try { listeningAnalyser?.disconnect?.(); } catch {}
        if (listeningAudioContext && listeningAudioContext.state !== 'closed') {
            listeningAudioContext.close().catch(() => {});
        }
        listeningAudioContext = null;
        listeningAnalyser = null;
        listeningSource = null;
        listeningStartedAt = 0;
        listeningLastVoiceAt = 0;
        listeningSpeechStarted = false;
        listeningNoiseFloor = 0;
    }

    function stopListeningStream() {
        if (!listeningStream) return;
        listeningStream.getTracks().forEach(track => track.stop());
        listeningStream = null;
    }

    function requestRecorderStop(reason = 'manual') {
        listeningStopReason = reason;
        if (!mediaRecorder || mediaRecorder.state !== 'recording') return false;
        try {
            mediaRecorder.stop();
            return true;
        } catch (err) {
            console.warn('[crm-assistant] unable to stop recorder:', err);
            return false;
        }
    }

    function readAnalyserRms(analyser, buffer) {
        analyser.getByteTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i += 1) {
            const centered = (buffer[i] - 128) / 128;
            sum += centered * centered;
        }
        return Math.sqrt(sum / buffer.length);
    }

    function startVoiceTurnDetection(stream) {
        const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextCtor) {
            emitTelemetry('voice_transcription_failed', {
                module: 'rail:voice',
                failureReason: 'audio_context_unavailable',
                fallbackShown: true
            });
            setState({
                mode: 'listening',
                subtitle: 'Слухаю. Авто-пауза недоступна в цьому браузері, натисни мікрофон ще раз для завершення.',
                tickerText: '',
                playbackState: 'listening'
            });
            return;
        }

        cleanupListeningAnalysis();
        listeningAudioContext = new AudioContextCtor();
        listeningAnalyser = listeningAudioContext.createAnalyser();
        listeningAnalyser.fftSize = 1024;
        listeningAnalyser.smoothingTimeConstant = 0.18;
        listeningSource = listeningAudioContext.createMediaStreamSource(stream);
        listeningSource.connect(listeningAnalyser);
        const buffer = new Uint8Array(listeningAnalyser.fftSize);
        listeningStartedAt = performance.now();
        listeningLastVoiceAt = listeningStartedAt;
        listeningSpeechStarted = false;
        listeningNoiseFloor = 0;

        const monitor = () => {
            if (!mediaRecorder || mediaRecorder.state !== 'recording' || !listeningAnalyser) return;
            const now = performance.now();
            const elapsed = now - listeningStartedAt;
            const rms = readAnalyserRms(listeningAnalyser, buffer);
            if (elapsed < 650) {
                listeningNoiseFloor = listeningNoiseFloor ? (listeningNoiseFloor * 0.82) + (rms * 0.18) : rms;
            }
            const threshold = Math.max(VOICE_RMS_FLOOR, (listeningNoiseFloor || VOICE_RMS_FLOOR) * 3.2);
            if (rms >= threshold) {
                listeningSpeechStarted = true;
                listeningLastVoiceAt = now;
                if (elapsed > VOICE_START_GRACE_MS) {
                    setState({
                        mode: 'listening',
                        subtitle: 'Чую голос. Завершу, коли буде коротка пауза.',
                        tickerText: '',
                        playbackState: 'voice-active'
                    });
                }
            }

            const quietFor = now - listeningLastVoiceAt;
            if (listeningSpeechStarted && elapsed >= VOICE_MIN_RECORD_MS && quietFor >= VOICE_SILENCE_MS) {
                setState({
                    mode: 'thinking',
                    subtitle: 'Пауза зафіксована. Завершую запис і готую відповідь...',
                    tickerText: '',
                    playbackState: 'auto-finalizing'
                });
                requestRecorderStop('auto_silence');
                return;
            }
            if (elapsed >= VOICE_MAX_RECORD_MS) {
                setState({
                    mode: 'thinking',
                    subtitle: 'Запис достатній. Завершую і готую відповідь...',
                    tickerText: '',
                    playbackState: 'max-duration'
                });
                requestRecorderStop('max_duration');
                return;
            }
            listeningMonitorFrame = requestAnimationFrame(monitor);
        };
        listeningMonitorFrame = requestAnimationFrame(monitor);
    }

    async function toggleListening() {
        cancelProactiveHelp();
        if (state.mode === 'speaking' || audioPlayer) {
            stopAudioPlayback({ setIdle: true, reason: 'interrupted' });
        }
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            setState({ mode: 'thinking', subtitle: 'Завершую запис і готую відповідь...', tickerText: '', playbackState: 'manual-finalizing' });
            requestRecorderStop('manual');
            return;
        }
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
            emitTelemetry('voice_transcription_failed', {
                module: 'rail:voice',
                failureReason: 'media_recorder_unavailable',
                fallbackShown: true
            });
            handleError(new Error('media_recorder_unavailable'), 'Голосовий ввід недоступний у цьому браузері.');
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            listeningStream = stream;
            audioChunks = [];
            listeningStopReason = '';
            const mimeType = pickAudioMimeType();
            const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
            mediaRecorder = recorder;

            recorder.ondataavailable = event => {
                if (event.data && event.data.size > 0) audioChunks.push(event.data);
            };
            recorder.onstop = async () => {
                const chunks = audioChunks.slice();
                const stopReason = listeningStopReason || 'manual';
                audioChunks = [];
                cleanupListeningAnalysis();
                stopListeningStream();
                mediaRecorder = null;
                listeningStopReason = '';
                if (stopReason === 'cancelled') {
                    setState({ mode: state.voiceEnabled ? 'idle' : 'muted', subtitle: 'Запис скасовано. Готовий продовжити.', tickerText: '', playbackState: 'cancelled' });
                    return;
                }
                if (!chunks.length) {
                    setState({ mode: state.voiceEnabled ? 'idle' : 'muted', subtitle: 'Не почув голос. Спробуй ще раз або напиши текстом.', tickerText: '', playbackState: 'empty' });
                    return;
                }
                try {
                    setState({ mode: 'thinking', subtitle: 'Розпізнаю голос і готую відповідь...' });
                    const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
                    const transcript = await transcribeAudioBlob(blob);
                    if (!transcript) throw new Error('empty_transcript');
                    await submitPromptText(transcript, { source: 'voice', voiceMode: true, alreadyFinalized: true });
                } catch (err) {
                    emitTelemetry('voice_transcription_failed', {
                        module: 'rail:voice',
                        failureReason: err.message || String(err),
                        fallbackShown: true
                    });
                    handleError(err, 'Не вдалося розпізнати голос або підготувати відповідь.');
                }
            };

            setState({ mode: 'listening', subtitle: 'Слухаю. Скажи фразу, а пауза завершить запис автоматично.', tickerText: '', playbackState: 'listening' });
            recorder.start(250);
            startVoiceTurnDetection(stream);
        } catch (err) {
            emitTelemetry('voice_transcription_failed', {
                module: 'rail:voice',
                failureReason: err.message || String(err),
                fallbackShown: true
            });
            handleError(err, 'Не вдалося увімкнути мікрофон.');
        }
    }

    function toggleVoice() {
        const next = !state.voiceEnabled;
        if (!next) stopAudioPlayback({ setIdle: false, reason: 'muted' });
        localStorage.setItem('eg_crm_assistant_voice', next ? 'on' : 'off');
        localStorage.setItem('eg_dashboard_assistant_voice', next ? 'on' : 'off');
        setState({
            voiceEnabled: next,
            voiceBlocked: false,
            mode: next ? 'idle' : 'muted',
            playbackState: next ? 'idle' : 'muted',
            subtitle: next
                ? 'Голос увімкнено. Наступні підказки можна озвучувати.'
                : 'Голос вимкнено. Відповіді залишаються в тексті та субтитрах.',
            tickerText: ''
        });
    }

    async function replayLastLine() {
        const line = state.lastSpokenLine || state.subtitle || 'Немає останньої репліки для повтору.';
        await playReply({ text: line, subtitle: line }, { textOnly: !state.voiceEnabled, addToHistory: false });
    }

    function getAssistantConversationId() {
        const scope = getAssistantUserScope();
        const stableId = `crm-assistant-user-${scope}`;
        const key = assistantScopedKey(ASSISTANT_CHAT_CONVERSATION_KEY);
        try {
            const stored = localStorage.getItem(key) || '';
            assistantConversationId = stored && stored.indexOf('crm-assistant-user-') === 0 ? stored : stableId;
            localStorage.setItem(key, assistantConversationId);
            sessionStorage.setItem('eg_crm_assistant_conversation_id', assistantConversationId);
        } catch {
            assistantConversationId = assistantConversationId && assistantConversationId.indexOf('crm-assistant-user-') === 0
                ? assistantConversationId
                : stableId;
        }
        return assistantConversationId;
    }

    function assistantHistoryItemId(role) {
        return `${getAssistantConversationId()}-${Date.now().toString(36)}-${role}-${history.length}`;
    }

    function isOldAssistantSession(item) {
        if (!item || !item.sessionId) return false;
        return item.sessionId !== getAssistantSessionId();
    }

    function normalizeStoredAssistantHistoryItem(item, index = 0) {
        const role = item?.role === 'user' ? 'user' : 'assistant';
        const text = String(item?.text || item?.content || '').trim();
        if (!text) return null;
        return {
            id: String(item.id || `${getAssistantConversationId()}-stored-${index}`),
            role,
            text: text.slice(0, 3800),
            at: item.at || item.createdAt || new Date().toISOString(),
            sessionId: item.sessionId || '',
            conversationId: item.conversationId || getAssistantConversationId(),
            page: item.page || ''
        };
    }

    function loadAssistantPersistentHistory() {
        const key = assistantScopedKey(ASSISTANT_CHAT_HISTORY_KEY);
        if (assistantHistoryLoadedForKey === key) return;
        assistantHistoryLoadedForKey = key;
        try {
            const parsed = JSON.parse(localStorage.getItem(key) || '[]');
            history = Array.isArray(parsed)
                ? parsed.map(normalizeStoredAssistantHistoryItem).filter(Boolean).slice(-ASSISTANT_CHAT_HISTORY_LIMIT)
                : [];
        } catch {
            history = [];
        }
        storeAssistantTranscriptPayload(buildAssistantChatTransferPayload());
    }

    function persistAssistantHistory() {
        try {
            localStorage.setItem(assistantScopedKey(ASSISTANT_CHAT_HISTORY_KEY), JSON.stringify(history.slice(-ASSISTANT_CHAT_HISTORY_LIMIT)));
        } catch {}
    }

    function storeAssistantTranscriptPayload(payload) {
        try {
            sessionStorage.setItem(ASSISTANT_CHAT_TRANSCRIPT_KEY, JSON.stringify(payload));
        } catch (err) {
            console.warn('[CrmAssistantRail] Unable to store assistant transcript payload:', err);
        }
    }

    function buildAssistantChatTransferPayload() {
        const snapshot = buildAssistantSnapshot();
        return {
            conversationId: getAssistantConversationId(),
            sessionId: getAssistantSessionId(),
            pageTitle: snapshot.pageFull || document.title || 'CRM',
            page: getCurrentPageKey(),
            returnUrl: currentAssistantReturnUrl(),
            messages: history.map((item, index) => ({
                id: item.id || `${getAssistantConversationId()}-${index}`,
                role: item.role === 'user' ? 'user' : 'assistant',
                text: item.text,
                at: item.at,
                sessionId: item.sessionId || getAssistantSessionId(),
                conversationId: item.conversationId || getAssistantConversationId(),
                page: item.page || getCurrentPageKey()
            }))
        };
    }

    function appendHistory(role, text) {
        const line = String(text || '').trim();
        if (!line) return;
        const safeRole = role === 'user' ? 'user' : 'assistant';
        history.push({
            id: assistantHistoryItemId(safeRole),
            role: safeRole,
            text: line,
            at: new Date().toISOString(),
            sessionId: getAssistantSessionId(),
            conversationId: getAssistantConversationId(),
            page: getCurrentPageKey()
        });
        if (history.length > ASSISTANT_CHAT_HISTORY_LIMIT) history = history.slice(-ASSISTANT_CHAT_HISTORY_LIMIT);
        persistAssistantHistory();
        storeAssistantTranscriptPayload(buildAssistantChatTransferPayload());
    }

    function currentAssistantReturnUrl() {
        const path = `${window.location.pathname || '/dashboard'}${window.location.search || ''}${window.location.hash || ''}`;
        return path || '/dashboard';
    }

    async function syncAssistantDialogToCrmChat() {
        const payload = buildAssistantChatTransferPayload();
        storeAssistantTranscriptPayload(payload);
        const resp = await fetch('/api/chat/assistant/transcript', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + localStorage.getItem('pzp_token')
            },
            body: JSON.stringify(payload)
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.success === false) {
            throw new Error(data.error || `assistant_transcript_import_http_${resp.status}`);
        }
        try {
            if (data.channel?.id) sessionStorage.setItem(ASSISTANT_CHAT_SYNC_CHANNEL_KEY, String(data.channel.id));
        } catch {}
        return data;
    }

    async function openCrmChatFromAssistant() {
        let channelId = '';
        try {
            const snapshot = buildAssistantSnapshot();
            sessionStorage.setItem(ASSISTANT_CHAT_RETURN_URL_KEY, currentAssistantReturnUrl());
            sessionStorage.setItem(ASSISTANT_CHAT_RETURN_LABEL_KEY, snapshot.pageFull || document.title || 'CRM');
            setState({ mode: 'action', subtitle: 'Синхронізую діалог з CRM Chat...', tickerText: '', playbackState: 'text' });
            const sync = await syncAssistantDialogToCrmChat();
            channelId = sync?.channel?.id ? String(sync.channel.id) : '';
        } catch (error) {
            console.warn('[CrmAssistantRail] Unable to sync assistant chat context:', error);
            emitTelemetry('action_unavailable', {
                module: 'rail:assistantChatSync',
                failureReason: error.message || String(error),
                fallbackShown: true
            });
        }
        const target = channelId
            ? `/chat?assistantReturn=1&channelId=${encodeURIComponent(channelId)}`
            : '/chat?assistantReturn=1';
        window.location.href = target;
    }

    function resumeAssistantPanelFromChatReturn() {
        let shouldReopen = false;
        try {
            shouldReopen = sessionStorage.getItem(ASSISTANT_CHAT_REOPEN_KEY) === '1';
            sessionStorage.removeItem(ASSISTANT_CHAT_REOPEN_KEY);
        } catch {
            shouldReopen = false;
        }
        if (!shouldReopen) return;
        window.setTimeout(() => {
            expand();
            appendHistory('assistant', 'Повернувся з CRM Chat. Можемо продовжити діалог по цій сторінці.');
            renderHistory();
        }, 220);
    }

    function expand() {
        const prev = document.getElementById('crmAssistantPanelOverlay');
        if (prev) {
            renderHistory();
            return;
        }
        const overlay = document.createElement('div');
        overlay.id = 'crmAssistantPanelOverlay';
        overlay.className = 'crm-assistant-panel-overlay';
        overlay.innerHTML = `
            <div class="crm-assistant-panel" role="dialog" aria-modal="true" aria-label="AI-провідник CRM">
                <div class="crm-assistant-panel-header">
                    <div>
                        <strong>Помічник</strong>
                        <span>AI-провідник CRM</span>
                    </div>
                    <div class="crm-assistant-panel-header-actions">
                        <button type="button" class="crm-assistant-panel-chat-link" id="crmAssistantOpenChatBtn">Мої чати</button>
                        <button type="button" class="crm-assistant-panel-close" aria-label="Закрити" id="crmAssistantPanelClose">×</button>
                    </div>
                </div>
                <div class="crm-assistant-panel-content" id="crmAssistantPanelContent">
                <div class="crm-assistant-panel-snapshot" id="crmAssistantPanelSnapshot"></div>
                <div class="crm-assistant-action-proposal" id="crmAssistantActionProposal"></div>
                <div class="crm-assistant-teaching-runner" id="crmAssistantTeachingRunner"></div>
                <div class="crm-assistant-mode-grid" aria-label="Режими роботи AI">
                    <button type="button" data-crm-assistant-prompt="Зроби короткий брифінг по цій сторінці і скажи що важливо зараз">
                        <span>01</span><strong>Брифінг</strong><small>коротко по екрану</small>
                    </button>
                    <button type="button" data-crm-assistant-prompt="Знайди ризики, прострочки або місця де потрібна дія">
                        <span>02</span><strong>Ризики</strong><small>що горить</small>
                    </button>
                    <button type="button" data-crm-assistant-prompt="Скажи одну найкращу наступну дію для моєї ролі">
                        <span>03</span><strong>Наступна дія</strong><small>що зробити</small>
                    </button>
                </div>
                <section class="crm-assistant-chat-workspace" id="crmAssistantChatWorkspace" aria-label="Чат з Помічником">
                    <div class="crm-assistant-chat-head">
                        <div>
                            <span>Чат з Помічником</span>
                            <strong>Поточний діалог</strong>
                        </div>
                        <button type="button" class="crm-assistant-chat-open" id="crmAssistantOpenChatInline">Мої чати</button>
                    </div>
                    <div class="crm-assistant-history" id="crmAssistantHistory"></div>
                </section>
                <div class="crm-assistant-quick-prompts">
                    <button type="button" data-crm-assistant-prompt="Що для мене зараз головне на цій сторінці?">Головне зараз</button>
                    <button type="button" data-crm-assistant-prompt="Поясни цю сторінку моєю роллю">Поясни сторінку</button>
                    <button type="button" data-crm-assistant-prompt="Що зараз найважливіше зробити?">Наступний крок</button>
                    <button type="button" data-crm-assistant-prompt="Проведи мене по ключових блоках">По блоках</button>
                </div>
                </div>
                <form class="crm-assistant-form" id="crmAssistantForm">
                    <textarea id="crmAssistantPromptInput" rows="3" maxlength="1200" placeholder="Запитай по цій сторінці CRM..."></textarea>
                    <button type="submit" class="dashboard-btn primary">Запитати</button>
                </form>
                <div class="crm-assistant-disclosure">Голосові відповіді генерує AI.</div>
            </div>
        `;
        overlay.addEventListener('click', event => {
            if (event.target === overlay) closePanel();
        });
        document.body.appendChild(overlay);
        pulseAssistantWindowBridge(overlay, { holdMs: 1400 });
        document.getElementById('crmAssistantPanelClose')?.addEventListener('click', closePanel);
        document.getElementById('crmAssistantOpenChatBtn')?.addEventListener('click', openCrmChatFromAssistant);
        document.getElementById('crmAssistantOpenChatInline')?.addEventListener('click', openCrmChatFromAssistant);
        document.getElementById('crmAssistantForm')?.addEventListener('submit', submitPrompt);
        document.getElementById('crmAssistantPromptInput')?.addEventListener('keydown', event => {
            if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
            event.preventDefault();
            event.currentTarget.closest('form')?.requestSubmit();
        });
        overlay.querySelectorAll('[data-crm-assistant-prompt]').forEach(btn => {
            btn.addEventListener('click', () => runQuickPrompt(btn.dataset.crmAssistantPrompt));
        });
        renderPanelSnapshot();
        renderHistory();
        document.getElementById('crmAssistantPromptInput')?.focus();
    }

    function closePanel() {
        document.getElementById('crmAssistantPanelOverlay')?.remove();
    }

    function renderHistory() {
        const container = document.getElementById('crmAssistantHistory');
        if (!container) return;
        const items = history.length ? history : [{ role: 'assistant', text: state.subtitle || 'Я готовий допомогти по цій сторінці.' }];
        container.innerHTML = items.map(item => `
            <div class="crm-assistant-history-item ${escapeHtml(item.role)}${isOldAssistantSession(item) ? ' old-session' : ''}">
                <span>${item.role === 'user' ? 'Ти' : 'Помічник'}${isOldAssistantSession(item) ? '<small>стара сесія</small>' : ''}</span>
                ${renderAssistantHistoryBody(item.role, item.text)}
            </div>
        `).join('');
        container.scrollTop = container.scrollHeight;
    }

    function renderPanelSnapshot() {
        const container = document.getElementById('crmAssistantPanelSnapshot');
        if (!container) return;
        const snapshot = buildAssistantSnapshot();
        const badges = snapshot.badges.length
            ? snapshot.badges.map(item => `<span>${escapeHtml(item)}</span>`).join('')
            : '<span>сигналів немає</span>';
        const warnings = snapshot.warnings.length
            ? snapshot.warnings.map(item => `<li>${escapeHtml(compactText(item, '', 72))}</li>`).join('')
            : '<li>Критичних текстових попереджень на екрані не видно.</li>';
        container.innerHTML = `
            <div class="crm-assistant-snapshot-card crm-assistant-snapshot-card--main">
                <span>Поточний екран</span>
                <strong>${escapeHtml(snapshot.pageFull)}</strong>
                <small>фокус: ${escapeHtml(snapshot.focusFull)}</small>
            </div>
            <div class="crm-assistant-snapshot-card">
                <span>Роль</span>
                <strong>${escapeHtml(snapshot.role)}</strong>
                <small>${escapeHtml(snapshot.voice)} · ${escapeHtml(snapshot.updated)}</small>
            </div>
            <div class="crm-assistant-snapshot-card">
                <span>Сигнали</span>
                <strong>${escapeHtml(snapshot.signalCount)}</strong>
                <small>${escapeHtml(snapshot.rows)} елементів у видимому робочому полі</small>
            </div>
            <div class="crm-assistant-snapshot-wide">
                <div class="crm-assistant-snapshot-badges">${badges}</div>
                <ul>${warnings}</ul>
            </div>
        `;
        renderActionProposal();
        renderTeachingRunner();
    }

    function getFoundationState() {
        try {
            return foundation()?.store?.getState?.() || {};
        } catch {
            return {};
        }
    }

    function strongestSignal(context = {}) {
        const rank = { critical: 5, danger: 4, warning: 3, info: 2, success: 1 };
        return (context.signals || []).slice().sort((a, b) => (rank[b?.severity] || 0) - (rank[a?.severity] || 0))[0] || null;
    }

    function actionById(context = {}, actionId = '') {
        return (context.actions || []).find(action => action.actionId === actionId) || null;
    }

    function actionReasonText(signal = null, proposal = null, context = {}) {
        if (signal?.evidence) return `Бо зараз видно: ${signal.evidence}`;
        if (signal?.label) return `Бо головний сигнал зараз — ${signal.label}.`;
        if (context.contextSummary?.headline) return `Опираюсь на ${context.contextSummary.headline}.`;
        return proposal?.failureMessage || 'Дія взята з безпечного assistant action registry для цього екрана.';
    }

    function teachingStepLine(result = {}) {
        const step = result.flow?.step || result.step || {};
        if (result.done) return 'Маршрут завершено. Ти вже в правильній зоні екрана.';
        if (result.success === false) return result.fallbackText || 'Цей крок зараз недоступний, тому не підсвічую неточну ціль.';
        return step.text || result.target?.label || 'Показую стабільний елемент на екрані.';
    }

    function actionTypeLabel(type = '') {
        const key = String(type || '').toLowerCase();
        if (key === 'filter') return 'фільтр';
        if (key === 'focus') return 'фокус';
        if (key === 'refresh') return 'оновлення';
        if (key === 'navigate' || key === 'navigation') return 'навігація';
        if (key === 'highlight') return 'підсвітка';
        if (key === 'theme') return 'тема';
        if (key === 'voice') return 'голос';
        if (key === 'ui') return 'інтерфейс';
        if (key === 'create') return 'створення';
        return type || 'дія';
    }

    function renderActionProposal() {
        const container = document.getElementById('crmAssistantActionProposal');
        if (!container) return;
        const context = buildPageGuideContext({ silent: true });
        const foundationState = getFoundationState();
        const proposal = foundationState.currentActionProposal || context.actionProposal || context.actions?.[0] || null;
        const secondary = (context.actions || []).find(action => action.actionId !== proposal?.actionId && action.confirmationNeeded !== true) || null;
        const signal = strongestSignal(context);
        if (!proposal?.actionId) {
            container.innerHTML = `
                <div class="crm-assistant-action-card is-muted">
                    <div>
                        <span>Наступна дія</span>
                        <strong>Немає безпечної дії</strong>
                        <p>${escapeHtml(context.fallbackReason || 'На цій сторінці асистент поки може тільки пояснити контекст.')}</p>
                    </div>
                </div>
            `;
            return;
        }
        const confirmation = proposal.confirmationNeeded ? '<small>потрібне підтвердження</small>' : '<small>безпечна дія</small>';
        const reason = actionReasonText(signal, proposal, context);
        const actionType = proposal.actionType ? `<em>${escapeHtml(actionTypeLabel(proposal.actionType))}</em>` : '';
        container.innerHTML = `
            <div class="crm-assistant-action-card" data-action-type="${escapeHtml(proposal.actionType || 'focus')}">
                <div>
                    <span>Рекомендована дія ${actionType}</span>
                    <strong>${escapeHtml(proposal.label || 'Виконати дію')}</strong>
                    <p>${escapeHtml(compactText(reason, '', 170))}</p>
                    ${confirmation}
                </div>
                <div class="crm-assistant-action-buttons">
                    <button type="button" class="crm-assistant-action-primary" data-crm-assistant-run-action="${escapeHtml(proposal.actionId)}">
                        ${proposal.confirmationNeeded ? 'Підтвердити' : 'Виконати'}
                    </button>
                    ${secondary ? `<button type="button" class="crm-assistant-action-secondary" data-crm-assistant-run-action="${escapeHtml(secondary.actionId)}">${escapeHtml(secondary.label)}</button>` : ''}
                </div>
            </div>
        `;
        container.querySelectorAll('[data-crm-assistant-run-action]').forEach(button => {
            button.addEventListener('click', () => handlePanelAction(button.dataset.crmAssistantRunAction));
        });
    }

    function renderTeachingRunner() {
        const container = document.getElementById('crmAssistantTeachingRunner');
        if (!container) return;
        const api = foundation();
        const context = buildPageGuideContext({ silent: true });
        const foundationState = getFoundationState();
        const flow = api?.teaching?.getState?.() || foundationState.currentTeachingFlow || null;
        const target = foundationState.currentTeachingTarget || context.teachingTarget || (context.teachingTargets || []).find(item => item.available) || null;
        const defaultFlow = api?.teaching?.defaultFlowForPage?.(getCurrentPageKey()) || '';
        if (flow?.active) {
            const step = flow.step || {};
            const canNext = Number(flow.index || 0) + 1 < Number(flow.total || 0);
            container.innerHTML = `
                <div class="crm-assistant-teaching-card is-active">
                    <div>
                        <span>Навчальний крок ${escapeHtml(String(Number(flow.index || 0) + 1))}/${escapeHtml(String(flow.total || 1))}</span>
                        <strong>${escapeHtml(step.label || flow.title || 'Крок')}</strong>
                        <p>${escapeHtml(step.text || 'Підсвічую стабільний елемент на сторінці.')}</p>
                    </div>
                    <div class="crm-assistant-teaching-buttons">
                        <button type="button" data-crm-assistant-highlight-target="${escapeHtml(step.targetId || '')}">Показати</button>
                        ${canNext ? '<button type="button" data-crm-assistant-teaching-next="1">Далі</button>' : '<button type="button" data-crm-assistant-teaching-next="1">Готово</button>'}
                        <button type="button" data-crm-assistant-teaching-dismiss="1">Закрити</button>
                    </div>
                </div>
            `;
        } else {
            const targetText = target?.available === false
                ? (target.fallbackText || target.reason || 'Точна ціль зараз недоступна.')
                : (target?.label || 'Можу підсвітити найближчий стабільний елемент.');
            container.innerHTML = `
                <div class="crm-assistant-teaching-card">
                    <div>
                        <span>Навігація по екрану</span>
                        <strong>${escapeHtml(target?.label || 'Показати де це')}</strong>
                        <p>${escapeHtml(targetText)}</p>
                    </div>
                    <div class="crm-assistant-teaching-buttons">
                        ${target?.targetId ? `<button type="button" data-crm-assistant-highlight-target="${escapeHtml(target.targetId)}">Підсвітити</button>` : ''}
                        ${defaultFlow ? `<button type="button" data-crm-assistant-teaching-start="${escapeHtml(defaultFlow)}">Провести</button>` : ''}
                    </div>
                </div>
            `;
        }
        container.querySelectorAll('[data-crm-assistant-highlight-target]').forEach(button => {
            button.addEventListener('click', () => handlePanelHighlight(button.dataset.crmAssistantHighlightTarget));
        });
        container.querySelector('[data-crm-assistant-teaching-start]')?.addEventListener('click', event => {
            handleTeachingStart(event.currentTarget.dataset.crmAssistantTeachingStart);
        });
        container.querySelector('[data-crm-assistant-teaching-next]')?.addEventListener('click', handleTeachingNext);
        container.querySelector('[data-crm-assistant-teaching-dismiss]')?.addEventListener('click', handleTeachingDismiss);
    }

    async function handlePanelAction(actionId) {
        const action = String(actionId || '').trim();
        if (!action) return;
        try {
            const context = buildPageGuideContext({ silent: true });
            const actionMeta = actionById(context, action);
            setState({ mode: 'action', subtitle: `Виконую: ${actionMeta?.label || 'дія асистента'}`, tickerText: '' });
            await runRegisteredAction(action);
            await refreshFoundationContext({ force: true });
            setState({ mode: 'success', subtitle: 'Дію виконано або відкрито потрібний фокус.', tickerText: '' });
            renderPanelSnapshot();
        } catch (err) {
            emitTelemetry('action_unavailable', {
                module: 'rail:panelAction',
                actionId: action,
                failureReason: err.message || String(err),
                fallbackShown: true
            });
            handleError(err, 'Не вдалося виконати запропоновану дію.');
        }
    }

    function handlePanelHighlight(targetId) {
        const target = String(targetId || '').trim();
        if (!target) return;
        const result = highlightTeachingTarget(target, { durationMs: 3600 });
        if (!result.success) {
            emitTelemetry('teaching_target_missing', {
                module: 'rail:highlight',
                targetId: target,
                failureReason: result.fallbackText || 'target_not_found',
                fallbackShown: true
            });
            setState({ mode: 'idle', subtitle: result.fallbackText || 'Точна ціль зараз недоступна.', tickerText: '' });
        } else {
            setState({ mode: 'success', subtitle: `${result.target?.label || 'Елемент'} підсвічено на екрані.`, tickerText: '' });
        }
        renderTeachingRunner();
    }

    function handleTeachingStart(flowId) {
        const result = foundation()?.teaching?.start?.(flowId);
        setState({
            mode: result?.success ? 'success' : 'idle',
            subtitle: teachingStepLine(result || { success: false, fallbackText: 'Цей навчальний сценарій зараз недоступний.' }),
            tickerText: ''
        });
        renderTeachingRunner();
    }

    function handleTeachingNext() {
        const result = foundation()?.teaching?.next?.();
        setState({
            mode: result?.success && !result?.done ? 'success' : 'idle',
            subtitle: teachingStepLine(result || { success: false, fallbackText: 'Навчальний маршрут зараз недоступний.' }),
            tickerText: ''
        });
        renderTeachingRunner();
    }

    function handleTeachingDismiss() {
        foundation()?.teaching?.dismiss?.();
        setState({ mode: state.voiceEnabled ? 'idle' : 'muted', subtitle: 'Навчання закрито. Можу повернутись до маршруту, коли буде потрібно.', tickerText: '' });
        renderTeachingRunner();
    }

    async function tryRunAssistantCommand(prompt) {
        const api = foundation();
        if (!api?.commands?.route || !api?.commands?.execute) return false;
        const route = api.commands.route(prompt, { pageId: getCurrentPageKey(), source: 'rail:prompt' });
        if (!route?.matched) return false;
        const actionLine = route.summary || route.label || 'Виконую дію по CRM.';
        try {
            setState({
                mode: route.blocked || route.requiresInput ? 'idle' : 'action',
                subtitle: actionLine,
                tickerText: '',
                playbackState: 'text'
            });
            const result = await api.commands.execute(route, { source: 'rail:prompt' });
            const line = result?.summary || actionLine;
            if (result?.navigating) {
                appendHistory('assistant', line);
                setState({ mode: 'success', subtitle: line, tickerText: line, lastSpokenLine: line, playbackState: 'text' });
                renderHistory();
                return true;
            }
            await playReply({ summary: line, subtitle: line, text: line }, {
                addToHistory: true,
                textOnly: !state.voiceEnabled || route.blocked || route.requiresInput
            });
            await refreshFoundationContext({ force: true });
            renderPanelSnapshot();
            return true;
        } catch (err) {
            emitTelemetry('action_unavailable', {
                module: 'rail:commandRouter',
                actionId: route.actionId || '',
                failureReason: err.message || String(err),
                fallbackShown: true
            });
            handleError(err, 'Не вдалося виконати команду. Я не вигадую дію, якої не маю в безпечному контракті.');
            return true;
        }
    }

    function runPendingAssistantCommandFromNavigation() {
        const api = foundation();
        const pending = api?.commands?.consumePending?.(getCurrentPageKey());
        if (!pending) return;
        window.setTimeout(async () => {
            try {
                setState({ mode: 'action', subtitle: pending.label || 'Відкриваю потрібну секцію.', tickerText: '' });
                if (pending.actionId) await runRegisteredAction(pending.actionId);
                else if (pending.targetId) highlightTeachingTarget(pending.targetId, { durationMs: 3600 });
                const line = pending.label ? `${pending.label}: готово.` : 'Секцію відкрито.';
                setState({ mode: 'success', subtitle: line, tickerText: '', playbackState: 'text' });
                renderPanelSnapshot();
            } catch (err) {
                emitTelemetry('action_unavailable', {
                    module: 'rail:pendingCommand',
                    actionId: pending.actionId || '',
                    targetId: pending.targetId || '',
                    failureReason: err.message || String(err),
                    fallbackShown: true
                });
                setState({ mode: 'idle', subtitle: 'Сторінку відкрито, але точну секцію зараз не знайшов.', tickerText: '' });
            }
        }, 420);
    }

    async function runQuickPrompt(prompt) {
        await submitPromptText(prompt);
    }

    async function submitPrompt(event) {
        event.preventDefault();
        const input = document.getElementById('crmAssistantPromptInput');
        const text = input ? input.value.trim() : '';
        if (input) input.value = '';
        await submitPromptText(text);
    }

    async function submitPromptText(text, options = {}) {
        const prompt = String(text || '').trim();
        if (!prompt) return;
        cancelProactiveHelp();
        stopAudioPlayback({ setIdle: false, reason: 'interrupted' });
        appendHistory('user', prompt);
        renderHistory();
        const voiceMode = options.voiceMode === true;
        const source = String(options.source || 'text');
        const label = prompt.length > 42 ? `${prompt.slice(0, 39).trim()}...` : prompt;
        return enqueueAssistantTurn(async turnId => {
            if (isAssistantTurnCancelled(turnId)) return;
            setState({
                mode: 'thinking',
                subtitle: voiceMode ? `Почув: ${prompt}` : 'Думаю над відповіддю по цій сторінці...',
                tickerText: '',
                playbackState: voiceMode ? 'transcript-ready' : 'idle'
            });
            try {
                if (await tryAnswerTimelineScheduleQuery(prompt)) return;
                if (isAssistantTurnCancelled(turnId)) return;
                if (await tryRunAssistantCommand(prompt)) return;
                if (isAssistantTurnCancelled(turnId)) return;
                const reply = await requestGuideReply({ userMessage: prompt, voiceMode });
                if (isAssistantTurnCancelled(turnId)) return;
                await playReply(reply, { textOnly: source === 'voice' ? false : undefined });
            } catch (err) {
                if (isAssistantTurnCancelled(turnId)) return;
                emitTelemetry('reply_failed', {
                    module: 'rail:submitPrompt',
                    failureReason: err.message || String(err),
                    fallbackShown: true
                });
                handleError(err);
            }
        }, { label });
    }

    function announceFromPage(text) {
        const line = String(text || '').trim();
        if (!line) return;
        stopAudioPlayback({ setIdle: false, reason: 'interrupted' });
        setState({
            mode: state.voiceEnabled ? 'idle' : 'muted',
            subtitle: line,
            tickerText: '',
            lastSpokenLine: line,
            playbackState: 'text'
        });
    }

    async function runRegisteredAction(actionId, payload = {}) {
        const api = foundation();
        if (!api?.actions?.run) throw new Error('assistant_action_registry_unavailable');
        return api.actions.run(actionId, payload);
    }

    function highlightTeachingTarget(targetOrId, options = {}) {
        const api = foundation();
        if (!api?.targets?.highlight) return { success: false, fallbackText: 'assistant_target_registry_unavailable' };
        return api.targets.highlight(targetOrId, options);
    }

    function init(options = {}) {
        initCount += 1;
        foundation()?.init?.({ pageId: getCurrentPageKey(), ...options });
        getAssistantSessionId();
        getAssistantConversationId();
        loadAssistantPersistentHistory();
        if (!ensureMounted()) return false;
        initAssistantWindowBridge();
        if (options.subtitle) announceFromPage(options.subtitle);
        runPendingAssistantCommandFromNavigation();
        resumeAssistantPanelFromChatReturn();
        window.setTimeout(() => scheduleProactiveHelp(options), initCount === 1 ? 500 : 100);
        return true;
    }

    window.CrmAssistantRail = {
        init,
        ensureMounted,
        setState,
        scheduleProactiveHelp,
        cancelProactiveHelp,
        announcePageContext,
        announceFromPage,
        toggleVoice,
        replayLastLine,
        expand,
        closePanel,
        requestGuideReply,
        speakText,
        playReply,
        toggleListening,
        normalizeReply,
        getFoundationContext,
        refreshFoundationContext,
        runRegisteredAction,
        tryRunAssistantCommand,
        highlightTeachingTarget,
        pulseAssistantWindowBridge,
        buildPageGuideContext,
        getAssetVersion
    };

    document.addEventListener('DOMContentLoaded', () => {
        if (document.body.classList.contains('authenticated-shell')) init();
    });
})();
