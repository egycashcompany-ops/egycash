// The zone editor's state machine (docs/12-planning/atm-map-zones.md §8.6) — a reducer with its own
// undo history, and the pure helpers the save path needs. No Leaflet and no DOM: the map canvas
// turns pointer events into the actions below (with the point already snapped, because snapping is
// measured in pixels), and the page shows the notices and dialogs.
//
// THE DRAFT IS THE WHOLE EDIT. One branch's zones are edited at a time (D-M6), all changes stay in
// the draft, and they are saved together under the revision the editor loaded (DM-7). `base` is
// that loaded set; everything the save sends, and the «تغييرات غير محفوظة: n» badge, is a
// comparison of the draft against it.
//
// ONE HISTORY STEP PER FINISHED GESTURE, at most 100. A drag moves points live without touching
// the history; its end (`END_GESTURE`) checks every zone it touched with the save's own geometry
// test and either records one step or puts the draft back and says why (`draw.crossing`,
// `draw.tooSmall`). A vertex delete is checked the same way. A midpoint drag inserts its vertex into
// every zone that shares the edge and moves them together, still one step.
//
// DRAWING IS STILL EDITING. While a shape is drawn the zone list stays on screen (§8.8 `EditPanel`),
// so its order buttons, undo and redo still act on the draft, and a row click leaves the drawing.
//
// NOTICES. What the user is told after an action — «أُلغي الشكل.», «لا يجوز أن تتقاطع…» — is state:
// `notice` carries the i18n key and a sequence number that changes every time, so the page shows
// one toast per notice and the reducer stays pure.
import {
  ATM_MAP_ZONE_MIN_POINTS,
  zoneGeometryIssues,
  type AtmMapLatLng,
  type AtmMapZoneSetDto,
  type SaveAtmMapZoneSet,
} from '@ecms/contracts';
import {
  coordKey,
  insertOnEdge,
  linkedVertices,
  round6,
  wouldCrossWhileDrawing,
  zonesWithEdge,
} from './map-geometry';

/** A zone in the draft: a real id, or a `new-…` temporary id until the save names it. */
export interface DraftZone {
  id: string;
  name: string;
  color: string;
  points: AtmMapLatLng[];
}

export type ZoneEditorMode = 'view' | 'edit' | 'draw';

export interface VertexRef {
  zoneId: string;
  index: number;
}

/** A message for the page to show once; `seq` changes on every notice, even a repeated one. */
export interface ZoneEditorNotice {
  key: string;
  seq: number;
}

export interface ZoneEditorState {
  mode: ZoneEditorMode;
  branchId: string | null;
  base: AtmMapZoneSetDto | null;
  /** Ordered: the first zone has the highest priority (D-M7). */
  draft: DraftZone[];
  selectedZoneId: string | null;
  selectedVertex: VertexRef | null;
  drawing: { points: AtmMapLatLng[]; color: string } | null;
  past: DraftZone[][];
  future: DraftZone[][];
  /** A drag in progress: the draft before it, and the vertices that move together. */
  gesture: { before: DraftZone[]; vertex: VertexRef; links: VertexRef[] } | null;
  /** A save answered 409 `ATM_MAP_ZONES_STALE`; the draft is kept (§8.6). */
  conflict: boolean;
  notice: ZoneEditorNotice | null;
}

