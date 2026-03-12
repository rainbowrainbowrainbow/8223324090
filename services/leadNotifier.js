/**
 * services/leadNotifier.js — Notify managers about new leads via Telegram
 * v23.4.0: Lead Capture Integration
 */
const { pool } = require('../db');
const { sendTelegramMessage } = require('./telegram');
const { createLogger } = require('../utils/logger');

const log = createLogger('LeadNotifier');

const SOURCE_LABELS = {
  telegram:       '🔵 Telegram',
  facebook:       '🔷 Facebook',
  instagram:      '🟣 Instagram',
  viber:          '🟢 Viber',
  tiktok:         '⚫ TikTok',
  turbo:          '🟠 Turbo',
  bnderoga:       '🟡 BnD',
  universal:      '🌐 Universal',
  manual:         '✏️ Ручний',
};

async function notifyNewLead(lead) {
  try {
    const managers = await pool.query(
      `SELECT telegram_chat_id FROM users
       WHERE role IN ('manager', 'director', 'creator')
         AND telegram_chat_id IS NOT NULL
         AND is_active = true`
    );

    if (managers.rows.length === 0) {
      log.warn('No managers with telegram_chat_id for lead notification');
      return;
    }

    const src   = SOURCE_LABELS[lead.source_channel] || `📥 ${lead.source_channel || '?'}`;
    const name  = lead.client_name || 'Без імені';
    const phone = lead.phone     ? `\n📞 ${lead.phone}`              : '';
    const ig    = lead.instagram ? `\n📸 @${lead.instagram}`         : '';
    const notes = lead.notes     ? `\n💬 ${lead.notes.slice(0, 200)}` : '';

    const text = `🔥 <b>Новий лід</b> [${src}]\n\n`
      + `👤 <b>${name}</b>${phone}${ig}${notes}\n\n`
      + `<a href="https://${process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost:3000'}/customers?tab=leads">Відкрити в CRM →</a>`;

    for (const row of managers.rows) {
      sendTelegramMessage(row.telegram_chat_id, text, { parse_mode: 'HTML' })
        .catch(e => log.warn(`Notify failed for ${row.telegram_chat_id}: ${e.message}`));
    }
  } catch (err) {
    log.error('notifyNewLead error', err);
  }
}

module.exports = { notifyNewLead };
