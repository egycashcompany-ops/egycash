// The settlements rules, pinned (docs/12-planning/atm-settlements-phase1.md §10.1). The api fills,
// bags, totals and prints with these functions and the web shows them, so a drift here would put a
// different number on the screen than on the Note.
//
// Every value below is invented: cassette mixes are the four Al Baraka shapes (denominations only),
// counts and seals are made up (`SEAL-T-0001`), and no figure from a workbook is used.
import { describe, expect, it } from 'vitest';
import {
  AddAtmPlanLinesSchema,
  AtmSettlementPrintSchema,
  LayoutImportFieldsSchema,
  SaveAtmCassetteLayoutSchema,
  SaveAtmStandardLoadSchema,
  UpdateAtmPlanLineSchema,
  bagAllocation,
  bagNeedsQr,
  byDenomination,
  cleanLabel,
  cleanScannedValue,
  fillFromStandard,
  isPlanned,
  layoutIssues,
  lineEgpTotalMinor,
  normalizeScheduleTime,
  planLineIssues,
  receiptMachineCount,
  receiptRows,
  repTapeComment,
  repTapeSlots,
  scannedValueWarnings,
  sealKey,
  splitByDenomination,
  splitEvenly,
  type AtmCassetteSlot,
  type AtmPlanLineIssueContext,
  type AtmPlanLineIssueInput,
  type AtmPlanSlot,
  type AtmSlotKind,
} from './atm-settlements.js';

// ── Builders ────────────────────────────────────────────────────────────────────────────────────

/** An EGP withdrawal cassette, or an empty slot for 0 (the Full list's own rule). */
const egp = (slot: number, denomination: number): AtmCassetteSlot =>
  denomination === 0
    ? { slot, kind: 'empty', denomination: null, currency: null }
    : { slot, kind: 'withdrawal', denomination, currency: 'EGP' };

/** Slots 1..n from a Full list mix such as 200/200/100/50 (0 = no cassette). */
const mix = (...denominations: number[]): AtmCassetteSlot[] =>
  denominations.map((d, i) => egp(i + 1, d));

const slotOf = (
  slot: number,
  kind: AtmSlotKind,
  denomination: number | null,
  currency: string | null,
): AtmCassetteSlot => ({ slot, kind, denomination, currency });

const withNotes = (slots: AtmCassetteSlot[], notes: number[]): AtmPlanSlot[] =>
  slots.map((s, i) => ({ ...s, notes: notes[i] ?? 0, bag: null }));

const asObject = (map: Map<number, number>): Record<number, number> => Object.fromEntries(map);

// ── §3.3 The even split ─────────────────────────────────────────────────────────────────────────

describe('splitEvenly (S-4, DS-12)', () => {
  it('gives the five examples of §3.3', () => {
    expect(splitEvenly(4000, 2)).toEqual([2000, 2000]);
    expect(splitEvenly(4100, 2)).toEqual([2100, 2000]);
    expect(splitEvenly(250, 2)).toEqual([100, 150]);
    expect(splitEvenly(0, 3)).toEqual([0, 0, 0]);
    expect(splitEvenly(700, 3)).toEqual([300, 200, 200]);
  });

  it('one cassette takes everything, a remainder under 100 included', () => {
    expect(splitEvenly(2350, 1)).toEqual([2350]);
  });

  it('a large total stays integer and sums back exactly', () => {
    const shares = splitEvenly(800_050, 8);
    expect(shares.every(Number.isInteger)).toBe(true);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(800_050);
    expect(shares).toEqual([
      100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 100_050,
    ]);
  });

  it('refuses no cassette and a negative or fractional total', () => {
    expect(() => splitEvenly(100, 0)).toThrow(RangeError);
    expect(() => splitEvenly(-100, 1)).toThrow(RangeError);
    expect(() => splitEvenly(10.5, 1)).toThrow(RangeError);
  });
});

describe('splitByDenomination (§3.3)', () => {
  it('two 200 cassettes share a typed 200 total', () => {
    const fill = splitByDenomination(mix(200, 200, 100, 50), [{ denomination: 200, notes: 4100 }]);
    expect(asObject(fill.notes)).toEqual({ 1: 2100, 2: 2000 });
    expect(fill.unplaced).toEqual([]);
  });

  it('a denomination with no slot is unplaced', () => {
    const fill = splitByDenomination(mix(200, 100, 50, 0), [{ denomination: 20, notes: 500 }]);
    expect(fill.notes.size).toBe(0);
    expect(fill.unplaced).toEqual([20]);
  });

  it('never touches a foreign slot of the same face value', () => {
    const slots = [egp(1, 100), slotOf(2, 'withdrawal', 100, 'USD'), egp(3, 50), egp(4, 0)];
    const fill = splitByDenomination(slots, [{ denomination: 100, notes: 3000 }]);
    expect(asObject(fill.notes)).toEqual({ 1: 3000 });
  });
});