export type ZoneEditorAction =
  | { type: 'ENTER_EDIT'; set: AtmMapZoneSetDto; selectZoneId?: string | null }
  | { type: 'RESTORE_DRAFT'; zones: readonly DraftZone[] }
  | { type: 'START_DRAW'; color: string }
  /** `pxFromLast`: how far, on screen, the dot is from the previous one (the double-click rule). */
  | { type: 'ADD_POINT'; point: AtmMapLatLng; pxFromLast?: number }
  | { type: 'UNDO_POINT' }
  /** `tempId` from `newTempId`; `formatName(n)` is the locale's «قطاع n» (`edit.defaultName`). */
  | { type: 'FINISH_DRAW'; tempId: string; formatName: (n: number) => string }
  | { type: 'CANCEL_DRAW' }
  | { type: 'SELECT_ZONE'; zoneId: string | null }
  | { type: 'SELECT_VERTEX'; vertex: VertexRef | null }
  /** `unlink`: Alt is held — move this vertex alone, not the zones that share it. */
  | { type: 'MOVE_VERTEX'; zoneId: string; index: number; point: AtmMapLatLng; unlink: boolean }
  | { type: 'INSERT_VERTEX'; zoneId: string; edgeIndex: number; point: AtmMapLatLng }
  | { type: 'END_GESTURE' }
  | { type: 'DELETE_VERTEX'; vertex?: VertexRef }
  | { type: 'RENAME'; zoneId: string; name: string }
  | { type: 'RECOLOR'; zoneId: string; color: string }
  | { type: 'MOVE_UP'; zoneId: string }
  | { type: 'MOVE_DOWN'; zoneId: string }
  | { type: 'SORT_AZ' }
  | { type: 'DELETE_ZONE'; zoneId: string }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  /** The refetched set, when the page has one; otherwise the loaded base is restored. */
  | { type: 'DISCARD'; set?: AtmMapZoneSetDto }
  | { type: 'EXIT_EDIT' }
  | { type: 'SAVED'; set: AtmMapZoneSetDto }
  | { type: 'CONFLICT' }
  | { type: 'CLOSE_CONFLICT' };

/** At most this many undo (and redo) steps are kept (§8.6). */
export const ZONE_EDITOR_HISTORY_MAX = 100;
/** The second dot of a double-click lands this close to the first; it is dropped (§8.6). */
export const DOUBLE_CLICK_DUPLICATE_PX = 4;
/** The web refuses a save whose body is larger than this (§6.6; the api's limit is 1 MB). */
export const SAVE_BODY_MAX_BYTES = 900 * 1024;

export const NOTICE_KEYS = {
  crossing: 'atm.map.draw.crossing',
  tooSmall: 'atm.map.draw.tooSmall',
  geometry: 'atm.map.save.error.geometry',
  added: 'atm.map.draw.added',
  cancelled: 'atm.map.draw.cancelled',
  saved: 'atm.map.save.saved',
} as const;

export const initialZoneEditorState: ZoneEditorState = {
  mode: 'view',
  branchId: null,
  base: null,
  draft: [],
  selectedZoneId: null,
  selectedVertex: null,
  drawing: null,
  past: [],
  future: [],
  gesture: null,
  conflict: false,
  notice: null,
};

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────

const TEMP_ID = /^new-[a-z0-9]{1,24}$/;

export const isTempId = (id: string): boolean => TEMP_ID.test(id);

/** A temporary id the draft does not use yet (`new-` + base-36, the schema's `TempIdSchema`). */
export const newTempId = (
  draft: readonly DraftZone[],
  random: () => number = Math.random,
): string => {
  const taken = new Set(draft.map((z) => z.id));
  for (;;) {
    const id = `new-${Math.floor(random() * 36 ** 8).toString(36)}`;
    if (!taken.has(id)) return id;
  }
};

/** DM-8: names compare after trimming, collapsing spaces and case-folding — the api's `zoneNameKey`. */
export const zoneNameKey = (name: string): string => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** The set's zones as a draft, in list order, every point rounded (DM-48). */
export const draftOf = (set: AtmMapZoneSetDto): DraftZone[] =>
  [...set.zones]
    .sort((a, b) => a.order - b.order)
    .map((zone) => ({
      id: zone.id,
      name: zone.name,
      color: zone.color.toLowerCase(),
      points: zone.points.map(round6),
    }));

const samePoints = (a: readonly AtmMapLatLng[], b: readonly AtmMapLatLng[]): boolean =>
  a.length === b.length && a.every((p, i) => coordKey(p) === coordKey(b[i] as AtmMapLatLng));

const sameZone = (a: DraftZone, b: DraftZone): boolean =>
  a.name === b.name &&
  a.color.toLowerCase() === b.color.toLowerCase() &&
  samePoints(a.points, b.points);

const sameDraft = (a: readonly DraftZone[], b: readonly DraftZone[]): boolean =>
  a.length === b.length && a.every((zone, i) => zone.id === b[i]?.id && sameZone(zone, b[i]));

