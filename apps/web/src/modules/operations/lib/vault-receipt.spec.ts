// Round 18 — «إستلام محصنة»: the receive form's rules that need no screen.
//
// «عاوز اخلى الفورم دا لما اجى استلم محصنة», with the owner's two screenshots of the legacy form: the
// seal summaries they show («[1 - 4]», «[6 - 8] - [10 - 11] - 13», «1 - [3 - 4] - [6 - 8]»,
// «11 - 13 - [16 - 17]») are pinned here exactly, with the rules around them — the boxes the counts
// draw, the notes of each denomination and what they come to, only the CHANGED shipment fields in
// the request, the request naming nobody, and where a refusal is said.
import { describe, expect, it } from 'vitest';
import {
  ErrorCodes,
  OPERATIONS_VAULT_DENOMINATIONS,
  ReceiveIntoVaultSchema,
  type OperationsShipmentDto,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import {
  BOX_SEALS_PER_BOX,
  MAX_SEALS,
  NO_SEAL_LIST,
  denominationCheck,
  denominationLabel,
  denominationLines,
  denominationsTotal,
  draftSlots,
  fillSealRange,
  growSeals,
  parseCount,
  poundAmount,
  receiveRefusal,
  receiveRequest,
  sealRangeNote,
  sealSlots,
  sealSummary,
  sealSummaryText,
  sealsToSend,
  shipmentPatch,
  typeSeal,
  type ReceiptDraft,
  type SealList,
  type ShipmentDraftValues,
} from './vault-receipt';

const text = (seals: string[]): string => sealSummaryText(sealSummary(seals));
const singles = (seals: string[]): string[] =>
  sealSummary(seals).parts.flatMap((part) => (part.kind === 'single' ? [part.value] : []));

describe('sealSummary — the legacy line over a list of seals', () => {
  it('reads the owner’s first screenshot: bags 1–4, boxes 6, 8, 7, 10, 11, 13', () => {
    expect(text(['1', '2', '3', '4'])).toBe('[1 - 4]');
    expect(singles(['1', '2', '3', '4'])).toEqual([]);
    // Typed out of order (8 before 7): sorted first.
    expect(text(['6', '8', '7', '10', '11', '13'])).toBe('[6 - 8] - [10 - 11] - 13');
    // 13 stands alone — legacy's red one.
    expect(singles(['6', '8', '7', '10', '11', '13'])).toEqual(['13']);
  });

  it('reads the owner’s second screenshot: bags ×3 1, 3, 4, 6, 7, 8; boxes 11, 13, 16, 17', () => {
    expect(text(['1', '3', '4', '6', '7', '8'])).toBe('1 - [3 - 4] - [6 - 8]');
    expect(singles(['1', '3', '4', '6', '7', '8'])).toEqual(['1']);
    expect(text(['11', '13', '16', '17'])).toBe('11 - 13 - [16 - 17]');
    expect(singles(['11', '13', '16', '17'])).toEqual(['11', '13']);
  });

  it('brackets a run of exactly two, and leaves a lone seal alone', () => {
    expect(sealSummary(['5', '6']).parts).toEqual([{ kind: 'run', from: '5', to: '6' }]);
    expect(sealSummary(['5']).parts).toEqual([{ kind: 'single', value: '5' }]);
    expect(text(['5', '7', '9'])).toBe('5 - 7 - 9');
  });

  it('sorts as whole numbers, not as text — 9 before 10, 99 before 100', () => {
    expect(text(['100', '9', '10', '99'])).toBe('[9 - 10] - [99 - 100]');
  });

  it('compares barcodes longer than a JavaScript number is exact', () => {
    const base = '123456789012345678';
    expect(text([`${base}1`, `${base}0`, `${base}2`])).toBe(`[${base}0 - ${base}2]`);
    // 2^53 and 2^53 + 1 are one number to a float, and two seals here.
    expect(text(['9007199254740993', '9007199254740992'])).toBe(
      '[9007199254740992 - 9007199254740993]',
    );
  });

  it('keeps each seal as it was typed — leading zeros and all — while 0099 and 0100 are neighbours', () => {
    expect(text(['0100', '0099'])).toBe('[0099 - 0100]');
    expect(text(['007'])).toBe('007');
  });

  it('reads Arabic-Indic digits as digits, and shows them as typed', () => {
    expect(text(['١٢', '١١', '13'])).toBe('[١١ - 13]');
  });

  it('lists a barcode that is not all digits as typed, after the numbers, in the order typed', () => {
    const summary = sealSummary(['B-77', '3', 'A12', '2']);
    expect(summary.parts).toEqual([
      { kind: 'run', from: '2', to: '3' },
      { kind: 'text', value: 'B-77' },
      { kind: 'text', value: 'A12' },
    ]);
    expect(sealSummaryText(summary)).toBe('[2 - 3] - B-77 - A12');
  });

  it('drops blanks and trims — an empty box is no seal', () => {
    expect(text(['', '  ', ' 4 ', '3', '\t'])).toBe('[3 - 4]');
    expect(sealSummary([]).parts).toEqual([]);
    expect(text(['', ' '])).toBe('');
  });

  it('lists a seal typed twice once, and names it — a scanner read twice, or a slip', () => {
    const summary = sealSummary(['1', '2', '2', '3', 'X', 'X', '02']);
    expect(sealSummaryText(summary)).toBe('[1 - 3] - X');
    // «02» is the number 2 again.
    expect(summary.duplicates).toEqual(['2', 'X', '02']);
    expect(sealSummary(['1', '2']).duplicates).toEqual([]);
  });
});

describe('the seal boxes — bags × «2×»/«3×», boxes × 2, never losing what was typed', () => {
  it('draws bags × the radio and two per box: the owner’s 2 bags → 4 or 6, 3 boxes → 6', () => {
    expect(sealSlots(2, 2)).toBe(4);
    expect(sealSlots(2, 3)).toBe(6);
    expect(BOX_SEALS_PER_BOX).toBe(2);
    expect(sealSlots(3, BOX_SEALS_PER_BOX)).toBe(6);
    expect(sealSlots(2, BOX_SEALS_PER_BOX)).toBe(4);
  });

  it('draws none for no count, and never more than the server takes in one list', () => {
    expect(sealSlots(0, 3)).toBe(0);
    expect(sealSlots(-2, 2)).toBe(0);
    expect(sealSlots(1.5, 2)).toBe(0);
    expect(sealSlots(1000, 3)).toBe(MAX_SEALS);
    expect(MAX_SEALS).toBe(500);
  });

  it('reads the form’s counts and radio together — cartons have no barcodes', () => {
    expect(draftSlots({ bagCount: '2', boxCount: '3', bagSealsPerBag: 2 })).toEqual({
      bags: 4,
      boxes: 6,
    });
    expect(draftSlots({ bagCount: '2', boxCount: '', bagSealsPerBag: 3 })).toEqual({
      bags: 6,
      boxes: 0,
    });
  });

  it('grows the list with the boxes and never shrinks it — a count lowered and raised gives them back', () => {
    const typed = ['1', '2', '3', '4'];
    const grown = growSeals(typed, 6);
    expect(grown).toEqual(['1', '2', '3', '4', '', '']);
    // Lowered to 2 bags × 2 → 4 boxes on screen; the held list keeps all six.
    expect(growSeals(grown, 4)).toEqual(grown);
    expect(growSeals([], 0)).toEqual([]);
    // A copy, never the caller's own array.
    expect(growSeals(typed, 2)).not.toBe(typed);
  });

  it('keeps a seal in its box when the radio changes — box 3 stays box 3', () => {
    const atTwo = ['1', '2', '3', '4'];
    const atThree = growSeals(atTwo, sealSlots(2, 3));
    expect(atThree.slice(0, 4)).toEqual(atTwo);
    expect(growSeals(atThree, sealSlots(2, 2)).slice(0, 4)).toEqual(atTwo);
  });

  it('sends only the boxes on screen, trimmed, the empty ones dropped', () => {
    const held = [' 1 ', '', '3', '4', '5', '6'];
    // 2 bags × 2 → the first four boxes; the 5 and 6 typed under «3×» are not this receipt's.
    expect(sealsToSend(held, 4)).toEqual(['1', '3', '4']);
    expect(sealsToSend(held, 6)).toEqual(['1', '3', '4', '5', '6']);
    expect(sealsToSend(held, 0)).toEqual([]);
    // Never a list holding one empty string — the contract drops it, the form does not send it.
    expect(sealsToSend(['', '  '], 2)).toEqual([]);
  });
});

// Round 18b — «عاوز لو دخل اول خانة فى الحقائب او الصناديق و دخل فى الخانة الاخير رقم يملى اللى ف
// النص بالترتيب بينهم»: the first and the last box hold numbers → the boxes between take the numbers
// between, in order — bags and boxes each on its own list.
describe('the range fill — the first and the last box fill the boxes between them', () => {
  /** Boxes typed one after another, each whole — `[index, value]`, as a hand or a paste does. */
  const typed = (slots: number, entries: [number, string][], from = NO_SEAL_LIST): SealList =>
    entries.reduce((list, [index, value]) => typeSeal(list, slots, index, value), from);
  /** A scanner types a box a character at a time, every one an `onChange` of its own. */
  const scanned = (list: SealList, slots: number, index: number, value: string): SealList =>
    [...value].reduce(
      (held, _, at) => typeSeal(held, slots, index, value.slice(0, at + 1)),
      list,
    );
  /** The boxes on screen, as the form draws them. */
  const shown = (list: SealList, slots: number): string[] =>
    growSeals(list.seals, slots).slice(0, slots);
  /** Which boxes on screen hold the fill's number — 'f' — and which what was typed — '.'. */
  const marks = (list: SealList, slots: number): string =>
    Array.from({ length: slots }, (_, index) => (list.filled[index] === true ? 'f' : '.')).join('');

  it('fills the owner’s two lists: bags 2 × «2×» from 1 to 4, boxes 3 (six boxes) from 6 to 11', () => {
    const bags = typed(4, [
      [0, '1'],
      [3, '4'],
    ]);
    expect(shown(bags, 4)).toEqual(['1', '2', '3', '4']);
    expect(marks(bags, 4)).toBe('.ff.');
    expect(sealsToSend(bags.seals, 4)).toEqual(['1', '2', '3', '4']);
    expect(sealSummaryText(sealSummary(sealsToSend(bags.seals, 4)))).toBe('[1 - 4]');
    expect(sealRangeNote(bags, 4)).toEqual({ kind: 'none' });

    const boxes = typed(sealSlots(3, BOX_SEALS_PER_BOX), [
      [0, '6'],
      [5, '11'],
    ]);
    expect(shown(boxes, 6)).toEqual(['6', '7', '8', '9', '10', '11']);
    expect(marks(boxes, 6)).toBe('.ffff.');
    expect(sealSummaryText(sealSummary(sealsToSend(boxes.seals, 6)))).toBe('[6 - 11]');
  });

  it('fills whichever end is typed second — the last box first, then the first', () => {
    const lastFirst = typed(4, [
      [3, '4'],
      [0, '1'],
    ]);
    expect(shown(lastFirst, 4)).toEqual(['1', '2', '3', '4']);
    expect(lastFirst).toEqual(
      typed(4, [
        [0, '1'],
        [3, '4'],
      ]),
    );
  });

  it('fills one box between three (1 bag × «3×»), and has nothing to fill in two', () => {
    expect(
      shown(
        typed(3, [
          [0, '41'],
          [2, '43'],
        ]),
        3,
      ),
    ).toEqual(['41', '42', '43']);
    // One box × 2: two boxes, nothing between them — and nothing to say, whatever their numbers.
    const two = typed(2, [
      [0, '5'],
      [1, '9'],
    ]);
    expect(shown(two, 2)).toEqual(['5', '9']);
    expect(marks(two, 2)).toBe('..');
    expect(sealRangeNote(two, 2)).toEqual({ kind: 'none' });
    expect(sealRangeNote(typed(1, [[0, '5']]), 1)).toEqual({ kind: 'none' });
    expect(fillSealRange(NO_SEAL_LIST, 0)).toBe(NO_SEAL_LIST);
  });

  it('fills NOTHING when the run is not as long as the boxes — longer or shorter — and says so', () => {
    const longer = typed(4, [
      [0, '1'],
      [3, '5'],
    ]);
    expect(shown(longer, 4)).toEqual(['1', '', '', '5']);
    expect(marks(longer, 4)).toBe('....');
    expect(sealRangeNote(longer, 4)).toEqual({ kind: 'mismatch', from: '1', to: '5', boxes: 4 });
    const shorter = typed(6, [
      [0, '6'],
      [5, '9'],
    ]);
    expect(shown(shorter, 6)).toEqual(['6', '', '', '', '', '9']);
    expect(sealRangeNote(shorter, 6)).toEqual({ kind: 'mismatch', from: '6', to: '9', boxes: 6 });
  });

  it('says nothing of a run that does not fit once every box between is typed by hand', () => {
    // The owner's own box list, «[6 - 8] - [10 - 11] - 13»: six seals scanned one by one, the ends
    // 6 and 13 — eight numbers for six boxes, and nothing left to fill. The summary says the gaps.
    const owner = typed(
      6,
      ['6', '8', '7', '10', '11', '13'].map((seal, index): [number, string] => [index, seal]),
    );
    expect(shown(owner, 6)).toEqual(['6', '8', '7', '10', '11', '13']);
    expect(marks(owner, 6)).toBe('......');
    expect(sealRangeNote(owner, 6)).toEqual({ kind: 'none' });
    // One box between emptied again: the fill had something to do and did not — said.
    expect(sealRangeNote(typeSeal(owner, 6, 2, ''), 6)).toEqual({
      kind: 'mismatch',
      from: '6',
      to: '13',
      boxes: 6,
    });
  });

  it('keeps the first box’s leading zeros — 00098 → 00099 → 00100 — padded to its width', () => {
    expect(
      shown(
        typed(3, [
          [0, '00098'],
          [2, '00100'],
        ]),
        3,
      ),
    ).toEqual(['00098', '00099', '00100']);
    expect(
      shown(
        typed(6, [
          [0, '00098'],
          [5, '00103'],
        ]),
        6,
      ),
    ).toEqual(['00098', '00099', '00100', '00101', '00102', '00103']);
    // The FIRST box's width, whatever the last was typed with.
    expect(
      shown(
        typed(5, [
          [0, '0098'],
          [4, '102'],
        ]),
        5,
      ),
    ).toEqual(['0098', '0099', '0100', '0101', '102']);
    expect(
      shown(
        typed(3, [
          [0, '98'],
          [2, '00100'],
        ]),
        3,
      ),
    ).toEqual(['98', '99', '00100']);
    // The ends are read trimmed: a stray space is not a digit of the width.
    expect(
      shown(
        typed(3, [
          [0, ' 007 '],
          [2, '009'],
        ]),
        3,
      ),
    ).toEqual([' 007 ', '008', '009']);
  });

  it('fills a run that goes down as well — a bag scanned from its other end', () => {
    expect(
      shown(
        typed(4, [
          [0, '10'],
          [3, '7'],
        ]),
        4,
      ),
    ).toEqual(['10', '9', '8', '7']);
    expect(
      shown(
        typed(3, [
          [0, '00100'],
          [2, '00098'],
        ]),
        3,
      ),
    ).toEqual(['00100', '00099', '00098']);
    expect(
      sealRangeNote(
        typed(4, [
          [0, '10'],
          [3, '6'],
        ]),
        4,
      ),
    ).toEqual({ kind: 'mismatch', from: '10', to: '6', boxes: 4 });
  });

  it('counts barcodes longer than a JavaScript number is exact, and writes Arabic-Indic as typed', () => {
    const base = '9007199254740993';
    expect(
      shown(
        typed(4, [
          [0, base],
          [3, '9007199254740996'],
        ]),
        4,
      ),
    ).toEqual([base, '9007199254740994', '9007199254740995', '9007199254740996']);
    expect(
      shown(
        typed(4, [
          [0, '١'],
          [3, '٤'],
        ]),
        4,
      ),
    ).toEqual(['١', '٢', '٣', '٤']);
    expect(
      shown(
        typed(3, [
          [0, '۰۹'],
          [2, '11'],
        ]),
        3,
      ),
    ).toEqual(['۰۹', '۱۰', '11']);
  });

  it('fills nothing, and says nothing, unless BOTH ends are whole numbers', () => {
    for (const [first, last] of [
      ['E100', 'E103'],
      ['1', '4A'],
      ['A1', '4'],
      ['1.5', '4'],
      ['-1', '2'],
      ['1', ''],
      ['', '4'],
    ]) {
      const list = typed(4, [
        [0, first as string],
        [3, last as string],
      ]);
      expect(shown(list, 4), `${first} … ${last}`).toEqual([first, '', '', last]);
      expect(marks(list, 4)).toBe('....');
      expect(sealRangeNote(list, 4)).toEqual({ kind: 'none' });
    }
    // The same number at both ends is a seal typed twice: the summary names it, the fill is silent.
    const twice = typed(4, [
      [0, '7'],
      [3, '007'],
    ]);
    expect(shown(twice, 4)).toEqual(['7', '', '', '007']);
    expect(sealRangeNote(twice, 4)).toEqual({ kind: 'none' });
  });

  it('never writes over a box typed by hand — only the empty ones between', () => {
    const list = typed(4, [
      [1, '7'],
      [0, '1'],
      [3, '4'],
    ]);
    expect(shown(list, 4)).toEqual(['1', '7', '3', '4']);
    expect(marks(list, 4)).toBe('..f.');
    // What was typed stays, and the summary line says it.
    expect(sealSummaryText(sealSummary(sealsToSend(list.seals, 4)))).toBe('1 - [3 - 4] - 7');
    // A box typed with the very number the fill would write is still the typist's.
    const same = typed(4, [
      [2, '3'],
      [0, '1'],
      [3, '4'],
    ]);
    expect(marks(same, 4)).toBe('.f..');
  });

  it('hands a filled box to whoever types into it — a scan over it, or the box emptied', () => {
    const filled = typed(5, [
      [0, '1'],
      [4, '5'],
    ]);
    expect(marks(filled, 5)).toBe('.fff.');
    // Typed over (the scanner's Enter selects a box's text, so a scan replaces it).
    const over = typeSeal(filled, 5, 2, '30');
    expect(shown(over, 5)).toEqual(['1', '2', '30', '4', '5']);
    expect(marks(over, 5)).toBe('.f.f.');
    // The ends move: the fill's boxes follow them, the typed one stays.
    const moved = typed(5, [
      [0, '11'],
      [4, '15'],
    ], over);
    expect(shown(moved, 5)).toEqual(['11', '12', '30', '14', '15']);
    expect(marks(moved, 5)).toBe('.f.f.');
    // A box emptied by hand stays empty — no number comes back under the caret…
    const emptied = typeSeal(filled, 5, 1, '');
    expect(shown(emptied, 5)).toEqual(['1', '', '3', '4', '5']);
    expect(marks(emptied, 5)).toBe('..ff.');
    // …until an end is typed again: an empty box between is the fill's to write.
    expect(shown(typeSeal(emptied, 5, 0, '1'), 5)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('fills again whenever an end changes — and takes its numbers away when the ends no longer fit', () => {
    const start = typed(4, [
      [0, '1'],
      [3, '4'],
    ]);
    // The first box changed: a new run.
    const next = typeSeal(start, 4, 0, '21');
    expect(shown(next, 4)).toEqual(['21', '', '', '4']);
    expect(sealRangeNote(next, 4)).toEqual({ kind: 'mismatch', from: '21', to: '4', boxes: 4 });
    const again = typeSeal(next, 4, 3, '24');
    expect(shown(again, 4)).toEqual(['21', '22', '23', '24']);
    // An end emptied: no run — the fill's numbers go with it.
    const cleared = typeSeal(again, 4, 3, '');
    expect(shown(cleared, 4)).toEqual(['21', '', '', '']);
    expect(marks(cleared, 4)).toBe('....');
    expect(sealRangeNote(cleared, 4)).toEqual({ kind: 'none' });
    // A box between typed into fills nothing, and moves nothing.
    expect(shown(typeSeal(start, 4, 1, '2'), 4)).toEqual(['1', '2', '3', '4']);
  });

  it('follows a scanner typing the last box a digit at a time — the end it stops on decides', () => {
    const first = typed(4, [[0, '1']]);
    // «4» fits a run of four; «40» does not — what «4» filled goes.
    const four = scanned(first, 4, 3, '4');
    expect(shown(four, 4)).toEqual(['1', '2', '3', '4']);
    const forty = scanned(first, 4, 3, '40');
    expect(shown(forty, 4)).toEqual(['1', '', '', '40']);
    expect(sealRangeNote(forty, 4)).toEqual({ kind: 'mismatch', from: '1', to: '40', boxes: 4 });
    // The same ends typed at once or a character at a time come to the same boxes.
    const zeros = scanned(typed(3, [[0, '00098']]), 3, 2, '00100');
    expect(zeros).toEqual(
      typed(3, [
        [0, '00098'],
        [2, '00100'],
      ]),
    );
    expect(shown(zeros, 3)).toEqual(['00098', '00099', '00100']);
  });

  it('follows the count and the radio: the last box moves, and the fill with it', () => {
    // 2 bags × «2×»: 1 … 4. «3×» draws six boxes — the last is empty now: no run, the fill's 2 and
    // 3 go, the typed 1 and 4 stay.
    const atTwo = typed(4, [
      [0, '1'],
      [3, '4'],
    ]);
    const atThree = fillSealRange(atTwo, 6);
    expect(shown(atThree, 6)).toEqual(['1', '', '', '4', '', '']);
    // The new last box scanned: the run 1 … 6, the 4 typed in box 4 kept as typed.
    const six = typeSeal(atThree, 6, 5, '6');
    expect(shown(six, 6)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(marks(six, 6)).toBe('.ff.f.');
    // Lowered again to four boxes: the box at the end now is the fill's 4… no — box 4 was typed.
    const lowered = fillSealRange(six, 4);
    expect(shown(lowered, 4)).toEqual(['1', '2', '3', '4']);
    expect(marks(lowered, 4)).toBe('.ff.');
  });

  it('empties a filled box a lowered count leaves at the end, and gives the run back when raised', () => {
    const six = typed(6, [
      [0, '1'],
      [5, '6'],
    ]);
    expect(marks(six, 6)).toBe('.ffff.');
    // Four boxes on screen: the one at the end held the fill's 4, from ends no longer shown — it
    // goes, and with no number at the end, so do 2 and 3.
    const four = fillSealRange(six, 4);
    expect(shown(four, 4)).toEqual(['1', '', '', '']);
    expect(sealsToSend(four.seals, 4)).toEqual(['1']);
    expect(sealRangeNote(four, 4)).toEqual({ kind: 'none' });
    // The boxes off screen are not touched: raised again, the run is whole.
    expect(four.seals.slice(4)).toEqual(['5', '6']);
    const back = fillSealRange(four, 6);
    expect(shown(back, 6)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(marks(back, 6)).toBe('.ffff.');
  });

  it('hands back the very same list when nothing changes — the form re-draws nothing', () => {
    const list = typed(4, [
      [0, '1'],
      [3, '4'],
    ]);
    expect(fillSealRange(list, 4)).toBe(list);
    const mismatch = typed(4, [
      [0, '1'],
      [3, '9'],
    ]);
    expect(fillSealRange(mismatch, 4)).toBe(mismatch);
    // Never the caller's own arrays.
    const moved = typeSeal(list, 4, 1, '8');
    expect(moved.seals).not.toBe(list.seals);
    expect(list.seals).toEqual(['1', '2', '3', '4']);
  });
});

describe('«عدد الورق من كل فئة» — the notes counted, and what they come to', () => {
  const counts = (filled: Record<string, string>): string[] =>
    OPERATIONS_VAULT_DENOMINATIONS.map((value) => filled[denominationLabel(value)] ?? '');

  it('labels the nine boxes as legacy did — 0.25, 0.50, 1 … 200', () => {
    expect(OPERATIONS_VAULT_DENOMINATIONS.map(denominationLabel)).toEqual([
      '0.25',
      '0.50',
      '1',
      '5',
      '10',
      '20',
      '50',
      '100',
      '200',
    ]);
  });

  it('sends only counts above zero, smallest denomination first', () => {
    expect(denominationLines(counts({ '200': '1500', '0.25': '4', '50': '0', '100': '' }))).toEqual(
      [
        { value: 0.25, count: 4 },
        { value: 200, count: 1500 },
      ],
    );
    expect(denominationLines(counts({}))).toEqual([]);
  });

  it('reads a count as a whole number — a fraction, a sign or letters are no count', () => {
    expect(parseCount('12')).toBe(12);
    expect(parseCount(' ١٥٠٠ ')).toBe(1500);
    expect(parseCount('')).toBe(0);
    expect(parseCount('2.5')).toBe(0);
    expect(parseCount('-3')).toBe(0);
    expect(parseCount('abc')).toBe(0);
    expect(parseCount('99999999999999999999')).toBe(0);
  });

  it('adds them up as value × count, exactly — in piastres, so quarters do not drift', () => {
    expect(
      denominationsTotal([
        { value: 200, count: 1500 },
        { value: 100, count: 500 },
        { value: 50, count: 20 },
        { value: 0.25, count: 4 },
      ]),
    ).toBe(351_001);
    expect(denominationsTotal([{ value: 0.25, count: 3 }])).toBe(0.75);
    expect(
      denominationsTotal([
        { value: 0.5, count: 7 },
        { value: 0.25, count: 1 },
      ]),
    ).toBe(3.75);
    expect(denominationsTotal([])).toBe(0);
  });

  it('sets the count beside the shipment’s pounds — a gentle word, never a refusal', () => {
    expect(denominationCheck(0, 351_000)).toEqual({ state: 'none' });
    expect(denominationCheck(351_000, 351_000)).toEqual({ state: 'match' });
    expect(denominationCheck(351_001, 351_000)).toEqual({ state: 'mismatch', difference: 1 });
    expect(denominationCheck(350_999.75, 351_000)).toEqual({
      state: 'mismatch',
      difference: -0.25,
    });
    // The owner's row carries no pounds at all: anything counted differs by all of it.
    expect(denominationCheck(1_000, 0)).toEqual({ state: 'mismatch', difference: 1_000 });
  });

  it('reads the shipment’s pounds from its pound lines only', () => {
    const isPound = (id: string): boolean => id === 'egp';
    expect(
      poundAmount(
        [
          { currencyId: 'egp', amount: 300_000.5 },
          { currencyId: 'usd', amount: 2_000 },
          { currencyId: 'egp', amount: 50_999.5 },
        ],
        isPound,
      ),
    ).toBe(351_000);
    expect(poundAmount([{ currencyId: 'aed', amount: 1_770 }], isPound)).toBe(0);
  });
});

const HELD: OperationsShipmentDto = {
  id: 's-1',
  shipmentType: 'secured',
  status: 'draft',
  mainBankId: 'b-misr',
  secondaryBankId: null,
  originBranchId: 'br-mansour',
  destinationBranchId: 'br-misr-gm',
  areaName: 'وسط البلد',
  lines: [
    { currencyId: 'aed', amount: 1770 },
    { currencyId: 'cad', amount: 1100 },
  ],
  collectionDate: '2026-05-17T00:00:00.000Z',
  deliveryDate: '2026-05-18T00:00:00.000Z',
  receiptNumber: null,
  vaultReceiptNumber: null,
  receiptImage: null,
  serialTracked: false,
  notes: 'وصلت ',
  receivedById: null,
  receivedAt: null,
  version: 4,
  createdAt: '2026-05-16T08:00:00.000Z',
  updatedAt: '2026-05-16T08:00:00.000Z',
};

/** The form as it opens on HELD — nothing touched. */
const UNTOUCHED: ShipmentDraftValues = {
  mainBankId: 'b-misr',
  secondaryBankId: null,
  originBranchId: 'br-mansour',
  destinationBranchId: 'br-misr-gm',
  areaName: 'وسط البلد',
  lines: [
    { currencyId: 'aed', amount: 1770 },
    { currencyId: 'cad', amount: 1100 },
  ],
  collectionDate: '2026-05-17',
  deliveryDate: '2026-05-18',
  notes: 'وصلت',
};

describe('shipmentPatch — only what the vault CHANGED («تعدّلها عادي»)', () => {
  it('is nothing at all when nothing changed — the request then carries no `shipment`', () => {
    expect(shipmentPatch(HELD, UNTOUCHED)).toBeUndefined();
  });

  it('does not call stored notes «changed» for being shown trimmed', () => {
    expect(shipmentPatch({ ...HELD, notes: '  وصلت  ' }, UNTOUCHED)).toBeUndefined();
    expect(shipmentPatch({ ...HELD, notes: null }, { ...UNTOUCHED, notes: null })).toBeUndefined();
    expect(shipmentPatch({ ...HELD, notes: '   ' }, { ...UNTOUCHED, notes: null })).toBeUndefined();
  });

  it('names each field the vault changed, and only that one', () => {
    expect(shipmentPatch(HELD, { ...UNTOUCHED, notes: 'وصلت مختومة' })).toEqual({
      notes: 'وصلت مختومة',
    });
    expect(shipmentPatch(HELD, { ...UNTOUCHED, notes: null })).toEqual({ notes: null });
    expect(shipmentPatch(HELD, { ...UNTOUCHED, originBranchId: 'br-other' })).toEqual({
      originBranchId: 'br-other',
    });
    expect(
      shipmentPatch(HELD, {
        ...UNTOUCHED,
        destinationBranchId: 'br-dokki',
        areaName: 'الجيزة',
      }),
    ).toEqual({ destinationBranchId: 'br-dokki', areaName: 'الجيزة' });
  });

  it('sends the dates as days the server coerces — and a delivery day cleared as null', () => {
    const patch = shipmentPatch(HELD, { ...UNTOUCHED, deliveryDate: '2026-05-20' });
    expect(Object.keys(patch ?? {})).toEqual(['deliveryDate']);
    expect(JSON.parse(JSON.stringify(patch))).toEqual({
      deliveryDate: '2026-05-20T00:00:00.000Z',
    });
    expect(shipmentPatch(HELD, { ...UNTOUCHED, deliveryDate: '' })).toEqual({
      deliveryDate: null,
    });
    const moved = shipmentPatch(HELD, { ...UNTOUCHED, collectionDate: '2026-05-18' });
    expect(JSON.parse(JSON.stringify(moved))).toEqual({
      collectionDate: '2026-05-18T00:00:00.000Z',
    });
  });

  it('sends the lines whole when any line changed — an amount, a currency, one more, one fewer', () => {
    const more = [...UNTOUCHED.lines, { currencyId: 'gbp', amount: 3000 }];
    expect(shipmentPatch(HELD, { ...UNTOUCHED, lines: more })).toEqual({ lines: more });
    const amount = [{ currencyId: 'aed', amount: 1771 }, UNTOUCHED.lines[1]!];
    expect(shipmentPatch(HELD, { ...UNTOUCHED, lines: amount })).toEqual({ lines: amount });
    const fewer = [UNTOUCHED.lines[0]!];
    expect(shipmentPatch(HELD, { ...UNTOUCHED, lines: fewer })).toEqual({ lines: fewer });
  });

  it('compares the TO bank by what it means — a main bank stored in `secondaryBankId` is unchanged', () => {
    expect(shipmentPatch({ ...HELD, secondaryBankId: 'b-misr' }, UNTOUCHED)).toBeUndefined();
    // A TO bank picked other than the main one.
    expect(
      shipmentPatch(HELD, {
        ...UNTOUCHED,
        secondaryBankId: 'b-ahly',
        destinationBranchId: 'br-ahly',
      }),
    ).toEqual({ secondaryBankId: 'b-ahly', destinationBranchId: 'br-ahly' });
    // …and back to the main bank.
    expect(
      shipmentPatch(
        { ...HELD, secondaryBankId: 'b-ahly' },
        { ...UNTOUCHED, secondaryBankId: null },
      ),
    ).toEqual({ secondaryBankId: null });
  });

  it('sends the TO bank with a changed MAIN bank whenever its stored value differs from the form’s', () => {
    // Stored as «secondary = main» (legacy); the main bank moves and the TO side follows it: the
    // stored value would otherwise go on naming the old main bank.
    const patch = shipmentPatch(
      { ...HELD, secondaryBankId: 'b-misr' },
      {
        ...UNTOUCHED,
        mainBankId: 'b-ahly',
        secondaryBankId: null,
        originBranchId: 'br-a1',
        destinationBranchId: 'br-a2',
      },
    );
    expect(patch).toEqual({
      mainBankId: 'b-ahly',
      secondaryBankId: null,
      originBranchId: 'br-a1',
      destinationBranchId: 'br-a2',
    });
    // A main bank changed while the TO bank stays the old one: the TO bank is now «another bank».
    expect(
      shipmentPatch(HELD, { ...UNTOUCHED, mainBankId: 'b-ahly', secondaryBankId: 'b-misr' }),
    ).toEqual({ mainBankId: 'b-ahly', secondaryBankId: 'b-misr' });
  });
});

const DRAFT: ReceiptDraft = {
  receiptNumber: ' 165 ',
  bagCount: '2',
  boxCount: '3',
  cartonCount: '1',
  bagSealsPerBag: 2,
  bagSeals: ['1', '2', '3', '4', '9', '10'],
  boxSeals: ['6', '8', '7', '10', '11', '13'],
  denominations: OPERATIONS_VAULT_DENOMINATIONS.map((value) =>
    value === 200 ? '1500' : value === 0.25 ? '4' : '',
  ),
  serialTracked: true,
};

describe('receiveRequest — the body, naming nobody, requiring nothing', () => {
  it('is the owner’s first screenshot as the server takes it', () => {
    expect(receiveRequest(DRAFT, { notes: 'وصلت مختومة' }, 4)).toEqual({
      receiptNumber: '165',
      bagCount: 2,
      cartonCount: 1,
      boxCount: 3,
      bagSealsPerBag: 2,
      // The 9 and 10 typed under «3×» are hidden under «2×» — not sent.
      bagSeals: ['1', '2', '3', '4'],
      boxSeals: ['6', '8', '7', '10', '11', '13'],
      denominations: [
        { value: 0.25, count: 4 },
        { value: 200, count: 1500 },
      ],
      serialTracked: true,
      shipment: { notes: 'وصلت مختومة' },
      version: 4,
    });
  });

  it('names NOBODY — no treasurer, no receiver: the server reads who from the token', () => {
    const body = receiveRequest(DRAFT, undefined, 4) as Record<string, unknown>;
    for (const key of [
      'receivedByPrimaryId',
      'receivedBySecondaryId',
      'receivedById',
      'captainId',
      'employeeId',
    ]) {
      expect(body).not.toHaveProperty(key);
    }
  });

  it('leaves `shipment` out when the vault changed nothing', () => {
    expect(receiveRequest(DRAFT, undefined, 4)).not.toHaveProperty('shipment');
  });

  it('is an empty receipt with nothing typed — and the contract takes it as it is', () => {
    const empty: ReceiptDraft = {
      receiptNumber: '   ',
      bagCount: '',
      boxCount: '',
      cartonCount: '',
      bagSealsPerBag: 2,
      bagSeals: [],
      boxSeals: [],
      denominations: OPERATIONS_VAULT_DENOMINATIONS.map(() => ''),
      serialTracked: false,
    };
    const body = receiveRequest(empty, undefined, 0);
    expect(body).toEqual({
      receiptNumber: null,
      bagCount: 0,
      cartonCount: 0,
      boxCount: 0,
      bagSealsPerBag: 2,
      bagSeals: [],
      boxSeals: [],
      denominations: [],
      serialTracked: false,
      version: 0,
    });
    expect(ReceiveIntoVaultSchema.safeParse(body).success).toBe(true);
  });

  it('is a body the contract accepts — the owner’s receipt with a correction', () => {
    const body = receiveRequest(
      { ...DRAFT, bagSealsPerBag: 3 },
      {
        notes: 'x',
        deliveryDate: new Date('2026-05-20'),
        lines: [{ currencyId: 'a'.repeat(24), amount: 5 }],
      },
      4,
    );
    expect(body.bagSeals).toEqual(['1', '2', '3', '4', '9', '10']);
    expect(ReceiveIntoVaultSchema.safeParse(JSON.parse(JSON.stringify(body))).success).toBe(true);
  });
});

describe('receiveRefusal — said under its box where the code allows', () => {
  const refused = (
    code: string,
    message = 'x',
    details?: { field: string; code: string; message: string }[],
  ) => receiveRefusal(new ApiError(code, message, 422, details));

  it('says a branch of another bank on the TO branch', () => {
    expect(refused('OPERATIONS_BRANCH_BANK_MISMATCH')).toEqual({
      field: 'destination',
      key: 'operations.shipment.errors.branchBank',
      closes: false,
    });
  });

  it('says a stopped branch on the side the server named', () => {
    expect(refused('OPERATIONS_UNKNOWN_BRANCH', 'unknown or inactive origin branch').field).toBe(
      'origin',
    );
    expect(
      refused('OPERATIONS_UNKNOWN_BRANCH', 'unknown or inactive destination branch').field,
    ).toBe('destination');
    expect(refused('OPERATIONS_UNKNOWN_BRANCH', 'gone').field).toBeNull();
  });

  it('says a stopped bank on the main bank, or the TO bank', () => {
    expect(refused('OPERATIONS_UNKNOWN_BANK', 'unknown or inactive main bank').field).toBe(
      'mainBank',
    );
    expect(refused('OPERATIONS_UNKNOWN_BANK', 'unknown or inactive secondary bank').field).toBe(
      'toBank',
    );
  });

  it('says a stopped currency on the money lines, a started van on the delivery date', () => {
    expect(refused('OPERATIONS_UNKNOWN_CURRENCY').field).toBe('lines');
    expect(refused('OPERATIONS_DISTRIBUTION_LEG_STARTED')).toEqual({
      field: 'deliveryDate',
      key: 'operations.shipment.errors.legStarted',
      closes: false,
    });
  });

  it('says a date refused on the box its detail names', () => {
    const detail = (field: string) => [{ field, code: 'MIN_DATE', message: '2026-05-17' }];
    expect(
      refused('OPERATIONS_SHIPMENT_DATE_BEFORE_ORIGINAL', 'x', detail('collectionDate')),
    ).toEqual({
      field: 'collectionDate',
      key: 'operations.shipment.errors.dateBeforeOriginal',
      closes: false,
    });
    expect(
      refused('OPERATIONS_SHIPMENT_DELIVERY_BEFORE_COLLECTION', 'x', detail('deliveryDate')).field,
    ).toBe('deliveryDate');
    expect(refused('OPERATIONS_SHIPMENT_DATE_IN_PAST').field).toBeNull();
  });

  it('closes the form on a shipment received meanwhile, or locked — and only then', () => {
    expect(refused(ErrorCodes.OPERATIONS_INVALID_SHIPMENT_TRANSITION)).toEqual({
      field: null,
      key: 'operations.secured.receive.errors.notDraft',
      closes: true,
    });
    // The custody's own «already in the vault» (409, the generic DUPLICATE).
    expect(receiveRefusal(new ApiError('DUPLICATE', 'already', 409)).closes).toBe(true);
    expect(refused(ErrorCodes.OPERATIONS_SECURED_LOCKED)).toEqual({
      field: null,
      key: 'operations.shipment.errors.locked',
      closes: true,
    });
    // A stale row keeps the form — and what was typed — open.
    expect(receiveRefusal(new ApiError('STALE_DOCUMENT', 'stale', 409))).toEqual({
      field: null,
      key: 'operations.shipment.errors.stale',
      closes: false,
    });
  });

  it('words the catch-all as the RECEIPT’s failure, and leaves the rest to `errorMessage`', () => {
    expect(refused('VALIDATION_FAILED').key).toBe('operations.secured.receive.failed');
    expect(receiveRefusal(new ApiError('FORBIDDEN', 'no', 403)).key).toBeNull();
    expect(receiveRefusal(new TypeError('Failed to fetch')).key).toBeNull();
  });
});
