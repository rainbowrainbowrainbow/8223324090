import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { db } from '../../db/client.js';
import { env } from '../../config/env.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { createManagerSchema, updateManagerSchema, uuidParam, paginationQuery } from '../../types/schemas.js';
import { AppError } from '../../utils/errors.js';
import { API_ERROR_CODE } from '../../types/enums.js';
import { paginate, buildPaginationMeta } from '../../utils/format.js';

export async function adminManagerRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', authorize('ADMIN'));

  // GET /api/v1/admin/managers
  app.get(
    '/',
    { preHandler: [validate({ query: paginationQuery })] },
    async (request, reply) => {
      const query = request.query as {
        page: number;
        perPage: number;
        sort?: string;
        order?: 'asc' | 'desc';
        search?: string;
      };

      const where: Record<string, unknown> = {};
      if (query.search) {
        where.OR = [
          { name: { contains: query.search, mode: 'insensitive' } },
          { email: { contains: query.search, mode: 'insensitive' } },
        ];
      }

      const [data, total] = await Promise.all([
        db.manager.findMany({
          where,
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            telegramChatId: true,
            role: true,
            isActive: true,
            createdAt: true,
          },
          ...paginate(query.page, query.perPage),
          orderBy: { [query.sort || 'createdAt']: query.order || 'desc' },
        }),
        db.manager.count({ where }),
      ]);

      return reply.send({
        success: true,
        data,
        meta: buildPaginationMeta(total, query.page, query.perPage),
      });
    },
  );

  // POST /api/v1/admin/managers
  app.post(
    '/',
    { preHandler: [validate({ body: createManagerSchema })] },
    async (request, reply) => {
      const input = request.body as {
        name: string;
        email: string;
        phone: string;
        telegramChatId?: string;
        role: string;
        password: string;
      };

      const existing = await db.manager.findUnique({ where: { email: input.email } });
      if (existing) {
        throw AppError.badRequest(API_ERROR_CODE.VALIDATION_FAILED, 'Email вже зайнятий');
      }

      const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_SALT_ROUNDS);

      const manager = await db.manager.create({
        data: {
          name: input.name,
          email: input.email,
          phone: input.phone,
          telegramChatId: input.telegramChatId,
          role: input.role as any,
          passwordHash,
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      });

      await db.auditLog.create({
        data: {
          entityType: 'manager',
          entityId: manager.id,
          action: 'manager.create',
          changes: { name: input.name, email: input.email, role: input.role },
          actorType: 'manager',
          actorId: request.manager.sub,
          ipAddress: request.ip,
        },
      });

      return reply.status(201).send({ success: true, data: manager });
    },
  );

  // PUT /api/v1/admin/managers/:id
  app.put(
    '/:id',
    { preHandler: [validate({ params: uuidParam, body: updateManagerSchema })] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const input = request.body as Record<string, unknown>;

      const existing = await db.manager.findUnique({ where: { id } });
      if (!existing) {
        throw AppError.notFound(API_ERROR_CODE.BOOKING_NOT_FOUND, 'Менеджера не знайдено');
      }

      const manager = await db.manager.update({
        where: { id },
        data: input as any,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          isActive: true,
        },
      });

      await db.auditLog.create({
        data: {
          entityType: 'manager',
          entityId: id,
          action: 'manager.update',
          changes: input as object,
          actorType: 'manager',
          actorId: request.manager.sub,
          ipAddress: request.ip,
        },
      });

      return reply.send({ success: true, data: manager });
    },
  );

  // DELETE /api/v1/admin/managers/:id (deactivate)
  app.delete(
    '/:id',
    { preHandler: [validate({ params: uuidParam })] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      if (id === request.manager.sub) {
        throw AppError.badRequest(
          API_ERROR_CODE.VALIDATION_FAILED,
          'Не можна деактивувати свій акаунт',
        );
      }

      await db.manager.update({
        where: { id },
        data: { isActive: false },
      });

      await db.auditLog.create({
        data: {
          entityType: 'manager',
          entityId: id,
          action: 'manager.deactivate',
          actorType: 'manager',
          actorId: request.manager.sub,
          ipAddress: request.ip,
        },
      });

      return reply.send({ success: true, data: { id } });
    },
  );
}
