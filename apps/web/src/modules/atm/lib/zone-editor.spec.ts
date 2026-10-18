// The zone editor's state machine (spec §8.6, §9.4): every transition, the history (one step per
// finished gesture, at most 100), shared vertices and edges, the mockup's dirty count, and the save
// body — checked against the contracts' own schema, so what the editor sends is what the api takes.
import { describe, expect, it } from 'vitest';
import {
  SaveAtmMapZoneSetSchema,
  type AtmMapLatLng,
  type AtmMapZoneDto,
  type AtmMapZoneSetDto,
} from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import {
  NOTICE_KEYS,
  ZONE_EDITOR_HISTORY_MAX,
  buildZoneSetSave,
  dirtyCount,
  draftOf,
  duplicateNames,
  initialZoneEditorState,
  isTempId,
  newTempId,
  nextDefaultName,
  saveBodyBytes,
  zoneEditorReducer,
  type DraftZone,
  type ZoneEditorAction,
  type ZoneEditorState,
} from './zone-editor';

const BRANCH = '6650a1b2c3d4e5f600000001';
const A = '6650a1b2c3d4e5f60000000a';
const B = '6650a1b2c3d4e5f60000000b';
const C = '6650a1b2c3d4e5f60000000c';

/** A square of side `size`° with its south-west corner at (lat, lng). */
const square = (lat: number, lng: number, size: number): AtmMapLatLng[] => [
  { lat, lng },
  { lat, lng: lng + size },
  { lat: lat + size, lng: lng + size },
  { lat: lat + size, lng },
];

const zone = (id: string, name: string, order: number, points: AtmMapLatLng[]): AtmMapZoneDto => ({
  id,
  branchId: BRANCH,
  name,
  color: '#483bba',
  order,
  points,
  updatedAt: '2026-10-18T00:00:00.000Z',
});

/** A and B share their border: A's east edge is B's west edge (written the other way round). */
const SET: AtmMapZoneSetDto = {
  branchId: BRANCH,
  revision: 3,
  zones: [
    zone(B, 'قطاع ب', 1, [
      { lat: 30.01, lng: 31.01 },
      { lat: 30, lng: 31.01 },
      { lat: 30, lng: 31.02 },
      { lat: 30.01, lng: 31.02 },
    ]),
    zone(A, 'قطاع أ', 0, square(30, 31, 0.01)),
    zone(C, 'قطاع ج', 2, square(30.1, 31.1, 0.01)),
  ],
};

const run = (state: ZoneEditorState, ...actions: ZoneEditorAction[]): ZoneEditorState =>
  actions.reduce(zoneEditorReducer, state);

const editing = (set: AtmMapZoneSetDto = SET): ZoneEditorState =>
  run(initialZoneEditorState, { type: 'ENTER_EDIT', set });

const zoneOf = (state: ZoneEditorState, id: string): DraftZone => {
  const found = state.draft.find((z) => z.id === id);
  if (found === undefined) throw new Error(`no zone ${id}`);
  return found;
};

const formatAr = (n: number): string => translate('ar', 'atm.map.edit.defaultName', { n });

/** A triangle of about 0.5 km² near (30.2, 31.2), drawn dot by dot. */
const drawTriangle = (state: ZoneEditorState): ZoneEditorState =>
  run(
    state,
    { type: 'START_DRAW', color: '#D3A813' },
    { type: 'ADD_POINT', point: { lat: 30.2, lng: 31.2 } },
    { type: 'ADD_POINT', point: { lat: 30.2, lng: 31.21 } },
    { type: 'ADD_POINT', point: { lat: 30.21, lng: 31.2 } },
  );

