
'use strict';

(function () {
    const PILOT_SCOPE = Object.freeze({ crmProfileKey: 'event_genix', registerAlias: 'middle', defaultEnabled: false });
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

    const state = {
        user: null,
        orderDetails: null,
        registerState: null,
        cashierProEnabled: false,
        createInFlight: false,
        confirmInFlight: false,
        confirmSubmitted: false,
        reportInFlight: false,
        unresolvedInFlight: false,
        unresolvedOrders: [],
        unresolvedQueueState: 'unknown',
        unresolvedLastKnownOrders: [],
        unresolvedLastRefreshAt: null,
        unresolvedLastError: null,
        readinessInFlight: false,
        readinessTimer: null,
        readinessBackoffMs: READINESS_REFRESH_MIN_MS,
        tender: 'cash',
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
        if (el) el.textContent = value == null || value === '' ? '?' : String(value);
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
            draft: 'чернетка', unpaid: 'не оплачено', pending: 'очікує', unknown: 'невідомо', confirmed: 'оплачено', open: 'відкрита', opening: 'відкривається', closing: 'закривається', closed: 'закрита',
            payment_recorded: 'оплату зафіксовано', fiscalized: 'чек створено', failed: 'помилка з повтором', failed_retryable: 'помилка, буде повтор', failed_terminal: 'помилка без автоповтору', dead: 'потрібна ручна перевірка', cancelled: 'скасовано',
            validation_failed: 'помилка перевірки', ready_to_send: 'готово до відправки', sending: 'відправляється', validating: 'перевіряється', not_open: 'не відкрита',
            mapping_missing: 'mapping відсутній', credentials_missing: 'credentials відсутні', provider_unavailable: 'Checkbox недоступний', identity_mismatch: 'невірна каса Checkbox', shift_opening: 'зміна відкривається', ready: 'готово'
        };
        return labels[status] || status;
    }

    function classifyStatus(value) {
        const status = normalizeStatus(value);
        if (['confirmed', 'payment_recorded', 'fiscalized', 'open', 'closed'].includes(status)) return 'is-ok';
        if (['pending', 'unknown', 'ready_to_send', 'sending', 'validating', 'opening', 'closing', 'failed', 'failed_retryable'].includes(status)) return 'is-warn';
        if (['failed_terminal', 'dead', 'validation_failed', 'blocked', 'cancelled'].includes(status)) return 'is-danger';
        return '';
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
        return `${STORAGE_PREFIX}:u:${userId}:crm:${PILOT_SCOPE.crmProfileKey}:reg:${PILOT_SCOPE.registerAlias}:fp:${fiscalProfileId}:fr:${fiscalRegisterId}`;
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
        return `${action}:${PILOT_SCOPE.crmProfileKey}:${PILOT_SCOPE.registerAlias}:${target || 'current'}`;
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

    function parseAmountInput(id, code) {
        try {
            const amount = parseUahToMinor($(id)?.value || '0');
            if (amount <= 0n) throw new Error(code);
            return amount.toString();
        } catch (error) {
            if (error.message === 'cash_amount_invalid') throw error;
            throw new Error(code);
        }
    }

    function parseNullableAmountInput(id) {
        return parseUahToMinor($(id)?.value || '0').toString();
    }

    function orderStorageScope() {
        const date = $('paymentDate')?.value || 'no-date';
        const kids = $('paymentKidsCount')?.value || '0';
        const adults = $('paymentAdultsCount')?.value || '0';
        return `${PILOT_SCOPE.crmProfileKey}:${PILOT_SCOPE.registerAlias}:${state.tender}:${date}:${kids}:${adults}`;
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
        const key = `confirm:${PILOT_SCOPE.crmProfileKey}:${PILOT_SCOPE.registerAlias}:${orderId}`;
        const existing = storageGet(key);
        if (existing) return existing;
        const generated = randomKey('cashier-ui-confirm');
        storageSet(key, generated);
        return generated;
    }

    function apiHeaders(idempotencyKey = null) {
        const headers = typeof getAuthHeaders === 'function' ? getAuthHeaders(true) : { 'Content-Type': 'application/json' };
        if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
        headers['X-Cashier-Pilot-Scope'] = `${PILOT_SCOPE.crmProfileKey}:${PILOT_SCOPE.registerAlias}`;
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
        const button = $('createPaymentOrderBtn');
        if (button) button.disabled = true;
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
            notify(result.replayed ? 'Оплату відкрито повторно з тим самим Idempotency-Key.' : 'Оплату створено. Перевірте позиції та підтвердьте отримання грошей.', 'success');
            focusFirstConfirmationControl();
        } catch (error) {
            if (button) button.disabled = false;
            notify(paymentUiError(error), 'error');
        } finally {
            state.createInFlight = false;
            syncCreateAvailability();
        }
    }

    async function loadPaymentOrder(orderId, { silent = false } = {}) {
        const result = await apiRequest(`/api/payments/orders/${encodeURIComponent(orderId)}`, {
            method: 'GET',
            headers: apiHeaders()
        });
        state.orderDetails = result;
        state.tender = result.order?.sourceSnapshot?.tender || (result.order?.paymentMethod === 'card_terminal' ? 'card_terminal_manual' : 'cash');
        state.confirmSubmitted = orderBlocksPayment(result.order);
        syncTenderControls();
        renderOrder(result);
        await loadPilotRegisterState({ silent: true });
        await loadUnresolvedOrders({ silent: true });
        syncOrderPolling(result.order);
        if (!silent) notify('Оплату завантажено.', 'success');
        return result;
    }

    async function loadPilotRegisterState({ silent = false } = {}) {
        try {
            const params = new URLSearchParams({ crmProfileKey: PILOT_SCOPE.crmProfileKey, registerAlias: PILOT_SCOPE.registerAlias });
            const result = await apiRequest(`/api/payments/pilot-register-state?${params.toString()}`, {
                method: 'GET',
                headers: apiHeaders(),
                timeoutMs: READINESS_REQUEST_TIMEOUT_MS
            });
            state.registerState = result;
            renderRegisterState(result);
            syncOperationalAvailability();
            if (!silent) notify('Стан каси оновлено.', 'success');
            return result;
        } catch (error) {
            state.registerState = null;
            renderRegisterState(null);
            syncOperationalAvailability();
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
        const button = $('refreshReadinessBtn');
        if (button) button.disabled = true;
        try {
            await apiRequest('/api/payments/readiness/probe', {
                method: 'POST',
                headers: apiHeaders(),
                body: JSON.stringify({ crmProfileKey: PILOT_SCOPE.crmProfileKey, registerAlias: PILOT_SCOPE.registerAlias, force }),
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
            if (button) button.disabled = false;
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
        const readableMessages = {
            cash_amount_invalid: 'Сума готівки має бути у гривнях, максимум з двома знаками після коми.',
            cash_received_too_low: 'Отримана готівка менша за суму оплати. Підтвердження заблоковано.',
            payment_date_required: 'Вкажіть дату квитка.',
            checkbox_integration_not_ready: 'Інтеграція Checkbox або mapping каси не готові. Підтвердження грошей заблоковано.',
            kids_count_invalid: 'Кількість дітей має бути більшою за нуль.',
            adults_count_invalid: 'Кількість дорослих не може бути від’ємною.',
            card_terminal_success_required: 'Перед підтвердженням поставте позначку: термінал показав успішну оплату.',
            payment_repeat_blocked: 'Повторна оплата заблокована: оплата вже підтверджена або чек очікує фіскалізації.',
            payment_order_cancel_denied: 'Скасувати можна тільки неоплачену чернетку.',
            fiscal_mapping_ambiguous_or_missing: 'Пілотна каса park / middle не налаштована або mapping неоднозначний.',
            forbidden: 'Немає доступу до цієї каси або CRM профілю.',
            idempotency_key_required: 'Idempotency-Key обов’язковий для безпечного повтору запиту.',
            queue_unavailable: 'Черга незавершених чеків недоступна. Підтвердження грошей заблоковано.',
            provider_unavailable: 'Checkbox тимчасово недоступний. Нові оплати заблоковано.',
            payment_acceptance_disabled: 'Приймання нових оплат вимкнене. Recovery вже оплачених чеків дозволений.'
        };
        if (readableMessages[code]) return readableMessages[code];
        const messages = {
            cash_amount_invalid: 'Сума готівки має бути у гривнях, максимум з двома знаками після коми.',
            cash_received_too_low: 'Отримана готівка менша за суму оплати. Підтвердження заблоковано.',
            payment_date_required: 'Вкажіть дату квитка.',
            checkbox_integration_not_ready: 'Інтеграція Checkbox або mapping каси не готові. Підтвердження грошей заблоковане.',
            kids_count_invalid: 'Кількість дітей має бути більшою за нуль.',
            adults_count_invalid: 'Кількість дорослих не може бути відʼємною.',
            card_terminal_success_required: 'Перед підтвердженням поставте позначку: термінал показав успішну оплату.',
            payment_repeat_blocked: 'Повторна оплата заблокована: оплата вже підтверджена або чек очікує фіскалізації.',
            payment_order_cancel_denied: 'Скасувати можна тільки неоплачену чернетку.',
            fiscal_mapping_ambiguous_or_missing: 'Пілотна каса park / middle не налаштована або mapping неоднозначний.',
            forbidden: 'Немає доступу до цієї каси або CRM профілю.',
            service_in_amount_required: 'Сума службового внесення має бути більшою за нуль.',
            service_out_amount_required: 'Сума службової видачі має бути більшою за нуль.',
            service_out_reason_required: 'Вкажіть причину службової видачі.',
            shift_not_open: 'Для цієї операції потрібна відкрита зміна.',
            shift_close_blocked: 'Закриття заблоковане, поки є pending/unknown фіскальні операції.',
            close_actual_totals_required: 'Вкажіть фактичну готівку та суму звіту термінала.',
            refund_order_required: 'Вкажіть ID оплати для повернення.',
            refund_reason_required: 'Вкажіть причину повернення.',
            idempotency_key_required: 'Idempotency-Key обов’язковий для безпечного повтору запиту.'
        };
        return messages[code] || error?.message || '\u0414\u0456\u044f \u043a\u0430\u0441\u0438\u0440\u0430 \u043d\u0435 \u0432\u0438\u043a\u043e\u043d\u0430\u043d\u0430.';
    }

    function renderOrder(details) {
        const order = details?.order || null;
        const items = Array.isArray(details?.items) ? details.items : [];
        if (!order) return;
        setText('cashierFiscalProfile', `${order.crmProfileKey || '?'} / ${order.legalEntityName || order.legalEntityKey || '\u0424\u041e\u041f \u043d\u0435 \u043d\u0430\u043b\u0430\u0448\u0442\u043e\u0432\u0430\u043d\u043e'}`);
        setText('cashierRegister', `${order.sourceSnapshot?.location_alias || 'park'} / ${order.registerDisplayName || order.registerAlias || 'middle'}`);
        setStatus('cashierPaymentStatus', order.paymentStatus || order.status);
        setStatus('cashierFiscalStatus', effectiveFiscalStatus(order));
        setText('internalReceiptLabel', `RCP-${order.id} \u2014 ${INTERNAL_RECEIPT_TEXT}`);
        setText('paymentTotalAmount', formatMoneyMinor(order.totalAmountMinor));
        setText('cardExactAmount', formatMoneyMinor(order.totalAmountMinor));
        const refundOrder = $('refundOrderId');
        if (refundOrder && !refundOrder.value) refundOrder.value = String(order.id);
        renderItems(items);
        renderFiscalResult(details);
        syncCreateAvailability();
        syncConfirmationAvailability();
    }

    function renderItems(items) {
        const body = $('paymentItemsBody');
        if (!body) return;
        if (!items.length) {
            body.innerHTML = '<tr><td colspan="4" class="cashier-empty">\u0423 snapshot \u043d\u0435\u043c\u0430\u0454 \u043f\u043e\u0437\u0438\u0446\u0456\u0439.</td></tr>';
            return;
        }
        body.innerHTML = items.map(item => `
            <tr>
                <td><strong>${escapeHtml(item.itemName)}</strong><div class="cashier-muted">${escapeHtml(item.itemCode || '')} \u00b7 ${escapeHtml(item.taxReference || 'tax mapping')}</div></td>
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
        const badge = $('fiscalReceiptBadge');
        if (badge) badge.textContent = formatStatus(fiscalStatus);
        const message = $('fiscalPendingMessage');
        const links = $('providerReceiptLinks');
        const pendingNotice = $('pendingReceiptNotice');
        const hasOfficialReceipt = FISCAL_DONE_STATUSES.has(fiscalStatus) || latestReceipt?.status === 'fiscalized';
        if (message) {
            if (hasOfficialReceipt) message.textContent = '\u041e\u0444\u0456\u0446\u0456\u0439\u043d\u0438\u0439 \u0447\u0435\u043a Checkbox \u043e\u0442\u0440\u0438\u043c\u0430\u043d\u043e. RCP-* \u043b\u0438\u0448\u0430\u0454\u0442\u044c\u0441\u044f \u0432\u043d\u0443\u0442\u0440\u0456\u0448\u043d\u044c\u043e\u044e \u043a\u0432\u0438\u0442\u0430\u043d\u0446\u0456\u0454\u044e Event Genix.';
            else if (FISCAL_BLOCKING_STATUSES.has(fiscalStatus)) message.textContent = '\u0424\u0456\u0441\u043a\u0430\u043b\u0456\u0437\u0430\u0446\u0456\u044f \u043e\u0447\u0456\u043a\u0443\u0454 \u0430\u0431\u043e \u043c\u0430\u0454 \u043d\u0435\u0432\u0456\u0434\u043e\u043c\u0438\u0439 \u0441\u0442\u0430\u043d. \u041f\u043e\u0432\u0442\u043e\u0440\u043d\u0430 \u043e\u043f\u043b\u0430\u0442\u0430 \u0437\u0430\u0431\u043b\u043e\u043a\u043e\u0432\u0430\u043d\u0430.';
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

    function renderPendingOrdersNotice(currentOrderId = null) {
        const pendingNotice = $('pendingReceiptNotice');
        if (!pendingNotice) return;
        const serverIds = (state.unresolvedOrders || []).map(order => String(order.id)).filter(Boolean);
        const ids = serverIds.length ? serverIds : pendingOrderIds();
        if (currentOrderId && !ids.includes(String(currentOrderId))) ids.unshift(String(currentOrderId));
        pendingNotice.classList.toggle('hidden', ids.length === 0);
        pendingNotice.textContent = ids.length
            ? `Незавершені чеки: ${ids.map(id => `RCP-${id}`).join(', ')}. Вони залишаються у серверній черзі нижче; повторну оплату для них не створюйте.`
            : '';
    }

    function renderUnresolvedOrders() {
        const body = $('unresolvedOrdersBody');
        if (!body) return;
        const orders = Array.isArray(state.unresolvedOrders) ? state.unresolvedOrders : [];
        if (state.unresolvedQueueState === 'unavailable') {
            const lastKnown = Array.isArray(state.unresolvedLastKnownOrders) ? state.unresolvedLastKnownOrders : [];
            body.innerHTML = `
                <div class="cashier-alert cashier-alert-danger" data-queue-state="queue_unavailable" role="alert">
                    Черга незавершених чеків недоступна. Не приймайте гроші й не починайте наступного клієнта до успішного оновлення.
                </div>
                ${lastKnown.length ? '<p class="cashier-muted">Останній відомий список збережено нижче, але він може бути застарілим.</p>' : '<p class="cashier-empty">Останнього відомого списку немає. Це не означає, що незавершених чеків немає.</p>'}
                ${lastKnown.length ? `<div class="cashier-unresolved-list">${lastKnown.map(order => `
                    <button type="button" class="cashier-unresolved-item" data-order-id="${escapeAttribute(order.id)}" aria-label="Відкрити RCP-${escapeAttribute(order.id)}">
                        <span><strong>RCP-${escapeHtml(order.id)}</strong><small>${escapeHtml(order.orderKey || '')}</small></span>
                        <span>${order.isMine === true ? 'Мій чек' : escapeHtml(order.cashierIdentity || 'Інший касир')}</span>
                        <span>${escapeHtml(formatMoneyMinor(order.totalAmountMinor))}</span>
                        <span>${escapeHtml(formatStatus(order.paymentStatus))}</span>
                        <span class="cashier-status ${escapeAttribute(classifyStatus(order.fiscalStatus))}">${escapeHtml(formatStatus(order.fiscalStatus))}</span>
                        <span>${order.nextRunAt ? `наступна спроба ${escapeHtml(new Date(order.nextRunAt).toLocaleString('uk-UA'))}` : 'стан відновлення ще невідомий'}</span>
                    </button>
                `).join('')}</div>` : ''}
            `;
            renderPendingOrdersNotice();
            syncCreateAvailability();
            syncConfirmationAvailability();
            return;
        }
        if (!orders.length) {
            body.innerHTML = '<p class="cashier-empty" data-queue-state="empty">Незавершених чеків для цієї каси немає.</p>';
            renderPendingOrdersNotice();
            return;
        }
        const myCount = orders.filter(order => order.isMine === true).length;
        const registerCount = orders.length;
        body.innerHTML = `
            <div class="cashier-report-grid" aria-label="Підсумок незавершених чеків">
                <div><dt>Мої чеки</dt><dd>${myCount}</dd></div>
                <div><dt>Вся каса</dt><dd>${registerCount}</dd></div>
            </div>
            <div class="cashier-unresolved-list">
                ${orders.map(order => `
                    <button type="button" class="cashier-unresolved-item" data-order-id="${escapeAttribute(order.id)}" aria-label="Відкрити RCP-${escapeAttribute(order.id)}">
                        <span><strong>RCP-${escapeHtml(order.id)}</strong><small>${escapeHtml(order.orderKey || '')}</small></span>
                        <span>${escapeHtml(formatMoneyMinor(order.totalAmountMinor))}</span>
                        <span>${escapeHtml(formatStatus(order.paymentStatus))}</span>
                        <span class="cashier-status ${escapeAttribute(classifyStatus(order.fiscalStatus))}">${escapeHtml(formatStatus(order.fiscalStatus))}</span>
                        <span>${order.nextRunAt ? `наступна спроба ${escapeHtml(new Date(order.nextRunAt).toLocaleString('uk-UA'))}` : 'очікує автоматичного відновлення'}</span>
                        <span>${order.incidentReason ? `причина: ${escapeHtml(order.incidentReason)}` : ''}</span>
                    </button>
                `).join('')}
            </div>`;
        renderPendingOrdersNotice();
    }

    async function loadUnresolvedOrders({ silent = false } = {}) {
        if (state.unresolvedInFlight) return state.unresolvedOrders;
        state.unresolvedInFlight = true;
        const button = $('refreshUnresolvedOrdersBtn');
        if (button) button.disabled = true;
        try {
            const params = new URLSearchParams({ crmProfileKey: PILOT_SCOPE.crmProfileKey, registerAlias: PILOT_SCOPE.registerAlias });
            const result = await apiRequest(`/api/payments/unresolved-orders?${params.toString()}`, {
                method: 'GET',
                headers: apiHeaders(),
                timeoutMs: READINESS_REQUEST_TIMEOUT_MS
            });
            state.unresolvedOrders = Array.isArray(result.orders) ? result.orders : [];
            state.unresolvedLastKnownOrders = state.unresolvedOrders;
            state.unresolvedQueueState = 'available';
            state.unresolvedLastRefreshAt = Date.now();
            state.unresolvedLastError = null;
            renderUnresolvedOrders();
            renderReadinessState();
            syncCreateAvailability();
            syncConfirmationAvailability();
            if (!silent) notify('Чергу незавершених чеків оновлено.', 'success');
            return state.unresolvedOrders;
        } catch (error) {
            state.unresolvedQueueState = 'unavailable';
            state.unresolvedLastError = { code: error?.code || error?.name || 'queue_unavailable', message: error?.message || 'queue_unavailable' };
            if (!silent) notify(paymentUiError(error), 'error');
            renderUnresolvedOrders();
            renderReadinessState();
            return state.unresolvedOrders;
        } finally {
            state.unresolvedInFlight = false;
            if (button) button.disabled = false;
        }
    }

    function renderCheckboxSalesReport(report) {
        const body = $('checkboxSalesReportBody');
        if (!body) return;
        if (!report) {
            body.textContent = 'Звіт не завантажено.';
            return;
        }
        const totals = report.totals || {};
        const counts = totals.statusCounts || {};
        const orders = Array.isArray(report.orders) ? report.orders : [];
        const totalCount = Number(report.totalCount || orders.length || 0);
        const page = Number(report.page || 1);
        const pageSize = Number(report.pageSize || orders.length || 50);
        body.innerHTML = `
            <dl class="cashier-report-grid">
                <div><dt>Оплати</dt><dd>${escapeHtml(formatMoneyMinor(totals.paymentTotalMinor || 0))}</dd></div>
                <div><dt>Готівка</dt><dd>${escapeHtml(formatMoneyMinor(totals.cashTotalMinor || 0))}</dd></div>
                <div><dt>Термінал</dt><dd>${escapeHtml(formatMoneyMinor(totals.cardTerminalTotalMinor || 0))}</dd></div>
                <div><dt>Фіскалізовано</dt><dd>${Number(counts.fiscalized || 0)}</dd></div>
                <div><dt>Очікують/невідомі</dt><dd>${Number(counts.pending || 0) + Number(counts.unknown || 0) + Number(counts.failed_retryable || 0)}</dd></div>
                <div><dt>Зупинені/термінальні</dt><dd>${Number(counts.dead || 0) + Number(counts.failed_terminal || 0)}</dd></div>
                <div><dt>Сторінка</dt><dd>${page} · ${orders.length}/${totalCount}</dd></div>
            </dl>
            <p class="cashier-muted">Суми пораховані по всьому фільтру, не лише по ${pageSize} рядках поточної сторінки. Це внутрішній звіт, не Z-звіт.</p>
            <div class="cashier-unresolved-list">
                ${orders.map(order => `
                    <div class="cashier-unresolved-item">
                        <span><strong>RCP-${escapeHtml(order.id)}</strong><small>${escapeHtml(order.confirmedAt ? new Date(order.confirmedAt).toLocaleString('uk-UA') : '')}</small></span>
                        <span>${escapeHtml(order.paymentMethod === 'card_terminal' ? 'термінал' : 'готівка')}</span>
                        <span>${escapeHtml(formatMoneyMinor(order.totalAmountMinor))}</span>
                        <span class="cashier-status ${escapeAttribute(classifyStatus(order.fiscalStatus))}">${escapeHtml(formatStatus(order.fiscalStatus))}</span>
                        ${isTrustedCheckboxUrl(order.providerTaxUrl) ? `<a class="btn btn-secondary" target="_blank" rel="noopener" href="${escapeAttribute(order.providerTaxUrl)}">Чек</a>` : '<span></span>'}
                    </div>
                `).join('') || '<p class="cashier-empty">Оплачених продажів ще немає.</p>'}
            </div>`;
    }

    async function loadCheckboxSalesReport({ silent = false } = {}) {
        if (state.reportInFlight) return;
        state.reportInFlight = true;
        const button = $('loadCheckboxSalesReportBtn');
        if (button) button.disabled = true;
        try {
            const params = new URLSearchParams({ crmProfileKey: PILOT_SCOPE.crmProfileKey, registerAlias: PILOT_SCOPE.registerAlias });
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
            if (!silent) notify('Внутрішній звіт продажів Checkbox завантажено.', 'success');
        } catch (error) {
            if (!silent) notify(paymentUiError(error), 'error');
        } finally {
            state.reportInFlight = false;
            if (button) button.disabled = false;
        }
    }

    function isTrustedCheckboxUrl(href) {
        if (!href) return false;
        try {
            const parsed = new URL(String(href), window.location.origin);
            const host = parsed.hostname.toLowerCase();
            return parsed.protocol === 'https:'
                && (host === 'api.checkbox.ua'
                    || host === 'api.checkbox.in.ua'
                    || host.endsWith('.checkbox.ua')
                    || host.endsWith('.checkbox.in.ua'));
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

    function renderRegisterState(result) {
        if (!result) {
            state.cashierProEnabled = false;
            setText('cashierFiscalProfile', state.orderDetails?.order ? $('cashierFiscalProfile')?.textContent : '—');
            setText('cashierRegister', state.orderDetails?.order ? $('cashierRegister')?.textContent : '—');
            setText('opsFiscalProfile', '—');
            setText('opsRegister', '—');
            setStatus('activeShiftStatus', 'not_open');
            setText('activeShiftId', '—');
            setText('shiftExpectedCash', formatMoneyMinor(0));
            setText('shiftExpectedTerminal', formatMoneyMinor(0));
            renderBlockers([]);
            renderReportBody(null);
            renderReadinessState();
            syncCreateAvailability();
            syncConfirmationAvailability();
            return;
        }
        state.cashierProEnabled = Boolean(result.cashierProEnabled);
        if (!state.orderDetails?.order) {
            setText('cashierFiscalProfile', `${result.crmProfileKey || 'event_genix'} / ${result.legalEntityName || result.legalEntityKey || 'ФОП не налаштовано'}`);
            setText('cashierRegister', `${result.locationAlias || 'park'} / ${result.registerDisplayName || result.registerAlias || 'middle'}`);
        }
        setText('opsFiscalProfile', `${result.crmProfileKey || '?'} / ${result.legalEntityName || result.legalEntityKey || '\u0424\u041e\u041f \u043d\u0435 \u043d\u0430\u043b\u0430\u0448\u0442\u043e\u0432\u0430\u043d\u043e'}`);
        setText('opsRegister', `${result.locationAlias || 'park'} / ${result.registerDisplayName || result.registerAlias || 'middle'}`);
        setStatus('activeShiftStatus', result.shift?.status || 'not_open');
        setText('activeShiftId', result.shift?.id || '?');
        setText('shiftExpectedCash', formatMoneyMinor(result.checklist?.cashExpectedMinor || 0));
        setText('shiftExpectedTerminal', formatMoneyMinor(result.checklist?.terminalExpectedMinor || 0));
        const cashActual = $('cashActualAmount');
        const terminalActual = $('terminalReportTotalAmount');
        if (cashActual && !cashActual.value) cashActual.value = minorToNumber(result.checklist?.cashExpectedMinor || 0).toFixed(2);
        if (terminalActual && !terminalActual.value) terminalActual.value = minorToNumber(result.checklist?.terminalExpectedMinor || 0).toFixed(2);
        renderBlockers(result.checklist?.pendingUnknownOperations || []);
        renderReadinessState();
        syncCreateAvailability();
        syncConfirmationAvailability();
    }

    function renderBlockers(blockers) {
        const panel = $('shiftBlockersPanel');
        const list = $('shiftBlockersList');
        const rows = Array.isArray(blockers) ? blockers : [];
        if (panel) panel.classList.toggle('hidden', rows.length === 0);
        if (list) {
            list.innerHTML = rows.length
                ? rows.map(item => `<li>\u041e\u043f\u0435\u0440\u0430\u0446\u0456\u044f #${escapeHtml(item.id)} \u00b7 ${escapeHtml(item.type)} \u00b7 ${escapeHtml(formatStatus(item.status))}</li>`).join('')
                : '';
        }
    }

    function renderReportBody(report) {
        const body = $('operationalReportBody');
        if (!body) return;
        if (!report) {
            body.textContent = 'Звіт не завантажено.';
            return;
        }
        const checklist = report.checklist || {};
        body.innerHTML = `
            <dl class="cashier-report-grid">
                <div><dt>\u0412\u043d\u0443\u0442\u0440\u0456\u0448\u043d\u0456\u0439 \u0437\u0432\u0456\u0442</dt><dd>${escapeHtml(report.internalReportLabel || '\u0412\u043d\u0443\u0442\u0440\u0456\u0448\u043d\u0456\u0439 \u043e\u043f\u0435\u0440\u0430\u0446\u0456\u0439\u043d\u0438\u0439 \u0437\u0432\u0456\u0442')}</dd></div>
                <div><dt>\u041e\u0444\u0456\u0446\u0456\u0439\u043d\u0438\u0439 Z-\u0437\u0432\u0456\u0442</dt><dd>${report.officialZReport ? '\u0442\u0430\u043a' : '\u043d\u0456'}</dd></div>
                <div><dt>\u041e\u0447\u0456\u043a\u0443\u0432\u0430\u043d\u0430 \u0433\u043e\u0442\u0456\u0432\u043a\u0430</dt><dd>${escapeHtml(formatMoneyMinor(checklist.cashExpectedMinor || 0))}</dd></div>
                <div><dt>\u041e\u0447\u0456\u043a\u0443\u0432\u0430\u043d\u0438\u0439 \u0442\u0435\u0440\u043c\u0456\u043d\u0430\u043b</dt><dd>${escapeHtml(formatMoneyMinor(checklist.terminalExpectedMinor || 0))}</dd></div>
                <div><dt>\u0421\u043b\u0443\u0436\u0431\u043e\u0432\u0435 \u0432\u043d\u0435\u0441\u0435\u043d\u043d\u044f</dt><dd>${escapeHtml(formatMoneyMinor(checklist.serviceInMinor || 0))}</dd></div>
                <div><dt>\u0421\u043b\u0443\u0436\u0431\u043e\u0432\u0430 \u0432\u0438\u0434\u0430\u0447\u0430</dt><dd>${escapeHtml(formatMoneyMinor(checklist.serviceOutMinor || 0))}</dd></div>
            </dl>
            ${report.checkboxZDocumentUrl ? `<a class="btn btn-secondary" target="_blank" rel="noopener" href="${escapeAttribute(report.checkboxZDocumentUrl)}">\u0412\u0456\u0434\u043a\u0440\u0438\u0442\u0438 \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442 Checkbox</a>` : '<p class="cashier-muted">\u041f\u043e\u0441\u0438\u043b\u0430\u043d\u043d\u044f \u043d\u0430 \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442 Checkbox \u0449\u0435 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0435.</p>'}
        `;
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
            && state.unresolvedQueueState === 'available'
            && state.registerState?.fiscalProfileId
            && state.registerState?.fiscalRegisterId
        );
    }

    function queueUnavailableReason() {
        if (state.unresolvedQueueState === 'available') return '';
        if (state.unresolvedQueueState === 'unavailable') return 'Черга незавершених чеків недоступна. Оновіть список перед прийманням грошей.';
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

    function renderReadinessState() {
        const panel = $('cashierReadinessStatus');
        if (!panel) return;
        const messages = [];
        if (!state.registerState) {
            messages.push('Не вдалося прочитати стан пілотної каси.');
        } else {
            const code = state.registerState.readinessCode || 'unknown';
            const readableLabels = {
                mapping_missing: 'Налаштування park / middle відсутнє.',
                mapping_ambiguous: 'Налаштування park / middle неоднозначне.',
                binding_missing: 'Користувач не прив’язаний до цієї каси.',
                fiscal_context_incomplete: 'Фіскальний контекст неповний: бракує ФОП, каси, касира або credential refs.',
                register_disabled: 'Пілотний register вимкнений.',
                global_integration_disabled: 'Інтеграція Checkbox вимкнена через CHECKBOX_INTEGRATION_ENABLED=false.',
                payment_acceptance_disabled: 'Приймання нових оплат вимкнене через CHECKBOX_ACCEPT_PAYMENTS_ENABLED=false.',
                credentials_missing: 'Runtime-доступи для Checkbox не налаштовані.',
                runtime_config_missing: 'Runtime config Checkbox відсутній.',
                runtime_config_invalid: 'Runtime config Checkbox невалідний.',
                provider_unavailable: 'Provider Checkbox тимчасово недоступний.',
                identity_mismatch: 'Checkbox повернув іншу організацію, касира або касу.',
                checkbox_cashier_test_mode_mismatch: 'Касир Checkbox не підтверджений як test-mode для пілоту.',
                checkbox_expected_is_test_mismatch: 'Очікуваний test/prod mode не збігається між DB mapping, env і provider.',
                shift_opening: 'Зміна відкривається у Checkbox.',
                shift_closing: 'Зміна закривається у Checkbox.',
                readiness_stale: 'Готовність застаріла, потрібна свіжа перевірка.',
                readiness_missing: 'Готовність ще не перевірена.',
                tax_mapping_missing: 'Фіскальні назви/податки для квитків не налаштовані.',
                ready: '',
                unknown: 'Стан готовності каси невідомий.'
            };
            const labels = {
                mapping_missing: 'Налаштування park / middle відсутнє.',
                mapping_ambiguous: 'Налаштування park / middle неоднозначне.',
                binding_missing: 'Користувач не прив’язаний до цієї каси.',
                register_disabled: 'Пілотний register вимкнений.',
                global_integration_disabled: 'Інтеграція Checkbox вимкнена через CHECKBOX_INTEGRATION_ENABLED=false.',
                credentials_missing: 'Runtime-доступи для Checkbox не налаштовані.',
                runtime_config_missing: 'Runtime config Checkbox відсутній.',
                runtime_config_invalid: 'Runtime config Checkbox невалідний.',
                provider_unavailable: 'Provider Checkbox тимчасово недоступний.',
                identity_mismatch: 'Checkbox повернув іншу організацію, касира або касу.',
                checkbox_cashier_test_mode_mismatch: 'Касир Checkbox не підтверджений як test-mode для пілоту.',
                shift_opening: 'Зміна відкривається у Checkbox.',
                shift_closing: 'Зміна закривається у Checkbox.',
                readiness_stale: 'Готовність застаріла, потрібна свіжа перевірка.',
                readiness_missing: 'Готовність ще не перевірена.',
                tax_mapping_missing: 'Фіскальні назви/податки для квитків не налаштовані.',
                ready: '',
                unknown: 'Стан готовності каси невідомий.'
            };
            if (readableLabels[code]) messages.push(readableLabels[code]);
            else if (labels[code]) messages.push(labels[code]);
            if (state.registerState.shift && normalizeStatus(state.registerState.shift.status) === 'opening') {
                messages.push('Зміна відкривається у Checkbox; підтвердження грошей буде доступне після готовності provider.');
            }
            if (!state.registerState.mappingExists) messages.push('Немає однозначного fiscal profile/register mapping.');
            if (!(state.registerState.featureEnabled || state.registerState.registerFeatureEnabled)) messages.push('Register feature flag вимкнений.');
            if (state.registerState.checkboxIntegrationEnabled === false) messages.push('Глобальна інтеграція Checkbox вимкнена.');
            if (state.registerState.runtimeConfigResolvable === false) messages.push('Credential refs не резолвляться у environment.');
        }
        const queueReason = queueUnavailableReason();
        if (queueReason) messages.push(queueReason);
        panel.textContent = messages.length
            ? `${messages.join(' ')} Підтвердження грошей заблоковане.`
            : 'Пілотна каса готова до тестової оплати.';
        panel.classList.toggle('hidden', messages.length === 0);
    }

    function setDisabledReason(el, disabled, reason) {
        if (!el) return;
        el.disabled = Boolean(disabled);
        el.setAttribute('aria-disabled', disabled ? 'true' : 'false');
        if (disabled && reason) el.title = reason;
        else el.removeAttribute('title');
    }

    function syncCreateAvailability() {
        const ready = integrationReady();
        const active = activeUnfinishedOrder();
        const order = state.orderDetails?.order;
        const nextAllowed = orderAllowsNextCustomer(order);
        const hasCurrentOrder = Boolean(order?.id);
        const disabled = !ready || active || state.createInFlight || (hasCurrentOrder && !orderIsComplete(order));
        const reason = !ready
            ? 'Каса не готова: перевірте readiness block.'
            : (active ? 'Спершу підтвердьте або скасуйте поточну чернетку.' : (hasCurrentOrder ? 'Натисніть “Нова оплата” для наступного клієнта.' : ''));
        const form = $('paymentOrderForm');
        if (form) {
            form.querySelectorAll('input, select').forEach(el => { el.disabled = disabled; });
        }
        setText('createPaymentDisabledReason', reason || 'Каса готова. Ціна, ФОП, профіль і каса визначаються сервером.');
        setDisabledReason($('createPaymentOrderBtn'), disabled, reason);
        const nextButton = $('startNextOrderBtn');
        if (nextButton) {
            nextButton.classList.toggle('hidden', !nextAllowed);
            setDisabledReason(nextButton, nextAllowed && state.unresolvedQueueState !== 'available', queueUnavailableReason());
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

    function hasOpenShift() {
        const status = normalizeStatus(state.registerState?.shift?.status);
        return status === 'open' || status === 'opening';
    }

    function hasCloseBlockers() {
        return Boolean(state.registerState?.checklist?.pendingUnknownOperations?.length);
    }

    function baseScopePayload() {
        const mapping = state.registerState;
        const order = state.orderDetails?.order || {};
        const fiscalProfileId = mapping?.fiscalProfileId || order.fiscalProfileId;
        const fiscalLocationId = mapping?.fiscalLocationId || order.fiscalLocationId;
        const fiscalRegisterId = mapping?.fiscalRegisterId || order.fiscalRegisterId;
        if (!fiscalProfileId || !fiscalLocationId || !fiscalRegisterId) throw new Error('fiscal_mapping_ambiguous_or_missing');
        return {
            crmProfileKey: mapping?.crmProfileKey || order.crmProfileKey || PILOT_SCOPE.crmProfileKey,
            fiscalProfileId,
            fiscalLocationId,
            fiscalRegisterId
        };
    }

    function setFormControlsEnabled(formId, enabled) {
        const form = $(formId);
        if (!form) return;
        form.querySelectorAll('input, button, textarea, select').forEach(el => { el.disabled = !enabled; });
    }

    function syncOperationalAvailability() {
        const panel = $('operationalContourPanel');
        if (panel) {
            panel.classList.add('hidden');
            panel.setAttribute('aria-hidden', 'true');
        }
    }

    function syncOperationBusyState() {
        // Cashier PRO is intentionally not loaded on the thin "Оплата та чек" page.
    }

    function syncConfirmationAvailability() {
        const order = state.orderDetails?.order || null;
        const hasOrder = Boolean(order?.id);
        const blocked = !integrationReady() || !hasOrder || orderBlocksPayment(order) || state.confirmSubmitted || state.confirmInFlight;
        const reason = !integrationReady()
            ? 'Каса не готова до Checkbox операцій.'
            : (!hasOrder ? 'Спершу створіть оплату.' : (orderBlocksPayment(order) ? 'Цю оплату вже не можна підтвердити повторно.' : ''));
        const cashReceived = $('cashReceivedAmount');
        const terminalSuccess = $('terminalSuccessCheckbox');
        const terminalReference = $('terminalReference');
        setText('confirmDisabledReason', reason);
        if (cashReceived) cashReceived.disabled = blocked || state.tender !== 'cash';
        if (terminalSuccess) terminalSuccess.disabled = blocked || state.tender !== 'card_terminal_manual';
        if (terminalReference) terminalReference.disabled = blocked || state.tender !== 'card_terminal_manual';
        setDisabledReason($('confirmCashBtn'), blocked || state.tender !== 'cash', reason);
        setDisabledReason($('confirmCardBtn'), blocked || state.tender !== 'card_terminal_manual' || !$('terminalSuccessCheckbox')?.checked, reason || 'Поставте позначку, що термінал показав успіх.');
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
            output.textContent = '?';
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
            notify(result.replayed ? '\u041f\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0436\u0435\u043d\u043d\u044f \u043f\u043e\u0432\u0442\u043e\u0440\u0435\u043d\u043e \u0437 \u0442\u0438\u043c \u0441\u0430\u043c\u0438\u043c Idempotency-Key.' : '\u041e\u043f\u043b\u0430\u0442\u0443 \u043f\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0436\u0435\u043d\u043e. \u0427\u0435\u043a \u043f\u043e\u0441\u0442\u0430\u0432\u043b\u0435\u043d\u043e \u0432 \u043d\u0430\u0434\u0456\u0439\u043d\u0443 \u0447\u0435\u0440\u0433\u0443 \u0444\u0456\u0441\u043a\u0430\u043b\u0456\u0437\u0430\u0446\u0456\u0457.', 'success');
            syncOrderPolling(state.orderDetails?.order);
            focusFiscalResult();
        } catch (error) {
            notify(paymentUiError(error), 'error');
        } finally {
            state.confirmInFlight = false;
            syncConfirmationAvailability();
        }
    }

    async function runOperation(buttonId, action, target, callback) {
        if (state.operationInFlight.has(buttonId)) return;
        state.operationInFlight.add(buttonId);
        syncOperationalAvailability();
        const idempotencyKey = getOperationIdempotencyKey(action, target);
        try {
            const result = await callback(idempotencyKey);
            clearOperationIdempotencyKey(action, target);
            await loadPilotRegisterState({ silent: true });
            return result;
        } catch (error) {
            notify(paymentUiError(error), 'error');
            return null;
        } finally {
            state.operationInFlight.delete(buttonId);
            syncOperationalAvailability();
        }
    }

    async function submitServiceIn(event) {
        event?.preventDefault?.();
        if (!$('serviceInFinalCheck')?.checked) {
            notify('Confirm final service-in text before submitting.', 'error');
            return;
        }
        await runOperation('serviceInBtn', 'service-in', 'current', async idempotencyKey => {
            const result = await apiRequest('/api/payments/service-in', {
                method: 'POST',
                headers: apiHeaders(idempotencyKey),
                body: JSON.stringify({ ...baseScopePayload(), amountMinor: parseAmountInput('serviceInAmount', 'service_in_amount_required'), reason: $('serviceInReason')?.value?.trim() || null, finalConfirmation: SERVICE_IN_FINAL_CONFIRMATION })
            });
            notify(result.replayed ? 'Service-in replayed with the same key.' : 'Service-in queued for Checkbox.', 'success');
            $('serviceInAmount').value = '';
            $('serviceInReason').value = '';
            $('serviceInFinalCheck').checked = false;
            return result;
        });
    }

    async function submitServiceOut(event) {
        event?.preventDefault?.();
        await runOperation('serviceOutRequestBtn', 'service-out-request', 'current', async idempotencyKey => {
            const result = await apiRequest('/api/payments/service-out', {
                method: 'POST',
                headers: apiHeaders(idempotencyKey),
                body: JSON.stringify({ ...baseScopePayload(), amountMinor: parseAmountInput('serviceOutAmount', 'service_out_amount_required'), reason: $('serviceOutReason')?.value?.trim() })
            });
            if (result.operationId) {
                state.lastServiceOutOperationId = result.operationId;
                setText('serviceOutApprovalOperationId', result.operationId);
            }
            notify(result.replayed ? 'Service-out request replayed with the same key.' : 'Service-out request created. Use separate approval.', 'success');
            syncOperationalAvailability();
            return result;
        });
    }

    async function approveServiceOutSubmit(event) {
        event?.preventDefault?.();
        const operationId = state.lastServiceOutOperationId || $('serviceOutApprovalOperationId')?.textContent?.trim();
        if (!operationId || operationId === '?') {
            notify('No service-out operation selected for approval.', 'error');
            return;
        }
        await runOperation('serviceOutApproveBtn', 'service-out-approve', operationId, async idempotencyKey => {
            const result = await apiRequest(`/api/payments/service-out/${encodeURIComponent(operationId)}/approve`, {
                method: 'POST',
                headers: apiHeaders(idempotencyKey),
                body: JSON.stringify({ pin: $('serviceOutApprovalPin')?.value || '' })
            });
            $('serviceOutApprovalPin').value = '';
            state.lastServiceOutOperationId = null;
            setText('serviceOutApprovalOperationId', '?');
            notify(result.replayed ? 'Service-out approval replayed with the same key.' : 'Service-out approved and queued.', 'success');
            return result;
        });
    }

    async function submitRefund(event) {
        event?.preventDefault?.();
        const orderId = $('refundOrderId')?.value?.trim();
        if (!orderId) {
            notify(paymentUiError(new Error('refund_order_required')), 'error');
            return;
        }
        await runOperation('refundBtn', 'refund-full', orderId, async idempotencyKey => {
            const result = await apiRequest(`/api/payments/orders/${encodeURIComponent(orderId)}/refund`, {
                method: 'POST',
                headers: apiHeaders(idempotencyKey),
                body: JSON.stringify({
                    reason: $('refundReason')?.value?.trim(),
                    pin: $('refundPin')?.value || '',
                    terminalRefundConfirmed: Boolean($('terminalRefundConfirmed')?.checked),
                    terminalRefundReference: $('terminalRefundReference')?.value?.trim() || undefined
                })
            });
            $('refundPin').value = '';
            notify(result.replayed ? 'Refund replayed with the same key.' : 'Full refund queued. Original receipt remains immutable.', 'success');
            return result;
        });
    }

    function reconciliationPayload() {
        return {
            cashActualMinor: parseNullableAmountInput('cashActualAmount'),
            terminalReportTotalMinor: parseNullableAmountInput('terminalReportTotalAmount'),
            reason: $('reconciliationReason')?.value?.trim() || null,
            pin: $('reconciliationPin')?.value || undefined
        };
    }

    async function submitReconciliation(event) {
        event?.preventDefault?.();
        const shiftId = state.registerState?.shift?.id;
        if (!shiftId) {
            notify('Open shift is required for reconciliation.', 'error');
            return;
        }
        await runOperation('reconcileShiftBtn', 'reconcile-shift', shiftId, async idempotencyKey => {
            const result = await apiRequest(`/api/payments/shifts/${encodeURIComponent(shiftId)}/reconcile`, {
                method: 'POST',
                headers: apiHeaders(idempotencyKey),
                body: JSON.stringify(reconciliationPayload())
            });
            $('reconciliationPin').value = '';
            notify(result.replayed ? 'Reconciliation replayed with the same key.' : 'Reconciliation revision saved.', 'success');
            return result;
        });
    }

    async function closeShift() {
        const shiftId = state.registerState?.shift?.id;
        if (!shiftId) {
            notify('Open shift is required for close.', 'error');
            return;
        }
        if (hasCloseBlockers()) {
            notify(paymentUiError(new Error('shift_close_blocked')), 'error');
            return;
        }
        await runOperation('closeShiftBtn', 'close-shift', shiftId, async idempotencyKey => {
            const result = await apiRequest(`/api/payments/shifts/${encodeURIComponent(shiftId)}/close`, {
                method: 'POST',
                headers: apiHeaders(idempotencyKey),
                body: JSON.stringify(reconciliationPayload())
            });
            $('reconciliationPin').value = '';
            notify(result.replayed ? 'Shift close replayed with the same key.' : 'Shift close queued.', 'success');
            return result;
        });
    }

    async function loadOperationalReport() {
        const shiftId = state.registerState?.shift?.id;
        if (!shiftId) {
            notify('Open or recent shift is required for operational report.', 'error');
            return;
        }
        await runOperation('loadOperationalReportBtn', 'load-report', shiftId, async () => {
            const result = await apiRequest(`/api/payments/shifts/${encodeURIComponent(shiftId)}/report`, {
                method: 'GET',
                headers: apiHeaders()
            });
            renderReportBody(result);
            notify('Operational report loaded.', 'success');
            return result;
        });
    }

    async function cancelDraftOrder() {
        const order = state.orderDetails?.order;
        if (!order?.id) return;
        if (!(normalizeStatus(order.paymentStatus) === 'unpaid' && normalizeStatus(order.status) === 'draft')) {
            notify(paymentUiError(new Error('payment_order_cancel_denied')), 'error');
            return;
        }
        const idempotencyKey = getOperationIdempotencyKey('cancel-draft', order.id);
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
        if (state.unresolvedQueueState !== 'available') {
            notify(queueUnavailableReason(), 'error');
            $('refreshUnresolvedOrdersBtn')?.focus?.({ preventScroll: false });
            return;
        }
        clearOrderPolling();
        clearCreateIdempotencyKey();
        storageRemove('lastOrderId');
        const currentOrderId = state.orderDetails?.order?.id;
        if (currentOrderId) storageRemove(`confirm:${PILOT_SCOPE.crmProfileKey}:${PILOT_SCOPE.registerAlias}:${currentOrderId}`);
        state.orderDetails = null;
        state.confirmSubmitted = false;
        state.confirmInFlight = false;
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
        void loadUnresolvedOrders({ silent: true });
        renderRegisterState(state.registerState);
        syncTenderControls();
        syncCreateAvailability();
        $('paymentDate')?.focus();
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
        $('loadCheckboxSalesReportBtn')?.addEventListener('click', () => { void loadCheckboxSalesReport({ silent: false }); });
        $('refreshReadinessBtn')?.addEventListener('click', () => { void refreshReadiness({ silent: false }); });
        $('unresolvedOrdersBody')?.addEventListener('click', event => {
            const target = event.target?.closest?.('[data-order-id]');
            const orderId = target?.getAttribute?.('data-order-id');
            if (orderId) void loadPaymentOrder(orderId, { silent: false });
        });
        $('refreshShiftStateBtn')?.addEventListener('click', () => { void refreshReadiness({ silent: false }); });
        $('serviceInForm')?.addEventListener('submit', submitServiceIn);
        $('serviceOutForm')?.addEventListener('submit', submitServiceOut);
        $('serviceOutApprovalPanel')?.addEventListener('submit', approveServiceOutSubmit);
        $('refundForm')?.addEventListener('submit', submitRefund);
        $('reconciliationForm')?.addEventListener('submit', submitReconciliation);
        $('closeShiftBtn')?.addEventListener('click', closeShift);
        $('loadOperationalReportBtn')?.addEventListener('click', loadOperationalReport);
        const today = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/Kyiv',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(new Date());
        if ($('paymentDate') && !$('paymentDate').value) $('paymentDate').value = today;
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
        syncOperationalAvailability();
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
                setDenied('Немає доступу до park cashier або потрібних payment capabilities. Касиру не потрібен finance.manage.');
                return;
            }
            await loadPilotRegisterState({ silent: true });
            await loadUnresolvedOrders({ silent: true });
            scheduleReadinessRefresh();
            const params = new URLSearchParams(window.location.search);
            const orderId = params.get('orderId') || storageGet('lastOrderId');
            if (orderId) {
                try { await loadPaymentOrder(orderId, { silent: true }); }
                catch { /* stale local order id should not block opening the page */ }
            }
        } catch (error) {
            if (error?.message === 'Invalid token') {
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

    document.addEventListener('DOMContentLoaded', () => { void initCashierPaymentsPage(); });

    window.CashierPaymentsPage = {
        PILOT_SCOPE,
        state,
        formatMoneyMinor,
        parseUahToMinor,
        getCreateIdempotencyKey,
        getConfirmIdempotencyKey,
        getOperationIdempotencyKey,
        loadPaymentOrder,
        loadPilotRegisterState
    };
})();
