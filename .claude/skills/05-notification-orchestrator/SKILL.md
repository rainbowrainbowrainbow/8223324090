# Skill: Notification Orchestrator

## Description
Manages multi-channel notification delivery (Telegram, Email, SMS) with templates, scheduling, retries, and delivery tracking. Central hub for all outbound communications in the booking system.

## Activation
Use this skill when:
- Sending notifications to clients or managers
- Creating/editing notification templates
- Setting up scheduled reminders
- Debugging delivery failures
- Building notification analytics

## Architecture

```
┌─────────────────────┐
│  Booking Workflow    │
│  (state machine)     │
└──────────┬──────────┘
           │ event: booking.statusChanged
           ▼
┌─────────────────────┐
│  Notification        │
│  Orchestrator        │
│  - resolve template  │
│  - resolve channels  │
│  - schedule or send  │
└──────────┬──────────┘
           │
     ┌─────┼──────────┐
     ▼     ▼          ▼
┌────────┐┌────────┐┌─────┐
│Telegram││ Email  ││ SMS │
│Provider││Provider││Prov.│
└────────┘└────────┘└─────┘
```

## Notification Events & Templates

### Client Notifications

| Event | Template ID | Channels | Timing |
|-------|------------|----------|--------|
| Booking created (HOLD) | `booking_created` | Telegram, Email | Immediate |
| Hold expiring soon | `hold_expiring` | Telegram | holdExpiresAt - 5min |
| Hold expired | `hold_expired` | Telegram, Email | On expiry |
| Payment pending | `payment_pending` | Telegram | Immediate |
| Booking confirmed | `booking_confirmed` | Telegram, Email | On deposit paid |
| Full payment received | `payment_complete` | Telegram, Email | Immediate |
| Reminder 24h | `reminder_24h` | Telegram | event.dateStart - 24h |
| Reminder 3h | `reminder_3h` | Telegram | event.dateStart - 3h |
| Booking cancelled | `booking_cancelled` | Telegram, Email | Immediate |
| Refund processed | `refund_processed` | Telegram, Email | Immediate |
| Feedback request | `feedback_request` | Telegram | event.dateEnd + 2h |

### Manager Notifications

| Event | Template ID | Channels | Timing |
|-------|------------|----------|--------|
| New booking | `mgr_new_booking` | Telegram | Immediate |
| Booking confirmed | `mgr_booking_confirmed` | Telegram | Immediate |
| Booking cancelled | `mgr_booking_cancelled` | Telegram | Immediate |
| Payment received | `mgr_payment_received` | Telegram | Immediate |
| Daily summary | `mgr_daily_summary` | Telegram, Email | Daily 09:00 |
| Event tomorrow | `mgr_event_tomorrow` | Telegram | event.dateStart - 24h |
| Capacity alert (80%+) | `mgr_capacity_alert` | Telegram | On booking confirm |

## Template System

```typescript
// src/notifications/templates.ts

interface TemplateContext {
  booking?: Booking & { event: Event; client: Client };
  payment?: Payment;
  event?: Event;
  manager?: Manager;
  client?: Client;
  custom?: Record<string, any>;
}

const templates: Record<string, TemplateDefinition> = {
  booking_created: {
    telegram: {
      text: `🎉 Бронювання створено!\n\n` +
        `📋 Номер: {{booking.bookingNumber}}\n` +
        `🎪 Подія: {{event.title}}\n` +
        `📅 Дата: {{event.dateStart | formatDate}}\n` +
        `👥 Гостей: {{booking.guestsCount}}\n` +
        `💰 Сума: {{booking.totalPrice}} ₴\n` +
        `💳 Депозит: {{booking.depositAmount}} ₴\n\n` +
        `⏱ Бронь утримується 30 хвилин.\n` +
        `Для підтвердження, будь ласка, сплатіть депозит.`,
      buttons: [
        { text: '💳 Оплатити депозит', url: '{{paymentUrl}}' },
        { text: '❌ Скасувати', callback_data: 'cancel_{{booking.id}}' },
      ],
    },
    email: {
      subject: 'Бронювання {{booking.bookingNumber}} створено',
      html: 'booking-created.html', // Handlebars template file
    },
  },

  reminder_24h: {
    telegram: {
      text: `⏰ Нагадування!\n\n` +
        `Завтра о {{event.dateStart | formatTime}} відбудеться:\n` +
        `🎪 {{event.title}}\n` +
        `📍 {{event.location}}\n` +
        `👥 Гостей: {{booking.guestsCount}}\n\n` +
        `Номер бронювання: {{booking.bookingNumber}}\n` +
        `Чекаємо на вас! 🎉`,
    },
  },

  mgr_new_booking: {
    telegram: {
      text: `📥 Нове бронювання!\n\n` +
        `#{{booking.bookingNumber}}\n` +
        `👤 {{client.fullName}} ({{client.phone}})\n` +
        `🎪 {{event.title}}\n` +
        `📅 {{event.dateStart | formatDate}}\n` +
        `👥 {{booking.guestsCount}} гостей\n` +
        `💰 {{booking.totalPrice}} ₴\n` +
        `📊 Статус: {{booking.status}}`,
      buttons: [
        { text: '✅ Деталі', url: '{{adminUrl}}/bookings/{{booking.id}}' },
      ],
    },
  },

  mgr_daily_summary: {
    telegram: {
      text: `📊 Щоденний звіт ({{date | formatDate}})\n\n` +
        `Нові бронювання: {{stats.newBookings}}\n` +
        `Підтверджені: {{stats.confirmed}}\n` +
        `Скасовані: {{stats.cancelled}}\n` +
        `Дохід за день: {{stats.revenue}} ₴\n\n` +
        `🎪 Найближчі події:\n{{upcomingEvents}}`,
    },
    email: {
      subject: 'Щоденний звіт бронювань - {{date | formatDate}}',
      html: 'daily-summary.html',
    },
  },
};
```

## Orchestrator Service

```typescript
// src/services/notification-orchestrator.ts

