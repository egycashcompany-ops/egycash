// The registry's filter builders — pure, and worth pinning because both are regex-based.
//
// A user's search term reaches `new RegExp` directly, so escaping is not a nicety: an unescaped
// `.*` in the code box would list the entire fleet, and an unbalanced `(` would throw a 500 out of
// a text input. Both are asserted here rather than only through the integration suite, because
// this is where the rule lives and it must fail loudly if the escape is ever dropped.
import { describe, expect, it } from 'vitest';
import { vehicleIdentifierFilter, vehicleSearchFilter } from './vehicle.repository';

const rx = (filter: Record<string, unknown>, field: string): RegExp => filter[field] as RegExp;

describe('vehicleSearchFilter — one term across the four identifiers', () => {
  it('asks all four fields at once', () => {
    const filter = vehicleSearchFilter('150') as { $or: Record<string, unknown>[] };
    expect(filter.$or.map((clause) => Object.keys(clause)[0])).toEqual([
      'code',
      'plateNumber',
      'chassisNumber',
      'motorNumber',
    ]);
  });

  it('matches a substring, case-insensitively', () => {
    const filter = vehicleSearchFilter('ch-1') as { $or: Record<string, unknown>[] };
    const codeRx = rx(filter.$or[0] as Record<string, unknown>, 'code');
    expect(codeRx.flags).toContain('i');
    expect(codeRx.test('XCH-150X')).toBe(true);
  });

  it('escapes regex metacharacters — a term is TEXT', () => {
    const filter = vehicleSearchFilter('.*') as { $or: Record<string, unknown>[] };
    const codeRx = rx(filter.$or[0] as Record<string, unknown>, 'code');
    expect(codeRx.test('anything')).toBe(false);
    expect(codeRx.test('a.*b')).toBe(true);
  });

  it('does not throw on an unbalanced bracket typed into the box', () => {
    expect(() => vehicleSearchFilter('CH-(150')).not.toThrow();
    const filter = vehicleSearchFilter('CH-(150') as { $or: Record<string, unknown>[] };
    expect(rx(filter.$or[0] as Record<string, unknown>, 'code').test('CH-(150')).toBe(true);
  });
});

describe('vehicleIdentifierFilter — ONE identifier, so filters can be ANDed', () => {
  it('narrows exactly one field, which is what makes "plate AND chassis" expressible', () => {
    const filter = vehicleIdentifierFilter('plateNumber', '150') as Record<string, unknown>;
    expect(Object.keys(filter)).toEqual(['plateNumber']);
    expect(rx(filter, 'plateNumber').test('س ص 150')).toBe(true);
  });

  it('escapes the term here too', () => {
    const filter = vehicleIdentifierFilter('code', '.*') as Record<string, unknown>;
    expect(rx(filter, 'code').test('V100')).toBe(false);
  });

  it('is case-insensitive, matching the combined search box', () => {
    const filter = vehicleIdentifierFilter('chassisNumber', 'ch-1') as Record<string, unknown>;
    expect(rx(filter, 'chassisNumber').test('CH-150')).toBe(true);
  });
});
