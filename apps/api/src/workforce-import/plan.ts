// Turning two sheets of rows into ONE plan per person, and refusing the rows that cannot be turned
// into anything true.
//
// Nothing here does I/O. It takes already-parsed rows and answers three questions:
//
//   1. WHO IS THIS. The two sheets overlap: 28 people appear in both, but only 21 of those share a
//      CODE — seven were rehired under a new one. An identity keyed on the code would create those
//      seven twice, as two people who are one person. The NATIONAL ID is the key, with no fallback:
//      the registry requires one anyway, so a row without one is refused rather than identified by
//      something weaker.
//   2. IN WHAT ORDER. A person who left and came back has to be created, exited and rehired in that
//      sequence, so their exit rows are sorted before their serving row. Building them the other way
//      round hits the national-id guard and fails.
//   3. WHAT MUST NOT BE IMPORTED AT ALL. Rows that contradict each other, or that lack what the
//      registry requires, become report lines rather than guesses.
import { formatEmployeeNumber } from '../modules/hr/employee-management/employees/employee-number';
import {
  type EducationLevel,
  type EmployeeExitType,
  type InsuranceStatus,
  type MilitaryStatus,
  type WeaponLicenseType,
} from '@ecms/contracts';

/** The parsed content of one spreadsheet row, before anything is decided about it. */
export interface SourceRow {
  sheet: 'master' | 'resignation';
  /** 1-based row number in that sheet, so a report line points at something a human can open. */
  rowNumber: number;
  code: string | null;
  nationalId: string | null;
  fullNameAr: string | null;
  fullNameEn: string | null;
  hiredAt: Date | null;
  branchName: string | null;
  departmentName: string | null;
  sectionName: string | null;
  jobTitleName: string | null;
  primaryPhone: string | null;
  emergencyPhone: string | null;
  addressLine: string | null;
  governorate: string | null;
  maritalStatus: string | null;
  religion: string | null;
  nationalIdExpiry: Date | null;
  drivingLicenseExpiry: Date | null;
  military: { status: MilitaryStatus | null; certificateRef: string | null; completedAt: Date | null };
  education: {
    level: EducationLevel | null;
    qualification: string | null;
    specialization: string | null;
    institution: string | null;
    graduationYear: number | null;
  };
  /** The SECOND qualification, kept verbatim — `education` holds one, so this becomes a certification. */
  additionalQualification: { qualification: string | null; institution: string | null; year: number | null };
  hasPriorExperience: boolean;
  incentive: number | null;
  insurance: {
    insuranceNumber: string | null;
    occupation: string | null;
    occupationCode: string | null;
    grossWage: number | null;
    contributionWage: number | null;
    basicWage: number | null;
    employerShare: number | null;
    employeeShare: number | null;
    status: InsuranceStatus | null;
  };
  officer: {
    reserveOfficer: boolean;
    rank: string | null;
    weaponLicenseType: WeaponLicenseType | null;
    weaponLicenseExpiry: Date | null;
    professionPractice: boolean;
    retirementDate: Date | null;
  };
  /** Resignation sheet only. */
  exit: { type: EmployeeExitType | null; effectiveDate: Date | null; reason: string | null; note: string | null } | null;
}

/** One person, and every row that speaks about them, in the order they must be applied. */
export interface PersonPlan {
  /** The national ID this person was identified by — the same key both sheets are joined on. */
  nationalId: string;
  /** The Employee Code, taken VERBATIM from the sheet. Never recomposed (ADR-017). */
  code: string;
  /** The 4-digit tail — the Global Employee Number this person was issued. */
  employeeNumber: string;
  /** The 3-char prefix — the branch that HIRED them, which is not always where they are now. */
  branchCodeAtHire: string;
  /** Exit spells first, then the serving row (if any): the order the registry must be walked in. */
  spells: SourceRow[];
  /** The row that describes the person as they stand today — the last spell. */
  current: SourceRow;
  /** True when this person is on the Master sheet: they are serving, not exited. */
  serving: boolean;
}

export interface Rejection {
  sheet: 'master' | 'resignation';
  rowNumber: number;
  code: string | null;
  reason: string;
}

export interface ImportPlan {
  people: PersonPlan[];
  rejected: Rejection[];
}

/** `0100004` → `010` + `0004`. The only place the legacy code is taken apart. */
const CODE_SHAPE = /^(\d{3})(\d{4,})$/u;

const splitCode = (code: string): { branchCode: string; number: string } | null => {
  const m = CODE_SHAPE.exec(code);
  if (m === null) return null;
  return { branchCode: m[1] as string, number: m[2] as string };
};

/** Two dates are the same calendar day. Both are built at UTC midnight, so this is equality. */
const sameDay = (a: Date | null, b: Date | null): boolean =>
  a !== null && b !== null && a.getTime() === b.getTime();

/**
 * Build the import plan.
 *
 * Ordering within a person is by hire date, with the serving row last regardless: somebody's
 * current employment is by definition the one that has not ended.
 */
