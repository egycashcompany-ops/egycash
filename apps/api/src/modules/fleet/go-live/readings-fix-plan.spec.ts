// The readings fix's decisions, without a database — on the shapes the 29 September export
// actually holds for the owner's four cars, and on the shapes the rule must refuse.
import { describe, expect, it } from 'vitest';
import { odometerBracketBreach } from '@ecms/contracts';
import { noteWith } from './legacy-row';
import {
  OWNER_DAY,
  OWNER_FACTS,
  clearedNote,
  counterField,
  counterNote,
  describeAlarm,
  describeOnceRecorded,
  describeToday,
  earlierWrites,
  expectedSince,
  pickServiceVisit,
  planCounter,
  planTypoReadings,
  reclosedNote,
  startOfDay,
  withEarlierWrites,
  type ChainRow,
  type OwnerFact,
  type ServiceCeiling,
  type ServiceVisit,
  type TypoPlan,
} from './readings-fix-plan';

const CUTOFF = startOfDay(OWNER_DAY);
const d = (day: string): Date => startOfDay(day);
let seq = 0;
/** A 24-hex id that sorts in the order rows are made, as ObjectIds do. */
const nextId = (): string => (seq++).toString(16).padStart(24, '0');
const row = (
  day: string,
  out: number,
  inReading: number | null,
  notes: string | null = null,
): ChainRow => ({
  id: nextId(),
  date: d(day),
  out,
  in: inReading,
  notes,
});
const fact = (code: string): OwnerFact => OWNER_FACTS.find((f) => f.code === code) as OwnerFact;

/** The rows as they stand once a plan is written — what a second run would read. */
const applied = (rows: readonly ChainRow[], plan: TypoPlan): ChainRow[] => {
  if (plan.kind !== 'fix') return [...rows];
  const cleared = new Set(plan.clear.map((r) => r.id));
  const reclosed = new Map(plan.reclose.map((r) => [r.id, r.newIn]));
  return rows
    .filter((r) => !cleared.has(r.id))
    .map((r) => (reclosed.has(r.id) ? { ...r, in: reclosed.get(r.id) ?? null } : r));
};

describe('the owner’s facts', () => {
  it('are the four cars the owner sent, with their figures — and not the three still to come', () => {
    expect(OWNER_DAY).toBe('2026-10-11');
    expect(OWNER_FACTS.map((f) => [f.code, f.today, f.serviceDay, f.counter])).toEqual([
      ['219', 90246, '2026-06-25', 84080],
      ['295', 24892, '2026-10-06', 22790],
      ['248', 121679, '2026-10-09', 121679],
      ['249', 117647, '2026-09-05', 113325],
    ]);
    for (const later of ['266', '246', '503']) {
      expect(
        OWNER_FACTS.some((f) => f.code === later),
        later,
      ).toBe(false);
    }
  });

  it('the maintenance «فارق» the owner expects is today’s reading less that counter', () => {
    expect(OWNER_FACTS.map((f) => [f.code, expectedSince(f)])).toEqual([
      ['219', 6166],
      ['295', 2102],
      ['248', 0],
      ['249', 4322],
    ]);
  });
});

