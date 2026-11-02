// Close-on-outside-click for popovers/menus/drawers. No-op while `active` is false.
//
// Several refs when the popover is not inside its anchor — a panel portalled to the page's body
// (`MultiSelect`'s `floating`): a press inside ANY of them is inside. Pass a stable array (a
// memo), or the listener is re-subscribed on every render.
import { useEffect, type RefObject } from 'react';

type Inside = RefObject<HTMLElement | null>;

export const useOnClickOutside = (
  ref: Inside | readonly Inside[],
  handler: () => void,
  active = true,
): void => {
  useEffect(() => {
    if (!active) return;
    const listener = (event: MouseEvent | TouchEvent): void => {
      const refs: readonly Inside[] = Array.isArray(ref) ? ref : [ref as Inside];
      const target = event.target as Node;
      const els = refs.map((one) => one.current).filter((el): el is HTMLElement => el !== null);
      if (els.length === 0 || els.some((el) => el.contains(target))) return;
      handler();
    };
    document.addEventListener('mousedown', listener);
    document.addEventListener('touchstart', listener);
    return () => {
      document.removeEventListener('mousedown', listener);
      document.removeEventListener('touchstart', listener);
    };
  }, [ref, handler, active]);
};
