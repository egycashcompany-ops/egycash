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
//   3. WHAT MUST NOT BE IMPORTED AT ALL. Rows that lack what the registry requires become report
//      lines rather than guesses. Repeated rows are NOT among them: one copy is kept and the person
//      goes in — see `collapseCopies`.
import { rowReasons } from './reasons';
import { formatEmployeeNumber } from '../modules/hr/employee-management/employees/employee-number';
import {
  type EducationLevel,
  type EmployeeExitType,
  type InsuranceStatus,
  type LocalizedString,
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
  /**
   * The national ID, when the company holds one — and `null` when it does not.
   *
   * NOT the join key any more: see `identityKey`. Four of the go-live leavers and the company's own
   * first employee predate the paperwork, and refusing them would lose real people to preserve a
   * column.
   */
  nationalId: string | null;
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
  /** Bilingual — the screen is Arabic and a reason in English on it is not a reason. */
  reason: LocalizedString;
}

/** Where a row lives, so the screen can point at it. */
export interface RowRef {
  sheet: 'master' | 'resignation';
  rowNumber: number;
}

/**
 * Copies of one employment that did NOT say the same thing. One was kept and the person went in;
 * this is how the preview tells somebody which, so a wrong pick is caught before it is applied.
 * Identical copies are not listed — there is nothing to check.
 */
export interface DisagreeingCopies {
  code: string;
  name: string;
  kept: RowRef;
  dropped: RowRef[];
}

export interface ImportPlan {
  people: PersonPlan[];
  rejected: Rejection[];
  disagreeing: DisagreeingCopies[];
}

/** `0100004` → `010` + `0004`. The only place the legacy code is taken apart. */
const CODE_SHAPE = /^(\d{3})(\d{4,})$/u;

const splitCode = (code: string): { branchCode: string; number: string } | null => {
  const m = CODE_SHAPE.exec(code);
  if (m === null) return null;
  return { branchCode: m[1] as string, number: m[2] as string };
};

/**
 * What joins a person's rows across the two sheets.
 *
 * The national ID when there is one: it is the identity the company itself deduplicates people by,
 * and it survives a re-code. The EMPLOYEE CODE otherwise — unique by `ux_code`, so two rows sharing
 * one are the same person, and it is the only identity a pre-paperwork employee has.
 *
 * A row without a national ID used to be refused outright. That was too strict: the employee
 * service already stores `nationalId: null` and skips the duplicate check for it, so the registry
 * has always been able to hold such a person — only this planner could not. Five real people were
 * being kept out of their own company's system to preserve a column, among them its first employee.
 *
 * Prefixed so the two key spaces can never collide: a code is 7 digits and a national ID is 14, but
 * relying on that is a coincidence rather than a rule.
 *
 * The one thing this cannot do is rejoin somebody who was REHIRED UNDER A NEW CODE and has no
 * national ID: with no identity that survives the re-code, their two spells read as two people. No
 * go-live row is in that position, and the alternative — guessing by name — would merge namesakes.
 */
const identityKey = (row: SourceRow): string =>
  row.nationalId === null ? `code:${row.code as string}` : `nid:${row.nationalId}`;


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
    const key = identityKey(row);
    const list = byIdentity.get(key);
    if (list === undefined) byIdentity.set(key, [row]);
    else list.push(row);
  }

  const people: PersonPlan[] = [];
  const disagreeing: DisagreeingCopies[] = [];
  for (const group of byIdentity.values()) {
    const collapsed = collapseCopies(group);
    disagreeing.push(...collapsed.disagreeing);
    const ordered = collapsed.spells.sort(orderSpells);

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
        reason: rowReasons.badCodeShape(code),
      });
      continue;
    }

    people.push({
      nationalId: current.nationalId,
      code,
      employeeNumber: formatEmployeeNumber(Number(parts.number)),
      branchCodeAtHire: parts.branchCode,
      spells: ordered,
      current,
      serving: ordered.some((r) => r.sheet === 'master'),
    });
  }

  return { people, rejected: rejected.sort(bySheetThenRow), disagreeing };
};

/**
 * Why a row cannot be imported at all.
 *
 * Deliberately short. Everything the REGISTRY requires is checked here; everything else is allowed
 * through with a null, because an employee with no recorded address is a real employee and refusing
 * them would lose a person to preserve a column.
 */
