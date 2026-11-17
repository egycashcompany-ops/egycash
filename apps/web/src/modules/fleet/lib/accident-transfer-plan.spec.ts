import { describe, expect, it } from 'vitest';
import { fleetAccidentRemaining } from '@ecms/contracts';
import {
  MAX_GIVING_CARS,
  planTakes,
  planTransfer,
  repick,
  transferBody,
  type TakeSource,
  type TransferPlan,
} from './accident-transfer-plan';

const car = (vehicleId: string, available: number) => ({ vehicleId, code: vehicleId, available });

describe('planTakes — the first car to zero before the next', () => {
  it('empties the first car picked, then takes the rest from the second', () => {
    const plan = planTakes([car('214', 300), car('305', 1000)], 500);
    expect(plan.rows.map((r) => [r.vehicleId, r.take, r.left])).toEqual([
      ['214', 300, 0],
      ['305', 200, 800],
    ]);
    expect(plan.total).toBe(1300);
    expect(plan.short).toBe(false);
  });

  it('follows the order PICKED, not the order of the codes', () => {
    const plan = planTakes([car('305', 1000), car('214', 300)], 500);
    expect(plan.rows.map((r) => r.take)).toEqual([500, 0]);
  });

  it('says so when the cars together have less than the amount', () => {
    expect(planTakes([car('214', 300), car('305', 1000)], 1300.01).short).toBe(true);
    expect(planTakes([car('214', 300), car('305', 1000)], 1300).short).toBe(false);
  });

  it('adds up to the piastre', () => {
    const plan = planTakes([car('a', 0.1), car('b', 0.2)], 0.3);
    expect(plan.rows.map((r) => r.take)).toEqual([0.1, 0.2]);
    expect(plan.short).toBe(false);
  });
});

// ── The approved sample's data (owner-approved 2026-11-09) ─────────────────────────────────────
// Five cars: 118 = 150 · 214 = 300 · 305 = 1,000 · 410 = 2,500 · 522 = 4,200 (8,150 together).
// Accident A on car 120: remaining −2,300.00 · accident B on car 120: remaining −9,000.00.
const ID: Record<string, string> = {
  '118': '6ac100000000000000000002',
  '120': '6ac100000000000000000003',
  '214': '6ac100000000000000000006',
  '305': '6ac100000000000000000008',
  '410': '6ac100000000000000000010',
  '522': '6ac100000000000000000012',
};
const idOf = (code: string): string => {
  const id = ID[code];
  if (id === undefined) throw new Error(`no car ${code}`);
  return id;
};
const cars: TakeSource[] = [
  ['118', 150],
  ['214', 300],
  ['305', 1000],
  ['410', 2500],
  ['522', 4200],
].map(([code, available]) => ({
  vehicleId: idOf(code as string),
  code: code as string,
  available: available as number,
}));
const ALL5 = (): string[] => ['118', '214', '305', '410', '522'].map(idOf);
const ACCIDENTS = {
  A: {
    vehicleId: idOf('120'),
    vehicleCode: '120',
    companyCost: 2000,
    amountCollected: 1700,
    paidAmount: 6000,
  },
  B: {
    vehicleId: idOf('120'),
    vehicleCode: '120',
    companyCost: 3000,
    amountCollected: 2000,
    paidAmount: 14000,
  },
} as const;

/** A state of the sample: his picks by code, the typed box ('' = empty), on accident A or B. */
const STATES = {
  'N1-picks-empty': { accident: 'A', picked: ['214', '305'], typed: '' },
  'N2-typed-only': { accident: 'A', picked: [], typed: '1500' },
  'N3-picks-then-typed': { accident: 'A', picked: ['214', '305'], typed: '2000' },
  'N4-picks-cover-early': { accident: 'A', picked: ['410', '214'], typed: '' },
  'N5-auto-button': { accident: 'A', picked: [], typed: '' },
  'N6-short-all-picked': { accident: 'B', picked: ['118', '214', '305', '410', '522'], typed: '' },
  'N7-short-typed': { accident: 'B', picked: [], typed: '9000' },
  'N8-over-deficit': { accident: 'A', picked: [], typed: '2500' },
  'N9-list-open': { accident: 'A', picked: ['214', '305'], typed: '2000' },
} as const;

