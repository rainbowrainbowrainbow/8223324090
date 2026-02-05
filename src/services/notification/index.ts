import { db } from '../../db/client.js';
import { env } from '../../config/env.js';
import type { TemplateContext } from '../../types/index.js';
import { renderTemplate } from './templates.js';

const MAX_RETRIES = 3;
const RETRY_DELAYS = [30_000, 120_000, 600_000]; // 30s, 2min, 10min

interface DispatchOptions {
  delay?: number;
  scheduledAt?: Date;
}

export async function dispatch(
  templateId: string,
  recipientType: string,
  recipientId: string,
  context: TemplateContext,
  options?: DispatchOptions,
) {
  const rendered = renderTemplate(templateId, context);
  if (!rendered) return;

  const bookingId = context.booking?.id || null;

  // Create notification records for each channel
  const notifications = [];

  if (rendered.telegram) {
    notifications.push(
      db.notification.create({
        data: {
          recipientType,
          recipientId,
          bookingId,
          channel: 'TELEGRAM',
          template: templateId,
          payload: { text: rendered.telegram.text, parseMode: rendered.telegram.parseMode },
          status: options?.scheduledAt ? 'QUEUED' : 'QUEUED',
          scheduledAt: options?.scheduledAt || null,
        },
      }),
    );
  }

  if (rendered.email) {
    notifications.push(
      db.notification.create({
        data: {
          recipientType,
          recipientId,
          bookingId,
          channel: 'EMAIL',
          template: templateId,
          payload: { subject: rendered.email.subject, text: rendered.email.text },
          status: 'QUEUED',
          scheduledAt: options?.scheduledAt || null,
        },
      }),
    );
  }

  const created = await Promise.all(notifications);

  // Process immediately if no schedule
  if (!options?.scheduledAt) {
    for (const n of created) {
      processNotification(n.id).catch((err) => {
        console.error(`[Notification] Failed to process ${n.id}:`, err);
      });
    }
  }

  return created;
}

export async function processNotification(notificationId: string) {
  const notification = await db.notification.findUnique({
    where: { id: notificationId },
  });

  if (!notification || notification.status === 'SENT' || notification.status === 'DELIVERED') {
    return;
  }

  try {
    const payload = notification.payload as Record<string, unknown>;

    if (notification.channel === 'TELEGRAM') {
      await sendTelegram(notification.recipientType, notification.recipientId, payload);
    } else if (notification.channel === 'EMAIL') {
      // Email sending not implemented yet
      console.log(`[Notification] Email sending not implemented: ${notification.id}`);
    }

    await db.notification.update({
      where: { id: notificationId },
      data: { status: 'SENT', sentAt: new Date() },
    });
  } catch (err) {
    const retryCount = notification.retryCount + 1;

    if (retryCount >= MAX_RETRIES) {
      await db.notification.update({
        where: { id: notificationId },
        data: {
          status: 'FAILED',
          retryCount,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      console.error(
        `[Notification] Permanently failed after ${MAX_RETRIES} retries: ${notificationId}`,
      );
    } else {
      await db.notification.update({
        where: { id: notificationId },
        data: {
          status: 'RETRY',
          retryCount,
          error: err instanceof Error ? err.message : String(err),
          scheduledAt: new Date(Date.now() + (RETRY_DELAYS[retryCount - 1] ?? 600_000)),
        },
      });
    }
  }
}

async function sendTelegram(
  recipientType: string,
  recipientId: string,
  payload: Record<string, unknown>,
) {
  const token = env.TELEGRAM_BOT_TOKEN;
  let chatId: string;

  if (recipientType === 'manager') {
    const manager = await db.manager.findUnique({
      where: { id: recipientId },
      select: { telegramChatId: true },
    });
    chatId = manager?.telegramChatId || env.TELEGRAM_DEFAULT_CHAT_ID || '';
  } else {
    const client = await db.client.findUnique({
      where: { id: recipientId },
      select: { telegramChatId: true },
    });
    chatId = client?.telegramChatId || '';
  }

  if (!chatId) {
    throw new Error(`No Telegram chat ID for ${recipientType}:${recipientId}`);
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: payload.text,
      parse_mode: payload.parseMode || 'HTML',
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram API error: ${response.status} ${body}`);
  }
}

// ── Scheduled notification processor (cron) ─────────────────────────

export async function processScheduledNotifications() {
  const due = await db.notification.findMany({
    where: {
      status: { in: ['QUEUED', 'RETRY'] },
      scheduledAt: { lte: new Date() },
    },
    take: 50,
    orderBy: { scheduledAt: 'asc' },
  });

  let processed = 0;
  for (const n of due) {
    try {
      await processNotification(n.id);
      processed++;
    } catch (err) {
      console.error(`[Cron] Notification processing failed: ${n.id}`, err);
    }
  }

  if (processed > 0) {
    console.log(`[Cron] Processed ${processed} scheduled notifications`);
  }
}