describe('(a) a figure above today’s reading, on a day before today', () => {
  it('car 219: 30 July opens on 118,722 — cleared; 29 July closed on 31 July’s 85,543', () => {
    const rows = [
      row('2026-07-28', 85428, 85482),
      row('2026-07-29', 85482, 118722),
      row('2026-07-30', 118722, 85543, 'اسوان'),
      row('2026-07-31', 85543, 85586),
      row('2026-09-29', 89234, null),
    ];
    const plan = planTypoReadings(rows, fact('219').today, CUTOFF);
    expect(plan.kind).toBe('fix');
    if (plan.kind !== 'fix') return;
    expect(
      plan.clear.map((r) => [r.date.toISOString().slice(0, 10), r.out, r.in, r.notes]),
    ).toEqual([['2026-07-30', 118722, 85543, 'اسوان']]);
    expect(
      plan.reclose.map((r) => [r.date.toISOString().slice(0, 10), r.out, r.oldIn, r.newIn]),
    ).toEqual([['2026-07-29', 85482, 118722, 85543]]);
  });

  it('car 295: the second row of 30 July opens on 79,200 — cleared; the first closed on 2 August’s 10,184', () => {
    const rows = [
      row('2026-07-29', 7884, 7997),
      row('2026-07-30', 7997, 79200),
      row('2026-07-30', 79200, 10184),
      row('2026-08-02', 10184, 10280),
      row('2026-10-05', 22400, null),
    ];
    const plan = planTypoReadings(rows, fact('295').today, CUTOFF);
    expect(plan.kind).toBe('fix');
    if (plan.kind !== 'fix') return;
    expect(plan.clear.map((r) => r.id)).toEqual([rows[2]?.id]);
    expect(plan.reclose.map((r) => [r.id, r.newIn])).toEqual([[rows[1]?.id, 10184]]);
  });

  it('cars 248 and 249: nothing above today’s reading — nothing to do', () => {
    // 249's 2,031 km between 2 and 3 September is not above 117,647, so it is not this rule's —
    // it is (a2)'s, below.
    const rows249 = [
      row('2026-09-02', 112840, 114871),
      row('2026-09-03', 114871, 115142),
      row('2026-09-29', 116910, null),
    ];
    expect(planTypoReadings(rows249, fact('249').today, CUTOFF)).toEqual({ kind: 'nothing' });
    const rows248 = [row('2026-09-22', 116708, 119092), row('2026-09-29', 119092, null)];
    expect(planTypoReadings(rows248, fact('248').today, CUTOFF)).toEqual({ kind: 'nothing' });
  });

  it('a second run finds nothing — the step is idempotent', () => {
    const rows = [
      row('2026-07-29', 85482, 118722),
      row('2026-07-30', 118722, 85543),
      row('2026-07-31', 85543, null),
    ];
    const plan = planTypoReadings(rows, 90246, CUTOFF);
    expect(planTypoReadings(applied(rows, plan), 90246, CUTOFF)).toEqual({ kind: 'nothing' });
  });

  it('a typo on the OPEN period: the row before it becomes the open period again', () => {
    const rows = [
      row('2026-10-01', 100, 200),
      row('2026-10-02', 200, 99999),
      row('2026-10-03', 99999, null),
    ];
    const plan = planTypoReadings(rows, 500, CUTOFF);
    expect(plan.kind).toBe('fix');
    if (plan.kind !== 'fix') return;
    expect(plan.clear.map((r) => r.id)).toEqual([rows[2]?.id]);
    expect(plan.reclose).toEqual([
      expect.objectContaining({ id: rows[1]?.id, oldIn: 99999, newIn: null }),
    ]);
  });

  it('consecutive typo rows are all cleared, and the row before them closes on the next real reading', () => {
    const rows = [
      row('2026-08-01', 100, 150),
      row('2026-08-02', 150, 9000),
      row('2026-08-03', 9000, 9100),
      row('2026-08-04', 9100, 160),
      row('2026-08-05', 160, null),
    ];
    const plan = planTypoReadings(rows, 1000, CUTOFF);
    expect(plan.kind).toBe('fix');
    if (plan.kind !== 'fix') return;
    expect(plan.clear.map((r) => r.id)).toEqual([rows[2]?.id, rows[3]?.id]);
    expect(plan.reclose.map((r) => [r.id, r.newIn])).toEqual([[rows[1]?.id, 160]]);
  });

  it('a row dated on the owner’s day or after it is not judged by today’s reading', () => {
    // 990 and 1,200 are above 960 — and were read on the owner's day or since, which the owner's
    // reading does not speak for.
    const rows = [
      row('2026-10-10', 900, 950),
      row(OWNER_DAY, 950, 990),
      row('2026-10-12', 1200, null),
    ];
    expect(planTypoReadings(rows, 960, CUTOFF)).toEqual({ kind: 'nothing' });
  });

  it('leaves the car when the next reading is below the row’s own opening', () => {
    const rows = [
      row('2026-08-01', 100, 9000),
      row('2026-08-02', 9000, 90),
      row('2026-08-03', 90, null),
    ];
    const plan = planTypoReadings(rows, 1000, CUTOFF);
    expect(plan).toEqual({
      kind: 'left',
      found: ['2026-08-01: 100 → 9000', '2026-08-02: 9000 → 90'],
      reason: '2026-08-01: the reading after it (90) is below its own opening 100',
    });
  });

  it('a closing reading handed on to a row of the owner’s day was read that day — the typo before it is still fixed', () => {
    // 90,300 closes 10 October and opens the 11th: the clerk's reading of the 11th, not a typo of
    // the 10th, even though it is above the owner's morning 90,246.
    const rows = [
      row('2026-07-29', 85482, 118722),
      row('2026-07-30', 118722, 85543),
      row('2026-07-31', 85543, 90100),
      row('2026-10-10', 90100, 90300),
      row(OWNER_DAY, 90300, null),
    ];
    const plan = planTypoReadings(rows, fact('219').today, CUTOFF);
    expect(plan.kind).toBe('fix');
    if (plan.kind !== 'fix') return;
    expect(plan.clear.map((r) => r.id)).toEqual([rows[1]?.id]);
    expect(plan.reclose.map((r) => [r.id, r.newIn])).toEqual([[rows[0]?.id, 85543]]);
    // The same when the clerk skipped the 11th and the next reading is the 12th's.
    const skipped = [
      row('2026-07-29', 85482, 118722),
      row('2026-07-30', 118722, 85543),
      row('2026-10-10', 85543, 90400),
      row('2026-10-12', 90400, null),
    ];
    expect(planTypoReadings(skipped, fact('219').today, CUTOFF)).toMatchObject({
      kind: 'fix',
      clear: [expect.objectContaining({ id: skipped[1]?.id })],
      reclose: [expect.objectContaining({ id: skipped[0]?.id, newIn: 85543 })],
    });
  });

  it('leaves the car when the next reading is above today’s too — a row the rule may not touch', () => {
    // 5,000 is not what the 12th opened on, so it is the 9th's own figure — and 4,000 after it is
    // above today's too.
    const rows = [row('2026-10-09', 100, 5000), row('2026-10-12', 4000, null)];
    const plan = planTypoReadings(rows, 1000, CUTOFF);
    expect(plan.kind).toBe('left');
    if (plan.kind === 'left') expect(plan.reason).toContain('above today');
  });

  it('leaves the car when it would lose its open period', () => {
    // The row before the typo never closed on it — the book never chained them.
    const rows = [row('2026-08-01', 100, 200), row('2026-08-02', 99999, null)];
    expect(planTypoReadings(rows, 500, CUTOFF)).toMatchObject({
      kind: 'left',
      reason: 'the car would end with no open period',
    });
  });

  it('leaves the car when the day already has a row without a reading', () => {
    const rows = [
      row('2026-07-29', 85482, 118722),
      row('2026-07-30', 118722, 85543),
      row('2026-07-31', 85543, null),
    ];
    expect(planTypoReadings(rows, 90246, CUTOFF, ['2026-07-30'])).toMatchObject({
      kind: 'left',
      reason: '2026-07-30 already has a row without a reading',
    });
  });

  it('keeps the figures in the notes, in the screen’s own column names', () => {
    expect(clearedNote({ out: 118722, in: 85543 })).toBe(
      'كما كُتب: عداد الخروج 118722، عداد الدخول 85543',
    );
    expect(clearedNote({ out: 99999, in: null })).toBe(
      'كما كُتب: عداد الخروج 99999، عداد الدخول —',
    );
    expect(reclosedNote({ oldIn: 118722 })).toBe('عداد الدخول كما كُتب: 118722');
    // Beside whatever the row already said.
    expect(noteWith('اسوان', clearedNote({ out: 118722, in: 85543 }))).toBe(
      'اسوان · كما كُتب: عداد الخروج 118722، عداد الدخول 85543',
    );
  });
});

