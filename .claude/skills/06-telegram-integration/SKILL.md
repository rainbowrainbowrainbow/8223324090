# Skill: Telegram Integration

## Description
Full Telegram bot integration for the booking system: client-facing bot for bookings, manager commands, webhook setup, inline keyboards, and conversation flows. Supports both grammY and node-telegram-bot-api frameworks.

## Activation
Use this skill when:
- Setting up or configuring the Telegram bot
- Implementing bot commands
- Building inline keyboards or callback handlers
- Integrating bot with booking workflow
- Debugging Telegram webhook issues

## Bot Architecture

```
┌──────────────────────────────────────┐
│          Telegram Bot API            │
└──────────────┬───────────────────────┘
               │ webhook POST /api/telegram/webhook
               ▼
┌──────────────────────────────────────┐
│          Bot Router                  │
│  ├── /start                          │
│  ├── /book                           │
│  ├── /mybookings                     │
│  ├── /help                           │
│  ├── /cancel_<id>                    │
│  ├── Callback queries                │
│  └── Manager commands (/admin, etc.) │
└──────────────┬───────────────────────┘
               │
     ┌─────────┼──────────┐
     ▼         ▼          ▼
 Booking    Notification  Manager
 Service    Orchestrator  Service
```

## Setup

### Environment Variables
```env
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
TELEGRAM_WEBHOOK_URL=https://api.yourdomain.com/api/telegram/webhook
TELEGRAM_WEBHOOK_SECRET=random-secret-for-verification
TELEGRAM_ADMIN_CHAT_IDS=123456789,987654321
```

### Webhook Registration
```typescript
// src/telegram/setup.ts
import { Bot } from 'grammy';

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);

// Set webhook (run once on deploy)
await bot.api.setWebhook(process.env.TELEGRAM_WEBHOOK_URL!, {
  secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
  allowed_updates: ['message', 'callback_query', 'my_chat_member'],
  drop_pending_updates: true,
});
```

## Bot Commands

### Client Commands

```typescript
// /start — Welcome + registration
bot.command('start', async (ctx) => {
  const telegramUser = ctx.from;

  // Check if client exists
  let client = await db.client.findFirst({
    where: { telegramChatId: String(ctx.chat.id) },
  });

  if (!client) {
    // Start registration flow
    await ctx.reply(
      '👋 Вітаємо! Це бот для бронювання свят.\n\n' +
      'Для початку, будь ласка, поділіться номером телефону:',
      {
        reply_markup: {
          keyboard: [[{
            text: '📱 Поділитися номером',
            request_contact: true,
          }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      }
    );
    return;
  }

  await ctx.reply(
    `Привіт, ${client.fullName}! 🎉\n\n` +
    'Що хочете зробити?',
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🎪 Переглянути події', callback_data: 'events_list' }],
          [{ text: '📋 Мої бронювання', callback_data: 'my_bookings' }],
          [{ text: '📞 Зв\'язатися з нами', callback_data: 'contact_us' }],
        ],
      },
    }
  );
});

// Phone number registration
bot.on('message:contact', async (ctx) => {
  const contact = ctx.message.contact;
  if (contact.user_id !== ctx.from?.id) {
    await ctx.reply('❌ Будь ласка, поділіться своїм номером телефону.');
    return;
  }

  const phone = normalizePhone(contact.phone_number); // → +380...

  let client = await db.client.findFirst({ where: { phone } });
  if (client) {
    // Link existing client to Telegram
    await db.client.update({
      where: { id: client.id },
      data: {
        telegramChatId: String(ctx.chat.id),
        telegramUsername: ctx.from?.username,
      },
    });
    await ctx.reply(`✅ Ваш акаунт знайдено! Вітаємо, ${client.fullName}!`);
  } else {
    // Create new client
    await ctx.reply('Як вас звати? (Прізвище та ім\'я)');
    // Save state: awaiting_name
    await setConversationState(ctx.chat.id, 'awaiting_name', { phone });
  }
});

// /book — Start booking flow
bot.command('book', async (ctx) => {
  const events = await db.event.findMany({
    where: { status: 'PUBLISHED', dateStart: { gt: new Date() } },
    orderBy: { dateStart: 'asc' },
    take: 10,
  });

  if (events.length === 0) {
    await ctx.reply('😔 Наразі немає доступних подій. Слідкуйте за оновленнями!');
    return;
  }

  const buttons = events.map(e => [{
    text: `🎪 ${e.title} — ${formatDate(e.dateStart)}`,
    callback_data: `book_event_${e.id}`,
  }]);

  await ctx.reply('Оберіть подію для бронювання:', {
    reply_markup: { inline_keyboard: buttons },
  });
});

// /mybookings — List client's bookings
bot.command('mybookings', async (ctx) => {
  const client = await getClientByChatId(ctx.chat.id);
  if (!client) return ctx.reply('Спочатку зареєструйтесь: /start');

  const bookings = await db.booking.findMany({
    where: { clientId: client.id, status: { notIn: ['DRAFT'] } },
    include: { event: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  if (bookings.length === 0) {
    return ctx.reply('У вас ще немає бронювань. Забронювати: /book');
  }

  let text = '📋 Ваші бронювання:\n\n';
  for (const b of bookings) {
    const statusEmoji = getStatusEmoji(b.status);
    text += `${statusEmoji} ${b.bookingNumber}\n`;
    text += `  🎪 ${b.event.title}\n`;
    text += `  📅 ${formatDate(b.event.dateStart)}\n`;
    text += `  👥 ${b.guestsCount} гостей | 💰 ${b.totalPrice} ₴\n`;
    text += `  Статус: ${translateStatus(b.status)}\n\n`;
  }

  await ctx.reply(text);
});
```

