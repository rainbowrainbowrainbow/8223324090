import { describe, it, expect } from 'vitest';
import { formatCurrency, generateBookingNumber, slugify, truncate, paginate, buildPaginationMeta } from '../format.js';

describe('formatCurrency', () => {
  it('formats integer amount', () => {
    const result = formatCurrency(1500);
    expect(result).toContain('1');
    expect(result).toContain('500');
    expect(result).toContain('₴');
  });

  it('formats decimal amount', () => {
    const result = formatCurrency(1234.56);
    expect(result).toContain('₴');
  });

  it('formats zero', () => {
    expect(formatCurrency(0)).toContain('0');
    expect(formatCurrency(0)).toContain('₴');
  });
});

describe('generateBookingNumber', () => {
  it('starts with BK-', () => {
    const number = generateBookingNumber();
    expect(number).toMatch(/^BK-\d{4}-\d{4}$/);
  });

  it('uses current year', () => {
    const number = generateBookingNumber();
    const year = new Date().getFullYear();
    expect(number).toContain(`BK-${year}-`);
  });

  it('generates unique numbers', () => {
    const numbers = new Set(Array.from({ length: 100 }, () => generateBookingNumber()));
    // With 9999 possible numbers, 100 should mostly be unique
    expect(numbers.size).toBeGreaterThan(80);
  });
});

describe('slugify', () => {
  it('converts to lowercase kebab-case', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('removes special characters', () => {
    expect(slugify('Hello, World!')).toBe('hello-world');
  });

  it('collapses multiple hyphens', () => {
    expect(slugify('a - - b')).toBe('a-b');
  });
});

describe('truncate', () => {
  it('keeps short strings', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates long strings with ellipsis', () => {
    expect(truncate('hello world foo bar', 10)).toBe('hello w...');
  });

  it('handles exact length', () => {
    expect(truncate('12345', 5)).toBe('12345');
  });
});

describe('paginate', () => {
  it('calculates skip for page 1', () => {
    expect(paginate(1, 20)).toEqual({ skip: 0, take: 20 });
  });

  it('calculates skip for page 3', () => {
    expect(paginate(3, 10)).toEqual({ skip: 20, take: 10 });
  });
});

describe('buildPaginationMeta', () => {
  it('calculates total pages', () => {
    const meta = buildPaginationMeta(100, 1, 20);
    expect(meta).toEqual({
      page: 1,
      perPage: 20,
      total: 100,
      totalPages: 5,
    });
  });

  it('rounds up partial pages', () => {
    const meta = buildPaginationMeta(21, 1, 20);
    expect(meta.totalPages).toBe(2);
  });

  it('handles zero total', () => {
    const meta = buildPaginationMeta(0, 1, 20);
    expect(meta.totalPages).toBe(0);
  });
});
