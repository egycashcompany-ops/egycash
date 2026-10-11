// «تصحيح القراءة» on the shapes the old book really left — decided without a database.
//
// The figures are car 219's and car 295's as the 29 September export has them: a typo row
// (118,722 / 79,200) the import closed with the next day's opening, and a book «rollback» where a
// day reads lower than the day before it. Neighbours are by DATE (`findNeighbors`), and the rules
// here are what keeps that from refusing or rewriting what nobody asked to change.
import { describe, expect, it } from 'vitest';
import { planCorrection, type ChainRow } from './correction-rules';

let seq = 0;
/** A row; ids increase in the order rows are made, as ObjectIds do. */
const row = (date: string, outReading: number | null, inReading: number | null): ChainRow => {
  seq += 1;
  return {
    _id: { toString: () => seq.toString(16).padStart(24, '0') },
    date: new Date(`${date}T00:00:00.000Z`),
    outReading,
    inReading,
  };
};

const plan = (result: ReturnType<typeof planCorrection>) => {
  if ('refusal' in result) throw new Error(`refused: ${result.refusal.message}`);
  return result.plan;
};
const refusal = (result: ReturnType<typeof planCorrection>) => {
  if (!('refusal' in result)) throw new Error('expected a refusal');
  return result.refusal;
};

describe('car 219 — the 118,722 typo of 29–30 July', () => {
  // 29 Jul 85,482 → 118,722 (the typo, as the book wrote it); 30 Jul 118,722 → 85,543 (the import
  // closed the bad in-reading with the next day's opening); 31 Jul 85,543 → …
  const jul29 = row('2026-07-29', 85_482, 118_722);
  const jul30 = row('2026-07-30', 118_722, 85_543);
  const jul31 = row('2026-07-31', 85_543, 85_600);

  it('correcting the typo rewrites the day BEFORE it, which shares the figure', () => {
    const result = plan(planCorrection(jul30, { outReading: 85_500 }, jul29, jul31));
    expect(result.newOut).toBe(85_500);
    // 29 July closed on 118,722 — the same physical reading — so it closes on 85,500 now.
    expect(result.prevIn).toBe(85_500);
    // The closing reading was not touched, so the next day is not either.
    expect(result.nextOut).toBeUndefined();
  });

  it('the 30 July row may close below its typo now — only its own new pair is checked', () => {
    // 85,500 → 85,543 is a forward period; the 118,722 it used to open on is what was wrong.
    expect('plan' in planCorrection(jul30, { outReading: 85_500 }, jul29, jul31)).toBe(true);
  });

  it('a correction BELOW the day before is still refused — an odometer does not run backwards', () => {
    expect(refusal(planCorrection(jul30, { outReading: 85_000 }, jul29, jul31)).field).toBe(
      'outReading',
    );
  });

  it('equal to the day before is accepted, as record() accepts it — a car that did not move', () => {
    expect(plan(planCorrection(jul30, { outReading: 85_482 }, jul29, jul31)).prevIn).toBe(85_482);
  });
});

describe('only what the request changes is checked', () => {
  // A book «rollback»: 5 March 79,180 → 79,146 (the import closed it on the 6th's opening), and
  // the 6th reads 79,146 — lower than the 5th's opening. Both rows are as the book wrote them.
  const mar05 = row('2026-03-05', 79_180, 79_146);
  const mar06 = row('2026-03-06', 79_146, 79_300);
  const mar07 = row('2026-03-07', 79_300, null);

  it('a note or a driver on the row after a rollback saves — no reading was asked to change', () => {
    expect('plan' in planCorrection(mar06, {}, mar05, mar07)).toBe(true);
    expect('plan' in planCorrection(mar05, {}, null, mar06)).toBe(true);
  });

  it('the same figure sent back unchanged is not a change either', () => {
    expect('plan' in planCorrection(mar06, { outReading: 79_146 }, mar05, mar07)).toBe(true);
  });

  it('but a reading the request DOES change is held to the day before', () => {
    expect(refusal(planCorrection(mar06, { outReading: 79_150 }, mar05, mar07)).field).toBe(
      'outReading',
    );
  });

  it('a period may not end below its own start, when the request moves either end', () => {
    expect(refusal(planCorrection(mar06, { inReading: 79_100 }, mar05, mar07)).message).toContain(
      'below its own start',
    );
  });
});

