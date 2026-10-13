// Header binding (spec §6.2, §10.2): by EXACT header and occurrence, all 49 or nothing.
import { describe, expect, it } from 'vitest';
import { ATM_REGISTER_COLUMNS } from '@ecms/contracts';
import { bindRegisterColumns, columnLetter, headerText } from './register-columns';

/** Row 1 exactly as the sheet carries it: strings, and the three number headers. */
const sheetHeaders = (): (string | null)[] =>
  ATM_REGISTER_COLUMNS.map((c) =>
    headerText(['AB', 'AC', 'AD'].includes(c.excel) ? Number(c.header) : c.header),
  );

const indexOf = (headers: (string | null)[], letter: string): number | undefined => {
  const bound = bindRegisterColumns(headers);
  if ('missing' in bound) throw new Error('expected a full binding');
  return bound.columns.find((c) => c.def.excel === letter)?.index;
};

describe('register column binding', () => {
  it('binds all 49 columns at their own letters', () => {
    const bound = bindRegisterColumns(sheetHeaders());
    expect('columns' in bound).toBe(true);
    if (!('columns' in bound)) return;
    expect(bound.columns).toHaveLength(49);
    for (const { def, index } of bound.columns) expect(columnLetter(index + 1)).toBe(def.excel);
  });

  it('tells the repeated headers apart by occurrence', () => {
    const headers = sheetHeaders();
    // `Number of\nkeys` #0 / #1
    expect(indexOf(headers, 'O')).toBe(14);
    expect(indexOf(headers, 'Q')).toBe(16);
    // `Number of\nloading cassettes` #0 / #1
    expect(indexOf(headers, 'S')).toBe(18);
    expect(indexOf(headers, 'Z')).toBe(25);
    // `Cassette -1..5` #0 (T..X) / #1 (AF..AJ)
    expect(indexOf(headers, 'T')).toBe(19);
    expect(indexOf(headers, 'X')).toBe(23);
    expect(indexOf(headers, 'AF')).toBe(31);
    expect(indexOf(headers, 'AJ')).toBe(35);
    // `LOCATION\nGPS` #0 (AP) / #1 (AV)
    expect(indexOf(headers, 'AP')).toBe(41);
    expect(indexOf(headers, 'AV')).toBe(47);
  });

  it('reads the number headers 200 / 100 / 50 as their text', () => {
    expect(headerText(200)).toBe('200');
    const headers = sheetHeaders();
    expect(indexOf(headers, 'AB')).toBe(27);
    expect(indexOf(headers, 'AC')).toBe(28);
    expect(indexOf(headers, 'AD')).toBe(29);
  });

  it('folds \\r\\n but nothing else — the comparison is exact', () => {
    const headers = sheetHeaders();
    headers[9] = headerText('Supervisor\r\nKeys');
    expect(indexOf(headers, 'J')).toBe(9);
    // The trailing space of `Withdrawall\nCassettes ` is part of the header.
    const trimmed = sheetHeaders();
    trimmed[17] = 'Withdrawall\nCassettes';
    const bound = bindRegisterColumns(trimmed);
    expect(bound).toEqual({ missing: [{ column: 'R', header: 'Withdrawall\nCassettes ' }] });
  });

  it('a renamed header names the column letter and the expected header only', () => {
    const headers = sheetHeaders();
    headers[4] = 'Machine name';
    const bound = bindRegisterColumns(headers);
    expect(bound).toEqual({ missing: [{ column: 'E', header: 'Name' }] });
    expect(JSON.stringify(bound)).not.toContain('Machine name');
  });

  it('a missing second occurrence is missing, not bound to the first', () => {
    const headers = sheetHeaders();
    headers[16] = null; // Q — the second `Number of\nkeys`
    expect(bindRegisterColumns(headers)).toEqual({
      missing: [{ column: 'Q', header: 'Number of\nkeys' }],
    });
  });

  it('never reads past AW', () => {
    const headers = sheetHeaders();
    headers[48] = null; // AW — HUB
    headers.push('HUB'); // AX
    expect(bindRegisterColumns(headers)).toEqual({ missing: [{ column: 'AW', header: 'HUB' }] });
  });

  it('unwraps rich text and formula results', () => {
    expect(headerText({ richText: [{ text: 'Supervisor\n' }, { text: 'Keys' }] })).toBe(
      'Supervisor\nKeys',
    );
    expect(headerText({ formula: 'X', result: 'Name' })).toBe('Name');
    expect(headerText('')).toBeNull();
    expect(headerText(undefined)).toBeNull();
  });

  it('spells column letters', () => {
    expect([1, 26, 27, 41, 49].map(columnLetter)).toEqual(['A', 'Z', 'AA', 'AO', 'AW']);
  });
});
