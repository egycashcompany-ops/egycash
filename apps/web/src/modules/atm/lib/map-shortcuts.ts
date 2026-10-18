// The zone editor's keyboard shortcuts (docs/12-planning/atm-map-zones.md §8.5, §8.11, DM-41).
//
// BY `KeyboardEvent.code`, NOT `key`: the physical key, so N, Z and Y work on an Arabic layout,
// where `key` would be «ى», «ئ» and «غ».
//
// NOTHING ACTS INSIDE A FIELD OR BEHIND A MODAL. In the zone-name field Ctrl+Z undoes text, not the
// last gesture; with a dialog or a side layer open, Esc closes only that, and Delete or Ctrl+Z must
// never change a zone the reader cannot see.
//
// The answer is what the key means, not what it does: Backspace removes the last dot while drawing
// and the selected vertex while editing, and the page picks by its mode.

export type MapShortcut =
  | { kind: 'newZone' }
  | { kind: 'finish' }
  | { kind: 'cancel' }
  /** Backspace or Delete. */
  | { kind: 'removePoint' }
  | { kind: 'undo' }
  | { kind: 'redo' }
  /** An arrow: 1 px, or 10 px with Shift (DM-41). */
  | { kind: 'nudge'; dx: number; dy: number };

/** The parts of a `KeyboardEvent` read here. */
export interface ShortcutEvent {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  target: unknown;
}

interface TargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
}

const isTypingTarget = (target: unknown): boolean => {
  if (typeof target !== 'object' || target === null) return false;
  const el = target as TargetLike;
  const tag = (el.tagName ?? '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable === true) return true;
  return typeof el.closest === 'function' && el.closest('[contenteditable]') !== null;
};

const ARROWS: Readonly<Record<string, [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export const shortcutFor = (
  event: ShortcutEvent,
  { modalOpen }: { modalOpen: boolean },
): MapShortcut | null => {
  if (modalOpen || isTypingTarget(event.target)) return null;
  const command = event.ctrlKey || event.metaKey;

  if (command && !event.altKey) {
    if (event.code === 'KeyZ') return event.shiftKey ? { kind: 'redo' } : { kind: 'undo' };
    if (event.code === 'KeyY' && event.ctrlKey && !event.shiftKey) return { kind: 'redo' };
    return null;
  }
  if (command || event.altKey) return null;

  const arrow = ARROWS[event.code];
  if (arrow !== undefined) {
    const step = event.shiftKey ? 10 : 1;
    return { kind: 'nudge', dx: arrow[0] * step, dy: arrow[1] * step };
  }
  if (event.shiftKey) return null;
  switch (event.code) {
    case 'KeyN':
      return { kind: 'newZone' };
    case 'Enter':
    case 'NumpadEnter':
      return { kind: 'finish' };
    case 'Escape':
      return { kind: 'cancel' };
    case 'Backspace':
    case 'Delete':
      return { kind: 'removePoint' };
    default:
      return null;
  }
};
