// The module's numbered series (design §2.8): which counter key each series takes, and where its
// floor is read. The printed forms live in the contracts (`formatAdministrationMasterCode`,
// `formatAdministrationNumber`), which a screen reads too; this file holds only what the server
// needs to hand a number out.
//
// Two master series, the item code (P1a.2) and the supplier code (P1b.1): global and never reset,
// so their keys carry no year (OD-05 A). And the yearly document series (P2.1), one per document
// kind and year, «PR-2026-000001» on `purchaseRequest:2026` (OD-58 A): its year is the Cairo year
// of the act's business date (OD-57 A), worked out once from the act's instant for both the key
// and the date the document stores, so the two never disagree at the turn of the year (RK-13).
//
// THE FLOOR. A counter that went missing must come back at the highest number already used, never
// at 0, where every create would meet `ux_code` on «ITM-00001» for ever. The floor is read from the
// codes themselves, retired rows included, since a code is never reused. Read the plain way —
// newest code first — it breaks past five digits: «ITM-99999» sorts after «ITM-100000». So the
// read groups the codes by length and takes the greatest of the longest, which is the highest
// number at any width, through the anchored prefix that `ux_code` serves. Only the formatter's
// spelling is grouped — five digits, or more with no leading zero — so the greatest of the longest
// is always a code the parser reads: a hand-typed «ITM-000042» must not outgrow «ITM-00500» and
// floor the counter at 0. A document series reads its year's numbers by the same rule, through
// `ux_number`: only the server writes a number, but an operator's hand fix must not floor a
// series wrongly either.
import {
  ADMINISTRATION_DOCUMENT_DIGITS,
  ADMINISTRATION_DOCUMENT_PREFIXES,
  ADMINISTRATION_MASTER_CODE_DIGITS,
  ADMINISTRATION_MASTER_CODE_PREFIXES,
  parseAdministrationMasterCode,
  parseAdministrationNumber,
  type AdministrationDocumentKind,
  type AdministrationMasterKind,
} from '@ecms/contracts';
import { type PipelineStage } from 'mongoose';
import { cairoCalendarDate } from './cairo-day';

export interface MasterCodeSeries {
  kind: AdministrationMasterKind;
  /** The counter row in `administration_counters` (§2.3.1). */
  key: string;
  /** The code's prefix, «ITM» — what the floor read matches. */
  prefix: string;
}

export const ITEM_CODE_SERIES: MasterCodeSeries = {
  kind: 'item',
  key: 'item:global',
  prefix: ADMINISTRATION_MASTER_CODE_PREFIXES.item,
};

export const SUPPLIER_CODE_SERIES: MasterCodeSeries = {
  kind: 'supplier',
  key: 'supplier:global',
  prefix: ADMINISTRATION_MASTER_CODE_PREFIXES.supplier,
};

const DIGITS = ADMINISTRATION_MASTER_CODE_DIGITS;

/** The formatter's spelling of the series' codes: its width exactly, or wider with no leading 0. */
const codePattern = (series: MasterCodeSeries): string =>
  `^${series.prefix}-(?:[0-9]{${String(DIGITS)}}|[1-9][0-9]{${String(DIGITS)},})$`;

/** The aggregation that finds the series' highest code in its collection's `code` field. */
export const highestCodePipeline = (series: MasterCodeSeries): PipelineStage[] => [
  { $match: { code: { $regex: codePattern(series) } } },
  { $group: { _id: { $strLenCP: '$code' }, top: { $max: '$code' } } },
  { $sort: { _id: -1 } },
  { $limit: 1 },
];

/**
 * The floor that pipeline's answer gives: the number of the highest code, or 0 when there is
 * none. The match keeps every wider misspelling out, so a code typed into the database by hand
 * hides no real one; a top that still does not parse — «ITM-00000», a number past the safe
 * integers — counts as none, rather than raising the counter to a number no item was ever given.
 */
export const floorFrom = (series: MasterCodeSeries, rows: readonly { top?: unknown }[]): number => {
  const top = rows[0]?.top;
  if (typeof top !== 'string') return 0;
  const parsed = parseAdministrationMasterCode(top);
  return parsed?.kind === series.kind ? parsed.seq : 0;
};

// ── The yearly document series ──────────────────────────────────────────────

export interface DocumentNumberSeries {
  kind: AdministrationDocumentKind;
  /** The Cairo calendar year of the business date the number is taken on (OD-57 A). */
  year: number;
  /** The counter row in `administration_counters`: `purchaseRequest:2026` (§2.8). */
  key: string;
  /**
   * The number's prefix through its year, «PR-2026» — what the floor read matches. A master
   * code's prefix is its kind's alone; a document's is its year's, since each year restarts.
   */
  prefix: string;
}

/** The series of one document kind in one year. */
export const documentNumberSeries = (
  kind: AdministrationDocumentKind,
  year: number,
): DocumentNumberSeries => ({
  kind,
  year,
  key: `${kind}:${String(year)}`,
  prefix: `${ADMINISTRATION_DOCUMENT_PREFIXES[kind]}-${String(year)}`,
});

/**
 * An act at `at`: its business date, the Cairo date stored as UTC midnight, and the series its
 * number comes from — both read from that one instant. An act at 23:59 on 31 December, Cairo
 * time, takes that year's number and that date; one at 00:00 on 1 January takes the next year's
 * number and the next date, though the UTC clock still reads the old year for two hours. Reading
 * the clock twice could split the two across midnight.
 */
export const documentNumberAt = (
  kind: AdministrationDocumentKind,
  at: Date,
): { businessDate: Date; series: DocumentNumberSeries } => {
  const businessDate = cairoCalendarDate(at);
  return { businessDate, series: documentNumberSeries(kind, businessDate.getUTCFullYear()) };
};

const NUMBER_DIGITS = ADMINISTRATION_DOCUMENT_DIGITS;

/** The formatter's spelling of the series' numbers: six digits exactly, or wider with no leading 0. */
const numberPattern = (series: DocumentNumberSeries): string =>
  `^${series.prefix}-(?:[0-9]{${String(NUMBER_DIGITS)}}|[1-9][0-9]{${String(NUMBER_DIGITS)},})$`;

/**
 * The aggregation that finds the series' highest number in its collection's `number` field. The
 * `$type` is the partial filter of the document's `ux_number` (the purchase request's from P2.2),
 * so the planner can use that index for the anchored prefix; a draft, which has no number yet, is
 * never read.
 */
export const highestNumberPipeline = (series: DocumentNumberSeries): PipelineStage[] => [
  { $match: { number: { $type: 'string', $regex: numberPattern(series) } } },
  { $group: { _id: { $strLenCP: '$number' }, top: { $max: '$number' } } },
  { $sort: { _id: -1 } },
  { $limit: 1 },
];

/**
 * The floor that pipeline's answer gives: the sequence of the year's highest number, or 0 when
 * there is none. A top that does not parse, or that names another kind or another year, counts as
 * none, as `floorFrom` does for a master code.
 */
export const numberFloorFrom = (
  series: DocumentNumberSeries,
  rows: readonly { top?: unknown }[],
): number => {
  const top = rows[0]?.top;
  if (typeof top !== 'string') return 0;
  const parsed = parseAdministrationNumber(top);
  return parsed?.kind === series.kind && parsed.year === series.year ? parsed.seq : 0;
};