describe('(a2) a figure above the last maintenance counter, on a day before that maintenance', () => {
  const service = (code: string): ServiceCeiling => ({
    before: d(fact(code).serviceDay),
    counter: fact(code).counter,
  });
  /** The plan for one of the owner's cars, by both of the owner's figures — as the step asks it. */
  const plan = (code: string, rows: readonly ChainRow[], emptyDays: string[] = []): TypoPlan =>
    planTypoReadings(rows, fact(code).today, CUTOFF, emptyDays, service(code));
  const days = (rows: readonly { date: Date }[]): string[] =>
    rows.map((r) => r.date.toISOString().slice(0, 10));
  /** Car 249 as the 29 September export has it around its 5 September service (113,325). */
  const car249 = (): ChainRow[] => [
    row('2026-08-31', 112418, 112533),
    row('2026-09-01', 112533, 112840),
    row('2026-09-02', 112840, 114871),
    row('2026-09-03', 114871, 115142),
    row('2026-09-06', 115124, 115322),
    row('2026-09-07', 115322, 115325),
    row('2026-09-08', 115325, 115530, 'شلاتيين'),
    row('2026-09-28', 116880, 116910),
    row('2026-09-29', 116910, null),
  ];

  it('car 249: 3 September opens above 113,325 — a day without a reading; 2 September only closes above it — closed on 6 September’s 115,124', () => {
    const rows = car249();
    const fix = plan('249', rows);
    expect(fix.kind).toBe('fix');
    if (fix.kind !== 'fix') return;
    expect(fix.clear.map((r) => [r.id, r.out, r.in, r.why])).toEqual([
      [rows[3]?.id, 114871, 115142, 'opens above the 2026-09-05 maintenance counter 113325'],
    ]);
    // 115,124 opens 6 September and was read then, after the service: the counter does not speak
    // for it. 2 September's own opening, 112,840, stands — 1 September closed on it.
    expect(fix.reclose.map((r) => [r.id, r.out, r.oldIn, r.newIn, r.why])).toEqual([
      [
        rows[2]?.id,
        112840,
        114871,
        115124,
        'closed above the 2026-09-05 maintenance counter 113325',
      ],
    ]);
    // Nothing of the maintenance day or after is touched, though every figure there is above
    // 113,325 — nor anything at or below it before.
    const touched = new Set([...fix.clear, ...fix.reclose].map((r) => r.id));
    expect(days(rows.filter((r) => !touched.has(r.id)))).toEqual([
      '2026-08-31',
      '2026-09-01',
      '2026-09-06',
      '2026-09-07',
      '2026-09-08',
      '2026-09-28',
      '2026-09-29',
    ]);
    // And the chain is whole where it was touched: each row closes on the next one's opening —
    // 3 September's 115,142 against the 6th's 115,124 is gone with it.
    const after = applied(rows, fix);
    expect(after.slice(0, 4).map((r) => [r.out, r.in])).toEqual([
      [112418, 112533],
      [112533, 112840],
      [112840, 115124],
      [115124, 115322],
    ]);
  });

  it('car 249: the alarm then takes the 113,325 counter, and the owner’s 4,322 follows from today’s reading', () => {
    const rows = car249();
    const after = applied(rows, plan('249', rows));
    // The alarm's own guard: the highest OPENING dated on or before the service day.
    const lowerBound = Math.max(
      ...after.filter((r) => r.date.getTime() <= d('2026-09-05').getTime()).map((r) => r.out),
    );
    expect(lowerBound).toBe(112840);
    expect(odometerBracketBreach(113325, { lowerBound, upperBound: null })).toBeNull();
    expect(fact('249').today - 113325).toBe(expectedSince(fact('249')));
    expect(expectedSince(fact('249'))).toBe(4322);
    // Before (a2) it was refused — 3 September's 114,871 stood above the counter.
    expect(odometerBracketBreach(113325, { lowerBound: 114871, upperBound: null })).toBe(
      'belowChain',
    );
  });

  it('only the closing above: closed on the opening of the next row that stays, the figure kept for the note', () => {
    const rows = [
      row('2026-09-01', 112533, 112840),
      row('2026-09-02', 112840, 114871),
      row('2026-09-03', 113140, 113300),
      row('2026-09-06', 113400, null),
    ];
    const fix = plan('249', rows);
    expect(fix).toEqual({
      kind: 'fix',
      clear: [],
      reclose: [
        {
          id: rows[1]?.id,
          date: d('2026-09-02'),
          out: 112840,
          oldIn: 114871,
          newIn: 113140,
          notes: null,
          why: 'closed above the 2026-09-05 maintenance counter 113325',
        },
      ],
    });
    expect(reclosedNote({ oldIn: 114871 })).toBe('عداد الدخول كما كُتب: 114871');
  });

  it('only the closing above, and the next row opens below its own opening: never closed below it — a day without a reading', () => {
    const rows = [
      row('2026-09-02', 112840, 114871),
      row('2026-09-03', 112800, 113000),
      row('2026-09-06', 113400, null),
    ];
    expect(plan('249', rows)).toMatchObject({
      kind: 'fix',
      clear: [
        {
          id: rows[0]?.id,
          why: 'closes above the 2026-09-05 maintenance counter 113325, and the reading after it (112800) is below its own opening 112840',
        },
      ],
      reclose: [],
    });
  });

  it('the row that closed on such a row’s opening is closed on the next row that stays — as a deleted row is re-linked — or the car is left', () => {
    // 2 September's opening of 112,840 stood, and 1 September closed on it; with the 2nd a day
    // without a reading, the 1st would close on a reading no longer on the chain.
    const rows = [
      row('2026-09-01', 112533, 112840),
      row('2026-09-02', 112840, 114871),
      row('2026-09-03', 112800, 113000),
      row('2026-09-06', 113400, null),
    ];
    const fix = plan('249', rows);
    expect(fix).toMatchObject({ kind: 'fix', clear: [{ id: rows[1]?.id }] });
    if (fix.kind !== 'fix') return;
    expect(fix.reclose.map((r) => [r.id, r.oldIn, r.newIn, r.why])).toEqual([
      [rows[0]?.id, 112840, 112800, 'it closed on 2026-09-02, now a day without a reading'],
    ]);
    expect(plan('249', applied(rows, fix), ['2026-09-02'])).toEqual({ kind: 'nothing' });
    // Where the next row that stays opens below the 1st's own opening too, nothing is written.
    const stuck = [
      row('2026-09-01', 112820, 112840),
      row('2026-09-02', 112840, 114871),
      row('2026-09-03', 112800, 113000),
      row('2026-09-06', 113400, null),
    ];
    expect(plan('249', stuck)).toMatchObject({
      kind: 'left',
      reason: '2026-09-01: the reading after it (112800) is below its own opening 112820',
    });
  });

  it('the next row that stays opens above today’s, after the owner’s day: a day without a reading — and a row closed on it is not moved there', () => {
    const rows = [row('2026-09-02', 112840, 114871), row('2026-10-12', 118000, null)];
    expect(plan('249', rows)).toMatchObject({
      kind: 'fix',
      clear: [
        {
          id: rows[0]?.id,
          why: "closes above the 2026-09-05 maintenance counter 113325, and the reading after it (118000) is above today's 117647 too",
        },
      ],
      reclose: [],
    });
    const before = [row('2026-09-01', 112533, 112840), ...rows];
    expect(plan('249', before)).toMatchObject({
      kind: 'left',
      reason: "2026-09-01: the reading after it (118000) is above today's 117647 too",
    });
  });

  it('the maintenance day starts at midnight UTC, as every date is stored', () => {
    const late = {
      ...row('2026-09-04', 113400, 113500),
      date: new Date('2026-09-04T23:59:59.999Z'),
    };
    const rows = [
      row('2026-09-03', 113000, 113400),
      late,
      row('2026-09-05', 113500, 113600),
      row('2026-09-06', 113600, null),
    ];
    expect(plan('249', rows)).toMatchObject({
      kind: 'fix',
      clear: [{ id: late.id }],
      reclose: [{ id: rows[0]?.id, newIn: 113500 }],
    });
  });

  it('never touches a row of the maintenance day or after, nor one at or below the counter', () => {
    const rows = [
      // Closes AT the counter — not above it.
      row('2026-09-03', 113000, 113325),
      // Closes above it — on the 113,400 the 5th opens on: read on the maintenance day, not before.
      row('2026-09-04', 113325, 113400),
      // The maintenance day itself, and after: above the counter, and not this rule's.
      row('2026-09-05', 113400, 113600),
      row('2026-09-06', 113600, null),
    ];
    expect(plan('249', rows)).toEqual({ kind: 'nothing' });
  });

  it('a row (a2) clears is not a row that stays: the row before it is decided again', () => {
    // 2 September has nothing possible after it (the 3rd's 112,800 is below its own opening) and
    // is cleared. 1 September closed above the counter too; it could close on the 2nd's 112,900,
    // but the next row that stays is the 3rd — below its 112,850, so it is cleared as well.
    const rows = [
      row('2026-09-01', 112850, 113500),
      row('2026-09-02', 112900, 113600),
      row('2026-09-03', 112800, 113000),
      row('2026-09-06', 113400, null),
    ];
    expect(plan('249', rows)).toMatchObject({
      kind: 'fix',
      clear: [{ id: rows[0]?.id }, { id: rows[1]?.id }],
      reclose: [],
    });
    // Opening at 112,700, the 1st closes on the 3rd's 112,800 — not on the cleared 2nd's 112,900.
    const lower = [
      row('2026-09-01', 112700, 113500),
      row('2026-09-02', 112900, 113600),
      row('2026-09-03', 112800, 113000),
      row('2026-09-06', 113400, null),
    ];
    expect(plan('249', lower)).toMatchObject({
      kind: 'fix',
      clear: [{ id: lower[1]?.id }],
      reclose: [{ id: lower[0]?.id, newIn: 112800 }],
    });
  });

  it('a second run finds nothing — the step is idempotent', () => {
    const rows = car249();
    const first = plan('249', rows);
    expect(first.kind).toBe('fix');
    const cleared = first.kind === 'fix' ? days(first.clear) : [];
    expect(plan('249', applied(rows, first), cleared)).toEqual({ kind: 'nothing' });
    const reclosing = [
      row('2026-09-02', 112840, 114871),
      row('2026-09-03', 113140, 113300),
      row('2026-09-06', 113400, null),
    ];
    expect(plan('249', applied(reclosing, plan('249', reclosing)))).toEqual({ kind: 'nothing' });
  });

  it('the same guards: never two rows without a reading on one day', () => {
    expect(plan('249', car249(), ['2026-09-03'])).toMatchObject({
      kind: 'left',
      found: ['2026-09-02: 112840 → 114871', '2026-09-03: 114871 → 115142'],
      reason: '2026-09-03 already has a row without a reading',
    });
    // 2 September is re-closed, not cleared: a row of its day without a reading is no matter.
    expect(plan('249', car249(), ['2026-09-02']).kind).toBe('fix');
    // A row cleared for its closing alone is held to the same guard.
    const closing = [row('2026-09-02', 112840, 114871), row('2026-09-03', 112800, null)];
    expect(plan('249', closing, ['2026-09-02'])).toMatchObject({
      kind: 'left',
      reason: '2026-09-02 already has a row without a reading',
    });
  });

  it('(a) is as it was: 219 and 295 decide the same by both figures, and their lines carry no (a2) reason', () => {
    const rows219 = [
      row('2026-06-24', 83992, 84037),
      row('2026-06-25', 84037, 84117),
      row('2026-07-29', 85482, 118722),
      row('2026-07-30', 118722, 85543, 'اسوان'),
      row('2026-07-31', 85543, 85586),
      row('2026-09-29', 89234, null),
    ];
    expect(plan('219', rows219)).toEqual(planTypoReadings(rows219, fact('219').today, CUTOFF));
    const rows295 = [
      row('2026-07-29', 7884, 7997),
      row('2026-07-30', 7997, 79200),
      row('2026-07-30', 79200, 10184),
      row('2026-08-02', 10184, 10280),
      row('2026-10-05', 22400, null),
    ];
    // 79,200 is above 295's 22,790 of 6 October too — (a)'s first, so its line reads as before.
    const fix = plan('295', rows295);
    expect(fix).toEqual(planTypoReadings(rows295, fact('295').today, CUTOFF));
    expect(fix).toMatchObject({ clear: [{ why: null }], reclose: [{ why: null }] });
  });
});

