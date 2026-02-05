import type { FastifyInstance } from 'fastify';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { bookingFilterQuery, uuidParam } from '../../types/schemas.js';
import { listBookings, getBookingById } from '../../services/booking/index.js';
import { transitionBooking } from '../../services/booking/state-machine.js';

export async function adminBookingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', authorize('ADMIN', 'MANAGER'));

  // GET /api/v1/admin/bookings
  app.get(
    '/',
    { preHandler: [validate({ query: bookingFilterQuery })] },
    async (request, reply) => {
      const query = request.query as {
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
      };

      const result = await listBookings(query);

      return reply.send({
        success: true,
        data: result.data,
        meta: result.meta,
      });
    },
  );

  // GET /api/v1/admin/bookings/:id
  app.get(
    '/:id',
    { preHandler: [validate({ params: uuidParam })] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const booking = await getBookingById(id);

      return reply.send({ success: true, data: booking });
    },
  );

  // POST /api/v1/admin/bookings/:id/cancel
  app.post(
    '/:id/cancel',
    { preHandler: [validate({ params: uuidParam })] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { reason } = (request.body as { reason?: string }) || {};

      const booking = await transitionBooking(id, 'cancel', {
        actor: 'manager',
        actorId: request.manager.sub,
        reason,
      });

      return reply.send({ success: true, data: booking });
    },
  );

  // POST /api/v1/admin/bookings/:id/no-show
  app.post(
    '/:id/no-show',
    { preHandler: [validate({ params: uuidParam })] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const booking = await transitionBooking(id, 'markNoShow', {
        actor: 'manager',
        actorId: request.manager.sub,
      });

      return reply.send({ success: true, data: booking });
    },
  );

  // POST /api/v1/admin/bookings/:id/refund
  app.post(
    '/:id/refund',
    { preHandler: [validate({ params: uuidParam }), authorize('ADMIN')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const booking = await transitionBooking(id, 'processRefund', {
        actor: 'manager',
        actorId: request.manager.sub,
      });

      return reply.send({ success: true, data: booking });
    },
  );
}
