// The settlement screens' dialog (§9.10): the shared `Dialog`, plus «focus returns to the opener
// when a dialog closes». The shared dialog leaves the focus where the browser puts it — on the page
// body once its panel is gone — and changing that for every module is not this work package's to
// do, so the settlement pages wrap it here.
//
// The opener is the element that held the focus when the dialog opened (the shared dialog moves
// no focus on open, and no settlement dialog auto-focuses a field). A menu item unmounts on its
// click, so `MenuButton` gives the focus back to its own button before the item runs; that button
// is then the opener. An opener that left the page meanwhile (a panel re-keyed by a save) is
// skipped.
import { useEffect, useRef, type ComponentProps } from 'react';
import { Dialog } from '../../../../shared/ui/Dialog';

/** Remembers what held the focus when `open` turned true, and focuses it again when it turns false. */
export const useReturnFocus = (open: boolean): void => {
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return undefined;
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    return () => {
      const element = opener.current;
      opener.current = null;
      if (element !== null && element.isConnected) element.focus();
    };
  }, [open]);
};

export const SettlementDialog = (props: ComponentProps<typeof Dialog>): JSX.Element | null => {
  useReturnFocus(props.open);
  return <Dialog {...props} />;
};
