// The Plus Code implementation, pinned on the spec's vectors (docs/12-planning/atm-map-zones.md
// §4.1, §9.2) and on an independent BigInt reference. The vectors were derived by hand from the
// algorithm and cross-checked with exact fractions; the cell-edge vector is the reason the
// arithmetic is integer at all.
import { describe, expect, it } from 'vitest';
import {
  PLUS_CODE_ALPHABET,
  classifyPlusCode,
  decode,
  encode,
  isFull,
  isShort,
  isValidCode,
  recoverNearest,
} from './plus-code';

const area = (code: string) => decode(code);

describe('decode', () => {
  it('decodes a 10-digit code on integer offsets', () => {
    const a = area('7FG49QCJ+2V');
    expect(a.south).toBeCloseTo(20.37, 9);
    expect(a.west).toBeCloseTo(2.782125, 9);
    expect(a.north).toBeCloseTo(20.370125, 9);
    expect(a.east).toBeCloseTo(2.78225, 9);
    expect(a.lat).toBeCloseTo(20.3700625, 9);
    expect(a.lng).toBeCloseTo(2.7821875, 9);
  });

  it('decodes a padded code as its coarse cell', () => {
    const a = area('7FG49Q00+');
    expect([a.south, a.west, a.north, a.east]).toEqual([
      expect.closeTo(20.35, 9),
      expect.closeTo(2.75, 9),
      expect.closeTo(20.4, 9),
      expect.closeTo(2.8, 9),
    ]);
    expect(a.lat).toBeCloseTo(20.375, 9);
    expect(a.lng).toBeCloseTo(2.775, 9);
  });

  it('decodes the reference codes, including an 11-digit grid code', () => {
    const ten = area('8FVC9G8F+6X');
    expect(ten.lat).toBeCloseTo(47.3655625, 9);
    expect(ten.lng).toBeCloseTo(8.5249375, 9);
    const grid = area('8FVC9G8F+6XQ');
    expect(grid.south).toBeCloseTo(47.365575, 9);
    expect(grid.west).toBeCloseTo(8.52496875, 9);
    expect(grid.north).toBeCloseTo(47.3656, 9);
    expect(grid.east).toBeCloseTo(8.525, 9);
  });

  it('gives the same answer in lowercase', () => {
    expect(area('8g2h26vp+q7')).toEqual(area('8G2H26VP+Q7'));
    expect(isValidCode('8g2h26vp+q7')).toBe(true);
    expect(isFull('8g2h26vp+q7')).toBe(true);
    expect(isShort('26vp+q7')).toBe(true);
  });

  it('refuses a code that is not full', () => {
    expect(() => decode('26VP+Q7')).toThrow(RangeError);
  });
});

