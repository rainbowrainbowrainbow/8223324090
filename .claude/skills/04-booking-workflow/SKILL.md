# Skill: Booking Workflow (State Machine)

## Description
Defines the booking lifecycle as a finite state machine with explicit transitions, guards, side effects, and automation rules. This is the core business logic of the system.

## Activation
Use this skill when:
- Implementing booking status changes
- Adding new booking states or transitions
- Writing booking-related business logic
- Debugging booking flow issues
- Writing tests for booking scenarios

## State Machine Diagram

```
                    ┌──────────┐
                    │  DRAFT   │ (form started but not submitted)
                    └────┬─────┘
                         │ submit()
                         ▼
                    ┌──────────┐  timeout (30min)  ┌───────────┐
                    │   HOLD   │──────────────────▶│ CANCELLED │
                    └────┬─────┘                   └───────────┘
                         │ initiatePayment()             ▲
                         ▼                               │
                ┌─────────────────┐  cancel()            │
                │ PENDING_PAYMENT │──────────────────────┘
                └────────┬────────┘                      │
                         │ depositPaid()                 │
                         ▼                               │
                  ┌────────────┐  cancel()               │
                  │ CONFIRMED  │─────────────────────────┘
                  └─────┬──────┘                         │
                        │ fullPayment()                  │
                        ▼                                │
                    ┌────────┐  cancel()                 │
                    │  PAID  │───────────────────────────┘
                    └───┬────┘                  ┌─────────┐
                        │ eventCompleted()      │ NO_SHOW │
                        ▼                       └─────────┘
                  ┌───────────┐                      ▲
                  │ COMPLETED │                      │
                  └───────────┘               markNoShow()
                                            (from PAID)

    CANCELLED + refund() → REFUNDED
```

## Transition Table

| From | To | Action | Guards | Side Effects |
|------|----|--------|--------|--------------|
| - | DRAFT | createDraft() | - | Save to DB |
| DRAFT | HOLD | submit() | eventPublished, capacityAvailable, clientPhoneValid | Reserve capacity, set holdExpiresAt (+30min), generate booking number, notify client + manager, schedule hold expiry warning |
| DRAFT | CANCELLED | cancel() | - | Clean up |
| HOLD | PENDING_PAYMENT | initiatePayment() | holdNotExpired | Create payment intent, notify client payment pending |
| HOLD | CANCELLED | holdExpired() | holdExpiresAt < now() | Release capacity, notify client hold expired |
| HOLD | CANCELLED | cancel() | - | Release capacity, notify client + manager |
| PENDING_PAYMENT | CONFIRMED | depositPaid() | paymentVerified, amount >= depositAmount | Update payment record, set confirmedAt, notify client + manager, schedule reminders (24h, 3h) |
| PENDING_PAYMENT | CANCELLED | cancel() | - | Void payment, release capacity, notify |
| PENDING_PAYMENT | CANCELLED | paymentFailed() | - | Void payment, release capacity, notify client |
| CONFIRMED | PAID | fullPayment() | paymentVerified, totalPaid >= totalPrice | Update payment, set paidAt, notify client + manager payment received |
| CONFIRMED | CANCELLED | cancel() | - | Calculate refund, release capacity, cancel reminders, notify |
| PAID | COMPLETED | eventCompleted() | event.dateEnd < now() | Update client stats, schedule feedback request |
| PAID | CANCELLED | cancel() | - | Calculate refund, release capacity, cancel reminders, notify |
| PAID | NO_SHOW | markNoShow() | actorIsManager | Update client stats, notify manager |
| CANCELLED | REFUNDED | processRefund() | hasEligiblePayments | Initiate provider refund, notify client + manager |

## Implementation Pattern

