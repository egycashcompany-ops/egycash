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
// `adjustment` is P-HR-04: a one-off bonus or penalty decided for one month. It is the third
// source the engine takes, after the pay-item assignment and the leave snapshot, and it is the
// only one that is NOT prorated — its amount is the amount somebody approved.
//
// `loanInstallment` is P-HR-05-B: the month's instalment of a debt the employee already received
// in cash. Like an adjustment it is never prorated, and unlike every other origin it is ALWAYS a
// deduction. The engine learns nothing else about the loan behind it — not its balance, not its
// schedule, not its status — because a repayment plan is not a payroll rule.
export const COMPENSATION_LINE_ORIGINS = [
  'payItem',
  'leaveSnapshot',
  'adjustment',
  'loanInstallment',
] as const;
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

/**
 * The run's lifecycle (PY-6, governed in P-HR-10).
 *
 * THE ORDER IS FORCED BY THE DOMAIN, not chosen. A payslip is issued FROM a frozen run, so until
 * the freeze there are no figures to review and nothing to approve — approval can only FOLLOW the
 * lock, never precede it.
 *
 *   draft → frozen → approved → paid → closed,  with `cancel` reachable up to `approved`.
 *
 * `cancelled` stops there on purpose: once a run is `paid`, money has left, and a status flip
 * cannot call it back. A payment recorded in error is corrected in a later period — the same
 * forward-only stance the rest of payroll takes about a closed month.
 */
export const PAYROLL_RUN_STATUSES = [
  'draft',
  'frozen',
  'approved',
  'paid',
  'closed',
  'cancelled',
] as const;

/** The states a run may still be cancelled from — before any money has moved. */
export const CANCELLABLE_PAYROLL_RUN_STATUSES = ['draft', 'frozen', 'approved'] as const;
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

/**
 * Approving the figures a frozen run produced (P-HR-10).
 *
 * A note and a version, and deliberately no amount of any kind: approval agrees with what the run
 * ALREADY says. A figure here would be a second opinion about money, which is a different act.
 */
export const ApprovePayrollRunSchema = z
  .object({ note: z.string().trim().max(500).optional(), version: z.number().int().min(0) })
  .strict();
export type ApprovePayrollRun = z.infer<typeof ApprovePayrollRunSchema>;

/**
 * Recording that the payroll was PAID (P-HR-10).
 *
 * `paidOn` is a date-only, because a payroll is paid on a day rather than at an instant, and a
 * reference is the organization's own — a transfer number, a cheque, a batch id. ECMS pays nobody:
 * this records that a payment happened elsewhere, exactly as a loan disbursement does.
 *
 * NO amount and NO bank details. The figures are the payslips', and a bank file is not this scope.
 */
