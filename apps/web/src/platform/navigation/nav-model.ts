// The navigation model that the ECMS shell is built on. It is derived entirely from the dynamic
// GET /platform/me/applications data (PR #64/#65) — Category → Application — reinterpreted for a
// scalable, module-oriented experience:
//   • a Module is a top-level Category (its own colored identity in the icon rail);
//   • Applications are the pages inside a module;
//   • the whole catalog is flattened for the ⌘K command palette.
// No backend/permission change: the data already reflects exactly the apps the user may open.
import { type LocalizedString, type MyApplicationCategoryDto, type MyApplicationDto } from '@ecms/contracts';

export interface NavModule {
  id: string;
  name: LocalizedString;
  apps: MyApplicationDto[];
}

export interface NavApp extends MyApplicationDto {
  moduleId: string;
  moduleName: LocalizedString;
}

export const toModules = (data: MyApplicationCategoryDto[]): NavModule[] =>
  data.map((c) => ({ id: c.id, name: c.name, apps: c.applications }));

export const flattenApps = (data: MyApplicationCategoryDto[]): NavApp[] =>
  data.flatMap((c) =>
    c.applications.map((a) => ({ ...a, moduleId: c.id, moduleName: c.name })),
  );

/** True when `pathname` is (or is nested under) an app's route. */
const matches = (route: string, pathname: string): boolean =>
  pathname === route || pathname.startsWith(`${route}/`);

/** The id of the module owning the app that best (longest-prefix) matches the current path. */
export const moduleOfPathname = (modules: NavModule[], pathname: string): string | null => {
  let bestId: string | null = null;
  let bestLen = -1;
  for (const m of modules) {
    for (const a of m.apps) {
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

/** 1–2 letter monogram for a module's identity tile. */
export const monogram = (name: string): string => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '•';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
};
