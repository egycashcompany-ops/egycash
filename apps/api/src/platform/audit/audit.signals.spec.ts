// F5 — threshold floor enforcement (defense-in-depth: mirrors the settings' own schema
// minimums so a stale/misparsed value can never lower the bar below the design floor).
import { describe, expect, it } from 'vitest';
import { applyThresholdFloor } from './audit.signals';

describe('applyThresholdFloor', () => {
  it('uses the configured value when it meets or exceeds the floor', () => {
    expect(applyThresholdFloor(3, 10)).toBe(10);
    expect(applyThresholdFloor(3, 3)).toBe(3);
  });

  it('clamps a below-floor configured value up to the floor', () => {
    expect(applyThresholdFloor(3, 1)).toBe(3);
    expect(applyThresholdFloor(5, 0)).toBe(5);
  });
});