const visit = (over: Partial<ServiceVisit> & { inDate: Date }): ServiceVisit => ({
  id: nextId(),
  outDate: null,
  odometerAtService: null,
  exitOdometer: null,
  notes: null,
  ...over,
});

describe('(b) the last maintenance counter', () => {
  it('picks the one visit that went in on the day', () => {
    const v = visit({
      inDate: d('2026-06-25'),
      outDate: d('2026-06-28'),
      odometerAtService: 84080,
    });
    expect(pickServiceVisit([v], '2026-06-25')).toEqual({ kind: 'one', visit: v });
  });

  it('prefers the visit that went IN that day over one that came out that day', () => {
    const out = visit({ inDate: d('2026-06-20'), outDate: d('2026-06-25') });
    const went = visit({ inDate: d('2026-06-25') });
    expect(pickServiceVisit([out, went], '2026-06-25')).toEqual({ kind: 'one', visit: went });
  });

  it('else the one that came out that day', () => {
    const out = visit({ inDate: d('2026-06-20'), outDate: d('2026-06-25') });
    expect(pickServiceVisit([out], '2026-06-25')).toEqual({ kind: 'one', visit: out });
  });

  it('none, or several: nothing is chosen', () => {
    expect(pickServiceVisit([], '2026-10-06')).toEqual({ kind: 'none' });
    const a = visit({ inDate: d('2026-10-06') });
    const b = visit({ inDate: d('2026-10-06') });
    expect(pickServiceVisit([a, b], '2026-10-06')).toEqual({ kind: 'several', visits: [a, b] });
  });

  it('the counter is the exit counter only on a visit that came out that day with one — as the alarm reads it', () => {
    const sameDay = visit({
      inDate: d('2026-10-09'),
      outDate: d('2026-10-09'),
      odometerAtService: 121600,
      exitOdometer: 121650,
    });
    expect(counterField(sameDay, '2026-10-09')).toBe('exitOdometer');
    const noExit = visit({
      inDate: d('2026-10-09'),
      outDate: d('2026-10-09'),
      odometerAtService: 121600,
    });
    expect(counterField(noExit, '2026-10-09')).toBe('odometerAtService');
    // 219: in on the 25th, out on the 28th — the owner's day is the day in.
    const later = visit({
      inDate: d('2026-06-25'),
      outDate: d('2026-06-28'),
      odometerAtService: 84080,
      exitOdometer: 84200,
    });
    expect(counterField(later, '2026-06-25')).toBe('odometerAtService');
  });

  it('already the owner’s: nothing to write', () => {
    const v = visit({
      inDate: d('2026-09-05'),
      outDate: d('2026-09-05'),
      odometerAtService: 113325,
    });
    expect(planCounter(v, '2026-09-05', 113325)).toEqual({
      kind: 'already',
      field: 'odometerAtService',
    });
  });

  it('missing or different: set, the old figure carried for the note', () => {
    const empty = visit({ inDate: d('2026-10-06'), outDate: d('2026-10-06') });
    expect(planCounter(empty, '2026-10-06', 22790)).toEqual({
      kind: 'set',
      field: 'odometerAtService',
      old: null,
    });
    const typed = visit({
      inDate: d('2026-10-09'),
      outDate: d('2026-10-09'),
      odometerAtService: 121600,
      exitOdometer: 121700,
    });
    expect(planCounter(typed, '2026-10-09', 121679)).toEqual({
      kind: 'set',
      field: 'exitOdometer',
      old: 121700,
    });
  });

  it('never leaves a visit out below its own in', () => {
    const exitBelow = visit({
      inDate: d('2026-10-06'),
      outDate: d('2026-10-08'),
      odometerAtService: 79300,
      exitOdometer: 22000,
    });
    expect(planCounter(exitBelow, '2026-10-06', 22790)).toMatchObject({
      kind: 'conflict',
      field: 'odometerAtService',
    });
    const entryAbove = visit({
      inDate: d('2026-10-06'),
      outDate: d('2026-10-06'),
      odometerAtService: 79300,
      exitOdometer: 79400,
    });
    expect(planCounter(entryAbove, '2026-10-06', 22790)).toMatchObject({
      kind: 'conflict',
      field: 'exitOdometer',
    });
  });

  it('the visit’s note names the counter by the form’s own label', () => {
    expect(counterNote('odometerAtService', null)).toBe('العداد عند الصيانة كما كُتب: —');
    expect(counterNote('exitOdometer', 121700)).toBe('عداد الخروج من الصيانة كما كُتب: 121700');
  });
});

