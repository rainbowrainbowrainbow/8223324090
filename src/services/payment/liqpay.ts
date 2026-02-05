import crypto from 'node:crypto';
import { env } from '../../config/env.js';

interface LiqPayParams {
  action: 'pay' | 'hold' | 'subscribe' | 'paydonate';
  amount: number;
  currency: string;
  description: string;
  order_id: string;
  result_url?: string;
  server_url?: string;
  sandbox?: number;
}

export function createLiqPayData(params: LiqPayParams): {
  data: string;
  signature: string;
} {
  const publicKey = env.LIQPAY_PUBLIC_KEY;
  const privateKey = env.LIQPAY_PRIVATE_KEY;

  if (!publicKey || !privateKey) {
    throw new Error('LiqPay keys not configured');
  }

  const payload = {
    version: 3,
    public_key: publicKey,
    ...params,
    sandbox: env.LIQPAY_SANDBOX ? 1 : 0,
  };

  const data = Buffer.from(JSON.stringify(payload)).toString('base64');
  const signature = generateSignature(data, privateKey);

  return { data, signature };
}

export function verifyLiqPaySignature(data: string, signature: string): boolean {
  const privateKey = env.LIQPAY_PRIVATE_KEY;
  if (!privateKey) return false;

  const expected = generateSignature(data, privateKey);

  // Use timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function decodeLiqPayData(data: string): Record<string, unknown> {
  const decoded = Buffer.from(data, 'base64').toString('utf-8');
  return JSON.parse(decoded);
}

function generateSignature(data: string, privateKey: string): string {
  return crypto
    .createHash('sha1')
    .update(privateKey + data + privateKey)
    .digest('base64');
}

export function buildPaymentUrl(bookingId: string, amount: number, description: string): string {
  const { data, signature } = createLiqPayData({
    action: 'pay',
    amount,
    currency: 'UAH',
    description,
    order_id: bookingId,
    server_url: `${env.BASE_URL}/api/v1/payments/webhook/liqpay`,
    result_url: `${env.BASE_URL}/booking/${bookingId}/status`,
  });

  return `https://www.liqpay.ua/api/3/checkout?data=${data}&signature=${signature}`;
}