// ── §3.1 Slots ──────────────────────────────────────────────────────────────────────────────────

describe('isPlanned (DS-4)', () => {
  it('is withdrawal or recycle in EGP only', () => {
    expect(isPlanned(slotOf(1, 'withdrawal', 200, 'EGP'))).toBe(true);
    expect(isPlanned(slotOf(1, 'recycle', 100, 'EGP'))).toBe(true);
    expect(isPlanned(slotOf(1, 'deposit', null, 'EGP'))).toBe(false);
    expect(isPlanned(slotOf(1, 'empty', null, null))).toBe(false);
    expect(isPlanned(slotOf(1, 'withdrawal', 100, 'USD'))).toBe(false);
  });
});

describe('cleanLabel (DS-5)', () => {
  it('strips a control and a format character, applies NFC and collapses spaces', () => {
    expect(cleanLabel('BRK\u0007 (S2)‏')).toBe('BRK (S2)');
    expect(cleanLabel('Café')).toBe('Café');
    expect(cleanLabel('  BRK   (DN)  recycle ')).toBe('BRK (DN) recycle');
  });
});

describe('layoutIssues (§3.1)', () => {
  it('accepts 4 and 8 slots, refuses 3 and 9', () => {
    expect(layoutIssues(mix(200, 200, 100, 50))).toEqual([]);
    expect(layoutIssues(mix(200, 200, 100, 100, 50, 50, 20, 0))).toEqual([]);
    expect(layoutIssues(mix(200, 100, 50))).toEqual([{ slot: null, code: 'SLOT_COUNT' }]);
    expect(layoutIssues(mix(200, 200, 100, 100, 50, 50, 20, 20, 10))).toEqual([
      { slot: null, code: 'SLOT_COUNT' },
    ]);
  });

  it('accepts a one-slot spare set, and refuses a spare slot that is not planned', () => {
    expect(layoutIssues(mix(200), { spare: true })).toEqual([]);
    expect(layoutIssues([egp(1, 200), egp(2, 0)], { spare: true })).toEqual([
      { slot: 2, code: 'SLOT_COUNT' },
    ]);
  });

  it('accepts a deposit-only machine (it simply cannot be planned)', () => {
    const deposit = [1, 2, 3, 4].map((n) => slotOf(n, 'deposit', null, n === 1 ? 'EGP' : null));
    expect(layoutIssues(deposit)).toEqual([]);
  });

  it('names every other code once', () => {
    const codes = (slots: AtmCassetteSlot[]) => layoutIssues(slots).map((i) => i.code);
    const base = mix(200, 100, 50, 0);
    expect(codes([egp(1, 200), egp(3, 100), egp(4, 50), egp(5, 0)])).toEqual(['SLOT_NUMBERS']);
    expect(codes([...base.slice(0, 3), slotOf(4, 'empty', 20, null)])).toEqual(['EMPTY_HAS_VALUE']);
    expect(codes([...base.slice(0, 3), slotOf(4, 'deposit', 200, 'EGP')])).toEqual([
      'DEPOSIT_HAS_DENOMINATION',
    ]);
    expect(codes([...base.slice(0, 3), slotOf(4, 'withdrawal', null, 'EGP')])).toEqual([
      'DENOMINATION_REQUIRED',
    ]);
    expect(codes([...base.slice(0, 3), slotOf(4, 'recycle', 20, null)])).toEqual([
      'CURRENCY_REQUIRED',
    ]);
    expect(codes([...base.slice(0, 3), slotOf(4, 'withdrawal', 25, 'EGP')])).toEqual([
      'EGP_DENOMINATION',
    ]);
    expect(codes([...base.slice(0, 3), slotOf(4, 'withdrawal', 2000, 'USD')])).toEqual([
      'FOREIGN_DENOMINATION',
    ]);
    expect(codes([...base.slice(0, 3), slotOf(4, 'withdrawal', 100, 'usd')])).toEqual([
      'CURRENCY_FORMAT',
    ]);
  });
});

// ── §3.2 Bags ───────────────────────────────────────────────────────────────────────────────────

