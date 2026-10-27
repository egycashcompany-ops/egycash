// The open boards' two keys (2026-10-27): F8 shows the head's «select all», anything else hides it
// again; Ctrl+A outside a field selects the table's copy columns.
import { describe, expect, it } from 'vitest';
import { SELECT_ALL_ATTRIBUTE, revealOnKey, revealOnPointer } from './select-all-reveal';
import { isSelectAllPress, isTypingTarget } from './board-copy';

describe('the «select all» reveal', () => {
  it('F8 shows it; a modifier alone leaves it; any other key hides it', () => {
    expect(revealOnKey('F8')).toBe('show');
    expect(revealOnKey('Shift')).toBe('keep');
    expect(revealOnKey('Control')).toBe('keep');
    expect(revealOnKey('Escape')).toBe('hide');
    expect(revealOnKey('a')).toBe('hide');
    expect(revealOnKey('F9')).toBe('hide');
  });

  it('Space or Enter ON the box uses it — the keyboard’s way in — and does not hide it', () => {
    const box = {
      closest: (selector: string) => (selector === `[${SELECT_ALL_ATTRIBUTE}]` ? {} : null),
    };
    expect(revealOnKey(' ', box)).toBe('keep');
    expect(revealOnKey('Enter', box)).toBe('keep');
    expect(revealOnKey(' ', { closest: () => null })).toBe('hide');
    expect(revealOnKey('Tab', box)).toBe('hide');
  });

  it('a press ON the box keeps it; a press anywhere else hides it', () => {
    const on = {
      closest: (selector: string) => (selector === `[${SELECT_ALL_ATTRIBUTE}]` ? {} : null),
    };
    const elsewhere = { closest: () => null };
    expect(revealOnPointer(on)).toBe('keep');
    expect(revealOnPointer(elsewhere)).toBe('hide');
    expect(revealOnPointer(null)).toBe('hide');
  });

  it('is the attribute the shared table puts on its head box', () => {
    expect(SELECT_ALL_ATTRIBUTE).toBe('data-table-select-all');
  });
});

describe('Ctrl+A on a board', () => {
  const press = (over: Partial<Parameters<typeof isSelectAllPress>[0]> = {}) => ({
    code: 'KeyA',
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    target: { tagName: 'BODY' },
    ...over,
  });

  it('is Ctrl+A or ⌘A by the physical key — the Arabic layout’s «ش» included', () => {
    expect(isSelectAllPress(press())).toBe(true);
    expect(isSelectAllPress(press({ ctrlKey: false, metaKey: true }))).toBe(true);
    expect(isSelectAllPress(press({ ctrlKey: false }))).toBe(false);
    expect(isSelectAllPress(press({ altKey: true }))).toBe(false);
    expect(isSelectAllPress(press({ code: 'KeyS' }))).toBe(false);
  });

  it('leaves a field its own Ctrl+A — the codes box selects its text', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(isTypingTarget({ tagName })).toBe(true);
      expect(isSelectAllPress(press({ target: { tagName } }))).toBe(false);
    }
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: 'TD' })).toBe(false);
  });

  it('a ticked row’s box does not own it — Ctrl+A right after a tick still selects the board', () => {
    for (const type of ['checkbox', 'radio', 'button']) {
      expect(isTypingTarget({ tagName: 'INPUT', type })).toBe(false);
      expect(isSelectAllPress(press({ target: { tagName: 'INPUT', type } }))).toBe(true);
    }
    for (const type of ['text', 'search', 'date', 'datetime-local']) {
      expect(isTypingTarget({ tagName: 'INPUT', type })).toBe(true);
    }
  });
});
