// The permission ID catalog — single source of truth (ADR-004).
// Permissions are declared in code (here for the platform; in module manifests for modules),
// synced to the DB registry at boot, and rendered into
// docs/06-security/permission-matrix.generated.md by scripts/gen-permission-matrix.mjs (Review R18).
import { z } from 'zod';
import { type LocalizedString } from '../common/index.js';

/** Closed action vocabulary (Permission Matrix §1). Extending it requires an ADR. */
export const PERMISSION_ACTIONS = [
  'view',
  'create',
  'edit',
  'delete',
  'export',
  'print',
  'approve',
  'reject',
] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/**
 * An administration SURFACE a module owns — the middle layer between a module and its permissions.
 *
 * A page is **organizational and never authorizational**. Nothing checks a page, no request is
 * refused because of one, and adding one grants nobody anything: authorization remains the
 * permission key plus the guards in ADR-026, exactly as before. What a page buys is that two
 * hundred checkboxes become a tree an administrator can read.
 *
 * It is DECLARED here rather than derived, and that is the whole point of the design. The obvious
 * shortcuts — reading `Application.permissionKey` from the navigation catalogue, or scanning the
 * frontend for route guards — both produce a relationship that is a side effect of something else:
 * the catalogue is runtime data an administrator can edit, it names the ONE permission that OPENS a
 * screen rather than the ones that belong to it, and it is empty on a deployment that has not been
 * seeded. A role matrix must render identically everywhere and must not reshape itself because
 * somebody renamed a menu row.
 */
export interface PageDef {
  /** `<moduleId>.<slug>` — stable, referenced by permissions, never displayed. */
  id: string;
  moduleId: string;
  name: LocalizedString;
  /**
   * The screen this page corresponds to, where one is routed. **Documentation only** — nothing
   * resolves it, and a page without a built screen is still a legitimate page.
   */
  route?: string;
  /** Ascending; pages without one sort after those with one, then by `id`. */
  sortOrder?: number;
}

export interface PermissionDef {
  /** `<resource>.<action>` — resource singular camelCase. */
  key: string;
  resource: string;
  /** Closed-vocabulary action, or a per-resource special action (documented). */
  action: string;
  moduleId: string;
  name: LocalizedString;
  /** Special grants reviewed quarterly / paged on use (Permission Matrix §6). */
  breakGlass?: boolean;
  /**
   * The page this authority belongs to, or `null` for one that deliberately has none.
   *
   * `null` is an ANSWER, not a gap. It says "no screen administers this today" — which is true of a
   * permission whose screen is not built yet (`auditLog.*`, `setting.*`) and of one that has no
   * screen at all (`file.*`, `scheduledTask.*`). Guessing a page for those would put a false
   * statement in the registry; they group under Other / Unassigned instead.
   */
  pageId: string | null;
}

export const PERMISSION_KEY_PATTERN = /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/;
export const PermissionKeySchema = z.string().regex(PERMISSION_KEY_PATTERN);
export const PAGE_ID_PATTERN = /^[a-z][a-zA-Z0-9]*\.[a-z][a-z0-9-]*$/;

const def = (
  moduleId: string,
  resource: string,
  action: string,
  name: LocalizedString,
  pageId: string | null,
  extra?: Partial<Pick<PermissionDef, 'breakGlass'>>,
): PermissionDef => ({
  key: `${resource}.${action}`,
  resource,
  action,
  moduleId,
  name,
  pageId,
  ...extra,
});

/**
 * Declare a resource with standard actions + named special actions.
 *
 * `pageId` is given once per RESOURCE rather than once per key — 59 declarations instead of 202 —
 * because that is how the data actually clusters: a resource is administered on one surface. A
 * resource whose actions genuinely split across two pages overrides per key at the call site.
 */
