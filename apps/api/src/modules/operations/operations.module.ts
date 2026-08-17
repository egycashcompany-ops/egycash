// Operations / Cash Transfer module manifest (design docs/12-planning/operations-module-design.md,
// OP-1 Domain Foundation slice).
//
// Delivered incrementally exactly as Fleet was: this slice registers the module and its domain
// vocabulary (packages/contracts/src/modules/operations.ts) and nothing else. OP-2..OP-12 add
// reference data, the operations day, shipments, crew assignment, vault custody, sequencing,
// captain execution, reports and events — each extending THIS manifest, never adding a second one.
//
// Surfaces are deliberately EMPTY here. Permissions, pages, routes and collections arrive with the
// slice that serves them (the IT precedent — "a grant is declared WITH its operation, never ahead
// of it"), so nothing in the registry describes an operation that does not exist yet.
//
// Boundary (frozen, fleet-module-design.md §9.4): Fleet owns (vehicle, drivers, mission type) per
// day in `fleet_duty_assignments`; Operations attaches its cash-crew and work to that row by id
// and never re-models the roster. Business behaviour is ported from the legacy system by parity
// (operations-legacy-discovery.md) — legacy parity first, improvements second.
import { type ModuleManifest } from '../../platform/kernel/module-registry';

export const operationsModule: ModuleManifest = {
  id: 'operations',
  name: { en: 'Operations', ar: 'العمليات' },
  version: '0.1.0',
  requiresPlatform: '^2.2',
  permissions: [],
  routes: [],
  collections: [],
  eventSubscriptions: [],
};
