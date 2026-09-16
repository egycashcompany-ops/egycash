// The rule behind the six chips: three different questions, and how they combine.
//
// Driven as a function, because that is what it is. The screen spec above renders it; this one
// pins the SEMANTICS — which is where the costly mistake lives, since «صيانة» the state and the
// mission type «نقل أموال (صيانة)» share a word and mean different things.
import { describe, expect, it } from 'vitest';
import { type FleetFixedCrewRowDto, type FleetRosterRowDto } from '@ecms/contracts';
import {
  carriesPlan,
  COUNTER_TONES,
  FIXED_ROSTER_VIEWS,
  hasDriver,
  MISSION_TONES,
  missionTone,
  readFixedView,
  readView,
  UNSAVED_ROW,
  visibleFixedRows,
  visibleRows,
} from './roster-view';

const MISSION_A = '65000000000000000000a001';
const MISSION_B = '65000000000000000000b002';

// The plate FOLLOWS the code unless the caller says otherwise. Spelling it as a literal beside a
// defaulted `code` gave every fixture the same plate, which quietly made a plate search match
// rows it had nothing to do with — a fixture that agrees with itself proves nothing.
const row = (over: Partial<FleetRosterRowDto> = {}): FleetRosterRowDto => {
  const code = over.code ?? '150';
  return {
    vehicleId: 'v1',
    typeId: 't1',
    inMaintenance: false,
    planned: false,
    missionTypeId: null,
    driver1EmployeeId: null,
    driver2EmployeeId: null,
    notes: null,
    ...over,
    code,
    plateNumber: over.plateNumber ?? `س ص ${code}`,
  };
};

const codes = (rows: readonly FleetRosterRowDto[]): string[] => rows.map((r) => r.code);

/** A day with one of each interesting shape. */
const DAY: FleetRosterRowDto[] = [
  row({ vehicleId: 'v1', code: '150' }), // plain: no plan, not in the workshop
  row({ vehicleId: 'v2', code: '151', inMaintenance: true }), // workshop, no plan
  row({ vehicleId: 'v3', code: '152', missionTypeId: MISSION_A }), // mission A
  row({ vehicleId: 'v4', code: '153', driver1EmployeeId: 'e1' }), // a driver, no mission
  row({ vehicleId: 'v5', code: '154', inMaintenance: true, missionTypeId: MISSION_A }), // both
  row({ vehicleId: 'v6', code: '155', missionTypeId: MISSION_B }), // mission B
];

describe('carriesPlan — what «تشغيل» has always counted', () => {
  it('is true for a mission, or a driver in EITHER seat', () => {
    expect(carriesPlan(row({ missionTypeId: MISSION_A }))).toBe(true);
    expect(carriesPlan(row({ driver1EmployeeId: 'e1' }))).toBe(true);
    expect(carriesPlan(row({ driver2EmployeeId: 'e2' }))).toBe(true);
  });

  it('is false for a bare row, and a NOTE is not a plan', () => {
    expect(carriesPlan(row())).toBe(false);
    expect(carriesPlan(row({ notes: 'ملاحظة' })), 'a remark about the day, not a plan for it').toBe(
      false,
    );
  });

  it('says nothing about the workshop — the two are independent facts', () => {
    // The trap this whole module exists to avoid: a car can be in the workshop AND carry a plan.
    expect(carriesPlan(row({ inMaintenance: true }))).toBe(false);
    expect(carriesPlan(row({ inMaintenance: true, missionTypeId: MISSION_A }))).toBe(true);
  });

  it('is not the same as `planned` — a stored row is not a plan on the row', () => {
    // `planned` says a duty document EXISTS for the day; it says nothing about its contents.
    expect(carriesPlan(row({ planned: true }))).toBe(false);
  });
});

