// Round 28 — «عاوز الاتجاه اقدر اكتبه بايدى لو مش موجود فى الليست فاهم ؟»: the direction box's list and
// its leaving rule, pinned. This REVERSES Round 20's «لازم اختار من الاتجاهات اللى موجوده بتاعت
// البنوك»: a name the list does not have is no longer a dead end («لا يوجد اتجاه بهذا الاسم»).
import { describe, expect, it } from 'vitest';
import { OPERATIONS_DIRECTION_MAX_LENGTH } from '@ecms/contracts';
import {
  directionItems,
  directionItemsAtOpen,
  directionOnLeave,
  directionTooLong,
  endsMidAreaWord,
  highlightedDirectionRow,
  isHandTypedDirection,
  opensOnText,
  typedDirection,
} from './direction-pick';

const AREAS = ['المعادي', 'المعادي الجديدة', 'حلوان', 'مدينة نصر', 'شبرا/الخيمة'];

const area = (direction: string) => ({ kind: 'area', direction }) as const;
const typed = (direction: string) => ({ kind: 'typed', direction }) as const;

describe('the list while typing — «استخدام «…» اتجاهًا»', () => {
  it('nothing typed: every area, and no typed row', () => {
    expect(directionItems('', AREAS)).toEqual(AREAS.map(area));
    expect(directionItems('   ', AREAS)).toEqual(AREAS.map(area));
  });

  it('text no area holds: the typed row FIRST and alone — the old dead end is gone', () => {
    expect(directionItems('طريق السويس', AREAS)).toEqual([typed('طريق السويس')]);
    // Tidied as the save tidies it.
    expect(directionItems('  طريق   السويس ', AREAS)).toEqual([typed('طريق السويس')]);
  });

  it('text some areas hold: those areas first, the typed row LAST — Enter still takes an area', () => {
    expect(directionItems('المعا', AREAS)).toEqual([
      area('المعادي'),
      area('المعادي الجديدة'),
      typed('المعا'),
    ]);
    // Folded as every search box folds: «ى» finds «ي», «ه» finds «ة».
    expect(directionItems('مدينه', AREAS)).toEqual([area('مدينة نصر'), typed('مدينه')]);
  });

  it('an area typed out in full: that area first, in its own spelling, and no typed row', () => {
    expect(directionItems('المعادى', AREAS)).toEqual([area('المعادي'), area('المعادي الجديدة')]);
    expect(directionItems('المعادي الجديده', AREAS)).toEqual([area('المعادي الجديدة')]);
    // Several areas, as the distribution reads them — one row, the areas' spelling joined.
    expect(directionItems('المعادى و حلوان', AREAS)).toEqual([area('المعادي - حلوان')]);
    expect(directionItems('شبرا/الخيمه', AREAS)).toEqual([area('شبرا/الخيمة')]);
  });

  it('text that names an area AND other words is not exactly an area: it is offered as typed', () => {
    expect(directionItems('المعادي - طريق السويس', AREAS)).toEqual([
      typed('المعادي - طريق السويس'),
    ]);
  });

  it('text with no letter and no digit is never offered', () => {
    expect(directionItems('-', AREAS)).toEqual(AREAS.map(area));
    expect(directionItems(' / ', [])).toEqual([]);
  });

  it('before the areas arrive, what is typed is offered as typed (the save still respells an area)', () => {
    expect(directionItems('المعادي', [])).toEqual([typed('المعادي')]);
  });
});

