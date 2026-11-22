// «عداد الطابعة» (owner, 2026-11-19) — «عند صرف الصنف : حبارة أو النوع : حبارات .. عايز يبقى فى Counter
// لعدد لورق المطبوع للطابعة اللى بيركب عليها الحبارة — يعني إجبارى أدخل عدد الورق المطبوع عند تركيب
// الحبارة», and then «كمان عايزك تكتب اخر قراءة لما أجى أصرف حبارة جديدة .. وأكيد مش هيدخل عدد ورق
// أقل أو مساوي للى موجود».
//
// The issue's counter rules, as pure functions — so each is proven without a browser, and «صرف»
// (`components/ConsumableDialogs.tsx`) and «تعديل الجهاز» only wire them:
//   · WHICH LINE COUNTS. An item whose TYPE is ticked «يتطلب عداد الطباعة» («حبارات» from the start).
//     A catalog that could not be read counts nothing here: the dialog adds no field, and the server,
//     which reads the type itself, is the judge.
//   · WHAT A COUNTED LINE NEEDS. The printer it goes into («مركّب على» — so the register of devices,
//     `itAsset.view`), one cartridge, and the printer's counter as its display shows it: a whole
//     number. The lines of one memo on one printer carry ONE reading — one display, one moment.
//   · THE LAST READING. Once a counted line has its printer, the printer's newest reading is shown
//     under the box, and a reading at or below it is refused there and then — STRICTLY greater —
//     unless «تم تصفير عداد الطابعة» is ticked. An issue dated before that reading is backdated, and
//     only the server can place it among the readings around its date, so it is left to the server.
//     The server judges every reading again inside its transaction, under the printer's lock.
//   · A MOVED LINE STARTS AGAIN. A reading belongs to the printer it was read on: a line whose device
//     changes — picked again, cleared, or taken off by a change of person — loses its reading.
//   · WHAT A REFUSAL SAYS. The server's three counter codes carry the line and field they are about
//     and, for a reading it refuses, the reading it was held against and when that was taken: said
//     on that line's field, with the figures («… (١٢٬٣٤٥ بتاريخ …)»), while the line is as it was sent
//     — and, for a reading refused against another, while the memo is dated as it was sent: the date
//     places the reading, so another date is another verdict. The dialog's alert says it too.
import {
  ErrorCodes,
  IT_PRINTER_COUNTER_MAX,
  type ItCatalogItemDto,
  type ItConsumableDto,
  type ItPrinterCounterDto,
  type Locale,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { errorMessage } from '../../../shared/lib/errors';
import { formatDateTime, formatNumber } from '../../../shared/lib/format';
import { type Translate } from './register-export';

/** The ids of the consumable types whose items take the printer's counter. */
export const countingTypes = (
  types: readonly Pick<ItCatalogItemDto, 'id' | 'requiresCounterReading'>[] | undefined,
): ReadonlySet<string> =>
  new Set((types ?? []).filter((type) => type.requiresCounterReading).map((type) => type.id));

/** What these rules read of an issue line. */
export interface CounterDraftLine {
  /** Stable across removals. */
  key: number;
  consumable: Pick<ItConsumableDto, 'id' | 'typeId'> | null;
  /** The printer, '' when none is named. */
  assetId: string;
  qty: string;
  /** «قراءة عداد الطابعة» as typed. */
  counterReading: string;
  /** «تم تصفير عداد الطابعة». */
  counterReset: boolean;
}

/** Whether this line's item takes the printer's counter. */
export const countsLine = (
  line: Pick<CounterDraftLine, 'consumable'>,
  counting: ReadonlySet<string>,
): boolean => line.consumable !== null && counting.has(line.consumable.typeId);

/** A reading typed into the box: a whole number from 0 to the contract's bound, or NaN. */
export const counterValue = (text: string): number => {
  const value = text.trim();
  if (!/^\d+$/u.test(value)) return Number.NaN;
  const reading = Number(value);
  return reading <= IT_PRINTER_COUNTER_MAX ? reading : Number.NaN;
};

/** The printer's newest reading, as the server answers it — null when it has none yet. */
export type LatestReading = ItPrinterCounterDto['latest'];

/** Whatever a counted line, or the server about one, has to say. */
export type CounterProblem =
  /** The printer is picked from the register of devices, which this reader cannot open. */
  | { kind: 'needsAssets' }
  | { kind: 'printerRequired' }
  | { kind: 'readingRequired' }
  /** Not a whole number, or past the contract's bound. */
  | { kind: 'readingInvalid' }
  | { kind: 'oneCartridge' }
  /**
   * Not strictly above the reading before it — `reading`/`at` are that reading, null when the
   * server did not name it.
   */
  | { kind: 'belowPrevious'; reading: number | null; at: string | null }
  /** A backdated reading not strictly below a later one — `reading`/`at` are that later one. */
  | { kind: 'aboveNext'; reading: number | null; at: string | null }
  /** Another reading than line `line`'s, on the same printer. */
  | { kind: 'sameReading'; line: number };

/** A counted line's check: whether it may be sent, and what to say under each of its fields. */
export interface CounterLineCheck {
  ok: boolean;
  /**
   * Under each field — null where nothing is wrong, and while a box is merely empty: its asterisk
   * and its hint say it is required, and the save waits for it.
   */
  printer: CounterProblem | null;
  qty: CounterProblem | null;
  reading: CounterProblem | null;
}

const FINE: CounterLineCheck = { ok: true, printer: null, qty: null, reading: null };

/**
 * The first line of the memo on `assetId` that carries a valid reading — what every later line on
 * that printer must repeat (the contract compares each with it, too). Numbered from one, as shown.
 */
const firstReadingOn = (
  assetId: string,
  lines: readonly (CounterDraftLine & { counts: boolean })[],
): { key: number; number: number; reading: number; reset: boolean } | null => {
  const index = lines.findIndex(
    (line) =>
      line.counts && line.assetId === assetId && !Number.isNaN(counterValue(line.counterReading)),
  );
  const first = lines[index];
  return first === undefined
    ? null
    : {
        key: first.key,
        number: index + 1,
        reading: counterValue(first.counterReading),
        reset: first.counterReset,
      };
};

/**
 * One line's counter, checked. `latest` is its printer's newest reading as read — null for none
 * yet, undefined while it is not read (or could not be: the server judges then). `issuedAt` is the
 * memo's date. `lines` are all the memo's lines, in order, each with whether it counts.
 */
export const counterLineCheck = (
  line: CounterDraftLine,
  {
    counts,
    canAssets,
    latest,
    issuedAt,
    lines,
  }: {
    counts: boolean;
    canAssets: boolean;
    latest: LatestReading | undefined;
    issuedAt: Date;
    lines: readonly (CounterDraftLine & { counts: boolean })[];
  },
): CounterLineCheck => {
  if (!counts) return FINE;
  if (!canAssets) {
    return { ok: false, printer: { kind: 'needsAssets' }, qty: null, reading: null };
  }
  const qty = line.qty.trim() === '1' ? null : ({ kind: 'oneCartridge' } as const);
  if (line.assetId === '') return { ok: false, printer: null, qty, reading: null };
  const typed = line.counterReading.trim();
  const reading = counterValue(typed);
  if (typed === '' || Number.isNaN(reading)) {
    return {
      ok: false,
      printer: null,
      qty,
      reading: typed === '' ? null : { kind: 'readingInvalid' },
    };
  }
  const first = firstReadingOn(line.assetId, lines);
  const problem: CounterProblem | null =
    first !== null &&
    first.key !== line.key &&
    (first.reading !== reading || first.reset !== line.counterReset)
      ? { kind: 'sameReading', line: first.number }
      : !line.counterReset &&
          latest !== undefined &&
          latest !== null &&
          issuedAt.getTime() >= Date.parse(latest.at) &&
          reading <= latest.reading
        ? { kind: 'belowPrevious', reading: latest.reading, at: latest.at }
        : null;
  return { ok: qty === null && problem === null, printer: null, qty, reading: problem };
};

/** Whether the memo is dated before the printer's newest reading — the server places it then. */
export const backdatedAgainst = (latest: LatestReading | undefined, issuedAt: Date): boolean =>
  latest !== undefined && latest !== null && issuedAt.getTime() < Date.parse(latest.at);

/**
 * The lines after a change, with the reading taken off every line whose device is no longer the one
 * it was read on. The same array when no line lost one, so a reducer's state keeps its identity.
 */
export const clearMovedReadings = <L extends Omit<CounterDraftLine, 'consumable' | 'qty'>>(
  before: readonly L[],
  after: L[],
): L[] => {
  let changed = false;
  const lines = after.map((line) => {
    const was = before.find((each) => each.key === line.key);
    if (was === undefined || was.assetId === line.assetId) return line;
    if (line.counterReading === '' && !line.counterReset) return line;
    changed = true;
    return { ...line, counterReading: '', counterReset: false };
  });
  return changed ? lines : after;
};

/** What a line adds to the issue's body: its reading when it counts, nothing otherwise. */
export const counterBody = (
  line: Pick<CounterDraftLine, 'counterReading' | 'counterReset'>,
  counts: boolean,
): { counterReading?: number; counterReset?: true } =>
  counts
    ? {
        counterReading: counterValue(line.counterReading),
        ...(line.counterReset ? { counterReset: true as const } : {}),
      }
    : {};

// ── The server's refusals ────────────────────────────────────────────────────

/** The field of a line (or of «تعديل الجهاز»'s one row) a refusal is about. */
export type CounterField = 'assetId' | 'counterReading' | 'qty';

export interface CounterFailure {
  /** The line's index in the request — null for «تعديل الجهاز», which has no lines. */
  index: number | null;
  field: CounterField;
  problem: CounterProblem;
}

const COUNTER_CODES: ReadonlySet<string> = new Set([
  ErrorCodes.IT_CONSUMABLE_COUNTER_REQUIRED,
  ErrorCodes.IT_CONSUMABLE_COUNTER_BELOW_PREVIOUS,
  ErrorCodes.IT_CONSUMABLE_COUNTER_ABOVE_NEXT,
]);

/** «lines.2.counterReading», «counterReading» (and a `body.` prefix, should the envelope add one). */
const FIELD = /^(?:body\.)?(?:lines\.(\d+)\.)?(assetId|counterReading|qty)$/u;

const parseField = (field: string | undefined): Omit<CounterFailure, 'problem'> | null => {
  const match = FIELD.exec(field ?? '');
  if (match === null) return null;
  return {
    index: match[1] === undefined ? null : Number(match[1]),
    field: match[2] as CounterField,
  };
};

/**
 * The counter refusals an error carries, one per field — empty for any other error. A
 * `…_BELOW_PREVIOUS` / `…_ABOVE_NEXT` names the reading it was held against in two details on the
 * reading's field; one the server could not name is said without its figures.
 */
export const counterFailures = (error: unknown): CounterFailure[] => {
  if (!(error instanceof ApiError) || !COUNTER_CODES.has(error.code)) return [];
  const details = error.details ?? [];
  if (error.code === ErrorCodes.IT_CONSUMABLE_COUNTER_REQUIRED) {
    return details.flatMap((detail) => {
      const at = parseField(detail.field);
      if (at === null) return [];
      const problem: CounterProblem =
        detail.code === 'ONE_CARTRIDGE'
          ? { kind: 'oneCartridge' }
          : at.field === 'assetId'
            ? { kind: 'printerRequired' }
            : at.field === 'qty'
              ? { kind: 'oneCartridge' }
              : { kind: 'readingRequired' };
      return [{ ...at, problem }];
    });
  }
  const prefix =
    error.code === ErrorCodes.IT_CONSUMABLE_COUNTER_BELOW_PREVIOUS ? 'PREVIOUS' : 'NEXT';
  const kind = prefix === 'PREVIOUS' ? 'belowPrevious' : 'aboveNext';
  const byField = new Map<
    string,
    { at: Omit<CounterFailure, 'problem'>; reading: number | null; when: string | null }
  >();
  for (const detail of details) {
    const at = parseField(detail.field);
    if (at === null) continue;
    const id = `${String(at.index)}:${at.field}`;
    const entry = byField.get(id) ?? { at, reading: null, when: null };
    if (detail.code === `${prefix}_READING`) {
      const reading = Number(detail.message);
      entry.reading = Number.isInteger(reading) ? reading : null;
    } else if (detail.code === `${prefix}_AT` && !Number.isNaN(Date.parse(detail.message))) {
      entry.when = detail.message;
    }
    byField.set(id, entry);
  }
  return [...byField.values()].map(({ at, reading, when }) => ({
    ...at,
    problem: { kind, reading, at: when },
  }));
};

/** A refused line as it was sent: its refusals stand while it is still exactly that. */
export interface SentCounterFailure {
  key: number;
  field: CounterField;
  problem: CounterProblem;
  sent: Omit<CounterDraftLine, 'key'>;
  /** The memo's date box as it was sent — '' for «now», which the server stamps. */
  issuedAt: string;
}

const sameDraft = (sent: Omit<CounterDraftLine, 'key'>, line: CounterDraftLine): boolean =>
  (sent.consumable?.id ?? '') === (line.consumable?.id ?? '') &&
  sent.assetId === line.assetId &&
  sent.qty === line.qty &&
  sent.counterReading === line.counterReading &&
  sent.counterReset === line.counterReset;

/**
 * Whether the memo's date decides this refusal. A reading is placed among the printer's readings by
 * the memo's date: the date says which reading it was held against, and whether below one or above
 * a later one — another date, another verdict. That an item takes the counter, a printer and one
 * cartridge does not depend on the date.
 */
const dated = (problem: CounterProblem): boolean =>
  problem.kind === 'belowPrevious' || problem.kind === 'aboveNext';

/**
 * The issue's refusals, each pinned to the line it was about by that line's key as sent, and to the
 * memo's date box as sent (`issuedAt`, '' for «now»).
 */
export const sentCounterFailures = (
  failures: readonly CounterFailure[],
  sent: readonly CounterDraftLine[],
  issuedAt: string,
): SentCounterFailure[] =>
  failures.flatMap(({ index, field, problem }) => {
    const line = index === null ? undefined : sent[index];
    if (line === undefined) return [];
    const { key, ...draft } = line;
    return [{ key, field, problem, sent: draft, issuedAt }];
  });

/**
 * What the server said about this field of this line — while the line is still as it was sent, and,
 * for a reading it held against another, while the memo is still dated as it was sent (`issuedAt`,
 * the date box as it is now).
 */
export const standingFailure = (
  failures: readonly SentCounterFailure[],
  line: CounterDraftLine,
  field: CounterField,
  issuedAt: string,
): CounterProblem | null =>
  failures.find(
    (failure) =>
      failure.key === line.key &&
      failure.field === field &&
      sameDraft(failure.sent, line) &&
      (!dated(failure.problem) || failure.issuedAt === issuedAt),
  )?.problem ?? null;

// ── In words ────────────────────────────────────────────────────────────────

/** «آخر قراءة مسجّلة لهذه الطابعة: ١٢٬٣٤٥ — ١٩ نوفمبر ٢٠٢٦، ١٠:٣٠ ص». */
export const lastReadingWords = (
  t: Translate,
  latest: NonNullable<LatestReading>,
  locale: Locale,
): string =>
  t('it.consumables.counter.lastReading', {
    reading: formatNumber(latest.reading, locale),
    date: formatDateTime(latest.at, locale),
  });

/** The toner a reading was taken with — «HP 85A (CON-00004)», or what there is of it. */
export const readingToner = (reading: {
  consumableName: string | null;
  consumableCode: string | null;
}): string | null => {
  const name = reading.consumableName?.trim() ?? '';
  const code = reading.consumableCode?.trim() ?? '';
  if (name === '') return code === '' ? null : code;
  return code === '' ? name : `${name} (${code})`;
};

/** A counter problem as the field says it. */
export const counterProblemWords = (
  t: Translate,
  problem: CounterProblem,
  locale: Locale,
): string => {
  switch (problem.kind) {
    case 'needsAssets':
      return t('it.consumables.counter.needsAssets');
    case 'printerRequired':
      return t('it.consumables.counter.printerRequired');
    case 'readingRequired':
      return t('it.consumables.counter.readingRequired');
    case 'readingInvalid':
      return t('it.consumables.counter.readingInvalid', {
        max: formatNumber(IT_PRINTER_COUNTER_MAX, locale),
      });
    case 'oneCartridge':
      return t('it.consumables.counter.oneCartridge');
    case 'sameReading':
      return t('it.consumables.counter.sameReading', { n: formatNumber(problem.line, locale) });
    case 'belowPrevious':
    case 'aboveNext': {
      const bare =
        problem.kind === 'belowPrevious'
          ? 'it.consumables.counter.belowPreviousBare'
          : 'it.consumables.counter.aboveNextBare';
      if (problem.reading === null || problem.at === null) return t(bare);
      return t(
        problem.kind === 'belowPrevious'
          ? 'it.consumables.counter.belowPrevious'
          : 'it.consumables.counter.aboveNext',
        {
          reading: formatNumber(problem.reading, locale),
          date: formatDateTime(problem.at, locale),
        },
      );
    }
  }
};

/**
 * What the issue's alert says of a failed save. A refusal pinned to a line: the words its field
 * says, with the figure — the printer's toast says the same. A counter refusal that named no line
 * of the memo: the platform's words for its code. Any other error: null, for the dialog to word as
 * it words its other failures.
 */
export const refusalAlertWords = (
  t: Translate,
  refusals: readonly Pick<SentCounterFailure, 'problem'>[],
  error: unknown,
  locale: Locale,
): string | null => {
  const [first] = refusals;
  if (first !== undefined) return counterProblemWords(t, first.problem, locale);
  return error instanceof ApiError && COUNTER_CODES.has(error.code)
    ? errorMessage(error, locale)
    : null;
};