export const PayPayrollRunSchema = z
  .object({
    paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a payment date is YYYY-MM-DD'),
    reference: z.string().trim().max(200).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type PayPayrollRun = z.infer<typeof PayPayrollRunSchema>;

/** Closing a paid run — it moves nothing and asserts nothing new; the month is simply finished. */
export const ClosePayrollRunSchema = z
  .object({ note: z.string().trim().max(500).optional(), version: z.number().int().min(0) })
  .strict();
export type ClosePayrollRun = z.infer<typeof ClosePayrollRunSchema>;

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
  /** The governance stamps (P-HR-10) — each written by exactly one transition, and never cleared. */
  approvedAt: string | null;
  approvedBy: string | null;
  approvalNote: string | null;
  paidAt: string | null;
  paidBy: string | null;
  /** The day the money actually left, which is not the instant it was recorded. */
  paidOn: string | null;
  paymentReference: string | null;
  closedAt: string | null;
  closedBy: string | null;
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

// ── Payslips (PY-7) ─────────────────────────────────────────────────────────
//
// WHAT A PAYSLIP IS, AND WHY IT STORES RATHER THAN PROJECTS.
//
// A payslip is one employee's pay for one run, WRITTEN DOWN. Not a view of today's data — a copy
// of the figures as they stood the moment it was issued. That is not a preference; it is forced
// by what the compensation calculation actually reads. Two of its inputs are frozen by the run
// (attendance rows, the leave snapshot) and three are NOT:
//
//   • `employment.salary` is a single current value that a `salaryChange` action OVERWRITES —
//     there is no dated salary history on the employee, so a raise recorded in June silently
//     restates what May's calculation returns.
//   • a pay-item assignment may be created with a backdated `effectiveFrom`, including into a
//     period whose run is already frozen; nothing refuses it.
//   • a catalog item's display name is editable, and a line copies that name when it is priced.
//
// So re-reading a frozen period does NOT reliably reproduce the same figures, and a payslip that
// recomputed on every view would restate a document somebody was already paid against. It stores
// its lines instead, and the run it names is the version of the truth behind them.
//
// WHAT IT STILL IS NOT. No tax, no contribution, no bank file, no signature and no `gross`: the
// basic salary is not a line in this system, so a "total pay before deductions" would be either
// `totalEarnings` under another name or a figure combining basic and earnings that no rule here
// grants. `net` is earnings minus deductions, exactly as everywhere else in this module.
//
// AND IT IS NEVER PARTIAL. A line with no figure — an unpriced quantity, an unsettled leave —
// keeps the payslip from being issued at all rather than appearing on it as a blank. A payslip
// with a hole is not a payslip, so `deferred` has no place on this DTO: an employee whose
// calculation is not complete is REPORTED as skipped, with the reason.

/**
 * Why an employee in a run got no payslip.
 *
 * Every one of these is a state the calculation can legitimately be in, so a batch reports them
 * and carries on rather than failing whole. What none of them is, is a payslip: an issued
 * document with a missing figure would be worse than an absent one.
 */
export const PAYSLIP_SKIP_REASONS = [
  /** No basic salary recorded — a percentage of nothing cannot be priced (PY-3 refuses it). */
  'noBasicSalary',
  /** A line has no figure yet: an unpriced quantity or unpinned leave (PY-4 / PY-5). */
  'pendingLine',
  /** Nothing was in force this period — no earning, no deduction, nothing to state. */
  'noLines',
  /** An assignment in another currency than the salary; PY-3 refuses to mix them. */
  'mixedCurrency',
] as const;
export type PayslipSkipReason = (typeof PAYSLIP_SKIP_REASONS)[number];

/**
 * Who the payslip was for, as they were WHEN IT WAS ISSUED.
 *
 * Copied rather than joined, for the same reason the lines are: a payslip is handed to a person
 * and kept, and a transfer next month must not silently retitle a document that was already
 * delivered. Deliberately minimal — identity and role, nothing else.
 */
export interface PayslipEmployeeDto {
  code: string;
  fullNameAr: string;
  fullNameEn: string | null;
  jobTitle: { ar: string; en: string } | null;
}

export interface PayslipDto {
  id: string;
  /** The frozen run these figures were priced against — the version of the truth behind them. */
  runId: string;
  /**
   * That run's status AS IT STANDS NOW — read at read time, never stored (audit finding A1).
   *
   * WHY IT IS HERE. `ux_live_period` deliberately excludes `cancelled`, so a period can be
   * recalculated by a NEW run after the first is cancelled — and the first run's payslips survive
   * it, because a payslip is a document nobody may edit. Since P-HR-20 and PY-11 list a person's
   * payslips ACROSS runs, a recalculated month shows two, and until now nothing said that one of
   * them came from a run that was cancelled.
   *
   * WHY IT IS NOT COPIED ONTO THE ROW, when every other figure on a payslip is. The rest of this
   * document is a snapshot precisely because its inputs change underneath it; this one is the
   * opposite — the question being asked is what the run's status is TODAY, and a stored copy would
   * have to be rewritten across every payslip of a run at the moment it is cancelled. That is a
   * bulk write into the one collection this system refuses to rewrite.
   *
   * `null` only if the cited run cannot be read. No path deletes a run, so this is unreachable in
   * practice — it is stated rather than filled with a status that was never recorded.
   */
  runStatus: PayrollRunStatus | null;
  /**
   * The cost centre this payslip was issued against (P-HR-23), or null when the employee held
   * none on the last day of the period.
   *
   * A SNAPSHOT, exactly like `branchId` beside it: resolved once at issue and written under
   * `$setOnInsert`, so re-running the issue pass cannot move it and editing the employee's
   * assignment afterwards cannot reach a document that was already handed over. Nothing in the
   * calculation reads it — it is an axis for reporting, never an input to a figure.
   */
  costCenterId: string | null;
  period: string;
  /** `YYYY-MM-DD` bounds of the period, inclusive. */
  from: string;
  to: string;
  employeeId: string;
  employee: PayslipEmployeeDto;
  /** The one currency the whole document is in — the basic salary's. */
  currency: string;
  basicSalary: number;
  employmentDaysInPeriod: number;
  daysInPeriod: number;
  /** The lines exactly as they were priced, each still carrying its own derivation. */
  earnings: CompensationLineDto[];
  deductions: CompensationLineDto[];
  /** The leave facts behind any leave line — days and rates, never money. */
  leave: LeavePayFactsDto | null;
  totalEarningsMinor: number;
  totalEarnings: number;
  totalDeductionsMinor: number;
  totalDeductions: number;
  /** Earnings minus deductions. NOT take-home pay: no tax or contribution exists yet. */
  netMinor: number;
  net: number;
  warnings: CompensationWarning[];
  issuedAt: string;
  issuedBy: string;
  createdAt: string;
}

/**
 * Issuing a run's payslips takes NOTHING.
 *
 * Not a figure, not an employee list, not a rate: who is covered follows from the period (everyone
 * employed for any part of it) and what each is owed follows from the run's frozen facts. A body
 * that could name either would be a second way to answer a question the run already answers.
 */
export const GeneratePayslipsSchema = z.object({}).strict();
export type GeneratePayslips = z.infer<typeof GeneratePayslipsSchema>;

/**
 * What one issuing pass did.
 *
 * `existing` is not an error and not a write: issuing is idempotent, so a repeated pass reports
 * what was already there rather than restating it with today's numbers. That is the whole reason
 * a payslip stores its lines, applied to its own re-run.
 */
export interface GeneratePayslipsResultDto {
  runId: string;
  period: string;
  /** Employees employed for any part of the period — the batch's whole population. */
  considered: number;
  created: number;
  existing: number;
  skipped: { employeeId: string; reason: PayslipSkipReason }[];
}

export const ListPayslipsQuerySchema = PaginationQuerySchema.extend({
  employeeId: objectId().optional(),
  period: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'a period is YYYY-MM')
    .optional(),
}).strict();
export type ListPayslipsQuery = z.infer<typeof ListPayslipsQuerySchema>;

// ── Run reconciliation (P-HR-15-A) ───────────────────────────────────────────
//
// IDENTITIES, NOT OPINIONS. Every figure below is a sum or a count over documents this system has
// already written, so each line either agrees with the payslips or something is wrong. Nothing here
// is a report: which reports exist, for whom and with which columns is a requirement nobody has
// given, and it stays blocked (design §3).
//
// WHAT IS ABSENT ON PURPOSE. No tax, insurance or GL view — those are P-HR-12 and P-HR-14 and are
// blocked on their own rules. Nothing exportable — PY-12 is closed. And no loan-ledger figure: that
// check would need the P-HR-05-B port widened, which is an architectural decision rather than a
// reporting one (design §4).

/**
 * A run's money, summed PER CURRENCY.
 *
 * Not one total. The engine refuses a mixed-currency employee, but nothing says two employees must
 * share a currency — so adding them together would be a defect wearing the costume of a summary.
 */
export interface PayrollRunTotalsDto {
  currency: string;
  payslips: number;
  totalEarningsMinor: number;
  totalEarnings: number;
  totalDeductionsMinor: number;
  totalDeductions: number;
  netMinor: number;
  net: number;
}

/**
 * Who should have been paid, against who was.
 *
 * `employedInPeriod` is the SAME population PY-7 issues from — `employedDuring` over the employee's
 * spans — so a gap here is the gap that batch left, not a second opinion about who works here.
 */
export interface PayrollRunCoverageDto {
  employedInPeriod: number;
  withPayslip: number;
  /** Employed for part of the period and holding no payslip from this run. */
  withoutPayslip: number;
}

/**
 * Approved adjustments for the period, against what actually reached a payslip.
 *
 * A difference is not an error and is not named one: the ordinary cause is an adjustment approved
 * AFTER the run issued its payslips, which P-HR-04 permits and P-HR-08 has a forward path for. It
 * is reported because somebody settling a month needs to see it, not because somebody erred.
 */
export interface PayrollRunAdjustmentReconciliationDto {
  currency: string;
  approvedForPeriod: number;
  approvedMinor: number;
  /** The `adjustment`-origin lines actually present on this run's payslips. */
  onPayslipsMinor: number;
  /** `approvedMinor - onPayslipsMinor`. Zero when every approved amount was priced. */
  differenceMinor: number;
}

export interface PayrollRunReconciliationDto {
  runId: string;
  period: string;
  status: PayrollRunStatus;
  /** Empty when the run has issued nothing — a draft reconciles to zero rather than to an error. */
  totals: PayrollRunTotalsDto[];
  coverage: PayrollRunCoverageDto;
  adjustments: PayrollRunAdjustmentReconciliationDto[];
}

// ── What a run cost, along the dimensions it already carries (P-HR-14 / U14-1) ─
//
// WHAT THIS IS. The run's own payslip lines, summed and grouped by the keys those lines already
// store: the currency, the direction (`kind`), what produced the line (`origin`), the catalog item
// behind it, and the branch the payslip was issued in. Every one of those is a field written at
// issue time — nothing here is derived, mapped, or decided.
//
// WHAT THIS IS NOT, AND MUST NEVER BECOME. It is **not** a general-ledger posting. There is no
// chart of accounts in this system, no account mapping, no posting rule, no journal entry and no
// entity that could hold one, and none of those is invented here: they are accounting decisions
// nobody has given, and P-HR-14's discovery keeps them open. This shape is the ARITHMETIC that
// such a posting would one day consume — it happens to be exactly the figures a journal needs,
// which is why it can be built now, and it names no account, which is why building it decides
// nothing.
//
// NO NET, ANYWHERE. Earnings and deductions are summed as positive amounts inside their own `kind`
// group and never subtracted from one another. Netting them across origins would be an accounting
// choice about what offsets what — and the run's true net already exists, once, in the
// reconciliation.
//
// PER CURRENCY, ALWAYS. There is no exchange rate in this system, so a total spanning currencies
// would be a defect wearing the costume of a summary. Currency is a group key in all three splits.

/** One (currency, kind, origin) cell — what that source contributed, and over how many lines. */
export interface PayrollRunCostRowDto {
  currency: string;
  kind: PayItemKind;
  origin: CompensationLineOrigin;
  /** How many payslip lines are behind the figure — a count of terms, not of employees. */
  lines: number;
  amountMinor: number;
  amount: number;
}

/**
 * The same money, split by the catalog item behind each line.
 *
 * `origin` is kept beside the item because it is what EXPLAINS a null `payItemId`: a leave or loan
 * line has no catalog row at all, and its `code` is the fixed one the engine gave it.
 */
export interface PayrollRunCostByPayItemDto {
  currency: string;
  kind: PayItemKind;
  origin: CompensationLineOrigin;
  payItemId: string | null;
  code: string;
  lines: number;
  amountMinor: number;
  amount: number;
}

/**
 * The same money, split by the branch the PAYSLIP was issued in.
 *
 * `branchId` is denormalized onto the payslip at issue time (ADR-015), so this answers "which
 * branch paid this" as it stood then, not as the employee's record stands today — the only reading
 * the stored data supports.
 *
 * `origin` is deliberately absent here: it would multiply every branch by four with nothing gained,
 * and the origin question is already answered in full by `byOrigin`.
 */
export interface PayrollRunCostByBranchDto {
  currency: string;
  kind: PayItemKind;
  branchId: string | null;
  /** Resolved for display only. Null when the branch cannot be read — never a reason to omit money. */
  branchName: { ar: string; en: string } | null;
  lines: number;
  amountMinor: number;
  amount: number;
}

export interface PayrollRunCostBreakdownDto {
  runId: string;
  period: string;
  status: PayrollRunStatus;
  /** Empty when the run has issued nothing — a draft costs zero rather than erroring. */
  byOrigin: PayrollRunCostRowDto[];
  byPayItem: PayrollRunCostByPayItemDto[];
  byBranch: PayrollRunCostByBranchDto[];
}

// ── Payroll adjustments — bonuses and penalties (P-HR-04) ────────────────────
//
// One amount, for one person, for one month, because somebody decided so. That sentence is the
// whole entity, and every field below is part of it.
//
// WHY THIS IS NOT A PAY ITEM. A pay item is a RATE — a `fixed` one prorates by the days it was in
// force, two assignments of it may not overlap, an open-ended one pays every month forever, and it
// carries no reason and no approver. None of that fits a decision to pay somebody 5,000 once, in
// March, for finishing a project. So this is a source of its own, in the same shape the engine has
// taken a new source twice already (PY-4 attendance, PY-5 leave): a port plus an `origin`.
//
// The frozen decisions are in docs/12-planning/payroll-adjustments-design.md.

export const PAYROLL_ADJUSTMENT_KINDS = ['bonus', 'penalty'] as const;
export const PayrollAdjustmentKindSchema = z.enum(PAYROLL_ADJUSTMENT_KINDS);
export type PayrollAdjustmentKind = z.infer<typeof PayrollAdjustmentKindSchema>;

/**
 * D1 — one approval by a second person, in the shape Contracts already uses.
 *
 * `reject` returns the entry to `draft` rather than to a terminal state, so a mistake can be
 * corrected and resubmitted; a rejection is a note on the way to a decision, not the decision.
 * `cancelled` is reachable from any live state and is the ONLY thing that can happen to an entry
 * once it is `approved` — an approved figure is the record of a decision, not a working note.
 */
export const PAYROLL_ADJUSTMENT_STATUSES = [
  'draft',
  'pendingApproval',
  'approved',
  'cancelled',
] as const;
export const PayrollAdjustmentStatusSchema = z.enum(PAYROLL_ADJUSTMENT_STATUSES);
export type PayrollAdjustmentStatus = z.infer<typeof PayrollAdjustmentStatusSchema>;

const adjustmentPeriod = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'a period is YYYY-MM');

