// «تبديل بين سيارتين» on «لوحة التشغيلة» (Round 32 C) — as a pure step on the draft.
//
// THE OWNER: «دلوقتى انا لو عندى عربية عينت عليها قادة و اخصائيين و اتجاه وهكذا وجيت غلط المفروض الداتا
// دى ل عربيه تانية او نص الداتا صح والاقى على عربيه تانية انا عاوز بقى اقدر اعمل اسوابنج بين عربيتين
// واقدر احدد هنقل ايه بالظبط للعربيه التانيه».
//
// WHAT MOVES. Everything a row holds but its van: each PERSON (in his slot) and each of the row's
// own FIELDS — «الاتجاه», «التوقيت», «النوع», «اللون», «ملاحظات». The vans stay where they are (a
// van is the row; the محصنات «توزيع المحصنات» put on a row ride its saved crew row, and so stay with
// its van too). Each item is ticked on the card of the row that holds it, and a ticked item GOES TO
// THE OTHER ROW:
//   · «تبديل المحدد ⇄» (`swap`) — the ticked items of both rows cross at once;
//   · «نقل المحدد» one way (`aToB`, `bToA`) — only the ticked items of the sending row cross; the
//     receiving row's ticks are not read.
// A FIELD — one value a row:
//   · in «تبديل المحدد ⇄» it is ONE exchange the two cards share (Round 32 critic): ticked on either
//     card, the two values cross — each row takes the other's, or the one value moves into the empty
//     row. It was a move there too, and the other row's own value — never ticked — was thrown away;
//   · in «نقل المحدد» one way the sending row's value MOVES: the other row takes it (and loses its
//     own, which the preview names — `replaced`), the sending row is left without one.
// An empty field is nothing to send, so it is never an item.
//
// THE BOARD'S RULES, as every other way of seating somebody holds to them, so nothing here makes a
// draft the save would refuse:
//   · a person keeps his SLOT ROLE — a captain goes to «قائد الطاقم», a specialist to the same
//     «أخصائي» slot or, that one full, to the other (`SLOT_PATH`);
//   · Round 23 (`fitsCrewSlot`): a slot his role does not fit is a new seat the save refuses — a
//     seat held outside his role before the rule stays where it is, named;
//   · Round 22 (`awayOf`): somebody HR has away that day goes on no other row — he stays, named;
//   · capacity (`CREW_SLOT_CAPACITY` a slot): a person with no room left stays, named. The room is
//     the room AFTER the operation — the people leaving a slot make room for the ones arriving;
//   · Q11 (nobody twice): people only ever cross between the two rows, never copied;
//   · a type archived since a row took it stays on that row (the server takes only an ACTIVE type
//     newly given to a row — `typeMayGo`). In an exchange the other row's type then stays too
//     (`archivedPair`): it could only land where the archived one stays (the Round 32 critic — it
//     landed, and the archived type was lost from both rows).
// What a rule keeps back is listed (`refused`) and left exactly where it was; the rest is applied.
//
// ONE OPERATION. The page records `applySwap` as one step of «تراجع» (`lib/crew-undo.ts`): one press
// puts both rows back. Nothing is written until «حفظ», which counts the two rows it changed.
import { CREW_SLOT_CAPACITY, fitsCrewSlot } from '@ecms/contracts';
import {
  CREW_SLOTS,
  wrongSlotOf,
  type CrewAway,
  type CrewRole,
  type CrewSlot,
  type PlanRow,
  type PlanRowPatch,
  type WrongSlot,
} from './crew-plan';
import { type CrewDraft, type UndoWhat } from './crew-undo';

/** The row's own fields an operation may carry across, in the cards' order. */
export const SWAP_FIELDS = [
  'direction',
  'plannedTime',
  'shiftTypeId',
  'rowColour',
  'notes',
] as const;
export type SwapField = (typeof SWAP_FIELDS)[number] & keyof PlanRowPatch;

