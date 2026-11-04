// Typing a list of vehicle codes, one keystroke at a time.
import { describe, expect, it } from 'vitest';
import { triggerPress } from '../../../shared/ui/MultiSelect';
import {
  answersWaitingWord,
  canonicalVehicleCodes,
  finishAnsweredBox,
  finishTypedVehicleCodes,
  heldVehicleCodes,
  readAnsweredBox,
  readTypedVehicleCodes,
  waitingVehicleWord,
} from './typed-vehicle-codes';
import { narrowVehicleCodeOptions, registryVehicleCodeOptions } from './vehicle-code-options';

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

describe('the list closing BY ITS TRIGGER takes the waiting word too', () => {
  // On any «الكود» filter: open the list, type «كولراى » with its trailing space, click the
  // «كود السيارة» trigger. The trigger used to empty the box in the same batch as the close, so the
  // list's `onClose` found nothing to take — no chip, no filter — while a click outside did take it.
  // What the control does, step by step: the trigger press, then `onClose` with the box as it is.
  const closeByTrigger = (box: string, answered: string | null = null): string[] => {
    const press = triggerPress(true);
    expect(press.open).toBe(false);
    const left = press.searchAfresh ? '' : box;
    return finishAnsweredBox(left, 'close', answered);
  };

  it('ticks «كولراى» — the same as a click outside or Escape', () => {
    expect(closeByTrigger('كولراى ')).toEqual(['كولراى']);
    expect(finishAnsweredBox('كولراى ', 'close', null)).toEqual(['كولراى']);
  });

  it('still drops a fragment mid-word, and a word a pick answered', () => {
    expect(closeByTrigger('كور')).toEqual([]);
    expect(closeByTrigger('كورولا ', 'كورولا')).toEqual([]);
  });
});

describe('a pick ANSWERS the waiting word — never a junk «كورولا» chip after it', () => {
  // Type «كورولا » → the list offers «كورولا 1», «كورولا 2» → click «كورولا 1». Enter, or typing
  // «كوستر», used to tick «كورولا» as well — a car nobody has, beside the one just picked.
  it('knows a waiting word from anything else in the box', () => {
    expect(waitingVehicleWord('كورولا ')).toBe('كورولا');
    expect(waitingVehicleWord('MG ')).toBe('MG');
    expect(waitingVehicleWord('كورولا')).toBeNull();
    expect(waitingVehicleWord('كورولا 1')).toBeNull();
    expect(waitingVehicleWord('150 ')).toBeNull();
    expect(waitingVehicleWord('')).toBeNull();
  });

  it('a tick or an untick of a car the word found answers it', () => {
    expect(answersWaitingWord('كورولا ', ['150'], ['150', 'كورولا 1'])).toBe('كورولا');
    expect(answersWaitingWord('كورولا ', ['150', 'كورولا 1'], ['150'])).toBe('كورولا');
    expect(answersWaitingWord('mg ', [], ['MG 2'])).toBe('mg');
  });

  it('…and nothing else does: a car the word did not find, a box with no waiting word', () => {
    expect(answersWaitingWord('كورولا ', ['150', 'كوستر 1'], ['كوستر 1'])).toBeNull();
    expect(answersWaitingWord('كور', [], ['كورولا 1'])).toBeNull();
    expect(answersWaitingWord('', [], ['كورولا 1'])).toBeNull();
  });

  it('Enter after the pick takes nothing for the word', () => {
    expect(finishAnsweredBox('كورولا ', 'enter', 'كورولا')).toEqual([]);
    // Unanswered, Enter still takes it — «كولراى» is a car.
    expect(finishAnsweredBox('كولراى ', 'enter', null)).toEqual(['كولراى']);
  });

  it('typing the next word after the pick takes nothing for the word, and searches the new one', () => {
    expect(readAnsweredBox('كورولا ك', 'كورولا')).toEqual({
      chosen: [],
      typing: 'ك',
      answered: null,
    });
    expect(readAnsweredBox('كورولا , ', 'كورولا')).toEqual({
      chosen: [],
      typing: '',
      answered: null,
    });
    // Unanswered, the word is taken as before.
    expect(readAnsweredBox('كولراى ك', null).chosen).toEqual(['كولراى']);
  });

  it('the answer stands while the box still holds the word — so «كورولا 2» can be ticked too', () => {
    expect(readAnsweredBox('كورولا  ', 'كورولا')).toEqual({
      chosen: [],
      typing: 'كورولا ',
      answered: 'كورولا',
    });
  });

  it('typing the number makes it that car, to be taken as usual', () => {
    expect(readAnsweredBox('كورولا 2', 'كورولا')).toEqual({
      chosen: [],
      typing: 'كورولا 2',
      answered: null,
    });
    expect(finishAnsweredBox('كورولا 2', 'enter', null)).toEqual(['كورولا 2']);
    expect(readAnsweredBox('كورولا 2 ', 'كورولا').chosen).toEqual(['كورولا 2']);
  });
});

describe('heldVehicleCodes — one ticked row per car, however the code was carried in', () => {
  it('holds a link’s stored «فورتشنر 2 » as the registry’s offered «فورتشنر 2»', () => {
    expect(heldVehicleCodes(['فورتشنر 2 '], ['150', 'فورتشنر 2'])).toEqual(['فورتشنر 2']);
    expect(heldVehicleCodes(['mg 2'], ['MG 2'])).toEqual(['MG 2']);
  });

  it('holds the URL’s «فورتشنر 2» as a board’s raw «فورتشنر 2 »', () => {
    expect(heldVehicleCodes(['فورتشنر 2'], ['فورتشنر 2 ', '150'])).toEqual(['فورتشنر 2 ']);
  });

  it('holds two spellings of one car once', () => {
    expect(heldVehicleCodes(['فورتشنر 2 ', 'فورتشنر 2', '150'], ['فورتشنر 2', '150'])).toEqual([
      'فورتشنر 2',
      '150',
    ]);
    expect(heldVehicleCodes(['كورولا  9', 'كورولا 9'], [])).toEqual(['كورولا 9']);
  });

  it('keeps each spelling a board offers on its own tickable', () => {
    const board = ['فورتشنر 2 ', 'فورتشنر 2'];
    expect(heldVehicleCodes(['فورتشنر 2'], board)).toEqual(['فورتشنر 2']);
    expect(heldVehicleCodes(['فورتشنر 2 ', 'فورتشنر 2'], board)).toEqual(board);
  });

  it('the registry list then shows that car ONCE, ticked — no second «فورتشنر 2 » row', () => {
    const held = heldVehicleCodes(['فورتشنر 2 '], ['فورتشنر 2', '150']);
    const rows = registryVehicleCodeOptions([{ code: 'فورتشنر 2 ' }, { code: '150' }], '', held);
    expect(rows.map((row) => row.value)).toEqual(['150', 'فورتشنر 2']);
    expect(rows.filter((row) => held.includes(row.value)).map((row) => row.value)).toEqual([
      'فورتشنر 2',
    ]);
  });

  it('…and a board’s raw row is the ticked one for the URL’s code', () => {
    const board = [{ value: 'فورتشنر 2 ' }, { value: '150' }];
    const held = heldVehicleCodes(
      ['فورتشنر 2'],
      board.map((option) => option.value),
    );
    const rows = narrowVehicleCodeOptions(board, 'فورتشنر', held);
    expect(rows.map((row) => row.value)).toEqual(['فورتشنر 2 ']);
    expect(held.includes('فورتشنر 2 ')).toBe(true);
  });
});
