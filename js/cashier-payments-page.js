
'use strict';

(function () {
    const PILOT_SCOPE = Object.freeze({ crmProfileKey: 'event_genix', registerAlias: 'middle', defaultEnabled: false });
    const INTERNAL_RECEIPT_TEXT = '\u0432\u043d\u0443\u0442\u0440\u0456\u0448\u043d\u044f \u043a\u0432\u0438\u0442\u0430\u043d\u0446\u0456\u044f';
    const STORAGE_PREFIX = 'eventgenix:cashier-payments';
    const SERVICE_IN_FINAL_CONFIRMATION = '\u0413\u043e\u0442\u0456\u0432\u043a\u0443 \u0432\u043d\u0435\u0441\u0435\u043d\u043e \u2014 \u0441\u0442\u0432\u043e\u0440\u0438\u0442\u0438 \u0441\u043b\u0443\u0436\u0431\u043e\u0432\u0435 \u0432\u043d\u0435\u0441\u0435\u043d\u043d\u044f';
    const FISCAL_BLOCKING_STATUSES = new Set(['pending', 'unknown', 'sending', 'validating', 'ready_to_send', 'failed_retryable']);
    const FISCAL_DONE_STATUSES = new Set(['fiscalized']);
    const OPERATION_BUTTON_IDS = Object.freeze([
        'serviceInBtn', 'serviceOutRequestBtn', 'serviceOutApproveBtn', 'refundBtn',
        'reconcileShiftBtn', 'closeShiftBtn', 'loadOperationalReportBtn', 'refreshShiftStateBtn'
    ]);

    const state = {
        user: null,
        orderDetails: null,
        registerState: null,
        createInFlight: false,
        confirmInFlight: false,
        confirmSubmitted: false,
        operationInFlight: new Set(),
        lastServiceOutOperationId: null,
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
            draft: 'draft', unpaid: 'unpaid', pending: 'pending', unknown: 'unknown', confirmed: 'confirmed', open: 'open', opening: 'opening', closing: 'closing', closed: 'closed',
            payment_recorded: 'payment recorded', fiscalized: 'fiscalized', failed: 'failed', cancelled: 'cancelled',
            validation_failed: 'validation failed', ready_to_send: 'ready to send', sending: 'sending', validating: 'validating'
        };
        return labels[status] || status;
    }

    function classifyStatus(value) {
        const status = normalizeStatus(value);
        if (['confirmed', 'payment_recorded', 'fiscalized', 'open', 'closed'].includes(status)) return 'is-ok';
        if (['pending', 'unknown', 'ready_to_send', 'sending', 'validating', 'opening', 'closing'].includes(status)) return 'is-warn';
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
        try { window.localStorage.removeItem(`${STORAGE_PREFIX}:${operationStorageKey(action, target)}`); }
        catch {}
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
        await loadPilotRegisterState({ silent: true });
        if (!silent) notify('Payment order loaded.', 'success');
        return result;
    }

    async function loadPilotRegisterState({ silent = false } = {}) {
        try {
            const params = new URLSearchParams({ crmProfileKey: PILOT_SCOPE.crmProfileKey, registerAlias: PILOT_SCOPE.registerAlias });
            const result = await apiRequest(`/api/payments/pilot-register-state?${params.toString()}`, {
                method: 'GET',
                headers: apiHeaders()
            });
            state.registerState = result;
            renderRegisterState(result);
            syncOperationalAvailability();
            if (!silent) notify('Shift state refreshed.', 'success');
            return result;
        } catch (error) {
            state.registerState = null;
            renderRegisterState(null);
            syncOperationalAvailability();
            if (!silent) notify(paymentUiError(error), 'error');
            return null;
        }
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
            forbidden: 'No access to this register or CRM profile.',
            service_in_amount_required: 'Service-in amount must be positive.',
            service_out_amount_required: 'Service-out amount must be positive.',
            service_out_reason_required: 'Service-out reason is required.',
            shift_not_open: 'Open shift is required for this operation.',
            shift_close_blocked: 'Close is blocked while pending/unknown fiscal operations exist.',
            close_actual_totals_required: 'Cash actual and terminal report total are required.',
            refund_order_required: 'Set payment order ID for refund.',
            refund_reason_required: 'Refund reason is required.',
            idempotency_key_required: 'Idempotency-Key is required.'
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
        setText('internalReceiptLabel', `RCP-${order.id} вЂ” ${INTERNAL_RECEIPT_TEXT}`);
        setText('paymentTotalAmount', formatMoneyMinor(order.totalAmountMinor));
        setText('cardExactAmount', formatMoneyMinor(order.totalAmountMinor));
        const refundOrder = $('refundOrderId');
        if (refundOrder && !refundOrder.value) refundOrder.value = String(order.id);
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

    function renderRegisterState(result) {
        if (!result) {
            setText('opsFiscalProfile', '?');
            setText('opsRegister', '?');
            setStatus('activeShiftStatus', 'not_open');
            setText('activeShiftId', '?');
            setText('shiftExpectedCash', formatMoneyMinor(0));
            setText('shiftExpectedTerminal', formatMoneyMinor(0));
            renderBlockers([]);
            renderReportBody(null);
            return;
        }
        setText('opsFiscalProfile', `${result.crmProfileKey || '?'} / ${result.legalEntityName || result.legalEntityKey || 'FOP is not configured'}`);
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
    }

    function renderBlockers(blockers) {
        const panel = $('shiftBlockersPanel');
        const list = $('shiftBlockersList');
        const rows = Array.isArray(blockers) ? blockers : [];
        if (panel) panel.classList.toggle('hidden', rows.length === 0);
        if (list) {
            list.innerHTML = rows.length
                ? rows.map(item => `<li>Operation #${escapeHtml(item.id)} ? ${escapeHtml(item.type)} ? ${escapeHtml(item.status)}</li>`).join('')
                : '';
        }
    }

    function renderReportBody(report) {
        const body = $('operationalReportBody');
        if (!body) return;
        if (!report) {
            body.textContent = 'No report loaded.';
            return;
        }
        const checklist = report.checklist || {};
        body.innerHTML = `
            <dl class="cashier-report-grid">
                <div><dt>Internal report</dt><dd>${escapeHtml(report.internalReportLabel || 'Internal operational report')}</dd></div>
                <div><dt>Official Z-report</dt><dd>${report.officialZReport ? 'yes' : 'no'}</dd></div>
                <div><dt>Cash expected</dt><dd>${escapeHtml(formatMoneyMinor(checklist.cashExpectedMinor || 0))}</dd></div>
                <div><dt>Terminal expected</dt><dd>${escapeHtml(formatMoneyMinor(checklist.terminalExpectedMinor || 0))}</dd></div>
                <div><dt>Service in</dt><dd>${escapeHtml(formatMoneyMinor(checklist.serviceInMinor || 0))}</dd></div>
                <div><dt>Service out</dt><dd>${escapeHtml(formatMoneyMinor(checklist.serviceOutMinor || 0))}</dd></div>
            </dl>
            ${report.checkboxZDocumentUrl ? `<a class="btn btn-secondary" target="_blank" rel="noopener" href="${escapeAttribute(report.checkboxZDocumentUrl)}">Open Checkbox document</a>` : '<p class="cashier-muted">Checkbox Z/document URL is not available yet.</p>'}
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
        const fiscalStatus = normalizeStatus(order.fiscalStatus);
        if (paymentStatus === 'confirmed' || normalizeStatus(order.status) === 'payment_recorded') return true;
        return FISCAL_BLOCKING_STATUSES.has(fiscalStatus) && paymentStatus !== 'unpaid';
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
        const openShift = hasOpenShift();
        const hasMapping = Boolean(state.registerState?.fiscalProfileId && state.registerState?.fiscalRegisterId);
        setFormControlsEnabled('serviceInForm', hasMapping && openShift && hasAction('fiscal.service_in'));
        setFormControlsEnabled('serviceOutForm', hasMapping && openShift && hasAction('fiscal.service_out.request'));
        setFormControlsEnabled('serviceOutApprovalPanel', Boolean(state.lastServiceOutOperationId) && hasAction('fiscal.service_out.approve'));
        setFormControlsEnabled('refundForm', hasMapping && openShift && hasAction('fiscal.refund'));
        setFormControlsEnabled('reconciliationForm', hasMapping && openShift && hasAction('fiscal.reconcile'));
        if ($('closeShiftBtn')) $('closeShiftBtn').disabled = !(hasMapping && openShift && hasAction('fiscal.shift.close')) || hasCloseBlockers();
        if ($('loadOperationalReportBtn')) $('loadOperationalReportBtn').disabled = !(hasMapping && state.registerState?.shift?.id && hasAction('fiscal.audit.view'));
        if ($('refreshShiftStateBtn')) $('refreshShiftStateBtn').disabled = !hasAction('payments.view');
        if (!openShift) {
            setFormControlsEnabled('serviceInForm', false);
            setFormControlsEnabled('serviceOutForm', false);
            setFormControlsEnabled('refundForm', false);
            setFormControlsEnabled('reconciliationForm', false);
        }
        syncOperationBusyState();
    }

    function syncOperationBusyState() {
        OPERATION_BUTTON_IDS.forEach(id => {
            const el = $(id);
            if (!el) return;
            const busy = state.operationInFlight.has(id);
            el.setAttribute('aria-busy', busy ? 'true' : 'false');
            if (busy) el.disabled = true;
        });
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
        $('refreshShiftStateBtn')?.addEventListener('click', () => { void loadPilotRegisterState({ silent: false }); });
        $('serviceInForm')?.addEventListener('submit', submitServiceIn);
        $('serviceOutForm')?.addEventListener('submit', submitServiceOut);
        $('serviceOutApprovalPanel')?.addEventListener('submit', approveServiceOutSubmit);
        $('refundForm')?.addEventListener('submit', submitRefund);
        $('reconciliationForm')?.addEventListener('submit', submitReconciliation);
        $('closeShiftBtn')?.addEventListener('click', closeShift);
        $('loadOperationalReportBtn')?.addEventListener('click', loadOperationalReport);
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
        syncOperationalAvailability();
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
            await loadPilotRegisterState({ silent: true });
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
        getOperationIdempotencyKey,
        loadPaymentOrder,
        loadPilotRegisterState
    };
})();
