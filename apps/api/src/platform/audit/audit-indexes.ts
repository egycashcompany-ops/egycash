// Building the two `audit_logs` indexes the security-signal sweep and the audit list read
// through — at boot, because nothing else builds them in production.
//
// `autoIndex` is off in production (infrastructure/database/mongo.ts), and the pre-deploy index
// sync (sync-indexes.cli.ts) runs in REPORT mode there: a declaration on a schema is listed as
// missing on every deploy and built by nobody. `ix_action_at` and `ix_at` (audit.model.ts) are the
// difference between the hourly sweep reading its own window and reading the whole append-only
// stream five times — the Atlas "Scanned Objects / Returned > 1000" alert — so they cannot wait
// for the sync to be switched to apply.
//
// SCOPED TO EXACTLY THESE TWO, BY NAME. The other three `audit_logs` indexes have their own
// history, and a platform-wide builder is the index sync's job, not this file's.
//
// THE DEFINITIONS ARE READ FROM THE SCHEMA (`indexBuildPlan`), never restated — the Fleet and ATM
// builders' rule. The day the sync does run in apply mode it sends byte-identical definitions,
// finds them present, and has nothing to do.
//
// SAFE TO RUN TWICE AT ONCE. Neither index is unique, so no row can refuse it and there is no
// duplicate to look for. `createIndex` with a definition identical to an existing index is a
// no-op, and one identical to a build already in progress waits for that build (a server that
// refuses the second request instead costs a warn line, and the first build carries on) — so the
// api and the worker may both start this, on every boot.
//
// NEVER AWAITED, NEVER THROWS. Building over a large `audit_logs` takes as long as it takes, and
// /health/ready has to answer inside railway.json's window; nor is a missing index a reason to
// keep the api down — every query still answers, only slower. A failure is a warn line naming the
// index, and the next boot tries again.
import { logger } from '../../infrastructure/logging/logger';
import { indexBuildPlan, indexNameOf, type IndexPlanEntry } from '../../shared/base/index-plan';
import {
  failureReason,
  sameIndexUnderAnotherName,
  type LiveIndex,
} from '../../shared/base/index-sync';
import { AuditLogModel } from './audit.model';

/** The indexes this step owns — listed, never discovered. */
export const AUDIT_BOOT_INDEXES = ['ix_action_at', 'ix_at'] as const;

/** Pure over the schema: the declarations of exactly the indexes above, as `createIndex` gets them. */
export const auditBootIndexPlan = (): IndexPlanEntry[] =>
  indexBuildPlan(AuditLogModel.schema.indexes()).filter((entry) =>
    (AUDIT_BOOT_INDEXES as readonly string[]).includes(indexNameOf(entry)),
  );

const NAMESPACE_NOT_FOUND = 26;

export interface AuditIndexBuildResult {
  built: string[];
  alreadyPresent: string[];
  /** Declared here, present on the server under another name an operator gave it. */
  presentAs: { index: string; existing: string }[];
  failed: { index: string; reason: string }[];
}

/**
 * Build whichever of the two is missing. Idempotent and non-destructive: it creates, and never
 * drops or changes, an index. Resolves with what it did; never rejects.
 */
export const ensureAuditIndexes = async (): Promise<AuditIndexBuildResult> => {
  const collection = AuditLogModel.collection.collectionName;
  const result: AuditIndexBuildResult = {
    built: [],
    alreadyPresent: [],
    presentAs: [],
    failed: [],
  };
  try {
    // A collection that does not exist yet has no indexes; `createIndex` brings it into being.
    const live = (await AuditLogModel.collection
      .listIndexes()
      .toArray()
      .catch((error: { code?: unknown }) => {
        if (error.code === NAMESPACE_NOT_FOUND) return [];
        throw error;
      })) as unknown as LiveIndex[];

    for (const entry of auditBootIndexPlan()) {
      const index = indexNameOf(entry);
      if (live.some((existing) => existing.name === index)) {
        result.alreadyPresent.push(index);
        continue;
      }
      // The same keys built by hand (an Atlas Performance Advisor suggestion, say) already serve
      // the queries, and the server would refuse a second copy with IndexOptionsConflict.
      const twin = sameIndexUnderAnotherName(entry, live);
      if (twin !== undefined) {
        result.presentAs.push({ index, existing: twin.name });
        continue;
      }
      try {
        const startedAt = Date.now();
        await AuditLogModel.collection.createIndex(entry.keys as never, entry.options as never);
        result.built.push(index);
        logger.info(
          { collection, index, durationMs: Date.now() - startedAt },
          'audit: index built',
        );
      } catch (error) {
        const reason = failureReason(error);
        result.failed.push({ index, reason });
        logger.warn({ collection, index, reason }, 'audit: index not built');
      }
    }
  } catch (error) {
    // The index list itself could not be read: nothing was attempted, and the next boot retries.
    const reason = failureReason(error);
    for (const index of AUDIT_BOOT_INDEXES) result.failed.push({ index, reason });
    logger.warn({ collection, reason }, 'audit: indexes not checked');
    return result;
  }

  logger.info(
    {
      collection,
      built: result.built,
      alreadyPresent: result.alreadyPresent,
      ...(result.presentAs.length === 0 ? {} : { presentAs: result.presentAs }),
      failed: result.failed.length,
    },
    'audit: index check complete',
  );
  return result;
};

/**
 * The entry the long-running processes call right after `bootPlatform` — deliberately not
 * awaited (see the top of this file). Not from `bootPlatform` itself: ten short-lived entrypoints
 * call that and disconnect the moment their own work is done, which would cut a build's log line
 * off mid-way for nothing — the api and the worker are the processes that stay up.
 */
export const startAuditIndexBuild = (): void => {
  void ensureAuditIndexes().catch(() => undefined);
};