describe('only a LINKED neighbour is rewritten', () => {
  it('a day before that closed on some other figure keeps it', () => {
    // The book never chained these two: the 1st closed on 1,450, the 2nd opens on 1,500.
    const first = row('2026-08-01', 1_000, 1_450);
    const second = row('2026-08-02', 1_500, 1_600);
    const result = plan(planCorrection(second, { outReading: 1_480 }, first, null));
    expect(result.prevIn).toBeUndefined();
  });

  it('a next day that opened on some other figure keeps it', () => {
    const first = row('2026-08-01', 1_000, 1_450);
    const second = row('2026-08-02', 1_500, 1_600);
    const result = plan(planCorrection(first, { inReading: 1_460 }, null, second));
    expect(result.nextOut).toBeUndefined();
  });

  it('a linked next day moves with the closing reading', () => {
    const first = row('2026-08-01', 1_000, 1_500);
    const second = row('2026-08-02', 1_500, 1_600);
    expect(plan(planCorrection(first, { inReading: 1_520 }, null, second)).nextOut).toBe(1_520);
  });

  it('…but not past the next day’s own closing reading', () => {
    const first = row('2026-08-01', 1_000, 1_500);
    const second = row('2026-08-02', 1_500, 1_600);
    expect(refusal(planCorrection(first, { inReading: 1_601 }, null, second)).message).toContain(
      'overlaps the next period',
    );
    // Equal to it is a zero-km next day, which is allowed.
    expect(plan(planCorrection(first, { inReading: 1_600 }, null, second)).nextOut).toBe(1_600);
  });

  it('a middle period is never reopened', () => {
    const first = row('2026-08-01', 1_000, 1_500);
    const second = row('2026-08-02', 1_500, null);
    expect(refusal(planCorrection(first, { inReading: null }, null, second)).message).toContain(
      'cannot be reopened',
    );
  });
});

describe('a new date keeps the row in its place', () => {
  const prev = row('2026-09-01', 1_000, 1_100);
  const entry = row('2026-09-03', 1_100, 1_200);
  const next = row('2026-09-05', 1_200, null);

  it('a day mistyped by one, still between its neighbours, is corrected', () => {
    const moved = { date: new Date('2026-09-04T00:00:00.000Z') };
    expect('plan' in planCorrection(entry, moved, prev, next)).toBe(true);
  });

  it('onto a neighbour’s own day is still between them when the order of writing agrees', () => {
    // `entry` was written after `prev`, so on the same day it still comes after it.
    const sameDay = { date: new Date('2026-09-01T00:00:00.000Z') };
    expect('plan' in planCorrection(entry, sameDay, prev, null)).toBe(true);
  });

  it('past the day before or the day after, it is refused', () => {
    expect(
      refusal(planCorrection(entry, { date: new Date('2026-08-31T00:00:00.000Z') }, prev, next))
        .field,
    ).toBe('date');
    expect(
      refusal(planCorrection(entry, { date: new Date('2026-09-06T00:00:00.000Z') }, prev, next))
        .field,
    ).toBe('date');
  });

  it('the same date sent back is not a move', () => {
    expect('plan' in planCorrection(entry, { date: entry.date }, prev, next)).toBe(true);
  });

  it('a row with no neighbour on a side is free on that side', () => {
    expect(
      'plan' in planCorrection(entry, { date: new Date('2026-12-01T00:00:00.000Z') }, prev, null),
    ).toBe(true);
  });
});
