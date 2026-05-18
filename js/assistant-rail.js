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
    let history = [];
    let proactiveTimer = null;
    let proactiveShownForPage = null;
    let pageInteractionDetected = false;
    let interactionWatchersBound = false;
    let speakingIdleTimer = null;
    let playbackRunId = 0;
    let initCount = 0;

    function escapeHtml(value) {
        const div = document.createElement('div');
        div.textContent = String(value ?? '');
        return div.innerHTML;
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
        const header = headerContent.closest('.header');
        let status = headerContent.querySelector('#crmAssistantTopStatus');
        if (!status) {
            status = document.createElement('div');
            status.id = 'crmAssistantTopStatus';
            status.className = 'crm-assistant-top-status';
            status.innerHTML = `
                <span class="crm-assistant-top-status-dot" aria-hidden="true"></span>
                <span>Клешня</span>
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
        if (header) {
            if (host.previousElementSibling !== header) header.insertAdjacentElement('afterend', host);
        } else if (host.parentElement !== headerContent) {
            headerContent.appendChild(host);
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
                    <span class="assistant-rail-orb-core"><span class="assistant-rail-orb-eye"></span></span>
                    <span class="assistant-rail-orb-ripple assistant-rail-orb-ripple--one"></span>
                    <span class="assistant-rail-orb-ripple assistant-rail-orb-ripple--two"></span>
                    <span class="assistant-rail-avatar-meter" aria-hidden="true"><strong id="crmAssistantSignalCount">0</strong><small>сигн.</small></span>
                </button>
                <div class="assistant-rail-status-stack">
                    <div class="assistant-rail-topline">
                        <span class="assistant-rail-name">Клешня</span>
                        <span class="assistant-rail-state assistant-state-idle" id="crmAssistantRailState">Готовий</span>
                        <span class="assistant-rail-engine">claude · клешня v3.2</span>
                    </div>
                    <div class="assistant-rail-subtitles-wrap" id="crmAssistantRailSubtitlesWrap">
                        <div class="assistant-rail-subtitles" id="crmAssistantRailSubtitles">Я поруч, якщо треба допомога по сторінці.</div>
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
                    <div class="assistant-rail-prompts" aria-label="Швидкі запити до Клешні">
                        <button type="button" data-crm-assistant-inline-prompt="Брифінг на сьогодні">› Брифінг</button>
                        <button type="button" data-crm-assistant-inline-prompt="Хто гарячі ліди?">› Гарячі ліди</button>
                        <button type="button" data-crm-assistant-inline-prompt="Скласти зміну">› Зміна</button>
                    </div>
                </div>
            </div>
            <div class="assistant-rail-actions" aria-label="Керування голосовим AI-помічником">
                <form class="assistant-rail-inline-form" id="crmAssistantInlineForm" role="search">
                    <span class="assistant-rail-inline-search" aria-hidden="true">⌕</span>
                    <input id="crmAssistantInlineInput" type="text" maxlength="240" autocomplete="off" placeholder="Запитати або /команда">
                    <span class="assistant-rail-inline-hint" aria-hidden="true">/</span>
                </form>
                <button type="button" class="assistant-rail-btn" id="crmAssistantMicBtn" title="Голосовий ввід" aria-label="Голосовий ввід">🎙</button>
                <button type="button" class="assistant-rail-btn" id="crmAssistantVoiceToggle" title="Увімкнути або вимкнути голос" aria-label="Увімкнути або вимкнути голос">🔊</button>
                <button type="button" class="assistant-rail-btn" id="crmAssistantReplayBtn" title="Повторити останню репліку" aria-label="Повторити останню репліку">↺</button>
                <button type="button" class="assistant-rail-btn" id="crmAssistantExpandBtn" title="Розгорнути AI-помічника" aria-label="Розгорнути AI-помічника">⋯</button>
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
        document.getElementById('crmAssistantRailAvatar')?.addEventListener('click', expand);
        document.getElementById('crmAssistantMicBtn')?.addEventListener('click', toggleListening);
        document.getElementById('crmAssistantVoiceToggle')?.addEventListener('click', toggleVoice);
        document.getElementById('crmAssistantReplayBtn')?.addEventListener('click', replayLastLine);
        document.getElementById('crmAssistantExpandBtn')?.addEventListener('click', expand);
        document.getElementById('crmAssistantInlineForm')?.addEventListener('submit', event => {
            event.preventDefault();
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

    function shouldSubtitleScroll(text = '', wrap = null, el = null, mode = state.mode) {
        const normalized = String(text).trim();
        if (mode === 'error' || mode === 'listening' || mode === 'muted') return false;
        const overflows = !!(wrap && el && (
            el.scrollWidth > wrap.clientWidth + 32 ||
            el.scrollHeight > wrap.clientHeight + 8
        ));
        if (mode === 'speaking') return normalized.length > 112 || overflows;
        if (mode === 'thinking') return normalized.length > 160 || overflows;
        if (normalized.length > 190) return true;
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

    function render() {
        const rail = document.getElementById('crmAssistantRail');
        const stateEl = document.getElementById('crmAssistantRailState');
        const subtitlesWrap = document.getElementById('crmAssistantRailSubtitlesWrap');
        const subtitlesEl = document.getElementById('crmAssistantRailSubtitles');
        const voiceBtn = document.getElementById('crmAssistantVoiceToggle');
        const micBtn = document.getElementById('crmAssistantMicBtn');
        const replayBtn = document.getElementById('crmAssistantReplayBtn');
        if (!rail || !stateEl || !subtitlesEl || !voiceBtn) return;

        const text = state.tickerText || state.subtitle || '...';
        const snapshot = buildAssistantSnapshot();
        rail.dataset.mode = state.mode;
        rail.dataset.aiState = UI_STATES[state.mode] || 'ready';
        rail.dataset.live = isLiveMode(state.mode) ? 'true' : 'false';
        rail.dataset.playbackState = state.playbackState || 'idle';
        rail.dataset.subtitleMode = state.subtitleMode || 'static';
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
        subtitlesEl.textContent = text;
        subtitlesEl.classList.remove('is-ticker', 'is-live-line');
        subtitlesEl.removeAttribute('data-ticker-text');
        subtitlesEl.style.removeProperty('--assistant-ticker-duration');
        voiceBtn.textContent = state.voiceEnabled ? '🔊' : '🔇';
        voiceBtn.setAttribute('aria-pressed', state.voiceEnabled ? 'true' : 'false');
        voiceBtn.title = state.voiceBlocked
            ? 'Озвучення заблоковано браузером. Натисни після взаємодії, щоб спробувати знову.'
            : 'Увімкнути або вимкнути голос';
        if (micBtn) {
            const listening = mediaRecorder?.state === 'recording' || state.mode === 'listening';
            micBtn.classList.toggle('active', listening);
            micBtn.setAttribute('aria-pressed', listening ? 'true' : 'false');
            micBtn.title = listening ? 'Зупинити запис голосу' : 'Голосовий ввід';
        }
        if (replayBtn) {
            replayBtn.disabled = !(state.lastSpokenLine || state.subtitle);
            replayBtn.title = state.voiceEnabled ? 'Повторити останню репліку голосом' : 'Показати останню репліку ще раз';
        }

        requestAnimationFrame(() => {
            const liveLine = isLiveMode(state.mode);
            const ticker = shouldSubtitleScroll(text, subtitlesWrap, subtitlesEl, state.mode);
            const subtitleMode = ticker ? 'ticker' : liveLine ? 'live' : 'static';
            subtitlesEl.classList.toggle('is-live-line', liveLine);
            subtitlesEl.classList.toggle('is-ticker', ticker);
            subtitlesWrap?.classList.toggle('is-ticker-wrap', ticker);
            rail.dataset.subtitleMode = subtitleMode;
            state.subtitleMode = subtitleMode;
            if (ticker) {
                subtitlesEl.setAttribute('data-ticker-text', text);
                const duration = Math.min(34, Math.max(18, Math.ceil(String(text).length / 7)));
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

    async function speakText(text) {
        const line = String(text || '').trim();
        if (!line) return;
        playbackRunId += 1;
        const runId = playbackRunId;
        releaseAudioPlayer();
        let resp;
        try {
            resp = await fetch('/api/crm-assistant/speak', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + localStorage.getItem('pzp_token')
                },
                body: JSON.stringify({ text: line })
            });
        } catch (err) {
            if (runId !== playbackRunId) return { interrupted: true };
            throw err;
        }
        if (runId !== playbackRunId) return { interrupted: true };
        if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            throw new Error(data.error || `crm_assistant_speak_http_${resp.status}`);
        }
        const blob = await resp.blob();
        if (runId !== playbackRunId) return { interrupted: true };
        audioUrl = URL.createObjectURL(blob);
        audioPlayer = new Audio(audioUrl);
        audioPlayer.onended = () => {
            if (runId !== playbackRunId) return;
            releaseAudioPlayer();
            clearSpeakingIdleTimer();
            if (state.mode === 'speaking') setState({ mode: 'idle', playbackState: 'ended', tickerText: '' });
        };
        audioPlayer.onerror = () => {
            if (runId !== playbackRunId) return;
            releaseAudioPlayer();
            if (state.mode === 'speaking') setState({ mode: 'idle', playbackState: 'error', tickerText: '' });
        };
        await audioPlayer.play();
        if (runId === playbackRunId) {
            setState({ mode: 'speaking', playbackState: 'playing', subtitle: line, tickerText: line });
            scheduleSpeakingIdleFallback(line);
        }
        return { success: true };
    }

    async function playReply(reply, options = {}) {
        const text = String(reply?.subtitle || reply?.summary || reply?.text || '').trim();
        if (!text) return;
        if (options.addToHistory !== false) appendHistory('assistant', text);
        const shouldPlayAudio = state.voiceEnabled && !options.textOnly;
        clearSpeakingIdleTimer();
        stopAudioPlayback();
        setState({
            mode: shouldPlayAudio ? 'speaking' : state.voiceEnabled ? 'idle' : 'muted',
            subtitle: text,
            tickerText: shouldPlayAudio ? text : '',
            lastSpokenLine: text,
            playbackState: shouldPlayAudio ? 'loading' : state.voiceEnabled ? 'text' : 'muted'
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

    async function toggleListening() {
        cancelProactiveHelp();
        if (state.mode === 'speaking' || audioPlayer) {
            stopAudioPlayback({ setIdle: true, reason: 'interrupted' });
        }
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            setState({ mode: 'thinking', subtitle: 'Завершую запис і готую відповідь...', tickerText: '', playbackState: 'idle' });
            mediaRecorder.stop();
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
            const mimeType = pickAudioMimeType();
            const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
            mediaRecorder = recorder;

            recorder.ondataavailable = event => {
                if (event.data && event.data.size > 0) audioChunks.push(event.data);
            };
            recorder.onstop = async () => {
                const chunks = audioChunks.slice();
                audioChunks = [];
                if (listeningStream) {
                    listeningStream.getTracks().forEach(track => track.stop());
                    listeningStream = null;
                }
                if (!chunks.length) {
                    setState({ mode: 'idle', subtitle: 'Не почувив голос. Спробуй ще раз.' });
                    return;
                }
                try {
                    setState({ mode: 'thinking', subtitle: 'Розпізнаю голос і готую відповідь...' });
                    const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
                    const transcript = await transcribeAudioBlob(blob);
                    if (!transcript) throw new Error('empty_transcript');
                    appendHistory('user', transcript);
                    setState({ mode: 'thinking', subtitle: `Почув: ${transcript}` });
                    const reply = await requestGuideReply({ userMessage: transcript, voiceMode: true });
                    await playReply(reply);
                } catch (err) {
                    emitTelemetry('voice_transcription_failed', {
                        module: 'rail:voice',
                        failureReason: err.message || String(err),
                        fallbackShown: true
                    });
                    handleError(err, 'Не вдалося розпізнати голос або підготувати відповідь.');
                }
            };

            setState({ mode: 'listening', subtitle: 'Слухаю. Скажи коротко, що треба зробити.', tickerText: '', playbackState: 'listening' });
            recorder.start();
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

    function appendHistory(role, text) {
        const line = String(text || '').trim();
        if (!line) return;
        history.push({ role, text: line, at: new Date().toISOString() });
        if (history.length > 16) history = history.slice(-16);
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
                        <strong>Клешня</strong>
                        <span>AI-провідник CRM</span>
                    </div>
                    <button type="button" class="crm-assistant-panel-close" aria-label="Закрити" id="crmAssistantPanelClose">×</button>
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
                <div class="crm-assistant-history" id="crmAssistantHistory"></div>
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
        document.getElementById('crmAssistantPanelClose')?.addEventListener('click', closePanel);
        document.getElementById('crmAssistantForm')?.addEventListener('submit', submitPrompt);
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
            <div class="crm-assistant-history-item ${escapeHtml(item.role)}">
                <span>${item.role === 'user' ? 'Ти' : 'Клешня'}</span>
                <p>${escapeHtml(item.text)}</p>
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
        const actionType = proposal.actionType ? `<em>${escapeHtml(proposal.actionType)}</em>` : '';
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

    async function submitPromptText(text) {
        const prompt = String(text || '').trim();
        if (!prompt) return;
        cancelProactiveHelp();
        stopAudioPlayback({ setIdle: false, reason: 'interrupted' });
        appendHistory('user', prompt);
        renderHistory();
        setState({ mode: 'thinking', subtitle: 'Думаю над відповіддю по цій сторінці...', tickerText: '', playbackState: 'idle' });
        try {
            const reply = await requestGuideReply({ userMessage: prompt });
            await playReply(reply);
        } catch (err) {
            emitTelemetry('reply_failed', {
                module: 'rail:submitPrompt',
                failureReason: err.message || String(err),
                fallbackShown: true
            });
            handleError(err);
        }
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
        if (!ensureMounted()) return false;
        if (options.subtitle) announceFromPage(options.subtitle);
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
        highlightTeachingTarget,
        buildPageGuideContext,
        getAssetVersion
    };

    document.addEventListener('DOMContentLoaded', () => {
        if (document.body.classList.contains('authenticated-shell')) init();
    });
})();