describe('bagAllocation (S-6, DS-13)', () => {
  it('4 planned → one bag; 3 with slot 1 empty → one bag of slots 2..4', () => {
    expect(bagAllocation(mix(200, 200, 100, 50))).toEqual([{ bag: 1, slots: [1, 2, 3, 4] }]);
    expect(bagAllocation(mix(0, 50, 100, 200))).toEqual([{ bag: 1, slots: [2, 3, 4] }]);
  });

  it('5, 6 and 8 planned → a second bag after four cassettes', () => {
    expect(bagAllocation(mix(200, 200, 100, 50, 20))).toEqual([
      { bag: 1, slots: [1, 2, 3, 4] },
      { bag: 2, slots: [5] },
    ]);
    expect(bagAllocation(mix(200, 200, 100, 100, 50, 50))).toEqual([
      { bag: 1, slots: [1, 2, 3, 4] },
      { bag: 2, slots: [5, 6] },
    ]);
    expect(bagAllocation(mix(200, 200, 100, 100, 50, 50, 20, 20))).toEqual([
      { bag: 1, slots: [1, 2, 3, 4] },
      { bag: 2, slots: [5, 6, 7, 8] },
    ]);
  });

  it('skips deposit and empty slots, includes recycle, and never bags a foreign slot', () => {
    expect(
      bagAllocation([
        slotOf(1, 'deposit', null, 'EGP'),
        slotOf(2, 'recycle', 200, 'EGP'),
        egp(3, 0),
        egp(4, 100),
      ]),
    ).toEqual([{ bag: 1, slots: [2, 4] }]);
    expect(
      bagAllocation([
        ...mix(200, 200, 100, 50),
        slotOf(5, 'withdrawal', 100, 'USD'),
        slotOf(6, 'withdrawal', 20, 'USD'),
      ]),
    ).toEqual([{ bag: 1, slots: [1, 2, 3, 4] }]);
  });

  it('a line with no planned slot has no bag', () => {
    expect(bagAllocation(mix(0, 0, 0, 0))).toEqual([]);
  });
});

describe('bagNeedsQr (DS-13)', () => {
  it('is false for a bag whose only cassette is a 0-note 20, true once any cassette has notes', () => {
    const slots = withNotes(mix(200, 200, 100, 50, 20), [2000, 2000, 1000, 1000, 0]);
    const [first, second] = bagAllocation(slots);
    expect(second).toEqual({ bag: 2, slots: [5] });
    expect(bagNeedsQr(second!, slots)).toBe(false);
    expect(bagNeedsQr(first!, slots)).toBe(true);
  });
});

// ── §3.4 Standard loads ─────────────────────────────────────────────────────────────────────────

describe('fillFromStandard (S-3, DS-8)', () => {
  const profile = {
    notes: [
      { denomination: 200, notes: 4200 },
      { denomination: 100, notes: 1300 },
      { denomination: 50, notes: 900 },
    ],
  };

  it('200/200/100/50 → the two 200s split equally', () => {
    const fill = fillFromStandard(mix(200, 200, 100, 50), profile);
    expect(asObject(fill.notes)).toEqual({ 1: 2100, 2: 2100, 3: 1300, 4: 900 });
    expect(fill.unplaced).toEqual([]);
  });

  it('200/100/50/20 → the 20 gets 0', () => {
    const fill = fillFromStandard(mix(200, 100, 50, 20), profile);
    expect(asObject(fill.notes)).toEqual({ 1: 4200, 2: 1300, 3: 900, 4: 0 });
  });

  it('0/50/100/200 (reversed) → each slot by its denomination, the empty slot untouched', () => {
    const fill = fillFromStandard(mix(0, 50, 100, 200), profile);
    expect(asObject(fill.notes)).toEqual({ 2: 900, 3: 1300, 4: 4200 });
  });

  it('a profile denomination with no slot is unplaced', () => {
    const fill = fillFromStandard(mix(200, 100, 0, 0), profile);
    expect(fill.unplaced).toEqual([50]);
    expect(asObject(fill.notes)).toEqual({ 1: 4200, 2: 1300 });
  });

  it('a foreign slot gets no notes at all, and no profile fills 0', () => {
    const slots = [...mix(200, 100, 50, 0), slotOf(5, 'withdrawal', 100, 'USD')];
    expect(fillFromStandard(slots, profile).notes.has(5)).toBe(false);
    expect(asObject(fillFromStandard(slots, null).notes)).toEqual({ 1: 0, 2: 0, 3: 0 });
  });
});

// ── §3.6 Totals ─────────────────────────────────────────────────────────────────────────────────