describe('entering and leaving', () => {
  it('ENTER_EDIT loads the set in list order as the base, with an empty history', () => {
    const state = editing();
    expect(state.mode).toBe('edit');
    expect(state.branchId).toBe(BRANCH);
    expect(state.base).toBe(SET);
    expect(state.draft.map((z) => z.id)).toEqual([A, B, C]);
    expect(state.past).toEqual([]);
    expect(dirtyCount(state.base, state.draft)).toBe(0);
  });

  it('ENTER_EDIT can open with a zone selected (ZoneDetail «تعديل»), never an unknown one', () => {
    expect(
      run(initialZoneEditorState, { type: 'ENTER_EDIT', set: SET, selectZoneId: B }).selectedZoneId,
    ).toBe(B);
    expect(
      run(initialZoneEditorState, { type: 'ENTER_EDIT', set: SET, selectZoneId: 'nope' })
        .selectedZoneId,
    ).toBeNull();
  });

  it('RESTORE_DRAFT replaces the draft as one undoable step', () => {
    const restored = draftOf(SET).slice(0, 2);
    const state = run(editing(), { type: 'RESTORE_DRAFT', zones: restored });
    expect(state.draft.map((z) => z.id)).toEqual([A, B]);
    expect(run(state, { type: 'UNDO' }).draft.map((z) => z.id)).toEqual([A, B, C]);
  });

  it('EXIT_EDIT returns to view and keeps nothing', () => {
    const state = run(
      editing(),
      { type: 'RENAME', zoneId: A, name: 'شمال' },
      { type: 'EXIT_EDIT' },
    );
    expect(state.mode).toBe('view');
    expect(state.draft).toEqual([]);
    expect(state.base).toBeNull();
  });

  it('DISCARD resets to the base (or the refetched set) and clears the history', () => {
    const changed = run(editing(), { type: 'RENAME', zoneId: A, name: 'شمال' });
    const discarded = run(changed, { type: 'DISCARD' });
    expect(zoneOf(discarded, A).name).toBe('قطاع أ');
    expect(discarded.past).toEqual([]);
    const newer: AtmMapZoneSetDto = { ...SET, revision: 4, zones: SET.zones.slice(0, 1) };
    const refetched = run(changed, { type: 'DISCARD', set: newer });
    expect(refetched.base).toBe(newer);
    expect(refetched.draft.map((z) => z.id)).toEqual([B]);
  });
});

