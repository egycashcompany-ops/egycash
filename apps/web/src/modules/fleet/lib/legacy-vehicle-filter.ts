// Reading a link written before the vehicle-code picker existed.
//
// The registry's vehicle filter used to be `?code=`, and it was a SUBSTRING: `?code=FLT21` meant
// "every car whose code contains FLT21". The picker that replaced it is exact, so sending that
// text on to `vehicleCodes` would answer a different question — and answer it with nothing, since
// no car is called `FLT21`.
//
// Substring over identifiers is `search`'s job, and always was: it spans code, plate, chassis and
// motor. So the link is rewritten to the control that still means what it meant. Once, in place,
// so the URL afterwards says what it now does — a link that keeps working but keeps lying about
// which filter is on is worse than one that fails loudly.
//
// An explicit `search` already on the link wins: it is the newer expression of the same intent,
// and overwriting it would discard what the reader last chose.

/**
 * The rewritten query string for a legacy registry link, or `null` when there is nothing to do.
 *
 * Pure, and returns the whole next `URLSearchParams` rather than mutating: the caller applies it
 * with `replace`, and a decision this small should be assertable without rendering a page.
 */
export const migrateLegacyVehicleCodeParam = (sp: URLSearchParams): URLSearchParams | null => {
  const legacy = sp.get('code');
  if (legacy === null || legacy.trim() === '') return null;
  const next = new URLSearchParams(sp);
  next.delete('code');
  if ((next.get('search') ?? '').trim() === '') next.set('search', legacy);
  return next;
};
