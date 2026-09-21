// CARRYING DRIVER FINES ONTO A CAR'S STATEMENT — the contract between the two halves of the
// violations screen, and the one rule the gesture has.
//
// «ممكن أعمل مالتي تشيك على أكتر من سواق وأخدهم دراج وأحطهم دروب على العربية نفسها». The fines
// are ticked on the left half and dropped on a group in the right half; the two panels are
// siblings that share nothing but the page, so the payload travels on `dataTransfer` exactly as
// the roster boards' single driver id does. Nothing is lifted into the page to make it work.
//
// It is here, beside its own test, rather than inside either panel: what a drag CARRIES and which
// group may RECEIVE it are rules, and a rule written inside a component is a rule that can only
// be checked by rendering one.

/** The `dataTransfer` type. Its own, so a roster driver cannot be dropped on a violations group. */
export const VIOLATION_DRAG_TYPE = 'application/x-ecms-violations';

/**
 * WHAT A ROW DRAGS.
 *
 * Dragging a row that is part of the selection drags the WHOLE selection — that is what ticking
 * four rows and pulling one of them means. Dragging a row that is not selected drags just that
 * row, and leaves the selection alone: picking up an unticked row is not a silent way to discard
 * what was ticked.
 */
export const draggedIds = (rowId: string, selected: ReadonlySet<string>): string[] =>
  selected.has(rowId) ? [...selected] : [rowId];

/** Read back what a drag carried. Anything that is not our own payload is not a drag we know. */
export const readDraggedIds = (raw: string): string[] => {
  if (raw === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string' && id !== '');
  } catch {
    return [];
  }
};

/**
 * MAY THIS GROUP RECEIVE A DROP?
 *
 * Three ways it may not, and each is a real row on the board:
 *   • no grant — moving a fine is a correction of where it is counted, so it is the EDIT grant.
 *   • a group from the old book, on a car the registry never had: it has no id any write accepts,
 *     so accepting the drop would be promising a 422.
 *   • nothing being dragged, which is every drag that came from somewhere else on the page.
 *
 * The caller must consult this in BOTH `dragover` and `drop` — styling a refusal without with-
 * holding `preventDefault` leaves a target that looks closed and still takes the drop.
 */
export const canReceive = (group: { vehicleId: string | null }, may: boolean): boolean =>
  may && group.vehicleId !== null;
