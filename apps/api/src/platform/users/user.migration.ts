// Boot migration for the auth & account-lifecycle upgrade (frozen auth design §3/§7).
// The `ux_email` unique index predates optional email — it must become partial on
// `email: {$type:'string'}` or the first email-less account would collide with another.
// Guarded: only drops the legacy definition; mongoose autoIndex recreates the partial one.
import { UserModel } from './user.model';
import { logger } from '../../infrastructure/logging/logger';

export const migrateUserAuthIndexes = async (): Promise<void> => {
  try {
    const indexes = await UserModel.collection.indexes();
    const legacy = indexes.find(
      (ix) =>
        ix.name === 'ux_email' &&
        (ix.partialFilterExpression as Record<string, unknown> | undefined)?.email === undefined,
    );
    if (legacy !== undefined) {
      await UserModel.collection.dropIndex('ux_email');
      await UserModel.createIndexes();
      logger.info('users: ux_email rebuilt as partial (optional-email upgrade)');
    }
  } catch (error) {
    // A missing collection (fresh install) is fine — autoIndex will build everything.
    logger.warn({ err: error }, 'users: email index migration skipped');
  }
};

/**
 * `ux_employeeId` must become partial on `isDeleted: false`.
 *
 * The original reads "one login per employee, EVER": a soft-deleted account went on holding its
 * employee's slot in the unique index, so provisioning a replacement died on a duplicate key —
 * after the screen had already offered «إنشاء حساب دخول». Deleting an account frees its username
 * and its email (both indexes are partial on `isDeleted: false`); this one was the odd man out.
 *
 * Narrowing only, so it cannot fail on existing data: every pair the new index rejects, the old
 * one rejected too.
 *
 * Detected the same way the email upgrade is — by the SHAPE of the partial filter rather than by a
 * version marker — so it is a no-op on a database that already carries the new definition.
 */
export const migrateUserEmployeeLinkIndex = async (): Promise<void> => {
  try {
    const indexes = await UserModel.collection.indexes();
    const legacy = indexes.find(
      (ix) =>
        ix.name === 'ux_employeeId' &&
        (ix.partialFilterExpression as Record<string, unknown> | undefined)?.isDeleted === undefined,
    );
    if (legacy === undefined) return;
    await UserModel.collection.dropIndex('ux_employeeId');
    await UserModel.collection.createIndex(
      { employeeId: 1 },
      {
        unique: true,
        name: 'ux_employeeId',
        partialFilterExpression: { isDeleted: false, employeeId: { $type: 'objectId' } },
      },
    );
    logger.info('users: ux_employeeId rebuilt as partial on live accounts');
  } catch (error) {
    // A missing collection (fresh install) is fine — the declared shape is already the new one.
    logger.warn({ err: error }, 'users: employee-link index migration skipped');
  }
};

/**
 * `ix_external_subject` for deployments that predate external accounts.
 *
 * `autoIndex` is off outside development (infrastructure/database/mongo.ts), so a schema-declared
 * index does not appear on its own in production — this is the deploy step that builds it.
 * Idempotent: `createIndex` on an index that already exists with the same definition is a no-op.
 */
export const migrateUserExternalSubjectIndex = async (): Promise<void> => {
  try {
    await UserModel.collection.createIndex(
      { 'externalSubject.moduleId': 1, 'externalSubject.subjectId': 1 },
      { name: 'ix_external_subject' },
    );
  } catch (error) {
    logger.warn({ err: error }, 'users: external-subject index migration skipped');
  }
};