describe('lineEgpTotalMinor (DS-28)', () => {
  it('a 4,000-note 200 cassette is 80,000,000 minor units (800,000 EGP)', () => {
    expect(lineEgpTotalMinor(withNotes(mix(200, 0, 0, 0), [4000]))).toBe(80_000_000);
  });

  it('ignores an empty slot and a USD slot', () => {
    const slots: AtmPlanSlot[] = [
      { ...egp(1, 200), notes: 1000, bag: 1 },
      { ...egp(2, 0), notes: 0, bag: null },
      { ...slotOf(3, 'withdrawal', 100, 'USD'), notes: 500, bag: null },
    ];
    expect(lineEgpTotalMinor(slots)).toBe(20_000_000);
  });
});

describe('byDenomination', () => {
  it('sums two 200 cassettes, orders 200/100/50 and omits absent denominations', () => {
    const slots = withNotes(mix(50, 200, 100, 200), [1000, 2000, 1000, 2000]);
    expect(byDenomination(slots)).toEqual([
      { denomination: 200, notes: 4000 },
      { denomination: 100, notes: 1000 },
      { denomination: 50, notes: 1000 },
    ]);
  });
});

describe('receiptRows («بيان التغذية»)', () => {
  it('always six rows in 200…5 order, the 20/10/5 rows summed, a USD 100 slot ignored', () => {
    const lines = [
      { slots: withNotes(mix(200, 100, 50, 20), [2000, 1000, 1000, 300]) },
      { slots: withNotes(mix(200, 20, 10, 5), [1000, 200, 400, 500]) },
      {
        slots: [
          ...withNotes(mix(200, 0, 0, 0), [500]),
          { ...slotOf(5, 'withdrawal', 100, 'USD'), notes: 900, bag: null },
        ],
      },
    ];
    expect(receiptRows(lines)).toEqual([
      { denomination: 200, notes: 3500 },
      { denomination: 100, notes: 1000 },
      { denomination: 50, notes: 1000 },
      { denomination: 20, notes: 500 },
      { denomination: 10, notes: 400 },
      { denomination: 5, notes: 500 },
    ]);
    expect(receiptRows([]).map((r) => r.denomination)).toEqual([200, 100, 50, 20, 10, 5]);
  });
});

describe('receiptMachineCount', () => {
  it('counts a machine on runs 1 and 2 once, plus one per spare line', () => {
    const x = { kind: 'machine' as const, machineId: 'm-x' };
    expect(receiptMachineCount([x, x])).toBe(1);
    const spare = { kind: 'spare' as const, machineId: null };
    expect(receiptMachineCount([x, x, spare, spare])).toBe(3);
  });
});

describe('repTapeComment', () => {
  it('writes REP. TAPE column M', () => {
    expect(repTapeComment('21:00')).toBe('Repl @9:00 PM');
    expect(repTapeComment('02:00')).toBe('Repl @2:00 AM');
    expect(repTapeComment('00:30')).toBe('Repl @12:30 AM');
    expect(repTapeComment('12:00')).toBe('Repl @12:00 PM');
    expect(repTapeComment(null)).toBe('');
  });
});

describe('repTapeSlots (§8.5)', () => {
  it('blanks a trailing run of slots that are not planned, and writes 0/0 before a planned one', () => {
    expect(repTapeSlots(withNotes(mix(200, 100, 50, 0), [2000, 1000, 1000]))).toEqual([
      { notes: 2000, denomination: 200 },
      { notes: 1000, denomination: 100 },
      { notes: 1000, denomination: 50 },
      null,
    ]);
    expect(repTapeSlots(withNotes(mix(0, 50, 100, 200), [0, 1000, 1000, 4000]))).toEqual([
      { notes: 0, denomination: 0 },
      { notes: 1000, denomination: 50 },
      { notes: 1000, denomination: 100 },
      { notes: 4000, denomination: 200 },
    ]);
  });
});

// ── §3.6 Times ──────────────────────────────────────────────────────────────────────────────────

describe('normalizeScheduleTime (UI-22)', () => {
  it('reads 24-hour, 12-hour, Arabic markers and Arabic-Indic digits', () => {
    for (const raw of ['21:00', '9:00 PM', '9:00 pm', '9:00PM', '9:00 م', '٩:٠٠ م', '۹:۰۰ م']) {
      expect(normalizeScheduleTime(raw)).toBe('21:00');
    }
    expect(normalizeScheduleTime('9:00')).toBe('09:00');
    expect(normalizeScheduleTime('9:00 ص')).toBe('09:00');
    expect(normalizeScheduleTime('12:30 AM')).toBe('00:30');
    expect(normalizeScheduleTime('12:00 PM')).toBe('12:00');
  });

  it("'' and null are no time; anything else is 'bad'", () => {
    expect(normalizeScheduleTime('')).toBeNull();
    expect(normalizeScheduleTime('  ')).toBeNull();
    expect(normalizeScheduleTime(null)).toBeNull();
    for (const raw of ['25:00', '9', 'abc', '13:00 PM', '0:30 AM', '9:60']) {
      expect(normalizeScheduleTime(raw)).toBe('bad');
    }
  });
});

