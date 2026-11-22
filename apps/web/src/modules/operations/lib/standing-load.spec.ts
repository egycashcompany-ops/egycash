// The toggle that loads the standing crew onto the day's board.
//
// Off by default, on fills the EMPTY vehicles, off again clears exactly what it filled. Each of
// those is a claim about what the operator's own work survives, so each is pinned here.
//
// Round 28b — «اه»: a vehicle it fills takes its standing «الاتجاه» too, where the day's row has
// none, and never one the day's save would refuse. Never the time.
import { describe, expect, it } from 'vitest';
import {
  CREW_SLOT_CAPACITY,
  OPERATIONS_DIRECTION_MAX_LENGTH,
  canonicalOperationsDirection,
  normalizeOperationsDirection,
  operationsDirectionNamesSomething,
} from '@ecms/contracts';
import { SLOT_POSITIONS, rowCrew, slotOccupants, type BoardRow, type SlotCells } from './crew-board';
import {
  clearStandingCrew,
  loadStandingCrew,
  standingDirectionForDay,
  type StandingCrewSource,
} from './standing-load';

const cells = (...ids: (string | null)[]): SlotCells =>
  SLOT_POSITIONS.map((position) => ids[position] ?? null);

const row = (vehicleId: string, over: Partial<BoardRow> = {}): BoardRow => ({
  vehicleId,
  vehicleCode: `C-${vehicleId}`,
  missionTypeId: null,
  captainEmployeeIds: cells(),
  specialist1EmployeeIds: cells(),
  specialist2EmployeeIds: cells(),
  direction: null,
  plannedTime: null,
  notes: null,
  ...over,
});

const standing = (
  vehicleId: string,
  captains: string[] = [],
  s1: string[] = [],
  s2: string[] = [],
  direction: string | null = null,
): StandingCrewSource => ({
  vehicleId,
  captainEmployeeIds: captains,
  specialist1EmployeeIds: s1,
  specialist2EmployeeIds: s2,
  direction,
});

/** The active areas of these specs — as the board reads them for the save's respelling. */
const AREAS = ['المعادي', 'حلوان', 'مدينة نصر', 'شبرا/الخيمة'];

