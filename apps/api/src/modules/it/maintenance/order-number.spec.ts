import { describe, expect, it } from 'vitest';
import {
  MAINTENANCE_ORDER_CODE_MIN_DIGITS,
  MAINTENANCE_ORDER_SEQUENCE_KEY,
  formatMaintenanceOrderCode,
} from './order-number';

describe('formatMaintenanceOrderCode', () => {
  it('pads to the minimum width', () => {
    expect(formatMaintenanceOrderCode(1)).toBe('MO-00001');
    expect(formatMaintenanceOrderCode(42)).toBe('MO-00042');
  });

  it('grows past the width instead of truncating', () => {
    expect(formatMaintenanceOrderCode(123456)).toBe('MO-123456');
  });

  it('keeps the documented width', () => {
    expect(MAINTENANCE_ORDER_CODE_MIN_DIGITS).toBe(5);
  });

  // Its own counter: sharing the asset or ticket sequence would make order codes skip, and a
  // skipped code reads to a human as a lost record (FR-1 — never reused, never editable).
  it('draws from its own sequence key', () => {
    expect(MAINTENANCE_ORDER_SEQUENCE_KEY).toBe('maintenanceOrder:global');
  });
});
