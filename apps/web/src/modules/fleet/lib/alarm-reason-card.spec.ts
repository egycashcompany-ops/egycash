// What the «فارق عداد الصيانة» reason card says, and how it opens — proven without a browser.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type FleetAlarmBaselineDto, type FleetMaintenanceAlarmDto } from '@ecms/contracts';
import {
  INTERVAL_PERMISSION,
  bindFigures,
  REASON_CARD_DELAY_MS,
  REASON_FIX,
  cardFacts,
  chipWords,
  counterLabelKey,
  figureFacts,
  headingWords,
  hoverControl,
  notActiveCard,
  reasonFix,
  remainingOf,
  templateParts,
} from './alarm-reason-card';

const HERE = dirname(fileURLToPath(import.meta.url));
const day = (ymd: string): string => `${ymd}T00:00:00.000Z`;

const baseline = (o: Partial<FleetAlarmBaselineDto> = {}): FleetAlarmBaselineDto => ({
  visitId: 'visit-295',
  inDate: day('2026-10-06'),
  outDate: day('2026-10-06'),
  entryCounter: 22_790,
  exitCounter: null,
  source: 'entry',
  counter: 22_790,
  counterDate: day('2026-10-06'),
  judgedAgainst: { reading: 22_830, date: day('2026-10-06') },
  exitSetAside: null,
  workType: null,
  ...o,
});

/** Car 295 under the old same-day rule: the entry counter judged against a reading of its day. */
const alarm = (o: Partial<FleetMaintenanceAlarmDto> = {}): FleetMaintenanceAlarmDto => ({
  vehicleId: 'v295',
  code: '295',
  level: 'none',
  remainingKm: null,
  sinceServiceKm: null,
  lastServiceAt: day('2026-10-06'),
  lastServiceVisitId: 'visit-295',
  noAlarmReason: 'baselineBelowChain',
  daysWithoutReading: 0,
  latestReading: 25_631,
  latestReadingAt: day('2026-10-26'),
  latestReadingLogId: 'r26',
  baseline: baseline(),
  newerUncountedVisit: null,
  rule: { vehicleType: null, intervalKm: 0, yellowKm: 1000, redKm: 300 },
  newestReading: null,
  ...o,
});

describe('the chip and the heading are the alarms board’s own sentence', () => {
  it('the chip keeps the fact before the dash; the heading keeps it all, never starting a line on it', () => {
    const sentence = 'عداد الصيانة أقل من قراءة مسجّلة قبل تاريخها — الرقمان غير قابلين للمقارنة';
    expect(chipWords(sentence)).toBe('عداد الصيانة أقل من قراءة مسجّلة قبل تاريخها');
    expect(headingWords(sentence)).toBe(sentence.replace(' — ', ' — '));
    expect(chipWords('لا صيانة محسوبة بعد')).toBe('لا صيانة محسوبة بعد');
  });

  it('«المطلوب» names the counter actually used', () => {
    expect(counterLabelKey(alarm())).toBe('fleet.maintenance.fields.odometerAtService');
    expect(
      counterLabelKey(alarm({ baseline: baseline({ source: 'exit', exitCounter: 22_900 }) })),
    ).toBe('fleet.maintenance.fields.exitOdometer');
    expect(counterLabelKey(alarm({ baseline: null }))).toBe(
      'fleet.maintenance.fields.odometerAtService',
    );
  });

  it('cuts a sentence at its placeholders, keeping the words between them', () => {
    expect(templateParts('أقل من قراءة {{reading}} في {{date}}')).toEqual([
      { text: 'أقل من قراءة ' },
      { name: 'reading' },
      { text: ' في ' },
      { name: 'date' },
    ]);
    expect(templateParts('بلا شيء')).toEqual([{ text: 'بلا شيء' }]);
  });
});

