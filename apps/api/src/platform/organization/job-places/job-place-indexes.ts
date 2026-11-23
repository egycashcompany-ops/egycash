// The boot step that builds the job-place indexes (P-ORG-3 §3.3).
//
// `autoIndex` is off outside development, so a schema's index does not appear on its own in
// production — and both of these are load-bearing on the first boot after release: the fill (§7)
// relies on `ux_departmentCatalogId` to let only one racing process commit, and on the place index to
// keep a job in one place once. Called from the kernel's boot migrations, before any module seed.
//
// Warns rather than throws, one collection at a time, exactly as `org-catalog-indexes.ts` does and
// for its reasons.
import { logger } from '../../../infrastructure/logging/logger';
import { JobPlaceModel } from './job-place.model';
import { JobPlaceFillModel } from './job-place-fill.model';

export const migrateJobPlaceIndexes = async (): Promise<void> => {
  const builds: { what: string; run: () => Promise<unknown> }[] = [
    { what: 'job_title_places', run: () => JobPlaceModel.createIndexes() },
    { what: 'job_title_place_fills', run: () => JobPlaceFillModel.createIndexes() },
  ];
  for (const build of builds) {
    try {
      await build.run();
    } catch (error) {
      logger.warn({ err: error, index: build.what }, 'job places: index not built');
    }
  }
};