/** The state as the form computes it — the accident's own car passed as `ownVehicleId`. */
const run = (name: keyof typeof STATES, typedOverride?: number): TransferPlan => {
  const s = STATES[name];
  const accident = ACCIDENTS[s.accident];
  return planTransfer({
    cars,
    picked: s.picked.map(idOf),
    typed: typedOverride ?? (s.typed === '' ? null : Number(s.typed)),
    remaining: fleetAccidentRemaining(accident),
    ownVehicleId: accident.vehicleId,
  });
};
type Row = [code: string, take: number, left: number, source: string, unneeded: boolean];
const rows = (plan: TransferPlan): Row[] =>
  plan.rows.map((r) => [r.code, r.take, r.left, r.source, r.unneeded]);
/** [mode, target, amount, total, leftTotal, before, after, short, problem, offerCoverAll] */
const figures = (p: TransferPlan): unknown[] => [
  p.mode,
  p.target,
  p.amount,
  p.total,
  p.leftTotal,
  p.before,
  p.after,
  p.short,
  p.problem,
  p.offerCoverAll,
];
const SHORT_8150 = { available: 8150, missing: 850, excluded: false, limited: false };

describe('planTransfer — the sample data', () => {
  it('reads the five cars and the two accidents as told to the owner', () => {
    expect(cars.map((c) => [c.code, c.available])).toEqual([
      ['118', 150],
      ['214', 300],
      ['305', 1000],
      ['410', 2500],
      ['522', 4200],
    ]);
    expect(cars.reduce((s, c) => s + c.available, 0)).toBe(8150);
    expect(fleetAccidentRemaining(ACCIDENTS.A)).toBe(-2300);
    expect(fleetAccidentRemaining(ACCIDENTS.B)).toBe(-9000);
    // Both accidents sit on car 120 — the own car every N-state passes as `ownVehicleId`.
    expect([ACCIDENTS.A.vehicleCode, ACCIDENTS.A.vehicleId]).toEqual(['120', idOf('120')]);
    expect([ACCIDENTS.B.vehicleCode, ACCIDENTS.B.vehicleId]).toEqual(['120', idOf('120')]);
  });
});

