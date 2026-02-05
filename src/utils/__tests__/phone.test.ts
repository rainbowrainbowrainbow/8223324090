import { describe, it, expect } from 'vitest';
import { normalizePhone, isValidUAPhone, formatPhone } from '../phone.js';

describe('normalizePhone', () => {
  it('keeps +380 format as-is', () => {
    expect(normalizePhone('+380501234567')).toBe('+380501234567');
  });

  it('prepends + to 380 prefix', () => {
    expect(normalizePhone('380501234567')).toBe('+380501234567');
  });

  it('converts 80 prefix to +380', () => {
    expect(normalizePhone('80501234567')).toBe('+380501234567');
  });

  it('converts 0 prefix to +380', () => {
    expect(normalizePhone('0501234567')).toBe('+380501234567');
  });

  it('strips non-digit characters', () => {
    expect(normalizePhone('+38 (050) 123-45-67')).toBe('+380501234567');
  });
});

describe('isValidUAPhone', () => {
  it('accepts valid +380 number', () => {
    expect(isValidUAPhone('+380501234567')).toBe(true);
  });

  it('rejects number without +380 prefix', () => {
    expect(isValidUAPhone('0501234567')).toBe(false);
  });

  it('rejects too short number', () => {
    expect(isValidUAPhone('+38050123456')).toBe(false);
  });

  it('rejects too long number', () => {
    expect(isValidUAPhone('+3805012345678')).toBe(false);
  });
});

describe('formatPhone', () => {
  it('formats +380501234567', () => {
    expect(formatPhone('+380501234567')).toBe('+380 (50) 123-45-67');
  });

  it('returns non-UA numbers as-is', () => {
    expect(formatPhone('+1234567890')).toBe('+1234567890');
  });
});
