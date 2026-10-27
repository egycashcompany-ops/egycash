// The open boards' «select all», kept out of reach until asked for — «شيل الـ Select all من فوق
// الجدول … خليها تظهر فقط عند الضغط على F8 … بس تختفى لو مدوستش عليها ودوست على اى حاجة تانية»
// (2026-10-27). The row boxes stay; the head's box appears on F8 — with the focus, so Space checks
// it without a mouse — and goes again at the next press or click on anything but itself. Checking
// it selects the view's rows and the bulk bar appears as it always did — the owner's answer to how
// F8 behaves («F8 يظهر تحديد الكل بس»).
import { useEffect, useState } from 'react';

/** The attribute the shared table puts on its head box — a click there keeps it shown. */
export const SELECT_ALL_ATTRIBUTE = 'data-table-select-all';

/** Keys that never count as «anything else»: held on their own, they press nothing. */
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock']);

interface ClosestTarget {
  closest?: (selector: string) => unknown;
}

/** Is this event's target the box itself? */
const onTheBox = (target: unknown): boolean => {
  const el = target as ClosestTarget | null;
  return typeof el?.closest === 'function' && el.closest(`[${SELECT_ALL_ATTRIBUTE}]`) !== null;
};

/**
 * Pure: what one key press does to the box. F8 shows it; a modifier alone leaves it; Space or Enter
 * ON the box — which F8 gives the focus — is using it, not «something else»; any other key hides it.
 */
export const revealOnKey = (key: string, target: unknown = null): 'show' | 'keep' | 'hide' => {
  if (key === 'F8') return 'show';
  if (MODIFIERS.has(key)) return 'keep';
  if ((key === ' ' || key === 'Enter') && onTheBox(target)) return 'keep';
  return 'hide';
};

/** Pure: a press ON the box keeps it; a press anywhere else hides it. */
export const revealOnPointer = (target: unknown): 'keep' | 'hide' =>
  onTheBox(target) ? 'keep' : 'hide';

/**
 * Is the head's box shown? Listening only while `enabled` — a dialog open on the board is its own
 * screen, and the box is hidden while it is up.
 */
export const useSelectAllReveal = (enabled: boolean): boolean => {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setShown(false);
      return undefined;
    }
    const onKey = (event: KeyboardEvent): void => {
      const action = revealOnKey(event.key, event.target);
      if (action === 'show') {
        event.preventDefault();
        setShown(true);
      } else if (action === 'hide') {
        setShown(false);
      }
    };
    const onPointer = (event: PointerEvent): void => {
      if (revealOnPointer(event.target) === 'hide') setShown(false);
    };
    window.addEventListener('keydown', onKey);
    // Capture, so a control that stops the event on its way up still counts as «something else».
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, [enabled]);
  // F8 puts the focus on the box it reveals, so Space can use it without a mouse.
  useEffect(() => {
    if (!shown) return;
    document.querySelector<HTMLInputElement>(`[${SELECT_ALL_ATTRIBUTE}]`)?.focus();
  }, [shown]);
  return shown;
};
