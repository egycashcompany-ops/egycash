// Layer 2 — Business Modules. Each module registers exactly one ModuleManifest here
// (Module Structure §5): adding a module touches its own folder + one line below.
// Phase 2.1 ships the Platform Core only; the HR module arrives with phase 2.3.
import { type ModuleManifest } from '../platform/kernel/module-registry';

export const moduleManifests: ModuleManifest[] = [];
