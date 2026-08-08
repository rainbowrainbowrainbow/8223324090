'use strict';

const { CheckboxClient } = require('./client');
const { CheckboxClientError, redactCheckboxDiagnostics } = require('./errors');
const {
    isCheckboxIntegrationEnabled,
    loadCheckboxRuntimeConfig,
    normalizeCredentialRef
} = require('./config');

const SUCCESS_RECEIPT_STATUSES = new Set(['DONE']);
const PENDING_RECEIPT_STATUSES = new Set(['CREATED']);
const FAILED_RECEIPT_STATUSES = new Set(['ERROR', 'CANCELLATION', 'CANCELLED']);
const OPEN_SHIFT_STATUS = 'OPENED';

class CheckboxProviderConfigError extends CheckboxClientError {
    constructor(code, message, options = {}) {
        super(code, message, { status: 503, retryable: false, ...options });
        this.name = 'CheckboxProviderConfigError';
        this.configuration = true;
    }
}

function upperStatus(value) {
    return String(value || '').trim().toUpperCase();
}

function requireText(value, code) {
    const text = String(value || '').trim();
    if (!text) throw new CheckboxClientError(code, `${code} is required`, { status: 400, retryable: false });
    return text;
}

function safeJsonObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function dbItemToCheckboxItem(item = {}) {
    const providerTaxId = String(item.provider_tax_id || '').trim();
    if (!providerTaxId) {
        throw new CheckboxClientError('checkbox_provider_tax_id_missing', 'Provider tax id is required before Checkbox sale', {
            status: 422,
            retryable: false,
            details: { lineNumber: item.line_number || null }
        });
    }
    return {
        name: item.item_name,
        code: item.item_code || item.sku || item.item_name,
        priceMinor: item.unit_price_minor,
        quantityMillis: item.quantity_milli || item.quantity_millis || 1000,
        tax: [providerTaxId]
    };
}

function receiptIdFromOperation(input = {}) {
    return requireText(input.providerOperationId || input.provider_operation_id || input.providerRequestUuid, 'checkbox_provider_operation_id_required');
}

function paymentTender(paymentOrder = {}) {
    return paymentOrder.payment_method || paymentOrder.paymentMethod || 'cash';
}

function paymentAmountMinor(paymentOrder = {}, fiscalOperation = {}) {
    return String(paymentOrder.total_amount_minor || paymentOrder.totalAmountMinor || fiscalOperation.fiscal_operation_amount_minor || fiscalOperation.amount_minor || '');
}

function normalizeReceiptArtifacts(receipt = {}, client) {
    const id = requireText(receipt.id || receipt.receipt_id, 'checkbox_receipt_id_missing');
    const status = upperStatus(receipt.status);
    if (SUCCESS_RECEIPT_STATUSES.has(status)) {
        return {
            id,
            receiptId: id,
            providerReceiptId: id,
            fiscalCode: receipt.fiscal_code || receipt.fiscalCode || null,
            serial: receipt.serial == null ? null : String(receipt.serial),
            taxUrl: receipt.tax_url || receipt.taxUrl || null,
            pdfUrl: `${client.baseUrl}/api/v1/receipts/${encodeURIComponent(id)}/pdf`,
            qrUrl: `${client.baseUrl}/api/v1/receipts/${encodeURIComponent(id)}/qrcode`,
            status,
            totalAmountMinor: String(receipt.total_payment || receipt.total_sum || receipt.totalAmountMinor || receipt.total_amount_minor || '0'),
            fiscalizedAt: receipt.fiscal_date || receipt.delivered_at || null,
            raw: redactCheckboxDiagnostics(receipt)
        };
    }
    if (PENDING_RECEIPT_STATUSES.has(status)) {
        throw new CheckboxClientError('checkbox_receipt_pending', 'Checkbox receipt is not fiscalized yet', {
            status: 202,
            retryable: true,
            unknown: true,
            details: { receiptId: id, providerStatus: status }
        });
    }
    if (FAILED_RECEIPT_STATUSES.has(status)) {
        throw new CheckboxClientError('checkbox_receipt_failed', 'Checkbox receipt reached a terminal failure status', {
            status: 422,
            retryable: false,
            details: { receiptId: id, providerStatus: status }
        });
    }
    throw new CheckboxClientError('checkbox_receipt_status_unknown', 'Checkbox receipt status is missing or unsupported', {
        status: 502,
        retryable: true,
        unknown: true,
        details: { receiptId: id, providerStatus: status || null }
    });
}

