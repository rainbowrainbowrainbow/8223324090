import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { env } from './config/env.js';
import { db } from './db/client.js';
import { errorHandler } from './middleware/error-handler.js';
import { publicEventRoutes } from './routes/public/events.js';
import { publicBookingRoutes } from './routes/public/bookings.js';
import { authRoutes } from './routes/auth/login.js';
import { adminEventRoutes } from './routes/admin/events.js';
import { adminBookingRoutes } from './routes/admin/bookings.js';
import { adminClientRoutes } from './routes/admin/clients.js';
import { adminManagerRoutes } from './routes/admin/managers.js';
import { adminDashboardRoutes } from './routes/admin/dashboard.js';
import { createBot } from './telegram/bot.js';
import { expireHoldBookings, completeFinishedEvents } from './services/booking/index.js';
import { processScheduledNotifications } from './services/notification/index.js';

async function main() {
  // ── Fastify Setup ───────────────────────────────────────────────
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
  });

  // Security headers
  await app.register(helmet, {
    contentSecurityPolicy: env.NODE_ENV === 'production',
  });

  // CORS
  await app.register(cors, {
    origin: env.NODE_ENV === 'production'
      ? [env.BASE_URL || 'https://localhost'].filter(Boolean)
      : true,
    credentials: true,
  });

  // Rate limiting
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_PUBLIC,
    timeWindow: '1 minute',
  });

  // Error handler
  app.setErrorHandler(errorHandler);

  // ── Health Check ────────────────────────────────────────────────
  let dbConnected = false;

  app.get('/health', async () => {
    return {
      status: dbConnected ? 'ok' : 'degraded',
      db: dbConnected ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    };
  });

  // Root route — basic API info
  app.get('/', async () => {
    return {
      name: 'Park Booking System API',
      version: '0.1.0',
      health: '/health',
      api: '/api/v1',
    };
  });

  // ── API Routes ──────────────────────────────────────────────────

  // Public
  await app.register(publicEventRoutes, { prefix: '/api/v1/events' });
  await app.register(publicBookingRoutes, { prefix: '/api/v1/bookings' });

  // Auth
  await app.register(authRoutes, { prefix: '/api/v1/auth' });

  // Admin
  await app.register(adminEventRoutes, { prefix: '/api/v1/admin/events' });
  await app.register(adminBookingRoutes, { prefix: '/api/v1/admin/bookings' });
  await app.register(adminClientRoutes, { prefix: '/api/v1/admin/clients' });
  await app.register(adminManagerRoutes, { prefix: '/api/v1/admin/managers' });
  await app.register(adminDashboardRoutes, { prefix: '/api/v1/admin/dashboard' });

  // ── Telegram Bot ────────────────────────────────────────────────
  let bot: ReturnType<typeof createBot> | null = null;
  try {
    bot = createBot();

    // Webhook endpoint
    app.post('/api/telegram/webhook', async (request, reply) => {
      const secret = request.headers['x-telegram-bot-api-secret-token'] as string;
      if (env.TELEGRAM_WEBHOOK_SECRET && secret !== env.TELEGRAM_WEBHOOK_SECRET) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      await bot!.handleUpdate(request.body as any);
      return reply.send({ ok: true });
    });
  } catch (err) {
    app.log.warn(err, 'Telegram bot initialization failed');
  }

  // ── Cron Jobs ───────────────────────────────────────────────────
  // Hold expiry check — every 1 minute
  const holdExpiryInterval = setInterval(async () => {
    if (!dbConnected) return;
    try {
      await expireHoldBookings();
    } catch (err) {
      app.log.error(err, 'Hold expiry cron failed');
    }
  }, 60_000);

  // Event completion — every 30 minutes
  const completionInterval = setInterval(async () => {
    if (!dbConnected) return;
    try {
      await completeFinishedEvents();
    } catch (err) {
      app.log.error(err, 'Event completion cron failed');
    }
  }, 30 * 60_000);

  // Notification processing — every 30 seconds
  const notificationInterval = setInterval(async () => {
    if (!dbConnected) return;
    try {
      await processScheduledNotifications();
    } catch (err) {
      app.log.error(err, 'Notification cron failed');
    }
  }, 30_000);

  // ── Graceful Shutdown ───────────────────────────────────────────
  const shutdown = async () => {
    app.log.info('Shutting down...');
    clearInterval(holdExpiryInterval);
    clearInterval(completionInterval);
    clearInterval(notificationInterval);
    await app.close();
    await db.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // ── Start Server ────────────────────────────────────────────────
  // Connect to DB (non-fatal if fails)
  try {
    await db.$connect();
    dbConnected = true;
    app.log.info('Database connected');
  } catch (err) {
    app.log.warn(err, 'Database connection failed — server will start without DB');
  }

  // Set Telegram webhook if configured
  try {
    if (bot && env.TELEGRAM_WEBHOOK_URL) {
      await bot.api.setWebhook(env.TELEGRAM_WEBHOOK_URL, {
        secret_token: env.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ['message', 'callback_query', 'my_chat_member'],
      });
      app.log.info(`Telegram webhook set: ${env.TELEGRAM_WEBHOOK_URL}`);
    }
  } catch (err) {
    app.log.warn(err, 'Telegram webhook setup failed');
  }

  // Start HTTP server (must succeed)
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(`Server listening on ${env.HOST}:${env.PORT}`);
  } catch (err) {
    app.log.error(err, 'Failed to start server');
    process.exit(1);
  }
}

main();
