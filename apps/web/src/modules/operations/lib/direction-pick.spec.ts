// Round 28 — «عاوز الاتجاه اقدر اكتبه بايدى لو مش موجود فى الليست فاهم ؟»: the direction box's list and
// its leaving rule, pinned. This REVERSES Round 20's «لازم اختار من الاتجاهات اللى موجوده بتاعت
// البنوك»: a name the list does not have is no longer a dead end («لا يوجد اتجاه بهذا الاسم»).
import { describe, expect, it } from 'vitest';
import { OPERATIONS_DIRECTION_MAX_LENGTH } from '@ecms/contracts';
import {
  directionAddHeld,
  directionAddOffer,
  directionAddOfferInBox,
  directionAddRefusal,
  directionAddRefusalText,
  directionItems,
  directionItemsAtOpen,
  directionOnLeave,
  directionKeyAction,
  directionTooLong,
  endsMidAreaWord,
  highlightedDirectionRow,
  isHandTypedDirection,
  opensOnText,
  typedDirection,
  withDirectionAdd,
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

// Round 28c — asked whether a direction typed by hand should also go on the list, the owner: «يعرض
// عليا اضيفه او لا». The list offers BOTH: «استخدام «…» اتجاهًا» (this row only, as Round 28 left it)
// and «إضافة «…» إلى القائمة» (written to «المناطق» at once), the add right after the typed row.
describe('Round 28c — «إضافة «…» إلى القائمة» (`directionAddOffer`, `withDirectionAdd`)', () => {
  const ARCHIVED = ['الدقي', 'طريق المطار'];
  const add = (direction: string) => ({ kind: 'add', direction }) as const;
  /** The list as the box shows it to a desk who may add. */
  const listed = (query: string, refused: Parameters<typeof directionAddOffer>[3] = null) =>
    withDirectionAdd(
      directionItems(query, AREAS),
      directionAddOffer(query, AREAS, ARCHIVED, refused),
    );

  it('a name no area answers: «استخدام» first (Enter keeps the row-only choice), «إضافة» right after it', () => {
    expect(listed('طريق السويس')).toEqual([typed('طريق السويس'), add('طريق السويس')]);
    // The name added is the text tidied as the save tidies it — the name «المناطق» stores.
    expect(directionAddOffer('  طريق\u200f   السويس ', AREAS, ARCHIVED)).toEqual({
      kind: 'add',
      name: 'طريق السويس',
    });
    expect(listed('  طريق   السويس ')).toEqual([typed('طريق السويس'), add('طريق السويس')]);
    // Enter takes the highlighted first row; the arrows reach the add, then «مسح الاتجاه».
    expect(highlightedDirectionRow(2, 0, true, false)).toBe(0);
    expect(highlightedDirectionRow(2, 1, true, true)).toBe(1);
    expect(highlightedDirectionRow(2, 2, true, true)).toBe(2);
  });

  it('is offered for ONE name only — never a direction of several parts, split as the save splits it', () => {
    for (const several of [
      'المعادي - طريق السويس',
      'طريق السويس و الواحات',
      'الواحات/الفيوم',
      'الواحات، الفيوم',
      'الواحات + الفيوم',
    ]) {
      expect(directionAddOffer(several, AREAS, ARCHIVED), several).toBeNull();
      expect(
        listed(several).some((item) => item.kind === 'add'),
        several,
      ).toBe(false);
    }
    // «و» joined to a word is part of it, as the save reads it: one name.
    expect(directionAddOffer('وادي النطرون', AREAS, ARCHIVED)).toEqual({
      kind: 'add',
      name: 'وادي النطرون',
    });
  });

  it('is never offered for text that names nothing, nor past the hand-typed ceiling (the ceiling itself is)', () => {
    for (const nothing of ['', '   ', '-', '!!!', '\u200b']) {
      expect(directionAddOffer(nothing, AREAS, ARCHIVED), JSON.stringify(nothing)).toBeNull();
    }
    const longest = 'ط'.repeat(OPERATIONS_DIRECTION_MAX_LENGTH);
    expect(directionAddOffer(longest, AREAS, ARCHIVED)).toEqual({ kind: 'add', name: longest });
    expect(directionAddOffer(`${longest}ب`, AREAS, ARCHIVED)).toBeNull();
  });

  // Round 28c critic — REWRITTEN: it held «المعا», «نصر مدينة» and «حلوات» back too (a piece, the
  // words reordered, a typo), which is how names of other places lost the add; now see the next.
  it('is never offered when an active area IS the name, folded — the list offers that area instead', () => {
    // Exactly, in another spelling, the article off, a mark for a space: the server's own rule.
    for (const answered of ['المعادي', 'المعادى', 'معادي', 'شبرا الخيمه']) {
      expect(directionAddOffer(answered, AREAS, ARCHIVED), answered).toBeNull();
      expect(
        listed(answered).some((item) => item.kind === 'add'),
        answered,
      ).toBe(false);
    }
  });

  // Round 28c critic — the verifier's wider «same name» (words reordered, one letter away, a piece
  // of a word) held back names of other places with no word why: «المنيب» beside «المنيل», «طرة»
  // beside «القنطرة», «شبرا» beside «شبرامنت». The server takes them (it folds exactly).
  it('a near miss, a piece, the words reordered are other names: the areas first (the «did you mean»), «استخدام», then «إضافة»', () => {
    const PLACES = ['المنيل', 'القنطرة شرق', 'شبرامنت', 'مدينة نصر', 'حلوان', 'المعادي'];
    const shown = (query: string) =>
      withDirectionAdd(directionItems(query, PLACES), directionAddOffer(query, PLACES, []));
    expect(shown('المنيب')).toEqual([area('المنيل'), typed('المنيب'), add('المنيب')]);
    expect(shown('طرة')).toEqual([area('القنطرة شرق'), typed('طرة'), add('طرة')]);
    expect(shown('شبرا')).toEqual([area('شبرامنت'), typed('شبرا'), add('شبرا')]);
    expect(shown('نصر مدينة')).toEqual([area('مدينة نصر'), typed('نصر مدينة'), add('نصر مدينة')]);
    expect(shown('حلوات')).toEqual([area('حلوان'), typed('حلوات'), add('حلوات')]);
    // Still being typed: the area is first — what Enter takes — and the add two arrows away.
    expect(shown('المعا')).toEqual([area('المعادي'), typed('المعا'), add('المعا')]);
    expect(highlightedDirectionRow(3, 0, false, false)).toBe(0);
  });

  // Round 28c verifier — «لو مش موجود»: a whole name a LONGER area only contains is not on the list.
  // The box gave no add for «القاهرة» beside «القاهرة الجديدة», nor «مصر» beside «مصر الجديدة» (the
  // server takes both: they fold to other names), and said an unrelated archived area instead.
  it('a whole name a longer area only contains is another name: the area first, «استخدام», then «إضافة»', () => {
    const LONGER = ['القاهرة الجديدة', 'مصر الجديدة', 'المعادي الجديدة'];
    for (const name of ['القاهرة', 'مصر', 'المعادي', 'معادي', 'الجديدة']) {
      expect(directionAddOffer(name, LONGER, []), name).toEqual({ kind: 'add', name });
    }
    expect(listed('مدينة')).toEqual([area('مدينة نصر'), typed('مدينة'), add('مدينة')]);
    expect(listed('نصر')).toEqual([area('مدينة نصر'), typed('نصر'), add('نصر')]);
    // Round 28c critic — REWRITTEN: a PIECE of a word held the add back («القاه», «طريق الم» even
    // named the archived «طريق المطار»); only a folded match does now — the areas still come first.
    for (const piece of ['القاه', 'قاهر', 'المعادي الجديد', 'عادي', 'الجدي']) {
      expect(directionAddOffer(piece, LONGER, []), piece).toEqual({ kind: 'add', name: piece });
    }
    expect(directionAddOffer('طريق', AREAS, ARCHIVED)).toEqual({ kind: 'add', name: 'طريق' });
    expect(directionAddOffer('طريق الم', AREAS, ARCHIVED)).toEqual({
      kind: 'add',
      name: 'طريق الم',
    });
  });

  // Round 28c verifier — a direction used «on this row only» once could never be added after: the
  // box opened on it lists «استخدام «…» اتجاهًا» first (`directionItemsAtOpen`) but offered no add
  // until a letter was typed and taken back.
  it('the box opened on its row’s own hand-typed direction offers the add too, right after it', () => {
    const atOpen = (value: string | null, archived: readonly string[] | null = ARCHIVED) =>
      withDirectionAdd(
        directionItemsAtOpen(value, AREAS),
        directionAddOfferInBox({ edited: false, query: '', value }, AREAS, archived),
      );
    expect(atOpen('طريق السويس')).toEqual([
      typed('طريق السويس'),
      add('طريق السويس'),
      ...AREAS.map(area),
    ]);
    // An area, several areas, nothing, an archived name, or no grant: the opening list as before.
    expect(atOpen('حلوان')).toEqual(AREAS.map(area));
    expect(atOpen('المعادي - حلوان')).toEqual(directionItemsAtOpen('المعادي - حلوان', AREAS));
    expect(atOpen(null)).toEqual(AREAS.map(area));
    expect(atOpen('الدقي')).toEqual(directionItemsAtOpen('الدقي', AREAS));
    expect(atOpen('طريق السويس', null)).toEqual(directionItemsAtOpen('طريق السويس', AREAS));
    // Typed, the offer follows the text, as ever.
    expect(
      directionAddOfferInBox(
        { edited: true, query: 'طريق الواحات', value: 'طريق السويس' },
        AREAS,
        ARCHIVED,
      ),
    ).toEqual({ kind: 'add', name: 'طريق الواحات' });
  });

  it('an ARCHIVED area that answers the text is said, and no add is offered — «المناطق» holds it', () => {
    expect(directionAddOffer('الدقى', AREAS, ARCHIVED)).toEqual({
      kind: 'archived',
      area: 'الدقي',
    });
    expect(directionAddOffer('طريق المطار', AREAS, ARCHIVED)).toEqual({
      kind: 'archived',
      area: 'طريق المطار',
    });
    // The list keeps «استخدام» for the row, and nothing more.
    expect(listed('الدقى')).toEqual([typed('الدقى')]);
    // Round 28c critic — named only when it IS the name: «مصر» is not «مصر القديمة», restored.
    expect(directionAddOffer('مصر', AREAS, ['مصر القديمة'])).toEqual({ kind: 'add', name: 'مصر' });
    expect(directionAddOffer('مصر القديمه', AREAS, ['مصر القديمة'])).toEqual({
      kind: 'archived',
      area: 'مصر القديمة',
    });
  });

  it('nothing is offered while the lists are read, or for a desk who may not write the catalog (null)', () => {
    expect(directionAddOffer('طريق السويس', AREAS, null)).toBeNull();
    expect(withDirectionAdd(directionItems('طريق السويس', AREAS), null)).toEqual([
      typed('طريق السويس'),
    ]);
  });

  it('an add refused for this very name is not offered again — unless it failed for a reason that may pass', () => {
    for (const reason of ['duplicate', 'forbidden', 'invalid'] as const) {
      expect(listed('طريق السويس', { name: 'طريق السويس', reason }), reason).toEqual([
        typed('طريق السويس'),
      ]);
      // Another name is offered as ever.
      expect(listed('طريق الواحات', { name: 'طريق السويس', reason }), reason).toEqual([
        typed('طريق الواحات'),
        add('طريق الواحات'),
      ]);
    }
    expect(listed('طريق السويس', { name: 'طريق السويس', reason: 'failed' })).toEqual([
      typed('طريق السويس'),
      add('طريق السويس'),
    ]);
  });

  it('puts the add right after the typed row it adds, and nowhere without one', () => {
    const items = [area('المعادي'), typed('طريق')];
    expect(withDirectionAdd(items, { kind: 'add', name: 'طريق' })).toEqual([
      area('المعادي'),
      typed('طريق'),
      add('طريق'),
    ]);
    expect(withDirectionAdd([area('المعادي')], { kind: 'add', name: 'طريق' })).toEqual([
      area('المعادي'),
    ]);
    expect(withDirectionAdd(items, { kind: 'archived', area: 'الدقي' })).toEqual(items);
  });

  // Round 28c critic — a 409 always said «added meanwhile», even of an archived area never listed.
  it('a 409 names the area holding the name, and says when it is archived — else the reason’s words', () => {
    const held = (code: string, message: string) => ({
      status: 409,
      details: [{ field: 'name', code, message }],
    });
    expect(directionAddHeld(held('AREA_ACTIVE', 'المعادي'))).toEqual({
      area: 'المعادي',
      archived: false,
    });
    expect(directionAddHeld(held('AREA_ARCHIVED', 'الدقي'))).toEqual({
      area: 'الدقي',
      archived: true,
    });
    for (const none of [{ status: 409 }, held('OTHER', 'x'), held('AREA_ACTIVE', ''), null, 'x']) {
      expect(directionAddHeld(none), JSON.stringify(none)).toBeNull();
    }
    expect(
      directionAddRefusalText({
        name: 'الدقى',
        reason: 'duplicate',
        held: { area: 'الدقي', archived: true },
      }),
    ).toEqual({
      key: 'operations.crewPlan.direction.addRefused.heldArchived',
      vars: { text: 'الدقى', area: 'الدقي' },
    });
    expect(
      directionAddRefusalText({
        name: 'المعادى',
        reason: 'duplicate',
        held: { area: 'المعادي', archived: false },
      }).key,
    ).toBe('operations.crewPlan.direction.addRefused.heldActive');
    // No detail (an older server) — the plain words, which no longer say «meanwhile».
    expect(directionAddRefusalText({ name: 'المعادى', reason: 'duplicate' })).toEqual({
      key: 'operations.crewPlan.direction.addRefused.duplicate',
      vars: { text: 'المعادى' },
    });
    expect(directionAddRefusalText({ name: 'x', reason: 'forbidden', held: null }).key).toBe(
      'operations.crewPlan.direction.addRefused.forbidden',
    );
  });

  it('reads the catalog’s refusal: 409 held, 403 no grant, 400 the name — anything else may pass', () => {
    expect(directionAddRefusal({ status: 409 })).toBe('duplicate');
    expect(directionAddRefusal({ status: 403 })).toBe('forbidden');
    expect(directionAddRefusal({ status: 400 })).toBe('invalid');
    expect(directionAddRefusal({ status: 422 })).toBe('invalid');
    expect(directionAddRefusal({ status: 500 })).toBe('failed');
    expect(directionAddRefusal(new TypeError('Failed to fetch'))).toBe('failed');
    expect(directionAddRefusal(null)).toBe('failed');
  });
});

// Round 28c critic — the box's keyboard was pinned only by rendering the list with a row lit: no web
// spec ran Enter on «إضافة», a second Enter while it is written, or «مسح الاتجاه». The web suite has
// no DOM, so the keys are read by `directionKeyAction` (the box only carries its answer out) and a
// desk's keystrokes are walked here, the list rebuilt at each step as the box rebuilds it.
describe('the box’s keys (`directionKeyAction`) — a desk’s keystrokes, walked', () => {
  const AREAS_HERE = ['المعادي', 'حلوان'];
  const add = (direction: string) => ({ kind: 'add', direction }) as const;
  /** The box as it stands after `query` was typed, the arrows on `active`. */
  const box = (
    query: string,
    over: { active?: number; arrowed?: boolean; pending?: boolean; value?: string | null } = {},
    offering = true,
  ) => {
    const items = withDirectionAdd(
      directionItems(query, AREAS_HERE),
      offering ? directionAddOffer(query, AREAS_HERE, []) : null,
    );
    const active = over.active ?? 0;
    // The row holds «حلوان» unless the case says otherwise (null: no direction).
    const hasValue = over.value === undefined || over.value !== null;
    return {
      open: true,
      pending: over.pending ?? false,
      items,
      active,
      lit: highlightedDirectionRow(items.length, active, hasValue, over.arrowed ?? false),
      hasValue,
    };
  };

  it('typed, ↓ reaches «إضافة» and Enter takes IT — the add, not the row-only text', () => {
    const typedBox = box('طريق السويس');
    expect(typedBox.items).toEqual([typed('طريق السويس'), add('طريق السويس')]);
    // Enter at once takes the highlighted row-only choice, as Round 28 left it.
    expect(directionKeyAction('Enter', typedBox)).toEqual({
      kind: 'take',
      direction: 'طريق السويس',
    });
    const down = directionKeyAction('ArrowDown', typedBox);
    expect(down).toEqual({ kind: 'move', active: 1 });
    const onAdd = box('طريق السويس', { active: 1, arrowed: true });
    expect(directionKeyAction('Enter', onAdd)).toEqual({ kind: 'add', name: 'طريق السويس' });
    // ↓ again: «مسح الاتجاه»; again: round to the first; ↑ from the first: «مسح الاتجاه».
    expect(directionKeyAction('ArrowDown', onAdd)).toEqual({ kind: 'move', active: 2 });
    const onClear = box('طريق السويس', { active: 2, arrowed: true });
    expect(directionKeyAction('Enter', onClear)).toEqual({ kind: 'take', direction: null });
    expect(directionKeyAction('ArrowDown', onClear)).toEqual({ kind: 'move', active: 0 });
    expect(directionKeyAction('ArrowUp', typedBox)).toEqual({ kind: 'move', active: 2 });
  });

  it('while the add is written every key but Tab is swallowed — a second Enter adds nothing', () => {
    const writing = box('طريق السويس', { active: 1, arrowed: true, pending: true });
    for (const key of ['Enter', 'ArrowDown', 'ArrowUp', 'Escape', 'a', 'Backspace', ' ']) {
      expect(directionKeyAction(key, writing), key).toEqual({ kind: 'block' });
    }
    expect(directionKeyAction('Tab', writing)).toEqual({ kind: 'pass' });
    // Shut, too: no arrow opens it while the name is written.
    expect(directionKeyAction('ArrowDown', { ...writing, open: false })).toEqual({ kind: 'block' });
  });

  it('a desk without the grant: no «إضافة» to reach — ↓ goes from the text to «مسح الاتجاه»', () => {
    const plain = box('طريق السويس', {}, false);
    expect(plain.items).toEqual([typed('طريق السويس')]);
    expect(directionKeyAction('ArrowDown', plain)).toEqual({ kind: 'move', active: 1 });
    expect(
      directionKeyAction('Enter', box('طريق السويس', { active: 1, arrowed: true }, false)),
    ).toEqual({ kind: 'take', direction: null });
  });

  it('an area searched for is what Enter takes; nothing lit takes nothing; Escape closes; Tab leaves', () => {
    const searching = box('المعا');
    expect(searching.items).toEqual([area('المعادي'), typed('المعا'), add('المعا')]);
    expect(directionKeyAction('Enter', searching)).toEqual({ kind: 'take', direction: 'المعادي' });
    // Past the ceiling there is no row — Enter does not clear the row's direction.
    const tooLong = box('ط'.repeat(OPERATIONS_DIRECTION_MAX_LENGTH + 1));
    expect(tooLong.items).toEqual([]);
    expect(directionKeyAction('Enter', tooLong)).toEqual({ kind: 'block' });
    expect(directionKeyAction('Escape', searching)).toEqual({ kind: 'close' });
    expect(directionKeyAction('Tab', searching)).toEqual({ kind: 'leave' });
    expect(directionKeyAction('a', searching)).toEqual({ kind: 'pass' });
    // Shut: ↓ opens it; Enter, Escape and Tab are the page's.
    const shut = { ...searching, open: false };
    expect(directionKeyAction('ArrowDown', shut)).toEqual({ kind: 'open' });
    for (const key of ['Enter', 'Escape', 'Tab']) {
      expect(directionKeyAction(key, shut), key).toEqual({ kind: 'pass' });
    }
  });
});