function normalizeShiftResponse(shift = {}) {
    const id = shift.id || shift.shift_id || null;
    const status = upperStatus(shift.status);
    if (!id || !status) {
        throw new CheckboxClientError('checkbox_shift_response_malformed', 'Checkbox shift response is missing id or status', {
            status: 502,
            retryable: true,
            unknown: true
        });
    }
    return { id, status, raw: redactCheckboxDiagnostics(shift) };
}

class CheckboxRuntimeProvider {
    constructor({ client, login, password } = {}) {
        if (!client) throw new CheckboxProviderConfigError('checkbox_client_required', 'Checkbox client is required');
        this.client = client;
        this.login = login;
        this.password = password;
        this.authenticated = false;
    }

    async authenticate() {
        await this.client.signIn({ login: this.login, password: this.password });
        this.authenticated = true;
    }

    async withAuth(run) {
        if (!this.authenticated) await this.authenticate();
        try {
            return await run();
        } catch (error) {
            if (error instanceof CheckboxClientError && error.status === 401) {
                await this.authenticate();
                return run();
            }
            throw error;
        }
    }

    async ensureShiftOpened() {
        return this.withAuth(async () => {
            let current = null;
            try {
                current = normalizeShiftResponse(await this.client.getCurrentShift());
            } catch (error) {
                if (error instanceof CheckboxClientError && (error.status === 401 || error.status >= 500)) throw error;
            }
            if (current?.status === OPEN_SHIFT_STATUS) return current;
            const opened = normalizeShiftResponse(await this.client.openShift({ providerRequestUuid: cryptoRandomUuid() }));
            if (opened.status === OPEN_SHIFT_STATUS) return opened;
            const refreshed = normalizeShiftResponse(await this.client.getCurrentShift());
            if (refreshed.status === OPEN_SHIFT_STATUS) return refreshed;
            throw new CheckboxClientError('checkbox_shift_not_opened', 'Checkbox shift is not OPENED yet', {
                status: 202,
                retryable: true,
                unknown: true,
                details: { providerStatus: refreshed.status || opened.status }
            });
        });
    }

    async lookupReceipt(input = {}) {
        return this.withAuth(async () => {
            const receiptId = receiptIdFromOperation(input);
            try {
                const receipt = await this.client.lookupReceipt({ receiptId });
                return { found: true, receipt: normalizeReceiptArtifacts(receipt, this.client) };
            } catch (error) {
                if (error instanceof CheckboxClientError && error.status === 404) return { found: false };
                throw error;
            }
        });
    }

    async validateSale(input = {}) {
        return this.withAuth(async () => {
            await this.ensureShiftOpened();
            return this.client.validateSale(this.toSalePayload(input));
        });
    }

    async createSaleReceipt(input = {}) {
        return this.withAuth(async () => {
            await this.ensureShiftOpened();
            const receipt = await this.client.createSaleReceipt(this.toSalePayload(input));
            return normalizeReceiptArtifacts(receipt, this.client);
        });
    }

    async openShift(input = {}) {
        return this.withAuth(async () => {
            const response = await this.client.openShift({
                providerRequestUuid: input.providerOperationId || input.providerRequestUuid || input.fiscalOperation?.provider_operation_id
            });
            return normalizeShiftResponse(response);
        });
    }

    async closeShift(input = {}) {
        return this.withAuth(async () => {
            const response = await this.client.closeShift({
                providerRequestUuid: input.providerOperationId || input.providerRequestUuid || input.fiscalOperation?.provider_operation_id || null
            });
            return normalizeShiftResponse(response);
        });
    }

    toSalePayload(input = {}) {
        const fiscalOperation = safeJsonObject(input.fiscalOperation);
        const paymentOrder = safeJsonObject(input.paymentOrder);
        return {
            providerRequestUuid: receiptIdFromOperation(input),
            tender: paymentTender(paymentOrder),
            amountMinor: paymentAmountMinor(paymentOrder, fiscalOperation),
            items: (input.items || []).map(dbItemToCheckboxItem),
            context: {
                eventgenix: true,
                fiscal_profile_id: Number(fiscalOperation.fiscal_profile_id || paymentOrder.fiscal_profile_id || 0),
                fiscal_operation_id: Number(fiscalOperation.fiscal_operation_id || fiscalOperation.id || 0),
                payment_order_id: Number(paymentOrder.payment_order_id || paymentOrder.id || 0)
            }
        };
    }
}

