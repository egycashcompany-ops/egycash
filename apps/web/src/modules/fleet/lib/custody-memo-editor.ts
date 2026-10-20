// «مذكرة جديدة» / «تعديل المذكرة» — the editor's arithmetic, kept out of the page so every rule of
// it is proved without a screen.
//
// «لما ادوس عليه اقدر اختار من الاربع صيانة او وقود او كاوتش او غسيل … واقدر احدد من كل واحده ب
// سيلكت»: the kind, then the period, then that kind's custody receipts that no memo holds yet,
// each with its «علامة صح». «عاوز احدد العربيات اسمحلى افلتر ب كود العربيه»: the app's own «كود
// السيارة» filter over that list — while codes are chosen, the memo is the ticked receipts OF THOSE
// CARS. A tick on a row the period or the codes hide is KEPT (widening them brings it back), but it
// is not in the memo: the footer, the paper and the save all follow what is on show.
//
// Nothing on the form is required but a receipt: no name («اسم المذكرة» is optional, app-only and
// never printed), and an emptied date box is simply not sent — the server then keeps the stored
// day, or works the period out of the receipts.
import {
  FLEET_CUSTODY_MEMO_MAX_LINES,
  FLEET_CUSTODY_SOURCES,
  compareFleetVehicleCodes,
  type CreateFleetCustodyMemo,
  type FleetCustodyMemoCandidateDto,
  type FleetCustodyMemoDto,
  type FleetCustodyMemoLine,
  type FleetCustodyOutsideKindDto,
  type FleetCustodySource,
  type Locale,
  type UpdateFleetCustodyMemo,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { type MemoPaperLine } from './custody-papers';
import { writeRefusalOf } from './write-refusal';

/** The most receipts one memo holds — the API's own cap on lines and on candidates. */
export const MEMO_MAX_LINES = FLEET_CUSTODY_MEMO_MAX_LINES;

/** A period, YYYY-MM-DD at both ends; `''` is an end left open (its box emptied). */
export interface MemoPeriod {
  from: string;
  to: string;
}

/** What he types on one line — kept on the memo, never on the receipt. */
export interface MemoTyped {
  /** «المأمورية» — fuel. */
  mission: string;
  /** «البيان» — maintenance. */
  statement: string;
  /** «ملاحظات» — fuel and maintenance. */
  note: string;
}
export const NO_TYPING: MemoTyped = { mission: '', statement: '', note: '' };

/** A receipt the memo holds, with what was typed on its line. */
export interface PickedLine {
  receipt: FleetCustodyMemoCandidateDto;
  typed: MemoTyped;
}

/** The kind an address names, or `null` for none or a word that is no custody kind. */
export const memoKindOf = (raw: string | undefined): FleetCustodySource | null =>
  raw !== undefined && (FLEET_CUSTODY_SOURCES as readonly string[]).includes(raw)
    ? (raw as FleetCustodySource)
    : null;

/**
 * «مذكرة جديدة» with no kind in its address opens on the first kind — the custody screen's order,
 * صيانة · وقود · كاوتش · غسيل — that has receipts waiting for a memo; none waiting, on صيانة.
 */
export const defaultMemoKind = (
  outside: readonly FleetCustodyOutsideKindDto[] | undefined,
): FleetCustodySource =>
  FLEET_CUSTODY_SOURCES.find((kind) =>
    (outside ?? []).some((line) => line.kind === kind && line.count > 0),
  ) ?? 'maintenance';

/**
 * Where a new memo starts and ends: the day of its first waiting receipt to the day of its last —
 * how the saved memos read, so the memo shows in «المذكرات» with the period the editor showed.
 * None waiting: today, both ends.
 */
export const periodOf = (
  receipts: readonly Pick<FleetCustodyMemoCandidateDto, 'date'>[],
  today: string,
): MemoPeriod => {
  const days = receipts.map((r) => r.date).sort();
  return { from: days[0] ?? today, to: days.at(-1) ?? today };
};

/**
 * Where an edit starts: the memo's own period, widened to every receipt it holds — so a line the
 * stored period would leave out is still on show, and still in the memo when it is saved again.
 */
export const editPeriodOf = (
  memo: Pick<FleetCustodyMemoDto, 'from' | 'to' | 'lines'>,
): MemoPeriod => {
  const days = [memo.from, memo.to, ...memo.lines.map((line) => line.date)].filter((d) => d !== '');
  const sorted = [...days].sort();
  return { from: sorted[0] ?? memo.from, to: sorted.at(-1) ?? memo.to };
};

/** The rows the period and the chosen codes let through — in the server's order (day, then entry). */
export const visibleRows = <R extends Pick<FleetCustodyMemoCandidateDto, 'date' | 'vehicleCode'>>(
  rows: readonly R[],
  period: MemoPeriod,
  codes: readonly string[],
): R[] =>
  rows.filter(
    (row) =>
      (period.from === '' || row.date >= period.from) &&
      (period.to === '' || row.date <= period.to) &&
      (codes.length === 0 || (row.vehicleCode !== null && codes.includes(row.vehicleCode))),
  );

/** The memo: the ticked rows ON SHOW, each with what was typed on it. A hidden tick is not in it. */
export const pickedLines = (
  shown: readonly FleetCustodyMemoCandidateDto[],
  ticked: ReadonlySet<string>,
  typed: Readonly<Record<string, MemoTyped>>,
): PickedLine[] =>
  shown
    .filter((row) => ticked.has(row.id))
    .map((receipt) => ({ receipt, typed: typed[receipt.id] ?? NO_TYPING }));

/** How many of `rows` are ticked. */
const tickedAmong = (rows: readonly { id: string }[], ticked: ReadonlySet<string>): number =>
  rows.reduce((n, row) => n + (ticked.has(row.id) ? 1 : 0), 0);

/**
 * The ticks for receipts seen for the first time. A NEW memo ticks every one (as the sample
 * opens), up to the cap; an EDIT ticks its own lines only — a receipt that turns up later (another
 * one entered meanwhile, a period widened) is ticked on a new memo and left unticked on an edit.
 * A receipt already seen keeps whatever the reader made of it.
 */
export const tickNewcomers = (
  receipts: readonly FleetCustodyMemoCandidateDto[],
  seen: ReadonlySet<string>,
  ticked: ReadonlySet<string>,
  editing: boolean,
  cap: number = MEMO_MAX_LINES,
): { seen: Set<string>; ticked: Set<string> } => {
  const nextSeen = new Set(seen);
  const nextTicked = new Set(ticked);
  let count = tickedAmong(receipts, ticked);
  for (const row of receipts) {
    if (nextSeen.has(row.id)) continue;
    nextSeen.add(row.id);
    const wanted = editing ? row.inThisMemo : true;
    if (wanted && !nextTicked.has(row.id) && count < cap) {
      nextTicked.add(row.id);
      count += 1;
    }
  }
  return { seen: nextSeen, ticked: nextTicked };
};

/** The ticks a list opens with — `tickNewcomers` over a list nothing of which was seen before. */
export const initialTicks = (
  receipts: readonly FleetCustodyMemoCandidateDto[],
  editing: boolean,
  cap: number = MEMO_MAX_LINES,
): Set<string> => tickNewcomers(receipts, new Set(), new Set(), editing, cap).ticked;

/**
 * The head's tick, for the rows on show: on once every row on show is ticked — or as many as one
 * memo holds — a dash while only some are.
 */
export const headTick = (
  shown: readonly { id: string }[],
  ticked: ReadonlySet<string>,
  cap: number = MEMO_MAX_LINES,
): { on: boolean; partly: boolean } => {
  const picked = tickedAmong(shown, ticked);
  const on = picked > 0 && picked >= Math.min(shown.length, cap);
  return { on, partly: picked > 0 && !on };
};

/**
 * The head's tick pressed: when on, every row on show is unticked; otherwise the rows on show are
 * ticked in order until the memo is full (`capped`: some were left out for want of room). Hidden
 * ticks are never touched.
 */
export const toggleAllShown = (
  shown: readonly { id: string }[],
  ticked: ReadonlySet<string>,
  cap: number = MEMO_MAX_LINES,
): { ticked: Set<string>; capped: boolean } => {
  const next = new Set(ticked);
  if (headTick(shown, ticked, cap).on) {
    for (const row of shown) next.delete(row.id);
    return { ticked: next, capped: false };
  }
  let count = tickedAmong(shown, ticked);
  let capped = false;
  for (const row of shown) {
    if (next.has(row.id)) continue;
    if (count >= cap) {
      capped = true;
      break;
    }
    next.add(row.id);
    count += 1;
  }
  return { ticked: next, capped };
};

/** One row's tick pressed — refused (`capped`) when the memo already holds all it can. */
export const toggleOne = (
  id: string,
  shown: readonly { id: string }[],
  ticked: ReadonlySet<string>,
  cap: number = MEMO_MAX_LINES,
): { ticked: Set<string>; capped: boolean } => {
  const next = new Set(ticked);
  if (next.has(id)) {
    next.delete(id);
    return { ticked: next, capped: false };
  }
  if (tickedAmong(shown, ticked) >= cap) return { ticked: next, capped: true };
  next.add(id);
  return { ticked: next, capped: false };
};

/** What a line types first: its saved cells on an edit; a fuel receipt's proposed mission. */
export const typedOf = (
  receipt: Pick<FleetCustodyMemoCandidateDto, 'suggestedMission'>,
  saved?: Pick<MemoTyped, 'mission' | 'statement' | 'note'>,
): MemoTyped =>
  saved === undefined
    ? { mission: receipt.suggestedMission ?? '', statement: '', note: '' }
    : { mission: saved.mission, statement: saved.statement, note: saved.note };

/** «كود السيارة»'s options: the cars this list holds, in the fleet's order. */
export const codeOptions = (
  rows: readonly Pick<FleetCustodyMemoCandidateDto, 'vehicleCode'>[],
): { value: string; label: string; shortLabel: string }[] =>
  [...new Set(rows.flatMap((row) => (row.vehicleCode === null ? [] : [row.vehicleCode])))]
    .sort(compareFleetVehicleCodes)
    .map((code) => ({ value: code, label: code, shortLabel: code }));

/** The memo's figure, summed in whole piastres. */
export const pickedTotal = (picked: readonly PickedLine[]): number =>
  picked.reduce((sum, line) => sum + Math.round(line.receipt.amount * 100), 0) / 100;

/** The picked lines as his paper of the kind draws them. Never the memo's name. */
export const paperLinesOf = (picked: readonly PickedLine[]): MemoPaperLine[] =>
  picked.map(({ receipt, typed }) => ({
    code: receipt.vehicleCode ?? '',
    date: receipt.date,
    amount: receipt.amount,
    mission: typed.mission,
    statement: typed.statement,
    note: typed.note,
  }));

/** The memo as it is being written, before it becomes a request body. */
export interface MemoDraft {
  kind: FleetCustodySource;
  name: string;
  /** «تاريخ المذكرة», YYYY-MM-DD; `''` when its box was emptied. */
  date: string;
  period: MemoPeriod;
  picked: readonly PickedLine[];
}

/** Each line's typed cells — only those his paper of the kind has a column for. */
export const memoLinesOf = (
  kind: FleetCustodySource,
  picked: readonly PickedLine[],
): FleetCustodyMemoLine[] =>
  picked.map(({ receipt, typed }) => ({
    receiptId: receipt.id,
    mission: kind === 'fuel' ? typed.mission.trim() : '',
    statement: kind === 'maintenance' ? typed.statement.trim() : '',
    note: kind === 'fuel' || kind === 'maintenance' ? typed.note.trim() : '',
  }));

/** A day box as the request carries it: an emptied box is NOT sent (never `''`, never `null`). */
const dayField = <K extends string>(key: K, day: string): Partial<Record<K, Date>> =>
  day === '' ? {} : ({ [key]: new Date(day) } as Record<K, Date>);

/** «حفظ المذكرة» on a new memo. */
export const memoBody = (draft: MemoDraft): CreateFleetCustodyMemo => ({
  kind: draft.kind,
  name: draft.name.replace(/\s+/gu, ' ').trim(),
  ...dayField('date', draft.date),
  ...dayField('from', draft.period.from),
  ...dayField('to', draft.period.to),
  lines: memoLinesOf(draft.kind, draft.picked),
});

/** «حفظ المذكرة» on an edit: the whole memo again, with the version it was read at. */
export const memoUpdateBody = (draft: MemoDraft, version: number): UpdateFleetCustodyMemo => ({
  ...memoBody(draft),
  version,
});

/**
 * Why the server refused a memo write, in the words the screen has for it — so it can say WHICH
 * rule refused it and read again what changed:
 *   taken    409 — a ticked receipt went onto another memo meanwhile (`DUPLICATE`);
 *   changed  400 — a ticked receipt was deleted, or its kind or payment changed, meanwhile;
 *   locked   422 — the memo was replenished meanwhile («استعاضة عهدة»), or its kind changed;
 *   stale    409 — the memo itself was changed elsewhere since it was read;
 *   gone     404 — the memo was deleted meanwhile.
 * `null` for anything else, which keeps its usual message.
 */
export type MemoRefusal = 'taken' | 'changed' | 'locked' | 'stale' | 'gone';
export const memoRefusalOf = (error: unknown): MemoRefusal | null => {
  if (!(error instanceof ApiError)) return null;
  const refusal = writeRefusalOf(error);
  if (refusal !== null) return refusal;
  if (error.status === 409 && error.code === 'DUPLICATE') return 'taken';
  if (error.status === 404) return 'gone';
  if (
    error.status === 400 &&
    (error.details ?? []).some((detail) => /^(body\.)?lines\./u.test(detail.field ?? ''))
  )
    return 'changed';
  return null;
};

/**
 * «كاوتش أكتوبر 2026» — the name the box suggests: the kind and the month its period ends in,
 * the month in the reader's language and the year in Latin digits, as every figure on the boards.
 */
export const monthOfDay = (day: string, locale: Locale): string => {
  const at = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return '';
  const month = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
    month: 'long',
    timeZone: 'UTC',
  }).format(at);
  return `${month} ${String(at.getUTCFullYear())}`;
};
