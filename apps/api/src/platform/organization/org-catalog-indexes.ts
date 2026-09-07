// The deploy step that builds the org-catalog indexes (P-ORG-2).
//
// `autoIndex` is off outside development (infrastructure/database/mongo.ts), so an index a schema
// declares does not appear on its own in production. `ux_branch_catalog` is the constraint the whole
// redesign rests on — one branch declares a company-wide department at most once — and a production
// database where it was never built would let the duplication come straight back.
//
// SAFE TO RUN AT ANY TIME, INCLUDING BEFORE THE MIGRATION. Both indexes are partial on
// `catalogId: {$type: 'objectId'}`, so on a database where nothing has been linked yet they cover
// zero documents and cannot conflict with anything. There is no ordering requirement between this
// and `migrate:org-catalog`.
//
// IT WARNS RATHER THAN THROWS. A boot that dies because one index could not be built takes the
// whole application down over a constraint that is not load-bearing for a single request; the log
// line names what failed so it can be fixed deliberately.
import { logger } from '../../infrastructure/logging/logger';
import { DepartmentModel } from './departments';
import { SectionModel } from './sections';
import { DepartmentCatalogModel } from './department-catalog';
import { SectionCatalogModel } from './section-catalog';

export const migrateOrgCatalogIndexes = async (): Promise<void> => {
  const builds: { what: string; run: () => Promise<unknown> }[] = [
    {
      what: 'departments.ux_branch_catalog',
      run: () =>
        DepartmentModel.collection.createIndex(
          { branchId: 1, catalogId: 1 },
          {
            unique: true,
            name: 'ux_branch_catalog',
            partialFilterExpression: { isDeleted: false, catalogId: { $type: 'objectId' } },
          },
        ),
    },
    {
      what: 'sections.ux_department_catalog',
      run: () =>
        SectionModel.collection.createIndex(
          { departmentId: 1, catalogId: 1 },
          {
            unique: true,
            name: 'ux_department_catalog',
            partialFilterExpression: { isDeleted: false, catalogId: { $type: 'objectId' } },
          },
        ),
    },
    { what: 'department_catalog', run: () => DepartmentCatalogModel.createIndexes() },
    { what: 'section_catalog', run: () => SectionCatalogModel.createIndexes() },
  ];

  // ONE AT A TIME. `createIndexes()` on a collection is a batch, so a single duplicate anywhere in
  // it fails every index in the call — the trap `fleet-indexes.ts` documents. The two catalog
  // collections are new and empty, so their batch has nothing to trip over.
  for (const build of builds) {
    try {
      await build.run();
    } catch (error) {
      logger.warn({ err: error, index: build.what }, 'org catalog: index not built');
    }
  }
};