export const CreatePayrollAdjustmentSchema = z
  .object({
    /** The Cairo month this is paid or deducted in — the binding to payroll (D5: exactly one). */
    period: adjustmentPeriod,
    kind: PayrollAdjustmentKindSchema,
    /** Always POSITIVE. Direction is `kind`'s job; a negative bonus is a penalty written unclearly. */
    amount: MoneyAmountSchema.refine((value) => value > 0, { message: 'an amount must be positive' }),
    /** Must equal the employee's basic-salary currency — PY-3 refuses to total two currencies. */
    currency: MoneyCurrencySchema,
    /** Required: a payment nobody can explain is not a payment anybody should make. */
    reason: z.string().min(1).max(500),
    /** D4 — optional. Lends the line its identity; never its arithmetic. */
    payItemId: objectId().optional(),
    note: z.string().max(1000).optional(),
    /** Uploaded first through the adjustment attachment endpoint, as personnel actions do. */
    attachmentFileId: objectId().optional(),
  })
  .strict();
export type CreatePayrollAdjustment = z.infer<typeof CreatePayrollAdjustmentSchema>;

/** Editing is a DRAFT-only act (D1) — every field of the decision, restated. */
export const UpdatePayrollAdjustmentSchema = CreatePayrollAdjustmentSchema.partial()
  .extend({ version: z.number().int().min(0) })
  .strict();