const capped = (history: DraftZone[][]): DraftZone[][] =>
  history.length > ZONE_EDITOR_HISTORY_MAX ? history.slice(-ZONE_EDITOR_HISTORY_MAX) : history;

const notify = (state: ZoneEditorState, key: string): ZoneEditorNotice => ({
  key,
  seq: (state.notice?.seq ?? 0) + 1,
});

/** One finished gesture: `before` goes on the undo stack and the redo stack is dropped. */
const committed = (
  state: ZoneEditorState,
  before: DraftZone[],
  draft: DraftZone[],
): ZoneEditorState => ({
  ...state,
  draft,
  past: capped([...state.past, before]),
  future: [],
});

/** A selection that still names a zone of the draft, or the first zone (the mockup's rule). */
const reselect = (draft: readonly DraftZone[], selected: string | null): string | null =>
  selected !== null && draft.some((z) => z.id === selected) ? selected : (draft[0]?.id ?? null);

const withZone = (
  draft: readonly DraftZone[],
  zoneId: string,
  change: (zone: DraftZone) => DraftZone,
): DraftZone[] => draft.map((zone) => (zone.id === zoneId ? change(zone) : zone));

/**
 * The toast for points the save would refuse (`zoneGeometryIssues`, the server's own test), or
 * null for a valid zone — FINISH_DRAW's mapping: a crossing, a zone under 100 m², anything else.
 */
const geometryNotice = (points: readonly AtmMapLatLng[]): string | null => {
  const issues = zoneGeometryIssues(points);
  if (issues.length === 0) return null;
  if (issues.includes('TOO_SMALL')) return NOTICE_KEYS.tooSmall;
  if (issues.includes('SELF_INTERSECTION')) return NOTICE_KEYS.crossing;
  return NOTICE_KEYS.geometry;
};

/**
 * Close a drag: one history step, or — when a touched zone is now a shape the save would refuse
 * (it crosses itself, falls under 100 m², doubles a point) — no change at all.
 */
const endGesture = (state: ZoneEditorState): ZoneEditorState => {
  const gesture = state.gesture;
  if (gesture === null) return state;
  const touched = new Set(gesture.links.map((link) => link.zoneId));
  const refused = state.draft
    .filter((zone) => touched.has(zone.id))
    .map((zone) => geometryNotice(zone.points))
    .find((key) => key !== null);
  if (refused !== undefined) {
    return {
      ...state,
      draft: gesture.before,
      gesture: null,
      selectedVertex: null,
      notice: notify(state, refused),
    };
  }
  const settled = { ...state, gesture: null };
  return sameDraft(gesture.before, state.draft)
    ? settled
    : committed(settled, gesture.before, state.draft);
};

const moveLinked = (
  draft: readonly DraftZone[],
  links: readonly VertexRef[],
  point: AtmMapLatLng,
): DraftZone[] => {
  const at = round6(point);
  return draft.map((zone) => {
    const indexes = links.filter((link) => link.zoneId === zone.id).map((link) => link.index);
    if (indexes.length === 0) return zone;
    return { ...zone, points: zone.points.map((p, i) => (indexes.includes(i) ? at : p)) };
  });
};

const collator = new Intl.Collator('ar', { numeric: true, sensitivity: 'base' });

// ── The reducer ─────────────────────────────────────────────────────────────────────────────────

