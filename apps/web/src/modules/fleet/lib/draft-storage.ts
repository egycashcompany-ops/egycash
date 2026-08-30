// An unsaved board survives a refresh — and nothing more than that.
//
// THE PROBLEM. Both roster boards hold their draft in `useState`, and the query cache is
// in-memory (no persister anywhere in this app), so a browser refresh took a morning's
// unsaved crew changes with it. Nothing was "cleared": nothing was ever written down.
//
// WHY sessionStorage AND NOT localStorage. The app already keeps preferences in
// `localStorage` — pinned modules, the queue you left behind — and those are the right
// lifetime for a preference: long-lived, and harmless if they outlive their moment. An
// unsaved draft is the opposite. `localStorage` would resurrect it days later, in another
// tab, on top of a board the server has since changed, and the reader would be looking at
// stale crew assignments presented as their own pending work. `sessionStorage` survives
// exactly the event we care about — a reload of this tab — and dies with the tab.
//
// WHAT THIS IS NOT. Persisting a draft is not saving it. Nothing here talks to the API,
// nothing here is a source of truth, and the server's board remains the only saved state.
// The draft is what the reader has not committed yet, held somewhere it can outlive a
// reload; «إلغاء» throws it away and a successful save clears it.

/** Guarded like the app's other storage helpers: private mode must not break a screen. */
const read = (key: string): unknown => {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    // Storage unavailable, or somebody left non-JSON under our key. A board that cannot
    // remember still works — it just starts from the server's answer, as it always did.
    return null;
  }
};

export const writeDraft = (key: string, rows: unknown): void => {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(rows));
  } catch {
    /* quota, or storage disabled — not remembering is not an error worth showing anyone */
  }
};

export const clearDraft = (key: string): void => {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    /* nothing to do and nothing worth saying */
  }
};

/** What an editable field holds: a reference to another record, or free text the reader typed. */
export type EditableKind = 'id' | 'text';

/** The editable fields of one board, each with the shape its stored values must have. */
export type EditableFields = Readonly<Record<string, EditableKind>>;

/**
 * The four facts a roster row lets a reader edit. Shared by both boards, which edit the same
 * four, so neither can drift into trusting a field the other checks.
 */
export const ROSTER_EDITABLE_FIELDS: EditableFields = {
  missionTypeId: 'id',
  driver1EmployeeId: 'id',
  driver2EmployeeId: 'id',
  notes: 'text',
};

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

/**
 * May this stored value be laid over the server's?
 *
 * THE RULE IS THE CONTRACT'S OWN, RESTATED — not a second, looser one. The server accepts an id
 * that is null or twenty-four hex characters, and a note that is null or one to five hundred
 * characters after trimming. Anything else it refuses, so restoring it would only put the reader
 * back where they started: a board that cannot be saved and does not say why.
 *
 * This is NOT validation moving to the client, and it does not relax anything. The server still
 * decides, and still refuses every value below. What this stops is the BOARD proposing a value
 * it can already see the server will reject — a value the reader never typed, that arrived from
 * a draft written by an older build of this screen.
 *
 * The strings that matter here are the ones that look like data and are not: `"undefined"` is
 * what a mapper produces from an absent field (this board's own bug, fixed server-side, but the
 * drafts it wrote survive in storage); `"null"` and `""` are the same mistake made by hand. All
 * three are ordinary strings that pass every type check and mean nothing.
 *
 * `"undefined"` as a NOTE is left alone: a note is free text, and a reader who typed that word
 * meant it.
 */
const usable = (kind: EditableKind, value: unknown): boolean => {
  // Nullable on both boards: "no mission", "no driver", "no note".
  if (value === null) return true;
  if (typeof value !== 'string') return false;
  if (kind === 'id') return OBJECT_ID.test(value);
  const text = value.trim();
  return text.length > 0 && text.length <= 500;
};