export type UpdatePayrollAdjustment = z.infer<typeof UpdatePayrollAdjustmentSchema>;

export const SubmitPayrollAdjustmentSchema = z
  .object({ version: z.number().int().min(0) })
  .strict();
export type SubmitPayrollAdjustment = z.infer<typeof SubmitPayrollAdjustmentSchema>;

export const DecidePayrollAdjustmentSchema = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    note: z.string().max(500).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type DecidePayrollAdjustment = z.infer<typeof DecidePayrollAdjustmentSchema>;

export const CancelPayrollAdjustmentSchema = z
  .object({ reason: z.string().min(1).max(500), version: z.number().int().min(0) })
  .strict();
export type CancelPayrollAdjustment = z.infer<typeof CancelPayrollAdjustmentSchema>;

// ── One decision, taken for many people at once (P-HR-13) ────────────────────
//
// WHAT THIS IS. A distribution: finance decides each person's amount OUTSIDE this system, and ECMS
// records the result. Profit sharing is the case it was built for, and the shape generalizes to any
// decided-elsewhere payment because nothing about it is specific to profit.
//
// WHAT ECMS THEREFORE DOES NOT DO, and this is the whole boundary: there is no pool, no formula, no
// percentage, no ratio, no eligibility rule, no service-length rule and no proration anywhere in
// this path. **The amount arrives; it is never computed.** Any of those words appearing in this
// feature would be a legal or financial rule nobody has given.
//
// WHY IT IS NOT A NEW ENTITY. A distribution is N of something this system already has: one amount,
// for one person, for one month, because somebody decided so — a `PayrollAdjustment`, which already
// carries the two-person rule, the frozen-month guard, the audit trail, the payslip line, the
// employee's own view of it (P-HR-19) and the reconciliation (P-HR-15-A). A second entity would be
// a second answer to a question this one already answers.
//
// THE FIELDS THAT ARE ABSENT ARE THE POINT:
//   • no `kind` — every row is a `bonus`. A clawback is not this path.
//   • no `currency` — it is DERIVED from the employee's own basic salary, because the engine already
//     refuses an adjustment in any other currency. Letting a caller type one would be inviting the
//     refusal rather than preventing it.
//   • one `period` and one `payItemId` for the WHOLE batch — a batch that spanned months would be
//     two decisions wearing one name, and the frozen-month guard applies per month.

