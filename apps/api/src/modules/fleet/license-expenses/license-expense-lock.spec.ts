// A licensing record «تسوية عهدة» settled is locked — the whole record, whichever memo was settled —
// and the lock rides every write through the repository, not a check before it.
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { BusinessRuleError } from '../../../shared/errors';
import {
  LICENSE_EXPENSE_WRITABLE,
  isLicenseExpenseLocked,
  licenseExpenseLockedMessage,
  settledDayOf,
  settlementField,
  settlementOf,
} from './license-expense-lock';
import { fleetLicenseExpenseRepository } from './license-expense.repository';
import { type FleetLicenseExpenseDoc } from './license-expense.model';

const settled = (day: string) => ({
  operationId: new Types.ObjectId(),
  settledAt: new Date(`${day}T00:00:00.000Z`),
});

describe('the settlement lock of a licensing record', () => {
  it('leaves a record with neither memo settled writable — a record from before reads so too', () => {
    expect(isLicenseExpenseLocked({ renewalSettlement: null, extensionSettlement: null })).toBe(
      false,
    );
    expect(isLicenseExpenseLocked({}), 'fields absent: written before settlements').toBe(false);
    expect(settledDayOf({})).toBeNull();
  });

  it('locks the whole record when either memo is settled', () => {
    expect(isLicenseExpenseLocked({ renewalSettlement: settled('2026-10-05') })).toBe(true);
    expect(
      isLicenseExpenseLocked({
        renewalSettlement: null,
        extensionSettlement: settled('2026-10-06'),
      }),
    ).toBe(true);
  });

  it('names the first day a memo of it was settled', () => {
    expect(
      settledDayOf({
        renewalSettlement: settled('2026-10-09'),
        extensionSettlement: settled('2026-10-05'),
      }),
    ).toBe('2026-10-05');
  });

  it('reads each memo’s settlement from its own field', () => {
    expect(settlementField('renewal')).toBe('renewalSettlement');
    expect(settlementField('extension')).toBe('extensionSettlement');
    const one = settled('2026-10-05');
    expect(settlementOf({ extensionSettlement: one }, 'extension')).toBe(one);
    expect(settlementOf({ extensionSettlement: one }, 'renewal')).toBeNull();
  });

  it('is a condition of every write, and the refusal says why in English', () => {
    expect(LICENSE_EXPENSE_WRITABLE).toEqual({
      renewalSettlement: null,
      extensionSettlement: null,
    });
    const repo = fleetLicenseExpenseRepository as unknown as {
      writeConditions(): Record<string, unknown>;
      assertWritable(doc: FleetLicenseExpenseDoc): void;
    };
    expect(repo.writeConditions()).toEqual(LICENSE_EXPENSE_WRITABLE);
    const id = new Types.ObjectId();
    const doc = { _id: id, extensionSettlement: settled('2026-10-05') } as FleetLicenseExpenseDoc;
    expect(() => repo.assertWritable(doc)).toThrow(BusinessRuleError);
    expect(() => repo.assertWritable(doc)).toThrow(
      licenseExpenseLockedMessage(String(id), '2026-10-05'),
    );
    expect(() =>
      repo.assertWritable({ _id: id, renewalSettlement: null } as FleetLicenseExpenseDoc),
    ).not.toThrow();
  });
});
