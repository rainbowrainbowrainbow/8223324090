'use strict';

const SAFE_SETTING_READ_KEYS = new Set([
    'auto_delete_enabled',
    'auto_delete_hours',
    'bot_username',
    'digest_time',
    'digest_time_weekday',
    'digest_time_weekend',
    'language',
    'reminder_time'
]);

function isSafeSettingReadKey(key) {
    return SAFE_SETTING_READ_KEYS.has(String(key || '').trim().toLowerCase());
}

module.exports = {
    SAFE_SETTING_READ_KEYS,
    isSafeSettingReadKey
};
