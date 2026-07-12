// Employee numbering: organization-wide, yearly-reset, `EMP-{YYYY}-{seq:6}` — the immutable,
// human-readable identifier HR uses instead of the Mongo ObjectId. Pure format/parse here;
// the atomic sequence allocation that feeds it lives in `employee-sequence.ts` (needs Mongo).
export const EMPLOYEE_NUMBER_PREFIX = 'EMP';

/** `EMP-2026-000001`. Pads the sequence to 6 digits; longer sequences are not truncated. */
export const formatEmployeeNumber = (year: number, seq: number): string =>
  `${EMPLOYEE_NUMBER_PREFIX}-${year}-${String(seq).padStart(6, '0')}`;

/** The per-year sequence key (yearly reset), namespaced apart from the other counters. */
export const employeeSequenceKey = (year: number): string => `employee:${year}`;

const EMPLOYEE_NUMBER_RE = /^EMP-(\d{4})-(\d{6,})$/;

export const parseEmployeeNumber = (code: string): { year: number; seq: number } | null => {
  const m = EMPLOYEE_NUMBER_RE.exec(code);
  if (m === null) return null;
  return { year: Number(m[1]), seq: Number(m[2]) };
};
