// The 57-number check (spec §6.5, §10.2): rows generated from the verified snapshot fold back to
// it exactly; one more machine in operation moves exactly the five cells it should.
import { describe, expect, it } from 'vitest';
import {
  ATM_DATA_REPORT_CELLS,
  ATM_REPORT_SECTION3_BANKS,
  type AtmBankCode,
  type AtmRegisterBranchCode,
} from '@ecms/contracts';
import { EXPECTED_DATA_REPORT } from './expected-data-report';
import { type ParsedRow } from './parse-rows';
import { checkDataReport } from './report-check';

let next = 3;
/** Just enough of a parsed row for the fold: branch cell, bank, dates. */
const row = (
  branchCode: AtmRegisterBranchCode | null,
  bankCode: AtmBankCode | null,
  startDate: string | null,
  endDate: string | null,
  branchCellPresent = branchCode !== null,
): ParsedRow =>
  ({
    importRow: next++,
    values: { branchCode, bankCode, startDate, endDate },
    branchCellPresent,
  }) as unknown as ParsedRow;

/** The snapshot's section-3 matrix as rows, plus history and pending rows that must not count. */
const snapshotRows = (): ParsedRow[] => {
  const rows: ParsedRow[] = [];
  for (const cellRef of ATM_DATA_REPORT_CELLS) {
    if (cellRef.section !== 3 || cellRef.branchCode === null || cellRef.bankCode === null) continue;
    const n = EXPECTED_DATA_REPORT.get(cellRef.key) ?? 0;
    for (let i = 0; i < n; i += 1)
      rows.push(row(cellRef.branchCode, cellRef.bankCode, '2025-01-01', null));
    // Handed back and never-started periods of the same machines: not active, never counted.
    rows.push(row(cellRef.branchCode, cellRef.bankCode, '2024-01-01', '2024-06-01'));
    rows.push(row(cellRef.branchCode, cellRef.bankCode, null, null));
  }
  // A start without a branch is not active either (CI: `A>0` first).
  rows.push(row(null, 'NBE', '2025-01-01', null, false));
  return rows;
};

describe('the 57-number check', () => {
  it('pins 57 cells, each with a snapshot value', () => {
    expect(ATM_DATA_REPORT_CELLS).toHaveLength(57);
    for (const ref of ATM_DATA_REPORT_CELLS) expect(EXPECTED_DATA_REPORT.has(ref.key)).toBe(true);
    expect(EXPECTED_DATA_REPORT.get('s1.total')).toBe(2607);
    expect(EXPECTED_DATA_REPORT.get('s2.total')).toBe(2607);
  });

  it('the snapshot matrix folds back to all 57 numbers', () => {
    const rows = snapshotRows();
    expect(
      rows.filter((r) => r.values.startDate !== null && r.values.endDate === null),
    ).toHaveLength(2607 + 1);
    const check = checkDataReport(rows);
    expect(check.cells.filter((c) => !c.matches)).toEqual([]);
    expect(check.allMatch).toBe(true);
  });

  it('one more NBE machine in Alexandria moves exactly five cells', () => {
    const check = checkDataReport([...snapshotRows(), row('EGYCASH-4', 'NBE', '2026-10-01', null)]);
    const moved = check.cells.filter((c) => !c.matches);
    expect(moved.map((c) => c.key).sort()).toEqual(
      ['s1.NBE', 's1.total', 's2.EGYCASH-4', 's2.total', 's3.EGYCASH-4.NBE'].sort(),
    );
    expect(moved.map((c) => c.cell).sort()).toEqual(['AE3', 'AE12', 'AH5', 'AJ3', 'AK5'].sort());
    for (const c of moved) expect(c.recomputed).toBe(c.expected + 1);
    expect(check.allMatch).toBe(false);
  });

  it('a row with an unknown branch code counts in its bank cell only, as the sheet does', () => {
    const check = checkDataReport([...snapshotRows(), row(null, 'BM', '2026-10-01', null, true)]);
    expect(
      check.cells
        .filter((c) => !c.matches)
        .map((c) => c.key)
        .sort(),
    ).toEqual(['s1.BM', 's1.total'].sort());
  });

  it('section 3 banks run NBE..NXT', () => {
    expect(ATM_REPORT_SECTION3_BANKS).toEqual(['NBE', 'BM', 'CIB', 'HDB', 'BRK', 'NXT']);
  });
});