describe('one filter at a time', () => {
  it('«إجمالي» — no filter shows the whole day', () => {
    expect(codes(visibleRows(DAY, {}))).toEqual(['150', '151', '152', '153', '154', '155']);
    expect(codes(visibleRows(DAY, { term: '', missions: [], view: null }))).toHaveLength(6);
  });

  it('«صيانة» — only the cars the workshop holds', () => {
    expect(codes(visibleRows(DAY, { view: 'workshop' }))).toEqual(['151', '154']);
  });

  it('«تشغيل» — only the cars carrying a plan', () => {
    expect(codes(visibleRows(DAY, { view: 'assigned' }))).toEqual(['152', '153', '154', '155']);
  });

  it('a mission chip — only that mission', () => {
    expect(codes(visibleRows(DAY, { missions: [MISSION_A] }))).toEqual(['152', '154']);
    expect(codes(visibleRows(DAY, { missions: [MISSION_B] }))).toEqual(['155']);
  });

  it('the code search — code or plate', () => {
    expect(codes(visibleRows(DAY, { term: '152' }))).toEqual(['152']);
    expect(codes(visibleRows(DAY, { term: 'س ص 155' })), 'the plate too').toEqual(['155']);
  });

  it('«صيانة» is NOT the mission type whose name contains the same word', () => {
    // The one confusion this module was written to prevent. A mission called «نقل أموال (صيانة)»
    // is a category; «صيانة» is a state. Filtering by one must never return the other's rows.
    const missionNamedSiyana = MISSION_B;
    expect(codes(visibleRows(DAY, { view: 'workshop' }))).not.toContain('155');
    expect(codes(visibleRows(DAY, { missions: [missionNamedSiyana] }))).not.toContain('151');
  });
});

describe('filters combine with AND — none cancels another', () => {
  it('«صيانة» + a mission is their INTERSECTION', () => {
    expect(codes(visibleRows(DAY, { view: 'workshop', missions: [MISSION_A] }))).toEqual(['154']);
    // …and not either one alone.
    expect(codes(visibleRows(DAY, { view: 'workshop' }))).toHaveLength(2);
    expect(codes(visibleRows(DAY, { missions: [MISSION_A] }))).toHaveLength(2);
  });

  it('«تشغيل» + a mission is their intersection too', () => {
    expect(codes(visibleRows(DAY, { view: 'assigned', missions: [MISSION_B] }))).toEqual(['155']);
  });

  it('a contradictory pair finds NOTHING rather than falling back to one of them', () => {
    // Mission B's car is not in the workshop. The honest answer is an empty board.
    expect(codes(visibleRows(DAY, { view: 'workshop', missions: [MISSION_B] }))).toEqual([]);
  });

  it('the search narrows on top of both', () => {
    expect(codes(visibleRows(DAY, { view: 'workshop', missions: [MISSION_A], term: '154' }))).toEqual([
      '154',
    ]);
    expect(codes(visibleRows(DAY, { view: 'workshop', missions: [MISSION_A], term: '150' }))).toEqual(
      [],
    );
  });

  it('never INVENTS a row: the result is always a subset of what it was given', () => {
    for (const filters of [
      { view: 'workshop' as const },
      { view: 'assigned' as const },
      { missions: [MISSION_A] },
      { view: 'assigned' as const, missions: [MISSION_A], term: '15' },
    ]) {
      const shown = visibleRows(DAY, filters);
      expect(
        shown.every((r) => DAY.includes(r)),
        JSON.stringify(filters),
      ).toBe(true);
    }
  });

  it('leaves the day it was handed untouched — filtering is a view, not an edit', () => {
    const before = JSON.stringify(DAY);
    visibleRows(DAY, { view: 'workshop', missions: [MISSION_A], term: '1' });
    expect(JSON.stringify(DAY)).toBe(before);
  });
});

describe('readView — the URL is user-writable', () => {
  it('accepts the two states it knows', () => {
    expect(readView('workshop')).toBe('workshop');
    expect(readView('assigned')).toBe('assigned');
  });

  it('answers null for anything else, so the board shows the whole day', () => {
    // A typo in the address bar must not produce an empty board nobody can explain.
    for (const raw of [null, '', 'nonsense', 'total', 'WORKSHOP', '65000000000000000000a001']) {
      expect(readView(raw), String(raw)).toBeNull();
    }
    expect(codes(visibleRows(DAY, { view: readView('nonsense') }))).toHaveLength(6);
  });
});