describe('leaving the box — Tab or a click outside (`directionOnLeave`)', () => {
  it('the exact name of an area → that area, in the area’s spelling (as before)', () => {
    expect(directionOnLeave('المعادى', AREAS)).toBe('المعادي');
    expect(directionOnLeave('  مدينه نصر ', AREAS)).toBe('مدينة نصر');
    expect(directionOnLeave('حلوان، المعادى', AREAS)).toBe('حلوان - المعادي');
  });

  it('text no area holds → taken as typed, tidied', () => {
    expect(directionOnLeave('طريق السويس', AREAS)).toBe('طريق السويس');
    expect(directionOnLeave(' طريق   مصر  الإسماعيلية ', AREAS)).toBe('طريق مصر الإسماعيلية');
    expect(directionOnLeave('المعادي - طريق السويس', AREAS)).toBe('المعادي - طريق السويس');
  });

  // REWRITTEN by the Round 28 critic — was «text some area holds → nothing taken», with «نصر» (a
  // WHOLE word of «مدينة نصر») among the reverts. That threw a desk's own short direction away
  // without a word — «مصر» beside «مصر الجديدة», «التجمع» beside «التجمع الخامس» — and only arrowing
  // to the last row could take it. What goes back now is text that ends PART-WAY through an area's
  // word — the half-typed search.
  it('text that ends part-way through an area’s word → nothing taken: the desk was searching', () => {
    expect(directionOnLeave('المعا', AREAS)).toBeNull();
    expect(directionOnLeave('حلو', AREAS)).toBeNull();
    expect(directionOnLeave('ال', AREAS)).toBeNull();
    expect(directionOnLeave('مدينة ن', AREAS)).toBeNull();
    // Round 28 critic — the second area half-typed: «حلو» of «حلوان» was saved as typed.
    expect(directionOnLeave('المعادي - حلو', AREAS)).toBeNull();
  });

  it('a whole word an area holds is the desk’s own direction → taken as typed, not thrown away', () => {
    expect(directionOnLeave('نصر', AREAS)).toBe('نصر');
    expect(directionOnLeave('مصر', ['مصر الجديدة', 'التجمع الخامس'])).toBe('مصر');
    expect(directionOnLeave('التجمع', ['مصر الجديدة', 'التجمع الخامس'])).toBe('التجمع');
    // The article aside: «معادي» is the whole word of «المعادي».
    expect(directionOnLeave('طريق معادي', AREAS)).toBe('طريق معادي');
    expect(directionOnLeave('المعادي - طريق', AREAS)).toBe('المعادي - طريق');
  });

  it('nothing typed, or no letter and no digit → nothing taken', () => {
    expect(directionOnLeave('', AREAS)).toBeNull();
    expect(directionOnLeave('   ', AREAS)).toBeNull();
    expect(directionOnLeave('-', AREAS)).toBeNull();
    expect(directionOnLeave('-', [])).toBeNull();
  });
});

// Round 28 critic — a near miss of a real area was steered into free text: the list matched by
// one run of letters, and the fold DROPPED a separator, so «شبرا الخيمة» never reached «شبرا/الخيمة»,
// «حلوات» never «حلوان», and either was saved as typed, looking like an area.
describe('a near miss of an area is offered that area first — before the typed text', () => {
  it('a mark between two words reads as a space: «شبرا الخيمة» is «شبرا/الخيمة»', () => {
    expect(directionItems('شبرا الخيمة', AREAS)).toEqual([area('شبرا/الخيمة')]);
    expect(directionItems('شبرا / الخيمه', AREAS)).toEqual([area('شبرا/الخيمة')]);
    expect(directionItems('شبرا الخ', AREAS)).toEqual([area('شبرا/الخيمة'), typed('شبرا الخ')]);
    expect(directionOnLeave('شبرا الخيمة', AREAS)).toBe('شبرا/الخيمة');
    expect(isHandTypedDirection('شبرا الخيمة', AREAS)).toBe(false);
  });

  // Round 28b critic — inside a longer direction the box's own pick, «شبرا/الخيمة - المعادي», was
  // split at «/» when read again: marked hand-typed once saved, and past 80 characters (eight
  // areas) refused by the save as hand-typed text. A run of parts now reads as the area it names.
  it('«شبرا/الخيمة» inside a longer direction: picked, read again, and long, it is still areas', () => {
    expect(directionOnLeave('شبرا الخيمة - المعادى', AREAS)).toBe('شبرا/الخيمة - المعادي');
    expect(isHandTypedDirection('شبرا/الخيمة - المعادي', AREAS)).toBe(false);
    expect(directionItems('شبرا/الخيمة - المعادي', AREAS)[0]).toEqual(
      area('شبرا/الخيمة - المعادي'),
    );
    const EIGHT = [...AREAS, 'التجمع الخامس', 'مصر الجديدة', 'الدقي', 'المهندسين'];
    const long = [
      'شبرا/الخيمة',
      'المعادي',
      'حلوان',
      'مدينة نصر',
      'التجمع الخامس',
      'مصر الجديدة',
      'الدقي',
      'المهندسين',
    ].join(' - ');
    expect(long.length).toBeGreaterThan(OPERATIONS_DIRECTION_MAX_LENGTH);
    expect(directionTooLong(long, EIGHT)).toBeNull();
    expect(directionOnLeave(long, EIGHT)).toBe(long);
  });

  it('the words in another order', () => {
    expect(directionItems('نصر مدينة', AREAS)).toEqual([area('مدينة نصر'), typed('نصر مدينة')]);
  });

  it('one letter away, four letters or more — and «حلو» is still only a search', () => {
    expect(directionItems('حلوات', AREAS)).toEqual([area('حلوان'), typed('حلوات')]);
    expect(directionItems('المعادئ', AREAS)).toEqual([area('المعادي'), typed('المعادئ')]);
    expect(directionItems('مدينة نسر', AREAS)).toEqual([area('مدينة نصر'), typed('مدينة نسر')]);
    expect(directionItems('حلب', AREAS)).toEqual([typed('حلب')]);
  });
});

