// Turning a registry SEARCH into the options a code picker offers.
//
// The registry outgrows any single page, so a picker cannot hold it: the options are whatever the
// server matched for what the user typed, a shortlist at a time. That has one consequence worth
// naming, and it is the whole reason this file exists — the answer changes as the user types, so a
// code already CHOSEN drops out of it the moment the search moves on. Without merging the
// selection back in, a chosen code has no row left to un-tick, and the filter becomes a thing you
// can set but not unset.
//
// Kept out of the components because it is the part with a rule in it, and the part a node-env
// test can reach: a closed dropdown renders no options at all.

export interface VehicleCodeOption {
  value: string;
  label: string;
}

export interface VehicleSummary {
  code: string;
  plateNumber: string;
}

/** `150 — س ص 150`: the code the operator knows the car by, and the plate that confirms it. */
export const vehicleCodeLabel = (vehicle: VehicleSummary): string =>
  `${vehicle.code} — ${vehicle.plateNumber}`;

/**
 * The search's answer, with every already-selected code kept in front of it.
 *
 * A selected code the search did not return is shown bare — the registry did not send a plate for
 * it this time, and inventing one would be worse than the code alone. Order puts the selection
 * first so the things you can turn OFF are never below a scroll.
 */
export const vehicleCodeOptions = (
  matched: readonly VehicleSummary[],
  selected: readonly string[],
): VehicleCodeOption[] => {
  const found = matched.map((vehicle) => ({
    value: vehicle.code,
    label: vehicleCodeLabel(vehicle),
  }));
  const shown = new Set(found.map((option) => option.value));
  const kept = selected
    .filter((code) => !shown.has(code))
    // A code can only be selected once, however many times the URL repeats it.
    .filter((code, at, all) => all.indexOf(code) === at)
    .map((code) => ({ value: code, label: code }));
  return [...kept, ...found];
};
