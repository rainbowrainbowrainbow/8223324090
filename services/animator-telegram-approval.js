'use strict';

const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('AnimatorTelegramApproval');

function telegramRequest(...args) {
  return require('./telegram').telegramRequest(...args);
}

function pushDefaultTimelineBusinessContext(...args) {
  return require('./timelineBusinessScope').pushDefaultTimelineBusinessContext(...args);
}

async function getSettingValue(key) {
  try {
    const result = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
    return result.rows[0]?.value || null;
  } catch (err) {
    log.warn(`Telegram setting lookup failed for ${key}`, { message: err.message });
    return null;
  }
}

async function findKnownTelegramChatId() {
  try {
    const result = await pool.query(
      `SELECT chat_id
         FROM telegram_known_chats
        WHERE type IN ('group', 'supergroup')
          AND LOWER(REGEXP_REPLACE(COALESCE(title, ''), '[^[:alnum:]]', '', 'g')) = ANY($1::text[])
        ORDER BY updated_at DESC
        LIMIT 1`,
      [['parkrozvag', 'паркрозваг']]
    );
    return result.rows[0]?.chat_id ? String(result.rows[0].chat_id) : null;
  } catch (err) {
    log.warn('Known Telegram chat lookup failed', { message: err.message });
    return null;
  }
}

async function findKnownTelegramThreadId(chatId) {
  if (!chatId) return null;
  try {
    const result = await pool.query(
      `SELECT thread_id
         FROM telegram_known_threads
        WHERE chat_id = $1
          AND (LOWER(COALESCE(title, '')) LIKE '%anim%'
            OR LOWER(COALESCE(title, '')) LIKE '%анім%'
            OR LOWER(COALESCE(title, '')) LIKE '%аним%')
        ORDER BY updated_at DESC
        LIMIT 1`,
      [chatId]
    );
    return result.rows[0]?.thread_id ? parseInt(result.rows[0].thread_id, 10) || null : null;
  } catch (err) {
    log.warn('Known Telegram thread lookup failed', { message: err.message });
    return null;
  }
}

async function resolveAnimatorAskTelegramTarget() {
  const explicitChatId = await getSettingValue('telegram_animator_chat_id')
    || process.env.TELEGRAM_ANIMATOR_CHAT_ID;
  const chatId = explicitChatId || await findKnownTelegramChatId();
  if (!chatId) return { chatId: null, threadId: null, source: 'missing' };

  const configuredThreadId = await getSettingValue('telegram_animator_thread_id')
    || process.env.TELEGRAM_ANIMATOR_THREAD_ID;
  const threadId = (parseInt(configuredThreadId, 10) || null)
    || await findKnownTelegramThreadId(chatId);

  return {
    chatId,
    threadId: threadId || null,
    source: explicitChatId ? 'animator_config' : 'known_parkrozvag_group',
  };
}

function safeRequestId(value) {
  const id = parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function callbackMessageTarget(message) {
  if (!message?.chat?.id || !message?.message_id) return null;
  return { chat_id: message.chat.id, message_id: message.message_id };
}

async function answerCallback(callbackQueryId, text, options = {}) {
  return telegramRequest('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
    ...options,
  });
}

async function clearInlineKeyboard(message, context) {
  const target = callbackMessageTarget(message);
  if (!target) return;
  try {
    await telegramRequest('editMessageReplyMarkup', {
      ...target,
      reply_markup: { inline_keyboard: [] },
    });
  } catch (err) {
    log.warn(`${context} keyboard cleanup failed: ${err.message}`);
  }
}

async function editCallbackMessageFinal(message, finalText, context) {
  const target = callbackMessageTarget(message);
  if (!target) return;
  const baseText = message.text || message.caption || '';
  const text = baseText ? `${baseText}\n\n${finalText}` : finalText;
  try {
    await telegramRequest('editMessageText', {
      ...target,
      text,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [] },
    });
  } catch (err) {
    log.warn(`${context} final message edit failed: ${err.message}`);
    await clearInlineKeyboard(message, context);
  }
}

async function answerStaleCallback(callbackQueryId, message) {
  await answerCallback(callbackQueryId, 'Запит вже оброблено');
  await clearInlineKeyboard(message, 'stale animator callback');
}

async function handleAnimatorApprovalCallback(update) {
  const callback = update?.callback_query;
  const data = String(callback?.data || '');
  if (!data.startsWith('add_anim:') && !data.startsWith('no_anim:')) return false;

  const [, action, rawId] = data.match(/^(add_anim|no_anim):(.*)$/) || [];
  const requestId = safeRequestId(rawId);
  if (!requestId) {
    await answerCallback(callback.id, 'Невалідний запит');
    return true;
  }

  const message = callback.message;
  const chatId = message?.chat?.id;
  const target = await resolveAnimatorAskTelegramTarget();
  if (!target.chatId || String(chatId) !== String(target.chatId)) {
    await answerCallback(callback.id, 'Ця кнопка доступна лише в групі ParkRozvag', { show_alert: true });
    await clearInlineKeyboard(message, action);
    return true;
  }

  const isApproval = action === 'add_anim';
  const status = isApproval ? 'approved' : 'rejected';
  const pending = await pool.query(
    'UPDATE pending_animators SET status = $1 WHERE id = $2 AND status = $3 RETURNING *',
    [status, requestId, 'pending']
  );
  if (pending.rows.length === 0) {
    await answerStaleCallback(callback.id, message);
    return true;
  }

  if (!isApproval) {
    await answerCallback(callback.id, 'Відхилено');
    await editCallbackMessageFinal(message, '❌ <b>Відхилено</b>', 'no_anim');
    log.info('Animator request rejected', { requestId });
    return true;
  }

  const date = pending.rows[0].date;
  const { ensureDefaultLines } = require('./booking');
  await ensureDefaultLines(date);
  const lineParams = [date];
  const lineScope = pushDefaultTimelineBusinessContext(lineParams);
  const linesResult = await pool.query(
    `SELECT * FROM lines_by_date WHERE date = $1 AND ${lineScope} ORDER BY id`,
    lineParams
  );
  const existingNumbers = linesResult.rows
    .map(row => {
      const match = String(row.name || '').match(/^(?:Ручний аніматор|Manual animator) (\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    })
    .filter(number => number > 0);
  let nextNumber = 1;
  while (existingNumbers.includes(nextNumber)) nextNumber++;

  const colors = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#E91E63', '#00BCD4'];
  const lineId = `manual_animator_${Date.now()}_${date}`;
  const lineName = `Ручний аніматор ${nextNumber}`;
  await pool.query(
    `INSERT INTO lines_by_date (business_context, date, line_id, name, color)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (business_context, date, line_id) DO NOTHING`,
    ['event_genix', date, lineId, lineName, colors[linesResult.rows.length % colors.length]]
  );

  await answerCallback(callback.id, 'Аніматора додано!');
  await editCallbackMessageFinal(message, `✅ <b>Додано: ${lineName}</b>`, 'add_anim');
  log.info('Animator request approved and line added', { requestId, date, lineId, lineName });
  return true;
}

module.exports = {
  handleAnimatorApprovalCallback,
  resolveAnimatorAskTelegramTarget,
};
