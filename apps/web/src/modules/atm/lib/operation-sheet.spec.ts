// What the four operation tables say, as words — for the screen, its sort and its Excel/PDF
// (2026-10-27): the columns in the table's order, which ones a reader copies, how each orders, and
// the statement's title «بيان تغذية/صيانة ماكينات الصراف الآلي عن يوم … / عن الفترة من … إلى …».
import { describe, expect, it } from 'vitest';
import { type AtmMaintenanceDto, type AtmReplenishmentDto } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import { sortRows } from '../../../shared/lib/sort-rows';
import {
  codeSortValue,
  knownSorts,
  maintenanceColumns,
  operationSortValue,
  replenishmentColumns,
  statementFileName,
  statementFilterLine,
  statementLines,
  statementSheet,
  scheduleSortValue,
  statementTitle,
} from './operation-sheet';
import { buildXlsxBook } from '../../../shared/lib/xlsx-writer';

const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);
const en = (key: string, params?: Record<string, string | number>): string =>
  translate('en', key, params);

const base = {
  branchId: 'b',
  machineId: 'm',
  bankName: 'SYN NBE',
  machineName: 'SYN ONE',
  zone: '',
  area: 'SYN Smouha',
  openedAt: '2026-10-27T08:00:00.000Z',
  closedAt: null,
  leaderName: null,
  openedByName: 'SYN OPENER',
  closedByName: null,
  version: 1,
  createdAt: '2026-10-27T08:00:00.000Z',
  updatedAt: '2026-10-27T08:00:00.000Z',
};
const rep = (id: string, machineCode: string, over: Partial<AtmReplenishmentDto> = {}) =>
  ({ ...base, id, machineCode, scheduleTime: '10:00', ...over }) as AtmReplenishmentDto;
const maint = (id: string, machineCode: string) =>
  ({
    ...base,
    id,
    machineCode,
    serviceType: null,
    notes: null,
    referenceNumber: 'REF-1',
    source: 'manual',
    mailTicketId: null,
    leaderEmployeeId: null,
  }) as AtmMaintenanceDto;

describe('the columns, in the table’s order', () => {
  it('replenishment board: the four copy columns first — bank, code, name, schedule', () => {
    const columns = replenishmentColumns(ar, 'ar', 'open');
    expect(columns.map((c) => c.key)).toEqual([
      'bank',
      'code',
      'name',
      'schedule',
      'area',
      'opened',
      'leader',
      'addedBy',
    ]);
    expect(columns.filter((c) => c.copy === true).map((c) => c.key)).toEqual([
      'bank',
      'code',
      'name',
      'schedule',
    ]);
  });

  it('maintenance board: the machine and the open time are copied — it has no schedule', () => {
    const columns = maintenanceColumns(ar, 'ar', 'open');
    expect(columns.map((c) => c.key)).toEqual([
      'bank',
      'code',
      'name',
      'service',
      'area',
      'opened',
      'notes',
      'leader',
      'reference',
      'addedBy',
    ]);
    expect(columns.filter((c) => c.copy === true).map((c) => c.key)).toEqual([
      'bank',
      'code',
      'name',
      'opened',
    ]);
  });

  it('done pages: the close, the duration and the closer; nothing is a copy column', () => {
    expect(replenishmentColumns(ar, 'ar', 'done').map((c) => c.key)).toEqual([
      'bank',
      'code',
      'name',
      'schedule',
      'area',
      'opened',
      'closed',
      'duration',
      'leader',
      'closedBy',
    ]);
    expect(maintenanceColumns(ar, 'ar', 'done').map((c) => c.key)).toEqual([
      'bank',
      'code',
      'name',
      'service',
      'area',
      'opened',
      'closed',
      'duration',
      'notes',
      'reference',
      'leader',
      'closedBy',
    ]);
    expect(replenishmentColumns(ar, 'ar', 'done').some((c) => c.copy === true)).toBe(false);
  });

  it('a missing value prints as the caller says — «—» on paper, a blank cell in a sheet', () => {
    const columns = maintenanceColumns(en, 'en', 'open');
    const [line] = statementLines([maint('1', '101')], columns, '');
    expect(line?.[3]).toBe('');
    expect(statementLines([maint('1', '101')], columns, '—')[0]?.[3]).toBe('—');
    expect(line?.[8]).toBe('REF-1');
  });
});

