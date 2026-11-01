// «عقود توريد السيارات» — the figures the screens work out themselves: the editor's totals as he
// types (his own contract: 22 × 4,700,000 + 11 × 5,400,000), «تسجيل استلام»'s table and its «over»
// rule (the edit's own cars given back first), the new delivery's ordinal, and the files a contract
// may take.
import { describe, expect, it } from 'vitest';
import { type FleetVehicleContractDto } from '@ecms/contracts';
import {
  acceptsContractFile,
  deliveryCounts,
  deliveryFigures,
  deliveryOrdinal,
  deliveryTyped,
  editorLineTotal,
  editorTotals,
  moveItem,
  pct,
  splitFileName,
  typedCount,
} from './vehicle-contract-figures';

const line = (id: string, count: number, received: number) => ({
  id,
  typeId: `t-${id}`,
  typeName: { ar: `ماركة ${id}`, en: `Make ${id}` },
  count,
  unitPrice: null,
  total: null,
  received,
  remaining: count - received,
});
const delivery = (id: string, no: number, date: string, counts: [string, number][]) => ({
  id,
  no,
  date,
  counts: counts.map(([lineId, count]) => ({ lineId, count })),
  total: counts.reduce((sum, [, count]) => sum + count, 0),
  receivedAfter: 0,
  remainingAfter: 0,
  createdAt: `${date}T10:00:00.000Z`,
  updatedAt: `${date}T10:00:00.000Z`,
});

/** His contract after two arrivals: Sprinter 14 of 22, Accelo 5 of 11 — 19 of 33. */
const HIS: Pick<FleetVehicleContractDto, 'lines' | 'deliveries'> = {
  lines: [line('l1', 22, 14), line('l2', 11, 5)],
  deliveries: [
    delivery('d1', 1, '2026-02-10', [['l1', 8]]),
    delivery('d2', 2, '2026-04-15', [
      ['l1', 6],
      ['l2', 5],
    ]),
  ],
};

describe('the editor works out the total as he types', () => {
  it('a line has a total only once its count and price are written', () => {
    expect(editorLineTotal({ count: '22', price: '4700000' })).toBe(103_400_000);
    expect(editorLineTotal({ count: '22', price: '' })).toBeNull();
    expect(editorLineTotal({ count: '', price: '4700000' })).toBeNull();
  });

  it('typing 540000 on his second line makes the total 109,340,000', () => {
    const lines = [
      { count: '22', price: '4700000' },
      { count: '11', price: '540000' },
    ];
    expect(editorTotals(lines)).toEqual({ total: 109_340_000, cars: 33, priced: 2 });
    expect(editorTotals([lines[0]!, { count: '11', price: '5400000' }]).total).toBe(162_800_000);
  });

  it('sums to the piastre without drifting', () => {
    expect(
      editorTotals([
        { count: '3', price: '0.1' },
        { count: '3', price: '0.2' },
      ]).total,
    ).toBe(0.9);
  });

  it('an empty box is no car', () => {
    expect(typedCount('')).toBe(0);
    expect(typedCount(undefined)).toBe(0);
    expect(typedCount('7')).toBe(7);
  });
});

describe('«تسجيل استلام»', () => {
  it('4 + 3 after 19 received makes 26 — and 7 still owed', () => {
    const figures = deliveryFigures(HIS, { l1: '4', l2: '3' }, null);
    expect(figures.receivedBefore).toBe(19);
    expect(figures.comingNow).toBe(7);
    expect(figures.after).toBe(26);
    expect(figures.contracted - figures.after).toBe(7);
    expect(figures.over).toEqual([]);
    expect(deliveryCounts(figures.rows)).toEqual([
      { lineId: 'l1', count: 4 },
      { lineId: 'l2', count: 3 },
    ]);
  });

  it('8 against a remaining of 6 is over', () => {
    const figures = deliveryFigures(HIS, { l1: '4', l2: '8' }, null);
    expect(figures.rows.map((row) => [row.left, row.over])).toEqual([
      [8, false],
      [6, true],
    ]);
    expect(figures.over.map((row) => row.line.id)).toEqual(['l2']);
  });

  it("an edit gives the delivery's own cars back first", () => {
    // d2 took 6 + 5; edited to 6 + 6 it is not over: without d2 the Accelo line has all 11 left.
    const typed = deliveryTyped(HIS, 'd2');
    expect(typed).toEqual({ l1: '6', l2: '5' });
    const figures = deliveryFigures(HIS, { ...typed, l2: '6' }, 'd2');
    expect(figures.rows.map((row) => row.received)).toEqual([8, 0]);
    expect(figures.rows.map((row) => row.left)).toEqual([14, 11]);
    expect(figures.over).toEqual([]);
  });

  it('nothing typed sends nothing', () => {
    expect(deliveryCounts(deliveryFigures(HIS, {}, null).rows)).toEqual([]);
  });

  it("the new delivery's ordinal is its date's place among the live ones", () => {
    expect(deliveryOrdinal(HIS, '2026-10-12', null)).toBe(3);
    expect(deliveryOrdinal(HIS, '2026-03-01', null)).toBe(2);
    expect(deliveryOrdinal(HIS, '2026-01-01', null)).toBe(1);
    // The same day as an earlier one: written later, so after it.
    expect(deliveryOrdinal(HIS, '2026-02-10', null)).toBe(2);
    // An edited delivery moved before the first.
    expect(deliveryOrdinal(HIS, '2026-01-05', 'd2')).toBe(1);
    expect(deliveryOrdinal(HIS, '2026-04-15', 'd2')).toBe(2);
  });

  it('a share of a whole, and of nothing', () => {
    expect(pct(32, 33)).toBe(97);
    expect(pct(0, 0)).toBe(0);
  });
});

describe('the attachments', () => {
  it('takes images and PDF files up to 10 MB', () => {
    expect(acceptsContractFile({ type: 'image/png', size: 200_000 })).toBe(true);
    expect(acceptsContractFile({ type: 'application/pdf', size: 10 * 1024 * 1024 })).toBe(true);
    expect(acceptsContractFile({ type: 'application/pdf', size: 10 * 1024 * 1024 + 1 })).toBe(
      false,
    );
    expect(acceptsContractFile({ type: 'text/plain', size: 10 })).toBe(false);
    expect(acceptsContractFile({ type: 'image/png', size: 0 })).toBe(false);
  });

  it('keeps an Arabic name apart from its extension', () => {
    expect(splitFileName('العقد كاملًا.pdf')).toEqual({ base: 'العقد كاملًا', ext: 'pdf' });
    expect(splitFileName('صفحة 1')).toEqual({ base: 'صفحة 1', ext: '' });
  });

  it('moves a tile to another place', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
  });
});
