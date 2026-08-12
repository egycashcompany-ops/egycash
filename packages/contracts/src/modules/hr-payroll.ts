// Payroll — the pay-item catalog (P-HR-02 / PY-1).
//
// WHAT A PAY ITEM IS. The vocabulary every later payroll phase speaks: a named thing that can
// appear on a payslip line, and the rule for how its amount is arrived at. It carries NO amount
// of its own — an amount belongs to an employee (PY-2) or to a calculation (PY-3), never to the
// definition. So this catalog is what an organization CALLS its earnings and deductions, and
// nothing more.
//
// WHAT IT DELIBERATELY IS NOT. There is no `taxable` flag, no statutory category, no bracket and
// no contribution rule: taxes and social insurance are out of Payroll v1 entirely, and a field
// with no consumer would be a claim about legislation that this system has not been given. When
// those rules arrive they arrive with their own phase.
import { z } from 'zod';
import { LocalizedStringSchema, PaginationQuerySchema, objectId } from '../common/index.js';
import { MoneyAmountSchema, MoneyCurrencySchema } from './hr-payroll-money.js';

/** Which side of the payslip the item lands on. Nothing else reads a sign. */
export const PAY_ITEM_KINDS = ['earning', 'deduction'] as const;
export const PayItemKindSchema = z.enum(PAY_ITEM_KINDS);
export type PayItemKind = z.infer<typeof PayItemKindSchema>;

/**
 * How the amount is arrived at — the item's own meaning, not a future feature flag:
 *
 *   • `fixed`          — a flat amount per period (a housing allowance).
 *   • `perDay`         — an amount × a number of days (an unpaid absence deduction).
 *   • `perMinute`      — an amount × a number of minutes (approved overtime).
 *   • `percentOfBase`  — a percentage of the base salary.
 *
 * The QUANTITIES those bases multiply come from elsewhere and are never derived here: attendance
 * days and minutes arrive through the frozen §15.1 feed, and leave's paid split arrives through
 * the leave ledger's `paidBreakdown`. Payroll prices; it does not re-derive.
 */
export const PAY_ITEM_CALC_BASES = ['fixed', 'perDay', 'perMinute', 'percentOfBase'] as const;
export const PayItemCalcBasisSchema = z.enum(PAY_ITEM_CALC_BASES);
export type PayItemCalcBasis = z.infer<typeof PayItemCalcBasisSchema>;

/**
 * WHICH quantity a `perDay` or `perMinute` item multiplies (PY-4).
 *
 * `calcBasis` says the item is priced per day; it does not say per day of WHAT. A per-day earning
 * might pay for days attended and a per-day deduction might charge for days absent, and nothing in
 * `calcBasis`, in the item's `kind`, or anywhere else in this system decides between them. So the
 * ITEM says it, once, at creation — and every value below is a direct derivation from a field the
 * frozen attendance feed already carries. Nothing here is inferred from a name.
 *
 *   • `attendedDays`            — days whose status is present, late, earlyLeave or lateAndEarly
 *   • `absentDays`              — days whose status is absent
 *   • `leaveDays`               — days whose status is onLeave
 *   • `workedMinutes`           — the sum of the feed's worked minutes
 *   • `lateMinutes`             — the sum of minutes past the shift's grace
 *   • `earlyLeaveMinutes`       — the sum of minutes left early
 *   • `approvedOvertimeMinutes` — approved overtime only; derived-but-unapproved never crosses
 *     the feed at all (attendance D5), so this cannot accidentally price an unapproved minute.
 *
 * `incomplete`, `weekend`, `holiday` and `dayOff` belong to NO group. Whether a day with a missing
 * checkout counts as attendance, or a worked holiday counts twice, is a labour rule — and this
 * system has not been given one.
 */
export const PAY_ITEM_QUANTITY_SOURCES = [
  'attendedDays',
  'absentDays',
  'leaveDays',
  'workedMinutes',
  'lateMinutes',
  'earlyLeaveMinutes',
  'approvedOvertimeMinutes',
] as const;
export const PayItemQuantitySourceSchema = z.enum(PAY_ITEM_QUANTITY_SOURCES);
export type PayItemQuantitySource = z.infer<typeof PayItemQuantitySourceSchema>;

