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
  type OperationsVaultSealHolderDto,
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
  holdsFromRefusal,
  isSealHeldRefusal,
  mergeHolds,
  parseCount,
  poundAmount,
  receiveRefusal,
  receiveRequest,
  otherPlaces,
  sealHeldNotice,
  sealHeldTitle,
  sealHolderName,
  sealHolds,
  sealNoticeText,
  sealRangeNote,
  sealRepeatNotice,
  sealRepeatTitle,
  sealRepeats,
  sealSlots,
  sealSummary,
  sealSummaryText,
  sealsToCheck,
  sealsToSend,
  shipmentPatch,
  shownSeals,
  typeSeal,
  type ReceiptDraft,
  type SealList,
  type ShipmentDraftValues,
} from './vault-receipt';
import { translate } from '../../../platform/localization/i18n';

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
    [...value].reduce((held, _, at) => typeSeal(held, slots, index, value.slice(0, at + 1)), list);
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
    // Leading zeros only where the first box has them: 10 down to 7 writes 9 and 8.
    expect(
      shown(
        typed(3, [
          [0, '0'],
          [2, '2'],
        ]),
        3,
      ),
    ).toEqual(['0', '1', '2']);
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
    const moved = typed(
      5,
      [
        [0, '11'],
        [4, '15'],
      ],
      over,
    );
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
    // Lowered again to four: the box at the end holds the 4 typed by hand — 1 … 4 stands.
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

