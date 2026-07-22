// Employee identity (ADR-017). The PERMANENT identity is the **Global Employee Number** — a
// company-wide, monotonic, zero-padded sequence (e.g. `000125`) that NEVER changes and is globally
// unique. The displayed **Employee Code** is DERIVED from the employee's CURRENT branch:
//   Employee Code = <CurrentBranchCode><GlobalEmployeeNumber>   e.g. 001 + 000125 → 001000125
// On transfer, ONLY the branch prefix changes (→ 004000125); the Global Employee Number is fixed.
// Pure format/derivation here; the atomic, concurrency-safe allocation lives in `employee-sequence.ts`.

/** The single global counter key in the shared `hr_sequences` collection. */
export const EMPLOYEE_SEQUENCE_KEY = 'employee:global';

/** Minimum width of the Global Employee Number (grows past it without truncation). */
export const EMPLOYEE_NUMBER_MIN_DIGITS = 6;

/** Zero-pad the raw global sequence to the permanent Global Employee Number: `125` → `"000125"`. */
export const formatEmployeeNumber = (seq: number): string =>
  String(seq).padStart(EMPLOYEE_NUMBER_MIN_DIGITS, '0');

/**
 * Derive the displayed Employee Code from the CURRENT branch code + the Global Employee Number.
 * Transferring branches recomputes only the prefix; the Global Employee Number never changes:
 *   buildEmployeeCode('001', '000125') → '001000125'
 *   buildEmployeeCode('004', '000125') → '004000125'
 */
export const buildEmployeeCode = (branchCode: string, employeeNumber: string): string =>
  `${branchCode}${employeeNumber}`;