export const zoneEditorReducer = (
  state: ZoneEditorState,
  action: ZoneEditorAction,
): ZoneEditorState => {
  switch (action.type) {
    case 'ENTER_EDIT': {
      const draft = draftOf(action.set);
      const wanted = action.selectZoneId ?? null;
      return {
        ...initialZoneEditorState,
        mode: 'edit',
        branchId: action.set.branchId,
        base: action.set,
        draft,
        selectedZoneId: wanted !== null && draft.some((z) => z.id === wanted) ? wanted : null,
        notice: state.notice,
      };
    }

    case 'RESTORE_DRAFT': {
      if (state.mode === 'view') return state;
      const draft = action.zones.map((zone) => ({
        id: zone.id,
        name: zone.name,
        color: zone.color.toLowerCase(),
        points: zone.points.map(round6),
      }));
      const current = endGesture(state);
      return {
        ...committed(current, current.draft, draft),
        mode: 'edit',
        drawing: null,
        selectedZoneId: null,
        selectedVertex: null,
      };
    }

    case 'START_DRAW': {
      if (state.mode !== 'edit') return state;
      return {
        ...endGesture(state),
        mode: 'draw',
        drawing: { points: [], color: action.color.toLowerCase() },
        selectedVertex: null,
      };
    }

    case 'ADD_POINT': {
      if (state.mode !== 'draw' || state.drawing === null) return state;
      if (action.pxFromLast !== undefined && action.pxFromLast < DOUBLE_CLICK_DUPLICATE_PX) {
        return state;
      }
      const point = round6(action.point);
      const points = state.drawing.points;
      const last = points[points.length - 1];
      if (last !== undefined && coordKey(last) === coordKey(point)) return state;
      if (wouldCrossWhileDrawing(points, point)) {
        return { ...state, notice: notify(state, NOTICE_KEYS.crossing) };
      }
      return { ...state, drawing: { ...state.drawing, points: [...points, point] } };
    }

    case 'UNDO_POINT': {
      if (state.mode !== 'draw' || state.drawing === null) return state;
      if (state.drawing.points.length === 0) return state;
      return {
        ...state,
        drawing: { ...state.drawing, points: state.drawing.points.slice(0, -1) },
      };
    }

    case 'FINISH_DRAW': {
      if (state.mode !== 'draw' || state.drawing === null) return state;
      const { points, color } = state.drawing;
      if (points.length < ATM_MAP_ZONE_MIN_POINTS) return state;
      const issues = zoneGeometryIssues(points);
      if (issues.length > 0) {
        const key = issues.includes('TOO_SMALL')
          ? NOTICE_KEYS.tooSmall
          : issues.includes('SELF_INTERSECTION')
            ? NOTICE_KEYS.crossing
            : NOTICE_KEYS.geometry;
        return { ...state, notice: notify(state, key) };
      }
      const zone: DraftZone = {
        id: action.tempId,
        name: nextDefaultName(state.draft, action.formatName),
        color,
        points,
      };
      return {
        ...committed(state, state.draft, [...state.draft, zone]),
        mode: 'edit',
        drawing: null,
        selectedZoneId: zone.id,
        selectedVertex: null,
        notice: notify(state, NOTICE_KEYS.added),
      };
    }

    case 'CANCEL_DRAW': {
      if (state.mode !== 'draw') return state;
      const hadShape = (state.drawing?.points.length ?? 0) >= ATM_MAP_ZONE_MIN_POINTS;
      return {
        ...state,
        mode: 'edit',
        drawing: null,
        notice: hadShape ? notify(state, NOTICE_KEYS.cancelled) : state.notice,
      };
    }

    case 'SELECT_ZONE': {
      if (state.mode === 'view') return state;
      const zoneId =
        action.zoneId !== null && state.draft.some((z) => z.id === action.zoneId)
          ? action.zoneId
          : null;
      // A list row clicked while drawing leaves the drawing, as the mockup's row `pick` does —
      // under CANCEL_DRAW's own rule for saying so.
      const left =
        state.mode === 'draw' ? zoneEditorReducer(state, { type: 'CANCEL_DRAW' }) : state;
      return { ...endGesture(left), selectedZoneId: zoneId, selectedVertex: null };
    }

    case 'SELECT_VERTEX': {
      if (state.mode !== 'edit') return state;
      const vertex = action.vertex;
      if (vertex === null) return { ...state, selectedVertex: null };
      const zone = state.draft.find((z) => z.id === vertex.zoneId);
      if (zone === undefined || vertex.index < 0 || vertex.index >= zone.points.length)
        return state;
      return { ...state, selectedZoneId: zone.id, selectedVertex: vertex };
    }

    case 'MOVE_VERTEX': {
      if (state.mode !== 'edit') return state;
      let current = state;
      const ongoing = current.gesture;
      if (
        ongoing !== null &&
        (ongoing.vertex.zoneId !== action.zoneId || ongoing.vertex.index !== action.index)
      ) {
        current = endGesture(current);
      }
      let gesture = current.gesture;
      if (gesture === null) {
        const zone = current.draft.find((z) => z.id === action.zoneId);
        const at = zone?.points[action.index];
        if (zone === undefined || at === undefined) return current;
        const vertex = { zoneId: zone.id, index: action.index };
        gesture = {
          before: current.draft,
          vertex,
          links: action.unlink ? [vertex] : linkedVertices(current.draft, coordKey(at)),
        };
      }
      return {
        ...current,
        draft: moveLinked(current.draft, gesture.links, action.point),
        gesture,
        selectedZoneId: action.zoneId,
        selectedVertex: { zoneId: action.zoneId, index: action.index },
      };
    }

    case 'INSERT_VERTEX': {
      if (state.mode !== 'edit') return state;
      const current = endGesture(state);
      const zone = current.draft.find((z) => z.id === action.zoneId);
      if (zone === undefined || zone.points.length < 2) return current;
      const n = zone.points.length;
      const start = zone.points[action.edgeIndex];
      const end = zone.points[(action.edgeIndex + 1) % n];
      if (start === undefined || end === undefined) return current;
      const point = round6(action.point);

      const own = insertOnEdge(zone, action.edgeIndex, point);
      if (own === zone.points) return current;
      const sharers = zonesWithEdge(current.draft, coordKey(start), coordKey(end)).filter(
        (hit) => hit.zoneId !== zone.id,
      );
      const links: VertexRef[] = [{ zoneId: zone.id, index: action.edgeIndex + 1 }];
      const inserted = new Map<string, AtmMapLatLng[]>([[zone.id, [...own]]]);
      for (const hit of sharers) {
        const other = current.draft.find((z) => z.id === hit.zoneId);
        if (other === undefined) continue;
        const ring = insertOnEdge(other, hit.edgeIndex, point);
        if (ring === other.points) continue;
        inserted.set(other.id, [...ring]);
        links.push({ zoneId: other.id, index: hit.edgeIndex + 1 });
      }
      const vertex = { zoneId: zone.id, index: action.edgeIndex + 1 };
      return {
        ...current,
        draft: current.draft.map((z) => {
          const ring = inserted.get(z.id);
          return ring === undefined ? z : { ...z, points: ring };
        }),
        gesture: { before: current.draft, vertex, links },
        selectedZoneId: zone.id,
        selectedVertex: vertex,
      };
    }

    case 'END_GESTURE':
      return endGesture(state);

    case 'DELETE_VERTEX': {
      if (state.mode !== 'edit') return state;
      const current = endGesture(state);
      const vertex = action.vertex ?? current.selectedVertex;
      if (vertex === null) return current;
      const zone = current.draft.find((z) => z.id === vertex.zoneId);
      if (zone === undefined || vertex.index < 0 || vertex.index >= zone.points.length) {
        return current;
      }
      // A zone keeps at least three points; the control is disabled there (`vertex.minThree`).
      if (zone.points.length <= ATM_MAP_ZONE_MIN_POINTS) return current;
      const points = zone.points.filter((_, i) => i !== vertex.index);
      // A delete that leaves a shape the save would refuse (a notch's corner, whose ring then
      // crosses itself) is refused here, where the person can see why — not at «حفظ».
      const refused = geometryNotice(points);
      if (refused !== null) return { ...current, notice: notify(current, refused) };
      const draft = withZone(current.draft, zone.id, (z) => ({ ...z, points }));
      return { ...committed(current, current.draft, draft), selectedVertex: null };
    }

    case 'RENAME': {
      if (state.mode !== 'edit') return state;
      const name = action.name.trim();
      const zone = state.draft.find((z) => z.id === action.zoneId);
      // An empty name is not a name; the field goes back to the stored one.
      if (zone === undefined || name === '' || name === zone.name) return state;
      return committed(
        state,
        state.draft,
        withZone(state.draft, zone.id, (z) => ({ ...z, name })),
      );
    }

    case 'RECOLOR': {
      if (state.mode !== 'edit') return state;
      const color = action.color.toLowerCase();
      const zone = state.draft.find((z) => z.id === action.zoneId);
      if (zone === undefined || color === zone.color.toLowerCase()) return state;
      return committed(
        state,
        state.draft,
        withZone(state.draft, zone.id, (z) => ({ ...z, color })),
      );
    }

    case 'MOVE_UP':
    case 'MOVE_DOWN': {
      if (state.mode === 'view') return state;
      const i = state.draft.findIndex((z) => z.id === action.zoneId);
      const j = action.type === 'MOVE_UP' ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= state.draft.length) return state;
      const draft = [...state.draft];
      [draft[i], draft[j]] = [draft[j] as DraftZone, draft[i] as DraftZone];
      return committed(state, state.draft, draft);
    }

    case 'SORT_AZ': {
      if (state.mode === 'view') return state;
      // The order IS the priority (D-M7), so «قطاع 2» must come before «قطاع 10» in every UI
      // locale: an Arabic collator with numeric ordering, and a stable sort for equal names.
      const draft = [...state.draft].sort((a, b) => collator.compare(a.name, b.name));
      if (draft.every((zone, i) => zone.id === state.draft[i]?.id)) return state;
      return committed(state, state.draft, draft);
    }

    case 'DELETE_ZONE': {
      if (state.mode !== 'edit') return state;
      const current = endGesture(state);
      if (!current.draft.some((z) => z.id === action.zoneId)) return current;
      const draft = current.draft.filter((z) => z.id !== action.zoneId);
      return {
        ...committed(current, current.draft, draft),
        selectedZoneId:
          current.selectedZoneId === action.zoneId
            ? (draft[0]?.id ?? null)
            : current.selectedZoneId,
        selectedVertex: null,
      };
    }

    case 'UNDO': {
      if (state.mode === 'view') return state;
      const current = endGesture(state);
      const previous = current.past[current.past.length - 1];
      if (previous === undefined) return current;
      return {
        ...current,
        draft: previous,
        past: current.past.slice(0, -1),
        future: capped([...current.future, current.draft]),
        selectedZoneId:
          current.selectedZoneId === null ? null : reselect(previous, current.selectedZoneId),
        selectedVertex: null,
      };
    }

    case 'REDO': {
      if (state.mode === 'view') return state;
      const current = endGesture(state);
      const next = current.future[current.future.length - 1];
      if (next === undefined) return current;
      return {
        ...current,
        draft: next,
        future: current.future.slice(0, -1),
        past: capped([...current.past, current.draft]),
        selectedZoneId:
          current.selectedZoneId === null ? null : reselect(next, current.selectedZoneId),
        selectedVertex: null,
      };
    }

    case 'DISCARD': {
      if (state.mode === 'view') return state;
      const base = action.set ?? state.base;
      if (base === null) return state;
      const draft = draftOf(base);
      return {
        ...state,
        mode: 'edit',
        branchId: base.branchId,
        base,
        draft,
        drawing: null,
        gesture: null,
        past: [],
        future: [],
        selectedZoneId:
          state.selectedZoneId === null ? null : reselect(draft, state.selectedZoneId),
        selectedVertex: null,
        conflict: false,
      };
    }

    case 'EXIT_EDIT':
      return { ...initialZoneEditorState, notice: state.notice };

    case 'SAVED': {
      const draft = draftOf(action.set);
      // A zone created in this save has a real id now; it sits where the draft had it.
      const index = state.draft.findIndex((z) => z.id === state.selectedZoneId);
      const selected =
        state.selectedZoneId === null
          ? null
          : draft.some((z) => z.id === state.selectedZoneId)
            ? state.selectedZoneId
            : (draft[index]?.id ?? null);
      // The page stays in edit mode — and a shape being drawn when the save landed stays drawn.
      return {
        ...state,
        mode: state.mode === 'draw' ? 'draw' : 'edit',
        branchId: action.set.branchId,
        base: action.set,
        draft,
        gesture: null,
        past: [],
        future: [],
        selectedZoneId: selected,
        selectedVertex: null,
        conflict: false,
        notice: notify(state, NOTICE_KEYS.saved),
      };
    }

    case 'CONFLICT':
      return { ...endGesture(state), conflict: true };

    case 'CLOSE_CONFLICT':
      return { ...state, conflict: false };
  }
};