class NotificationOrchestrator {
  constructor(
    private telegramProvider: TelegramProvider,
    private emailProvider: EmailProvider,
    private smsProvider: SmsProvider,
    private db: PrismaClient,
    private queue: JobQueue, // bull / bullmq / agenda
  ) {}

  async dispatch(
    event: NotificationEvent,
    context: TemplateContext,
    options?: { delay?: number; scheduledAt?: Date }
  ) {
    const template = templates[event];
    if (!template) throw new Error(`Template not found: ${event}`);

    const channels = Object.keys(template) as NotificationChannel[];

    for (const channel of channels) {
      const notification = await this.db.notification.create({
        data: {
          recipientType: context.client ? 'client' : 'manager',
          recipientId: context.client?.id || context.manager?.id,
          bookingId: context.booking?.id,
          channel,
          template: event,
          payload: context,
          status: options?.scheduledAt ? 'QUEUED' : 'QUEUED',
          scheduledAt: options?.scheduledAt,
        },
      });

      if (options?.scheduledAt) {
        await this.queue.add('send-notification', {
          notificationId: notification.id,
        }, {
          delay: options.scheduledAt.getTime() - Date.now(),
          attempts: 3,
          backoff: { type: 'exponential', delay: 60000 },
        });
      } else {
        await this.queue.add('send-notification', {
          notificationId: notification.id,
        }, {
          attempts: 3,
          backoff: { type: 'exponential', delay: 30000 },
        });
      }
    }
  }

  async processNotification(notificationId: string) {
    const notification = await this.db.notification.findUniqueOrThrow({
      where: { id: notificationId },
    });

    try {
      const rendered = renderTemplate(
        notification.template,
        notification.channel,
        notification.payload as TemplateContext
      );

      switch (notification.channel) {
        case 'TELEGRAM':
          await this.telegramProvider.send(
            notification.recipientId,
            rendered
          );
          break;
        case 'EMAIL':
          await this.emailProvider.send(
            notification.recipientId,
            rendered
          );
          break;
        case 'SMS':
          await this.smsProvider.send(
            notification.recipientId,
            rendered
          );
          break;
      }

      await this.db.notification.update({
        where: { id: notificationId },
        data: { status: 'SENT', sentAt: new Date() },
      });
    } catch (error) {
      const retryCount = notification.retryCount + 1;
      await this.db.notification.update({
        where: { id: notificationId },
        data: {
          status: retryCount >= 3 ? 'FAILED' : 'RETRY',
          retryCount,
          error: error.message,
        },
      });
      throw error; // let queue handle retry
    }
  }
}
```

## Scheduling Helpers

```typescript
function scheduleBookingReminders(booking: Booking & { event: Event }) {
  const eventStart = booking.event.dateStart;

  return [
    {
      template: 'reminder_24h',
      scheduledAt: subHours(eventStart, 24),
    },
    {
      template: 'reminder_3h',
      scheduledAt: subHours(eventStart, 3),
    },
    {
      template: 'feedback_request',
      scheduledAt: addHours(booking.event.dateEnd, 2),
    },
  ].filter(r => r.scheduledAt > new Date()); // only future reminders
}

function scheduleHoldExpiryWarning(booking: Booking) {
  if (!booking.holdExpiresAt) return [];
  return [{
    template: 'hold_expiring',
    scheduledAt: subMinutes(booking.holdExpiresAt, 5),
  }].filter(r => r.scheduledAt > new Date());
}

// Triggered by cron (daily at 09:00 Kyiv time)
async function sendManagerEventReminders() {
  const tomorrow = addDays(startOfDay(new Date()), 1);
  const events = await db.event.findMany({
    where: {
      dateStart: { gte: tomorrow, lt: addDays(tomorrow, 1) },
      status: 'PUBLISHED',
    },
    include: { manager: true },
  });
  for (const event of events) {
    if (event.manager?.telegramChatId) {
      await orchestrator.dispatch('mgr_event_tomorrow', {
        event, manager: event.manager,
      });
    }
  }
}

// Triggered on booking confirm — check capacity threshold
async function checkCapacityAlert(booking: Booking & { event: Event }) {
  const confirmed = await db.booking.aggregate({
    where: { eventId: booking.eventId, status: { in: ['CONFIRMED', 'PAID'] } },
    _sum: { guestsCount: true },
  });
  const used = confirmed._sum.guestsCount || 0;
  const ratio = used / booking.event.capacityMax;
  if (ratio >= 0.8) {
    await orchestrator.dispatch('mgr_capacity_alert', {
      event: booking.event, custom: { usedPercent: Math.round(ratio * 100), used },
    });
  }
}
```

## Retry Policy

| Attempt | Delay | Total Wait |
|---------|-------|-----------|
| 1st retry | 30 seconds | 30s |
| 2nd retry | 2 minutes | 2.5min |
| 3rd retry | 10 minutes | 12.5min |
| After 3 fails | Mark FAILED, alert admin | - |

## Monitoring Queries

```sql
-- Failed notifications in last 24h
SELECT channel, template, COUNT(*) as failed_count
FROM notifications
WHERE status = 'FAILED' AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY channel, template;

-- Delivery rate by channel
SELECT channel,
  COUNT(*) FILTER (WHERE status = 'SENT') * 100.0 / COUNT(*) as delivery_rate
FROM notifications
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY channel;
```