describe('planTransfer — the approved states N1…N9', () => {
  it('N1: his 214 then 305 with the amount EMPTY → the whole −2,300; the system adds 118 and 410', () => {
    const p = run('N1-picks-empty');
    expect(rows(p)).toEqual([
      ['214', 300, 0, 'manual', false],
      ['305', 1000, 0, 'manual', false],
      ['118', 150, 0, 'auto', false],
      ['410', 850, 1650, 'auto', false],
    ]);
    expect(figures(p)).toEqual(['whole', 2300, 2300, 3950, 1650, -2300, 0, null, null, false]);
    expect(p.manualIds).toEqual(['214', '305'].map(idOf));
    expect(p.autoIds).toEqual(['118', '410'].map(idOf));
  });

  it('N2: nothing picked, typed 1,500 → smallest first, each to 0, 410 gives the rest', () => {
    const p = run('N2-typed-only');
    expect(rows(p)).toEqual([
      ['118', 150, 0, 'auto', false],
      ['214', 300, 0, 'auto', false],
      ['305', 1000, 0, 'auto', false],
      ['410', 50, 2450, 'auto', false],
    ]);
    expect(figures(p)).toEqual(['typed', 1500, 1500, 3950, 2450, -2300, -800, null, null, false]);
  });

  it('N3: his 214 then 305, typed 2,000', () => {
    const p = run('N3-picks-then-typed');
    expect(rows(p)).toEqual([
      ['214', 300, 0, 'manual', false],
      ['305', 1000, 0, 'manual', false],
      ['118', 150, 0, 'auto', false],
      ['410', 550, 1950, 'auto', false],
    ]);
    expect(figures(p)).toEqual(['typed', 2000, 2000, 3950, 1950, -2300, -300, null, null, false]);
  });

  it('N4: his 410 then 214, amount EMPTY → 410 covers it all, 214 listed «لم يُحتج إليها»', () => {
    const p = run('N4-picks-cover-early');
    expect(rows(p)).toEqual([
      ['410', 2300, 200, 'manual', false],
      ['214', 0, 300, 'manual', true],
    ]);
    expect(figures(p)).toEqual(['whole', 2300, 2300, 2800, 500, -2300, 0, null, null, false]);
    expect(p.autoIds).toEqual([]);
  });

  it('N5: nothing picked or typed → no transfer, «تغطية السالب كله تلقائياً» offered', () => {
    const p = run('N5-auto-button');
    expect(figures(p)).toEqual(['none', 0, 0, 0, 0, -2300, -2300, null, null, true]);
    expect(p.rows).toHaveLength(0);
  });

  it('N5b: pressing it types the whole negative → the system picks every car it needs', () => {
    const pressed = run('N5-auto-button', 2300);
    expect(rows(pressed)).toEqual([
      ['118', 150, 0, 'auto', false],
      ['214', 300, 0, 'auto', false],
      ['305', 1000, 0, 'auto', false],
      ['410', 850, 1650, 'auto', false],
    ]);
    expect(figures(pressed)).toEqual([
      'typed',
      2300,
      2300,
      3950,
      1650,
      -2300,
      0,
      null,
      null,
      false,
    ]);
  });

  it('N6: B (−9,000), all five picked, amount EMPTY → all give everything, still −850, allowed', () => {
    const p = run('N6-short-all-picked');
    expect(rows(p)).toEqual([
      ['118', 150, 0, 'manual', false],
      ['214', 300, 0, 'manual', false],
      ['305', 1000, 0, 'manual', false],
      ['410', 2500, 0, 'manual', false],
      ['522', 4200, 0, 'manual', false],
    ]);
    expect(figures(p)).toEqual([
      'whole',
      9000,
      8150,
      8150,
      0,
      -9000,
      -850,
      SHORT_8150,
      null,
      false,
    ]);
  });

  it('N7: B, nothing picked, typed 9,000 → all five by the system, smallest first; −850, allowed', () => {
    const p = run('N7-short-typed');
    expect(rows(p)).toEqual([
      ['118', 150, 0, 'auto', false],
      ['214', 300, 0, 'auto', false],
      ['305', 1000, 0, 'auto', false],
      ['410', 2500, 0, 'auto', false],
      ['522', 4200, 0, 'auto', false],
    ]);
    expect(figures(p)).toEqual([
      'typed',
      9000,
      8150,
      8150,
      0,
      -9000,
      -850,
      SHORT_8150,
      null,
      false,
    ]);
  });

  it('N8: typed 2,500 over a negative of 2,300 → refused, max 2,300', () => {
    const p = run('N8-over-deficit');
    expect(figures(p)).toEqual([
      'typed',
      0,
      0,
      0,
      0,
      -2300,
      -2300,
      null,
      { kind: 'overDeficit', max: 2300 },
      false,
    ]);
    expect(p.rows).toHaveLength(0);
  });

  it('N9: the same plan as N3 (the list is only opened)', () => {
    expect(rows(run('N9-list-open'))).toEqual(rows(run('N3-picks-then-typed')));
  });
});