const unusableReason = (row: SourceRow): LocalizedString | null => {
  if (row.code === null) return rowReasons.noCode();
  if (row.fullNameAr === null) return rowReasons.noArabicName();
  if (row.hiredAt === null) return rowReasons.noHireDate();
  if (row.branchName === null) return rowReasons.noSite();
  if (row.departmentName === null) return rowReasons.noDepartment();
  if (row.jobTitleName === null) return rowReasons.noJobTitle();
  if (row.sheet === 'resignation') {
    if (row.exit === null || row.exit.effectiveDate === null) return rowReasons.noExitDate();
    if (row.exit.type === null) {
      // Two different problems, and they need different fixes — six go-live rows carry an exit DATE
      // with no reason beside it, which is a cell to fill in rather than a word to teach the
      // importer. There is no `unknown` exit type to fall back on, and inventing `resignation`
      // would put a reason on somebody's file that nobody recorded.
      return row.exit.reason === null
        ? rowReasons.exitReasonBlank()
        : rowReasons.exitReasonUnknown(row.exit.reason);
    }
    // Two rows in the go-live sheet end before they begin (`0200810` hired 2024-10-23 and exited
    // 2024-08-27; `0501484` hired 2025-02-19 and exited 2024-01-05). One of the two dates is wrong
    // and nothing here can tell which, so the row goes to a human rather than into an employment
    // period that runs backwards.
    if (row.exit.effectiveDate.getTime() < row.hiredAt.getTime()) {
      return rowReasons.exitBeforeHire();
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
 * ONE ROW PER EMPLOYMENT. Two rows of one person with the same hire date describe one employment,
 * not two — an employment cannot start twice — so exactly one of them is kept and the person goes in.
 *
 * Which one, in the owner's words:
 *
 *   • ON BOTH SHEETS — «لو فى أسماء فى الشيتين .. دا معناه إن الراجل جه وأتعين وبعدين مشي ..
 *     فأنت هتعتمد الأتنين.. توظفه وبعدين تمشية .. دا لو مكانش متوظف أصلاً». The Resignation row is
 *     kept: it is the same employment with its ending written on it. Nothing else is needed for
 *     the rest of that sentence — a person kept from the Resignation sheet is created and exited if
 *     the registry has never seen them, and only exited if it already has (`run.ts`).
 *   • THE SAME SHEET TWICE — «لو فى بيانات متكرره خد واحد منهم وضيفه .. لكن متمنعش البيانات
 *     كلها إنها تتحط». The LAST copy is kept. A list pasted twice is the case this was written
 *     for (36 leavers, rows 2–37 and again 38–73), and there the lower copy is the later paste —
 *     the one with the insurance status filled in.
 *
 * This replaced a refusal. The planner used to hold the WHOLE person back on any repeat, calling
 * byte-identical copies «conflicting»: 78 rows of one upload were refused, 66 of them over copies
 * that agreed on every cell. A person was kept out of the registry to protect against a choice
 * between two answers that were the same.
 *
 * What is not lost is the check. Copies that DISAGREE come back in `disagreeing`, naming the row
 * kept and the rows set aside, so the preview shows it before anything is written. On both sheets
 * the exit is expected to differ — that is the ending — so only a difference elsewhere counts.
 */
const collapseCopies = (
  rows: readonly SourceRow[],
): { spells: SourceRow[]; disagreeing: DisagreeingCopies[] } => {
  const byHireDay = new Map<number, SourceRow[]>();
  for (const row of rows) {
    // Every row here has a hire date: `unusableReason` refused the ones without.
    const day = (row.hiredAt as Date).getTime();
    const copies = byHireDay.get(day);
    if (copies === undefined) byHireDay.set(day, [row]);
    else copies.push(row);
  }

  const spells: SourceRow[] = [];
  const disagreeing: DisagreeingCopies[] = [];
  for (const copies of byHireDay.values()) {
    const kept = keptCopy(copies);
    spells.push(kept);
    const dropped = copies.filter((c) => c !== kept);
    if (dropped.some((c) => !sayTheSame(kept, c))) {
      disagreeing.push({
        code: kept.code as string,
        name: kept.fullNameAr as string,
        kept: { sheet: kept.sheet, rowNumber: kept.rowNumber },
        dropped: dropped.map((c) => ({ sheet: c.sheet, rowNumber: c.rowNumber })),
      });
    }
  }
  return { spells, disagreeing };
};

/** The Resignation copy when there is one — it carries the ending — and otherwise the last row. */
const keptCopy = (copies: readonly SourceRow[]): SourceRow => {
  const ended = copies.filter((c) => c.sheet === 'resignation');
  const pool = ended.length > 0 ? ended : copies;
  return pool.reduce((a, b) => (b.rowNumber > a.rowNumber ? b : a));
};

/**
 * Whether two copies say the same thing about the person. Where they sit never counts; across the
 * two sheets the exit does not count either, because the Resignation copy is the one with the ending.
 */
const sayTheSame = (kept: SourceRow, other: SourceRow): boolean => {
  const ignored = kept.sheet === other.sheet ? WHERE : WHERE_AND_ENDING;
  const a = kept as unknown as Record<string, unknown>;
  const b = other as unknown as Record<string, unknown>;
  return Object.keys(a).every((key) => ignored.has(key) || sameValue(a[key], b[key]));
};

const WHERE = new Set(['sheet', 'rowNumber']);
const WHERE_AND_ENDING = new Set([...WHERE, 'exit']);

const sameValue = (a: unknown, b: unknown): boolean => {
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  return (
    keys.length === Object.keys(y).length && keys.every((key) => sameValue(x[key], y[key]))
  );
};

const bySheetThenRow = (a: Rejection, b: Rejection): number =>
  a.sheet === b.sheet ? a.rowNumber - b.rowNumber : a.sheet === 'master' ? -1 : 1;