describe('(c) today’s reading — reported, never written', () => {
  const at = (reading: number, day: string) => ({ reading, date: d(day) });

  it('on the board', () => {
    expect(
      describeToday(fact('248'), { onDay: [121679], writable: true, lower: null, upper: null }),
    ).toBe('248 2026-10-11: 121679 is on the board');
  });

  it('not yet, and the board would take it now', () => {
    expect(
      describeToday(fact('219'), {
        onDay: [],
        writable: true,
        lower: at(89234, '2026-09-29'),
        upper: null,
      }),
    ).toBe('219 2026-10-11: no reading yet; 90246 would be accepted');
  });

  it('not yet, and the board would refuse it — naming the reading that refuses it', () => {
    expect(
      describeToday(fact('219'), {
        onDay: [],
        writable: true,
        lower: at(118722, '2026-07-30'),
        upper: null,
      }),
    ).toBe('219 2026-10-11: no reading yet; 90246 would be REFUSED — below 118722 on 2026-07-30');
  });

  it('a different figure on the day is reported and left; a day without a reading is said as such', () => {
    expect(
      describeToday(fact('295'), {
        onDay: [24900],
        writable: true,
        lower: at(24900, '2026-10-11'),
        upper: null,
      }),
    ).toBe(
      "295 2026-10-11: the board has 24900, not the owner's 24892 — left as it is; 24892 would be REFUSED — below 24900 on 2026-10-11",
    );
    expect(
      describeToday(fact('249'), { onDay: [null], writable: true, lower: null, upper: null }),
    ).toBe('249 2026-10-11: recorded without a reading; 117647 would be accepted');
    expect(
      describeToday(fact('249'), { onDay: [], writable: false, lower: null, upper: null }),
    ).toContain('disposed');
  });
});

