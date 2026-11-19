// «الاتجاه» on «لوحة التشغيلة» and «الطاقم الثابت» — what the box's list offers while a desk types,
// and what leaving the box takes. Pure, so the rules are pinned without a DOM.
//
// Round 28 — «عاوز الاتجاه اقدر اكتبه بايدى لو مش موجود فى الليست فاهم ؟». It REVERSES Round 20's «اقدر
// اكتب بس فى الاخر لازم اختار من الاتجاهات اللى موجوده بتاعت البنوك», where the box took an area or
// nothing and a name the list did not have ended on «لا يوجد اتجاه بهذا الاسم». Now:
//
//   · THE LIST (`directionItems`) — the areas that answer what is typed, best first, and, when the
//     text is not exactly an area, one more item: «استخدام «…» اتجاهًا», the text as typed. That
//     item is FIRST (and alone) when no area answers the text, and LAST when some do, so the
//     highlighted first row — what Enter takes — is an area while the desk is searching. An area
//     ANSWERS (Round 28 critic — a near miss of a real area must not be steered into free text):
//       1. its name holds the text (folded: «المعادى» finds «المعادي», and a mark between two words
//          is a space — «شبرا الخيمة» finds «شبرا/الخيمة»);
//       2. its name holds every WORD of the text, in any order («نصر مدينة» finds «مدينة نصر»);
//       3. one letter away from the text, a word of four letters or more («حلوات» finds «حلوان»).
//     Text of several parts («المعادي - حلو», split as the save splits it) is completed instead: the
//     areas that answer its LAST part, the earlier parts kept («المعادي - حلوان»).
//     Text that IS an area (or several, «المعادى و حلوان») offers that area first, in its spelling.
//   · ENTER takes the highlighted item, an area or the typed text.
//   · LEAVING (Tab, a click outside) — `directionOnLeave`: the exact name of an area (or areas)
//     → that area, in the area's own spelling, as before; text that ENDS PART-WAY THROUGH a word of
//     an area («حلو», «المعادي - حلو», «زمال») → nothing taken, the box goes back to its value (the
//     desk was searching, and a half-typed name must not be saved by walking away); anything else →
//     the text as typed — «مصر» too, though «مصر الجديدة» holds it (Round 28 critic: a whole word is
//     the desk's own direction, and throwing it away without a word defeated «اقدر اكتبه بايدى»).
//
// What is typed is tidied as the save tidies it (`normalizeOperationsDirection`): invisible marks
// dropped, trimmed, inner spaces one. Text that names nothing («-», «/») is never taken, and text
// typed by hand past `OPERATIONS_DIRECTION_MAX_LENGTH` is not either — the list says so instead
// (`directionTooLong`) of the box cutting a paste without a word.
//
// Round 28c — asked whether a direction typed by hand should also go on the list, the owner: «يعرض
// عليا اضيفه او لا». So beside «استخدام «…» اتجاهًا» (this row only, unchanged) the list offers
// «إضافة «…» إلى القائمة» (`directionAddOffer`, `withDirectionAdd`) — the name added to «المناطق»,
// the catalog the list is read from, then put on the row in the area's own spelling. Right AFTER
// the typed row, so Enter still takes the row-only choice and the add is one arrow away. Offered
// only for a desk who may write the catalog, and only for ONE new name: text that names something,
// within the hand-typed ceiling, of one part (none of the save's separators — «المعادي - طريق» is
// a direction of several), and that no area answers — an active one (the list offers it instead)
// or an archived one (the list says so, `{ kind: 'archived' }`: restored, not added twice).
import {
  OPERATIONS_DIRECTION_MAX_LENGTH,
  OPERATIONS_DIRECTION_SEPARATOR,
  canonicalOperationsDirection,
  foldOperationsAreaName,
  normalizeOperationsDirection,
  operationsDirectionAreas,
  operationsDirectionNamesSomething,
} from '@ecms/contracts';
import { fold } from '../../../shared/lib/fold';

/**
 * One row of the box's list: an area (its own spelling), the text as the desk typed it, or (Round
 * 28c) that text offered to «المناطق» — «إضافة «…» إلى القائمة».
 */
export type DirectionItem =
  | { kind: 'area'; direction: string }
  | { kind: 'typed'; direction: string }
  | { kind: 'add'; direction: string };