describe('a direction of several parts: its last part is completed', () => {
  it('offers the areas answering the part after the last separator, the earlier parts kept', () => {
    expect(directionItems('المعادي - حلو', AREAS)).toEqual([
      area('المعادي - حلوان'),
      typed('المعادي - حلو'),
    ]);
    expect(directionItems('حلوان و مدي', AREAS)).toEqual([
      area('حلوان - مدينة نصر'),
      typed('حلوان و مدي'),
    ]);
    // An earlier part hand-typed: the completion is typed text, the separator as typed.
    expect(directionItems('طريق السويس، حلو', AREAS)).toEqual([
      typed('طريق السويس، حلوان'),
      typed('طريق السويس، حلو'),
    ]);
  });

  it('leaves out an area the earlier parts already name, and an area named by a separator whole', () => {
    expect(directionItems('المعادي - المعا', AREAS)).toEqual([
      area('المعادي - المعادي الجديدة'),
      typed('المعادي - المعا'),
    ]);
    // «شبرا/الخ» is part of ONE area's name, not two parts.
    expect(directionItems('شبرا/الخ', AREAS)[0]).toEqual(area('شبرا/الخيمة'));
  });
});

describe('typed past the ceiling — said, never cut without a word', () => {
  it('is no typed row, and its length is said; a direction of areas is never too long', () => {
    const long = 'ط'.repeat(OPERATIONS_DIRECTION_MAX_LENGTH + 5);
    expect(directionItems(long, AREAS)).toEqual([]);
    expect(directionTooLong(long, AREAS)).toBe(OPERATIONS_DIRECTION_MAX_LENGTH + 5);
    expect(directionOnLeave(long, AREAS)).toBeNull();
    expect(directionTooLong('ط'.repeat(OPERATIONS_DIRECTION_MAX_LENGTH), AREAS)).toBeNull();
    const many = Array.from({ length: 9 }, () => 'المعادي الجديدة').join(' - ');
    expect(many.length).toBeGreaterThan(OPERATIONS_DIRECTION_MAX_LENGTH);
    expect(directionTooLong(many, AREAS)).toBeNull();
    expect(directionOnLeave(many, AREAS)).toBe('المعادي الجديدة');
  });
});