```typescript
// src/services/booking-machine.ts

interface BookingTransition {
  from: BookingStatus[];
  to: BookingStatus;
  guards: Guard[];
  effects: Effect[];
}

const transitions: Record<string, BookingTransition> = {
  submit: {
    from: ['DRAFT'],
    to: 'HOLD',
    guards: [
      'eventIsPublished',
      'eventHasCapacity',
      'clientPhoneValid',
    ],
    effects: [
      'reserveCapacity',
      'setHoldExpiry',
      'generateBookingNumber',
      'notifyClientBookingCreated',
      'notifyManagerNewBooking',
      'scheduleHoldExpiryWarning',
    ],
  },

  depositPaid: {
    from: ['PENDING_PAYMENT'],
    to: 'CONFIRMED',
    guards: [
      'paymentVerified',
      'depositAmountMet',
    ],
    effects: [
      'updatePaymentRecord',
      'setConfirmedAt',
      'notifyClientConfirmed',
      'notifyManagerConfirmed',
      'scheduleReminder24h',
      'scheduleReminder3h',
    ],
  },

  initiatePayment: {
    from: ['HOLD'],
    to: 'PENDING_PAYMENT',
    guards: [
      'holdNotExpired',
    ],
    effects: [
      'createPaymentIntent',
      'notifyClientPaymentPending',
    ],
  },

  holdExpired: {
    from: ['HOLD'],
    to: 'CANCELLED',
    guards: [
      'holdIsExpired',
    ],
    effects: [
      'releaseCapacity',
      'setCancelledAt',
      'notifyClientHoldExpired',
    ],
  },

  paymentFailed: {
    from: ['PENDING_PAYMENT'],
    to: 'CANCELLED',
    guards: [],
    effects: [
      'voidPaymentIntent',
      'releaseCapacity',
      'setCancelledAt',
      'notifyClientPaymentFailed',
    ],
  },

  cancel: {
    from: ['DRAFT', 'HOLD', 'PENDING_PAYMENT', 'CONFIRMED', 'PAID'],
    to: 'CANCELLED',
    guards: [],
    effects: [
      'releaseCapacity',
      'calculateRefund',
      'setCancelledAt',
      'notifyClientCancelled',
      'notifyManagerCancelled',
      'cancelScheduledReminders',
    ],
  },

  fullPayment: {
    from: ['CONFIRMED'],
    to: 'PAID',
    guards: [
      'paymentVerified',
      'fullAmountMet',
    ],
    effects: [
      'updatePaymentRecord',
      'setPaidAt',
      'notifyClientPaymentComplete',
      'notifyManagerPaymentReceived',
    ],
  },

  eventCompleted: {
    from: ['PAID'],
    to: 'COMPLETED',
    guards: [
      'eventHasEnded',
    ],
    effects: [
      'updateClientStats',
      'scheduleFeedbackRequest',
    ],
  },

  markNoShow: {
    from: ['PAID'],
    to: 'NO_SHOW',
    guards: [
      'actorIsManager',
    ],
    effects: [
      'updateClientStats',
      'notifyManagerNoShow',
    ],
  },

  processRefund: {
    from: ['CANCELLED'],
    to: 'REFUNDED',
    guards: [
      'hasEligiblePayments',
    ],
    effects: [
      'initiateProviderRefund',
      'notifyClientRefunded',
      'notifyManagerRefunded',
    ],
  },
};

// Main transition executor
async function transitionBooking(
  bookingId: string,
  action: string,
  context: TransitionContext
): Promise<Booking> {
  const booking = await db.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { event: true, client: true, payments: true },
  });

  const transition = transitions[action];
  if (!transition) throw new Error(`Unknown action: ${action}`);
  if (!transition.from.includes(booking.status)) {
    throw new BookingError(
      'BOOKING_INVALID_TRANSITION',
      `Cannot ${action} from ${booking.status}`
    );
  }

  // Run guards
  for (const guard of transition.guards) {
    await runGuard(guard, booking, context);
  }

  // Update status in transaction
  const updated = await db.$transaction(async (tx) => {
    const result = await tx.booking.update({
      where: { id: bookingId },
      data: { status: transition.to, updatedAt: new Date() },
    });

    // Run effects inside transaction where needed
    for (const effect of transition.effects) {
      await runEffect(effect, result, context, tx);
    }

    return result;
  });

  // Run async effects (notifications, etc.)
  for (const effect of transition.effects) {
    await runAsyncEffect(effect, updated, context);
  }

  // Audit log
  await logTransition(bookingId, booking.status, transition.to, action, context);

  return updated;
}
```

