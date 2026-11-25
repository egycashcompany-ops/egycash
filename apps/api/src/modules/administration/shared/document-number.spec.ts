// The master codes' series (design §2.8, §19.7): their counter keys, the prefix each floor reads,
// and the floor itself — the highest number at any width, so a counter that went missing past
// «ITM-99999» does not come back below a code already used. The supplier's series is the item's
// machinery under its own key and prefix, so neither ever floors at the other's codes. And the
// yearly document series (P2.1): the key and the business date from one instant, the year turning
// at Cairo's midnight and not UTC's (OD-57 A, RK-13), and the floor of that year's numbers by the
// master codes' rule.
import { formatAdministrationMasterCode, formatAdministrationNumber } from '@ecms/contracts';
import { describe, expect, it } from 'vitest';
import {
  ITEM_CODE_SERIES,
  SUPPLIER_CODE_SERIES,
  documentNumberAt,
  documentNumberSeries,
  floorFrom,
  highestCodePipeline,
  highestNumberPipeline,
  numberFloorFrom,
  type DocumentNumberSeries,
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

describe('the yearly document series (OD-57 A, OD-58 A)', () => {
  const PR_2026 = documentNumberSeries('purchaseRequest', 2026);

  // The `$match` stage, its `number` clause named — the shape the index serves.
  const matchOf = (series: DocumentNumberSeries): { $type: string; $regex: string } => {
    const [match] = highestNumberPipeline(series);
    return (match as { $match: { number: { $type: string; $regex: string } } }).$match.number;
  };
  const numberPatternOf = (series: DocumentNumberSeries): RegExp =>
    new RegExp(matchOf(series).$regex);

  it('counts each kind and year on its own key, «PR-2026» its prefix', () => {
    expect(PR_2026).toEqual({
      kind: 'purchaseRequest',
      year: 2026,
      key: 'purchaseRequest:2026',
      prefix: 'PR-2026',
    });
    expect(documentNumberSeries('purchaseRequest', 2027).key).toBe('purchaseRequest:2027');
    expect([ITEM_CODE_SERIES.key, SUPPLIER_CODE_SERIES.key]).not.toContain(PR_2026.key);
  });

  it('keys an act by the Cairo year of its business date, from one instant (RK-13)', () => {
    const lastOfYear = documentNumberAt('purchaseRequest', new Date('2026-12-31T21:59:59.999Z'));
    expect(lastOfYear.series.key).toBe('purchaseRequest:2026');
    expect(lastOfYear.businessDate.toISOString()).toBe('2026-12-31T00:00:00.000Z');

    // 00:00 on 1 January in Cairo, while the UTC clock still reads 31 December, 22:00.
    const firstOfYear = documentNumberAt('purchaseRequest', new Date('2026-12-31T22:00:00.000Z'));
    expect(firstOfYear.series.key).toBe('purchaseRequest:2027');
    expect(firstOfYear.series.prefix).toBe('PR-2027');
    expect(firstOfYear.businessDate.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(
      new Date('2026-12-31T22:00:00.000Z').getUTCFullYear(),
      'the UTC year HR’s series take would still number it in 2026',
    ).toBe(2026);
  });

  it('gives the number and the date one year, whatever the instant', () => {
    for (const at of [
      '2026-01-01T00:00:00.000Z',
      '2026-06-30T21:30:00.000Z', // summer time: Cairo is UTC+3, already 1 July
      '2026-12-31T21:59:59.999Z',
      '2026-12-31T22:00:00.000Z',
      '2027-01-01T01:59:59.999Z',
    ]) {
      const { businessDate, series } = documentNumberAt('purchaseRequest', new Date(at));
      expect(series.year, at).toBe(businessDate.getUTCFullYear());
      expect(series, at).toEqual(documentNumberSeries('purchaseRequest', series.year));
    }
  });

  it('reads its floor from that year’s numbers in the formatter’s own spelling only', () => {
    const match = matchOf(PR_2026);
    expect(match.$type, '`ux_number`’s partial filter, so the index serves the read').toBe(
      'string',
    );
    expect(match.$regex).toBe('^PR-2026-(?:[0-9]{6}|[1-9][0-9]{6,})$');
    const pattern = numberPatternOf(PR_2026);
    for (const number of ['PR-2026-000001', 'PR-2026-999999', 'PR-2026-1000000']) {
      expect(pattern.test(number), number).toBe(true);
    }
    for (const number of [
      'PR-2027-000001',
      'PR-2025-999999',
      'XPR-2026-000001',
      'PR-2026-',
      'PR-2026-00001',
      'pr-2026-000001',
      'PR-2026-00001a',
      'ITM-00001',
      // Wider than six with a leading zero: the longest group, if matched, would hide every real
      // number behind a top the parser refuses.
      'PR-2026-0000042',
      'PR-2026-01000000',
    ]) {
      expect(pattern.test(number), number).toBe(false);
    }
  });

  it('takes the greatest of the longest numbers — the highest at any width', () => {
    expect(highestNumberPipeline(PR_2026).slice(1)).toEqual([
      { $group: { _id: { $strLenCP: '$number' }, top: { $max: '$number' } } },
      { $sort: { _id: -1 } },
      { $limit: 1 },
    ]);
    // What the pipeline does, done by hand over numbers that straddle six digits.
    const pattern = numberPatternOf(PR_2026);
    const numbers = [999_999, 1_000_000, 1_000_001, 7].map((n) =>
      formatAdministrationNumber('purchaseRequest', 2026, n),
    );
    const plainTop = [...numbers].sort().reverse()[0];
    expect(plainTop, 'the plain order stops at six digits').toBe('PR-2026-999999');
    const matched = numbers.filter((number) => pattern.test(number));
    const longest = Math.max(...matched.map((number) => number.length));
    const top = matched
      .filter((number) => number.length === longest)
      .sort()
      .reverse()[0];
    expect(numberFloorFrom(PR_2026, [{ top }])).toBe(1_000_001);
  });

  it('never lets a hand-typed «PR-2026-0000042» outgrow «PR-2026-000500»', () => {
    const pattern = numberPatternOf(PR_2026);
    const stored = ['PR-2026-000500', 'PR-2026-0000042', 'PR-2026-000007'];
    const matched = stored.filter((number) => pattern.test(number));
    expect(matched, 'the misspelling is not grouped at all').toEqual([
      'PR-2026-000500',
      'PR-2026-000007',
    ]);
    const longest = Math.max(...matched.map((number) => number.length));
    const top = matched
      .filter((number) => number.length === longest)
      .sort()
      .reverse()[0];
    expect(numberFloorFrom(PR_2026, [{ top }])).toBe(500);
    expect(numberFloorFrom(PR_2026, [{ top: 'PR-2026-0000042' }]), 'and reads as none').toBe(0);
  });

  it('floors at 0 when there is no number, or one of another year or kind', () => {
    expect(numberFloorFrom(PR_2026, [])).toBe(0);
    expect(numberFloorFrom(PR_2026, [{ top: null }])).toBe(0);
    expect(numberFloorFrom(PR_2026, [{ top: 'PR-2026-000042' }])).toBe(42);
    expect(numberFloorFrom(PR_2026, [{ top: 'PR-2025-000900' }]), 'another year').toBe(0);
    expect(
      numberFloorFrom(documentNumberSeries('purchaseRequest', 2025), [{ top: 'PR-2025-000900' }]),
    ).toBe(900);
    expect(numberFloorFrom(PR_2026, [{ top: 'ITM-00042' }]), 'a master code').toBe(0);
    expect(numberFloorFrom(PR_2026, [{ top: 'PR-2026-000000' }]), 'no number a counter gives').toBe(
      0,
    );
  });
});