describe('the box opened on its value (Round 28 critic — it blanked a hand-typed one)', () => {
  it('keeps the text of a value that is not one area of the list, whole and editable', () => {
    expect(opensOnText('طريق مصر الإسماعيلية الصحراوي', AREAS)).toBe(true);
    expect(opensOnText('المعادي - حلوان', AREAS)).toBe(true);
    expect(opensOnText('المعادي', AREAS)).toBe(false);
    expect(opensOnText(null, AREAS)).toBe(false);
    expect(opensOnText('طريق السويس', [])).toBe(false);
  });

  it('lists that value first (so Enter keeps it), then every area', () => {
    expect(directionItemsAtOpen('طريق السويس', AREAS)).toEqual([
      typed('طريق السويس'),
      ...AREAS.map(area),
    ]);
    expect(directionItemsAtOpen('المعادي - حلوان', AREAS)).toEqual([
      area('المعادي - حلوان'),
      ...AREAS.map(area),
    ]);
    expect(directionItemsAtOpen('حلوان', AREAS)).toEqual(AREAS.map(area));
    expect(directionItemsAtOpen(null, AREAS)).toEqual(AREAS.map(area));
  });
});

describe('ending part-way through an area’s word (`endsMidAreaWord`)', () => {
  it('is the last word held by an area’s word, and no area’s whole word', () => {
    expect(endsMidAreaWord('حلو', AREAS)).toBe(true);
    expect(endsMidAreaWord('طريق السويس - الخي', AREAS)).toBe(true);
    expect(endsMidAreaWord('حلوان', AREAS)).toBe(false);
    expect(endsMidAreaWord('نصر', AREAS)).toBe(false);
    expect(endsMidAreaWord('معادي', AREAS)).toBe(false);
    expect(endsMidAreaWord('طريق', AREAS)).toBe(false);
    expect(endsMidAreaWord('', AREAS)).toBe(false);
  });
});

describe('the typed text, as the save takes it', () => {
  it('is tidied, and held to the save’s ceiling', () => {
    expect(typedDirection('  أ   ب ')).toBe('أ ب');
    const longest = 'ط'.repeat(OPERATIONS_DIRECTION_MAX_LENGTH);
    expect(typedDirection(longest)).toBe(longest);
    expect(typedDirection(`${longest}ب`)).toBeNull();
    expect(typedDirection('—')).toBeNull();
    expect(typedDirection('7')).toBe('7');
    // Round 28 critic — the invisible marks a paste brings are dropped, as the save drops them.
    expect(typedDirection('\u200fطريق\u200b')).toBe('طريق');
    expect(typedDirection('\u200b')).toBeNull();
  });
});

describe('a saved direction that is hand-typed (`isHandTypedDirection`)', () => {
  it('is any text that is not the name of an area or of several', () => {
    expect(isHandTypedDirection('طريق السويس', AREAS)).toBe(true);
    expect(isHandTypedDirection('المعادي - طريق السويس', AREAS)).toBe(true);
    expect(isHandTypedDirection('المعادي', AREAS)).toBe(false);
    expect(isHandTypedDirection('المعادي - حلوان', AREAS)).toBe(false);
    expect(isHandTypedDirection(null, AREAS)).toBe(false);
    // Text that names nothing is no direction at all, hand-typed or not.
    expect(isHandTypedDirection('-', AREAS)).toBe(false);
    expect(isHandTypedDirection('\u200b', AREAS)).toBe(false);
  });

  it('is never said before the areas arrive', () => {
    expect(isHandTypedDirection('طريق السويس', [])).toBe(false);
  });
});

// Round 28 critic — with no item (a paste past the ceiling), the first row was «مسح الاتجاه»,
// highlighted, and Enter cleared the row's direction.
describe('the highlighted row (`highlightedDirectionRow`) — what Enter takes', () => {
  it('walks the items, then «مسح الاتجاه» after the last', () => {
    expect(highlightedDirectionRow(3, 0, true, false)).toBe(0);
    expect(highlightedDirectionRow(3, 3, true, true)).toBe(3);
    expect(highlightedDirectionRow(3, 3, false, true)).toBe(-1);
  });

  it('highlights nothing when there is no item, until the arrows reach «مسح الاتجاه»', () => {
    expect(highlightedDirectionRow(0, 0, true, false)).toBe(-1);
    expect(highlightedDirectionRow(0, 0, true, true)).toBe(0);
    expect(highlightedDirectionRow(0, 0, false, true)).toBe(-1);
  });
});
