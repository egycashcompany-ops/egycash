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
// A field ticked on one row only MOVES: the other row takes its value (and loses its own, which the
// preview names — `replaced`), the sending row is left without one. Ticked on both, the two values
// are exchanged. An empty field is nothing to send, so it is never an item.
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
//     newly given to a row — `typeMayGo`).
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

/** Why an item stays where it is. */
export type SwapRefusal = CrewAway | WrongSlot | 'captainFull' | 'specialistsFull' | 'archivedType';

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
/** A value the receiving row held and loses: a field moved onto it, not exchanged. */
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
  for (const field of SWAP_FIELDS) {
    const item = fieldItem(field);
    const value = { a: a[field], b: b[field] };
    const goes = { a: false, b: false };
    for (const side of ['a', 'b'] as const) {
      const own = value[side];
      if (own === null || !sends(side, item)) continue;
      // A type archived since the row took it stays on that row: the other row would be GIVEN it,
      // which the save refuses (only an active type is newly given).
      if (field === 'shiftTypeId' && !rules.typeMayGo(own, rowOf[otherSide(side)].key)) {
        refused.push({ from: side, item, reason: 'archivedType' });
        continue;
      }
      goes[side] = true;
      moved.push({ from: side, item });
    }
    for (const side of ['a', 'b'] as const) {
      const other = otherSide(side);
      if (goes[other]) {
        // Moved onto a value this row keeps no copy of: the preview names what it loses.
        const own = value[side];
        if (!goes[side] && own !== null) replaced.push({ on: side, field, was: own });
        Object.assign(fields[side], { [field]: value[other] });
      } else if (goes[side]) {
        Object.assign(fields[side], { [field]: null });
      }
    }
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
