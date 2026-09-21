// «صلاحياتي» — the caller's own authority, reduced from the administration projection.
//
// `explainEffectivePermissions` answers the administrator's question: every grant that ever applied
// to an account, pending and expired alike, each carrying the assignment id to act on. This reduces
// that to the holder's question — «ما الذي يُسمح لي به؟» — which is a strictly smaller answer:
//
//   • ONLY WHAT IS IN FORCE NOW. A row whose every source is still to open, or has already closed,
//     is not an authority the caller has; printing it here would say he may do something the server
//     would refuse. The administration screen keeps those rows because "that grant ended last
//     Tuesday" is the answer to ITS question; it is not the answer to this one.
//   • NO IDS. The sources are named — a role's name, or a delegation's site — and nothing here
//     identifies an assignment, because there is no action on this screen to take with one.
//   • ONLY THE PAGES THE ROWS REFERENCE. The client groups by screen and needs those names, but it
//     must not receive the whole registry: `permission.view` guards that catalog, and an account
//     reading its own permissions is precisely the account that does not hold it.
//
// Pure: the caller supplies both inputs, so every rule above is unit-testable without a database.
import {
  type EffectivePermissionsDto,
  type MyPermissionDto,
  type MyPermissionsDto,
  type PageDto,
  type PermissionCatalogDto,
} from '@ecms/contracts';

export const reduceToMyPermissions = (
  explained: EffectivePermissionsDto,
  catalog: PermissionCatalogDto,
): MyPermissionsDto => {
  // The registry is what says which screen a key administers; the projection carries only the
  // module. A key the registry no longer declares resolves to null and groups under its module,
  // exactly as the catalog screen treats it.
  const pageOf = new Map(catalog.permissions.map((permission) => [permission.key, permission.pageId]));

  const rows: MyPermissionDto[] = [];
  for (const row of explained.rows) {
    // `scope` is null exactly when nothing grants the key right now, which is also what makes the
    // row `pending` or `expired`. Reading the scope rather than the state keeps the two from
    // drifting: a row with a scope is one the authorizer would honour.
    if (row.scope === null) continue;
    rows.push({
      key: row.key,
      name: row.name,
      moduleId: row.moduleId,
      pageId: pageOf.get(row.key) ?? null,
      breakGlass: row.breakGlass,
      scope: row.scope,
      sources: row.sources
        .filter((source) => source.state === 'active')
        .map((source) => ({
          kind: source.kind,
          name: source.roleName,
          // A delegation is for ONE site, and saying which is most of what makes it
          // understandable — «الحركة · أكتوبر» reads as a posting, «تفويض» alone reads as
          // nothing. A role carries no site: it applies wherever its own scope reaches.
          where:
            source.kind === 'role' || source.branch === null
              ? null
              : source.department === null
                ? source.branch.name
                : {
                    ar: `${source.department.name.ar} · ${source.branch.name.ar}`,
                    en: `${source.department.name.en} · ${source.branch.name.en}`,
                  },
        })),
    });
  }

  rows.sort((a, b) => a.key.localeCompare(b.key));
  return { evaluatedAt: explained.evaluatedAt, rows, pages: pagesUsedBy(rows, catalog.pages) };
};

/** Only the surfaces the rows actually reference, in the catalog's own order. */
const pagesUsedBy = (rows: MyPermissionDto[], registryPages: PageDto[]): PageDto[] => {
  const used = new Set(rows.map((row) => row.pageId).filter((id): id is string => id !== null));
  return registryPages.filter((page) => used.has(page.id));
};
