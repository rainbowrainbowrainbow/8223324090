import type { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import type { JwtPayload, ManagerRoleType } from '../types/index.js';
import { AppError } from '../utils/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    manager: JwtPayload;
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    throw AppError.unauthorized('Токен не надано');
  }

  const token = header.slice(7);

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    request.manager = payload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError(401, 'AUTH_TOKEN_EXPIRED', 'Токен прострочено');
    }
    throw AppError.unauthorized('Невалідний токен');
  }
}

export function authorize(...roles: ManagerRoleType[]) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    if (!request.manager) {
      throw AppError.unauthorized();
    }

    if (roles.length > 0 && !roles.includes(request.manager.role as ManagerRoleType)) {
      throw AppError.forbidden(
        `Потрібна роль: ${roles.join(' або ')}`,
      );
    }
  };
}