describe('the way to fix it', () => {
  const all = (): boolean => true;
  const car = { code: '2 95', vehicleId: 'v295' };

  it('sends each reason to its place, the code escaped', () => {
    expect(reasonFix('noInterval', car, all)).toEqual({
      kind: 'route',
      to: '/fleet/catalogs?kind=make',
    });
    expect(reasonFix('noReading', car, all)).toEqual({ kind: 'record' });
    for (const reason of ['noService', 'baselineAboveReading', 'baselineBelowChain'] as const) {
      expect(reasonFix(reason, car, all)).toEqual({
        kind: 'route',
        to: '/fleet/maintenance?vehicleCodes=2%2095',
      });
    }
    expect(reasonFix('readingOlderThanService', car, all)).toEqual({
      kind: 'route',
      to: '/fleet/maintenance-alarms?vehicleCodes=2%2095',
    });
    expect(reasonFix('notActive', car, all)).toEqual({ kind: 'route', to: '/fleet/vehicles/v295' });
  });

  it('shows a link only to a reader who holds every grant it needs', () => {
    const only =
      (...held: string[]) =>
      (p: string) =>
        held.includes(p);
    // The interval is edited under the makes' own grant; the catalogs grant only opens the screen.
    expect(reasonFix('noInterval', car, only('fleetCatalog.manage'))).toBeNull();
    expect(reasonFix('noInterval', car, only(INTERVAL_PERMISSION))).toBeNull();
    expect(
      reasonFix('noInterval', car, only('fleetCatalog.manage', INTERVAL_PERMISSION)),
    ).not.toBeNull();
    expect(reasonFix('noReading', car, only('fleetOdometer.view'))).toBeNull();
    expect(reasonFix('noService', car, only('fleetOdometer.view'))).toBeNull();
    expect(reasonFix('readingOlderThanService', car, only('fleetOdometer.view'))).not.toBeNull();
    expect(reasonFix('notActive', car, only('fleetOdometer.view'))).toBeNull();
    expect(REASON_FIX.notActive.needs).toEqual(['fleetVehicle.view']);
  });

  it('with no grant at all, no reason offers a way — each one needs one', () => {
    for (const reason of Object.keys(REASON_FIX) as (keyof typeof REASON_FIX)[]) {
      expect(REASON_FIX[reason].needs.length, reason).toBeGreaterThan(0);
      expect(
        reasonFix(reason, car, () => false),
        reason,
      ).toBeNull();
    }
    for (const reason of ['noService', 'baselineAboveReading', 'baselineBelowChain'] as const) {
      expect(REASON_FIX[reason].needs, reason).toEqual(['fleetMaintenance.view']);
    }
  });

  it('the interval’s grant IS the makes table’s', () => {
    const table = readFileSync(join(HERE, '../components/VehicleTypesTable.tsx'), 'utf8');
    expect(table).toContain(`MAKES_PERMISSION = '${INTERVAL_PERMISSION}'`);
  });
});