describe('drawing a zone', () => {
  it('START_DRAW goes to draw mode with the suggested colour preselected', () => {
    const state = run(editing(), { type: 'START_DRAW', color: '#D3A813' });
    expect(state.mode).toBe('draw');
    expect(state.drawing).toEqual({ points: [], color: '#d3a813' });
  });

  it('ADD_POINT refuses a crossing edge with the crossing notice, and keeps the dots', () => {
    const state = run(
      editing(),
      { type: 'START_DRAW', color: '#d3a813' },
      { type: 'ADD_POINT', point: { lat: 30.2, lng: 31.2 } },
      { type: 'ADD_POINT', point: { lat: 30.21, lng: 31.21 } },
      { type: 'ADD_POINT', point: { lat: 30.2, lng: 31.21 } },
      { type: 'ADD_POINT', point: { lat: 30.21, lng: 31.2 } },
    );
    expect(state.drawing?.points).toHaveLength(3);
    expect(state.notice?.key).toBe(NOTICE_KEYS.crossing);
  });

  it('the second dot of a double-click (within 4 px) is dropped', () => {
    const state = run(
      editing(),
      { type: 'START_DRAW', color: '#d3a813' },
      { type: 'ADD_POINT', point: { lat: 30.2, lng: 31.2 } },
      { type: 'ADD_POINT', point: { lat: 30.2, lng: 31.200001 }, pxFromLast: 2 },
    );
    expect(state.drawing?.points).toHaveLength(1);
  });

  it('UNDO_POINT removes the last dot', () => {
    const state = run(drawTriangle(editing()), { type: 'UNDO_POINT' });
    expect(state.drawing?.points).toHaveLength(2);
  });

  it('FINISH_DRAW is refused below three points', () => {
    const state = run(
      editing(),
      { type: 'START_DRAW', color: '#d3a813' },
      { type: 'ADD_POINT', point: { lat: 30.2, lng: 31.2 } },
      { type: 'ADD_POINT', point: { lat: 30.2, lng: 31.21 } },
      { type: 'FINISH_DRAW', tempId: 'new-1', formatName: formatAr },
    );
    expect(state.mode).toBe('draw');
    expect(state.draft).toHaveLength(3);
  });

  it('FINISH_DRAW is refused for a zone under 100 m², with the tooSmall notice', () => {
    const state = run(
      editing(),
      { type: 'START_DRAW', color: '#d3a813' },
      { type: 'ADD_POINT', point: { lat: 30.2, lng: 31.2 } },
      { type: 'ADD_POINT', point: { lat: 30.2, lng: 31.20005 } },
      { type: 'ADD_POINT', point: { lat: 30.20005, lng: 31.2 } },
      { type: 'FINISH_DRAW', tempId: 'new-1', formatName: formatAr },
    );
    expect(state.mode).toBe('draw');
    expect(state.notice?.key).toBe(NOTICE_KEYS.tooSmall);
  });

  it('FINISH_DRAW appends the zone at the bottom, named «قطاع n», selected, as one step', () => {
    const state = run(drawTriangle(editing()), {
      type: 'FINISH_DRAW',
      tempId: 'new-abc',
      formatName: formatAr,
    });
    expect(state.mode).toBe('edit');
    expect(state.draft.map((z) => z.id)).toEqual([A, B, C, 'new-abc']);
    expect(zoneOf(state, 'new-abc')).toMatchObject({ name: 'قطاع 1', color: '#d3a813' });
    expect(state.selectedZoneId).toBe('new-abc');
    expect(state.past).toHaveLength(1);
    expect(state.notice?.key).toBe(NOTICE_KEYS.added);
  });

  it('CANCEL_DRAW with three dots says «أُلغي الشكل.»; with fewer it is silent', () => {
    const withShape = run(drawTriangle(editing()), { type: 'CANCEL_DRAW' });
    expect(withShape.mode).toBe('edit');
    expect(withShape.notice?.key).toBe(NOTICE_KEYS.cancelled);
    const without = run(
      editing(),
      { type: 'START_DRAW', color: '#d3a813' },
      { type: 'ADD_POINT', point: { lat: 30.2, lng: 31.2 } },
      { type: 'CANCEL_DRAW' },
    );
    expect(without.mode).toBe('edit');
    expect(without.notice).toBeNull();
  });
});

describe('the list while drawing', () => {
  it('order buttons, undo and redo still act on the draft, and the shape stays', () => {
    const drawing = drawTriangle(run(editing(), { type: 'RENAME', zoneId: A, name: 'شمال' }));
    const moved = run(drawing, { type: 'MOVE_DOWN', zoneId: A });
    expect(moved.mode).toBe('draw');
    expect(moved.draft.map((z) => z.id)).toEqual([B, A, C]);
    expect(moved.drawing?.points).toHaveLength(3);
    const undone = run(moved, { type: 'UNDO' }, { type: 'UNDO' });
    expect(zoneOf(undone, A).name).toBe('قطاع أ');
    expect(undone.drawing?.points).toHaveLength(3);
  });

  it('a row click leaves the drawing under CANCEL_DRAW’s rule and selects the zone', () => {
    const state = run(drawTriangle(editing()), { type: 'SELECT_ZONE', zoneId: B });
    expect(state.mode).toBe('edit');
    expect(state.drawing).toBeNull();
    expect(state.selectedZoneId).toBe(B);
    expect(state.notice?.key).toBe(NOTICE_KEYS.cancelled);
  });

  it('a save that lands while drawing keeps the shape being drawn', () => {
    const drawing = drawTriangle(run(editing(), { type: 'RENAME', zoneId: A, name: 'شمال' }));
    const state = run(drawing, { type: 'SAVED', set: { ...SET, revision: 4 } });
    expect(state.mode).toBe('draw');
    expect(state.drawing?.points).toHaveLength(3);
    expect(state.past).toEqual([]);
  });
});