// Round 21 — the owner, over his own form with bags 1 … 6 and boxes 1 and 3: «مينفعش يكون فيه رقم
// للحقائب و الصناديق زى بعض برضو». One receipt names a seal ONCE, the bags and the boxes read as one
// list; a repeat — across the lists, or inside one («برضو») — is a refusal, said on every box that
// holds it and in one notice. "The same seal" is the contract's `vaultSealKey`.
describe('one seal, once per receipt — which boxes repeat, and what the form says', () => {
  const ar = (key: string, params?: Record<string, string | number>): string =>
    translate('ar', key, params);
  const en = (key: string, params?: Record<string, string | number>): string =>
    translate('en', key, params);
  /** The boxes marked, as [list, index] — what turns red. */
  const marked = (bags: string[], boxes: string[]): string[] => {
    const found = sealRepeats(bags, boxes);
    return [
      ...found.bags.flatMap((repeat, index) => (repeat === null ? [] : [`bag ${index}`])),
      ...found.boxes.flatMap((repeat, index) => (repeat === null ? [] : [`box ${index}`])),
    ];
  };

  it('finds the owner’s case: 1 and 3 in the bags AND the boxes — four boxes red', () => {
    const found = sealRepeats(['1', '2', '3', '4', '5', '6'], ['1', '3']);
    expect(found.repeats).toEqual([
      {
        seal: '1',
        spots: [
          { list: 'bag', index: 0 },
          { list: 'box', index: 0 },
        ],
        where: 'both',
      },
      {
        seal: '3',
        spots: [
          { list: 'bag', index: 2 },
          { list: 'box', index: 1 },
        ],
        where: 'both',
      },
    ]);
    expect(marked(['1', '2', '3', '4', '5', '6'], ['1', '3'])).toEqual([
      'bag 0',
      'bag 2',
      'box 0',
      'box 1',
    ]);
    // One mark per box on screen, in its place.
    expect(found.bags.map((repeat) => repeat?.seal ?? null)).toEqual([
      '1',
      null,
      '3',
      null,
      null,
      null,
    ]);
    expect(found.boxes.map((repeat) => repeat?.seal ?? null)).toEqual(['1', '3']);
  });

  it('finds a seal twice inside ONE list too — «برضو» — and three times as one repeat', () => {
    expect(sealRepeats(['5', '6', '5'], []).repeats).toEqual([
      {
        seal: '5',
        spots: [
          { list: 'bag', index: 0 },
          { list: 'bag', index: 2 },
        ],
        where: 'bags',
      },
    ]);
    expect(sealRepeats([], ['8', '9', '8']).repeats.map((r) => r.where)).toEqual(['boxes']);
    const thrice = sealRepeats(['4', '4'], ['4']);
    expect(thrice.repeats).toHaveLength(1);
    expect(thrice.repeats[0]?.where).toBe('both');
    expect(marked(['4', '4'], ['4'])).toEqual(['bag 0', 'bag 1', 'box 0']);
  });

  it('reads a seal as the contract does: 0099 = 99, Arabic-Indic = ASCII, text as typed', () => {
    expect(marked(['0099'], ['99'])).toEqual(['bag 0', 'box 0']);
    expect(marked(['١٢'], ['12'])).toEqual(['bag 0', 'box 0']);
    expect(marked([' AB-1 '], ['AB-1'])).toEqual(['bag 0', 'box 0']);
    expect(marked(['AB-1'], ['ab-1'])).toEqual([]);
    // A number pasted with an invisible right-to-left mark is the number the clerk sees.
    expect(marked(['12'], ['‏12'])).toEqual(['bag 0', 'box 0']);
    expect(marked(['۰۷'], ['‎7'])).toEqual(['bag 0', 'box 0']);
    // Neighbours are two seals; blanks are none.
    expect(marked(['0099', '', '  '], ['0100', '', ''])).toEqual([]);
    // The seal is named as it was first typed.
    expect(sealRepeats(['0099'], ['99']).repeats[0]?.seal).toBe('0099');
  });

  it('finds nothing in distinct seals — the bags and the boxes each their own', () => {
    const found = sealRepeats(['1', '2', '3', '4', '5', '6'], ['7', '8']);
    expect(found.repeats).toEqual([]);
    expect(found.bags.every((repeat) => repeat === null)).toBe(true);
    expect(found.boxes).toEqual([null, null]);
  });

  it('reads only the boxes on screen — a box hidden by a lowered count is no seal of the receipt', () => {
    const bags: SealList = { seals: ['1', '2', '3', '4', '5', '6'], filled: [] };
    // «3×» → «2×» with one bag: two boxes on screen; the 3 typed in the third is hidden.
    expect(shownSeals(bags, 2)).toEqual(['1', '2']);
    expect(marked(shownSeals(bags, 2), ['3'])).toEqual([]);
    expect(marked(shownSeals(bags, 3), ['3'])).toEqual(['bag 2', 'box 0']);
    // Empty boxes drawn by a raised count are on screen, and repeat nothing.
    expect(shownSeals(NO_SEAL_LIST, 2)).toEqual(['', '']);
  });

  it('marks a number the range fill wrote like one typed — the fill keeps working', () => {
    // Bags 1 … 6 over six boxes: the fill writes 2 … 5; the boxes' 3 collides with a filled box.
    const bags = typeSeal(typeSeal(NO_SEAL_LIST, 6, 0, '1'), 6, 5, '6');
    expect(bags.seals).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(bags.filled[2]).toBe(true);
    expect(marked(shownSeals(bags, 6), ['3'])).toEqual(['bag 2', 'box 0']);
  });

  it('says it in ONE notice, in Arabic’s own forms of the count', () => {
    const notice = (bags: string[], boxes: string[]): string =>
      sealRepeatNotice(sealRepeats(bags, boxes).repeats, ar, 'ar');
    expect(notice(['1', '2'], ['1'])).toBe('الرقم 1 مكرر — في الحقائب والصناديق');
    // The owner's own screen.
    expect(notice(['1', '2', '3', '4', '5', '6'], ['1', '3'])).toBe(
      'الرقمان 1 و3 مكرران — في الحقائب والصناديق',
    );
    expect(notice(['1', '2', '3'], ['1', '2', '3'])).toBe(
      'الأرقام 1 و2 و3 مكررة — في الحقائب والصناديق',
    );
    // Inside one list, and both kinds at once — the seals in both lists said first.
    expect(notice(['5', '6', '5'], [])).toBe('الرقم 5 مكرر — في الحقائب');
    expect(notice([], ['8', '8'])).toBe('الرقم 8 مكرر — في الصناديق');
    // Joined by the Arabic semicolon: a middle dot beside Arabic words reads as the zero «٠».
    expect(notice(['5', '1', '5'], ['1'])).toBe(
      'الرقم 1 مكرر — في الحقائب والصناديق؛ الرقم 5 مكرر — في الحقائب',
    );
    expect(notice(['5', '1', '5'], ['1'])).not.toContain('·');
    // Eleven seals or more take the counted form of «many».
    const eleven = Array.from({ length: 11 }, (_, index) => String(index + 1));
    expect(notice(eleven, eleven)).toMatch(/^الأرقام 1 و2 و3 .* و11 مكررة — في الحقائب والصناديق$/u);
    expect(notice(['1', '2'], ['3'])).toBe('');
    expect(sealRepeatNotice(sealRepeats(['1', '2'], ['1', '2']).repeats, en, 'en')).toBe(
      'Seals 1 and 2 are repeated — in the bags and the boxes',
    );
    expect(sealRepeatNotice(sealRepeats(['5', '1', '5'], ['1']).repeats, en, 'en')).toBe(
      'Seal 1 is repeated — in the bags and the boxes; Seal 5 is repeated — in the bags',
    );
  });

  it('titles a red box with where else its seal is, numbered as the boxes are labelled', () => {
    const found = sealRepeats(['1', '2', '3', '4', '5', '6'], ['1', '3']);
    const three = found.repeats[1];
    if (three === undefined) throw new Error('no repeat');
    // Bag box 2 under «2×» is bag 2, seal 1; box 1 is box 1, seal 2.
    expect(otherPlaces(three, { list: 'bag', index: 2 }, 2)).toEqual([
      { list: 'box', unit: 1, seal: 2 },
    ]);
    expect(otherPlaces(three, { list: 'box', index: 1 }, 2)).toEqual([
      { list: 'bag', unit: 2, seal: 1 },
    ]);
    // Under «3×» the same bag box is bag 1, seal 3.
    expect(otherPlaces(three, { list: 'box', index: 1 }, 3)).toEqual([
      { list: 'bag', unit: 1, seal: 3 },
    ]);
    expect(sealRepeatTitle(three, { list: 'bag', index: 2 }, 2, ar, 'ar')).toBe(
      'مكرر — موجود أيضًا في الصندوق 1، الختم 2',
    );
    // Three boxes: the other two, listed.
    const thrice = sealRepeats(['4', '4'], ['4']).repeats[0];
    if (thrice === undefined) throw new Error('no repeat');
    expect(sealRepeatTitle(thrice, { list: 'box', index: 0 }, 2, ar, 'ar')).toBe(
      'مكرر — موجود أيضًا في الحقيبة 1، الختم 1 والحقيبة 1، الختم 2',
    );
  });
});

