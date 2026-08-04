'use strict';

const { CheckboxClientError, classifyCheckboxFetchError, redactCheckboxDiagnostics } = require('./errors');
const { mapFullReturnReceipt, mapSaleReceipt, mapServiceReceipt } = require('./mapper');

const JSON_CONTENT_TYPE = 'application/json';

function normalizeBaseUrl(baseUrl) {
    return String(baseUrl || '').replace(/\/+$/, '');
}

function encodePathSegment(value) {
    return encodeURIComponent(String(value || '').trim());
}

function normalizeToken(payload) {
    const token = payload?.access_token || payload?.token;
    if (!token) throw new CheckboxClientError('checkbox_auth_token_missing', 'Checkbox signin response did not include access_token', { status: 502, retryable: false });
    return token;
}

class CheckboxClient {
    constructor({
        baseUrl,
        clientName = 'EventGenix Checkbox Client',
        clientVersion = 'eventgenix-checkbox-client',
        licenseKey = null,
        accessKey = null,
        deviceId = null,
        timeoutMs = 15000,
        fetchImpl = globalThis.fetch
    } = {}) {
        if (!fetchImpl) throw new CheckboxClientError('checkbox_fetch_unavailable', 'Native fetch is unavailable in this runtime', { status: 500 });
        if (!baseUrl) throw new CheckboxClientError('checkbox_base_url_required', 'Checkbox baseUrl is required', { status: 500 });
        this.baseUrl = normalizeBaseUrl(baseUrl);
        this.clientName = clientName;
        this.clientVersion = clientVersion;
        this.licenseKey = licenseKey;
        this.accessKey = accessKey;
        this.deviceId = deviceId;
        this.timeoutMs = Math.max(1000, Math.min(Number(timeoutMs || 15000), 60000));
        this.fetchImpl = fetchImpl;
        this.accessToken = null;
    }

    setAccessToken(token) {
        this.accessToken = String(token || '').trim() || null;
    }

    baseHeaders({ auth = true, license = false, accessKey = false, device = false, contentType = false } = {}) {
        const headers = {
            'X-Client-Name': this.clientName,
            'X-Client-Version': this.clientVersion
        };
        if (contentType) headers['Content-Type'] = JSON_CONTENT_TYPE;
        if (auth) {
            if (!this.accessToken) throw new CheckboxClientError('checkbox_auth_token_required', 'Checkbox access token is required for this operation', { status: 401 });
            headers.Authorization = `Bearer ${this.accessToken}`;
        }
        if (license) {
            if (!this.licenseKey) throw new CheckboxClientError('checkbox_license_key_required', 'Checkbox X-License-Key is required for this operation', { status: 400 });
            headers['X-License-Key'] = this.licenseKey;
        }
        if (accessKey && this.accessKey) headers['X-Access-Key'] = this.accessKey;
        if (device && this.deviceId) headers['X-Device-ID'] = this.deviceId;
        return headers;
    }

    async request(path, { method = 'GET', headers = {}, body = undefined, auth = true, license = false, accessKey = false, device = false, expectBinary = false, timeoutMs = this.timeoutMs } = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
        const hasBody = body !== undefined;
        const url = `${this.baseUrl}${path}`;
        try {
            const response = await this.fetchImpl(url, {
                method,
                headers: {
                    ...this.baseHeaders({ auth, license, accessKey, device, contentType: hasBody && !expectBinary }),
                    ...headers
                },
                body: hasBody ? JSON.stringify(body) : undefined,
                signal: controller.signal
            });
            const contentType = response.headers?.get?.('content-type') || '';
            const payload = expectBinary
                ? Buffer.from(await response.arrayBuffer())
                : contentType.includes('application/json')
                    ? await response.json()
                    : await response.text();
            if (!response.ok) {
                const status = response.status || 500;
                const retryable = status >= 500 || status === 408 || status === 429;
                throw new CheckboxClientError(
                    status >= 400 && status < 500 ? 'checkbox_validation_error' : 'checkbox_provider_error',
                    `Checkbox HTTP ${status}`,
                    { status, retryable, unknown: retryable, details: redactCheckboxDiagnostics(payload) }
                );
            }
            return payload;
        } catch (error) {
            if (error instanceof CheckboxClientError) throw error;
            throw classifyCheckboxFetchError(error);
        } finally {
            clearTimeout(timer);
        }
    }