export const BulkPayrollAdjustmentRowSchema = z
  .object({
    employeeId: objectId(),
    /** Always positive, exactly as a single adjustment's is — the kind sets the sign. */
    amount: MoneyAmountSchema.refine((value) => value > 0, {
      message: 'an amount must be positive',
    }),
    /** Per row: two people may be paid the same month for different stated reasons. */
    reason: z.string().min(1).max(500),
  })
  .strict();
export type BulkPayrollAdjustmentRow = z.infer<typeof BulkPayrollAdjustmentRowSchema>;

export const BulkCreatePayrollAdjustmentsSchema = z
  .object({
    /** ONE month for the batch (D13-3) — never per row. */
    period: adjustmentPeriod,
    /**
     * REQUIRED here, though optional on a single adjustment (D13-4).
     *
     * Without it every row would land on the payslip under the generic `BONUS` code and a
     * distribution would be indistinguishable from any other bonus — including in P-HR-14's
     * by-pay-item split. The server checks the item exists, is active, and is an `earning`.
     */
    payItemId: objectId(),
    /** The same bound the punch import uses (D13-7): a batch is large, not unbounded. */
    rows: z.array(BulkPayrollAdjustmentRowSchema).min(1).max(5000),
  })
  .strict();
export type BulkCreatePayrollAdjustments = z.infer<typeof BulkCreatePayrollAdjustmentsSchema>;

