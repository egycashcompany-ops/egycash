// The pure core of the effective-applications resolver — no I/O, so it is fully unit-testable. Given
// the candidate applications and the categories they reference, it produces the grouped, ordered
// navigation the sidebar renders:
//   • applications the caller holds no permission for dropped,
//   • applications with NO declared permission dropped — entitled to nobody (see below),
//   • duplicates removed (first occurrence wins),
//   • inactive applications dropped,
//   • grouped under their category, empty categories omitted,
//   • grouped again under their SECTION inside that category, empty sections omitted,
//   • categories, sections and applications each ordered by their own sortOrder.
//
// SECTIONS ARE ORGANIZATION, NOT ENTITLEMENT. A section holds no permission key and is never
// consulted when deciding what a caller may see; it only decides how the rows they may already
// see are grouped. An application with no section stays where it has always been — directly
// under its module, in the category's own `applications` list — which is what keeps every
// pre-sections row visible and every pre-sections client working.
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
  /** The section it belongs to, or null for the rows that hang directly off the module. */
  sectionId: string | null;
  /** Permission that opens it. Null = none declared, which entitles nobody. */
  permissionKey: string | null;
}

export interface EffectiveSectionInput {
  id: string;
  name: { ar: string; en: string };
  categoryId: string;
  sortOrder: number;
  status: 'active' | 'inactive';
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
  sections: EffectiveSectionInput[] = [],
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

  const toDto = (app: EffectiveAppInput) => ({
    id: app.id,
    name: app.name,
    icon: app.icon,
    route: app.route,
  });
  const byOrder = (a: { sortOrder: number }, b: { sortOrder: number }): number =>
    a.sortOrder - b.sortOrder;

  // An INACTIVE section is not a heading anybody should read, but its applications are still
  // entitled rows — so they fall back to the module's own list rather than disappearing. The same
  // fallback catches a `sectionId` pointing at a section that has since been deleted.
  // Keyed by id → owning category, because a section only groups the module it belongs to: an
  // application pointing at a SIBLING module's section is a mis-set field, and the row must fall
  // back to its own module rather than disappear into a group that is never rendered for it.
  const liveSections = new Map(
    sections
      .filter((section) => section.status === 'active')
      .map((section) => [section.id, section.categoryId]),
  );
  const sectionOf = (app: EffectiveAppInput): string | null =>
    app.sectionId !== null && liveSections.get(app.sectionId) === app.categoryId
      ? app.sectionId
      : null;

  return [...categories]
    .sort(byOrder)
    .map((category) => {
      const mine = activeApps.filter((app) => app.categoryId === category.id);
      return {
        id: category.id,
        name: category.name,
        icon: category.icon,
        applications: mine
          .filter((app) => sectionOf(app) === null)
          .sort(byOrder)
          .map(toDto),
        sections: sections
          .filter((section) => section.categoryId === category.id && section.status === 'active')
          .sort(byOrder)
          .map((section) => ({
            id: section.id,
            name: section.name,
            applications: mine
              .filter((app) => sectionOf(app) === section.id)
              .sort(byOrder)
              .map(toDto),
          }))
          // An empty section is a heading over nothing — and, since emptiness here usually means
          // "you may open none of these", printing it would advertise what the caller cannot have.
          .filter((section) => section.applications.length > 0),
      };
    })
    .filter((group) => group.applications.length > 0 || group.sections.length > 0);
};
