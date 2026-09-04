// Employee identity (ADR-017). Two facts, and the second one is the one people actually use.
//
// The **Global Employee Number** is a company-wide, monotonic, zero-padded sequence (e.g. `0125`)
// allocated once at hire. It is branch-agnostic — the company counts employees, not employees per
// branch — and it never changes.
//
// The **Employee Code** is the number carried behind the code of the branch that hired them:
//   Employee Code = <BranchCodeAtHire><GlobalEmployeeNumber>   e.g. 010 + 0004 → 0100004
// It is COMPOSED ONCE, AT HIRE, AND STORED. It is not a projection of where the employee stands
// today, and nothing recomputes it afterwards: not a branch transfer, not a rehire into another
// branch, not an administrator correcting the branch's own code. An employee code is issued, the
// way a badge number is issued.
//
// WHY IT IS FROZEN, since the opposite rule stood here until this change and the reasons were
// real. A derived code keeps the prefix honest about where somebody works. But the code is printed
// on contracts, insurance filings, bank letters and twenty years of paper that nobody reissues, and
// the workforce this system was built to hold demonstrates the company's actual rule: 148 of 2,699
// employees carry a prefix from a branch they no longer work at, because they were transferred and
// their code stayed. Re-deriving would have renamed 148 people on import. The prefix answers "who
// hired you", the employee's `branchId` answers "where are you now", and only the second one moves.
//
// The consequence to keep in mind: `code` is NOT reconstructible from the employee's current row —
// `buildEmployeeCode(currentBranch.code, employeeNumber)` may legitimately differ from `code`. Read
// the stored value; never re-derive one to compare.
//
// Pure format/composition here; the atomic, concurrency-safe allocation lives in
// `employee-sequence.ts`.

/** The single global counter key in the shared `hr_sequences` collection. */
export const EMPLOYEE_SEQUENCE_KEY = 'employee:global';

/**
 * Minimum width of the Global Employee Number (grows past it without truncation).
 *
 * Four, to match the company's own numbering — `0100004` is `010` + `0004` — so every code already
 * issued on paper is the code this system composes. Past 9999 the number simply widens and codes
 * grow a character; nothing truncates and nothing wraps.
 */
export const EMPLOYEE_NUMBER_MIN_DIGITS = 4;

/** Zero-pad the raw global sequence to the permanent Global Employee Number: `125` → `"0125"`. */
export const formatEmployeeNumber = (seq: number): string =>
  String(seq).padStart(EMPLOYEE_NUMBER_MIN_DIGITS, '0');

/**
 * Compose the Employee Code from the HIRING branch's code + the Global Employee Number.
 *
 * Call this ONCE, when the employee is created. Transfers and rehires must not call it — the code
 * they would produce is not the employee's code.
 *
 *   buildEmployeeCode('010', '0004') → '0100004'
 */
export const buildEmployeeCode = (branchCode: string, employeeNumber: string): string =>
  `${branchCode}${employeeNumber}`;
