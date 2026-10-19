// The editor's shortcuts (spec §9.4): by physical key (`code`), so an Arabic layout works; never
// inside a field; never behind a modal; Ctrl+Shift+Z and Ctrl+Y redo.
import { describe, expect, it } from 'vitest';
import { shortcutFor, type ShortcutEvent } from './map-shortcuts';

const MAP = { tagName: 'DIV', isContentEditable: false, closest: () => null };

const key = (code: string, extra: Partial<ShortcutEvent> = {}): ShortcutEvent => ({
  code,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  target: MAP,
  ...extra,
});

const open = { modalOpen: false };

describe('shortcutFor', () => {
  it('maps KeyN by its code, whatever the layout typed (an Arabic «ى»)', () => {
    expect(shortcutFor({ ...key('KeyN'), ...{ key: 'ى' } }, open)).toEqual({ kind: 'newZone' });
  });

  it('maps Enter, Escape, Backspace and Delete', () => {
    expect(shortcutFor(key('Enter'), open)).toEqual({ kind: 'finish' });
    expect(shortcutFor(key('Escape'), open)).toEqual({ kind: 'cancel' });
    expect(shortcutFor(key('Backspace'), open)).toEqual({ kind: 'removePoint' });
    expect(shortcutFor(key('Delete'), open)).toEqual({ kind: 'removePoint' });
  });

  it('undo and redo: Ctrl/⌘+Z, Ctrl+Shift+Z, Ctrl+Y', () => {
    expect(shortcutFor(key('KeyZ', { ctrlKey: true }), open)).toEqual({ kind: 'undo' });
    expect(shortcutFor(key('KeyZ', { metaKey: true }), open)).toEqual({ kind: 'undo' });
    expect(shortcutFor(key('KeyZ', { ctrlKey: true, shiftKey: true }), open)).toEqual({
      kind: 'redo',
    });
    expect(shortcutFor(key('KeyY', { ctrlKey: true }), open)).toEqual({ kind: 'redo' });
  });

  it('arrows nudge 1 px, or 10 px with Shift (DM-41)', () => {
    expect(shortcutFor(key('ArrowLeft'), open)).toEqual({ kind: 'nudge', dx: -1, dy: 0 });
    expect(shortcutFor(key('ArrowDown', { shiftKey: true }), open)).toEqual({
      kind: 'nudge',
      dx: 0,
      dy: 10,
    });
  });

  it('maps nothing inside an input, a textarea, a select or an editable element', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(shortcutFor(key('KeyZ', { ctrlKey: true, target: { tagName } }), open)).toBeNull();
    }
    expect(
      shortcutFor(key('Delete', { target: { tagName: 'DIV', isContentEditable: true } }), open),
    ).toBeNull();
    const insideEditable = {
      tagName: 'SPAN',
      closest: (s: string) => (s === '[contenteditable]' ? {} : null),
    };
    expect(shortcutFor(key('Backspace', { target: insideEditable }), open)).toBeNull();
  });

  it('maps nothing while a dialog or a side layer is open', () => {
    expect(shortcutFor(key('Escape'), { modalOpen: true })).toBeNull();
    expect(shortcutFor(key('Delete'), { modalOpen: true })).toBeNull();
    expect(shortcutFor(key('KeyZ', { ctrlKey: true }), { modalOpen: true })).toBeNull();
  });

  it('leaves other combinations to the browser', () => {
    expect(shortcutFor(key('KeyN', { ctrlKey: true }), open)).toBeNull();
    expect(shortcutFor(key('KeyN', { altKey: true }), open)).toBeNull();
    expect(shortcutFor(key('KeyQ'), open)).toBeNull();
  });
});
