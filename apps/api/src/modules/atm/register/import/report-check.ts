// The 57-number check (spec §6.5, D8): fold the uploaded rows into the Data Report with THE SAME
// code the report page runs (`foldAtmRegisterReport`), and lay each of the sheet's 57 numeric
// cells beside the verified snapshot. Apply is refused unless every cell matches, or the owner
// explicitly overrides (the expected path at cut-over, when the fresh copy has newer receipts).
//
// "Active" is the Excel helper CI, `=IF(A>0,IF(AQ>0,IF(AR="",1,0)))`: a row counts when column A
// holds anything, AQ is set and AR is empty. A row whose A holds a code the register does not know
// is still active to the Excel, so it is counted as the sheet counts it — in its bank cell only
// (`branchCode: null` in the fold), never in a branch cell.
import {
  ATM_DATA_REPORT_CELLS,
  foldAtmRegisterReport,
  isAtmRegisterActive,
  readAtmReportCell,
  type AtmBankCode,
  type AtmRegisterBranchCode,
  type AtmRegisterImportReportCellDto,
  type AtmRegisterReportGroup,
} from '@ecms/contracts';
import { EXPECTED_DATA_REPORT } from './expected-data-report';
import { type ParsedRow } from './parse-rows';

export interface DataReportCheck {
  cells: AtmRegisterImportReportCellDto[];
  allMatch: boolean;
}

/** ACTIVE rows grouped by (EGYCASH code, bank) — the fold's input. */
export const activeReportGroups = (rows: readonly ParsedRow[]): AtmRegisterReportGroup[] => {
  const counts = new Map<string, AtmRegisterReportGroup>();
  for (const row of rows) {
    const { branchCode, bankCode, startDate, endDate } = row.values;
    if (!isAtmRegisterActive({ hasBranch: row.branchCellPresent, startDate, endDate })) continue;
    const key = `${branchCode ?? ''}|${bankCode ?? ''}`;
    const group = counts.get(key);
    if (group === undefined) {
      counts.set(key, {
        branchCode: branchCode satisfies AtmRegisterBranchCode | null,
        bankCode: bankCode satisfies AtmBankCode | null,
        count: 1,
      });
    } else {
      group.count += 1;
    }
  }
  return [...counts.values()];
};

/** Every one of the 57 cells: expected (snapshot), recomputed (this file), and whether they agree. */
export const checkDataReport = (
  rows: readonly ParsedRow[],
  expected: ReadonlyMap<string, number> = EXPECTED_DATA_REPORT,
): DataReportCheck => {
  const counts = foldAtmRegisterReport(activeReportGroups(rows));
  const cells = ATM_DATA_REPORT_CELLS.map((ref): AtmRegisterImportReportCellDto => {
    const recomputed = readAtmReportCell(counts, ref);
    const want = expected.get(ref.key) ?? 0;
    return { ...ref, expected: want, recomputed, matches: recomputed === want };
  });
  return { cells, allMatch: cells.every((cell) => cell.matches) };
};
