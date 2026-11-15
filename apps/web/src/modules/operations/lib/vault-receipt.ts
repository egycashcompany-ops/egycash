// Round 18 — «إستلام محصنة», the legacy vault receive form brought back: «عاوز اخلى الفورم دا لما اجى
// استلم محصنة». Its rules that need no screen, each pinned in `vault-receipt.spec.ts`:
//
//   · THE SEALS. The legacy form drew one box per seal — bags × «2×»/«3×», and two per box («عدد
//     الصناديق») — and, over each list, a SUMMARY of what was typed: the numbers sorted, a run of
//     consecutive ones bracketed «[1 - 4]», one standing alone in red («[6 - 8] - [10 - 11] - 13»).
//     A treasurer reads at a glance that the bag seals run 1 to 4 with none missing, and that 13 is
//     on its own. `sealSummary` is that line; `sealSlots` / `growSeals` / `sealsToSend` are the
//     boxes — growing and shrinking with the counts and the radio, never losing what was typed.
//     Round 18b: the first and the last box hold numbers → the boxes between take the numbers
//     between («يملى اللى ف النص بالترتيب بينهم») — `fillSealRange` / `typeSeal` / `sealRangeNote`.
//   · «عدد الورق من كل فئة»: how many notes of each pound denomination, and what they come to
//     (`denominationsTotal`) — set beside the shipment's pound amount, a gentle hint when the two
//     differ (`denominationCheck`), never a refusal: «كله اختيارى».
//     Round 21: «مينفعش يكون فيه رقم للحقائب و الصناديق زى بعض برضو» — one receipt names a seal ONCE,
//     bags and boxes together (`sealRepeats`, by the contract's own `vaultSealKey`).
//   · THE SHIPMENT'S DATA, corrected in the same form («تعدّلها عادي»): only what CHANGED goes in
//     the request's `shipment` (`shipmentPatch`) — a field the vault did not touch is not sent, so
//     «السجل» shows exactly the vault's corrections and nothing it merely looked at.
//   · NO NAMES AND NOTHING REQUIRED («انا مش عاوز اى اسماء ومش عاوز اى خانة من الخانات دى اجبارى كله
//     اختيارى»): `receiveRequest` names nobody — the server records the signed-in user from the
//     token — and an empty receipt number is none.
import {
  ErrorCodes,
  OPERATIONS_VAULT_DENOMINATIONS,
  asciiDigits,
  type OperationsShipmentDto,
  type OperationsVaultBagSealsPerBag,
  type OperationsVaultDenominationCountDto,
  type Locale,
  type ReceiveIntoVaultInput,
  type ReceiveIntoVaultShipmentPatch,
  vaultSealKey,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { pluralKey } from '../../../shared/lib/plural';
import { shipmentSaveErrorKey } from './shipment-form';

// ── The seals ────────────────────────────────────────────────────────────────────────────────────

/** «باركود الصناديق»: two boxes per box, as the legacy form drew them (3 boxes → 6). */
export const BOX_SEALS_PER_BOX = 2;

/** The contract's ceiling on one list of seals (`ReceiveIntoVaultSchema` — `.max(500)`). */
export const MAX_SEALS = 500;

/**
 * How many seal boxes a count draws: bags × «2×»/«3×», or boxes × 2 — never more than the server
 * takes in one list, and none for a count that is not a whole number above zero.
 */
export const sealSlots = (count: number, perUnit: number): number =>
  Number.isInteger(count) && count > 0 ? Math.min(count * perUnit, MAX_SEALS) : 0;

/**
 * The seals held for `slots` boxes. «keeping what was typed»: the list only ever GROWS — a count
 * lowered and raised again (3 bags → 2 → 3, or «3×» → «2×» → «3×») gives the boxes back with what
 * was in them. The boxes are positions, as legacy's were: seal 1 stays in box 1 whatever the radio
 * says.
 */
export const growSeals = (seals: readonly string[], slots: number): string[] =>
  seals.length >= slots ? [...seals] : [...seals, ...Array<string>(slots - seals.length).fill('')];

/**
 * What is SENT (and printed): the boxes on screen only — a box hidden by a lowered count is not a
 * seal of this receipt — each trimmed, the empty ones dropped. The very rule the server stores them
 * by, so the «إيصال» printed from the form says what was stored.
 */
export const sealsToSend = (seals: readonly string[], slots: number): string[] =>
  seals
    .slice(0, slots)
    .map((seal) => seal.trim())
    .filter((seal) => seal !== '');

/** A seal that is a whole number — digits only, once Arabic-Indic digits are read as digits. */
const ALL_DIGITS = /^\d+$/u;

// ── The range fill ───────────────────────────────────────────────────────────────────────────────
//
// Round 18b — «عاوز لو دخل اول خانة فى الحقائب او الصناديق و دخل فى الخانة الاخير رقم يملى اللى ف
// النص بالترتيب بينهم»: the FIRST and the LAST box of a list (bags, or boxes — each on its own) hold
// numbers, and the boxes between take the numbers between, in order. The rules, each pinned in
// `vault-receipt.spec.ts`:
//
//   · The ends are the first and the last box ON SCREEN (`slots`), and both must be whole numbers —
//     digits only, leading zeros allowed, Arabic-Indic digits counted, as the summary line reads
//     them. A seal with a letter in it is no end: nothing is filled.
//   · It fills ONLY when the run the ends make is exactly as long as the boxes: |last − first| + 1
//     equals the number of boxes on screen. A shorter or longer run is not a guess worth writing
//     — which seal would be missing, or which box would hold two? — so nothing is filled, and the
//     list's bar says why, beside its summary line (`sealRangeNote`). The run may go down as well
//     as up (a bag scanned from its other end): «بالترتيب بينهم» is the order between the two.
//   · A number is written as the first box writes its own: a first box with leading zeros sets the
//     width (00098 → 00099 → 00100), one without sets none (10 down to 7 is 9, 8); in its digits.
//   · It never writes over a box typed by hand — only an EMPTY box, or one it wrote itself that
//     nobody has typed into since (`filled`). A box typed by hand that disagrees stays as typed: the
//     summary line already says it («1 - [3 - 4] - 7»).
//   · What it wrote follows the ends: it is written again whenever the first or the last box
//     changes, or the count / «2×»/«3×» moves the last box — and taken away when the ends no longer
//     make a run that fits. The boxes it filled always say what the two ends on screen say, never
//     what they said a moment ago (a scanner types the last box a digit at a time: «4» fits a run
//     of four, «40» does not).

/**
 * One list of seal boxes as the form holds it — bags or boxes: every box ever drawn (`growSeals`),
 * and which of them hold what the range fill wrote rather than what was typed.
 */
export interface SealList {
  seals: readonly string[];
  /** `filled[i]`: box i holds the range fill's number, and nobody has typed into it since. */
  filled: readonly boolean[];
}

/** A list with no box typed yet. */
export const NO_SEAL_LIST: SealList = { seals: [], filled: [] };

/** What the list's bar says of the range fill. */
export type SealRangeNote =
  | { kind: 'none' }
  /** Both ends are numbers, but their run is not as long as the boxes: nothing was filled. */
  | { kind: 'mismatch'; from: string; to: string; boxes: number };

const wholeNumber = (seal: string): bigint | null => {
  const digits = asciiDigits(seal);
  return ALL_DIGITS.test(digits) ? BigInt(digits) : null;
};

/** The two ends on screen, when both are whole numbers and not the same one. */
const rangeEnds = (
  seals: readonly string[],
  slots: number,
): { first: string; last: string; from: bigint; to: bigint; size: bigint } | null => {
  // Fewer than three boxes have nothing between their ends.
  if (slots < 3) return null;
  const first = (seals[0] ?? '').trim();
  const last = (seals[slots - 1] ?? '').trim();
  const from = wholeNumber(first);
  const to = wholeNumber(last);
  // The same number at both ends is a seal typed twice — the summary line says that, not this.
  if (from === null || to === null || from === to) return null;
  return { first, last, from, to, size: (to > from ? to - from : from - to) + 1n };
};

/** `ascii` (digits) written in the digits `sample` is written in — ١٢٣ for a list typed in ١٢٣. */
const inDigitsOf = (sample: string, ascii: string): string => {
  const base = /[۰-۹]/u.test(sample) ? 0x06f0 : /[٠-٩]/u.test(sample) ? 0x0660 : null;
  return base === null
    ? ascii
    : ascii.replace(/\d/gu, (digit) => String.fromCodePoint(base + Number(digit)));
};

/** The number box `index` takes in the run between the ends — or null when the ends make none. */
const rangeFill = (seals: readonly string[], slots: number): ((index: number) => string) | null => {
  const ends = rangeEnds(seals, slots);
  if (ends === null || ends.size !== BigInt(slots)) return null;
  const step = ends.to > ends.from ? 1n : -1n;
  // Only a first box written WITH leading zeros sets a width: 10 counting down writes 9, not 09.
  const width = /^[0٠۰]/u.test(ends.first) ? ends.first.length : 0;
  return (index) =>
    inDigitsOf(ends.first, String(ends.from + step * BigInt(index)).padStart(width, '0'));
};

/** `values` as long as `length`, padded with `blank`. */
const padTo = <T>(values: readonly T[], length: number, blank: T): T[] =>
  values.length >= length
    ? [...values]
    : [...values, ...Array.from({ length: length - values.length }, () => blank)];

/**
 * The range fill, run over the boxes on screen. What it wrote before goes first — it came from the
 * ends as they were — then, when the ends make a run exactly as long as the boxes, every EMPTY box
 * between them takes its number. A box typed by hand is never written; a box off screen (hidden by
 * a lowered count) is left as it is, to be judged again when it is shown. The same list comes back
 * when nothing changes.
 */
export const fillSealRange = (list: SealList, slots: number): SealList => {
  const seals = growSeals(list.seals, slots);
  const filled = padTo(list.filled, seals.length, false);
  for (let index = 0; index < slots; index += 1) {
    if (filled[index] === true) {
      seals[index] = '';
      filled[index] = false;
    }
  }
  const fill = rangeFill(seals, slots);
  if (fill !== null) {
    for (let index = 1; index < slots - 1; index += 1) {
      if ((seals[index] ?? '').trim() === '') {
        seals[index] = fill(index);
        filled[index] = true;
      }
    }
  }
  const same =
    seals.length === list.seals.length &&
    seals.every((seal, index) => seal === list.seals[index]) &&
    filled.every((mark, index) => mark === (list.filled[index] ?? false));
  return same ? list : { seals, filled };
};

/**
 * A box typed into (by hand or by a scanner): it is the typist's from now on, whatever the fill
 * wrote there. Typed into the first or the last box on screen, the range fill runs again.
 */
export const typeSeal = (list: SealList, slots: number, index: number, value: string): SealList => {
  const seals = growSeals(list.seals, index + 1);
  const filled = padTo(list.filled, seals.length, false);
  seals[index] = value;
  filled[index] = false;
  const typed = { seals, filled };
  return index === 0 || index === slots - 1 ? fillSealRange(typed, slots) : typed;
};

/**
 * The word in a list's bar: said when both ends are numbers whose run is NOT as long as the
 * boxes and a box between them is still empty — the fill had something to do and did not. Once
 * every box between holds a seal typed by hand there is nothing to fill, and the summary line says
 * the gaps («[6 - 8] - [10 - 11] - 13», the owner's own list): a second word would be noise.
 */
export const sealRangeNote = (list: SealList, slots: number): SealRangeNote => {
  const ends = rangeEnds(list.seals, slots);
  if (ends === null || ends.size === BigInt(slots)) return { kind: 'none' };
  // (The last box holds a number, so the held list reaches it: every box between is in it.)
  const emptyBetween = list.seals.slice(1, slots - 1).some((seal) => seal.trim() === '');
  return emptyBetween
    ? { kind: 'mismatch', from: ends.first, to: ends.last, boxes: slots }
    : { kind: 'none' };
};

/** One piece of a seal summary. */
export type SealPart =
  /** Two or more consecutive numbers — «[1 - 4]». */
  | { kind: 'run'; from: string; to: string }
  /** A number with no neighbour — legacy's RED one: a seal worth a second look. */
  | { kind: 'single'; value: string }
  /** Not a number (a barcode with letters): listed as typed, after the numbers. */
  | { kind: 'text'; value: string };

export interface SealSummary {
  parts: SealPart[];
  /** A seal typed twice — a scanner read twice, or a slip — listed once in `parts`, named here. */
  duplicates: string[];
}

/**
 * The legacy summary line over a list of seals: «[1 - 4]», «1 - [3 - 4] - [6 - 8]», «[6 - 8] -
 * [10 - 11] - 13», «11 - 13 - [16 - 17]».
 *
 *   · Numbers are compared as WHOLE numbers, of any length (a barcode is longer than a JavaScript
 *     number is exact): 0099 and 0100 are neighbours. Each is shown as it was typed, leading zeros
 *     kept. Arabic-Indic digits count as digits («١٢»).
 *   · Sorted ascending; a run of two or more consecutive numbers is one bracket, a number on its
 *     own a `single` — the red one.
 *   · Anything that is not all digits is listed as typed, in the order typed, after the numbers.
 *   · Blanks are no seal. A seal typed twice is listed once and named in `duplicates`.
 */
export const sealSummary = (seals: readonly string[]): SealSummary => {
  const numbers = new Map<bigint, string>();
  const texts: string[] = [];
  const duplicates: string[] = [];
  for (const raw of seals) {
    // "The same seal" is the contract's (`vaultSealKey`), so this line and the receipt's refusal
    // of a repeat read a seal alike: a number's key is its digits, a text's is itself.
    const key = vaultSealKey(raw);
    if (key === null) continue;
    const seal = raw.trim();
    if (ALL_DIGITS.test(key)) {
      const value = BigInt(key);
      if (numbers.has(value)) duplicates.push(seal);
      else numbers.set(value, seal);
    } else if (texts.includes(seal)) {
      duplicates.push(seal);
    } else {
      texts.push(seal);
    }
  }
  const sorted = [...numbers.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const typed = (value: bigint): string => numbers.get(value) ?? String(value);
  const parts: SealPart[] = [];
  for (let start = 0; start < sorted.length;) {
    let end = start;
    while (end + 1 < sorted.length && sorted[end + 1] === (sorted[end] as bigint) + 1n) end += 1;
    const first = sorted[start] as bigint;
    parts.push(
      end > start
        ? { kind: 'run', from: typed(first), to: typed(sorted[end] as bigint) }
        : { kind: 'single', value: typed(first) },
    );
    start = end + 1;
  }
  for (const value of texts) parts.push({ kind: 'text', value });
  return { parts, duplicates };
};

/** One part as the legacy line wrote it — «[6 - 8]», «13». */
export const sealPartText = (part: SealPart): string =>
  part.kind === 'run' ? `[${part.from} - ${part.to}]` : part.value;

/** The whole line, as legacy wrote it — the parts joined with « - ». '' for no seals. */
export const sealSummaryText = (summary: SealSummary): string =>
  summary.parts.map(sealPartText).join(' - ');

// ── One seal, once per receipt ───────────────────────────────────────────────────────────────────
//
// Round 21 — the owner, over his own form with bags 1 … 6 and boxes 1 and 3: «مينفعش يكون فيه رقم
// للحقائب و الصناديق زى بعض برضو». A seal closes ONE package, so one receipt names it ONCE, the bags
// and the boxes read as one list; «برضو» — as with a number typed twice in one list, which until then
// was only an amber «مكرر» beside its summary line. Now both are a refusal, not a warning: the
// contract refuses the receipt (`ReceiveIntoVaultSchema`), and the form says it before it is sent —
// every box holding a repeated seal red, one notice under the seals, «استلام» held. "The same seal"
// is the contract's own `vaultSealKey` (0099 = 99 = ٩٩; a text seal as typed), so the form and the
// server cannot disagree about a repeat. Cartons have no seals; other shipments' seals are not
// compared (not asked).

/** Which list of seal boxes — the bags', or the boxes'. */
export type SealListKind = 'bag' | 'box';

/** One box on screen: its list, and its position in it. */
export interface SealSpot {
  list: SealListKind;
  index: number;
}

/** Where a repeated seal stands: in both lists, or more than once in one of them. */
export type SealRepeatWhere = 'both' | 'bags' | 'boxes';

export interface SealRepeat {
  /** The seal as typed (trimmed) in the first box that holds it. */
  seal: string;
  /** Every box holding it — the bags' first, then the boxes', each in order. */
  spots: SealSpot[];
  where: SealRepeatWhere;
}

export interface SealRepeats {
  /** Each repeated seal once, in the order the form reads them: the bags first, then the boxes. */
  repeats: SealRepeat[];
  /** Per box on screen, the repeat it is part of — null for a box whose seal is its own. */
  bags: (SealRepeat | null)[];
  boxes: (SealRepeat | null)[];
}

/** The boxes on screen of one list — what `SealBoxes` draws, empty ones included. */
export const shownSeals = (list: SealList, slots: number): string[] =>
  growSeals(list.seals, slots).slice(0, slots);

/**
 * The seals named more than once across the two lists ON SCREEN (`shownSeals` — a box hidden by a
 * lowered count is no seal of this receipt), and which boxes hold them. Blanks are no seal.
 */
export const sealRepeats = (bags: readonly string[], boxes: readonly string[]): SealRepeats => {
  const byKey = new Map<string, { seal: string; spots: SealSpot[] }>();
  const read = (list: SealListKind, seals: readonly string[]): void =>
    seals.forEach((raw, index) => {
      const key = vaultSealKey(raw);
      if (key === null) return;
      const held = byKey.get(key);
      if (held === undefined) byKey.set(key, { seal: raw.trim(), spots: [{ list, index }] });
      else held.spots.push({ list, index });
    });
  read('bag', bags);
  read('box', boxes);
  const repeats: SealRepeat[] = [];
  const marks: Record<SealListKind, (SealRepeat | null)[]> = {
    bag: bags.map(() => null),
    box: boxes.map(() => null),
  };
  for (const { seal, spots } of byKey.values()) {
    if (spots.length < 2) continue;
    const inBags = spots.some((spot) => spot.list === 'bag');
    const inBoxes = spots.some((spot) => spot.list === 'box');
    const repeat: SealRepeat = {
      seal,
      spots,
      where: inBags && inBoxes ? 'both' : inBags ? 'bags' : 'boxes',
    };
    repeats.push(repeat);
    for (const spot of spots) marks[spot.list][spot.index] = repeat;
  }
  return { repeats, bags: marks.bag, boxes: marks.box };
};

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** The notice says a seal in both lists first — the owner's own case — then one list's repeats. */
const WHERE_ORDER: readonly SealRepeatWhere[] = ['both', 'bags', 'boxes'];

/** «1 و3», «1 and 3» — the locale's own way of listing. */
const listOf = (values: readonly string[], locale: Locale): string =>
  new Intl.ListFormat(locale, { type: 'conjunction' }).format(values);

/**
 * Between the notice's sentences: the Arabic semicolon «؛», not a middle dot — beside Arabic words a
 * «·» reads as the Arabic-Indic zero «٠», and this notice is about numbers.
 */
const SENTENCES_JOIN: Record<Locale, string> = { ar: '؛ ', en: '; ' };

/**
 * The ONE notice under the seals — a sentence per place, in Arabic's own forms of the count: «الرقم
 * 1 مكرر — في الحقائب والصناديق», «الرقمان 1 و3 مكرران — في الحقائب والصناديق», «الأرقام 4 و5 و6
 * مكررة — في الحقائب». '' when no seal repeats. The very words a refusal from the server is said in.
 */
export const sealRepeatNotice = (
  repeats: readonly SealRepeat[],
  t: Translate,
  locale: Locale,
): string =>
  WHERE_ORDER.flatMap((where) => {
    const seals = repeats.filter((repeat) => repeat.where === where).map((repeat) => repeat.seal);
    return seals.length === 0
      ? []
      : [
          t(pluralKey('operations.secured.receive.sealRepeat', locale, seals.length), {
            seals: listOf(seals, locale),
            where: t(`operations.secured.receive.sealRepeatWhere.${where}`),
          }),
        ];
  }).join(SENTENCES_JOIN[locale]);

/** A box as the form numbers it — the bag (or box) it closes, and which of its seals. */
export interface SealPlace {
  list: SealListKind;
  unit: number;
  seal: number;
}

/**
 * The OTHER boxes holding the seal a box holds — where else it is, numbered as the boxes' own
 * labels number them (bags by «2×»/«3×», boxes by two).
 */
export const otherPlaces = (repeat: SealRepeat, self: SealSpot, perBag: number): SealPlace[] =>
  repeat.spots
    .filter((spot) => spot.list !== self.list || spot.index !== self.index)
    .map((spot) => {
      const per = spot.list === 'bag' ? perBag : BOX_SEALS_PER_BOX;
      return {
        list: spot.list,
        unit: Math.floor(spot.index / per) + 1,
        seal: (spot.index % per) + 1,
      };
    });

/** What a red box's title says: «مكرر — موجود أيضًا في الصندوق 1، الختم 1». */
export const sealRepeatTitle = (
  repeat: SealRepeat,
  self: SealSpot,
  perBag: number,
  t: Translate,
  locale: Locale,
): string =>
  t('operations.secured.receive.sealRepeatAt', {
    places: listOf(
      otherPlaces(repeat, self, perBag).map((place) =>
        t(`operations.secured.receive.sealPlace.${place.list}`, {
          unit: place.unit,
          seal: place.seal,
        }),
      ),
      locale,
    ),
  });

// ── Counts and «عدد الورق من كل فئة» ────────────────────────────────────────────────────────────

/** A typed count as a whole number: '' (nothing typed), a fraction or a negative are 0. */
export const parseCount = (raw: string): number => {
  const text = asciiDigits(raw.trim());
  if (!/^\d+$/u.test(text)) return 0;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : 0;
};

/** A denomination as the legacy form labelled its box: «0.25», «0.50», «1» … «200». */
export const denominationLabel = (value: number): string =>
  value < 1 ? value.toFixed(2) : String(value);

/**
 * The note counts the form sends, from the nine boxes (one per `OPERATIONS_VAULT_DENOMINATIONS`
 * entry, in that order): only a count above zero, smallest denomination first — what the server
 * stores (a zero is accepted and dropped there; not sending it keeps the request what was meant).
 */
export const denominationLines = (
  counts: readonly string[],
): OperationsVaultDenominationCountDto[] =>
  OPERATIONS_VAULT_DENOMINATIONS.flatMap((value, index) => {
    const count = parseCount(counts[index] ?? '');
    return count > 0 ? [{ value, count }] : [];
  });

/**
 * What the counted notes come to, in pounds. Summed in PIASTRES — 0.25 × 3 is 0.75 exactly, which
 * a sum of floating halves and quarters is not always — and handed back in pounds.
 */
export const denominationsTotal = (
  lines: readonly Pick<OperationsVaultDenominationCountDto, 'value' | 'count'>[],
): number =>
  lines.reduce((piastres, line) => piastres + Math.round(line.value * 100) * line.count, 0) / 100;

/** The counted total against the shipment's pound amount. */
export type DenominationCheck =
  /** Nothing counted — nothing to compare («كله اختيارى»). */
  | { state: 'none' }
  | { state: 'match' }
  /** `difference` is counted − shipment: above zero, more was counted than the shipment says. */
  | { state: 'mismatch'; difference: number };

/**
 * A gentle check, never a refusal: the notes counted against the pound the shipment carries. Equal
 * to the piastre is a match; nothing counted is no check at all.
 */
export const denominationCheck = (counted: number, shipmentPound: number): DenominationCheck => {
  if (counted === 0) return { state: 'none' };
  const difference = Math.round(counted * 100 - shipmentPound * 100) / 100;
  return difference === 0 ? { state: 'match' } : { state: 'mismatch', difference };
};

/**
 * The shipment's pound amount — its lines whose currency is the pound (`isPound`, the board's own
 * reading of the catalog: `currencyKind`). Summed in piastres, as the denominations are.
 */
export const poundAmount = (
  lines: readonly { currencyId: string; amount: number }[],
  isPound: (currencyId: string) => boolean,
): number =>
  lines
    .filter((line) => isPound(line.currencyId))
    .reduce((piastres, line) => piastres + Math.round(line.amount * 100), 0) / 100;

// ── The shipment's data, as the vault corrected it ──────────────────────────────────────────────

/**
 * The top of the form as it stands — the shipment form's own state, read the way it sends it:
 * days as 'YYYY-MM-DD' ('' for no delivery day), the TO bank already folded into
 * `secondaryBankId` (`secondaryBankFor`), the area and notes trimmed or null, the money lines
 * complete ones only (`toShipmentLines`).
 */
export interface ShipmentDraftValues {
  mainBankId: string;
  secondaryBankId: string | null;
  originBranchId: string;
  destinationBranchId: string;
  areaName: string | null;
  lines: { currencyId: string; amount: number }[];
  collectionDate: string;
  deliveryDate: string;
  notes: string | null;
}

const dayOf = (iso: string | null): string => (iso === null ? '' : iso.slice(0, 10));
const textOrNull = (value: string | null): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

const sameLines = (
  held: readonly { currencyId: string; amount: number }[],
  draft: readonly { currencyId: string; amount: number }[],
): boolean =>
  held.length === draft.length &&
  held.every(
    (line, index) =>
      line.currencyId === draft[index]?.currencyId && line.amount === draft[index]?.amount,
  );

/**
 * ONLY WHAT CHANGED, as `ReceiveIntoVaultShipmentPatchSchema` takes it — or `undefined` when the
 * vault changed nothing, and the request carries no `shipment` at all. Every field the patch names
 * is re-checked by the server against the edit form's rules, so a field merely looked at is not
 * sent: «السجل» then shows exactly the vault's corrections.
 *
 *   · The TO bank compares by what it MEANS (`secondaryBankId ?? mainBankId`): a row stored with
 *     its main bank in `secondaryBankId` reads as «the main bank» on both sides. When the MAIN bank
 *     changes, `secondaryBankId` goes with it whenever its stored value differs from the form's —
 *     the server would otherwise keep a TO bank the form no longer means.
 *   · Notes compare trimmed, so a stored «x » is not "changed" into «x» by being shown.
 *   · Lines compare in order, currency and amount; the form opens on the stored order.
 */
export const shipmentPatch = (
  held: Pick<
    OperationsShipmentDto,
    | 'mainBankId'
    | 'secondaryBankId'
    | 'originBranchId'
    | 'destinationBranchId'
    | 'areaName'
    | 'lines'
    | 'collectionDate'
    | 'deliveryDate'
    | 'notes'
  >,
  draft: ShipmentDraftValues,
): ReceiveIntoVaultShipmentPatch | undefined => {
  const patch: ReceiveIntoVaultShipmentPatch = {};
  const mainChanged = draft.mainBankId !== held.mainBankId;
  if (mainChanged) patch.mainBankId = draft.mainBankId;
  const heldTo = held.secondaryBankId ?? held.mainBankId;
  const draftTo = draft.secondaryBankId ?? draft.mainBankId;
  if (heldTo !== draftTo || (mainChanged && held.secondaryBankId !== draft.secondaryBankId)) {
    patch.secondaryBankId = draft.secondaryBankId;
  }
  if (draft.originBranchId !== held.originBranchId) patch.originBranchId = draft.originBranchId;
  if (draft.destinationBranchId !== held.destinationBranchId) {
    patch.destinationBranchId = draft.destinationBranchId;
  }
  if (draft.areaName !== textOrNull(held.areaName)) patch.areaName = draft.areaName;
  if (!sameLines(held.lines, draft.lines)) patch.lines = draft.lines;
  // The contract types dates post-coercion; JSON writes a Date as the ISO day the server coerces.
  if (draft.collectionDate !== dayOf(held.collectionDate)) {
    patch.collectionDate = new Date(draft.collectionDate);
  }
  if (draft.deliveryDate !== dayOf(held.deliveryDate)) {
    patch.deliveryDate = draft.deliveryDate === '' ? null : new Date(draft.deliveryDate);
  }
  if (draft.notes !== textOrNull(held.notes)) patch.notes = draft.notes;
  return Object.keys(patch).length === 0 ? undefined : patch;
};

// ── The request ──────────────────────────────────────────────────────────────────────────────────

/** The middle and the bottom of the form, as typed. */
export interface ReceiptDraft {
  receiptNumber: string;
  bagCount: string;
  boxCount: string;
  cartonCount: string;
  bagSealsPerBag: OperationsVaultBagSealsPerBag;
  /** Every seal box ever drawn (`growSeals`) — only the ones on screen are sent. */
  bagSeals: readonly string[];
  boxSeals: readonly string[];
  /** One per `OPERATIONS_VAULT_DENOMINATIONS` entry, in that order. */
  denominations: readonly string[];
  serialTracked: boolean;
}

/** The boxes on screen for the draft's counts — bags × «2×»/«3×», boxes × 2. */
export const draftSlots = (
  draft: Pick<ReceiptDraft, 'bagCount' | 'boxCount' | 'bagSealsPerBag'>,
) => ({
  bags: sealSlots(parseCount(draft.bagCount), draft.bagSealsPerBag),
  boxes: sealSlots(parseCount(draft.boxCount), BOX_SEALS_PER_BOX),
});

/**
 * `POST /operations/secured/:id/receive`'s body. Names NOBODY — no treasurer, no receiver: the
 * server records the signed-in user from the token. Nothing in it is required but the version: an
 * empty receipt number is none (null), an empty count 0, a seal box left empty no seal.
 *
 * «سيريال» is ALWAYS sent: «بتتعرف عند الاستلام اذا كان سيريال او لا» — the vault decides it here,
 * for this shipment, whatever it said before (the server records a change on `vaultReceived`).
 */
export const receiveRequest = (
  draft: ReceiptDraft,
  patch: ReceiveIntoVaultShipmentPatch | undefined,
  version: number,
): ReceiveIntoVaultInput => {
  const slots = draftSlots(draft);
  const receiptNumber = draft.receiptNumber.trim();
  return {
    receiptNumber: receiptNumber === '' ? null : receiptNumber,
    bagCount: parseCount(draft.bagCount),
    cartonCount: parseCount(draft.cartonCount),
    boxCount: parseCount(draft.boxCount),
    bagSealsPerBag: draft.bagSealsPerBag,
    bagSeals: sealsToSend(draft.bagSeals, slots.bags),
    boxSeals: sealsToSend(draft.boxSeals, slots.boxes),
    denominations: denominationLines(draft.denominations),
    serialTracked: draft.serialTracked,
    ...(patch === undefined ? {} : { shipment: patch }),
    version,
  };
};

// ── A refused receipt, said where it belongs ────────────────────────────────────────────────────

/**
 * The boxes of the form a refusal can name: the top's — and, since Round 21, `seals`, the seals
 * band, for a seal the server refused as named twice in the receipt.
 */
export type ReceiveField =
  | 'mainBank'
  | 'toBank'
  | 'origin'
  | 'destination'
  | 'lines'
  | 'collectionDate'
  | 'deliveryDate'
  | 'seals';

/**
 * Round 21 — the contract's refusal of a seal named twice in one receipt: a 400 whose detail is a
 * `custom` issue on a seal of either list (`body.bagSeals.3`). The form only ever sends strings,
 * within the ceiling, so on these two fields that refusal is the only one it can meet.
 */
const SEAL_REPEAT_FIELD = /^body\.(bagSeals|boxSeals)\.\d+$/u;
const isSealRepeat = (error: ApiError): boolean =>
  error.code === ErrorCodes.VALIDATION_FAILED &&
  (error.details ?? []).some(
    (detail) => detail.code === 'CUSTOM' && SEAL_REPEAT_FIELD.test(detail.field ?? ''),
  );

export interface ReceiveRefusal {
  /** The box it is said under, when the code says which; null → a toast. */
  field: ReceiveField | null;
  /** The i18n key, or null when the refusal is not about the values (`errorMessage` words it). */
  key: string | null;
  /**
   * The row on screen can never be received from here — someone else received it meanwhile, or it
   * is locked: nothing typed can be saved past it, so the form closes over a board that re-reads.
   * A STALE row does not close it: what was typed (the seals, the counts) stays on screen, to be
   * printed or typed again, as the shipment form keeps its values on the same refusal.
   */
  closes: boolean;
}

/** Refusals of the receipt itself — the shipment form has no words for them. */
const RECEIVE_ERRORS: Record<string, string> = {
  // Not a draft any more: received (or sent out) by someone else after the row was read.
  OPERATIONS_INVALID_SHIPMENT_TRANSITION: 'operations.secured.receive.errors.notDraft',
  // The custody's own guard — this shipment is already in the vault (a 409 `ConflictError`, whose
  // code is the generic `DUPLICATE`; on this route nothing else answers it).
  DUPLICATE: 'operations.secured.receive.errors.notDraft',
};

/**
 * The shipment form's words for a refusal (`shipmentSaveErrorKey`) — but its catch-all «تعذّر حفظ
 * الشحنة» becomes the receipt's own «تعذّر تسجيل الاستلام»: what failed here is the receipt.
 */
const receiveKey = (error: unknown): string | null => {
  const key = shipmentSaveErrorKey(error);
  return key === 'operations.shipment.saveFailed' ? 'operations.secured.receive.failed' : key;
};

/**
 * Where a refused receipt is said — «Server refusals shown by field where the codes allow», in the
 * shipment form's words (`shipmentSaveErrorKey`, its `SAVE_ERRORS`):
 *
 *   · a branch of another bank → the TO branch; an unknown or stopped branch → the side the
 *     server's message names; an unknown or stopped bank → the main bank, or the TO bank;
 *   · an unknown or stopped currency → the money lines;
 *   · a seal named twice in the receipt (Round 21) → the seals band;
 *   · a date refused (`MIN_DATE`) → the date box its detail names; a delivery day moved off a van
 *     whose captain has started → the delivery date;
 *   · anything else — stale, locked, received by someone else, no connection — a toast.
 */
export const receiveRefusal = (error: unknown): ReceiveRefusal => {
  if (!(error instanceof ApiError)) {
    return { field: null, key: receiveKey(error), closes: false };
  }
  const own = RECEIVE_ERRORS[error.code];
  if (own !== undefined) return { field: null, key: own, closes: true };
  // A repeated seal is said under the seals, in the words the form says it in before sending
  // (`sealRepeatNotice`) — never «بعض الحقول تحتاج إلى مراجعة».
  if (isSealRepeat(error)) {
    return { field: 'seals', key: 'operations.secured.receive.sealRepeatRefused', closes: false };
  }
  const key = receiveKey(error);
  const closes = error.code === ErrorCodes.OPERATIONS_SECURED_LOCKED;
  const said = (field: ReceiveField): ReceiveRefusal => ({ field, key, closes: false });
  const message = error.message.toLowerCase();
  switch (error.code) {
    case 'OPERATIONS_BRANCH_BANK_MISMATCH':
      return said('destination');
    case 'OPERATIONS_UNKNOWN_BRANCH':
      return message.includes('origin')
        ? said('origin')
        : message.includes('destination')
          ? said('destination')
          : { field: null, key, closes: false };
    case 'OPERATIONS_UNKNOWN_BANK':
      return said(message.includes('secondary') ? 'toBank' : 'mainBank');
    case 'OPERATIONS_UNKNOWN_CURRENCY':
      return said('lines');
    case 'OPERATIONS_DISTRIBUTION_LEG_STARTED':
      return said('deliveryDate');
    case 'OPERATIONS_SHIPMENT_DATE_IN_PAST':
    case 'OPERATIONS_SHIPMENT_DATE_BEFORE_ORIGINAL':
    case 'OPERATIONS_SHIPMENT_DELIVERY_BEFORE_COLLECTION': {
      const field = error.details?.find((detail) => detail.code === 'MIN_DATE')?.field;
      return field === 'collectionDate' || field === 'deliveryDate'
        ? said(field)
        : { field: null, key, closes: false };
    }
    default:
      return { field: null, key, closes };
  }
};