describe('the colours', () => {
  it('gives each of the three states its own tone', () => {
    const tones = [COUNTER_TONES.total, COUNTER_TONES.workshop, COUNTER_TONES.assigned];
    expect(new Set(tones).size).toBe(3);
  });

  it('agrees with the workshop row: «صيانة» is rose, like the tinted row', () => {
    expect(COUNTER_TONES.workshop).toContain('rose');
  });

  it('is STABLE per mission — the same catalog id answers the same way', () => {
    expect(missionTone(MISSION_A)).toBe(missionTone(MISSION_A));
    expect(MISSION_TONES).toContain(missionTone(MISSION_A));
  });

  it('DISTINGUISHES missions — a palette that answers the same for everyone is no palette', () => {
    // The gap a sabotage found: stability alone is satisfied by returning one colour forever,
    // and a row of six identically-tinted chips defeats the whole point of colouring them.
    const ids = Array.from(
      { length: MISSION_TONES.length },
      (_, i) => `6500000000000000000000${String(i).padStart(2, '0')}`,
    );
    const tones = new Set(ids.map(missionTone));
    expect(tones.size, `${ids.length} missions produced ${tones.size} colour(s)`).toBeGreaterThan(
      1,
    );
    // A fleet's handful of missions should land on distinct hues, not clump on one.
    expect(new Set(['a1', 'b2', 'c3', 'd4'].map(missionTone)).size).toBeGreaterThan(2);
  });

  it('does not depend on POSITION — archiving one mission moves nobody else’s colour', () => {
    const ids = [MISSION_A, MISSION_B, '65000000000000000000c003'];
    const before = ids.map(missionTone);
    const after = ids.slice(1).map(missionTone);
    expect(after).toEqual(before.slice(1));
  });

  it('spends no state colour on a category', () => {
    // A mission's colour identifies it; it must never read as a verdict about it.
    for (const tone of MISSION_TONES) {
      expect(tone, tone).not.toContain('rose');
      expect(tone, tone).not.toContain('emerald');
      expect(tone, tone).not.toContain('brand');
    }
  });

  it('keeps text readable in both themes — a light fill with dark text, inverted for dark', () => {
    for (const tone of [...MISSION_TONES, ...Object.values(COUNTER_TONES)]) {
      expect(tone, tone).toMatch(/bg-[a-z]+-100/);
      expect(tone, tone).toMatch(/text-[a-z]+-(800|900)/);
      expect(tone, tone).toMatch(/dark:bg-[a-z]+-900\/40/);
      expect(tone, tone).toMatch(/dark:text-[a-z]+-100/);
    }
  });
});

/**
 * «يعمل الbackground للصف او العربيه اللى حصل عليها تغيير ولسه معملش حفظ، لما يعمل حفظ اللون
 * يتشال عشان ممكن يعمل تعديل ويخودش باله هو عدل ايه».
 *
 * The colour itself is asserted here because BOTH boards paint with it, and two screens showing
 * one state in two colours is the thing this constant exists to prevent.
 */
describe('UNSAVED_ROW — the colour of a car edited and not yet saved', () => {
  it('is amber, the hue both boards already spend on unsaved work', () => {
    expect(UNSAVED_ROW).toContain('bg-amber-50');
    expect(UNSAVED_ROW).toContain('dark:bg-amber-950/40');
  });

  it('takes neither of the two meanings these boards already colour', () => {
    // Rose is «this car is in the workshop today» on the daily board; emerald is «crewed».
    expect(UNSAVED_ROW, 'not the workshop tint').not.toContain('rose');
    expect(UNSAVED_ROW, 'not the crewed tint').not.toContain('emerald');
    expect(UNSAVED_ROW, 'not the pool tint').not.toContain('green');
  });

  it('answers both themes, and says so in text as well as background', () => {
    // A row tint that only defines a background hands the theme's own text colour a surface it
    // was not chosen against — which is how a tinted row ends up unreadable in one of the two.
    for (const piece of ['bg-amber-50', 'text-amber-950', 'dark:bg-amber-950/40', 'dark:text-amber-50']) {
      expect(UNSAVED_ROW, piece).toContain(piece);
    }
  });

  it('keeps a hover state, so a tinted row still behaves like a row', () => {
    expect(UNSAVED_ROW).toContain('hover:bg-amber-100/70');
    expect(UNSAVED_ROW).toContain('dark:hover:bg-amber-950/60');
  });
});

