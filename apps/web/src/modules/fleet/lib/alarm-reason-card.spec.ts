// What the «فارق عداد الصيانة» reason card says, and how it opens — proven without a browser.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type FleetAlarmBaselineDto, type FleetMaintenanceAlarmDto } from '@ecms/contracts';
import {
  INTERVAL_PERMISSION,
  REASON_CARD_DELAY_MS,
  REASON_FIX,
  cardFacts,
  chipWords,
  counterLabelKey,
  headingWords,
  hoverControl,
  notActiveCard,
  reasonFix,
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