/** The text as a hand-typed direction, tidied — or null when there is nothing to take. */
export const typedDirection = (query: string): string | null => {
  const typed = normalizeOperationsDirection(query);
  if (!operationsDirectionNamesSomething(typed)) return null;
  return typed.length > OPERATIONS_DIRECTION_MAX_LENGTH ? null : typed;
};

/**
 * Text as the list compares it: folded as every search box folds (`fold` — «ى» is «ي», «ة» is «ه»,
 * no tashkeel), the article kept so «الم» still narrows to «المعادي» while it is typed, and every
 * punctuation mark or symbol a space — «شبرا/الخيمة» reads «شبرا الخيمه».
 */
const searchFold = (value: string): string =>
  fold(
    normalizeOperationsDirection(value)
      .replace(/ـ/gu, '')
      .replace(/[\p{P}\p{S}]/gu, ' '),
  )
    .replace(/ +/gu, ' ')
    .trim();

/** The letters of a word, the article off as the save's fold takes it («المعادي» = «معادي»). */
const wordFold = (word: string): string => foldOperationsAreaName(word);

/** Are the two within one letter of each other (one added, dropped or changed)? */
const oneLetterAway = (a: string, b: string): boolean => {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < short.length && short[i] === long[i]) i += 1;
  // Changed (same length) or added/dropped (one longer): the rest must then agree.
  return short.length === long.length
    ? short.slice(i + 1) === long.slice(i + 1)
    : short.slice(i) === long.slice(i + 1);
};

/** The fewest letters a text needs before a near miss is offered — «حلو» is still a search. */
const NEAR_MISS_LETTERS = 4;

/**
 * The areas that answer `text`, best first (see the head of this file): those whose name holds it,
 * then those holding each of its words, then those one letter away. In the catalog's order within
 * each. `wholeOnly` keeps the first kind alone — for text of several parts, whose words are not one
 * area's.
 */
const areasAnswering = (
  text: string,
  options: readonly string[],
  wholeOnly = false,
): readonly string[] => {
  const q = searchFold(text);
  if (q === '') return options;
  const words = q.split(' ');
  const holds: string[] = [];
  const holdsWords: string[] = [];
  const near: string[] = [];
  for (const option of options) {
    const name = searchFold(option);
    if (name.includes(q)) holds.push(option);
    else if (wholeOnly) continue;
    else if (words.length > 1 && words.every((word) => name.includes(word)))
      holdsWords.push(option);
    else if (
      q.replace(/ /gu, '').length >= NEAR_MISS_LETTERS &&
      (oneLetterAway(q, name) || oneLetterAway(wordFold(q), wordFold(option)))
    ) {
      near.push(option);
    }
  }
  return [...holds, ...holdsWords, ...near];
};

/** The exact area(s) the text names, in their own spelling — or null when it names other text. */
const exactAreas = (query: string, options: readonly string[]): string | null => {
  const typed = normalizeOperationsDirection(query);
  if (typed === '' || options.length === 0) return null;
  const canonical = canonicalOperationsDirection(typed, options);
  return 'direction' in canonical ? canonical.direction : null;
};

const SEPARATORS = new RegExp(OPERATIONS_DIRECTION_SEPARATOR.source, 'gu');

/**
 * Text of several parts, at its LAST separator: what comes before it, separator included as typed,
 * and the part after — or null for text of one part (or one that starts with its separator).
 */
const lastPart = (typed: string): { head: string; tail: string } | null => {
  let end = -1;
  for (const match of typed.matchAll(SEPARATORS)) end = match.index + match[0].length;
  if (end <= 0) return null;
  const head = typed.slice(0, end);
  return operationsDirectionNamesSomething(head) ? { head, tail: typed.slice(end) } : null;
};

/**
 * Text of several parts completed: each area answering its last part put in its place, the earlier
 * parts kept as typed — an area item when the whole then names areas only («المعادي - حلوان»), the
 * typed text otherwise. An area the earlier parts already name adds nothing and is left out.
 */
const completions = (typed: string, options: readonly string[]): DirectionItem[] => {
  const split = lastPart(typed);
  if (split === null || searchFold(split.tail) === '') return [];
  const named = new Set(operationsDirectionAreas(split.head));
  return areasAnswering(split.tail, options).flatMap((option): DirectionItem[] => {
    if (named.has(foldOperationsAreaName(option))) return [];
    const whole = `${split.head}${option}`;
    const exact = exactAreas(whole, options);
    if (exact !== null) return [{ kind: 'area', direction: exact }];
    const own = typedDirection(whole);
    return own === null ? [] : [{ kind: 'typed', direction: own }];
  });
};