// Round 21b — the owner, asked whether a seal already recorded on another محصنة should be refused:
// «لو موجوده عندنا لا ك محصنة يبقى مينفعش ولو دخلت وخرجت واتكرر يبقى عادى». The server decides; these
// are the form's rules around its answer — what is asked, which boxes turn red, what the ONE notice
// says, and how a refused receipt marks the seals its 409 names.
describe('a seal still in the vault — what is asked, which boxes turn red, what the notice says', () => {
  const ar = (key: string, params?: Record<string, string | number>): string =>
    translate('ar', key, params);
  const en = (key: string, params?: Record<string, string | number>): string =>
    translate('en', key, params);
  const MISR: OperationsVaultSealHolderDto = {
    shipmentId: 's-misr',
    receiptNumber: '1234',
    mainBankName: 'بنك مصر',
    originBranchName: 'فرع المعادي',
    destinationBranchName: 'فرع الدقي',
    receivedAt: '2026-11-14T08:20:00.000Z',
  };
  const AHLY: OperationsVaultSealHolderDto = {
    shipmentId: 's-ahly',
    receiptNumber: null,
    mainBankName: 'الأهلي',
    originBranchName: 'فرع التحرير',
    destinationBranchName: 'فرع العتبة',
    receivedAt: '2026-11-13T09:00:00.000Z',
  };
  const answer = (...held: [string, OperationsVaultSealHolderDto][]) => ({
    held: held.map(([seal, holder]) => ({ seal, holder })),
  });
  const refusal = (details: { field: string; code: string; message: string }[]) =>
    new ApiError(ErrorCodes.OPERATIONS_SEAL_HELD_IN_VAULT, 'held', 409, details);

  it('asks each seal on screen once, by its key — sorted, blanks skipped, 0099 and ٩٩ one question', () => {
    expect(sealsToCheck(['7', '', '0099', ' 12 '], ['٩٩', '7', 'AB-1', '  '])).toEqual([
      '12',
      '7',
      '99',
      'AB-1',
    ]);
    // The same question however the boxes are ordered — and none at all for empty boxes.
    expect(sealsToCheck(['12', '7'], [])).toEqual(sealsToCheck([], ['7', '12']));
    expect(sealsToCheck(['', ' '], [''])).toEqual([]);
  });

  it('marks every box holding a seal the vault holds — by key, the bags and the boxes alike', () => {
    const holds = mergeHolds(answer(['7', MISR]), 1, null);
    const found = sealHolds(['5', '07', '8'], ['٧', '9'], holds);
    expect(found.bags.map((hold) => hold?.shipmentId ?? null)).toEqual([null, 's-misr', null]);
    expect(found.boxes.map((hold) => hold?.shipmentId ?? null)).toEqual(['s-misr', null]);
    // Each held seal said once, as typed in its first box.
    expect(found.held).toEqual([{ seal: '07', hold: { shipmentId: 's-misr', holder: MISR } }]);
    expect(sealHolds(['5', ''], [], holds).held).toEqual([]);
  });

  it('says it in the ONE notice’s words, a sentence per held محصنة, in Arabic’s forms of the count', () => {
    const notice = (
      bags: string[],
      boxes: string[],
      holds = mergeHolds(answer(['7', MISR], ['8', MISR], ['9', AHLY]), 1, null),
    ) => sealHeldNotice(sealHolds(bags, boxes, holds).held, ar, 'ar');
    expect(notice(['7'], [])).toBe('الرقم 7 موجود في الخزينة على محصنة أخرى (بنك مصر، إيصال 1234)');
    expect(notice(['7', '8'], [])).toBe(
      'الرقمان 7 و8 موجودان في الخزينة على محصنة أخرى (بنك مصر، إيصال 1234)',
    );
    // Two محصنات: one sentence each, joined as the notice's sentences are — the Arabic semicolon.
    expect(notice(['7'], ['9'])).toBe(
      'الرقم 7 موجود في الخزينة على محصنة أخرى (بنك مصر، إيصال 1234)؛ الرقم 9 موجود في الخزينة على محصنة أخرى (الأهلي، من فرع التحرير إلى فرع العتبة)',
    );
    const three = mergeHolds(answer(['1', MISR], ['2', MISR], ['3', MISR]), 1, null);
    expect(notice(['1', '2', '3'], [], three)).toBe(
      'الأرقام 1 و2 و3 موجودة في الخزينة على محصنة أخرى (بنك مصر، إيصال 1234)',
    );
    expect(notice(['5'], [])).toBe('');
    expect(
      sealHeldNotice(
        sealHolds(['7', '8'], [], mergeHolds(answer(['7', MISR], ['8', MISR]), 1, null)).held,
        en,
        'en',
      ),
    ).toBe('Seals 7 and 8 are in the vault on another secured shipment (بنك مصر, receipt 1234)');
  });

  it('names the held محصنة by its bank and receipt number — or its branches when it has none', () => {
    expect(sealHolderName(MISR, ar)).toBe('بنك مصر، إيصال 1234');
    expect(sealHolderName(AHLY, ar)).toBe('الأهلي، من فرع التحرير إلى فرع العتبة');
    expect(sealHolderName({ ...MISR, receiptNumber: '' }, ar)).toBe(
      'بنك مصر، من فرع المعادي إلى فرع الدقي',
    );
  });

  it('titles a held box with the محصنة and when the vault took it in', () => {
    expect(
      sealHeldTitle({ shipmentId: 's-misr', holder: MISR }, ar, (iso) => `«${iso.slice(0, 10)}»`),
    ).toBe('موجود في الخزينة على المحصنة: بنك مصر، إيصال 1234 — استُلمت «2026-11-14»');
    expect(sealHeldTitle({ shipmentId: 's-x', holder: null }, ar, () => '')).toBe(
      'موجود في الخزينة على محصنة أخرى',
    );
  });

  it('joins the repeats and the held seals into ONE notice — the repeats first', () => {
    const repeat = sealRepeatNotice(sealRepeats(['1', '2'], ['1']).repeats, ar, 'ar');
    const held = sealHeldNotice(
      sealHolds(['7'], [], mergeHolds(answer(['7', MISR]), 1, null)).held,
      ar,
      'ar',
    );
    expect(sealNoticeText([repeat, held], 'ar')).toBe(
      'الرقم 1 مكرر — في الحقائب والصناديق؛ الرقم 7 موجود في الخزينة على محصنة أخرى (بنك مصر، إيصال 1234)',
    );
    expect(sealNoticeText(['', held], 'ar')).toBe(held);
    expect(sealNoticeText(['', ''], 'ar')).toBe('');
  });

  it('reads a refused receipt’s 409 against what was SENT — each seal it names, by key', () => {
    const error = refusal([
      { field: 'bagSeals.1', code: 'HELD_IN_VAULT', message: 's-misr' },
      { field: 'boxSeals.0', code: 'HELD_IN_VAULT', message: 's-ahly' },
      // Anything else in the details is not a held seal.
      { field: 'bagSeals.9', code: 'HELD_IN_VAULT', message: 's-none' },
      { field: 'receiptNumber', code: 'HELD_IN_VAULT', message: 's-none' },
      { field: 'bagSeals.0', code: 'OTHER', message: 's-none' },
    ]);
    expect(isSealHeldRefusal(error)).toBe(true);
    expect([...holdsFromRefusal(error, { bagSeals: ['5', '0007'], boxSeals: ['9'] })]).toEqual([
      ['7', 's-misr'],
      ['9', 's-ahly'],
    ]);
    // Any other refusal says nothing is held.
    const other = new ApiError(ErrorCodes.VALIDATION_FAILED, 'x', 400, []);
    expect(isSealHeldRefusal(other)).toBe(false);
    expect(holdsFromRefusal(other, { bagSeals: ['7'] }).size).toBe(0);
    expect(holdsFromRefusal(new Error('x'), { bagSeals: ['7'] }).size).toBe(0);
  });

  it('marks what the refusal named at once — and lets the check’s next answer take over', () => {
    const refused = { at: 100, holds: new Map([['7', 's-misr']]) };
    // The check had not seen it (stale, or not yet answered): the refusal stands, unnamed…
    expect([...mergeHolds(answer(), 50, refused)]).toEqual([
      ['7', { shipmentId: 's-misr', holder: null }],
    ]);
    expect([...mergeHolds(undefined, 0, refused)]).toEqual([
      ['7', { shipmentId: 's-misr', holder: null }],
    ]);
    // …named by an answer that knows that محصنة for another seal…
    expect(mergeHolds(answer(['8', MISR]), 50, refused).get('7')).toEqual({
      shipmentId: 's-misr',
      holder: MISR,
    });
    // …and once the check has answered SINCE the refusal, the check is what the form says.
    expect([...mergeHolds(answer(['7', MISR]), 150, refused)]).toEqual([
      ['7', { shipmentId: 's-misr', holder: MISR }],
    ]);
    expect([...mergeHolds(answer(), 150, refused)]).toEqual([]);
    // A check that could not be asked (null) never wipes what the server said.
    expect(mergeHolds(null, 150, refused).get('7')).toEqual({ shipmentId: 's-misr', holder: null });
  });

  it('says a refused receipt under the seals, the form left open to correct it', () => {
    expect(
      receiveRefusal(refusal([{ field: 'bagSeals.0', code: 'HELD_IN_VAULT', message: 's-1' }])),
    ).toEqual({ field: 'seals', key: 'operations.secured.receive.sealHeldRefused', closes: false });
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
    const correction = {
      notes: 'x',
      deliveryDate: new Date('2026-05-20'),
      lines: [{ currencyId: 'a'.repeat(24), amount: 5 }],
    };
    const wire = (body: unknown): unknown => JSON.parse(JSON.stringify(body));
    const body = receiveRequest({ ...DRAFT, bagSealsPerBag: 3 }, correction, 4);
    expect(body.bagSeals).toEqual(['1', '2', '3', '4', '9', '10']);
    // Round 21 — under «3×» the bags' 10 is on screen, and the boxes hold a 10 as well: «مينفعش يكون
    // فيه رقم للحقائب و الصناديق زى بعض برضو». The contract refuses the box's 10…
    const refused = ReceiveIntoVaultSchema.safeParse(wire(body));
    expect(refused.success).toBe(false);
    expect(refused.success ? [] : refused.error.issues.map((issue) => issue.path)).toEqual([
      ['boxSeals', 3],
    ]);
    // …and takes the receipt once that box holds its own seal.
    const corrected = receiveRequest(
      { ...DRAFT, bagSealsPerBag: 3, boxSeals: ['6', '8', '7', '12', '11', '13'] },
      correction,
      4,
    );
    expect(ReceiveIntoVaultSchema.safeParse(wire(corrected)).success).toBe(true);
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

  // Round 21 — the contract's refusal of a seal named twice: said under the seals, never the
  // generic «بعض الحقول تحتاج إلى مراجعة».
  it('says a seal refused as repeated under the seals — on either list, and only that refusal', () => {
    const invalid = (details: { field: string; code: string; message: string }[]) =>
      receiveRefusal(new ApiError(ErrorCodes.VALIDATION_FAILED, 'Validation failed', 400, details));
    const repeat = (field: string) => [
      { field, code: 'CUSTOM', message: 'seal "1" is already in this receipt at bagSeals.0' },
    ];
    expect(invalid(repeat('body.boxSeals.0'))).toEqual({
      field: 'seals',
      key: 'operations.secured.receive.sealRepeatRefused',
      closes: false,
    });
    expect(invalid(repeat('body.bagSeals.12')).field).toBe('seals');
    // Another field's refusal, or a seal of the wrong type, is not a repeat.
    expect(invalid(repeat('body.denominations.1.value')).field).toBeNull();
    expect(
      invalid([{ field: 'body.bagSeals.0', code: 'INVALID_TYPE', message: 'Expected string' }])
        .field,
    ).toBeNull();
    expect(
      receiveRefusal(new ApiError('OPERATIONS_X', 'x', 422, repeat('body.bagSeals.1'))).field,
    ).toBeNull();
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