/** The two rows: `a` the row the operation was opened from, `b` the one picked beside it. */
export type SwapSide = 'a' | 'b';
export const otherSide = (side: SwapSide): SwapSide => (side === 'a' ? 'b' : 'a');

/** «تبديل المحدد ⇄», «نقل المحدد» from a to b, and from b to a. */
export const SWAP_MODES = ['aToB', 'swap', 'bToA'] as const;
export type SwapMode = (typeof SWAP_MODES)[number];

/** Do the ticks of this side cross in this mode? */
export const sendsFrom = (mode: SwapMode, side: SwapSide): boolean =>
  mode === 'swap' || (side === 'a' ? mode === 'aToB' : mode === 'bToA');

/** An item's id on its card — a person, or a field. */
export const personItem = (employeeId: string): string => `person:${employeeId}`;
export const fieldItem = (field: SwapField): string => `field:${field}`;

/** One thing a row holds that can cross: a person in his slot, or a field with a value. */
export type SwapItem =
  | { kind: 'person'; id: string; employeeId: string; slot: CrewSlot }
  | { kind: 'field'; id: string; field: SwapField; value: string };

/** What a row offers, in the card's order: its people slot by slot, then its filled fields. */
export const swapItems = (row: PlanRow): SwapItem[] => [
  ...CREW_SLOTS.flatMap((slot) =>
    row.slots[slot].map((employeeId): SwapItem => ({
      kind: 'person',
      id: personItem(employeeId),
      employeeId,
      slot,
    })),
  ),
  ...SWAP_FIELDS.flatMap((field): SwapItem[] => {
    const value = row[field];
    return value === null ? [] : [{ kind: 'field', id: fieldItem(field), field, value }];
  }),
];

/** The card's three quick picks: everything, the people only, nothing. */
export const QUICK_PICKS = ['all', 'crew', 'none'] as const;
export type QuickPick = (typeof QUICK_PICKS)[number];

export const quickPick = (row: PlanRow, pick: QuickPick): string[] =>
  pick === 'none'
    ? []
    : swapItems(row)
        .filter((item) => pick === 'all' || item.kind === 'person')
        .map((item) => item.id);

/** The ticks on each card, by item id. */
export interface SwapPicks {
  a: readonly string[];
  b: readonly string[];
}
export const NO_PICKS: SwapPicks = { a: [], b: [] };

/**
 * What the board knows of the people and the types — the same answers its drop asks
 * (`resolveDrop`): `roleOf` null for somebody the roster no longer names (the save, which reads his
 * requirements, judges him — as everywhere on the board); `typeMayGo` — may this type be given to
 * that row: active, or the row's saved row already holds it.
 */
export interface SwapRules {
  roleOf: (employeeId: string) => CrewRole | null;
  awayOf: (employeeId: string) => CrewAway | null;
  typeMayGo: (shiftTypeId: string, toKey: string) => boolean;
}

/**
 * Why an item stays where it is. `archivedPair` — an exchanged field whose other half is an
 * archived type that stays on its row: there is nowhere for this one to land.
 */
export type SwapRefusal =
  CrewAway | WrongSlot | 'captainFull' | 'specialistsFull' | 'archivedType' | 'archivedPair';

export interface SwapMove {
  /** The side it leaves. */
  from: SwapSide;
  item: string;
  /** Where a person lands on the other row. */
  slot?: CrewSlot;
}
export interface SwapRefused {
  /** The side it was ticked on — and stays on. */
  from: SwapSide;
  item: string;
  reason: SwapRefusal;
}
/** A value the receiving row held and loses: a field MOVED onto it one way (never in an exchange). */
export interface SwapReplaced {
  on: SwapSide;
  field: SwapField;
  was: string;
}

export interface SwapResult {
  /** The two rows after the operation — the same objects when nothing crosses. */
  a: PlanRow;
  b: PlanRow;
  moved: SwapMove[];
  refused: SwapRefused[];
  replaced: SwapReplaced[];
}

