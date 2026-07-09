// Pure retry-backoff math (Sprint 3.3 plan §3d) — the self-managed retry counter's
// exponential schedule, matching the platform's own queue default (2s base — ADR-009).
import { describe, expect, it } from 'vitest';
import { computeDeliveryBackoffMs } from './notification.service';

describe('computeDeliveryBackoffMs', () => {
  it('doubles from a 2s base on each successive attempt', () => {
    expect(computeDeliveryBackoffMs(1)).toBe(2_000);
    expect(computeDeliveryBackoffMs(2)).toBe(4_000);
    expect(computeDeliveryBackoffMs(3)).toBe(8_000);
    expect(computeDeliveryBackoffMs(4)).toBe(16_000);
    expect(computeDeliveryBackoffMs(5)).toBe(32_000);
  });
});
