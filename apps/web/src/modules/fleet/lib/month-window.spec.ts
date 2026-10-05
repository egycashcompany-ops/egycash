import { describe, expect, it } from 'vitest';
import { monthWindow } from '../pages/VehiclesListPage';

describe('a licence-expiry month as a window', () => {
  it('runs from the month’s first instant to its last, in UTC', () => {
    expect(monthWindow('2026-11')).toEqual({
      from: '2026-11-01T00:00:00.000Z',
      before: '2026-11-30T23:59:59.999Z',
    });
    expect(monthWindow('2028-02')?.before).toBe('2028-02-29T23:59:59.999Z');
    expect(monthWindow('2026-12')?.before).toBe('2026-12-31T23:59:59.999Z');
  });

  it('is nothing for an empty or malformed month', () => {
    expect(monthWindow('')).toBeNull();
    expect(monthWindow('2026-13')).toBeNull();
    expect(monthWindow('11/2026')).toBeNull();
  });
});
