import { Bot, InlineKeyboard, session } from 'grammy';
import type { Context, SessionFlavor } from 'grammy';
import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { normalizePhone, isValidUAPhone, formatPhone } from '../utils/phone.js';
import { formatCurrency } from '../utils/format.js';
import { formatDateFull, toKyivDateTime } from '../utils/dates.js';
import { STATUS_EMOJI } from '../types/enums.js';
import { createBooking } from '../services/booking/index.js';
import { transitionBooking } from '../services/booking/state-machine.js';
import { buildPaymentUrl } from '../services/payment/liqpay.js';
import { findOrCreateClient } from '../services/client/index.js';

// ── Session Types ───────────────────────────────────────────────────

interface SessionData {
  awaitingPhone?: boolean;
  selectedEventId?: string;
  selectedGuests?: number;
}

type BotContext = Context & SessionFlavor<SessionData>;

// ── Rate Limiting ───────────────────────────────────────────────────

const rateLimitMap = new Map<number, number[]>();
const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX = 30;

function checkRateLimit(userId: number): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(userId) || [];
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW);
  recent.push(now);
  rateLimitMap.set(userId, recent);
  return recent.length <= RATE_LIMIT_MAX;
}

// ── Bot Setup ───────────────────────────────────────────────────────

export function createBot(): Bot<BotContext> {
  const bot = new Bot<BotContext>(env.TELEGRAM_BOT_TOKEN);

  // Session middleware
  bot.use(
    session({
      initial: (): SessionData => ({}),
    }),
  );

  // Rate limiting
  bot.use(async (ctx, next) => {
    if (ctx.from && !checkRateLimit(ctx.from.id)) {
      await ctx.reply('⚠️ Забагато запитів. Зачекайте хвилину.');
      return;
    }
    await next();
  });

  // ── Commands ────────────────────────────────────────────────────

  bot.command('start', async (ctx) => {
    const chatId = String(ctx.chat.id);

    const client = await db.client.findFirst({
      where: { telegramChatId: chatId },
    });

    if (client) {
      const keyboard = new InlineKeyboard()
        .text('🎪 Переглянути події', 'browse_events')
        .row()
        .text('📋 Мої бронювання', 'my_bookings');

      await ctx.reply(
        `Привіт, ${client.fullName}! 👋\n\nОберіть дію:`,
        { reply_markup: keyboard },
      );
    } else {
      ctx.session.awaitingPhone = true;
      await ctx.reply(
        'Вітаємо! 🎉\n\n' +
          'Для початку роботи поділіться номером телефону.\n' +
          'Натисніть кнопку нижче або введіть номер у форматі +380XXXXXXXXX.',
        {
          reply_markup: {
            keyboard: [[{ text: '📱 Поділитися номером', request_contact: true }]],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        },
      );
    }
  });

  bot.command('book', async (ctx) => {
    await showEventsList(ctx);
  });

  bot.command('mybookings', async (ctx) => {
    await showMyBookings(ctx);
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      '📖 <b>Доступні команди:</b>\n\n' +
        '/start — Головне меню\n' +
        '/book — Переглянути доступні події\n' +
        '/mybookings — Мої бронювання\n' +
        '/help — Допомога',
      { parse_mode: 'HTML' },
    );
  });

  // ── Contact Sharing (phone registration) ────────────────────────

  bot.on('message:contact', async (ctx) => {
    const contact = ctx.message.contact;
    const phone = normalizePhone(contact.phone_number);

    if (!isValidUAPhone(phone)) {
      await ctx.reply('❌ Невірний формат номера. Спробуйте ще раз у форматі +380XXXXXXXXX.');
      return;
    }

    const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Клієнт';
    const chatId = String(ctx.chat.id);
    const username = ctx.from?.username;

    await findOrCreateClient({
      fullName,
      phone,
      telegramChatId: chatId,
      telegramUsername: username,
      source: 'TELEGRAM',
    });

    ctx.session.awaitingPhone = false;

    const keyboard = new InlineKeyboard()
      .text('🎪 Переглянути події', 'browse_events')
      .row()
      .text('📋 Мої бронювання', 'my_bookings');

    await ctx.reply(`✅ Реєстрація завершена!\n\n${fullName}, ${formatPhone(phone)}`, {
      reply_markup: keyboard,
    });
  });

  // Phone number as text message
  bot.hears(/^\+?380\d{9}$/, async (ctx) => {
    if (!ctx.session.awaitingPhone) return;

    const phone = normalizePhone(ctx.message?.text ?? '');
    if (!isValidUAPhone(phone)) {
      await ctx.reply('❌ Невірний формат. Введіть +380XXXXXXXXX');
      return;
    }

    const chatId = String(ctx.chat.id);
    const fullName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || 'Клієнт';

    await findOrCreateClient({
      fullName,
      phone,
      telegramChatId: chatId,
      telegramUsername: ctx.from?.username,
      source: 'TELEGRAM',
    });

    ctx.session.awaitingPhone = false;

    const keyboard = new InlineKeyboard()
      .text('🎪 Переглянути події', 'browse_events')
      .row()
      .text('📋 Мої бронювання', 'my_bookings');

    await ctx.reply(`✅ Номер ${formatPhone(phone)} зареєстровано!`, {
      reply_markup: keyboard,
    });
  });

  // ── Callback Queries ────────────────────────────────────────────

  bot.callbackQuery('browse_events', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showEventsList(ctx);
  });

  bot.callbackQuery('my_bookings', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMyBookings(ctx);
  });

  bot.callbackQuery(/^book_event_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const eventId = ctx.match[1]!;
    ctx.session.selectedEventId = eventId;

    const event = await db.event.findUnique({ where: { id: eventId } });
    if (!event) {
      await ctx.editMessageText('❌ Подію не знайдено.');
      return;
    }

    const keyboard = new InlineKeyboard();
    const guestOptions = [1, 2, 3, 4, 5, 10, 15, 20, 30, 50];

    for (let i = 0; i < guestOptions.length; i++) {
      keyboard.text(String(guestOptions[i]), `guests_${guestOptions[i]}`);
      if ((i + 1) % 5 === 0) keyboard.row();
    }
    keyboard.row().text('◀️ Назад', 'browse_events');

    await ctx.editMessageText(
      `🎪 <b>${event.title}</b>\n\n` +
        `📅 ${formatDateFull(event.dateStart)}\n` +
        `📍 ${event.location}\n` +
        `💰 ${formatCurrency(event.pricePerPerson)}/особа\n\n` +
        `Оберіть кількість гостей:`,
      { parse_mode: 'HTML', reply_markup: keyboard },
    );
  });

  bot.callbackQuery(/^guests_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const guestsCount = parseInt(ctx.match[1]!, 10);
    const eventId = ctx.session.selectedEventId;

    if (!eventId) {
      await ctx.editMessageText('❌ Оберіть подію спочатку.');
      return;
    }

    ctx.session.selectedGuests = guestsCount;

    const event = await db.event.findUnique({ where: { id: eventId } });
    if (!event) {
      await ctx.editMessageText('❌ Подію не знайдено.');
      return;
    }

    const total = event.pricePerPerson.mul(guestsCount).add(event.basePrice);
    const deposit = total.mul(event.depositPercent).div(100);

    const keyboard = new InlineKeyboard()
      .text('✅ Підтвердити бронювання', `confirm_${eventId}_${guestsCount}`)
      .row()
      .text('◀️ Назад', `book_event_${eventId}`);

    await ctx.editMessageText(
      `📋 <b>Підтвердження бронювання</b>\n\n` +
        `🎪 ${event.title}\n` +
        `📅 ${formatDateFull(event.dateStart)}\n` +
        `👥 Гостей: ${guestsCount}\n` +
        `💰 Сума: ${formatCurrency(total)}\n` +
        `💳 Депозит: ${formatCurrency(deposit)}\n\n` +
        `Підтвердити?`,
      { parse_mode: 'HTML', reply_markup: keyboard },
    );
  });

  bot.callbackQuery(/^confirm_(.+)_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery('Створюємо бронювання...');
    const eventId = ctx.match[1]!;
    const guestsCount = parseInt(ctx.match[2]!, 10);

    const chatId = String(ctx.chat!.id);
    const client = await db.client.findFirst({ where: { telegramChatId: chatId } });

    if (!client) {
      await ctx.editMessageText('❌ Спочатку зареєструйтесь: /start');
      return;
    }

    try {
      const booking = await createBooking({
        eventId: eventId,
        fullName: client.fullName,
        phone: client.phone,
        email: client.email || undefined,
        guestsCount,
      });

      const paymentUrl = buildPaymentUrl(
        booking.id,
        Number(booking.depositAmount),
        `Депозит за ${booking.event.title}`,
      );

      const keyboard = new InlineKeyboard()
        .url('💳 Оплатити депозит', paymentUrl)
        .row()
        .text('❌ Скасувати', `cancel_${booking.id}`);

      await ctx.editMessageText(
        `🎉 <b>Бронювання створено!</b>\n\n` +
          `📋 Номер: <b>${booking.bookingNumber}</b>\n` +
          `🎪 ${booking.event.title}\n` +
          `👥 Гостей: ${booking.guestsCount}\n` +
          `💰 Сума: ${formatCurrency(booking.totalPrice)}\n` +
          `💳 Депозит: ${formatCurrency(booking.depositAmount)}\n\n` +
          `⏱ Бронь утримується 30 хвилин.`,
        { parse_mode: 'HTML', reply_markup: keyboard },
      );
    } catch (err: any) {
      await ctx.editMessageText(`❌ ${err.message || 'Помилка створення бронювання'}`);
    }
  });

  bot.callbackQuery(/^cancel_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const bookingId = ctx.match[1]!;

    try {
      const booking = await transitionBooking(bookingId, 'cancel', {
        actor: 'client',
        reason: 'Скасовано через Telegram',
      });

      await ctx.editMessageText(
        `❌ Бронювання ${booking.bookingNumber} скасовано.`,
      );
    } catch (err: any) {
      await ctx.editMessageText(`❌ ${err.message || 'Помилка скасування'}`);
    }
  });

  // ── Manager Commands ────────────────────────────────────────────

  bot.command('admin', async (ctx) => {
    const chatId = String(ctx.chat.id);
    const manager = await db.manager.findFirst({
      where: { telegramChatId: chatId, isActive: true },
    });

    if (!manager) {
      await ctx.reply('⛔ Доступ лише для менеджерів.');
      return;
    }

    const todayBookings = await db.booking.count({
      where: {
        createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        ...(manager.role === 'MANAGER' ? { event: { managerId: manager.id } } : {}),
      },
    });

    const pendingBookings = await db.booking.count({
      where: {
        status: { in: ['HOLD', 'PENDING_PAYMENT'] },
        ...(manager.role === 'MANAGER' ? { event: { managerId: manager.id } } : {}),
      },
    });

    const keyboard = new InlineKeyboard()
      .text('📋 Бронювання сьогодні', 'admin_today')
      .row()
      .text('📥 Нові (очікують)', 'admin_pending')
      .row()
      .text('🎪 Мої події', 'admin_events');

    await ctx.reply(
      `👤 <b>${manager.name}</b> (${manager.role})\n\n` +
        `📊 Бронювань сьогодні: ${todayBookings}\n` +
        `⏳ Очікують дії: ${pendingBookings}`,
      { parse_mode: 'HTML', reply_markup: keyboard },
    );
  });

  return bot;
}