// ── The save path ───────────────────────────────────────────────────────────────────────────────

/**
 * The PUT body: only what changed. Creates carry their temporary id, updates only the fields that
 * differ from the base, deletes the base ids the draft no longer has, and `order` is always the
 * whole final list (the server checks it is a permutation).
 */
export const buildZoneSetSave = (
  base: AtmMapZoneSetDto,
  draft: readonly DraftZone[],
): SaveAtmMapZoneSet => {
  const before = new Map(draftOf(base).map((zone) => [zone.id, zone]));
  const kept = new Set(draft.map((zone) => zone.id));
  const creates: SaveAtmMapZoneSet['creates'] = [];
  const updates: SaveAtmMapZoneSet['updates'] = [];
  for (const zone of draft) {
    const old = before.get(zone.id);
    if (old === undefined) {
      creates.push({
        tempId: zone.id,
        name: zone.name,
        color: zone.color.toLowerCase(),
        points: zone.points.map(round6),
      });
      continue;
    }
    const update: SaveAtmMapZoneSet['updates'][number] = { id: zone.id };
    if (zone.name !== old.name) update.name = zone.name;
    if (zone.color.toLowerCase() !== old.color) update.color = zone.color.toLowerCase();
    if (!samePoints(zone.points, old.points)) update.points = zone.points.map(round6);
    if (Object.keys(update).length > 1) updates.push(update);
  }
  return {
    branchId: base.branchId,
    revision: base.revision,
    creates,
    updates,
    deletes: [...before.keys()].filter((id) => !kept.has(id)),
    order: draft.map((zone) => zone.id),
  };
};

