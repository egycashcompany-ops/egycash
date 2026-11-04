// The one rule every code filter matches stored codes by — without a database.
import { describe, expect, it } from 'vitest';
import { anyVehicleCode, vehicleCodePattern } from './vehicle-code-match';
import { vehicleListFilter } from './vehicle.repository';

const matches = (asked: string, stored: string): boolean => vehicleCodePattern(asked).test(stored);

describe('vehicleCodePattern — the stored codes a filter code names', () => {
  it('matches the code itself', () => {
    expect(matches('كورولا 1', 'كورولا 1')).toBe(true);
    expect(matches('150', '150')).toBe(true);
    expect(matches('A-15', 'A-15')).toBe(true);
  });

  it('reads whitespace around and inside the code as one space — stored data untouched', () => {
    expect(matches('فورتشنر 2', 'فورتشنر 2 ')).toBe(true);
    expect(matches('كوستر 1', 'كوستر  1')).toBe(true);
    expect(matches('كوستر 1', ' كوستر\t1')).toBe(true);
    expect(matches(' كوستر   1 ', 'كوستر 1')).toBe(true);
  });

  it('ignores the case of a Latin letter', () => {
    expect(matches('mg 2', 'MG 2')).toBe(true);
    expect(matches('MG 2', 'mg 2')).toBe(true);
  });

  it('is exact otherwise — no substring, no other number, no missing space', () => {
    expect(matches('كورولا 1', 'كورولا 10')).toBe(false);
    expect(matches('كورولا 1', 'كورولا 2')).toBe(false);
    expect(matches('كورولا', 'كورولا 1')).toBe(false);
    expect(matches('كورولا 1', 'كورولا1')).toBe(false);
    expect(matches('15', '150')).toBe(false);
  });

  it('reads every character of a code as itself, never as pattern syntax', () => {
    expect(matches('A.1', 'A.1')).toBe(true);
    expect(matches('A.1', 'AB1')).toBe(false);
    expect(matches('A+1', 'A+1')).toBe(true);
    expect(matches('(1)', '(1)')).toBe(true);
  });
});

describe('anyVehicleCode — the `$in` a code field is asked with', () => {
  it('one pattern per code, and none for a blank one', () => {
    const clause = anyVehicleCode(['كورولا 1', '  ', 'MG 2']);
    expect(clause.$in).toHaveLength(2);
    expect(clause.$in.every((one) => one instanceof RegExp)).toBe(true);
  });

  it('an empty `$in` for no codes — matching nothing, never everything', () => {
    expect(anyVehicleCode([])).toEqual({ $in: [] });
  });

  it('is what the registry list asks for `vehicleCodes`', () => {
    const filter = vehicleListFilter({ vehicleCodes: ['فورتشنر 2'] }) as Record<string, unknown>;
    const asText = JSON.stringify(filter, (_key, value: unknown) =>
      value instanceof RegExp ? String(value) : value,
    );
    expect(asText).toContain('فورتشنر');
    expect(asText).toContain('\\\\s+');
  });
});
