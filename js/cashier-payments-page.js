
'use strict';

(function () {
    const PILOT_SCOPE = Object.freeze({ crmProfileKey: 'event_genix', registerAlias: 'middle', defaultEnabled: false });
    const INTERNAL_RECEIPT_TEXT = '\u0432\u043d\u0443\u0442\u0440\u0456\u0448\u043d\u044f \u043a\u0432\u0438\u0442\u0430\u043d\u0446\u0456\u044f';
    const STORAGE_PREFIX = 'eventgenix:cashier-payments';
    const FISCAL_BLOCKING_STATUSES = new Set(['pending', 'unknown', 'sending', 'validating', 'ready_to_send', 'failed_retryable']);
    const FISCAL_DONE_STATUSES = new Set(['fiscalized']);

    const state = {
        user: null,
        orderDetails: null,
        createInFlight: false,
        confirmInFlight: false,
        confirmSubmitted: false,
        tender: 'cash'
    };

    function $(id) { return document.getElementById(id); }

    function notify(message, type = 'info') {
        if (typeof showNotification === 'function') showNotification(message, type);
        const el = $('cashierGlobalStatus');
        if (el) {
            el.textContent = message;
            el.classList.remove('hidden', 'cashier-alert-danger');
            if (type === 'error') el.classList.add('cashier-alert-danger');
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
            draft: 'draft', unpaid: 'unpaid', pending: 'pending', unknown: 'unknown', confirmed: 'confirmed',
            payment_recorded: 'payment recorded', fiscalized: 'fiscalized', failed: 'failed', cancelled: 'cancelled',
            validation_failed: 'validation failed', ready_to_send: 'ready to send', sending: 'sending', validating: 'validating'
        };
        return labels[status] || status;
    }

    function classifyStatus(value) {
        const status = normalizeStatus(value);
        if (['confirmed', 'payment_recorded', 'fiscalized'].includes(status)) return 'is-ok';
        if (['pending', 'unknown', 'ready_to_send', 'sending', 'validating'].includes(status)) return 'is-warn';
        if (['failed', 'validation_failed', 'blocked', 'cancelled'].includes(status)) return 'is-danger';
        return '';
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

    function storageGet(key) {
        try { return window.localStorage.getItem(`${STORAGE_PREFIX}:${key}`); }
        catch { return null; }
    }

    function storageSet(key, value) {
        try { window.localStorage.setItem(`${STORAGE_PREFIX}:${key}`, String(value)); }
        catch {}
    }

    function orderStorageScope() {
        const sourceId = $('paymentSourceId')?.value?.trim() || 'unknown-source';
        return `${PILOT_SCOPE.crmProfileKey}:${PILOT_SCOPE.registerAlias}:${sourceId}:${state.tender}`;
    }

    function getCreateIdempotencyKey() {
        const key = `create:${orderStorageScope()}`;
        const existing = storageGet(key);
        if (existing) return existing;
        const generated = randomKey('cashier-ui-create');
        storageSet(key, generated);
        return generated;
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
        const response = await fetch(path, {
            ...options,
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
    }

    function buildAdmissionTicketPayload() {
        const date = $('paymentDate')?.value;
        const kids = Number($('paymentKidsCount')?.value || 0);
        const adults = Number($('paymentAdultsCount')?.value || 0);
        const sourceId = $('paymentSourceId')?.value?.trim();
        if (!date) throw new Error('payment_date_required');
        if (!sourceId) throw new Error('source_id_required');
        if (!Number.isSafeInteger(kids) || kids <= 0) throw new Error('kids_count_invalid');
        if (!Number.isSafeInteger(adults) || adults < 0) throw new Error('adults_count_invalid');
        return {
            tender: state.tender,
            crmProfileKey: PILOT_SCOPE.crmProfileKey,
            sourceId,
            admissionTicket: {
                date,
                banquetGuests: kids,
                banquetAdults: adults,
                ticketQuantities: {
                    regular_child: kids,
                    adult_companion: adults
                }
            }
        };
    }

    async function createPaymentOrder(event) {
        event?.preventDefault?.();
        if (state.createInFlight) return;
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
            notify(result.replayed ? 'Payment order replayed with the same Idempotency-Key.' : 'Payment order created. Review immutable snapshot and confirm payment.', 'success');
        } catch (error) {
            if (button) button.disabled = false;
            notify(paymentUiError(error), 'error');
        } finally {
            state.createInFlight = false;
        }
    }

    async function loadPaymentOrder(orderId, { silent = false } = {}) {
        const result = await apiRequest(`/api/payments/orders/${encodeURIComponent(orderId)}`, {
            method: 'GET',
            headers: apiHeaders()
        });
        state.orderDetails = result;
        state.tender = result.order?.sourceSnapshot?.tender || (result.order?.paymentMethod === 'card_terminal' ? 'card_terminal_manual' : 'cash');
        syncTenderControls();
        renderOrder(result);
        if (!silent) notify('Payment order loaded.', 'success');
        return result;
    }

    function paymentUiError(error) {
        const code = error?.code || error?.message;
        const messages = {
            cash_amount_invalid: 'Cash amount must use no more than two decimal places.',
            cash_received_too_low: 'Received cash is lower than total. Confirmation is blocked.',
            payment_date_required: 'Set ticket date.',
            source_id_required: 'Set test source/order reference.',
            kids_count_invalid: 'Kids count must be greater than zero.',
            adults_count_invalid: 'Adults count cannot be negative.',
            card_terminal_success_required: 'Before confirmation, check: terminal showed successful payment.',
            payment_repeat_blocked: 'Repeat payment is blocked: order is already paid or fiscalization is pending/unknown.',
            fiscal_mapping_ambiguous_or_missing: 'Pilot register park/middle is not enabled or mapping is ambiguous. Feature flag remains disabled-by-default.',
            forbidden: 'No access to this register or CRM profile.'
        };
        return messages[code] || error?.message || 'Cashier action failed.';
    }

    function renderOrder(details) {
        const order = details?.order || null;
        const items = Array.isArray(details?.items) ? details.items : [];
        if (!order) return;
        setText('cashierFiscalProfile', `${order.crmProfileKey || '?'} / ${order.legalEntityName || order.legalEntityKey || 'FOP is not configured'}`);
        setText('cashierRegister', `${order.sourceSnapshot?.location_alias || 'park'} / ${order.registerDisplayName || order.registerAlias || 'middle'}`);
        setStatus('cashierPaymentStatus', order.paymentStatus || order.status);
        setStatus('cashierFiscalStatus', order.fiscalStatus);
        setText('internalReceiptLabel', `RCP-${order.id} — ${INTERNAL_RECEIPT_TEXT}`);
        setText('paymentTotalAmount', formatMoneyMinor(order.totalAmountMinor));
        setText('cardExactAmount', formatMoneyMinor(order.totalAmountMinor));
        renderItems(items);
        renderFiscalResult(details);
        syncConfirmationAvailability();
    }

    function renderItems(items) {
        const body = $('paymentItemsBody');
        if (!body) return;
        if (!items.length) {
            body.innerHTML = '<tr><td colspan="4" class="cashier-empty">No items in snapshot.</td></tr>';
            return;
        }
        body.innerHTML = items.map(item => `
            <tr>
                <td><strong>${escapeHtml(item.itemName)}</strong><div class="cashier-muted">${escapeHtml(item.itemCode || '')} ? ${escapeHtml(item.taxReference || 'tax TBD')}</div></td>
                <td>${escapeHtml(formatQuantity(item.quantityMillis))}</td>
                <td>${escapeHtml(formatMoneyMinor(item.unitPriceMinor))}</td>
                <td>${escapeHtml(formatMoneyMinor(item.totalAmountMinor))}</td>
            </tr>
        `).join('');
    }

    function renderFiscalResult(details) {
        const order = details?.order || {};
        const fiscalStatus = normalizeStatus(order.fiscalStatus);
        const artifacts = details?.artifacts || {};
        const latestReceipt = Array.isArray(details?.receipts) ? details.receipts[0] : null;
        const badge = $('fiscalReceiptBadge');
        if (badge) badge.textContent = fiscalStatus;
        const message = $('fiscalPendingMessage');
        const links = $('providerReceiptLinks');
        const hasOfficialReceipt = FISCAL_DONE_STATUSES.has(fiscalStatus) || latestReceipt?.status === 'fiscalized';
        if (message) {
            if (hasOfficialReceipt) message.textContent = 'Official Checkbox receipt received. RCP-* remains Event Genix internal receipt.';
            else if (FISCAL_BLOCKING_STATUSES.has(fiscalStatus)) message.textContent = 'Fiscalization is pending or unknown. Repeat payment is blocked; use status lookup/reconciliation instead of another payment.';
            else message.textContent = 'After confirmed payment the server creates one durable fiscalization job.';
        }
        setReceiptLink('providerTaxUrl', artifacts.taxUrl || latestReceipt?.providerTaxUrl);
        setReceiptLink('providerPdfUrl', artifacts.pdfUrl || latestReceipt?.providerPdfUrl);
        setReceiptLink('providerQrUrl', artifacts.qrUrl || latestReceipt?.providerQrUrl);
        if (links) links.classList.toggle('hidden', !hasOfficialReceipt);
    }

    function setReceiptLink(id, href) {
        const el = $(id);
        if (!el) return;
        const visible = Boolean(href);
        el.classList.toggle('hidden', !visible);
        if (visible) el.href = href;
        else el.removeAttribute('href');
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
    }

    function orderBlocksPayment(order = state.orderDetails?.order) {
        if (!order) return true;
        const paymentStatus = normalizeStatus(order.paymentStatus);
        const fiscalStatus = normalizeStatus(order.fiscalStatus);
        if (paymentStatus === 'confirmed' || normalizeStatus(order.status) === 'payment_recorded') return true;
        return FISCAL_BLOCKING_STATUSES.has(fiscalStatus) && paymentStatus !== 'unpaid';
    }

    function syncConfirmationAvailability() {
        const order = state.orderDetails?.order || null;
        const hasOrder = Boolean(order?.id);
        const blocked = !hasOrder || orderBlocksPayment(order) || state.confirmSubmitted || state.confirmInFlight;
        const cashReceived = $('cashReceivedAmount');
        const terminalSuccess = $('terminalSuccessCheckbox');
        const terminalReference = $('terminalReference');
        if (cashReceived) cashReceived.disabled = blocked || state.tender !== 'cash';
        if (terminalSuccess) terminalSuccess.disabled = blocked || state.tender !== 'card_terminal_manual';
        if (terminalReference) terminalReference.disabled = blocked || state.tender !== 'card_terminal_manual';
        if ($('confirmCashBtn')) $('confirmCashBtn').disabled = blocked || state.tender !== 'cash';
        if ($('confirmCardBtn')) $('confirmCardBtn').disabled = blocked || state.tender !== 'card_terminal_manual' || !$('terminalSuccessCheckbox')?.checked;
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
        if (!order?.id) throw new Error('payment_order_missing');
        if (orderBlocksPayment(order)) throw new Error('payment_repeat_blocked');
        if (state.tender === 'cash') {
            const received = parseUahToMinor($('cashReceivedAmount')?.value || '0');
            const total = BigInt(String(order.totalAmountMinor || 0));
            if (received < total) throw new Error('cash_received_too_low');
            return {
                tender: 'cash',
                confirmedAmountMinor: String(order.totalAmountMinor),
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
            notify(result.replayed ? 'Confirmation replayed with the same Idempotency-Key.' : 'Payment confirmed. Receipt was queued in durable fiscal queue.', 'success');
        } catch (error) {
            notify(paymentUiError(error), 'error');
        } finally {
            state.confirmInFlight = false;
            syncConfirmationAvailability();
        }
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
        const today = new Date().toISOString().slice(0, 10);
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
                setDenied('No access to park cashier or required payment capabilities. Cashier does not need finance.manage.');
                return;
            }
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
                setDenied('Failed to initialize cashier page.');
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
        loadPaymentOrder
    };
})();
