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
import { LocalizedStringSchema, PaginationQuerySchema } from '../common/index.js';

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
