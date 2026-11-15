// «لوحة التشغيلة» — what a drag carries, where it may land and what the drop does there (Round 22).
//
// THE OWNER, on the live board: «مش راضى يخلينى احط ولا قادة ولا اخصائيين على العربيه … بسحب الاسم
// بالماوس وبيرجع تانى اكنى متحطش». On his Windows PC every drop was refused, the name springing back
// as if it was never dropped. It could not be reproduced here: Playwright and a real OS-level drag in
// Chromium both placed the name, on the same build and the same API. So rather than fix the one gate
// that could not be proven, this file takes away EVERY gate a real browser could trip:
//
//   · WHO IS DRAGGED comes from our own `dragstart` (a ref the page keeps), never from what the
//     browser shows of the drag's data during dragover. The Round-20 board accepted a dragover only
//     when `dataTransfer.types` listed the board's own MIME type. Chromium carries such a type in a
//     private clipboard format, and anything on Windows that passes on only the standard formats (an
//     endpoint-security hook, an extension) drops it: then every slot refuses, every time, on that
//     one PC. The legacy board (`setData("text")`, every `td` accepting) and Fleet's «الحركة» (no
//     type check on dragover) never asked.
//   · THE WHOLE BOARD ACCEPTS our drag, and what the drop does is decided AT THE DROP. The browser
//     keeps «is a drop accepted here» as the answer to the LAST dragover the page got through
//     (Chromium's `current_drag_op_`, answered asynchronously by the page). On a slow PC the page
//     answers behind the pointer, and a hand that lets go the moment it reaches a row was refused
//     on the answer given for the pool it just left. Accepting everywhere on the board keeps that
//     answer «yes» from the first dragover to the last; the drop then finds what is under it.
//   · NO `dropEffect` IS NAMED: Blink turns one the drag's source does not allow into «none» — a
//     refused drop — while an unset one becomes whatever the source allows (`beginDrag`).
//   · WHERE: anywhere on a row, the vehicle's cell included («على العربيه»), as legacy's `td`s were.
//     A drop on the row goes to the slot the person's role takes (`rowDropSlots`); a drop aimed at a
//     slot still means that slot.
//   · A REFUSAL IS SAID — a toast naming the slot and the row, as legacy's alert did — never only a
//     name that springs back. While he hovers, the slot that would refuse is drawn red.
//
// The page keeps the DOM half (reading the marks under the pointer, the events); everything that
// decides is here, pure, and pinned in `crew-drag.spec.ts`.
import {
  CREW_SLOTS,
  seatOf,
  slotRefusal,
  type CrewAway,
  type CrewRole,
  type CrewSlot,
  type PlanRow,
} from './crew-plan';

/**
 * The board's own MIME type — the same one the standing crew's cards carry (`CrewMemberCard`
 * re-exports it): narrow, so a file or a link dragged over a slot is told apart from a person.
 */
export const CREW_DRAG_TYPE = 'application/x-ecms-crew-member';

/** The part of a `DataTransfer` a drag source writes. */
export interface DragSourceData {
  setData: (format: string, data: string) => void;
  effectAllowed: DataTransfer['effectAllowed'];
}

/**
 * What a chip's `dragstart` writes, and ONLY that — no state. Setting React state here re-rendered
 * the 321 chips before the browser took the drag over (9–20 ms on a laptop, about 50 ms on a slow
 * one), and Blink cancels a drag whose source is no longer under the pointer once `dragstart`
 * returns — which a re-render that inserts a line above the chip (the pool's «أفلِته هنا» hint, a
 * picked name's «إخراج» button) does — measured on the real stack: a placed name pressed in its pool,
 * then dragged, never left it (0 of 3; 3 of 3 now). The page draws the drag only once the browser has
 * had its first answer (`drawDrag` in the page).
 *
 *   · the id twice: under the board's own type, and as `text/plain` — the one format every browser,
 *     OS and hook carries (legacy carried nothing else);
 *   · `copyMove`, not `move`: a hook that takes MOVE away from the drag's allowed effects left a
 *     `move`-only drag with none at all, which every target refuses. Nothing is ever copied: a drop
 *     moves the person whatever the cursor shows (`placeMember`).
 */