describe('encode', () => {
  it('encodes Cairo, at 10 and at 11 digits', () => {
    expect(encode(30.0444, 31.2357)).toBe('8G2H26VP+Q7');
    const centre = area('8G2H26VP+Q7');
    expect(centre.lat).toBeCloseTo(30.0444375, 9);
    expect(centre.lng).toBeCloseTo(31.2356875, 9);

    expect(encode(30.0444, 31.2357, 11)).toBe('8G2H26VP+Q78');
    const grid = area('8G2H26VP+Q78');
    expect(grid.south).toBeCloseTo(30.0444, 9);
    expect(grid.west).toBeCloseTo(31.2356875, 9);
    expect(grid.north).toBeCloseTo(30.044425, 9);
    expect(grid.east).toBeCloseTo(31.23571875, 9);
  });

  it('encodes a point inside the 11-digit reference cell', () => {
    expect(encode(47.36559, 8.524997, 11)).toBe('8FVC9G8F+6XQ');
  });

  it('decides a point exactly on a cell edge exactly', () => {
    // 216.922625 × 8,192,000 = 1,777,030,144: the edge itself. A floating-point floor gives …+H2.
    expect(encode(22.226405, 36.922625)).toBe('7GJR6WGF+H3');
  });

  it('encodes Alexandria, Asyut and Ismailia', () => {
    expect(encode(31.2001, 29.9187)).toBe('8G3F6W29+2F');
    expect(encode(27.1809, 31.1837)).toBe('7GVH55JM+9F');
    expect(encode(31.2653, 32.3019)).toBe('8G3J7882+4Q');
  });

  it('pads the short lengths and refuses impossible ones', () => {
    expect(encode(20.375, 2.775, 6)).toBe('7FG49Q00+');
    expect(encode(30.0444, 31.2357, 8)).toBe('8G2H26VP+');
    expect(encode(30.0444, 31.2357, 2)).toBe('8G000000+');
    expect(() => encode(30, 31, 9)).toThrow(RangeError);
    expect(() => encode(30, 31, 7)).toThrow(RangeError);
    expect(() => encode(30, 31, 16)).toThrow(RangeError);
  });

  it('clips the north pole and wraps the antimeridian', () => {
    expect(isFull(encode(90, 0))).toBe(true);
    expect(encode(0, 180)).toBe(encode(0, -180));
  });

  it('round-trips five Egyptian points to within half a cell', () => {
    const points: [number, number][] = [
      [30.0444, 31.2357],
      [31.2001, 29.9187],
      [27.1809, 31.1837],
      [24.0889, 32.8998],
      [31.2653, 32.3019],
    ];
    for (const [lat, lng] of points) {
      const centre = decode(encode(lat, lng));
      expect(Math.abs(centre.lat - lat)).toBeLessThanOrEqual(0.000125 / 2 + 1e-12);
      expect(Math.abs(centre.lng - lng)).toBeLessThanOrEqual(0.000125 / 2 + 1e-12);
    }
  });

  it('agrees with an exact BigInt reference on 10,000 seeded random points in Egypt', () => {
    // mulberry32 — deterministic, so a failure names the same point every run.
    let seed = 0x5eed1234;
    const random = (): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const reference = (latMicro: bigint, lngMicro: bigint, length: number): string => {
      let latInt = (latMicro + 90_000_000n) * 25n;
      let lngInt = ((lngMicro + 180_000_000n) * 8192n) / 1000n;
      let grid = '';
      for (let i = 0; i < 5; i += 1) {
        grid = PLUS_CODE_ALPHABET[Number((latInt % 5n) * 4n + (lngInt % 4n))] + grid;
        latInt /= 5n;
        lngInt /= 4n;
      }
      let pairs = '';
      for (let i = 0; i < 5; i += 1) {
        pairs =
          PLUS_CODE_ALPHABET[Number(latInt % 20n)]! +
          PLUS_CODE_ALPHABET[Number(lngInt % 20n)]! +
          pairs;
        latInt /= 20n;
        lngInt /= 20n;
      }
      const digits = (pairs + grid).slice(0, length);
      return `${digits.slice(0, 8)}+${digits.slice(8)}`;
    };
    for (let i = 0; i < 10_000; i += 1) {
      const latMicro = Math.round((21.7 + random() * (31.9 - 21.7)) * 1e6);
      const lngMicro = Math.round((24.6 + random() * (37.0 - 24.6)) * 1e6);
      const length = i % 2 === 0 ? 10 : 11;
      const got = encode(latMicro / 1e6, lngMicro / 1e6, length);
      expect(got, `${String(latMicro)},${String(lngMicro)}`).toBe(
        reference(BigInt(latMicro), BigInt(lngMicro), length),
      );
    }
  });
});

