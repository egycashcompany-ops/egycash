// «توزيع المحصنات» — what a drag carries, where it may land and what the drop does there (Round 25).
//
// THE OWNER: «لما بعمل دراج و دروب لل محصنة على العربيه مش بتتحط بتتحط فى حالة دوست على نقل الى بس غير
// كدا مفيش حاجه بتتغير». Dropped on a van, the محصنة sprang back; only «نقل إلى…» moved it.
//
// THE CAUSE, measured with REAL OS drags (XTEST under Xvfb, Chromium's own drag loop): the screen had
// kept, since Round 12, the very gates Round 22 took off «لوحة التشغيلة» (`crew-drag.ts`):
//   · ONLY THE CARDS ACCEPTED. A van card and the left column answered a dragover with «yes»; the
//     grid's gaps between the cards, the column's padding and head, the toolbar answered «no».
//     Chromium keeps «is a drop accepted here» as the answer to the LAST dragover the page answered
//     (asynchronously), so a hand that crosses a gap and lets go the moment it reaches a van is
//     refused on the gap's stale «no» — the drop never fires, the card springs back. At 6× CPU (a
//     slow office PC) 4 of 6 real drags were refused that way; the log ends on a «yes» dragover on
//     the van, then `dragleave` and `dragend` with `dropEffect` none, and no `drop`.
//   · THE OWN TYPE WAS ASKED FOR on every dragover (`dataTransfer.types` listing our private MIME
//     type). On a Windows PC whose hook passes only the standard formats — Round 22's finding on the
//     owner's own machine — that refuses EVERY van, every time: exactly «مش بتتحط», with «نقل إلى…»
//     (no drag at all) the one way left.
//   · STATE WAS SET IN `dragstart` (the dragged card faded, every van re-drawn armed) before the
//     browser took the drag over, and the drop read the dragged id from that render.
//
// THE FIX — the crew board's, point for point:
//   · WHO IS DRAGGED is our own `dragstart`'s (a ref the page keeps), never the browser's `types`;
//   · THE WHOLE SCREEN ACCEPTS our drag — every dragenter/dragover of it on the page's frame is
//     answered «yes» (`acceptsShipmentDragOver`), so the browser's last answer is «yes» from the first
//     dragover to the last; what the drop DOES is decided AT THE DROP from what is under the pointer
//     (`dropTargetFromMarks`, then `resolveShipmentDrop`): anywhere on a van card — its head, the
//     captain's line, the empty load, a chip already on it — is that van; anywhere on the left column,
//     its head included (folded on a phone), takes it off its van; anywhere else does nothing;
//   · NO `dropEffect` IS NAMED, and the source allows `copyMove` (`beginShipmentDrag`);
//   · NOTHING IS DRAWN IN `dragstart`: the page draws the drag (the faded card, the armed vans) one
//     task after the first dragover was answered;
//   · A REFUSAL IS SAID — a van without a captain, a row that is not «محصنة» — never only a card that
//     springs back.
//
// The page keeps the DOM half (reading the marks under the pointer, the events); every decision is
// here, pure, and pinned in `distribution-drag.spec.ts`.
import { type DragSourceData } from './crew-drag';

/** What a drag carries — our own type, so a file or a link dragged over a van is told apart. */
export const SHIPMENT_DRAG_TYPE = 'application/x-ecms-secured-shipment';

/**
 * What a card's `dragstart` writes, and ONLY that — no state (see the head of this file):
 *   · the id under our own type, and as `text/plain` — the one format every browser, OS and hook
 *     carries;
 *   · `copyMove`, not `move`: a hook that takes MOVE away from a drag's allowed effects leaves a
 *     `move`-only drag with none at all, which every target refuses. Nothing is ever copied.
 */
export const beginShipmentDrag = (data: DragSourceData, shipmentId: string): void => {
  data.setData(SHIPMENT_DRAG_TYPE, shipmentId);
  data.setData('text/plain', shipmentId);
  data.effectAllowed = 'copyMove';
};

/**
 * Which shipment a drop carries: our own drag's id first (the page's ref), then our type, then
 * `text/plain` — the first one that is a shipment of the screen. A text dragged in from another
 * window is none, and drops nothing.
 */
export const droppedShipment = (
  carried: { own: string | null; custom: string; text: string },
  known: (shipmentId: string) => boolean,
): string | null => {
  for (const candidate of [carried.own ?? '', carried.custom, carried.text]) {
    const id = candidate.trim();
    if (id !== '' && known(id)) return id;
  }
  return null;
};

/**
 * Does the screen take this dragenter/dragover? EXACTLY when it is our own drag — anywhere on the
 * screen, whatever the browser shows of its `types`. The page then cancels the event and leaves
 * `dropEffect` alone. A drag that did not start on this page (a file, a link, a text from another
 * window) is the browser's own business.
 */