describe('editing vertices', () => {
  /** A's north-east corner, shared with B. */
  const SHARED = { zoneId: A, index: 2 };

  it('SELECT_ZONE and SELECT_VERTEX select, and clear each other as they should', () => {
    let state = run(editing(), { type: 'SELECT_VERTEX', vertex: SHARED });
    expect(state.selectedZoneId).toBe(A);
    expect(state.selectedVertex).toEqual(SHARED);
    state = run(state, { type: 'SELECT_ZONE', zoneId: B });
    expect(state.selectedZoneId).toBe(B);
    expect(state.selectedVertex).toBeNull();
  });

  it('a shared-vertex drag moves both zones; with Alt it moves one', () => {
    const to = { lat: 30.012, lng: 31.011 };
    const linked = run(
      editing(),
      { type: 'MOVE_VERTEX', ...SHARED, point: { lat: 30.011, lng: 31.0105 }, unlink: false },
      { type: 'MOVE_VERTEX', ...SHARED, point: to, unlink: false },
      { type: 'END_GESTURE' },
    );
    expect(zoneOf(linked, A).points[2]).toEqual(to);
    expect(zoneOf(linked, B).points[0]).toEqual(to);
    expect(linked.past).toHaveLength(1);

    const alone = run(
      editing(),
      { type: 'MOVE_VERTEX', ...SHARED, point: to, unlink: true },
      { type: 'END_GESTURE' },
    );
    expect(zoneOf(alone, A).points[2]).toEqual(to);
    expect(zoneOf(alone, B).points[0]).toEqual({ lat: 30.01, lng: 31.01 });
  });

  it('a snap during a drag changes no other zone', () => {
    // A's south-west corner dragged onto C's corner: C is not touched.
    const before = zoneOf(editing(), C);
    const target = before.points[0] as AtmMapLatLng;
    const state = run(
      editing(),
      { type: 'MOVE_VERTEX', zoneId: A, index: 0, point: target, unlink: false },
      { type: 'END_GESTURE' },
    );
    expect(zoneOf(state, C)).toEqual(before);
    expect(zoneOf(state, B)).toEqual(zoneOf(editing(), B));
  });

  it('a drag that makes a zone cross itself is put back, with the crossing notice', () => {
    const state = run(
      editing(),
      {
        type: 'MOVE_VERTEX',
        zoneId: A,
        index: 0,
        point: { lat: 30.02, lng: 31.005 },
        unlink: true,
      },
      { type: 'END_GESTURE' },
    );
    expect(zoneOf(state, A).points).toEqual(square(30, 31, 0.01));
    expect(state.past).toEqual([]);
    expect(state.notice?.key).toBe(NOTICE_KEYS.crossing);
  });

  it('INSERT_VERTEX on a shared edge inserts into both zones in one step, and they move linked', () => {
    // A's east edge (index 1: (30, 31.01) → (30.01, 31.01)) is B's edge 0.
    const mid = { lat: 30.005, lng: 31.01 };
    const dragged = { lat: 30.005, lng: 31.012 };
    const state = run(
      editing(),
      { type: 'INSERT_VERTEX', zoneId: A, edgeIndex: 1, point: mid },
      { type: 'MOVE_VERTEX', zoneId: A, index: 2, point: dragged, unlink: false },
      { type: 'END_GESTURE' },
    );
    expect(zoneOf(state, A).points).toHaveLength(5);
    expect(zoneOf(state, B).points).toHaveLength(5);
    expect(zoneOf(state, A).points[2]).toEqual(dragged);
    expect(zoneOf(state, B).points[1]).toEqual(dragged);
    expect(state.past).toHaveLength(1);
    expect(run(state, { type: 'UNDO' }).draft).toEqual(editing().draft);
  });

  it('DELETE_VERTEX (and a double-click on a vertex) deletes it, but never below three points', () => {
    const state = run(editing(), { type: 'DELETE_VERTEX', vertex: { zoneId: A, index: 1 } });
    expect(zoneOf(state, A).points).toHaveLength(3);
    const again = run(state, { type: 'DELETE_VERTEX', vertex: { zoneId: A, index: 0 } });
    expect(zoneOf(again, A).points).toHaveLength(3);
    expect(again).toBe(state);
  });

  it('DELETE_VERTEX without a vertex deletes the selected one', () => {
    const state = run(
      editing(),
      { type: 'SELECT_VERTEX', vertex: { zoneId: A, index: 3 } },
      { type: 'DELETE_VERTEX' },
    );
    expect(zoneOf(state, A).points).toEqual(square(30, 31, 0.01).slice(0, 3));
    expect(state.selectedVertex).toBeNull();
  });
});

