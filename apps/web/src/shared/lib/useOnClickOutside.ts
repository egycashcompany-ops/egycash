// Close-on-outside-click for popovers/menus/drawers. No-op while `active` is false.
import { useEffect, type RefObject } from 'react';

export const useOnClickOutside = (
  ref: RefObject<HTMLElement | null>,
  handler: () => void,
  active = true,
): void => {
  useEffect(() => {
    if (!active) return;
    const listener = (event: MouseEvent | TouchEvent): void => {
      const el = ref.current;
      if (el === null || el.contains(event.target as Node)) return;
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
