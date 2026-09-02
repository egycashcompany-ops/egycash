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
  /** What the filter trigger says — the same thing the option says, now that both are the code. */
  shortLabel: string;
}

export interface VehicleSummary {
  code: string;
  plateNumber: string;
}

/**
 * `150`: the code, and nothing else.
 *
 * This used to read `150 — س ص 150`, on the reasoning that the plate confirms the car. In practice
 * it confirmed nothing anyone needed — the code IS how an operator names a car here — while making
 * every option twice as long, wrapping the narrow filter dropdowns, and putting a second identifier
 * in front of someone who came to pick the first. A vehicle offered for selection is offered by its
 * code across the whole application; the plate stays where it answers a question, on the rows and
 * detail screens that are about the car rather than about choosing one.
 *
 * `VehicleSummary` still carries `plateNumber` because callers pass whole vehicles and the registry
 * search matches on the plate — this decides what is DISPLAYED, not what is searched or stored.
 */
export const vehicleCodeLabel = (vehicle: VehicleSummary): string => vehicle.code;

/**
 * The search's answer, with every already-selected code kept in front of it.
 *
 * Order puts the selection first so the things you can turn OFF are never below a scroll.
 */
export const vehicleCodeOptions = (
  matched: readonly VehicleSummary[],
  selected: readonly string[],
): VehicleCodeOption[] => {
  const found = matched.map((vehicle) => ({
    value: vehicle.code,
    label: vehicleCodeLabel(vehicle),
    shortLabel: vehicle.code,
  }));
  const shown = new Set(found.map((option) => option.value));
  const kept = selected
    .filter((code) => !shown.has(code))
    // A code can only be selected once, however many times the URL repeats it.
    .filter((code, at, all) => all.indexOf(code) === at)
    .map((code) => ({ value: code, label: code, shortLabel: code }));
  return [...kept, ...found];
};
