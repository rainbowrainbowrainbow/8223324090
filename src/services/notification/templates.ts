import type { TemplateContext } from '../../types/index.js';
import { formatCurrency } from '../../utils/format.js';
import { toKyivDateTime, formatDateFull } from '../../utils/dates.js';
import { formatPhone } from '../../utils/phone.js';
import { STATUS_EMOJI } from '../../types/enums.js';

interface TemplateDefinition {
  telegram?: { text: string; parseMode?: 'HTML' | 'MarkdownV2' };
  email?: { subject: string; text: string };
}

type TemplateRenderer = (ctx: TemplateContext) => TemplateDefinition;

const templates: Record<string, TemplateRenderer> = {
  booking_created: (ctx) => {
    const b = ctx.booking!;
    return {
      telegram: {
        text: [
          `🎉 <b>Бронювання створено!</b>`,
          ``,
          `📋 Номер: <b>${b.bookingNumber}</b>`,
          `🎪 Подія: ${b.event.title}`,
          `📅 Дата: ${formatDateFull(b.event.dateStart)}`,
          `👥 Гостей: ${b.guestsCount}`,
          `💰 Сума: ${formatCurrency(b.totalPrice)}`,
          `💳 Депозит: ${formatCurrency(b.depositAmount)}`,
          ``,
          `⏱ Бронь утримується 30 хвилин.`,
        ].join('\n'),
        parseMode: 'HTML',
      },
      email: {
        subject: `Бронювання ${b.bookingNumber} створено`,
        text: `Ваше бронювання ${b.bookingNumber} на "${b.event.title}" створено. Сума: ${formatCurrency(b.totalPrice)}. Оплатіть депозит протягом 30 хвилин.`,
      },
    };
  },

  hold_expiring: (ctx) => {
    const b = ctx.booking!;
    return {
      telegram: {
        text: [
          `⏰ <b>Увага! Бронь закінчується!</b>`,
          ``,
          `📋 ${b.bookingNumber} — ${b.event.title}`,
          `⏱ Залишилось 5 хвилин для оплати депозиту.`,
        ].join('\n'),
        parseMode: 'HTML',
      },
    };
  },

  booking_confirmed: (ctx) => {
    const b = ctx.booking!;
    return {
      telegram: {
        text: [
          `✅ <b>Бронювання підтверджено!</b>`,
          ``,
          `📋 ${b.bookingNumber}`,
          `🎪 ${b.event.title}`,
          `📅 ${formatDateFull(b.event.dateStart)}`,
          `📍 ${b.event.location}`,
          `👥 Гостей: ${b.guestsCount}`,
          ``,
          `Дякуємо за оплату депозиту! Чекаємо на вас.`,
        ].join('\n'),
        parseMode: 'HTML',
      },
      email: {
        subject: `Бронювання ${b.bookingNumber} підтверджено`,
        text: `Ваше бронювання ${b.bookingNumber} підтверджено. Подія "${b.event.title}" відбудеться ${formatDateFull(b.event.dateStart)}.`,
      },
    };
  },

  booking_cancelled: (ctx) => {
    const b = ctx.booking!;
    return {
      telegram: {
        text: [
          `❌ <b>Бронювання скасовано</b>`,
          ``,
          `📋 ${b.bookingNumber} — ${b.event.title}`,
          ctx.custom?.reason ? `📝 Причина: ${ctx.custom.reason}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        parseMode: 'HTML',
      },
    };
  },

  reminder_24h: (ctx) => {
    const b = ctx.booking!;
    return {
      telegram: {
        text: [
          `🔔 <b>Нагадування: завтра ваша подія!</b>`,
          ``,
          `🎪 ${b.event.title}`,
          `📅 ${formatDateFull(b.event.dateStart)}`,
          `📍 ${b.event.location}`,
          `👥 Гостей: ${b.guestsCount}`,
        ].join('\n'),
        parseMode: 'HTML',
      },
    };
  },

  reminder_3h: (ctx) => {
    const b = ctx.booking!;
    return {
      telegram: {
        text: [
          `🔔 <b>Подія через 3 години!</b>`,
          ``,
          `🎪 ${b.event.title}`,
          `📍 ${b.event.location}`,
          `👥 Гостей: ${b.guestsCount}`,
        ].join('\n'),
        parseMode: 'HTML',
      },
    };
  },

  // Manager templates
  mgr_new_booking: (ctx) => {
    const b = ctx.booking!;
    return {
      telegram: {
        text: [
          `📥 <b>Нове бронювання!</b>`,
          ``,
          `📋 ${b.bookingNumber}`,
          `👤 ${b.client.fullName} (${formatPhone(b.client.phone)})`,
          `🎪 ${b.event.title}`,
          `👥 Гостей: ${b.guestsCount}`,
          `💰 ${formatCurrency(b.totalPrice)}`,
        ].join('\n'),
        parseMode: 'HTML',
      },
    };
  },

  mgr_booking_confirmed: (ctx) => {
    const b = ctx.booking!;
    return {
      telegram: {
        text: [
          `✅ <b>Депозит оплачено</b>`,
          ``,
          `📋 ${b.bookingNumber}`,
          `👤 ${b.client.fullName}`,
          `💳 Депозит: ${formatCurrency(b.depositAmount)}`,
        ].join('\n'),
        parseMode: 'HTML',
      },
    };
  },

  mgr_payment_received: (ctx) => {
    const b = ctx.booking!;
    const p = ctx.payment!;
    return {
      telegram: {
        text: [
          `💚 <b>Оплата отримана</b>`,
          ``,
          `📋 ${b.bookingNumber}`,
          `👤 ${b.client.fullName}`,
          `💰 ${formatCurrency(p.amount)}`,
        ].join('\n'),
        parseMode: 'HTML',
      },
    };
  },

  mgr_daily_summary: (ctx) => {
    const data = ctx.custom as {
      todayBookings: number;
      todayRevenue: number;
      upcomingEvents: number;
    };
    return {
      telegram: {
        text: [
          `📊 <b>Щоденний звіт</b>`,
          ``,
          `📅 Бронювань сьогодні: ${data.todayBookings}`,
          `💰 Дохід: ${formatCurrency(data.todayRevenue)}`,
          `🎪 Найближчих подій: ${data.upcomingEvents}`,
        ].join('\n'),
        parseMode: 'HTML',
      },
    };
  },

  mgr_capacity_alert: (ctx) => {
    const e = ctx.event!;
    const pct = ctx.custom?.percentage || 80;
    return {
      telegram: {
        text: [
          `⚠️ <b>Заповненість ${pct}%</b>`,
          ``,
          `🎪 ${e.title}`,
          `📅 ${formatDateFull(e.dateStart)}`,
          `Скоро подія буде повністю заповнена!`,
        ].join('\n'),
        parseMode: 'HTML',
      },
    };
  },
};

export function renderTemplate(
  templateId: string,
  context: TemplateContext,
): TemplateDefinition | null {
  const renderer = templates[templateId];
  if (!renderer) {
    console.warn(`[Notification] Unknown template: ${templateId}`);
    return null;
  }
  return renderer(context);
}
