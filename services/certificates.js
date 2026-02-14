/**
 * services/certificates.js — Certificates business logic
 * v8.4: Certificate registry with Telegram alerts
 * v8.7: Seasonal certificate backgrounds
 */

const VALID_SEASONS = ['winter', 'spring', 'summer', 'autumn'];

function getCurrentSeason() {
    const m = new Date().getMonth(); // 0-11
    if (m >= 2 && m <= 4) return 'spring';
    if (m >= 5 && m <= 7) return 'summer';
    if (m >= 8 && m <= 10) return 'autumn';
    return 'winter';
}

function mapCertificateRow(row) {
    return {
        id: row.id,
        certCode: row.cert_code,
        displayMode: row.display_mode,
        displayValue: row.display_value,
        typeText: row.type_text,
        issuedAt: row.issued_at,
        validUntil: row.valid_until,
        issuedByUserId: row.issued_by_user_id,
        issuedByName: row.issued_by_name,
        status: row.status || 'active',
        usedAt: row.used_at,
        invalidatedAt: row.invalidated_at,
        invalidReason: row.invalid_reason,
        notes: row.notes,
        season: row.season || 'winter',
        telegramAlertSent: row.telegram_alert_sent,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function calculateValidUntil(issuedDate, defaultDays = 45) {
    const date = issuedDate ? new Date(issuedDate) : new Date();
    date.setDate(date.getDate() + defaultDays);
    return date.toISOString().split('T')[0];
}

const VALID_STATUSES = ['active', 'used', 'expired', 'revoked', 'blocked'];
const VALID_DISPLAY_MODES = ['number', 'fio'];

function validateCertificateInput(body) {
    const errors = [];
    if (body.displayValue && body.displayValue.length > 200) {
        errors.push('displayValue max 200 chars');
    }
    if (body.displayMode && !VALID_DISPLAY_MODES.includes(body.displayMode)) {
        errors.push('displayMode must be "number" or "fio"');
    }
    if (body.typeText && body.typeText.length > 200) {
        errors.push('typeText max 200 chars');
    }
    if (body.validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(body.validUntil)) {
        errors.push('validUntil must be YYYY-MM-DD');
    }
    return errors;
}

module.exports = {
    mapCertificateRow,
    calculateValidUntil,
    validateCertificateInput,
    getCurrentSeason,
    VALID_STATUSES,
    VALID_DISPLAY_MODES,
    VALID_SEASONS
};
