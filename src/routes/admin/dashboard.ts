import type { FastifyInstance } from 'fastify';
import { db } from '../../db/client.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { startOfDay, endOfDay } from '../../utils/dates.js';

export async function adminDashboardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', authorize('ADMIN', 'MANAGER'));

  // GET /api/v1/admin/dashboard
  app.get('/', async (request, reply) => {
    const today = new Date();
    const todayStart = startOfDay(today);
    const todayEnd = endOfDay(today);

    const managerFilter =
      request.manager.role === 'MANAGER' ? { event: { managerId: request.manager.sub } } : {};

    const [
      totalBookings,
      todayBookings,
      pendingBookings,
      confirmedBookings,
      totalRevenue,
      todayRevenue,
      upcomingEvents,
      totalClients,
    ] = await Promise.all([
      db.booking.count({ where: managerFilter }),
      db.booking.count({
        where: {
          ...managerFilter,
          createdAt: { gte: todayStart, lte: todayEnd },
        },
      }),
      db.booking.count({
        where: {
          ...managerFilter,
          status: { in: ['HOLD', 'PENDING_PAYMENT'] },
        },
      }),
      db.booking.count({
        where: {
          ...managerFilter,
          status: { in: ['CONFIRMED', 'PAID'] },
        },
      }),
      db.payment.aggregate({
        where: {
          status: 'SUCCESS',
          booking: managerFilter,
        },
        _sum: { amount: true },
      }),
      db.payment.aggregate({
        where: {
          status: 'SUCCESS',
          createdAt: { gte: todayStart, lte: todayEnd },
          booking: managerFilter,
        },
        _sum: { amount: true },
      }),
      db.event.count({
        where: {
          status: 'PUBLISHED',
          dateStart: { gte: today },
          deletedAt: null,
          ...(request.manager.role === 'MANAGER'
            ? { managerId: request.manager.sub }
            : {}),
        },
      }),
      db.client.count({ where: { deletedAt: null } }),
    ]);

    // Recent bookings
    const recentBookings = await db.booking.findMany({
      where: managerFilter,
      include: {
        event: { select: { title: true } },
        client: { select: { fullName: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return reply.send({
      success: true,
      data: {
        stats: {
          totalBookings,
          todayBookings,
          pendingBookings,
          confirmedBookings,
          totalRevenue: Number(totalRevenue._sum.amount || 0),
          todayRevenue: Number(todayRevenue._sum.amount || 0),
          upcomingEvents,
          totalClients,
        },
        recentBookings,
      },
    });
  });
}
