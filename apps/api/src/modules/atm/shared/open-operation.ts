// The owner's rule, 2026-10-13: «مينفعش أضيف ماكينة مرتين سواء فى عملية التغذية أو الصيانة» — a
// machine is never added twice, whether to replenishment or to maintenance.
//
// What that means here, exactly:
//   · a machine has AT MOST ONE OPEN replenishment and AT MOST ONE OPEN maintenance at a time
//     (open = `closedAt: null`, not soft-deleted); the two kinds are independent of each other,
//     and once an operation closes a new one for the same machine may open;
//   · the machine is its normalized `machineCode` COMPANY-WIDE — the identity the mail matcher
//     already uses — so an operation open in another branch blocks too, and a refusal names only
//     the code the caller typed, never where the open operation is;
//   · every path that creates or re-opens an open operation enforces it (the two batch opens, the
//     two reopens, the mail accept), and a partial unique index per collection makes it race-proof.
//
// The legacy had no such guard (contad_app.js:637-768 opened one row per pasted line, and the
// maintenance open :1896-1957 likewise) — an owner decision overriding legacy, port doc OD-1.
import { ErrorCodes } from '@ecms/contracts';
import { ConflictError } from '../../../shared/errors';

export type AtmOperationKind = 'replenishment' | 'maintenance';

/** The race-proof half of the rule, one per collection — built at boot by `atm-indexes.ts`. */
export const OPEN_OPERATION_INDEX_NAMES: Record<AtmOperationKind, string> = {
  replenishment: 'ux_open_replenishment_per_code',
  maintenance: 'ux_open_maintenance_per_code',
};

/**
 * The rows the unique index covers: open, live, and with a NON-EMPTY code. `closedAt: null` also
 * matches a row with no `closedAt` at all, which is what the service check's `closedAt: null`
 * query matches too — the two can never disagree about what "open" means. The code must be a
 * non-empty string because an empty one identifies no machine: no live path writes one (the open
 * forms skip blank lines, and `machineCode` is a required String, which Mongoose rejects when
 * empty), but a raw legacy import could, and N such rows must not collide with each other.
 *
 * A fresh object per call — Mongoose keeps the options it is handed.
 */
export const openOperationPartialFilter = (): Record<string, unknown> => ({
  closedAt: null,
  isDeleted: false,
  machineCode: { $gt: '' },
});

/** What happened to one submitted line of a batch open. */
export type OpenLineDecision = 'blank' | 'unknown' | 'alreadyOpen' | 'open';

/**
 * Pure: the per-line outcome of a batch open, in input order. A blank line is skipped, a code
 * with no active machine is `unknown` (as before), a code that already has an open operation is
 * `alreadyOpen`, and a code REPEATED inside the batch opens once — on its first line — with every
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
 * The refusal a single-row write (a reopen, an accepted mail) answers with: 409 under one stable
 * code. The message names the machine code the caller already holds and nothing else — no
 * branch, no row — because the blocking operation may sit where the caller cannot read.
 */
export const alreadyOpenError = (kind: AtmOperationKind, machineCode: string): ConflictError =>
  new ConflictError(
    `machine ${machineCode} already has an open ${kind}`,
    ErrorCodes.ATM_OPERATION_ALREADY_OPEN,
  );

export const isAlreadyOpenError = (error: unknown): boolean =>
  error instanceof ConflictError && error.code === ErrorCodes.ATM_OPERATION_ALREADY_OPEN;

/**
 * Did a write lose the race to the open-operation index? `create` reports E11000 as a
 * `ConflictError` (base.repository.ts); `findOneAndUpdate` lets the driver's error through with
 * `code: 11000`. On these two collections the open index is the only unique index besides `_id`,
 * which a fresh ObjectId cannot collide on — so either form IS the rule's refusal.
 */
export const isOpenOperationDuplicate = (error: unknown): boolean =>
  (error instanceof ConflictError && error.code === ErrorCodes.DUPLICATE) ||
  (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000);
