// What every master register of the module does the same way — units, categories and items now;
// warehouses and suppliers as they ship — written once so the five cannot drift apart: the answer
// to a duplicate (design §5.15), a stale edit's (§19.3), the audit verb of each act (§10.2) and the
// text search (§19.4).
// Each feature keeps what is its own: its checks, its literal entity ref, its snapshot, its signal.
import {
  ErrorCodes,
  foldName,
  type AdministrationDuplicateField,
  type AuditAction,
} from '@ecms/contracts';
import { isDuplicateKeyError } from '../../../shared/base/index-sync';
import { AppError, ConflictError, StaleDocumentError } from '../../../shared/errors';

// ── Duplicates ──────────────────────────────────────────────────────────────
//
// Neither the platform's `ConflictError` (`DUPLICATE`) nor a raw E11000 reaches a screen: the web
// has no words for the first and would show the second's English (RK-23). A duplicate arrives two
// ways and both end in the same 409: the service's own check before the write, which gives the
// early answer, and a unique index refusing a write that raced past that check — the index is the
// only guard two simultaneous creates cannot both pass (§2.1).

export const duplicateRefusal = (field: AdministrationDuplicateField): AppError =>
  new AppError(
    ErrorCodes.ADMINISTRATION_DUPLICATE,
    409,
    `another live row already holds this ${field}`,
    { details: [{ field, code: 'duplicate', message: `the ${field} is taken` }] },
  );

/**
 * A write a unique index refused: raw from `updateById`, or already turned into the platform's
 * `ConflictError` by `BaseRepository.create`, which keeps only the field names in its message.
 */
export const isDuplicateWrite = (error: unknown): boolean =>
  isDuplicateKeyError(error) ||
  (error instanceof ConflictError && error.code === ErrorCodes.DUPLICATE);

/**
 * A register's own question, "which field would this write take from a live row?" — asked before
 * the write and again after a unique index refused it. Each feature asks it its own way.
 */
export type TakenField = () => Promise<AdministrationDuplicateField | null>;

/** The early answer: refuse before writing when a live row already holds the name or the code. */
export const assertNotTaken = async (taken: TakenField): Promise<void> => {
  const field = await taken();
  if (field !== null) throw duplicateRefusal(field);
};

/**
 * What to throw after a failed write. A unique index refused a write that raced past the early
 * check: the row that won is in now, so the same question names the field. Any other failure goes
 * on as it came — and so does a refusal the question cannot explain, rather than a guessed field.
 */
export const explainDuplicate = async (error: unknown, taken: TakenField): Promise<unknown> => {
  if (!isDuplicateWrite(error)) return error;
  const field = await taken();
  return field === null ? error : duplicateRefusal(field);
};

// ── Stale edits ─────────────────────────────────────────────────────────────
//
// An edit is judged on the stored row merged with its body. A body written against an older row
// would be judged on fields its sender never saw — refused for a level or a parent it did not
// send — and a retry with its own version could never pass. So the version is answered before
// any rule; `updateById`'s version filter still catches a write that lands after this read.

/** 409 `STALE_DOCUMENT` unless the body was written against the row as it is now. */
export const assertCurrentVersion = (row: { __v: number }, version: number): void => {
  if (row.__v !== version) throw new StaleDocumentError();
};

// ── Audit verbs ─────────────────────────────────────────────────────────────
//
// A PATCH that flips `isActive` is ONE row, `activate` or `deactivate`, carrying every field that
// PATCH changed: IT's maintenance plans' verbs, not IT vendors' `update` with an `isActive` diff.

export type MasterDataAct = 'create' | 'edit' | 'activate' | 'deactivate';

export const MASTER_DATA_AUDIT_ACTION = {
  create: 'create',
  edit: 'update',
  activate: 'activate',
  deactivate: 'deactivate',
} as const satisfies Record<MasterDataAct, AuditAction>;

/** The act an edit was, read from the row before and after it. */
export const masterDataEditAct = (
  before: { isActive: boolean },
  after: { isActive: boolean },
): Exclude<MasterDataAct, 'create'> => {
  if (before.isActive === after.isActive) return 'edit';
  return after.isActive ? 'activate' : 'deactivate';
};

/**
 * Does this act need an explicit signal? `activate` and `deactivate` are not broadcast verbs
 * (`REALTIME_BROADCAST_ACTIONS`), so without one a retired unit would refresh no open screen.
 */
export const needsExplicitSignal = (act: MasterDataAct): boolean =>
  act === 'activate' || act === 'deactivate';

// ── Search ──────────────────────────────────────────────────────────────────

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A register's `search`, server-side (ADR-019 rule 5): the text as typed, case ignored, for codes
 * and names — and folded, for the stored `nameKey`, so «قطعه» finds «قطعة», the two spellings the
 * unique index already treats as one. Null when there is nothing to search for.
 */
export const searchPatterns = (
  search: string | undefined,
): { typed: RegExp; folded: RegExp | null } | null => {
  if (search === undefined || search === '') return null;
  const folded = foldName(search);
  return {
    typed: new RegExp(escapeRegExp(search), 'i'),
    folded: folded === '' ? null : new RegExp(escapeRegExp(folded)),
  };
};

/**
 * The `$or` a register's list filters on — its code, both names and the folded key, and any field
 * of its own the text is matched against as typed (an item's barcode) — or null when nothing is
 * searched.
 */
export const masterSearchClause = (
  search: string | undefined,
  alsoTyped: readonly string[] = [],
): Record<string, RegExp>[] | null => {
  const patterns = searchPatterns(search);
  if (patterns === null) return null;
  return [
    { code: patterns.typed },
    { 'name.ar': patterns.typed },
    { 'name.en': patterns.typed },
    ...(patterns.folded === null ? [] : [{ nameKey: patterns.folded }]),
    ...alsoTyped.map((field) => ({ [field]: patterns.typed })),
  ];
};
