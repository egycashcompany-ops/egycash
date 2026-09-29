// The printed drivers' sheet: ONE line per driver — «يجمع كل مخالفات السائق فى صف واحد يحط
// الاجمالى». The owner picked sample A: the name, every car code and every date the driver was
// fined on, the fines counted by type («2 سرعة و 1 حزام»), and what they come to.
import type { FleetViolationDto } from '@ecms/contracts';
import { reportMoney } from './fleet-report-print';

export interface DriverSheetInput {
  rows: readonly FleetViolationDto[];
  driverOf: (row: FleetViolationDto) => string;
  codeOf: (row: FleetViolationDto) => string;
  typeOf: (row: FleetViolationDto) => string;
  /** The word between two counted types — « و » in Arabic. */
  and: string;
}

/** «2026-06-09T…» → «2026/06/09», the way sample A writes it. */
const dayOf = (date: string | null): string | null =>
  date === null ? null : date.slice(0, 10).replaceAll('-', '/');

/** A person by their employee id; a book-kept row (no employee) by the name the book wrote. */
const keyOf = (row: FleetViolationDto, name: string): string =>
  row.driverEmployeeId === null ? `name:${name}` : `id:${row.driverEmployeeId}`;

const unique = (values: readonly string[]): string[] => [
  ...new Set(values.filter((v) => v !== '')),
];

/**
 * [name, car codes, dates, fines by type, total] per driver, in the order the board shows them.
 * Dates run newest first; codes follow the dates they were fined on; the types are counted, the
 * most frequent first.
 */
export const driverSheetRows = (input: DriverSheetInput): string[][] => {
  const groups = new Map<string, { name: string; rows: FleetViolationDto[] }>();
  for (const row of input.rows) {
    const name = input.driverOf(row);
    const key = keyOf(row, name);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { name, rows: [row] });
    else group.rows.push(row);
  }
  return [...groups.values()].map(({ name, rows }) => {
    const byDate = [...rows].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
    const counts = new Map<string, number>();
    for (const row of byDate) {
      const type = input.typeOf(row);
      if (type !== '') counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    const types = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `${String(count)} ${type}`)
      .join(input.and);
    return [
      name,
      unique(byDate.map(input.codeOf)).join(' ، '),
      unique(byDate.map((row) => dayOf(row.date) ?? '')).join(' ، '),
      types,
      reportMoney(rows.reduce((sum, row) => sum + row.amount, 0)),
    ];
  });
};