export const beginDrag = (data: DragSourceData, employeeId: string): void => {
  data.setData(CREW_DRAG_TYPE, employeeId);
  data.setData('text/plain', employeeId);
  data.effectAllowed = 'copyMove';
};

/**
 * Which person a drop carries: our own drag's id first (the page's ref), then the board's type, then
 * `text/plain` — the first one that is somebody the board knows (on the roster, or seated). A text
 * dragged in from another window is nobody, and drops nothing.
 */
export const droppedMember = (
  carried: { own: string | null; custom: string; text: string },
  known: (employeeId: string) => boolean,
): string | null => {
  for (const candidate of [carried.own ?? '', carried.custom, carried.text]) {
    const employeeId = candidate.trim();
    if (employeeId !== '' && known(employeeId)) return employeeId;
  }
  return null;
};

// ── Where a drop lands ─────────────────────────────────────────────────────────────────────────────

/** What is under the pointer: a slot, any other part of a row, or a pool. */
export type DropTarget =
  | { kind: 'slot'; key: string; slot: CrewSlot }
  | { kind: 'row'; key: string }
  | { kind: 'pool'; pool: string };

/**
 * The target, from the marks the board draws (the nearest `data-slot-zone`, `data-plan-row` and
 * `data-plan-pool` around the element under the pointer): a slot's zone is `<row key>|<slot>`.
 * Null — not a target (the toolbar, the table's head, a slot mark that names no slot).
 */
export const targetFromMarks = (marks: {
  slotZone: string | null;
  rowKey: string | null;
  pool: string | null;
}): DropTarget | null => {
  if (marks.slotZone !== null) {
    const cut = marks.slotZone.lastIndexOf('|');
    const slot = marks.slotZone.slice(cut + 1);
    if (cut > 0 && (CREW_SLOTS as readonly string[]).includes(slot)) {
      return { kind: 'slot', key: marks.slotZone.slice(0, cut), slot: slot as CrewSlot };
    }
  }
  if (marks.rowKey !== null && marks.rowKey !== '') return { kind: 'row', key: marks.rowKey };
  if (marks.pool !== null && marks.pool !== '') return { kind: 'pool', pool: marks.pool };
  return null;
};

/** A target as one string — the page's «under the pointer» state, which a repeated dragover keeps. */
export const targetKey = (target: DropTarget): string =>
  target.kind === 'slot'
    ? `slot|${target.key}|${target.slot}`
    : target.kind === 'row'
      ? `row|${target.key}`
      : `pool|${target.pool}`;

export const parseTargetKey = (key: string): DropTarget | null => {
  const [kind = '', ...rest] = key.split('|');
  if (kind === 'slot' && rest.length === 2) {
    return targetFromMarks({ slotZone: rest.join('|'), rowKey: null, pool: null });
  }
  if (kind === 'row' && rest.length === 1)
    return targetFromMarks({ slotZone: null, rowKey: rest[0] ?? null, pool: null });
  if (kind === 'pool' && rest.length === 1)
    return targetFromMarks({ slotZone: null, rowKey: null, pool: rest[0] ?? null });
  return null;
};

/**
 * The slots a drop ON THE ROW tries, in order, for a role — the legacy board's own routing
 * (tashghela.ejs:1316-1325: a leader to the captain's column, a specialist to a specialist's, «both»
 * to either):
 *   · a captain → «قائد الطاقم» only. Seating him as a specialist is the planner's choice, made by
 *     aiming at that slot (marked out of role, never refused);
 *   · a specialist who also leads (blue) → «قائد الطاقم» first, then the specialists' — «اقدر
 *     اوظفهم ك قائد او اخصائى»;
 *   · a specialist → «أخصائي 1», then «أخصائي 2».
 */
export const rowDropSlots = (role: CrewRole): readonly CrewSlot[] =>
  role === 'captain'
    ? ['captain']
    : role === 'dual'
      ? ['captain', 'specialist1', 'specialist2']
      : ['specialist1', 'specialist2'];

