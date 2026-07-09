// Boot sequence (Software Architecture §4):
//   infrastructure → Tier 0 (settings, audit) → Tier 1 (users/org/rbac/auth) →
//   module manifests (validate → register) → routes mount → traffic.
// A module that fails validation FAILS THE BOOT loudly.
import { z } from 'zod';
import { platformPermissions, type PermissionDef } from '@ecms/contracts';
import { connectMongo } from '../../infrastructure/database/mongo';
import { logger } from '../../infrastructure/logging/logger';
import { registerAuthEventHandlers, registerAuthSettings } from '../auth';
import { registerAuditJobHandlers } from '../audit';
import { registerFileJobHandlers } from '../files';
import { declareFeatureFlagSettings } from '../settings';
import { rbacService } from '../rbac';
import { organizationService } from '../organization';
import { registerPlatformScheduledTasks, schedulerService } from '../scheduler';
import { registerOutboxJobHandlers } from './event-bus';
import { getRegisteredModules, registerModule, type ModuleManifest } from './module-registry';

let booted = false;

export interface BootOptions {
  mongoUri?: string;
  modules?: ModuleManifest[];
}

export const bootPlatform = async (options: BootOptions = {}): Promise<void> => {
  if (booted) return;
  booted = true;

  await connectMongo(options.mongoUri);

  // Tier 0 — foundations: setting declarations, job handlers.
  registerAuthSettings();
  declareFeatureFlagSettings(z.boolean());
  registerAuditJobHandlers();
  registerOutboxJobHandlers();
  registerFileJobHandlers(); // files extension-point pipeline (worker executes)

  // Layer 2 — validate + register module manifests (permissions flow into the registry).
  for (const manifest of options.modules ?? []) {
    registerModule(manifest);
    for (const subscription of manifest.eventSubscriptions) {
      // Subscriptions are declared in manifests — visible, reviewable wiring (ADR-008).
      const { subscribe } = await import('./event-bus');
      subscribe(
        subscription.event,
        `${manifest.id}:${subscription.handlerId}`,
        subscription.handler,
      );
    }
  }

  // Tier 1 — identity & authorization.
  const modulePermissions: PermissionDef[] = getRegisteredModules().flatMap((m) => m.permissions);
  await rbacService.syncPermissionRegistry([...platformPermissions, ...modulePermissions]);
  registerAuthEventHandlers();

  // Organization singleton must exist before anything scopes to it (ADR-015).
  await organizationService.ensure({ name: { ar: 'إيجي كاش', en: 'EGYCASH' } });

  // Scheduler registry (Review R3).
  registerPlatformScheduledTasks();
  await schedulerService.syncRegistry();

  logger.info({ modules: getRegisteredModules().map((m) => m.id) }, 'platform booted');
};

/** Test-only: allow a fresh boot in a new database. */
export const resetBootState = (): void => {
  booted = false;
};
