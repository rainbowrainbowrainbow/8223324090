'use strict';

const SECRET_PATTERN = /(Bearer\s+)[A-Za-z0-9._~+/-]+|(token|secret|password|pin|api[_-]?key|authorization|license[_-]?key|access[_-]?key|device[_-]?id)(["'\s:=]+)([^"'\s,}]+)/gi;

class CheckboxClientError extends Error {
    constructor(code, message, { status = 500, retryable = false, unknown = false, details = null, cause = null } = {}) {
        super(message || code);
        this.name = 'CheckboxClientError';
        this.code = code;
        this.status = status;
        this.statusCode = status;
        this.retryable = retryable;
        this.unknown = unknown;
        this.details = details;
        if (cause) this.cause = cause;
    }
}

function redactCheckboxDiagnostics(value) {
    if (value == null) return value;
    if (typeof value === 'string') {
        return value.replace(SECRET_PATTERN, (match, bearerPrefix, secretKey, sep) => {
            if (bearerPrefix) return `${bearerPrefix}[redacted]`;
            return `${secretKey}${sep}[redacted]`;
        });
    }
    if (Array.isArray(value)) return value.map(redactCheckboxDiagnostics);
    if (typeof value === 'object') {
        const output = {};
        for (const [key, item] of Object.entries(value)) {
            if (/token|secret|password|pin|api[_-]?key|authorization|license[_-]?key|access[_-]?key|device[_-]?id/i.test(key)) {
                output[key] = '[redacted]';
            } else {
                output[key] = redactCheckboxDiagnostics(item);
            }
        }
        return output;
    }
    return value;
}

function classifyCheckboxFetchError(error) {
    const code = String(error?.code || error?.name || '').toLowerCase();
    const message = String(error?.message || '').toLowerCase();
    const retryable = /abort|timeout|network|socket|econn|fetch|terminated/.test(`${code} ${message}`);
    return new CheckboxClientError(
        retryable ? 'checkbox_network_unknown' : 'checkbox_request_failed',
        redactCheckboxDiagnostics(error?.message || 'Checkbox request failed'),
        { status: 503, retryable, unknown: retryable, cause: error }
    );
}

module.exports = {
    CheckboxClientError,
    classifyCheckboxFetchError,
    redactCheckboxDiagnostics
};
