/**
 * services/music-delivery.js — MusicDelivery adapter v33.15.0
 * Abstraction for delivering announcements to the park's music system.
 * Current: Telegram channel. Future: HTTP API to media player.
 */
const { sendTelegramMessage, getConfiguredChatId } = require('./telegram');
const { createLogger } = require('../utils/logger');
const log = createLogger('MusicDelivery');

const DELIVERY_MODE = process.env.MUSIC_DELIVERY_MODE || 'telegram';

async function deliverAnnouncement(ann, opts = {}) {
    const { triggeredBy = 'manual', zoneId = null } = opts;
    const zone = zoneId ? ` [Зона: ${zoneId}]` : '';

    switch (DELIVERY_MODE) {
        case 'telegram':
            return _deliverViaTelegram(ann, zone, triggeredBy);
        case 'mock':
            log.info(`[Mock] Доставка: "${ann.title}"`);
            return { success: true, mode: 'mock', detail: 'Тест' };
        default:
            return { success: false, mode: DELIVERY_MODE, detail: 'Невідомий режим' };
    }
}

async function _deliverViaTelegram(ann, zone, triggeredBy) {
    try {
        const chatId = await getConfiguredChatId();
        if (!chatId) return { success: false, mode: 'telegram', detail: 'chatId not configured' };

        const typeEmoji = { promo:'📣', safety:'⚠️', schedule:'📅', birthday:'🎂', general:'📢', info:'ℹ️' }[ann.announcement_type] || '📢';
        const trigLabel = triggeredBy === 'scheduler' ? '⏰ Авто' : '👆 Вручну';

        const text =
            `🔊 <b>ОГОЛОШЕННЯ</b>${zone}\n` +
            `${typeEmoji} <b>${ann.title}</b>\n\n` +
            `<i>${ann.text_content}</i>\n\n` +
            `⏱ ${ann.duration_seconds || 30} сек · ${trigLabel}` +
            (ann.voice_url ? `\n🎵 <a href="${ann.voice_url}">Аудіо</a>` : '');

        await sendTelegramMessage(chatId, text);
        return { success: true, mode: 'telegram', detail: `Чат ${chatId}` };
    } catch (err) {
        log.error('deliverViaTelegram error', err);
        return { success: false, mode: 'telegram', detail: err.message };
    }
}

/**
 * Simple cron expression matcher: "min hour dom mon dow"
 * Supports: *, N, N-N, N,N, * /N
 */
function isCronDue(cronExpr, nowDate = new Date()) {
    try {
        const parts = cronExpr.trim().split(/\s+/);
        if (parts.length !== 5) return false;
        const [minPat, hourPat, domPat, monPat, dowPat] = parts;

        const matchPart = (pat, val) => {
            if (pat === '*') return true;
            if (pat.includes(',')) return pat.split(',').map(Number).includes(val);
            if (pat.includes('-')) { const [a, b] = pat.split('-').map(Number); return val >= a && val <= b; }
            if (pat.includes('/')) { const step = parseInt(pat.split('/')[1]); return val % step === 0; }
            return parseInt(pat, 10) === val;
        };

        // v38.4.0: DST-aware Kyiv time (was hardcoded UTC+3)
        const kyivStr = nowDate.toLocaleString('en-US', { timeZone: 'Europe/Kyiv' });
        const kyiv = new Date(kyivStr);
        return matchPart(minPat, kyiv.getMinutes()) &&
               matchPart(hourPat, kyiv.getHours()) &&
               matchPart(domPat, kyiv.getDate()) &&
               matchPart(monPat, kyiv.getMonth() + 1) &&
               matchPart(dowPat, kyiv.getDay());
    } catch { return false; }
}

module.exports = { deliverAnnouncement, isCronDue };
