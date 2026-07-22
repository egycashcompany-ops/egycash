// Branch-based Employee Code (ADR-017): `<BranchCode><GlobalSequence>`. The running number is a
// SINGLE GLOBAL counter across the whole company — not per-branch — so the numeric suffix never
// repeats anywhere; the branch-code prefix ties the code to the employee's hiring branch. Pure
// format here; the atomic, concurrency-safe allocation lives in `employee-sequence.ts`.
//
// Examples (branch 001 then 002, global sequence 1,2,3,4,5):
//   001001 · 001002 · 002003 · 003004 · 001005   (branch 001, global 25 → 001025)

/** The single global counter key in the shared `hr_sequences` collection. */
export const EMPLOYEE_SEQUENCE_KEY = 'employee:global';

/** Minimum width of the global running number (grows past it without truncation). */
export const EMPLOYEE_SEQUENCE_MIN_DIGITS = 3;

/** `001` + `025` → `001025`. Longer sequences are not truncated. */
export const formatEmployeeCode = (branchCode: string, seq: number): string =>
  `${branchCode}${String(seq).padStart(EMPLOYEE_SEQUENCE_MIN_DIGITS, '0')}`;