describe('planTransfer — the edges the rules promise', () => {
  const A = { cars, remaining: -2300 };

  it('allows typing exactly the negative', () => {
    expect(planTransfer({ ...A, picked: [], typed: 2300 }).problem).toBeNull();
  });

  it('takes a small amount from the smallest car alone, and only what is missing', () => {
    expect(rows(planTransfer({ ...A, picked: [], typed: 100 }))).toEqual([
      ['118', 100, 50, 'auto', false],
    ]);
  });

  it('adds nothing when his pick covers a typed amount by itself', () => {
    expect(rows(planTransfer({ ...A, picked: [idOf('522')], typed: 1000 }))).toEqual([
      ['522', 1000, 3200, 'manual', false],
    ]);
  });

  it('never takes from the accident’s own car, even when passed in and picked', () => {
    const withOwn = [...cars, { vehicleId: idOf('120'), code: '120', available: 50 }];
    const own = planTransfer({
      cars: withOwn,
      picked: [idOf('120')],
      typed: 100,
      remaining: -2300,
      ownVehicleId: idOf('120'),
    });
    expect(rows(own)).toEqual([['118', 100, 50, 'auto', false]]);
  });

  it('never adds a car he unticked: 118 refused → 214 first', () => {
    expect(rows(planTransfer({ ...A, picked: [], typed: 400, refused: [idOf('118')] }))).toEqual([
      ['214', 300, 0, 'auto', false],
      ['305', 100, 900, 'auto', false],
    ]);
  });

  it('breaks a tie in balance by the lower code — numbers, not text («98» before «118»)', () => {
    const tie = [
      { vehicleId: 'x118', code: '118', available: 200 },
      { vehicleId: 'x98', code: '98', available: 200 },
      { vehicleId: 'x700', code: '700', available: 100 },
    ];
    expect(rows(planTransfer({ cars: tie, picked: [], typed: 350, remaining: -1000 }))).toEqual([
      ['700', 100, 0, 'auto', false],
      ['98', 200, 0, 'auto', false],
      ['118', 50, 150, 'auto', false],
    ]);
  });

  it('takes nothing from an accident that is not negative, picked or typed', () => {
    expect(
      planTransfer({ cars, remaining: 50, picked: [idOf('214')], typed: null }).problem,
    ).toEqual({ kind: 'noDeficit' });
    expect(planTransfer({ cars, remaining: 0, picked: [], typed: 100 }).problem).toEqual({
      kind: 'noDeficit',
    });
  });

  it('offers no button while the accident owes nothing', () => {
    expect(planTransfer({ cars, remaining: 0, picked: [], typed: null }).offerCoverAll).toBe(false);
  });

  it('lists his picks in HIS order even when a later one is smaller; the same id twice counts once', () => {
    expect(
      planTransfer({
        ...A,
        picked: [idOf('522'), idOf('118'), idOf('522')],
        typed: null,
      }).rows.map((r) => [r.code, r.take, r.unneeded]),
    ).toEqual([
      ['522', 2300, false],
      ['118', 0, true],
    ]);
  });

  it('is short with picks AND a typed amount below the negative: all available, the rest stays owed', () => {
    const few = cars.filter((c) => ['118', '214'].includes(c.code));
    const shortTyped = planTransfer({
      cars: few,
      picked: [idOf('214')],
      typed: 1000,
      remaining: -2300,
    });
    expect(rows(shortTyped)).toEqual([
      ['214', 300, 0, 'manual', false],
      ['118', 150, 0, 'auto', false],
    ]);
    expect([shortTyped.amount, shortTyped.after, shortTyped.short]).toEqual([
      450,
      -1850,
      { available: 450, missing: 550, excluded: false, limited: false },
    ]);
  });

  it('counts in piastres: no binary-float drift', () => {
    const cents = [
      { vehicleId: 'a', code: '1', available: 0.1 },
      { vehicleId: 'b', code: '2', available: 0.2 },
    ];
    const c = planTransfer({ cars: cents, picked: [], typed: 0.3, remaining: -0.3 });
    expect([c.amount, c.after, c.short]).toEqual([0.3, 0, null]);
  });
});