/**
 * The slots a person tries on the other row, in order — his own slot's KIND: «قائد الطاقم» for a
 * captain's seat; for a specialist's, the same «أخصائي» slot, then the other one.
 */
export const SLOT_PATH: Record<CrewSlot, readonly CrewSlot[]> = {
  captain: ['captain'],
  specialist1: ['specialist1', 'specialist2'],
  specialist2: ['specialist2', 'specialist1'],
};

type Slots = Record<CrewSlot, string[]>;

const copySlots = (slots: PlanRow['slots']): Slots => ({
  captain: [...slots.captain],
  specialist1: [...slots.specialist1],
  specialist2: [...slots.specialist2],
});

interface Mover {
  side: SwapSide;
  employeeId: string;
  slot: CrewSlot;
  /** The slots on the other row his role fits, in `SLOT_PATH` order. */
  fits: readonly CrewSlot[];
}

/**
 * The operation on two rows — what the preview draws and what «تطبيق» applies. Pure: the same rows,
 * ticks, mode and rules give the same answer, so the page recomputes it on the draft as it is at the
 * press (another desk's save may have rebased it under the open dialog).
 */
export const planSwap = (
  a: PlanRow,
  b: PlanRow,
  picks: SwapPicks,
  mode: SwapMode,
  rules: SwapRules,
): SwapResult => {
  const rowOf = { a, b };
  const ticked = { a: new Set(picks.a), b: new Set(picks.b) };
  const sends = (side: SwapSide, item: string): boolean =>
    sendsFrom(mode, side) && ticked[side].has(item);
  const refused: SwapRefused[] = [];
  const moved: SwapMove[] = [];
  const replaced: SwapReplaced[] = [];

  // ── The people ──────────────────────────────────────────────────────────────────────────────
  // Who is ticked to cross, less whom a rule of the PERSON keeps back (away that day, a slot his
  // role does not fit) — those stay put whatever room there is.
  const movers: Mover[] = [];
  for (const side of ['a', 'b'] as const) {
    for (const slot of CREW_SLOTS) {
      for (const employeeId of rowOf[side].slots[slot]) {
        const item = personItem(employeeId);
        if (!sends(side, item)) continue;
        const away = rules.awayOf(employeeId);
        if (away !== null) {
          refused.push({ from: side, item, reason: away });
          continue;
        }
        const role = rules.roleOf(employeeId);
        const path = SLOT_PATH[slot];
        const fits = path.filter((to) => role === null || fitsCrewSlot(role, to));
        const first = path[0] as CrewSlot;
        if (fits.length === 0) {
          refused.push({
            from: side,
            item,
            reason: wrongSlotOf(role as CrewRole, first) as WrongSlot,
          });
          continue;
        }
        movers.push({ side, employeeId, slot, fits });
      }
    }
  }

  // THE ROOM — after the operation: a slot's people who leave make room for the ones arriving.
  // Somebody with no room left stays, and so takes his seat back on his own row, which may leave
  // no room there for somebody coming the other way: worked out again until nothing changes (each
  // round only ever keeps more people back, so it ends — after at most one round a person).
  const kept = new Set<string>();
  let slots: { a: Slots; b: Slots } = { a: copySlots(a.slots), b: copySlots(b.slots) };
  let landed: { mover: Mover; slot: CrewSlot }[] = [];
  for (;;) {
    const crossing = movers.filter((mover) => !kept.has(mover.employeeId));
    const leaving = new Set(crossing.map((mover) => mover.employeeId));
    const next = {
      a: copySlots(a.slots),
      b: copySlots(b.slots),
    };
    for (const side of ['a', 'b'] as const) {
      for (const slot of CREW_SLOTS) {
        next[side][slot] = next[side][slot].filter((employeeId) => !leaving.has(employeeId));
      }
    }
    const arrivals: { mover: Mover; slot: CrewSlot }[] = [];
    let more = false;
    for (const mover of crossing) {
      const there = next[otherSide(mover.side)];
      const slot = mover.fits.find((to) => there[to].length < CREW_SLOT_CAPACITY);
      if (slot === undefined) {
        kept.add(mover.employeeId);
        refused.push({
          from: mover.side,
          item: personItem(mover.employeeId),
          reason: mover.slot === 'captain' ? 'captainFull' : 'specialistsFull',
        });
        more = true;
        continue;
      }
      there[slot].push(mover.employeeId);
      arrivals.push({ mover, slot });
    }
    if (!more) {
      slots = next;
      landed = arrivals;
      break;
    }
  }
  for (const { mover, slot } of landed) {
    moved.push({ from: mover.side, item: personItem(mover.employeeId), slot });
  }

  // ── The fields ──────────────────────────────────────────────────────────────────────────────
  const fields: { a: PlanRowPatch; b: PlanRowPatch } = { a: {}, b: {} };
  const set = (side: SwapSide, field: SwapField, to: string | null): void => {
    Object.assign(fields[side], { [field]: to });
  };
  for (const field of SWAP_FIELDS) {
    const item = fieldItem(field);
    const value = { a: a[field], b: b[field] };
    // A type archived since the row took it stays on that row: the other row would be GIVEN it,
    // which the save refuses (only an active type is newly given).
    const stays = (side: SwapSide): boolean => {
      const own = value[side];
      return (
        field === 'shiftTypeId' && own !== null && !rules.typeMayGo(own, rowOf[otherSide(side)].key)
      );
    };
    if (mode === 'swap') {
      // ONE exchange the two cards share: ticked on either, both values cross.
      if (!ticked.a.has(item) && !ticked.b.has(item)) continue;
      if (value.a === null && value.b === null) continue;
      if (stays('a') || stays('b')) {
        // Off, both ways: the archived type stays — and so does the other row's, which could only
        // land where it stays. Each named on its own row.
        for (const side of ['a', 'b'] as const) {
          if (value[side] === null) continue;
          refused.push({ from: side, item, reason: stays(side) ? 'archivedType' : 'archivedPair' });
        }
        continue;
      }
      for (const side of ['a', 'b'] as const) {
        if (value[side] !== null) moved.push({ from: side, item });
      }
      set('a', field, value.b);
      set('b', field, value.a);
      continue;
    }
    // One way: the sending row's ticked value moves; the receiving row's own is replaced, named.
    const from: SwapSide = mode === 'aToB' ? 'a' : 'b';
    const to = otherSide(from);
    const own = value[from];
    if (own === null || !sends(from, item)) continue;
    if (stays(from)) {
      refused.push({ from, item, reason: 'archivedType' });
      continue;
    }
    moved.push({ from, item });
    const was = value[to];
    if (was !== null) replaced.push({ on: to, field, was });
    set(to, field, own);
    set(from, field, null);
  }

  const crossed = moved.length > 0;
  const after = (side: SwapSide): PlanRow =>
    crossed ? { ...rowOf[side], slots: slots[side], ...fields[side] } : rowOf[side];
  return { a: after('a'), b: after('b'), moved, refused, replaced };
};

