// Reading a link written before the vehicle-code picker existed.
//
// The registry's vehicle filter used to be `?code=`, and it was a SUBSTRING: `?code=FLT21` meant
// "every car whose code contains FLT21". The picker that replaced it is exact. So the old text can
// mean either of the two controls that now exist, and which one depends on a fact about the
// registry rather than about the text:
//
//   • it NAMES a car        → the picker. `?code=FLT210` → `?vehicleCodes=FLT210`, the same rows.
//   • it names no car       → `search`, which is where substring lives now and spans code, plate,
//                             chassis and motor. `?code=FLT21` → `?search=FLT21`.
//
// Routing everything to `search` would widen a link that named one car into a search across four
// fields; routing everything to the picker would read a partial code exactly and find nothing. The
// lookup is what avoids both, and it is cheap: one registry search the page already knows how to do.
//
// An explicit value already on the link wins in either direction: it is the newer expression of the
// same intent, and overwriting it would discard what the reader last chose.

/**
 * The rewritten query string for a legacy registry link, or `null` when there is nothing to do.
 *
 * `namesAVehicle` is the registry's answer about the legacy value — the caller looks it up, so this
 * stays pure and the decision is assertable without rendering a page.
 */
export const migrateLegacyVehicleCodeParam = (
  sp: URLSearchParams,
  namesAVehicle: boolean,
): URLSearchParams | null => {
  const legacy = sp.get('code');
  if (legacy === null || legacy.trim() === '') return null;
  const next = new URLSearchParams(sp);
  next.delete('code');
  const key = namesAVehicle ? 'vehicleCodes' : 'search';
  if ((next.get(key) ?? '').trim() === '') next.set(key, legacy);
  return next;
};