function cryptoRandomUuid() {
    return require('node:crypto').randomUUID();
}

function createProviderFromConfig(config = {}, { fetchImpl } = {}) {
    const client = new CheckboxClient({
        baseUrl: config.baseUrl,
        clientName: config.clientName,
        clientVersion: config.clientVersion,
        licenseKey: config.licenseKey,
        accessKey: config.accessKey,
        deviceId: config.deviceId,
        timeoutMs: config.timeoutMs,
        fetchImpl
    });
    return new CheckboxRuntimeProvider({ client, login: config.login, password: config.password });
}

function refsFromContext(context = {}) {
    const job = context.job || context;
    const licenseRef = normalizeCredentialRef(job.provider_license_ref || job.checkbox_license_ref || job.register_credential_ref);
    const credentialRef = normalizeCredentialRef(job.provider_cashier_login_ref || job.checkbox_cashier_ref || licenseRef);
    return { credentialRef, licenseRef };
}

function createCheckboxProviderFactory({ env = process.env, fetchImpl } = {}) {
    return {
        isEnabled() {
            return isCheckboxIntegrationEnabled(env);
        },
        canResolveRefs({ credentialRef, licenseRef } = {}) {
            if (!this.isEnabled()) return false;
            try {
                loadCheckboxRuntimeConfig({ env, credentialRef, licenseRef });
                return true;
            } catch {
                return false;
            }
        },
        createForContext(context = {}) {
            if (!this.isEnabled()) {
                throw new CheckboxProviderConfigError('checkbox_integration_disabled', 'Checkbox integration is disabled');
            }
            const refs = refsFromContext(context);
            const config = loadCheckboxRuntimeConfig({ env, ...refs });
            return createProviderFromConfig(config, { fetchImpl });
        },
        async getEligibleFiscalProfileIds(dbPool) {
            if (!this.isEnabled()) return [];
            const client = await dbPool.connect();
            try {
                const result = await client.query(
                    `SELECT DISTINCT job.fiscal_profile_id,
                            fr.provider_license_ref,
                            fcb.provider_cashier_login_ref
                       FROM payment_outbox_jobs job
                       JOIN payment_orders po
                         ON po.id = job.payment_order_id
                        AND po.fiscal_profile_id = job.fiscal_profile_id
                       JOIN fiscal_registers fr
                         ON fr.id = po.fiscal_register_id
                        AND fr.fiscal_profile_id = po.fiscal_profile_id
                        AND fr.provider = 'checkbox'
                        AND fr.status = 'active'
                        AND fr.feature_enabled = TRUE
                       LEFT JOIN fiscal_cashier_bindings fcb
                         ON fcb.fiscal_profile_id = po.fiscal_profile_id
                        AND fcb.fiscal_register_id = po.fiscal_register_id
                        AND fcb.user_id = po.cashier_user_id
                        AND fcb.status = 'active'
                      WHERE job.provider = 'checkbox'
                        AND job.status IN ('queued', 'failed', 'claimed', 'running')`
                );
                const ids = new Set();
                for (const row of result.rows) {
                    if (this.canResolveRefs({
                        credentialRef: row.provider_cashier_login_ref || row.provider_license_ref,
                        licenseRef: row.provider_license_ref
                    })) {
                        ids.add(Number(row.fiscal_profile_id));
                    }
                }
                return [...ids];
            } finally {
                client.release();
            }
        }
    };
}

module.exports = {
    FAILED_RECEIPT_STATUSES,
    OPEN_SHIFT_STATUS,
    PENDING_RECEIPT_STATUSES,
    SUCCESS_RECEIPT_STATUSES,
    CheckboxProviderConfigError,
    CheckboxRuntimeProvider,
    createCheckboxProviderFactory,
    createProviderFromConfig,
    dbItemToCheckboxItem,
    normalizeReceiptArtifacts,
    normalizeShiftResponse,
    refsFromContext
};