// ── the STANDING board ─────────────────────────────────────────────────────
//
// «عاوز الطاقم الثابت الفلاتر بتاعته تكون زى تعيين السيارات». The same rule, on this board's
// two states. What is pinned here is what those states MEAN: a crew is somebody in a seat, and
// a mission with nobody on it is not one.

const crew = (over: Partial<FleetFixedCrewRowDto> = {}): FleetFixedCrewRowDto => {
  const code = over.code ?? '150';
  return {
    vehicleId: 'v1',
    typeId: 't1',
    inMaintenance: false,
    missionTypeId: null,
    driver1EmployeeId: null,
    driver2EmployeeId: null,
    notes: null,
    ...over,
    code,
    plateNumber: over.plateNumber ?? `س ص ${code}`,
  };
};

const fixedCodes = (rows: readonly FleetFixedCrewRowDto[]): string[] => rows.map((r) => r.code);

/** A standing board with one of each shape. */
const STANDING: FleetFixedCrewRowDto[] = [
  crew({ vehicleId: 'v1', code: '150', driver1EmployeeId: 'e1', missionTypeId: MISSION_A }), // crewed, A
  crew({ vehicleId: 'v2', code: '151' }), // nobody, nothing
  crew({ vehicleId: 'v3', code: '152', missionTypeId: MISSION_A }), // mission A, nobody on it
  crew({ vehicleId: 'v4', code: '153', driver2EmployeeId: 'e2' }), // second seat only
  crew({ vehicleId: 'v5', code: '154', inMaintenance: true, driver1EmployeeId: 'e3' }), // workshop, crewed
  crew({ vehicleId: 'v6', code: '155', missionTypeId: MISSION_B, driver1EmployeeId: 'e4' }), // crewed, B
];

describe('hasDriver reads a STANDING row too', () => {
  it('is the same predicate on both boards — either seat, and nothing else', () => {
    expect(hasDriver(crew({ driver1EmployeeId: 'e1' }))).toBe(true);
    expect(hasDriver(crew({ driver2EmployeeId: 'e2' }))).toBe(true);
    expect(hasDriver(crew({ missionTypeId: MISSION_A })), 'a mission is not a crew').toBe(false);
    expect(hasDriver(crew({ notes: 'ملاحظة' })), 'nor is a note').toBe(false);
  });
});