describe('the order', () => {
  it('codes of digits as numbers — 987 before 1234', () => {
    const rows = [rep('a', '1234'), rep('b', '987'), rep('c', 'ABC')];
    const ordered = sortRows(rows, [{ by: 'code', dir: 'asc' }], operationSortValue);
    expect(ordered.map((r) => r.machineCode).slice(0, 2)).toEqual(['987', '1234']);
  });

  it('is one order whatever the rows arrived in — a code of digits beside one with letters', () => {
    const codes = ['9', '100', '10A', '987', 'ABC', '1234'];
    const want = sortRows(
      codes.map((code, i) => rep(String(i), code)),
      [{ by: 'code', dir: 'asc' }],
      operationSortValue,
    ).map((r) => r.machineCode);
    for (const shuffled of [[...codes].reverse(), ['10A', '9', 'ABC', '1234', '100', '987']]) {
      const got = sortRows(
        shuffled.map((code, i) => rep(String(i), code)),
        [{ by: 'code', dir: 'asc' }],
        operationSortValue,
      ).map((r) => r.machineCode);
      expect(got).toEqual(want);
    }
    expect(want.slice(0, 4)).toEqual(['9', '100', '987', '1234']);
    // Every value of the column is text, so no comparison mixes a number with a word.
    expect(codes.map(codeSortValue).every((v) => typeof v === 'string')).toBe(true);
  });

  it('a schedule by the clock — «9:00» before «10:30» — Arabic digits and «٫» included', () => {
    const rows = ['10:30', '9:00', '11:00', '٨٫١٥'].map((time, i) =>
      rep(String(i), String(i), { scheduleTime: time }),
    );
    const ordered = sortRows(rows, [{ by: 'schedule', dir: 'asc' }], operationSortValue);
    expect(ordered.map((r) => r.scheduleTime)).toEqual(['٨٫١٥', '9:00', '10:30', '11:00']);
    expect(scheduleSortValue('9.05 ص')).toBe('09:05');
    expect(scheduleSortValue('بعد الظهر')).toBe('بعد الظهر');
    expect(scheduleSortValue('  ')).toBeNull();
  });

  it('a blank sorts last in either direction', () => {
    const rows = [rep('a', '1', { scheduleTime: null }), rep('b', '2', { scheduleTime: '09:00' })];
    for (const dir of ['asc', 'desc'] as const) {
      expect(sortRows(rows, [{ by: 'schedule', dir }], operationSortValue)[1]?.id).toBe('a');
    }
  });

  it('keeps only the sorts the table has a column for', () => {
    expect(
      knownSorts(
        [
          { by: 'schedule', dir: 'asc' },
          { by: 'service', dir: 'desc' },
        ],
        replenishmentColumns(ar, 'ar', 'open'),
      ),
    ).toEqual([{ by: 'schedule', dir: 'asc' }]);
  });
});

describe('the statement', () => {
  it('names one day, or the days from … to …, in the reader’s language', () => {
    const day = statementTitle(ar, 'replenishment', { from: '2026-10-27', to: '2026-10-27' }, 'ar');
    expect(day.startsWith('بيان تغذية ماكينات الصراف الآلي عن يوم ')).toBe(true);
    const range = statementTitle(ar, 'maintenance', { from: '2026-10-01', to: '2026-10-27' }, 'ar');
    expect(range.startsWith('بيان صيانة ماكينات الصراف الآلي عن الفترة من ')).toBe(true);
    expect(range).toContain(' إلى ');
    expect(
      statementTitle(en, 'replenishment', { from: '2026-10-27', to: '2026-10-27' }, 'en'),
    ).toBe('ATM replenishment statement for 27 Oct 2026');
  });

  it('prints the filters in force under the title, and nothing when none is', () => {
    expect(statementFilterLine(ar, 'ar', { banks: ['SYN NBE', 'SYN CIB'], areas: [] })).toBe(
      'البنك: SYN NBE، SYN CIB',
    );
    expect(statementFilterLine(en, 'en', { banks: ['A'], areas: ['X'] })).toBe('Bank: A · Area: X');
    expect(statementFilterLine(ar, 'ar', { banks: [], areas: [] })).toBe('');
  });

  it('names the file by what it is and the day or days', () => {
    expect(statementFileName(ar, 'replenishment', { from: '2026-10-27', to: '2026-10-27' })).toBe(
      'بيان-تغذية-الماكينات-2026-10-27.xlsx',
    );
    expect(statementFileName(en, 'maintenance', { from: '2026-10-01', to: '2026-10-27' })).toBe(
      'ATM-maintenance-2026-10-01_2026-10-27.xlsx',
    );
  });
});

describe('the statement as a workbook', () => {
  // The writer STORES its parts, so the sheet's XML is plain text inside the zip.
  const xml = async (blob: Blob): Promise<string> =>
    new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
  const sheet = statementSheet({
    name: 'التغذيات',
    title: 'بيان تغذية ماكينات الصراف الآلي عن يوم 27',
    serialHeader: 'م',
    header: ['البنك', 'الكود'],
    lines: [
      ['SYN NBE', '101'],
      ['SYN CIB', ''],
    ],
  });

  it('puts the title in row 1, merged across the serial and every column, the table from row 3', () => {
    expect(sheet.merges).toEqual(['A1:C1']);
    expect(sheet.rightToLeft).toBe(true);
    expect(sheet.cells[0]).toEqual({
      row: 1,
      col: 1,
      value: 'بيان تغذية ماكينات الصراف الآلي عن يوم 27',
      style: 'group',
    });
    expect(sheet.cells.filter((cell) => cell.row === 3).map((cell) => cell.value)).toEqual([
      'م',
      'البنك',
      'الكود',
    ]);
    expect(sheet.cells.filter((cell) => cell.row === 5).map((cell) => cell.value)).toEqual([
      2,
      'SYN CIB',
      '',
    ]);
    expect(sheet.cells.some((cell) => cell.row === 2)).toBe(false);
  });

  it('is a sheet the shared writer writes: the title merged, right to left', async () => {
    const book = await xml(buildXlsxBook([sheet]));
    expect(book).toContain('<mergeCell ref="A1:C1"/>');
    expect(book).toContain('<sheetView rightToLeft="1"');
    expect(book).toContain('بيان تغذية ماكينات الصراف الآلي عن يوم 27');
    expect(book).toContain('<row r="3">');
    expect(book).not.toContain('<row r="2">');
  });
});