export const buildPlan = (rows: readonly SourceRow[]): ImportPlan => {
  const rejected: Rejection[] = [];
  const byIdentity = new Map<string, SourceRow[]>();

  for (const row of rows) {
    const reason = unusableReason(row);
    if (reason !== null) {
      rejected.push({ sheet: row.sheet, rowNumber: row.rowNumber, code: row.code, reason });
      continue;
    }
    // `unusableReason` has already refused a row without one, so this is always present.
    const key = row.nationalId as string;
    const list = byIdentity.get(key);
    if (list === undefined) byIdentity.set(key, [row]);
    else list.push(row);
  }

  const people: PersonPlan[] = [];
  for (const [key, group] of byIdentity) {
    const ordered = [...group].sort(orderSpells);

    // Contradictory copies of ONE period — not two periods. Reject the whole person rather than
    // importing an arbitrary half of a contradiction.
    const duplicate = findDuplicatePeriod(ordered);
    if (duplicate !== null) {
      for (const row of ordered) {
        rejected.push({
          sheet: row.sheet,
          rowNumber: row.rowNumber,
          code: row.code,
          reason: `conflicting duplicate rows for one employment (same hire date${
            duplicate.sameExit ? ' and exit date' : ''
          }) — needs a human decision before import`,
        });
      }
      continue;
    }

    const current = ordered[ordered.length - 1] as SourceRow;
    // A person's code comes from the row that describes them TODAY. For the seven rehired under a
    // new code that is the new one, which is what the company's own records show them by.
    const code = current.code as string;
    const parts = splitCode(code);
    if (parts === null) {
      rejected.push({
        sheet: current.sheet,
        rowNumber: current.rowNumber,
        code,
        reason: `employee code "${code}" is not <3-digit branch><4-digit number>`,
      });
      continue;
    }

    people.push({
      nationalId: key,
      code,
      employeeNumber: formatEmployeeNumber(Number(parts.number)),
      branchCodeAtHire: parts.branchCode,
      spells: ordered,
      current,
      serving: ordered.some((r) => r.sheet === 'master'),
    });
  }

  return { people, rejected: rejected.sort(bySheetThenRow) };
};

/**
 * Why a row cannot be imported at all.
 *
 * Deliberately short. Everything the REGISTRY requires is checked here; everything else is allowed
 * through with a null, because an employee with no recorded address is a real employee and refusing
 * them would lose a person to preserve a column.
 */
const unusableReason = (row: SourceRow): string | null => {
  if (row.code === null) return 'no employee code';
  if (row.fullNameAr === null) return 'no Arabic name';
  // The registry requires one — it derives birth date, gender and place of birth from it, and the
  // duplicate-person guard is built on it. Five go-live rows have none, and they are a cell to fill
  // in rather than a person to invent an identity for.
  if (row.nationalId === null) return 'no national ID — the registry requires one';
  if (row.hiredAt === null) return 'no hiring date';
  if (row.branchName === null) return 'no site (الموقع)';
  if (row.departmentName === null) return 'no department (الإدارة)';
  if (row.jobTitleName === null) return 'no job title (الوظيفة)';
  if (row.sheet === 'resignation') {
    if (row.exit === null || row.exit.effectiveDate === null) return 'no exit date';
    if (row.exit.type === null) {
      // Two different problems, and they need different fixes — six go-live rows carry an exit DATE
      // with no reason beside it, which is a cell to fill in rather than a word to teach the
      // importer. There is no `unknown` exit type to fall back on, and inventing `resignation`
      // would put a reason on somebody's file that nobody recorded.
      return row.exit.reason === null
        ? 'exit reason is blank — fill it in and re-run'
        : `exit reason "${row.exit.reason}" is not one of the recognised reasons`;
    }
    // Two rows in the go-live sheet end before they begin (`0200810` hired 2024-10-23 and exited
    // 2024-08-27; `0501484` hired 2025-02-19 and exited 2024-01-05). One of the two dates is wrong
    // and nothing here can tell which, so the row goes to a human rather than into an employment
    // period that runs backwards.
    if (row.exit.effectiveDate.getTime() < row.hiredAt.getTime()) {
      return 'exit date is before the hiring date — one of the two is wrong';
    }
  }
  return null;
};

/** Exits first, oldest first; the serving row always last. */
const orderSpells = (a: SourceRow, b: SourceRow): number => {
  if (a.sheet !== b.sheet) return a.sheet === 'resignation' ? -1 : 1;
  const at = a.hiredAt?.getTime() ?? 0;
  const bt = b.hiredAt?.getTime() ?? 0;
  return at - bt || a.rowNumber - b.rowNumber;
};

/**
 * Two rows describe the same PERIOD rather than two periods when their hire dates agree. One
 * employment cannot start twice.
 *
 * This catches both shapes the go-live workbook contains, which is why the rule is about the hire
 * date rather than about which sheet a row came from:
 *
 *   • Three codes appear twice WITHIN the Resignation sheet with identical hire AND exit dates
 *     (`0100417`, `0300857`, `0100954`) — one employment entered twice. Importing them as two
 *     spells would invent a period of service that never happened.
 *   • Three people appear on BOTH sheets with the same hire date (`0100313`, `0200810`,
 *     `0501600`/`0501484`) — serving and exited for the same employment at once. A genuine rehire
 *     has a LATER hire date on the serving row, which is true of the other 25 who appear on both.
 */
const findDuplicatePeriod = (ordered: readonly SourceRow[]): { sameExit: boolean } | null => {
  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1] as SourceRow;
    const row = ordered[i] as SourceRow;
    if (!sameDay(previous.hiredAt, row.hiredAt)) continue;
    return { sameExit: sameDay(previous.exit?.effectiveDate ?? null, row.exit?.effectiveDate ?? null) };
  }
  return null;
};

const bySheetThenRow = (a: Rejection, b: Rejection): number =>
  a.sheet === b.sheet ? a.rowNumber - b.rowNumber : a.sheet === 'master' ? -1 : 1;
