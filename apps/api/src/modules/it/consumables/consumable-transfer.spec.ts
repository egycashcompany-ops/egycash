// «تحويل إلى فرع» — «لو مثلاً فى 10 ماوس .. فممكن أنقل 5 لفرع تاني» — pinned where it is pure: the one
// store a transfer leaves, what may receive it in the other, and what it answers.
import { describe, expect, it } from 'vitest';
import { BusinessRuleError, NotFoundError } from '../../../shared/errors';
import {
  consumableTransferResult,
  receivingItemRefusal,
  sameUnit,
  transferSourceBranch,
} from './consumable-transfer';

const OCTOBER = '6563a1b2c3d4e5f601020301';
const TANTA = '6563a1b2c3d4e5f601020302';
const ASSIUT = '6563a1b2c3d4e5f601020303';

describe('the store a transfer leaves', () => {
  it('is the one branch every item is in', () => {
    expect(transferSourceBranch([{ branchId: OCTOBER }, { branchId: OCTOBER }], TANTA)).toBe(
      OCTOBER,
    );
  });

  it('refuses items of two stores — each store’s shelf is a transfer of its own', () => {
    expect(() =>
      transferSourceBranch([{ branchId: OCTOBER }, { branchId: ASSIUT }], TANTA),
    ).toThrowError(
      new BusinessRuleError(
        "the items of one transfer leave one store: transfer each branch's items on its own",
      ),
    );
  });

  it('refuses a transfer to the store the items are already in', () => {
    expect(() => transferSourceBranch([{ branchId: OCTOBER }], OCTOBER)).toThrow(BusinessRuleError);
  });

  it('has no store to name without an item', () => {
    expect(() => transferSourceBranch([], TANTA)).toThrow(NotFoundError);
  });
});

describe('the unit the two stores count in', () => {
  it('is the same name, trimmed and case aside', () => {
    expect(sameUnit('قطعة', 'قطعة')).toBe(true);
    expect(sameUnit(' قطعة ', 'قطعة')).toBe(true);
    expect(sameUnit('Box', 'box')).toBe(true);
    expect(sameUnit('قطعة', 'علبة')).toBe(false);
    expect(sameUnit('m', 'متر')).toBe(false);
  });
});

describe('what may receive the units', () => {
  const mouse = { code: 'CON-00003', name: 'Mouse', unit: 'قطعة' };

  it('the other store’s item of the same name, counting the same way and still taking stock', () => {
    expect(
      receivingItemRefusal(mouse, { code: 'CON-00041', unit: 'قطعة', active: true }),
    ).toBeNull();
    expect(
      receivingItemRefusal(mouse, { code: 'CON-00041', unit: ' قطعة', active: true }),
    ).toBeNull();
  });

  it('never one that counts in another unit — five «علبة» would arrive as five «قطعة»', () => {
    const refusal = receivingItemRefusal(mouse, { code: 'CON-00041', unit: 'علبة', active: true });
    expect(refusal).toBeInstanceOf(BusinessRuleError);
    // Both units named, and the item that disagrees.
    expect(refusal?.message).toContain('«قطعة»');
    expect(refusal?.message).toContain('«علبة»');
    expect(refusal?.message).toContain('CON-00041');
  });

  it('never a retired one — it takes no new stock, the delivery’s rule', () => {
    const refusal = receivingItemRefusal(mouse, { code: 'CON-00041', unit: 'قطعة', active: false });
    expect(refusal).toBeInstanceOf(BusinessRuleError);
    expect(refusal?.message).toContain('CON-00041');
    expect(refusal?.message).toContain('inactive');
  });
});

describe('what a transfer answers', () => {
  it('its id, both stores, when, and each line as written — the one it made said so', () => {
    const lines = [
      {
        fromConsumableId: 'f1',
        fromCode: 'CON-00003',
        toConsumableId: 't1',
        toCode: 'CON-00041',
        name: 'Mouse',
        unit: 'قطعة',
        qty: 5,
        created: false,
      },
      {
        fromConsumableId: 'f2',
        fromCode: 'CON-00004',
        toConsumableId: 't2',
        toCode: 'CON-00090',
        name: 'كابل HDMI 3 متر',
        unit: 'قطعة',
        qty: 2,
        created: true,
      },
    ];
    expect(
      consumableTransferResult({
        transferId: 'x',
        fromBranchId: OCTOBER,
        toBranchId: TANTA,
        at: new Date('2026-11-11T09:00:00.000Z'),
        lines,
      }),
    ).toEqual({
      transferId: 'x',
      fromBranchId: OCTOBER,
      toBranchId: TANTA,
      at: '2026-11-11T09:00:00.000Z',
      lines,
    });
  });
});