describe('zones', () => {
  it('RENAME and RECOLOR are one step each; a no-op or an empty name records nothing', () => {
    const renamed = run(editing(), { type: 'RENAME', zoneId: A, name: '  شمال  ' });
    expect(zoneOf(renamed, A).name).toBe('شمال');
    expect(renamed.past).toHaveLength(1);
    expect(run(renamed, { type: 'RENAME', zoneId: A, name: 'شمال' })).toBe(renamed);
    expect(run(renamed, { type: 'RENAME', zoneId: A, name: '   ' })).toBe(renamed);
    const recoloured = run(renamed, { type: 'RECOLOR', zoneId: A, color: '#5BC4A3' });
    expect(zoneOf(recoloured, A).color).toBe('#5bc4a3');
    expect(recoloured.past).toHaveLength(2);
  });

  it('MOVE_UP and MOVE_DOWN swap neighbours and stop at the ends', () => {
    const up = run(editing(), { type: 'MOVE_UP', zoneId: B });
    expect(up.draft.map((z) => z.id)).toEqual([B, A, C]);
    expect(run(up, { type: 'MOVE_UP', zoneId: B })).toBe(up);
    const down = run(editing(), { type: 'MOVE_DOWN', zoneId: B });
    expect(down.draft.map((z) => z.id)).toEqual([A, C, B]);
    expect(run(down, { type: 'MOVE_DOWN', zoneId: B })).toBe(down);
  });

  it('SORT_AZ puts «قطاع 2» before «قطاع 10» — whatever the UI locale — and keeps ties in order', () => {
    for (const locale of ['ar', 'en'] as const) {
      const name = (n: number) => translate(locale, 'atm.map.edit.defaultName', { n });
      // Two ties under the collator's base sensitivity, each in the opposite case order.
      const names = [name(10), 'same', name(2), 'Same', 'Other', 'other'];
      const set: AtmMapZoneSetDto = {
        ...SET,
        zones: names.map((n, i) =>
          zone(`6650a1b2c3d4e5f6000000${String(10 + i)}`, n, i, square(30 + i, 31, 0.01)),
        ),
      };
      const sorted = run(editing(set), { type: 'SORT_AZ' }).draft.map((z) => z.name);
      expect(sorted.indexOf(name(2))).toBeLessThan(sorted.indexOf(name(10)));
      expect(sorted.indexOf('same')).toBe(sorted.indexOf('Same') - 1);
      expect(sorted.indexOf('Other')).toBe(sorted.indexOf('other') - 1);
    }
  });

  it('DELETE_ZONE removes it and selects the first remaining zone, as the mockup does', () => {
    const state = run(
      editing(),
      { type: 'SELECT_ZONE', zoneId: A },
      { type: 'DELETE_ZONE', zoneId: A },
    );
    expect(state.draft.map((z) => z.id)).toEqual([B, C]);
    expect(state.selectedZoneId).toBe(B);
    expect(run(editing(), { type: 'DELETE_ZONE', zoneId: C }).selectedZoneId).toBeNull();
  });
});

