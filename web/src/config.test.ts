import { describe, expect, it } from 'vitest';

import { formatPeriod, formatXlm, parseXlm, shortAddress } from './config';

describe('formatXlm', () => {
  it('renders whole XLM without decimals', () => {
    expect(formatXlm(250_000_000n)).toBe('25');
  });

  it('trims trailing zeros from fractions', () => {
    expect(formatXlm(251_500_000n)).toBe('25.15');
  });

  it('caps decimals at the asked precision', () => {
    expect(formatXlm(10_000_001n, 4)).toBe('1');
    expect(formatXlm(10_123_456n, 2)).toBe('1.01');
  });

  it('groups thousands', () => {
    expect(formatXlm(12_345_600_000_000n)).toBe('1,234,560');
  });

  it('keeps the sign on negative amounts', () => {
    expect(formatXlm(-251_500_000n)).toBe('-25.15');
  });
});

describe('parseXlm', () => {
  it('parses whole and fractional amounts to stroops', () => {
    expect(parseXlm('25')).toBe(250_000_000n);
    expect(parseXlm('25.15')).toBe(251_500_000n);
    expect(parseXlm('0.0000001')).toBe(1n);
  });

  it('round-trips with formatXlm', () => {
    expect(parseXlm(formatXlm(251_500_000n))).toBe(251_500_000n);
  });

  it('rejects malformed input', () => {
    for (const bad of ['', '.', 'abc', '1.2.3', '1,5']) {
      expect(() => parseXlm(bad)).toThrow();
    }
  });

  it('rejects more than 7 decimal places', () => {
    expect(() => parseXlm('1.00000001')).toThrow();
  });
});

describe('formatPeriod', () => {
  it('names daily and weekly periods', () => {
    expect(formatPeriod(86_400n)).toBe('daily');
    expect(formatPeriod(7n * 86_400n)).toBe('every 7 days');
  });

  it('falls back to hours below a day', () => {
    expect(formatPeriod(3_600n)).toBe('hourly');
    expect(formatPeriod(6n * 3_600n)).toBe('every 6 hours');
  });

  it('shows raw seconds for odd periods', () => {
    expect(formatPeriod(90n)).toBe('every 90s');
  });
});

describe('shortAddress', () => {
  it('keeps both ends of the address', () => {
    expect(shortAddress('GDGMCDU5HPC2Z7B6XO67IO5AZZR6NRITVS3E47WJ7LAQJBNAX2I2NJTC')).toBe(
      'GDGM…NJTC',
    );
  });
});