/** Items without repeats, the first of each direction kept. */
const once = (items: readonly DirectionItem[]): DirectionItem[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.direction)) return false;
    seen.add(item.direction);
    return true;
  });
};

/** What the list offers for what is typed — see the head of this file for the order. */
export const directionItems = (query: string, options: readonly string[]): DirectionItem[] => {
  const typed = normalizeOperationsDirection(query);
  if (typed === '') return options.map((direction) => ({ kind: 'area', direction }));
  const several = lastPart(typed) !== null;
  const areas: DirectionItem[] = areasAnswering(typed, options, several).map((direction) => ({
    kind: 'area',
    direction,
  }));
  const exact = exactAreas(typed, options);
  if (exact !== null) {
    // The area typed out in full comes first, so Enter takes the very name typed.
    return once([{ kind: 'area', direction: exact }, ...areas]);
  }
  const offered = once([...areas, ...completions(typed, options)]);
  const own = typedDirection(typed);
  if (own === null) return offered;
  const mine: DirectionItem = { kind: 'typed', direction: own };
  const others = offered.filter((item) => item.direction !== own);
  return others.length === 0 ? [mine] : [...others, mine];
};

/**
 * Typed by hand past `OPERATIONS_DIRECTION_MAX_LENGTH` (and not the name of areas, which the save
 * respells however long): its length, for the list to say — null otherwise.
 */
export const directionTooLong = (query: string, options: readonly string[]): number | null => {
  const typed = normalizeOperationsDirection(query);
  if (typed.length <= OPERATIONS_DIRECTION_MAX_LENGTH || exactAreas(typed, options) !== null) {
    return null;
  }
  return typed.length;
};

/**
 * Does the text end PART-WAY THROUGH a word of an area — the desk still typing it? Its last word is
 * held by some area's word and is no area's whole word («حلو» of «حلوان»; «مصر» of «مصر الجديدة» is
 * whole, «معادي» of «المعادي» too — the article aside).
 */
export const endsMidAreaWord = (query: string, options: readonly string[]): boolean => {
  const words = searchFold(query).split(' ');
  const last = words[words.length - 1] ?? '';
  if (last === '') return false;
  const whole = wordFold(last);
  let held = false;
  for (const option of options) {
    for (const word of searchFold(option).split(' ')) {
      if (word === last || (whole !== '' && wordFold(word) === whole)) return false;
      if (word.includes(last)) held = true;
    }
  }
  return held;
};

/**
 * Leaving the box (Tab, a click outside) with `query` typed: the direction to take, or null to
 * keep the value the box had. Nothing typed is nothing to take.
 */
export const directionOnLeave = (query: string, options: readonly string[]): string | null => {
  if (normalizeOperationsDirection(query) === '') return null;
  const exact = exactAreas(query, options);
  if (exact !== null) return exact;
  // Part-way through an area's word: the desk was searching for it — go back, take nothing.
  if (endsMidAreaWord(query, options)) return null;
  return typedDirection(query);
};

/**
 * Is a saved direction hand-typed — not the name of an area (or of several)? While the areas have
 * not arrived nothing is called hand-typed: an empty list is «not read yet».
 */
export const isHandTypedDirection = (value: string | null, options: readonly string[]): boolean =>
  value !== null &&
  operationsDirectionNamesSomething(value) &&
  options.length > 0 &&
  !('direction' in canonicalOperationsDirection(value, options));

/**
 * The box opened on a value that is not one area of the list — typed by hand, or several areas:
 * the box keeps the text, whole and editable (Round 28 critic — it blanked it, so a long direction
 * could never be read in full on a phone, nor a typo fixed in place). One area opens on an empty
 * box, the whole list to choose from, as before.
 */
export const opensOnText = (value: string | null, options: readonly string[]): boolean =>
  value !== null &&
  operationsDirectionNamesSomething(value) &&
  options.length > 0 &&
  !options.includes(value);

/**
 * The list as the box opens, before anything is typed: the value it opens on first, when it is
 * not one area of the list (`opensOnText` — so Enter keeps it, and it reads in full), then every
 * area.
 */
