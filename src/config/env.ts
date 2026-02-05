import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),

  // Database
  DATABASE_URL: z.string().url(),

  // Auth
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('8h'),
  BCRYPT_SALT_ROUNDS: z.coerce.number().default(12),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_URL: z.string().url().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  TELEGRAM_DEFAULT_CHAT_ID: z.string().optional(),

  // LiqPay
  LIQPAY_PUBLIC_KEY: z.string().optional(),
  LIQPAY_PRIVATE_KEY: z.string().optional(),
  LIQPAY_SANDBOX: z.coerce.boolean().default(true),

  // Redis (for BullMQ)
  REDIS_URL: z.string().url().optional(),

  // Rate limiting
  RATE_LIMIT_PUBLIC: z.coerce.number().default(100),
  RATE_LIMIT_AUTH: z.coerce.number().default(5),
  RATE_LIMIT_BOOKING: z.coerce.number().default(10),

  // App
  BASE_URL: z.string().url().optional(),
  HOLD_DURATION_MINUTES: z.coerce.number().default(30),
  DEFAULT_DEPOSIT_PERCENT: z.coerce.number().default(30),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    console.error(`❌ Invalid environment variables:\n${formatted}`);
    process.exit(1);
  }

  return result.data;
}

export const env = loadEnv();
