// Typing a list of vehicle codes, one keystroke at a time.
import { describe, expect, it } from 'vitest';
import {
  canonicalVehicleCodes,
  finishTypedVehicleCodes,
  readTypedVehicleCodes,
} from './typed-vehicle-codes';

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

describe('a code with a space in it — «كورولا 1», «MG 2»', () => {
  // «لما باجى اعمل فلتر على اى عربيه من اللى بالعربى دى مش بيجيب العربيه»: the space after
  // «كورولا» ticked «كورولا» — a car nobody has — and left «1» in the box.
  it('does NOT take a word the moment a space follows it — a number may follow', () => {
    expect(read('كورولا ')).toEqual([[], 'كورولا ']);
    expect(read('MG ')).toEqual([[], 'MG ']);
    expect(read('كورولا   ')).toEqual([[], 'كورولا ']);
  });

  it('reads the word and its number as one code, still being written', () => {
    expect(read('كورولا 1')).toEqual([[], 'كورولا 1']);
    expect(read('بيجو 500')).toEqual([[], 'بيجو 500']);
  });

  it('takes «كورولا 1» whole once a separator follows it', () => {
    expect(read('كورولا 1 ')).toEqual([['كورولا 1'], '']);
    expect(read('كورولا 1,')).toEqual([['كورولا 1'], '']);
    expect(read('كورولا 1 - ')).toEqual([['كورولا 1'], '']);
    expect(read('كورولا 1 - كوستر 2')).toEqual([['كورولا 1'], 'كوستر 2']);
    expect(read('كورولا 1 - كوستر 2 ')).toEqual([['كورولا 1', 'كوستر 2'], '']);
  });

  it('takes the word alone when a hard separator or another word follows it', () => {
    expect(read('كولراى,')).toEqual([['كولراى'], '']);
    expect(read('كولراى - ')).toEqual([['كولراى'], '']);
    expect(read('كولراى -')).toEqual([['كولراى'], '']);
    expect(read('كولراى كور')).toEqual([['كولراى'], 'كور']);
    expect(read('كولراى كورولا ')).toEqual([['كولراى'], 'كورولا ']);
  });

  it('still takes a NUMBER at its space, and holds back only the word after it', () => {
    expect(read('150 ')).toEqual([['150'], '']);
    expect(read('150 كورولا ')).toEqual([['150'], 'كورولا ']);
    expect(read('150 كورولا 2 ')).toEqual([['150', 'كورولا 2'], '']);
  });

  it('holds a dashed word back too, and takes a dashed number at once', () => {
    expect(read('A-15 ')).toEqual([[], 'A-15 ']);
    expect(read('215-216 ')).toEqual([['215-216'], '']);
  });
});

describe('finishTypedVehicleCodes — Enter, or the list closing', () => {
  it('Enter takes whatever is left, word, number or both', () => {
    expect(finishTypedVehicleCodes('كورولا 1', 'enter')).toEqual(['كورولا 1']);
    expect(finishTypedVehicleCodes('كولراى ', 'enter')).toEqual(['كولراى']);
    expect(finishTypedVehicleCodes('150', 'enter')).toEqual(['150']);
    expect(finishTypedVehicleCodes('', 'enter')).toEqual([]);
  });

  it('closing takes a word left waiting for a number, and drops a fragment mid-word', () => {
    expect(finishTypedVehicleCodes('كولراى ', 'close')).toEqual(['كولراى']);
    expect(finishTypedVehicleCodes('كور', 'close')).toEqual([]);
    expect(finishTypedVehicleCodes('كورولا 1', 'close')).toEqual([]);
    expect(finishTypedVehicleCodes('   ', 'close')).toEqual([]);
  });
});

describe('canonicalVehicleCodes — a typed code ticks the row the list offers', () => {
  const offered = ['150', 'MG 2', 'كورولا 1', 'كورولا 2'];

  it('writes a typed code the way the list spells it', () => {
    expect(canonicalVehicleCodes(['mg 2'], offered)).toEqual(['MG 2']);
    expect(canonicalVehicleCodes(['كورولا  1'], offered)).toEqual(['كورولا 1']);
    expect(canonicalVehicleCodes(['150'], offered)).toEqual(['150']);
  });

  it('keeps a code the list does not offer as it was typed', () => {
    expect(canonicalVehicleCodes(['كورولا 9'], offered)).toEqual(['كورولا 9']);
    expect(canonicalVehicleCodes(['كورولا'], offered)).toEqual(['كورولا']);
  });
});