describe('loadStandingCrew — switching the toggle on', () => {
  it('fills an empty vehicle from its standing crew', () => {
    const load = loadStandingCrew([row('v1')], [standing('v1', ['cap'], ['s1'], ['s2'])]);
    expect(slotOccupants(load.rows[0] as BoardRow, 'captain')).toEqual(['cap']);
    expect(slotOccupants(load.rows[0] as BoardRow, 'specialist1')).toEqual(['s1']);
    expect(slotOccupants(load.rows[0] as BoardRow, 'specialist2')).toEqual(['s2']);
    expect(load.filledVehicleIds).toEqual(['v1']);
  });

  it('carries a full six-person standing crew across', () => {
    const load = loadStandingCrew(
      [row('v1')],
      [standing('v1', ['c1', 'c2'], ['a1', 'a2'], ['b1', 'b2'])],
    );
    expect(rowCrew(load.rows[0] as BoardRow)).toEqual(['c1', 'c2', 'a1', 'a2', 'b1', 'b2']);
    expect((load.rows[0] as BoardRow).captainEmployeeIds).toHaveLength(CREW_SLOT_CAPACITY);
  });

  it('NEVER overwrites a vehicle that already carries somebody', () => {
    // The rule that makes the toggle safe to press: a crew saved this morning, or one just dragged
    // by hand, is somebody's decision and the toggle is not entitled to replace it.
    const board = [row('v1', { captainEmployeeIds: cells('mine') })];
    const load = loadStandingCrew(board, [standing('v1', ['standing'])]);
    expect(slotOccupants(load.rows[0] as BoardRow, 'captain')).toEqual(['mine']);
    expect(load.filledVehicleIds).toEqual([]);
  });

  it('does not place somebody who is already on the board elsewhere (Q11)', () => {
    // One person, one vehicle per operating day — the save would refuse a plan that broke it, so
    // the board must not offer one.
    const board = [row('v1', { captainEmployeeIds: cells('cap') }), row('v2')];
    const load = loadStandingCrew(board, [standing('v2', ['cap'], ['s1'])]);
    expect(slotOccupants(load.rows[1] as BoardRow, 'captain')).toEqual([]);
    expect(slotOccupants(load.rows[1] as BoardRow, 'specialist1')).toEqual(['s1']);
  });

  it('gives a contested person to the FIRST vehicle in board order, deterministically', () => {
    const load = loadStandingCrew(
      [row('v1'), row('v2')],
      [standing('v2', ['shared']), standing('v1', ['shared'])],
    );
    expect(slotOccupants(load.rows[0] as BoardRow, 'captain')).toEqual(['shared']);
    expect(slotOccupants(load.rows[1] as BoardRow, 'captain')).toEqual([]);
    expect(load.filledVehicleIds).toEqual(['v1']);
  });

  it('leaves a standing crew whose vehicle is not on the board IN THE POOL, and says so', () => {
    // "لو فى طاقم على سيارة والسيارة مش متاحه سيب الطاقم بدون تحميله على سيارة" — the van is in the
    // yard today. Its people are not forced somewhere wrong, and not silently swallowed either.
    const load = loadStandingCrew([row('v1')], [standing('v9', ['cap'], ['s1'])]);
    expect(load.rows.map((r) => r.vehicleId)).toEqual(['v1']);
    expect(load.filledVehicleIds).toEqual([]);
    expect(load.unavailableVehicleIds).toEqual(['v9']);
  });

  it('does not report an EMPTY standing crew as stranded — it has nobody to strand', () => {
    expect(loadStandingCrew([row('v1')], [standing('v9')]).unavailableVehicleIds).toEqual([]);
  });

  it('leaves a board vehicle with no standing crew untouched', () => {
    const load = loadStandingCrew([row('v1'), row('v2')], [standing('v1', ['cap'])]);
    expect(rowCrew(load.rows[1] as BoardRow)).toEqual([]);
    expect(load.filledVehicleIds).toEqual(['v1']);
  });

  it('does not mutate the rows it was given', () => {
    const board = [row('v1')];
    loadStandingCrew(board, [standing('v1', ['cap'])]);
    expect(rowCrew(board[0] as BoardRow)).toEqual([]);
  });

  // Rewritten in Round 28b (was «keeps direction and plannedTime as the board had them», whose
  // standing row carried no direction and whose comment said «the toggle loads a CREW»): the load
  // now carries the direction too — but never over the day row's own, and never the time.
  it('keeps the day row’s own direction and time — a standing direction never overwrites one', () => {
    const board = [row('v1', { direction: 'بنها', plannedTime: '06:00' })];
    const load = loadStandingCrew(board, [standing('v1', ['cap'], [], [], 'حلوان')], AREAS);
    expect(load.filledVehicleIds).toEqual(['v1']);
    expect(load.rows[0]?.direction).toBe('بنها');
    expect(load.rows[0]?.plannedTime).toBe('06:00');
    expect(load.directionsPut).toEqual({});
  });
});

