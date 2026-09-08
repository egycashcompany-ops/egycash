// The two rules behind the drivers registry's «الاسم / كود الموظف» filter.
//
// Both are the kind that a component test cannot reach and a screenshot cannot see: a closed
// popover renders no options at all, and «this filter is narrower than it should be» looks exactly
// like «there are fewer drivers than you thought».
import { describe, expect, it } from 'vitest';
import {
  driverIdFilter,
  driverPickLabel,
  driverPickShortLabel,
  driverPickerOptions,
  type DriverPickOption,
} from './driver-filter-selection';

const person = (
  employeeId: string,
  name = `اسم ${employeeId}`,
  code = `CODE-${employeeId}`,
): DriverPickOption => ({ employeeId, name, code });

describe('how a driver reads in the picker', () => {
  it('names them by BOTH the name and the code', () => {
    expect(driverPickLabel(person('e1', 'محمود السيد', '001000125'))).toBe(
      'محمود السيد — 001000125',
    );
  });

  it('falls back to whichever half it has, and never renders blank', () => {
    expect(driverPickLabel({ employeeId: 'e1', name: '', code: '001000125' })).toBe('001000125');
    expect(driverPickLabel({ employeeId: 'e1', name: 'محمود', code: '' })).toBe('محمود');
    // Nothing loaded yet: the id is the only thing known, and it beats an empty chip.
    expect(driverPickLabel({ employeeId: 'e1', name: '', code: '' })).toBe('e1');
  });

  it('shortens to the NAME on the trigger, where there is one row for the whole selection', () => {
    expect(driverPickShortLabel(person('e1', 'محمود السيد', '001000125'))).toBe('محمود السيد');
    expect(driverPickShortLabel({ employeeId: 'e1', name: '  ', code: '001000125' })).toBe(
      '001000125',
    );
  });
});

describe('the options a picked driver stays visible in', () => {
  it('offers what the search matched', () => {
    const options = driverPickerOptions([person('e1'), person('e2')], [], new Map());
    expect(options.map((o) => o.value)).toEqual(['e1', 'e2']);
  });

  it('KEEPS a picked driver on offer when the search has moved past them', () => {
    // The failure this exists to prevent: the options are a live HR search, so the driver ticked a
    // moment ago drops out of the answer — and with them the row that un-ticks them. The filter
    // becomes one you can set and cannot unset.
    const known = new Map([['e9', person('e9', 'سالم', 'C-9')]]);
    const options = driverPickerOptions([person('e1')], ['e9'], known);
    expect(options.map((o) => o.value)).toEqual(['e9', 'e1']);
    expect(options[0]?.label, 'named from what is known, not as a bare id').toBe('سالم — C-9');
  });

  it('puts the selection FIRST, so what can be turned off is never below a scroll', () => {
    const options = driverPickerOptions(
      [person('a'), person('b'), person('c')],
      ['z'],
      new Map([['z', person('z')]]),
    );
    expect(options[0]?.value).toBe('z');
  });

  it('does not list a picked driver twice when the search matched them too', () => {
    const options = driverPickerOptions([person('e1')], ['e1'], new Map([['e1', person('e1')]]));
    expect(options.map((o) => o.value)).toEqual(['e1']);
  });

  it('picks a person once, however many times the URL repeats them', () => {
    const options = driverPickerOptions([], ['e1', 'e1', 'e1'], new Map());
    expect(options.map((o) => o.value)).toEqual(['e1']);
  });

  it('still names a picked driver whose record has not loaded', () => {
    const options = driverPickerOptions([], ['e7'], new Map());
    expect(options).toEqual([{ value: 'e7', label: 'e7', shortLabel: 'e7' }]);
  });
});

describe('the one id list the fleet query is asked for', () => {
  it('is null when nobody has been named — the list stays unnarrowed', () => {
    expect(driverIdFilter([], null)).toBeNull();
  });

  it('is the picked ids when only the picker is set', () => {
    expect(driverIdFilter(['a', 'b'], null)).toEqual(['a', 'b']);
  });

  it('is HR’s match when only the text boxes are set', () => {
    expect(driverIdFilter([], ['x', 'y'])).toEqual(['x', 'y']);
  });

  it('INTERSECTS them — «this driver, in that governorate» asks both questions', () => {
    // A union would widen a filter the reader narrowed; letting one win would drop the other.
    expect(driverIdFilter(['a', 'b', 'c'], ['b', 'c', 'd'])).toEqual(['b', 'c']);
  });

  it('keeps the order the reader PICKED, not the order HR happened to answer in', () => {
    expect(driverIdFilter(['c', 'a'], ['a', 'b', 'c'])).toEqual(['c', 'a']);
  });

  it('returns an EMPTY list — not null — when the two agree on nobody', () => {
    // The distinction the whole filter hangs on: `null` means «no filter» and would answer with
    // every driver, while `[]` means «nobody matches both» and must render an empty table.
    expect(driverIdFilter(['a'], ['b'])).toEqual([]);
  });

  it('an empty HR match stays empty even with drivers picked', () => {
    expect(driverIdFilter(['a', 'b'], [])).toEqual([]);
  });

  it('copies rather than aliasing, so a caller cannot mutate the filter it was handed', () => {
    const picked = ['a'];
    const result = driverIdFilter(picked, null);
    expect(result).not.toBe(picked);
  });
});
