import { db } from '../../db/client.js';
import { API_ERROR_CODE } from '../../types/enums.js';
import { AppError } from '../../utils/errors.js';
import { verifyLiqPaySignature, decodeLiqPayData, buildPaymentUrl } from './liqpay.js';
import { transitionBooking } from '../booking/state-machine.js';

export { buildPaymentUrl } from './liqpay.js';

interface InitiatePaymentInput {
  bookingId: string;
  type: 'DEPOSIT' | 'FULL' | 'PARTIAL';
  method: 'CARD' | 'CASH' | 'TRANSFER' | 'LIQPAY';
  amount?: number;
}

export async function initiatePayment(input: InitiatePaymentInput) {
  const booking = await db.booking.findUnique({
    where: { id: input.bookingId },
    include: { event: true, client: true },
  });

  if (!booking) {
    throw AppError.notFound(API_ERROR_CODE.BOOKING_NOT_FOUND, 'Бронювання не знайдено');
  }

  const amount =
    input.amount ||
    (input.type === 'DEPOSIT' ? Number(booking.depositAmount) : Number(booking.totalPrice));

  // Create payment record
  const payment = await db.payment.create({
    data: {
      bookingId: booking.id,
      amount,
      type: input.type,
      method: input.method,
      status: 'PENDING',
    },
  });

  // Transition booking to PENDING_PAYMENT
  if (booking.status === 'HOLD') {
    await transitionBooking(booking.id, 'initiatePayment', {
      actor: 'client',
      actorId: booking.clientId,
    });
  }

  // For LiqPay, generate checkout URL
  let paymentUrl: string | null = null;
  if (input.method === 'LIQPAY') {
    const description = `Бронювання ${booking.bookingNumber} — ${booking.event.title}`;
    paymentUrl = buildPaymentUrl(booking.id, amount, description);
  }

  return { payment, paymentUrl };
}

export async function handleLiqPayWebhook(data: string, signature: string) {
  // 1. Verify signature
  if (!verifyLiqPaySignature(data, signature)) {
    throw AppError.badRequest(API_ERROR_CODE.PAYMENT_SIGNATURE_INVALID, 'Невірний підпис');
  }

  // 2. Decode payload
  const payload = decodeLiqPayData(data) as {
    order_id: string;
    status: string;
    amount: number;
    transaction_id: number;
    payment_id: number;
  };

  const bookingId = payload.order_id;

  // 3. Find pending payment
  const payment = await db.payment.findFirst({
    where: {
      bookingId,
      status: 'PENDING',
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!payment) {
    console.warn(`[LiqPay] No pending payment found for booking ${bookingId}`);
    return;
  }

  // 4. Process by status
  if (['success', 'sandbox'].includes(payload.status)) {
    await db.payment.update({
      where: { id: payment.id },
      data: {
        status: 'SUCCESS',
        providerTransactionId: String(payload.transaction_id),
      },
    });

    // Transition booking based on payment type
    const booking = await db.booking.findUnique({ where: { id: bookingId } });
    if (!booking) return;

    if (booking.status === 'PENDING_PAYMENT') {
      await transitionBooking(bookingId, 'depositPaid', {
        actor: 'system',
        paymentAmount: payload.amount,
      });
    } else if (booking.status === 'CONFIRMED') {
      await transitionBooking(bookingId, 'fullPayment', {
        actor: 'system',
        paymentAmount: payload.amount,
      });
    }
  } else if (['failure', 'error'].includes(payload.status)) {
    await db.payment.update({
      where: { id: payment.id },
      data: {
        status: 'FAILED',
        providerTransactionId: String(payload.transaction_id),
      },
    });

    const booking = await db.booking.findUnique({ where: { id: bookingId } });
    if (booking?.status === 'PENDING_PAYMENT') {
      await transitionBooking(bookingId, 'paymentFailed', { actor: 'system' });
    }
  }
}

export async function listPayments(bookingId: string) {
  return db.payment.findMany({
    where: { bookingId },
    orderBy: { createdAt: 'desc' },
  });
}
