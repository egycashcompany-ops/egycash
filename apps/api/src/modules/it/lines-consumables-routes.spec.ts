// «فى الصلاحيات مش لاقى حاجة لـ /consumables ولا /mobile-lines !! فى الـ IT ظبط صلاحيات الشاشات عشان
// أقدر أتحكم فيها» (2026-11-17) — the two screens that rode the asset grants have their own.
//
// What is pinned here is the gate of every ROUTE, read off the routers themselves: each one the
// lines, their intervals and their papers serve authorizes on `itMobileLine.*`; each one the
// stores, their ledger and their memos serve on `itConsumable.*` — the same ACTION the asset key
// had, and no route of either on `itAsset` any more (no «either key» fallback: that would make the
// new rows of the role matrix mean nothing). `/it/people`, the holder boxes of all three screens,
// opens on ANY of the three registers' read grants; `/it/people/recipients`, the box a hand-over
// names its recipient in (2026-11-18), on ANY of their hand-over grants. `authorize` and
// `authorizeAny` are replaced by stand-ins that carry the keys they were given, so the router
// stack says which gate each route has; everything else is the real module.
import { type Router } from 'express';
import { describe, expect, it, vi } from 'vitest';

type Gate = { keys: readonly string[]; any: boolean };
type GatedHandler = (() => void) & { gate?: Gate };

vi.mock('../../platform/rbac', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  authorize: (key: string): GatedHandler =>
    Object.assign(() => undefined, { gate: { keys: [key], any: false } }),
  authorizeAny: (...keys: string[]): GatedHandler =>
    Object.assign(() => undefined, { gate: { keys, any: true } }),
}));

const {
  buildItMobileLineAssignmentsRouter,
  buildItMobileLineReceiptsRouter,
  buildItMobileLinesRouter,
} = await import('./mobile-lines');
const { buildItConsumableMemosRouter, buildItConsumableMovementsRouter, buildItConsumablesRouter } =
  await import('./consumables');
const { buildItPeopleRouter } = await import('./people');

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: { handle: GatedHandler }[];
  };
}

/**
 * `METHOD path → the gate` for every route a router declares, in its own order. Express's own
 * types do not declare a route's `methods`, which it carries at run time — hence the shape above.
 */
const gates = (prefix: string, router: Router): [string, Gate | undefined][] =>
  (router.stack as unknown as RouteLayer[]).flatMap((layer) => {
    const route = layer.route;
    if (route === undefined) return [];
    const method = Object.keys(route.methods)[0]?.toUpperCase() ?? '?';
    const gate = route.stack.map((s) => s.handle.gate).find((g) => g !== undefined);
    return [[`${method} ${prefix}${route.path}`, gate]];
  });

const single = (key: string): Gate => ({ keys: [key], any: false });

describe('the mobile lines answer to their own grants', () => {
  const routes = [
    ...gates('/it/mobile-lines', buildItMobileLinesRouter()),
    ...gates('/it/mobile-line-assignments', buildItMobileLineAssignmentsRouter()),
    ...gates('/it/mobile-line-receipts', buildItMobileLineReceiptsRouter()),
  ];

  it('authorizes every route on itMobileLine.<the action itAsset had>', () => {
    expect(Object.fromEntries(routes)).toEqual({
      'GET /it/mobile-lines/': single('itMobileLine.view'),
      'GET /it/mobile-lines/summary': single('itMobileLine.view'),
      'POST /it/mobile-lines/': single('itMobileLine.create'),
      'GET /it/mobile-lines/:id': single('itMobileLine.view'),
      'PATCH /it/mobile-lines/:id': single('itMobileLine.edit'),
      'GET /it/mobile-lines/:id/history': single('itMobileLine.view'),
      'POST /it/mobile-lines/:id/assign': single('itMobileLine.assign'),
      'POST /it/mobile-lines/:id/return': single('itMobileLine.assign'),
      'POST /it/mobile-lines/:id/suspend': single('itMobileLine.edit'),
      'POST /it/mobile-lines/:id/reactivate': single('itMobileLine.edit'),
      'GET /it/mobile-line-assignments/': single('itMobileLine.view'),
      'POST /it/mobile-line-receipts/preview': single('itMobileLine.assign'),
      'GET /it/mobile-line-receipts/:id': single('itMobileLine.view'),
      'POST /it/mobile-line-receipts/:id/print': single('itMobileLine.view'),
      'GET /it/mobile-line-receipts/:id/signed-copy': single('itMobileLine.view'),
      'POST /it/mobile-line-receipts/:id/signed-copy': single('itMobileLine.assign'),
      'DELETE /it/mobile-line-receipts/:id/signed-copy': single('itMobileLine.assign'),
    });
  });

  it('leaves no route on the asset grants', () => {
    for (const [route, gate] of routes) {
      expect(gate, route).toBeDefined();
      for (const key of gate?.keys ?? []) expect(key, route).not.toMatch(/^itAsset\./u);
    }
  });
});

