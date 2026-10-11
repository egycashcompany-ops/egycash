// The coloured calendar is the only way a click opens a date box's picker once the browser's own
// indicator is hidden — so the call must never throw, and a browser that cannot open the picker
// must still leave the reader in the box to type the date.
import { describe, expect, it, vi } from 'vitest';
import { openDatePicker, type PickerBox } from './open-date-picker';

describe('openDatePicker', () => {
  it('asks the browser for the picker, with the focus in the box', () => {
    const order: string[] = [];
    const box = {
      focus: vi.fn(() => order.push('focus')),
      showPicker: vi.fn(() => order.push('picker')),
    };
    expect(openDatePicker(box)).toBe(true);
    expect(box.showPicker).toHaveBeenCalledTimes(1);
    expect(order, 'focused first, so typing and blur behave whatever the picker does').toEqual([
      'focus',
      'picker',
    ]);
  });

  it('falls back to the focus where the browser has no showPicker', () => {
    const box = { focus: vi.fn() };
    expect(openDatePicker(box)).toBe(false);
    expect(box.focus).toHaveBeenCalledTimes(1);
  });

  it('falls back to the focus, without throwing, when showPicker refuses', () => {
    const box = {
      focus: vi.fn(),
      showPicker: vi.fn(() => {
        throw new DOMException('cannot be used on immutable controls', 'InvalidStateError');
      }),
    };
    expect(() => openDatePicker(box)).not.toThrow();
    expect(openDatePicker(box)).toBe(false);
    expect(box.focus).toHaveBeenCalled();
    expect(box.showPicker).toHaveBeenCalled();
  });

  it('treats a showPicker that is not a function as missing', () => {
    const box = { focus: vi.fn(), showPicker: null };
    expect(openDatePicker(box as unknown as PickerBox)).toBe(false);
    expect(box.focus).toHaveBeenCalledTimes(1);
  });
});
