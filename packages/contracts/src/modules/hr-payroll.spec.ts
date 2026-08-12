// The payroll vocabulary, pinned.
//
// These enums are what every later phase will branch on, and what a payslip line will cite. A
// value added or renamed here changes the meaning of stored rows, so the list is stated by name
// rather than counted — and the ABSENCE of statutory fields is asserted too, because "no tax rule
// yet" is a decision this phase must keep rather than a gap somebody quietly fills.
import { describe, expect, it } from 'vitest';
import {
  CreatePayItemSchema,
  PAY_ITEM_CALC_BASES,
  PAY_ITEM_KINDS,
  UpdatePayItemSchema,
} from './hr-payroll';

describe('the pay-item vocabulary', () => {
  it('pins the two kinds and the four calculation bases', () => {
    expect([...PAY_ITEM_KINDS]).toEqual(['earning', 'deduction']);
    expect([...PAY_ITEM_CALC_BASES]).toEqual([
      'fixed',
      'perDay',
      'perMinute',
      'percentOfBase',
    ]);
  });

  it('accepts a well-formed item', () => {
    const parsed = CreatePayItemSchema.safeParse({
      code: 'HOUSING',
      name: { ar: 'بدل سكن', en: 'Housing allowance' },
      kind: 'earning',
      calcBasis: 'fixed',
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses a code that is not an uppercase handle', () => {
    for (const code of ['housing', 'Housing', '1HOUSING', 'HOUSING ALLOWANCE', 'H']) {
      const parsed = CreatePayItemSchema.safeParse({
        code,
        name: { ar: 'س', en: 'X' },
        kind: 'earning',
        calcBasis: 'fixed',
      });
      expect(parsed.success, code).toBe(false);
    }
  });

  // The arithmetic is immutable BY CONTRACT: a payslip line cites the item that produced it, so
  // an item that could change kind or basis would silently restate history.
  it('refuses to change what an existing item means', () => {
    for (const field of ['code', 'kind', 'calcBasis']) {
      const parsed = UpdatePayItemSchema.safeParse({
        [field]: field === 'code' ? 'OTHER' : field === 'kind' ? 'deduction' : 'perDay',
        version: 0,
      });
      expect(parsed.success, field).toBe(false);
    }
    expect(UpdatePayItemSchema.safeParse({ name: { ar: 'س', en: 'X' }, version: 0 }).success).toBe(
      true,
    );
  });

  // Payroll v1 has no statutory rule. A field here would be a claim about legislation nobody has
  // given this system — and the place it would first appear is this schema.
  it('carries no tax or insurance field', () => {
    const shape = Object.keys(CreatePayItemSchema.shape);
    expect(shape.sort()).toEqual(['calcBasis', 'code', 'kind', 'name', 'sortOrder']);
    for (const forbidden of ['taxable', 'tax', 'insurance', 'socialInsurance', 'exempt']) {
      expect(shape, forbidden).not.toContain(forbidden);
    }
  });
});
