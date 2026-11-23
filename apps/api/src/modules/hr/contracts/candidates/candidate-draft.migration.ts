// Boot migration for «عقد جديد» drafts saved before a candidate's choice was kept beside the job's
// papers (A28): «مفروض تنور علي اساس الوظيفه اللي خاصه بيه فبينور علي النمازج الخاصه بالوظيفه».
//
// A draft used to keep the whole list of papers ticked (`selected`), so once HR had ticked anything
// the job's papers no longer counted — and those lists were ticked against papers since changed
// (every paper offered, then only the department's and job's). Each is given the empty choice: the
// person's papers ticked as their job ticks them. Guarded by `$exists: false`, so re-runs are no-ops.
import { logger } from '../../../../infrastructure/logging/logger';
import { CandidateDraftModel } from './candidate-draft.model';

export const migrateCandidateDrafts = async (): Promise<void> => {
  try {
    const result = await CandidateDraftModel.collection.updateMany(
      { added: { $exists: false } },
      { $set: { added: [], removed: [] }, $unset: { selected: '' } },
    );
    if (result.modifiedCount > 0) {
      logger.info({ drafts: result.modifiedCount }, 'hr contracts: candidate drafts follow their job\'s papers');
    }
  } catch (error) {
    logger.warn({ err: error }, 'hr contracts: candidate draft migration skipped');
  }
};
