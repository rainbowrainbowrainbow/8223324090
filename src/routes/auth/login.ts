import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import { loginSchema } from '../../types/schemas.js';
import { API_ERROR_CODE } from '../../types/enums.js';
import { AppError } from '../../utils/errors.js';

export async function authRoutes(app: FastifyInstance) {
  // POST /api/v1/auth/login
  app.post(
    '/login',
    { preHandler: [validate({ body: loginSchema })] },
    async (request, reply) => {
      const { email, password } = request.body as { email: string; password: string };

      const manager = await db.manager.findUnique({ where: { email } });

      if (!manager || !manager.isActive) {
        throw AppError.unauthorized('Невірний email або пароль');
      }

      const passwordValid = await bcrypt.compare(password, manager.passwordHash);
      if (!passwordValid) {
        // Audit: failed login
        await db.auditLog.create({
          data: {
            entityType: 'manager',
            entityId: manager.id,
            action: 'auth.login_failed',
            actorType: 'manager',
            actorId: manager.id,
            ipAddress: request.ip,
          },
        });

        throw AppError.unauthorized('Невірний email або пароль');
      }

      const token = jwt.sign(
        { sub: manager.id, role: manager.role },
        env.JWT_SECRET,
        { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions,
      );

      // Audit: successful login
      await db.auditLog.create({
        data: {
          entityType: 'manager',
          entityId: manager.id,
          action: 'auth.login',
          actorType: 'manager',
          actorId: manager.id,
          ipAddress: request.ip,
        },
      });

      return reply.send({
        success: true,
        data: {
          token,
          manager: {
            id: manager.id,
            name: manager.name,
            email: manager.email,
            role: manager.role,
          },
        },
      });
    },
  );

  // GET /api/v1/auth/me
  app.get('/me', { preHandler: [authenticate] }, async (request, reply) => {
    const manager = await db.manager.findUnique({
      where: { id: request.manager.sub },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        telegramChatId: true,
        isActive: true,
      },
    });

    if (!manager || !manager.isActive) {
      throw AppError.unauthorized('Менеджера не знайдено');
    }

    return reply.send({ success: true, data: manager });
  });
}
