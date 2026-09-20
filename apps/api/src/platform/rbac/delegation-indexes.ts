// The deploy step for the delegated-grant indexes (ADR-032, Gap 1).
//
// The first shape of `delegated_grants` keyed one live row per (account, branch) under
// `ux_userId_branchId`. A grant is now per UNIT — one department in a branch, or the whole branch —
// so an account may hold two rows in one branch, which the old index refuses with a duplicate-key
// error. `autoIndex` is off outside development, so the old index would stay in production until
// somebody dropped it; this drops it at boot when it is still there and asks the schema to build
// its replacement. Safe to run at any time: dropping a superseded UNIQUE index cannot weaken an
// invariant the replacement does not re-state, and the collection was empty when the shape changed.
//
// It warns rather than throws, for the reason `org-catalog-indexes` gives.
import { logger } from '../../infrastructure/logging/logger';
import { DelegatedGrantModel, SUPERSEDED_DELEGATION_INDEX } from './delegation.model';

export const migrateDelegationIndexes = async (): Promise<void> => {
  try {
    const existing = (await DelegatedGrantModel.collection.indexes()) as { name?: string }[];
    if (existing.some((index) => index.name === SUPERSEDED_DELEGATION_INDEX)) {
      await DelegatedGrantModel.collection.dropIndex(SUPERSEDED_DELEGATION_INDEX);
      logger.info({ index: SUPERSEDED_DELEGATION_INDEX }, 'delegated grants: superseded index dropped');
    }
    await DelegatedGrantModel.createIndexes();
  } catch (error) {
    // A collection that does not exist yet answers `ns not found` to `indexes()`; nothing to do.
    if ((error as { codeName?: string }).codeName === 'NamespaceNotFound') return;
    logger.warn({ err: error }, 'delegated grants: index migration did not complete');
  }
};