describe('the consumables answer to their own grants', () => {
  const routes = [
    ...gates('/it/consumables', buildItConsumablesRouter()),
    ...gates('/it/consumable-movements', buildItConsumableMovementsRouter()),
    ...gates('/it/consumable-memos', buildItConsumableMemosRouter()),
  ];

  it('authorizes every route on itConsumable.<the action itAsset had>', () => {
    expect(Object.fromEntries(routes)).toEqual({
      'GET /it/consumables/': single('itConsumable.view'),
      'POST /it/consumables/': single('itConsumable.create'),
      'POST /it/consumables/issue': single('itConsumable.assign'),
      'POST /it/consumables/transfer': single('itConsumable.assign'),
      'GET /it/consumables/transfer-targets': single('itConsumable.assign'),
      'GET /it/consumables/:id': single('itConsumable.view'),
      'PATCH /it/consumables/:id': single('itConsumable.edit'),
      'GET /it/consumables/:id/movements': single('itConsumable.view'),
      'POST /it/consumables/:id/receive': single('itConsumable.edit'),
      'POST /it/consumables/:id/scrap': single('itConsumable.edit'),
      'POST /it/consumables/:id/return': single('itConsumable.assign'),
      'GET /it/consumable-movements/': single('itConsumable.view'),
      // «تعديل الجهاز» (2026-11-17) — the issue's own grant; a device it names needs the caller's
      // own `itAsset.view`, which the service asks, not the gate.
      'PATCH /it/consumable-movements/:id/installed-on': single('itConsumable.assign'),
      'GET /it/consumable-memos/:id': single('itConsumable.view'),
      'POST /it/consumable-memos/:id/print': single('itConsumable.view'),
      'GET /it/consumable-memos/:id/signed-copy': single('itConsumable.view'),
      'POST /it/consumable-memos/:id/signed-copy': single('itConsumable.assign'),
      'DELETE /it/consumable-memos/:id/signed-copy': single('itConsumable.assign'),
    });
  });

  it('declares the transfer targets before the id routes, so the segment is never read as an id', () => {
    const paths = routes.map(([route]) => route);
    expect(paths.indexOf('GET /it/consumables/transfer-targets')).toBeLessThan(
      paths.indexOf('GET /it/consumables/:id'),
    );
  });

  it('leaves no route on the asset grants', () => {
    for (const [route, gate] of routes) {
      expect(gate, route).toBeDefined();
      for (const key of gate?.keys ?? []) expect(key, route).not.toMatch(/^itAsset\./u);
    }
  });
});

describe('the holder boxes of all three screens', () => {
  it('open /it/people on ANY of the three registers’ read grants', () => {
    const any: Gate = {
      keys: ['itAsset.view', 'itMobileLine.view', 'itConsumable.view'],
      any: true,
    };
    expect(Object.fromEntries(gates('/it/people', buildItPeopleRouter()))).toEqual({
      'GET /it/people/': any,
      'GET /it/people/recipients': {
        keys: ['itAsset.assign', 'itMobileLine.assign', 'itConsumable.assign'],
        any: true,
      },
      'GET /it/people/:employeeId': any,
    });
  });

  // «أسمح إنه يعرف يسلم لحد فى فرع تاني» (2026-11-18) — a hand-over's box names anybody employed,
  // in every branch, so it opens on the ACT's grant: a reader who may only look gets a 403.
  it('open /it/people/recipients on ANY of the three hand-over grants, before the id route', () => {
    const paths = gates('/it/people', buildItPeopleRouter()).map(([route]) => route);
    expect(paths.indexOf('GET /it/people/recipients')).toBeLessThan(
      paths.indexOf('GET /it/people/:employeeId'),
    );
  });
});
