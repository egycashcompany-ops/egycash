import { describe, expect, it } from 'vitest';
import { isPrivateOperation, splitWorkType } from './work-type-split';

describe('what the dealership row says in «نوع العمل»', () => {
  it('writes «صيانة» for a maintenance visit, however the catalog spells it', () => {
    expect(splitWorkType('صيانة')).toEqual([{ workKind: 'maintenance', workTypeLabel: 'صيانة' }]);
    expect(splitWorkType('صيانه ')).toEqual([{ workKind: 'maintenance', workTypeLabel: 'صيانة' }]);
  });

  it('writes «إصلاح» for a repair', () => {
    expect(splitWorkType('إصلاح')).toEqual([{ workKind: 'repair', workTypeLabel: 'إصلاح' }]);
    expect(splitWorkType('اصلاح')).toEqual([{ workKind: 'repair', workTypeLabel: 'إصلاح' }]);
  });

  it('opens TWO rows for «صيانة + إصلاح» — each half has its own invoice', () => {
    for (const name of ['صيانة + إصلاح', 'صيانه و اصلاح', 'إصلاح + صيانة']) {
      expect(
        splitWorkType(name)
          .map((row) => row.workKind)
          .sort(),
      ).toEqual(['maintenance', 'repair']);
    }
  });

  it('writes anything else as a repair of that kind, in parentheses', () => {
    expect(splitWorkType('كهرباء')).toEqual([
      { workKind: 'repair', workTypeLabel: 'إصلاح (كهرباء)' },
    ]);
    expect(splitWorkType('عفشة')).toEqual([{ workKind: 'repair', workTypeLabel: 'إصلاح (عفشة)' }]);
    // Both words plus something else is not the plain split.
    expect(splitWorkType('صيانة + إصلاح كهرباء')).toEqual([
      { workKind: 'repair', workTypeLabel: 'إصلاح (صيانة + إصلاح كهرباء)' },
    ]);
  });
});

describe('«ملاكي» from the car’s operation', () => {
  it('reads both spellings, and nothing else', () => {
    expect(isPrivateOperation('ملاكى')).toBe(true);
    expect(isPrivateOperation('ملاكي')).toBe(true);
    expect(isPrivateOperation('سيارات ملاكي')).toBe(true);
    expect(isPrivateOperation('نقل اموال')).toBe(false);
    expect(isPrivateOperation(null)).toBe(false);
  });
});
