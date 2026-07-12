// TanStack Query key factory (ADR-013): stable, hierarchical keys so invalidation is
// surgical. Convention: [module, feature, kind, ...params] — e.g.
// ['hr','applicants','list',{ page: 1 }]. Feature api/ folders build their keys from these.
export const listKey = (module: string, feature: string, params?: unknown): readonly unknown[] =>
  params === undefined ? [module, feature, 'list'] : [module, feature, 'list', params];

export const detailKey = (module: string, feature: string, id: string): readonly unknown[] => [
  module,
  feature,
  'detail',
  id,
];

/** Everything under a feature — the broadest invalidation a mutation should need. */
export const featureKey = (module: string, feature: string): readonly unknown[] => [module, feature];
