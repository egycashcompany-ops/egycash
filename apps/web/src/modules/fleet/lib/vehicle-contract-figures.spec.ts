// «عقود توريد السيارات» — the figures the screens work out themselves: the editor's totals as he
// types (his own contract: 22 × 4,700,000 + 11 × 5,400,000), «المستلم حتى الآن» on a new contract
// (15 + 11 received of 22 + 11) and the bodies Save sends, «تسجيل استلام»'s table and its «over»
// rule (the edit's own cars given back first), the new delivery's ordinal, and the files a contract
// may take.
import { describe, expect, it } from 'vitest';
import {
  CreateFleetVehicleContractSchema,
  UpdateFleetVehicleContractSchema,
  type FleetVehicleContractDto,
} from '@ecms/contracts';
import {
  acceptsContractFile,
  createBodyOf,
  deliveryCounts,
  deliveryFigures,
  deliveryOrdinal,
  deliveryTyped,
  editorLineTotal,
  editorReceived,
  editorTotals,
  moveItem,
  pct,
  receivedModeOf,
  receivedOver,
  splitFileName,
  typedCount,
  updateBodyOf,
  type EditorForm,
  type EditorLine,
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
    // `received` is batch 3's «المستلم حتى الآن» — none written here.
    expect(editorTotals(lines)).toEqual({ total: 109_340_000, cars: 33, priced: 2, received: 0 });
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

const TYPE_1 = '65f000000000000000000021';
const TYPE_2 = '65f000000000000000000022';
const editorLine = (key: string, over: Partial<EditorLine> = {}): EditorLine => ({
  key,
  id: null,
  typeId: TYPE_1,
  count: '',
  price: '',
  received: '',
  ...over,
});
/** His new contract: Sprinter 22 at 4,700,000 with 15 received, Accelo 11 at 5,400,000 all received. */
const NEW_LINES: EditorLine[] = [
  editorLine('k1', { count: '22', price: '4700000', received: '15' }),
  editorLine('k2', { typeId: TYPE_2, count: '11', price: '5400000', received: '11' }),
];
const form = (lines: EditorLine[], over: Partial<EditorForm> = {}): EditorForm => ({
  date: '2025-12-08',
  deadline: '2026-07-31',
  name: ' عقد توريد عربات نقل أموال ',
  supplier: '',
  lines,
  receivedDate: '2026-11-01',
  ...over,
});

describe('«المستلم حتى الآن» on a new contract', () => {
  it('15 + 11 of 22 + 11: 26 received, 7 still owed, nothing over', () => {
    expect(editorTotals(NEW_LINES)).toEqual({
      total: 162_800_000,
      cars: 33,
      priced: 2,
      received: 26,
    });
    expect(editorReceived(NEW_LINES, 'edit', 0)).toEqual({ received: 26, left: 7, over: [] });
  });

  it('25 on the line of 22 is over — Save waits on that line only', () => {
    const lines = [{ ...NEW_LINES[0]!, received: '25' }, NEW_LINES[1]!];
    expect(lines.map(receivedOver)).toEqual([true, false]);
    const figures = editorReceived(lines, 'edit', 0);
    expect(figures.received).toBe(36);
    expect(figures.left).toBe(0);
    expect(figures.over.map((line) => line.key)).toEqual(['k1']);
  });

  it('as many as the line names is not over; an empty box is none', () => {
    expect(receivedOver({ count: '11', received: '11' })).toBe(false);
    expect(receivedOver({ count: '11', received: '' })).toBe(false);
    expect(receivedOver({ count: '11', received: '12' })).toBe(true);
    // A line without a count yet is named by the required-fields banner, not as over.
    expect(editorReceived([editorLine('k1', { received: '3' })], 'edit', 0).over).toEqual([]);
  });

  it('who types it: a new contract with the grant, locked on an edit, hidden without it', () => {
    expect(receivedModeOf(false, true)).toBe('edit');
    expect(receivedModeOf(false, false)).toBe('hidden');
    expect(receivedModeOf(true, true)).toBe('locked');
    expect(receivedModeOf(true, false)).toBe('locked');
  });

  it('an edit shows the saved figure; without the grant nothing is counted', () => {
    // The boxes are not read on an edit — the contract's own received is.
    expect(editorReceived(NEW_LINES, 'locked', 32)).toEqual({ received: 32, left: 1, over: [] });
    expect(editorReceived(NEW_LINES, 'hidden', 0)).toEqual({ received: 0, left: 33, over: [] });
  });
});

describe('what Save sends', () => {
  it('a new contract carries each line’s received and the first delivery’s day', () => {
    const body = createBodyOf(form(NEW_LINES), 'edit');
    expect(body.lines.map((line) => [line.count, line.received, line.unitPrice])).toEqual([
      [22, 15, 4_700_000],
      [11, 11, 5_400_000],
    ]);
    expect(body.receivedDate).toEqual(new Date('2026-11-01'));
    expect(body.name).toBe('عقد توريد عربات نقل أموال');
    expect(body.deadline).toEqual(new Date('2026-07-31'));
    // The server takes it as it is: a valid create body.
    expect(CreateFleetVehicleContractSchema.safeParse(body).success).toBe(true);
  });

  it('nothing received: every line 0, and no day', () => {
    const lines = NEW_LINES.map((line) => ({ ...line, received: '' }));
    const body = createBodyOf(form(lines), 'edit');
    expect(body.lines.map((line) => line.received)).toEqual([0, 0]);
    expect(body.receivedDate).toBeNull();
    expect(CreateFleetVehicleContractSchema.safeParse(body).success).toBe(true);
  });

  it('without the grant the boxes are not read — nothing is sent as received', () => {
    const body = createBodyOf(form(NEW_LINES), 'hidden');
    expect(body.lines.map((line) => line.received)).toEqual([0, 0]);
    expect(body.receivedDate).toBeNull();
  });

  it('an edit sends no received figure and no day — the strict Update schema takes it', () => {
    const lines = NEW_LINES.map((line, index) => ({
      ...line,
      id: `65f00000000000000000001${index}`,
    }));
    const body = updateBodyOf(form(lines), 3);
    expect(body.version).toBe(3);
    expect(body.lines.every((line) => !('received' in line))).toBe(true);
    expect('receivedDate' in body).toBe(false);
    expect(UpdateFleetVehicleContractSchema.safeParse(body).success).toBe(true);
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
