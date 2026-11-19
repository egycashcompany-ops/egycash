// «عداد الطابعة» — «وأكيد مش هيدخل عدد ورق أقل أو مساوي للى موجود» (owner, 2026-11-19) — the printer
// counter's rules, pure: the order of a printer's readings, where a new one may sit (STRICTLY above
// the one before, strictly below a later one, a reset excepted), which one may leave, and what each
// cartridge printed — the same item's next reading less its own, unknown across a reset.
import { describe, expect, it } from 'vitest';
import {
  averagePages,
  compareCounter,
  counterPlacement,
  counterRemoval,
  counterSiblings,
  pairCounterReadings,
  type CounterRow,
} from './consumable-counter';

/** Ids that sort as written: «a1» < «a2» < «b1». */
const row = (
  id: string,
  day: number,
  reading: number,
  over: Partial<CounterRow> & { item?: string } = {},
): CounterRow & { item: string } => ({
  id,
  at: new Date(Date.UTC(2026, 10, day, 9)),
  reading,
  reset: false,
  memoId: `memo-${id}`,
  item: 'K',
  ...over,
});

const entry = (day: number, reading: number, over: Partial<CounterRow> = {}): CounterRow => ({
  id: 'z9',
  at: new Date(Date.UTC(2026, 10, day, 9)),
  reading,
  reset: false,
  memoId: 'memo-new',
  ...over,
});

describe('the order of a printer’s readings', () => {
  it('is `at` first, then the id — one memo’s lines share `at`', () => {
    const late = row('a1', 3, 10);
    const early = row('b1', 2, 10);
    const tieLow = row('c1', 4, 10);
    const tieHigh = row('c2', 4, 10);
    expect([late, tieHigh, early, tieLow].sort(compareCounter).map((r) => r.id)).toEqual([
      'b1',
      'a1',
      'c1',
      'c2',
    ]);
  });
});

describe('where a new reading may sit', () => {
  const timeline = [row('a1', 1, 1000), row('a2', 5, 2000)];

  it('a first reading on a printer that has none is always fine', () => {
    expect(counterPlacement([], entry(1, 0))).toMatchObject({ ok: true, previous: null });
  });

  it('strictly above the last one is fine', () => {
    expect(counterPlacement(timeline, entry(6, 2001))).toMatchObject({
      ok: true,
      previous: { id: 'a2' },
      next: null,
    });
  });

  it('below the last one is refused, naming it', () => {
    expect(counterPlacement(timeline, entry(6, 1500))).toEqual({
      ok: false,
      kind: 'belowPrevious',
      previous: timeline[1],
    });
  });

  it('EQUAL to the last one is refused too — «أقل أو مساوي»', () => {
    expect(counterPlacement(timeline, entry(6, 2000))).toMatchObject({
      ok: false,
      kind: 'belowPrevious',
    });
  });

  it('a reset may read lower than the last one — it starts the counter again', () => {
    expect(counterPlacement(timeline, entry(6, 5, { reset: true }))).toMatchObject({ ok: true });
    expect(counterPlacement(timeline, entry(6, 2000, { reset: true }))).toMatchObject({
      ok: true,
    });
  });

  it('backdated: strictly between the readings around its date', () => {
    expect(counterPlacement(timeline, entry(3, 1500))).toMatchObject({
      ok: true,
      previous: { id: 'a1' },
      next: { id: 'a2' },
    });
    expect(counterPlacement(timeline, entry(3, 1000))).toMatchObject({
      kind: 'belowPrevious',
    });
  });

  it('backdated above — or equal to — a later reading is refused, naming it', () => {
    expect(counterPlacement(timeline, entry(3, 2500))).toEqual({
      ok: false,
      kind: 'aboveNext',
      next: timeline[1],
    });
    expect(counterPlacement(timeline, entry(3, 2000))).toMatchObject({ kind: 'aboveNext' });
  });

  it('a reset is still capped by the reading after it…', () => {
    expect(counterPlacement(timeline, entry(3, 2500, { reset: true }))).toMatchObject({
      kind: 'aboveNext',
    });
  });

  it('…unless that one is a reset too — it lifts the cap', () => {
    const reset = [row('a1', 1, 1000), row('a2', 5, 10, { reset: true })];
    expect(counterPlacement(reset, entry(3, 5000))).toMatchObject({ ok: true });
  });

  it('a tie at the same `at` is ordered by id', () => {
    const tie = [row('a1', 3, 1000), row('zz', 3, 3000)];
    // «z9» sorts between «a1» and «zz»: above the first, below the second.
    expect(counterPlacement(tie, entry(3, 2000))).toMatchObject({
      ok: true,
      previous: { id: 'a1' },
      next: { id: 'zz' },
    });
  });

  it('a correction leaves its own row out — it is not its own neighbour', () => {
    const own = [row('a1', 1, 1000), row('z9', 3, 1500), row('a3', 5, 2000)];
    expect(counterPlacement(own, entry(3, 1800))).toMatchObject({
      ok: true,
      previous: { id: 'a1' },
      next: { id: 'a3' },
    });
  });

  it('the lines of its own memo are one moment — never its neighbours', () => {
    // Four colours fitted at once: the other three lines already read 1500 on this printer.
    const memo = [
      row('a1', 1, 1000),
      row('b1', 3, 1500, { memoId: 'memo-new' }),
      row('b2', 3, 1500, { memoId: 'memo-new' }),
    ];
    expect(counterPlacement(memo, entry(3, 1500))).toMatchObject({
      ok: true,
      previous: { id: 'a1' },
    });
  });
});

