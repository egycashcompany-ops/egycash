// The deploy step for the delegated-grant indexes (ADR-032, Gap 1).
//
// `delegated_grants` has been rekeyed twice, each time because a grant learned to name something
// it could not name before. It began as one live row per (account, branch); then a grant could name
// a department inside a branch, so an account could hold two rows in one branch; and now a grant
// can name a department in EVERY branch — «الحركة، في كل الفروع», the general manager's own
// authority handed to a deputy — which carries no branch at all and would collide with any other
// such grant under the previous key. Each superseded index refuses the new shape with a
// duplicate-key error. `autoIndex` is off outside development, so an old index would stay in
// production until somebody dropped it; this drops the ones still there at boot and asks the schema
// to build the current one. Safe to run at any time: dropping a superseded UNIQUE index cannot
// weaken an invariant the replacement does not re-state.
//
// It warns rather than throws, for the reason `org-catalog-indexes` gives.
import { logger } from '../../infrastructure/logging/logger';
import { DelegatedGrantModel, SUPERSEDED_DELEGATION_INDEXES } from './delegation.model';

export const migrateDelegationIndexes = async (): Promise<void> => {
  try {
    // A collection that does not exist yet answers `ns not found` to `indexes()`: nothing to drop,
    // and `createIndexes()` below is what brings the collection into being with its indexes —
    // which matters in production, where `autoIndex` is off and nothing else would build them.
    const existing = await DelegatedGrantModel.collection
      .indexes()
      .then((list) => list as { name?: string }[])
      .catch((error: { codeName?: string }) => {
        if (error.codeName === 'NamespaceNotFound') return [] as { name?: string }[];
        throw error;
      });
    for (const name of SUPERSEDED_DELEGATION_INDEXES) {
      if (!existing.some((index) => index.name === name)) continue;
      await DelegatedGrantModel.collection.dropIndex(name);
      logger.info({ index: name }, 'delegated grants: superseded index dropped');
    }
    await DelegatedGrantModel.createIndexes();
  } catch (error) {
    logger.warn({ err: error }, 'delegated grants: index migration did not complete');
  }
};
