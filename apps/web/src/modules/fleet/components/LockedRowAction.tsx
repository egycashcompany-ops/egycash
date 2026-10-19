// A row action the record no longer allows — a settled licence memo's pen and bin, the bin of a
// receipt a custody memo holds: the same icon in the same place, faded and not pressable, with the
// reason on hover.
//
// The reason sits on a wrapping span: the icon's square (`actionTone`) sets
// `disabled:pointer-events-none`, so a `title` on the disabled button itself would never show. The
// button carries the reason as its name too, for a screen reader, which never reaches the span.
import { type ReactNode } from 'react';
import { actionTone, type RowActionKind } from './row-actions-look';

export const LockedRowAction = ({
  kind,
  reason,
  mark,
  children,
}: {
  kind: RowActionKind;
  /** Why it is locked — formal Arabic, one line. */
  reason: string;
  /** `data-locked-action` — which action, for the specs and the shoot scripts. */
  mark: string;
  /** The icon, as the unlocked action draws it. */
  children: ReactNode;
}): JSX.Element => (
  <span title={reason} data-locked-action={mark} className="inline-flex">
    <button type="button" disabled aria-label={reason} className={actionTone(kind)}>
      {children}
    </button>
  </span>
);