describe('the maintenance board, reported', () => {
  it('now', () => {
    expect(describeAlarm('219', { level: 'none', sinceServiceKm: 5154, noAlarmReason: null })).toBe(
      '219: 5154 km since the service (none)',
    );
    expect(
      describeAlarm('249', {
        level: 'none',
        sinceServiceKm: null,
        noAlarmReason: 'baselineBelowChain',
      }),
    ).toBe('249: no figure — baselineBelowChain');
    expect(describeAlarm('219', null)).toContain('not active');
  });

  it('once today’s reading is recorded, beside the owner’s figure', () => {
    expect(
      describeOnceRecorded(
        fact('219'),
        { level: 'none', sinceServiceKm: 6166, noAlarmReason: null },
        { counter: 84080, lower: null },
      ),
    ).toBe("219: 6166 km once 90246 is recorded — the owner's 6166 ✓");
  });

  it('a reading still above the service counter, where (a2) could not clear it — said plainly', () => {
    const line = describeOnceRecorded(
      fact('249'),
      { level: 'none', sinceServiceKm: null, noAlarmReason: 'baselineBelowChain' },
      { counter: 113325, lower: { reading: 114871, date: d('2026-09-03') } },
    );
    expect(line).toContain('114871 on 2026-09-03');
    expect(line).toContain('113325');
    expect(line).toContain('did not clear');
    expect(line).toContain('4322');
  });
});