    async signIn({ login, password } = {}) {
        const payload = await this.request('/api/v1/cashier/signin', {
            method: 'POST',
            auth: false,
            device: true,
            body: { login, password }
        });
        this.setAccessToken(normalizeToken(payload));
        return payload;
    }

    async getCashierProfile() {
        return this.request('/api/v1/cashier/me');
    }

    async getCurrentShift() {
        return this.request('/api/v1/cashier/shift');
    }

    async listShifts(query = {}) {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(query || {})) {
            if (value == null || value === '') continue;
            if (Array.isArray(value)) value.forEach(item => params.append(key, String(item)));
            else params.set(key, String(value));
        }
        return this.request(`/api/v1/shifts${params.toString() ? `?${params}` : ''}`);
    }

    async openShift({ providerRequestUuid, autoCloseAt = null } = {}) {
        const body = { id: providerRequestUuid };
        if (autoCloseAt) body.auto_close_at = autoCloseAt;
        return this.request('/api/v1/shifts', {
            method: 'POST',
            license: true,
            device: true,
            body
        });
    }

    async closeShift({ providerRequestUuid = null } = {}) {
        const body = providerRequestUuid ? { report: { id: providerRequestUuid } } : {};
        return this.request('/api/v1/shifts/close', {
            method: 'POST',
            accessKey: true,
            device: true,
            body
        });
    }

    async validateSale(input = {}) {
        const body = input.goods ? input : mapSaleReceipt(input);
        return this.request('/api/v1/receipts/validate', {
            method: 'POST',
            device: true,
            body
        });
    }

    async createSaleReceipt(input = {}) {
        const body = input.goods ? input : mapSaleReceipt(input);
        return this.request('/api/v1/receipts/sell', {
            method: 'POST',
            accessKey: true,
            device: true,
            body
        });
    }

    async createReturnReceipt(input = {}) {
        const body = input.goods ? input : mapFullReturnReceipt(input);
        return this.request('/api/v1/receipts/sell', {
            method: 'POST',
            accessKey: true,
            device: true,
            body
        });
    }

    async createServiceReceipt(input = {}) {
        const body = input.payment ? input : mapServiceReceipt(input);
        return this.request('/api/v1/receipts/service', {
            method: 'POST',
            accessKey: true,
            device: true,
            body
        });
    }

    async lookupReceipt({ receiptId }) {
        return this.request(`/api/v1/receipts/${encodePathSegment(receiptId)}`);
    }

    async getReceiptDocument({ receiptId, format = 'pdf' }) {
        const safeFormat = String(format || 'pdf').toLowerCase();
        const allowed = new Set(['html', 'pdf', 'png', 'qrcode', 'text', 'xml']);
        if (!allowed.has(safeFormat)) throw new CheckboxClientError('checkbox_receipt_document_format_invalid', 'Unsupported Checkbox receipt document format', { status: 400 });
        return this.request(`/api/v1/receipts/${encodePathSegment(receiptId)}/${safeFormat}`, {
            auth: safeFormat === 'text' || safeFormat === 'xml' || safeFormat === 'html',
            expectBinary: ['pdf', 'png', 'qrcode'].includes(safeFormat)
        });
    }

    async getReport({ reportId }) {
        return this.request(`/api/v1/reports/${encodePathSegment(reportId)}`);
    }
}

module.exports = {
    CheckboxClient,
    normalizeToken
};
