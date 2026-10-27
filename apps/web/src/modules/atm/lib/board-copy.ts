// What a board gives a reader who copies it — «مش عايز كل الأعمدة تبقي Selectable عايز بس البنك
// والكود واسم الماكينة وتوقيت التغذية» (2026-10-27).
//
// The table is unselectable as a whole and only the copy columns take a selection back
// (`select-none` around it, `select-text` on those cells), so a drag across the rows picks up the
// bank, the code, the name and the time — and Chromium copies exactly those, a tab between cells
// and a line per row, ready to paste into a sheet or a message. Nothing else on a row — its box,
// its timer, its buttons — comes along.
//
// Ctrl+A (⌘A) outside a field selects the table's rows the same way: «Select All» of the data,
// without the buttons.
import { useEffect, type RefObject } from 'react';

/** The classes that make a column one a reader copies. */
export const COPY_COLUMN_CLASS = 'select-text';
/** The class around the table that keeps every other cell out of a selection. */
export const COPY_TABLE_CLASS = 'select-none';

interface TypingTarget {
  tagName?: string;
  isContentEditable?: boolean;
}

/** Pure: a key press a field owns — Ctrl+A in the codes box selects its text, not the board. */
export const isTypingTarget = (target: unknown): boolean => {
  if (typeof target !== 'object' || target === null) return false;
  const el = target as TypingTarget;
  const tag = (el.tagName ?? '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
};

/** Pure: is this press the board's «select all»? By the physical key, so it works on an Arabic layout. */
export const isSelectAllPress = (event: {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: unknown;
}): boolean =>
  event.code === 'KeyA' &&
  (event.ctrlKey || event.metaKey) &&
  !event.altKey &&
  !isTypingTarget(event.target);

/** Ctrl+A selects the rows of the table under `ref` — while `enabled` (no dialog up). */
export const useSelectBoardText = (ref: RefObject<HTMLElement | null>, enabled: boolean): void => {
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (!isSelectAllPress(event)) return;
      const body = ref.current?.querySelector('tbody');
      if (body === null || body === undefined) return;
      event.preventDefault();
      const selection = window.getSelection();
      if (selection === null) return;
      const range = document.createRange();
      range.selectNodeContents(body);
      selection.removeAllRanges();
      selection.addRange(range);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ref, enabled]);
};
