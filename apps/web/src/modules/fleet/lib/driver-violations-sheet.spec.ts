// Sample A, as printed: one line per driver, the fines counted by type, and the driver's total.
import type { FleetViolationDto } from '@ecms/contracts';
import { describe, expect, it } from 'vitest';
import { driverSheetRows } from './driver-violations-sheet';

const TYPES: Record<string, string> = { t1: 'سرعة', t2: 'حزام' };
const NAMES: Record<string, string> = {
  e1: 'حسين فهمى ابو اليزيد',
  e2: 'منير على محمود علام',
};

const fine = (
  id: string,
  date: string | null,
  code: string,
  employee: string | null,
  type: string,
  amount: number,
  bookName: string | null = null,
): FleetViolationDto =>
  ({
    id,
    kind: 'driver',
    vehicleId: `v${code}`,
    vehicleCode: code,
    violationTypeId: type,
    amount,
    date: date === null ? null : `${date}T00:00:00.000Z`,
    driverEmployeeId: employee,
    driverName: bookName,
    collected: false,
  }) as unknown as FleetViolationDto;

const sheet = (rows: FleetViolationDto[]): string[][] =>
  driverSheetRows({
    rows,
    driverOf: (row) =>
      (row.driverEmployeeId === null ? undefined : NAMES[row.driverEmployeeId]) ??
      row.driverName ??
      '',
    codeOf: (row) => row.vehicleCode ?? '',
    typeOf: (row) => TYPES[row.violationTypeId] ?? '',
    and: ' و ',
  });

describe('the drivers’ printed sheet — sample A', () => {
  it('puts every fine of one driver on ONE line, with their total', () => {
    expect(
      sheet([
        fine('f1', '2026-06-09', '204', 'e1', 't1', 700),
        fine('f2', '2026-05-18', '204', 'e1', 't2', 400),
        fine('f3', '2026-05-11', '204', 'e1', 't1', 700),
        fine('f4', '2026-01-25', '204', 'e2', 't1', 700),
        fine('f5', '2025-03-23', '196', 'e2', 't1', 200),
      ]),
    ).toEqual([
      [
        'حسين فهمى ابو اليزيد',
        '204',
        '2026/06/09 ، 2026/05/18 ، 2026/05/11',
        '2 سرعة و 1 حزام',
        '1800.00',
      ],
      ['منير على محمود علام', '204 ، 196', '2026/01/25 ، 2025/03/23', '2 سرعة', '900.00'],
    ]);
  });

  it('lists the dates newest first, whatever order the board is in, and each date once', () => {
    const [line] = sheet([
      fine('f1', '2025-03-23', '196', 'e1', 't1', 200),
      fine('f2', '2026-01-25', '204', 'e1', 't1', 200),
      fine('f3', '2026-01-25', '204', 'e1', 't2', 200),
    ]);
    expect(line?.[1]).toBe('204 ، 196');
    expect(line?.[2]).toBe('2026/01/25 ، 2025/03/23');
    expect(line?.[3]).toBe('2 سرعة و 1 حزام');
  });

  it('keeps a book-kept driver (no employee) apart by the name the book wrote', () => {
    const lines = sheet([
      fine('f1', '2023-04-27', '204', null, 't1', 200, 'محمد الشحات'),
      fine('f2', '2023-04-28', '204', null, 't1', 200, 'كامل فتحى'),
      fine('f3', '2023-04-29', '204', null, 't1', 200, 'محمد الشحات'),
    ]);
    expect(lines.map((l) => [l[0], l[4]])).toEqual([
      ['محمد الشحات', '400.00'],
      ['كامل فتحى', '200.00'],
    ]);
  });

  it('leaves a fine with no date off the dates, but still counts it', () => {
    const [line] = sheet([
      fine('f1', null, '204', 'e1', 't1', 300),
      fine('f2', '2026-01-25', '204', 'e1', 't1', 200),
    ]);
    expect(line?.[2]).toBe('2026/01/25');
    expect(line?.[3]).toBe('2 سرعة');
    expect(line?.[4]).toBe('500.00');
  });
});
