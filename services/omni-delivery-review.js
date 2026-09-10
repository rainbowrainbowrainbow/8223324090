'use strict';
const { pool } = require('../db');
const { resolveOmniRuntimeConfig } = require('./omni-accounts');

async function findMessage(id, businessContext) {
  const result = await pool.query(
    `SELECT m.*, c.channel, c.external_id, c.customer_phone FROM conversation_messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE m.id = $1 AND COALESCE(c.business_context, 'event_genix') = $2`, [id, businessContext]);
  const message = result.rows[0];
  if (!message) throw Object.assign(new Error('Повідомлення не знайдено'), { statusCode: 404 });
  if (message.direction !== 'outbound') throw Object.assign(new Error('Звірка доступна для вихідних повідомлень.'), { statusCode: 400 });
  return message;
}

async function reconcileMessage(id, businessContext) {
  const row = await findMessage(id, businessContext);
  const hub = require('./omni-hub');
  const response = { message: hub.mapMessageRow(row), canRecheck: false };
  if (['delivered', 'read', 'later_failed'].includes(row.delivery_status)) {
    return { ...response, nextAction: 'Фінальний стан уже підтверджений провайдером.' };
  }
  if (!row.provider_message_id) {
    return { ...response, nextAction: 'Немає ID провайдера. Звірте повідомлення безпосередньо в каналі; повторне надсилання може створити дубль.' };
  }
  const runtime = await resolveOmniRuntimeConfig(row.channel, { businessContext });
  if (row.channel !== 'sms' || runtime.provider !== 'turbosms') {
    return { ...response, nextAction: 'Автоматична звірка цього каналу недоступна. Очікуйте підтвердження каналу або зафіксуйте ручну перевірку.' };
  }
  const result = await require('./omni-sms-providers').getTurboSmsDeliveryStatus(runtime, row.provider_message_id, row.external_id || row.customer_phone);
  if (!result.deliveryStatus) {
    return { ...response, canRecheck: true, nextAction: 'Провайдер ще не визначив результат. Перевірте пізніше; повідомлення повторно не надсилалось.' };
  }
  await hub.applyProviderLifecycleReceipt({
    channel: 'sms', providerMessageId: row.provider_message_id, deliveryStatus: result.deliveryStatus,
    providerLifecycleSource: 'turbosms_status_query', providerLifecycleEvent: result.providerStatus,
    providerLifecycleAt: new Date().toISOString(),
    deliveryError: result.deliveryStatus === 'later_failed' ? result.providerStatus : null,
  }, { businessContext, messageId: id, reconcileOnly: true });
  return { message: hub.mapMessageRow(await findMessage(id, businessContext)), canRecheck: true,
    nextAction: 'Статус звірено з TurboSMS. Нового повідомлення не надсилали.' };
}

async function recordManualVerification(id, businessContext, user, input) {
  if (!['observed_present', 'observed_absent', 'unresolved'].includes(input.outcome)
      || typeof input.note !== 'string' || !input.note.trim() || input.note.length > 500) {
    throw Object.assign(new Error('Оберіть результат і додайте пояснення до 500 символів.'), { statusCode: 400 });
  }
  await findMessage(id, businessContext);
  const verification = { outcome: input.outcome, note: input.note.trim(), by: user.username || String(user.id),
    userId: user.id, at: new Date().toISOString(), source: 'manager' };
  const result = await pool.query(
    `UPDATE conversation_messages m SET meta = COALESCE(m.meta, '{}'::jsonb) ||
       jsonb_build_object('manualVerification', $3::jsonb,
         'manualVerifications', COALESCE(m.meta->'manualVerifications', '[]'::jsonb) || jsonb_build_array($3::jsonb))
     FROM conversations c WHERE c.id = m.conversation_id AND m.id = $1
       AND COALESCE(c.business_context, 'event_genix') = $2 AND m.direction = 'outbound' RETURNING m.*`,
    [id, businessContext, JSON.stringify(verification)]);
  if (!result.rows[0]) throw Object.assign(new Error('Повідомлення не знайдено'), { statusCode: 404 });
  const hub = require('./omni-hub');
  const message = hub.mapMessageRow(result.rows[0]);
  hub.notifyCRM('omni:message', { businessContext, message });
  return message;
}

module.exports = { reconcileMessage, recordManualVerification };
