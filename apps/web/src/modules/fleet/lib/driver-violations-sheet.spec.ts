// The drivers' report: every fine, then one line per driver — and «مجهول» on neither.
import type { FleetViolationDto } from '@ecms/contracts';
import { describe, expect, it } from 'vitest';
import { driverSummaryLines, outstandingTotal, reportableFines } from './driver-violations-sheet';

const NAMES: Record<string, { name: string; code: string }> = {
  e1: { name: 'حسين فهمى ابو اليزيد', code: '0200353' },
  e2: { name: 'منير على محمود علام', code: '0501771' },
};

const fine = (
  id: string,
  employee: string | null,
  amount: number,
  o: { bookName?: string | null; collected?: boolean } = {},
): FleetViolationDto =>
  ({
    id,
    kind: 'driver',
    vehicleId: 'v204',
    vehicleCode: '204',
    violationTypeId: 't1',
    amount,
    date: '2026-05-10T00:00:00.000Z',
    driverEmployeeId: employee,
    driverName: o.bookName ?? null,
    collected: o.collected ?? false,
  }) as unknown as FleetViolationDto;

const lines = (rows: FleetViolationDto[]) =>
  driverSummaryLines({
    rows,
    driverOf: (row) =>
      (row.driverEmployeeId === null ? undefined : NAMES[row.driverEmployeeId]?.name) ??
      row.driverName ??
      '',
    employeeCodeOf: (row) =>
      row.driverEmployeeId === null ? '' : (NAMES[row.driverEmployeeId]?.code ?? ''),
  });

describe('the drivers’ report', () => {
  it('leaves every «مجهول» fine off — named, or with no name at all', () => {
    const kept = reportableFines([
      fine('a', 'e1', 700),
      fine('b', null, 200, { bookName: 'مجهول' }),
      fine('c', null, 200, { bookName: ' مجهول ' }),
      fine('d', null, 200),
      fine('e', null, 300, { bookName: 'محمد الشحات' }),
    ]);
    expect(kept.map((row) => row.id)).toEqual(['a', 'e']);
  });

  it('puts each driver on ONE line with their EMPLOYEE code and their total', () => {
    expect(
      lines([
        fine('a', 'e1', 700),
        fine('b', 'e2', 700),
        fine('c', 'e1', 400),
        fine('d', 'e1', 700),
      ]),
    ).toEqual([
      { name: 'حسين فهمى ابو اليزيد', code: '0200353', amount: 1800 },
      { name: 'منير على محمود علام', code: '0501771', amount: 700 },
    ]);
  });

  it('keeps a driver the old book named apart by that name, with no code', () => {
    expect(
      lines([
        fine('a', null, 200, { bookName: 'محمد الشحات' }),
        fine('b', null, 300, { bookName: 'كامل فتحى' }),
        fine('c', null, 100, { bookName: 'محمد الشحات' }),
      ]),
    ).toEqual([
      { name: 'محمد الشحات', code: '', amount: 300 },
      { name: 'كامل فتحى', code: '', amount: 300 },
    ]);
  });

  it('totals what is still owed', () => {
    expect(
      outstandingTotal([fine('a', 'e1', 700), fine('b', 'e1', 400, { collected: true })]),
    ).toBe(700);
  });
});
