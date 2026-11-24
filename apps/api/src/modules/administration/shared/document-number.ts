// The module's numbered series (design §2.8): which counter key each series takes, and where its
// floor is read. The printed forms live in the contracts (`formatAdministrationMasterCode`), which
// a screen reads too; this file holds only what the server needs to hand a number out.
//
// P1a.2 has one series, the item code: global and never reset, so its key carries no year (OD-05
// A). The supplier code (P1b.1) and the yearly document series (P2) join this table.
//
// THE FLOOR. A counter that went missing must come back at the highest number already used, never
// at 0, where every create would meet `ux_code` on «ITM-00001» for ever. The floor is read from the
// codes themselves, retired rows included, since a code is never reused. Read the plain way —
// newest code first — it breaks past five digits: «ITM-99999» sorts after «ITM-100000». So the
// read groups the codes by length and takes the greatest of the longest, which is the highest
// number at any width, through the anchored prefix that `ux_code` serves.
import {
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

/** The aggregation that finds the series' highest code in its collection's `code` field. */
export const highestCodePipeline = (series: MasterCodeSeries): PipelineStage[] => [
  { $match: { code: { $regex: `^${series.prefix}-[0-9]+$` } } },
  { $group: { _id: { $strLenCP: '$code' }, top: { $max: '$code' } } },
  { $sort: { _id: -1 } },
  { $limit: 1 },
];

/**
 * The floor that pipeline's answer gives: the number of the highest code, or 0 when there is
 * none. A code the formatter would not have written (typed into the database by hand) counts as
 * none, rather than raising the counter to a number no item was ever given.
 */
export const floorFrom = (series: MasterCodeSeries, rows: readonly { top?: unknown }[]): number => {
  const top = rows[0]?.top;
  if (typeof top !== 'string') return 0;
  const parsed = parseAdministrationMasterCode(top);
  return parsed?.kind === series.kind ? parsed.seq : 0;
};
