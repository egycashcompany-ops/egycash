// The owner's Data Report as verified on the 2026-09-29 save of the workbook (spec §6.5) — the 57
// numbers the import recomputes from the uploaded rows before it lets anything be applied (D8).
//
// COUNTS ONLY: how many machines were in operation per bank, per branch and per branch × bank. No
// machine code, name or other cell of the register is here, which is why the snapshot may live in
// the repository. The cached values were re-computed with 0 mismatches under both the Excel
// formulas and the register's one definition of "active" (D7).
import {
  ATM_REPORT_SECTION3_BANKS,
  type AtmRegisterBranchCode,
  type AtmSeedBankCode,
} from '@ecms/contracts';

/** Section 1 (AD3..AI3 + AJ3): machines in operation per bank — the workbook's six (DEC-35). */
const SECTION1: Record<AtmSeedBankCode, number> = {
  NXT: 4,
  NBE: 1212,
  BM: 1101,
  CIB: 107,
  HDB: 77,
  BRK: 106,
};
const SECTION1_TOTAL = 2607;

/** Section 2 (AD5..AJ5 + AK5): machines in operation per branch. */
const SECTION2: Record<AtmRegisterBranchCode, number> = {
  'EGYCASH-7': 188,
  'EGYCASH-1': 1061,
  'EGYCASH-2': 211,
  'EGYCASH-3': 154,
  'EGYCASH-4': 294,
  'EGYCASH-5': 475,
  'EGYCASH-6': 224,
};
const SECTION2_TOTAL = 2607;

/** Section 3 (rows 8..14 × AE..AJ): per branch, in `ATM_REPORT_SECTION3_BANKS` order. */
const SECTION3: Record<AtmRegisterBranchCode, readonly number[]> = {
  'EGYCASH-1': [487, 412, 60, 43, 57, 2],
  'EGYCASH-5': [198, 177, 47, 27, 24, 2],
  'EGYCASH-2': [85, 126, 0, 0, 0, 0],
  'EGYCASH-3': [86, 68, 0, 0, 0, 0],
  'EGYCASH-4': [138, 156, 0, 0, 0, 0],
  'EGYCASH-6': [62, 162, 0, 0, 0, 0],
  'EGYCASH-7': [156, 0, 0, 7, 25, 0],
};

/** `ATM_DATA_REPORT_CELLS` key (`s1.NBE`, `s2.total`, `s3.EGYCASH-1.NBE`, …) → the snapshot value. */
export const EXPECTED_DATA_REPORT: ReadonlyMap<string, number> = new Map<string, number>([
  ...Object.entries(SECTION1).map(([bank, n]): [string, number] => [`s1.${bank}`, n]),
  ['s1.total', SECTION1_TOTAL],
  ...Object.entries(SECTION2).map(([branch, n]): [string, number] => [`s2.${branch}`, n]),
  ['s2.total', SECTION2_TOTAL],
  ...Object.entries(SECTION3).flatMap(([branch, counts]) =>
    ATM_REPORT_SECTION3_BANKS.map((bank, i): [string, number] => [
      `s3.${branch}.${bank}`,
      counts[i] ?? 0,
    ]),
  ),
]);