// ── Helper Functions ────────────────────────────────────────────────

async function showEventsList(ctx: BotContext) {
  const events = await db.event.findMany({
    where: {
      status: 'PUBLISHED',
      dateStart: { gte: new Date() },
      deletedAt: null,
    },
    orderBy: { dateStart: 'asc' },
    take: 10,
  });

  if (events.length === 0) {
    await ctx.reply('😔 Наразі немає доступних подій.');
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const event of events) {
    keyboard
      .text(
        `🎪 ${event.title} — ${formatDateFull(event.dateStart)}`,
        `book_event_${event.id}`,
      )
      .row();
  }

  const text = events.length === 1
    ? 'Доступна подія:'
    : `Доступні події (${events.length}):`;

  // Try to edit existing message, fall back to new message
  try {
    await ctx.editMessageText(text, { reply_markup: keyboard });
  } catch {
    await ctx.reply(text, { reply_markup: keyboard });
  }
}

async function showMyBookings(ctx: BotContext) {
  const chatId = String(ctx.chat!.id);
  const client = await db.client.findFirst({
    where: { telegramChatId: chatId },
  });

  if (!client) {
    await ctx.reply('Спочатку зареєструйтесь: /start');
    return;
  }

  const bookings = await db.booking.findMany({
    where: {
      clientId: client.id,
      status: { notIn: ['CANCELLED', 'REFUNDED'] },
    },
    include: { event: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  if (bookings.length === 0) {
    await ctx.reply('📋 У вас поки немає активних бронювань.\n\nПерегляньте події: /book');
    return;
  }

  const lines = bookings.map((b) => {
    const emoji = STATUS_EMOJI[b.status] || '📝';
    return `${emoji} <b>${b.bookingNumber}</b>\n  🎪 ${b.event.title}\n  📅 ${formatDateFull(b.event.dateStart)}\n  💰 ${formatCurrency(b.totalPrice)}`;
  });

  try {
    await ctx.editMessageText(
      `📋 <b>Ваші бронювання:</b>\n\n${lines.join('\n\n')}`,
      { parse_mode: 'HTML' },
    );
  } catch {
    await ctx.reply(
      `📋 <b>Ваші бронювання:</b>\n\n${lines.join('\n\n')}`,
      { parse_mode: 'HTML' },
    );
  }
}
