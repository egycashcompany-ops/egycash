// Cell conversion (spec §6.3, §10.2). Every value is synthetic.
import { describe, expect, it } from 'vitest';
import {
  convertBank,
  convertBranch,
  convertCode,
  convertCombination,
  convertDate,
  convertName,
  convertText,
  convertTime,
  isDateFormat,
  unwrapCellValue,
  type CellColumn,
  type RawCellValue,
} from './cell-convert';

const P = (excel: string): CellColumn => ({ excel, sensitivity: 'P' });
const K = (excel: string): CellColumn => ({ excel, sensitivity: 'K' });
const AO: CellColumn = { excel: 'AO', sensitivity: 'S' };

const str = (value: string): RawCellValue => ({ kind: 'string', value });
const num = (value: number): RawCellValue => ({ kind: 'number', value });
const err = (value: string): RawCellValue => ({ kind: 'error', value });
const EMPTY: RawCellValue = { kind: 'empty' };
/** What ExcelJS hands over for a time-formatted number: the 1900-epoch instant. */
const timeCell = (days: number): RawCellValue => ({
  kind: 'date',
  value: new Date(Date.UTC(1899, 11, 30) + Math.round(days * 86_400_000)),
});

describe('time columns (AK, AL, AM)', () => {
  it('stores what Excel shows, HH:mm', () => {
    expect(convertTime(timeCell(8 / 24), P('AK'), false)).toEqual({ value: '08:00', issues: [] });
    expect(convertTime(timeCell(13.5 / 24), P('AL'), false)).toEqual({
      value: '13:30',
      issues: [],
    });
  });

  it('a whole day shows 00:00 and keeps its day count (EG-20)', () => {
    expect(convertTime(timeCell(1), P('AK'), false)).toEqual({
      value: '00:00',
      issues: [{ code: 'timeOverDay', column: 'AK', detail: '1' }],
    });
  });

  it('3.75 days shows 18:00 with detail 3.75', () => {
    expect(convertTime(timeCell(3.75), P('AL'), false)).toEqual({
      value: '18:00',
      issues: [{ code: 'timeOverDay', column: 'AL', detail: '3.75' }],
    });
  });

  it('a General number is NOT converted', () => {
    expect(convertTime(num(0), P('AK'), false)).toEqual({ value: '0', issues: [] });
    expect(convertTime(num(0.5), P('AL'), false)).toEqual({ value: '0.5', issues: [] });
  });

  it('text is kept as typed', () => {
    expect(convertTime(str(' 9:00AM '), P('AM'), false).value).toBe('9:00AM');
  });
});

describe('date columns (AQ, AR)', () => {
  it('a Date is its UTC day', () => {
    const out = convertDate(
      { kind: 'date', value: new Date('2025-03-04T00:00:00Z') },
      P('AQ'),
      false,
    );
    expect(out).toEqual({ value: '2025-03-04', issues: [], invalid: false });
  });

  it('an integer serial in range converts with dateSerial', () => {
    expect(convertDate(num(46034), P('AQ'), false)).toEqual({
      value: '2026-01-12',
      issues: [{ code: 'dateSerial', column: 'AQ', detail: '2026-01-12' }],
      invalid: false,
    });
  });

  it('text, whitespace, an error and a fraction are unreadable', () => {
    for (const cell of [str('soon'), str('   '), err('#N/A'), num(46034.5), num(12)]) {
      const out = convertDate(cell, P('AR'), false);
      expect(out.value).toBeNull();
      expect(out.invalid).toBe(true);
      expect(out.issues.map((i) => i.code)).toEqual(['dateInvalid']);
    }
  });

  it('empty is null and readable', () => {
    expect(convertDate(EMPTY, P('AQ'), false)).toEqual({ value: null, issues: [], invalid: false });
  });
});