/**
 * What one batch did — and REJECTED ROWS ARE REPORTED, never silently dropped.
 *
 * The posture the punch import established: one employee whose month is frozen, whose currency
 * differs, or who was not employed that month must not cost the other three hundred their payment.
 * Each refusal comes back with the row's index, the employee it was for, and the server's own
 * sentence about why.
 */
export interface BulkPayrollAdjustmentRejectionDto {
  index: number;
  employeeId: string;
  reason: string;
}

export interface BulkCreatePayrollAdjustmentsResultDto {
  period: string;
  payItemId: string;
  /** Rows recorded — every one of them as a `draft`, awaiting the second person (D1). */
  created: number;
  /** Rows already recorded for this employee, month, kind and reason — a re-run writes nothing. */
  duplicates: number;
  rejected: BulkPayrollAdjustmentRejectionDto[];
}

export const ListPayrollAdjustmentsQuerySchema = PaginationQuerySchema.extend({
  period: adjustmentPeriod.optional(),
  kind: PayrollAdjustmentKindSchema.optional(),
  status: PayrollAdjustmentStatusSchema.optional(),
  employeeId: objectId().optional(),
}).strict();
export type ListPayrollAdjustmentsQuery = z.infer<typeof ListPayrollAdjustmentsQuerySchema>;

export interface PayrollAdjustmentDto {
  id: string;
  employeeId: string;
  period: string;
  kind: PayrollAdjustmentKind;
  amount: number;
  currency: string;
  reason: string;
  /** The catalog item lending the line its name, when one was chosen (D4). */
  payItemId: string | null;
  payItem: { code: string; name: { ar: string; en: string } } | null;
  note: string | null;
  attachmentFileId: string | null;
  status: PayrollAdjustmentStatus;
  submittedBy: string | null;
  submittedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  /**
   * Display labels, enriched on the ORGANIZATION-WIDE list read (P-HR-06 / D7) — never stored.
   *
   * Optional because the employee-scoped read does not need them: that caller already knows whose
   * profile it is looking at. They are absent, not empty, when nothing enriched them — the same
   * shape AT-6 gave the attendance lists, and for the same reason: a corrected name must not leave
   * a stale copy behind on a decision about somebody who still exists.
   */
  employeeCode?: string;
  employeeName?: string;
}