export const directionItemsAtOpen = (
  value: string | null,
  options: readonly string[],
): DirectionItem[] => {
  const areas: DirectionItem[] = options.map((direction) => ({ kind: 'area', direction }));
  if (value === null || !opensOnText(value, options)) return areas;
  const own: DirectionItem = {
    kind: isHandTypedDirection(value, options) ? 'typed' : 'area',
    direction: value,
  };
  return [own, ...areas];
};

/**
 * The row the box highlights — what Enter takes — or -1 for none. `active` walks the items and then
 * «مسح الاتجاه» (the row after the last item, while the row has a direction). With NO item (text
 * past the ceiling, or naming nothing) «مسح الاتجاه» is not highlighted until the arrows reach it:
 * otherwise Enter on a too-long paste would clear the row's direction.
 */
export const highlightedDirectionRow = (
  itemCount: number,
  active: number,
  hasValue: boolean,
  arrowed: boolean,
): number => {
  const count = itemCount + (hasValue ? 1 : 0);
  if (count === 0 || active < 0 || active >= count) return -1;
  return itemCount === 0 && !arrowed ? -1 : active;
};

// ── Round 28c — «إضافة «…» إلى القائمة» ──────────────────────────────────────────────────────────

/** Why «المناطق» refused an add — said in the list, the typed text kept for the row instead. */
export type DirectionAddRefusal = 'duplicate' | 'forbidden' | 'invalid' | 'failed';

/** An add «المناطق» refused: the name it was for, and why. */
export interface DirectionAddRefused {
  name: string;
  reason: DirectionAddRefusal;
}

/**
 * What the list offers about adding the typed text to «المناطق»: the add itself (`name`, the text
 * tidied as the save tidies it — the name the catalog stores), or, when an ARCHIVED area answers
 * the text, that area — said, not added again (the catalog holds the name; it is restored there).
 */
export type DirectionAddOffer = { kind: 'add'; name: string } | { kind: 'archived'; area: string };

/**
 * Round 28c — may «إضافة «…» إلى القائمة» be offered for `query`? (See the head of this file.)
 * `archived` is null while the archived areas are read — or for a desk who may not write the
 * catalog: nothing is offered then. An add refused for this very name (`refused`) is not offered
 * again, unless it failed for a reason that may pass (`failed` — the network, the server).
 */
export const directionAddOffer = (
  query: string,
  options: readonly string[],
  archived: readonly string[] | null,
  refused: DirectionAddRefused | null = null,
): DirectionAddOffer | null => {
  if (archived === null) return null;
  const name = typedDirection(query);
  // Nothing named, past the hand-typed ceiling, or several parts: no one name to add.
  if (name === null || OPERATIONS_DIRECTION_SEPARATOR.test(name)) return null;
  // An active area answers it: the list offers that area.
  if (exactAreas(name, options) !== null || areasAnswering(name, options).length > 0) return null;
  const asleep = exactAreas(name, archived) ?? areasAnswering(name, archived)[0];
  if (asleep !== undefined) return { kind: 'archived', area: asleep };
  if (refused !== null && refused.name === name && refused.reason !== 'failed') return null;
  return { kind: 'add', name };
};

/** The list with «إضافة «…» إلى القائمة» right after the typed row it adds — Enter keeps the row's. */
export const withDirectionAdd = (
  items: readonly DirectionItem[],
  offer: DirectionAddOffer | null,
): DirectionItem[] => {
  if (offer === null || offer.kind !== 'add') return [...items];
  const at = items.findIndex((item) => item.kind === 'typed' && item.direction === offer.name);
  if (at === -1) return [...items];
  return [
    ...items.slice(0, at + 1),
    { kind: 'add', direction: offer.name },
    ...items.slice(at + 1),
  ];
};

/**
 * Why the catalog refused the add, from the answer: 409 — the name is held (added meanwhile, in
 * any spelling that folds to it, archived too); 403 — no grant to write the catalog; 400 — the
 * name itself; anything else (the network, the server) may pass, and the add is offered again.
 */
export const directionAddRefusal = (error: unknown): DirectionAddRefusal => {
  const status =
    typeof error === 'object' && error !== null ? (error as { status?: unknown }).status : null;
  if (status === 409) return 'duplicate';
  if (status === 403) return 'forbidden';
  if (status === 400 || status === 422) return 'invalid';
  return 'failed';
};
