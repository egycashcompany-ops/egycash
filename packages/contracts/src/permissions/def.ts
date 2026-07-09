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
}

export const PERMISSION_KEY_PATTERN = /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/;
export const PermissionKeySchema = z.string().regex(PERMISSION_KEY_PATTERN);

const def = (
  moduleId: string,
  resource: string,
  action: string,
  name: LocalizedString,
  extra?: Partial<Pick<PermissionDef, 'breakGlass'>>,
): PermissionDef => ({ key: `${resource}.${action}`, resource, action, moduleId, name, ...extra });

/** Declare a resource with standard actions + named special actions. */
export const declarePermissions = (
  moduleId: string,
  resource: string,
  resourceName: LocalizedString,
  actions: readonly string[],
  specials: readonly { action: string; name: LocalizedString; breakGlass?: boolean }[] = [],
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
      return def(moduleId, resource, action, {
        en: `${actionName.en} ${resourceName.en}`,
        ar: `${actionName.ar} ${resourceName.ar}`,
      });
    }),
    ...specials.map((s) =>
      def(
        moduleId,
        resource,
        s.action,
        s.name,
        s.breakGlass === undefined ? undefined : { breakGlass: s.breakGlass },
      ),
    ),
  ];
};
