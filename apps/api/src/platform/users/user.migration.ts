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