export const acceptsShipmentDragOver = (draggedId: string | null): draggedId is string =>
  draggedId !== null;

// ── Where a drop lands ─────────────────────────────────────────────────────────────────────────────

/** What is under the pointer: a van card (a crew row of the day), or the column of the unplaced. */
export type ShipmentDropTarget = { kind: 'van'; crewAssignmentId: string } | { kind: 'unplaced' };

/**
 * The target, from the marks the screen draws around the element under the pointer: the nearest
 * van card (`data-drop-van` — its crew row id) wins over the column it stands in; the left column
 * (`data-drop-unplaced`) takes it off its van. Null — not a target (the toolbar, the day bar, the
 * vans' column between the cards).
 */
export const dropTargetFromMarks = (marks: {
  van: string | null;
  unplaced: boolean;
}): ShipmentDropTarget | null => {
  if (marks.van !== null && marks.van !== '') return { kind: 'van', crewAssignmentId: marks.van };
  if (marks.unplaced) return { kind: 'unplaced' };
  return null;
};

/** A target as one string — the page's «under the pointer» state, which a repeated dragover keeps. */
export const dropTargetKey = (target: ShipmentDropTarget | null): string | null =>
  target === null ? null : target.kind === 'van' ? `van|${target.crewAssignmentId}` : 'unplaced';

/** Why a drop is refused, each said in its own words. */
export type ShipmentDropRefusal = 'noCaptain' | 'notSecured';

/**
 * The words of a refused drop, as a toast: the van as its TITLE and the whole reason as its
 * DESCRIPTION. The toaster cuts a title to one line (`truncate`), and «السيارة 106: هذا الصف ليس من
 * نوع محصنة، فلا يأخذ …» lost the end of the reason that way; a description wraps, so the reason is
 * read to its last word.
 */
export const dropRefusalToast = (
  reason: ShipmentDropRefusal,
  vanName: string,
  t: (key: string) => string,
): { title: string; description: string } => ({
  title: vanName,
  description: t(
    reason === 'notSecured'
      ? 'operations.distribution.notSecuredDrop'
      : 'operations.distribution.noCaptainDrop',
  ),
});

/**
 * What a drop does — the drag's, and the same answer «نقل إلى…» gives:
 *   · `place` — onto that van (with the van's first captain, or the one it already has there);
 *   · `unplace` — off its van (dropped on the left column);
 *   · `refuse` — the van takes no shipment: it has no captain («بلا قائد»), or (Round 25) it is a
 *     row of another type listed only for what it already carries («ليس من نوع محصنة»);
 *   · `stay` — nothing to do: dropped where it already is, off the targets, or a held leg.
 */
export type ShipmentDropDecision =
  | { kind: 'place'; crewAssignmentId: string }
  | { kind: 'unplace' }
  | { kind: 'refuse'; crewAssignmentId: string; reason: ShipmentDropRefusal }
  | { kind: 'stay' };

/** The facts of a van the drop reads. */
export interface DropVan {
  crewAssignmentId: string;
  captains: readonly unknown[];
  /** Round 25 — a row of the «محصنة» type; false: listed only for what it already carries. */
  securedType: boolean;
}

/**
 * The decision for a shipment `at` a van (or null — on none), dropped on `target`. `held` — its
 * captain has started the leg in the app: it moves nowhere (the card is not draggable then; this is
 * the last word). A van the screen no longer lists is no target. `savedAt` — the row its SAVED leg
 * is on (`placedCrewAssignmentId`): a row that is not «محصنة» still takes it BACK there, as the save
 * does (its keep rule — the leg already on that very row); it takes no other.
 */
export const resolveShipmentDrop = (
  at: string | null,
  target: ShipmentDropTarget | null,
  vanOf: (crewAssignmentId: string) => DropVan | undefined,
  held = false,
  savedAt: string | null = null,
): ShipmentDropDecision => {
  if (target === null || held) return { kind: 'stay' };
  if (target.kind === 'unplaced') return at === null ? { kind: 'stay' } : { kind: 'unplace' };
  if (target.crewAssignmentId === at) return { kind: 'stay' };
  const van = vanOf(target.crewAssignmentId);
  if (van === undefined) return { kind: 'stay' };
  if (!van.securedType && van.crewAssignmentId !== savedAt) {
    return { kind: 'refuse', crewAssignmentId: van.crewAssignmentId, reason: 'notSecured' };
  }
  if (van.captains.length === 0) {
    return { kind: 'refuse', crewAssignmentId: van.crewAssignmentId, reason: 'noCaptain' };
  }
  return { kind: 'place', crewAssignmentId: van.crewAssignmentId };
};