/**
 * The persisted draft for `key`, RECONCILED against the board the server just sent.
 *
 * Two things can be wrong with what comes out of storage, and both are ordinary rather than
 * exceptional, so neither throws:
 *
 *  • MALFORMED — not JSON, not an array, or entries that are not rows. Another tab, an older
 *    release of this screen, or a user who edited storage by hand. Answered with `null`: the
 *    board falls back to the server's own rows, which is exactly the behaviour before any of
 *    this existed.
 *  • UNUSABLE — a field holding something the server would refuse: `"undefined"`, `"null"`,
 *    `""`, a number, an object. Dropped FIELD BY FIELD, so the rest of the draft survives; the
 *    row keeps the server's own value for that field. A draft whose every field is dropped
 *    leaves the board equal to the server's, so it does not count as a draft and no unsaved
 *    banner appears over work nobody did and nobody could save.
 *  • STALE — rows for vehicles the board no longer has. A vehicle sold, or a reader whose
 *    scope changed between the edit and the reload. Those rows are DROPPED rather than
 *    restored, because a draft may only ever speak about vehicles that are actually on the
 *    board in front of the reader; sending one for a vehicle they cannot see is a save the
 *    server would refuse and the reader could not explain.
 *
 * The result is built by walking `saved`, not the stored array, so the restored draft always
 * has the board's own shape and order: every vehicle appears exactly once, new vehicles that
 * arrived since the edit come through with the server's values, and a duplicate or reordered
 * entry in storage cannot change what the board looks like.
 *
 * Returns `null` when there is nothing usable to restore — including when the restored board
 * would be identical to `saved`, since a draft equal to the server's answer is not a draft.
 */
export const readDraft = <T extends { vehicleId: string }>(
  key: string,
  saved: readonly T[],
  /**
   * The fields the reader may actually edit, each with the SHAPE its values must have — the only
   * ones taken from storage, and only when what is stored is usable.
   *
   * Everything else on a row is a fact about the world: the vehicle's code and plate, and
   * whether the workshop holds it today. A reload is exactly when those may have changed, and a
   * stale `inMaintenance: false` restored over the server's `true` would offer a drop that FR-5
   * then refuses. So a restore is a narrow overlay onto the server's row, not a merge of two.
   */
  editable: EditableFields,
): T[] | null => {
  const stored = read(key);
  if (!Array.isArray(stored) || stored.length === 0) return null;
  if (saved.length === 0) return null;

  const byVehicle = new Map<string, T>();
  for (const entry of stored) {
    if (entry === null || typeof entry !== 'object') return null;
    const vehicleId = (entry as { vehicleId?: unknown }).vehicleId;
    if (typeof vehicleId !== 'string' || vehicleId === '') return null;
    byVehicle.set(vehicleId, entry as T);
  }

  let differs = false;
  const rows = saved.map((row) => {
    const restored = byVehicle.get(row.vehicleId);
    if (restored === undefined) return row;
    // Built ON the server's row, taking an editable field from storage only when what is stored
    // is USABLE — see `usable`. A field that is missing, or holds something the server would
    // refuse, simply does not overwrite: the row keeps the server's own value for it, and the
    // rest of the draft is unaffected.
    const merged: Record<string, unknown> = { ...row };
    for (const [field, kind] of Object.entries(editable)) {
      if (!Object.hasOwn(restored, field)) continue;
      const value = (restored as Record<string, unknown>)[field];
      if (!usable(kind, value)) continue;
      merged[field] = value;
    }
    if (JSON.stringify(merged) !== JSON.stringify(row)) differs = true;
    return merged as T;
  });

  return differs ? rows : null;
};

/** Where one board's draft lives. The Fixed Roster has no date, and must not invent one. */
export const FIXED_ROSTER_DRAFT_KEY = 'ecms.fleet.fixedRoster.draft';

/**
 * The daily board's key CARRIES THE DATE, and that is the whole of the cross-day guarantee.
 *
 * A day's draft belongs to that day. Keying without the date would hand the 2nd of September
 * the crew somebody typed for the 1st — the same class of bug as serving one date's board for
 * another, which this module already fixed once in the query layer. Callers read through a
 * memo on this key, so switching the date re-reads storage rather than reusing what is in
 * hand, and switching back finds that day's own draft still there.
 */
export const rosterDraftKey = (date: string): string => `ecms.fleet.roster.draft.${date}`;
