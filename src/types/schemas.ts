import { z } from 'zod';

// ── Common ──────────────────────────────────────────────────────────

export const uuidParam = z.object({
  id: z.string().uuid(),
});

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().max(200).optional(),
});

// ── Auth ────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().email('Невірний формат email'),
  password: z.string().min(1, 'Пароль обов\'язковий'),
});

// ── Events ──────────────────────────────────────────────────────────

export const createEventSchema = z.object({
  title: z.string().min(2).max(200),
  slug: z.string().min(2).max(200).regex(/^[a-z0-9-]+$/),
  description: z.string().max(5000).optional(),
  type: z.enum(['BIRTHDAY', 'CORPORATE', 'WEDDING', 'HOLIDAY', 'CUSTOM']),
  dateStart: z.string().datetime(),
  dateEnd: z.string().datetime(),
  location: z.string().min(2).max(500),
  locationLat: z.number().optional(),
  locationLng: z.number().optional(),
  capacityMin: z.number().int().min(1),
  capacityMax: z.number().int().min(1),
  pricePerPerson: z.number().positive(),
  basePrice: z.number().positive(),
  depositPercent: z.number().int().min(0).max(100).default(30),
  images: z.array(z.string().url()).optional(),
  tags: z.array(z.string()).optional(),
});

export const updateEventSchema = createEventSchema.partial();

export const eventStatusSchema = z.object({
  status: z.enum(['DRAFT', 'PUBLISHED', 'SOLD_OUT', 'ARCHIVED', 'CANCELLED']),
});

export const eventFilterQuery = paginationQuery.extend({
  status: z.string().optional(),
  type: z.string().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
});

// ── Bookings ────────────────────────────────────────────────────────

export const createBookingSchema = z.object({
  eventId: z.string().uuid(),
  fullName: z.string().min(2).max(100),
  phone: z.string().regex(/^\+380\d{9}$/, 'Невірний формат телефону'),
  email: z.string().email().optional(),
  guestsCount: z.number().int().min(1).max(200),
  specialRequests: z.string().max(1000).optional(),
  promoCode: z.string().max(50).optional(),
});

export const bookingFilterQuery = paginationQuery.extend({
  status: z.string().optional(),
  eventId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
});

export const cancelBookingSchema = z.object({
  reason: z.string().max(1000).optional(),
});

// ── Clients ─────────────────────────────────────────────────────────

export const updateClientSchema = z.object({
  fullName: z.string().min(2).max(100).optional(),
  phone: z.string().regex(/^\+380\d{9}$/).optional(),
  email: z.string().email().optional().nullable(),
  telegramUsername: z.string().optional().nullable(),
  source: z.enum(['WEBSITE', 'TELEGRAM', 'PHONE', 'REFERRAL', 'INSTAGRAM']).optional(),
  notes: z.string().max(5000).optional().nullable(),
});

export const clientFilterQuery = paginationQuery.extend({
  source: z.string().optional(),
});

// ── Payments ────────────────────────────────────────────────────────

export const initiatePaymentSchema = z.object({
  bookingId: z.string().uuid(),
  type: z.enum(['DEPOSIT', 'FULL', 'PARTIAL']),
  method: z.enum(['CARD', 'CASH', 'TRANSFER', 'LIQPAY']),
  amount: z.number().positive().optional(),
});

// ── Managers ────────────────────────────────────────────────────────

export const createManagerSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  phone: z.string().regex(/^\+380\d{9}$/),
  telegramChatId: z.string().optional(),
  role: z.enum(['ADMIN', 'MANAGER', 'VIEWER']).default('MANAGER'),
  password: z
    .string()
    .min(8, 'Мінімум 8 символів')
    .regex(/[A-Z]/, 'Потрібна велика літера')
    .regex(/[0-9]/, 'Потрібна цифра')
    .regex(/[^A-Za-z0-9]/, 'Потрібен спеціальний символ'),
});

export const updateManagerSchema = createManagerSchema.partial().omit({ password: true });

// ── Promo Codes ─────────────────────────────────────────────────────

export const createPromoSchema = z.object({
  code: z.string().min(3).max(50).toUpperCase(),
  discountPercent: z.number().int().min(1).max(100),
  maxUses: z.number().int().positive().optional(),
  validFrom: z.string().datetime(),
  validUntil: z.string().datetime(),
});
