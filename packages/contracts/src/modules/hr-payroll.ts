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
  .object({ ...payItemBase, sortOrder: payItemBase.sortOrder.optional() })
  .strict();
export type CreatePayItem = z.infer<typeof CreatePayItemSchema>;

/**
 * `code`, `kind` and `calcBasis` are absent on purpose.
 *
 * A payslip line records which item produced it, so changing what an existing item MEANS would
 * silently restate every payslip that already cites it — a deduction that becomes an earning, or
 * a flat allowance that becomes per-day. Renaming is safe and re-ordering is cosmetic; changing
 * the arithmetic is a different item, and creating one is how you say that.
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

/**
 * Whether a line carries a figure yet.
 *
 * `pendingQuantity` is the honest answer for a `perDay` or `perMinute` item: its price is known
 * and its quantity is not, because quantities come from the frozen attendance feed and that
 * arrives with PY-4. Such a line is SHOWN — hiding it would make an assigned item vanish without
 * explanation — and excluded from every total, because a total including a figure nobody computed
 * would be worse than no total at all.
 */
export const COMPENSATION_LINE_STATES = ['computed', 'pendingQuantity'] as const;
export type CompensationLineState = (typeof COMPENSATION_LINE_STATES)[number];

/**
 * Things the reader has to know that are not wrong enough to refuse over.
 *
 *   • `legacyAllowancesIgnored` — the employee still carries the older `employment.allowances[]`
 *     list, which these rules do not read. Counting both lists would double any allowance that
 *     has already been re-recorded as a pay item, so this says so instead of guessing.
 *   • `netBelowZero` — deductions exceeded earnings. Reported exactly as computed: flooring pay at
 *     zero is a labour rule, and no such rule has been given to this system.
 */
export const COMPENSATION_WARNINGS = ['legacyAllowancesIgnored', 'netBelowZero'] as const;
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
  sourceAssignmentId: string;
  payItemId: string;
  code: string;
  name: { ar: string; en: string };
  kind: PayItemKind;
  calcBasis: PayItemCalcBasis;
  currency: string;
  /** The assignment's own figure: an amount for `fixed`, a percentage for `percentOfBase`. */
  baseAmount: number;
  /** `daysInForce / daysInPeriod`, or null when the line has no figure to prorate yet. */
  prorationFactor: number | null;
  daysInForce: number;
  daysInPeriod: number;
  /** Integer minor units — the exact figure. Null while `state` is `pendingQuantity`. */
  amountMinor: number | null;
  amount: number | null;
  state: CompensationLineState;
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
  totalEarningsMinor: number;
  totalEarnings: number;
  totalDeductionsMinor: number;
  totalDeductions: number;
  /** Earnings minus deductions. NOT take-home pay: no tax or contribution exists yet. */
  netMinor: number;
  net: number;
  warnings: CompensationWarning[];
}
