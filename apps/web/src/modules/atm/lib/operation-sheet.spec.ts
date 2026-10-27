// What the four operation tables say, as words — for the screen, its sort and its Excel/PDF
// (2026-10-27): the columns in the table's order, which ones a reader copies, how each orders, and
// the statement's title «بيان تغذية/صيانة ماكينات الصراف الآلي عن يوم … / عن الفترة من … إلى …».
import { describe, expect, it } from 'vitest';
import { type AtmMaintenanceDto, type AtmReplenishmentDto } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import { sortRows } from '../../../shared/lib/sort-rows';
import {
  knownSorts,
  maintenanceColumns,
  operationSortValue,
  replenishmentColumns,
  statementFileName,
  statementFilterLine,
  statementLines,
  statementTitle,
} from './operation-sheet';

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
