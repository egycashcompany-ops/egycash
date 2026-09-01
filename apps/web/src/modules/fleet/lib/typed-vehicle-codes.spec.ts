// Typing a list of vehicle codes, one keystroke at a time.
import { describe, expect, it } from 'vitest';
import { readTypedVehicleCodes } from './typed-vehicle-codes';

const read = (raw: string): [string[], string] => {
  const { chosen, typing } = readTypedVehicleCodes(raw);
  return [chosen, typing];
};

describe('a vehicle-code box being typed into', () => {
  it('holds the first code back while it is still being written', () => {
    expect(read('1')).toEqual([[], '1']);
    expect(read('15')).toEqual([[], '15']);
    expect(read('150')).toEqual([[], '150']);
  });

  it('takes a code the moment its separator is typed', () => {
    // The reported bug: `150 - ` used to go to the registry whole, match nothing, and answer "no
    // results" over a half-written list. Now 150 is chosen and the box is empty for the next one.
    expect(read('150 -')).toEqual([['150'], '']);
    expect(read('150 - ')).toEqual([['150'], '']);
    expect(read('150,')).toEqual([['150'], '']);
  });

  it('keeps taking them as the list grows', () => {
    expect(read('150 - 2')).toEqual([['150'], '2']);
    expect(read('150 - 215')).toEqual([['150'], '215']);
    expect(read('150 - 215 - ')).toEqual([['150', '215'], '']);
    expect(read('215 - 210 - 211 - 220 - 320')).toEqual([['215', '210', '211', '220'], '320']);
  });

  it('leaves a hyphenated code alone — the dash inside it is not a separator', () => {
    expect(read('A-15')).toEqual([[], 'A-15']);
    expect(read('A-15 - ')).toEqual([['A-15'], '']);
    expect(read('A-15 - FLT-2')).toEqual([['A-15'], 'FLT-2']);
  });

  it('takes everything when the text ends on a separator, however written', () => {
    expect(read('150;215;')).toEqual([['150', '215'], '']);
    expect(read('150 215 ')).toEqual([['150', '215'], '']);
  });

  it('drops a code written twice rather than choosing it twice', () => {
    expect(read('150 - 150 - ')).toEqual([['150'], '']);
  });

  it('has nothing to say about an empty box', () => {
    expect(read('')).toEqual([[], '']);
    expect(read('   ')).toEqual([[], '']);
  });
});
