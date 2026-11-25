// The module's numbered series (design §2.8): which counter key each series takes, and where its
// floor is read. The printed forms live in the contracts (`formatAdministrationMasterCode`), which
// a screen reads too; this file holds only what the server needs to hand a number out.
//
// Two series so far, the item code (P1a.2) and the supplier code (P1b.1): global and never reset,
// so their keys carry no year (OD-05 A). The yearly document series (P2) join this table.
//
// THE FLOOR. A counter that went missing must come back at the highest number already used, never
// at 0, where every create would meet `ux_code` on «ITM-00001» for ever. The floor is read from the
// codes themselves, retired rows included, since a code is never reused. Read the plain way —
// newest code first — it breaks past five digits: «ITM-99999» sorts after «ITM-100000». So the
// read groups the codes by length and takes the greatest of the longest, which is the highest
// number at any width, through the anchored prefix that `ux_code` serves. Only the formatter's
// spelling is grouped — five digits, or more with no leading zero — so the greatest of the longest
// is always a code the parser reads: a hand-typed «ITM-000042» must not outgrow «ITM-00500» and
// floor the counter at 0.
import {
  ADMINISTRATION_MASTER_CODE_DIGITS,
  ADMINISTRATION_MASTER_CODE_PREFIXES,
  parseAdministrationMasterCode,
  type AdministrationMasterKind,
} from '@ecms/contracts';
import { type PipelineStage } from 'mongoose';

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
