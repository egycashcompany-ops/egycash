// What a vehicle-code box matches, in the browser — and, just as importantly, what it does not.
import { describe, expect, it } from 'vitest';
import { isAnyVehicleCode, matchesVehicleCode } from './vehicle-code-match';

describe('matchesVehicleCode', () => {
  it('matches the code', () => {
    expect(matchesVehicleCode('150', '150')).toBe(true);
    expect(matchesVehicleCode('150', '15')).toBe(true);
  });

  it('does not match a code the car does not carry', () => {
    expect(matchesVehicleCode('150', '200')).toBe(false);
  });

  it('narrows nothing when the box holds no code', () => {
    // Empty, whitespace, and a lone dash the parser drops: all of them are "no question asked".
    for (const term of ['', '   ', '-', ' - ']) {
      expect(matchesVehicleCode('150', term), `«${term}» must not narrow`).toBe(true);
    }
  });

  it('reads `150 -` the way the filter bar reads it', () => {
    // The canonical parser's whole point: a trailing separator means the code before it is
    // FINISHED, not that the term is `150 -` — which names no car and would empty the board under
    // a half-typed box. `150 - ` is the same text one keystroke later and must not answer
    // differently.
    expect(matchesVehicleCode('150', '150 -')).toBe(true);
    expect(matchesVehicleCode('150', '150 - ')).toBe(true);
    expect(matchesVehicleCode('200', '150 -')).toBe(false);
  });

  it('keeps `A-15` one code, as the hyphen rule says', () => {
    // No spaces around the dash, so it is part of the code and not a separator.
    expect(matchesVehicleCode('A-15', 'A-15')).toBe(true);
    expect(matchesVehicleCode('A', 'A-15')).toBe(false);
  });

  it('takes several codes at once, OR-ed', () => {
    expect(matchesVehicleCode('150', '150 - 151')).toBe(true);
    expect(matchesVehicleCode('151', '150 - 151')).toBe(true);
    expect(matchesVehicleCode('152', '150 - 151')).toBe(false);
    expect(matchesVehicleCode('151', '150,151')).toBe(true);
  });

  it('ignores case, as the registry does', () => {
    expect(matchesVehicleCode('FLT-210', 'flt-210')).toBe(true);
  });

  it('reads «كورولا 1» as ONE code — not «كورولا» or «1» — and matches it whatever the spacing', () => {
    expect(matchesVehicleCode('كورولا 1', 'كورولا 1')).toBe(true);
    expect(matchesVehicleCode('كورولا 2', 'كورولا 1')).toBe(false);
    expect(matchesVehicleCode('151', 'كورولا 1')).toBe(false);
    expect(matchesVehicleCode('فورتشنر 2 ', 'فورتشنر 2')).toBe(true);
    expect(matchesVehicleCode('كورولا  1', 'كورولا 1')).toBe(true);
    expect(matchesVehicleCode('MG 2', 'mg 2')).toBe(true);
  });

  it('lets the bare word find every car of that model', () => {
    expect(matchesVehicleCode('كورولا 1', 'كورولا')).toBe(true);
    expect(matchesVehicleCode('كورولا 2', 'كورولا ')).toBe(true);
    expect(matchesVehicleCode('كوستر 1', 'كورولا')).toBe(false);
  });
});

describe('isAnyVehicleCode — the PICKED codes, matched whole (the server’s `anyVehicleCode`)', () => {
  // The audit's board (D16): picking «كورولا 1» on «تعيين السيارات» or «الطقم الثابت» — or opening
  // it from «فتح» beside the car on the fleet dashboard — showed «كورولا 10» and «كورولا 11» too,
  // and «5» showed 15, 150, 151 and 215. Every other screen reads the same code with the server's
  // whole-code rule (`vehicleCodePattern`): this is its twin, case for case.
  const BOARD = [
    '5',
    '15',
    '150',
    '151',
    '215',
    'كورولا 1',
    'كورولا 10',
    'كورولا 11',
    'MG 2',
    'MG 20',
  ];
  const picked = (term: string): string[] => BOARD.filter((code) => isAnyVehicleCode(code, term));

  it('answers the car picked, and only that car', () => {
    expect(picked('كورولا 1')).toEqual(['كورولا 1']);
    expect(picked('MG 2')).toEqual(['MG 2']);
    expect(picked('5')).toEqual(['5']);
    expect(picked('15')).toEqual(['15']);
    expect(picked('150')).toEqual(['150']);
  });

  it('where the typed search still finds every code containing it', () => {
    expect(BOARD.filter((code) => matchesVehicleCode(code, 'كورولا 1'))).toEqual([
      'كورولا 1',
      'كورولا 10',
      'كورولا 11',
    ]);
    expect(BOARD.filter((code) => matchesVehicleCode(code, '5'))).toEqual([
      '5',
      '15',
      '150',
      '151',
      '215',
    ]);
  });

  it('takes the picker’s list — several cars, ORed, by the canonical parser', () => {
    expect(picked('كورولا 1,كورولا 10')).toEqual(['كورولا 1', 'كورولا 10']);
    expect(picked('150 - 151')).toEqual(['150', '151']);
    expect(picked('150,MG 2')).toEqual(['150', 'MG 2']);
  });

  it('narrows nothing when the list names no code', () => {
    for (const term of ['', '   ', '-', ' - ']) {
      expect(picked(term), `«${term}» must not narrow`).toEqual(BOARD);
    }
  });

  it('reads whitespace as one space, a Unicode space included, as the server does', () => {
    expect(isAnyVehicleCode('فورتشنر 2 ', 'فورتشنر 2')).toBe(true);
    expect(isAnyVehicleCode('كوستر  1', 'كوستر 1')).toBe(true);
    expect(isAnyVehicleCode('كورولا\u00a01', 'كورولا 1')).toBe(true);
    expect(isAnyVehicleCode('كورولا\u00a010', 'كورولا 1')).toBe(false);
  });

  it('ignores the case of a Latin letter, and reads Arabic-Indic digits as Latin', () => {
    expect(isAnyVehicleCode('MG 2', 'mg 2')).toBe(true);
    expect(isAnyVehicleCode('FLT-210', 'flt-210')).toBe(true);
    expect(isAnyVehicleCode('150', '١٥٠')).toBe(true);
    expect(isAnyVehicleCode('1500', '١٥٠')).toBe(false);
  });

  it('is exact otherwise — no part of a code, no other number, no missing space', () => {
    expect(isAnyVehicleCode('كورولا 10', 'كورولا 1')).toBe(false);
    expect(isAnyVehicleCode('كورولا 2', 'كورولا 1')).toBe(false);
    expect(isAnyVehicleCode('كورولا 1', 'كورولا')).toBe(false);
    expect(isAnyVehicleCode('كورولا1', 'كورولا 1')).toBe(false);
    expect(isAnyVehicleCode('A15', 'A-15')).toBe(false);
    expect(isAnyVehicleCode('A-15', 'A-15')).toBe(true);
  });
});
