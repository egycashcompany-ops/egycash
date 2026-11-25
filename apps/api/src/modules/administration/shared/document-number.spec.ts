// The master codes' series (design §2.8, §19.7): their counter keys, the prefix each floor reads,
// and the floor itself — the highest number at any width, so a counter that went missing past
// «ITM-99999» does not come back below a code already used. The supplier's series is the item's
// machinery under its own key and prefix, so neither ever floors at the other's codes.
import { formatAdministrationMasterCode } from '@ecms/contracts';
import { describe, expect, it } from 'vitest';
import {
  ITEM_CODE_SERIES,
  SUPPLIER_CODE_SERIES,
  floorFrom,
  highestCodePipeline,
} from './document-number';

// The pipeline's first stage is its `$match` on the code; the cast names that one stage's shape.
const patternOf = (series: typeof ITEM_CODE_SERIES): RegExp => {
  const [match] = highestCodePipeline(series);
  return new RegExp((match as { $match: { code: { $regex: string } } }).$match.code.$regex);
};

describe('the item code series (OD-05 A)', () => {
  it('counts on `item:global` — global, never reset, so no year in its key', () => {
    expect(ITEM_CODE_SERIES).toEqual({ kind: 'item', key: 'item:global', prefix: 'ITM' });
  });

  it('reads its floor from the codes in the formatter’s own spelling only', () => {
    const [match] = highestCodePipeline(ITEM_CODE_SERIES);
    const pattern = new RegExp(
      (match as { $match: { code: { $regex: string } } }).$match.code.$regex,
    );
    expect(pattern.source.startsWith('^ITM-'), 'anchored, so `ux_code` serves it').toBe(true);
    for (const code of ['ITM-00001', 'ITM-99999', 'ITM-100000', 'ITM-123456']) {
      expect(pattern.test(code), code).toBe(true);
    }
    for (const code of [
      'SUP-00001',
      'XITM-00001',
      'ITM-',
      'ITM-12a',
      'itm-00001',
      'ITM-0042',
      // Wider than five with a leading zero: the longest group, if matched, would hide every
      // real code behind a top the parser refuses.
      'ITM-000042',
      'ITM-0100000',
    ]) {
      expect(pattern.test(code), code).toBe(false);
    }
  });

  it('every code the pattern takes is one the parser reads, at any width', () => {
    const [match] = highestCodePipeline(ITEM_CODE_SERIES);
    const pattern = new RegExp(
      (match as { $match: { code: { $regex: string } } }).$match.code.$regex,
    );
    for (const seq of [1, 42, 99_999, 100_000, 1_234_567]) {
      const code = formatAdministrationMasterCode('item', seq);
      expect(pattern.test(code), code).toBe(true);
      expect(floorFrom(ITEM_CODE_SERIES, [{ top: code }]), code).toBe(seq);
    }
  });

  it('takes the greatest of the longest codes — the highest number at any width', () => {
    expect(highestCodePipeline(ITEM_CODE_SERIES).slice(1)).toEqual([
      { $group: { _id: { $strLenCP: '$code' }, top: { $max: '$code' } } },
      { $sort: { _id: -1 } },
      { $limit: 1 },
    ]);
    // What the pipeline does, done by hand over codes that straddle five digits.
    const codes = [99_999, 100_000, 100_001, 7].map((n) =>
      formatAdministrationMasterCode('item', n),
    );
    const plainTop = [...codes].sort().reverse()[0];
    expect(plainTop, 'the plain order stops at five digits').toBe('ITM-99999');
    const longest = Math.max(...codes.map((code) => code.length));
    const top = codes
      .filter((code) => code.length === longest)
      .sort()
      .reverse()[0];
    expect(floorFrom(ITEM_CODE_SERIES, [{ top }])).toBe(100_001);
  });

  it('floors at 0 when there is no code, or none the formatter would have written', () => {
    expect(floorFrom(ITEM_CODE_SERIES, [])).toBe(0);
    expect(floorFrom(ITEM_CODE_SERIES, [{ top: 'ITM-00042' }])).toBe(42);
    expect(floorFrom(ITEM_CODE_SERIES, [{ top: 'ITM-000042' }])).toBe(0);
    expect(floorFrom(ITEM_CODE_SERIES, [{ top: null }])).toBe(0);
  });
});

describe('the supplier code series (OD-05 A)', () => {
  it('counts on `supplier:global`, global and never reset like the item’s', () => {
    expect(SUPPLIER_CODE_SERIES).toEqual({
      kind: 'supplier',
      key: 'supplier:global',
      prefix: 'SUP',
    });
    expect(SUPPLIER_CODE_SERIES.key).not.toBe(ITEM_CODE_SERIES.key);
  });

  it('reads its floor from «SUP-» codes only, never an item’s', () => {
    const pattern = patternOf(SUPPLIER_CODE_SERIES);
    expect(pattern.source.startsWith('^SUP-'), 'anchored, so `ux_code` serves it').toBe(true);
    for (const code of ['SUP-00001', 'SUP-99999', 'SUP-100000']) {
      expect(pattern.test(code), code).toBe(true);
    }
    for (const code of ['ITM-00001', 'XSUP-00001', 'sup-00001', 'SUP-000042', 'SUP-0042']) {
      expect(pattern.test(code), code).toBe(false);
    }
    expect(patternOf(ITEM_CODE_SERIES).test('SUP-00001'), 'and the item’s never reads one').toBe(
      false,
    );
  });

  it('floors at the number its highest code carries, and at 0 on another master’s code', () => {
    for (const seq of [1, 42, 100_000]) {
      const code = formatAdministrationMasterCode('supplier', seq);
      expect(floorFrom(SUPPLIER_CODE_SERIES, [{ top: code }]), code).toBe(seq);
    }
    expect(floorFrom(SUPPLIER_CODE_SERIES, [])).toBe(0);
    expect(floorFrom(SUPPLIER_CODE_SERIES, [{ top: 'ITM-00042' }])).toBe(0);
    expect(floorFrom(ITEM_CODE_SERIES, [{ top: 'SUP-00042' }])).toBe(0);
  });
});
