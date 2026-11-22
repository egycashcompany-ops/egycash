// «المواقع» (design §2): the gate of every route, read off the router itself. The tab, its branch
// list and every write are `itCatalog.manage` — the catalogs page's grant, no new key — and the
// pickers' names open on ANY of the three IT reads a picker naming a place serves (the catalog's
// own trio). `authorize` and `authorizeAny` are replaced by stand-ins that carry the keys they were
// given, so the router stack says which gate each route has; everything else is the real module.
// The manifest is held to the router too: the prefix it is mounted at, and the collection it owns.
import { type Router } from 'express';
import { describe, expect, it, vi } from 'vitest';

type Gate = { keys: readonly string[]; any: boolean };
type GatedHandler = (() => void) & { gate?: Gate };

vi.mock('../../../platform/rbac', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  authorize: (key: string): GatedHandler =>
    Object.assign(() => undefined, { gate: { keys: [key], any: false } }),
  authorizeAny: (...keys: string[]): GatedHandler =>
    Object.assign(() => undefined, { gate: { keys, any: true } }),
}));

const { buildItLocationsRouter } = await import('./index');
const { itModule } = await import('../it.module');

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: { handle: GatedHandler }[];
  };
}

/** `METHOD path → the gate` for every route the router declares, in its own order. */
const gates = (prefix: string, router: Router): [string, Gate | undefined][] =>
  (router.stack as unknown as RouteLayer[]).flatMap((layer) => {
    const route = layer.route;
    if (route === undefined) return [];
    const method = Object.keys(route.methods)[0]?.toUpperCase() ?? '?';
    const gate = route.stack.map((s) => s.handle.gate).find((g) => g !== undefined);
    return [[`${method} ${prefix}${route.path}`, gate]];
  });

const single = (key: string): Gate => ({ keys: [key], any: false });

describe('the places answer to the catalogs’ grant', () => {
  const routes = gates('/it/locations', buildItLocationsRouter());

  it('gates the tab, its branch list and every write on itCatalog.manage, the pickers on any IT read', () => {
    expect(routes).toEqual([
      ['GET /it/locations/', single('itCatalog.manage')],
      [
        'GET /it/locations/options',
        { keys: ['itAsset.view', 'itConsumable.view', 'itCatalog.manage'], any: true },
      ],
      ['GET /it/locations/branch-targets', single('itCatalog.manage')],
      ['POST /it/locations/', single('itCatalog.manage')],
      ['PATCH /it/locations/:id', single('itCatalog.manage')],
    ]);
  });

  it('declares no delete — a place is retired, never deleted', () => {
    expect(routes.some(([route]) => route.startsWith('DELETE '))).toBe(false);
  });

  it('serves the literal segments before /:id', () => {
    const order = routes.map(([route]) => route);
    expect(order.indexOf('GET /it/locations/options')).toBeLessThan(
      order.indexOf('PATCH /it/locations/:id'),
    );
    expect(order.indexOf('GET /it/locations/branch-targets')).toBeLessThan(
      order.indexOf('PATCH /it/locations/:id'),
    );
  });
});

describe('the IT manifest', () => {
  it('mounts the places at /it/locations and owns their collection', () => {
    expect(itModule.routes.map((route) => route.prefix)).toContain('/it/locations');
    expect(itModule.collections).toContain('it_locations');
  });
});
