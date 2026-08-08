// Layer 2 — Business Modules. Each module registers exactly one ModuleManifest here
// (Module Structure §5): adding a module touches its own folder + one line below.
import { env } from '../infrastructure/config/env';
import { type ModuleManifest } from '../platform/kernel/module-registry';
import { hrModule } from './hr/hr.module';
import { fleetModule } from './fleet/fleet.module';
import { itModule } from './it/it.module';
import { automationModule } from './automation/automation.module';

/**
 * Automation is gated on `AUTOMATION_ENABLED` (default false) until the engine is complete
 * (design §13). Withholding the MANIFEST rather than the routes is what makes the flag total: no
 * routes mounted, no permissions in the registry, no event subscriptions — nothing for a user to
 * find half-built. Flipping the flag registers it at the next boot like any other module.
 */
export const moduleManifests: ModuleManifest[] = [
  hrModule,
  fleetModule,
  itModule,
  ...(env.AUTOMATION_ENABLED ? [automationModule] : []),
];