describe('history', () => {
  it('UNDO and REDO walk the steps', () => {
    const state = run(
      editing(),
      { type: 'RENAME', zoneId: A, name: 'one' },
      { type: 'RENAME', zoneId: A, name: 'two' },
    );
    const undone = run(state, { type: 'UNDO' });
    expect(zoneOf(undone, A).name).toBe('one');
    expect(zoneOf(run(undone, { type: 'REDO' }), A).name).toBe('two');
    // A new step after an undo drops the redo stack.
    expect(
      run(undone, { type: 'RENAME', zoneId: A, name: 'three' }, { type: 'REDO' }).future,
    ).toEqual([]);
  });

  it(`undo/redo across 101 gestures keeps ${String(ZONE_EDITOR_HISTORY_MAX)}`, () => {
    let state = editing();
    for (let i = 1; i <= 101; i += 1) {
      state = run(state, { type: 'RENAME', zoneId: A, name: `name ${String(i)}` });
    }
    expect(state.past).toHaveLength(100);
    for (let i = 0; i < 150; i += 1) state = run(state, { type: 'UNDO' });
    // The oldest step (the base name) fell off; the earliest reachable name is the first rename.
    expect(zoneOf(state, A).name).toBe('name 1');
    expect(state.future).toHaveLength(100);
    for (let i = 0; i < 150; i += 1) state = run(state, { type: 'REDO' });
    expect(zoneOf(state, A).name).toBe('name 101');
  });

  it('SAVED takes the saved set as the base, clears the history, and stays in edit mode', () => {
    const drawn = run(drawTriangle(editing()), {
      type: 'FINISH_DRAW',
      tempId: 'new-abc',
      formatName: formatAr,
    });
    const savedId = '6650a1b2c3d4e5f6000000dd';
    const saved: AtmMapZoneSetDto = {
      branchId: BRANCH,
      revision: 4,
      zones: [...SET.zones, zone(savedId, 'قطاع 1', 3, zoneOf(drawn, 'new-abc').points)],
    };
    const state = run(drawn, { type: 'SAVED', set: saved });
    expect(state.mode).toBe('edit');
    expect(state.base).toBe(saved);
    expect(state.past).toEqual([]);
    expect(state.future).toEqual([]);
    expect(state.selectedZoneId).toBe(savedId);
    expect(state.notice?.key).toBe(NOTICE_KEYS.saved);
    expect(dirtyCount(state.base, state.draft)).toBe(0);
  });

  it('CONFLICT keeps the draft and marks the conflict; CLOSE_CONFLICT closes it', () => {
    const changed = run(editing(), { type: 'RENAME', zoneId: A, name: 'شمال' });
    const conflict = run(changed, { type: 'CONFLICT' });
    expect(conflict.conflict).toBe(true);
    expect(conflict.draft).toEqual(changed.draft);
    expect(conflict.past).toEqual(changed.past);
    expect(run(conflict, { type: 'CLOSE_CONFLICT' }).conflict).toBe(false);
  });
});

