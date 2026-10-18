// The Arabic scale bar (spec §9.4): the longest 1/2/5 × 10ⁿ distance within 72 px, in m or km.
import { describe, expect, it } from 'vitest';
import { scaleFor } from './map-scale';

describe('scaleFor', () => {
  it('rounds down to a nice number that fits in 72 px', () => {
    expect(scaleFor(1)).toEqual({ meters: 50, px: 50, label: { key: 'atm.map.scale.m', n: 50 } });
    expect(scaleFor(3)?.meters).toBe(200); // 216 m fit
    expect(scaleFor(10)?.meters).toBe(500); // 720 m fit
    expect(scaleFor(0.5)?.meters).toBe(20); // 36 m fit
  });

  it('switches to kilometres from 1,000 m', () => {
    expect(scaleFor(14)).toEqual({
      meters: 1000,
      px: 1000 / 14,
      label: { key: 'atm.map.scale.km', n: 1 },
    });
    expect(scaleFor(100)?.label).toEqual({ key: 'atm.map.scale.km', n: 5 });
    expect(scaleFor(13.8)?.label).toEqual({ key: 'atm.map.scale.m', n: 500 });
  });

  it('has nothing to show without a scale', () => {
    expect(scaleFor(0)).toBeNull();
    expect(scaleFor(Number.NaN)).toBeNull();
  });
});