// ── §3.5 Scanned values ─────────────────────────────────────────────────────────────────────────

describe('cleanScannedValue (§3.5)', () => {
  it('maps Arabic-Indic and Eastern Arabic-Indic digits to ASCII', () => {
    expect(cleanScannedValue('SEAL-T-٠٠٠١')).toBe('SEAL-T-0001');
    expect(cleanScannedValue('SEAL-T-۰۰۰۲')).toBe('SEAL-T-0002');
  });

  it('removes a trailing CR, LF or Tab and the LRM, RLM, BOM and zero-width marks', () => {
    expect(cleanScannedValue('SEAL-T-0001\r')).toBe('SEAL-T-0001');
    expect(cleanScannedValue('SEAL-T-0001\n')).toBe('SEAL-T-0001');
    expect(cleanScannedValue('SEAL-T-0001\t')).toBe('SEAL-T-0001');
    expect(cleanScannedValue('‏SEAL‎-T-﻿00​01‌‍')).toBe('SEAL-T-0001');
  });

  it('keeps case and inner spaces; a URL survives unchanged', () => {
    expect(cleanScannedValue('  Seal t 0001 ')).toBe('Seal t 0001');
    const url = 'https://example.test/q?id=AbC-001&x=1';
    expect(cleanScannedValue(url)).toBe(url);
  });

  it("'' and white space only are null", () => {
    expect(cleanScannedValue('')).toBeNull();
    expect(cleanScannedValue(' \r\n')).toBeNull();
    expect(cleanScannedValue(null)).toBeNull();
  });
});

describe('sealKey (DS-15)', () => {
  it('upper-cases Latin letters, removes inner spaces and folds full-width forms', () => {
    expect(sealKey('seal-t-0001')).toBe('SEAL-T-0001');
    expect(sealKey('SEAL T 0001')).toBe('SEALT0001');
    expect(sealKey('ＳＥＡＬ－Ｔ－０００１')).toBe('SEAL-T-0001');
  });

  it('two values differing only in case, digit script or a trailing CR share a key', () => {
    const key = (raw: string) => sealKey(cleanScannedValue(raw) ?? '');
    expect(key('seal-t-0001')).toBe(key('SEAL-T-0001'));
    expect(key('SEAL-T-٠٠٠١')).toBe(key('SEAL-T-0001'));
    expect(key('SEAL-T-0001\r')).toBe(key('SEAL-T-0001'));
  });
});

describe('scannedValueWarnings', () => {
  it('flags a value typed under the Arabic layout, and nothing on a Latin value', () => {
    // «SEAL» typed on the Arabic layout of a standard keyboard.
    expect(scannedValueWarnings('سثشم-T-0001')).toEqual(['ARABIC_LETTERS']);
    expect(scannedValueWarnings('SEAL-T-0001')).toEqual([]);
  });
});

// ── §3.7 Line issues ────────────────────────────────────────────────────────────────────────────

