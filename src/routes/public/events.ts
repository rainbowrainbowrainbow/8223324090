import type { FastifyInstance } from 'fastify';
import { db } from '../../db/client.js';
import { validate } from '../../middleware/validate.js';
import { eventFilterQuery, uuidParam } from '../../types/schemas.js';
import { API_ERROR_CODE } from '../../types/enums.js';
import { AppError } from '../../utils/errors.js';
import { paginate, buildPaginationMeta } from '../../utils/format.js';

export async function publicEventRoutes(app: FastifyInstance) {
  // GET /api/v1/events — list published events
  app.get(
    '/',
    { preHandler: [validate({ query: eventFilterQuery })] },
    async (request, reply) => {
      const query = request.query as {
        page: number;
        perPage: number;
        sort?: string;
        order?: 'asc' | 'desc';
        type?: string;
        dateFrom?: string;
        dateTo?: string;
        search?: string;
      };

      const where: Record<string, unknown> = {
        status: 'PUBLISHED',
        deletedAt: null,
        dateStart: { gte: new Date() },
      };

      if (query.type) {
        where.type = query.type;
      }
      if (query.dateFrom || query.dateTo) {
        where.dateStart = {
          ...(where.dateStart as object),
          ...(query.dateFrom && { gte: new Date(query.dateFrom) }),
          ...(query.dateTo && { lte: new Date(query.dateTo) }),
        };
      }
      if (query.search) {
        where.OR = [
          { title: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
          { location: { contains: query.search, mode: 'insensitive' } },
        ];
      }

      const [data, total] = await Promise.all([
        db.event.findMany({
          where,
          select: {
            id: true,
            title: true,
            slug: true,
            description: true,
            type: true,
            dateStart: true,
            dateEnd: true,
            location: true,
            capacityMax: true,
            pricePerPerson: true,
            basePrice: true,
            depositPercent: true,
            status: true,
            images: true,
            tags: true,
          },
          ...paginate(query.page, query.perPage),
          orderBy: { [query.sort || 'dateStart']: query.order || 'asc' },
        }),
        db.event.count({ where }),
      ]);

      return reply.send({
        success: true,
        data,
        meta: buildPaginationMeta(total, query.page, query.perPage),
      });
    },
  );

  // GET /api/v1/events/:slug — get event by slug
  app.get('/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };

    const event = await db.event.findFirst({
      where: { slug, deletedAt: null },
      include: {
        _count: {
          select: {
            bookings: {
              where: { status: { in: ['HOLD', 'PENDING_PAYMENT', 'CONFIRMED', 'PAID'] } },
            },
          },
        },
      },
    });

    if (!event) {
      throw AppError.notFound(API_ERROR_CODE.EVENT_NOT_FOUND, 'Подію не знайдено');
    }

    // Calculate available spots
    const bookedGuests = await db.booking.aggregate({
      where: {
        eventId: event.id,
        status: { in: ['HOLD', 'PENDING_PAYMENT', 'CONFIRMED', 'PAID'] },
      },
      _sum: { guestsCount: true },
    });

    const availableSpots = event.capacityMax - (bookedGuests._sum.guestsCount || 0);

    return reply.send({
      success: true,
      data: {
        ...event,
        availableSpots: Math.max(0, availableSpots),
      },
    });
  });
}
