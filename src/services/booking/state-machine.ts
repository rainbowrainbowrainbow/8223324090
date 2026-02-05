import { Decimal } from '@prisma/client/runtime/library';
import { db } from '../../db/client.js';
import { env } from '../../config/env.js';
import type { BookingTransition, TransitionContext, BookingWithRelations } from '../../types/index.js';
import { API_ERROR_CODE, BOOKING_STATUS } from '../../types/enums.js';
import { AppError } from '../../utils/errors.js';
import { addMinutes, differenceInHours } from '../../utils/dates.js';
import { generateBookingNumber } from '../../utils/format.js';

// ── Transition Definitions ──────────────────────────────────────────

const transitions: Record<string, BookingTransition> = {
  submit: {
    from: [BOOKING_STATUS.DRAFT],
    to: BOOKING_STATUS.HOLD,
    guards: ['eventIsPublished', 'eventHasCapacity', 'clientPhoneValid'],
    effects: [
      'reserveCapacity',
      'setHoldExpiry',
      'generateBookingNumber',
      'notifyClientBookingCreated',
      'notifyManagerNewBooking',
    ],
  },

  initiatePayment: {
    from: [BOOKING_STATUS.HOLD],
    to: BOOKING_STATUS.PENDING_PAYMENT,
    guards: ['holdNotExpired'],
    effects: ['createPaymentRecord', 'notifyClientPaymentPending'],
  },

  holdExpired: {
    from: [BOOKING_STATUS.HOLD],
    to: BOOKING_STATUS.CANCELLED,
    guards: [],
    effects: [
      'releaseCapacity',
      'setCancelledAt',
      'notifyClientHoldExpired',
      'notifyManagerHoldExpired',
    ],
  },

  depositPaid: {
    from: [BOOKING_STATUS.PENDING_PAYMENT],
    to: BOOKING_STATUS.CONFIRMED,
    guards: ['paymentVerified', 'depositAmountMet'],
    effects: [
      'updatePaymentRecord',
      'setConfirmedAt',
      'notifyClientConfirmed',
      'notifyManagerConfirmed',
    ],
  },

  paymentFailed: {
    from: [BOOKING_STATUS.PENDING_PAYMENT],
    to: BOOKING_STATUS.HOLD,
    guards: [],
    effects: ['markPaymentFailed', 'resetHoldExpiry', 'notifyClientPaymentFailed'],
  },

  fullPayment: {
    from: [BOOKING_STATUS.CONFIRMED],
    to: BOOKING_STATUS.PAID,
    guards: ['paymentVerified', 'fullAmountMet'],
    effects: [
      'updatePaymentRecord',
      'setPaidAt',
      'notifyClientFullyPaid',
      'notifyManagerPaymentReceived',
    ],
  },

  eventCompleted: {
    from: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.PAID],
    to: BOOKING_STATUS.COMPLETED,
    guards: ['eventDatePassed'],
    effects: ['updateClientStats', 'notifyClientCompleted'],
  },

  markNoShow: {
    from: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.PAID],
    to: BOOKING_STATUS.NO_SHOW,
    guards: ['actorIsManager'],
    effects: ['notifyManagerNoShow'],
  },

  cancel: {
    from: [
      BOOKING_STATUS.DRAFT,
      BOOKING_STATUS.HOLD,
      BOOKING_STATUS.PENDING_PAYMENT,
      BOOKING_STATUS.CONFIRMED,
      BOOKING_STATUS.PAID,
    ],
    to: BOOKING_STATUS.CANCELLED,
    guards: [],
    effects: [
      'releaseCapacity',
      'calculateRefund',
      'setCancelledAt',
      'notifyClientCancelled',
      'notifyManagerCancelled',
    ],
  },

  processRefund: {
    from: [BOOKING_STATUS.CANCELLED],
    to: BOOKING_STATUS.REFUNDED,
    guards: ['hasRefundablePayments'],
    effects: ['createRefundPayment', 'notifyClientRefunded'],
  },
};

// ── Guards ───────────────────────────────────────────────────────────

type Guard = (booking: BookingWithRelations, ctx: TransitionContext) => Promise<void>;

const guards: Record<string, Guard> = {
  async eventIsPublished(booking) {
    if (booking.event.status !== 'PUBLISHED') {
      throw AppError.badRequest(API_ERROR_CODE.EVENT_NOT_PUBLISHED, 'Подія не опублікована');
    }
  },

  async eventHasCapacity(booking) {
    const bookedGuests = await db.booking.aggregate({
      where: {
        eventId: booking.eventId,
        status: { in: ['HOLD', 'PENDING_PAYMENT', 'CONFIRMED', 'PAID'] },
        id: { not: booking.id },
      },
      _sum: { guestsCount: true },
    });

    const currentGuests = bookedGuests._sum.guestsCount || 0;
    if (currentGuests + booking.guestsCount > booking.event.capacityMax) {
      throw AppError.badRequest(API_ERROR_CODE.BOOKING_CAPACITY_EXCEEDED, 'Недостатньо місць');
    }
  },

  async clientPhoneValid(booking) {
    if (!/^\+380\d{9}$/.test(booking.client.phone)) {
      throw AppError.badRequest(API_ERROR_CODE.INVALID_PHONE_FORMAT, 'Невірний формат телефону');
    }
  },

  async holdNotExpired(booking) {
    if (booking.holdExpiresAt && booking.holdExpiresAt < new Date()) {
      throw AppError.badRequest(API_ERROR_CODE.BOOKING_HOLD_EXPIRED, 'Час утримання закінчився');
    }
  },

  async paymentVerified(_booking, _ctx) {
    // Verified via LiqPay webhook signature — always passes when called from webhook handler
  },

  async depositAmountMet(booking) {
    const totalPaid = await getTotalPaid(booking.id);
    if (totalPaid.lessThan(booking.depositAmount)) {
      throw AppError.badRequest(API_ERROR_CODE.PAYMENT_FAILED, 'Депозит не оплачено повністю');
    }
  },

  async fullAmountMet(booking) {
    const totalPaid = await getTotalPaid(booking.id);
    if (totalPaid.lessThan(booking.totalPrice)) {
      throw AppError.badRequest(API_ERROR_CODE.PAYMENT_FAILED, 'Повна сума не оплачена');
    }
  },

  async eventDatePassed(booking) {
    if (booking.event.dateEnd > new Date()) {
      throw AppError.badRequest(
        API_ERROR_CODE.BOOKING_INVALID_TRANSITION,
        'Подія ще не завершилася',
      );
    }
  },

  async actorIsManager(_booking, ctx) {
    if (ctx.actor !== 'manager') {
      throw AppError.forbidden('Тільки менеджер може виконати цю дію');
    }
  },

  async hasRefundablePayments(booking) {
    const totalPaid = await getTotalPaid(booking.id);
    if (totalPaid.isZero()) {
      throw AppError.badRequest(API_ERROR_CODE.PAYMENT_FAILED, 'Немає оплат для повернення');
    }
  },
};