describe('the facts', () => {
  const kinds = (a: FleetMaintenanceAlarmDto) =>
    cardFacts(a, a.noAlarmReason ?? 'noService').map((f) => f.kind);

  it('car 295, same day: the entry counter used, the reading it was judged against in conflict', () => {
    const facts = cardFacts(alarm(), 'baselineBelowChain');
    expect(facts.map((f) => f.kind)).toEqual(['car', 'latest', 'service', 'counter', 'judged']);
    expect(facts).toContainEqual({ kind: 'car', code: '295' });
    expect(facts).toContainEqual({
      kind: 'latest',
      reading: 25_631,
      date: day('2026-10-26'),
      conflict: false,
      dateFlagged: false,
    });
    expect(facts).toContainEqual({
      kind: 'counter',
      which: 'entry',
      value: 22_790,
      used: true,
      conflict: false,
      setAside: null,
    });
    expect(facts).toContainEqual({
      kind: 'judged',
      point: { reading: 22_830, date: day('2026-10-06') },
      conflict: true,
    });
  });

  it('a late closure: the exit counter set aside with what contradicts it, the entry used', () => {
    const late = alarm({
      noAlarmReason: 'readingOlderThanService',
      lastServiceAt: day('2026-10-26'),
      latestReading: 167_520,
      latestReadingAt: day('2026-10-25'),
      baseline: baseline({
        inDate: day('2026-10-12'),
        outDate: day('2026-10-26'),
        entryCounter: 165_880,
        exitCounter: 165_895,
        counter: 165_880,
        counterDate: day('2026-10-12'),
        judgedAgainst: { reading: 165_862, date: day('2026-10-11') },
        exitSetAside: {
          because: 'belowChain',
          conflict: { reading: 167_520, date: day('2026-10-25') },
        },
      }),
    });
    const facts = cardFacts(late, 'readingOlderThanService');
    expect(facts.map((f) => f.kind)).toEqual([
      'car',
      'latest',
      'service',
      'counter',
      'counter',
      'judged',
    ]);
    expect(facts.find((f) => f.kind === 'latest')).toMatchObject({
      dateFlagged: true,
      conflict: false,
    });
    expect(facts.find((f) => f.kind === 'service')).toMatchObject({ outFlagged: true });
    expect(facts.filter((f) => f.kind === 'counter')).toEqual([
      {
        kind: 'counter',
        which: 'entry',
        value: 165_880,
        used: true,
        conflict: false,
        setAside: null,
      },
      {
        kind: 'counter',
        which: 'exit',
        value: 165_895,
        used: false,
        conflict: false,
        setAside: {
          because: 'belowChain',
          conflict: { reading: 167_520, date: day('2026-10-25') },
        },
      },
    ]);
    // Not this reason's conflict: the judged-against reading is not marked.
    expect(facts.find((f) => f.kind === 'judged')).toMatchObject({ conflict: false });
  });

  it('a counter above the latest reading: both the reading and the USED counter in conflict', () => {
    const above = alarm({
      noAlarmReason: 'baselineAboveReading',
      baseline: baseline({
        source: 'exit',
        exitCounter: 28_790,
        counter: 28_790,
        judgedAgainst: null,
      }),
    });
    const facts = cardFacts(above, 'baselineAboveReading');
    expect(facts.find((f) => f.kind === 'latest')).toMatchObject({ conflict: true });
    const [entry, exit] = facts.filter((f) => f.kind === 'counter');
    expect(entry).toMatchObject({ which: 'entry', used: false, conflict: false });
    expect(exit).toMatchObject({ which: 'exit', used: true, conflict: true });
  });

  it('a visit with no counter: the reading standing in, with no judged-against line', () => {
    const standIn = alarm({
      noAlarmReason: 'readingOlderThanService',
      baseline: baseline({
        entryCounter: null,
        source: 'reading',
        counter: 22_400,
        judgedAgainst: null,
      }),
    });
    expect(kinds(standIn)).toEqual(['car', 'latest', 'service', 'standIn']);
    expect(cardFacts(standIn, 'readingOlderThanService')).toContainEqual({
      kind: 'standIn',
      value: 22_400,
    });
  });

  it('a newer visit that is still open, or does not count, closes the list', () => {
    const open = alarm({
      noAlarmReason: 'noService',
      lastServiceAt: null,
      lastServiceVisitId: null,
      baseline: null,
      newerUncountedVisit: {
        visitId: 'n',
        inDate: day('2026-10-24'),
        outDate: null,
        why: 'open',
        workType: null,
        workshop: null,
        counts: false,
      },
    });
    expect(kinds(open)).toEqual(['car', 'latest', 'newer']);
    expect(cardFacts(open, 'noService').at(-1)).toEqual({
      kind: 'newer',
      why: 'open',
      date: day('2026-10-24'),
    });
    const notCounting = alarm({
      newerUncountedVisit: {
        visitId: 'n',
        inDate: day('2026-10-20'),
        outDate: day('2026-10-21'),
        why: 'notCounting',
        workType: null,
        workshop: null,
        counts: false,
      },
    });
    expect(cardFacts(notCounting, 'baselineBelowChain').at(-1)).toMatchObject({
      why: 'notCounting',
    });
  });

  it('a car with no reading and no service says only what it has — never a guess', () => {
    const bare = alarm({
      noAlarmReason: 'noReading',
      latestReading: null,
      latestReadingAt: null,
      latestReadingLogId: null,
      lastServiceAt: null,
      lastServiceVisitId: null,
      baseline: null,
    });
    expect(cardFacts(bare, 'noReading')).toEqual([{ kind: 'car', code: '295' }]);
  });
});

describe('«السيارة غير نشطة»', () => {
  const car = { status: 'outOfService' as const, statusReason: 'حادث تصادم — في ورشة التوكيل' };

  it('names the status and its reason from the registry', () => {
    expect(notActiveCard({ readable: true, loaded: true }, car)).toEqual({
      why: 'why',
      vehicle: car,
    });
  });

  it('a blank reason is no reason', () => {
    expect(notActiveCard({ readable: true, loaded: true }, { ...car, statusReason: '  ' })).toEqual(
      {
        why: 'why',
        vehicle: { status: 'outOfService', statusReason: null },
      },
    );
  });

  it('a car missing from the whole registry is deleted', () => {
    expect(notActiveCard({ readable: true, loaded: true }, undefined)).toEqual({
      why: 'whyDeleted',
      vehicle: null,
    });
  });

  it('a reader without the registry, or a list not in yet, gets the plain sentence', () => {
    expect(notActiveCard({ readable: false, loaded: false }, undefined).why).toBe('whyUnknown');
    expect(notActiveCard({ readable: true, loaded: false }, car)).toEqual({
      why: 'whyUnknown',
      vehicle: null,
    });
  });
});

