// The drivers' report, printed and exported: TWO pages — «صورتين ينزلو مره واحده».
//   1. every fine on its own line: date, car code, driver, type, amount — the form as it was;
//   2. one line per driver: name, EMPLOYEE code, and what their fines come to.
// A fine with no named driver («مجهول») is on neither: «مينفعش يطبع مخالفات السائقيين فقط».
import { isUnknownFleetDriver, type FleetViolationDto } from '@ecms/contracts';

/** The fines the report is about — every one that names a driver. */
export const reportableFines = (rows: readonly FleetViolationDto[]): FleetViolationDto[] =>
  rows.filter((row) => !isUnknownFleetDriver(row));

/** What the report owes: the fines not yet collected — the board's own «إجمالي السائقين» rule. */
export const outstandingTotal = (rows: readonly FleetViolationDto[]): number =>
  rows.filter((row) => !row.collected).reduce((sum, row) => sum + row.amount, 0);

export interface DriverSummaryLine {
  name: string;
  /** The employee code; empty for a driver the old book named and HR does not know. */
  code: string;
  amount: number;
}

/** A person by their employee id; a book-kept row (no employee) by the name the book wrote. */
const keyOf = (row: FleetViolationDto, name: string): string =>
  row.driverEmployeeId === null ? `name:${name}` : `id:${row.driverEmployeeId}`;

/** Page 2 — one line per driver, in the order the board shows them. */
export const driverSummaryLines = (input: {
  rows: readonly FleetViolationDto[];
  driverOf: (row: FleetViolationDto) => string;
  employeeCodeOf: (row: FleetViolationDto) => string;
}): DriverSummaryLine[] => {
  const lines = new Map<string, DriverSummaryLine>();
  for (const row of input.rows) {
    const name = input.driverOf(row);
    const key = keyOf(row, name);
    const line = lines.get(key);
    if (line === undefined) {
      lines.set(key, { name, code: input.employeeCodeOf(row), amount: row.amount });
    } else line.amount += row.amount;
  }
  return [...lines.values()];
};
