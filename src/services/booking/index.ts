import { Decimal } from '@prisma/client/runtime/library';
import { db } from '../../db/client.js';
import { env } from '../../config/env.js';
import { API_ERROR_CODE } from '../../types/enums.js';
import type { BookingWithRelations, PaginationMeta } from '../../types/index.js';
import { AppError } from '../../utils/errors.js';
import { normalizePhone } from '../../utils/phone.js';
import { generateBookingNumber, paginate, buildPaginationMeta } from '../../utils/format.js';
import { addMinutes } from '../../utils/dates.js';
import { transitionBooking } from './state-machine.js';

export { transitionBooking } from './state-machine.js';

interface CreateBookingInput {
  eventId: string;
  fullName: string;
  phone: string;
  email?: string;
  guestsCount: number;
  specialRequests?: string;
  promoCode?: string;
}

export async function createBooking(input: CreateBookingInput): Promise<BookingWithRelations> {
  const phone = normalizePhone(input.phone);

  // Find or create client
  let client = await db.client.findUnique({ where: { phone } });
  if (!client) {
    client = await db.client.create({
      data: {
        fullName: input.fullName,
        phone,
        email: input.email,
        source: 'WEBSITE',
      },
    });
  }

  // Load event
  const event = await db.event.findUnique({ where: { id: input.eventId } });
  if (!event) {
    throw AppError.notFound(API_ERROR_CODE.EVENT_NOT_FOUND, 'Подію не знайдено');
  }
  if (event.status !== 'PUBLISHED') {
    throw AppError.badRequest(API_ERROR_CODE.EVENT_NOT_PUBLISHED, 'Подія не опублікована');
  }

  // Calculate pricing
  let discountPercent = 0;
  if (input.promoCode) {
    const promo = await db.promoCode.findUnique({ where: { code: input.promoCode.toUpperCase() } });
    if (
      !promo ||
      !promo.isActive ||
      promo.validFrom > new Date() ||
      promo.validUntil < new Date() ||
      (promo.maxUses && promo.currentUses >= promo.maxUses)
    ) {
      throw AppError.badRequest(API_ERROR_CODE.PROMO_CODE_INVALID, 'Промокод недійсний');
    }
    discountPercent = promo.discountPercent;

    await db.promoCode.update({
      where: { id: promo.id },
      data: { currentUses: { increment: 1 } },
    });
  }

  const baseTotal = event.pricePerPerson.mul(input.guestsCount).add(event.basePrice);
  const discount = discountPercent > 0 ? baseTotal.mul(discountPercent).div(100) : new Decimal(0);
  const totalPrice = baseTotal.sub(discount);
  const depositAmount = totalPrice.mul(event.depositPercent).div(100);

  // Create booking in DRAFT status
  const booking = await db.booking.create({
    data: {
      bookingNumber: generateBookingNumber(),
      eventId: event.id,
      clientId: client.id,
      guestsCount: input.guestsCount,
      totalPrice,
      depositAmount,
      status: 'DRAFT',
      specialRequests: input.specialRequests,
      promoCode: input.promoCode?.toUpperCase(),
      discountPercent: discountPercent > 0 ? discountPercent : null,
    },
    include: { event: true, client: true, payments: true },
  });

  // Immediately transition to HOLD
  const holdBooking = await transitionBooking(booking.id, 'submit', {
    actor: 'client',
    actorId: client.id,
  });

  return holdBooking;
}

export async function getBookingById(id: string): Promise<BookingWithRelations> {
  const booking = await db.booking.findUnique({
    where: { id },
    include: { event: true, client: true, payments: true },
  });

  if (!booking) {
    throw AppError.notFound(API_ERROR_CODE.BOOKING_NOT_FOUND, 'Бронювання не знайдено');
  }

  return booking as BookingWithRelations;
}

export async function getBookingByNumber(bookingNumber: string): Promise<BookingWithRelations> {
  const booking = await db.booking.findUnique({
    where: { bookingNumber },
    include: { event: true, client: true, payments: true },
  });

  if (!booking) {
    throw AppError.notFound(API_ERROR_CODE.BOOKING_NOT_FOUND, 'Бронювання не знайдено');
  }

  return booking as BookingWithRelations;
}

interface ListBookingsOpts {
  page: number;
  perPage: number;
  sort?: string;
  order?: 'asc' | 'desc';
  status?: string;
  eventId?: string;
  clientId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

export async function listBookings(
  opts: ListBookingsOpts,
): Promise<{ data: BookingWithRelations[]; meta: PaginationMeta }> {
  const where: Record<string, unknown> = {};

  if (opts.status) {
    where.status = { in: opts.status.split(',') };
  }
  if (opts.eventId) {
    where.eventId = opts.eventId;
  }
  if (opts.clientId) {
    where.clientId = opts.clientId;
  }
  if (opts.dateFrom || opts.dateTo) {
    where.createdAt = {};
    if (opts.dateFrom) (where.createdAt as Record<string, unknown>).gte = new Date(opts.dateFrom);
    if (opts.dateTo) (where.createdAt as Record<string, unknown>).lte = new Date(opts.dateTo);
  }
  if (opts.search) {
    where.OR = [
      { bookingNumber: { contains: opts.search, mode: 'insensitive' } },
      { client: { fullName: { contains: opts.search, mode: 'insensitive' } } },
      { client: { phone: { contains: opts.search } } },
    ];
  }

  const [data, total] = await Promise.all([
    db.booking.findMany({
      where,
      include: { event: true, client: true, payments: true },
      ...paginate(opts.page, opts.perPage),
      orderBy: { [opts.sort || 'createdAt']: opts.order || 'desc' },
    }),
    db.booking.count({ where }),
  ]);

  return {
    data: data as BookingWithRelations[],
    meta: buildPaginationMeta(total, opts.page, opts.perPage),
  };
}

// ── Cron Jobs ───────────────────────────────────────────────────────

export async function expireHoldBookings(): Promise<number> {
  const expired = await db.booking.findMany({
    where: {
      status: 'HOLD',
      holdExpiresAt: { lte: new Date() },
    },
    select: { id: true },
  });

  let count = 0;
  for (const { id } of expired) {
    try {
      await transitionBooking(id, 'holdExpired', { actor: 'system' });
      count++;
    } catch (err) {
      console.error(`[Cron] Failed to expire booking ${id}:`, err);
    }
  }

  if (count > 0) {
    console.log(`[Cron] Expired ${count} hold bookings`);
  }
  return count;
}

export async function completeFinishedEvents(): Promise<number> {
  const finishedBookings = await db.booking.findMany({
    where: {
      status: { in: ['CONFIRMED', 'PAID'] },
      event: { dateEnd: { lte: new Date() } },
    },
    select: { id: true },
  });

  let count = 0;
  for (const { id } of finishedBookings) {
    try {
      await transitionBooking(id, 'eventCompleted', { actor: 'system' });
      count++;
    } catch (err) {
      console.error(`[Cron] Failed to complete booking ${id}:`, err);
    }
  }

  if (count > 0) {
    console.log(`[Cron] Completed ${count} bookings for finished events`);
  }
  return count;
}
