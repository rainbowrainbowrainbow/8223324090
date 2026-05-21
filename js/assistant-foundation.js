/**
 * js/assistant-foundation.js - compact CRM assistant contracts.
 *
 * This is intentionally small: one store, one optional page-adapter contract,
 * one thin action registry, one teaching-target normalizer, and one reply
 * schema normalizer for the shared rail.
 */
(function () {
    const CONTRACT_VERSION = 'assistant_foundation_v1';
    if (window.CrmAssistantFoundation?.CONTRACT_VERSION === CONTRACT_VERSION) return;

    const MODES = new Set(['idle', 'thinking', 'busy', 'listening', 'speaking', 'muted', 'error', 'working', 'streaming', 'action', 'success']);
    const RISK_LEVELS = new Set(['none', 'low', 'medium', 'high', 'critical']);
    const CONFIDENCE_LEVELS = new Set(['low', 'medium', 'high', 'exact']);
    const subscribers = new Set();
    const adapters = new Map();
    const actions = new Map();
    const highlightTimers = new Map();
    const snapshotCache = new Map();
    const snapshotInflight = new Map();
    const SNAPSHOT_TTL_MS = 45000;
    const TELEMETRY_THROTTLE_MS = 60000;
    const telemetryLastSent = new Map();

    function nowIso() {
        return new Date().toISOString();
    }

    function readStorage(key, fallback = '') {
        try {
            return localStorage.getItem(key) ?? fallback;
        } catch {
            return fallback;
        }
    }

    function compactText(value, limit = 180) {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        if (text.length <= limit) return text;
        return `${text.slice(0, Math.max(0, limit - 1)).trim()}...`;
    }

    const UI_TEXT_REPLACEMENTS = [
        [/\bShow overdue tasks\b/gi, 'Показати прострочені задачі'],
        [/\bFocus work queue\b/gi, 'Відкрити робочу чергу'],
        [/\bShow reply backlog\b/gi, 'Показати чергу відповідей'],
        [/\bRefresh work queue\b/gi, 'Оновити робочу чергу'],
        [/\bOpen waiting tasks\b/gi, 'Відкрити задачі в очікуванні'],
        [/\bFocus first overdue task\b/gi, 'Показати першу прострочену задачу'],
        [/\bOpen debts tab\b/gi, 'Відкрити борги'],
        [/\bOpen finance analytics\b/gi, 'Відкрити фінансову аналітику'],
        [/\bOpen leads kanban\b/gi, 'Відкрити канбан лідів'],
        [/\bFocus hot lead\b/gi, 'Показати гарячий лід'],
        [/\bFilter unread chats\b/gi, 'Показати непрочитані чати'],
        [/\bFocus first unread chat\b/gi, 'Показати перший непрочитаний чат'],
        [/\bDashboard widget grid\b/gi, 'Сітка віджетів дашборда'],
        [/\bDashboard work queue snapshot\b/gi, 'Зріз робочої черги дашборда'],
        [/\bDashboard operating context\b/gi, 'Операційний контекст дашборда'],
        [/\bWork queue items\b/gi, 'Елементи робочої черги'],
        [/\bWaiting reply pressure\b/gi, 'Тиск очікуваних відповідей'],
        [/\bOverdue task pressure\b/gi, 'Тиск прострочених задач'],
        [/\bLead follow-ups due\b/gi, 'Ліди, яким потрібен follow-up'],
        [/\bBooking confirmations\b/gi, 'Підтвердження бронювань'],
        [/\bWork queue bottleneck\b/gi, 'Вузьке місце робочої черги'],
        [/\bWork queue API snapshot unavailable\b/gi, 'Зріз робочої черги недоступний'],
        [/\bWaiting reply queue\b/gi, 'Черга відповідей'],
        [/\bOverdue work queue\b/gi, 'Прострочене в робочій черзі'],
        [/\bCurrent tasks board slice\b/gi, 'Поточний зріз задач'],
        [/\bInbox tab count\b/gi, 'Кількість в інбоксі'],
        [/\bToday tab count\b/gi, 'Кількість на сьогодні'],
        [/\bTeam tab count\b/gi, 'Командні задачі'],
        [/\bMy tab count\b/gi, 'Мої задачі'],
        [/\bOverdue tasks\b/gi, 'Прострочені задачі'],
        [/\bWaiting tasks\b/gi, 'Задачі в очікуванні'],
        [/\bNear deadline tasks\b/gi, 'Задачі з близьким дедлайном'],
        [/\bTasks without typed owner\b/gi, 'Задачі без відповідального'],
        [/\bPersonal cabinet projection\b/gi, 'Персональний зріз кабінету'],
        [/\bTasks API snapshot unavailable\b/gi, 'Зріз задач недоступний'],
        [/\bToday tasks\b/gi, 'Задачі на сьогодні'],
        [/\bVisible overdue deadlines\b/gi, 'Видимі прострочені дедлайни'],
        [/\bTasks live board snapshot\b/gi, 'Живий зріз дошки задач'],
        [/\bTasks API personal projection\b/gi, 'Персональний API-зріз задач'],
        [/\bTasks board context\b/gi, 'Контекст дошки задач'],
        [/\bFinance API snapshot\b/gi, 'Фінансовий API-зріз'],
        [/\bOverdue payment debt\b/gi, 'Прострочена заборгованість'],
        [/\bNegative monthly profit\b/gi, 'Мінусовий прибуток місяця'],
        [/\bNegative weekly cashflow\b/gi, 'Мінусовий cashflow тижня'],
        [/\bFinance KPI cards\b/gi, 'Фінансові KPI'],
        [/\bVisible debt rows\b/gi, 'Видимі рядки боргів'],
        [/\bFinance risk\/control snapshot\b/gi, 'Фінансовий зріз ризиків і контролю'],
        [/\bFinance control context\b/gi, 'Фінансовий контекст контролю'],
        [/\bHot leads waiting follow-up\b/gi, 'Гарячі ліди чекають follow-up'],
        [/\bNew leads this period\b/gi, 'Нові ліди за період'],
        [/\bUnread chat messages\b/gi, 'Непрочитані повідомлення'],
        [/\bCommunication snapshot loaded\b/gi, 'Зріз комунікацій завантажено'],
        [/\bCommunication API snapshot unavailable\b/gi, 'Зріз комунікацій недоступний'],
        [/\bVisible hot\/idle leads\b/gi, 'Видимі гарячі або завислі ліди'],
        [/\bWorkspace waiting reply signals\b/gi, 'Сигнали очікування відповіді'],
        [/\bChat response snapshot\b/gi, 'Зріз відповідей у чаті'],
        [/\bLead\/chat follow-up snapshot\b/gi, 'Зріз follow-up лідів і чатів'],
        [/\bChat response context\b/gi, 'Контекст відповідей у чаті'],
        [/\bLead pipeline context\b/gi, 'Контекст pipeline лідів'],
        [/\bTask board filters\b/gi, 'Фільтри дошки задач'],
        [/\bTask board\b/gi, 'Дошка задач'],
        [/\bFirst visible overdue task\b/gi, 'Перша видима прострочена задача'],
        [/\bDebt control\b/gi, 'Контроль боргів'],
        [/\bFinance analytics\b/gi, 'Фінансова аналітика'],
        [/\bLead stats\b/gi, 'Статистика лідів'],
        [/\bLead pipeline kanban\b/gi, 'Канбан pipeline лідів'],
        [/\bWaiting reply signal\b/gi, 'Сигнал очікування відповіді'],
        [/\bChat messages\b/gi, 'Повідомлення чату'],
        [/\bFirst unread channel\b/gi, 'Перший непрочитаний канал'],
        [/\bUse the dashboard widget grid as the main operating surface\b/gi, 'Використай сітку віджетів дашборда як головну робочу поверхню'],
        [/\bWork queue is hidden for this role or not loaded yet\b/gi, 'Робоча черга прихована для цієї ролі або ще не завантажена'],
        [/\bWork queue is not visible on this dashboard\b/gi, 'Робочу чергу не видно на цьому дашборді'],
        [/\bOverdue task filter is unavailable\b/gi, 'Фільтр прострочених задач недоступний'],
        [/\bReply backlog controls are unavailable\b/gi, 'Керування чергою відповідей недоступне'],
        [/\bDashboard work queue refresh is unavailable\b/gi, 'Оновлення робочої черги недоступне'],
        [/\bWaiting tasks tab is unavailable\b/gi, 'Вкладка задач в очікуванні недоступна'],
        [/\bNo stable overdue task card is visible\b/gi, 'Зараз не видно стабільної картки простроченої задачі'],
        [/\bNo visible overdue task has a stable card target right now\b/gi, 'Зараз немає видимої простроченої задачі зі стабільною карткою'],
        [/\bFinance debts tab is unavailable\b/gi, 'Вкладка боргів недоступна'],
        [/\bFinance advanced analytics tab is unavailable\b/gi, 'Вкладка фінансової аналітики недоступна'],
        [/\bOpen the debts tab to inspect unpaid bookings\b/gi, 'Відкрий борги, щоб перевірити неоплачені бронювання'],
        [/\bLeads kanban is unavailable\b/gi, 'Канбан лідів недоступний'],
        [/\bNo stable hot lead target is visible\b/gi, 'Зараз не видно стабільної цілі гарячого ліда'],
        [/\bNo exact waiting-reply workspace target is visible yet\b/gi, 'Зараз не видно точної цілі для очікування відповіді'],
        [/\bUnread chat filter is unavailable\b/gi, 'Фільтр непрочитаних чатів недоступний'],
        [/\bNo stable unread chat target is visible\b/gi, 'Зараз не видно стабільної цілі непрочитаного чату'],
        [/\bNo unread channel is visible right now\b/gi, 'Зараз не видно непрочитаного каналу'],
        [/\bNo stable target is available for this guidance\b/gi, 'Для цієї підказки зараз немає стабільної цілі'],
        [/\bdashboard\.focus-work-queue\b/gi, 'фокус на робочу чергу'],
        [/\bdashboard\.show-overdue-tasks\b/gi, 'фільтр прострочених задач'],
        [/\bdashboard\.show-reply-backlog\b/gi, 'черга відповідей'],
        [/\btasks\.focus-overdue\b/gi, 'прострочені задачі'],
        [/\bfinance\.open-debts\b/gi, 'борги'],
        [/\bleads\.focus-hot\b/gi, 'гарячі ліди'],
        [/\bchat\.filter-unread\b/gi, 'непрочитані чати'],
        [/\bFILTER\b/g, 'фільтр'],
        [/\bFOCUS\b/g, 'фокус'],
        [/\bteam_online\b/g, 'Команда онлайн'],
        [/\bstaff_today\b/g, 'Хто на зміні'],
        [/\bwork queue\b/gi, 'робоча черга'],
        [/\bdashboard\b/gi, 'дашборд'],
        [/\bcreator\b/gi, 'роль творця'],
        [/\btyped owner\b/gi, 'відповідальний']
    ];

    function localizeAssistantText(value) {
        let text = String(value || '').trim();
        if (!text) return '';
        UI_TEXT_REPLACEMENTS.forEach(([pattern, replacement]) => {
            text = text.replace(pattern, replacement);
        });
        return text;
    }

    function toList(value, limit = 20) {
        if (!Array.isArray(value)) return [];
        return value.filter(Boolean).slice(0, limit);
    }

    function numberValue(value, fallback = 0) {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function formatMoney(value) {
        const amount = numberValue(value, 0);
        try {
            return `${amount.toLocaleString('uk-UA')} грн`;
        } catch {
            return `${amount} грн`;
        }
    }

    function authHeaders() {
        const token = readStorage('pzp_token', '');
        return token ? { Authorization: `Bearer ${token}` } : {};
    }

    function emitTelemetry(eventType, details = {}) {
        const token = readStorage('pzp_token', '');
        if (!token || typeof fetch !== 'function') return false;
        const page = compactText(details.page || details.pageId || getPageId(), 80);
        const reason = compactText(details.failureReason || details.reason || '', 120);
        const dedupeKey = [
            eventType,
            page,
            compactText(details.module || 'foundation', 60),
            compactText(details.actionId || details.targetId || details.snapshotKey || '', 80),
            reason
        ].join(':');
        const now = Date.now();
        if (telemetryLastSent.has(dedupeKey) && now - telemetryLastSent.get(dedupeKey) < TELEMETRY_THROTTLE_MS) {
            return false;
        }
        telemetryLastSent.set(dedupeKey, now);
        const currentState = typeof state === 'object' && state ? state : {};
        const payload = {
            eventType: compactText(eventType, 80),
            page,
            module: compactText(details.module || 'foundation', 80),
            assistantState: compactText(details.assistantState || currentState.mode || '', 80),
            playbackState: compactText(details.playbackState || currentState.playbackState || '', 80),
            failureReason: reason,
            fallbackShown: details.fallbackShown === true || Boolean(currentState.fallbackReason),
            actionId: compactText(details.actionId || '', 100),
            targetId: compactText(details.targetId || '', 100),
            snapshotKey: compactText(details.snapshotKey || '', 100),
            source: compactText(details.source || 'assistant-foundation', 80)
        };
        fetch('/api/crm-assistant/telemetry', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload),
            keepalive: true
        }).catch(() => {});
        return true;
    }

    async function apiGetJson(path) {
        if (typeof fetch !== 'function') {
            const err = new Error('fetch_unavailable');
            err.status = 0;
            throw err;
        }
        const response = await fetch(path, { headers: authHeaders() });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const err = new Error(payload?.error || `assistant_snapshot_http_${response.status}`);
            err.status = response.status;
            err.payload = payload;
            throw err;
        }
        return payload;
    }

    function snapshotKey(pageId, key) {
        return `${compactText(pageId || getPageId(), 80)}:${compactText(key, 80)}`;
    }

    function setSnapshot(pageId, key, data, error = null) {
        const entry = {
            pageId: compactText(pageId || getPageId(), 80),
            key: compactText(key, 80),
            data: data || null,
            error: error ? compactText(error.message || error, 180) : '',
            status: error?.status || 200,
            at: Date.now(),
            updatedAt: nowIso()
        };
        snapshotCache.set(snapshotKey(pageId, key), entry);
        return entry;
    }

    function getSnapshotEntry(pageId, key, maxAgeMs = SNAPSHOT_TTL_MS) {
        const entry = snapshotCache.get(snapshotKey(pageId, key));
        if (!entry) return null;
        return {
            ...entry,
            stale: Date.now() - entry.at > maxAgeMs
        };
    }

    function getSnapshotData(pageId, key) {
        return getSnapshotEntry(pageId, key)?.data || null;
    }

    function snapshotError(pageId, key) {
        const entry = getSnapshotEntry(pageId, key);
        return entry?.error || '';
    }

    function snapshotRequestsForPage(pageId) {
        if (pageId === 'dashboard') {
            return [
                { key: 'workQueue', path: '/api/work-queue?replyScope=all&replySla=all&replyOwner=all&replyEscalation=all&limit=12' }
            ];
        }
        if (pageId === 'tasks') {
            return [
                { key: 'taskCabinet', path: '/api/tasks/my-cabinet' },
                { key: 'tasks', path: '/api/tasks?status=todo,in_progress&limit=160' }
            ];
        }
        if (pageId === 'finance') {
            return [
                { key: 'financeDebts', path: '/api/finance/debts' },
                { key: 'financeAdvanced', path: '/api/finance/advanced-dashboard' }
            ];
        }
        if (pageId === 'leads' || pageId === 'sales-funnel') {
            return [
                { key: 'hotLeads', path: '/api/leads/hot' },
                { key: 'leadStats', path: '/api/leads/stats?period=week' },
                { key: 'chatUnread', path: '/api/chat/unread' }
            ];
        }
        if (pageId === 'chat' || pageId === 'omni') {
            return [
                { key: 'chatUnread', path: '/api/chat/unread' }
            ];
        }
        return [];
    }

    async function refreshAdapterSnapshot(pageId = getPageId(), options = {}) {
        const page = compactText(pageId || getPageId(), 80);
        const requests = snapshotRequestsForPage(page);
        if (!requests.length) return { pageId: page, skipped: true, reason: 'no_snapshot_requests' };
        const refreshKey = `refresh:${page}`;
        if (!options.force && snapshotInflight.has(refreshKey)) return snapshotInflight.get(refreshKey);
        const promise = (async () => {
            const result = { pageId: page, refreshedAt: nowIso(), keys: [] };
            await Promise.all(requests.map(async request => {
                const fresh = getSnapshotEntry(page, request.key);
                if (!options.force && fresh && !fresh.stale) {
                    result.keys.push({ key: request.key, cached: true, ok: !fresh.error });
                    return;
                }
                try {
                    const payload = await apiGetJson(request.path);
                    setSnapshot(page, request.key, payload, null);
                    result.keys.push({ key: request.key, ok: true });
                } catch (err) {
                    setSnapshot(page, request.key, null, err);
                    result.keys.push({ key: request.key, ok: false, error: err.message || String(err), status: err.status || 0 });
                    emitTelemetry('snapshot_failed', {
                        page,
                        snapshotKey: request.key,
                        failureReason: err.message || String(err),
                        fallbackShown: true
                    });
                }
            }));
            return result;
        })();
        snapshotInflight.set(refreshKey, promise);
        try {
            return await promise;
        } finally {
            snapshotInflight.delete(refreshKey);
        }
    }

    function refreshContext(options = {}) {
        return refreshAdapterSnapshot(options.pageId || options.page || getPageId(), options);
    }

    function queueBucket(queue, key) {
        return (queue?.buckets || []).find(bucket => bucket?.key === key) || null;
    }

    function queueBucketCount(queue, key) {
        const bucket = queueBucket(queue, key);
        return numberValue(bucket?.count ?? bucket?.items?.length, 0);
    }

    function snapshotFallback(pageId, keys) {
        const errors = toList(keys, 8)
            .map(key => snapshotError(pageId, key))
            .filter(Boolean);
        return errors.length ? errors.join('; ') : '';
    }

    function getPageId() {
        const raw = window.location.pathname.replace(/^\/+/, '').replace(/\.html$/, '').replace(/\/$/, '');
        if (!raw || raw === 'index') return 'timeline';
        return raw;
    }

    function getSessionUser() {
        if (window.AppState?.currentUser) return window.AppState.currentUser;
        try {
            return JSON.parse(localStorage.getItem('pzp_current_user') || 'null');
        } catch {
            return null;
        }
    }

    function roleLabel(role) {
        if (!role) return '';
        return window.ROLE_NAMES?.[role] || role;
    }

    function getRoleSnapshot() {
        const user = getSessionUser();
        const role = String(user?.role || '').trim();
        const previewRole = role === 'creator' ? String(readStorage('pzp_test_role', '') || sessionStorage.getItem('testRole') || '').trim() : '';
        return {
            role,
            displayRole: roleLabel(previewRole || role),
            permissionRole: role,
            previewRole,
            isPreview: Boolean(previewRole),
            userId: user?.id || user?.userId || null,
            username: user?.username || '',
            source: user ? 'session_user' : 'missing_session_user'
        };
    }

    function normalizeMode(mode) {
        return MODES.has(mode) ? mode : 'idle';
    }

    function isVoiceExplicitlyEnabled() {
        return readStorage('eg_crm_assistant_voice', 'off') === 'on';
    }

    const state = {
        mode: isVoiceExplicitlyEnabled() ? 'idle' : 'muted',
        pageId: getPageId(),
        roleSnapshot: getRoleSnapshot(),
        lastAssistantSummaryLine: '',
        voiceEnabled: isVoiceExplicitlyEnabled(),
        muted: !isVoiceExplicitlyEnabled(),
        speaking: false,
        playbackState: 'idle',
        adapterId: '',
        currentActionProposal: null,
        currentTeachingTarget: null,
        currentTeachingFlow: null,
        currentContextSnapshot: null,
        fallbackReason: '',
        updatedAt: nowIso()
    };

    const store = {
        getState() {
            return {
                ...state,
                roleSnapshot: { ...(state.roleSnapshot || {}) },
                currentActionProposal: state.currentActionProposal ? { ...state.currentActionProposal } : null,
                currentTeachingTarget: state.currentTeachingTarget ? { ...state.currentTeachingTarget } : null,
                currentTeachingFlow: state.currentTeachingFlow ? { ...state.currentTeachingFlow } : null
            };
        },
        setState(patch = {}, meta = {}) {
            if (!patch || typeof patch !== 'object') return store.getState();
            if (Object.prototype.hasOwnProperty.call(patch, 'mode')) state.mode = normalizeMode(patch.mode);
            if (Object.prototype.hasOwnProperty.call(patch, 'pageId')) state.pageId = compactText(patch.pageId, 80) || getPageId();
            if (Object.prototype.hasOwnProperty.call(patch, 'roleSnapshot')) state.roleSnapshot = patch.roleSnapshot || getRoleSnapshot();
            if (Object.prototype.hasOwnProperty.call(patch, 'lastAssistantSummaryLine')) state.lastAssistantSummaryLine = compactText(patch.lastAssistantSummaryLine, 700);
            if (Object.prototype.hasOwnProperty.call(patch, 'voiceEnabled')) state.voiceEnabled = patch.voiceEnabled === true;
            if (Object.prototype.hasOwnProperty.call(patch, 'muted')) state.muted = patch.muted === true;
            if (Object.prototype.hasOwnProperty.call(patch, 'speaking')) state.speaking = patch.speaking === true;
            if (Object.prototype.hasOwnProperty.call(patch, 'playbackState')) state.playbackState = compactText(patch.playbackState, 40);
            if (Object.prototype.hasOwnProperty.call(patch, 'adapterId')) state.adapterId = compactText(patch.adapterId, 80);
            if (Object.prototype.hasOwnProperty.call(patch, 'currentActionProposal')) state.currentActionProposal = patch.currentActionProposal || null;
            if (Object.prototype.hasOwnProperty.call(patch, 'currentTeachingTarget')) state.currentTeachingTarget = patch.currentTeachingTarget || null;
            if (Object.prototype.hasOwnProperty.call(patch, 'currentTeachingFlow')) state.currentTeachingFlow = patch.currentTeachingFlow || null;
            if (Object.prototype.hasOwnProperty.call(patch, 'currentContextSnapshot')) state.currentContextSnapshot = patch.currentContextSnapshot || null;
            if (Object.prototype.hasOwnProperty.call(patch, 'fallbackReason')) state.fallbackReason = compactText(patch.fallbackReason, 240);
            state.updatedAt = nowIso();
            const snapshot = store.getState();
            subscribers.forEach(fn => {
                try { fn(snapshot, meta); } catch (err) { console.warn('[crm-assistant-foundation] subscriber failed', err); }
            });
            return snapshot;
        },
        subscribe(fn) {
            if (typeof fn !== 'function') return () => {};
            subscribers.add(fn);
            return () => subscribers.delete(fn);
        }
    };

    function normalizeSignal(signal = {}, index = 0) {
        if (typeof signal === 'string') {
            return {
                signalId: `signal-${index + 1}`,
                page: getPageId(),
                label: compactText(localizeAssistantText(signal), 140),
                value: '',
                severity: 'info',
                evidence: compactText(localizeAssistantText(signal), 220),
                source: 'adapter_text'
            };
        }
        const severity = ['info', 'success', 'warning', 'danger', 'critical'].includes(signal.severity) ? signal.severity : 'info';
        return {
            signalId: compactText(signal.signalId || signal.id || `signal-${index + 1}`, 80),
            page: compactText(signal.page || getPageId(), 80),
            label: compactText(localizeAssistantText(signal.label || signal.title || signal.type || 'Сигнал'), 140),
            value: compactText(signal.value ?? signal.count ?? '', 120),
            severity,
            evidence: compactText(localizeAssistantText(signal.evidence || signal.reason || signal.text || signal.label || ''), 260),
            source: compactText(signal.source || 'adapter', 80)
        };
    }

    function isStableSelector(selector) {
        const value = String(selector || '').trim();
        if (!value) return false;
        if (value.startsWith('#')) return true;
        if (value.includes('[data-assistant-target=')) return true;
        if (value.includes('[data-view=') || value.includes('[data-tab=') || value.includes('[data-widget=') || value.includes('[data-task-id]') || value.includes('[data-lead-id]') || value.includes('[data-id]')) return true;
        return false;
    }

    function normalizeTarget(target = {}, index = 0) {
        const selectorOrRef = target.selectorOrRef || target.selector || target.ref || '';
        const stable = typeof selectorOrRef !== 'string' || isStableSelector(selectorOrRef);
        const normalized = {
            targetId: compactText(target.targetId || target.id || `target-${index + 1}`, 90),
            page: compactText(target.page || getPageId(), 80),
            label: compactText(localizeAssistantText(target.label || target.title || 'Ціль Помічника'), 140),
            selectorOrRef,
            kind: compactText(target.kind || 'section', 40),
            priority: Number.isFinite(Number(target.priority)) ? Number(target.priority) : index + 1,
            available: target.available !== false && stable,
            reason: compactText(localizeAssistantText(target.reason || (stable ? '' : 'selector_not_stable')), 180),
            fallbackText: compactText(localizeAssistantText(target.fallbackText || 'Для цієї підказки зараз немає стабільної цілі.'), 220)
        };
        if (typeof selectorOrRef === 'string' && stable) {
            normalized.available = Boolean(document.querySelector(selectorOrRef));
            if (!normalized.available && !normalized.reason) normalized.reason = 'target_not_found';
        }
        return normalized;
    }

    function serializeTarget(target) {
        const normalized = normalizeTarget(target);
        return {
            targetId: normalized.targetId,
            page: normalized.page,
            label: normalized.label,
            selectorOrRef: typeof normalized.selectorOrRef === 'string' ? normalized.selectorOrRef : '',
            kind: normalized.kind,
            priority: normalized.priority,
            available: normalized.available,
            reason: normalized.reason,
            fallbackText: normalized.fallbackText
        };
    }

    function normalizeAction(action = {}, index = 0) {
        return {
            actionId: compactText(action.actionId || action.id || `action-${index + 1}`, 100),
            page: compactText(action.page || getPageId(), 80),
            actionType: compactText(action.actionType || action.type || 'focus', 60),
            label: compactText(localizeAssistantText(action.label || action.title || 'Дія Помічника'), 140),
            run: typeof action.run === 'function' ? action.run : null,
            confirmationNeeded: action.confirmationNeeded === true,
            targetResolver: typeof action.targetResolver === 'function' ? action.targetResolver : null,
            failureMessage: compactText(localizeAssistantText(action.failureMessage || 'Дія зараз недоступна.'), 220)
        };
    }

    function serializeAction(action) {
        const normalized = normalizeAction(action);
        return {
            actionId: normalized.actionId,
            page: normalized.page,
            actionType: normalized.actionType,
            label: normalized.label,
            confirmationNeeded: normalized.confirmationNeeded,
            failureMessage: normalized.failureMessage
        };
    }

    const actionRegistry = {
        register(action) {
            const normalized = normalizeAction(action);
            if (!normalized.actionId) return null;
            actions.set(normalized.actionId, normalized);
            return normalized;
        },
        unregister(actionId) {
            actions.delete(String(actionId || ''));
        },
        list(page = getPageId()) {
            return Array.from(actions.values()).filter(action => !page || action.page === page);
        },
        async run(actionId, payload = {}) {
            const action = actions.get(String(actionId || ''));
            if (!action || typeof action.run !== 'function') {
                emitTelemetry('action_unavailable', {
                    actionId,
                    failureReason: action?.failureMessage || 'assistant_action_unavailable',
                    fallbackShown: true
                });
                throw new Error(action?.failureMessage || 'assistant_action_unavailable');
            }
            if (action.confirmationNeeded && typeof window.confirm === 'function') {
                const ok = window.confirm(action.label);
                if (!ok) return { success: false, cancelled: true };
            }
            try {
                store.setState({ mode: 'action', currentActionProposal: serializeAction(action) }, { source: 'action:start' });
                const result = await action.run(payload);
                store.setState({ mode: 'success', currentActionProposal: null }, { source: 'action:success' });
                return result || { success: true };
            } catch (err) {
                store.setState({ mode: 'error', fallbackReason: action.failureMessage || err.message }, { source: 'action:error' });
                emitTelemetry('action_unavailable', {
                    page: action.page,
                    actionId: action.actionId,
                    failureReason: action.failureMessage || err.message,
                    fallbackShown: true
                });
                throw err;
            }
        }
    };

    function elementForTarget(targetOrId) {
        let target = targetOrId;
        if (typeof targetOrId === 'string') {
            const active = buildContext({ silent: true }).teachingTargets || [];
            const safeId = window.CSS?.escape ? CSS.escape(targetOrId) : String(targetOrId).replace(/"/g, '\\"');
            target = active.find(item => item.targetId === targetOrId) || { selectorOrRef: `[data-assistant-target="${safeId}"]` };
        }
        const normalized = normalizeTarget(target);
        if (!normalized.available) return { target: normalized, element: null };
        const ref = normalized.selectorOrRef;
        if (ref && typeof ref !== 'string' && typeof Element !== 'undefined' && ref instanceof Element) return { target: normalized, element: ref };
        return { target: normalized, element: typeof ref === 'string' ? document.querySelector(ref) : null };
    }

    function highlightTarget(targetOrId, options = {}) {
        const { target, element } = elementForTarget(targetOrId);
        if (!element) {
            store.setState({
                currentTeachingTarget: serializeTarget(target),
                fallbackReason: target.reason || target.fallbackText || 'target_not_found'
            }, { source: 'target:missing' });
            emitTelemetry('teaching_target_missing', {
                page: target.page,
                targetId: target.targetId,
                failureReason: target.reason || target.fallbackText || 'target_not_found',
                fallbackShown: true
            });
            return { success: false, target: serializeTarget(target), fallbackText: target.fallbackText };
        }
        element.scrollIntoView?.({ behavior: options.behavior || 'smooth', block: options.block || 'center' });
        element.classList.add('crm-assistant-target-highlight');
        window.CrmAssistantRail?.showClickGuide?.(serializeTarget(target), element, {
            label: target.label,
            durationMs: options.durationMs || 3600
        });
        const key = target.targetId;
        if (highlightTimers.has(key)) window.clearTimeout(highlightTimers.get(key));
        highlightTimers.set(key, window.setTimeout(() => {
            element.classList.remove('crm-assistant-target-highlight');
            highlightTimers.delete(key);
        }, options.durationMs || 2600));
        store.setState({ currentTeachingTarget: serializeTarget(target), fallbackReason: '' }, { source: 'target:highlight' });
        return { success: true, target: serializeTarget(target) };
    }

    function markTarget(targetId, selector) {
        const element = document.querySelector(selector);
        if (!element) return false;
        element.setAttribute('data-assistant-target', targetId);
        return true;
    }

    function markFirstTarget(targetId, selector) {
        const element = document.querySelector(selector);
        if (!element) return false;
        element.setAttribute('data-assistant-target', targetId);
        return true;
    }

    function markKnownTargets(pageId = getPageId()) {
        markTarget('assistant-rail', '#crmAssistantRail');
        if (pageId === 'dashboard') {
            markTarget('dashboard-grid', '#dashboardGrid');
            markTarget('dashboard-work-queue', '#workQueuePanel, #widget-funnel, [data-widget="funnel"]');
            markTarget('dashboard-greeting', '#dashboardGreeting');
        }
        if (pageId === 'tasks') {
            markTarget('tasks-tabs', '#boardTabs');
            markTarget('tasks-board', '#boardContent');
            markTarget('tasks-operations-summary', '#operationsSummary');
            markTarget('tasks-waiting-tab', '.board-tab[data-view="waiting"]');
            markFirstTarget('tasks-first-overdue', '.task-card[data-task-id] .deadline-overdue');
        }
        if (pageId === 'finance') {
            markTarget('finance-stats', '#finStats');
            markTarget('finance-debts-tab', '.fin-tab[data-tab="debts"]');
            markTarget('finance-debts', '#debtsContent');
            markTarget('finance-advanced', '#advancedContent');
        }
        if (pageId === 'leads' || pageId === 'sales-funnel') {
            markTarget('leads-stats', '#leadsStats');
            markTarget('leads-kanban', '#kanbanView');
            markTarget('leads-workspace', '#leadWorkspace');
            markFirstTarget('leads-first-hot', '.kanban-card[data-id].idle-red, [data-lead-id]');
            markFirstTarget('leads-waiting-reply', '.workspace-badge.waiting, .workspace-row-meta.waiting');
        }
        if (pageId === 'chat' || pageId === 'omni') {
            markTarget('chat-messages', '#chatMessages');
            markTarget('chat-unread-filter', '[data-omni-filter="unread"]');
            markFirstTarget('chat-first-unread', '.chat-channel-item.has-unread');
        }
    }

    const TEACHING_FLOWS = {
        'dashboard.work-queue-review': {
            flowId: 'dashboard.work-queue-review',
            page: 'dashboard',
            title: 'Work queue review',
            steps: [
                { stepId: 'dashboard.queue', targetId: 'dashboard-work-queue', label: 'Work queue', text: 'Тут видно bottlenecks: відповіді, прострочки, підтвердження і follow-up.' },
                { stepId: 'dashboard.grid', targetId: 'dashboard-grid', label: 'Dashboard grid', text: 'Після черги звір KPI-віджети, щоб зрозуміти масштаб ризику.' }
            ]
        },
        'tasks.overdue-review': {
            flowId: 'tasks.overdue-review',
            page: 'tasks',
            title: 'Overdue task review',
            steps: [
                { stepId: 'tasks.filters', targetId: 'tasks-tabs', label: 'Task filters', text: 'Почни з фільтрів дошки: вони швидко відрізають inbox, waiting і твої задачі.' },
                { stepId: 'tasks.board', targetId: 'tasks-board', label: 'Task board', text: 'Тут видно активні задачі та їхній поточний статус.' },
                { stepId: 'tasks.overdue', targetId: 'tasks-first-overdue', label: 'Overdue task', text: 'Якщо прострочена задача є на екрані, її краще відкрити першою.' }
            ]
        },
        'finance.debt-review': {
            flowId: 'finance.debt-review',
            page: 'finance',
            title: 'Debt control review',
            steps: [
                { stepId: 'finance.stats', targetId: 'finance-stats', label: 'Finance KPIs', text: 'Почни з KPI, щоб оцінити загальну картину грошей.' },
                { stepId: 'finance.debts-tab', targetId: 'finance-debts-tab', label: 'Debts tab', text: 'Відкрий борги, якщо потрібен контроль оплат.' },
                { stepId: 'finance.debts', targetId: 'finance-debts', label: 'Debt table', text: 'Тут перевір суми, клієнтів і бронювання з недоплатою.' }
            ]
        },
        'leads.follow-up-review': {
            flowId: 'leads.follow-up-review',
            page: 'leads',
            title: 'Lead follow-up review',
            steps: [
                { stepId: 'leads.stats', targetId: 'leads-stats', label: 'Lead stats', text: 'Спершу подивись, де накопичився pipeline pressure.' },
                { stepId: 'leads.kanban', targetId: 'leads-kanban', label: 'Lead kanban', text: 'На kanban зручно знайти гарячі ліди та наступну комунікацію.' },
                { stepId: 'leads.waiting', targetId: 'leads-waiting-reply', label: 'Waiting reply', text: 'Якщо є точний waiting-reply сигнал, працюй з ним першим.' }
            ]
        },
        'chat.unread-review': {
            flowId: 'chat.unread-review',
            page: 'chat',
            title: 'Unread chat review',
            steps: [
                { stepId: 'chat.unread-filter', targetId: 'chat-unread-filter', label: 'Unread filter', text: 'Фільтр непрочитаних допомагає швидко прибрати шум.' },
                { stepId: 'chat.first-unread', targetId: 'chat-first-unread', label: 'Unread channel', text: 'Почни з першого стабільно видимого каналу з unread.' }
            ]
        }
    };

    function defaultTeachingFlowForPage(pageId = getPageId()) {
        if (pageId === 'dashboard') return 'dashboard.work-queue-review';
        if (pageId === 'tasks') return 'tasks.overdue-review';
        if (pageId === 'finance') return 'finance.debt-review';
        if (pageId === 'leads' || pageId === 'sales-funnel') return 'leads.follow-up-review';
        if (pageId === 'chat' || pageId === 'omni') return 'chat.unread-review';
        return '';
    }

    function teachingTargetForStep(step = {}) {
        const context = buildContext({ pageId: getPageId(), silent: true });
        const target = toList(context.teachingTargets || [], 20).find(item => item.targetId === step.targetId);
        return target || normalizeTarget({
            targetId: step.targetId,
            page: getPageId(),
            label: step.label,
            selectorOrRef: step.selectorOrRef || '',
            fallbackText: step.fallbackText || 'This guided step has no stable target on the current screen.'
        });
    }

    function serializeTeachingFlow(flow, index = 0, step = null) {
        if (!flow) return null;
        const steps = toList(flow.steps || [], 4);
        return {
            flowId: compactText(flow.flowId || flow.id || 'teaching-flow', 90),
            page: compactText(flow.page || getPageId(), 80),
            title: compactText(flow.title || 'Guided flow', 140),
            index: Math.max(0, Math.min(index, Math.max(steps.length - 1, 0))),
            total: steps.length,
            active: steps.length > 0,
            step: step ? {
                stepId: compactText(step.stepId || step.targetId || 'step', 90),
                targetId: compactText(step.targetId || '', 90),
                label: compactText(step.label || '', 140),
                text: compactText(step.text || '', 260)
            } : null,
            updatedAt: nowIso()
        };
    }

    function runTeachingStep(flow, index = 0) {
        const steps = toList(flow?.steps || [], 4);
        const step = steps[index];
        if (!step) {
            store.setState({ currentTeachingFlow: null, currentTeachingTarget: null }, { source: 'teaching:done' });
            return { success: false, done: true };
        }
        const target = teachingTargetForStep(step);
        const flowState = serializeTeachingFlow(flow, index, step);
        store.setState({ currentTeachingFlow: flowState }, { source: 'teaching:step' });
        const highlight = highlightTarget(target, { durationMs: 3600 });
        return {
            ...highlight,
            flow: store.getState().currentTeachingFlow,
            step: flowState.step,
            fallbackText: highlight.success ? '' : (target.fallbackText || step.fallbackText || 'target_unavailable')
        };
    }

    function startTeachingFlow(flowIdOrSteps = '', options = {}) {
        const pageId = compactText(options.pageId || options.page || getPageId(), 80);
        const flowId = Array.isArray(flowIdOrSteps)
            ? 'custom.teaching-flow'
            : compactText(flowIdOrSteps || options.flowId || defaultTeachingFlowForPage(pageId), 90);
        const flow = Array.isArray(flowIdOrSteps)
            ? { flowId, page: pageId, title: options.title || 'Guided flow', steps: flowIdOrSteps }
            : TEACHING_FLOWS[flowId];
        if (!flow || !toList(flow.steps || [], 4).length) {
            store.setState({ fallbackReason: 'teaching_flow_unavailable', currentTeachingFlow: null }, { source: 'teaching:missing' });
            return { success: false, fallbackText: 'teaching_flow_unavailable' };
        }
        return runTeachingStep({ ...flow, page: pageId }, 0);
    }

    function nextTeachingStep() {
        const current = store.getState().currentTeachingFlow;
        if (!current?.active) return { success: false, fallbackText: 'teaching_flow_inactive' };
        const flow = TEACHING_FLOWS[current.flowId];
        const nextIndex = numberValue(current.index, 0) + 1;
        if (!flow || nextIndex >= numberValue(current.total, 0)) {
            store.setState({ currentTeachingFlow: null, currentTeachingTarget: null }, { source: 'teaching:done' });
            return { success: true, done: true };
        }
        return runTeachingStep(flow, nextIndex);
    }

    function dismissTeachingFlow() {
        store.setState({ currentTeachingFlow: null, currentTeachingTarget: null, fallbackReason: '' }, { source: 'teaching:dismiss' });
        return { success: true };
    }

    function safeText(selector, limit = 140) {
        return compactText(document.querySelector(selector)?.textContent || '', limit);
    }

    function readCount(selector) {
        const text = safeText(selector, 40);
        const match = text.match(/-?\d+/);
        return match ? Number(match[0]) : 0;
    }

    function clickSelector(selector) {
        const element = document.querySelector(selector);
        if (!element) return false;
        element.click();
        return true;
    }

    function navigateForAction(href) {
        const safeHref = String(href || '').trim();
        if (!safeHref) return { success: false, failureReason: 'missing_navigation_target' };
        window.setTimeout(() => {
            window.location.assign(safeHref);
        }, 80);
        return { success: true, navigating: true, href: safeHref };
    }

    function delayedHighlightTarget(targetId, delayMs = 120) {
        return new Promise(resolve => {
            window.setTimeout(() => resolve(highlightTarget(targetId)), delayMs);
        });
    }

    function persistReplyBacklogPreset(preset = 'team_overdue') {
        const map = {
            all: { scope: 'all', sla: 'all', owner: 'all', escalation: 'all', preset: 'all' },
            mine_overdue: { scope: 'mine', sla: 'overdue', owner: 'all', escalation: 'all', preset: 'mine_overdue' },
            team_overdue: { scope: 'team', sla: 'overdue', owner: 'all', escalation: 'all', preset: 'team_overdue' },
            unassigned: { scope: 'all', sla: 'all', owner: 'without_owner', escalation: 'all', preset: 'unassigned' },
            escalated: { scope: 'all', sla: 'all', owner: 'all', escalation: 'escalated', preset: 'escalated' }
        };
        const next = map[preset] || map.team_overdue;
        try {
            localStorage.setItem('eg_reply_backlog_scope', next.scope);
            localStorage.setItem('eg_reply_console_filters', JSON.stringify(next));
        } catch (err) {
            console.warn('[crm-assistant-foundation] reply backlog preset persistence failed', err);
        }
        return next;
    }

    function focusDashboardQueueSurface() {
        const result = highlightTarget('dashboard-work-queue');
        if (result?.success) return result;
        return highlightTarget('dashboard-grid');
    }

    function openDashboardReplyBacklog() {
        persistReplyBacklogPreset('team_overdue');
        if (document.getElementById('workQueuePanel') && window.DashboardPage?.setReplyConsoleFilter) {
            window.DashboardPage.setReplyConsoleFilter('preset', 'team_overdue');
            return delayedHighlightTarget('dashboard-work-queue', 180);
        }
        return navigateForAction('omni.html?filter=waiting&replySla=overdue');
    }

    function openDashboardOverdueTasks() {
        if (document.getElementById('workQueuePanel') && window.DashboardPage?.setReplyConsoleFilter) {
            window.DashboardPage.setReplyConsoleFilter('sla', 'overdue');
            return delayedHighlightTarget('dashboard-work-queue', 180);
        }
        return navigateForAction('tasks.html?view=team&assistantFilter=overdue');
    }

    const ACTION_COMMAND_VERSION = 'assistant_action_commands_v1';
    const PENDING_COMMAND_KEY = 'eg_crm_assistant_pending_command_v1';
    const SAFE_COMMAND_TYPES = new Set(['navigation', 'filter', 'focus', 'highlight', 'theme', 'ui', 'voice']);
    const CONFIRMATION_COMMAND_TYPES = new Set(['create_task']);
    const FORBIDDEN_COMMAND_PATTERNS = [
        /видал(и|ити|ення)|delete|destroy|drop/i,
        /парол|password|token|токен|secret|ключ/i,
        /права доступу|permission|role|роль/i,
        /оплат(и|ити)|списати|переказ|refund|повернення коштів/i,
        /відправ(и|ити).*(повідомлення|message|telegram|email)/i
    ];
    const PAGE_COMMANDS = [
        { pageId: 'timeline', href: 'index.html', aliases: ['таймлайн', 'timeline', 'день'] },
        { pageId: 'dashboard', href: 'dashboard.html', aliases: ['dashboard', 'дашборд', 'головна', 'головний екран'] },
        { pageId: 'tasks', href: 'tasks.html', aliases: ['tasks', 'задачі', 'задач', 'таски'] },
        { pageId: 'leads', href: 'leads.html', aliases: ['leads', 'ліди', 'лід', 'воронка'] },
        { pageId: 'chat', href: 'chat.html', aliases: ['chat', 'чат', 'діалоги', 'комунікації'] },
        { pageId: 'finance', href: 'finance.html', aliases: ['finance', 'фінанси', 'борги', 'p&l', 'pnl'] },
        { pageId: 'reports', href: 'reports.html', aliases: ['reports', 'звіти', 'звіт'] },
        { pageId: 'profile', href: 'profile.html', aliases: ['profile', 'профіль', 'кабінет'] }
    ];

    function normalizeCommandText(value = '') {
        return String(value || '')
            .toLowerCase()
            .replace(/[«»“”]/g, '"')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function isReadOnlyTimelineScheduleQuestion(text = '', options = {}) {
        const pageId = compactText(options.pageId || getPageId(), 80);
        if (pageId !== 'timeline') return false;
        const asksSchedule = /(заход|захор|поді[яї]|брон|івент|event|booking|афіш)/i.test(text);
        const asksDate = /(сьогодні|завтра|післязавтра|today|tomorrow|after tomorrow)/i.test(text);
        const asksReadOnly = /(які|що|скажи|покажи|розкажи|список|є|скільки|what|show|tell|list)/i.test(text);
        return asksSchedule && asksDate && asksReadOnly;
    }

    function commandHasAny(text = '', terms = []) {
        return terms.some(term => text.includes(String(term).toLowerCase()));
    }

    function routeResult(overrides = {}) {
        return {
            matched: true,
            blocked: false,
            requiresInput: false,
            confirmationNeeded: false,
            commandType: 'ui',
            actionId: '',
            label: '',
            summary: '',
            payload: {},
            safe: true,
            ...overrides
        };
    }

    function forbiddenCommand(text = '') {
        return FORBIDDEN_COMMAND_PATTERNS.find(pattern => pattern.test(text)) || null;
    }

    function currentPageHref(pageId = getPageId()) {
        const page = PAGE_COMMANDS.find(item => item.pageId === pageId);
        return page?.href || `${pageId}.html`;
    }

    function pageCommandForText(text = '') {
        return PAGE_COMMANDS.find(item => commandHasAny(text, item.aliases)) || null;
    }

    function sidebarPageCommandForText(text = '') {
        const items = Array.isArray(window.Sidebar?.NAV_ITEMS) ? window.Sidebar.NAV_ITEMS : [];
        for (const item of items) {
            const href = String(item?.href || '').trim();
            if (!href || href.startsWith('#') || item.type === 'group') continue;
            const label = normalizeCommandText(item.label || '');
            const slug = normalizeCommandText(href.replace(/^\//, '').replace(/\.html$/, '').replace(/[?#].*$/, ''));
            if ((label && text.includes(label)) || (slug && text.includes(slug))) {
                return {
                    pageId: slug || 'crm',
                    href,
                    aliases: [label, slug].filter(Boolean)
                };
            }
        }
        return null;
    }

    function taskViewForCommand(text = '') {
        if (/waiting|чекаю|очіку/.test(text)) return 'waiting';
        if (/канбан|kanban|дошк/.test(text)) return 'board';
        if (/мої|my/.test(text)) return 'my';
        if (/сьогодні|today/.test(text)) return 'today';
        if (/наступн|next/.test(text)) return 'next';
        if (/архів|archive/.test(text)) return 'archive';
        return '';
    }

    function sectionActionForCommand(text = '', targetPage = getPageId()) {
        if (/борг|debt/.test(text)) return { pageId: 'finance', actionId: 'finance.open-debts', targetId: 'finance-debts' };
        if (/p&l|pnl|аналітик|analytics/.test(text)) return { pageId: 'finance', actionId: 'finance.open-advanced', targetId: 'finance-advanced' };
        if (/гаряч|hot|follow|kanban|канбан/.test(text) && /лід|lead|ворон/.test(text)) return { pageId: 'leads', actionId: 'leads.open-kanban', targetId: 'leads-kanban' };
        if (/unread|непроч|waiting|очіку/.test(text) && /чат|chat|діалог/.test(text)) return { pageId: 'chat', actionId: 'chat.filter-unread', targetId: 'chat-unread-filter' };
        if (/work queue|черг|просроч|простроч|overdue/.test(text) && targetPage === 'dashboard') return { pageId: 'dashboard', actionId: 'dashboard.focus-work-queue', targetId: 'dashboard-work-queue' };
        return null;
    }

    function savePendingCommand(command = {}) {
        try {
            sessionStorage.setItem(PENDING_COMMAND_KEY, JSON.stringify({
                pageId: compactText(command.pageId || '', 80),
                actionId: compactText(command.actionId || '', 100),
                targetId: compactText(command.targetId || '', 100),
                label: compactText(command.label || '', 140),
                createdAt: Date.now(),
                expiresAt: Date.now() + 18000
            }));
        } catch {}
    }

    function consumePendingCommand(pageId = getPageId()) {
        try {
            const raw = sessionStorage.getItem(PENDING_COMMAND_KEY);
            if (!raw) return null;
            const command = JSON.parse(raw);
            if (!command || Date.now() > Number(command.expiresAt || 0)) {
                sessionStorage.removeItem(PENDING_COMMAND_KEY);
                return null;
            }
            if (command.pageId && command.pageId !== pageId) return null;
            sessionStorage.removeItem(PENDING_COMMAND_KEY);
            return command;
        } catch {
            try { sessionStorage.removeItem(PENDING_COMMAND_KEY); } catch {}
            return null;
        }
    }

    function assistantToday(offsetDays = 0) {
        const date = new Date();
        date.setDate(date.getDate() + offsetDays);
        return date.toISOString().slice(0, 10);
    }

    function parseTaskDeadline(text = '') {
        const timeMatch = text.match(/(?:о|на|в|at)\s*(\d{1,2})(?::|\.)(\d{2})/i);
        const date = /завтра|tomorrow/i.test(text) ? assistantToday(1) : assistantToday(0);
        if (!timeMatch) return { date, deadline: null };
        const hh = String(Math.min(23, Math.max(0, Number(timeMatch[1])))).padStart(2, '0');
        const mm = String(Math.min(59, Math.max(0, Number(timeMatch[2])))).padStart(2, '0');
        return { date, deadline: `${date}T${hh}:${mm}:00` };
    }

    function parseTaskPriority(text = '') {
        if (/критич|термінов|urgent|critical/i.test(text)) return 'urgent';
        if (/висок|важлив|high/i.test(text)) return 'high';
        if (/низьк|low/i.test(text)) return 'low';
        return 'normal';
    }

    function extractQuotedText(raw = '') {
        const quote = String(raw || '').match(/["«“](.+?)["»”]/);
        return quote ? quote[1].trim() : '';
    }

    function extractTaskTitle(raw = '') {
        const quoted = extractQuotedText(raw);
        if (quoted) return compactText(quoted, 160);
        let title = String(raw || '')
            .replace(/^\s*(помічник[у]?,?\s*)?/i, '')
            .replace(/\b(будь ласка|пліз|please)\b/ig, '')
            .replace(/\b(створи|створити|додай|додати|постав|зроби|сформуй|create|add|make)\b/ig, '')
            .replace(/\b(нову|новий|мені|нам)\b/ig, '')
            .replace(/\b(задачу|задача|таску|task|чекліст|checklist)\b/ig, '')
            .replace(/\b(на сьогодні|сьогодні|на завтра|завтра)\b/ig, '')
            .replace(/\b(о|на|в|at)\s*\d{1,2}(?::|\.)\d{2}\b/ig, '')
            .replace(/\b(з пріоритетом|пріоритет|priority)\s*(критичний|терміновий|високий|низький|normal|high|low|urgent)\b/ig, '')
            .trim();
        title = title.replace(/^[:\-–—]+/, '').trim();
        return compactText(title, 160);
    }

    function parseTaskCommand(raw = '', text = normalizeCommandText(raw)) {
        const isTaskCommand = /(створи|створити|додай|додати|постав|зроби|сформуй|create|add|make).{0,32}(задач|таск|task|чекліст|checklist)/i.test(text)
            || /(задач|таск|task|чекліст|checklist).{0,24}(створи|додай|постав|create|add|make)/i.test(text);
        if (!isTaskCommand) return null;
        const title = extractTaskTitle(raw);
        if (!title || title.length < 3) {
            return routeResult({
                commandType: 'create_task',
                actionId: 'assistant.create-task',
                label: 'Створити задачу',
                requiresInput: true,
                confirmationNeeded: true,
                safe: false,
                summary: 'Напиши назву задачі. Наприклад: “створи задачу Подзвонити клієнту завтра о 12:00”.'
            });
        }
        const deadline = parseTaskDeadline(text);
        const isChecklist = /чекліст|checklist/i.test(text);
        const sourceId = (() => {
            try {
                const params = new URLSearchParams(window.location.search);
                if (getPageId() === 'leads') return params.get('lead') || params.get('leadId') || '';
                if (getPageId() === 'tasks') return params.get('open') || '';
                return '';
            } catch {
                return '';
            }
        })();
        return routeResult({
            commandType: 'create_task',
            actionId: 'assistant.create-task',
            label: isChecklist ? 'Створити чекліст' : 'Створити задачу',
            confirmationNeeded: true,
            safe: false,
            summary: `${isChecklist ? 'Підготував чекліст' : 'Підготував задачу'} “${title}”. Потрібне підтвердження перед створенням.`,
            payload: {
                title,
                date: deadline.date,
                deadline: deadline.deadline,
                priority: parseTaskPriority(text),
                task_kind: isChecklist ? 'checklist' : (/чекаю|waiting/i.test(text) ? 'waiting' : 'action'),
                category: isChecklist ? 'checklist' : 'admin',
                source_module: getPageId(),
                source_type: getPageId() === 'chat' ? 'chat_command' : (getPageId() === 'leads' ? 'lead_command' : 'assistant_command'),
                source_id: sourceId || null
            }
        });
    }

    function routeCommand(rawInput = '', options = {}) {
        const raw = String(rawInput || '').trim();
        const text = normalizeCommandText(raw);
        if (!text) return { matched: false };
        if (isReadOnlyTimelineScheduleQuestion(text, options)) {
            return { matched: false, reason: 'timeline_schedule_read_only_query' };
        }
        const forbidden = forbiddenCommand(text);
        if (forbidden) {
            return routeResult({
                blocked: true,
                commandType: 'blocked',
                actionId: 'assistant.blocked',
                label: 'Небезпечна дія заблокована',
                safe: false,
                summary: 'Цю дію я не виконую напряму. Видалення, паролі, токени, права доступу, фінансові мутації та відправка повідомлень мають лишатися під ручним контролем.'
            });
        }
        if (/що ти вмієш|список функц|команди помічника|що можеш зробити/i.test(text)) {
            return routeResult({
                commandType: 'capabilities',
                actionId: 'assistant.capabilities',
                label: 'Показати можливості',
                summary: 'Я вже можу відкривати CRM-сторінки, секції, пошук, міняти тему, згортати меню, керувати голосом/вікном, вмикати compact timeline і створювати задачу або чекліст тільки після підтвердження.'
            });
        }
        const taskCommand = parseTaskCommand(raw, text);
        if (taskCommand) return taskCommand;
        if (/назад|повернись назад|go back/i.test(text)) {
            return routeResult({ commandType: 'navigation', actionId: 'assistant.back', label: 'Повернутись назад', summary: 'Повертаюсь на попередній екран.' });
        }
        if (/пошук|search|ctrl\+k|cmd\+k/i.test(text) && /(відкрий|відкрити|покажи|open|запусти)/i.test(text)) {
            return routeResult({ commandType: 'ui', actionId: 'assistant.open-search', label: 'Відкрити пошук', summary: 'Відкриваю глобальний пошук CRM.' });
        }
        const taskOpenMatch = text.match(/(?:відкрий|відкрити|покажи|open).{0,18}(?:задач[ауи]?|task)\s*#?\s*(\d+)/i);
        if (taskOpenMatch) {
            return routeResult({
                commandType: 'navigation',
                actionId: 'assistant.navigate',
                label: 'Відкрити задачу',
                summary: `Відкриваю задачу #${taskOpenMatch[1]}.`,
                payload: { href: `tasks.html?open=${encodeURIComponent(taskOpenMatch[1])}`, pageId: 'tasks' }
            });
        }
        const leadOpenMatch = text.match(/(?:відкрий|відкрити|покажи|open).{0,18}(?:лід|lead)\s*#?\s*(\d+)/i);
        if (leadOpenMatch) {
            return routeResult({
                commandType: 'navigation',
                actionId: 'assistant.navigate',
                label: 'Відкрити лід',
                summary: `Відкриваю workspace ліда #${leadOpenMatch[1]}.`,
                payload: { href: `leads.html?lead=${encodeURIComponent(leadOpenMatch[1])}`, pageId: 'leads' }
            });
        }
        if (/(ручн|форма|додати|створи).{0,28}(звіт|report)|звіт.{0,28}(ручн|форма|додати)/i.test(text)) {
            const currentPage = compactText(options.pageId || getPageId(), 80);
            if (currentPage !== 'reports') {
                return routeResult({
                    commandType: 'navigation',
                    actionId: 'assistant.navigate',
                    label: 'Відкрити звіти',
                    summary: 'Відкриваю сторінку звітів. Сам запис звіту створюється тільки вручну або після окремого підтвердження.',
                    payload: { href: 'reports.html', pageId: 'reports' }
                });
            }
            return routeResult({ commandType: 'ui', actionId: 'assistant.report-open-form', label: 'Відкрити форму ручного звіту', summary: 'Відкриваю форму ручного звіту. Збереження фінансового запису лишається тільки після твого підтвердження.' });
        }
        if (/велике вікно|вікно помічника|assistant window|панель помічника/i.test(text)) {
            const close = /закрий|закрити|close/i.test(text);
            return routeResult({ commandType: 'ui', actionId: close ? 'assistant.panel-close' : 'assistant.panel-open', label: close ? 'Закрити вікно Помічника' : 'Відкрити вікно Помічника', summary: close ? 'Закриваю велике вікно Помічника.' : 'Відкриваю велике вікно Помічника.' });
        }
        if (/голос|voice|озвуч|повтори остан/i.test(text)) {
            if (/повтори|replay/i.test(text)) return routeResult({ commandType: 'voice', actionId: 'assistant.voice-replay', label: 'Повторити останню відповідь', summary: 'Повторюю останню відповідь.' });
            const off = /вимк|off|mute|тиша/i.test(text);
            const on = /увімк|включ|on/i.test(text);
            if (off || on) return routeResult({ commandType: 'voice', actionId: off ? 'assistant.voice-off' : 'assistant.voice-on', label: off ? 'Вимкнути голос' : 'Увімкнути голос', summary: off ? 'Вимикаю голосові відповіді.' : 'Увімкнув голосові відповіді.' });
        }
        if (/тема|theme|день|ніч|night|day|auto|авто/i.test(text) && /(зміни|перемк|увімк|включ|постав|theme|тема)/i.test(text)) {
            let mode = 'toggle';
            if (/ніч|темн|dark|night/i.test(text)) mode = 'dark';
            if (/день|світл|light|day/i.test(text)) mode = 'light';
            if (/авто|auto|систем/i.test(text)) mode = 'auto';
            return routeResult({ commandType: 'theme', actionId: 'assistant.theme', label: 'Змінити тему', summary: mode === 'auto' ? 'Перемикаю тему в авто-режим.' : mode === 'dark' ? 'Перемикаю CRM у нічну тему.' : mode === 'light' ? 'Перемикаю CRM у денну тему.' : 'Перемикаю тему CRM.', payload: { mode } });
        }
        if (/згорн|розгорн|меню|sidebar/i.test(text) && /(меню|sidebar)/i.test(text)) {
            const collapse = /згорн|collapse/i.test(text);
            const expand = /розгорн|expand/i.test(text);
            return routeResult({ commandType: 'ui', actionId: collapse ? 'assistant.sidebar-collapse' : expand ? 'assistant.sidebar-expand' : 'assistant.sidebar-toggle', label: collapse ? 'Згорнути меню' : expand ? 'Розгорнути меню' : 'Перемкнути меню', summary: collapse ? 'Згортаю ліве меню.' : expand ? 'Розгортаю ліве меню.' : 'Перемикаю стан лівого меню.' });
        }
        if (/compact|компакт/i.test(text) && /таймлайн|timeline/i.test(text)) {
            const off = /вимк|off|звичай/i.test(text);
            return routeResult({ commandType: 'ui', actionId: off ? 'assistant.timeline-compact-off' : 'assistant.timeline-compact-on', label: off ? 'Вимкнути compact timeline' : 'Увімкнути compact timeline', summary: off ? 'Вимикаю compact mode для таймлайна.' : 'Увімкнув compact mode для таймлайна.' });
        }
        if (/(відкрий|відкрити|перейди|покажи|open|go to|на сторінку)/i.test(text)) {
            const currentPage = compactText(options.pageId || getPageId(), 80);
            const section = sectionActionForCommand(text, currentPage);
            if (section) {
                return routeResult({
                    commandType: currentPage === section.pageId ? 'filter' : 'navigation',
                    actionId: currentPage === section.pageId ? section.actionId : 'assistant.navigate',
                    label: 'Відкрити секцію',
                    summary: currentPage === section.pageId ? 'Відкриваю потрібну секцію на поточній сторінці.' : 'Переходжу на потрібну сторінку і відкрию секцію після завантаження.',
                    payload: {
                        href: currentPageHref(section.pageId),
                        pageId: section.pageId,
                        pendingActionId: currentPage === section.pageId ? '' : section.actionId,
                        pendingTargetId: section.targetId,
                        directActionId: currentPage === section.pageId ? section.actionId : ''
                    }
                });
            }
            const page = pageCommandForText(text) || sidebarPageCommandForText(text);
            if (page) {
                let href = page.href;
                if (page.pageId === 'tasks') {
                    const view = taskViewForCommand(text);
                    if (view) href = `tasks.html?view=${encodeURIComponent(view)}`;
                }
                return routeResult({
                    commandType: 'navigation',
                    actionId: 'assistant.navigate',
                    label: `Відкрити ${page.pageId}`,
                    summary: `Відкриваю ${page.pageId}.`,
                    payload: { href, pageId: page.pageId }
                });
            }
        }
        if (/проведи|по крок|2-4 крок|навчи|навчання|guided|tour|сценар/i.test(text)) {
            return routeResult({
                commandType: 'highlight',
                actionId: 'assistant.teaching-start',
                label: 'Провести по кроках',
                summary: 'Запускаю короткий guided-сценарій тільки зі стабільними цілями на цій сторінці.',
                payload: { flowId: defaultTeachingFlowForPage(getPageId()) }
            });
        }
        if (/покажи де|де натиснути|де натискати|куди натиснути|куди клікати|де клікнути|де клікати|підсвіт|highlight/i.test(text)) {
            const context = buildContext({ silent: true });
            const target = context.teachingTarget || toList(context.teachingTargets || [], 10).find(item => item.available);
            if (!target) {
                return routeResult({ commandType: 'highlight', actionId: 'assistant.highlight', label: 'Підсвітити ціль', summary: 'Зараз не бачу стабільної цілі для підсвітки, тому не буду блимати випадковим елементом.', payload: { targetId: '' } });
            }
            return routeResult({ commandType: 'highlight', actionId: 'assistant.highlight', label: `Підсвітити ${target.label}`, summary: `Підсвічую: ${target.label}.`, payload: { targetId: target.targetId } });
        }
        return { matched: false };
    }

    function setSidebarCollapsed(collapsed = null) {
        const sidebar = document.getElementById('sidebarNav');
        if (!sidebar) return { success: false, message: 'sidebar_unavailable' };
        const next = collapsed === null ? !sidebar.classList.contains('collapsed') : !!collapsed;
        sidebar.classList.toggle('collapsed', next);
        document.body.classList.toggle('sidebar-is-collapsed', next);
        try { localStorage.setItem('pzp_sidebar_collapsed', String(next)); } catch {}
        const btn = document.getElementById('sidebarCollapseBtn');
        if (btn) {
            btn.setAttribute('aria-pressed', String(next));
            btn.setAttribute('aria-label', next ? 'Розгорнути меню' : 'Згорнути меню');
            btn.setAttribute('title', next ? 'Розгорнути меню' : 'Згорнути меню');
        }
        window.dispatchEvent(new Event('resize'));
        return { success: true, collapsed: next };
    }

    function setTimelineCompact(enabled) {
        const next = !!enabled;
        try { localStorage.setItem('pzp_compact_mode', String(next)); } catch {}
        if (window.AppState) window.AppState.compactMode = next;
        const toggle = document.getElementById('compactModeToggle');
        if (toggle) toggle.checked = next;
        if (typeof window.applyTimelineResponsiveDensity === 'function') window.applyTimelineResponsiveDensity();
        const container = document.querySelector('.timeline-container');
        if (container) container.classList.toggle('compact', next);
        if (typeof window.renderTimeline === 'function') window.renderTimeline();
        return { success: true, compact: next, currentPage: getPageId() };
    }

    function applyThemeCommand(mode = 'toggle') {
        const currentDark = document.body.classList.contains('dark-mode') || document.documentElement.getAttribute('data-theme') === 'dark';
        let nextMode = mode;
        if (nextMode === 'toggle') nextMode = currentDark ? 'light' : 'dark';
        if (nextMode === 'auto') {
            try { localStorage.removeItem('pzp_dark_mode'); } catch {}
            const systemDark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
            if (typeof window.applyCrmThemeMode === 'function') window.applyCrmThemeMode(systemDark, false);
            else {
                document.body.classList.toggle('dark-mode', systemDark);
                document.documentElement.setAttribute('data-theme', systemDark ? 'dark' : 'light');
                document.documentElement.style.colorScheme = systemDark ? 'dark' : 'light';
            }
            return { success: true, mode: 'auto', dark: systemDark };
        }
        const dark = nextMode === 'dark';
        if (typeof window.applyCrmThemeMode === 'function') window.applyCrmThemeMode(dark, true);
        else {
            document.body.classList.toggle('dark-mode', dark);
            document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
            document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
            try { localStorage.setItem('pzp_dark_mode', String(dark)); } catch {}
        }
        return { success: true, mode: dark ? 'dark' : 'light', dark };
    }

    async function createTaskFromCommand(payload = {}) {
        const token = readStorage('pzp_token', '');
        if (!token) throw new Error('auth_required');
        const body = {
            title: compactText(payload.title, 180),
            date: payload.date || assistantToday(0),
            deadline: payload.deadline || null,
            priority: payload.priority || 'normal',
            category: payload.category || 'admin',
            task_type: 'human',
            task_mode: 'work',
            task_kind: payload.task_kind || 'action',
            visibility: 'team',
            workflow_state: payload.task_kind === 'waiting' ? 'waiting' : 'inbox',
            source_type: payload.source_type || 'assistant_command',
            source_id: payload.source_id || null,
            source_module: payload.source_module || getPageId()
        };
        const response = await fetch('/api/tasks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(body)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) {
            const err = new Error(data.message || data.error || `task_create_http_${response.status}`);
            err.status = response.status;
            err.payload = data;
            throw err;
        }
        return { success: true, task: data.task, summary: `Задачу створено: “${body.title}”.` };
    }

    async function executeCommand(route = {}, options = {}) {
        if (!route?.matched) return { success: false, handled: false };
        if (route.blocked || route.requiresInput) return { success: false, handled: true, summary: route.summary, blocked: route.blocked, requiresInput: route.requiresInput };
        const type = route.commandType || 'ui';
        if (!SAFE_COMMAND_TYPES.has(type) && !CONFIRMATION_COMMAND_TYPES.has(type)) {
            throw new Error('assistant_command_type_not_allowed');
        }
        if (route.confirmationNeeded) {
            const title = route.payload?.title ? `\n\n${route.payload.title}` : '';
            const ok = typeof window.confirm === 'function'
                ? window.confirm(`${route.label || 'Підтвердити дію'}?${title}`)
                : false;
            if (!ok) return { success: false, handled: true, cancelled: true, summary: 'Дію скасовано. Без підтвердження я не створюю або не змінюю дані.' };
        }
        if (route.payload?.directActionId) {
            const result = await actionRegistry.run(route.payload.directActionId, route.payload);
            return { success: true, handled: true, summary: route.summary, result };
        }
        switch (route.actionId) {
            case 'assistant.navigate':
                if (route.payload?.pendingActionId || route.payload?.pendingTargetId) {
                    savePendingCommand({
                        pageId: route.payload.pageId,
                        actionId: route.payload.pendingActionId,
                        targetId: route.payload.pendingTargetId,
                        label: route.label
                    });
                }
                window.setTimeout(() => window.location.assign(route.payload?.href || currentPageHref(route.payload?.pageId)), 80);
                return { success: true, handled: true, navigating: true, summary: route.summary };
            case 'assistant.back':
                window.setTimeout(() => window.history.back(), 80);
                return { success: true, handled: true, navigating: true, summary: route.summary };
            case 'assistant.open-search':
                if (typeof window.openGlobalHeaderSearch === 'function') window.openGlobalHeaderSearch();
                else if (typeof window.openSearch === 'function') window.openSearch();
                else clickSelector('#globalHeaderSearchBtn, .header-search-btn, .btn-search');
                return { success: true, handled: true, summary: route.summary };
            case 'assistant.report-open-form':
                return { success: clickSelector('#addReportBtn'), handled: true, summary: route.summary };
            case 'assistant.theme':
                return { success: true, handled: true, summary: route.summary, result: applyThemeCommand(route.payload?.mode || 'toggle') };
            case 'assistant.sidebar-collapse':
                return { success: true, handled: true, summary: route.summary, result: setSidebarCollapsed(true) };
            case 'assistant.sidebar-expand':
                return { success: true, handled: true, summary: route.summary, result: setSidebarCollapsed(false) };
            case 'assistant.sidebar-toggle':
                return { success: true, handled: true, summary: route.summary, result: setSidebarCollapsed(null) };
            case 'assistant.timeline-compact-on':
                return { success: true, handled: true, summary: route.summary, result: setTimelineCompact(true) };
            case 'assistant.timeline-compact-off':
                return { success: true, handled: true, summary: route.summary, result: setTimelineCompact(false) };
            case 'assistant.panel-open':
                window.CrmAssistantRail?.expand?.();
                return { success: true, handled: true, summary: route.summary };
            case 'assistant.panel-close':
                window.CrmAssistantRail?.closePanel?.();
                return { success: true, handled: true, summary: route.summary };
            case 'assistant.voice-on':
                if (window.CrmAssistantRail?.toggleVoice && readStorage('eg_crm_assistant_voice', 'off') !== 'on') window.CrmAssistantRail.toggleVoice();
                return { success: true, handled: true, summary: route.summary };
            case 'assistant.voice-off':
                if (window.CrmAssistantRail?.toggleVoice && readStorage('eg_crm_assistant_voice', 'off') === 'on') window.CrmAssistantRail.toggleVoice();
                return { success: true, handled: true, summary: route.summary };
            case 'assistant.voice-replay':
                await window.CrmAssistantRail?.replayLastLine?.();
                return { success: true, handled: true, summary: route.summary };
            case 'assistant.highlight': {
                const targetId = route.payload?.targetId || '';
                const result = targetId ? highlightTarget(targetId, { durationMs: 3600 }) : { success: false, fallbackText: route.summary };
                return { success: result.success, handled: true, summary: result.success ? route.summary : (result.fallbackText || route.summary), result };
            }
            case 'assistant.teaching-start': {
                const result = startTeachingFlow(route.payload?.flowId || defaultTeachingFlowForPage(getPageId()));
                return { success: result.success, handled: true, summary: result.success ? route.summary : (result.fallbackText || 'На цій сторінці немає стабільного guided-сценарію.'), result };
            }
            case 'assistant.create-task': {
                const created = await createTaskFromCommand(route.payload || {});
                return { success: true, handled: true, summary: created.summary, result: created };
            }
            case 'assistant.capabilities':
                return { success: true, handled: true, summary: route.summary };
            default:
                throw new Error('assistant_command_unavailable');
        }
    }

    function pageMatches(adapter, pageId) {
        const ids = toList([adapter.pageId, ...(adapter.pageIds || [])], 12).filter(Boolean);
        return ids.includes(pageId);
    }

    function registerAdapter(adapter = {}) {
        const pageId = compactText(adapter.pageId || '', 80);
        if (!pageId) return null;
        const normalized = {
            pageId,
            pageIds: Array.isArray(adapter.pageIds) ? adapter.pageIds.map(item => compactText(item, 80)).filter(Boolean) : [],
            isAvailable: typeof adapter.isAvailable === 'function' ? adapter.isAvailable : () => true,
            getSignals: typeof adapter.getSignals === 'function' ? adapter.getSignals : () => [],
            getActions: typeof adapter.getActions === 'function' ? adapter.getActions : () => [],
            getTeachingTargets: typeof adapter.getTeachingTargets === 'function' ? adapter.getTeachingTargets : () => [],
            getContextSummary: typeof adapter.getContextSummary === 'function' ? adapter.getContextSummary : () => ({}),
            dispose: typeof adapter.dispose === 'function' ? adapter.dispose : () => {}
        };
        adapters.set(pageId, normalized);
        return normalized;
    }

    function getActiveAdapter(pageId = getPageId()) {
        const direct = adapters.get(pageId);
        if (direct && direct.isAvailable()) return direct;
        for (const adapter of adapters.values()) {
            if (!pageMatches(adapter, pageId)) continue;
            try {
                if (adapter.isAvailable()) return adapter;
            } catch {}
        }
        return null;
    }

    function callAdapter(adapter, method, fallback) {
        try {
            const value = adapter?.[method]?.();
            return value ?? fallback;
        } catch (err) {
            console.warn(`[crm-assistant-foundation] adapter ${method} failed`, err);
            emitTelemetry('foundation_context_failed', {
                module: `adapter:${method}`,
                failureReason: err.message || String(err),
                fallbackShown: true
            });
            return fallback;
        }
    }

    function normalizeContextSummary(summary = {}) {
        if (typeof summary === 'string') return { headline: compactText(summary, 220), details: [] };
        return {
            headline: compactText(summary.headline || summary.title || '', 220),
            details: toList(summary.details || summary.items || [], 12).map(item => compactText(item, 180)),
            source: compactText(summary.source || 'adapter', 80)
        };
    }

    function severityRank(signal = {}) {
        const map = { critical: 5, danger: 4, warning: 3, info: 2, success: 1 };
        return map[signal.severity] || 0;
    }

    function firstMatchingAction(actionsList, needles = []) {
        const terms = toList(needles, 8).map(item => String(item).toLowerCase());
        return actionsList.find(action => {
            const haystack = `${action.actionId} ${action.actionType} ${action.label}`.toLowerCase();
            return terms.some(term => haystack.includes(term));
        }) || null;
    }

    function firstMatchingTarget(targetsList, needles = []) {
        const terms = toList(needles, 8).map(item => String(item).toLowerCase());
        return targetsList.find(target => {
            if (target.available === false) return false;
            const haystack = `${target.targetId} ${target.kind} ${target.label}`.toLowerCase();
            return terms.some(term => haystack.includes(term));
        }) || null;
    }

    function chooseActionProposal(signals = [], actionsList = []) {
        if (!actionsList.length) return null;
        const strongest = [...signals].sort((a, b) => severityRank(b) - severityRank(a))[0] || null;
        const id = `${strongest?.signalId || ''} ${strongest?.label || ''}`.toLowerCase();
        let action = null;
        if (/waiting|reply|unread|chat/.test(id)) action = firstMatchingAction(actionsList, ['waiting', 'reply', 'unread', 'chat']);
        if (!action && /overdue|deadline|task/.test(id)) action = firstMatchingAction(actionsList, ['overdue', 'deadline', 'task']);
        if (!action && /debt|finance|cash|payment/.test(id)) action = firstMatchingAction(actionsList, ['debt', 'finance', 'advanced']);
        if (!action && /lead|hot|follow/.test(id)) action = firstMatchingAction(actionsList, ['hot', 'lead', 'kanban', 'follow']);
        return serializeAction(action || actionsList[0]);
    }

    function chooseTeachingTarget(signals = [], targetsList = []) {
        const available = targetsList.filter(target => target.available !== false);
        if (!available.length) return null;
        const strongest = [...signals].sort((a, b) => severityRank(b) - severityRank(a))[0] || null;
        const id = `${strongest?.signalId || ''} ${strongest?.label || ''}`.toLowerCase();
        let target = null;
        if (/waiting|reply|unread|chat/.test(id)) target = firstMatchingTarget(available, ['waiting', 'reply', 'unread', 'chat']);
        if (!target && /overdue|deadline|task/.test(id)) target = firstMatchingTarget(available, ['overdue', 'deadline', 'task', 'board']);
        if (!target && /debt|finance|cash|payment/.test(id)) target = firstMatchingTarget(available, ['debt', 'finance', 'advanced']);
        if (!target && /lead|hot|follow/.test(id)) target = firstMatchingTarget(available, ['hot', 'lead', 'kanban', 'follow']);
        return serializeTarget(target || available[0]);
    }

    function buildContext(extra = {}) {
        const pageId = compactText(extra.page || extra.pageId || getPageId(), 80);
        markKnownTargets(pageId);
        if (!extra.silent) refreshAdapterSnapshot(pageId).catch(err => console.warn('[crm-assistant-foundation] snapshot refresh failed', err));
        const roleSnapshot = getRoleSnapshot();
        const adapter = getActiveAdapter(pageId);
        const rawSignals = adapter ? callAdapter(adapter, 'getSignals', []) : [];
        const rawActions = adapter ? callAdapter(adapter, 'getActions', []) : [];
        const rawTargets = adapter ? callAdapter(adapter, 'getTeachingTargets', []) : [];
        const signals = toList(rawSignals, 20).map(normalizeSignal);
        const pageActions = toList(rawActions, 20).map(normalizeAction);
        pageActions.forEach(action => actionRegistry.register(action));
        const teachingTargets = toList(rawTargets, 20).map(normalizeTarget).sort((a, b) => a.priority - b.priority);
        const contextSummary = normalizeContextSummary(adapter ? callAdapter(adapter, 'getContextSummary', {}) : {});
        const fallbackReason = adapter ? (signals.length ? '' : 'adapter_has_no_signals') : 'adapter_missing';
        const actionProposal = chooseActionProposal(signals, pageActions);
        const teachingTarget = chooseTeachingTarget(signals, teachingTargets);
        const snapshot = {
            pageId,
            adapterId: adapter?.pageId || '',
            roleSnapshot,
            contextSummary,
            signals,
            actions: pageActions.map(serializeAction),
            teachingTargets: teachingTargets.map(serializeTarget),
            actionProposal,
            teachingTarget,
            fallbackReason
        };
        if (!extra.silent) {
            store.setState({
                pageId,
                roleSnapshot,
                adapterId: snapshot.adapterId,
                currentContextSnapshot: snapshot,
                currentActionProposal: actionProposal,
                currentTeachingTarget: teachingTarget,
                fallbackReason
            }, { source: 'context' });
        }
        return snapshot;
    }

    function normalizeEvidence(value = []) {
        return toList(value, 8).map((item, index) => {
            if (typeof item === 'string') return { label: compactText(localizeAssistantText(item), 160), source: 'assistant', signalId: `evidence-${index + 1}` };
            return {
                label: compactText(localizeAssistantText(item.label || item.evidence || item.text || item.signalId || `Доказ ${index + 1}`), 180),
                value: compactText(item.value || item.count || '', 80),
                source: compactText(item.source || 'adapter', 80),
                signalId: compactText(item.signalId || item.id || `evidence-${index + 1}`, 80),
                severity: compactText(item.severity || '', 40)
            };
        });
    }

    function inferReplyRiskLevel(evidence = [], fallbackReason = '') {
        const levels = normalizeEvidence(evidence).map(item => String(item.severity || item.label || '').toLowerCase());
        if (levels.some(item => /critical|критич/.test(item))) return 'critical';
        if (levels.some(item => /danger|overdue|debt|борг|простроч/.test(item))) return 'high';
        if (levels.some(item => /warning|waiting|unread|ризик|очіку/.test(item))) return 'medium';
        return fallbackReason ? 'low' : 'none';
    }

    function roleStrategicFrame(role = '') {
        const key = String(role || '').toLowerCase();
        if (key === 'director') return 'Для директора це контроль ризику і грошей';
        if (key === 'manager') return 'Для менеджера це наступна операційна дія';
        if (key === 'hr') return 'Для HR це стабільність людей і графіка';
        if (key === 'art_director') return 'Для артдиректора це контроль production pipeline';
        if (key === 'creator') return 'Для creator це перевірка цілісності сценарію';
        return 'Практичний висновок';
    }

    function pageStrategicAngle(page = '') {
        const key = String(page || '').toLowerCase();
        if (key === 'dashboard') return 'операційний bottleneck і черга роботи';
        if (key === 'tasks') return 'прострочка, власник і дедлайн';
        if (key === 'finance') return 'борг, cashflow і P&L контроль';
        if (key === 'chat' || key === 'omni') return 'очікувані відповіді й unresolved conversations';
        if (key === 'leads' || key === 'sales-funnel') return 'гарячі ліди та follow-up';
        if (key === 'staff' || key === 'hr') return 'люди, графік і конфлікти';
        if (key === 'warehouse') return 'залишки, низький сток і рух';
        return 'найсильніший видимий CRM-сигнал';
    }

    function buildStrategicRecommendation(context = {}, summary = '') {
        const role = context.roleSnapshot?.permissionRole || context.roleSnapshot?.role || '';
        const page = context.pageId || context.page || getPageId();
        const frame = roleStrategicFrame(role);
        const strongest = toList(context.signals || context.evidence || [], 8)
            .map(normalizeSignal)
            .sort((a, b) => severityRank(b) - severityRank(a))[0] || null;
        const action = context.actionProposal || toList(context.actions || [], 6)[0] || null;
        const signalText = strongest?.evidence || strongest?.label || compactText(summary, 160);
        const pageAngle = pageStrategicAngle(page);
        if (action?.label && signalText) return `${frame}: ${signalText}. Фокус — ${pageAngle}. Наступний крок — ${action.label}.`;
        if (signalText) return `${frame}: ${signalText}. Фокус — ${pageAngle}; обери один контрольний крок.`;
        return summary || 'Почни з найсильнішого видимого сигналу і однієї безпечної дії.';
    }

    function normalizeReply(reply = {}, context = {}) {
        const source = typeof reply === 'string' ? { text: reply } : (reply || {});
        const summary = compactText(localizeAssistantText(source.summary || source.subtitle || source.text || source.recommendation || ''), 700);
        const evidenceSource = source.evidence || context.evidence || context.signals || [];
        const actionProposal = source.actionProposal
            ? serializeAction(source.actionProposal)
            : (context.actionProposal ? serializeAction(context.actionProposal) : null);
        const teachingTarget = source.teachingTarget
            ? serializeTarget(source.teachingTarget)
            : (context.teachingTarget ? serializeTarget(context.teachingTarget) : null);
        const normalized = {
            mode: normalizeMode(source.mode || (summary ? 'speaking' : 'idle')),
            summary,
            text: compactText(localizeAssistantText(source.text || summary), 900),
            subtitle: compactText(localizeAssistantText(source.subtitle || summary), 700),
            evidence: normalizeEvidence(evidenceSource),
            riskLevel: RISK_LEVELS.has(source.riskLevel) ? source.riskLevel : inferReplyRiskLevel(evidenceSource, source.fallbackReason || context.fallbackReason),
            confidence: CONFIDENCE_LEVELS.has(source.confidence) ? source.confidence : (normalizeEvidence(evidenceSource).length ? 'medium' : 'low'),
            recommendation: compactText(localizeAssistantText(source.recommendation || buildStrategicRecommendation(context, summary)), 700),
            actionProposal,
            teachingTarget,
            fallbackReason: compactText(localizeAssistantText(source.fallbackReason || context.fallbackReason || ''), 240),
            model: source.model || ''
        };
        store.setState({
            mode: normalized.mode,
            lastAssistantSummaryLine: normalized.summary,
            currentActionProposal: normalized.actionProposal,
            currentTeachingTarget: normalized.teachingTarget,
            fallbackReason: normalized.fallbackReason,
            speaking: normalized.mode === 'speaking',
            playbackState: normalized.mode === 'speaking' ? 'speaking' : 'idle'
        }, { source: 'reply' });
        return normalized;
    }

    function todayDateString(offsetDays = 0) {
        const date = new Date();
        date.setDate(date.getDate() + offsetDays);
        return date.toISOString().slice(0, 10);
    }

    function taskDateOnly(task = {}) {
        const raw = task.deadline || task.remindAt || task.remind_at || task.date || '';
        if (!raw) return '';
        return String(raw).slice(0, 10);
    }

    function isActiveTask(task = {}) {
        return !['done', 'archived', 'cancelled'].includes(String(task.status || '').toLowerCase());
    }

    function isMissingTaskOwner(task = {}) {
        return isActiveTask(task) && !numberValue(task.ownerUserId || task.owner_user_id, 0) && !task.assignedTo && !task.assigned_to && !task.owner;
    }

    function dashboardSignals() {
        const payload = getSnapshotData('dashboard', 'workQueue');
        const queue = payload?.queue || null;
        const signals = [];
        if (queue) {
            const waiting = queueBucketCount(queue, 'waiting_reply');
            const overdue = queueBucketCount(queue, 'overdue');
            const callback = queueBucketCount(queue, 'callback_due');
            const confirmation = queueBucketCount(queue, 'needs_confirmation');
            const bottleneck = toList(queue.meta?.intelligence?.bottlenecks || [], 1)[0];
            signals.push({ signalId: 'dashboard.work_queue.items', label: 'Work queue items', value: numberValue(queue.items?.length, 0), source: 'api:/api/work-queue' });
            if (waiting) signals.push({ signalId: 'dashboard.work_queue.waiting_reply', label: 'Waiting reply pressure', value: waiting, severity: 'warning', evidence: `${waiting} розмов очікують відповіді у work queue.`, source: 'api:/api/work-queue' });
            if (overdue) signals.push({ signalId: 'dashboard.work_queue.overdue_tasks', label: 'Overdue task pressure', value: overdue, severity: 'danger', evidence: `${overdue} прострочених задач у видимій робочій черзі.`, source: 'api:/api/work-queue' });
            if (callback) signals.push({ signalId: 'dashboard.work_queue.followups_due', label: 'Lead follow-ups due', value: callback, severity: 'warning', evidence: `${callback} follow-up пунктів у черзі.`, source: 'api:/api/work-queue' });
            if (confirmation) signals.push({ signalId: 'dashboard.work_queue.confirmations', label: 'Booking confirmations', value: confirmation, severity: 'danger', evidence: `${confirmation} бронювань потребують підтвердження.`, source: 'api:/api/work-queue' });
            if (bottleneck) signals.push({ signalId: `dashboard.work_queue.bottleneck.${bottleneck.type || 'main'}`, label: bottleneck.label || 'Work queue bottleneck', value: bottleneck.count || '', severity: bottleneck.count ? 'warning' : 'info', evidence: `${bottleneck.label || 'Bottleneck'}: ${bottleneck.count || 0}.`, source: 'api:/api/work-queue' });
            return signals;
        }
        const error = snapshotFallback('dashboard', ['workQueue']);
        return [
            error ? { signalId: 'dashboard.work_queue.snapshot_unavailable', label: 'Work queue API snapshot unavailable', value: 'limited', severity: 'info', evidence: error, source: 'api_snapshot_error' } : null,
            readCount('.bucket-waiting_reply .work-queue-count') ? { signalId: 'dashboard.waiting_reply_dom', label: 'Waiting reply queue', value: readCount('.bucket-waiting_reply .work-queue-count'), severity: 'warning', source: 'work_queue_dom_fallback' } : null,
            readCount('.bucket-overdue .work-queue-count') ? { signalId: 'dashboard.overdue_tasks_dom', label: 'Overdue work queue', value: readCount('.bucket-overdue .work-queue-count'), severity: 'danger', source: 'work_queue_dom_fallback' } : null
        ].filter(Boolean);
    }

    function dashboardSummary() {
        const payload = getSnapshotData('dashboard', 'workQueue');
        const queue = payload?.queue || null;
        const ctx = window.DashboardPage?.getAssistantContext?.() || {};
        if (!queue) return { headline: 'Dashboard operating context', details: toList(ctx.widgets || [], 8), source: snapshotError('dashboard', 'workQueue') ? 'dom_with_snapshot_error' : 'DashboardPage.getAssistantContext' };
        const intelligence = queue.meta?.intelligence || {};
        const details = [
            `queueItems=${numberValue(queue.items?.length, 0)}`,
            `waitingReplies=${queueBucketCount(queue, 'waiting_reply')}`,
            `overdueTasks=${queueBucketCount(queue, 'overdue')}`,
            `bottlenecks=${numberValue(intelligence.bottlenecks?.length, 0)}`
        ];
        return { headline: 'Dashboard work queue snapshot', details, source: 'api:/api/work-queue' };
    }

    function getTaskPageSnapshot() {
        try {
            const snapshot = window.TasksPage?.getAssistantSnapshot?.();
            if (snapshot && typeof snapshot === 'object') return snapshot;
        } catch (err) {
            emitTelemetry('snapshot_failed', {
                page: 'tasks',
                snapshotKey: 'TasksPage.getAssistantSnapshot',
                failureReason: err.message || String(err),
                fallbackShown: true
            });
            console.warn('[crm-assistant-foundation] task page snapshot failed', err);
        }
        return null;
    }

    function taskSignals() {
        const pageSnapshot = getTaskPageSnapshot();
        if (pageSnapshot) {
            const counts = pageSnapshot.counts || {};
            const viewLabel = pageSnapshot.currentViewLabel || pageSnapshot.currentView || 'tasks';
            const source = pageSnapshot.source || 'TasksPage.getAssistantSnapshot';
            const currentViewCount = numberValue(counts.currentView, 0);
            const currentVisible = numberValue(counts.currentVisible, currentViewCount);
            const signals = [
                {
                    signalId: 'tasks.page.current_view',
                    label: 'Current tasks board slice',
                    value: currentViewCount,
                    severity: currentViewCount ? 'info' : 'success',
                    evidence: `У зрізі "${viewLabel}" зараз ${currentViewCount} задач; показано після фільтрів: ${currentVisible}.`,
                    source
                },
                { signalId: 'tasks.page.inbox', label: 'Inbox tab count', value: numberValue(counts.inbox, 0), severity: numberValue(counts.inbox, 0) ? 'warning' : 'info', evidence: `Інбокс: ${numberValue(counts.inbox, 0)} задач.`, source },
                { signalId: 'tasks.page.today', label: 'Today tab count', value: numberValue(counts.today, 0), severity: numberValue(counts.today, 0) ? 'info' : 'success', evidence: `Сьогодні: ${numberValue(counts.today, 0)} задач.`, source },
                { signalId: 'tasks.page.team', label: 'Team tab count', value: numberValue(counts.team, 0), severity: numberValue(counts.team, 0) ? 'info' : 'success', evidence: `Командні: ${numberValue(counts.team, 0)} задач.`, source },
                { signalId: 'tasks.page.my', label: 'My tab count', value: numberValue(counts.my, 0), severity: numberValue(counts.my, 0) ? 'info' : 'success', evidence: `Мої: ${numberValue(counts.my, 0)} задач.`, source }
            ];
            if (numberValue(counts.overdue, 0)) signals.push({ signalId: 'tasks.overdue', label: 'Overdue tasks', value: numberValue(counts.overdue, 0), severity: 'danger', evidence: `${numberValue(counts.overdue, 0)} прострочених задач у live task board snapshot.`, source });
            if (numberValue(counts.waiting, 0)) signals.push({ signalId: 'tasks.waiting', label: 'Waiting tasks', value: numberValue(counts.waiting, 0), severity: 'warning', evidence: `${numberValue(counts.waiting, 0)} задач у waiting/workflow стані.`, source });
            if (numberValue(counts.next, 0) || numberValue(counts.nearDeadline, 0)) {
                const deadlineCount = Math.max(numberValue(counts.next, 0), numberValue(counts.nearDeadline, 0));
                signals.push({ signalId: 'tasks.near_deadline', label: 'Near deadline tasks', value: deadlineCount, severity: 'warning', evidence: `${deadlineCount} задач у найближчому плані або з близьким дедлайном.`, source });
            }
            if (numberValue(counts.missingOwner, 0)) signals.push({ signalId: 'tasks.missing_owner', label: 'Tasks without typed owner', value: numberValue(counts.missingOwner, 0), severity: 'warning', evidence: `${numberValue(counts.missingOwner, 0)} активних задач без typed owner у live task board snapshot.`, source });
            return signals;
        }
        const cabinet = getSnapshotData('tasks', 'taskCabinet');
        const visibleTasksPayload = getSnapshotData('tasks', 'tasks');
        const visibleTasks = Array.isArray(visibleTasksPayload) ? visibleTasksPayload : toList(visibleTasksPayload?.tasks || visibleTasksPayload?.items || [], 200);
        const stats = cabinet?.stats || {};
        const overdue = numberValue(stats.overdueCount, cabinet?.overdue?.length || 0);
        const waiting = numberValue(stats.waitingCount, cabinet?.waiting?.length || 0);
        const inbox = numberValue(stats.inboxCount, cabinet?.inbox?.length || 0);
        const next = numberValue(cabinet?.next?.length, 0);
        const missingOwner = visibleTasks.filter(isMissingTaskOwner).length;
        const today = todayDateString();
        const inTwoDays = todayDateString(2);
        const nearDeadline = visibleTasks.filter(task => {
            const due = taskDateOnly(task);
            return isActiveTask(task) && due && due >= today && due <= inTwoDays;
        }).length;
        const signals = [];
        if (cabinet) {
            signals.push({ signalId: 'tasks.cabinet.personal_projection', label: 'Personal cabinet projection', value: numberValue(cabinet.all?.length, 0), source: 'api:/api/tasks/my-cabinet' });
            if (overdue) signals.push({ signalId: 'tasks.overdue', label: 'Overdue tasks', value: overdue, severity: 'danger', evidence: `${overdue} задач прострочено у персональній проекції.`, source: 'api:/api/tasks/my-cabinet' });
            if (waiting) signals.push({ signalId: 'tasks.waiting', label: 'Waiting tasks', value: waiting, severity: 'warning', evidence: `${waiting} задач у waiting/workflow стані.`, source: 'api:/api/tasks/my-cabinet' });
            if (inbox) signals.push({ signalId: 'tasks.inbox', label: 'Inbox tasks', value: inbox, severity: 'warning', evidence: `${inbox} задач у inbox потребують розбору.`, source: 'api:/api/tasks/my-cabinet' });
            if (next || nearDeadline) signals.push({ signalId: 'tasks.near_deadline', label: 'Near deadline tasks', value: Math.max(next, nearDeadline), severity: 'warning', evidence: 'Є задачі з близьким дедлайном у найближчому вікні.', source: 'api:/api/tasks' });
        }
        if (missingOwner) signals.push({ signalId: 'tasks.missing_owner', label: 'Tasks without typed owner', value: missingOwner, severity: 'warning', evidence: `${missingOwner} активних задач без typed owner у видимому API списку.`, source: 'api:/api/tasks' });
        if (signals.length) return signals;
        const error = snapshotFallback('tasks', ['taskCabinet', 'tasks']);
        return [
            error ? { signalId: 'tasks.snapshot_unavailable', label: 'Tasks API snapshot unavailable', value: 'limited', severity: 'info', evidence: error, source: 'api_snapshot_error' } : null,
            { signalId: 'tasks.today', label: 'Today tasks', value: readCount('#countToday'), source: 'tasks_tab_counts' },
            { signalId: 'tasks.waiting_dom', label: 'Waiting tasks', value: readCount('#countWaiting'), severity: readCount('#countWaiting') ? 'warning' : 'info', source: 'tasks_tab_counts' },
            { signalId: 'tasks.overdue_visible', label: 'Visible overdue deadlines', value: document.querySelectorAll('.deadline-overdue').length, severity: document.querySelectorAll('.deadline-overdue').length ? 'danger' : 'info', source: 'tasks_dom_fallback' }
        ].filter(Boolean);
    }

    function taskSummary() {
        const pageSnapshot = getTaskPageSnapshot();
        if (pageSnapshot) {
            const counts = pageSnapshot.counts || {};
            const taskTitles = list => toList(list || [], 8)
                .map(task => task?.title || task?.label || '')
                .filter(Boolean)
                .slice(0, 5)
                .join(' | ') || 'none';
            return {
                headline: 'Tasks live board snapshot',
                details: [
                    `view=${pageSnapshot.currentView || 'tasks'}`,
                    `viewCount=${numberValue(counts.currentView, 0)}`,
                    `visibleAfterFilter=${numberValue(counts.currentVisible, counts.currentView)}`,
                    `inbox=${numberValue(counts.inbox, 0)}`,
                    `today=${numberValue(counts.today, 0)}`,
                    `next=${numberValue(counts.next, 0)}`,
                    `waiting=${numberValue(counts.waiting, 0)}`,
                    `team=${numberValue(counts.team, 0)}`,
                    `my=${numberValue(counts.my, 0)}`,
                    `overdue=${numberValue(counts.overdue, 0)}`,
                    `recentNew=${taskTitles(pageSnapshot.recentTasks)}`,
                    `myTasks=${taskTitles(pageSnapshot.myTasks)}`,
                    `delegatedByMe=${taskTitles(pageSnapshot.delegatedByMeTasks)}`,
                    `assistantFilter=${pageSnapshot.assistantFilter || 'none'}`
                ],
                source: pageSnapshot.source || 'TasksPage.getAssistantSnapshot'
            };
        }
        const cabinet = getSnapshotData('tasks', 'taskCabinet');
        if (cabinet) {
            return {
                headline: 'Tasks API personal projection',
                details: [
                    `today=${numberValue(cabinet.stats?.todayPlanned, 0)}`,
                    `waiting=${numberValue(cabinet.stats?.waitingCount, 0)}`,
                    `overdue=${numberValue(cabinet.stats?.overdueCount, 0)}`,
                    `focus=${numberValue(cabinet.stats?.focusCount, 0)}`
                ],
                source: 'api:/api/tasks/my-cabinet'
            };
        }
        return { headline: 'Tasks board context', details: [`today=${readCount('#countToday')}`, `waiting=${readCount('#countWaiting')}`, `my=${readCount('#countMy')}`], source: 'tasks_dom' };
    }

    function financeSignals() {
        const debts = getSnapshotData('finance', 'financeDebts');
        const advanced = getSnapshotData('finance', 'financeAdvanced');
        const debtCount = numberValue(debts?.count ?? advanced?.debt?.count, 0);
        const totalDebt = numberValue(debts?.totalDebt ?? advanced?.debt?.total_debt, 0);
        const metrics = advanced?.metrics || {};
        const lastCashFlow = toList(advanced?.cashFlow || [], 16).slice(-1)[0] || null;
        const signals = [];
        if (debts || advanced) {
            signals.push({ signalId: 'finance.snapshot.loaded', label: 'Finance API snapshot', value: 'loaded', source: debts ? 'api:/api/finance/debts' : 'api:/api/finance/advanced-dashboard' });
            if (debtCount || totalDebt) signals.push({ signalId: 'finance.debt.overdue', label: 'Overdue payment debt', value: formatMoney(totalDebt), severity: totalDebt > 0 ? 'danger' : 'info', evidence: `${debtCount} боргів на ${formatMoney(totalDebt)}.`, source: debts ? 'api:/api/finance/debts' : 'api:/api/finance/advanced-dashboard' });
            if (numberValue(metrics.monthProfit, 0) < 0) signals.push({ signalId: 'finance.pnl.month_negative', label: 'Negative monthly profit', value: formatMoney(metrics.monthProfit), severity: 'warning', evidence: `P&L місяця нижче нуля: ${formatMoney(metrics.monthProfit)}.`, source: 'api:/api/finance/advanced-dashboard' });
            if (lastCashFlow && numberValue(lastCashFlow.netFlow, 0) < 0) signals.push({ signalId: 'finance.cashflow.negative_week', label: 'Negative weekly cashflow', value: formatMoney(lastCashFlow.netFlow), severity: 'warning', evidence: `Останній тиждень cashflow: ${formatMoney(lastCashFlow.netFlow)}.`, source: 'api:/api/finance/advanced-dashboard' });
            return signals;
        }
        const error = snapshotFallback('finance', ['financeDebts', 'financeAdvanced']);
        return [
            error ? { signalId: 'finance.snapshot_unavailable', label: 'Finance API snapshot unavailable', value: 'limited', severity: 'info', evidence: error, source: 'api_snapshot_error' } : null,
            { signalId: 'finance.stats', label: 'Finance KPI cards', value: document.querySelectorAll('#finStats .fin-stat-card').length, source: 'finance_dom' },
            { signalId: 'finance.debts_visible', label: 'Visible debt rows', value: document.querySelectorAll('#debtsContent tbody tr').length, severity: document.querySelectorAll('#debtsContent tbody tr').length ? 'danger' : 'info', source: 'finance_debts_dom_fallback' }
        ].filter(Boolean);
    }

    function financeSummary() {
        const debts = getSnapshotData('finance', 'financeDebts');
        const advanced = getSnapshotData('finance', 'financeAdvanced');
        if (debts || advanced) {
            return {
                headline: 'Finance risk/control snapshot',
                details: [
                    `debtCount=${numberValue(debts?.count ?? advanced?.debt?.count, 0)}`,
                    `totalDebt=${numberValue(debts?.totalDebt ?? advanced?.debt?.total_debt, 0)}`,
                    `monthProfit=${numberValue(advanced?.metrics?.monthProfit, 0)}`,
                    `margin=${numberValue(advanced?.metrics?.margin, 0)}%`
                ],
                source: 'api:/api/finance'
            };
        }
        return { headline: 'Finance control context', details: [safeText('.fin-tab.active') || 'dashboard', `debtRows=${document.querySelectorAll('#debtsContent tbody tr').length}`], source: 'finance_dom' };
    }

    function communicationSignals(pageId = getPageId()) {
        const hot = getSnapshotData(pageId, 'hotLeads');
        const stats = getSnapshotData(pageId, 'leadStats');
        const unread = getSnapshotData(pageId, 'chatUnread');
        const hotCount = numberValue(hot?.leads?.length, 0);
        const newLeads = numberValue(stats?.stats?.new || stats?.stageStats?.new, 0);
        const unreadTotal = numberValue(unread?.total, 0);
        const unreadChannels = unread?.channels && typeof unread.channels === 'object'
            ? Object.values(unread.channels).filter(count => numberValue(count, 0) > 0).length
            : 0;
        const signals = [];
        if (hot || stats || unread) {
            if (hotCount) signals.push({ signalId: 'leads.hot.follow_up', label: 'Hot leads waiting follow-up', value: hotCount, severity: 'warning', evidence: `${hotCount} нових лідів чекають понад 24 години.`, source: 'api:/api/leads/hot' });
            if (newLeads) signals.push({ signalId: 'leads.new.week', label: 'New leads this period', value: newLeads, severity: newLeads ? 'info' : 'success', source: 'api:/api/leads/stats' });
            if (unreadTotal) signals.push({ signalId: 'chat.unread.total', label: 'Unread chat messages', value: unreadTotal, severity: 'warning', evidence: `${unreadTotal} непрочитаних повідомлень у ${unreadChannels || 'кількох'} каналах.`, source: 'api:/api/chat/unread' });
            if (!signals.length) signals.push({ signalId: 'communication.snapshot.clear', label: 'Communication snapshot loaded', value: 'no pressure', severity: 'success', source: 'api_snapshot' });
            return signals;
        }
        const error = snapshotFallback(pageId, ['hotLeads', 'leadStats', 'chatUnread']);
        return [
            error ? { signalId: `${pageId}.communication_snapshot_unavailable`, label: 'Communication API snapshot unavailable', value: 'limited', severity: 'info', evidence: error, source: 'api_snapshot_error' } : null,
            { signalId: 'leads.hot_visible', label: 'Visible hot/idle leads', value: document.querySelectorAll('.kanban-card.idle-red, .kanban-card.idle-yellow').length, severity: document.querySelectorAll('.kanban-card.idle-red').length ? 'danger' : 'warning', source: 'leads_kanban_dom_fallback' },
            { signalId: 'leads.waiting_reply', label: 'Workspace waiting reply signals', value: document.querySelectorAll('.workspace-badge.waiting, .workspace-row-meta.waiting').length, severity: 'warning', source: 'lead_workspace_dom_fallback' }
        ].filter(Boolean);
    }

    function communicationSummary(pageId = getPageId()) {
        const hot = getSnapshotData(pageId, 'hotLeads');
        const stats = getSnapshotData(pageId, 'leadStats');
        const unread = getSnapshotData(pageId, 'chatUnread');
        if (hot || stats || unread) {
            return {
                headline: pageId === 'chat' || pageId === 'omni' ? 'Chat response snapshot' : 'Lead/chat follow-up snapshot',
                details: [
                    `hotLeads=${numberValue(hot?.leads?.length, 0)}`,
                    `newLeads=${numberValue(stats?.stats?.new || stats?.stageStats?.new, 0)}`,
                    `unread=${numberValue(unread?.total, 0)}`
                ],
                source: 'api:/api/leads + /api/chat/unread'
            };
        }
        if (pageId === 'chat' || pageId === 'omni') {
            return { headline: 'Chat response context', details: [`unreadChannels=${document.querySelectorAll('.chat-channel-item.has-unread').length}`], source: 'chat_dom' };
        }
        return { headline: 'Lead pipeline context', details: [`cards=${document.querySelectorAll('.kanban-card[data-id], [data-lead-id]').length}`, `waiting=${document.querySelectorAll('.workspace-badge.waiting, .workspace-row-meta.waiting').length}`], source: 'leads_dom' };
    }

    function registerDefaultAdapters() {
        registerAdapter({
            pageId: 'dashboard',
            isAvailable: () => Boolean(document.getElementById('dashboardGrid') || window.DashboardPage?.getAssistantContext),
            getSignals: dashboardSignals,
            getActions: () => [
                { actionId: 'dashboard.focus-work-queue', page: 'dashboard', actionType: 'focus', label: 'Focus work queue', run: focusDashboardQueueSurface, targetResolver: () => 'dashboard-work-queue', failureMessage: 'Work queue is not visible on this dashboard.' },
                { actionId: 'dashboard.show-overdue-tasks', page: 'dashboard', actionType: 'filter', label: 'Show overdue tasks', run: openDashboardOverdueTasks, targetResolver: () => 'dashboard-work-queue', failureMessage: 'Overdue task filter is unavailable.' },
                { actionId: 'dashboard.show-waiting-replies', page: 'dashboard', actionType: 'filter', label: 'Show reply backlog', run: openDashboardReplyBacklog, targetResolver: () => 'dashboard-work-queue', failureMessage: 'Reply backlog controls are unavailable.' },
                { actionId: 'dashboard.refresh-work-queue', page: 'dashboard', actionType: 'refresh', label: 'Refresh work queue', run: () => window.DashboardPage?.refreshWorkQueue?.(), confirmationNeeded: false, targetResolver: () => 'dashboard-work-queue', failureMessage: 'Dashboard work queue refresh is unavailable.' }
            ],
            getTeachingTargets: () => [
                { targetId: 'dashboard-grid', page: 'dashboard', label: 'Dashboard widget grid', selectorOrRef: '[data-assistant-target="dashboard-grid"]', kind: 'section', priority: 1, fallbackText: 'Use the dashboard widget grid as the main operating surface.' },
                { targetId: 'dashboard-work-queue', page: 'dashboard', label: 'Work queue', selectorOrRef: '[data-assistant-target="dashboard-work-queue"]', kind: 'queue', priority: 2, fallbackText: 'Work queue is hidden for this role or not loaded yet.' }
            ],
            getContextSummary: dashboardSummary
        });

        registerAdapter({
            pageId: 'tasks',
            isAvailable: () => Boolean(document.getElementById('boardContent')),
            getSignals: taskSignals,
            getActions: () => [
                { actionId: 'tasks.focus-waiting', page: 'tasks', actionType: 'filter', label: 'Open waiting tasks', run: () => { clickSelector('.board-tab[data-view="waiting"]'); return highlightTarget('tasks-board'); }, targetResolver: () => 'tasks-waiting-tab', failureMessage: 'Waiting tasks tab is unavailable.' },
                { actionId: 'tasks.focus-overdue', page: 'tasks', actionType: 'focus', label: 'Focus first overdue task', run: () => highlightTarget('tasks-first-overdue'), targetResolver: () => 'tasks-first-overdue', failureMessage: 'No stable overdue task card is visible.' }
            ],
            getTeachingTargets: () => [
                { targetId: 'tasks-tabs', page: 'tasks', label: 'Task board filters', selectorOrRef: '[data-assistant-target="tasks-tabs"]', kind: 'filter', priority: 1 },
                { targetId: 'tasks-board', page: 'tasks', label: 'Task board', selectorOrRef: '[data-assistant-target="tasks-board"]', kind: 'board', priority: 2 },
                { targetId: 'tasks-first-overdue', page: 'tasks', label: 'First visible overdue task', selectorOrRef: '[data-assistant-target="tasks-first-overdue"]', kind: 'card', priority: 3, fallbackText: 'No visible overdue task has a stable card target right now.' }
            ],
            getContextSummary: taskSummary
        });

        registerAdapter({
            pageId: 'finance',
            isAvailable: () => Boolean(document.getElementById('finStats') || document.querySelector('.fin-tab')),
            getSignals: financeSignals,
            getActions: () => [
                { actionId: 'finance.open-debts', page: 'finance', actionType: 'filter', label: 'Open debts tab', run: () => { if (typeof window.switchTab === 'function') window.switchTab('debts'); else clickSelector('.fin-tab[data-tab="debts"]'); return window.setTimeout(() => highlightTarget('finance-debts'), 120); }, targetResolver: () => 'finance-debts-tab', failureMessage: 'Finance debts tab is unavailable.' },
                { actionId: 'finance.open-advanced', page: 'finance', actionType: 'filter', label: 'Open finance analytics', run: () => { if (typeof window.switchTab === 'function') window.switchTab('advanced'); else clickSelector('.fin-tab[data-tab="advanced"]'); return window.setTimeout(() => highlightTarget('finance-advanced'), 120); }, targetResolver: () => 'finance-advanced', failureMessage: 'Finance advanced analytics tab is unavailable.' }
            ],
            getTeachingTargets: () => [
                { targetId: 'finance-stats', page: 'finance', label: 'Finance KPI cards', selectorOrRef: '[data-assistant-target="finance-stats"]', kind: 'kpi', priority: 1 },
                { targetId: 'finance-debts', page: 'finance', label: 'Debt control', selectorOrRef: '[data-assistant-target="finance-debts"]', kind: 'table', priority: 2, fallbackText: 'Open the debts tab to inspect unpaid bookings.' },
                { targetId: 'finance-advanced', page: 'finance', label: 'Finance analytics', selectorOrRef: '[data-assistant-target="finance-advanced"]', kind: 'section', priority: 3 }
            ],
            getContextSummary: financeSummary
        });

        const leadsAdapter = {
            pageId: 'leads',
            pageIds: ['sales-funnel'],
            isAvailable: () => Boolean(document.getElementById('leadsStats') || document.getElementById('leadWorkspace')),
            getSignals: () => communicationSignals(getPageId()),
            getActions: () => [
                { actionId: 'leads.open-kanban', page: getPageId(), actionType: 'filter', label: 'Open leads kanban', run: () => { clickSelector('.view-btn[data-view="kanban"]'); return highlightTarget('leads-kanban'); }, targetResolver: () => 'leads-kanban', failureMessage: 'Leads kanban is unavailable.' },
                { actionId: 'leads.focus-hot', page: getPageId(), actionType: 'focus', label: 'Focus hot lead', run: () => highlightTarget('leads-first-hot'), targetResolver: () => 'leads-first-hot', failureMessage: 'No stable hot lead target is visible.' }
            ],
            getTeachingTargets: () => [
                { targetId: 'leads-stats', page: getPageId(), label: 'Lead stats', selectorOrRef: '[data-assistant-target="leads-stats"]', kind: 'kpi', priority: 1 },
                { targetId: 'leads-kanban', page: getPageId(), label: 'Lead pipeline kanban', selectorOrRef: '[data-assistant-target="leads-kanban"]', kind: 'pipeline', priority: 2 },
                { targetId: 'leads-waiting-reply', page: getPageId(), label: 'Waiting reply signal', selectorOrRef: '[data-assistant-target="leads-waiting-reply"]', kind: 'signal', priority: 3, fallbackText: 'No exact waiting-reply workspace target is visible yet.' }
            ],
            getContextSummary: () => communicationSummary(getPageId())
        };
        registerAdapter(leadsAdapter);

        const chatAdapter = {
            pageId: 'chat',
            pageIds: ['omni'],
            isAvailable: () => Boolean(document.getElementById('chatMessages') || document.querySelector('.chat-channel-item')),
            getSignals: () => communicationSignals(getPageId()),
            getActions: () => [
                { actionId: 'chat.filter-unread', page: getPageId(), actionType: 'filter', label: 'Filter unread chats', run: () => { clickSelector('[data-omni-filter="unread"]'); return highlightTarget('chat-unread-filter'); }, targetResolver: () => 'chat-unread-filter', failureMessage: 'Unread chat filter is unavailable.' },
                { actionId: 'chat.focus-first-unread', page: getPageId(), actionType: 'focus', label: 'Focus first unread chat', run: () => highlightTarget('chat-first-unread'), targetResolver: () => 'chat-first-unread', failureMessage: 'No stable unread chat target is visible.' }
            ],
            getTeachingTargets: () => [
                { targetId: 'chat-messages', page: getPageId(), label: 'Chat messages', selectorOrRef: '[data-assistant-target="chat-messages"]', kind: 'conversation', priority: 1 },
                { targetId: 'chat-first-unread', page: getPageId(), label: 'First unread channel', selectorOrRef: '[data-assistant-target="chat-first-unread"]', kind: 'signal', priority: 2, fallbackText: 'No unread channel is visible right now.' }
            ],
            getContextSummary: () => communicationSummary(getPageId())
        };
        registerAdapter(chatAdapter);
    }

    function init(options = {}) {
        const pageId = compactText(options.pageId || options.page || getPageId(), 80);
        markKnownTargets(pageId);
        store.setState({
            pageId,
            roleSnapshot: getRoleSnapshot(),
            voiceEnabled: isVoiceExplicitlyEnabled(),
            muted: !isVoiceExplicitlyEnabled()
        }, { source: 'init' });
        return buildContext({ pageId });
    }

    registerDefaultAdapters();

    window.CrmAssistantFoundation = {
        CONTRACT_VERSION,
        store,
        init,
        buildContext,
        refreshContext,
        refreshAdapterSnapshot,
        registerAdapter,
        getActiveAdapter,
        normalizeSignal,
        normalizeAction,
        normalizeTarget,
        normalizeReply,
        emitTelemetry,
        serializeAction,
        serializeTarget,
        actions: actionRegistry,
        targets: {
            markKnownTargets,
            highlight: highlightTarget,
            normalize: normalizeTarget
        },
        teaching: {
            flows: () => Object.keys(TEACHING_FLOWS),
            defaultFlowForPage: defaultTeachingFlowForPage,
            start: startTeachingFlow,
            next: nextTeachingStep,
            dismiss: dismissTeachingFlow,
            getState: () => store.getState().currentTeachingFlow
        },
        snapshots: {
            refresh: refreshAdapterSnapshot,
            get: getSnapshotEntry
        },
        telemetry: {
            emit: emitTelemetry
        },
        commands: {
            version: ACTION_COMMAND_VERSION,
            safeTypes: () => Array.from(SAFE_COMMAND_TYPES),
            route: routeCommand,
            execute: executeCommand,
            consumePending: consumePendingCommand,
            capabilities: () => ({
                safeWithoutConfirmation: ['navigation', 'filter', 'focus', 'highlight', 'theme', 'ui', 'voice'],
                confirmationRequired: ['create_task'],
                blocked: ['delete', 'passwords', 'tokens', 'permissions', 'financial_mutations', 'send_messages']
            })
        },
        adapters: {
            register: registerAdapter,
            list: () => Array.from(adapters.values()).map(adapter => ({ pageId: adapter.pageId, pageIds: adapter.pageIds })),
            getActive: getActiveAdapter
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        window.setTimeout(() => init(), 0);
    });
})();
