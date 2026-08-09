// The pure core of the effective-applications resolver — no I/O, so it is fully unit-testable. Given
// the caller's candidate applications (already the union of department + direct grants) and the
// categories they reference, it produces the grouped, ordered navigation the sidebar renders:
//   • duplicates removed (first occurrence wins),
//   • inactive applications dropped,
//   • applications the caller lacks the permission for dropped,
//   • grouped under their category, empty categories omitted,
//   • categories ordered by sortOrder, applications ordered by sortOrder within each category.
//
// The permission filter is what keeps navigation and authorization from disagreeing. A grant is an
// administrator saying "this app is on offer to you"; the permission is RBAC saying whether you may
// enter it. Before the filter, a user granted an application whose module they hold no permission in
// saw the row and got a 403 on opening it — and a user restricted to one module still had every
// other module advertised in their sidebar through their department's grants. Filtering here (not in
// the client) means the answer is the same on every surface, and no per-user navigation data has to
// be maintained to keep it true.
import { type MyApplicationCategoryDto, type DataScope } from '@ecms/contracts';

export interface EffectiveAppInput {
  id: string;
  name: { ar: string; en: string };
  icon: string;
  route: string;
  sortOrder: number;
  status: 'active' | 'inactive';
  categoryId: string;
  /** Permission needed to open it; null (or a pre-field catalog row) = no permission needed. */
  permissionKey: string | null;
}

export interface EffectiveCategoryInput {
  id: string;
  name: { ar: string; en: string };
  icon: string | null;
  sortOrder: number;
}

export const assembleEffectiveApplications = (
  apps: EffectiveAppInput[],
  categories: EffectiveCategoryInput[],
  permissions: Record<string, DataScope>,
): MyApplicationCategoryDto[] => {
  // Dedupe by id (first wins), keep only active applications, and drop the ones the caller holds
  // no permission for. `permissionKey === null` is the pre-field / open-page case and stays.
  const active = new Map<string, EffectiveAppInput>();
  for (const app of apps) {
    if (app.status !== 'active' || active.has(app.id)) continue;
    const key = app.permissionKey;
    if (key !== null && permissions[key] === undefined) continue;
    active.set(app.id, app);
  }
  const activeApps = [...active.values()];

  return [...categories]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((category) => ({
      category,
      applications: activeApps
        .filter((app) => app.categoryId === category.id)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((app) => ({ id: app.id, name: app.name, icon: app.icon, route: app.route })),
    }))
    .filter((group) => group.applications.length > 0)
    .map((group) => ({
      id: group.category.id,
      name: group.category.name,
      icon: group.category.icon,
      applications: group.applications,
    }));
};
