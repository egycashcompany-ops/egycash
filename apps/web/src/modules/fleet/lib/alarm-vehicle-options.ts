// Turning the alarms BOARD into the options its car picker offers.
//
// The board is the whole fleet in one answer, so unlike the registry picker next door this one
// needs no search endpoint behind it — the codes are already here, and the component searches
// them locally. What it does need is the rule below, and the rule is the reason this file exists
// rather than living inline: a closed dropdown renders no options at all, so an inline version is
// a guarantee no node-env test can reach.
//
// The guarantee: EVERY selected code appears in the result. A code the board no longer reports —
// the URL names a car the projection has dropped — still gets a row, or there is nothing left to
// un-tick and the filter becomes a thing you can set but not unset. Which is also what makes the
// picker's search safe: narrowing the search hides options, never selections, and the selection
// always has a row waiting for it when the search is cleared.
import { type MultiSelectOption } from '../../../shared/ui/MultiSelect';

export interface AlarmVehicle {
  code: string;
}

/**
 * The board's codes, numerically ordered, with every already-selected code kept in front.
 *
 * Order puts the selection first so the things you can turn OFF are never below a scroll, and the
 * codes sort `9 < 150 < 1500` rather than as text.
 */
export const alarmVehicleOptions = (
  board: readonly AlarmVehicle[],
  selected: readonly string[],
): MultiSelectOption[] => {
  const onBoard = [...new Set(board.map((vehicle) => vehicle.code))].sort((a, b) =>
    a.localeCompare(b, 'en', { numeric: true }),
  );
  const shown = new Set(onBoard);
  const orphans = selected.filter((code) => !shown.has(code));
  // A code can only be offered once, however many times the URL repeats it.
  return [...new Set([...orphans, ...onBoard])].map((code) => ({ value: code, label: code }));
};