describe('validity and classification', () => {
  it.each([
    ['8G2H26VP+Q', 'one character after +'],
    ['8G2H26V+PQ7', '+ at an odd index'],
    ['8G2H26VP+Q7A!', 'characters outside the alphabet'],
    ['8G0H26VP+Q7', 'padding in the middle'],
    ['8G2H2600+Q7', 'padded, with something after +'],
    ['0G2H26VP+Q7', 'padding at index 0'],
    ['8G2H26VP', 'no separator'],
    ['8G2H+26VP+Q7', 'two separators'],
  ])('refuses %s (%s)', (code) => {
    expect(isValidCode(code)).toBe(false);
    expect(classifyPlusCode(code)).toBe('unreadable');
  });

  it('reads WG2H26VP+Q7 as valid but neither full nor short', () => {
    expect(isValidCode('WG2H26VP+Q7')).toBe(true);
    expect(isFull('WG2H26VP+Q7')).toBe(false);
    expect(isShort('WG2H26VP+Q7')).toBe(false);
    expect(classifyPlusCode('WG2H26VP+Q7')).toBe('unreadable');
  });

  it('reads a full code with fewer than 10 digits as unreadable', () => {
    expect(isFull('8G2H2600+')).toBe(true);
    expect(isFull('8G2H26VP+')).toBe(true);
    expect(classifyPlusCode('8G2H2600+')).toBe('unreadable');
    expect(classifyPlusCode('8G2H26VP+')).toBe('unreadable');
    expect(classifyPlusCode('8G2H26VP+Q7')).toBe('full');
  });

  it('never treats a padded code as short', () => {
    expect(isValidCode('2600+')).toBe(true);
    expect(isShort('2600+')).toBe(false);
    expect(classifyPlusCode('2600+')).toBe('unreadable');
  });

  it('classifies a short code, and refuses one with nothing after +', () => {
    expect(classifyPlusCode('26VP+Q7')).toBe('short');
    expect(isShort('26VP+')).toBe(true);
    expect(classifyPlusCode('26VP+')).toBe('unreadable');
  });
});

describe('recoverNearest', () => {
  it('recovers the spec vectors', () => {
    expect(recoverNearest('26VP+Q7', 30.05, 31.2).code).toBe('8G2H26VP+Q7');
    // The reference lies more than 0.5° from the true point: the nearest cell is a degree north.
    const north = recoverNearest('26VP+Q7', 30.6, 31.2357);
    expect(north.code).toBe('8G3H26VP+Q7');
    expect(north.lat).toBeCloseTo(31.0444375, 9);
    // On the 0.5° boundary: 29.5444 + 0.5 < 30.0444375, so one degree south.
    expect(recoverNearest('26VP+Q7', 29.5444, 31.2357).code).toBe('7GXH26VP+Q7');
  });

  it('returns the recovered cell centre', () => {
    const r = recoverNearest('26vp+q7', 30.05, 31.2);
    expect(r.lat).toBeCloseTo(30.0444375, 9);
    expect(r.lng).toBeCloseTo(31.2356875, 9);
  });

  it('recovers correctly inside each window and not beyond it', () => {
    // True point 8G2H26VP+Q7 (30.0444375, 31.2356875).
    // 6 characters before +: ±10°.
    expect(recoverNearest('2H26VP+Q7', 39.0, 40.0).code).toBe('8G2H26VP+Q7');
    expect(recoverNearest('2H26VP+Q7', 40.1, 31.2357).code).not.toBe('8G2H26VP+Q7');
    // 4 characters before +: ±0.5°.
    expect(recoverNearest('26VP+Q7', 30.5, 30.75).code).toBe('8G2H26VP+Q7');
    expect(recoverNearest('26VP+Q7', 30.55, 31.2357).code).not.toBe('8G2H26VP+Q7');
    // 2 characters before +: ±0.025°.
    expect(recoverNearest('VP+Q7', 30.03, 31.25).code).toBe('8G2H26VP+Q7');
    expect(recoverNearest('VP+Q7', 30.07, 31.2357).code).not.toBe('8G2H26VP+Q7');
  });

  it('always lands within half a cell of the reference, whatever the true point', () => {
    for (const [ref, half] of [
      [[30.6, 31.2357], 0.5],
      [[29.0, 32.4], 0.5],
    ] as const) {
      const r = recoverNearest('26VP+Q7', ref[0], ref[1]);
      expect(Math.abs(r.lat - ref[0])).toBeLessThanOrEqual(half);
      expect(Math.abs(r.lng - ref[1])).toBeLessThanOrEqual(half);
    }
  });

  it('refuses a code that is not short', () => {
    expect(() => recoverNearest('8G2H26VP+Q7', 30, 31)).toThrow(RangeError);
    expect(() => recoverNearest('2600+', 30, 31)).toThrow(RangeError);
  });
});