// ── Adjustment decisions: events and notifications (P-HR-07) ────────────────
//
// P-HR-04 built the whole two-person decision and P-HR-06-A gave it a queue, and neither told
// anybody anything. An approver learned that a bonus was waiting by opening the screen and looking;
// the person who recorded it learned the answer the same way. That is a worklist nobody is invited
// to — the gap this phase closes, using the shape Attendance and Leave already use rather than a
// new one.
//
// TWO MOMENTS, NOT FIVE. A draft is a private working note and a cancellation is an act by somebody
// who was already looking at the row; neither is news. What is news is that a decision is now
// OWED (submitted), and that it was MADE (decided) — the two points where one person is waiting on
// another. Adding more would be inventing an audience.

//
// P-HR-16 ADDS THE RUN'S OWN LIFECYCLE, for the same reason and by the same rule. P-HR-10 built
// freeze → approve → pay → close and every one of those transitions happened in silence: the
// person holding `payrollRun.approve` learned that a month was frozen and waiting for them by
// opening the screen, exactly as an approver used to learn about a bonus.
//
// THREE MOMENTS, NOT SIX. The test is unchanged — a real transition where somebody is thereby
// waiting to act — and the recipient is derived from the permission governing the NEXT act:
// frozen → whoever may approve, approved → whoever may pay, paid → whoever may close it. Creating
// a draft, closing a finished month and cancelling a run publish nothing: the first is a private
// working note, the second is terminal, and the third is an act by somebody already looking at
// the row.

export const HrPayrollTemplates = {
  AdjustmentSubmitted: 'hr.payroll.adjustmentSubmitted',
  AdjustmentDecided: 'hr.payroll.adjustmentDecided',
  RunFrozen: 'hr.payroll.runFrozen',
  RunApproved: 'hr.payroll.runApproved',
  RunPaid: 'hr.payroll.runPaid',
} as const;
export type HrPayrollTemplateKey = (typeof HrPayrollTemplates)[keyof typeof HrPayrollTemplates];

export const HrPayrollEvents = {
  AdjustmentSubmitted: 'hr.payroll.adjustmentSubmitted',
  AdjustmentDecided: 'hr.payroll.adjustmentDecided',
  RunFrozen: 'hr.payroll.runFrozen',
  RunApproved: 'hr.payroll.runApproved',
  RunPaid: 'hr.payroll.runPaid',
} as const;
export type HrPayrollEventName = (typeof HrPayrollEvents)[keyof typeof HrPayrollEvents];

/**
 * The figure travels with the event, and that is deliberate.
 *
 * A consumer asking "how much?" would otherwise have to read the adjustment back, and by then it
 * may have been decided again or cancelled. The payload is what was true at the moment the fact
 * happened — the same stance the payslip takes about its own lines.
 */
export const PayrollAdjustmentSubmittedPayloadV1 = z.object({
  adjustmentId: objectId(),
  employeeId: objectId(),
  period: adjustmentPeriod,
  kind: PayrollAdjustmentKindSchema,
  amount: MoneyAmountSchema,
  currency: MoneyCurrencySchema,
});

/**
 * `decision` is the contract's own word, and `rejected` does NOT mean the entry is dead: P-HR-04
 * sends a rejected adjustment back to `draft` so it can be corrected and resubmitted. A consumer
 * that treats this as terminal would be wrong about the state machine, so the name says `decision`
 * rather than `outcome`.
 */
export const PayrollAdjustmentDecidedPayloadV1 = z.object({
  adjustmentId: objectId(),
  employeeId: objectId(),
  period: adjustmentPeriod,
  kind: PayrollAdjustmentKindSchema,
  amount: MoneyAmountSchema,
  currency: MoneyCurrencySchema,
  decision: z.enum(['approved', 'rejected']),
});

/**
 * The run's three lifecycle facts (P-HR-16) — one payload shape, because they carry one fact.
 *
 * NO AMOUNT, and that is not an omission. A run has no total of its own: the figures are the
 * payslips', issued from the frozen run and read behind `employee.viewCompensation`. The event
 * says WHICH month reached WHICH state; anything more would be a second copy of money that lives
 * somewhere it is already governed.
 *
 * `by` is the actor, carried because every one of these transitions is somebody's decision and the
 * two-person rule (the freezer may not approve) is a fact about who acted rather than about who
 * may. A consumer that re-read the run would get its CURRENT actor, which after the next
 * transition is a different person.
 */
export const PayrollRunLifecyclePayloadV1 = z.object({
  runId: objectId(),
  period: adjustmentPeriod,
  status: PayrollRunStatusSchema,
  by: objectId(),
});
