import type { FastifyInstance } from 'fastify';
import { db } from '../../db/client.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  createEventSchema,
  updateEventSchema,
  eventStatusSchema,
  eventFilterQuery,
  uuidParam,
} from '../../types/schemas.js';
import { API_ERROR_CODE } from '../../types/enums.js';
import { AppError } from '../../utils/errors.js';
import { paginate, buildPaginationMeta } from '../../utils/format.js';

export async function adminEventRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', authorize('ADMIN', 'MANAGER'));

  // GET /api/v1/admin/events
  app.get(
    '/',
    { preHandler: [validate({ query: eventFilterQuery })] },
    async (request, reply) => {
      const query = request.query as {
        page: number;
        perPage: number;
        sort?: string;
        order?: 'asc' | 'desc';
        status?: string;
        search?: string;
      };

      const where: Record<string, unknown> = { deletedAt: null };

      // MANAGER sees only their events, ADMIN sees all
      if (request.manager.role === 'MANAGER') {
        where.managerId = request.manager.sub;
      }

      if (query.status) {
        where.status = { in: query.status.split(',') };
      }
      if (query.search) {
        where.OR = [
          { title: { contains: query.search, mode: 'insensitive' } },
          { location: { contains: query.search, mode: 'insensitive' } },
        ];
      }

      const [data, total] = await Promise.all([
        db.event.findMany({
          where,
          include: {
            manager: { select: { id: true, name: true } },
            _count: { select: { bookings: true } },
          },
          ...paginate(query.page, query.perPage),
          orderBy: { [query.sort || 'dateStart']: query.order || 'desc' },
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

  // POST /api/v1/admin/events
  app.post(
    '/',
    { preHandler: [validate({ body: createEventSchema })] },
    async (request, reply) => {
      const input = request.body as Record<string, unknown>;

      const event = await db.event.create({
        data: {
          ...(input as any),
          managerId: request.manager.sub,
          dateStart: new Date(input.dateStart as string),
          dateEnd: new Date(input.dateEnd as string),
        },
      });

      await db.auditLog.create({
        data: {
          entityType: 'event',
          entityId: event.id,
          action: 'event.create',
          changes: input as object,
          actorType: 'manager',
          actorId: request.manager.sub,
          ipAddress: request.ip,
        },
      });

      return reply.status(201).send({ success: true, data: event });
    },
  );

  // GET /api/v1/admin/events/:id
  app.get(
    '/:id',
    { preHandler: [validate({ params: uuidParam })] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const event = await db.event.findUnique({
        where: { id },
        include: {
          manager: { select: { id: true, name: true, email: true } },
          bookings: {
            include: { client: true },
            orderBy: { createdAt: 'desc' },
            take: 50,
          },
        },
      });

      if (!event || event.deletedAt) {
        throw AppError.notFound(API_ERROR_CODE.EVENT_NOT_FOUND, 'Подію не знайдено');
      }

      return reply.send({ success: true, data: event });
    },
  );

  // PUT /api/v1/admin/events/:id
  app.put(
    '/:id',
    { preHandler: [validate({ params: uuidParam, body: updateEventSchema })] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const input = request.body as Record<string, unknown>;

      const existing = await db.event.findUnique({ where: { id } });
      if (!existing || existing.deletedAt) {
        throw AppError.notFound(API_ERROR_CODE.EVENT_NOT_FOUND, 'Подію не знайдено');
      }

      const updates: Record<string, unknown> = { ...input };
      if (input.dateStart) updates.dateStart = new Date(input.dateStart as string);
      if (input.dateEnd) updates.dateEnd = new Date(input.dateEnd as string);

      const event = await db.event.update({ where: { id }, data: updates as any });

      await db.auditLog.create({
        data: {
          entityType: 'event',
          entityId: id,
          action: 'event.update',
          changes: input as object,
          actorType: 'manager',
          actorId: request.manager.sub,
          ipAddress: request.ip,
        },
      });

      return reply.send({ success: true, data: event });
    },
  );

  // PATCH /api/v1/admin/events/:id/status
  app.patch(
    '/:id/status',
    { preHandler: [validate({ params: uuidParam, body: eventStatusSchema })] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { status } = request.body as { status: string };

      const existing = await db.event.findUnique({ where: { id } });
      if (!existing || existing.deletedAt) {
        throw AppError.notFound(API_ERROR_CODE.EVENT_NOT_FOUND, 'Подію не знайдено');
      }

      const event = await db.event.update({
        where: { id },
        data: { status: status as any },
      });

      await db.auditLog.create({
        data: {
          entityType: 'event',
          entityId: id,
          action: 'event.status_change',
          changes: { from: existing.status, to: status },
          actorType: 'manager',
          actorId: request.manager.sub,
          ipAddress: request.ip,
        },
      });

      return reply.send({ success: true, data: event });
    },
  );

  // DELETE /api/v1/admin/events/:id (soft delete)
  app.delete(
    '/:id',
    { preHandler: [validate({ params: uuidParam }), authorize('ADMIN')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const event = await db.event.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      await db.auditLog.create({
        data: {
          entityType: 'event',
          entityId: id,
          action: 'event.delete',
          actorType: 'manager',
          actorId: request.manager.sub,
          ipAddress: request.ip,
        },
      });

      return reply.send({ success: true, data: { id: event.id } });
    },
  );
}