describe('the save path', () => {
  it('buildZoneSetSave sends only changed fields, tempIds for new zones, deletes, and the order', () => {
    const drawn = run(
      drawTriangle(editing()),
      { type: 'FINISH_DRAW', tempId: 'new-abc', formatName: formatAr },
      { type: 'RENAME', zoneId: A, name: 'شمال' },
      { type: 'DELETE_ZONE', zoneId: C },
    );
    const body = buildZoneSetSave(SET, drawn.draft);
    expect(body).toEqual({
      branchId: BRANCH,
      revision: 3,
      creates: [
        {
          tempId: 'new-abc',
          name: 'قطاع 1',
          color: '#d3a813',
          points: zoneOf(drawn, 'new-abc').points,
        },
      ],
      updates: [{ id: A, name: 'شمال' }],
      deletes: [C],
      order: [A, B, 'new-abc'],
    });
    expect(SaveAtmMapZoneSetSchema.safeParse(body).success).toBe(true);
  });

  it('a reorder alone produces just the order', () => {
    const state = run(editing(), { type: 'MOVE_DOWN', zoneId: A });
    const body = buildZoneSetSave(SET, state.draft);
    expect(body.creates).toEqual([]);
    expect(body.updates).toEqual([]);
    expect(body.deletes).toEqual([]);
    expect(body.order).toEqual([B, A, C]);
    expect(SaveAtmMapZoneSetSchema.safeParse(body).success).toBe(true);
  });

  it('a moved vertex sends that zone’s points and nothing else of it', () => {
    const state = run(
      editing(),
      {
        type: 'MOVE_VERTEX',
        zoneId: C,
        index: 0,
        point: { lat: 30.099, lng: 31.099 },
        unlink: true,
      },
      { type: 'END_GESTURE' },
    );
    expect(buildZoneSetSave(SET, state.draft).updates).toEqual([
      { id: C, points: zoneOf(state, C).points },
    ]);
  });

  it('dirtyCount follows the mockup: Sort A–Z on 12 zones is 1; a rename and a reorder is 1', () => {
    const twelve: AtmMapZoneSetDto = {
      ...SET,
      zones: Array.from({ length: 12 }, (_, i) =>
        zone(
          `6650a1b2c3d4e5f6000001${String(i).padStart(2, '0')}`,
          `قطاع ${String(12 - i)}`,
          i,
          square(30 + i, 31, 0.01),
        ),
      ),
    };
    const sorted = run(editing(twelve), { type: 'SORT_AZ' });
    expect(sorted.draft[0]?.name).toBe('قطاع 1');
    expect(dirtyCount(twelve, sorted.draft)).toBe(1);

    const renamedAndMoved = run(
      editing(),
      { type: 'RENAME', zoneId: C, name: 'جنوب' },
      { type: 'MOVE_UP', zoneId: B },
    );
    expect(dirtyCount(SET, renamedAndMoved.draft)).toBe(1);
    // A create and a delete count once each.
    const createdAndDeleted = run(
      drawTriangle(editing()),
      { type: 'FINISH_DRAW', tempId: 'new-x', formatName: formatAr },
      { type: 'DELETE_ZONE', zoneId: C },
    );
    expect(dirtyCount(SET, createdAndDeleted.draft)).toBe(2);
  });

  it('nextDefaultName takes the smallest unused n (DM-22)', () => {
    const draft = [{ name: 'قطاع 1' }, { name: ' قطاع  3 ' }];
    expect(nextDefaultName(draft, formatAr)).toBe('قطاع 2');
    expect(nextDefaultName([], formatAr)).toBe('قطاع 1');
    expect(
      nextDefaultName([{ name: 'ZONE 1' }], (n) =>
        translate('en', 'atm.map.edit.defaultName', { n }),
      ),
    ).toBe('Zone 2');
  });

  it('duplicateNames compares after trimming, collapsing spaces and case-folding (DM-8)', () => {
    const draft: DraftZone[] = [
      { id: A, name: '  قطاع  أ ', color: '#483bba', points: [] },
      { id: B, name: 'قطاع أ', color: '#483bba', points: [] },
      { id: C, name: 'North', color: '#483bba', points: [] },
      { id: 'new-1', name: 'north ', color: '#483bba', points: [] },
      { id: 'new-2', name: 'South', color: '#483bba', points: [] },
    ];
    expect(duplicateNames(draft)).toEqual([A, B, C, 'new-1']);
  });

  it('saveBodyBytes measures the body as sent; newTempId fits the schema and is unused', () => {
    const body = buildZoneSetSave(SET, editing().draft);
    expect(saveBodyBytes(body)).toBe(new TextEncoder().encode(JSON.stringify(body)).length);
    const draft = [{ id: 'new-0', name: 'x', color: '#483bba', points: [] }];
    const ids = [0, 0.5];
    const id = newTempId(draft, () => ids.shift() ?? 0.25);
    expect(id).not.toBe('new-0');
    expect(isTempId(id)).toBe(true);
  });
});