### Callback Query Handlers

```typescript
// Event selection → booking flow
bot.callbackQuery(/^book_event_(.+)$/, async (ctx) => {
  const eventId = ctx.match[1];
  const event = await db.event.findUnique({ where: { id: eventId } });

  if (!event || event.status !== 'PUBLISHED') {
    return ctx.answerCallbackQuery('Подія більше не доступна');
  }

  const availableCapacity = await getAvailableCapacity(eventId);

  await ctx.editMessageText(
    `🎪 ${event.title}\n\n` +
    `📅 ${formatDate(event.dateStart)} — ${formatDate(event.dateEnd)}\n` +
    `📍 ${event.location}\n` +
    `💰 ${event.pricePerPerson} ₴/особа + ${event.basePrice} ₴ базова\n` +
    `👥 Вільних місць: ${availableCapacity}\n` +
    `💳 Депозит: ${event.depositPercent}%\n\n` +
    `Скільки гостей?`,
    {
      reply_markup: {
        inline_keyboard: [
          [1, 2, 3, 4, 5].map(n => ({
            text: `${n}`,
            callback_data: `guests_${eventId}_${n}`,
          })),
          [10, 15, 20, 30, 50].map(n => ({
            text: `${n}`,
            callback_data: `guests_${eventId}_${n}`,
          })),
          [{ text: '◀️ Назад', callback_data: 'events_list' }],
        ],
      },
    }
  );
});

// Booking confirmation
bot.callbackQuery(/^confirm_booking_(.+)$/, async (ctx) => {
  const bookingId = ctx.match[1];
  try {
    const booking = await transitionBooking(bookingId, 'submit', {
      actor: 'client',
      actorId: ctx.from.id.toString(),
    });

    const paymentUrl = await createPaymentUrl(booking);

    await ctx.editMessageText(
      `✅ Бронювання створено!\n\n` +
      `📋 Номер: ${booking.bookingNumber}\n` +
      `⏱ Тримається 30 хвилин\n\n` +
      `Для підтвердження — оплатіть депозит:`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '💳 Оплатити депозит', url: paymentUrl }],
            [{ text: '❌ Скасувати', callback_data: `cancel_${booking.id}` }],
          ],
        },
      }
    );
  } catch (error) {
    await ctx.answerCallbackQuery(error.message);
  }
});

// Cancel booking
bot.callbackQuery(/^cancel_(.+)$/, async (ctx) => {
  const bookingId = ctx.match[1];
  try {
    await transitionBooking(bookingId, 'cancel', {
      actor: 'client',
      actorId: ctx.from.id.toString(),
      reason: 'Скасовано клієнтом через Telegram',
    });
    await ctx.editMessageText('❌ Бронювання скасовано.');
  } catch (error) {
    await ctx.answerCallbackQuery(error.message);
  }
});
```