// ── Main Transition Function ────────────────────────────────────────

export async function transitionBooking(
  bookingId: string,
  action: string,
  context: TransitionContext,
): Promise<BookingWithRelations> {
  const transition = transitions[action];
  if (!transition) {
    throw AppError.badRequest(
      API_ERROR_CODE.BOOKING_INVALID_TRANSITION,
      `Невідома дія: ${action}`,
    );
  }

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { event: true, client: true, payments: true },
  });

  if (!booking) {
    throw AppError.notFound(API_ERROR_CODE.BOOKING_NOT_FOUND, 'Бронювання не знайдено');
  }

  if (!transition.from.includes(booking.status)) {
    throw AppError.badRequest(
      API_ERROR_CODE.BOOKING_INVALID_TRANSITION,
      `Не можна виконати "${action}" зі статусу ${booking.status}`,
    );
  }

  // Run guards
  for (const guardName of transition.guards) {
    const guard = guards[guardName];
    if (guard) {
      await guard(booking as BookingWithRelations, context);
    }
  }

  // Build update data
  const updateData: Record<string, unknown> = {
    status: transition.to,
  };

  // Apply synchronous effects
  if (transition.effects.includes('setHoldExpiry')) {
    updateData.holdExpiresAt = addMinutes(new Date(), env.HOLD_DURATION_MINUTES);
  }
  if (transition.effects.includes('generateBookingNumber') && !booking.bookingNumber) {
    updateData.bookingNumber = generateBookingNumber();
  }
  if (transition.effects.includes('setConfirmedAt')) {
    updateData.confirmedAt = new Date();
  }
  if (transition.effects.includes('setPaidAt')) {
    updateData.paidAt = new Date();
  }
  if (transition.effects.includes('setCancelledAt')) {
    updateData.cancelledAt = new Date();
    updateData.cancellationReason = context.reason || null;
  }
  if (transition.effects.includes('resetHoldExpiry')) {
    updateData.holdExpiresAt = addMinutes(new Date(), env.HOLD_DURATION_MINUTES);
  }

  // Update booking in transaction
  const updated = await db.$transaction(async (tx) => {
    const result = await tx.booking.update({
      where: { id: bookingId },
      data: updateData,
      include: { event: true, client: true, payments: true },
    });

    // Audit log
    await tx.auditLog.create({
      data: {
        entityType: 'booking',
        entityId: bookingId,
        action: `booking.${action}`,
        changes: { from: booking.status, to: transition.to },
        actorType: context.actor,
        actorId: context.actorId || 'system',
      },
    });

    return result;
  });

  // Async effects (notifications) — fire and forget
  runAsyncEffects(transition.effects, updated as BookingWithRelations, context).catch((err) => {
    console.error(`[StateMachine] Async effect error for ${action}:`, err);
  });

  return updated as BookingWithRelations;
}

// ── Helpers ──────────────────────────────────────────────────────────

async function getTotalPaid(bookingId: string): Promise<Decimal> {
  const result = await db.payment.aggregate({
    where: {
      bookingId,
      status: 'SUCCESS',
      type: { not: 'REFUND' },
    },
    _sum: { amount: true },
  });
  return result._sum.amount || new Decimal(0);
}

export function calculateRefund(booking: BookingWithRelations): {
  amount: Decimal;
  reason: string;
} {
  const hoursUntilEvent = differenceInHours(booking.event.dateStart, new Date());
  const totalPaid = booking.payments
    .filter((p) => p.status === 'SUCCESS' && p.type !== 'REFUND')
    .reduce((sum, p) => sum.add(p.amount), new Decimal(0));

  if (hoursUntilEvent > 72)
    return { amount: totalPaid.mul(0.95), reason: '>72h: 95% повернення' };
  if (hoursUntilEvent >= 24)
    return { amount: totalPaid.mul(0.5), reason: '24-72h: 50% повернення' };
  return { amount: new Decimal(0), reason: '<24h: без повернення' };
}

async function runAsyncEffects(
  effects: string[],
  booking: BookingWithRelations,
  _context: TransitionContext,
): Promise<void> {
  // Notification effects will be dispatched here
  // For now, log which notifications should be sent
  const notificationEffects = effects.filter((e) => e.startsWith('notify'));
  for (const effect of notificationEffects) {
    console.log(`[StateMachine] TODO: dispatch notification "${effect}" for booking ${booking.id}`);
  }
}