/** The unit each source counts in. Days go with `perDay`, minutes with `perMinute` — §2 coherence. */
export const QUANTITY_SOURCE_UNITS: Record<PayItemQuantitySource, 'days' | 'minutes'> = {
  attendedDays: 'days',
  absentDays: 'days',
  leaveDays: 'days',
  workedMinutes: 'minutes',
  lateMinutes: 'minutes',
  earlyLeaveMinutes: 'minutes',
  approvedOvertimeMinutes: 'minutes',
};

/** The unit a calculation basis needs, or null when it needs no quantity at all. */
export const CALC_BASIS_UNITS: Record<PayItemCalcBasis, 'days' | 'minutes' | null> = {
  fixed: null,
  perDay: 'days',
  perMinute: 'minutes',
  percentOfBase: null,
};

/**
 * The one coherence rule, and it comes from UNITS rather than from legislation: an item priced per
 * day counts something measured in days, an item priced per minute counts minutes, and an item
 * with a flat or percentage basis counts nothing and must name no source.
 */
export const quantitySourceFits = (
  calcBasis: PayItemCalcBasis,
  quantitySource: PayItemQuantitySource | null | undefined,
): boolean => {
  const needed = CALC_BASIS_UNITS[calcBasis];
  if (needed === null) return quantitySource == null;
  return quantitySource != null && QUANTITY_SOURCE_UNITS[quantitySource] === needed;
};

/** Uppercase, no spaces — the stable handle a later phase refers an item by. */
export const PayItemCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(30)
  .regex(/^[A-Z][A-Z0-9_]*$/, 'a pay-item code is uppercase letters, digits and underscores');

const payItemBase = {
  code: PayItemCodeSchema,
  name: LocalizedStringSchema,
  kind: PayItemKindSchema,
  calcBasis: PayItemCalcBasisSchema,
  sortOrder: z.number().int().min(0).max(100_000),
};

export const CreatePayItemSchema = z
  .object({
    ...payItemBase,
    sortOrder: payItemBase.sortOrder.optional(),
    /** Required for `perDay`/`perMinute`, refused for the rest — see `quantitySourceFits`. */
    quantitySource: PayItemQuantitySourceSchema.nullish(),
  })
  .strict()
  .refine((v) => quantitySourceFits(v.calcBasis, v.quantitySource), {
    path: ['quantitySource'],
    message:
      'a per-day item counts days and a per-minute item counts minutes; a fixed or percentage item counts nothing',
  });
export type CreatePayItem = z.infer<typeof CreatePayItemSchema>;

/**
 * `code`, `kind` and `calcBasis` are absent on purpose.
 *
 * A payslip line records which item produced it, so changing what an existing item MEANS would
 * silently restate every payslip that already cites it — a deduction that becomes an earning, or
 * a flat allowance that becomes per-day. Renaming is safe and re-ordering is cosmetic; changing
 * the arithmetic is a different item, and creating one is how you say that.
 *
 * `quantitySource` (PY-4) is absent for exactly the same reason and is the sharpest case of it:
 * switching an item from days-attended to days-absent would turn a payment into a charge over
 * every period already priced with it.
 */