### Manager Commands

```typescript
// Manager authentication middleware
const managerOnly = async (ctx, next) => {
  const chatId = String(ctx.chat.id);
  const manager = await db.manager.findFirst({
    where: { telegramChatId: chatId, isActive: true },
  });
  if (!manager) {
    return ctx.reply('⛔ Доступ лише для менеджерів.');
  }
  ctx.manager = manager;
  await next();
};

// /admin — Manager dashboard
bot.command('admin', managerOnly, async (ctx) => {
  const stats = await getDashboardStats();

  await ctx.reply(
    `📊 Панель менеджера\n\n` +
    `Сьогодні:\n` +
    `  📥 Нових бронювань: ${stats.todayBookings}\n` +
    `  ✅ Підтверджених: ${stats.todayConfirmed}\n` +
    `  💰 Дохід: ${stats.todayRevenue} ₴\n\n` +
    `Загалом активних: ${stats.activeBookings}\n` +
    `Найближча подія: ${stats.nextEvent?.title || '—'}`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📋 Бронювання на сьогодні', callback_data: 'mgr_today' }],
          [{ text: '📥 Нові (неопрацьовані)', callback_data: 'mgr_pending' }],
          [{ text: '🎪 Мої події', callback_data: 'mgr_events' }],
          [{ text: '📊 Звіт за тиждень', callback_data: 'mgr_weekly' }],
        ],
      },
    }
  );
});
```

## Utility Functions

```typescript
function getStatusEmoji(status: BookingStatus): string {
  const map: Record<BookingStatus, string> = {
    DRAFT: '📝', HOLD: '⏳', PENDING_PAYMENT: '💳',
    CONFIRMED: '✅', PAID: '💚', COMPLETED: '🏁',
    CANCELLED: '❌', NO_SHOW: '👻', REFUNDED: '💸',
  };
  return map[status] || '❓';
}

function translateStatus(status: BookingStatus): string {
  const map: Record<BookingStatus, string> = {
    DRAFT: 'Чернетка', HOLD: 'Утримується', PENDING_PAYMENT: 'Очікує оплати',
    CONFIRMED: 'Підтверджено', PAID: 'Оплачено', COMPLETED: 'Завершено',
    CANCELLED: 'Скасовано', NO_SHOW: 'Не з\'явився', REFUNDED: 'Повернено',
  };
  return map[status] || status;
}

function normalizePhone(phone: string): string {
  let clean = phone.replace(/\D/g, '');
  if (clean.startsWith('380')) clean = '+' + clean;
  else if (clean.startsWith('80')) clean = '+3' + clean;
  else if (clean.startsWith('0')) clean = '+380' + clean.slice(1);
  else if (!clean.startsWith('+')) clean = '+' + clean;
  return clean;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('uk-UA', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(date);
}
```

## Webhook Endpoint (Fastify)

```typescript
// src/routes/telegram-webhook.ts
app.post('/api/telegram/webhook', async (request, reply) => {
  const secret = request.headers['x-telegram-bot-api-secret-token'];
  if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }

  try {
    await bot.handleUpdate(request.body);
    return reply.code(200).send({ ok: true });
  } catch (error) {
    console.error('Telegram webhook error:', error);
    return reply.code(200).send({ ok: true }); // Always 200 to prevent retries
  }
});
```

## Security Rules

1. **Always** verify webhook secret header
2. **Never** expose bot token in client-side code
3. **Validate** callback_data to prevent manipulation
4. **Rate-limit** bot commands per user (max 30/min)
5. **Sanitize** user input before database operations
6. **Log** all bot interactions for audit
7. Manager commands require **telegramChatId** matching in DB