describe('Round 28b — «الاتجاه» comes down with the crew («اه»)', () => {
  it('copies the standing direction onto a vehicle it fills whose row has none', () => {
    const load = loadStandingCrew(
      [row('v1'), row('v2')],
      [standing('v1', ['cap'], ['s1'], [], 'حلوان'), standing('v2', ['c2'], [], [], 'طريق السويس')],
      AREAS,
    );
    expect(load.rows.map((r) => r.direction)).toEqual(['حلوان', 'طريق السويس']);
    expect(load.directionsPut).toEqual({ v1: 'حلوان', v2: 'طريق السويس' });
    // The direction only: the time, the notes stay the day's (asked about the direction alone).
    expect(load.rows.map((r) => [r.plannedTime, r.notes])).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it('copies nothing onto a vehicle it does not fill', () => {
    const board = [
      // Already crewed by hand — rule 1, so not filled, so not its direction either.
      row('v1', { captainEmployeeIds: cells('mine') }),
      // Its only standing member already sits on v1 — rule 2 leaves it empty, so not filled.
      row('v2'),
    ];
    const load = loadStandingCrew(
      board,
      [standing('v1', ['cap'], [], [], 'حلوان'), standing('v2', ['mine'], [], [], 'المعادي')],
      AREAS,
    );
    expect(load.filledVehicleIds).toEqual([]);
    expect(load.rows.map((r) => r.direction)).toEqual([null, null]);
    expect(load.directionsPut).toEqual({});
  });

  it('a standing row with no direction leaves the row’s direction empty', () => {
    const load = loadStandingCrew([row('v1')], [standing('v1', ['cap'])], AREAS);
    expect(load.filledVehicleIds).toEqual(['v1']);
    expect(load.rows[0]?.direction).toBeNull();
    expect(load.directionsPut).toEqual({});
  });

  it('never copies a direction the day’s save would refuse — the van is still filled', () => {
    // A legacy standing row may hold these (its own, kept there while sent unchanged); on the day's
    // row each would be NEW, and the save refuses it (400 on the row's `direction`).
    const longTyped = 'ط'.repeat(OPERATIONS_DIRECTION_MAX_LENGTH + 1);
    for (const refused of ['', '   ', '-', '\u200b', '!!!', longTyped]) {
      const load = loadStandingCrew([row('v1')], [standing('v1', ['cap'], [], [], refused)], AREAS);
      expect(load.filledVehicleIds, JSON.stringify(refused)).toEqual(['v1']);
      expect(load.rows[0]?.direction, JSON.stringify(refused)).toBeNull();
      expect(load.directionsPut, JSON.stringify(refused)).toEqual({});
    }
    // At the ceiling, hand-typed text is taken.
    const longest = 'ط'.repeat(OPERATIONS_DIRECTION_MAX_LENGTH);
    expect(
      loadStandingCrew([row('v1')], [standing('v1', ['cap'], [], [], longest)], AREAS).rows[0]
        ?.direction,
    ).toBe(longest);
  });

  it('writes it as the save would store it: tidied, and an area in the areas’ own spelling', () => {
    const load = loadStandingCrew(
      [row('v1'), row('v2'), row('v3'), row('v4')],
      [
        standing('v1', ['a'], [], [], '  طريق   السويس '),
        standing('v2', ['b'], [], [], 'المعادى'),
        standing('v3', ['c'], [], [], 'معادي/حلوان'),
        standing('v4', ['d'], [], [], 'شبرا الخيمة'),
      ],
      AREAS,
    );
    expect(load.rows.map((r) => r.direction)).toEqual([
      'طريق السويس',
      'المعادي',
      'المعادي - حلوان',
      'شبرا/الخيمة',
    ]);
  });

  it('a direction of areas past the hand-typed ceiling is copied — the save respells, never refuses it', () => {
    const many = Array.from({ length: 12 }, (_, i) => `منطقة ${i + 1}`);
    const stored = many.join(' - ');
    expect(stored.length).toBeGreaterThan(OPERATIONS_DIRECTION_MAX_LENGTH);
    const load = loadStandingCrew([row('v1')], [standing('v1', ['cap'], [], [], stored)], many);
    expect(load.rows[0]?.direction).toBe(stored);
    // The same text with the areas unknown is hand-typed past the ceiling: not copied.
    expect(
      loadStandingCrew([row('v1')], [standing('v1', ['cap'], [], [], stored)], []).rows[0]
        ?.direction,
    ).toBeNull();
  });

  // Round 28b critic — the save judges the text the load SENDS (the respelling), not the standing
  // row's. Split at «/», «شبرا/الخيمة - المعادي …» read again was no areas, so a respelling of eight
  // areas (91 characters) was hand-typed text past the ceiling: «حفظ» after the load was refused
  // whole (400 TOO_BIG), and a standing row already holding that respelling was left behind.
  describe('an area whose name holds a separator, inside a direction past the ceiling', () => {
    const EIGHT = [...AREAS, 'التجمع الخامس', 'مصر الجديدة', 'الدقي', 'المهندسين'];
    const NAMES = [
      'المعادي',
      'حلوان',
      'مدينة نصر',
      'التجمع الخامس',
      'مصر الجديدة',
      'الدقي',
      'المهندسين',
    ];
    const respelled = ['شبرا/الخيمة', ...NAMES].join(' - ');
    /** The day's save on a NEW direction (crew/crew-direction.ts): what it stores, or refused. */
    const daySave = (sent: string): string => {
      const typed = normalizeOperationsDirection(sent);
      if (!operationsDirectionNamesSomething(typed)) return 'TOO_SMALL';
      const canonical = canonicalOperationsDirection(typed, EIGHT);
      if ('direction' in canonical) return canonical.direction;
      return typed.length > OPERATIONS_DIRECTION_MAX_LENGTH ? 'TOO_BIG' : typed;
    };

    it('copies what the save takes — as typed on the standing row, or as it stores it there', () => {
      expect(respelled.length).toBeGreaterThan(OPERATIONS_DIRECTION_MAX_LENGTH);
      for (const held of [['شبرا الخيمة', ...NAMES].join(' - '), respelled]) {
        const load = loadStandingCrew([row('v1')], [standing('v1', ['cap'], [], [], held)], EIGHT);
        const written = load.rows[0]?.direction as string;
        expect(written, held).toBe(respelled);
        // «حفظ» sends exactly this, and the save stores it unchanged — never 400.
        expect(daySave(written), held).toBe(respelled);
        expect(load.directionsLeftBehind, held).toEqual([]);
      }
    });

    it('judges the text it writes: a respelling the save would not read as areas is not written', () => {
      // An area whose own name ends in « و»: its respelling, read again, splits at « و - ».
      const areas = ['زايد و', ...EIGHT];
      const held = ['زايد و', ...NAMES].join('، ');
      const respelling = canonicalOperationsDirection(held, areas);
      expect(respelling).toEqual({ direction: ['زايد و', ...NAMES].join(' - ') });
      expect(
        canonicalOperationsDirection((respelling as { direction: string }).direction, areas),
      ).not.toHaveProperty('direction');
      // The standing row's own text is, then: the save reads it as areas and respells it itself.
      expect(standingDirectionForDay(held, areas)).toBe(held);
      expect('direction' in canonicalOperationsDirection(held, areas)).toBe(true);
    });
  });

  it('names the vans it filled whose standing direction it left behind — and only those', () => {
    const longTyped = 'ط'.repeat(OPERATIONS_DIRECTION_MAX_LENGTH + 1);
    const many = Array.from({ length: 12 }, (_, i) => `منطقة ${i + 1}`).join(' - ');
    const board = [
      row('v1'), // a legacy hand-typed direction past the ceiling — left behind
      row('v2'), // «-» names nothing: no direction to leave behind
      row('v3', { direction: 'بنها' }), // the day's own is kept, nothing left behind
      row('v4', { captainEmployeeIds: cells('mine') }), // not filled
      row('v5'), // copied
      row('v6'), // twelve areas while the areas are unknown: judged hand-typed, left behind
    ];
    const sources = [
      standing('v1', ['a'], [], [], longTyped),
      standing('v2', ['b'], [], [], '-'),
      standing('v3', ['c'], [], [], longTyped),
      standing('v4', ['d'], [], [], longTyped),
      standing('v5', ['e'], [], [], 'حلوان'),
      standing('v6', ['f'], [], [], many),
    ];
    const load = loadStandingCrew(board, sources, AREAS);
    expect(load.filledVehicleIds).toEqual(['v1', 'v2', 'v3', 'v5', 'v6']);
    expect(load.directionsLeftBehind).toEqual(['v1', 'v6']);
    expect(load.directionsPut).toEqual({ v5: 'حلوان' });
  });

  it('`standingDirectionForDay` is the server’s rule (crew/crew-direction.ts) for a NEW direction', () => {
    expect(standingDirectionForDay(null, AREAS)).toBeNull();
    expect(standingDirectionForDay(undefined, AREAS)).toBeNull();
    expect(standingDirectionForDay('\u200f حلوان \u200e', AREAS)).toBe('حلوان');
    expect(standingDirectionForDay('نصر مدينة', AREAS)).toBe('نصر مدينة');
    expect(standingDirectionForDay('مدينة نصر', AREAS)).toBe('مدينة نصر');
    expect(standingDirectionForDay('حلوان - طريق الأوتوستراد', AREAS)).toBe(
      'حلوان - طريق الأوتوستراد',
    );
  });
});

describe('clearStandingCrew — switching the toggle off', () => {
  it('empties exactly the vehicles the load filled', () => {
    const load = loadStandingCrew([row('v1'), row('v2')], [standing('v1', ['cap'])]);
    const cleared = clearStandingCrew(load.rows, load.filledVehicleIds);
    expect(rowCrew(cleared[0] as BoardRow)).toEqual([]);
  });

  it('leaves a vehicle the toggle never touched alone', () => {
    const board = [row('v1', { captainEmployeeIds: cells('mine') }), row('v2')];
    const load = loadStandingCrew(board, [standing('v2', ['cap'])]);
    const cleared = clearStandingCrew(load.rows, load.filledVehicleIds);
    expect(slotOccupants(cleared[0] as BoardRow, 'captain')).toEqual(['mine']);
    expect(rowCrew(cleared[1] as BoardRow)).toEqual([]);
  });

  it('on → off returns the board to exactly where it started', () => {
    const board = [row('v1'), row('v2', { specialist1EmployeeIds: cells('kept') })];
    const load = loadStandingCrew(board, [standing('v1', ['cap'], ['s1'])]);
    expect(clearStandingCrew(load.rows, load.filledVehicleIds)).toEqual(board);
  });

  it('keeps direction and plannedTime when it clears a crew', () => {
    const board = [row('v1', { direction: 'الجيزة' })];
    const load = loadStandingCrew(board, [standing('v1', ['cap'])]);
    const cleared = clearStandingCrew(load.rows, load.filledVehicleIds);
    expect(cleared[0]?.direction).toBe('الجيزة');
  });

  it('Round 28b — clears the direction it wrote, and on → off is where it started', () => {
    const board = [row('v1'), row('v2', { direction: 'بنها' }), row('v3')];
    const load = loadStandingCrew(
      board,
      [
        standing('v1', ['a'], [], [], 'حلوان'),
        standing('v2', ['b'], [], [], 'المعادي'),
        standing('v3', [], [], [], 'مدينة نصر'),
      ],
      AREAS,
    );
    expect(load.rows.map((r) => r.direction)).toEqual(['حلوان', 'بنها', null]);
    const cleared = clearStandingCrew(load.rows, load.filledVehicleIds, load.directionsPut);
    expect(cleared).toEqual(board);
  });

  it('Round 28b — keeps a direction the planner changed after the load', () => {
    const load = loadStandingCrew(
      [row('v1'), row('v2')],
      [standing('v1', ['a'], [], [], 'حلوان'), standing('v2', ['b'], [], [], 'المعادي')],
      AREAS,
    );
    // He typed his own over van 1's, and cleared van 2's.
    const edited = load.rows.map((r) =>
      r.vehicleId === 'v1' ? { ...r, direction: 'طريق السويس' } : { ...r, direction: null },
    );
    const cleared = clearStandingCrew(edited, load.filledVehicleIds, load.directionsPut);
    expect(cleared.map((r) => r.direction)).toEqual(['طريق السويس', null]);
    expect(cleared.map(rowCrew)).toEqual([[], []]);
  });
});