describe('one memo, one printer, one reading — the rows a write of the reading reaches', () => {
  it('are the entry’s memo’s other rows on the printer, at its `at` — never its own, never another memo’s', () => {
    const timeline = [
      row('a1', 1, 1000),
      row('b1', 3, 1000, { memoId: 'memo-new' }),
      row('z9', 3, 1000, { memoId: 'memo-new' }),
      row('b2', 3, 1000, { memoId: 'memo-new' }),
      row('c1', 5, 2000),
    ];
    expect(counterSiblings(timeline, entry(3, 1500)).map((r) => r.id)).toEqual(['b1', 'b2']);
  });

  it('a row with no memo has none', () => {
    const timeline = [row('a1', 3, 1000, { memoId: null }), row('a2', 3, 1000, { memoId: null })];
    expect(counterSiblings(timeline, entry(3, 1500, { memoId: null }))).toEqual([]);
  });
});

describe('which reading may leave a printer', () => {
  it('any reading that is not a reset', () => {
    const timeline = [row('a1', 1, 1000), row('a2', 2, 2000), row('a3', 3, 3000)];
    expect(counterRemoval(timeline, 'a2')).toEqual({ ok: true });
  });

  it('a reset the readings after it rest on is refused', () => {
    const timeline = [row('a1', 1, 5000), row('a2', 2, 10, { reset: true }), row('a3', 3, 900)];
    expect(counterRemoval(timeline, 'a2')).toEqual({
      ok: false,
      previous: timeline[0],
      next: timeline[2],
    });
  });

  it('a reset whose next reading still lies above the one before it may leave', () => {
    const timeline = [row('a1', 1, 500), row('a2', 2, 10, { reset: true }), row('a3', 3, 900)];
    expect(counterRemoval(timeline, 'a2')).toEqual({ ok: true });
  });

  it('a reset with nothing after it — or nothing before it — may leave', () => {
    expect(counterRemoval([row('a1', 1, 500), row('a2', 2, 10, { reset: true })], 'a2')).toEqual({
      ok: true,
    });
    expect(counterRemoval([row('a1', 1, 10, { reset: true }), row('a2', 2, 9)], 'a1')).toEqual({
      ok: true,
    });
  });

  it('a row that is not on the timeline leaves nothing', () => {
    expect(counterRemoval([row('a1', 1, 500)], 'nope')).toEqual({ ok: true });
  });
});

