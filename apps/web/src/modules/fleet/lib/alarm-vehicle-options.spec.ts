import { describe, expect, it } from 'vitest';
import { alarmVehicleOptions } from './alarm-vehicle-options';

const v = (code: string) => ({ code });
const values = (...args: Parameters<typeof alarmVehicleOptions>): string[] =>
  alarmVehicleOptions(...args).map((o) => o.value);

describe('alarmVehicleOptions', () => {
  it('offers every car the board reports, labelled by its code', () => {
    expect(alarmVehicleOptions([v('150'), v('151')], [])).toEqual([
      { value: '150', label: '150' },
      { value: '151', label: '151' },
    ]);
  });

  it('orders the codes as NUMBERS, so 9 comes before 150 and 150 before 1500', () => {
    expect(values([v('1500'), v('9'), v('150')], [])).toEqual(['9', '150', '1500']);
  });

  it('offers a car once, however many rows the board has for it', () => {
    expect(values([v('150'), v('150')], [])).toEqual(['150']);
  });

  // ── the guarantee the picker's search rests on ────────────────────────────

  it('KEEPS a selected code the board no longer reports, so it can still be un-ticked', () => {
    // Without this row the filter is a thing you can set but not unset: the trigger still names
    // the car — `selectionSummary` falls back to the bare value — but the list has nothing to
    // click, so the reader cannot take it off.
    expect(values([v('150')], ['999'])).toEqual(['999', '150']);
  });

  it('keeps the orphans FIRST, so what you can turn off is never below a scroll', () => {
    expect(values([v('150'), v('151')], ['999', '998'])).toEqual(['999', '998', '150', '151']);
  });

  it('offers a selected code exactly once when the board reports it too', () => {
    expect(values([v('150'), v('151')], ['150'])).toEqual(['150', '151']);
  });

  it('never drops a selection, whatever the board says — the property, exhaustively', () => {
    // This is what makes searching safe: narrowing hides options, never selections, and every
    // selection still has a row waiting when the search is cleared.
    const boards = [[], [v('150')], [v('150'), v('161')], [v('900'), v('901')]];
    const selections = [[], ['150'], ['150', '161'], ['999'], ['150', '999'], ['999', '150']];
    for (const board of boards) {
      for (const selected of selections) {
        const offered = new Set(values(board, selected));
        for (const code of selected) {
          expect(
            offered.has(code),
            `${code} is offered against board ${JSON.stringify(board)}`,
          ).toBe(true);
        }
      }
    }
  });

  it('offers nothing when there is nothing to offer', () => {
    expect(alarmVehicleOptions([], [])).toEqual([]);
  });

  it('offers a repeated URL code once', () => {
    expect(values([], ['150', '150'])).toEqual(['150']);
  });
});
