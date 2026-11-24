// The item code's series (design §2.8, §19.7): its counter key, the prefix its floor reads, and
// the floor itself — the highest number at any width, so a counter that went missing past
// «ITM-99999» does not come back below a code already used.
import { formatAdministrationMasterCode } from '@ecms/contracts';
import { describe, expect, it } from 'vitest';
import { ITEM_CODE_SERIES, floorFrom, highestCodePipeline } from './document-number';

describe('the item code series (OD-05 A)', () => {
  it('counts on `item:global` — global, never reset, so no year in its key', () => {
    expect(ITEM_CODE_SERIES).toEqual({ kind: 'item', key: 'item:global', prefix: 'ITM' });
  });

  it('reads its floor from the codes that carry its prefix and digits only', () => {
    const [match] = highestCodePipeline(ITEM_CODE_SERIES);
    const pattern = new RegExp(
      (match as { $match: { code: { $regex: string } } }).$match.code.$regex,
    );
    expect(pattern.source.startsWith('^ITM-'), 'anchored, so `ux_code` serves it').toBe(true);
    for (const code of ['ITM-00001', 'ITM-123456']) expect(pattern.test(code), code).toBe(true);
    for (const code of ['SUP-00001', 'XITM-00001', 'ITM-', 'ITM-12a', 'itm-00001']) {
      expect(pattern.test(code), code).toBe(false);
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
