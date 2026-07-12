// Boot sequence (Software Architecture §4):
//   infrastructure → Tier 0 (settings, audit) → Tier 1 (users/org/rbac/auth) →
//   module manifests (validate → register) → routes mount → traffic.
// A module that fails validation FAILS THE BOOT loudly.
import { z } from 'zod';
import { platformPermissions, type PermissionDef } from '@ecms/contracts';
import { connectMongo } from '../../infrastructure/database/mongo';
import { logger } from '../../infrastructure/logging/logger';
import { registerAuthEventHandlers, registerAuthSettings } from '../auth';
import { registerAuditJobHandlers, registerAuditSettings } from '../audit';
import { registerFileJobHandlers } from '../files';
import {
  ensureBuiltinNotificationTemplates,
  registerBuiltinChannelAdapters,
  registerNotificationEventHandlers,
  registerNotificationJobHandlers,
  registerNotificationSettings,
} from '../notifications';
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
  registerAuditSettings();
  registerNotificationSettings();
  declareFeatureFlagSettings(z.boolean());
  registerAuditJobHandlers();
  registerOutboxJobHandlers();
  registerFileJobHandlers(); // files extension-point pipeline (worker executes)
  registerNotificationJobHandlers();
  registerBuiltinChannelAdapters();

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
  registerNotificationEventHandlers();

  // Organization singleton must exist before anything scopes to it (ADR-015).
  await organizationService.ensure({ name: { ar: 'إيجي كاش', en: 'EGYCASH' } });

  // Built-in templates for the two wired-up event subscriptions above (Sprint 3.3 §4).
  await ensureBuiltinNotificationTemplates();

  // Scheduler registry (Review R3) — platform tasks, then any a module manifest declares.
  registerPlatformScheduledTasks();
  for (const manifest of getRegisteredModules()) {
    for (const task of manifest.scheduledTasks ?? []) schedulerService.declareTask(task);
  }
  await schedulerService.syncRegistry();

  // Module reference-data seeds run last — after permissions, the org singleton, and the
  // scheduler exist, since a module's seed may depend on any of them (Module Structure §2.1).
  for (const manifest of getRegisteredModules()) {
    if (manifest.seed !== undefined) await manifest.seed();
  }

  logger.info({ modules: getRegisteredModules().map((m) => m.id) }, 'platform booted');
};

/** Test-only: allow a fresh boot in a new database. */
export const resetBootState = (): void => {
  booted = false;
};
