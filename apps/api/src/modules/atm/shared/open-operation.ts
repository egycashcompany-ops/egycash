// The owner's rule, 2026-10-13: «مينفعش أضيف ماكينة مرتين سواء فى عملية التغذية أو الصيانة» — a
// machine is never added twice, whether to replenishment or to maintenance. NARROWED 2026-10-27 to
// the day: «خلى الرفض دا يحصل فقط إذا كانت الماكينات مفتوحه في نفس اليوم ولم تُغلق ! مش يرفضها لو
// مفتوحه أمبارح ومتقفلتش» — a machine open YESTERDAY and never closed no longer blocks today. LIFTED
// for replenishments 2026-11-01 (port doc OD-1b): «عايزك تسمح فى التغذيات بإنى افتح تغذيه أكتر من
// واحده لنفس الماكينة عادى» — a machine may have several open replenishments, as in the legacy.
//
// What that means here, exactly — for MAINTENANCE only:
//   · a machine has AT MOST ONE OPEN maintenance PER CAIRO DAY (open = `closedAt: null`, not
//     soft-deleted; the day = the Cairo calendar day of `openedAt`, the same day the boards group
//     by); once it closes a new one for the same machine may open that day. Replenishments are
//     outside the rule and never block a maintenance;
//   · the machine is its normalized `machineCode` COMPANY-WIDE — the identity the mail matcher
//     already uses — so a maintenance open in another branch blocks too, and a refusal names only
//     the code the caller typed, never where the open operation is;
//   · every path that creates or re-opens an open maintenance enforces it (the batch open, the
//     reopen, the mail accept), and so does the edit that MOVES an open maintenance to another day
//     (the single edit of the open time — the maintenance bulk edit sets the leader only). A
//     partial unique index on `{ machineCode, openDay }` makes it race-proof.
//
// The legacy had no such guard (contad_app.js:637-768 opened one row per pasted line, and the
// maintenance open :1896-1957 likewise) — an owner decision overriding legacy, port doc OD-1.
import { ErrorCodes } from '@ecms/contracts';
import { ConflictError } from '../../../shared/errors';
import { cairoDateString } from './cairo-time';

export type AtmOperationKind = 'replenishment' | 'maintenance';

/**
 * The race-proof half of the rule — the maintenance log's index, built at boot by `atm-indexes.ts`.
 * Replenishments carry none since OD-1b.
 */
export const OPEN_MAINTENANCE_INDEX_NAME = 'ux_open_maintenance_per_code_day';

/**
 * Indexes the operation logs must not carry any more, which the boot DROPS (`atm-indexes.ts`) —
 * an index, never a document:
 *   · the company-wide, any-day indexes of the rule's first form (2026-10-13), which would go on
 *     refusing a machine open yesterday (OD-1a);
 *   · the replenishment log's per-day index, which would go on refusing a second open
 *     replenishment of a machine (OD-1b, 2026-11-01).
 */
export const RETIRED_OPEN_OPERATION_INDEX_NAMES: Record<AtmOperationKind, readonly string[]> = {
  replenishment: ['ux_open_replenishment_per_code', 'ux_open_replenishment_per_code_day'],
  maintenance: ['ux_open_maintenance_per_code'],
};

/**
 * The day an operation belongs to — the Cairo calendar day of its open time, `YYYY-MM-DD`. Stored
 * beside `openedAt` as `openDay` on every write that sets the open time, because a partial index
 * cannot compute it. The SERVICE checks never read the stored field: they ask by the open time's
 * own day range, so a row written before the field existed blocks its day exactly the same.
 */
export const openDayOf = (openedAt: Date): string => cairoDateString(openedAt);

/**
 * The rows the maintenance log's unique index covers: open, live, with a NON-EMPTY code and a stored day.
 * `closedAt: null` also matches a row with no `closedAt` at all, which is what the service check's
 * `closedAt: null` query matches too — the two can never disagree about what "open" means. The
 * code must be a non-empty string because an empty one identifies no machine: no live path writes
 * one (the open forms skip blank lines, and `machineCode` is a required String, which Mongoose
 * rejects when empty), but a raw legacy import could, and N such rows must not collide with each
 * other. The day must be a string too: a row stored before `openDay` existed has none, and every
 * such row would otherwise share the one "no day" key — the service check holds those by their
 * open time instead.
 *
 * A fresh object per call — Mongoose keeps the options it is handed.
 */
export const openOperationPartialFilter = (): Record<string, unknown> => ({
  closedAt: null,
  isDeleted: false,
  machineCode: { $gt: '' },
  openDay: { $gt: '' },
});

/** What happened to one submitted line of a batch open. */
export type OpenLineDecision = 'blank' | 'unknown' | 'alreadyOpen' | 'open';

/**
 * Pure: the per-line outcome of a batch maintenance open, in input order. A blank line is skipped, a code
 * with no active machine is `unknown` (as before), a code that already has an open operation ON
 * THE BATCH'S DAY is `alreadyOpen` (every line of a batch opens at the same instant, so the batch
 * has one day), and a code REPEATED inside the batch opens once — on its first line — with every
 * later line `alreadyOpen`.
 */
export const decideOpenLines = (
  codes: readonly string[],
  isKnown: (code: string) => boolean,
  alreadyOpen: ReadonlySet<string>,
): OpenLineDecision[] => {
  const claimed = new Set(alreadyOpen);
  return codes.map((code) => {
    if (code === '') return 'blank';
    if (!isKnown(code)) return 'unknown';
    if (claimed.has(code)) return 'alreadyOpen';
    claimed.add(code);
    return 'open';
  });
};

/**
 * The refusal a single-row write (a reopen, an accepted mail, an edit moving the open time) answers
 * with: 409 under one stable code. The message names the machine code the caller already holds and nothing else — no
 * branch, no row — because the blocking operation may sit where the caller cannot read.
 */
export const alreadyOpenError = (kind: AtmOperationKind, machineCode: string): ConflictError =>
  new ConflictError(
    `machine ${machineCode} already has an open ${kind} that day`,
    ErrorCodes.ATM_OPERATION_ALREADY_OPEN,
  );

export const isAlreadyOpenError = (error: unknown): boolean =>
  error instanceof ConflictError && error.code === ErrorCodes.ATM_OPERATION_ALREADY_OPEN;

/**
 * Did a write lose the race to the open-maintenance index? `create` reports E11000 as a
 * `ConflictError` (base.repository.ts); `findOneAndUpdate` and `updateMany` let the driver's error
 * through with `code: 11000`. On the maintenance log the open index is the only unique index
 * besides `_id`, which a fresh ObjectId cannot collide on — so either form IS the rule's refusal.
 */
export const isOpenOperationDuplicate = (error: unknown): boolean =>
  (error instanceof ConflictError && error.code === ErrorCodes.DUPLICATE) ||
  (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000);