export const declarePermissions = (
  moduleId: string,
  resource: string,
  resourceName: LocalizedString,
  actions: readonly string[],
  specials: readonly { action: string; name: LocalizedString; breakGlass?: boolean }[] = [],
  pageId: string | null = null,
): PermissionDef[] => {
  const actionNames: Record<string, LocalizedString> = {
    view: { en: 'View', ar: 'عرض' },
    create: { en: 'Create', ar: 'إنشاء' },
    edit: { en: 'Edit', ar: 'تعديل' },
    delete: { en: 'Delete', ar: 'حذف' },
    export: { en: 'Export', ar: 'تصدير' },
    print: { en: 'Print', ar: 'طباعة' },
    approve: { en: 'Approve', ar: 'اعتماد' },
    reject: { en: 'Reject', ar: 'رفض' },
  };
  return [
    ...actions.map((action) => {
      const actionName = actionNames[action] ?? { en: action, ar: action };
      return def(
        moduleId,
        resource,
        action,
        {
          en: `${actionName.en} ${resourceName.en}`,
          ar: `${actionName.ar} ${resourceName.ar}`,
        },
        pageId,
      );
    }),
    ...specials.map((s) =>
      def(
        moduleId,
        resource,
        s.action,
        s.name,
        pageId,
        s.breakGlass === undefined ? undefined : { breakGlass: s.breakGlass },
      ),
    ),
  ];
};

/** One problem found in a page registry, phrased for a boot log or a CI failure. */
export interface PageRegistryProblem {
  kind: 'duplicate-page' | 'bad-page-id' | 'foreign-page' | 'unknown-page' | 'empty-page';
  detail: string;
}

/**
 * Everything that can be wrong about a page registry, in one pass, for one deployment's worth of
 * pages and permissions.
 *
 * It runs at boot and in CI rather than only in CI, because the registry is assembled from whichever
 * modules a deployment actually enables: a page belonging to a disabled module is not a problem, and
 * a permission pointing at a page that shipped in a module somebody turned off is. Only the process
 * that knows which modules are on can decide that, so the check lives where the assembly happens.
 *
 * `empty-page` is the one worth naming. A page with no permissions renders as an expandable row
 * containing nothing — a tree that describes a surface which, as far as authorization is concerned,
 * does not exist. Failing the boot is the honest response; hiding it would leave the registry
 * disagreeing with the screen and nobody the wiser.
 */
export const validatePageRegistry = (
  pages: readonly PageDef[],
  permissions: readonly PermissionDef[],
): PageRegistryProblem[] => {
  const problems: PageRegistryProblem[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    if (seen.has(page.id)) {
      problems.push({ kind: 'duplicate-page', detail: `page id declared twice: ${page.id}` });
    }
    seen.add(page.id);
    if (!PAGE_ID_PATTERN.test(page.id)) {
      problems.push({
        kind: 'bad-page-id',
        detail: `page id is not <moduleId>.<slug>: ${page.id}`,
      });
    } else if (!page.id.startsWith(`${page.moduleId}.`)) {
      problems.push({
        kind: 'bad-page-id',
        detail: `page ${page.id} is declared by module ${page.moduleId}`,
      });
    }
  }

  const used = new Set<string>();
  for (const permission of permissions) {
    if (permission.pageId === null) continue;
    used.add(permission.pageId);
    const page = pages.find((p) => p.id === permission.pageId);
    if (page === undefined) {
      problems.push({
        kind: 'unknown-page',
        detail: `${permission.key} points at an undeclared page: ${permission.pageId}`,
      });
      continue;
    }
    // A permission may only sit on a page its OWN module owns. Otherwise one module's matrix would
    // grow rows from another's, and the tree would stop being a projection of the module boundary.
    if (page.moduleId !== permission.moduleId) {
      problems.push({
        kind: 'foreign-page',
        detail: `${permission.key} (${permission.moduleId}) points at ${page.id} (${page.moduleId})`,
      });
    }
  }

  for (const page of pages) {
    if (!used.has(page.id)) {
      problems.push({ kind: 'empty-page', detail: `page has no permissions: ${page.id}` });
    }
  }
  return problems;
};
