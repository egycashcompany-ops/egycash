// The owner's rule, and how it was lifted — history now, enforced nowhere:
//
//   · 2026-10-13 (port doc OD-1): «مينفعش أضيف ماكينة مرتين سواء فى عملية التغذية أو الصيانة» — a
//     machine is never added twice, whether to replenishment or to maintenance;
//   · 2026-10-27 (OD-1a), narrowed to the day: «خلى الرفض دا يحصل فقط إذا كانت الماكينات مفتوحه في
//     نفس اليوم ولم تُغلق ! مش يرفضها لو مفتوحه أمبارح ومتقفلتش» — a machine open YESTERDAY and
//     never closed no longer blocked today;
//   · 2026-11-01 (OD-1b), lifted for replenishments: «عايزك تسمح فى التغذيات بإنى افتح تغذيه أكتر من
//     واحده لنفس الماكينة عادى»;
//   · 2026-11-02 (OD-1c), lifted for maintenance: «في الصيانة عايزك تسمح إنه يضيف أكتر من صيانة
//     عادي».
//
// So a machine may have several open operations of either kind, on any day, as in the legacy
// (contad_app.js:637-768 opened one row per pasted line, and the maintenance open :1896-1957
// likewise): no path checks, refuses or reports it, and no unique index holds it — the boot drops
// the ones older databases built (below). What stays: every write that sets an open time also
// stores its Cairo day (`openDay`), and the mail `duplication` flag still asks "is this machine's
// maintenance open on the ticket's day?" — as a warning only (operation-log.repository.ts
// `openMachineCodes`).
import { cairoDateString } from './cairo-time';

export type AtmOperationKind = 'replenishment' | 'maintenance';

/**
 * Indexes the operation logs must not carry any more, which the boot DROPS (`atm-indexes.ts`) —
 * an index, never a document:
 *   · the company-wide, any-day indexes of the rule's first form (2026-10-13), which would go on
 *     refusing a machine open yesterday (OD-1a);
 *   · the per-day indexes of its second form, which would go on refusing a second open operation
 *     of a machine that day — the replenishment log's since OD-1b (2026-11-01), the maintenance
 *     log's since OD-1c (2026-11-02).
 */
export const RETIRED_OPEN_OPERATION_INDEX_NAMES: Record<AtmOperationKind, readonly string[]> = {
  replenishment: ['ux_open_replenishment_per_code', 'ux_open_replenishment_per_code_day'],
  maintenance: ['ux_open_maintenance_per_code', 'ux_open_maintenance_per_code_day'],
};

/**
 * The day an operation belongs to — the Cairo calendar day of its open time, `YYYY-MM-DD`, the day
 * the boards show it on. Stored beside `openedAt` as `openDay` on every write that sets the open
 * time (it held the per-day index while the rule stood, and is kept). The mail `duplication`
 * question never reads the stored field: it asks by the open time's own day range, so a row
 * written before the field existed counts for its day all the same.
 */
export const openDayOf = (openedAt: Date): string => cairoDateString(openedAt);
