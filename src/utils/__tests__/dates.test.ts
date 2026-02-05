import { describe, it, expect } from 'vitest';
import {
  addMinutes,
  addHours,
  differenceInHours,
  differenceInMinutes,
  isExpired,
  startOfDay,
  endOfDay,
} from '../dates.js';

describe('addMinutes', () => {
  it('adds 30 minutes', () => {
    const date = new Date('2025-01-01T12:00:00Z');
    const result = addMinutes(date, 30);
    expect(result.toISOString()).toBe('2025-01-01T12:30:00.000Z');
  });

  it('handles crossing midnight', () => {
    const date = new Date('2025-01-01T23:45:00Z');
    const result = addMinutes(date, 30);
    expect(result.getUTCDate()).toBe(2);
  });
});

describe('addHours', () => {
  it('adds 3 hours', () => {
    const date = new Date('2025-01-01T12:00:00Z');
    const result = addHours(date, 3);
    expect(result.toISOString()).toBe('2025-01-01T15:00:00.000Z');
  });
});

describe('differenceInHours', () => {
  it('calculates positive difference', () => {
    const a = new Date('2025-01-02T12:00:00Z');
    const b = new Date('2025-01-01T12:00:00Z');
    expect(differenceInHours(a, b)).toBe(24);
  });

  it('returns negative for past date', () => {
    const a = new Date('2025-01-01T12:00:00Z');
    const b = new Date('2025-01-02T12:00:00Z');
    expect(differenceInHours(a, b)).toBe(-24);
  });
});

describe('differenceInMinutes', () => {
  it('calculates 90 minutes', () => {
    const a = new Date('2025-01-01T13:30:00Z');
    const b = new Date('2025-01-01T12:00:00Z');
    expect(differenceInMinutes(a, b)).toBe(90);
  });
});

describe('isExpired', () => {
  it('returns true for past date', () => {
    const past = new Date(Date.now() - 60_000);
    expect(isExpired(past)).toBe(true);
  });

  it('returns false for future date', () => {
    const future = new Date(Date.now() + 60_000);
    expect(isExpired(future)).toBe(false);
  });
});

describe('startOfDay', () => {
  it('sets time to 00:00:00.000', () => {
    const date = new Date('2025-06-15T14:30:45.123Z');
    const result = startOfDay(date);
    expect(result.getUTCHours()).toBe(0);
    expect(result.getUTCMinutes()).toBe(0);
    expect(result.getUTCSeconds()).toBe(0);
    expect(result.getUTCMilliseconds()).toBe(0);
  });
});

describe('endOfDay', () => {
  it('sets time to 23:59:59.999', () => {
    const date = new Date('2025-06-15T14:30:45.123Z');
    const result = endOfDay(date);
    expect(result.getUTCHours()).toBe(23);
    expect(result.getUTCMinutes()).toBe(59);
    expect(result.getUTCSeconds()).toBe(59);
    expect(result.getUTCMilliseconds()).toBe(999);
  });
});