describe('planTransfer — the review fixes', () => {
  const A = { cars, remaining: -2300 };

  it('says «في السيارات المحددة» when HE unticked 410 and 522 (6,700.00 still in them)', () => {
    const mineShort = planTransfer({
      ...A,
      picked: [],
      typed: 2300,
      refused: [idOf('410'), idOf('522')],
    });
    expect(rows(mineShort)).toEqual([
      ['118', 150, 0, 'auto', false],
      ['214', 300, 0, 'auto', false],
      ['305', 1000, 0, 'auto', false],
    ]);
    expect([mineShort.amount, mineShort.after, mineShort.short, mineShort.problem]).toEqual([
      1450,
      -850,
      { available: 1450, missing: 850, excluded: true, limited: false },
      null,
    ]);
  });

  it('a refused car he then picks again is his pick, so nothing is excluded', () => {
    const back = planTransfer({
      cars,
      picked: ALL5(),
      typed: null,
      remaining: -9000,
      refused: [idOf('410')],
    });
    expect(back.short).toEqual(SHORT_8150);
  });

  it('a refused car with nothing in it excludes nothing', () => {
    const empty = [...cars, { vehicleId: 'z0', code: '900', available: 0 }];
    expect(
      planTransfer({ cars: empty, picked: [], typed: 9000, remaining: -9000, refused: ['z0'] })
        .short,
    ).toEqual(SHORT_8150);
  });

  it('refuses when every car with money is unticked — never an empty transfer', () => {
    const none = planTransfer({
      ...A,
      picked: [],
      typed: 1000,
      refused: cars.map((c) => c.vehicleId),
    });
    expect([none.problem, none.rows.length, none.amount]).toEqual([
      { kind: 'nothingToTake' },
      0,
      0,
    ]);
    expect(
      planTransfer({
        cars: [{ vehicleId: 'z', code: '9', available: 0 }],
        picked: ['z'],
        typed: null,
        remaining: -100,
      }).problem,
    ).toEqual({ kind: 'nothingToTake' });
  });

  it('refuses a typed 0 rather than reading it as «empty» — even with a car picked', () => {
    expect(planTransfer({ ...A, picked: [idOf('214')], typed: 0 }).problem).toEqual({
      kind: 'zero',
    });
    expect(planTransfer({ ...A, picked: [], typed: 0 }).problem).toEqual({ kind: 'zero' });
    expect(planTransfer({ ...A, picked: [], typed: 0 }).offerCoverAll).toBe(false);
  });

  it('refuses a box that holds no number (a lone «.» reads as NaN) as it refuses a 0', () => {
    // `MoneyInput` keeps a lone «.»; the form reads it with Number('.'), which is NaN.
    const typed = Number('.');
    for (const picked of [[idOf('214')], []]) {
      const p = planTransfer({ ...A, picked, typed });
      expect([p.mode, p.problem, p.rows, p.amount, p.after, p.short]).toEqual([
        'typed',
        { kind: 'zero' },
        [],
        0,
        -2300,
        null,
      ]);
      expect(transferBody(p), 'never sent as an empty transfer').toBeUndefined();
    }
  });

  it('keeps leftTotal in piastres: no −0.00, no drift', () => {
    const cents = [
      { vehicleId: 'a', code: '1', available: 0.1 },
      { vehicleId: 'b', code: '2', available: 0.2 },
    ];
    const c = planTransfer({ cars: cents, picked: ['a', 'b'], typed: null, remaining: -0.3 });
    expect([c.total, c.amount, c.leftTotal, Object.is(c.leftTotal, -0)]).toEqual([
      0.3,
      0.3,
      0,
      false,
    ]);
    const c2 = planTransfer({ cars: cents, picked: ['b'], typed: 0.15, remaining: -0.3 });
    expect([c2.rows.map((r) => r.left), c2.leftTotal]).toEqual([[0.05], 0.05]);
  });
});

describe('planTransfer — stops at twenty giving cars (the contract’s fromVehicleIds.max(20))', () => {
  /** 30 cars of 100.00 each, codes 1…30 — 3,000.00 together. */
  const many = Array.from({ length: 30 }, (_, i) => ({
    vehicleId: `c${i + 1}`,
    code: String(i + 1),
    available: 100,
  }));

  it('is the contract’s limit', () => {
    expect(MAX_GIVING_CARS).toBe(20);
  });

  it('the system stops at twenty: 2,000.00 taken, −500.00 left, the amber note says it is the limit', () => {
    const p = planTransfer({ cars: many, picked: [], typed: null, remaining: -2500 });
    expect(p.mode).toBe('none');
    const typed = planTransfer({ cars: many, picked: [], typed: 2500, remaining: -2500 });
    expect(typed.rows).toHaveLength(20);
    expect(typed.rows.map((r) => r.code)).toEqual(
      Array.from({ length: 20 }, (_, i) => String(i + 1)),
    );
    expect([typed.amount, typed.after, typed.problem]).toEqual([2000, -500, null]);
    expect(typed.short).toEqual({ available: 2000, missing: 500, excluded: false, limited: true });
  });

  it('his picks count toward the twenty: 15 of his, then only 5 of the system’s', () => {
    const picked = many.slice(10, 25).map((c) => c.vehicleId);
    const p = planTransfer({ cars: many, picked, typed: 2500, remaining: -2500 });
    expect(p.manualIds).toHaveLength(15);
    expect(p.autoIds).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
    expect(p.rows.filter((r) => r.take > 0)).toHaveLength(20);
    expect(p.short?.limited).toBe(true);
  });

  it('a pick of his past the twentieth giving car gives nothing and is marked over the limit', () => {
    const picked = many.slice(0, 22).map((c) => c.vehicleId);
    const p = planTransfer({ cars: many, picked, typed: null, remaining: -2500 });
    expect(p.rows).toHaveLength(22);
    expect(p.rows.slice(20).map((r) => [r.take, r.left, r.overLimit, r.unneeded])).toEqual([
      [0, 100, true, false],
      [0, 100, true, false],
    ]);
    expect(p.autoIds).toEqual([]);
    expect([p.amount, p.after]).toEqual([2000, -500]);
    expect(p.short).toEqual({ available: 2000, missing: 500, excluded: false, limited: true });
  });

  it('is not «limited» when twenty cars are all there is', () => {
    const twenty = many.slice(0, 20);
    const p = planTransfer({ cars: twenty, picked: [], typed: 2500, remaining: -2500 });
    expect(p.short).toEqual({ available: 2000, missing: 500, excluded: false, limited: false });
  });

  it('never sends more than twenty cars', () => {
    const picked = many.map((c) => c.vehicleId);
    const body = transferBody(planTransfer({ cars: many, picked, typed: null, remaining: -9000 }));
    expect(body?.fromVehicleIds).toHaveLength(20);
    expect(body?.amount).toBe(2000);
  });
});

