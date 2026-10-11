// «لما ادوس عليها تجبلى اختيار تاريخ» — the coloured calendar on a date box opens that box's own
// picker. Those boxes hide the browser's white indicator, so this call is the only press that
// brings the calendar up: where the browser has no `showPicker` (Firefox before 101, Safari before
// 16) or refuses it (a read-only box, no user gesture behind the call), the box is still focused,
// so the date can be typed by hand as it always could.

/** The two calls the opening needs: a real `<input>`, or a stand-in in a spec. */
export interface PickerBox {
  focus: () => void;
  showPicker?: () => void;
}

/**
 * Open a date (or month) box's calendar. The focus comes first, whatever the picker does next:
 * the keyboard lands in the box, and a box that turns back into its caption on blur (the notices'
 * «من» / «إلى») does so when the reader leaves it, not while the calendar is open.
 *
 * Returns whether the browser took the picker call — `false` means the focus is all it got.
 */
export const openDatePicker = (box: PickerBox): boolean => {
  box.focus();
  if (typeof box.showPicker !== 'function') return false;
  try {
    box.showPicker();
    return true;
  } catch {
    // Refused — an immutable box, a call with no press behind it, a cross-origin frame. The focus
    // stands, and typing works.
    return false;
  }
};
