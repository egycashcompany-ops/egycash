// The pure core of the effective-applications resolver — no I/O, so it is fully unit-testable. Given
// the candidate applications and the categories they reference, it produces the grouped, ordered
// navigation the sidebar renders:
//   • applications the caller holds no permission for dropped,
//   • applications with NO declared permission dropped — entitled to nobody (see below),
//   • duplicates removed (first occurrence wins),
//   • inactive applications dropped,
//   • grouped under their category, empty categories omitted,
//   • categories ordered by sortOrder, applications ordered by sortOrder within each category.
//
// THE PERMISSION IS THE ONLY INPUT. Navigation is a projection of what the caller may do: an
// application declares the permission that opens it, and holding that permission is what puts it in
// the sidebar. Nothing else grants a row — no per-user list, no per-department list — so the sidebar
// cannot disagree with the server, and it changes the moment RBAC does, with no second record to
// keep in step.
//
// The permission check ignores SCOPE deliberately. Holding `leave.view` at `own` still opens the
// Leave screen; scope narrows the rows the screen returns, it does not withhold the screen. That is
// the same reading `authorize()` gives on the route, which is what keeps the two surfaces agreeing.
//
// A NULL `permissionKey` is entitled to nobody. It means no permission was declared for that screen,
// and "nobody said who may open this" must not resolve to "everybody may". The caller loading the
// candidates already excludes them; the check is repeated here so the rule holds for any caller of
// this function, and so it is visible where the decision is made.
import { type MyApplicationCategoryDto, type DataScope } from '@ecms/contracts';

export interface EffectiveAppInput {
  id: string;
  name: { ar: string; en: string };
  icon: string;
  route: string;
  sortOrder: number;
  status: 'active' | 'inactive';
  categoryId: string;
  /** Permission that opens it. Null = none declared, which entitles nobody. */
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
  // Dedupe by id (first wins), keep only active applications, and keep only the ones the caller is
  // entitled to: a declared permission that they hold. No key declared → nobody is entitled.
  const active = new Map<string, EffectiveAppInput>();
  for (const app of apps) {
    if (app.status !== 'active' || active.has(app.id)) continue;
    const key = app.permissionKey;
    if (key === null || permissions[key] === undefined) continue;
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