describe('the standing board, one filter at a time', () => {
  it('«إجمالي» — no filter shows the whole board', () => {
    expect(fixedCodes(visibleFixedRows(STANDING, {}))).toHaveLength(6);
  });

  it('«بطقم» — only the cars somebody is on, in either seat', () => {
    expect(fixedCodes(visibleFixedRows(STANDING, { view: 'crewed' }))).toEqual(['150', '153', '154', '155']);
  });

  it('«بدون طقم» — only the cars nobody is on, a mission notwithstanding', () => {
    expect(fixedCodes(visibleFixedRows(STANDING, { view: 'uncrewed' }))).toEqual(['151', '152']);
  });

  it('the two views are complementary — every car is in exactly one', () => {
    const crewed = fixedCodes(visibleFixedRows(STANDING, { view: 'crewed' }));
    const uncrewed = fixedCodes(visibleFixedRows(STANDING, { view: 'uncrewed' }));
    expect([...crewed, ...uncrewed].sort()).toEqual(fixedCodes(STANDING).sort());
  });

  it('a mission chip — only that mission, crewed or not', () => {
    expect(fixedCodes(visibleFixedRows(STANDING, { missions: [MISSION_A] }))).toEqual(['150', '152']);
  });

  it('the code search — through the shared code parser, so a list works', () => {
    expect(fixedCodes(visibleFixedRows(STANDING, { term: '152' }))).toEqual(['152']);
    expect(fixedCodes(visibleFixedRows(STANDING, { term: '150 - 151' }))).toEqual(['150', '151']);
  });

  it('«صيانة» narrows to the cars the workshop holds, WITHOUT taking their crew away', () => {
    // A REVERSAL, at the owner's word: «خلى الفلاتر بتاعت الطقم الثابت زى تعيين السيارات». This
    // axis was deliberately absent — the daily «صيانة» is a fact about a DAY and this board has
    // none — and what that missed is that the board draws the badge on every row it applies to.
    //
    // The two questions stay different, which is the whole of this test: 154 is in the workshop
    // AND crewed, so it answers both «صيانة» and «بطقم». On the daily board the workshop refuses
    // the assignment; here it only says where the car is.
    expect(fixedCodes(visibleFixedRows(STANDING, { view: 'workshop' }))).toEqual(['154']);
    expect(
      fixedCodes(visibleFixedRows(STANDING, { view: 'crewed' })),
      'and it is still a crewed car',
    ).toContain('154');
    expect(FIXED_ROSTER_VIEWS).toEqual(['workshop', 'crewed', 'uncrewed']);
  });
});

describe('the standing board’s filters combine with AND', () => {
  it('«بدون طقم» + a mission is their intersection', () => {
    expect(fixedCodes(visibleFixedRows(STANDING, { view: 'uncrewed', missions: [MISSION_A] }))).toEqual(['152']);
  });

  it('«بطقم» + a mission is their intersection too', () => {
    expect(fixedCodes(visibleFixedRows(STANDING, { view: 'crewed', missions: [MISSION_A] }))).toEqual(['150']);
  });

  it('a contradictory pair finds NOTHING rather than falling back to one of them', () => {
    // Mission B's only car is crewed.
    expect(fixedCodes(visibleFixedRows(STANDING, { view: 'uncrewed', missions: [MISSION_B] }))).toEqual([]);
  });

  it('the search narrows on top of both', () => {
    expect(fixedCodes(visibleFixedRows(STANDING, { view: 'crewed', missions: [MISSION_A], term: '150' }))).toEqual(['150']);
    expect(fixedCodes(visibleFixedRows(STANDING, { view: 'crewed', missions: [MISSION_A], term: '151' }))).toEqual([]);
  });

  it('leaves the board it was handed untouched', () => {
    const before = JSON.stringify(STANDING);
    visibleFixedRows(STANDING, { view: 'crewed', missions: [MISSION_A], term: '1' });
    expect(JSON.stringify(STANDING)).toBe(before);
  });
});

describe('readFixedView — the URL is user-writable', () => {
  it('accepts the two states this board knows', () => {
    expect(readFixedView('crewed')).toBe('crewed');
    expect(readFixedView('uncrewed')).toBe('uncrewed');
  });

  it('answers null for anything else — including the daily board’s «تشغيل»', () => {
    // A link copied from the daily board must not empty the standing one. «صيانة» is now a state
    // BOTH boards have, so it is no longer in this list; «تشغيل» — a mission OR a driver — is
    // still the daily board's alone, because a mission with nobody on it is not a crew.
    for (const raw of [null, '', 'nonsense', 'total', 'CREWED', 'assigned']) {
      expect(readFixedView(raw), String(raw)).toBeNull();
    }
    expect(fixedCodes(visibleFixedRows(STANDING, { view: readFixedView('assigned') }))).toHaveLength(
      6,
    );
    expect(readFixedView('workshop'), 'and the one they share is read').toBe('workshop');
  });
});