export const UpdatePayItemSchema = z
  .object({
    name: LocalizedStringSchema.optional(),
    sortOrder: payItemBase.sortOrder.optional(),
    status: z.enum(['active', 'archived']).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdatePayItem = z.infer<typeof UpdatePayItemSchema>;

export const ListPayItemsQuerySchema = PaginationQuerySchema.extend({
  kind: PayItemKindSchema.optional(),
  status: z.enum(['active', 'archived']).optional(),
  search: z.string().max(200).optional(),
}).strict();
export type ListPayItemsQuery = z.infer<typeof ListPayItemsQuerySchema>;

export interface PayItemDto {
  id: string;
  code: string;
  name: { ar: string; en: string };
  kind: PayItemKind;
  calcBasis: PayItemCalcBasis;
  /** Which attendance quantity this item multiplies; null unless the basis needs one (PY-4). */
  quantitySource: PayItemQuantitySource | null;
  sortOrder: number;
  /** Archived, never deleted once used: a payslip line must keep naming a real item. */
  status: 'active' | 'archived';
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ── Employee pay items (PY-2) ───────────────────────────────────────────────
//
// WHAT THIS IS. The assignment that gives a catalog item an amount for one employee over one
// dated interval: "this employee has HOUSING at 1,500 from the first of March". The catalog says
// what a thing IS; this says what it is WORTH, to whom, and WHEN. Nothing here calculates
// anything — PY-3 reads these rows and prices a period from them.
//
// WHY THE INTERVAL IS THE RECORD. A raise is not an edit. An amount that changed on the first of
// July has to keep being 1,500 for June, because a payslip already priced June with it — so an
// assignment is never overwritten in place: it is ENDED, and the new amount is a new row. That is
// also why the intervals for one employee × one item may never overlap: on any given day exactly
// one amount is in force, or none, and "which of these two rows applies?" is never a question.
//
// NO PERMISSION OF ITS OWN. These rows ARE compensation, so they are read and written with the
// keys that already govern it — `employee.viewCompensation` and `employee.manageCompensation` —
// under the same scopes. A caller who cannot see an employee's salary cannot see their pay items.

export const CreateEmployeePayItemSchema = z
  .object({
    payItemId: objectId(),
    /**
     * What the item is worth to this employee. Read against the catalog item's `calcBasis`: a
     * per-day or per-minute item states the rate, a `percentOfBase` item states the percentage.
     * The multiplication itself is PY-3's — nothing in PY-2 reads this number arithmetically.
     */
    amount: MoneyAmountSchema.refine((value) => value > 0, {
      message: 'an amount must be greater than zero',
    }),
    /** The same three-letter code every other compensation figure carries; defaults to EGP. */
    currency: MoneyCurrencySchema,
    /** Date-only, Cairo calendar — the first day this amount is in force. */
    effectiveFrom: z.coerce.date(),
    /** Omitted/null = open-ended: in force until something ends it. Inclusive when present. */
    effectiveTo: z.coerce.date().nullish(),
    note: z.string().max(500).optional(),
  })
  .strict()
  .refine((v) => v.effectiveTo == null || v.effectiveTo >= v.effectiveFrom, {
    path: ['effectiveTo'],
    message: 'effectiveTo must be on or after effectiveFrom',
  });
export type CreateEmployeePayItem = z.infer<typeof CreateEmployeePayItemSchema>;

export const ListEmployeePayItemsQuerySchema = PaginationQuerySchema.extend({
  payItemId: objectId().optional(),
  /** Only the assignments whose interval covers this date. */
  activeOn: z.coerce.date().optional(),
}).strict();
export type ListEmployeePayItemsQuery = z.infer<typeof ListEmployeePayItemsQuerySchema>;

/** The catalog item an assignment points at, denormalized so a row can render on its own. */
export interface EmployeePayItemRefDto {
  id: string;
  code: string;
  name: { ar: string; en: string };
  kind: PayItemKind;
  calcBasis: PayItemCalcBasis;
  quantitySource: PayItemQuantitySource | null;
  status: 'active' | 'archived';
}

export interface EmployeePayItemDto {
  id: string;
  employeeId: string;
  payItemId: string;
  /** Null only if the catalog row went missing — the assignment still reads as a record. */
  payItem: EmployeePayItemRefDto | null;
  amount: number;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  note: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * What `DELETE` did — because removing an assignment and ending one are different acts, and the
 * caller does not choose between them: the dates do.
 *
 *   • `removed` — the interval had not started yet, so nothing was ever priced with it and the
 *     row leaves without taking history with it.
 *   • `ended`   — the interval had started, so the row STAYS and is closed as of today. Payroll
 *     will need it to explain what it already paid.
 *   • `alreadyEnded` — the interval was closed before today; nothing to do, and nothing removed.
 */
export const EMPLOYEE_PAY_ITEM_REMOVALS = ['removed', 'ended', 'alreadyEnded'] as const;
export type EmployeePayItemRemoval = (typeof EMPLOYEE_PAY_ITEM_REMOVALS)[number];

export interface RemoveEmployeePayItemResultDto {
  outcome: EmployeePayItemRemoval;
  /** The closed row for `ended`/`alreadyEnded`; null when the row was removed outright. */
  item: EmployeePayItemDto | null;
}

// ── Compensation effects (PY-3) ─────────────────────────────────────────────
//
// WHAT THIS IS. The rules that turn assigned pay items into LINES for one employee over one
// period: what each item is worth this month, given when it was in force and how long the person
// was employed. A computed value, never a stored row — the storing starts with the payroll run
// that has a reason to archive it.
//
// WHAT IT DELIBERATELY IS NOT. There is no tax, no insurance, no run, no payslip and no legal
// rule of any kind. `net` here is earnings minus deductions and nothing else — it is not take-home
// pay, and calling it that would be a claim about legislation this system has not been given.
//
// PY-4 adds the quantity lines: `perDay` and `perMinute` items priced from the FROZEN attendance
// feed and nothing else. Until a period is frozen their figure is unknown rather than zero, and
// the line says so (`pendingQuantity`) instead of guessing.
//
// PY-5 adds the leave lines, and they are the first lines here that NO ONE ASSIGNED. `payRate`
// has been snapshotted on every leave consumption since Leave shipped and read by nothing; a
// leave line is that number finally spent. The rule, granted rather than inferred:
//
//     amount = basicSalary × (100 − payRate)% × days ÷ daysInPeriod
//
// — a DEDUCTION of the shortfall, not an earning. Three consequences worth stating plainly:
// leave paid at 100% produces no line at all (its shortfall is zero); leave at 0% costs exactly
// one day of basic salary per day taken; and the base is the BASIC SALARY ALONE, never basic plus
// allowances and never another item. The divisor is the period's own calendar length, which is
// the same denominator every prorated line here already uses.

/**
 * Whether a line carries a figure yet.
 *
 * `pendingQuantity` is the honest answer for a `perDay` or `perMinute` item: its price is known
 * and its quantity is not, because quantities come from the frozen attendance feed and that
 * arrives with PY-4. Such a line is SHOWN — hiding it would make an assigned item vanish without
 * explanation — and excluded from every total, because a total including a figure nobody computed
 * would be worse than no total at all.
 *
 * `pendingLeaveSnapshot` (PY-5) is a DIFFERENT unknown and deliberately not the same word: the
 * period has no frozen payroll run, so its leave consumptions have never been pinned to a month
 * and this calculation cannot know whether any leave happened at all. A screen has to be able to
 * say which of the two is missing, because the fix differs — one waits for attendance to be
 * frozen, the other for a run to exist.
 */
export const COMPENSATION_LINE_STATES = [
  'computed',
  'pendingQuantity',
  'pendingLeaveSnapshot',
] as const;
export type CompensationLineState = (typeof COMPENSATION_LINE_STATES)[number];

/**
 * Where a line came from (PY-5).
 *
 * Every line until now was a pay item somebody assigned. A leave line is not: it is DERIVED from
 * the run's leave snapshot, so it has no assignment and no catalog row behind it, and the fields
 * that name those are null. This flag is what lets a reader tell the two apart without inferring
 * it from a null.
 */
export const COMPENSATION_LINE_ORIGINS = ['payItem', 'leaveSnapshot'] as const;
export type CompensationLineOrigin = (typeof COMPENSATION_LINE_ORIGINS)[number];

/**
 * Things the reader has to know that are not wrong enough to refuse over.
 *
 *   • `legacyAllowancesIgnored` — the employee still carries the older `employment.allowances[]`
 *     list, which these rules do not read. Counting both lists would double any allowance that
 *     has already been re-recorded as a pay item, so this says so instead of guessing.
 *   • `netBelowZero` — deductions exceeded earnings. Reported exactly as computed: flooring pay at
 *     zero is a labour rule, and no such rule has been given to this system.
 *   • `leaveDaysAlsoPriced` (PY-5) — this employee has a pay item priced on `leaveDays` AND the
 *     leave snapshot produced a line, so one absence is being charged twice by two counts that
 *     are not even equal: `leaveDays` counts every CALENDAR day an attendance row says `onLeave`
 *     (weekends and holidays inside the span included, a half day counted as one), while the
 *     snapshot counts the LEDGER's days by the leave type's own counting mode, halves included.
 *     Neither is wrong and neither is "the" number, so this reports the collision rather than
 *     silently dropping a line the organization deliberately assigned.
 */
export const COMPENSATION_WARNINGS = [
  'legacyAllowancesIgnored',
  'netBelowZero',
  'leaveDaysAlsoPriced',
] as const;
export type CompensationWarning = (typeof COMPENSATION_WARNINGS)[number];

export const CompensationQuerySchema = z
  .object({
    /** `YYYY-MM`, Cairo calendar month — the same period key the attendance feed uses. */
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'a period is YYYY-MM'),
  })
  .strict();
export type CompensationQuery = z.infer<typeof CompensationQuerySchema>;

/**
 * One priced line.
 *
 * It carries its DERIVATION, not just its result: the base it was taken from, the proration
 * factor, and the day counts on both sides of that fraction. A figure that cannot explain itself
 * has no place on something an employee will ask about.
 */
export interface CompensationLineDto {
  /** `payItem` for an assigned line, `leaveSnapshot` for a line derived from a run (PY-5). */
  origin: CompensationLineOrigin;
  /** Null on a derived line — there is no assignment and no catalog row behind it. */
  sourceAssignmentId: string | null;
  payItemId: string | null;
  code: string;
  name: { ar: string; en: string };
  kind: PayItemKind;
  calcBasis: PayItemCalcBasis;
  currency: string;
  /** The assignment's own figure: an amount for `fixed`, a percentage for `percentOfBase`. */
  baseAmount: number;
  /**
   * `daysInForce / daysInPeriod` for a flat or percentage line.
   *
   * ALWAYS null for a quantity line (PY-4), and that is arithmetic rather than an omission: the
   * quantity was already counted over the days the item was in force, so multiplying by this
   * fraction as well would charge the same absence twice.
   */
  prorationFactor: number | null;
  daysInForce: number;
  daysInPeriod: number;
  /** How many days or minutes this line priced; null when no quantity applies or none is known. */
  quantity: number | null;
  /** Which attendance quantity it was, so the figure can explain itself (PY-4). */
  quantitySource: PayItemQuantitySource | null;
  quantityUnit: 'days' | 'minutes' | null;
  /**
   * When the attendance period this quantity came from was frozen — which VERSION of the truth
   * was priced. A frozen row never moves, so the same period always prices the same.
   */
  feedFrozenAt: string | null;
  /**
   * The pay rate the leave was consumed at, as the ledger snapshotted it (PY-5).
   *
   * Null on every pay-item line. On a leave line it is the percentage the employee WAS paid, so
   * the line's own `baseAmount` — the percentage actually charged — is `100 - leavePayRate`.
   * Carrying both makes the subtraction visible instead of asking the reader to trust it.
   */
  leavePayRate: number | null;
  /** The leave type this line came from, so a figure names its own absence (PY-5). */
  leaveTypeCode: string | null;
  /** Integer minor units — the exact figure. Null while the line is in a pending state. */
  amountMinor: number | null;
  amount: number | null;
  state: CompensationLineState;
}

/**
 * What the run's leave snapshot held for this employee in this period (PY-5).
 *
 * Facts, not money: the days and the rates they were consumed at, exactly as PY-6 pinned them.
 * The lines above are what those come to; this is what they were. A figure nobody can trace back
 * to a day count is not something an employee can be answered with.
 */
export interface LeavePayFactsDto {
  /** The frozen run these facts were read from — the version of the truth being priced. */
  runId: string;
  /** When that run pinned them. */
  snapshotAt: string;
  /** Days as the LEDGER counted them (the leave type's counting mode), halves included. */
  totalDays: number;
  /** Σ days × payRate/100 — the days the employee was paid for. */
  paidDays: number;
  /** Σ days × (100 − payRate)/100 — the shortfall the deduction lines charge. */
  unpaidDays: number;
  /** Days grouped by the rate they were consumed at; never averaged into one rate. */
  byRate: { payRate: number; days: number }[];
}

export interface CompensationEffectsDto {
  employeeId: string;
  period: string;
  /** `YYYY-MM-DD` bounds of the period, inclusive. */
  from: string;
  to: string;
  /** The one currency the whole calculation is in — the basic salary's. */
  currency: string;
  basicSalary: number;
  /** Calendar days of the period the employee was actually employed for (inclusive). */
  employmentDaysInPeriod: number;
  daysInPeriod: number;
  earnings: CompensationLineDto[];
  deductions: CompensationLineDto[];
  /** Lines with no figure yet — shown, never totalled (see `pendingQuantity`). */
  deferred: CompensationLineDto[];
  /**
   * The leave facts behind any leave line, or null when the period has no frozen run (PY-5).
   *
   * Null is "not knowable yet", never "no leave was taken": without a run the consumptions have
   * never been pinned to a month, and a `pendingLeaveSnapshot` line in `deferred` says so.
   */
  leave: LeavePayFactsDto | null;
  totalEarningsMinor: number;
  totalEarnings: number;
  totalDeductionsMinor: number;
  totalDeductions: number;
  /** Earnings minus deductions. NOT take-home pay: no tax or contribution exists yet. */
  netMinor: number;
  net: number;
  warnings: CompensationWarning[];
}

// ── Payroll runs (PY-6) ─────────────────────────────────────────────────────
//
// WHAT A RUN IS. One payroll period, and the moment its facts stopped moving. It is the ONLY
// thing in this system that calls the attendance freeze, and the only place a leave consumption
// is pinned to a period. Everything downstream prices against a run's frozen facts rather than
// against today's data.
//
// WHAT A RUN IS NOT. It calculates nothing and stores no figure. No line, no total, no payslip,
// no tax, no contribution. Those arrive with the phases that are given them; a run's whole job is
// to make sure the numbers they will use cannot change underneath them.
//
// THERE IS NO UNFREEZE, here or anywhere. Cancelling a run changes the RUN's status and nothing
// else: frozen attendance rows stay frozen, the leave snapshot is left exactly as written, and a
// later recalculation happens through a NEW run rather than by editing a cancelled one.

export const PAYROLL_RUN_STATUSES = ['draft', 'frozen', 'cancelled'] as const;
export const PayrollRunStatusSchema = z.enum(PAYROLL_RUN_STATUSES);
export type PayrollRunStatus = z.infer<typeof PayrollRunStatusSchema>;

/**
 * How a snapshot row's pay split was arrived at — recorded per row so the derivation is visible
 * rather than dissolved into a number.
 *
 *   • `whole`         — the ledger entry lies entirely inside the period, so its own breakdown was
 *                       copied verbatim. No judgement was exercised at all, and this is the
 *                       majority case.
 *   • `chronological` — the entry straddles the period boundary, so the tiers were laid over the
 *                       days in date order. That order is what the tier model already means (the
 *                       first days consumed fill the first tier), but it is an inference, so every
 *                       row that relied on it says so.
 */
export const PAYROLL_LEAVE_ALLOCATIONS = ['whole', 'chronological'] as const;
export const PayrollLeaveAllocationSchema = z.enum(PAYROLL_LEAVE_ALLOCATIONS);
export type PayrollLeaveAllocation = z.infer<typeof PayrollLeaveAllocationSchema>;

export const CreatePayrollRunSchema = z
  .object({
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'a period is YYYY-MM'),
    note: z.string().max(500).optional(),
  })
  .strict();
export type CreatePayrollRun = z.infer<typeof CreatePayrollRunSchema>;

export const FreezePayrollRunSchema = z.object({ version: z.number().int().min(0) }).strict();
export type FreezePayrollRun = z.infer<typeof FreezePayrollRunSchema>;

export const CancelPayrollRunSchema = z
  .object({ reason: z.string().trim().min(3).max(500), version: z.number().int().min(0) })
  .strict();
export type CancelPayrollRun = z.infer<typeof CancelPayrollRunSchema>;

export const ListPayrollRunsQuerySchema = PaginationQuerySchema.extend({
  status: PayrollRunStatusSchema.optional(),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
}).strict();
export type ListPayrollRunsQuery = z.infer<typeof ListPayrollRunsQuerySchema>;

export interface PayrollRunDto {
  id: string;
  period: string;
  /** `YYYY-MM-DD` bounds of the period, inclusive. */
  from: string;
  to: string;
  status: PayrollRunStatus;
  frozenAt: string | null;
  frozenBy: string | null;
  /** What the attendance freeze reported — which version of the truth this run pinned. */
  attendanceFrozenRows: number;
  attendanceComputedRows: number;
  leaveSnapshotRows: number;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  note: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * One leave consumption as this run pinned it: the slice inside the period, and that slice's own
 * pay split. Payroll reads THIS, never the live ledger — a request can complete, be cancelled or
 * return early after a period is priced, and the ledger would answer differently tomorrow.
 */
export interface PayrollLeaveSnapshotDto {
  id: string;
  runId: string;
  period: string;
  employeeId: string;
  /** Provenance: the ledger entry this row pinned, and the request and type behind it. */
  ledgerEntryId: string;
  requestId: string | null;
  typeId: string;
  typeCode: string;
  /** The slice INSIDE this period, inclusive; `days` counts it in half-day steps. */
  from: string;
  to: string;
  days: number;
  breakdown: LeavePaidBreakdown[];
  allocation: PayrollLeaveAllocation;
  snapshotAt: string;
}

/**
 * The pay split of consumed leave days, as Leave snapshotted it (R7): `payRate` is a percentage.
 *
 * Restated here rather than imported so the payroll contract can be read on its own — the shape is
 * Leave's and this module never writes it. WHAT the percentage applies to is not decided here and
 * is not decided by PY-6 at all: pricing a leave day arrives with PY-5.
 */
export interface LeavePaidBreakdown {
  days: number;
  payRate: number;
}
