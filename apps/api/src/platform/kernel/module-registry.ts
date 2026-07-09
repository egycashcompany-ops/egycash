// The module plugin system (Software Architecture §4): modules are discovered and
// mounted at boot via a Module Manifest — the single integration point between
// Layer 2 and Layer 1. A manifest that fails validation FAILS THE BOOT loudly.
import { type Router } from 'express';
import { PERMISSION_KEY_PATTERN, type LocalizedString, type PermissionDef } from '@ecms/contracts';
import { type EventHandler } from './event-bus';

/** Bumped by ADR-governed platform-contract changes (Review R25). */
export const PLATFORM_VERSION = '2.1.0';

export interface RouteRegistration {
  /** Mounted under `/api/v1/<module-id>` — kernel enforces the prefix. */
  prefix: string;
  router: Router;
}

export interface EventSubscription {
  event: string;
  handlerId: string;
  handler: EventHandler;
}

export interface ModuleManifest {
  id: string;
  name: LocalizedString;
  version: string;
  /** Semver range of the platform contract the module was built against (Review R25). */
  requiresPlatform: string;
  permissions: PermissionDef[];
  routes: RouteRegistration[];
  /** Mongoose collection names the module owns — must carry the `<id>_` prefix. */
  collections: string[];
  eventSubscriptions: EventSubscription[];
  seed?: () => Promise<void>;
}

const MODULE_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * Minimal semver-satisfies for the range shapes manifests use: `^MAJOR.MINOR`
 * (or `^MAJOR.MINOR.PATCH`) and exact versions. Anything else is a validation error.
 */
export const platformSatisfies = (range: string, version: string = PLATFORM_VERSION): boolean => {
  const parse = (v: string): [number, number, number] | null => {
    const m = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(v);
    return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3] ?? '0')];
  };
  const actual = parse(version);
  if (actual === null) return false;
  if (range.startsWith('^')) {
    const wanted = parse(range.slice(1));
    if (wanted === null) return false;
    if (actual[0] !== wanted[0]) return false;
    if (actual[1] !== wanted[1]) return actual[1] > wanted[1];
    return actual[2] >= wanted[2];
  }
  const exact = parse(range);
  return (
    exact !== null && exact[0] === actual[0] && exact[1] === actual[1] && exact[2] === actual[2]
  );
};

const registeredModules = new Map<string, ModuleManifest>();

export class ManifestValidationError extends Error {
  constructor(moduleId: string, rule: string) {
    super(`Module manifest validation failed [${moduleId}]: ${rule}`);
    this.name = 'ManifestValidationError';
  }
}

export const validateManifest = (manifest: ModuleManifest): void => {
  const { id } = manifest;
  if (!MODULE_ID_PATTERN.test(id)) {
    throw new ManifestValidationError(id, `module id must match ${MODULE_ID_PATTERN}`);
  }
  if (registeredModules.has(id)) {
    throw new ManifestValidationError(id, 'duplicate module id');
  }
  if (!platformSatisfies(manifest.requiresPlatform)) {
    throw new ManifestValidationError(
      id,
      `requiresPlatform ${manifest.requiresPlatform} is not satisfied by platform ${PLATFORM_VERSION}`,
    );
  }
  for (const permission of manifest.permissions) {
    if (!PERMISSION_KEY_PATTERN.test(permission.key)) {
      throw new ManifestValidationError(id, `permission key ${permission.key} violates naming`);
    }
    if (permission.moduleId !== id) {
      throw new ManifestValidationError(
        id,
        `permission ${permission.key} declares foreign moduleId`,
      );
    }
  }
  for (const collection of manifest.collections) {
    if (!collection.startsWith(`${id.replaceAll('-', '_')}_`)) {
      throw new ManifestValidationError(id, `collection ${collection} lacks the module prefix`);
    }
  }
  for (const route of manifest.routes) {
    if (route.prefix !== `/${id}` && !route.prefix.startsWith(`/${id}/`)) {
      throw new ManifestValidationError(id, `route prefix ${route.prefix} outside /${id}`);
    }
  }
};

export const registerModule = (manifest: ModuleManifest): void => {
  validateManifest(manifest);
  registeredModules.set(manifest.id, manifest);
};

export const getRegisteredModules = (): ModuleManifest[] => [...registeredModules.values()];

/** Test-only. */
export const clearModules = (): void => {
  registeredModules.clear();
};