describe('opening and closing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const watched = () => {
    const seen: boolean[] = [];
    const control = hoverControl((open) => seen.push(open));
    return { seen, control };
  };

  it('opens a beat after the pointer arrives — and not if it left first', () => {
    const { seen, control } = watched();
    control.enter();
    vi.advanceTimersByTime(REASON_CARD_DELAY_MS - 1);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual([true]);
    control.leave();
    expect(seen).toEqual([true, false]);
    control.enter();
    control.leave();
    vi.advanceTimersByTime(REASON_CARD_DELAY_MS * 2);
    expect(seen).toEqual([true, false]);
    control.close();
  });

  it('opens at once on keyboard focus, stays while the pointer wanders, closes on blur', () => {
    const { seen, control } = watched();
    control.focus(false);
    expect(seen, 'a click’s focus is not a question').toEqual([]);
    control.focus(true);
    expect(seen).toEqual([true]);
    control.leave();
    expect(seen).toEqual([true]);
    control.blur();
    expect(seen).toEqual([true, false]);
  });

  it('closes on Escape and says so — and Escape on a closed card does nothing', () => {
    const { seen, control } = watched();
    expect(control.escape()).toBe(false);
    control.focus(true);
    expect(control.escape()).toBe(true);
    expect(seen).toEqual([true, false]);
  });

  it('one card open at a time', () => {
    const a = watched();
    const b = watched();
    a.control.focus(true);
    b.control.enter();
    vi.advanceTimersByTime(REASON_CARD_DELAY_MS);
    expect(a.seen).toEqual([true, false]);
    expect(b.seen).toEqual([true]);
    b.control.close();
  });

  it('leaves no timer behind when its chip goes', () => {
    const { seen, control } = watched();
    control.enter();
    control.close();
    vi.advanceTimersByTime(REASON_CARD_DELAY_MS * 2);
    expect(seen).toEqual([]);
  });
});

// ── «كيف حُسب الفارق» — a computed figure, explained ────────────────────────────────────────────

