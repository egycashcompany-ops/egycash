// Layer 2 — Business Modules. Each module registers exactly one ModuleManifest here
// (Module Structure §5): adding a module touches its own folder + one line below.
import { type ModuleManifest } from '../platform/kernel/module-registry';
import { hrModule } from './hr/hr.module';

export const moduleManifests: ModuleManifest[] = [hrModule];
