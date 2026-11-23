// Tab kept inside a dialog — moved out of `CrewSwapDialog.tsx` (Round 32) when «الشحنات المسلَّمة»'s
// «تأكيد التسليم» (Round 33 B) needed the same window behaviour: one trap, not a copy.
import { useEffect, type RefObject } from 'react';
import { custodyTrapFocus } from '../../fleet/components/custody-dashboard-parts';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Tab kept inside the window (the vault reports' trap, `custodyTrapFocus`), the first box to fill
 * focused, and the focus handed back to what opened it. Hooked on an element INSIDE the panel: its
 * panel is the nearest `[role="dialog"]` — a board's `DesignDialog` (Round 32's swap) or the shared
 * `Dialog` (Round 33 B's «تأكيد التسليم»).
 */
export const useFocusTrap = (
  inside: RefObject<HTMLElement>,
  first: () => HTMLElement | null,
): void => {
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = (): HTMLElement | null =>
      inside.current?.closest<HTMLElement>('[role="dialog"]') ?? null;
    const stops = (): HTMLElement[] =>
      Array.from(panel()?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
    requestAnimationFrame(() => (first() ?? stops()[0])?.focus({ preventScroll: true }));
    let back = false;
    const trap = (active: Element | null, preventDefault?: () => void): void => {
      const box = panel();
      const list = stops();
      const head = list[0];
      const tail = list[list.length - 1];
      if (box === null || head === undefined || tail === undefined) return;
      const target = custodyTrapFocus<Element>({
        back,
        active,
        first: head,
        last: tail,
        inside: active !== null && box.contains(active),
      });
      if (!(target instanceof HTMLElement)) return;
      preventDefault?.();
      target.focus();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return;
      // Only the window on top keeps the focus — a dialog opened over it keeps its own.
      const roots = document.querySelectorAll('[data-dialog-root]');
      if (roots[roots.length - 1]?.contains(panel()) !== true) return;
      back = event.shiftKey;
      if (document.activeElement === document.body) return;
      trap(document.activeElement, () => event.preventDefault());
    };
    const onFocusIn = (event: FocusEvent): void => {
      const roots = document.querySelectorAll('[data-dialog-root]');
      if (roots[roots.length - 1]?.contains(panel()) !== true) return;
      if (event.target instanceof Node && panel()?.contains(event.target) === false) {
        trap(event.target instanceof Element ? event.target : null);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocusIn);
      if (opener?.isConnected === true) opener.focus({ preventScroll: true });
    };
    // Once for the window's life: who opened it, and where Tab goes round.
  }, []);
};