describe('identity columns', () => {
  it('a blank name stays null with noName (DEC-32)', () => {
    expect(convertName(EMPTY, P('E'))).toEqual({
      value: null,
      issues: [{ code: 'noName', column: 'E', detail: null }],
    });
    expect(convertName(str('  Mall ATM '), P('E'))).toEqual({ value: 'Mall ATM', issues: [] });
  });

  it('a number code and a text code unify', () => {
    expect(convertCode(num(99990003), P('D')).value).toBe('99990003');
    expect(convertCode(str('99990003'), P('D'))).toEqual({ value: '99990003', issues: [] });
  });

  it('NBSP or edge spaces are noted; leading zeros go', () => {
    expect(convertCode(str(' 99990003'), P('D'))).toEqual({
      value: '99990003',
      issues: [{ code: 'codeWhitespace', column: 'D', detail: null }],
    });
    expect(convertCode(str('0123'), P('D')).value).toBe('123');
  });

  it('placeholders are kept and marked; blanks are noCode', () => {
    expect(convertCode(str('#'), P('D'))).toEqual({
      value: '#',
      issues: [{ code: 'placeholderCode', column: 'D', detail: '#' }],
    });
    expect(convertCode(str('********'), P('D')).issues.map((i) => i.code)).toEqual([
      'placeholderCode',
    ]);
    expect(convertCode(EMPTY, P('D')).issues.map((i) => i.code)).toEqual(['noCode']);
  });

  it('the bank alias is read as NXT and noted; an unknown bank is refused', () => {
    expect(convertBank(str('نيكست'), P('C'))).toEqual({
      value: 'NXT',
      issues: [{ code: 'bankAlias', column: 'C', detail: 'نيكست' }],
    });
    expect(convertBank(str('NBE'), P('C'))).toEqual({ value: 'NBE', issues: [] });
    expect(convertBank(str('QNB'), P('C'))).toEqual({
      value: null,
      issues: [{ code: 'unknownBank', column: 'C', detail: 'QNB' }],
    });
  });

  it('#N/A in B is areaError', () => {
    expect(convertText(err('#N/A'), P('B'), 'areaError')).toEqual({
      value: null,
      issues: [{ code: 'areaError', column: 'B', detail: '#N/A' }],
    });
  });

  it('branch codes: exact EGYCASH-n, blank, unknown', () => {
    expect(convertBranch(str('EGYCASH-4'), P('A'))).toMatchObject({
      value: 'EGYCASH-4',
      present: true,
    });
    expect(convertBranch(EMPTY, P('A'))).toMatchObject({ value: null, present: false });
    const unknown = convertBranch(str('EGYCASH-9'), P('A'));
    expect(unknown).toMatchObject({ value: null, present: true });
    expect(unknown.issues.map((i) => i.code)).toEqual(['unknownBranchCode']);
  });

  it('a date typed into a text column keeps its day + dateInText', () => {
    expect(convertText({ kind: 'date', value: new Date('2024-02-03T00:00:00Z') }, P('F'))).toEqual({
      value: '2024-02-03',
      issues: [{ code: 'dateInText', column: 'F', detail: '2024-02-03' }],
    });
  });
});

describe('the combination (AO) and the key columns — no value in any issue', () => {
  it('a number under 00 - 00 - 00 is laid into the format, zero-padded', () => {
    expect(convertCombination(num(25), AO, '00 - 00 - 00')).toEqual({
      value: '00 - 00 - 25',
      issues: [],
    });
    expect(convertCombination(num(123456), AO, '00" - "00" - "00')).toEqual({
      value: '12 - 34 - 56',
      issues: [],
    });
  });

  it('a 7-digit number or another shape keeps its text with aoShape, detail null', () => {
    const seven = convertCombination(num(1234567), AO, '00 - 00 - 00');
    expect(seven).toEqual({
      value: '1234567',
      issues: [{ code: 'aoShape', column: 'AO', detail: null }],
    });
    const text = convertCombination(str('12-34'), AO, null);
    expect(text).toEqual({
      value: '12-34',
      issues: [{ code: 'aoShape', column: 'AO', detail: null }],
    });
    expect(convertCombination(str('12 - 34 - 56'), AO, null).issues).toEqual([]);
  });

  it('an error in AO or in a K column never carries its text', () => {
    expect(convertCombination(err('#REF!'), AO, null).issues).toEqual([
      { code: 'errorValue', column: 'AO', detail: null },
    ]);
    expect(convertText(err('#VALUE!'), K('J')).issues).toEqual([
      { code: 'errorValue', column: 'J', detail: null },
    ]);
    expect(
      convertText({ kind: 'date', value: new Date('2024-01-01T00:00:00Z') }, K('AN')).issues,
    ).toEqual([{ code: 'dateInText', column: 'AN', detail: null }]);
  });
});

describe('unwrapping what ExcelJS hands over', () => {
  it('formulas read their cached result; a date-formatted result becomes a Date', () => {
    expect(unwrapCellValue({ formula: 'B3', result: 'Smouha' }, null, false)).toEqual(
      str('Smouha'),
    );
    const day = unwrapCellValue({ formula: 'TODAY()', result: 46034 }, 'yyyy-mm-dd', false);
    expect(day.kind === 'date' && day.value.toISOString().slice(0, 10)).toBe('2026-01-12');
    expect(unwrapCellValue({ formula: 'X', result: Number.NaN }, null, false)).toEqual({
      kind: 'error',
      value: null,
    });
  });

  it('rich text joins, errors are marked, empty strings are empty', () => {
    expect(unwrapCellValue({ richText: [{ text: 'a' }, { text: 'b' }] }, null, false)).toEqual(
      str('ab'),
    );
    expect(unwrapCellValue({ error: '#N/A' }, null, false)).toEqual(err('#N/A'));
    expect(unwrapCellValue('', null, false)).toEqual(EMPTY);
  });

  it('isDateFormat mirrors ExcelJS', () => {
    expect(isDateFormat('h:mm')).toBe(true);
    expect(isDateFormat('yyyy-mm-dd')).toBe(true);
    expect(isDateFormat('00 - 00 - 00')).toBe(false);
    expect(isDateFormat('"d"0')).toBe(false);
    expect(isDateFormat(null)).toBe(false);
  });
});
