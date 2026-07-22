// The pure core of the effective-applications resolver — no I/O, so it is fully unit-testable. Given
// the caller's candidate applications (already the union of department + direct grants) and the
// categories they reference, it produces the grouped, ordered navigation the sidebar renders:
//   • duplicates removed (first occurrence wins),
//   • inactive applications dropped,
//   • grouped under their category, empty categories omitted,
//   • categories ordered by sortOrder, applications ordered by sortOrder within each category.
import { type MyApplicationCategoryDto } from '@ecms/contracts';

export interface EffectiveAppInput {
  id: string;
  name: { ar: string; en: string };
  icon: string;
  route: string;
  sortOrder: number;
  status: 'active' | 'inactive';
  categoryId: string;
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
): MyApplicationCategoryDto[] => {
  // Dedupe by id (first wins) and keep only active applications.
  const active = new Map<string, EffectiveAppInput>();
  for (const app of apps) {
    if (app.status === 'active' && !active.has(app.id)) active.set(app.id, app);
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