/**
 * Why a drop is refused — each said in its own words (`operations.crewPlan.drop.*`): a slot or a
 * row full, or (Round 22) the person AWAY that day — `absent` or `onLeave`, HR's two answers.
 */
export type DropRefusal = 'full' | 'captainFull' | 'specialistsFull' | 'rowFull' | CrewAway;

/** Is this refusal about the person (away), not about the room on the row? */
export const refusedAsAway = (reason: DropRefusal): reason is CrewAway =>
  reason === 'absent' || reason === 'onLeave';

/**
 * What a drop does — the drag's, and the same answer for a pick from a slot's list (Round 22 E):
 *   · `place` — seat him there (moving him off any other row: `placeMember`);
 *   · `free` — a seated person dropped on a pool: off the board;
 *   · `refuse` — the slot (or every slot the row would give him) is full, or he is away that day:
 *     said, and drawn on those slots while he hovers;
 *   · `stay` — nothing to do, nothing to say: dropped where he already is, or a free name back on a
 *     pool.
 */
export type DropDecision =
  | { kind: 'place'; key: string; slot: CrewSlot }
  | { kind: 'free' }
  | { kind: 'refuse'; key: string; slots: readonly CrewSlot[]; reason: DropRefusal }
  | { kind: 'stay' };

export type RefusedDrop = Extract<DropDecision, { kind: 'refuse' }>;

const FULL_ROW: Record<CrewRole, DropRefusal> = {
  captain: 'captainFull',
  dual: 'rowFull',
  specialist: 'specialistsFull',
};

/**
 * `away` (Round 22): HR has him absent or on leave that day — «لو القائد غايب … مقدرش احطه على
 * العربيه و كذلك الاخصائيين». No row takes him, and the slots it would have given him are drawn red
 * with the reason. Two moves stay open, as the server's own rule (`OPERATIONS_CREW_MEMBER_ABSENT`)
 * leaves them: off the board onto a pool, and from slot to slot on the row he ALREADY sits on —
 * somebody seated before HR recorded the absence keeps his seat until the planner takes him off.
 */
export const resolveDrop = (
  rows: readonly PlanRow[],
  target: DropTarget,
  employeeId: string,
  role: CrewRole,
  away: CrewAway | null = null,
): DropDecision => {
  if (target.kind === 'pool') {
    return seatOf(rows, employeeId) === null ? { kind: 'stay' } : { kind: 'free' };
  }
  if (away !== null && seatOf(rows, employeeId)?.key !== target.key) {
    return {
      kind: 'refuse',
      key: target.key,
      slots: target.kind === 'slot' ? [target.slot] : rowDropSlots(role),
      reason: away,
    };
  }
  if (target.kind === 'slot') {
    const refusal = slotRefusal(rows, target.key, target.slot, employeeId);
    if (refusal === null) return { kind: 'place', key: target.key, slot: target.slot };
    return refusal === 'here'
      ? { kind: 'stay' }
      : { kind: 'refuse', key: target.key, slots: [target.slot], reason: 'full' };
  }
  // Somebody already on this row, dropped on it again but not on a slot: he stays where he sits — a
  // loose drop is no reason to move him from captain to specialist.
  if (seatOf(rows, employeeId)?.key === target.key) return { kind: 'stay' };
  const slots = rowDropSlots(role);
  const open = slots.find((slot) => slotRefusal(rows, target.key, slot, employeeId) === null);
  return open === undefined
    ? { kind: 'refuse', key: target.key, slots, reason: FULL_ROW[role] }
    : { kind: 'place', key: target.key, slot: open };
};

/**
 * Does the board take this dragenter/dragover? EXACTLY when it is our own drag — anywhere on the
 * board, whatever the browser shows of its `types`, whatever is under the pointer; the page then
 * cancels the event and leaves `dropEffect` alone. A drag that did not start on this page (a file, a
 * link, text from another window) is the browser's own business, untouched. Where the drop lands,
 * and whether that slot has room, is `resolveDrop`'s question AT the drop — never the dragover's,
 * whose answer the browser applies late (see the head of this file).
 */
export const acceptsDragOver = (draggedId: string | null): draggedId is string =>
  draggedId !== null;