describe('the run row across attempts', () => {
  const attempt = (over: Partial<Record<string, string[]>> = {}) => ({
    applied: [],
    skipped: [],
    readingsCleared: [],
    readingsReclosed: [],
    countersSet: [],
    countersAlready: [],
    ...over,
  });

  it('keeps what an earlier attempt wrote — the retry finds it done and would report it as nothing', () => {
    // Attempt one cleared 219's 30 July and reclosed the 29th, then failed on the car's visit.
    const earlier = earlierWrites({
      applied: ['219: 2 readings'],
      readingsCleared: ['219 2026-07-30: 118722 → 85543 — now a day without a reading'],
      readingsReclosed: ['219 2026-07-29: 85482 → 118722, now → 85543'],
      countersSet: [],
      failed: 1,
      failures: [{ code: '219', reason: 'the visit changed while this ran' }],
    });
    const now = withEarlierWrites(
      earlier,
      attempt({
        skipped: [
          '219: no reading above 90246 before 2026-10-11; the 2026-06-25 counter is already 84080',
          '248: no reading above 121679 before 2026-10-11',
        ],
        countersAlready: ['219 2026-06-25: 84080'],
      }),
    );
    expect(now.applied).toEqual(['219: 2 readings']);
    expect(now.readingsCleared).toEqual([
      '219 2026-07-30: 118722 → 85543 — now a day without a reading',
    ]);
    expect(now.readingsReclosed).toEqual(['219 2026-07-29: 85482 → 118722, now → 85543']);
    expect(now.skipped, 'not also «wrote nothing on»').toEqual([
      '248: no reading above 121679 before 2026-10-11',
    ]);
    expect(now.countersAlready).toEqual(['219 2026-06-25: 84080']);
  });

  it('counts nothing twice, and adds nothing where the row said nothing', () => {
    const twice = withEarlierWrites(
      earlierWrites({ countersSet: ['295 2026-10-06 odometerAtService: — → 22790'] }),
      attempt({ countersSet: ['295 2026-10-06 odometerAtService: — → 22790'] }),
    );
    expect(twice.countersSet).toHaveLength(1);
    for (const row of [null, undefined, { refused: true, reason: 'no-admin' }]) {
      expect(earlierWrites(row)).toEqual({});
    }
    const fresh = attempt({ applied: ['295: the 2026-10-06 counter'], skipped: ['248: x'] });
    expect(withEarlierWrites({}, fresh)).toEqual(fresh);
  });
});