describe('figureFacts — the card of a COMPUTED figure lays the server’s numbers side by side', () => {
  const SERVICE = { id: 'wt-service', name: { ar: 'صيانة', en: 'Service' } };
  const REPAIR = { id: 'wt-repair', name: { ar: 'إصلاح', en: 'Repair' } };
  const DEALER = { id: 'ws-dealer', name: { ar: 'التوكيل', en: 'Dealership' } };
  const SPRINTER = { id: 'make-516', name: { ar: 'مرسيدس اسبرانتر 516', en: 'Sprinter 516' } };

  /** Car 295 as the owner sent it: 28,297 − 22,790 = 5,507 km, interval 7,500, 1,993 left. */
  const car295 = (o: Partial<FleetMaintenanceAlarmDto> = {}): FleetMaintenanceAlarmDto =>
    alarm({
      noAlarmReason: null,
      sinceServiceKm: 5_507,
      remainingKm: 1_993,
      latestReading: 28_297,
      latestReadingAt: day('2026-11-01'),
      latestReadingLogId: 'r1101',
      baseline: baseline({ workType: SERVICE, judgedAgainst: null }),
      rule: { vehicleType: SPRINTER, intervalKm: 7_500, yellowKm: 1_000, redKm: 300 },
      newestReading: { reading: 28_297, date: day('2026-11-01') },
      ...o,
    });

  it('nothing for a figure the projection refused — that car gets the reason card', () => {
    expect(figureFacts(alarm())).toBeNull();
  });

  it('car 295: the reading, the counted visit and its work type, the arithmetic and the rule', () => {
    const facts = figureFacts(car295());
    expect(facts).toMatchObject({
      code: '295',
      vehicleType: SPRINTER,
      latest: { reading: 28_297, date: day('2026-11-01') },
      newest: null,
      service: { inDate: day('2026-10-06'), outDate: day('2026-10-06'), workType: SERVICE },
      subtraction: { latest: 28_297, counter: 22_790, since: 5_507 },
      intervalKm: 7_500,
      remaining: { interval: 7_500, since: 5_507, left: 1_993 },
      thresholds: { yellowKm: 1_000, redKm: 300 },
      level: 'none',
      newer: null,
    });
    // The used counter is marked; nothing is set aside or in conflict on a computed figure.
    expect(facts?.counters).toEqual([
      {
        kind: 'counter',
        which: 'entry',
        value: 22_790,
        used: true,
        conflict: false,
        setAside: null,
      },
    ]);
  });

  it('the exit counter used, the entry beside it unused', () => {
    const facts = figureFacts(
      car295({
        baseline: baseline({
          entryCounter: 22_700,
          exitCounter: 22_790,
          source: 'exit',
          counter: 22_790,
          workType: SERVICE,
        }),
      }),
    );
    expect(facts?.counters.map((c) => (c.kind === 'counter' ? [c.which, c.used] : c.kind))).toEqual(
      [
        ['entry', false],
        ['exit', true],
      ],
    );
  });

  it('an exit counter SET ASIDE stays on the card, with the reading against it (R3)', () => {
    const aside = {
      because: 'belowChain' as const,
      conflict: { reading: 167_520, date: day('2026-10-25') },
    };
    const facts = figureFacts(
      car295({
        baseline: baseline({
          entryCounter: 19_790,
          exitCounter: 19_800,
          source: 'entry',
          counter: 19_790,
          exitSetAside: aside,
        }),
        sinceServiceKm: 8_507,
        remainingKm: -1_007,
        level: 'red',
      }),
    );
    const exit = facts?.counters.find((c) => c.kind === 'counter' && c.which === 'exit');
    expect(exit).toMatchObject({ used: false, setAside: aside, conflict: false });
    expect(facts?.subtraction).toEqual({ latest: 28_297, counter: 19_790, since: 8_507 });
    // Past the interval the remainder is the server's negative figure, laid out as it came.
    expect(facts?.remaining).toEqual({ interval: 7_500, since: 8_507, left: -1_007 });
  });

  it('a reading standing in for both counters is said as such (R4)', () => {
    const facts = figureFacts(
      car295({
        baseline: baseline({
          entryCounter: null,
          exitCounter: null,
          source: 'reading',
          counter: 22_800,
        }),
        sinceServiceKm: 5_497,
      }),
    );
    expect(facts?.counters).toEqual([{ kind: 'standIn', value: 22_800 }]);
    expect(facts?.subtraction).toEqual({ latest: 28_297, counter: 22_800, since: 5_497 });
  });

  it('C6: the newest reading is shown only when it is NOT the highest — by figure or by day', () => {
    expect(figureFacts(car295())?.newest).toBeNull();
    // A typo-high reading earlier in the cycle (31,297 on 10/12): the highest is not the newest,
    // and the newest (28,297 on 11/01) is shown beside it.
    expect(
      figureFacts(car295({ latestReading: 31_297, latestReadingAt: day('2026-10-12') }))?.newest,
    ).toEqual({ reading: 28_297, date: day('2026-11-01') });
    // Same figure, another day (a later day that did not move): still said.
    const later = { reading: 28_297, date: day('2026-11-02') };
    expect(figureFacts(car295({ newestReading: later }))?.newest).toEqual(later);
    // A full instant on the same day is the same day.
    expect(
      figureFacts(car295({ newestReading: { reading: 28_297, date: '2026-11-01T00:00:00Z' } }))
        ?.newest,
    ).toBeNull();
  });

  it('no rule: no interval and no remainder — the subtraction still stands', () => {
    const facts = figureFacts(
      car295({ rule: { vehicleType: null, intervalKm: 0, yellowKm: 1_000, redKm: 300 } }),
    );
    expect(facts?.intervalKm).toBeNull();
    expect(facts?.remaining).toBeNull();
    expect(facts?.subtraction).not.toBeNull();
  });

  it('thresholds and level are the server’s as resolved, never compared here', () => {
    const facts = figureFacts(
      car295({
        level: 'yellow',
        remainingKm: 800,
        rule: { vehicleType: SPRINTER, intervalKm: 7_500, yellowKm: 1_200, redKm: 400 },
      }),
    );
    expect(facts?.thresholds).toEqual({ yellowKm: 1_200, redKm: 400 });
    expect(facts?.level).toBe('yellow');
  });

  describe('a newer visit that does not count (yet)', () => {
    const newer = (
      why: 'open' | 'notCounting' | 'checkedOutEarlier',
      workType = REPAIR,
      outDate: string | null = null,
      // The server's word on the work type (`newerUncountedVisit.counts`); «إصلاح» does not count.
      counts = why === 'checkedOutEarlier',
    ) => ({
      visitId: 'newer',
      inDate: day('2026-09-10'),
      outDate,
      why,
      workType,
      workshop: DEALER,
      counts,
    });

    // Rewritten on purpose (HUB, W-ODO hand-off): the server now says whether an open visit's work
    // type counts (`counts`), so the card no longer infers it from the counted visit's work type —
    // 157's «إصلاح» is stated as not counting even once closed, as sample A/04 says.
    it('157: open «إصلاح», which the server says does not count — so it never counts once closed', () => {
      const facts = figureFacts(car295({ newerUncountedVisit: newer('open') }));
      expect(facts?.newer).toEqual({
        why: 'open',
        inDate: day('2026-09-10'),
        outDate: null,
        workType: REPAIR,
        workshop: DEALER,
        counts: false,
        countedOut: null,
      });
    });

    it('open, of a work type the server says counts — that one counts once closed', () => {
      expect(
        figureFacts(car295({ newerUncountedVisit: newer('open', SERVICE, null, true) }))?.newer
          ?.counts,
      ).toBe(true);
    });

    it('the server’s word, never the name: an open visit named like the counted one may not count', () => {
      expect(
        figureFacts(car295({ newerUncountedVisit: newer('open', SERVICE, null, false) }))?.newer
          ?.counts,
      ).toBe(false);
    });

    it('closed, of a work type that does not count', () => {
      const facts = figureFacts(
        car295({ newerUncountedVisit: newer('notCounting', REPAIR, day('2026-10-21')) }),
      );
      expect(facts?.newer).toMatchObject({ why: 'notCounting', counts: false, countedOut: null });
    });

    it('C8: closed and counting, but checked out before the counted visit — that day is named', () => {
      const facts = figureFacts(
        car295({
          baseline: baseline({
            inDate: day('2026-09-26'),
            outDate: day('2026-10-20'),
            entryCounter: 19_790,
            counter: 19_790,
            workType: SERVICE,
          }),
          sinceServiceKm: 8_507,
          newerUncountedVisit: newer('checkedOutEarlier', SERVICE, day('2026-10-06')),
        }),
      );
      expect(facts?.newer).toMatchObject({
        why: 'checkedOutEarlier',
        counts: true,
        outDate: day('2026-10-06'),
        countedOut: day('2026-10-20'),
      });
    });
  });
});