describe('transferBody — what the save sends', () => {
  it('sends only the rows that give, in row order, with amount = Σ takes', () => {
    expect(transferBody(run('N4-picks-cover-early'))).toEqual({
      fromVehicleIds: [idOf('410')],
      amount: 2300,
    });
    expect(transferBody(run('N1-picks-empty'))).toEqual({
      fromVehicleIds: ['214', '305', '118', '410'].map(idOf),
      amount: 2300,
    });
  });

  it('sends what is taken when the cars are short — saving stays allowed', () => {
    expect(transferBody(run('N6-short-all-picked'))?.amount).toBe(8150);
  });

  it('sends nothing with no transfer or a refused one', () => {
    expect(transferBody(run('N5-auto-button'))).toBeUndefined();
    expect(transferBody(run('N8-over-deficit'))).toBeUndefined();
  });

  it('never sends what the contract refuses: no giving car, or an amount that is not above 0', () => {
    const base = run('N4-picks-cover-early');
    // A NaN amount slips past `amount <= 0`; the body refuses it all the same.
    expect(transferBody({ ...base, amount: Number.NaN })).toBeUndefined();
    // Rows that give nothing (a NaN take included) are no transfer.
    const none = base.rows.map((row) => ({ ...row, take: Number.NaN }));
    expect(transferBody({ ...base, rows: none })).toBeUndefined();
    expect(transferBody({ ...base, rows: [] })).toBeUndefined();
  });

  it('adds up to the piastre', () => {
    const cents = [
      { vehicleId: 'a', code: '1', available: 0.1 },
      { vehicleId: 'b', code: '2', available: 0.2 },
    ];
    expect(
      transferBody(planTransfer({ cars: cents, picked: [], typed: null, remaining: -0.3 })),
    ).toBeUndefined();
    expect(
      transferBody(planTransfer({ cars: cents, picked: ['a', 'b'], typed: null, remaining: -0.3 })),
    ).toEqual({ fromVehicleIds: ['a', 'b'], amount: 0.3 });
  });
});

describe('repick — what ticking and unticking in the open list means', () => {
  it('a car he unticks — his own or the system’s — is his «no», and stays out', () => {
    // N1: his 214, 305; the system's 118, 410. He unticks 305 (his) and 118 (the system's).
    const after = repick({
      ticked: ['214', '305', '118', '410'],
      mine: ['214', '305'],
      refused: [],
      next: ['214', '410'],
    });
    expect(after).toEqual({ picked: ['214'], refused: ['305', '118'] });
    // …and the plan never adds them back for him.
    const plan = planTransfer({
      cars,
      picked: after.picked.map(idOf),
      typed: null,
      remaining: -2300,
      refused: after.refused.map(idOf),
    });
    expect(plan.rows.map((r) => r.code)).not.toContain('305');
    expect(plan.rows.map((r) => r.code)).not.toContain('118');
  });

  it('a car he ticks is his own pick, after the ones he has — even one the system had added', () => {
    expect(
      repick({ ticked: ['214', '118'], mine: ['214'], refused: [], next: ['214', '118', '522'] }),
    ).toEqual({ picked: ['214', '522'], refused: [] });
  });

  it('ticking an unticked car again takes it off the «no» list', () => {
    expect(
      repick({ ticked: ['214'], mine: ['214'], refused: ['305', '118'], next: ['214', '305'] }),
    ).toEqual({ picked: ['214', '305'], refused: ['118'] });
  });
});