/**
 * «تطبيق» on the draft: the two rows replaced by what `planSwap` makes of them, every other row as
 * it was. The same array when nothing crosses, a row is gone, or the two are one row — so the undo
 * history records nothing (`record`'s `same`).
 */
export const applySwap = (
  rows: readonly PlanRow[],
  aKey: string,
  bKey: string,
  picks: SwapPicks,
  mode: SwapMode,
  rules: SwapRules,
): readonly PlanRow[] => {
  if (aKey === bKey) return rows;
  const a = rows.find((row) => row.key === aKey);
  const b = rows.find((row) => row.key === bKey);
  if (a === undefined || b === undefined) return rows;
  const result = planSwap(a, b, picks, mode, rules);
  if (result.moved.length === 0) return rows;
  return rows.map((row) => (row.key === aKey ? result.a : row.key === bKey ? result.b : row));
};

/**
 * «تطبيق» on the whole draft (Round 32 critic): the rows by `applySwap` — and the standing crew's
 * bookkeeping lets go of the two rows once anything crossed. What «الطاقم الثابت» loaded onto them is
 * no longer what they hold: its «off» emptied the row that now held the other van's people and left
 * the loaded ones on the other van. After a swap both rows are the planner's own, kept as he made
 * them; the load's other rows are untouched. Nothing crossed → the same draft.
 */
