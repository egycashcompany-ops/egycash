// The navigation model that the ECMS shell is built on. It is derived entirely from the dynamic
// GET /platform/me/applications data (PR #64/#65) — Category → Application — reinterpreted for a
// scalable, module-oriented experience:
//   • a Module is a top-level Category (its own colored identity in the icon rail);
//   • Applications are the pages inside a module;
//   • the whole catalog is flattened for the ⌘K command palette.
// No backend/permission change: the data already reflects exactly the apps the user may open.
import { type LocalizedString, type MyApplicationCategoryDto, type MyApplicationDto } from '@ecms/contracts';

/**
 * A named group of pages inside a module. Purely organizational — the server has already decided
 * WHICH pages the caller may see; a section only decides how those pages are grouped, and its
 * names come from the catalog, never from this file.
 */
export interface NavSection {
  id: string;
  name: LocalizedString;
  apps: MyApplicationDto[];
}

export interface NavModule {
  id: string;
  name: LocalizedString;
  /** Category icon name from the catalog (admin-editable); null renders the generic fallback. */
  icon: string | null;
  /** Pages that belong to no section — rendered directly under the module, as they always were. */
  apps: MyApplicationDto[];
  sections: NavSection[];
}

export interface NavApp extends MyApplicationDto {
  moduleId: string;
  moduleName: LocalizedString;
}

export const toModules = (data: MyApplicationCategoryDto[]): NavModule[] =>
  data.map((c) => ({
    id: c.id,
    name: c.name,
    icon: c.icon,
    apps: c.applications,
    // A server that predates sections sends none; an empty list is the same as no grouping.
    sections: (c.sections ?? []).map((s) => ({ id: s.id, name: s.name, apps: s.applications })),
  }));

/** Every page of a module, section or not — the order the column reads top to bottom. */
export const moduleApps = (module: NavModule): MyApplicationDto[] => [
  ...module.apps,
  ...module.sections.flatMap((s) => s.apps),
];

/**
 * The modules that earn chrome — the ONE definition of "this module has pages", shared by every
 * surface that lists modules (the launchpad, the rail, the ⌘K palette).
 *
 * It counts `moduleApps`, not `apps`. A module's `apps` holds only the pages that belong to no
 * SECTION, so a module that has organized every one of its pages — HR, whose twenty-three pages
 * are all filed under Recruitment / Employees / Employee File / Attendance & Leave / Payroll —
 * has an empty `apps` and a full `sections`. Filtering on `apps.length` therefore dropped exactly
 * the modules that were best organized: HR disappeared from the launchpad and from the palette's
 * module list while every one of its pages was still entitled, catalogued and routed.
 *
 * The rail had the same bug and was fixed alone (#205); the rule lives here now so that fixing it
 * in one shell cannot leave it standing in another.
 */
export const visibleModules = (data: MyApplicationCategoryDto[]): NavModule[] =>
  toModules(data).filter((module) => moduleApps(module).length > 0);

/**
 * Every page the caller has, flattened. It must include the SECTIONED pages too: this feeds the
 * ⌘K palette, the pinned-favourites lookup and the exact-match route set, none of which are about
 * grouping — a page that a section holds is still a page the user can search for and pin.
 */
export const flattenApps = (data: MyApplicationCategoryDto[]): NavApp[] =>
  data.flatMap((c) =>
    [...c.applications, ...(c.sections ?? []).flatMap((s) => s.applications)].map((a) => ({
      ...a,
      moduleId: c.id,
      moduleName: c.name,
    })),
  );

/** True when `pathname` is (or is nested under) an app's route. */
const matches = (route: string, pathname: string): boolean =>
  pathname === route || pathname.startsWith(`${route}/`);

/**
 * Whether a nav row must match its route EXACTLY rather than by prefix.
 *
 * `NavLink` highlights by prefix, so a module landing page like `/fleet` lights up while the
 * user is on `/fleet/vehicles` — two rows reading as "you are here" at once. A row needs the
 * exact rule precisely when another row lives underneath it; deriving that from the routes
 * themselves keeps it true for whatever the catalog serves next, with nothing hardcoded.
 */
export const requiresExactMatch = (route: string, allRoutes: readonly string[]): boolean =>
  allRoutes.some((other) => other !== route && other.startsWith(`${route}/`));

/**
 * Where switching INTO a module should land: the page the user last had open there, when that
 * page still exists for them, and the module's first page otherwise.
 *
 * Returning people to where they were is what makes a switcher feel like a workspace rather
 * than a menu — leaving and coming back should not cost you your place. The stored path is
 * re-validated against the live catalog on every use, so a page revoked since (or renamed)
 * degrades quietly to the module's entry point instead of navigating into nothing.
 */
export const moduleEntryRoute = (module: NavModule, remembered: string | null): string | null => {
  // Every page of the module, sectioned or not — grouping must not change where a module opens.
  const apps = moduleApps(module);
  const first = apps[0]?.route ?? null;
  if (remembered === null) return first;
  const routes = apps.map((a) => a.route);
  // A page's own route always counts. Deeper paths count only under a LEAF page — a detail
  // screen lives under its list, whereas a module landing route like `/fleet` is a prefix of
  // the whole module and would otherwise wave through any stale path beneath it.
  const stillValid = apps.some(
    (a) =>
      remembered === a.route ||
      (!requiresExactMatch(a.route, routes) && remembered.startsWith(`${a.route}/`)),
  );
  return stillValid ? remembered : first;
};

/** The id of the module owning the app that best (longest-prefix) matches the current path. */
export const moduleOfPathname = (modules: NavModule[], pathname: string): string | null => {
  let bestId: string | null = null;
  let bestLen = -1;
  for (const m of modules) {
    // Sectioned pages scope the column exactly like unsectioned ones — grouping is not routing.
    for (const a of moduleApps(m)) {
      if (matches(a.route, pathname) && a.route.length > bestLen) {
        bestLen = a.route.length;
        bestId = m.id;
      }
    }
  }
  return bestId;
};

// A small, fixed palette (literal Tailwind classes so JIT keeps them) gives every module a stable,
// distinct colored identity — the way Slack/Teams/Notion make workspaces instantly recognizable.
const MODULE_COLORS = [
  'bg-indigo-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-sky-500',
  'bg-violet-500',
  'bg-teal-500',
  'bg-orange-500',
  'bg-cyan-500',
  'bg-fuchsia-500',
] as const;

const hash = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

export const moduleColor = (key: string): string => MODULE_COLORS[hash(key) % MODULE_COLORS.length]!;