## Guards Implementation

```typescript
const guards: Record<string, GuardFn> = {
  eventIsPublished: async (booking) => {
    if (booking.event.status !== 'PUBLISHED') {
      throw new BookingError('EVENT_NOT_PUBLISHED', 'Подію ще не опубліковано');
    }
  },

  eventHasCapacity: async (booking) => {
    const confirmedGuests = await db.booking.aggregate({
      where: {
        eventId: booking.eventId,
        status: { in: ['HOLD', 'CONFIRMED', 'PAID'] },
        id: { not: booking.id },
      },
      _sum: { guestsCount: true },
    });
    const used = confirmedGuests._sum.guestsCount || 0;
    if (used + booking.guestsCount > booking.event.capacityMax) {
      throw new BookingError(
        'BOOKING_CAPACITY_EXCEEDED',
        `Доступно місць: ${booking.event.capacityMax - used}`
      );
    }
  },

  holdNotExpired: async (booking) => {
    if (booking.holdExpiresAt && booking.holdExpiresAt < new Date()) {
      throw new BookingError('BOOKING_HOLD_EXPIRED', 'Час бронювання вичерпано');
    }
  },

  depositAmountMet: async (booking, context) => {
    if (context.paymentAmount < Number(booking.depositAmount)) {
      throw new BookingError(
        'PAYMENT_AMOUNT_MISMATCH',
        `Мінімальний депозит: ${booking.depositAmount} ₴`
      );
    }
  },
};
```

## Cron Jobs / Scheduled Tasks

```typescript
// Run every 5 minutes
async function expireHoldBookings() {
  const expired = await db.booking.findMany({
    where: {
      status: 'HOLD',
      holdExpiresAt: { lt: new Date() },
    },
  });

  for (const booking of expired) {
    await transitionBooking(booking.id, 'holdExpired', {
      actor: 'system',
      reason: 'Hold timer expired',
    });
  }
}

// Run every hour
async function completeFinishedEvents() {
  const finished = await db.booking.findMany({
    where: {
      status: 'PAID',
      event: { dateEnd: { lt: new Date() } },
    },
    include: { event: true },
  });

  for (const booking of finished) {
    await transitionBooking(booking.id, 'eventCompleted', {
      actor: 'system',
    });
  }
}
```

## Refund Calculation

```typescript
function calculateRefund(booking: Booking): { amount: Decimal; reason: string } {
  const hoursUntilEvent = differenceInHours(booking.event.dateStart, new Date());
  const totalPaid = booking.payments
    .filter(p => p.status === 'SUCCESS' && p.type !== 'REFUND')
    .reduce((sum, p) => sum.add(p.amount), new Decimal(0));

  if (hoursUntilEvent > 72) {
    // Full refund minus 5% fee
    const fee = totalPaid.mul(0.05);
    return { amount: totalPaid.sub(fee), reason: '>72h: повне повернення мінус 5% комісії' };
  } else if (hoursUntilEvent >= 24) {
    // 50% refund
    return { amount: totalPaid.mul(0.5), reason: '24-72h: 50% повернення' };
  } else {
    // No refund
    return { amount: new Decimal(0), reason: '<24h: повернення не передбачено' };
  }
}
```

## Testing Scenarios

Must-have test cases:
1. Happy path: DRAFT → HOLD → PENDING_PAYMENT → CONFIRMED → PAID → COMPLETED
2. Hold expiry: HOLD → CANCELLED (after 30 min)
3. Capacity overflow: Submit when event is full → error
4. Double booking: Same client, same event → error or warning
5. Cancel with refund: PAID → CANCELLED → REFUNDED (>72h)
6. Cancel no refund: PAID → CANCELLED (<24h, amount=0)
7. Payment failure: PENDING_PAYMENT → CANCELLED
8. No-show: PAID → NO_SHOW
9. Invalid transitions: COMPLETED → HOLD (should throw)
10. Concurrent bookings: Two clients grab last spot simultaneously