describe('remainingOf — «X من Y كم» on the alarms board’s «المتبقي»', () => {
  const rule = (intervalKm: number) => ({
    vehicleType: null,
    intervalKm,
    yellowKm: 1_000,
    redKm: 300,
  });

  it('what is left of the make’s interval, as the server sent it', () => {
    expect(remainingOf({ remainingKm: 1_993, rule: rule(7_500) })).toEqual({
      left: 1_993,
      interval: 7_500,
      overdue: false,
    });
  });

  it('past the interval: overdue, the remainder kept as it came', () => {
    expect(remainingOf({ remainingKm: -500, rule: rule(5_000) })).toEqual({
      left: -500,
      interval: 5_000,
      overdue: true,
    });
    expect(remainingOf({ remainingKm: 0, rule: rule(5_000) })?.overdue).toBe(false);
  });

  it('nothing without a rule or a remainder', () => {
    expect(remainingOf({ remainingKm: 1_993, rule: rule(0) })).toBeNull();
    expect(remainingOf({ remainingKm: null, rule: rule(7_500) })).toBeNull();
  });
});

describe('bindFigures — a line of figures breaks only between its phrases', () => {
  const NB = '\u00A0';
  it('binds each figure to the word before it, and the closing unit to the last figure', () => {
    expect(bindFigures('المتبقي {{left}} من {{interval}} كم')).toBe(
      `المتبقي${NB}{{left}} من${NB}{{interval}}${NB}كم`,
    );
    expect(bindFigures('متأخر {{over}} كم عن {{interval}} كم')).toBe(
      `متأخر${NB}{{over}} كم عن${NB}{{interval}}${NB}كم`,
    );
    expect(bindFigures('من {{interval}} كم')).toBe(`من${NB}{{interval}}${NB}كم`);
  });

  it('leaves a sentence that does not end on a unit word as it is after its last figure', () => {
    expect(bindFigures('{{left}} of {{interval}} km left')).toBe(
      `{{left}} of${NB}{{interval}} km left`,
    );
    expect(bindFigures('بلا أرقام')).toBe('بلا أرقام');
  });
});
