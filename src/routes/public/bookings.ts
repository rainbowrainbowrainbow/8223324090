import type { FastifyInstance } from 'fastify';
import { validate } from '../../middleware/validate.js';
import { createBookingSchema, cancelBookingSchema, uuidParam } from '../../types/schemas.js';
import { createBooking, getBookingById, getBookingByNumber } from '../../services/booking/index.js';
import { initiatePayment } from '../../services/payment/index.js';
import { transitionBooking } from '../../services/booking/state-machine.js';
import { initiatePaymentSchema } from '../../types/schemas.js';

export async function publicBookingRoutes(app: FastifyInstance) {
  // POST /api/v1/bookings — create booking
  app.post(
    '/',
    { preHandler: [validate({ body: createBookingSchema })] },
    async (request, reply) => {
      const input = request.body as {
        eventId: string;
        fullName: string;
        phone: string;
        email?: string;
        guestsCount: number;
        specialRequests?: string;
        promoCode?: string;
      };

      const booking = await createBooking(input);

      return reply.status(201).send({
        success: true,
        data: booking,
      });
    },
  );

  // GET /api/v1/bookings/:id — get booking details
  app.get(
    '/:id',
    { preHandler: [validate({ params: uuidParam })] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const booking = await getBookingById(id);

      return reply.send({
        success: true,
        data: booking,
      });
    },
  );

  // GET /api/v1/bookings/by-number/:number — get by booking number
  app.get('/by-number/:number', async (request, reply) => {
    const { number } = request.params as { number: string };
    const booking = await getBookingByNumber(number);

    return reply.send({
      success: true,
      data: booking,
    });
  });

  // POST /api/v1/bookings/:id/cancel — cancel booking
  app.post(
    '/:id/cancel',
    { preHandler: [validate({ params: uuidParam, body: cancelBookingSchema })] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { reason } = (request.body as { reason?: string }) || {};

      const booking = await transitionBooking(id, 'cancel', {
        actor: 'client',
        reason,
      });

      return reply.send({
        success: true,
        data: booking,
      });
    },
  );

  // POST /api/v1/payments/initiate — start payment
  app.post(
    '/payments/initiate',
    { preHandler: [validate({ body: initiatePaymentSchema })] },
    async (request, reply) => {
      const input = request.body as {
        bookingId: string;
        type: 'DEPOSIT' | 'FULL' | 'PARTIAL';
        method: 'CARD' | 'CASH' | 'TRANSFER' | 'LIQPAY';
        amount?: number;
      };

      const result = await initiatePayment(input);

      return reply.send({
        success: true,
        data: result,
      });
    },
  );

  // POST /api/v1/payments/webhook/liqpay — LiqPay callback
  app.post('/payments/webhook/liqpay', async (request, reply) => {
    const { data, signature } = request.body as { data: string; signature: string };

    const { handleLiqPayWebhook } = await import('../../services/payment/index.js');
    await handleLiqPayWebhook(data, signature);

    return reply.send({ ok: true });
  });
}