/**
 * «تغييرات غير محفوظة: n» — the approved mockup's formula (DM-23, `Edit.dc.html:536-544`): created +
 * changed (geometry, name or colour) + deleted, plus 1 when the surviving zones' relative order
 * changed and no zone was changed. Sort A–Z on twelve zones is one change, not twelve.
 */
export const dirtyCount = (base: AtmMapZoneSetDto | null, draft: readonly DraftZone[]): number => {
  const before = base === null ? [] : draftOf(base);
  const byId = new Map(before.map((zone) => [zone.id, zone]));
  const now = new Set(draft.map((zone) => zone.id));
  let added = 0;
  let changed = 0;
  for (const zone of draft) {
    const old = byId.get(zone.id);
    if (old === undefined) added += 1;
    else if (!sameZone(old, zone)) changed += 1;
  }
  const removed = before.filter((zone) => !now.has(zone.id)).length;
  const survivingNow = draft.filter((zone) => byId.has(zone.id)).map((zone) => zone.id);
  const survivingBefore = before.filter((zone) => now.has(zone.id)).map((zone) => zone.id);
  const orderChanged = survivingNow.join() !== survivingBefore.join();
  return added + changed + removed + (orderChanged && changed === 0 ? 1 : 0);
};

/** DM-22: the smallest n whose «قطاع n» is not yet a name in the draft (under DM-8's comparison). */
export const nextDefaultName = (
  draft: readonly { name: string }[],
  formatName: (n: number) => string,
): string => {
  const taken = new Set(draft.map((zone) => zoneNameKey(zone.name)));
  for (let n = 1; ; n += 1) {
    const name = formatName(n);
    if (!taken.has(zoneNameKey(name))) return name;
  }
};

/** The ids of every draft zone whose name another zone also has (DM-8), in list order. */
export const duplicateNames = (draft: readonly DraftZone[]): string[] => {
  const counts = new Map<string, number>();
  for (const zone of draft) {
    const key = zoneNameKey(zone.name);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return draft.filter((zone) => (counts.get(zoneNameKey(zone.name)) ?? 0) > 1).map((z) => z.id);
};

/** The body's size on the wire, for the 900 KB guard (§6.6). */
export const saveBodyBytes = (body: SaveAtmMapZoneSet): number =>
  new TextEncoder().encode(JSON.stringify(body)).length;

/** The zone the panel shows as «القطاع المحدد», if any. */
export const selectedZone = (state: ZoneEditorState): DraftZone | null =>
  state.draft.find((zone) => zone.id === state.selectedZoneId) ?? null;