describe('what each cartridge printed', () => {
  const key = (r: CounterRow & { item: string }) => r.item;

  it('a mono printer: each toner the one before it, this reading less its own', () => {
    const pairs = pairCounterReadings(
      [row('a1', 1, 1000), row('a2', 2, 4000), row('a3', 3, 6500)],
      key,
    );
    expect(
      pairs.map((p) => p.replaced && { id: p.replaced.row.id, pages: p.replaced.pages }),
    ).toEqual([null, { id: 'a1', pages: 3000 }, { id: 'a2', pages: 2500 }]);
  });

  it('a colour printer: K, C, K interleaved — each colour pairs with its own', () => {
    const pairs = pairCounterReadings(
      [
        row('a1', 1, 1000, { item: 'K' }),
        row('a2', 2, 1500, { item: 'C' }),
        row('a3', 3, 4000, { item: 'K' }),
      ],
      key,
    );
    expect(pairs[1]?.replaced).toBeNull();
    expect(pairs[2]?.replaced).toMatchObject({ row: { id: 'a1' }, pages: 3000 });
  });

  it('a reset between two cartridges makes the pages unknown', () => {
    const pairs = pairCounterReadings(
      [row('a1', 1, 9000), row('a2', 2, 100, { item: 'C', reset: true }), row('a3', 3, 2000)],
      key,
    );
    expect(pairs[2]?.replaced).toMatchObject({ row: { id: 'a1' }, pages: null });
  });

  it('a four-colour memo reset at 0 is ONE reset: the next memo’s four colours each pair with their own', () => {
    // «One memo, one printer, one reading»: K, C, M, Y fitted at once on a counter set back to 0,
    // then the next four at 5000. Counting each reset row as a reset of its own would leave K, C, M
    // a reset behind their pair, and only Y known.
    const colours = ['K', 'C', 'M', 'Y'];
    const reset = colours.map((item, i) =>
      row(`b${String(i)}`, 2, 0, { item, memoId: 'memo-reset', reset: true }),
    );
    const next = colours.map((item, i) =>
      row(`c${String(i)}`, 3, 5000, { item, memoId: 'memo-next' }),
    );
    const before = colours.map((item, i) => row(`a${String(i)}`, 1, 9000, { item, memoId: 'm1' }));
    const pairs = pairCounterReadings([...before, ...reset, ...next], key);

    // Across the reset: unknown, every colour.
    expect(pairs.slice(4, 8).map((p) => [p.row.id, p.replaced?.pages])).toEqual([
      ['b0', null],
      ['b1', null],
      ['b2', null],
      ['b3', null],
    ]);
    // After it: 5000 each, every colour.
    expect(pairs.slice(8).map((p) => [p.row.item, p.replaced?.row.id, p.replaced?.pages])).toEqual([
      ['K', 'b0', 5000],
      ['C', 'b1', 5000],
      ['M', 'b2', 5000],
      ['Y', 'b3', 5000],
    ]);
  });

  it('two reset memos are two resets — a pair across the second is unknown again', () => {
    const pairs = pairCounterReadings(
      [
        row('a1', 1, 0, { memoId: 'm1', reset: true }),
        row('a2', 1, 0, { item: 'C', memoId: 'm1', reset: true }),
        row('b1', 2, 0, { item: 'C', memoId: 'm2', reset: true }),
        row('c1', 3, 800),
      ],
      key,
    );
    // K's 0 (memo m1) and K's 800 lie either side of memo m2's reset.
    expect(pairs[3]?.replaced).toMatchObject({ row: { id: 'a1' }, pages: null });
  });

  it('the reset row itself starts the new count: pairs after it are known again', () => {
    const pairs = pairCounterReadings(
      [row('a1', 1, 100, { reset: true }), row('a2', 2, 700), row('a3', 3, 1000)],
      key,
    );
    expect(pairs[1]?.replaced?.pages).toBe(600);
    expect(pairs[2]?.replaced?.pages).toBe(300);
  });

  it('the first of a model on the printer replaced nothing', () => {
    const pairs = pairCounterReadings(
      [row('a1', 1, 1000, { item: 'HP 85A' }), row('a2', 2, 3000, { item: 'HP 12A' })],
      key,
    );
    expect(pairs.map((p) => p.replaced)).toEqual([null, null]);
  });

  it('A, then B, then A on one slot: A’s second is credited with everything since A’s first', () => {
    // Pinned as documented (§7, decision 4): the system does not know how many slots a printer has.
    const pairs = pairCounterReadings(
      [
        row('a1', 1, 1000, { item: 'A' }),
        row('a2', 2, 2000, { item: 'B' }),
        row('a3', 3, 3000, { item: 'A' }),
      ],
      key,
    );
    expect(pairs[2]?.replaced).toMatchObject({ row: { id: 'a1' }, pages: 2000 });
  });

  it('pairs by the key it is given — the same name from two stores pairs, different names do not', () => {
    const names: Record<string, string> = { s1: 'حبر HP 85A', s2: 'حبر HP 85A', s3: 'حبر HP 12A' };
    const rows = [
      row('a1', 1, 1000, { item: 's1' }),
      row('a2', 2, 2500, { item: 's2' }),
      row('a3', 3, 4000, { item: 's3' }),
    ];
    const pairs = pairCounterReadings(rows, (r) => names[r.item] ?? r.item);
    expect(pairs[1]?.replaced).toMatchObject({ row: { id: 'a1' }, pages: 1500 });
    expect(pairs[2]?.replaced).toBeNull();
  });

  it('answers oldest first, whatever order it was handed', () => {
    const pairs = pairCounterReadings([row('a3', 3, 3000), row('a1', 1, 1000)], key);
    expect(pairs.map((p) => p.row.id)).toEqual(['a1', 'a3']);
  });
});

describe('the average per cartridge', () => {
  it('is the mean of the known pages, rounded', () => {
    expect(averagePages([3000, null, 2501])).toBe(2751);
  });

  it('is null when none is known', () => {
    expect(averagePages([])).toBeNull();
    expect(averagePages([null, null])).toBeNull();
  });
});
