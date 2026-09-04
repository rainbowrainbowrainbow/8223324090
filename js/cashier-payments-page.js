
'use strict';

(function () {
    const PILOT_SCOPE = Object.freeze({ crmProfileKey: 'event_genix', locationAlias: 'park', registerAlias: 'middle', defaultEnabled: false });
    const INTERNAL_RECEIPT_TEXT = '\u0432\u043d\u0443\u0442\u0440\u0456\u0448\u043d\u044f \u043a\u0432\u0438\u0442\u0430\u043d\u0446\u0456\u044f';
    const STORAGE_PREFIX = 'eventgenix:cashier-payments';
    const FISCAL_BLOCKING_STATUSES = new Set(['pending', 'unknown', 'sending', 'validating', 'ready_to_send', 'failed', 'failed_retryable']);
    const FISCAL_DONE_STATUSES = new Set(['fiscalized']);
    const PAYMENT_TERMINAL_STATUSES = new Set(['confirmed']);
    const FISCAL_TERMINAL_STATUSES = new Set(['fiscalized', 'failed_terminal', 'validation_failed', 'blocked', 'cancelled', 'not_required', 'dead']);
    const POLLING_INTERVAL_MS = 2500;
    const POLLING_TIMEOUT_MS = 60000;
    const READINESS_REFRESH_MIN_MS = 15000;
    const READINESS_REFRESH_MAX_MS = 60000;
    const READINESS_REQUEST_TIMEOUT_MS = 8000;
    const UNRESOLVED_PAGE_SIZE = 50;
    const KYIV_DATE_TIME_FORMATTER = new Intl.DateTimeFormat('uk-UA', {
        timeZone: 'Europe/Kyiv',
        dateStyle: 'short',
        timeStyle: 'short'
    });
    const UNRESOLVED_QUEUE_TTL_MS = boundedTestTiming('ttlMs', 60000);
    const UNRESOLVED_REFRESH_MIN_MS = boundedTestTiming('retryMinMs', 15000);
    const UNRESOLVED_REFRESH_MAX_MS = Math.max(
        UNRESOLVED_REFRESH_MIN_MS,
        boundedTestTiming('retryMaxMs', 60000)
    );
    const PHASE1_CLOSE_POLL_INTERVAL_MS = 2500;
    const PHASE1_CLOSE_POLL_TIMEOUT_MS = 60000;

    function boundedTestTiming(key, fallback) {
        const value = Number(window.__EVENTGENIX_TEST_CASHIER_QUEUE_TIMING__?.[key]);
        if (!Number.isFinite(value) || value < 100) return fallback;
        // A browser-local test hook may only shorten safety windows, never relax them.
        return Math.min(fallback, Math.floor(value));
    }

    const state = {
        user: null,
        orderDetails: null,
        registerState: null,
        createInFlight: false,
        confirmInFlight: false,
        confirmSubmitted: false,
        reportInFlight: false,
        receiptHistoryLoaded: false,
        lastReportRefreshAt: null,
        unresolvedInFlight: false,
        unresolvedOrders: [],
        unresolvedPage: 0,
        unresolvedPageSize: UNRESOLVED_PAGE_SIZE,
        unresolvedSnapshotRevision: null,
        unresolvedNextCursor: null,
        unresolvedSnapshotRestartPending: false,
        unresolvedRegisterCount: 0,
        unresolvedMyCount: 0,
        unresolvedHasMore: false,
        unresolvedQueueState: 'unknown',
        unresolvedLastKnownOrders: [],
        unresolvedLastKnownSummary: { registerCount: 0, myCount: 0 },
        unresolvedLastRefreshAt: null,
        unresolvedLastError: null,
        unresolvedRefreshTimer: null,
        unresolvedRefreshBackoffMs: UNRESOLVED_REFRESH_MIN_MS,
        unresolvedAutoRefreshEnabled: false,
        unresolvedForceOpenChecking: false,
        readinessInFlight: false,
        nextCustomerSafetyRefreshInFlight: false,
        readinessTimer: null,
        readinessBackoffMs: READINESS_REFRESH_MIN_MS,
        phase1CloseConfirmationInFlight: false,
        phase1CloseInFlight: false,
        phase1ClosePollingTimer: null,
        phase1ClosePollingStartedAt: 0,
        phase1CloseTargetShiftId: null,
        phase1ClosePollingPaused: false,
        tender: 'cash',
        orderLoadGeneration: 0,
        pollingTimer: null,
        pollingOrderId: null,
        pollingStartedAt: 0
    };

    function $(id) { return document.getElementById(id); }

    function notify(message, type = 'info') {
        if (typeof showNotification === 'function') showNotification(message, type);
        const el = $('cashierGlobalStatus');
        if (el) {
            el.textContent = message;
            el.setAttribute('tabindex', '-1');
            el.classList.remove('hidden', 'cashier-alert-danger');
            if (type === 'error') el.classList.add('cashier-alert-danger');
            if (type === 'error') el.focus({ preventScroll: false });
        }
    }

    function setText(id, value) {
        const el = $(id);
        if (el) el.textContent = value == null || value === '' ? '—' : String(value);
    }

    function safeJson(value) {
        if (!value || typeof value !== 'object') return null;
        return value;
    }

    function normalizeStatus(value) {
        return String(value || '').trim().toLowerCase() || 'unknown';
    }

    function formatStatus(value) {
        const status = normalizeStatus(value);
        const labels = {
            draft: 'чернетка', unpaid: 'не оплачено', pending: 'очікує', unknown: 'невідомо', confirmed: 'оплачено', created: 'створюється', open: 'відкрита', opened: 'відкрита', opening: 'відкривається', closing: 'закривається', closed: 'закрита', blocked: 'заблоковано',
            payment_recorded: 'оплату зафіксовано', fiscalized: 'чек створено', failed: 'помилка з повтором', failed_retryable: 'помилка, буде повтор', failed_terminal: 'помилка без автоповтору', dead: 'потрібна ручна перевірка', cancelled: 'скасовано',
            validation_failed: 'помилка перевірки', ready_to_send: 'готово до відправки', sending: 'відправляється', validating: 'перевіряється', not_open: 'не відкрита', not_required: 'не потрібен',
            mapping_missing: 'налаштування каси відсутнє', credentials_missing: 'доступи не налаштовані', provider_unavailable: 'Checkbox недоступний', identity_mismatch: 'невірна каса Checkbox', shift_opening: 'зміна відкривається', paid_sale_closed_shift_reconciliation_required: 'потрібна ручна звірка оплаченого чека', ready: 'готово'
        };
        return labels[status] || 'потребує перевірки';
    }

    function classifyStatus(value) {
        const status = normalizeStatus(value);
        if (['confirmed', 'payment_recorded', 'fiscalized', 'open', 'closed'].includes(status)) return 'is-ok';
        if (['pending', 'unknown', 'ready_to_send', 'sending', 'validating', 'opening', 'closing', 'failed', 'failed_retryable'].includes(status)) return 'is-warn';
        if (['failed_terminal', 'dead', 'validation_failed', 'blocked', 'cancelled', 'paid_sale_closed_shift_reconciliation_required'].includes(status)) return 'is-danger';
        return '';
    }

    function formatCrmProfile(value) {
        const profile = String(value || '').trim();
        return profile === 'event_genix' ? 'парк' : (profile || '—');
    }

    function formatLocationRegister(locationValue, registerValue, registerDisplayName = '', locationDisplayName = '') {
        const location = String(locationValue || '').trim();
        const register = String(registerValue || '').trim();
        const locationLabel = location.toLowerCase() === 'park'
            ? 'парк'
            : (String(locationDisplayName || '').trim() || 'локація');
        const registerLabel = register.toLowerCase() === 'middle'
            ? 'середня каса'
            : (String(registerDisplayName || '').trim() || 'каса');
        return `${locationLabel} / ${registerLabel}`;
    }

    function effectiveFiscalStatus(order = state.orderDetails?.order) {
        return normalizeStatus(order?.fiscalQueueStatus || order?.fiscalStatus);
    }

    function setStatus(id, value) {
        const el = $(id);
        if (!el) return;
        el.textContent = formatStatus(value);
        el.classList.remove('is-ok', 'is-warn', 'is-danger');
        const cls = classifyStatus(value);
        if (cls) el.classList.add(cls);
    }

    function minorToNumber(value) {
        try { return Number(BigInt(String(value || 0))) / 100; }
        catch { return 0; }
    }

    function formatMoneyMinor(value) {
        return new Intl.NumberFormat('uk-UA', { style: 'currency', currency: 'UAH' }).format(minorToNumber(value));
    }

    function formatKyivDateTime(value) {
        if (!value) return '—';
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return '—';
        return KYIV_DATE_TIME_FORMATTER.format(date);
    }

    function formatUnresolvedOwnership(order = {}) {
        if (order.isMine === true) return 'Мій чек';
        const identity = String(order.cashierIdentity || '').trim();
        const userMatch = identity.match(/^user:(\d+)$/i);
        return userMatch ? `Касир №${userMatch[1]}` : 'Інший касир';
    }

    function formatIncidentReason(value) {
        const code = normalizeStatus(value);
        if (!value) return '';
        const labels = {
            provider_unavailable: 'Checkbox тимчасово недоступний; система повторить перевірку.',
            provider_shift_closed_before_sale_submit: 'Зміну закрито до відправлення чека; потрібна ручна звірка.',
            paid_sale_closed_shift_reconciliation_required: 'Потрібна ручна звірка оплаченого чека.',
            receipt_validation_failed: 'Checkbox не прийняв дані чека; потрібна перевірка відповідального.',
            identity_mismatch: 'Дані каси не збігаються; потрібна перевірка відповідального.'
        };
        if (labels[code]) return labels[code];
        if (/(timeout|network|unavailable|provider_5\d\d)/.test(code)) {
            return 'Checkbox тимчасово не відповів; система повторить перевірку.';
        }
        if (/(identity|cashier|organization|register|shift).*mismatch/.test(code)) {
            return 'Дані каси не збігаються; потрібна перевірка відповідального.';
        }
        if (/(validation|malformed|invalid)/.test(code)) {
            return 'Дані чека не пройшли перевірку; потрібна перевірка відповідального.';
        }
        return 'Потрібна перевірка відповідального.';
    }

    function formatPaymentMethod(value) {
        const method = normalizeStatus(value);
        if (method === 'card_terminal' || method === 'card_terminal_manual') return 'Термінал';
        if (method === 'cash') return 'Готівка';
        return 'Оплата';
    }

    function formatRecoveryText(order = {}) {
        const fiscalStatus = effectiveFiscalStatus(order);
        if (FISCAL_DONE_STATUSES.has(fiscalStatus)) return 'Чек створено. Після оновлення він зникне з незавершених.';
        if (['dead', 'failed_terminal', 'validation_failed', 'blocked'].includes(fiscalStatus)) {
            return 'Автоповтор зупинено — потрібна перевірка відповідального.';
        }
        if (order.nextRunAt) return `Чек очікує Checkbox — буде повтор ${formatKyivDateTime(order.nextRunAt)}.`;
        return 'Чек очікує Checkbox — система повторить автоматично.';
    }

    function updateTextIfPresent(id, value) {
        const el = $(id);
        if (el) el.textContent = value;
    }

    function setFlowNodeState(name, mode) {
        const node = document.querySelector(`[data-flow-node="${name}"]`);
        if (!node) return;
        node.classList.remove('is-active', 'is-complete', 'is-blocked', 'is-muted');
        if (mode) node.classList.add(`is-${mode}`);
    }

    function syncFlowOverview() {
        const order = state.orderDetails?.order || null;
        const fiscalStatus = effectiveFiscalStatus(order);
        const queueState = effectiveUnresolvedQueueState();
        const queueCount = queueState === 'available'
            ? Number(state.unresolvedRegisterCount || 0)
            : Number(state.unresolvedLastKnownSummary.registerCount || 0);
        const readinessReady = integrationReady();
        const viewOnly = state.registerState?.checkboxIntegrationEnabled === false
            || state.registerState?.paymentAcceptanceEnabled === false
            || state.registerState?.readinessCode === 'global_integration_disabled'
            || state.registerState?.readinessCode === 'payment_acceptance_disabled';
        const hasOrder = Boolean(order?.id);
        const paid = normalizeStatus(order?.paymentStatus) === 'confirmed' || normalizeStatus(order?.status) === 'payment_recorded';
        const fiscalized = FISCAL_DONE_STATUSES.has(fiscalStatus);

        updateTextIfPresent('cashierFlowReadiness', state.readinessInFlight ? 'оновлюємо' : (readinessReady ? 'готова' : (viewOnly ? 'тільки перегляд' : 'заблоковано')));
        updateTextIfPresent('cashierFlowOrder', !hasOrder ? 'створіть оплату' : (paid ? 'оплату прийнято' : 'очікує підтвердження'));
        updateTextIfPresent('cashierFlowReceipt', fiscalized ? 'чек створено' : (paid ? 'чек очікує Checkbox' : 'ще не створювався'));
        updateTextIfPresent('cashierFlowRecovery', queueState === 'available'
            ? (queueCount > 0 ? `${queueCount} незавершених` : 'черга чиста')
            : 'потрібне оновлення');

        setFlowNodeState('readiness', readinessReady ? 'complete' : 'blocked');
        setFlowNodeState('order', !hasOrder ? 'active' : (paid ? 'complete' : 'active'));
        setFlowNodeState('receipt', fiscalized ? 'complete' : (paid ? 'active' : 'muted'));
        setFlowNodeState('recovery', queueState === 'available' && queueCount === 0 ? 'complete' : (queueState === 'available' ? 'active' : 'blocked'));
    }

    function setButtonBusy(button, busy, busyText) {
        if (!button) return;
        if (busy) {
            if (!button.dataset.idleText) button.dataset.idleText = button.textContent || '';
            button.textContent = busyText;
            button.disabled = true;
        } else if (button.dataset.idleText) {
            button.textContent = button.dataset.idleText;
            delete button.dataset.idleText;
        }
        button.setAttribute('aria-busy', busy ? 'true' : 'false');
    }

    function parseUahToMinor(value) {
        const text = String(value || '').trim().replace(',', '.');
        if (!text) return 0n;
        if (!/^\d+(\.\d{0,2})?$/.test(text)) throw new Error('cash_amount_invalid');
        const [whole, fraction = ''] = text.split('.');
        return BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
    }

    function formatQuantity(quantityMillis) {
        try {
            const value = BigInt(String(quantityMillis || 0));
            if (value % 1000n === 0n) return String(value / 1000n);
            return (Number(value) / 1000).toLocaleString('uk-UA', { maximumFractionDigits: 3 });
        } catch {
            return '1';
        }
    }

    function randomKey(prefix) {
        const uuid = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        return `${prefix}:${uuid}`;
    }

    function storageNamespace() {
        const userId = state.user?.id || state.user?.username || 'anonymous';
        const fiscalProfileId = state.registerState?.fiscalProfileId || 'profile-pending';
        const fiscalRegisterId = state.registerState?.fiscalRegisterId || 'register-pending';
        return `${STORAGE_PREFIX}:u:${userId}:crm:${PILOT_SCOPE.crmProfileKey}:loc:${PILOT_SCOPE.locationAlias}:reg:${PILOT_SCOPE.registerAlias}:fp:${fiscalProfileId}:fr:${fiscalRegisterId}`;
    }

    function storageKey(key) {
        return `${storageNamespace()}:${key}`;
    }

    function storageGet(key) {
        try { return window.localStorage.getItem(storageKey(key)); }
        catch { return null; }
    }

    function storageSet(key, value) {
        try { window.localStorage.setItem(storageKey(key), String(value)); }
        catch {}
    }

    function storageRemove(key) {
        try { window.localStorage.removeItem(storageKey(key)); }
        catch {}
    }


    function operationStorageKey(action, target) {
        return `${action}:${PILOT_SCOPE.crmProfileKey}:${PILOT_SCOPE.locationAlias}:${PILOT_SCOPE.registerAlias}:${target || 'current'}`;
    }

    function getOperationIdempotencyKey(action, target = 'current') {
        const key = operationStorageKey(action, target);
        const existing = storageGet(key);
        if (existing) return existing;
        const generated = randomKey(`cashier-ui-${action}`);
        storageSet(key, generated);
        return generated;
    }

    function clearOperationIdempotencyKey(action, target = 'current') {
        storageRemove(operationStorageKey(action, target));
    }

    function orderStorageScope() {
        const date = $('paymentDate')?.value || 'no-date';
        const kids = $('paymentKidsCount')?.value || '0';
        const adults = $('paymentAdultsCount')?.value || '0';
        return `${PILOT_SCOPE.crmProfileKey}:${PILOT_SCOPE.locationAlias}:${PILOT_SCOPE.registerAlias}:${state.tender}:${date}:${kids}:${adults}`;
    }

    function getCreateIdempotencyKey() {
        const key = `create:${orderStorageScope()}`;
        const existing = storageGet(key);
        if (existing) return existing;
        const generated = randomKey('cashier-ui-create');
        storageSet(key, generated);
        return generated;
    }

    function clearCreateIdempotencyKey() {
        storageRemove(`create:${orderStorageScope()}`);
    }

    function getConfirmIdempotencyKey(orderId) {
        const key = `confirm:${PILOT_SCOPE.crmProfileKey}:${PILOT_SCOPE.locationAlias}:${PILOT_SCOPE.registerAlias}:${orderId}`;
        const existing = storageGet(key);
        if (existing) return existing;
        const generated = randomKey('cashier-ui-confirm');
        storageSet(key, generated);
        return generated;
    }

    function apiHeaders(idempotencyKey = null) {
        const headers = typeof getAuthHeaders === 'function' ? getAuthHeaders(true) : { 'Content-Type': 'application/json' };
        if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
        headers['X-Cashier-Pilot-Scope'] = `${PILOT_SCOPE.crmProfileKey}:${PILOT_SCOPE.locationAlias}:${PILOT_SCOPE.registerAlias}`;
        return headers;
    }

    async function apiRequest(path, options = {}) {
        const timeoutMs = Number(options.timeoutMs || 0);
        const controller = timeoutMs > 0 ? new AbortController() : null;
        const timeoutId = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null;
        try {
            const response = await fetch(path, {
                ...options,
                signal: controller?.signal || options.signal,
                headers: { ...(options.headers || {}) }
            });
            const contentType = response.headers.get('content-type') || '';
            const payload = contentType.includes('application/json') ? await response.json() : { error: await response.text() };
            if (!response.ok || payload.success === false) {
                const error = new Error(payload.error || `HTTP ${response.status}`);
                error.status = response.status;
                error.code = payload.code;
                error.details = payload.details;
                throw error;
            }
            return payload;
        } finally {
            if (timeoutId) window.clearTimeout(timeoutId);
        }
    }

    function buildAdmissionTicketPayload() {
        const date = $('paymentDate')?.value;
        const kids = Number($('paymentKidsCount')?.value || 0);
        const adults = Number($('paymentAdultsCount')?.value || 0);
        if (!date) throw new Error('payment_date_required');
        if (!Number.isSafeInteger(kids) || kids <= 0) throw new Error('kids_count_invalid');
        if (!Number.isSafeInteger(adults) || adults < 0) throw new Error('adults_count_invalid');
        return {
            tender: state.tender,
            crmProfileKey: PILOT_SCOPE.crmProfileKey,
            locationAlias: PILOT_SCOPE.locationAlias,
            registerAlias: PILOT_SCOPE.registerAlias,
            admissionTicket: {
                date,
                banquetGuests: kids,
                banquetAdults: adults,
                ticketQuantities: []
            }
        };
    }

    async function createPaymentOrder(event) {
        event?.preventDefault?.();
        if (state.createInFlight) return;
        if (!integrationReady()) {
            notify(paymentUiError(new Error('checkbox_integration_not_ready')), 'error');
            return;
        }
        if (activeUnfinishedOrder()) {
            notify('Завершіть поточну оплату або дочекайтесь чека перед новою оплатою.', 'error');
            return;
        }
        state.createInFlight = true;
        syncCreateAvailability();
        try {
            const payload = buildAdmissionTicketPayload();
            const idempotencyKey = getCreateIdempotencyKey();
            const result = await apiRequest('/api/payments/admission-ticket/orders', {
                method: 'POST',
                headers: apiHeaders(idempotencyKey),
                body: JSON.stringify(payload)
            });
            const orderId = result.order?.id;
            if (!orderId) throw new Error('payment_order_missing_in_response');
            storageSet('lastOrderId', orderId);
            await loadPaymentOrder(orderId, { silent: true });
            notify(result.replayed ? 'Цю саму оплату безпечно відкрито повторно.' : 'Оплату створено. Перевірте позиції та підтвердьте отримання грошей.', 'success');
            focusFirstConfirmationControl();
        } catch (error) {
            notify(paymentUiError(error), 'error');
        } finally {
            state.createInFlight = false;
            syncCreateAvailability();
        }
    }

    async function loadPaymentOrder(orderId, { silent = false } = {}) {
        const loadGeneration = ++state.orderLoadGeneration;
        const result = await apiRequest(`/api/payments/orders/${encodeURIComponent(orderId)}`, {
            method: 'GET',
            headers: apiHeaders()
        });
        if (loadGeneration !== state.orderLoadGeneration) return state.orderDetails;
        const currentOrder = state.orderDetails?.order;
        if (String(currentOrder?.id || '') === String(result.order?.id || '')
            && FISCAL_DONE_STATUSES.has(effectiveFiscalStatus(currentOrder))
            && !FISCAL_DONE_STATUSES.has(effectiveFiscalStatus(result.order))) {
            return state.orderDetails;
        }
        state.orderDetails = result;
        state.tender = result.order?.sourceSnapshot?.tender || (result.order?.paymentMethod === 'card_terminal' ? 'card_terminal_manual' : 'cash');
        state.confirmSubmitted = orderBlocksPayment(result.order);
        // Keep confirmation fail-closed while the order's register-wide safety context is refreshed.
        // Rendering a new draft before this transition creates a brief false-ready focus window.
        // Existing paid orders keep the last visible queue snapshot during silent polling to avoid UI blinking.
        const orderChanged = String(currentOrder?.id || '') !== String(result.order?.id || '');
        const newUnpaidDraft = orderChanged && normalizeStatus(result.order?.paymentStatus) === 'unpaid';
        if (!silent || newUnpaidDraft || !unresolvedQueueIsFresh()) {
            if (newUnpaidDraft) state.unresolvedForceOpenChecking = true;
            state.unresolvedQueueState = 'checking';
            state.unresolvedLastError = null;
            renderUnresolvedOrders();
            renderReadinessState();
        }
        syncTenderControls();
        renderOrder(result);
        await loadPilotRegisterState({ silent: true });
        if (loadGeneration !== state.orderLoadGeneration) return state.orderDetails;
        await loadUnresolvedOrders({ silent: true });
        if (loadGeneration !== state.orderLoadGeneration) return state.orderDetails;
        syncOrderPolling(result.order);
        if (FISCAL_DONE_STATUSES.has(effectiveFiscalStatus(result.order))) refreshReceiptHistoryIfVisible();
        if (!silent) notify('Оплату завантажено.', 'success');
        return result;
    }

    async function loadPilotRegisterState({ silent = false } = {}) {
        try {
            const params = new URLSearchParams({ crmProfileKey: PILOT_SCOPE.crmProfileKey, locationAlias: PILOT_SCOPE.locationAlias, registerAlias: PILOT_SCOPE.registerAlias });
            const result = await apiRequest(`/api/payments/pilot-register-state?${params.toString()}`, {
                method: 'GET',
                headers: apiHeaders(),
                timeoutMs: READINESS_REQUEST_TIMEOUT_MS
            });
            state.registerState = result;
            renderRegisterState(result);
            if (!silent) notify('Стан каси оновлено.', 'success');
            return result;
        } catch (error) {
            state.registerState = null;
            renderRegisterState(null);
            if (!silent) notify(paymentUiError(error), 'error');
            return null;
        }
    }

    function clearReadinessRefreshTimer() {
        if (state.readinessTimer) window.clearTimeout(state.readinessTimer);
        state.readinessTimer = null;
    }

    function scheduleReadinessRefresh() {
        clearReadinessRefreshTimer();
        state.readinessTimer = window.setTimeout(async () => {
            await loadPilotRegisterState({ silent: true });
            scheduleReadinessRefresh();
        }, state.readinessBackoffMs);
    }

    async function refreshReadiness({ silent = false, force = true } = {}) {
        if (state.readinessInFlight) return state.registerState;
        state.readinessInFlight = true;
        state.phase1ClosePollingPaused = false;
        const button = $('refreshReadinessBtn');
        setButtonBusy(button, true, 'Оновлюємо готовність…');
        renderReadinessState();
        syncCreateAvailability();
        syncConfirmationAvailability();
        try {
            await apiRequest('/api/payments/readiness/probe', {
                method: 'POST',
                headers: apiHeaders(),
                body: JSON.stringify({ crmProfileKey: PILOT_SCOPE.crmProfileKey, locationAlias: PILOT_SCOPE.locationAlias, registerAlias: PILOT_SCOPE.registerAlias, force }),
                timeoutMs: READINESS_REQUEST_TIMEOUT_MS
            });
            const result = await loadPilotRegisterState({ silent: true });
            state.readinessBackoffMs = READINESS_REFRESH_MIN_MS;
            if (!silent) notify('Готовність Checkbox оновлено без перезавантаження сторінки.', 'success');
            return result;
        } catch (error) {
            state.readinessBackoffMs = Math.min(READINESS_REFRESH_MAX_MS, Math.max(READINESS_REFRESH_MIN_MS, state.readinessBackoffMs * 2));
            state.registerState = {
                ...(state.registerState || {}),
                readinessCode: error?.code || 'provider_unavailable',
                integrationReady: false,
                providerUnavailable: true
            };
            renderRegisterState(state.registerState);
            if (!silent) notify(paymentUiError(error), 'error');
            return state.registerState;
        } finally {
            state.readinessInFlight = false;
            setButtonBusy(button, false, '');
            if (button) button.disabled = false;
            renderReadinessState();
            syncCreateAvailability();
            syncConfirmationAvailability();
            scheduleReadinessRefresh();
        }
    }

    function focusFirstConfirmationControl() {
        const target = state.tender === 'card_terminal_manual' ? $('terminalSuccessCheckbox') : $('cashReceivedAmount');
        target?.focus?.({ preventScroll: false });
    }

    function focusFiscalResult() {
        const panel = $('fiscalResultPanel');
        if (!panel) return;
        panel.setAttribute('tabindex', '-1');
        panel.focus({ preventScroll: false });
    }

    function clearOrderPolling() {
        if (state.pollingTimer) window.clearTimeout(state.pollingTimer);
        state.pollingTimer = null;
        state.pollingOrderId = null;
        state.pollingStartedAt = 0;
    }

    function isFiscalTerminal(order = state.orderDetails?.order) {
        return FISCAL_TERMINAL_STATUSES.has(effectiveFiscalStatus(order));
    }

    function shouldPollOrder(order = state.orderDetails?.order) {
        if (!order?.id) return false;
        if (!PAYMENT_TERMINAL_STATUSES.has(normalizeStatus(order.paymentStatus))) return false;
        if (isFiscalTerminal(order)) return false;
        return FISCAL_BLOCKING_STATUSES.has(effectiveFiscalStatus(order));
    }

    function syncOrderPolling(order = state.orderDetails?.order) {
        if (!shouldPollOrder(order)) {
            clearOrderPolling();
            return;
        }
        const orderId = String(order.id);
        if (state.pollingOrderId === orderId) {
            if (!state.pollingStartedAt) state.pollingStartedAt = Date.now();
            if (!state.pollingTimer) scheduleOrderPoll();
            return;
        }
        clearOrderPolling();
        state.pollingOrderId = orderId;
        state.pollingStartedAt = Date.now();
        scheduleOrderPoll();
    }

    function scheduleOrderPoll() {
        if (!state.pollingOrderId) return;
        state.pollingTimer = window.setTimeout(async () => {
            state.pollingTimer = null;
            const orderId = state.pollingOrderId;
            if (!orderId) return;
            if (Date.now() - state.pollingStartedAt > POLLING_TIMEOUT_MS) {
                clearOrderPolling();
                await loadUnresolvedOrders({ silent: true });
                notify('Чек ще не завершений. Він залишився у черзі незавершених чеків; повторну оплату не створюйте. Можна натиснути “Оновити” вручну.', 'error');
                return;
            }
            try {
                await loadPaymentOrder(orderId, { silent: true });
            } catch (error) {
                notify(paymentUiError(error), 'error');
                scheduleOrderPoll();
            }
        }, POLLING_INTERVAL_MS);
    }

    function paymentUiError(error) {
        const code = error?.code || error?.message;
        const messages = {
            cash_amount_invalid: 'Сума готівки має бути у гривнях, максимум з двома знаками після коми.',
            cash_received_too_low: 'Отримана готівка менша за суму оплати. Підтвердження заблоковано.',
            payment_date_required: 'Вкажіть дату квитка.',
            checkbox_integration_not_ready: 'Інтеграція Checkbox або налаштування каси не готові. Підтвердження грошей заблоковано.',
            checkbox_integration_disabled: 'Зв’язок із Checkbox вимкнений. Приймання грошей недоступне.',
            checkbox_payment_acceptance_disabled: 'Приймання нових оплат вимкнене. Уже оплачені чеки залишаються у відновленні.',
            readiness_stale: 'Перевірка каси застаріла. Оновіть готовність Checkbox перед оплатою.',
            checkbox_provider_unavailable: 'Checkbox тимчасово недоступний. Нові оплати заблоковано.',
            external_shift_requires_sync: 'У Checkbox є інша відкрита зміна. Потрібна безпечна звірка відповідальним.',
            kids_count_invalid: 'Кількість дітей має бути більшою за нуль.',
            adults_count_invalid: 'Кількість дорослих не може бути від’ємною.',
            card_terminal_success_required: 'Перед підтвердженням поставте позначку: термінал показав успішну оплату.',
            payment_repeat_blocked: 'Повторна оплата заблокована: оплата вже підтверджена або чек очікує фіскалізації.',
            payment_order_cancel_denied: 'Скасувати можна тільки неоплачену чернетку.',
            fiscal_mapping_ambiguous_or_missing: 'Парк і середня каса не налаштовані або мають неоднозначну відповідність.',
            forbidden: 'Немає доступу до цієї каси або CRM профілю.',
            idempotency_key_required: 'Не вдалося створити ключ безпечного повтору запиту.',
            queue_unavailable: 'Черга незавершених чеків недоступна. Підтвердження грошей заблоковано.',
            unresolved_snapshot_changed: 'Список незавершених чеків змінився під час перегляду. Оновлюємо його з початку.',
            provider_unavailable: 'Checkbox тимчасово недоступний. Нові оплати заблоковано.',
            paid_sale_closed_shift_reconciliation_required: 'Зміну Checkbox закрито до відправлення вже оплаченої операції. Нові оплати заблоковано до ручної звірки.',
            payment_acceptance_disabled: 'Приймання нових оплат вимкнене. Уже оплачені чеки продовжують безпечно відновлюватися.',
            phase1_shift_identity_mismatch: 'Сервер повернув іншу зміну. Закриття зупинено без повторного запиту.',
            phase1_close_confirmation_unavailable: 'Безпечне підтвердження тимчасово недоступне. Запит на закриття не надіслано.'
        };
        return messages[code] || 'Не вдалося виконати дію. Оновіть стан каси або зверніться до відповідального.';
    }

    function renderOrder(details) {
        const order = details?.order || null;
        const items = Array.isArray(details?.items) ? details.items : [];
        if (!order) return;
        setText('cashierFiscalProfile', `${formatCrmProfile(order.crmProfileKey)} / ${order.legalEntityName || order.legalEntityKey || '\u0424\u041e\u041f \u043d\u0435 \u043d\u0430\u043b\u0430\u0448\u0442\u043e\u0432\u0430\u043d\u043e'}`);
        const locationAlias = order.sourceSnapshot?.location_alias
            || order.sourceSnapshot?.locationAlias
            || order.locationAlias
            || state.registerState?.locationAlias;
        const registerAlias = order.registerAlias
            || order.sourceSnapshot?.register_alias
            || order.sourceSnapshot?.registerAlias
            || state.registerState?.registerAlias
            || order.registerDisplayName;
        setText('cashierRegister', formatLocationRegister(
            locationAlias,
            registerAlias,
            order.registerDisplayName || state.registerState?.registerDisplayName,
            order.locationDisplayName || state.registerState?.locationDisplayName
        ));
        setStatus('cashierPaymentStatus', order.paymentStatus || order.status);
        setStatus('cashierFiscalStatus', effectiveFiscalStatus(order));
        setText('internalReceiptLabel', `RCP-${order.id} \u2014 ${INTERNAL_RECEIPT_TEXT}`);
        setText('paymentTotalAmount', formatMoneyMinor(order.totalAmountMinor));
        setText('cardExactAmount', formatMoneyMinor(order.totalAmountMinor));
        renderItems(items);
        renderFiscalResult(details);
        syncCreateAvailability();
        syncConfirmationAvailability();
    }

    function renderItems(items) {
        const body = $('paymentItemsBody');
        if (!body) return;
        if (!items.length) {
            body.innerHTML = '<tr><td colspan="4" class="cashier-empty">У зафіксованій оплаті немає позицій.</td></tr>';
            return;
        }
        body.innerHTML = items.map(item => `
            <tr>
                <td><strong>${escapeHtml(item.itemName)}</strong></td>
                <td>${escapeHtml(formatQuantity(item.quantityMillis))}</td>
                <td>${escapeHtml(formatMoneyMinor(item.unitPriceMinor))}</td>
                <td>${escapeHtml(formatMoneyMinor(item.totalAmountMinor))}</td>
            </tr>
        `).join('');
    }

    function renderFiscalResult(details) {
        const order = details?.order || {};
        const fiscalStatus = effectiveFiscalStatus(order);
        const artifacts = details?.artifacts || {};
        const latestReceipt = Array.isArray(details?.receipts) ? details.receipts[0] : null;
        setStatus('fiscalReceiptBadge', fiscalStatus);
        const message = $('fiscalPendingMessage');
        const links = $('providerReceiptLinks');
        const pendingNotice = $('pendingReceiptNotice');
        const hasOfficialReceipt = FISCAL_DONE_STATUSES.has(fiscalStatus) || latestReceipt?.status === 'fiscalized';
        if (hasOfficialReceipt) forgetPendingOrder(order.id);
        if (message) {
            if (hasOfficialReceipt) message.textContent = '\u041e\u0444\u0456\u0446\u0456\u0439\u043d\u0438\u0439 \u0447\u0435\u043a Checkbox \u043e\u0442\u0440\u0438\u043c\u0430\u043d\u043e. RCP-* \u043b\u0438\u0448\u0430\u0454\u0442\u044c\u0441\u044f \u0432\u043d\u0443\u0442\u0440\u0456\u0448\u043d\u044c\u043e\u044e \u043a\u0432\u0438\u0442\u0430\u043d\u0446\u0456\u0454\u044e Event Genix.';
            else if (FISCAL_BLOCKING_STATUSES.has(fiscalStatus)) message.textContent = 'Чек очікує Checkbox або буде повтор. Оплата вже зафіксована, тому повторно приймати гроші за цей RCP не можна.';
            else message.textContent = '\u041f\u0456\u0441\u043b\u044f \u043f\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0436\u0435\u043d\u043d\u044f \u043e\u043f\u043b\u0430\u0442\u0438 \u0441\u0435\u0440\u0432\u0435\u0440 \u0441\u0442\u0432\u043e\u0440\u0438\u0442\u044c \u043e\u0434\u043d\u0443 \u043d\u0430\u0434\u0456\u0439\u043d\u0443 \u0437\u0430\u0434\u0430\u0447\u0443 \u0444\u0456\u0441\u043a\u0430\u043b\u0456\u0437\u0430\u0446\u0456\u0457.';
        }
        if (pendingNotice) {
            const isPending = FISCAL_BLOCKING_STATUSES.has(fiscalStatus) && normalizeStatus(order.paymentStatus) === 'confirmed';
            if (isPending) rememberPendingOrder(order.id);
            renderPendingOrdersNotice(isPending ? order.id : null);
        }
        setReceiptLink('providerTaxUrl', artifacts.taxUrl || latestReceipt?.providerTaxUrl);
        setReceiptLink('providerPdfUrl', artifacts.pdfUrl || latestReceipt?.providerPdfUrl);
        setReceiptLink('providerQrUrl', artifacts.qrUrl || latestReceipt?.providerQrUrl);
        if (links) {
            const visibleLinks = Array.from(links.querySelectorAll('a')).some(link => !link.classList.contains('hidden'));
            links.classList.toggle('hidden', !hasOfficialReceipt || !visibleLinks);
        }
        syncFlowOverview();
    }

    function pendingOrderIds() {
        try {
            const parsed = JSON.parse(storageGet('pendingOrderIds') || '[]');
            return Array.isArray(parsed) ? parsed.map(String).filter(Boolean).slice(0, 10) : [];
        } catch {
            return [];
        }
    }

    function rememberPendingOrder(orderId) {
        if (!orderId) return;
        const ids = pendingOrderIds().filter(id => id !== String(orderId));
        ids.unshift(String(orderId));
        storageSet('pendingOrderIds', JSON.stringify(ids.slice(0, 10)));
    }

    function forgetPendingOrder(orderId) {
        if (!orderId) return;
        const ids = pendingOrderIds().filter(id => id !== String(orderId));
        storageSet('pendingOrderIds', JSON.stringify(ids));
    }

    function replacePendingOrderIds(orderIds) {
        const ids = Array.from(new Set((orderIds || []).map(String).filter(Boolean))).slice(0, 10);
        storageSet('pendingOrderIds', JSON.stringify(ids));
    }

    function renderPendingOrdersNotice(currentOrderId = null) {
        const pendingNotice = $('pendingReceiptNotice');
        if (!pendingNotice) return;
        const serverIds = (state.unresolvedOrders || []).map(order => String(order.id)).filter(Boolean);
        const ids = state.unresolvedQueueState === 'available'
            ? serverIds
            : pendingOrderIds();
        if (currentOrderId && !ids.includes(String(currentOrderId))) ids.unshift(String(currentOrderId));
        pendingNotice.classList.toggle('hidden', ids.length === 0);
        const knownTotal = state.unresolvedQueueState === 'available'
            ? state.unresolvedRegisterCount
            : state.unresolvedLastKnownSummary.registerCount;
        const remainingCount = Math.max(0, Number(knownTotal || 0) - ids.length);
        const recoverySubject = ids.length === 1 ? 'Він залишається' : 'Вони залишаються';
        const repeatSubject = ids.length === 1 ? 'нього' : 'них';
        pendingNotice.textContent = ids.length
            ? `Чек очікує Checkbox / буде повтор: ${ids.map(id => `RCP-${id}`).join(', ')}${remainingCount ? ` та ще ${remainingCount}` : ''}. ${recoverySubject} у серверній черзі нижче; повторну оплату для ${repeatSubject} не створюйте.`
            : '';
    }

    function unresolvedQueueIsFresh(now = Date.now()) {
        const refreshedAt = Number(state.unresolvedLastRefreshAt || 0);
        return state.unresolvedQueueState === 'available'
            && Number.isFinite(refreshedAt)
            && refreshedAt > 0
            && Math.max(0, Number(now) - refreshedAt) < UNRESOLVED_QUEUE_TTL_MS;
    }

    function effectiveUnresolvedQueueState() {
        if (state.unresolvedQueueState === 'available' && !unresolvedQueueIsFresh()) return 'stale';
        return state.unresolvedQueueState;
    }

    function invalidUnresolvedQueuePayload() {
        const error = new Error('queue_unavailable');
        error.code = 'queue_unavailable';
        return error;
    }

    function normalizeUnresolvedQueuePayload(result, {
        requestedPage,
        requestedPageSize,
        requestedCursor = null,
        requestedSnapshotRevision = null,
        append = false
    } = {}) {
        const positiveInteger = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
        const nonNegativeInteger = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0;
        const snapshotRevision = String(result?.snapshotRevision || '').trim().toLowerCase();
        const nextCursor = result?.nextCursor == null || result?.nextCursor === ''
            ? null
            : String(result.nextCursor).trim();
        if (!result || result.success !== true || result.registerWide !== true || !Array.isArray(result.orders)) {
            throw invalidUnresolvedQueuePayload();
        }
        if (!positiveInteger(result.fiscalProfileId)
            || !positiveInteger(result.fiscalLocationId)
            || !positiveInteger(result.fiscalRegisterId)
            || !positiveInteger(result.page)
            || !positiveInteger(result.pageSize)
            || Number(result.page) !== Number(requestedPage)
            || Number(result.pageSize) !== Number(requestedPageSize)
            || !nonNegativeInteger(result.registerCount)
            || !nonNegativeInteger(result.myCount)
            || Number(result.myCount) > Number(result.registerCount)
            || typeof result.hasMore !== 'boolean'
            || result.orders.length > Number(result.pageSize)
            || !/^[a-f0-9]{32}$/.test(snapshotRevision)
            || (nextCursor !== null && !positiveInteger(nextCursor))
            || result.hasMore !== (nextCursor !== null)) {
            throw invalidUnresolvedQueuePayload();
        }
        if (append && (!positiveInteger(requestedCursor)
            || !/^[a-f0-9]{32}$/.test(String(requestedSnapshotRevision || '').trim().toLowerCase())
            || snapshotRevision !== String(requestedSnapshotRevision).trim().toLowerCase())) {
            throw invalidUnresolvedQueuePayload();
        }
        const expectedProfileId = Number(state.registerState?.fiscalProfileId || 0);
        const expectedLocationId = Number(state.registerState?.fiscalLocationId || 0);
        const expectedRegisterId = Number(state.registerState?.fiscalRegisterId || 0);
        if ((expectedProfileId && Number(result.fiscalProfileId) !== expectedProfileId)
            || (expectedLocationId && Number(result.fiscalLocationId) !== expectedLocationId)
            || (expectedRegisterId && Number(result.fiscalRegisterId) !== expectedRegisterId)) {
            throw invalidUnresolvedQueuePayload();
        }
        const seen = new Set();
        const orders = result.orders.map(order => {
            const id = Number(order?.id);
            if (!order || !positiveInteger(id)
                || seen.has(String(id))
                || order.isMine !== true && order.isMine !== false
                || normalizeStatus(order.paymentStatus) !== 'confirmed'
                || !String(order.fiscalStatus || '').trim()
                || !/^\d+$/.test(String(order.totalAmountMinor || ''))
                || String(order.currency || '').trim().toUpperCase() !== 'UAH') {
                throw invalidUnresolvedQueuePayload();
            }
            seen.add(String(id));
            return { ...order, id };
        });
        if (orders.some((order, index) => index > 0 && order.id >= orders[index - 1].id)
            || (append && orders.some(order => order.id >= Number(requestedCursor)))
            || result.hasMore && (orders.length !== Number(result.pageSize) || nextCursor !== String(orders.at(-1)?.id || ''))
            || !result.hasMore && nextCursor !== null
            || orders.length > Number(result.registerCount)) {
            throw invalidUnresolvedQueuePayload();
        }
        return {
            ...result,
            fiscalProfileId: Number(result.fiscalProfileId),
            fiscalLocationId: Number(result.fiscalLocationId),
            fiscalRegisterId: Number(result.fiscalRegisterId),
            page: Number(result.page),
            pageSize: Number(result.pageSize),
            registerCount: Number(result.registerCount),
            myCount: Number(result.myCount),
            snapshotRevision,
            nextCursor,
            orders
        };
    }

    function clearUnresolvedRefreshTimer() {
        if (state.unresolvedRefreshTimer) window.clearTimeout(state.unresolvedRefreshTimer);
        state.unresolvedRefreshTimer = null;
    }

    function scheduleUnresolvedRefresh({ delayMs = null } = {}) {
        clearUnresolvedRefreshTimer();
        if (!state.unresolvedAutoRefreshEnabled) return;
        const refreshedAt = Number(state.unresolvedLastRefreshAt || 0);
        const untilStale = refreshedAt > 0
            ? Math.max(100, UNRESOLVED_QUEUE_TTL_MS - Math.max(0, Date.now() - refreshedAt))
            : UNRESOLVED_REFRESH_MIN_MS;
        const delay = delayMs == null
            ? (state.unresolvedQueueState === 'available' ? untilStale : state.unresolvedRefreshBackoffMs)
            : Number(delayMs);
        state.unresolvedRefreshTimer = window.setTimeout(() => {
            state.unresolvedRefreshTimer = null;
            if (state.unresolvedQueueState === 'available' && !unresolvedQueueIsFresh()) {
                state.unresolvedQueueState = 'stale';
                renderUnresolvedOrders();
                renderReadinessState();
            }
            void loadUnresolvedOrders({ silent: true });
        }, Math.max(100, Math.min(Number(delay) || UNRESOLVED_REFRESH_MIN_MS, UNRESOLVED_REFRESH_MAX_MS)));
    }

    function syncUnresolvedControls() {
        const refreshButton = $('refreshUnresolvedOrdersBtn');
        const loadMoreButton = $('loadMoreUnresolvedOrdersBtn');
        const queueState = effectiveUnresolvedQueueState();
        const busy = state.unresolvedInFlight || queueState === 'checking';
        if (refreshButton) {
            refreshButton.disabled = busy;
            refreshButton.setAttribute('aria-disabled', busy ? 'true' : 'false');
            refreshButton.setAttribute('aria-busy', busy ? 'true' : 'false');
        }
        if (loadMoreButton) {
            const visible = queueState === 'available' && state.unresolvedHasMore;
            loadMoreButton.classList.toggle('hidden', !visible);
            loadMoreButton.disabled = busy || !visible;
            loadMoreButton.setAttribute('aria-disabled', loadMoreButton.disabled ? 'true' : 'false');
            loadMoreButton.setAttribute('aria-busy', busy ? 'true' : 'false');
        }
    }

    function syncUnresolvedDisclosure() {
        const panel = $('unresolvedOrdersPanel');
        const badge = $('unresolvedOrdersSummaryBadge');
        if (!panel || !badge) return;
        const queueState = effectiveUnresolvedQueueState();
        const count = queueState === 'available'
            ? Number(state.unresolvedRegisterCount || 0)
            : Number(state.unresolvedLastKnownSummary.registerCount || 0);
        const labels = {
            checking: 'перевіряємо',
            unavailable: 'список недоступний',
            stale: 'потрібне оновлення',
            unknown: 'не перевірено'
        };
        badge.textContent = queueState === 'available'
            ? (count > 0 ? `${count} незавершених` : 'немає')
            : (labels[queueState] || 'не перевірено');
        const needsAttention = queueState !== 'available' || count > 0;
        const shouldAutoOpen = count > 0
            || queueState === 'unavailable'
            || queueState === 'stale'
            || (queueState === 'checking' && state.unresolvedForceOpenChecking === true);
        panel.classList.toggle('has-warning', needsAttention);
        if (shouldAutoOpen) {
            if (!panel.open) panel.dataset.safetyOpened = count > 0 ? 'unresolved' : queueState;
            panel.open = true;
        } else if (queueState === 'available' && count === 0 && panel.dataset.safetyOpened && panel.dataset.safetyOpened !== 'unresolved') {
            panel.open = false;
            delete panel.dataset.safetyOpened;
            state.unresolvedForceOpenChecking = false;
        } else {
            delete panel.dataset.safetyOpened;
            if (queueState === 'available') state.unresolvedForceOpenChecking = false;
        }
    }

    function renderUnresolvedOrderButton(order = {}) {
        return `
            <button type="button" class="cashier-unresolved-item cashier-unresolved-item--receipt" data-order-id="${escapeAttribute(order.id)}" aria-label="${escapeAttribute(unresolvedOrderAccessibleLabel(order))}">
                <span class="cashier-receipt-id"><strong>RCP-${escapeHtml(order.id)}</strong><small>${escapeHtml(formatUnresolvedOwnership(order))}</small></span>
                <span class="cashier-receipt-money">${escapeHtml(formatMoneyMinor(order.totalAmountMinor))}</span>
                <span>${escapeHtml(formatPaymentMethod(order.paymentMethod || order.tender))}</span>
                <span>${escapeHtml(formatStatus(order.paymentStatus))}</span>
                <span class="cashier-status ${escapeAttribute(classifyStatus(order.fiscalStatus))}">${escapeHtml(formatStatus(order.fiscalStatus))}</span>
                <span class="cashier-recovery-text">${escapeHtml(formatRecoveryText(order))}</span>
                <span class="cashier-recovery-reason">${escapeHtml(formatIncidentReason(order.incidentReason))}</span>
            </button>
        `;
    }

    function renderUnresolvedOrders() {
        const body = $('unresolvedOrdersBody');
        if (!body) return;
        const orders = Array.isArray(state.unresolvedOrders) ? state.unresolvedOrders : [];
        const queueState = effectiveUnresolvedQueueState();
        const isChecking = queueState === 'checking';
        const isStale = queueState === 'stale';
        syncUnresolvedDisclosure();
        body.setAttribute('aria-busy', isChecking ? 'true' : 'false');
        if (isChecking || isStale || queueState === 'unavailable') {
            const lastKnown = Array.isArray(state.unresolvedLastKnownOrders) ? state.unresolvedLastKnownOrders : [];
            const lastKnownRegisterCount = Number(state.unresolvedLastKnownSummary.registerCount || lastKnown.length || 0);
            const lastKnownMyCount = Number(state.unresolvedLastKnownSummary.myCount || 0);
            const alertMarkup = isChecking
                ? '<div class="cashier-alert cashier-alert-warning" data-queue-state="checking" role="status">Перевіряємо повний список незавершених чеків. Приймання грошей, наступний клієнт і закриття зміни тимчасово заблоковані.</div>'
                : isStale
                    ? '<div class="cashier-alert cashier-alert-warning" data-queue-state="stale" role="alert">Дані про незавершені чеки застаріли. Приймання грошей заблоковано до успішного оновлення.</div>'
                    : '<div class="cashier-alert cashier-alert-danger" data-queue-state="queue_unavailable" role="alert">Черга незавершених чеків недоступна. Не приймайте гроші й не починайте наступного клієнта до успішного оновлення.</div>';
            body.innerHTML = `
                ${alertMarkup}
                ${lastKnownRegisterCount ? `<div class="cashier-report-grid" aria-label="Останній відомий підсумок незавершених чеків"><div><dt>Мої чеки</dt><dd>${lastKnownMyCount}</dd></div><div><dt>Вся каса</dt><dd>${lastKnownRegisterCount}</dd></div></div>` : ''}
                ${lastKnown.length ? '<p class="cashier-muted">Останній відомий список збережено нижче, але під час перевірки він може змінитися.</p>' : '<p class="cashier-empty">Останнього відомого списку немає. Це не означає, що незавершених чеків немає.</p>'}
                ${lastKnown.length ? `<div class="cashier-unresolved-list">${lastKnown.map(order => renderUnresolvedOrderButton(order)).join('')}</div>` : ''}
            `;
            renderPendingOrdersNotice();
            syncCreateAvailability();
            syncConfirmationAvailability();
            renderPhase1ShiftState();
            syncUnresolvedControls();
            syncFlowOverview();
            return;
        }
        if (!orders.length) {
            body.innerHTML = '<p class="cashier-empty" data-queue-state="empty">Незавершених чеків для цієї каси немає.</p>';
            renderPendingOrdersNotice();
            renderPhase1ShiftState();
            syncUnresolvedControls();
            syncFlowOverview();
            return;
        }
        const myCount = Number(state.unresolvedMyCount || 0);
        const registerCount = Number(state.unresolvedRegisterCount || orders.length);
        body.innerHTML = `
            <div class="cashier-report-grid" data-queue-state="available" aria-label="Підсумок незавершених чеків">
                <div><dt>Мої чеки</dt><dd>${myCount}</dd></div>
                <div><dt>Вся каса</dt><dd>${registerCount}</dd></div>
                <div><dt>Показано</dt><dd>${orders.length}/${registerCount}</dd></div>
            </div>
            <div class="cashier-unresolved-list">
                ${orders.map(order => renderUnresolvedOrderButton(order)).join('')}
            </div>`;
        renderPendingOrdersNotice();
        renderPhase1ShiftState();
        syncUnresolvedControls();
        syncFlowOverview();
    }

    function unresolvedOrderAccessibleLabel(order = {}) {
        const ownership = formatUnresolvedOwnership(order);
        const retry = order.nextRunAt
            ? `наступна спроба ${formatKyivDateTime(order.nextRunAt)}`
            : 'час наступної спроби не визначено';
        const incident = formatIncidentReason(order.incidentReason);
        return [
            `Відкрити RCP-${order.id}`,
            ownership,
            `сума ${formatMoneyMinor(order.totalAmountMinor)}`,
            `оплата ${formatStatus(order.paymentStatus)}`,
            `фіскалізація ${formatStatus(order.fiscalStatus)}`,
            retry,
            incident ? `причина: ${incident}` : 'без зафіксованої причини інциденту'
        ].join('. ');
    }

    async function loadUnresolvedOrders({ silent = false, append = false } = {}) {
        if (state.unresolvedInFlight) return state.unresolvedOrders;
        clearUnresolvedRefreshTimer();
        const keepVisibleSnapshot = silent
            && !append
            && state.unresolvedQueueState === 'available'
            && unresolvedQueueIsFresh();
        state.unresolvedInFlight = true;
        if (!keepVisibleSnapshot) state.unresolvedQueueState = 'checking';
        state.unresolvedLastError = null;
        if (keepVisibleSnapshot) {
            syncUnresolvedControls();
        } else {
            renderUnresolvedOrders();
            renderReadinessState();
        }
        let retryDelayMs = null;
        let restartAfterSnapshotChange = false;
        try {
            const params = new URLSearchParams({ crmProfileKey: PILOT_SCOPE.crmProfileKey, locationAlias: PILOT_SCOPE.locationAlias, registerAlias: PILOT_SCOPE.registerAlias });
            const requestedPage = append ? Math.max(1, Number(state.unresolvedPage || 0) + 1) : 1;
            params.set('page', String(requestedPage));
            params.set('pageSize', String(UNRESOLVED_PAGE_SIZE));
            const requestedCursor = append ? state.unresolvedNextCursor : null;
            const requestedSnapshotRevision = append ? state.unresolvedSnapshotRevision : null;
            if (append) {
                if (!requestedCursor || !requestedSnapshotRevision) throw invalidUnresolvedQueuePayload();
                params.set('cursor', String(requestedCursor));
                params.set('snapshotRevision', String(requestedSnapshotRevision));
            }
            const response = await apiRequest(`/api/payments/unresolved-orders?${params.toString()}`, {
                method: 'GET',
                headers: apiHeaders(),
                timeoutMs: READINESS_REQUEST_TIMEOUT_MS
            });
            const result = normalizeUnresolvedQueuePayload(response, {
                requestedPage,
                requestedPageSize: UNRESOLVED_PAGE_SIZE,
                requestedCursor,
                requestedSnapshotRevision,
                append
            });
            const incoming = Array.isArray(result.orders) ? result.orders : [];
            if (append) {
                const expectedLoadedCount = (requestedPage - 1) * UNRESOLVED_PAGE_SIZE;
                const loadedIds = new Set(state.unresolvedOrders.map(order => String(order.id)));
                if (state.unresolvedOrders.length !== expectedLoadedCount
                    || incoming.some(order => loadedIds.has(String(order.id)))) {
                    throw invalidUnresolvedQueuePayload();
                }
            }
            const merged = append ? [...state.unresolvedOrders, ...incoming] : incoming;
            if (merged.length > result.registerCount
                || (result.hasMore && merged.length >= result.registerCount)
                || (!result.hasMore && merged.length !== result.registerCount)) {
                throw invalidUnresolvedQueuePayload();
            }
            state.unresolvedOrders = merged;
            state.unresolvedPage = Math.max(1, Number(result.page || requestedPage));
            state.unresolvedPageSize = Math.max(1, Number(result.pageSize || UNRESOLVED_PAGE_SIZE));
            state.unresolvedRegisterCount = Math.max(0, Number(result.registerCount ?? result.totalCount ?? state.unresolvedOrders.length));
            state.unresolvedMyCount = Math.max(0, Number(result.myCount ?? state.unresolvedOrders.filter(order => order.isMine === true).length));
            state.unresolvedHasMore = typeof result.hasMore === 'boolean'
                ? result.hasMore
                : state.unresolvedOrders.length < state.unresolvedRegisterCount;
            state.unresolvedSnapshotRevision = result.snapshotRevision;
            state.unresolvedNextCursor = result.nextCursor;
            state.unresolvedLastKnownOrders = state.unresolvedOrders.slice();
            state.unresolvedLastKnownSummary = {
                registerCount: state.unresolvedRegisterCount,
                myCount: state.unresolvedMyCount
            };
            state.unresolvedQueueState = 'available';
            state.unresolvedLastRefreshAt = Date.now();
            state.unresolvedLastError = null;
            state.unresolvedRefreshBackoffMs = UNRESOLVED_REFRESH_MIN_MS;
            if (!state.unresolvedHasMore) {
                replacePendingOrderIds(state.unresolvedOrders.map(order => order.id));
            }
            renderUnresolvedOrders();
            renderReadinessState();
            syncCreateAvailability();
            syncConfirmationAvailability();
            if (!silent) notify('Чергу незавершених чеків оновлено.', 'success');
            return state.unresolvedOrders;
        } catch (error) {
            state.unresolvedQueueState = 'unavailable';
            state.unresolvedLastError = { code: error?.code || error?.name || 'queue_unavailable', message: error?.message || 'queue_unavailable' };
            restartAfterSnapshotChange = append && error?.code === 'unresolved_snapshot_changed';
            state.unresolvedSnapshotRestartPending = restartAfterSnapshotChange;
            retryDelayMs = restartAfterSnapshotChange ? null : state.unresolvedRefreshBackoffMs;
            state.unresolvedRefreshBackoffMs = Math.min(
                UNRESOLVED_REFRESH_MAX_MS,
                Math.max(UNRESOLVED_REFRESH_MIN_MS, state.unresolvedRefreshBackoffMs * 2)
            );
            if (!silent) notify(paymentUiError(error), 'error');
            renderUnresolvedOrders();
            renderReadinessState();
            return state.unresolvedOrders;
        } finally {
            state.unresolvedInFlight = false;
            syncUnresolvedControls();
            if (restartAfterSnapshotChange && state.unresolvedSnapshotRestartPending) {
                state.unresolvedSnapshotRestartPending = false;
                window.setTimeout(() => { void loadUnresolvedOrders({ silent: true }); }, 0);
            } else {
                scheduleUnresolvedRefresh({ delayMs: retryDelayMs });
            }
        }
    }

    function renderReceiptHistoryActions(order = {}) {
        const taxUrlTrusted = isTrustedCheckboxUrl(order.providerTaxUrl);
        const links = [
            { href: taxUrlTrusted ? order.providerTaxUrl : null, label: 'Чек' },
            { href: order.providerPdfUrl, label: 'PDF' },
            { href: order.providerQrUrl, label: 'QR' }
        ].filter(link => isTrustedCheckboxUrl(link.href));
        if (!links.length) return '<span class="cashier-history-empty-artifact">офіційний артефакт ще недоступний</span>';
        return `<span class="cashier-history-actions">${links.map(link => `<a class="btn-page-secondary cashier-history-link" target="_blank" rel="noopener" href="${escapeAttribute(link.href)}">${escapeHtml(link.label)}</a>`).join('')}</span>`;
    }

    function renderReceiptHistoryRow(order = {}) {
        return `
            <div class="cashier-history-item">
                <span class="cashier-receipt-id"><strong>RCP-${escapeHtml(order.id)}</strong><small>${escapeHtml(order.confirmedAt ? formatKyivDateTime(order.confirmedAt) : 'час не підтверджено')}</small></span>
                <span>${escapeHtml(formatPaymentMethod(order.paymentMethod))}</span>
                <span class="cashier-receipt-money">${escapeHtml(formatMoneyMinor(order.totalAmountMinor))}</span>
                <span class="cashier-status ${escapeAttribute(classifyStatus(order.fiscalStatus))}">${escapeHtml(formatStatus(order.fiscalStatus))}</span>
                <span class="cashier-recovery-text">${escapeHtml(formatRecoveryText(order))}</span>
                ${renderReceiptHistoryActions(order)}
            </div>
        `;
    }

    function renderCheckboxSalesReport(report) {
        const body = $('checkboxSalesReportBody');
        if (!body) return;
        if (!report) {
            body.textContent = 'Історію чеків ще не завантажено.';
            return;
        }
        const totals = report.totals || {};
        const counts = totals.statusCounts || {};
        const orders = Array.isArray(report.orders) ? report.orders : [];
        const totalCount = Number(report.totalCount || orders.length || 0);
        const page = Number(report.page || 1);
        const pageSize = Number(report.pageSize || orders.length || 50);
        const fiscalizedIds = new Set(
            orders
                .filter(order => FISCAL_DONE_STATUSES.has(normalizeStatus(order.fiscalStatus)))
                .map(order => String(order.id))
        );
        if (fiscalizedIds.size) {
            replacePendingOrderIds(pendingOrderIds().filter(id => !fiscalizedIds.has(String(id))));
        }
        state.receiptHistoryLoaded = true;
        state.lastReportRefreshAt = Date.now();
        const badge = $('checkboxSalesReportSummaryBadge');
        if (badge) badge.textContent = totalCount ? `${totalCount} чеків · лише перегляд` : 'чеків немає · лише перегляд';
        body.innerHTML = `
            <dl class="cashier-report-grid">
                <div><dt>Оплати всього</dt><dd>${escapeHtml(formatMoneyMinor(totals.paymentTotalMinor || 0))}</dd></div>
                <div><dt>Готівка</dt><dd>${escapeHtml(formatMoneyMinor(totals.cashTotalMinor || 0))}</dd></div>
                <div><dt>Термінал</dt><dd>${escapeHtml(formatMoneyMinor(totals.cardTerminalTotalMinor || 0))}</dd></div>
                <div><dt>Фіскалізовано</dt><dd>${Number(counts.fiscalized || 0)}</dd></div>
                <div><dt>Очікують/невідомі</dt><dd>${Number(counts.pending || 0) + Number(counts.unknown || 0) + Number(counts.failed_retryable || 0)}</dd></div>
                <div><dt>Зупинені/термінальні</dt><dd>${Number(counts.dead || 0) + Number(counts.failed_terminal || 0)}</dd></div>
                <div><dt>Сторінка</dt><dd>${page} · ${orders.length}/${totalCount}</dd></div>
            </dl>
            <p class="cashier-muted">Суми пораховані по всьому фільтру, не лише по ${pageSize} рядках поточної сторінки. Це внутрішній звіт, не Z-звіт.</p>
            <div class="cashier-history-list" aria-label="Історія чеків цієї каси">
                ${orders.map(order => renderReceiptHistoryRow(order)).join('') || '<p class="cashier-empty">Оплачених продажів за цим фільтром ще немає.</p>'}
            </div>`;
        renderPendingOrdersNotice();
    }

    async function loadCheckboxSalesReport({ silent = false } = {}) {
        if (state.reportInFlight) return;
        state.reportInFlight = true;
        const button = $('loadCheckboxSalesReportBtn');
        const body = $('checkboxSalesReportBody');
        setButtonBusy(button, true, 'Формуємо звіт…');
        if (body) {
            body.setAttribute('aria-busy', 'true');
            if (!silent || !state.receiptHistoryLoaded) body.textContent = 'Формуємо звіт…';
        }
        try {
            const params = new URLSearchParams({ crmProfileKey: PILOT_SCOPE.crmProfileKey, locationAlias: PILOT_SCOPE.locationAlias, registerAlias: PILOT_SCOPE.registerAlias });
            const dateFrom = $('checkboxReportDateFrom')?.value || '';
            const dateTo = $('checkboxReportDateTo')?.value || '';
            const shiftId = $('checkboxReportShiftId')?.value || '';
            const cashierUserId = $('checkboxReportCashierUserId')?.value || '';
            const page = $('checkboxReportPage')?.value || '1';
            if (dateFrom) params.set('dateFrom', dateFrom);
            if (dateTo) params.set('dateTo', dateTo);
            if (shiftId) params.set('shiftId', shiftId);
            if (cashierUserId) params.set('cashierUserId', cashierUserId);
            if (page) params.set('page', page);
            params.set('pageSize', '50');
            const result = await apiRequest(`/api/payments/checkbox-sales-report?${params.toString()}`, {
                method: 'GET',
                headers: apiHeaders()
            });
            renderCheckboxSalesReport(result);
            if (!silent) notify('Історію чеків завантажено.', 'success');
        } catch (error) {
            if (body) body.textContent = 'Не вдалося завантажити історію чеків. Спробуйте ще раз.';
            if (!silent) notify(paymentUiError(error), 'error');
        } finally {
            state.reportInFlight = false;
            setButtonBusy(button, false, '');
            if (button) button.disabled = false;
            if (body) body.setAttribute('aria-busy', 'false');
        }
    }

    function isTrustedCheckboxUrl(href) {
        if (!href) return false;
        try {
            const parsed = new URL(String(href), window.location.origin);
            const host = parsed.hostname.toLowerCase();
            return parsed.protocol === 'https:'
                && (host === 'api.checkbox.ua'
                    || host === 'api.checkbox.in.ua');
        } catch {
            return false;
        }
    }

    function setReceiptLink(id, href) {
        const el = $(id);
        if (!el) return;
        const visible = isTrustedCheckboxUrl(href);
        el.classList.toggle('hidden', !visible);
        if (visible) el.href = href;
        else el.removeAttribute('href');
    }

    function refreshReceiptHistoryIfVisible() {
        const panel = $('checkboxSalesReportPanel');
        if (!panel?.open && !state.receiptHistoryLoaded) return;
        void loadCheckboxSalesReport({ silent: true });
    }

    function renderRegisterState(result) {
        if (!result) {
            setText('cashierFiscalProfile', state.orderDetails?.order ? $('cashierFiscalProfile')?.textContent : '—');
            setText('cashierRegister', state.orderDetails?.order ? $('cashierRegister')?.textContent : '—');
            renderReadinessState();
            syncCreateAvailability();
            syncConfirmationAvailability();
            renderPhase1ShiftState();
            return;
        }
        if (!state.orderDetails?.order) {
            setText('cashierFiscalProfile', `${formatCrmProfile(result.crmProfileKey)} / ${result.legalEntityName || result.legalEntityKey || 'ФОП не налаштовано'}`);
            setText('cashierRegister', formatLocationRegister(
                result.locationAlias,
                result.registerAlias,
                result.registerDisplayName,
                result.locationDisplayName
            ));
        }
        renderReadinessState();
        syncCreateAvailability();
        syncConfirmationAvailability();
        renderPhase1ShiftState();
    }

    function escapeAttribute(value) {
        return escapeHtml(value).replace(/`/g, '&#96;');
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
    }

    function orderBlocksPayment(order = state.orderDetails?.order) {
        if (!order) return true;
        const paymentStatus = normalizeStatus(order.paymentStatus);
        const fiscalStatus = effectiveFiscalStatus(order);
        if (normalizeStatus(order.status) === 'cancelled' || fiscalStatus === 'not_required') return true;
        if (paymentStatus === 'confirmed' || normalizeStatus(order.status) === 'payment_recorded') return true;
        return FISCAL_BLOCKING_STATUSES.has(fiscalStatus) && paymentStatus !== 'unpaid';
    }

    function orderIsComplete(order = state.orderDetails?.order) {
        if (!order) return false;
        return FISCAL_DONE_STATUSES.has(effectiveFiscalStatus(order))
            || normalizeStatus(order.status) === 'cancelled'
            || effectiveFiscalStatus(order) === 'not_required';
    }

    function integrationReady() {
        return Boolean(
            state.registerState?.integrationReady === true
            && state.readinessInFlight !== true
            && state.nextCustomerSafetyRefreshInFlight !== true
            && unresolvedQueueIsFresh()
        );
    }

    function queueUnavailableReason() {
        const queueState = effectiveUnresolvedQueueState();
        if (queueState === 'available') return '';
        if (queueState === 'checking') return 'Перевіряємо повний список незавершених чеків. Дочекайтеся завершення перевірки.';
        if (queueState === 'stale') return 'Дані про незавершені чеки застаріли. Дочекайтеся успішного оновлення.';
        if (queueState === 'unavailable') return 'Черга незавершених чеків недоступна. Оновіть список перед прийманням грошей.';
        return 'Черга незавершених чеків ще не перевірена.';
    }

    function activeUnfinishedOrder() {
        const order = state.orderDetails?.order;
        return Boolean(order?.id && normalizeStatus(order.paymentStatus) === 'unpaid' && normalizeStatus(order.status) === 'draft');
    }

    function orderAllowsNextCustomer(order = state.orderDetails?.order) {
        if (!order?.id) return false;
        if (orderIsComplete(order)) return true;
        return normalizeStatus(order.paymentStatus) === 'confirmed';
    }

    function setPaymentStepState(stepNumber, stepState) {
        const step = document.querySelector(`[data-payment-step="${stepNumber}"]`);
        if (!step) return;
        step.classList.remove('is-active', 'is-complete', 'is-inactive');
        step.classList.add(`is-${stepState}`);
        if (stepState === 'active') step.setAttribute('aria-current', 'step');
        else step.removeAttribute('aria-current');
        if (stepState === 'inactive') step.setAttribute('aria-disabled', 'true');
        else step.removeAttribute('aria-disabled');
    }

    function syncPaymentStepState() {
        const order = state.orderDetails?.order;
        const hasOrder = Boolean(order?.id);
        const paymentConfirmed = hasOrder && (
            normalizeStatus(order.paymentStatus) === 'confirmed'
            || normalizeStatus(order.status) === 'payment_recorded'
        );
        const cancelled = hasOrder && normalizeStatus(order.status) === 'cancelled';

        setPaymentStepState(1, !hasOrder || cancelled ? 'active' : 'complete');
        setPaymentStepState(2, !hasOrder || cancelled ? 'inactive' : (paymentConfirmed ? 'complete' : 'active'));
        setPaymentStepState(3, paymentConfirmed ? 'active' : 'inactive');
    }

    function renderReadinessState() {
        const panel = $('cashierReadinessStatus');
        if (!panel) return;
        const summary = $('cashierReadinessSummary');
        const details = $('cashierReadinessDetails');
        const technicalList = $('cashierReadinessTechnicalList');
        const canViewTechnicalDetails = hasAction('fiscal.configure');
        const messages = [];
        if (!state.registerState) {
            messages.push('Не вдалося прочитати стан пілотної каси.');
        } else {
            const code = state.registerState.readinessCode || 'unknown';
            const labels = {
                mapping_missing: 'Немає налаштування відповідності для парку та середньої каси.',
                mapping_ambiguous: 'Налаштування парку та середньої каси неоднозначне.',
                binding_missing: 'Користувач не прив’язаний до цієї каси.',
                fiscal_context_incomplete: 'Бракує реквізитів ФОП, каси, касира або посилань на локальні доступи.',
                register_disabled: 'Середню касу вимкнено в налаштуваннях інтеграції.',
                global_integration_disabled: 'Інтеграція Checkbox вимкнена через CHECKBOX_INTEGRATION_ENABLED=false.',
                payment_acceptance_disabled: 'Приймання нових оплат вимкнене через CHECKBOX_ACCEPT_PAYMENTS_ENABLED=false.',
                credentials_missing: 'Локальні доступи до Checkbox не налаштовані.',
                runtime_config_missing: 'Налаштування підключення Checkbox відсутні.',
                runtime_config_invalid: 'Налаштування підключення Checkbox некоректні.',
                provider_unavailable: 'Сервіс Checkbox тимчасово недоступний.',
                paid_sale_closed_shift_reconciliation_required: 'Є оплачена операція, яку не було відправлено до закриття зміни. Потрібна ручна звірка; нові оплати заблоковано.',
                identity_mismatch: 'Checkbox повернув іншу організацію, касира або касу.',
                checkbox_cashier_test_mode_mismatch: 'Касир Checkbox не підтверджений як тестовий.',
                checkbox_expected_is_test_mismatch: 'Очікуваний режим каси не збігається між збереженим налаштуванням, локальними доступами та Checkbox.',
                shift_opening: 'Зміна відкривається у Checkbox.',
                shift_closing: 'Зміна закривається у Checkbox.',
                readiness_stale: 'Готовність застаріла, потрібна свіжа перевірка.',
                readiness_missing: 'Готовність ще не перевірена.',
                tax_mapping_missing: 'Фіскальні назви/податки для квитків не налаштовані.',
                ready: '',
                unknown: 'Стан готовності каси невідомий.'
            };
            if (labels[code]) messages.push(labels[code]);
            if (state.registerState.shift && normalizeStatus(state.registerState.shift.status) === 'opening') {
                messages.push('Зміна відкривається у Checkbox; приймання грошей стане доступним після підтвердження готовності.');
            }
            if (state.registerState.mappingExists === false) messages.push('Не знайдено однозначної відповідності між профілем, локацією та касою.');
            if (state.registerState.featureEnabled === false && state.registerState.registerFeatureEnabled === false) messages.push('Інтеграцію для середньої каси вимкнено.');
            if (state.registerState.checkboxIntegrationEnabled === false) messages.push('Глобальна інтеграція Checkbox вимкнена.');
            if (state.registerState.runtimeConfigResolvable === false) messages.push('Посилання на локальні доступи Checkbox не вдалося знайти в середовищі сервера.');
        }
        const queueReason = queueUnavailableReason();
        if (queueReason) messages.push(queueReason);
        const ready = integrationReady() && messages.length === 0;
        const viewOnly = state.registerState?.checkboxIntegrationEnabled === false
            || state.registerState?.paymentAcceptanceEnabled === false
            || state.registerState?.readinessCode === 'global_integration_disabled'
            || state.registerState?.readinessCode === 'payment_acceptance_disabled';
        const summaryText = state.readinessInFlight
            ? 'Оновлюємо готовність Checkbox…'
            : (ready
                ? 'Каса готова — можна приймати оплату.'
                : (viewOnly
                    ? 'Оплати поки вимкнені — сторінка працює лише для перегляду.'
                    : 'Каса ще не готова — приймання оплат заблоковано.'));
        if (summary) summary.textContent = summaryText;
        if (technicalList) {
            technicalList.innerHTML = canViewTechnicalDetails && messages.length
                ? [...new Set(messages)].map(message => `<li>${escapeHtml(message)}</li>`).join('')
                : (canViewTechnicalDetails ? '<li>Усі перевірки готовності пройдено.</li>' : '');
        }
        if (details) {
            details.hidden = !canViewTechnicalDetails;
            if (!canViewTechnicalDetails) details.open = false;
        }
        panel.classList.remove('hidden');
        panel.classList.toggle('is-ready', ready);
        panel.classList.toggle('is-blocked', !ready);
        panel.classList.toggle('cashier-alert-warning', !ready);
        panel.setAttribute('aria-busy', state.readinessInFlight ? 'true' : 'false');
        syncFlowOverview();
    }

    function setDisabledReason(el, disabled, reason) {
        if (!el) return;
        el.disabled = Boolean(disabled);
        el.setAttribute('aria-disabled', disabled ? 'true' : 'false');
        if (disabled && reason) el.title = reason;
        else el.removeAttribute('title');
    }

    function syncCreateAvailability() {
        syncPaymentStepState();
        const ready = integrationReady();
        const active = activeUnfinishedOrder();
        const order = state.orderDetails?.order;
        const nextAllowed = orderAllowsNextCustomer(order);
        const hasCurrentOrder = Boolean(order?.id);
        const disabled = !ready || active || state.createInFlight || (hasCurrentOrder && !orderIsComplete(order));
        const reason = state.createInFlight
            ? 'Створюємо оплату…'
            : (!ready
                ? (queueUnavailableReason() || 'Каса не готова: перегляньте повідомлення про готовність вище.')
                : (active ? 'Спершу підтвердьте або скасуйте поточну чернетку.' : (hasCurrentOrder ? 'Натисніть “Нова оплата” для наступного клієнта.' : '')));
        const createButton = $('createPaymentOrderBtn');
        const form = $('paymentOrderForm');
        if (form) {
            form.querySelectorAll('input, select').forEach(el => { el.disabled = disabled; });
            form.setAttribute('aria-busy', state.createInFlight ? 'true' : 'false');
        }
        setText('createPaymentDisabledReason', reason || 'Каса готова. Ціна, ФОП, профіль і каса визначаються сервером.');
        setButtonBusy(createButton, state.createInFlight, 'Створюємо оплату…');
        setDisabledReason(createButton, disabled, reason);
        const nextButton = $('startNextOrderBtn');
        if (nextButton) {
            nextButton.classList.toggle('hidden', !nextAllowed);
            setDisabledReason(nextButton, nextAllowed && !unresolvedQueueIsFresh(), queueUnavailableReason());
            nextButton.textContent = normalizeStatus(order?.paymentStatus) === 'confirmed' && !orderIsComplete(order)
                ? 'Наступний клієнт'
                : 'Нова оплата';
        }
        const cancelBtn = $('cancelDraftOrderBtn');
        const canCancel = Boolean(order?.id && normalizeStatus(order.paymentStatus) === 'unpaid' && normalizeStatus(order.status) === 'draft');
        if (cancelBtn) {
            cancelBtn.classList.toggle('hidden', !canCancel);
            setDisabledReason(cancelBtn, !canCancel, canCancel ? '' : 'Скасувати можна тільки неоплачену чернетку.');
        }
    }

    function hasAction(action) {
        return typeof canAccess === 'function' ? canAccess(action) : false;
    }

    function phase1CloseContext() {
        const raw = state.registerState?.phase1Close;
        if (!raw || typeof raw !== 'object') return null;
        const shiftId = raw.shiftId ?? raw.fiscalShiftId ?? state.registerState?.shift?.id ?? null;
        const status = normalizeStatus(raw.providerStatus || raw.shiftStatus || raw.status);
        return {
            visible: raw.visible === true,
            allowed: raw.allowed === true,
            shiftId: shiftId == null || shiftId === '' ? null : String(shiftId),
            status,
            reasonCode: String(raw.reasonCode || raw.code || '').trim().toLowerCase()
        };
    }

    function phase1CloseUnavailableReason(context = phase1CloseContext()) {
        if (!context) return 'Закриття зміни не надане сервером для цього користувача або каси.';
        if (!hasAction('fiscal.shift.close')) return 'Немає дозволу на закриття зміни Checkbox.';
        const queueReason = queueUnavailableReason();
        if (queueReason) return queueReason;
        const unresolvedCount = Number(state.unresolvedRegisterCount || 0);
        if (unresolvedCount > 0) return `Закриття заблоковане: незавершених чеків на касі — ${unresolvedCount}.`;
        if (!context.shiftId) return 'Сервер не підтвердив точну зміну для закриття.';
        if (context.status !== 'opened') {
            const statusMessages = {
                created: 'Зміна ще створюється у Checkbox.',
                opening: 'Зміна ще відкривається у Checkbox.',
                closing: 'Зміна вже закривається у Checkbox.',
                closed: 'Зміну Checkbox закрито.',
                unknown: 'Статус зміни Checkbox не підтверджено.'
            };
            return statusMessages[context.status] || `Закриття недоступне: статус зміни — ${formatStatus(context.status)}.`;
        }
        if (context.allowed !== true) {
            const reasonMessages = {
                unresolved_orders: 'Закриття заблоковане, доки є незавершені чеки.',
                unresolved_operations: 'Закриття заблоковане, доки є незавершені чеки.',
                queue_unavailable: 'Не вдалося перевірити незавершені чеки каси.',
                provider_unavailable: 'Checkbox тимчасово недоступний для безпечного закриття зміни.',
                identity_mismatch: 'Checkbox повернув іншу касу, організацію або касира.',
                checkbox_cashier_identity_mismatch: 'Checkbox повернув іншого касира.',
                checkbox_organization_identity_mismatch: 'Checkbox повернув іншу організацію.',
                checkbox_register_identity_mismatch: 'Checkbox повернув іншу касу.',
                checkbox_signature_unavailable: 'Підпис Checkbox недоступний.',
                checkbox_certificate_unavailable: 'Сертифікат Checkbox недоступний.',
                readiness_stale: 'Готовність Checkbox застаріла. Оновіть її перед закриттям зміни.',
                readiness_missing: 'Готовність Checkbox ще не підтверджена.',
                phase1_close_requires_payment_drain: 'Закриття недоступне: спочатку зупиніть нові оплати, дочекайтеся завершення чеків і оновіть стан зміни.',
                global_integration_disabled: 'Інтеграція Checkbox вимкнена.',
                register_disabled: 'Цю касу вимкнено в налаштуваннях інтеграції.',
                credentials_missing: 'Доступи Checkbox не налаштовані на сервері.',
                integration_owner_missing: 'Для каси не призначено відповідального за інтеграцію.',
                integration_owner_only: 'Закрити зміну може лише відповідальний за інтеграцію.',
                capability_denied: 'Немає системного дозволу на закриття зміни.',
                binding_capability_denied: 'Прив’язка користувача до каси не дозволяє закриття зміни.',
                no_open_shift: 'Відкритої зміни Checkbox немає.',
                shift_not_provider_open: 'Checkbox не підтвердив, що зміну відкрито.',
                provider_shift_not_open: 'Checkbox не підтвердив, що зміну відкрито.',
                provider_not_ready: 'Checkbox не готовий до безпечного закриття зміни.'
            };
            return reasonMessages[context.reasonCode] || 'Сервер не дозволив закриття цієї зміни.';
        }
        return '';
    }

    function renderPhase1ShiftState() {
        const panel = $('phase1ShiftPanel');
        const button = $('phase1CloseShiftBtn');
        const notice = $('phase1ShiftCloseNotice');
        const context = phase1CloseContext();
        const visible = Boolean(context?.visible);
        if (panel) {
            panel.classList.toggle('hidden', !visible);
            panel.setAttribute('aria-hidden', visible ? 'false' : 'true');
        }
        if (!visible) {
            setDisabledReason(button, true, 'Закриття зміни недоступне для цього користувача або каси.');
            if (notice) notice.textContent = 'Закриття зміни недоступне.';
            return;
        }
        setStatus('phase1ShiftStatus', context.status);
        const reason = phase1CloseUnavailableReason(context);
        const disabled = Boolean(reason) || state.phase1CloseConfirmationInFlight || state.phase1CloseInFlight;
        const busyReason = state.phase1CloseConfirmationInFlight
            ? 'Очікуємо вашого фінального підтвердження.'
            : state.phase1CloseInFlight
            ? 'Запит на закриття прийнято. Очікуємо підтвердження Checkbox.'
            : reason;
        setDisabledReason(button, disabled, busyReason);
        if (notice) {
            notice.textContent = busyReason || 'Зміну відкрито, незавершених чеків немає. Можна безпечно надіслати запит на закриття.';
        }
        if (context.status === 'closing'
            && context.shiftId
            && !state.phase1ClosePollingTimer
            && !state.phase1CloseInFlight
            && !state.phase1ClosePollingPaused) {
            startPhase1ClosePolling(context.shiftId);
        }
    }

    function clearPhase1ClosePolling({ preserveTarget = false } = {}) {
        if (state.phase1ClosePollingTimer) window.clearTimeout(state.phase1ClosePollingTimer);
        state.phase1ClosePollingTimer = null;
        state.phase1ClosePollingStartedAt = 0;
        if (!preserveTarget) state.phase1CloseTargetShiftId = null;
    }

    function phase1CloseReachedClosed(context, targetShiftId) {
        return Boolean(
            context
            && context.status === 'closed'
            && context.shiftId
            && String(context.shiftId) === String(targetShiftId)
        );
    }

    async function confirmPhase1ShiftClose() {
        const confirmFn = typeof window.confirmModal === 'function' ? window.confirmModal : null;
        if (!confirmFn) throw new Error('phase1_close_confirmation_unavailable');
        return Boolean(await confirmFn(
            'Закрити поточну зміну в Checkbox? Після закриття нові чеки потребуватимуть відкриття нової зміни.',
            { type: 'warning', okText: 'Закрити зміну', cancelText: 'Скасувати' }
        ));
    }

    function startPhase1ClosePolling(shiftId) {
        const targetShiftId = String(shiftId || '').trim();
        if (!targetShiftId) return;
        if (state.phase1CloseTargetShiftId !== targetShiftId) {
            clearPhase1ClosePolling();
            state.phase1CloseTargetShiftId = targetShiftId;
            state.phase1ClosePollingStartedAt = Date.now();
            state.phase1ClosePollingPaused = false;
        } else if (!state.phase1ClosePollingStartedAt) {
            state.phase1ClosePollingStartedAt = Date.now();
        }
        if (state.phase1ClosePollingTimer) return;
        state.phase1CloseInFlight = true;
        renderPhase1ShiftState();
        state.phase1ClosePollingTimer = window.setTimeout(async () => {
            state.phase1ClosePollingTimer = null;
            const target = state.phase1CloseTargetShiftId;
            if (!target) return;
            if (Date.now() - state.phase1ClosePollingStartedAt > PHASE1_CLOSE_POLL_TIMEOUT_MS) {
                state.phase1CloseInFlight = false;
                state.phase1ClosePollingPaused = true;
                clearPhase1ClosePolling({ preserveTarget: true });
                renderPhase1ShiftState();
                notify('Закриття зміни ще не підтверджено. Не повторюйте запит: оновіть стан Checkbox вручну.', 'error');
                $('refreshReadinessBtn')?.focus?.({ preventScroll: false });
                return;
            }
            const result = await loadPilotRegisterState({ silent: true });
            const context = phase1CloseContext();
            if (phase1CloseReachedClosed(context, target)) {
                clearOperationIdempotencyKey('phase1-close', target);
                state.phase1CloseInFlight = false;
                state.phase1ClosePollingPaused = false;
                clearPhase1ClosePolling();
                renderPhase1ShiftState();
                notify('Зміну Checkbox закрито.', 'success');
                const status = $('phase1ShiftStatus');
                status?.setAttribute?.('tabindex', '-1');
                status?.focus?.({ preventScroll: false });
                return;
            }
            if (result && context?.shiftId && String(context.shiftId) !== String(target)) {
                state.phase1CloseInFlight = false;
                state.phase1ClosePollingPaused = true;
                clearPhase1ClosePolling({ preserveTarget: true });
                renderPhase1ShiftState();
                notify('Сервер повернув іншу зміну. Закриття зупинено без повторного запиту.', 'error');
                $('refreshReadinessBtn')?.focus?.({ preventScroll: false });
                return;
            }
            startPhase1ClosePolling(target);
        }, PHASE1_CLOSE_POLL_INTERVAL_MS);
    }

    async function closePhase1Shift() {
        if (state.phase1CloseConfirmationInFlight || state.phase1CloseInFlight) return;
        const context = phase1CloseContext();
        let reason = phase1CloseUnavailableReason(context);
        if (reason || !context?.shiftId) {
            notify(reason || 'Закриття зміни недоступне.', 'error');
            const focusTarget = !unresolvedQueueIsFresh() ? $('refreshUnresolvedOrdersBtn') : $('phase1CloseShiftBtn');
            focusTarget?.focus?.({ preventScroll: false });
            return;
        }
        state.phase1CloseConfirmationInFlight = true;
        renderPhase1ShiftState();
        let confirmed = false;
        try {
            confirmed = await confirmPhase1ShiftClose();
        } catch (error) {
            notify(paymentUiError(error), 'error');
        } finally {
            state.phase1CloseConfirmationInFlight = false;
        }
        if (!confirmed) {
            renderPhase1ShiftState();
            if (typeof window.confirmModal === 'function') notify('Закриття зміни скасовано. Запит до Checkbox не надіслано.', 'info');
            $('phase1CloseShiftBtn')?.focus?.({ preventScroll: false });
            return;
        }
        const freshContext = phase1CloseContext();
        reason = phase1CloseUnavailableReason(freshContext);
        if (reason || !freshContext?.shiftId || String(freshContext.shiftId) !== String(context.shiftId)) {
            renderPhase1ShiftState();
            notify(reason || 'Стан зміни змінився під час підтвердження. Оновіть готовність і спробуйте знову.', 'error');
            $('refreshReadinessBtn')?.focus?.({ preventScroll: false });
            return;
        }
        const shiftId = context.shiftId;
        const idempotencyKey = getOperationIdempotencyKey('phase1-close', shiftId);
        state.phase1CloseInFlight = true;
        state.phase1ClosePollingPaused = false;
        renderPhase1ShiftState();
        try {
            const result = await apiRequest(`/api/payments/shifts/${encodeURIComponent(shiftId)}/phase1-close`, {
                method: 'POST',
                headers: apiHeaders(idempotencyKey),
                body: JSON.stringify({})
            });
            const returnedShiftId = result.fiscalShiftId ?? result.shiftId ?? shiftId;
            if (String(returnedShiftId) !== String(shiftId)) throw new Error('phase1_shift_identity_mismatch');
            notify(result.replayed ? 'Запит на закриття зміни вже прийнято. Очікуємо підтвердження.' : 'Закриття зміни надіслано. Очікуємо підтвердження Checkbox.', 'success');
            startPhase1ClosePolling(shiftId);
        } catch (error) {
            state.phase1CloseInFlight = false;
            renderPhase1ShiftState();
            notify(paymentUiError(error), 'error');
            $('phase1CloseShiftBtn')?.focus?.({ preventScroll: false });
        }
    }

    function syncConfirmationAvailability() {
        const order = state.orderDetails?.order || null;
        const hasOrder = Boolean(order?.id);
        const blocked = !integrationReady() || !hasOrder || orderBlocksPayment(order) || state.confirmSubmitted || state.confirmInFlight;
        const reason = state.confirmInFlight
            ? 'Підтверджуємо оплату…'
            : (!integrationReady()
                ? (queueUnavailableReason() || 'Каса не готова до Checkbox операцій.')
                : (!hasOrder ? 'Спершу створіть оплату.' : (orderBlocksPayment(order) ? 'Цю оплату вже не можна підтвердити повторно.' : '')));
        const cashReceived = $('cashReceivedAmount');
        const terminalSuccess = $('terminalSuccessCheckbox');
        const terminalReference = $('terminalReference');
        const cashButton = $('confirmCashBtn');
        const cardButton = $('confirmCardBtn');
        const confirmationStep = document.querySelector('[data-payment-step="2"]');
        setText('confirmDisabledReason', reason);
        confirmationStep?.setAttribute('aria-busy', state.confirmInFlight ? 'true' : 'false');
        if (cashReceived) cashReceived.disabled = blocked || state.tender !== 'cash';
        if (terminalSuccess) terminalSuccess.disabled = blocked || state.tender !== 'card_terminal_manual';
        if (terminalReference) terminalReference.disabled = blocked || state.tender !== 'card_terminal_manual';
        setButtonBusy(cashButton, state.confirmInFlight && state.tender === 'cash', 'Підтверджуємо оплату…');
        setButtonBusy(cardButton, state.confirmInFlight && state.tender === 'card_terminal_manual', 'Підтверджуємо оплату…');
        setDisabledReason(cashButton, blocked || state.tender !== 'cash', reason);
        setDisabledReason(cardButton, blocked || state.tender !== 'card_terminal_manual' || !$('terminalSuccessCheckbox')?.checked, reason || 'Поставте позначку, що термінал показав успіх.');
        updateCashChange();
    }

    function syncTenderControls() {
        document.querySelectorAll('input[name="paymentTender"]').forEach(input => {
            input.checked = input.value === state.tender;
        });
        $('cashConfirmationPanel')?.classList.toggle('hidden', state.tender !== 'cash');
        $('cardConfirmationPanel')?.classList.toggle('hidden', state.tender !== 'card_terminal_manual');
        syncConfirmationAvailability();
    }

    function updateCashChange() {
        const order = state.orderDetails?.order;
        const output = $('cashChangeAmount');
        if (!output) return;
        try {
            const received = parseUahToMinor($('cashReceivedAmount')?.value || '0');
            const total = BigInt(String(order?.totalAmountMinor || 0));
            const change = received > total ? received - total : 0n;
            output.textContent = formatMoneyMinor(change.toString());
        } catch {
            output.textContent = '—';
        }
    }

    function confirmBody() {
        const order = state.orderDetails?.order;
        if (!integrationReady()) throw new Error('checkbox_integration_not_ready');
        if (!order?.id) throw new Error('payment_order_missing');
        if (orderBlocksPayment(order)) throw new Error('payment_repeat_blocked');
        if (state.tender === 'cash') {
            const received = parseUahToMinor($('cashReceivedAmount')?.value || '0');
            const total = BigInt(String(order.totalAmountMinor || 0));
            if (received < total) throw new Error('cash_received_too_low');
            return {
                tender: 'cash',
                confirmedAmountMinor: received.toString(),
                cashReceivedAmountMinor: received.toString(),
                changeAmountMinor: (received - total).toString()
            };
        }
        if (!$('terminalSuccessCheckbox')?.checked) throw new Error('card_terminal_success_required');
        return {
            tender: 'card_terminal_manual',
            confirmedAmountMinor: String(order.totalAmountMinor),
            terminalShowedSuccess: true,
            terminalReference: $('terminalReference')?.value?.trim() || undefined
        };
    }

    async function confirmPayment() {
        if (state.confirmInFlight) return;
        const orderId = state.orderDetails?.order?.id;
        let payload;
        try {
            payload = confirmBody();
        } catch (error) {
            notify(paymentUiError(error), 'error');
            return;
        }
        const idempotencyKey = getConfirmIdempotencyKey(orderId || 'missing');
        state.confirmInFlight = true;
        state.confirmSubmitted = true;
        syncConfirmationAvailability();
        try {
            const result = await apiRequest(`/api/payments/orders/${encodeURIComponent(orderId)}/confirm`, {
                method: 'POST',
                headers: apiHeaders(idempotencyKey),
                body: JSON.stringify(payload)
            });
            if (result.order?.id) storageSet('lastOrderId', result.order.id);
            await loadPaymentOrder(result.order?.id || orderId, { silent: true });
            await loadUnresolvedOrders({ silent: true });
            refreshReceiptHistoryIfVisible();
            notify(result.replayed ? 'Це саме підтвердження безпечно оброблено повторно.' : '\u041e\u043f\u043b\u0430\u0442\u0443 \u043f\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0436\u0435\u043d\u043e. \u0427\u0435\u043a \u043f\u043e\u0441\u0442\u0430\u0432\u043b\u0435\u043d\u043e \u0432 \u043d\u0430\u0434\u0456\u0439\u043d\u0443 \u0447\u0435\u0440\u0433\u0443 \u0444\u0456\u0441\u043a\u0430\u043b\u0456\u0437\u0430\u0446\u0456\u0457.', 'success');
            syncOrderPolling(state.orderDetails?.order);
            focusFiscalResult();
        } catch (error) {
            notify(paymentUiError(error), 'error');
        } finally {
            state.confirmInFlight = false;
            syncConfirmationAvailability();
        }
    }

    async function cancelDraftOrder() {
        const order = state.orderDetails?.order;
        if (!order?.id) return;
        if (!(normalizeStatus(order.paymentStatus) === 'unpaid' && normalizeStatus(order.status) === 'draft')) {
            notify(paymentUiError(new Error('payment_order_cancel_denied')), 'error');
            return;
        }
        const idempotencyKey = getOperationIdempotencyKey('cancel-draft', order.id);
        state.orderLoadGeneration += 1;
        const button = $('cancelDraftOrderBtn');
        setDisabledReason(button, true, 'Скасування виконується.');
        try {
            const result = await apiRequest(`/api/payments/orders/${encodeURIComponent(order.id)}/cancel`, {
                method: 'POST',
                headers: apiHeaders(idempotencyKey)
            });
            clearOperationIdempotencyKey('cancel-draft', order.id);
            if (result.order?.id) {
                state.orderDetails = { ...(state.orderDetails || {}), order: result.order };
                storageRemove('lastOrderId');
                renderOrder(state.orderDetails);
            }
            await loadUnresolvedOrders({ silent: true });
            notify(result.replayed ? 'Скасування чернетки повторено без дублювання.' : 'Чернетку скасовано. Можна починати нову оплату.', 'success');
            $('startNextOrderBtn')?.focus?.({ preventScroll: false });
        } catch (error) {
            notify(paymentUiError(error), 'error');
        } finally {
            syncCreateAvailability();
            syncConfirmationAvailability();
        }
    }

    function startNextOrder() {
        if (!unresolvedQueueIsFresh()) {
            notify(queueUnavailableReason(), 'error');
            $('refreshUnresolvedOrdersBtn')?.focus?.({ preventScroll: false });
            return;
        }
        clearOrderPolling();
        state.orderLoadGeneration += 1;
        clearCreateIdempotencyKey();
        storageRemove('lastOrderId');
        const currentOrderId = state.orderDetails?.order?.id;
        if (currentOrderId) storageRemove(`confirm:${PILOT_SCOPE.crmProfileKey}:${PILOT_SCOPE.locationAlias}:${PILOT_SCOPE.registerAlias}:${currentOrderId}`);
        state.orderDetails = null;
        state.confirmSubmitted = false;
        state.confirmInFlight = false;
        state.nextCustomerSafetyRefreshInFlight = true;
        $('terminalSuccessCheckbox') && ($('terminalSuccessCheckbox').checked = false);
        $('terminalReference') && ($('terminalReference').value = '');
        $('cashReceivedAmount') && ($('cashReceivedAmount').value = '');
        setText('internalReceiptLabel', 'RCP-* \u2014 \u0432\u043d\u0443\u0442\u0440\u0456\u0448\u043d\u044f \u043a\u0432\u0438\u0442\u0430\u043d\u0446\u0456\u044f');
        setStatus('cashierPaymentStatus', 'unpaid');
        setStatus('cashierFiscalStatus', 'pending');
        setText('paymentTotalAmount', formatMoneyMinor(0));
        setText('cardExactAmount', formatMoneyMinor(0));
        setText('cashChangeAmount', formatMoneyMinor(0));
        renderItems([]);
        renderFiscalResult({ order: { fiscalStatus: 'pending' }, receipts: [], artifacts: {} });
        renderRegisterState(state.registerState);
        syncTenderControls();
        syncCreateAvailability();
        // A completed sale can open or close the provider shift after the cached
        // readiness snapshot was taken. Keep the new draft disabled until both
        // register-wide unresolved visibility and a fresh provider observation
        // converge for the next customer.
        void (async () => {
            try {
                await loadUnresolvedOrders({ silent: true });
                await refreshReadiness({ silent: true, force: true });
            } finally {
                state.nextCustomerSafetyRefreshInFlight = false;
                syncCreateAvailability();
                syncConfirmationAvailability();
                $('paymentDate')?.focus({ preventScroll: false });
            }
        })();
    }

    function bindEvents() {
        $('paymentOrderForm')?.addEventListener('submit', createPaymentOrder);
        document.querySelectorAll('input[name="paymentTender"]').forEach(input => {
            input.addEventListener('change', () => {
                if (state.orderDetails?.order) return;
                state.tender = input.value === 'card_terminal_manual' ? 'card_terminal_manual' : 'cash';
                syncTenderControls();
            });
        });
        $('cashReceivedAmount')?.addEventListener('input', updateCashChange);
        $('terminalSuccessCheckbox')?.addEventListener('change', syncConfirmationAvailability);
        $('confirmCashBtn')?.addEventListener('click', confirmPayment);
        $('confirmCardBtn')?.addEventListener('click', confirmPayment);
        $('startNextOrderBtn')?.addEventListener('click', startNextOrder);
        $('cancelDraftOrderBtn')?.addEventListener('click', cancelDraftOrder);
        $('refreshUnresolvedOrdersBtn')?.addEventListener('click', () => { void loadUnresolvedOrders({ silent: false }); });
        $('loadMoreUnresolvedOrdersBtn')?.addEventListener('click', () => { void loadUnresolvedOrders({ silent: false, append: true }); });
        $('loadCheckboxSalesReportBtn')?.addEventListener('click', () => { void loadCheckboxSalesReport({ silent: false }); });
        $('refreshReadinessBtn')?.addEventListener('click', () => { void refreshReadiness({ silent: false }); });
        $('phase1CloseShiftBtn')?.addEventListener('click', () => { void closePhase1Shift(); });
        $('unresolvedOrdersBody')?.addEventListener('click', event => {
            const target = event.target?.closest?.('[data-order-id]');
            const orderId = target?.getAttribute?.('data-order-id');
            if (orderId) void loadPaymentOrder(orderId, { silent: false });
        });
        const today = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/Kyiv',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(new Date());
        if ($('paymentDate') && !$('paymentDate').value) $('paymentDate').value = today;
        if ($('checkboxReportDateFrom') && !$('checkboxReportDateFrom').value) $('checkboxReportDateFrom').value = today;
        if ($('checkboxReportDateTo') && !$('checkboxReportDateTo').value) $('checkboxReportDateTo').value = today;
        ['checkboxReportDateFrom', 'checkboxReportDateTo', 'checkboxReportShiftId', 'checkboxReportCashierUserId'].forEach(id => {
            $(id)?.addEventListener('change', () => {
                if ($('checkboxReportPage')) $('checkboxReportPage').value = '1';
            });
        });
    }

    function setDenied(message) {
        const denied = $('cashierAccessDenied');
        if (denied) {
            denied.textContent = message;
            denied.classList.remove('hidden');
        }
        document.querySelectorAll('input, button').forEach(el => {
            if (el.closest('.header') || el.closest('.sidebar-nav')) return;
            el.disabled = true;
        });
    }

    async function initCashierPaymentsPage() {
        bindEvents();
        syncTenderControls();
        syncCreateAvailability();
        if (typeof initDarkMode === 'function') initDarkMode();
        try {
            const user = await apiVerifyToken();
            if (!user) throw new Error('Invalid token');
            state.user = user;
            if (typeof hydrateActionPermissions === 'function') {
                const permissions = await hydrateActionPermissions(user);
                if (!permissions) {
                    if (typeof showAuthenticatedPageShell === 'function') showAuthenticatedPageShell();
                    if (typeof renderPermissionBootstrapError === 'function') renderPermissionBootstrapError({ containerId: 'main-content', retry: initCashierPaymentsPage });
                    return;
                }
            }
            AppState.currentUser = user;
            setText('currentUser', user.name || user.username || '');
            if (typeof showAuthenticatedPageShell === 'function') showAuthenticatedPageShell();
            if (!canAccessPage('/cashier-payments') || !canAccess('payments.view') || !canAccess('payments.create') || !canAccess('payments.confirm_received')) {
                setDenied('Немає доступу до сторінки оплати або потрібних касових дозволів. Розширений доступ до фінансів для цієї сторінки не потрібен.');
                return;
            }
            await loadPilotRegisterState({ silent: true });
            state.unresolvedAutoRefreshEnabled = true;
            await loadUnresolvedOrders({ silent: true });
            scheduleReadinessRefresh();
            const params = new URLSearchParams(window.location.search);
            const queryOrderId = params.get('orderId');
            const storedOrderId = storageGet('lastOrderId');
            const orderId = queryOrderId || storedOrderId;
            if (orderId) {
                try { await loadPaymentOrder(orderId, { silent: true }); }
                catch (error) {
                    if (!queryOrderId
                        && String(storedOrderId || '') === String(orderId)
                        && (Number(error?.status) === 404 || error?.code === 'payment_order_not_found')) {
                        storageRemove('lastOrderId');
                    }
                    /* A stale local order id must not block opening the page. */
                }
            }
        } catch (error) {
            if (error?.message === 'Invalid token') {
                if (typeof handleTransientAuthSessionBootstrap === 'function'
                    && handleTransientAuthSessionBootstrap({ retry: () => window.location.reload(), containerId: 'main-content' })) {
                    return;
                }
                window.location.href = '/';
                return;
            }
            if (typeof handleStandaloneInitError === 'function') {
                handleStandaloneInitError('cashier-payments', error);
            } else {
                setDenied('Не вдалося ініціалізувати сторінку оплати та чека.');
            }
        }
    }

    window.addEventListener('pagehide', () => {
        state.unresolvedAutoRefreshEnabled = false;
        clearUnresolvedRefreshTimer();
    });
    document.addEventListener('DOMContentLoaded', () => { void initCashierPaymentsPage(); });

    window.CashierPaymentsPage = {
        PILOT_SCOPE,
        state,
        formatMoneyMinor,
        parseUahToMinor,
        getCreateIdempotencyKey,
        getConfirmIdempotencyKey,
        getOperationIdempotencyKey,
        unresolvedQueueIsFresh,
        loadPaymentOrder,
        loadPilotRegisterState,
        closePhase1Shift,
        isTrustedCheckboxUrl,
        unresolvedOrderAccessibleLabel
    };
})();