describe('planLineIssues (§3.7)', () => {
  const today = '2026-11-02';
  const clean = (): AtmPlanLineIssueInput => ({
    kind: 'machine',
    machineId: 'm-1',
    run: 1,
    scheduleTime: '21:00',
    status: 'draft',
    slots: withNotes(mix(200, 200, 100, 50), [2100, 2100, 1300, 900]),
    typeLabel: 'BRK (T1)',
    featuresLabel: null,
    hubLabel: null,
    layoutRevision: 3,
    standardNotes: [
      { denomination: 200, notes: 4200 },
      { denomination: 100, notes: 1300 },
      { denomination: 50, notes: 900 },
    ],
    standardLoadId: 'load-1',
    standardLoadChosen: false,
  });
  /** The machine's layout at `revision`, the content `clean()` copied unless `over` changes it. */
  const layoutAt = (
    revision: number,
    over: Partial<NonNullable<AtmPlanLineIssueContext['layout']>> = {},
  ): NonNullable<AtmPlanLineIssueContext['layout']> => {
    const { slots, typeLabel, featuresLabel, hubLabel } = clean();
    return { revision, slots, typeLabel, featuresLabel, hubLabel, ...over };
  };
  const ctx = (over: Partial<AtmPlanLineIssueContext> = {}): AtmPlanLineIssueContext => ({
    otherLines: [],
    layout: layoutAt(3),
    refreshStandardLoadId: 'load-1',
    machinePlannable: true,
    replenishDate: today,
    today,
    ...over,
  });
  const codes = (line: AtmPlanLineIssueInput, c: AtmPlanLineIssueContext = ctx()) =>
    planLineIssues(line, c).map((i) => i.code);

  it('a clean line has no issue', () => {
    expect(planLineIssues(clean(), ctx())).toEqual([]);
  });

  it('errors: machine not plannable, no layout, no planned slot, empty line', () => {
    expect(planLineIssues(clean(), ctx({ machinePlannable: false }))).toEqual([
      { code: 'MACHINE_NOT_PLANNABLE', severity: 'error' },
    ]);
    expect(codes(clean(), ctx({ layout: null }))).toEqual(['NO_LAYOUT']);
    const depositOnly = {
      ...clean(),
      slots: withNotes(
        [1, 2, 3, 4].map((n) => slotOf(n, 'deposit', null, null)),
        [],
      ),
      standardNotes: null,
    };
    expect(codes(depositOnly)).toEqual(['NO_FILLABLE_SLOT']);
    const empty = { ...clean(), slots: withNotes(mix(200, 200, 100, 50), [0, 0, 0, 0]) };
    expect(codes(empty)).toEqual(['EMPTY_LINE', 'DIFFERS_FROM_STANDARD']);
  });

  it('errors: a duplicate in the run, a spare without a type, an invalid layout', () => {
    const other = { kind: 'machine' as const, machineId: 'm-1', run: 1, scheduleTime: '09:00' };
    expect(codes(clean(), ctx({ otherLines: [{ ...other, status: 'issued' }] }))).toEqual([
      'DUPLICATE_IN_RUN',
    ]);
    // A cancelled twin is no duplicate.
    expect(codes(clean(), ctx({ otherLines: [{ ...other, status: 'cancelled' }] }))).toEqual([]);
    const spare: AtmPlanLineIssueInput = {
      ...clean(),
      kind: 'spare',
      machineId: null,
      typeLabel: null,
      layoutRevision: null,
      slots: withNotes(mix(200, 100), [2000, 1000]),
      standardNotes: null,
    };
    expect(codes(spare, ctx({ layout: null, machinePlannable: false }))).toEqual([
      'SPARE_TYPE_REQUIRED',
    ]);
    const broken = { ...clean(), slots: withNotes(mix(200, 200, 100), [2100, 2100, 1300]) };
    expect(codes(broken)).toEqual(['LAYOUT_INVALID', 'STANDARD_DENOMINATION_UNPLACED']);
  });

  it('warnings: not a multiple of 100 (per slot), no time, a past date', () => {
    const odd = { ...clean(), slots: withNotes(mix(200, 200, 100, 50), [2150, 2050, 1300, 900]) };
    expect(planLineIssues(odd, ctx())).toEqual([
      { code: 'NOT_MULTIPLE_OF_100', severity: 'warning', slot: 1 },
      { code: 'NOT_MULTIPLE_OF_100', severity: 'warning', slot: 2 },
    ]);
    expect(codes({ ...clean(), scheduleTime: null })).toEqual(['NO_TIME']);
    expect(codes(clean(), ctx({ replenishDate: '2026-11-01' }))).toEqual(['PAST_DATE']);
  });

  it('LAYOUT_CHANGED on a draft when the revision moved with a label or a slot', () => {
    expect(codes(clean(), ctx({ layout: layoutAt(4, { hubLabel: 'منطقة تجريبية 2' }) }))).toEqual([
      'LAYOUT_CHANGED',
    ]);
    const slots = mix(200, 100, 100, 50);
    expect(codes(clean(), ctx({ layout: layoutAt(4, { slots }) }))).toEqual(['LAYOUT_CHANGED']);
  });

  it('LAYOUT_CHANGED_AFTER_ISSUE on an issued line dated today, never on one dated yesterday', () => {
    const issued = { ...clean(), status: 'issued' as const };
    const changed = layoutAt(4, { typeLabel: 'BRK (T2)' });
    expect(codes(issued, ctx({ layout: changed }))).toEqual(['LAYOUT_CHANGED_AFTER_ISSUE']);
    expect(codes(issued, ctx({ layout: changed, replenishDate: '2026-11-01' }))).toEqual([
      'PAST_DATE',
    ]);
  });

  it('a revision that moved with the same slots and labels (a standard load re-pointed) raises neither', () => {
    expect(codes(clean(), ctx({ layout: layoutAt(4) }))).toEqual([]);
    expect(codes({ ...clean(), status: 'issued' }, ctx({ layout: layoutAt(4) }))).toEqual([]);
    expect(codes({ ...clean(), status: 'prepared' }, ctx({ layout: layoutAt(9) }))).toEqual([]);
  });

  it('STANDARD_LOAD_CHANGED on a draft whose refresh would take another profile (FIT-3)', () => {
    // The layout's standard load was re-pointed: the revision moved, the content did not.
    const repointed = ctx({ layout: layoutAt(4), refreshStandardLoadId: 'load-2' });
    expect(codes(clean(), repointed)).toEqual(['STANDARD_LOAD_CHANGED']);
    // A line that chose its own profile keeps it on a refresh: nothing to offer.
    expect(codes({ ...clean(), standardLoadChosen: true }, repointed)).toEqual([]);
    // An issued line's counts are on its Note; only a draft is refreshed.
    expect(codes({ ...clean(), status: 'issued' }, repointed)).toEqual([]);
    // The content changed too: LAYOUT_CHANGED already offers the refresh, once.
    const both = ctx({
      layout: layoutAt(4, { typeLabel: 'BRK (T2)' }),
      refreshStandardLoadId: 'load-2',
    });
    expect(codes(clean(), both)).toEqual(['LAYOUT_CHANGED']);
    // A spare line has no machine to follow.
    expect(codes({ ...clean(), kind: 'spare', machineId: null }, repointed)).not.toContain(
      'STANDARD_LOAD_CHANGED',
    );
  });

  it('STANDARD_DENOMINATION_UNPLACED when the profile carries a denomination no slot has', () => {
    const line = {
      ...clean(),
      slots: withNotes(mix(200, 200, 100, 0), [2100, 2100, 1300]),
    };
    expect(codes(line)).toEqual(['STANDARD_DENOMINATION_UNPLACED']);
  });

  it('DIFFERS_FROM_STANDARD against standardNotes on a draft, never on an issued line', () => {
    const edited = {
      ...clean(),
      slots: withNotes(mix(200, 200, 100, 50), [2100, 1100, 1300, 900]),
    };
    expect(codes(edited)).toEqual(['DIFFERS_FROM_STANDARD']);
    expect(codes({ ...edited, status: 'issued' })).toEqual([]);
  });

  it('RUN_TIME_ORDER when run 2 is not later than run 1', () => {
    const first = {
      kind: 'machine' as const,
      machineId: 'm-1',
      run: 1,
      scheduleTime: '21:00',
      status: 'draft' as const,
    };
    const second = { ...clean(), run: 2, scheduleTime: '09:00' };
    expect(codes(second, ctx({ otherLines: [first] }))).toEqual(['RUN_TIME_ORDER']);
    expect(codes({ ...second, scheduleTime: '22:00' }, ctx({ otherLines: [first] }))).toEqual([]);
  });

  it('FOREIGN_CURRENCY_NOT_PLANNED when the layout has a fillable foreign slot', () => {
    const line = {
      ...clean(),
      slots: [
        ...withNotes(mix(200, 200, 100, 50), [2100, 2100, 1300, 900]),
        { ...slotOf(5, 'withdrawal', 100, 'USD'), notes: 0, bag: null },
      ],
    };
    expect(codes(line)).toEqual(['FOREIGN_CURRENCY_NOT_PLANNED']);
  });
});

