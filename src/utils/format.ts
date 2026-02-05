import { Decimal } from '@prisma/client/runtime/library';

export function formatCurrency(amount: Decimal | number | string): string {
  const num = typeof amount === 'number' ? amount : Number(amount);
  return new Intl.NumberFormat('uk-UA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(num) + ' ₴';
}

export function generateBookingNumber(): string {
  const year = new Date().getFullYear();
  const seq = Math.floor(Math.random() * 9999) + 1;
  return `BK-${year}-${String(seq).padStart(4, '0')}`;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

export function paginate(page: number, perPage: number) {
  const skip = (page - 1) * perPage;
  return { skip, take: perPage };
}

export function buildPaginationMeta(total: number, page: number, perPage: number) {
  return {
    page,
    perPage,
    total,
    totalPages: Math.ceil(total / perPage),
  };
}
