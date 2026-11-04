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

  it('reads a Unicode space as the browser does — a no-break, thin or ideographic space', () => {
    // The web normalizes these (JavaScript's `\s`) and offers «كورولا 1»; the database's own `\s`
    // is ASCII only, so the class names them — or a sheet's no-break space is an empty table.
    expect(matches('كورولا 1', 'كورولا\u00a01')).toBe(true);
    expect(matches('فورتشنر 2', 'فورتشنر\u00a02\u00a0')).toBe(true);
    expect(matches('mg 2', 'MG\u20092')).toBe(true);
    expect(matches('كوستر 1', '\ufeffكوستر\u30001')).toBe(true);
    expect(matches('كورولا 1', 'كورولا\u00a010')).toBe(false);
  });

  it('holds exactly JavaScript’s whitespace — every character, one by one', () => {
    const pattern = vehicleCodePattern('a b');
    const differ: string[] = [];
    for (let point = 0; point <= 0xffff; point += 1) {
      const char = String.fromCharCode(point);
      if (pattern.test(`a${char}b`) !== /\s/.test(char)) differ.push(point.toString(16));
    }
    expect(differ).toEqual([]);
  });

  it('spells no character the database refuses — no `\\u`, no NUL, no line separator', () => {
    // V8 writes U+2028 / U+2029 back as `\u2028` in a pattern's source and the database refuses
    // `\u` (a 500); the class reaches them through the database's `\v` instead.
    for (const code of ['كورولا 1', ' MG\u00a0\u20282 ', 'a\u0000b']) {
      const { source } = vehicleCodePattern(code);
      expect(source, code).not.toContain('\\u');
      expect(source, code).not.toMatch(/[\0\u2028\u2029]/);
      expect(source, code).toContain('\u00a0');
    }
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

  it('never puts a NUL byte in the pattern — BSON refuses one, and the request would be a 500', () => {
    const pattern = vehicleCodePattern('a\u0000b');
    expect(pattern.source).not.toContain('\u0000');
    expect(pattern.source).toContain('\\x00');
    // Still that character, and only it: the stored code with the NUL, never «ab» or «a b».
    expect(pattern.test('a\u0000b')).toBe(true);
    expect(pattern.test('ab')).toBe(false);
    expect(pattern.test('a b')).toBe(false);
    const [only] = anyVehicleCode(['\u0000']).$in;
    expect(only?.source).not.toContain('\u0000');
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
    expect(asText).toContain(JSON.stringify(String(vehicleCodePattern('فورتشنر 2'))));
  });
});
