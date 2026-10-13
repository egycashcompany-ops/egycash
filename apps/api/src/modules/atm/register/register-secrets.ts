// The register's secrets (D3, spec §5.4): who may see the K values, how the safe-door combination
// is sealed and re-wrapped, and how an audit diff names a secret without carrying it.
//
// ONE predicate decides visibility — `secretsVisibleFor` — and the mapper, the write gate (DEC-7:
// write implies read) and the reveal all ask it, so a caller can never write what they cannot see
// or reveal what the grid hides. It is `keyCoversEntry` for `atmRegister.viewSecrets`: the key is
// organization-wide, or it reaches the entry's whole branch. A department-, section- or
// own-scoped `viewSecrets` therefore sees nothing secret (DEC-29) — those scopes never cover a
// whole branch, and this register has no finer unit to place a row in.
//
// The combination is sealed through the platform secret store under a context that names the
// record (`<collection>:<id>:<field>`, the AAD rule of platform/crypto): a ref copied onto another
// entry fails to open instead of revealing the wrong machine's code. Rotation re-wraps the DATA
// KEY only — no plaintext exists at any point of it (DEC-33).
import { type AuditChange, type SecretRef } from '@ecms/contracts';
import { type Types } from 'mongoose';
import { logger } from '../../../infrastructure/logging/logger';
import { getSecretStore } from '../../../platform/secrets';
import { BusinessRuleError } from '../../../shared/errors';
import { keyReachesBranch, scopeOf, type AuthContext } from '../../../shared/types';
import { diffChanges } from '../../../shared/utils/diff';
import { AtmRegisterEntryModel } from './register.model';
import { atmRegisterEntryRepository } from './register.repository';

/** The AAD context a combination is sealed under — names the record and the field. */
export const combinationContext = (entryId: string): string =>
  `atm_register_entries:${entryId}:safeCombination`;

/**
 * Seal a combination for an entry whose id is already minted (the id must exist BEFORE the insert
 * so the context can name it — the credential precedent). Refuses rather than storing in the clear
 * when the store has no usable key.
 */
export const sealCombination = async (entryId: string, plaintext: string): Promise<SecretRef> => {
  const store = getSecretStore();
  if (!store.available()) {
    throw new BusinessRuleError(
      'the safe-door combination cannot be stored: the secret store has no usable key on this deployment',
    );
  }
  return store.seal(plaintext, combinationContext(entryId));
};

/** The reveal path's ONLY opener — callers check `secretsVisibleFor` first. */
export const openCombination = async (entryId: string, ref: SecretRef): Promise<string> =>
  getSecretStore().open(ref, combinationContext(entryId));

/**
 * DEC-29: the key is organization-wide, or it reaches the entry's WHOLE branch. Every register
 * write and the reveal require this on top of finding the entry in the caller's read scope.
 */
export const keyCoversEntry = (
  ctx: AuthContext,
  key: string,
  entry: { branchId: Types.ObjectId | string | null },
): boolean =>
  scopeOf(ctx, key) === 'organization' ||
  (entry.branchId !== null && keyReachesBranch(ctx, key, String(entry.branchId)));

/** D3 / DEC-7: may this caller see (and therefore write) this entry's K values and reveal its S? */
export const secretsVisibleFor = (
  ctx: AuthContext,
  entry: { branchId: Types.ObjectId | string | null },
): boolean => keyCoversEntry(ctx, 'atmRegister.viewSecrets', entry);

/** The K paths (J..Q, AN, AU) and the S field (AO), as they appear in an entry snapshot. */
export const REGISTER_SECRET_FIELDS: ReadonlySet<string> = new Set([
  'keys.supervisorCode',
  'keys.supervisorCount',
  'keys.safeDoorCount',
  'keys.alanki',
  'keys.combinationKeyCode',
  'keys.combinationKeyCount',
  'keys.cashUnitCode',
  'keys.cashUnitCount',
  'receiptNotes',
  'handoverNotes',
  'safeCombination',
]);

const REDACTED = '[redacted]';

/**
 * The audit diff of two entry snapshots with every secret field written as a fact, never a value:
 * `{ old: '[redacted]' | null, new: '[redacted]' | null }`, and only when it actually changed (the
 * employee-service precedent — write-time redaction for fully secret values; the audit masking
 * list is not extended).
 */
export const redactedDiff = (
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): AuditChange[] =>
  diffChanges(before, after).map((change) =>
    REGISTER_SECRET_FIELDS.has(change.field)
      ? {
          field: change.field,
          old: change.old === null ? null : REDACTED,
          new: change.new === null ? null : REDACTED,
        }
      : change,
  );

/**
 * DEC-33 — move every sealed combination not on the current key onto it, the
 * `automation.rotateCredentialKeys` mirror. Soft-deleted entries are rewrapped too (the raw,
 * versioned update below does not filter `isDeleted`), so the old key can leave the ring after
 * BOTH nightly sweeps report nothing left on it. A row on a key already gone, or one that changed
 * under the sweep, is a count — never a throw that stops the rest.
 */
export const rotateRegisterCombinationKeys = async (
  batchSize = 200,
): Promise<{ rotated: number; failed: number }> => {
  const store = getSecretStore();
  const status = store.status();
  if (!status.available || !status.rotatable || status.currentKeyId === null) {
    return { rotated: 0, failed: 0 };
  }
  const stale = await atmRegisterEntryRepository.listCombinationsNotOnKey(
    status.currentKeyId,
    batchSize,
  );
  let rotated = 0;
  let failed = 0;
  for (const doc of stale) {
    if (doc.safeCombination === null) continue;
    try {
      const ref = await store.rewrap(doc.safeCombination);
      const result = await AtmRegisterEntryModel.updateOne(
        { _id: doc._id, __v: doc.__v },
        { $set: { safeCombination: ref }, $inc: { __v: 1 } },
      ).exec();
      if (result.modifiedCount === 1) rotated += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
  }
  if (rotated > 0 || failed > 0) {
    logger.info(
      { provider: status.provider, currentKeyId: status.currentKeyId, rotated, failed },
      'atm: register combination key rotation pass',
    );
  }
  return { rotated, failed };
};
