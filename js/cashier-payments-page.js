
'use strict';

(function () {
    const BUSINESS_SCOPES = Object.freeze({
        event_genix: Object.freeze({ crmProfileKey: 'event_genix', businessLabel: 'ПАРК', locationLabel: 'ПАРК', registerLabel: 'Середня каса' }),
        dar: Object.freeze({ crmProfileKey: 'dar', businessLabel: 'ДАР', locationLabel: 'ДАР', registerLabel: 'Студія / Каса ДАР' })
    });
    const DiscountCalculator = window.CatalogDiscountCalculator;
    const pageParams = new URLSearchParams(window.location.search);
    const requestedBusinessContext = pageParams.get('businessContext');
    function normalizeCashierBusinessContext(value) {
        const normalized = typeof window.CrmBusinessContext?.normalize === 'function'
            ? window.CrmBusinessContext.normalize(value)
            : String(value || '').trim().toLowerCase();
        return BUSINESS_SCOPES[normalized] ? normalized : 'event_genix';
    }
    function storedCashierBusinessContext(user = null) {
        try {
            const stored = window.localStorage.getItem('pzp_crm_business_context');
            if (!stored) return null;
            const storedUser = String(window.localStorage.getItem('pzp_crm_business_context_user') || '').trim();
            const currentUser = user ? String(user.id || user.username || user.name || '').trim() : '';
            if (currentUser && storedUser && storedUser !== currentUser) return null;
            const normalized = normalizeCashierBusinessContext(stored);
            if (typeof window.CrmBusinessContext?.canAccess === 'function'
                && !window.CrmBusinessContext.canAccess(user || undefined, normalized)) return null;
            return normalized;
        } catch {
            return null;
        }
    }
    function currentCrmBusinessScope(user = null) {
        const scopeUser = user || (typeof AppState !== 'undefined' ? AppState.currentUser : null);
        return typeof window.CrmBusinessContext?.scope === 'function'
            ? window.CrmBusinessContext.scope(scopeUser || undefined)
            : null;
    }
    function currentCrmBusinessContext(user = null) {
        const scope = currentCrmBusinessScope(user);
        if (scope && scope.mode && scope.mode !== 'single') return null;
        const stored = storedCashierBusinessContext(user);
        if (stored) return stored;
        const scopeUser = user || (typeof AppState !== 'undefined' ? AppState.currentUser : null);
        const current = typeof window.CrmBusinessContext?.current === 'function'
            ? window.CrmBusinessContext.current(scopeUser || undefined)
            : null;
        return normalizeCashierBusinessContext(scope?.activeContext || current || requestedBusinessContext);
    }
    const initialBusinessContext = currentCrmBusinessContext() || normalizeCashierBusinessContext(requestedBusinessContext);
    let PILOT_SCOPE = {
        ...BUSINESS_SCOPES[initialBusinessContext],
        routeOptionId: pageParams.get('routeOptionId') || `${initialBusinessContext === 'dar' ? 'dar' : 'park'}_production`,
        mode: 'production'
    };
    const SALE_MODE = PILOT_SCOPE.crmProfileKey === 'dar' || pageParams.get('saleMode') !== 'admission'
        ? 'catalog_sale'
        : 'admission_ticket';
    const INTERNAL_RECEIPT_TEXT = '\u043d\u043e\u043c\u0435\u0440 \u043f\u0440\u043e\u0434\u0430\u0436\u0443 CRM';
    const STORAGE_PREFIX = 'eventgenix:cashier-payments';
    const FISCAL_BLOCKING_STATUSES = new Set(['pending', 'unknown', 'sending', 'validating', 'ready_to_send', 'failed', 'failed_retryable']);
    const FISCAL_DONE_STATUSES = new Set(['fiscalized']);
    const PAYMENT_TERMINAL_STATUSES = new Set(['confirmed']);
    const FISCAL_TERMINAL_STATUSES = new Set(['fiscalized', 'failed_terminal', 'validation_failed', 'blocked', 'cancelled', 'not_required', 'dead']);
    const KNOWN_PRE_PAYMENT_REJECTION_CODES = new Set([
        'cash_amount_invalid',
        'cash_received_too_low',
        'card_terminal_success_required',
        'payment_tender_required',
        'payment_tender_unsupported',
        'checkbox_integration_not_ready',
        'checkbox_integration_disabled',
        'checkbox_payment_acceptance_disabled',
        'payment_acceptance_disabled',
        'global_integration_disabled',
        'readiness_stale',
        'readiness_missing',
        'provider_unavailable',
        'checkbox_provider_unavailable',
        'checkbox_cashier_permissions_missing',
        'checkbox_payment_permission_unreported',
        'checkbox_cashier_permissions_malformed',
        'checkbox_expected_is_test_mismatch',
        'fiscal_binding_capability_denied',
        'tax_mapping_missing',
        'paid_sale_closed_shift_reconciliation_required',
        'cashier_binding_required',
        'cashier_binding_scope_invalid',
        'fiscal_route_option_required',
        'fiscal_route_option_invalid',
        'fiscal_route_mapping_missing',
        'fiscal_route_feature_disabled',
        'fiscal_route_acceptance_disabled',
        'fiscal_route_mode_mismatch',
        'shared_test_register_draining',
        'shared_test_register_owned_by_other_business',
        'shared_test_register_recovery_incomplete'
    ]);
    const POLLING_INTERVAL_MS = 2500;
    const POLLING_FAST_WINDOW_MS = boundedTestTiming('pollFastWindowMs', 60000);
    const POLLING_RECOVERY_INTERVAL_MS = boundedTestTiming('pollRecoveryIntervalMs', 15000);
    const POLLING_TIMEOUT_MS = boundedTestTiming('pollTimeoutMs', 15 * 60 * 1000);
    const READINESS_REFRESH_MIN_MS = 15000;
    const READINESS_REFRESH_MAX_MS = 60000;
    const READINESS_REQUEST_TIMEOUT_MS = 8000;
    const UNRESOLVED_PAGE_SIZE = 50;
    const RECEIPT_HISTORY_PAGE_SIZE = 50;
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
    const UNRESOLVED_REFRESH_LEAD_MS = Math.min(
        5000,
        Math.max(100, Math.floor(UNRESOLVED_QUEUE_TTL_MS / 10))
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
        saleMode: SALE_MODE,
        routeOptions: [],
        routeReady: false,
        routeLoading: true,
        catalogItems: [],
        catalogDiscounts: [],
        catalogReady: SALE_MODE !== 'catalog_sale',
        localQa: null,
        selectableCashiers: [],
        orderDetails: null,
        registerState: null,
        createInFlight: false,
        draftRevision: '',
        confirmInFlight: false,
        confirmSubmitted: false,
        confirmOutcomePending: false,
        paymentErrorActive: false,
        reportInFlight: false,
        reportRequest: null,
        reportLoadGeneration: 0,
        reportPage: 1,
        reportPageSize: RECEIPT_HISTORY_PAGE_SIZE,
        reportTotalCount: 0,
        reportPeriod: 'today',
        reportAppliedSnapshot: null,
        reportRenderedSnapshotKey: null,
        reportLastError: null,
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
        unresolvedFastRefreshStartedAt: 0,
        unresolvedRequest: null,
        unresolvedLoadGeneration: 0,
        unresolvedAutoRefreshEnabled: false,
        unresolvedForceOpenChecking: false,
        readinessInFlight: false,
        readinessLoadGeneration: 0,
        nextCustomerSafetyRefreshInFlight: false,
        readinessTimer: null,
        readinessBackoffMs: READINESS_REFRESH_MIN_MS,
        phase1CloseConfirmationInFlight: false,
        phase1CloseSafetyRefreshInFlight: false,
        phase1CloseInFlight: false,
        phase1ClosePollingTimer: null,
        phase1ClosePollingStartedAt: 0,
        phase1CloseTargetShiftId: null,
        phase1ClosePollingPaused: false,
        serviceOutOperations: [],
        serviceOutLoadInFlight: false,
        serviceOutCreateInFlight: false,
        serviceOutApproveInFlight: false,
        serviceOutCancelInFlight: false,
        serviceOutLastError: null,
        actionPinBindings: [],
        actionPinLoadInFlight: false,
        actionPinSaveInFlight: false,
        tender: 'cash',
        interactionGeneration: 0,
        orderLoadGeneration: 0,
        orderRequest: null,
        pollingTimer: null,
        pollingOrderId: null,
        pollingStartedAt: 0,
        pollingErrorBackoffMs: POLLING_RECOVERY_INTERVAL_MS,
        lastErrorNotificationAt: 0
    };

    function $(id) {
        return typeof document === 'undefined' ? null : document.getElementById(id);
    }

    function pageIsVisible() {
        return document.visibilityState !== 'hidden';
    }

    function interactionContextKey() {
        return [
            state.interactionGeneration,
            PILOT_SCOPE.crmProfileKey,
            PILOT_SCOPE.routeOptionId
        ].join(':');
    }

    function invalidateInteractionRequests() {
        state.interactionGeneration += 1;
        state.orderLoadGeneration += 1;
        state.unresolvedLoadGeneration += 1;
        state.readinessLoadGeneration += 1;
        state.reportLoadGeneration += 1;
        state.orderRequest = null;
        state.unresolvedRequest = null;
        state.reportRequest = null;
        state.unresolvedInFlight = false;
        state.reportInFlight = false;
        state.serviceOutLoadInFlight = false;
        state.actionPinLoadInFlight = false;
        state.serviceOutLastError = null;
        syncUnresolvedControls();
        renderServiceOutPanel();
        renderActionPinPanel();
        renderFiscalReportsPanel();
        const reportButton = $('loadCheckboxSalesReportBtn');
        setButtonBusy(reportButton, false, '');
        if (reportButton) reportButton.disabled = false;
        $('checkboxSalesReportBody')?.setAttribute('aria-busy', 'false');
    }

    function notify(message, type = 'info') {
        const el = $('cashierGlobalStatus');
        if (el && type !== 'error'
            && (state.confirmOutcomePending || state.paymentErrorActive)
            && el.classList.contains('cashier-alert-danger')) {
            return;
        }
        if (el && type !== 'error'
            && state.lastErrorNotificationAt
            && Date.now() - state.lastErrorNotificationAt < 8000
            && el.classList.contains('cashier-alert-danger')) {
            return;
        }
        if (typeof showNotification === 'function') showNotification(message, type);
        if (el) {
            if (type === 'error') state.lastErrorNotificationAt = Date.now();
            el.textContent = message;
            el.setAttribute('tabindex', '-1');
            el.classList.remove('hidden', 'cashier-alert-danger');
            if (type === 'error') el.classList.add('cashier-alert-danger');
            if (type === 'error') el.focus({ preventScroll: true });
        }
    }

    function notifyPaymentError(message) {
        state.paymentErrorActive = true;
        notify(message, 'error');
    }

    function clearCorrectablePaymentError() {
        if (state.confirmOutcomePending || !state.paymentErrorActive) return;
        state.paymentErrorActive = false;
        clearGlobalStatus({ preserveError: false });
    }

    function clearGlobalStatus({ preserveError = true } = {}) {
        const el = $('cashierGlobalStatus');
        if (!el) return;
        if (preserveError && el.classList.contains('cashier-alert-danger')) return;
        el.textContent = '';
        el.classList.add('hidden');
        el.classList.remove('cashier-alert-danger');
        el.removeAttribute('tabindex');
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
            draft: 'чернетка', unpaid: 'не оплачено', not_created: 'ще не створено', pending: 'очікує', unknown: 'невідомо', confirmed: 'оплачено', created: 'створюється', open: 'відкрита', opened: 'відкрита', opening: 'відкривається', closing: 'закривається', closed: 'закрита', blocked: 'заблоковано',
            payment_recorded: 'оплату зафіксовано', fiscalized: 'чек створено', failed: 'помилка з повтором', failed_retryable: 'помилка, буде повтор', failed_terminal: 'помилка без автоповтору', dead: 'потрібна ручна перевірка', cancelled: 'скасовано',
            validation_failed: 'помилка перевірки', ready_to_send: 'готово до відправки', sending: 'відправляється', validating: 'перевіряється', not_open: 'не відкрита', not_required: 'не потрібен',
            mapping_missing: 'налаштування каси відсутнє', credentials_missing: 'доступи не налаштовані', provider_unavailable: 'Checkbox недоступний', identity_mismatch: 'невірна каса Checkbox', shift_opening: 'зміна відкривається', paid_sale_closed_shift_reconciliation_required: 'потрібна ручна звірка оплаченого чека', ready: 'готово', awaiting_receipt: 'Checkbox обробляє чек'
        };
        return labels[status] || 'потребує перевірки';
    }

    function classifyStatus(value) {
        const status = normalizeStatus(value);
        if (['confirmed', 'payment_recorded', 'fiscalized', 'open', 'closed'].includes(status)) return 'is-ok';
        if (['pending', 'unknown', 'ready_to_send', 'sending', 'validating', 'opening', 'closing', 'failed', 'failed_retryable', 'awaiting_receipt'].includes(status)) return 'is-warn';
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

    function isReceiptPendingCode(value) {
        return ['checkbox_receipt_pending', 'provider_receipt_pending', 'receipt_lookup_required_before_retry'].includes(normalizeStatus(value));
    }

    function fiscalStatusForDisplay(order, errorCode = order?.lastErrorCode || order?.incidentReason) {
        const status = effectiveFiscalStatus(order);
        // Presentation only: canonical statuses still govern payment, polling and close guards.
        return isReceiptPendingCode(errorCode) && ['pending', 'unknown', 'failed_retryable'].includes(status)
            ? 'awaiting_receipt' : status;
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
            checkbox_receipt_pending: 'Checkbox ще обробляє чек. Повторна оплата не потрібна.',
            provider_receipt_pending: 'Checkbox ще обробляє чек. Повторна оплата не потрібна.',
            receipt_lookup_required_before_retry: 'Checkbox ще звіряє чек. Повторна оплата не потрібна.',
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

    function selectedCashierLabel() {
        const select = $('paymentCashierBinding');
        const option = select?.selectedOptions?.[0];
        const label = String(option?.textContent || '').trim();
        if (!select || !select.value || !label || /оберіть|завантаження|немає/i.test(label)) return 'не обрано';
        return label;
    }

    function renderCompactContext() {
        const route = selectedRoute();
        const shiftStatus = normalizeStatus(state.registerState?.shift?.status || phase1CloseContext()?.status);
        const shiftLabel = shiftStatus === 'unknown' ? 'не підтверджено' : formatStatus(shiftStatus);
        setText('cashierScopeBusiness', PILOT_SCOPE.businessLabel);
        setText('cashierScopeRegister', route?.registerLabel || PILOT_SCOPE.registerLabel);
        setText('cashierScopeCashier', selectedCashierLabel());
        setText('cashierScopeTender', formatPaymentMethod(state.tender).toLowerCase());
        setText('cashierScopeShift', shiftLabel);
        setText('cashierShiftConsoleStatus', `зміна: ${shiftLabel}`);
        setText('cashierScopeMode', route?.mode === 'test' ? 'ТЕСТОВИЙ' : (state.localQa?.enabled === true ? 'LOCAL QA · MOCK' : 'РОБОЧИЙ'));
    }

    function placeCheckoutActions() {
        const target = state.saleMode === 'catalog_sale' && $('catalogCheckoutActions')
            ? $('catalogCheckoutActions')
            : $('defaultCheckoutActions');
        if (!target) return;
        ['paymentTenderGroup', 'createPaymentOrderBtn', 'cancelDraftOrderBtn', 'createPaymentDisabledReason']
            .map(id => $(id))
            .filter(Boolean)
            .forEach(el => target.appendChild(el));
    }

    function formatRecoveryText(order = {}) {
        const fiscalStatus = effectiveFiscalStatus(order);
        if (FISCAL_DONE_STATUSES.has(fiscalStatus)) return 'Чек створено. Після оновлення він зникне з незавершених.';
        if (['dead', 'failed_terminal', 'validation_failed', 'blocked'].includes(fiscalStatus)) {
            return 'Автоповтор зупинено — потрібна перевірка відповідального.';
        }
        if (order.nextRunAt) return `Наступна серверна перевірка: ${formatKyivDateTime(order.nextRunAt)}. Повторно не оплачуйте.`;
        return 'Стан чека перевіряється автоматично. Повторно не оплачуйте.';
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
        return `${STORAGE_PREFIX}:u:${userId}:route:${PILOT_SCOPE.routeOptionId}:fp:${fiscalProfileId}:fr:${fiscalRegisterId}`;
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
        return `${action}:${PILOT_SCOPE.routeOptionId}:${target || 'current'}`;
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
        if (state.saleMode === 'catalog_sale') {
            const lines = [...document.querySelectorAll('#catalogSaleLines .cashier-catalog-line')]
                .map(row => `${row.querySelector('[data-catalog-item]')?.value || ''}:${row.querySelector('[data-catalog-quantity]')?.value || ''}`)
                .join('|');
            const discount = $('catalogDiscountRule')?.value || 'none';
            return `${PILOT_SCOPE.routeOptionId}:catalog:${$('paymentCashierBinding')?.value}:${state.tender}:${lines}:${discount}`;
        }
        const date = $('paymentDate')?.value || 'no-date';
        const kids = $('paymentKidsCount')?.value || '0';
        const adults = $('paymentAdultsCount')?.value || '0';
        return `${PILOT_SCOPE.routeOptionId}:${$('paymentCashierBinding')?.value}:${state.tender}:${date}:${kids}:${adults}`;
    }

    function createDraft() {
        const raw = storageGet('createDraft');
        if (!raw) return null;
        try { return JSON.parse(raw); }
        catch { return { payload: {}, key: null }; }
    }

    function getCreateIdempotencyKey() {
        const existing = createDraft();
        if (existing && !existing.key) throw new Error('idempotency_key_required');
        if (existing && (existing.payload || existing.scope === orderStorageScope())) return existing.key;
        const generated = randomKey('cashier-ui-create');
        // Fail closed when durable browser storage is unavailable; a lost key cannot be retried safely.
        window.localStorage.setItem(storageKey('createDraft'), JSON.stringify({ key: generated, scope: orderStorageScope() }));
        return generated;
    }

    function clearCreateIdempotencyKey() {
        window.localStorage.removeItem(storageKey('createDraft'));
    }

    function invalidateUnsubmittedDraft() {
        if (!createDraft()?.payload) clearCreateIdempotencyKey();
    }

    function getConfirmIdempotencyKey(orderId) {
        const key = `confirm:${PILOT_SCOPE.routeOptionId}:${orderId}`;
        const existing = storageGet(key);
        if (existing) return existing;
        const generated = randomKey('cashier-ui-confirm');
        storageSet(key, generated);
        return generated;
    }

    function apiHeaders(idempotencyKey = null) {
        const headers = typeof getAuthHeaders === 'function' ? getAuthHeaders(true) : { 'Content-Type': 'application/json' };
        if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
        if (PILOT_SCOPE.routeOptionId) headers['X-Fiscal-Route-Option'] = PILOT_SCOPE.routeOptionId;
        return headers;
    }

    function routeQueryParams(extra = {}) {
        return new URLSearchParams({
            businessContext: PILOT_SCOPE.crmProfileKey,
            routeOptionId: PILOT_SCOPE.routeOptionId,
            ...extra
        });
    }

    function selectedCashierBindingId() {
        const id = Number($('paymentCashierBinding')?.value || 0);
        return Number.isSafeInteger(id) && id > 0 ? id : null;
    }

    function readinessRouteParams(extra = {}) {
        const params = routeQueryParams(extra);
        const bindingId = selectedCashierBindingId();
        if (bindingId) params.set('cashierBindingId', String(bindingId));
        if (state.tender) params.set('requiredTender', state.tender);
        return params;
    }

    function readinessContextKey() {
        return JSON.stringify({
            routeOptionId: PILOT_SCOPE.routeOptionId || null,
            cashierBindingId: selectedCashierBindingId(),
            tender: state.tender || null
        });
    }

    function readinessTenderMatches(registerState = state.registerState) {
        const expected = String(state.tender || '').trim();
        if (!expected) return false;
        const actual = String(registerState?.requiredTender || registerState?.readiness?.requiredTender || '').trim();
        return actual === expected;
    }

    function selectedRoute() {
        return state.routeOptions.find(route => route.id === PILOT_SCOPE.routeOptionId
            && route.businessContext === PILOT_SCOPE.crmProfileKey) || null;
    }

    function routesForActiveBusiness() {
        return state.routeOptions.filter(route => route.businessContext === PILOT_SCOPE.crmProfileKey);
    }

    function preferredRouteForActiveBusiness() {
        const routes = routesForActiveBusiness();
        return routes.find(route => route.id === PILOT_SCOPE.routeOptionId)
            || routes.find(route => route.mode === 'production')
            || routes[0]
            || null;
    }

    function defaultRouteOptionIdForBusiness(businessContext) {
        return `${businessContext === 'dar' ? 'dar' : 'park'}_production`;
    }

    function routeOptionBelongsToBusiness(routeOptionId, businessContext) {
        const id = String(routeOptionId || '').trim();
        if (!id) return false;
        const route = state.routeOptions.find(item => item.id === id);
        if (route) return route.businessContext === businessContext;
        const prefix = businessContext === 'dar' ? 'dar_' : 'park_';
        return id.startsWith(prefix);
    }

    function applyPilotScopeRoute(route) {
        if (!route || route.businessContext !== PILOT_SCOPE.crmProfileKey || !BUSINESS_SCOPES[route.businessContext]) return false;
        PILOT_SCOPE = {
            ...BUSINESS_SCOPES[route.businessContext],
            routeOptionId: route.id,
            mode: route.mode,
            registerLabel: route.registerLabel
        };
        state.saleMode = route.businessContext === 'dar' || pageParams.get('saleMode') !== 'admission'
            ? 'catalog_sale'
            : 'admission_ticket';
        return true;
    }

    function syncPilotScopeWithCrmBusiness(user = state.user) {
        const businessContext = currentCrmBusinessContext(user);
        if (!businessContext) {
            const error = new Error('business_scope_single_required');
            error.code = 'business_scope_single_required';
            throw error;
        }
        if (businessContext !== PILOT_SCOPE.crmProfileKey) {
            const requestedRouteOptionId = routeOptionBelongsToBusiness(PILOT_SCOPE.routeOptionId, businessContext)
                ? PILOT_SCOPE.routeOptionId
                : defaultRouteOptionIdForBusiness(businessContext);
            PILOT_SCOPE = {
                ...BUSINESS_SCOPES[businessContext],
                routeOptionId: requestedRouteOptionId,
                mode: 'production'
            };
        }
        const route = preferredRouteForActiveBusiness();
        if (route) applyPilotScopeRoute(route);
        return PILOT_SCOPE;
    }

    function assertSelectedRouteScope() {
        const route = selectedRoute();
        if (!route) {
            const error = new Error('fiscal_route_option_invalid');
            error.code = 'fiscal_route_option_invalid';
            throw error;
        }
        return route;
    }

    function hasServiceOutRequestAccess() {
        return hasAction('fiscal.service_out.request');
    }

    function hasServiceOutApproveAccess() {
        return hasAction('fiscal.service_out.approve');
    }

    function serviceOutVisible() {
        return hasServiceOutRequestAccess() || hasServiceOutApproveAccess();
    }

    function actionPinVisible() {
        return hasAction('fiscal.configure');
    }

    function currentShiftStatus() {
        const phaseContext = phase1CloseContext();
        return normalizeStatus(phaseContext?.status || state.registerState?.shift?.status || state.registerState?.shiftStatus);
    }

    function serviceOutUnavailableReason() {
        if (!serviceOutVisible()) return 'Немає дозволу на службову видачу.';
        if (!state.routeReady) return 'Каса або маршрут ще не готові.';
        if (state.registerState?.integrationReady !== true) return 'Готовність Checkbox ще не підтверджена.';
        if (!unresolvedQueueIsFresh()) return queueUnavailableReason();
        const shiftStatus = currentShiftStatus();
        if (!['open', 'opened'].includes(shiftStatus)) return 'Потрібна відкрита зміна Checkbox.';
        return '';
    }

    function serviceOutScopePayload() {
        const route = assertSelectedRouteScope();
        const result = {
            businessContext: route.businessContext,
            routeOptionId: route.id
        };
        const registerState = state.registerState || {};
        const profileId = registerState.fiscalProfileId ?? registerState.fiscal_profile_id;
        const locationId = registerState.fiscalLocationId ?? registerState.fiscal_location_id;
        const registerId = registerState.fiscalRegisterId ?? registerState.fiscal_register_id;
        if (profileId != null) result.fiscalProfileId = profileId;
        if (locationId != null) result.fiscalLocationId = locationId;
        if (registerId != null) result.fiscalRegisterId = registerId;
        return result;
    }

    function serviceOutDraftScope() {
        return JSON.stringify({
            routeOptionId: PILOT_SCOPE.routeOptionId,
            businessContext: PILOT_SCOPE.crmProfileKey,
            amount: String($('serviceOutAmount')?.value || '').trim().replace(',', '.'),
            reason: String($('serviceOutReason')?.value || '').trim()
        });
    }

    function serviceOutCreateIdempotencyKey(scope = serviceOutDraftScope()) {
        return getOperationIdempotencyKey('service-out-request', scope);
    }

    function clearServiceOutCreateIdempotencyKey(scope = serviceOutDraftScope()) {
        clearOperationIdempotencyKey('service-out-request', scope);
    }

    async function apiRequest(path, options = {}) {
        const timeoutMs = Number(options.timeoutMs || 0);
        const controller = timeoutMs > 0 ? new AbortController() : null;
        const timeoutId = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null;
        const method = String(options.method || 'GET').toUpperCase();
        try {
            const response = await fetch(path, {
                cache: method === 'GET' ? 'no-store' : 'default',
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

    function normalizeServiceOutPayload(result = {}) {
        if (Array.isArray(result.operations)) return result.operations;
        if (result.operation) return [result.operation];
        return [];
    }

    function upsertServiceOutOperation(operation) {
        if (!operation?.operationId) return;
        const id = String(operation.operationId);
        const existing = state.serviceOutOperations.filter(item => String(item.operationId) !== id);
        state.serviceOutOperations = [operation, ...existing].sort((a, b) => {
            const bTime = new Date(b.createdAt || 0).getTime();
            const aTime = new Date(a.createdAt || 0).getTime();
            if (bTime !== aTime) return bTime - aTime;
            return Number(b.operationId || 0) - Number(a.operationId || 0);
        }).slice(0, 50);
    }

    function serviceOutOperationById(operationId) {
        return state.serviceOutOperations.find(item => String(item.operationId) === String(operationId)) || null;
    }

    async function loadServiceOutRequests({ silent = false } = {}) {
        if (!serviceOutVisible()) {
            state.serviceOutOperations = [];
            renderServiceOutPanel();
            return [];
        }
        const contextKey = interactionContextKey();
        state.serviceOutLoadInFlight = true;
        renderServiceOutPanel();
        try {
            const params = routeQueryParams();
            const result = await apiRequest(`/api/payments/service-out?${params.toString()}`, {
                method: 'GET',
                headers: apiHeaders()
            });
            if (contextKey !== interactionContextKey()) return state.serviceOutOperations;
            state.serviceOutOperations = normalizeServiceOutPayload(result);
            state.serviceOutLastError = null;
            if (!silent) notify('Список service-out оновлено.', 'success');
            return state.serviceOutOperations;
        } catch (error) {
            if (contextKey !== interactionContextKey()) return state.serviceOutOperations;
            state.serviceOutLastError = error;
            if (!silent) notify(paymentUiError(error), 'error');
            return state.serviceOutOperations;
        } finally {
            state.serviceOutLoadInFlight = false;
            renderServiceOutPanel();
        }
    }

    async function recoverServiceOutRequest(idempotencyKey) {
        const key = String(idempotencyKey || '').trim();
        if (!key) throw new Error('idempotency_key_required');
        const result = await apiRequest('/api/payments/service-out/recovery', {
            method: 'GET',
            headers: apiHeaders(key)
        });
        const operation = normalizeServiceOutPayload(result)[0] || null;
        if (operation) upsertServiceOutOperation(operation);
        return result;
    }

    function serviceOutRecoverableError(error) {
        const status = Number(error?.status || 0);
        return error?.name === 'AbortError' || status === 0 || status >= 500 || error?.code === 'provider_unavailable';
    }

    async function createServiceOutRequest(event) {
        event?.preventDefault?.();
        if (state.serviceOutCreateInFlight) return;
        const unavailable = serviceOutUnavailableReason();
        if (unavailable) {
            notify(unavailable, 'error');
            $('serviceOutAmount')?.focus?.({ preventScroll: false });
            return;
        }
        let minor;
        try {
            minor = parseUahToMinor($('serviceOutAmount')?.value || '');
        } catch (error) {
            notify(paymentUiError(error), 'error');
            $('serviceOutAmount')?.focus?.({ preventScroll: false });
            return;
        }
        if (minor <= 0n) {
            notify(paymentUiError(new Error('service_out_amount_required')), 'error');
            $('serviceOutAmount')?.focus?.({ preventScroll: false });
            return;
        }
        const reason = String($('serviceOutReason')?.value || '').trim();
        if (!reason) {
            notify(paymentUiError(new Error('service_out_reason_required')), 'error');
            $('serviceOutReason')?.focus?.({ preventScroll: false });
            return;
        }
        const draftScope = serviceOutDraftScope();
        const idempotencyKey = serviceOutCreateIdempotencyKey(draftScope);
        const run = async () => {
            state.serviceOutCreateInFlight = true;
            renderServiceOutPanel();
            try {
                const result = await apiRequest('/api/payments/service-out', {
                    method: 'POST',
                    headers: apiHeaders(idempotencyKey),
                    body: JSON.stringify({
                        ...serviceOutScopePayload(),
                        amountMinor: minor.toString(),
                        reason
                    }),
                    timeoutMs: READINESS_REQUEST_TIMEOUT_MS
                });
                const operation = normalizeServiceOutPayload(result)[0] || null;
                if (operation) upsertServiceOutOperation(operation);
                clearServiceOutCreateIdempotencyKey(draftScope);
                if ($('serviceOutAmount')) $('serviceOutAmount').value = '';
                if ($('serviceOutReason')) $('serviceOutReason').value = '';
                notify(result.replayed ? 'Service-out уже був створений. Стан відновлено.' : 'Service-out запит створено й очікує погодження.', 'success');
                await loadServiceOutRequests({ silent: true });
                await loadPilotRegisterState({ silent: true });
            } catch (error) {
                if (serviceOutRecoverableError(error)) {
                    try {
                        const recovered = await recoverServiceOutRequest(idempotencyKey);
                        clearServiceOutCreateIdempotencyKey(draftScope);
                        notify(recovered?.operation ? 'Service-out відновлено після втраченої відповіді.' : 'Стан service-out уточнено.', 'success');
                        return;
                    } catch (recoverError) {
                        if (Number(recoverError?.status || 0) !== 404) error = recoverError;
                    }
                }
                state.serviceOutLastError = error;
                notify(paymentUiError(error), 'error');
            } finally {
                state.serviceOutCreateInFlight = false;
                renderServiceOutPanel();
            }
        };
        if (window.navigator.locks?.request) {
            return window.navigator.locks.request(storageKey('service-out-request'), run).catch(error => notify(paymentUiError(error), 'error'));
        }
        return run();
    }

    async function cancelServiceOutOperation(operationId) {
        const operation = serviceOutOperationById(operationId);
        if (!operation?.canCancel || state.serviceOutCancelInFlight) return;
        state.serviceOutCancelInFlight = true;
        renderServiceOutPanel();
        try {
            const result = await apiRequest(`/api/payments/service-out/${encodeURIComponent(operationId)}/cancel`, {
                method: 'POST',
                headers: apiHeaders(getOperationIdempotencyKey('service-out-cancel', operationId)),
                body: JSON.stringify({})
            });
            const nextOperation = normalizeServiceOutPayload(result)[0] || null;
            if (nextOperation) upsertServiceOutOperation(nextOperation);
            clearOperationIdempotencyKey('service-out-cancel', operationId);
            notify(result.replayed ? 'Скасування service-out уже зафіксовано.' : 'Service-out запит скасовано. Запит до Checkbox не надсилався.', 'success');
            await loadPilotRegisterState({ silent: true });
        } catch (error) {
            notify(paymentUiError(error), 'error');
        } finally {
            state.serviceOutCancelInFlight = false;
            renderServiceOutPanel();
        }
    }

    async function approveServiceOutOperation(operationId) {
        const operation = serviceOutOperationById(operationId);
        if (!operation?.canApprove || state.serviceOutApproveInFlight) return;
        const pinInput = $('serviceOutApprovalPin');
        const pin = String(pinInput?.value || '').trim();
        if (!pin) {
            notify(paymentUiError(new Error('action_pin_required')), 'error');
            pinInput?.focus?.({ preventScroll: false });
            return;
        }
        state.serviceOutApproveInFlight = true;
        renderServiceOutPanel();
        try {
            const result = await apiRequest(`/api/payments/service-out/${encodeURIComponent(operationId)}/approve`, {
                method: 'POST',
                headers: apiHeaders(getOperationIdempotencyKey('service-out-approve', operationId)),
                body: JSON.stringify({ pin })
            });
            const nextOperation = normalizeServiceOutPayload(result)[0] || null;
            if (nextOperation) upsertServiceOutOperation(nextOperation);
            clearOperationIdempotencyKey('service-out-approve', operationId);
            notify('Service-out погоджено. Подальшу відправку контролює серверна черга.', 'success');
            await loadServiceOutRequests({ silent: true });
        } catch (error) {
            notify(paymentUiError(error), 'error');
        } finally {
            if (pinInput) pinInput.value = '';
            state.serviceOutApproveInFlight = false;
            renderServiceOutPanel();
        }
    }

    async function loadActionPinBindings({ silent = false } = {}) {
        if (!actionPinVisible()) {
            state.actionPinBindings = [];
            renderActionPinPanel();
            return [];
        }
        state.actionPinLoadInFlight = true;
        renderActionPinPanel();
        try {
            const params = routeQueryParams();
            const result = await apiRequest(`/api/payments/fiscal-bindings/cashiers?${params.toString()}`, {
                method: 'GET',
                headers: apiHeaders()
            });
            state.actionPinBindings = Array.isArray(result.cashiers) ? result.cashiers : [];
            if (!silent) notify('Список касирів для PIN оновлено.', 'success');
            return state.actionPinBindings;
        } catch (error) {
            state.actionPinBindings = [];
            if (!silent) notify(paymentUiError(error), 'error');
            return state.actionPinBindings;
        } finally {
            state.actionPinLoadInFlight = false;
            renderActionPinPanel();
        }
    }

    function clearActionPinFields() {
        if ($('actionPinValue')) $('actionPinValue').value = '';
        if ($('actionPinConfirm')) $('actionPinConfirm').value = '';
    }

    function changeActionPinBinding() {
        clearActionPinFields();
        renderActionPinPanel();
    }

    async function saveActionPin(event) {
        event?.preventDefault?.();
        if (state.actionPinSaveInFlight) return;
        const select = $('actionPinBindingSelect');
        const bindingId = select?.value || '';
        const binding = state.actionPinBindings.find(item => String(item.id) === String(bindingId));
        const pin = String($('actionPinValue')?.value || '').trim();
        const confirmation = String($('actionPinConfirm')?.value || '').trim();
        if (!binding) {
            notify(paymentUiError(new Error('cashier_binding_required')), 'error');
            select?.focus?.({ preventScroll: false });
            return;
        }
        if (Number(binding.targetUserId) === Number(state.user?.id)) {
            notify(paymentUiError(new Error('action_pin_self_enrollment_denied')), 'error');
            select?.focus?.({ preventScroll: false });
            return;
        }
        if (!/^\d{4,12}$/.test(pin)) {
            notify(paymentUiError(new Error('action_pin_format_invalid')), 'error');
            $('actionPinValue')?.focus?.({ preventScroll: false });
            return;
        }
        if (pin !== confirmation) {
            notify(paymentUiError(new Error('action_pin_confirmation_mismatch')), 'error');
            $('actionPinConfirm')?.focus?.({ preventScroll: false });
            return;
        }
        state.actionPinSaveInFlight = true;
        renderActionPinPanel();
        try {
            await apiRequest(`/api/payments/fiscal-bindings/${encodeURIComponent(binding.id)}/action-pin`, {
                method: 'POST',
                headers: apiHeaders(),
                body: JSON.stringify({
                    actionPin: pin,
                    businessContext: PILOT_SCOPE.crmProfileKey,
                    routeOptionId: PILOT_SCOPE.routeOptionId
                })
            });
            clearActionPinFields();
            notify('Action PIN збережено для обраної прив’язки.', 'success');
            await loadActionPinBindings({ silent: true });
        } catch (error) {
            notify(paymentUiError(error), 'error');
        } finally {
            state.actionPinSaveInFlight = false;
            renderActionPinPanel();
        }
    }

    function configurePageContext() {
        const catalogMode = state.saleMode === 'catalog_sale';
        const route = selectedRoute();
        setText('cashierHeroKicker', `Checkbox · ${PILOT_SCOPE.businessLabel} · ${route?.registerLabel || PILOT_SCOPE.registerLabel}`);
        setText('cashierHeroDescription', state.orderDetails?.order?.id ? `Продаж RCP-${state.orderDetails.order.id}` : 'Новий продаж');
        $('cashierTestModeBanner')?.classList.toggle('hidden', route?.mode !== 'test');
        $('cashierRouteSelector')?.classList.toggle('is-test-route', route?.mode === 'test');
        $('admissionTicketFields')?.classList.toggle('hidden', catalogMode);
        $('catalogSaleFields')?.classList.toggle('hidden', !catalogMode);
        $('paymentDate') && ($('paymentDate').required = !catalogMode);
        $('paymentKidsCount') && ($('paymentKidsCount').required = !catalogMode);
        setText('paymentOrderFormTitle', 'Новий продаж');
        if ($('createPaymentOrderBtn')) $('createPaymentOrderBtn').textContent = 'Перейти до оплати';
        placeCheckoutActions();
        renderCompactContext();
    }

    async function loadLocalQaStatus() {
        if (pageParams.get('localQa') !== '1') return null;
        const params = routeQueryParams();
        const result = await apiRequest(`/api/payments/local-qa-status?${params.toString()}`, {
            method: 'GET',
            headers: apiHeaders()
        });
        if (result.enabled !== true || result.providerMode !== 'loopback_mock' || result.externalNetwork !== false) {
            const error = new Error('local_qa_identity_not_confirmed');
            error.code = 'local_qa_identity_not_confirmed';
            throw error;
        }
        state.localQa = result;
        const banner = $('localQaBanner');
        banner?.classList.remove('hidden');
        setText('localQaBannerDetails', `${PILOT_SCOPE.businessLabel} · ${selectedRoute()?.registerLabel || 'каса'} · тільки localhost · зовнішній Checkbox заблоковано`);
        renderCompactContext();
        return result;
    }

    function routeReadinessLabel(route) {
        if (!route?.configured) return 'не налаштовано';
        if (route.status !== 'active') return 'неактивна';
        if (route.featureEnabled !== true) return 'функцію вимкнено';
        if (route.acceptanceEnabled !== true) return 'приймання вимкнено';
        if (route.sequentialReady !== true) return 'очікує завершення іншого напрямку';
        return 'готова';
    }

    function renderRouteSelectors() {
        const businessSelect = $('paymentBusinessContext');
        const registerSelect = $('paymentRegisterRoute');
        if (!businessSelect || !registerSelect) return;
        syncPilotScopeWithCrmBusiness();
        const businesses = [PILOT_SCOPE.crmProfileKey];
        businessSelect.replaceChildren();
        for (const businessContext of businesses) {
            const option = document.createElement('option');
            option.value = businessContext;
            option.textContent = businessContext === 'dar' ? 'ДАР' : 'ПАРК';
            businessSelect.appendChild(option);
        }
        businessSelect.value = PILOT_SCOPE.crmProfileKey;
        businessSelect.disabled = true;
        businessSelect.title = 'Бізнес каси береться із загального перемикача CRM.';

        const availableRoutes = routesForActiveBusiness();
        registerSelect.replaceChildren();
        for (const route of availableRoutes) {
            const option = document.createElement('option');
            option.value = route.id;
            option.textContent = `${route.mode === 'test' ? 'Тестова каса' : route.registerLabel} · ${routeReadinessLabel(route)}`;
            registerSelect.appendChild(option);
        }
        if (availableRoutes.some(route => route.id === PILOT_SCOPE.routeOptionId)) {
            registerSelect.value = PILOT_SCOPE.routeOptionId;
        } else if (availableRoutes.length) {
            registerSelect.value = availableRoutes.find(route => route.mode === 'production')?.id || availableRoutes[0].id;
        }
        const route = availableRoutes.find(item => item.id === registerSelect.value) || null;
        if (route) applyPilotScopeRoute(route);
        state.routeReady = Boolean(
            route?.configured
            && route.status === 'active'
            && route.featureEnabled === true
            && route.acceptanceEnabled === true
            && route.sequentialReady === true
        );
        setText('cashierRouteStatus', routeReadinessLabel(route));
        configurePageContext();
    }

    async function loadRouteOptions() {
        state.routeLoading = true;
        state.routeReady = false;
        setText('cashierRouteStatus', 'завантаження');
        try {
            const result = await apiRequest('/api/payments/catalog/routes', { method: 'GET', headers: apiHeaders() });
            state.routeOptions = Array.isArray(result.routes) ? result.routes : [];
            if (!state.routeOptions.length) throw new Error('fiscal_route_options_unavailable');
            renderRouteSelectors();
            return state.routeOptions;
        } finally {
            state.routeLoading = false;
        }
    }

    function clearRouteData() {
        invalidateInteractionRequests();
        clearReadinessRefreshTimer();
        clearUnresolvedRefreshTimer();
        clearOrderPolling();
        state.catalogItems = [];
        state.catalogDiscounts = [];
        state.catalogReady = state.saleMode !== 'catalog_sale';
        state.selectableCashiers = [];
        state.registerState = null;
        state.orderDetails = null;
        state.unresolvedOrders = [];
        state.unresolvedQueueState = 'unknown';
        state.unresolvedFastRefreshStartedAt = 0;
        state.serviceOutOperations = [];
        state.serviceOutLastError = null;
        state.actionPinBindings = [];
        resetReceiptHistoryForScope();
        $('catalogSaleLines')?.replaceChildren();
        $('paymentCashierBinding')?.replaceChildren(new Option('Завантаження касирів…', ''));
        $('serviceOutApprovalPin') && ($('serviceOutApprovalPin').value = '');
        clearActionPinFields();
        renderServiceOutPanel();
        renderActionPinPanel();
    }

    async function activateSelectedRoute(routeOptionId) {
        const route = state.routeOptions.find(item => item.id === routeOptionId);
        if (!route) throw new Error('fiscal_route_option_invalid');
        if (!BUSINESS_SCOPES[route.businessContext]) throw new Error('fiscal_route_option_invalid');
        if (route.businessContext !== PILOT_SCOPE.crmProfileKey) throw new Error('fiscal_route_option_invalid');
        if (activeUnfinishedOrder()) {
            renderRouteSelectors();
            throw new Error('fiscal_route_change_blocked_by_order');
        }
        clearRouteData();
        applyPilotScopeRoute(route);
        renderReceiptHistoryAppliedFilter();
        renderRouteSelectors();
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set('businessContext', route.businessContext);
        nextUrl.searchParams.set('routeOptionId', route.id);
        window.history.replaceState({}, '', nextUrl);
        await loadSelectedRouteWorkspace();
    }

    async function loadSelectedRouteWorkspace() {
        const route = selectedRoute();
        if (!route?.configured) {
            setText('catalogSaleSummary', 'Каса для цього маршруту ще не налаштована. Продаж заблоковано.');
            const select = $('paymentCashierBinding');
            select?.replaceChildren(new Option('Немає налаштованої каси', ''));
            state.catalogReady = false;
            state.routeReady = false;
            renderReadinessState();
            syncCreateAvailability();
            renderServiceOutPanel();
            renderActionPinPanel();
            return;
        }
        await loadSelectableCashiers();
        await loadCatalogData();
        await loadPilotRegisterState({ silent: true });
        state.draftRevision = storageGet('draftRevision') || '';
        state.unresolvedAutoRefreshEnabled = true;
        await loadUnresolvedOrders({ silent: true });
        await loadServiceOutRequests({ silent: true });
        await loadActionPinBindings({ silent: true });
        scheduleReadinessRefresh();
        loadReceiptHistoryOnOpen();
    }

    async function handleBusinessContextChange() {
        renderRouteSelectors();
        notify('Бізнес каси змінюється через загальний перемикач CRM.', 'info');
    }

    async function handleRegisterRouteChange() {
        const routeOptionId = $('paymentRegisterRoute')?.value || '';
        if (!routeOptionId) return;
        try { await activateSelectedRoute(routeOptionId); }
        catch (error) { notify(paymentUiError(error), 'error'); }
    }

    async function handleGlobalBusinessContextChanged(event = {}) {
        const nextBusiness = normalizeCashierBusinessContext(event.detail?.current);
        if (nextBusiness === PILOT_SCOPE.crmProfileKey) return;
        if (activeUnfinishedOrder()) {
            renderRouteSelectors();
            notify('Завершіть або відновіть поточну оплату перед переходом в інший бізнес.', 'error');
            return;
        }
        try {
            clearRouteData();
            PILOT_SCOPE = {
                ...BUSINESS_SCOPES[nextBusiness],
                routeOptionId: `${nextBusiness === 'dar' ? 'dar' : 'park'}_production`,
                mode: 'production'
            };
            syncPilotScopeWithCrmBusiness(state.user);
            renderReceiptHistoryAppliedFilter();
            renderRouteSelectors();
            const route = selectedRoute();
            if (route) {
                const nextUrl = new URL(window.location.href);
                nextUrl.searchParams.set('businessContext', route.businessContext);
                nextUrl.searchParams.set('routeOptionId', route.id);
                window.history.replaceState({}, '', nextUrl);
            }
            await loadSelectedRouteWorkspace();
        } catch (error) {
            notify(paymentUiError(error), 'error');
        }
    }

    function catalogItemByCode(itemCode) {
        return state.catalogItems.find(item => item.itemCode === String(itemCode || '')) || null;
    }

    function catalogFilterActive() {
        return Boolean(String($('catalogSearch')?.value || '').trim() || String($('catalogCategory')?.value || '').trim());
    }

    function filteredCatalogItems() {
        const search = String($('catalogSearch')?.value || '').trim().toLocaleLowerCase('uk-UA');
        const category = String($('catalogCategory')?.value || '').trim();
        return state.catalogItems.filter(item => {
            const matchesSearch = !search || `${item.name || ''} ${item.itemCode || ''} ${item.category || ''}`.toLocaleLowerCase('uk-UA').includes(search);
            return matchesSearch && (!category || item.category === category);
        });
    }

    function catalogSelectItems(selectedCode = '') {
        const filtered = state.catalogItems;
        const selected = catalogItemByCode(selectedCode);
        return selected && !filtered.some(item => item.itemCode === selected.itemCode)
            ? [selected, ...filtered]
            : filtered;
    }

    function fillCatalogSelect(select, selectedCode = '') {
        if (!select) return;
        const items = catalogSelectItems(selectedCode);
        select.replaceChildren();
        if (!items.length) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'Нічого не знайдено';
            select.appendChild(option);
            return;
        }
        for (const item of items) {
            const option = document.createElement('option');
            option.value = item.itemCode;
            option.textContent = `${item.category ? `${item.category} · ` : ''}${item.name}`;
            select.appendChild(option);
        }
        select.value = items.some(item => item.itemCode === selectedCode) ? selectedCode : items[0].itemCode;
    }

    function setCatalogPickerOpen(open) {
        const picker = $('catalogPicker');
        if (!picker) return;
        picker.hidden = !open;
        $('addCatalogLineBtn')?.setAttribute('aria-expanded', String(open));
        setText('addCatalogLineBtn', open ? 'Сховати товари' : 'Обрати товари');
    }

    function renderCatalogSearchResults() {
        const container = $('catalogSearchResults');
        if (!container) return;
        container.replaceChildren();
        if (state.saleMode !== 'catalog_sale' || !state.catalogReady) {
            container.classList.add('hidden');
            return;
        }
        const items = filteredCatalogItems();
        const locked = Boolean(state.orderDetails?.order || state.createInFlight || createDraft()?.payload);
        container.classList.remove('hidden');
        setText('catalogResultsCount', `${items.length} позицій`);
        if (!items.length) {
            const empty = document.createElement('p');
            empty.className = 'cashier-help';
            empty.textContent = 'За цим пошуком немає доступних позицій.';
            container.appendChild(empty);
            return;
        }
        for (const item of items) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'cashier-catalog-result';
            button.dataset.catalogAdd = item.itemCode;
            button.setAttribute('aria-label', `Додати: ${item.name}, ${formatMoneyMinor(item.priceMinor)}`);
            button.disabled = locked;
            if (locked) button.setAttribute('aria-disabled', 'true');
            button.innerHTML = `
                <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.category || 'Без категорії')}</small></span>
                <span class="cashier-catalog-result-price">${escapeHtml(formatMoneyMinor(item.priceMinor))}<small>${escapeHtml(item.unit || 'шт.')}</small></span>
                <span class="cashier-catalog-add-icon" aria-hidden="true">+</span>`;
            button.addEventListener('click', () => addCatalogLine(item.itemCode));
            container.appendChild(button);
        }
    }

    function refreshCatalogSelects() {
        // Filtering the picker never modifies the basket or its quantities.
        renderCatalogSearchResults();
    }

    function renderCatalogCategories() {
        const select = $('catalogCategory');
        if (!select) return;
        const selected = select.value;
        select.replaceChildren(new Option('Усі категорії', ''));
        const categories = [...new Set(state.catalogItems.map(item => String(item.category || '').trim()).filter(Boolean))]
            .sort((left, right) => left.localeCompare(right, 'uk'));
        for (const category of categories) select.appendChild(new Option(category, category));
        select.value = categories.includes(selected) ? selected : '';
    }

    function discountRateBps(discount) {
        return DiscountCalculator.discountRateBps(discount);
    }

    function discountEligibilityMode(discount) {
        return DiscountCalculator.discountEligibilityMode(discount);
    }

    function catalogItemClubDirection(item) {
        return DiscountCalculator.itemClubDirection(item);
    }

    function catalogQuoteFromRows(rows, selectedDiscounts) {
        const catalog = new Map(state.catalogItems.map(item => [item.itemCode, item]));
        const lines = rows.map(row => ({
            itemCode: String(row.querySelector('[data-catalog-item]')?.value || '').trim(),
            quantityMillis: Math.round(Number(row.querySelector('[data-catalog-quantity]')?.value || 0) * 1000)
        }));
        return DiscountCalculator.quoteCatalogLines(lines, catalog, selectedDiscounts);
    }

    function discountDisplayName(discount) {
        const name = String(discount?.name || discount?.code || '').trim();
        const rateLabel = `${discountRateBps(discount) / 100}%`;
        return name.includes(rateLabel) ? name : `${name} ${rateLabel}`.trim();
    }

    function updateCatalogCartSummary() {
        const rows = [...document.querySelectorAll('#catalogSaleLines .cashier-catalog-line')];
        $('catalogCartEmpty')?.classList.toggle('hidden', Boolean(rows.length));
        let originalTotalMinor = 0n;
        let finalTotalMinor = 0n;
        const discountCode = String($('catalogDiscountRule')?.value || '').trim();
        const discount = state.catalogDiscounts.find(rule => rule.code === discountCode) || null;
        const selectedDiscounts = discount ? [discount] : [];
        setText('catalogBasketCount', `${rows.length} ${rows.length === 1 ? 'позиція' : (rows.length >= 2 && rows.length <= 4 ? 'позиції' : 'позицій')}`);
        let quotes = [];
        try {
            quotes = catalogQuoteFromRows(rows, selectedDiscounts);
        } catch {
            quotes = [];
        }
        quotes.forEach((quote, index) => {
            originalTotalMinor += quote.originalTotalMinor;
            finalTotalMinor += quote.totalMinor;
            const row = rows[index];
            const total = row?.querySelector('[data-catalog-line-total]');
            const lineDiscount = row?.querySelector('[data-catalog-line-discount]');
            if (total) total.textContent = formatMoneyMinor(String(quote.totalMinor));
            if (lineDiscount) {
                lineDiscount.hidden = !quote.discount || quote.totalDiscountMinor <= 0n;
                lineDiscount.textContent = quote.discount && quote.totalDiscountMinor > 0n
                    ? `${discountDisplayName(quote.discount)} · −${formatMoneyMinor(String(quote.totalDiscountMinor))}`
                    : '';
            }
        });
        for (let index = quotes.length; index < rows.length; index += 1) {
            const total = rows[index].querySelector('[data-catalog-line-total]');
            if (total) total.textContent = '—';
            const lineDiscount = rows[index].querySelector('[data-catalog-line-discount]');
            if (lineDiscount) lineDiscount.hidden = true;
        }
        const discountTotalMinor = originalTotalMinor - finalTotalMinor;
        setText('catalogOriginalTotal', formatMoneyMinor(String(originalTotalMinor)));
        setText('catalogDiscountTotal', formatMoneyMinor(String(discountTotalMinor)));
        setText('catalogFinalTotal', formatMoneyMinor(String(finalTotalMinor)));
        const createButton = $('createPaymentOrderBtn');
        if (createButton && !state.createInFlight && !createDraft()?.payload) {
            createButton.textContent = rows.length
                ? `Перейти до оплати · ${formatMoneyMinor(String(finalTotalMinor))}`
                : 'Перейти до оплати';
        }
        const explanation = $('catalogDiscountExplanation');
        if (explanation) {
            explanation.hidden = !discount;
            const discountName = discount ? discountDisplayName(discount) : '';
            explanation.textContent = discountEligibilityMode(discount) === 'second_club_direction'
                ? (discountTotalMinor > 0n
                    ? `${discountName} застосовано тільки до іншого гурткового напрямку. Перший напрямок лишається за повною ціною.`
                    : `0 грн знижки зараз коректно: ${discountName} спрацює після додавання іншого гурткового напрямку.`)
                : (discount ? `Знижка: ${formatMoneyMinor(String(discountTotalMinor))}.` : '');
        }
    }

    function quantityRule(item) {
        return DiscountCalculator.quantityRule(item);
    }

    function syncCatalogLine(row) {
        const select = row.querySelector('[data-catalog-item]');
        const quantity = row.querySelector('[data-catalog-quantity]');
        const price = row.querySelector('[data-catalog-price]');
        const item = catalogItemByCode(select?.value);
        const rule = quantityRule(item);
        if (quantity) {
            quantity.min = String(rule.minimumMillis / 1000);
            quantity.step = String(rule.stepMillis / 1000);
            const currentMillis = Math.round(Number(quantity.value || 0) * 1000);
            if (!Number.isSafeInteger(currentMillis) || currentMillis < rule.minimumMillis || currentMillis % rule.stepMillis !== 0) {
                quantity.value = String(rule.minimumMillis / 1000);
            }
            quantity.setAttribute('aria-label', `Кількість: ${item?.name || 'позиція'}`);
        }
        const unitPrice = row.querySelector('[data-catalog-unit-price]');
        if (price && !unitPrice) price.textContent = item ? `${formatMoneyMinor(item.priceMinor)} / ${item.unit || 'шт.'}` : '—';
        if (unitPrice) unitPrice.textContent = item ? formatMoneyMinor(item.priceMinor) : '—';
        const category = row.querySelector('[data-catalog-category]');
        if (category) {
            category.hidden = !item?.category;
            category.textContent = item?.category || '';
        }
        const unit = row.querySelector('[data-catalog-unit-label]');
        if (unit) unit.textContent = item?.unit ? `за ${item.unit}` : 'за позицію';
        const total = row.querySelector('[data-catalog-line-total]');
        if (total) total.textContent = item ? formatMoneyMinor(item.priceMinor) : '—';
        const fullName = row.querySelector('[data-catalog-name]');
        if (fullName) fullName.textContent = item?.name || '';
        updateCatalogCartSummary();
        syncCreateAvailability();
    }

    function addCatalogLine(itemCode = '') {
        const container = $('catalogSaleLines');
        if (!container || !state.catalogItems.length || state.orderDetails?.order?.id || state.createInFlight || createDraft()?.payload) return;
        const selectedItem = itemCode ? catalogItemByCode(itemCode) : filteredCatalogItems()[0];
        if (!selectedItem) {
            notify('За цим пошуком немає доступних позицій. Змініть пошук або категорію.', 'error');
            return;
        }
        invalidateUnsubmittedDraft();
        const existing = [...container.querySelectorAll('.cashier-catalog-line')]
            .find(row => row.querySelector('[data-catalog-item]')?.value === selectedItem.itemCode);
        if (existing) {
            const quantity = existing.querySelector('[data-catalog-quantity]');
            quantity.value = String((Math.round(Number(quantity.value) * 1000) + quantityRule(selectedItem).stepMillis) / 1000);
            syncCatalogLine(existing);
            return;
        }
        const row = document.createElement('div');
        row.className = 'cashier-catalog-line';
        row.innerHTML = `
            <div class="cashier-catalog-item-summary">
                <div class="cashier-field cashier-catalog-item-field"><select data-catalog-item hidden aria-hidden="true" tabindex="-1"></select><strong class="cashier-catalog-name" data-catalog-name></strong></div>
                <span class="cashier-catalog-line-meta"><small data-catalog-category></small><small data-catalog-unit-label>за позицію</small></span>
            </div>
            <div class="cashier-catalog-line-controls">
                <div class="cashier-catalog-stepper">
                    <span class="cashier-catalog-control-label">К-сть</span>
                    <button type="button" data-catalog-step="-1" title="Зменшити кількість" aria-label="Зменшити кількість">−</button>
                    <input data-catalog-quantity type="number" inputmode="decimal" value="1">
                    <button type="button" data-catalog-step="1" title="Збільшити кількість" aria-label="Збільшити кількість">+</button>
                </div>
                <span class="cashier-catalog-price" data-catalog-price aria-label="Ціна за одиницю"><small>Ціна</small><strong data-catalog-unit-price>—</strong></span>
                <span class="cashier-catalog-line-money"><small>Сума</small><strong data-catalog-line-total aria-label="Сума позиції зі знижкою"></strong><small data-catalog-line-discount hidden></small></span>
                <button type="button" class="btn-page-secondary cashier-catalog-remove" data-catalog-remove title="Видалити позицію" aria-label="Видалити позицію">×</button>
            </div>`;
        const select = row.querySelector('[data-catalog-item]');
        fillCatalogSelect(select, selectedItem.itemCode);
        select.addEventListener('change', () => syncCatalogLine(row));
        row.querySelector('[data-catalog-quantity]')?.addEventListener('input', () => syncCatalogLine(row));
        row.querySelectorAll('[data-catalog-step]').forEach(button => button.addEventListener('click', () => {
            if (state.orderDetails?.order?.id || state.createInFlight || createDraft()?.payload) return;
            invalidateUnsubmittedDraft();
            const quantity = row.querySelector('[data-catalog-quantity]');
            const rule = quantityRule(catalogItemByCode(select.value));
            const next = Math.round(Number(quantity.value || 0) * 1000) + Number(button.dataset.catalogStep) * rule.stepMillis;
            quantity.value = String(Math.max(rule.minimumMillis, next) / 1000);
            syncCatalogLine(row);
        }));
        row.querySelector('[data-catalog-remove]')?.addEventListener('click', () => {
            if (state.orderDetails?.order?.id || state.createInFlight || createDraft()?.payload) return;
            invalidateUnsubmittedDraft();
            row.remove();
            updateCatalogCartSummary();
            renderCatalogSearchResults();
            syncCreateAvailability();
        });
        container.appendChild(row);
        syncCatalogLine(row);
    }

    function renderCatalogDiscounts() {
        const select = $('catalogDiscountRule');
        const field = $('catalogDiscountField');
        if (!select || !field) return;
        select.replaceChildren();
        const none = document.createElement('option');
        none.value = '';
        none.textContent = 'Без знижки';
        select.appendChild(none);
        for (const discount of state.catalogDiscounts) {
            const option = document.createElement('option');
            option.value = discount.code;
            option.textContent = discountDisplayName(discount);
            select.appendChild(option);
        }
        field.classList.toggle('hidden', state.catalogDiscounts.length === 0);
        updateCatalogCartSummary();
    }

    async function loadCatalogData() {
        if (state.saleMode !== 'catalog_sale') return;
        setCatalogPickerOpen(true);
        state.catalogReady = false;
        const params = routeQueryParams();
        const [catalog, discounts] = await Promise.all([
            apiRequest(`/api/payments/catalog/items?${params.toString()}`, { method: 'GET', headers: apiHeaders() }),
            apiRequest(`/api/payments/catalog/discounts?${params.toString()}`, { method: 'GET', headers: apiHeaders() })
        ]);
        state.catalogItems = Array.isArray(catalog.items) ? catalog.items : [];
        state.catalogDiscounts = Array.isArray(discounts.discounts) ? discounts.discounts : [];
        if (!state.catalogItems.length) throw new Error('catalog_items_unavailable');
        state.catalogReady = true;
        $('catalogSaleLines')?.replaceChildren();
        renderCatalogCategories();
        renderCatalogDiscounts();
        renderCatalogSearchResults();
        updateCatalogCartSummary();
        setText('catalogSaleSummary', `${state.catalogItems.length} активних позицій · актуальні ціни · без ПДВ`);
        syncCreateAvailability();
    }

    function catalogLinesPayload() {
        const rows = [...document.querySelectorAll('#catalogSaleLines .cashier-catalog-line')];
        if (!rows.length) throw new Error('catalog_items_required');
        return rows.map(row => {
            const itemCode = String(row.querySelector('[data-catalog-item]')?.value || '').trim();
            const quantity = Number(row.querySelector('[data-catalog-quantity]')?.value || 0);
            const quantityMillis = Math.round(quantity * 1000);
            const item = catalogItemByCode(itemCode);
            const rule = quantityRule(item);
            if (!item || !Number.isFinite(quantity) || quantity <= 0
                || !Number.isSafeInteger(quantityMillis)
                || quantityMillis < rule.minimumMillis
                || quantityMillis % rule.stepMillis !== 0) {
                const error = new Error('catalog_quantity_invalid');
                error.code = 'catalog_quantity_invalid';
                throw error;
            }
            return { itemCode, quantityMillis };
        });
    }

    function buildCatalogSalePayload() {
        const route = assertSelectedRouteScope();
        const cashierBindingId = Number($('paymentCashierBinding')?.value || 0);
        if (!Number.isSafeInteger(cashierBindingId) || cashierBindingId <= 0) throw new Error('cashier_binding_required');
        const discountCode = String($('catalogDiscountRule')?.value || '').trim();
        return {
            businessContext: route.businessContext,
            routeOptionId: route.id,
            cashierBindingId,
            tender: state.tender,
            items: catalogLinesPayload(),
            discountCodes: discountCode ? [discountCode] : []
        };
    }

    function buildAdmissionTicketPayload() {
        const route = assertSelectedRouteScope();
        const date = $('paymentDate')?.value;
        const kids = Number($('paymentKidsCount')?.value || 0);
        const adults = Number($('paymentAdultsCount')?.value || 0);
        const cashierBindingId = Number($('paymentCashierBinding')?.value || 0);
        if (!date) throw new Error('payment_date_required');
        if (!Number.isSafeInteger(kids) || kids <= 0) throw new Error('kids_count_invalid');
        if (!Number.isSafeInteger(adults) || adults < 0) throw new Error('adults_count_invalid');
        if (!Number.isSafeInteger(cashierBindingId) || cashierBindingId <= 0) throw new Error('cashier_binding_required');
        return {
            businessContext: route.businessContext,
            routeOptionId: route.id,
            tender: state.tender,
            cashierBindingId,
            admissionTicket: {
                date,
                banquetGuests: kids,
                banquetAdults: adults,
                ticketQuantities: []
            }
        };
    }

    async function loadSelectableCashiers() {
        const select = $('paymentCashierBinding');
        if (!select) return;
        const route = assertSelectedRouteScope();
        const params = routeQueryParams({ businessContext: route.businessContext, routeOptionId: route.id });
        const result = await apiRequest(`/api/payments/catalog/cashiers?${params.toString()}`, { method: 'GET', headers: apiHeaders() });
        const cashiers = Array.isArray(result.cashiers) ? result.cashiers : [];
        state.selectableCashiers = cashiers;
        select.replaceChildren();
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = cashiers.length ? 'Оберіть касира' : 'Немає активних касирів';
        select.appendChild(placeholder);
        for (const cashier of cashiers) {
            const option = document.createElement('option');
            option.value = String(cashier.id);
            option.textContent = `${cashier.cashierName || 'Касир'} · ${cashier.mode === 'test' ? 'тест' : 'робочий'}`;
            select.appendChild(option);
        }
        if (cashiers.length === 1) select.value = String(cashiers[0].id);
        setText('paymentCashierHelp', cashiers.length
            ? 'Оберіть активного касира саме цієї каси.'
            : 'Для цієї каси немає активного касира з налаштованим credential reference.');
        renderCompactContext();
        syncCreateAvailability();
    }

    async function createPaymentOrder(event) {
        event?.preventDefault?.();
        if (state.createInFlight) return;
        if (!integrationReady()) {
            notify(paymentUiError(new Error('checkbox_integration_not_ready')), 'error');
            return;
        }
        if (state.orderDetails?.order?.id) {
            notify('Для нового продажу натисніть «Наступний клієнт».', 'info');
            return;
        }
        state.createInFlight = true;
        syncCreateAvailability();
        try {
            if (!window.navigator.locks?.request) throw new Error('Безпечні повтори недоступні у цьому браузері. Відкрийте касу в актуальному браузері через HTTPS.');
            await window.navigator.locks.request(storageKey('create-order'), async () => {
                // Another tab may have completed this same draft while we waited for the lock.
                const existingOrderId = storageGet('lastOrderId');
                if (existingOrderId) {
                    await loadPaymentOrder(existingOrderId, { silent: true });
                    return;
                }
                if (state.draftRevision !== (storageGet('draftRevision') || '')) {
                    notify('Інша вкладка вже почала нового клієнта. Оновіть сторінку перед створенням продажу.', 'info');
                    return;
                }
                const payload = createDraft()?.payload || (state.saleMode === 'catalog_sale' ? buildCatalogSalePayload() : buildAdmissionTicketPayload());
                const idempotencyKey = getCreateIdempotencyKey();
                window.localStorage.setItem(storageKey('createDraft'), JSON.stringify({ ...createDraft(), payload }));
                const endpoint = state.saleMode === 'catalog_sale'
                    ? '/api/payments/catalog/orders'
                    : '/api/payments/admission-ticket/orders';
                const result = await apiRequest(endpoint, {
                    method: 'POST',
                    headers: apiHeaders(idempotencyKey),
                    body: JSON.stringify(payload)
            });
            const orderId = result.order?.id;
            if (!orderId) throw new Error('payment_order_missing_in_response');
            storageSet('lastOrderId', orderId);
            invalidateInteractionRequests();
            await loadPaymentOrder(orderId, { silent: true });
            notify(result.replayed ? 'Цю саму оплату безпечно відкрито повторно.' : 'Оплату створено. Перевірте позиції та підтвердьте отримання грошей.', 'success');
            focusFirstConfirmationControl();
            });
        } catch (error) {
            if ([400, 403, 404, 422].includes(Number(error?.status)) && !storageGet('lastOrderId')) clearCreateIdempotencyKey();
            notify(paymentUiError(error), 'error');
        } finally {
            state.createInFlight = false;
            syncCreateAvailability();
        }
    }

    async function loadPaymentOrder(orderId, { silent = false } = {}) {
        const requestedOrderId = String(orderId || '');
        const contextKey = `${interactionContextKey()}:order:${requestedOrderId}`;
        if (state.orderRequest?.key === contextKey) return state.orderRequest.promise;
        const loadGeneration = ++state.orderLoadGeneration;
        const interactionGeneration = state.interactionGeneration;
        const request = (async () => {
            const result = await apiRequest(`/api/payments/orders/${encodeURIComponent(requestedOrderId)}`, {
                method: 'GET',
                headers: apiHeaders(),
                cache: 'no-store'
            });
            if (loadGeneration !== state.orderLoadGeneration
                || interactionGeneration !== state.interactionGeneration
                || contextKey !== `${interactionContextKey()}:order:${requestedOrderId}`) {
                return state.orderDetails;
            }
            if (String(result.order?.id || '') !== requestedOrderId) throw new Error('payment_order_identity_mismatch');
            const currentOrder = state.orderDetails?.order;
            if (String(currentOrder?.id || '') === requestedOrderId
                && FISCAL_DONE_STATUSES.has(effectiveFiscalStatus(currentOrder))
                && !FISCAL_DONE_STATUSES.has(effectiveFiscalStatus(result.order))) {
                return state.orderDetails;
            }
            state.orderDetails = result;
            state.tender = result.order?.sourceSnapshot?.tender || (result.order?.paymentMethod === 'card_terminal' ? 'card_terminal_manual' : 'cash');
            if (orderPaymentConfirmed(result.order) || normalizeStatus(result.order?.status) === 'cancelled') {
                state.confirmOutcomePending = false;
                state.paymentErrorActive = false;
            }
            state.confirmSubmitted = state.confirmOutcomePending || orderBlocksPayment(result.order);
            const orderChanged = String(currentOrder?.id || '') !== requestedOrderId;
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
            if (loadGeneration !== state.orderLoadGeneration || interactionGeneration !== state.interactionGeneration) return state.orderDetails;
            await loadUnresolvedOrders({ silent: true });
            if (loadGeneration !== state.orderLoadGeneration || interactionGeneration !== state.interactionGeneration) return state.orderDetails;
            state.pollingErrorBackoffMs = POLLING_RECOVERY_INTERVAL_MS;
            syncOrderPolling(result.order);
            if (FISCAL_DONE_STATUSES.has(effectiveFiscalStatus(result.order))) refreshReceiptHistoryIfVisible();
            if (!silent) notify('Оплату завантажено.', 'success');
            return result;
        })();
        state.orderRequest = { key: contextKey, promise: request };
        try {
            return await request;
        } finally {
            if (state.orderRequest?.promise === request) state.orderRequest = null;
        }
    }

    async function loadPilotRegisterState({ silent = false } = {}) {
        const loadGeneration = ++state.readinessLoadGeneration;
        const contextKey = readinessContextKey();
        try {
            const params = readinessRouteParams();
            const result = await apiRequest(`/api/payments/pilot-register-state?${params.toString()}`, {
                method: 'GET',
                headers: apiHeaders(),
                timeoutMs: READINESS_REQUEST_TIMEOUT_MS
            });
            if (loadGeneration !== state.readinessLoadGeneration || contextKey !== readinessContextKey()) {
                return state.registerState;
            }
            state.registerState = result;
            renderRegisterState(result);
            if (!silent) notify('Стан каси оновлено.', 'success');
            return result;
        } catch (error) {
            if (loadGeneration !== state.readinessLoadGeneration || contextKey !== readinessContextKey()) {
                return state.registerState;
            }
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
            const cashierBindingId = selectedCashierBindingId();
            await apiRequest('/api/payments/readiness/probe', {
                method: 'POST',
                headers: apiHeaders(),
                body: JSON.stringify({
                    businessContext: PILOT_SCOPE.crmProfileKey,
                    routeOptionId: PILOT_SCOPE.routeOptionId,
                    ...(cashierBindingId ? { cashierBindingId } : {}),
                    requiredTender: state.tender,
                    force
                }),
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
            renderServiceOutPanel();
            scheduleReadinessRefresh();
        }
    }

    function focusFirstConfirmationControl() {
        const target = state.tender === 'card_terminal_manual' ? $('terminalSuccessCheckbox') : $('cashReceivedAmount');
        target?.focus?.({ preventScroll: true });
    }

    function focusFiscalResult() {
        const panel = $('fiscalResultPanel');
        if (!panel) return;
        panel.setAttribute('tabindex', '-1');
        panel.focus({ preventScroll: true });
    }

    function clearOrderPolling() {
        if (state.pollingTimer) window.clearTimeout(state.pollingTimer);
        state.pollingTimer = null;
        state.pollingOrderId = null;
        state.pollingStartedAt = 0;
        state.pollingErrorBackoffMs = POLLING_RECOVERY_INTERVAL_MS;
    }

    function pauseOrderPolling() {
        if (state.pollingTimer) window.clearTimeout(state.pollingTimer);
        state.pollingTimer = null;
    }

    function isFiscalTerminal(order = state.orderDetails?.order) {
        return FISCAL_TERMINAL_STATUSES.has(effectiveFiscalStatus(order));
    }

    function shouldPollOrder(order = state.orderDetails?.order) {
        if (!order?.id) return false;
        if (!PAYMENT_TERMINAL_STATUSES.has(normalizeStatus(order.paymentStatus))) return false;
        if (normalizeStatus(state.orderDetails?.progress?.stage) === 'attention_required') return false;
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
        state.pollingErrorBackoffMs = POLLING_RECOVERY_INTERVAL_MS;
        scheduleOrderPoll();
    }

    function scheduleOrderPoll({ delayMs = null } = {}) {
        if (!state.pollingOrderId || !pageIsVisible()) return;
        const elapsedMs = Math.max(0, Date.now() - state.pollingStartedAt);
        const nextDelayMs = delayMs == null && elapsedMs >= POLLING_FAST_WINDOW_MS
            ? POLLING_RECOVERY_INTERVAL_MS
            : (delayMs == null ? POLLING_INTERVAL_MS : Number(delayMs));
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
                state.pollingErrorBackoffMs = Math.min(
                    UNRESOLVED_REFRESH_MAX_MS,
                    Math.max(POLLING_RECOVERY_INTERVAL_MS, state.pollingErrorBackoffMs * 2)
                );
                scheduleOrderPoll({ delayMs: state.pollingErrorBackoffMs });
            }
        }, Math.max(100, nextDelayMs));
    }

    function paymentUiError(error) {
        const code = error?.code || error?.message;
        const details = error?.details && typeof error.details === 'object' ? error.details : {};
        const unreportedPermissions = Array.isArray(details.unreportedPaymentPermissions)
            ? details.unreportedPaymentPermissions
            : [];
        const permissionLabels = unreportedPermissions.map(permission => ({
            cash_payment: 'готівку',
            card_payment: 'картку'
        }[permission] || permission));
        const deniedPermissions = Array.isArray(details.deniedPaymentPermissions)
            ? details.deniedPaymentPermissions
            : [];
        const deniedLabels = deniedPermissions.map(permission => ({
            cash_payment: 'готівку',
            card_payment: 'картку',
            sales: 'продажі'
        }[permission] || permission));
        const messages = {
            shared_test_register_draining: 'Нові оплати PARK і ДАР зупинені до початку наступного тестового дня.',
            shared_test_provider_read_access_required: 'Потрібен чинний доступ для перевірки Checkbox. Заборону не знято; відповідальний має перевірити підключення.',
            shared_test_provider_evidence_invalid: 'Свіже підтвердження стану Checkbox не отримано. Оновіть стан і повторіть перевірку.',
            shared_test_drain_not_closed: 'Спочатку дочекайтеся підтвердженого закриття зміни.',
            shared_test_close_not_verified: 'Закриття зміни ще не підтверджене. Приймання оплат залишається зупиненим.',
            shared_test_resume_blocked_unresolved: 'У касі залишилися незавершені операції. Відновлення заблоковано.',
            shared_test_owner_mismatch: 'Дію має підтвердити відповідальний, який зупинив цю тестову касу.',
            shared_test_scope_mismatch: 'Маршрут або налаштування тестової каси не збігаються. Потрібна перевірка відповідального.',
            shared_test_scope_changed: 'Налаштування каси змінилися. Дію не виконано; потрібна повторна перевірка.',
            shared_test_other_shift_exists: 'Виявлено іншу зміну. Відновлення заблоковано до звірки.',
            shared_test_idempotency_conflict: 'Повторний запит не відповідає попередній дії. Оновіть стан каси.',
            cash_amount_invalid: 'Сума готівки має бути у гривнях, максимум з двома знаками після коми.',
            cash_received_too_low: 'Отримана готівка менша за суму оплати. Підтвердження заблоковано.',
            payment_date_required: 'Вкажіть дату квитка.',
            cashier_binding_required: 'Оберіть активного касира Checkbox.',
            cashier_binding_scope_invalid: 'Обраний касир не належить цій касі або вже не активний.',
            checkbox_integration_not_ready: 'Інтеграція Checkbox або налаштування каси не готові. Підтвердження грошей заблоковано.',
            checkbox_integration_disabled: 'Зв’язок із Checkbox вимкнений. Приймання грошей недоступне.',
            checkbox_payment_acceptance_disabled: 'Приймання нових оплат вимкнене. Уже оплачені чеки залишаються у відновленні.',
            readiness_stale: 'Перевірка каси застаріла. Оновіть готовність Checkbox перед оплатою.',
            checkbox_provider_unavailable: 'Checkbox тимчасово недоступний. Нові оплати заблоковано.',
            checkbox_cashier_permissions_missing: deniedLabels.length
                ? `Checkbox відхилив право касира на ${deniedLabels.join(' і ')}. Відповідальний має перевірити права касира у Checkbox.`
                : 'Checkbox не підтвердив право касира на вибраний спосіб оплати. Відповідальний має перевірити права касира у Checkbox.',
            checkbox_cashier_permissions_malformed: 'Checkbox повернув неочікуваний формат прав касира. Приймання оплати заблоковано до перевірки відповідальним.',
            checkbox_payment_permission_unreported: permissionLabels.length
                ? `Checkbox не повідомив право касира на ${permissionLabels.join(' і ')}. Оновлення сторінки це не виправить; потрібна перевірка прав у Checkbox.`
                : 'Checkbox не повідомив право касира на вибраний спосіб оплати. Потрібна перевірка прав у Checkbox.',
            fiscal_binding_capability_denied: 'Локальна прив’язка касира не дозволяє цю фіскальну дію. Потрібна перевірка прив’язки касира.',
            service_out_amount_required: 'Вкажіть суму службової видачі у гривнях.',
            service_out_reason_required: 'Вкажіть причину службової видачі.',
            service_out_not_found: 'Service-out запит не знайдено або він недоступний для цього користувача.',
            service_out_not_pending_approval: 'Цей service-out уже не очікує погодження.',
            service_out_cancel_denied: 'Скасувати service-out може лише касир, який створив цей запит.',
            service_out_cancel_forbidden: 'Service-out уже погоджений або переданий у чергу Checkbox; скасування заблоковано.',
            service_out_cancel_conflict: 'Стан service-out змінився під час скасування. Оновіть список.',
            service_out_idempotency_conflict: 'Повторний service-out запит не збігається з попереднім. Оновіть сторінку перед новою дією.',
            service_out_route_scope_mismatch: 'Service-out не збігається з обраною касою або напрямком.',
            park_dar_test_service_out_scope_invalid: 'Service-out у test-only режимі дозволений тільки для точної тестової каси PARK/ДАР.',
            action_pin_required: 'Введіть Action PIN відповідального.',
            action_pin_format_invalid: 'PIN має містити тільки 4–12 цифр.',
            action_pin_confirmation_mismatch: 'Повтор PIN не збігається.',
            action_pin_self_enrollment_denied: 'Адміністратор не може встановити PIN для власної прив’язки.',
            action_pin_locked: 'PIN тимчасово заблокований після невдалих спроб.',
            action_pin_invalid: 'PIN не підтверджено. Перевірте введення або зверніться до відповідального.',
            payment_tender_required: 'Оберіть спосіб оплати перед перевіркою готовності або підтвердженням.',
            payment_tender_unsupported: 'Обраний спосіб оплати не підтримується для цієї каси.',
            payment_confirmation_outcome_unknown: 'Результат підтвердження уточнюється. Не повторюйте оплату і не скасовуйте чернетку, доки відповідальний не звірить стан.',
            external_shift_requires_sync: 'У Checkbox є інша відкрита зміна. Потрібна безпечна звірка відповідальним.',
            kids_count_invalid: 'Кількість дітей має бути більшою за нуль.',
            adults_count_invalid: 'Кількість дорослих не може бути від’ємною.',
            catalog_items_required: 'Додайте хоча б одну позицію каталогу.',
            catalog_items_unavailable: 'Для цього бізнесу немає доступних позицій каталогу.',
            catalog_item_unavailable: 'Позиція неактивна, має нульову або неоднозначну ціну.',
            catalog_quantity_invalid: 'Перевірте кількість: для цієї позиції діє мінімум і крок продажу.',
            catalog_discount_invalid: 'Обране правило знижки недоступне.',
            fiscal_route_option_invalid: 'Оберіть доступну касу.',
            fiscal_route_options_unavailable: 'Для вас немає доступних налаштованих кас.',
            fiscal_route_change_blocked_by_order: 'Спочатку завершіть або скасуйте поточну оплату, потім змінюйте касу.',
            fiscal_route_mapping_missing: 'Обрана каса ще не налаштована.',
            fiscal_route_feature_disabled: 'Обрана каса вимкнена для продажів.',
            fiscal_route_acceptance_disabled: 'Приймання оплат для цієї каси ще не активоване.',
            fiscal_route_mode_mismatch: 'Фактичний test/production режим каси не збігається з обраним.',
            shared_test_register_owned_by_other_business: 'Спільна тестова каса зараз використовується іншим напрямком.',
            shared_test_register_recovery_incomplete: 'Перед переключенням тестової каси треба завершити попередню зміну й відновлення.',
            local_qa_identity_not_confirmed: 'LOCAL QA не підтверджений сервером. Продаж заблоковано.',
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
            phase1_close_requires_payment_drain: 'Закриття зміни заблоковане, доки адміністратор не вимкне приймання нових оплат і система не підтвердить порожню чергу чеків.',
            phase1_close_confirmation_unavailable: 'Безпечне підтвердження тимчасово недоступне. Запит на закриття не надіслано.'
        };
        return messages[code] || 'Не вдалося виконати дію. Оновіть стан каси або зверніться до відповідального.';
    }

    function renderOrder(details) {
        const order = details?.order || null;
        const items = Array.isArray(details?.items) ? details.items : [];
        if (!order) return;
        setText('cashierFiscalProfile', `${formatCrmProfile(order.crmProfileKey)} / ${order.legalEntityName || order.legalEntityKey || '\u0424\u041e\u041f \u043d\u0435 \u043d\u0430\u043b\u0430\u0448\u0442\u043e\u0432\u0430\u043d\u043e'}`);
        setText('cashierRegister', `${PILOT_SCOPE.businessLabel} / ${selectedRoute()?.registerLabel || order.registerDisplayName || 'каса'}`);
        setStatus('cashierPaymentStatus', order.paymentStatus || order.status);
        setStatus('cashierFiscalStatus', normalizeStatus(order.paymentStatus) === 'unpaid' ? 'not_created' : fiscalStatusForDisplay(order, details?.outboxJob?.lastErrorCode));
        const paymentConfirmed = orderPaymentConfirmed(order);
        setText('cashierHeroDescription', `Продаж RCP-${order.id}`);
        setText('paymentSnapshotTitle', paymentConfirmed ? 'Поточний продаж' : 'Підтвердження грошей');
        setText('internalReceiptLabel', `RCP-${order.id} · ${INTERNAL_RECEIPT_TEXT}`);
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

    function progressMessage(progress = {}) {
        const stage = normalizeStatus(progress.stage);
        const labels = {
            awaiting_shift: 'Очікуємо підтвердження відкриття зміни Checkbox.',
            preparing: 'Сервер готує вже зафіксовану оплату до фіскалізації.',
            checking_readiness: 'Сервер перевіряє готовність каси для вже зафіксованої оплати.',
            validating: 'Сервер перевіряє дані вже зафіксованої оплати.',
            submitting: 'Запит на створення чека обробляється.',
            checking_receipt: 'Сервер звіряє стан вже надісланого чека.',
            awaiting_receipt: 'Checkbox ще обробляє чек; сервер продовжить перевірку.',
            attention_required: 'Автоматичне відновлення зупинене. Потрібне втручання адміністратора.'
        };
        if (!labels[stage]) return '';
        const nextCheck = progress.nextCheckAt ? ` Наступна серверна перевірка запланована на ${formatKyivDateTime(progress.nextCheckAt)}.` : '';
        const lastCheck = progress.lastCheckAt ? ` Остання підтверджена перевірка: ${formatKyivDateTime(progress.lastCheckAt)}.` : '';
        const attention = stage === 'attention_required' && progress.attentionReason
            ? ` Код: ${formatIncidentReason(progress.attentionReason)}.`
            : '';
        return `${labels[stage]}${lastCheck}${nextCheck}${attention}`;
    }

    function renderFiscalResult(details) {
        const order = details?.order || {};
        const hasOrder = Boolean(order.id);
        const fiscalStatus = effectiveFiscalStatus(order);
        const artifacts = details?.artifacts || {};
        const latestReceipt = Array.isArray(details?.receipts) ? details.receipts[0] : null;
        const serverProgressMessage = progressMessage(details?.progress);
        const displayStatus = fiscalStatusForDisplay(order, details?.outboxJob?.lastErrorCode);
        setStatus('fiscalReceiptBadge', hasOrder && normalizeStatus(order.paymentStatus) !== 'unpaid' ? displayStatus : 'not_created');
        const message = $('fiscalPendingMessage');
        const links = $('providerReceiptLinks');
        const pendingNotice = $('pendingReceiptNotice');
        const hasOfficialReceipt = FISCAL_DONE_STATUSES.has(fiscalStatus) || latestReceipt?.status === 'fiscalized';
        if (hasOfficialReceipt) {
            forgetPendingOrder(order.id);
            clearGlobalStatus();
        }
        if (message) {
            if (!hasOrder) message.textContent = 'Чек ще не створено. Спочатку створіть оплату для поточного клієнта.';
            else if (hasOfficialReceipt) message.textContent = 'Оплату завершено. Офіційний чек Checkbox отримано. Для нового продажу натисніть «Наступний клієнт».';
            else if (state.confirmOutcomePending) message.textContent = 'Результат підтвердження уточнюється. Не повторюйте оплату й не скасовуйте чернетку, доки відповідальний не звірить цей продаж.';
            else if (normalizeStatus(order.paymentStatus) === 'unpaid') message.textContent = 'Оплату ще не підтверджено. Перевірте суму та підтвердьте отримання грошей.';
            else if (serverProgressMessage) message.textContent = `${serverProgressMessage} Повторно оплачувати не потрібно.`;
            else if (displayStatus === 'awaiting_receipt' || fiscalStatus === 'pending') message.textContent = 'Оплату зафіксовано. Стадію обробки ще не повідомлено; стан перевіряється автоматично. Повторно оплачувати не потрібно.';
            else if (['failed_terminal', 'validation_failed', 'blocked', 'dead'].includes(fiscalStatus)) message.textContent = 'Потрібне втручання адміністратора. Гроші вже зафіксовані; повторно приймати оплату не можна.';
            else if (FISCAL_BLOCKING_STATUSES.has(fiscalStatus)) message.textContent = 'Гроші зафіксовані. Чек відновлюється; повторно приймати оплату не можна. Стан доступний у незавершених чеках.';
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
            ? `Незавершені чеки: ${ids.map(id => `RCP-${id}`).join(', ')}${remainingCount ? ` та ще ${remainingCount}` : ''}. ${recoverySubject} у серверній черзі нижче; повторну оплату для ${repeatSubject} не створюйте.`
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
        if (!state.unresolvedAutoRefreshEnabled || !pageIsVisible()) return;
        const refreshedAt = Number(state.unresolvedLastRefreshAt || 0);
        const untilStale = refreshedAt > 0
            ? Math.max(100, UNRESOLVED_QUEUE_TTL_MS - UNRESOLVED_REFRESH_LEAD_MS - Math.max(0, Date.now() - refreshedAt))
            : UNRESOLVED_REFRESH_MIN_MS;
        const pendingElapsedMs = state.unresolvedFastRefreshStartedAt
            ? Math.max(0, Date.now() - state.unresolvedFastRefreshStartedAt)
            : 0;
        let delay = Number(delayMs);
        if (delayMs == null && state.unresolvedQueueState === 'available' && state.unresolvedRegisterCount > 0) {
            delay = pendingElapsedMs < POLLING_FAST_WINDOW_MS ? POLLING_INTERVAL_MS : POLLING_RECOVERY_INTERVAL_MS;
        } else if (delayMs == null) {
            delay = state.unresolvedQueueState === 'available' ? untilStale : state.unresolvedRefreshBackoffMs;
        }
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
                <span class="cashier-status ${escapeAttribute(classifyStatus(fiscalStatusForDisplay(order)))}">${escapeHtml(formatStatus(fiscalStatusForDisplay(order)))}</span>
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
            `фіскалізація ${formatStatus(fiscalStatusForDisplay(order))}`,
            retry,
            incident ? `причина: ${incident}` : 'без зафіксованої причини інциденту'
        ].join('. ');
    }

    function unresolvedRequestIsCurrent(requestContext) {
        return requestContext.generation === state.unresolvedLoadGeneration
            && requestContext.interactionGeneration === state.interactionGeneration
            && requestContext.key === `${interactionContextKey()}:queue`;
    }

    function loadUnresolvedOrders({ silent = false, append = false } = {}) {
        const key = `${interactionContextKey()}:queue`;
        if (state.unresolvedRequest?.key === key) return state.unresolvedRequest.promise;
        const requestContext = {
            key,
            generation: ++state.unresolvedLoadGeneration,
            interactionGeneration: state.interactionGeneration
        };
        const promise = performLoadUnresolvedOrders({ silent, append }, requestContext);
        state.unresolvedRequest = { key, promise };
        return promise.finally(() => {
            if (state.unresolvedRequest?.promise === promise) state.unresolvedRequest = null;
        });
    }

    async function performLoadUnresolvedOrders({ silent = false, append = false } = {}, requestContext) {
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
            const params = routeQueryParams();
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
            if (!unresolvedRequestIsCurrent(requestContext)) return state.unresolvedOrders;
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
            state.unresolvedFastRefreshStartedAt = state.unresolvedRegisterCount > 0
                ? (state.unresolvedFastRefreshStartedAt || Date.now())
                : 0;
            if (!state.unresolvedHasMore) {
                replacePendingOrderIds(state.unresolvedOrders.map(order => order.id));
            }
            renderUnresolvedOrders();
            renderReadinessState();
            syncCreateAvailability();
            syncConfirmationAvailability();
            renderServiceOutPanel();
            if (!silent) notify('Чергу незавершених чеків оновлено.', 'success');
            return state.unresolvedOrders;
        } catch (error) {
            if (!unresolvedRequestIsCurrent(requestContext)) return state.unresolvedOrders;
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
            renderServiceOutPanel();
            return state.unresolvedOrders;
        } finally {
            if (unresolvedRequestIsCurrent(requestContext)) {
                state.unresolvedInFlight = false;
                syncUnresolvedControls();
                renderServiceOutPanel();
                if (restartAfterSnapshotChange && state.unresolvedSnapshotRestartPending) {
                    state.unresolvedSnapshotRestartPending = false;
                    window.setTimeout(() => { void loadUnresolvedOrders({ silent: true }); }, 0);
                } else {
                    scheduleUnresolvedRefresh({ delayMs: retryDelayMs });
                }
            }
        }
    }

    function renderReceiptHistoryActions(order = {}) {
        if (state.localQa?.enabled === true) {
            return '<span class="cashier-history-empty-artifact">локальний mock-чек · зовнішні посилання вимкнено</span>';
        }
        const taxUrlTrusted = isTrustedCheckboxUrl(order.providerTaxUrl);
        const links = [
            { href: taxUrlTrusted ? order.providerTaxUrl : null, label: 'Чек' },
            { href: order.providerPdfUrl, label: 'PDF' },
            { href: order.providerQrUrl, label: 'QR' }
        ].filter(link => isTrustedCheckboxUrl(link.href));
        if (!links.length) return '<span class="cashier-history-empty-artifact">офіційний артефакт ще недоступний</span>';
        return `<span class="cashier-history-actions">${links.map(link => `<a class="btn-page-secondary cashier-history-link" target="_blank" rel="noopener" href="${escapeAttribute(link.href)}">${escapeHtml(link.label)}</a>`).join('')}</span>`;
    }

    function kyivIsoDate(now = new Date()) {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/Kyiv',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(now);
    }

    function shiftIsoDate(isoDate, days) {
        const [year, month, day] = String(isoDate || '').split('-').map(Number);
        if (![year, month, day].every(Number.isFinite)) return isoDate;
        return new Date(Date.UTC(year, month - 1, day + Number(days || 0))).toISOString().slice(0, 10);
    }

    function formatIsoDate(isoDate) {
        const [year, month, day] = String(isoDate || '').split('-');
        return year && month && day ? `${day}.${month}.${year}` : 'дату не задано';
    }

    function receiptHistorySnapshot({ page = state.reportPage } = {}) {
        return {
            interactionGeneration: state.interactionGeneration,
            businessContext: PILOT_SCOPE.crmProfileKey,
            routeOptionId: PILOT_SCOPE.routeOptionId,
            period: state.reportPeriod,
            dateFrom: $('checkboxReportDateFrom')?.value || '',
            dateTo: $('checkboxReportDateTo')?.value || '',
            shiftId: $('checkboxReportShiftId')?.value || '',
            cashierUserId: $('checkboxReportCashierUserId')?.value || '',
            page: Math.max(1, Number(page || 1)),
            pageSize: RECEIPT_HISTORY_PAGE_SIZE
        };
    }

    function receiptHistorySnapshotKey(snapshot, { includePage = true } = {}) {
        const values = [
            snapshot.interactionGeneration,
            snapshot.businessContext,
            snapshot.routeOptionId,
            snapshot.dateFrom,
            snapshot.dateTo,
            snapshot.shiftId,
            snapshot.cashierUserId
        ];
        if (includePage) values.push(snapshot.page, snapshot.pageSize);
        return values.join('|');
    }

    function receiptHistoryRequestIsCurrent(requestContext) {
        return requestContext.generation === state.reportLoadGeneration
            && requestContext.snapshot.interactionGeneration === state.interactionGeneration
            && requestContext.key === receiptHistorySnapshotKey(receiptHistorySnapshot({ page: requestContext.snapshot.page }));
    }

    function receiptHistoryFilterLabel(snapshot) {
        const scope = `${snapshot.businessContext === 'dar' ? 'ДАР' : 'ПАРК'} · ${PILOT_SCOPE.registerLabel || 'поточна каса'}`;
        const period = snapshot.period === 'today'
            ? `Сьогодні, ${formatIsoDate(snapshot.dateFrom)}`
            : snapshot.period === 'yesterday'
                ? `Вчора, ${formatIsoDate(snapshot.dateFrom)}`
                : `${formatIsoDate(snapshot.dateFrom)} — ${formatIsoDate(snapshot.dateTo)}`;
        const extra = [
            snapshot.shiftId ? `зміна ${snapshot.shiftId}` : '',
            snapshot.cashierUserId ? `користувач CRM ${snapshot.cashierUserId}` : ''
        ].filter(Boolean).join(' · ');
        return `${scope} · ${period}${extra ? ` · ${extra}` : ''}`;
    }

    function syncReceiptHistoryPeriodControls() {
        document.querySelectorAll('[data-history-period]').forEach(button => {
            const active = button.dataset.historyPeriod === state.reportPeriod;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        $('checkboxReportCustomDates')?.classList.toggle('hidden', state.reportPeriod !== 'custom');
    }

    function renderReceiptHistoryAppliedFilter(snapshot = receiptHistorySnapshot()) {
        setText('checkboxReportAppliedFilter', receiptHistoryFilterLabel(snapshot));
    }

    function resetReceiptHistoryForScope() {
        state.reportLoadGeneration += 1;
        state.reportRequest = null;
        state.reportInFlight = false;
        state.reportPage = 1;
        state.reportTotalCount = 0;
        state.reportAppliedSnapshot = null;
        state.reportRenderedSnapshotKey = null;
        state.reportLastError = null;
        state.receiptHistoryLoaded = false;
        state.lastReportRefreshAt = null;
        const body = $('checkboxSalesReportBody');
        if (body) {
            body.classList.remove('is-stale', 'is-error');
            body.removeAttribute('aria-busy');
            body.textContent = 'Відкрийте історію, щоб завантажити чеки.';
        }
        setText('checkboxSalesReportSummaryBadge', 'Продажі Checkbox · лише перегляд');
        setText('checkboxReportRefreshStatus', '');
        $('checkboxReportPagination')?.classList.add('hidden');
        renderReceiptHistoryAppliedFilter();
    }

    function applyReceiptHistoryPeriod(period, { load = true, focusDates = false } = {}) {
        if (!['today', 'yesterday', 'custom'].includes(period)) return;
        state.reportPeriod = period;
        const today = kyivIsoDate();
        if (period === 'today' || period === 'yesterday') {
            const value = period === 'today' ? today : shiftIsoDate(today, -1);
            if ($('checkboxReportDateFrom')) $('checkboxReportDateFrom').value = value;
            if ($('checkboxReportDateTo')) $('checkboxReportDateTo').value = value;
        }
        syncReceiptHistoryPeriodControls();
        if (focusDates && period === 'custom') $('checkboxReportDateFrom')?.focus({ preventScroll: true });
        handleReceiptHistoryFilterChange({ load });
    }

    function normalizeReceiptHistoryDateRange(changedId = '') {
        const from = $('checkboxReportDateFrom');
        const to = $('checkboxReportDateTo');
        if (!from || !to) return;
        if (from.value && to.value && from.value > to.value) {
            if (changedId === 'checkboxReportDateTo') from.value = to.value;
            else to.value = from.value;
        }
        to.min = from.value || '';
        from.max = to.value || '';
    }

    function handleReceiptHistoryFilterChange({ load = true, changedId = '' } = {}) {
        normalizeReceiptHistoryDateRange(changedId);
        state.reportPage = 1;
        const snapshot = receiptHistorySnapshot();
        const nextKey = receiptHistorySnapshotKey(snapshot);
        if (state.reportRequest && state.reportRequest.key !== nextKey) {
            state.reportLoadGeneration += 1;
            state.reportRequest = null;
        }
        if (state.reportRenderedSnapshotKey !== nextKey) {
            state.receiptHistoryLoaded = false;
            const body = $('checkboxSalesReportBody');
            if (body) {
                body.classList.remove('is-stale', 'is-error');
                body.textContent = $('checkboxSalesReportPanel')?.open
                    ? 'Завантажуємо чеки за новим фільтром…'
                    : 'Відкрийте історію, щоб завантажити чеки.';
            }
            $('checkboxReportPagination')?.classList.add('hidden');
        }
        renderReceiptHistoryAppliedFilter(snapshot);
        if (load && $('checkboxSalesReportPanel')?.open && state.routeReady) {
            void loadCheckboxSalesReport({ silent: true });
        }
    }

    function renderReceiptHistoryRow(order = {}) {
        const fiscalStatus = effectiveFiscalStatus(order);
        const displayStatus = fiscalStatusForDisplay(order);
        const recoveryText = FISCAL_DONE_STATUSES.has(fiscalStatus) ? '' : formatRecoveryText(order);
        const historicalIncident = FISCAL_DONE_STATUSES.has(normalizeStatus(order.fiscalStatus)) && order.incidentReason
            ? `<p class="cashier-history-note">Чек завершено; лишився окремий запис контролю: ${escapeHtml(formatIncidentReason(order.incidentReason))}</p>`
            : '';
        const confirmedAt = order.confirmedAt ? formatKyivDateTime(order.confirmedAt) : 'час не підтверджено';
        return `
            <article class="cashier-history-item" aria-label="Продаж RCP-${escapeAttribute(order.id)}, ${escapeAttribute(confirmedAt)}">
                <span class="cashier-history-cell cashier-history-time"><small>Час</small><time datetime="${escapeAttribute(order.confirmedAt || '')}">${escapeHtml(confirmedAt)}</time></span>
                <span class="cashier-history-cell cashier-receipt-id"><small>Продаж CRM</small><strong>RCP-${escapeHtml(order.id)}</strong></span>
                <span class="cashier-history-cell"><small>Оплата</small><span>${escapeHtml(formatPaymentMethod(order.paymentMethod))}</span></span>
                <span class="cashier-history-cell cashier-receipt-money"><small>Сума</small><strong>${escapeHtml(formatMoneyMinor(order.totalAmountMinor))}</strong></span>
                <span class="cashier-history-cell cashier-history-status"><small>Статус чека</small><span class="cashier-status ${escapeAttribute(classifyStatus(displayStatus))}">${escapeHtml(formatStatus(displayStatus))}</span>${recoveryText ? `<span class="cashier-recovery-text">${escapeHtml(recoveryText)}</span>` : ''}</span>
                <span class="cashier-history-cell cashier-history-documents"><small>Документи</small>${renderReceiptHistoryActions(order)}</span>
                ${historicalIncident}
            </article>
        `;
    }

    function renderReceiptHistoryPagination({ page, pageSize, totalCount }) {
        const pagination = $('checkboxReportPagination');
        if (!pagination) return;
        if (totalCount <= 0) {
            pagination.classList.add('hidden');
            setText('checkboxReportRange', '0 записів');
            return;
        }
        const start = (page - 1) * pageSize + 1;
        const end = Math.min(totalCount, page * pageSize);
        pagination.classList.remove('hidden');
        setText('checkboxReportRange', `${start}–${end} із ${totalCount}`);
        const previous = $('checkboxReportPreviousPage');
        const next = $('checkboxReportNextPage');
        if (previous) previous.disabled = state.reportInFlight || page <= 1;
        if (next) next.disabled = state.reportInFlight || end >= totalCount;
    }

    function renderCheckboxSalesReport(report, snapshot = receiptHistorySnapshot()) {
        const body = $('checkboxSalesReportBody');
        if (!body) return;
        if (!report) {
            body.textContent = 'Відкрийте історію, щоб завантажити чеки.';
            return;
        }
        const totals = report.totals || {};
        const counts = totals.statusCounts || {};
        const orders = Array.isArray(report.orders) ? report.orders : [];
        const totalCount = Number(report.totalCount || orders.length || 0);
        const page = Number(report.page || 1);
        const pageSize = Number(report.pageSize || orders.length || RECEIPT_HISTORY_PAGE_SIZE);
        const processingCount = Number(counts.pending || 0)
            + Number(counts.sending || 0)
            + Number(counts.validating || 0)
            + Number(counts.ready_to_send || 0)
            + Number(counts.failed_retryable || 0);
        const unknownCount = Number(counts.unknown || 0);
        const stoppedCount = Number(counts.dead || 0)
            + Number(counts.failed_terminal || 0)
            + Number(counts.blocked || 0)
            + Number(counts.validation_failed || 0)
            + Number(counts.cancelled || 0);
        state.receiptHistoryLoaded = true;
        state.lastReportRefreshAt = Date.now();
        state.reportPage = page;
        state.reportPageSize = pageSize;
        state.reportTotalCount = totalCount;
        state.reportAppliedSnapshot = { ...snapshot, page, pageSize };
        state.reportRenderedSnapshotKey = receiptHistorySnapshotKey(state.reportAppliedSnapshot);
        state.reportLastError = null;
        const badge = $('checkboxSalesReportSummaryBadge');
        if (badge) badge.textContent = totalCount ? `${totalCount} чеків · лише перегляд` : 'чеків немає · лише перегляд';
        body.classList.remove('is-stale', 'is-error');
        body.innerHTML = `
            <dl class="cashier-history-totals" aria-label="Підсумки за всім фільтром">
                <div><dt>Всього</dt><dd>${escapeHtml(formatMoneyMinor(totals.paymentTotalMinor || 0))}</dd></div>
                <div><dt>Готівка</dt><dd>${escapeHtml(formatMoneyMinor(totals.cashTotalMinor || 0))}</dd></div>
                <div><dt>Термінал</dt><dd>${escapeHtml(formatMoneyMinor(totals.cardTerminalTotalMinor || 0))}</dd></div>
                <div><dt>Чек створено</dt><dd>${Number(counts.fiscalized || 0)}</dd></div>
                <div class="${processingCount ? 'has-warning' : ''}"><dt>В обробці</dt><dd>${processingCount}</dd></div>
                <div class="${unknownCount ? 'has-danger' : ''}"><dt>Невідомо</dt><dd>${unknownCount}</dd></div>
                <div class="${stoppedCount ? 'has-danger' : ''}"><dt>Зупинено</dt><dd>${stoppedCount}</dd></div>
            </dl>
            <p class="cashier-history-total-note">Суми за всім фільтром, не лише за поточною сторінкою.</p>
            <div class="cashier-history-list" aria-label="Історія чеків цієї каси">
                ${orders.map(order => renderReceiptHistoryRow(order)).join('') || '<p class="cashier-empty">За цим фільтром чеків немає.</p>'}
            </div>`;
        renderReceiptHistoryAppliedFilter(state.reportAppliedSnapshot);
        setText('checkboxReportRefreshStatus', `Оновлено ${formatKyivDateTime(new Date().toISOString())}.`);
        renderReceiptHistoryPagination({ page, pageSize, totalCount });
        // Receipt history is informative only. The canonical unresolved queue owns pending membership.
        renderPendingOrdersNotice();
    }

    function loadCheckboxSalesReport({ silent = false, page = state.reportPage } = {}) {
        const snapshot = receiptHistorySnapshot({ page });
        const key = receiptHistorySnapshotKey(snapshot);
        if (state.reportRequest?.key === key) return state.reportRequest.promise;
        const requestContext = {
            key,
            generation: ++state.reportLoadGeneration,
            snapshot
        };
        const promise = performLoadCheckboxSalesReport({ silent }, requestContext);
        state.reportRequest = { key, promise };
        return promise.finally(() => {
            if (state.reportRequest?.promise === promise) state.reportRequest = null;
        });
    }

    async function performLoadCheckboxSalesReport({ silent = false } = {}, requestContext) {
        state.reportInFlight = true;
        const button = $('loadCheckboxSalesReportBtn');
        const body = $('checkboxSalesReportBody');
        const preservePrevious = state.receiptHistoryLoaded
            && state.reportRenderedSnapshotKey === requestContext.key;
        setButtonBusy(button, true, 'Оновлюємо…');
        renderReceiptHistoryPagination({
            page: state.reportPage,
            pageSize: state.reportPageSize,
            totalCount: state.reportTotalCount
        });
        if (body) {
            body.setAttribute('aria-busy', 'true');
            body.classList.toggle('is-stale', preservePrevious);
            body.classList.remove('is-error');
            if (!preservePrevious) body.textContent = 'Завантажуємо історію чеків…';
        }
        setText('checkboxReportRefreshStatus', preservePrevious ? 'Оновлюємо; показано попередні дані.' : 'Завантажуємо…');
        try {
            const params = routeQueryParams();
            const { dateFrom, dateTo, shiftId, cashierUserId, page, pageSize } = requestContext.snapshot;
            if (dateFrom) params.set('dateFrom', dateFrom);
            if (dateTo) params.set('dateTo', dateTo);
            if (shiftId) params.set('shiftId', shiftId);
            if (cashierUserId) params.set('cashierUserId', cashierUserId);
            if (page) params.set('page', page);
            params.set('pageSize', pageSize);
            const result = await apiRequest(`/api/payments/checkbox-sales-report?${params.toString()}`, {
                method: 'GET',
                headers: apiHeaders()
            });
            if (!receiptHistoryRequestIsCurrent(requestContext)) return;
            renderCheckboxSalesReport(result, requestContext.snapshot);
            if (!silent) notify('Історію чеків завантажено.', 'success');
        } catch (error) {
            if (!receiptHistoryRequestIsCurrent(requestContext)) return;
            state.reportLastError = { code: error?.code || error?.name || 'history_unavailable' };
            if (body && preservePrevious) {
                body.classList.add('is-stale', 'is-error');
                setText('checkboxReportRefreshStatus', 'Не вдалося оновити. Показано попередні дані; вони можуть бути неактуальними.');
            } else if (body) {
                state.receiptHistoryLoaded = false;
                body.classList.add('is-error');
                body.textContent = 'Не вдалося завантажити історію чеків. Дані не вважаються порожніми; спробуйте ще раз.';
                setText('checkboxReportRefreshStatus', 'Історія недоступна.');
                $('checkboxReportPagination')?.classList.add('hidden');
            }
            if (!silent) notify(paymentUiError(error), 'error');
        } finally {
            if (receiptHistoryRequestIsCurrent(requestContext)) {
                state.reportInFlight = false;
                setButtonBusy(button, false, '');
                if (button) button.disabled = false;
                if (body) body.setAttribute('aria-busy', 'false');
                renderReceiptHistoryPagination({
                    page: state.reportPage,
                    pageSize: state.reportPageSize,
                    totalCount: state.reportTotalCount
                });
            }
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
        const visible = state.localQa?.enabled !== true && isTrustedCheckboxUrl(href);
        el.classList.toggle('hidden', !visible);
        if (visible) el.href = href;
        else el.removeAttribute('href');
    }

    function refreshReceiptHistoryIfVisible() {
        const panel = $('checkboxSalesReportPanel');
        if (!panel?.open && !state.receiptHistoryLoaded) return;
        void loadCheckboxSalesReport({ silent: true });
    }

    function loadReceiptHistoryOnOpen() {
        const panel = $('checkboxSalesReportPanel');
        if (!panel?.open || !state.routeReady) return;
        const snapshot = receiptHistorySnapshot();
        if (state.receiptHistoryLoaded
            && state.reportRenderedSnapshotKey === receiptHistorySnapshotKey(snapshot)) return;
        void loadCheckboxSalesReport({ silent: true });
    }

    function changeReceiptHistoryPage(direction) {
        if (state.reportInFlight) return;
        const nextPage = state.reportPage + direction;
        const maxPage = Math.max(1, Math.ceil(state.reportTotalCount / state.reportPageSize));
        if (nextPage < 1 || nextPage > maxPage) return;
        state.reportPage = nextPage;
        void loadCheckboxSalesReport({ silent: true, page: nextPage });
    }

    function renderRegisterState(result) {
        if (!result) {
            setText('cashierFiscalProfile', state.orderDetails?.order ? $('cashierFiscalProfile')?.textContent : '—');
            setText('cashierRegister', state.orderDetails?.order ? $('cashierRegister')?.textContent : '—');
            renderReadinessState();
            syncCreateAvailability();
            syncConfirmationAvailability();
            renderPhase1ShiftState();
            renderServiceOutPanel();
            renderActionPinPanel();
            renderCompactContext();
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
        renderServiceOutPanel();
        renderActionPinPanel();
        renderCompactContext();
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

    function orderPaymentConfirmed(order = state.orderDetails?.order) {
        if (!order) return false;
        return normalizeStatus(order.paymentStatus) === 'confirmed'
            || normalizeStatus(order.status) === 'payment_recorded';
    }

    function isDefinitePaymentRejection(error) {
        const status = Number(error?.status || 0);
        if (status >= 500) return false;
        const code = String(error?.code || error?.message || '').trim();
        return KNOWN_PRE_PAYMENT_REJECTION_CODES.has(code);
    }

    function orderIsUnpaidDraft(order = state.orderDetails?.order) {
        return Boolean(order?.id
            && normalizeStatus(order.paymentStatus) === 'unpaid'
            && normalizeStatus(order.status) === 'draft');
    }

    function orderIsComplete(order = state.orderDetails?.order) {
        if (!order) return false;
        return FISCAL_DONE_STATUSES.has(effectiveFiscalStatus(order))
            || normalizeStatus(order.status) === 'cancelled'
            || effectiveFiscalStatus(order) === 'not_required';
    }

    function integrationReady() {
        return Boolean(
            state.routeReady === true
            && state.registerState?.sharedTestDay?.localDrainBlocked !== true
            && state.routeLoading !== true
            && state.registerState?.integrationReady === true
            && readinessTenderMatches(state.registerState)
            && state.readinessInFlight !== true
            && state.nextCustomerSafetyRefreshInFlight !== true
            && unresolvedQueueIsFresh()
        );
    }

    function sharedTestDaySpecificReason(day) {
        const code = normalizeStatus(day?.reasonCode);
        if (!code || code === 'ready' || code === 'shared_test_register_draining') return '';
        return paymentUiError({ code });
    }

    function sharedTestDayProjection(day = state.registerState?.sharedTestDay) {
        if (day?.localDrainBlocked !== true) {
            return {
                blocked: false,
                notice: 'Завершення роботи зупиняє нові оплати обох тестових маршрутів. Відновлення не відкриває зміну та не вмикає вимкнені серверні налаштування.',
                reason: ''
            };
        }
        const specificReason = sharedTestDaySpecificReason(day);
        const reasonCode = normalizeStatus(day?.reasonCode);
        const activeStatus = normalizeStatus(day?.activeDrain?.status);
        if (activeStatus === 'closed') {
            if (day.canResume === true) {
                const text = 'Закриття тестової зміни підтверджене. Нові оплати PARK і ДАР зупинено до явної дії «Почати наступний тестовий день».';
                return { blocked: true, verifiedClosed: true, canResume: true, notice: text, reason: text };
            }
            if (reasonCode === 'shared_test_close_not_verified') {
                const text = `Закриття тестової зміни очікує підтвердження Checkbox. Нові оплати PARK і ДАР зупинено; початок наступного тестового дня недоступний.${specificReason ? ` ${specificReason}` : ''}`;
                return { blocked: true, pendingCloseProof: true, canResume: false, notice: text, reason: text };
            }
            const text = `Закриття тестової зміни зафіксоване локально, але початок наступного тестового дня зараз недоступний.${specificReason ? ` ${specificReason}` : ''}`;
            return { blocked: true, closedButBlocked: true, canResume: false, notice: text, reason: text };
        }
        const text = 'Приймання оплат зупинене для завершення тестового дня. Спочатку дочекайтеся завершення черги та підтвердженого закриття зміни.';
        return { blocked: true, draining: true, canResume: false, notice: text, reason: text };
    }

    function sharedTestDayBlockReason() {
        const day = state.registerState?.sharedTestDay;
        return sharedTestDayProjection(day).reason;
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
        if (state.confirmOutcomePending) return false;
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
        const warnings = [];
        if (!state.registerState) {
            messages.push('Не вдалося прочитати стан пілотної каси.');
        } else {
            const code = state.registerState.readinessCode || 'unknown';
            const readinessDetails = state.registerState.readiness || state.registerState;
            const unreportedPermissions = readinessDetails.unreportedPaymentPermissions || [];
            const deniedPermissions = readinessDetails.deniedPaymentPermissions || [];
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
                checkbox_cashier_permissions_missing: 'Checkbox не підтвердив права касира на вибраний спосіб оплати.',
                checkbox_cashier_permissions_malformed: 'Checkbox повернув неочікуваний формат прав касира.',
                checkbox_payment_permission_unreported: 'Checkbox не повідомив право касира на вибраний спосіб оплати.',
                fiscal_binding_capability_denied: 'Локальна прив’язка касира не дозволяє цю фіскальну дію.',
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
            if (state.registerState.integrationReady === true && !readinessTenderMatches(state.registerState)) {
                messages.push('Готовність Checkbox ще не підтверджена для вибраного способу оплати.');
            }
            if (Array.isArray(unreportedPermissions) && unreportedPermissions.length) {
                const serverAllowsWithWarning = state.registerState.integrationReady === true
                    && readinessTenderMatches(state.registerState) && code === 'ready'
                    && !deniedPermissions.length;
                if (serverAllowsWithWarning) {
                    const tenderLabel = state.tender === 'card_terminal_manual' ? 'оплату карткою' : 'готівку';
                    warnings.push(`Checkbox не повідомив право на ${tenderLabel}; сервер застосував погоджений тестовий виняток. Інші перевірки каси залишаються обов'язковими.`);
                } else {
                    messages.push(paymentUiError({
                        code: 'checkbox_payment_permission_unreported',
                        details: { unreportedPaymentPermissions: unreportedPermissions }
                    }));
                }
            }
            if (Array.isArray(deniedPermissions) && deniedPermissions.length) {
                messages.push(paymentUiError({
                    code: 'checkbox_cashier_permissions_missing',
                    details: { deniedPaymentPermissions: deniedPermissions }
                }));
            }
        }
        if (!state.routeReady && selectedRoute()?.readinessCode === 'shared_test_register_owned_by_other_business') {
            messages.push('Спільну тестову зміну використовує інший напрямок. Для переходу потрібне штатне завершення його тестового дня.');
        }
        const testDayReason = sharedTestDayBlockReason();
        if (testDayReason) messages.push(testDayReason);
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
                ? (warnings.length
                    ? 'Сервер дозволив приймання оплати з попередженням: Checkbox не повідомив право на вибраний спосіб оплати.'
                    : state.tender === 'card_terminal_manual'
                    ? 'Каса готова до оплати карткою через термінал.'
                    : 'Каса готова до оплати готівкою.')
                : (viewOnly
                    ? 'Оплати поки вимкнені — сторінка працює лише для перегляду.'
                    : testDayReason || 'Каса ще не готова — приймання оплат заблоковано.'));
        if (summary) summary.textContent = summaryText;
        if (technicalList) {
            technicalList.innerHTML = canViewTechnicalDetails && (messages.length || warnings.length)
                ? [...new Set([...messages, ...warnings])].map(message => `<li>${escapeHtml(message)}</li>`).join('')
                : (canViewTechnicalDetails ? '<li>Усі перевірки готовності пройдено.</li>' : '');
        }
        if (details) {
            details.hidden = !canViewTechnicalDetails;
            if (!canViewTechnicalDetails) details.open = false;
        }
        panel.classList.remove('hidden');
        panel.classList.toggle('is-ready', ready && warnings.length === 0);
        panel.classList.toggle('is-blocked', !ready);
        panel.classList.toggle('cashier-alert-warning', !ready || warnings.length > 0);
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
        const retryPending = Boolean(createDraft()?.payload) && !hasCurrentOrder;
        const safeDraftCoordination = Boolean(window.navigator.locks?.request);
        const cashierSelected = Number($('paymentCashierBinding')?.value || 0) > 0;
        let catalogSelectionValid = true;
        if (state.saleMode === 'catalog_sale') {
            try { catalogSelectionValid = state.catalogReady && catalogLinesPayload().length > 0; }
            catch { catalogSelectionValid = false; }
        }
        const disabled = !safeDraftCoordination || !ready || !state.routeReady || (!retryPending && (!cashierSelected || !catalogSelectionValid)) || state.createInFlight || hasCurrentOrder;
        const editingDisabled = state.createInFlight || hasCurrentOrder || retryPending;
        let reason = '';
        if (!safeDraftCoordination) reason = 'Безпечні повтори недоступні. Відкрийте касу в актуальному браузері через HTTPS.';
        else if (state.createInFlight) reason = 'Створюємо оплату…';
        else if (state.confirmOutcomePending) reason = 'Результат підтвердження уточнюється. Не повторюйте оплату й не скасовуйте чернетку до звірки.';
        else if (active) reason = 'Спершу підтвердьте або скасуйте поточну чернетку.';
        else if (hasCurrentOrder) reason = 'Натисніть «Наступний клієнт» для нового продажу.';
        else if (sharedTestDayBlockReason()) reason = sharedTestDayBlockReason();
        else if (!state.routeReady) reason = 'Обрана каса ще не готова або приймання оплат для неї вимкнено.';
        else if (!ready) reason = queueUnavailableReason() || 'Каса не готова: перегляньте повідомлення про готовність вище.';
        else if (retryPending) reason = 'Результат створення ще не відновлено. Повторіть той самий запит; кошик збережено.';
        else if (!cashierSelected) reason = 'Оберіть активного касира Checkbox для цієї каси.';
        else if (!catalogSelectionValid) reason = 'Оберіть доступні позиції та вкажіть дозволену кількість.';
        const createButton = $('createPaymentOrderBtn');
        if ($('paymentBusinessContext')) $('paymentBusinessContext').disabled = true;
        if ($('paymentRegisterRoute')) $('paymentRegisterRoute').disabled = editingDisabled || state.routeLoading;
        const form = $('paymentOrderForm');
        if (form) {
            form.querySelectorAll('input, select').forEach(el => {
                if (el.id === 'paymentBusinessContext') {
                    el.disabled = true;
                    return;
                }
                const admissionOnly = Boolean(el.closest('#admissionTicketFields'));
                const catalogOnly = Boolean(el.closest('#catalogSaleFields'));
                el.disabled = editingDisabled
                    || (state.saleMode === 'catalog_sale' && admissionOnly)
                    || (state.saleMode !== 'catalog_sale' && catalogOnly);
            });
            form.setAttribute('aria-busy', state.createInFlight ? 'true' : 'false');
        }
        const addLineButton = $('addCatalogLineBtn');
        if (addLineButton) addLineButton.disabled = editingDisabled || !state.catalogReady;
        document.querySelectorAll('[data-catalog-remove], [data-catalog-step], [data-catalog-add]').forEach(button => {
            button.disabled = editingDisabled;
        });
        setText('createPaymentDisabledReason', reason || 'Каса готова. Перевірте товари, кількість і спосіб оплати.');
        setText('paymentRouteHelp', hasCurrentOrder
            ? `Відкрито продаж №${order.id}. Напрямок, каса й касир зафіксовані.${nextAllowed ? ' Для нового продажу натисніть «Наступний клієнт».' : ''}${nextAllowed && !unresolvedQueueIsFresh() ? ` ${queueUnavailableReason()}` : ''}`
            : 'Оберіть напрямок і касу для поточного клієнта.');
        setButtonBusy(createButton, state.createInFlight, 'Створюємо оплату…');
        if (createButton && !state.createInFlight) {
            const catalogTotal = $('catalogFinalTotal')?.textContent?.trim();
            createButton.textContent = hasCurrentOrder
                ? 'Продаж відкрито'
                : retryPending
                ? 'Відновити створення оплати'
                : (state.saleMode === 'catalog_sale' && document.querySelector('#catalogSaleLines .cashier-catalog-line')
                    ? `Перейти до оплати · ${catalogTotal}`
                    : 'Перейти до оплати');
        }
        setDisabledReason(createButton, disabled, reason);
        const nextButton = $('startNextOrderBtn');
        if (nextButton) {
            const reconcileOnly = state.confirmOutcomePending && Boolean(order?.id);
            nextButton.classList.toggle('hidden', !nextAllowed && !reconcileOnly);
            const nextDisabled = reconcileOnly
                ? Boolean(state.orderRequest)
                : (!safeDraftCoordination || (nextAllowed && !unresolvedQueueIsFresh()));
            setDisabledReason(nextButton, nextDisabled, reconcileOnly
                ? 'Читаємо стан цього самого продажу в CRM без повторної оплати.'
                : (!safeDraftCoordination ? reason : queueUnavailableReason()));
            nextButton.textContent = reconcileOnly ? 'Звірити цей продаж' : 'Наступний клієнт';
        }
        const cancelBtn = $('cancelDraftOrderBtn');
        const canCancel = orderIsUnpaidDraft(order);
        if (cancelBtn) {
            cancelBtn.classList.toggle('hidden', !canCancel && !state.confirmOutcomePending);
            const cancelReason = state.confirmOutcomePending
                ? 'Результат підтвердження уточнюється. Скасування заблоковано до звірки.'
                : 'Скасувати можна тільки неоплачену чернетку.';
            setDisabledReason(cancelBtn, !canCancel || state.confirmOutcomePending, canCancel && !state.confirmOutcomePending ? '' : cancelReason);
        }
    }

    function hasAction(action) {
        return typeof canAccess === 'function' ? canAccess(action) : false;
    }

    function renderServiceOutList() {
        const list = $('serviceOutList');
        if (!list) return;
        if (state.serviceOutLoadInFlight && !state.serviceOutOperations.length) {
            list.textContent = 'Завантажуємо service-out запити…';
            return;
        }
        if (!state.serviceOutOperations.length) {
            list.textContent = state.serviceOutLastError
                ? 'Список тимчасово недоступний. Оновіть стан каси.'
                : 'Активних service-out запитів немає.';
            return;
        }
        const busy = state.serviceOutApproveInFlight || state.serviceOutCancelInFlight;
        list.innerHTML = state.serviceOutOperations.map(operation => {
            const amount = formatMoneyMinor(operation.amountMinor);
            const status = formatStatus(operation.status);
            const requestedAt = formatKyivDateTime(operation.createdAt);
            const ownership = operation.isMine ? 'Мій запит' : 'Інший касир';
            const actions = [
                operation.canCancel
                    ? `<button type="button" class="btn-page-secondary btn-page-toolbar" data-service-out-cancel="${escapeAttribute(operation.operationId)}"${busy ? ' disabled' : ''}>Скасувати</button>`
                    : '',
                operation.canApprove
                    ? `<button type="button" class="btn-page-secondary btn-page-toolbar" data-service-out-approve="${escapeAttribute(operation.operationId)}"${busy ? ' disabled' : ''}>Погодити</button>`
                    : ''
            ].filter(Boolean).join('');
            return `<article class="cashier-service-out-item">
                <div><strong>${escapeHtml(amount)}</strong><small>${escapeHtml(operation.reason || 'Причину не вказано')}</small></div>
                <div><strong>${escapeHtml(status)}</strong><small>${escapeHtml(ownership)} · ${escapeHtml(requestedAt)}</small></div>
                <div class="cashier-service-out-actions">${actions || '<span class="cashier-muted">Дій немає</span>'}</div>
            </article>`;
        }).join('');
    }

    function renderServiceOutPanel() {
        const panel = $('serviceOutPanel');
        if (!panel) return;
        const visible = serviceOutVisible();
        panel.classList.toggle('hidden', !visible);
        panel.setAttribute('aria-hidden', visible ? 'false' : 'true');
        panel.setAttribute('aria-busy', state.serviceOutLoadInFlight || state.serviceOutCreateInFlight ? 'true' : 'false');
        if (!visible) return;
        const requestAllowed = hasServiceOutRequestAccess();
        const approvePending = state.serviceOutOperations.some(operation => operation.canApprove);
        const unavailable = serviceOutUnavailableReason();
        const createBusy = state.serviceOutCreateInFlight;
        const loadBusy = state.serviceOutLoadInFlight;
        const createButton = $('createServiceOutBtn');
        const refreshButton = $('refreshServiceOutBtn');
        const form = $('serviceOutForm');
        const pinField = $('serviceOutApprovalPinField');
        if (form) form.classList.toggle('hidden', !requestAllowed);
        if ($('serviceOutAmount')) $('serviceOutAmount').disabled = createBusy || !requestAllowed;
        if ($('serviceOutReason')) $('serviceOutReason').disabled = createBusy || !requestAllowed;
        pinField?.classList.toggle('hidden', !approvePending);
        if ($('serviceOutApprovalPin')) $('serviceOutApprovalPin').disabled = !approvePending || state.serviceOutApproveInFlight;
        setStatus('serviceOutStatus', loadBusy ? 'pending' : (unavailable ? 'blocked' : 'ready'));
        setButtonBusy(createButton, createBusy, 'Створюємо запит…');
        if (!createBusy) {
            setDisabledReason(createButton, !requestAllowed || Boolean(unavailable), requestAllowed ? unavailable : 'Немає дозволу на створення service-out.');
        }
        setButtonBusy(refreshButton, loadBusy, 'Оновлюємо…');
        if (!loadBusy) setDisabledReason(refreshButton, false, '');
        const notice = state.serviceOutLastError
            ? paymentUiError(state.serviceOutLastError)
            : (unavailable || (approvePending
                ? 'Введіть PIN відповідального лише перед погодженням конкретного запиту.'
                : 'Service-out створюється як запит на погодження; до Checkbox він іде тільки після approve.'));
        setText('serviceOutNotice', notice);
        renderServiceOutList();
    }

    function renderActionPinPanel() {
        const panel = $('actionPinPanel');
        if (!panel) return;
        const visible = actionPinVisible();
        panel.classList.toggle('hidden', !visible);
        panel.setAttribute('aria-hidden', visible ? 'false' : 'true');
        panel.setAttribute('aria-busy', state.actionPinLoadInFlight || state.actionPinSaveInFlight ? 'true' : 'false');
        if (!visible) return;
        const select = $('actionPinBindingSelect');
        const previousValue = select?.value || '';
        if (select) {
            select.replaceChildren();
            if (state.actionPinLoadInFlight) {
                select.append(new Option('Завантаження касирів…', ''));
            } else if (!state.actionPinBindings.length) {
                select.append(new Option('Немає доступних прив’язок', ''));
            } else {
                select.append(new Option('Оберіть касира', ''));
                state.actionPinBindings.forEach(binding => {
                    const pinState = binding.actionPin?.configured || binding.pinConfigured ? 'PIN є' : 'PIN немає';
                    const locked = binding.actionPin?.lockedUntil || binding.pinLockedUntil
                        ? ` · lock до ${formatKyivDateTime(binding.actionPin?.lockedUntil || binding.pinLockedUntil)}`
                        : '';
                    const option = new Option(`${binding.cashierName || binding.cashierLogin || `Касир ${binding.id}`} · ${pinState}${locked}`, String(binding.id));
                    if (Number(binding.targetUserId) === Number(state.user?.id)) option.disabled = true;
                    select.append(option);
                });
                if ([...select.options].some(option => option.value === previousValue && !option.disabled)) select.value = previousValue;
            }
        }
        const selected = state.actionPinBindings.find(binding => String(binding.id) === String(select?.value || ''));
        const selfSelected = selected && Number(selected.targetUserId) === Number(state.user?.id);
        const disabled = state.actionPinLoadInFlight || state.actionPinSaveInFlight || !selected || selfSelected;
        if (select) select.disabled = state.actionPinLoadInFlight || state.actionPinSaveInFlight;
        if ($('actionPinValue')) $('actionPinValue').disabled = disabled;
        if ($('actionPinConfirm')) $('actionPinConfirm').disabled = disabled;
        setStatus('actionPinStatus', state.actionPinLoadInFlight ? 'pending' : (disabled ? 'blocked' : 'ready'));
        setButtonBusy($('saveActionPinBtn'), state.actionPinSaveInFlight, 'Зберігаємо…');
        if (!state.actionPinSaveInFlight) {
            setDisabledReason($('saveActionPinBtn'), disabled, selfSelected
                ? 'Не можна встановити PIN для власної прив’язки.'
                : (!selected ? 'Оберіть прив’язку іншого касира.' : ''));
        }
        setText('actionPinNotice', selfSelected
            ? 'Самостійне встановлення PIN для власної прив’язки заблоковане.'
            : 'PIN встановлює адміністратор для іншого касира цієї самої route-aware binding.');
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
                phase1_close_requires_payment_drain: 'Закриття зміни заблоковане, доки адміністратор не вимкне приймання нових оплат і система не підтвердить порожню чергу чеків.',
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

    let sharedTestDayInFlight = false;

    function renderSharedTestDay() {
        const day = state.registerState?.sharedTestDay;
        const panel = $('sharedTestDayPanel');
        const visible = day?.visible === true;
        panel?.classList.toggle('hidden', !visible);
        panel?.setAttribute('aria-hidden', visible ? 'false' : 'true');
        panel?.setAttribute('aria-busy', sharedTestDayInFlight ? 'true' : 'false');
        const projection = sharedTestDayProjection(day);
        const notice = projection.notice;
        setText('sharedTestDayNotice', sharedTestDayInFlight ? 'Перевіряємо стан тестової каси…' : notice);
        setDisabledReason($('sharedTestDrainBtn'), !visible || !day?.canDrain || sharedTestDayInFlight, notice);
        setDisabledReason($('sharedTestResumeBtn'), !visible || !day?.canResume || sharedTestDayInFlight || !unresolvedQueueIsFresh(), notice);
    }

    async function changeSharedTestDay(action) {
        if (sharedTestDayInFlight) return;
        const day = state.registerState?.sharedTestDay;
        const target = action === 'drain' ? phase1CloseContext()?.shiftId : day?.activeDrain?.id;
        const route = PILOT_SCOPE.routeOptionId;
        if (!target || !(action === 'drain' ? day?.canDrain : day?.canResume)) return;
        const button = $(action === 'drain' ? 'sharedTestDrainBtn' : 'sharedTestResumeBtn');
        sharedTestDayInFlight = true;
        renderSharedTestDay();
        try {
            const confirmed = await window.confirmModal(action === 'drain'
                ? 'Зупинити нові оплати PARK і ДАР на спільній тестовій касі? Уже прийняті чеки залишаться в черзі. Закриття зміни потрібно підтвердити окремо.'
                : 'Почати наступний тестовий день після перевірки CLOSED і порожньої черги? Це лише зніме локальну заборону. Зміна не відкриється, інші серверні обмеження залишаться чинними.');
            if (!confirmed) return;
            await loadUnresolvedOrders({ silent: true });
            await loadPilotRegisterState({ silent: true });
            const fresh = state.registerState?.sharedTestDay;
            const currentTarget = action === 'drain' ? phase1CloseContext()?.shiftId : fresh?.activeDrain?.id;
            if (route !== PILOT_SCOPE.routeOptionId || String(currentTarget) !== String(target)
                || !(action === 'drain' ? fresh?.canDrain : fresh?.canResume)) throw new Error('Стан каси змінився. Оновіть сторінку перед повторним підтвердженням.');
            const url = action === 'drain' ? `/api/payments/shifts/${encodeURIComponent(target)}/phase1-drain`
                : `/api/payments/test-drains/${encodeURIComponent(target)}/resume`;
            await apiRequest(url, { method: 'POST', headers: apiHeaders(getOperationIdempotencyKey(`test-${action}`, target)),
                body: JSON.stringify(action === 'drain' ? {} : { confirmNextTestDay: true }) });
            notify(action === 'drain' ? 'Нові оплати обох маршрутів зупинено. Перевірте чергу перед закриттям зміни.'
                : 'Локальну заборону знято. Перед новими оплатами перевірте готовність каси.', 'success');
        } catch (error) {
            notify(paymentUiError(error), 'error');
        } finally {
            sharedTestDayInFlight = false;
            await loadPilotRegisterState({ silent: true });
            renderSharedTestDay();
            button?.focus?.();
        }
    }

    function renderPhase1ShiftState() {
        renderSharedTestDay();
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
            renderFiscalReportsPanel();
            return;
        }
        setStatus('phase1ShiftStatus', context.status);
        const reason = phase1CloseUnavailableReason(context);
        const disabled = Boolean(reason) || state.phase1CloseConfirmationInFlight || state.phase1CloseSafetyRefreshInFlight || state.phase1CloseInFlight;
        const busyReason = state.phase1CloseConfirmationInFlight
            ? 'Очікуємо вашого фінального підтвердження.'
            : state.phase1CloseSafetyRefreshInFlight
            ? 'Повторно перевіряємо зміну та незавершені чеки перед закриттям.'
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
        renderFiscalReportsPanel();
    }

    function xReportUnavailableReason() {
        return 'X-звіт Checkbox поки не запускається з CRM: потрібна durable черга provider-report з ідемпотентністю, щоб не створити дубль після перезавантаження.';
    }

    function renderFiscalReportsPanel() {
        const panel = $('fiscalReportsPanel');
        if (!panel) return;
        const context = phase1CloseContext();
        const visible = Boolean(context?.visible);
        const closeReason = visible ? phase1CloseUnavailableReason(context) : 'Немає активної зміни або доступу до звітів цієї каси.';
        const closeBusy = state.phase1CloseConfirmationInFlight || state.phase1CloseSafetyRefreshInFlight || state.phase1CloseInFlight;
        const xReason = xReportUnavailableReason();
        const xButton = $('createXReportBtn');
        const zButton = $('closeZReportBtn');
        const badge = $('fiscalReportsStateBadge');
        const notice = $('fiscalReportsNotice');
        const statusLabel = context?.status ? formatStatus(context.status) : 'невідомо';
        const canClose = visible && !closeReason && !closeBusy;
        panel.classList.toggle('is-ready', canClose);
        panel.classList.toggle('is-blocked', !canClose);
        panel.setAttribute('aria-busy', closeBusy ? 'true' : 'false');
        setDisabledReason(xButton, true, xReason);
        setDisabledReason(zButton, !canClose, closeBusy ? 'Очікуємо завершення поточної перевірки зміни.' : closeReason);
        if (badge) {
            badge.textContent = canClose
                ? `Зміна ${statusLabel} · можна закривати`
                : (visible ? `Зміна ${statusLabel}` : 'Звіти недоступні');
        }
        if (notice) {
            notice.textContent = canClose
                ? `${xReason} Z-звіт створюється тільки через чинне закриття зміни з повторною перевіркою черги.`
                : `${xReason} Z-звіт недоступний: ${closeBusy ? 'триває перевірка зміни.' : closeReason}`;
        }
    }

    function explainXReportUnavailable() {
        renderFiscalReportsPanel();
        notify(xReportUnavailableReason(), 'info');
    }

    function requestZReportClose() {
        renderFiscalReportsPanel();
        const context = phase1CloseContext();
        const reason = phase1CloseUnavailableReason(context);
        if (reason) {
            notify(reason, 'error');
            $('phase1CloseShiftBtn')?.focus?.({ preventScroll: false });
            return;
        }
        void closePhase1Shift();
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
        if (state.phase1CloseConfirmationInFlight || state.phase1CloseSafetyRefreshInFlight || state.phase1CloseInFlight) return;
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
        state.phase1CloseSafetyRefreshInFlight = true;
        renderPhase1ShiftState();
        try {
            await loadUnresolvedOrders({ silent: true });
            await loadPilotRegisterState({ silent: true });
        } finally {
            state.phase1CloseSafetyRefreshInFlight = false;
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
        const blocked = !integrationReady() || !hasOrder || orderBlocksPayment(order) || state.confirmSubmitted || state.confirmOutcomePending || state.confirmInFlight;
        const reason = state.confirmInFlight
            ? 'Підтверджуємо оплату…'
            : (state.confirmOutcomePending
                ? 'Результат підтвердження уточнюється. Не повторюйте оплату; звірте це саме замовлення без нового підтвердження.'
                : (!integrationReady()
                    ? (queueUnavailableReason() || 'Каса не готова до Checkbox операцій.')
                    : (!hasOrder ? 'Спершу створіть оплату.' : (orderBlocksPayment(order) ? 'Цю оплату вже не можна підтвердити повторно.' : ''))));
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
        renderCompactContext();
        renderReadinessState();
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
        if (state.confirmOutcomePending) throw new Error('payment_confirmation_outcome_unknown');
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
            notifyPaymentError(paymentUiError(error));
            return;
        }
        const idempotencyKey = getConfirmIdempotencyKey(orderId || 'missing');
        state.confirmInFlight = true;
        state.confirmSubmitted = true;
        state.confirmOutcomePending = false;
        syncConfirmationAvailability();
        try {
            const result = await apiRequest(`/api/payments/orders/${encodeURIComponent(orderId)}/confirm`, {
                method: 'POST',
                headers: apiHeaders(idempotencyKey),
                body: JSON.stringify(payload)
            });
            if (result.order?.id) storageSet('lastOrderId', result.order.id);
            const loaded = await loadPaymentOrder(result.order?.id || orderId, { silent: true });
            await loadUnresolvedOrders({ silent: true });
            refreshReceiptHistoryIfVisible();
            if (!orderPaymentConfirmed(loaded?.order || state.orderDetails?.order)) {
                state.confirmSubmitted = true;
                state.confirmOutcomePending = true;
                syncConfirmationAvailability();
                if (state.orderDetails?.order) renderFiscalResult(state.orderDetails);
                notifyPaymentError('Сервер прийняв запит, але повторне читання замовлення не підтвердило оплату. Не повторюйте оплату; звірте цей продаж у CRM.');
                return;
            }
            state.confirmOutcomePending = false;
            state.paymentErrorActive = false;
            notify(result.replayed ? 'Це саме підтвердження безпечно оброблено повторно.' : '\u041e\u043f\u043b\u0430\u0442\u0443 \u043f\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0436\u0435\u043d\u043e. \u0427\u0435\u043a \u043f\u043e\u0441\u0442\u0430\u0432\u043b\u0435\u043d\u043e \u0432 \u043d\u0430\u0434\u0456\u0439\u043d\u0443 \u0447\u0435\u0440\u0433\u0443 \u0444\u0456\u0441\u043a\u0430\u043b\u0456\u0437\u0430\u0446\u0456\u0457.', 'success');
            syncOrderPolling(state.orderDetails?.order);
            focusFiscalResult();
        } catch (error) {
            let rereadOrder = null;
            let rereadSucceeded = false;
            if (orderId) {
                try {
                    const loaded = await loadPaymentOrder(orderId, { silent: true });
                    rereadOrder = loaded?.order || state.orderDetails?.order || null;
                    rereadSucceeded = true;
                } catch {}
            }
            if (isDefinitePaymentRejection(error) && rereadSucceeded && orderIsUnpaidDraft(rereadOrder)) {
                state.confirmSubmitted = false;
                state.confirmOutcomePending = false;
                notifyPaymentError(paymentUiError(error));
            } else {
                state.confirmSubmitted = true;
                state.confirmOutcomePending = true;
                if (state.orderDetails?.order) renderFiscalResult(state.orderDetails);
                notifyPaymentError(paymentUiError(new Error('payment_confirmation_outcome_unknown')));
            }
        } finally {
            state.confirmInFlight = false;
            syncCreateAvailability();
            syncConfirmationAvailability();
        }
    }

    async function cancelDraftOrder() {
        const order = state.orderDetails?.order;
        if (!order?.id) return;
        if (state.confirmOutcomePending) {
            notify(paymentUiError(new Error('payment_confirmation_outcome_unknown')), 'error');
            return;
        }
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
            state.paymentErrorActive = false;
            notify(result.replayed ? 'Скасування чернетки повторено без дублювання.' : 'Чернетку скасовано. Можна починати нову оплату.', 'success');
            $('startNextOrderBtn')?.focus?.({ preventScroll: false });
        } catch (error) {
            notify(paymentUiError(error), 'error');
        } finally {
            syncCreateAvailability();
            syncConfirmationAvailability();
        }
    }

    async function reconcileCurrentOrder() {
        const orderId = state.orderDetails?.order?.id;
        if (!state.confirmOutcomePending || !orderId || state.orderRequest) return;
        try {
            await loadPaymentOrder(orderId, { silent: true });
            await loadUnresolvedOrders({ silent: true });
            if (state.confirmOutcomePending) {
                renderFiscalResult(state.orderDetails);
                notifyPaymentError('CRM ще не підтвердила результат цієї оплати. Не повторюйте підтвердження і не скасовуйте продаж.');
                return;
            }
            notify('Стан цього продажу звірено в CRM без повторної оплати.', 'success');
        } catch {
            state.confirmOutcomePending = true;
            state.confirmSubmitted = true;
            renderFiscalResult(state.orderDetails);
            notifyPaymentError('Не вдалося звірити результат цієї оплати. Продаж лишається заблокованим без повторного підтвердження.');
        } finally {
            syncCreateAvailability();
            syncConfirmationAvailability();
        }
    }

    function startNextOrder() {
        if (state.confirmOutcomePending) return reconcileCurrentOrder();
        if (!window.navigator.locks?.request) return;
        return window.navigator.locks.request(storageKey('create-order'), async () => {
            const latestOrderId = storageGet('lastOrderId');
            if (latestOrderId && String(latestOrderId) !== String(state.orderDetails?.order?.id)) {
                await loadPaymentOrder(latestOrderId, { silent: true });
                return;
            }
            if (state.draftRevision !== (storageGet('draftRevision') || '')) {
                notify('Інша вкладка вже почала нового клієнта. Оновіть сторінку.', 'info');
                return;
            }
            return resetForNextCustomer();
        }).catch(error => notify(paymentUiError(error), 'error'));
    }

    function resetForNextCustomer() {
        if (state.confirmOutcomePending || !orderAllowsNextCustomer() || state.createInFlight || state.confirmInFlight) return;
        if (!unresolvedQueueIsFresh()) {
            notify(queueUnavailableReason(), 'error');
            $('refreshUnresolvedOrdersBtn')?.focus?.({ preventScroll: false });
            return;
        }
        const revision = randomKey('cashier-ui-customer');
        window.localStorage.setItem(storageKey('draftRevision'), revision);
        state.draftRevision = revision;
        clearOrderPolling();
        invalidateInteractionRequests();
        clearCreateIdempotencyKey();
        storageRemove('lastOrderId');
        const currentOrderId = state.orderDetails?.order?.id;
        if (currentOrderId) storageRemove(`confirm:${PILOT_SCOPE.routeOptionId}:${currentOrderId}`);
        state.orderDetails = null;
        state.confirmSubmitted = false;
        state.confirmOutcomePending = false;
        state.paymentErrorActive = false;
        state.confirmInFlight = false;
        state.nextCustomerSafetyRefreshInFlight = true;
        clearGlobalStatus({ preserveError: false });
        $('terminalSuccessCheckbox') && ($('terminalSuccessCheckbox').checked = false);
        $('terminalReference') && ($('terminalReference').value = '');
        $('cashReceivedAmount') && ($('cashReceivedAmount').value = '');
        $('catalogSaleLines')?.replaceChildren();
        if ($('catalogDiscountRule')) $('catalogDiscountRule').value = '';
        if ($('catalogSearch')) $('catalogSearch').value = '';
        if ($('catalogCategory')) $('catalogCategory').value = '';
        setCatalogPickerOpen(state.saleMode === 'catalog_sale');
        renderCatalogSearchResults();
        updateCatalogCartSummary();
        setText('cashierHeroDescription', 'Новий продаж');
        setText('paymentSnapshotTitle', 'Оплата');
        setText('internalReceiptLabel', 'RCP-* · номер продажу CRM');
        setStatus('cashierPaymentStatus', 'unpaid');
        setStatus('cashierFiscalStatus', 'not_created');
        setText('paymentTotalAmount', formatMoneyMinor(0));
        setText('cardExactAmount', formatMoneyMinor(0));
        setText('cashChangeAmount', formatMoneyMinor(0));
        renderItems([]);
        renderFiscalResult({ order: null, receipts: [], artifacts: {} });
        renderRegisterState(state.registerState);
        syncTenderControls();
        syncCreateAvailability();
        // A completed sale can open or close the provider shift after the cached
        // readiness snapshot was taken. Keep the new draft disabled until both
        // register-wide unresolved visibility and a fresh provider observation
        // converge for the next customer.
        return (async () => {
            try {
                await loadUnresolvedOrders({ silent: true });
                await refreshReadiness({ silent: true, force: true });
            } finally {
                state.nextCustomerSafetyRefreshInFlight = false;
                syncCreateAvailability();
                syncConfirmationAvailability();
                (state.saleMode === 'catalog_sale'
                    ? $('catalogSearch')
                    : $('paymentDate'))?.focus({ preventScroll: true });
            }
        })();
    }

    function bindEvents() {
        $('paymentOrderForm')?.addEventListener('input', invalidateUnsubmittedDraft);
        $('paymentOrderForm')?.addEventListener('change', invalidateUnsubmittedDraft);
        $('paymentOrderForm')?.addEventListener('submit', createPaymentOrder);
        $('paymentBusinessContext')?.addEventListener('change', () => { void handleBusinessContextChange(); });
        $('paymentRegisterRoute')?.addEventListener('change', () => { void handleRegisterRouteChange(); });
        $('paymentCashierBinding')?.addEventListener('change', async () => {
            clearCorrectablePaymentError();
            invalidateInteractionRequests();
            state.registerState = null;
            renderRegisterState(null);
            renderCompactContext();
            syncCreateAvailability();
            await loadPilotRegisterState({ silent: true });
            await loadUnresolvedOrders({ silent: true });
            await loadServiceOutRequests({ silent: true });
            await loadActionPinBindings({ silent: true });
        });
        $('addCatalogLineBtn')?.addEventListener('click', () => {
            const open = Boolean($('catalogPicker')?.hidden);
            setCatalogPickerOpen(open);
            if (open) $('catalogSearch')?.focus({ preventScroll: true });
        });
        $('catalogPicker')?.addEventListener('keydown', event => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            setCatalogPickerOpen(false);
            $('addCatalogLineBtn')?.focus({ preventScroll: true });
        });
        $('catalogDiscountRule')?.addEventListener('change', () => {
            updateCatalogCartSummary();
            syncCreateAvailability();
        });
        $('catalogSearch')?.addEventListener('input', refreshCatalogSelects);
        $('catalogCategory')?.addEventListener('change', refreshCatalogSelects);
        document.querySelectorAll('input[name="paymentTender"]').forEach(input => {
            input.addEventListener('change', () => {
                if (state.orderDetails?.order) return;
                clearCorrectablePaymentError();
                state.tender = input.value === 'card_terminal_manual' ? 'card_terminal_manual' : 'cash';
                invalidateInteractionRequests();
                syncTenderControls();
                void Promise.all([
                    loadPilotRegisterState({ silent: true }),
                    loadUnresolvedOrders({ silent: true })
                ]);
            });
        });
        $('cashReceivedAmount')?.addEventListener('input', () => {
            clearCorrectablePaymentError();
            updateCashChange();
        });
        $('terminalSuccessCheckbox')?.addEventListener('change', () => {
            clearCorrectablePaymentError();
            syncConfirmationAvailability();
        });
        $('terminalReference')?.addEventListener('input', clearCorrectablePaymentError);
        $('confirmCashBtn')?.addEventListener('click', confirmPayment);
        $('confirmCardBtn')?.addEventListener('click', confirmPayment);
        $('startNextOrderBtn')?.addEventListener('click', startNextOrder);
        $('cancelDraftOrderBtn')?.addEventListener('click', cancelDraftOrder);
        $('refreshUnresolvedOrdersBtn')?.addEventListener('click', () => { void loadUnresolvedOrders({ silent: false }); });
        $('loadMoreUnresolvedOrdersBtn')?.addEventListener('click', () => { void loadUnresolvedOrders({ silent: false, append: true }); });
        $('loadCheckboxSalesReportBtn')?.addEventListener('click', () => { void loadCheckboxSalesReport({ silent: false }); });
        $('createXReportBtn')?.addEventListener('click', explainXReportUnavailable);
        $('closeZReportBtn')?.addEventListener('click', requestZReportClose);
        $('checkboxSalesReportPanel')?.addEventListener('toggle', loadReceiptHistoryOnOpen);
        document.querySelectorAll('[data-history-period]').forEach(button => {
            button.addEventListener('click', () => {
                applyReceiptHistoryPeriod(button.dataset.historyPeriod, {
                    load: true,
                    focusDates: button.dataset.historyPeriod === 'custom'
                });
            });
        });
        $('checkboxReportPreviousPage')?.addEventListener('click', () => changeReceiptHistoryPage(-1));
        $('checkboxReportNextPage')?.addEventListener('click', () => changeReceiptHistoryPage(1));
        $('refreshReadinessBtn')?.addEventListener('click', () => { void refreshReadiness({ silent: false }); });
        $('phase1CloseShiftBtn')?.addEventListener('click', () => { void closePhase1Shift(); });
        $('sharedTestDrainBtn')?.addEventListener('click', () => { void changeSharedTestDay('drain'); });
        $('sharedTestResumeBtn')?.addEventListener('click', () => { void changeSharedTestDay('resume'); });
        $('serviceOutForm')?.addEventListener('submit', createServiceOutRequest);
        $('refreshServiceOutBtn')?.addEventListener('click', () => { void loadServiceOutRequests({ silent: false }); });
        $('serviceOutList')?.addEventListener('click', event => {
            const cancelTarget = event.target?.closest?.('[data-service-out-cancel]');
            const approveTarget = event.target?.closest?.('[data-service-out-approve]');
            if (cancelTarget) {
                void cancelServiceOutOperation(cancelTarget.getAttribute('data-service-out-cancel'));
                return;
            }
            if (approveTarget) void approveServiceOutOperation(approveTarget.getAttribute('data-service-out-approve'));
        });
        $('actionPinForm')?.addEventListener('submit', saveActionPin);
        $('actionPinBindingSelect')?.addEventListener('change', changeActionPinBinding);
        $('actionPinValue')?.addEventListener('input', renderActionPinPanel);
        $('actionPinConfirm')?.addEventListener('input', renderActionPinPanel);
        $('unresolvedOrdersBody')?.addEventListener('click', event => {
            const target = event.target?.closest?.('[data-order-id]');
            const orderId = target?.getAttribute?.('data-order-id');
            if (orderId) {
                if (String(state.orderDetails?.order?.id || '') !== String(orderId)) invalidateInteractionRequests();
                void loadPaymentOrder(orderId, { silent: false });
            }
        });
        const today = kyivIsoDate();
        if ($('paymentDate') && !$('paymentDate').value) $('paymentDate').value = today;
        applyReceiptHistoryPeriod('today', { load: false });
            ['checkboxReportDateFrom', 'checkboxReportDateTo', 'checkboxReportShiftId', 'checkboxReportCashierUserId'].forEach(id => {
                $(id)?.addEventListener('change', () => handleReceiptHistoryFilterChange({ load: true, changedId: id }));
            });
    }

    function setDenied(message) {
        const denied = $('cashierAccessDenied');
        if (denied) {
            denied.textContent = message;
            denied.classList.remove('hidden');
        }
        document.querySelectorAll('input, select, button').forEach(el => {
            if (el.closest('.header') || el.closest('.sidebar-nav')) return;
            el.disabled = true;
        });
    }

    async function initCashierPaymentsPage() {
        configurePageContext();
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
            syncPilotScopeWithCrmBusiness(user);
            setText('currentUser', user.name || user.username || '');
            if (typeof showAuthenticatedPageShell === 'function') showAuthenticatedPageShell();
            if (!canAccessPage('/cashier-payments') || !canAccess('payments.view') || !canAccess('payments.create') || !canAccess('payments.confirm_received')) {
                setDenied('Немає доступу до сторінки оплати або потрібних касових дозволів. Розширений доступ до фінансів для цієї сторінки не потрібен.');
                return;
            }
            await loadRouteOptions();
            await loadLocalQaStatus();
            await loadSelectedRouteWorkspace();
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
        pauseOrderPolling();
        if ($('serviceOutApprovalPin')) $('serviceOutApprovalPin').value = '';
        clearActionPinFields();
    });
    window.addEventListener('crmBusinessContextChanged', event => { void handleGlobalBusinessContextChanged(event); });
    document.addEventListener('visibilitychange', () => {
        if (!pageIsVisible()) {
            clearUnresolvedRefreshTimer();
            pauseOrderPolling();
            return;
        }
        if (serviceOutVisible()) void loadServiceOutRequests({ silent: true });
        const order = state.orderDetails?.order;
        if (shouldPollOrder(order)) {
            void loadPaymentOrder(order.id, { silent: true }).catch(() => {
                if (state.unresolvedAutoRefreshEnabled) return loadUnresolvedOrders({ silent: true });
                return null;
            });
        } else if (state.unresolvedAutoRefreshEnabled) {
            void loadUnresolvedOrders({ silent: true });
        }
    });
    document.addEventListener('DOMContentLoaded', () => { void initCashierPaymentsPage(); });

    window.CashierPaymentsPage = {
        get PILOT_SCOPE() { return PILOT_SCOPE; },
        SALE_MODE,
        state,
        formatMoneyMinor,
        parseUahToMinor,
        getCreateIdempotencyKey,
        getConfirmIdempotencyKey,
        getOperationIdempotencyKey,
        buildCatalogSalePayload,
        loadCatalogData,
        unresolvedQueueIsFresh,
        loadPaymentOrder,
        loadPilotRegisterState,
        closePhase1Shift,
        renderFiscalReportsPanel,
        explainXReportUnavailable,
        requestZReportClose,
        loadServiceOutRequests,
        createServiceOutRequest,
        cancelServiceOutOperation,
        approveServiceOutOperation,
        loadActionPinBindings,
        saveActionPin,
        isTrustedCheckboxUrl,
        unresolvedOrderAccessibleLabel
    };
})();