export const applySwapToDraft = (
  draft: CrewDraft,
  aKey: string,
  bKey: string,
  picks: SwapPicks,
  mode: SwapMode,
  rules: SwapRules,
): CrewDraft => {
  const rows = applySwap(draft.rows, aKey, bKey, picks, mode, rules);
  if (rows === draft.rows) return draft;
  const touched = (key: string): boolean => key === aKey || key === bKey;
  const keys = draft.standingKeys;
  if (keys === null || !keys.some(touched)) return { ...draft, rows };
  const directions = draft.standingDirections;
  return {
    ...draft,
    rows,
    standingKeys: keys.filter((key) => !touched(key)),
    ...(directions === undefined
      ? {}
      : {
          standingDirections: Object.fromEntries(
            Object.entries(directions).filter(([key]) => !touched(key)),
          ),
        }),
  };
};

/**
 * What «تراجع» and the toast call the operation (Round 32 critic): «التبديل بين 213 و255» for an
 * exchange; a one-way move says so, from the sending row to the other — «نقل المحدد ←» was announced
 * as a swap.
 */
export const swapOperation = (
  mode: SwapMode,
  names: { a: string; b: string },
): UndoWhat & { kind: 'swap' | 'move' } =>
  mode === 'swap'
    ? { kind: 'swap', vars: { a: names.a, b: names.b } }
    : mode === 'aToB'
      ? { kind: 'move', vars: { from: names.a, to: names.b } }
      : { kind: 'move', vars: { from: names.b, to: names.a } };

/**
 * The three ways in a row, under the arrow keys (Round 32 critic): the NEXT way lies in the reading
 * direction — to the LEFT in Arabic, to the RIGHT in English — and down where they stand in a column
 * (at `lg`). It was Arabic's for both: in English → chose the way on the left. 0 for any other key.
 */
export const modeStepOf = (key: string, rtl: boolean): -1 | 0 | 1 => {
  if (key === 'ArrowDown') return 1;
  if (key === 'ArrowUp') return -1;
  if (key === 'ArrowLeft') return rtl ? 1 : -1;
  if (key === 'ArrowRight') return rtl ? -1 : 1;
  return 0;
};

/**
 * Round 32 critic — the محصنات riding a row stay on it whatever crosses (they ride its saved crew
 * row, and so its van). Said where it matters: a row that holds some and whose captains or
 * direction the operation changes — they were placed for the crew and the direction it had.
 */
export const shipmentsLeftBehind = (before: PlanRow, after: PlanRow): number => {
  const count = before.shipments ?? 0;
  if (count === 0) return 0;
  const captains = (row: PlanRow): string => [...row.slots.captain].sort().join(',');
  return captains(before) !== captains(after) || before.direction !== after.direction ? count : 0;
};

/**
 * The ticks still meaning something on the rows as they are now: an item a row no longer holds (a
 * person moved off it by another desk's save, a field emptied) is no longer ticked.
 */
export const livePicks = (a: PlanRow, b: PlanRow, picks: SwapPicks): SwapPicks => {
  const held = (row: PlanRow): Set<string> => new Set(swapItems(row).map((item) => item.id));
  const onA = held(a);
  const onB = held(b);
  const keepA = picks.a.filter((id) => onA.has(id));
  const keepB = picks.b.filter((id) => onB.has(id));
  return keepA.length === picks.a.length && keepB.length === picks.b.length
    ? picks
    : { a: keepA, b: keepB };
};
