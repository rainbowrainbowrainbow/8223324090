import { db } from '../../db/client.js';
import { API_ERROR_CODE } from '../../types/enums.js';
import type { PaginationMeta } from '../../types/index.js';
import { AppError } from '../../utils/errors.js';
import { paginate, buildPaginationMeta } from '../../utils/format.js';
import { normalizePhone } from '../../utils/phone.js';

interface ListClientsOpts {
  page: number;
  perPage: number;
  sort?: string;
  order?: 'asc' | 'desc';
  search?: string;
  source?: string;
}

export async function listClients(opts: ListClientsOpts) {
  const where: Record<string, unknown> = {
    deletedAt: null,
  };

  if (opts.source) {
    where.source = opts.source;
  }

  if (opts.search) {
    where.OR = [
      { fullName: { contains: opts.search, mode: 'insensitive' } },
      { phone: { contains: opts.search } },
      { email: { contains: opts.search, mode: 'insensitive' } },
    ];
  }

  const [data, total] = await Promise.all([
    db.client.findMany({
      where,
      ...paginate(opts.page, opts.perPage),
      orderBy: { [opts.sort || 'createdAt']: opts.order || 'desc' },
    }),
    db.client.count({ where }),
  ]);

  return {
    data,
    meta: buildPaginationMeta(total, opts.page, opts.perPage),
  };
}

export async function getClientById(id: string) {
  const client = await db.client.findUnique({
    where: { id },
    include: {
      bookings: {
        include: { event: true, payments: true },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!client || client.deletedAt) {
    throw AppError.notFound(API_ERROR_CODE.BOOKING_NOT_FOUND, 'Клієнта не знайдено');
  }

  return client;
}

export async function updateClient(
  id: string,
  data: {
    fullName?: string;
    phone?: string;
    email?: string | null;
    telegramUsername?: string | null;
    source?: 'WEBSITE' | 'TELEGRAM' | 'PHONE' | 'REFERRAL' | 'INSTAGRAM';
    notes?: string | null;
  },
) {
  const client = await db.client.findUnique({ where: { id } });
  if (!client || client.deletedAt) {
    throw AppError.notFound(API_ERROR_CODE.BOOKING_NOT_FOUND, 'Клієнта не знайдено');
  }

  if (data.phone) {
    data.phone = normalizePhone(data.phone);
  }

  return db.client.update({
    where: { id },
    data,
  });
}

export async function softDeleteClient(id: string) {
  const client = await db.client.findUnique({ where: { id } });
  if (!client) {
    throw AppError.notFound(API_ERROR_CODE.BOOKING_NOT_FOUND, 'Клієнта не знайдено');
  }

  return db.client.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

export async function findOrCreateClient(data: {
  fullName: string;
  phone: string;
  email?: string;
  telegramChatId?: string;
  telegramUsername?: string;
  source?: 'WEBSITE' | 'TELEGRAM' | 'PHONE' | 'REFERRAL' | 'INSTAGRAM';
}) {
  const phone = normalizePhone(data.phone);

  let client = await db.client.findUnique({ where: { phone } });

  if (client) {
    // Update telegram info if newly provided
    const updates: Record<string, string> = {};
    if (data.telegramChatId && !client.telegramChatId) {
      updates.telegramChatId = data.telegramChatId;
    }
    if (data.telegramUsername && !client.telegramUsername) {
      updates.telegramUsername = data.telegramUsername;
    }
    if (Object.keys(updates).length > 0) {
      client = await db.client.update({ where: { id: client.id }, data: updates });
    }
    return client;
  }

  return db.client.create({
    data: {
      fullName: data.fullName,
      phone,
      email: data.email,
      telegramChatId: data.telegramChatId,
      telegramUsername: data.telegramUsername,
      source: data.source || 'WEBSITE',
    },
  });
}