// ── §6.1 Schemas ────────────────────────────────────────────────────────────────────────────────

describe('schemas (§6.1)', () => {
  const layout = {
    version: null,
    slots: mix(200, 200, 100, 50),
    typeLabel: 'BRK (T1)',
    featuresLabel: 'Withdrawall',
    hubLabel: 'منطقة اختبار',
    standardLoadId: null,
    reason: null,
  };

  it('SaveAtmCassetteLayoutSchema refuses 3 slots and a label with a control character', () => {
    expect(SaveAtmCassetteLayoutSchema.safeParse(layout).success).toBe(true);
    const three = SaveAtmCassetteLayoutSchema.safeParse({ ...layout, slots: mix(200, 100, 50) });
    expect(three.success).toBe(false);
    const control = SaveAtmCassetteLayoutSchema.safeParse({ ...layout, typeLabel: 'BRK\u0007' });
    expect(control.success).toBe(false);
  });

  it('SaveAtmCassetteLayoutSchema reports the layoutIssues codes and upper-cases a currency', () => {
    const bad = SaveAtmCassetteLayoutSchema.safeParse({
      ...layout,
      slots: [...mix(200, 200, 100), slotOf(4, 'withdrawal', 25, 'egp')],
    });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues.map((i) => i.message)).toEqual(['EGP_DENOMINATION']);
      expect(bad.error.issues[0]?.path).toEqual(['slots', 3]);
    }
  });

  it('SaveAtmStandardLoadSchema refuses a repeated denomination', () => {
    const body = {
      branchId: '650000000000000000000101',
      bankCode: 'BRK',
      label: null,
      isDefault: true,
      notes: [
        { denomination: 200, notes: 4200 },
        { denomination: 200, notes: 1300 },
      ],
    };
    const parsed = SaveAtmStandardLoadSchema.safeParse(body);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.path).toEqual(['notes', 1, 'denomination']);
    expect(SaveAtmStandardLoadSchema.safeParse({ ...body, notes: [body.notes[0]] }).success).toBe(
      true,
    );
  });

  it('UpdateAtmPlanLineSchema refuses a repeated slot in notes, and a patch with no change', () => {
    const repeated = UpdateAtmPlanLineSchema.safeParse({
      version: 0,
      notes: [
        { slot: 1, notes: 100 },
        { slot: 1, notes: 200 },
      ],
    });
    expect(repeated.success).toBe(false);
    expect(UpdateAtmPlanLineSchema.safeParse({ version: 0 }).success).toBe(false);
    expect(UpdateAtmPlanLineSchema.safeParse({ version: 0, run: 2 }).success).toBe(true);
  });

  it('AddAtmPlanLinesSchema refuses 201 rows and accepts a 12-hour time', () => {
    const row = { machineCode: 'BRKN9001', scheduleTime: '9:00 PM' };
    expect(AddAtmPlanLinesSchema.safeParse({ run: 1, rows: [row] }).success).toBe(true);
    expect(
      AddAtmPlanLinesSchema.safeParse({ run: 1, rows: Array.from({ length: 201 }, () => row) })
        .success,
    ).toBe(false);
    expect(AddAtmPlanLinesSchema.safeParse({ run: 4, rows: [row] }).success).toBe(false);
  });

  describe('LayoutImportFieldsSchema (SEC-10)', () => {
    const fields = { bankCode: 'BRK', branchId: '650000000000000000000101' };
    const sha = 'a'.repeat(64);

    it("'TRUE' is not true, and a missing standardLoads is false", () => {
      const parsed = LayoutImportFieldsSchema.parse({ ...fields, apply: 'TRUE' });
      expect(parsed.apply).toBe(false);
      expect(parsed.standardLoads).toBe(false);
      expect(parsed.mode).toBeUndefined();
    });

    it("apply 'true' needs a mode, a hash and the preview's revisions", () => {
      const noMode = LayoutImportFieldsSchema.safeParse({
        ...fields,
        apply: 'true',
        fileSha256: sha,
        previewRevisions: '[]',
      });
      expect(noMode.success).toBe(false);
      if (!noMode.success) expect(noMode.error.issues[0]?.path).toEqual(['mode']);
      const ok = LayoutImportFieldsSchema.parse({
        ...fields,
        apply: 'true',
        mode: 'newOnly',
        standardLoads: 'true',
        fileSha256: sha,
        previewRevisions: JSON.stringify([
          { machineId: '650000000000000000000201', revision: null },
          { machineId: '650000000000000000000202', revision: 2 },
        ]),
      });
      expect(ok.apply).toBe(true);
      expect(ok.standardLoads).toBe(true);
      expect(ok.previewRevisions).toEqual([
        { machineId: '650000000000000000000201', revision: null },
        { machineId: '650000000000000000000202', revision: 2 },
      ]);
    });

    it('refuses a short hash and revisions that are not the expected JSON', () => {
      expect(LayoutImportFieldsSchema.safeParse({ ...fields, fileSha256: 'abc' }).success).toBe(
        false,
      );
      const broken = LayoutImportFieldsSchema.safeParse({
        ...fields,
        apply: 'true',
        mode: 'newOnly',
        fileSha256: sha,
        previewRevisions: '{not json',
      });
      expect(broken.success).toBe(false);
    });
  });

  it('AtmSettlementPrintSchema refuses an unknown kind', () => {
    expect(AtmSettlementPrintSchema.safeParse({ kind: 'notes', unprintedOnly: true }).success).toBe(
      true,
    );
    expect(AtmSettlementPrintSchema.safeParse({ kind: 'labels' }).success).toBe(false);
  });
});
