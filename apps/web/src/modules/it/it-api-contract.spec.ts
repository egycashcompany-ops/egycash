// The UI→API seam, checked against the API itself.
//
// This suite exists because of the one class of bug the sandbox cannot catch any other way. The
// integration tests prove the backend works; the component tests prove the screens render. What
// neither proves is that the screens call the endpoints the backend actually serves — a typo in a
// path, a wrong verb, or a sort field the API rejects all typecheck, lint and render perfectly,
// and fail only when a real user clicks the button.
//
// So this reads the IT route files from `apps/api` and the IT api/ surface from here, and asserts
// they agree. It is a source-level check on purpose: it needs no database, no server and no
// network, so it runs everywhere including CI's fastest job.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_SRC = resolve(HERE, '../../../../api/src/modules/it');

const read = (path: string): string => readFileSync(resolve(API_SRC, path), 'utf8');
const CLIENT = readFileSync(resolve(HERE, 'api/it-api.ts'), 'utf8');

const ASSET_ROUTES = read('assets/asset.routes.ts');
const CATALOG_ROUTES = read('catalog-items/catalog-item.routes.ts');
const VENDOR_ROUTES = read('vendors/vendor.routes.ts');
const TICKET_ROUTES = read('tickets/ticket.routes.ts');
const PRIORITY_ROUTES = read('tickets/priority.routes.ts');
const ORDER_ROUTES = read('maintenance/order.routes.ts');
const PLAN_ROUTES = read('maintenance/plan.routes.ts');
const PART_ROUTES = read('spare-parts/part.routes.ts');
const ASSET_SERVICE = read('assets/asset.service.ts');
const CATALOG_SERVICE = read('catalog-items/catalog-item.service.ts');
const VENDOR_SERVICE = read('vendors/vendor.service.ts');
const TICKET_REPOSITORY = read('tickets/ticket.repository.ts');
const PRIORITY_REPOSITORY = read('tickets/priority.repository.ts');
const ORDER_REPOSITORY = read('maintenance/order.repository.ts');
const PLAN_REPOSITORY = read('maintenance/plan.repository.ts');
const PART_REPOSITORY = read('spare-parts/part.repository.ts');
const MANIFEST = read('it.module.ts');

/** The verb+path pairs a router declares, e.g. `get /by-code/:code`. */
const declared = (routes: string): Set<string> => {
  const found = new Set<string>();
  for (const match of routes.matchAll(/router\.(get|post|patch|delete)\(\s*'([^']+)'/g)) {
    found.add(`${match[1]} ${match[2]}`);
  }
  return found;
};

describe('every endpoint the IT client calls exists on the API', () => {
  it('mounts the three routers the client targets', () => {
    for (const prefix of ['/it/assets', '/it/catalog-items', '/it/vendors']) {
      expect(MANIFEST, `manifest does not mount ${prefix}`).toContain(`prefix: '${prefix}'`);
    }
  });

  it('assets: the IT-1 registry plus IT-2 custody', () => {
    const routes = declared(ASSET_ROUTES);
    expect(routes).toEqual(
      new Set([
        // IT-1 — the registry
        'get /',
        'get /by-code/:code',
        'post /labels',
        'get /:id',
        'post /',
        'patch /:id',
        'delete /:id',
        // IT-2 — custody: four NAMED actions, never a generic PATCH (design §4.3)
        'post /:id/assign',
        'post /:id/return',
        'post /:id/transfer',
        'post /:id/dispose',
        'get /:id/history',
        'get /:id/assignments',
      ]),
    );
    // …and the client calls exactly those.
    expect(CLIENT).toContain("`/it/assets${buildQuery(params)}`");
    expect(CLIENT).toContain('`/it/assets/${id}`');
    expect(CLIENT).toContain('`/it/assets/by-code/${encodeURIComponent(code)}`');
    expect(CLIENT).toContain("post<ItAssetDto>('/it/assets'");
    expect(CLIENT).toContain("postBinary('/it/assets/labels'");
    // …and the client calls each custody action at the path the API serves it on.
    for (const action of ['assign', 'return', 'transfer', 'dispose']) {
      expect(CLIENT).toContain(`/it/assets/\${id}/${action}`);
    }
    expect(CLIENT).toContain('`/it/assets/${id}/history');
    expect(CLIENT).toContain('`/it/assets/${id}/assignments');
  });

  it('mounts the cross-asset custody register', () => {
    expect(MANIFEST).toContain("prefix: '/it/assignments'");
    expect(CLIENT).toContain("getPage<ItAssetAssignmentDto>(`/it/assignments");
  });

  it('catalog items: list, create, update — and no delete, because rows archive (FR-11)', () => {
    const routes = declared(CATALOG_ROUTES);
    expect(routes).toEqual(new Set(['get /', 'post /', 'patch /:id']));
    expect([...routes].some((r) => r.startsWith('delete'))).toBe(false);
    expect(CLIENT).not.toContain("del<void>('/it/catalog-items");
  });

  it('vendors: list, get, create, update — archive, never delete (FR-11)', () => {
    const routes = declared(VENDOR_ROUTES);
    expect(routes).toEqual(new Set(['get /', 'get /:id', 'post /', 'patch /:id']));
    expect(CLIENT).not.toContain("del<void>('/it/vendors");
  });

  it('exposes resolve-by-id, the half of ADR-019 rule 5 a picker cannot fake', () => {
    expect(declared(VENDOR_ROUTES)).toContain('get /:id');
    expect(CLIENT).toContain('`/it/vendors/${id}`');
  });

  it('tickets: the read pair, the edit, and one endpoint per NAMED transition (§4.4)', () => {
    const routes = declared(TICKET_ROUTES);
    expect(routes).toEqual(
      new Set([
        'get /',
        'post /',
        'get /:id',
        'patch /:id',
        // Each transition carries a different required fact, so each has its own endpoint — and
        // none of them is a generic PATCH of `status`, which would let a client invent a move.
        'post /:id/assign',
        'post /:id/status',
        'post /:id/resolve',
        'post /:id/close',
        'post /:id/reopen',
        'post /:id/cancel',
        // The stream: history AND conversation, one collection, one route pair.
        'get /:id/comments',
        'post /:id/comments',
      ]),
    );
    expect(MANIFEST).toContain("prefix: '/it/tickets'");
    expect(CLIENT).toContain("getPage<ItTicketDto>(`/it/tickets${buildQuery(params)}`)");
    expect(CLIENT).toContain('`/it/tickets/${id}`');
    for (const action of ['assign', 'status', 'resolve', 'close', 'reopen', 'cancel', 'comments']) {
      expect(CLIENT, `client never calls /${action}`).toContain(`/it/tickets/\${id}/${action}`);
    }
  });

  // Design §2's files row is explicit: "additive attachments · NO NEW UPLOAD PATH". IT must not
  // mint an upload endpoint of its own — a ticket attachment is an ordinary platform file carrying
  // the owning `entityRef`. Pinned in both directions, because the tempting shortcut (an
  // `/it/tickets/:id/attachments` proxy, as HR applicants have) is exactly what the design forbids
  // here, and it would also mint a second permission surface over the same bytes.
  it('attachments ride platform/files additively — IT declares no upload path of its own', () => {
    const routes = declared(TICKET_ROUTES);
    for (const route of routes) {
      expect(route, 'IT must not serve its own attachment endpoint').not.toContain('attachment');
    }
    expect(CLIENT).toContain("upload<FileDto>('/platform/files'");
    // …and it names the owning entity, which is what makes the file findable from the ticket.
    expect(CLIENT).toContain("form.append('moduleId', 'it')");
    expect(CLIENT).toContain("form.append('entityType', 'ticket')");
  });

  it('maintenance orders: the read pair, the edit, and one endpoint per NAMED transition (§4.7)', () => {
    const routes = declared(ORDER_ROUTES);
    expect(routes).toEqual(
      new Set([
        'get /',
        'post /',
        'get /:id',
        'patch /:id',
        // The consumed parts are a SEPARATE read, because they live in the ledger and not on the
        // order (ADR-024). An embedded list would be a second copy to drift.
        'get /:id/parts',
        'post /:id/start',
        'post /:id/complete',
        'post /:id/cancel',
      ]),
    );
    // No delete: an order is a business record. It ends by completing or by cancelling.
    expect([...routes].some((r) => r.startsWith('delete'))).toBe(false);
    expect(MANIFEST).toContain("prefix: '/it/maintenance-orders'");
    expect(CLIENT).toContain("getPage<ItMaintenanceOrderDto>(`/it/maintenance-orders");
    for (const action of ['start', 'complete', 'cancel', 'parts']) {
      expect(CLIENT, `client never calls /${action}`).toContain(
        `/it/maintenance-orders/\${id}/${action}`,
      );
    }
  });

  it('maintenance plans: CRUD plus the two named state actions — never a delete (FR-11)', () => {
    const routes = declared(PLAN_ROUTES);
    expect(routes).toEqual(
      new Set([
        'get /',
        'post /',
        'get /:id',
        'patch /:id',
        'post /:id/activate',
        'post /:id/deactivate',
      ]),
    );
    expect([...routes].some((r) => r.startsWith('delete'))).toBe(false);
    expect(MANIFEST).toContain("prefix: '/it/maintenance-plans'");
    expect(CLIENT).toContain("getPage<ItMaintenancePlanDto>(`/it/maintenance-plans");
    expect(CLIENT).toContain("active ? 'activate' : 'deactivate'");
  });

  // FR-9, pinned as an ABSENCE. Stock leaves the store only through an order's completion, so a
  // consumption endpoint must not exist — not on the store's router, and not in the client. This
  // is the single most tempting thing for a later change to add, and adding it would break the one
  // question the ledger exists to answer: which repair used the part.
  it('spare parts: receipts and movements — and NO consumption endpoint anywhere (FR-9)', () => {
    const routes = declared(PART_ROUTES);
    expect(routes).toEqual(
      new Set(['get /', 'post /', 'get /:id', 'patch /:id', 'post /:id/receipts', 'get /:id/movements']),
    );
    expect([...routes].some((r) => r.startsWith('delete'))).toBe(false);
    for (const route of routes) {
      expect(route, 'stock must never leave the store outside an order').not.toMatch(
        /consume|issue|withdraw/i,
      );
    }
    expect(CLIENT).not.toMatch(/consumeSparePart|issueSparePart/);
    expect(MANIFEST).toContain("prefix: '/it/spare-parts'");
    expect(CLIENT).toContain('`/it/spare-parts/${id}/receipts`');
    expect(CLIENT).toContain('`/it/spare-parts/${id}/movements');
  });

  it('priorities: list, create, update — archived, never deleted, because tickets point at them', () => {
    const routes = declared(PRIORITY_ROUTES);
    expect(routes).toEqual(new Set(['get /', 'post /', 'patch /:id']));
    expect([...routes].some((r) => r.startsWith('delete'))).toBe(false);
    expect(MANIFEST).toContain("prefix: '/it/ticket-priorities'");
    expect(CLIENT).toContain('/it/ticket-priorities');
  });
});

describe('the permissions the API enforces are the ones the UI gates on', () => {
  // Matches both `authorize('x')` and every key inside `authorizeAny('x', 'y')`.
  const enforced = (routes: string): Set<string> =>
    new Set(
      [...routes.matchAll(/authorize(?:Any)?\(([^)]*)\)/g)].flatMap((m) =>
        [...(m[1] ?? '').matchAll(/'([^']+)'/g)].flatMap((k) => (k[1] ? [k[1]] : [])),
      ),
    );

  it('assets', () => {
    expect(enforced(ASSET_ROUTES)).toEqual(
      new Set([
        'itAsset.view',
        'itAsset.create',
        'itAsset.edit',
        'itAsset.delete',
        'itAsset.assign',
        'itAsset.dispose',
      ]),
    );
  });

  // Design §7: ONE custody grant for assign + return + transfer — they are a single operational
  // surface — and disposal keeps its own, because writing an asset off is a different, terminal
  // decision. Pinned because collapsing them later would silently widen who can write assets off.
  it('custody: assign/return/transfer share a grant; dispose has its own', () => {
    for (const action of ['assign', 'return', 'transfer']) {
      const route =
        new RegExp(`router\\.post\\(\\s*'/:id/${action}'[\\s\\S]*?\\);`).exec(ASSET_ROUTES)?.[0] ?? '';
      expect(route, `${action} must ride itAsset.assign`).toContain("authorize('itAsset.assign')");
    }
    const dispose = /router\.post\(\s*'\/:id\/dispose'[\s\S]*?\);/.exec(ASSET_ROUTES)?.[0] ?? '';
    expect(dispose).toContain("authorize('itAsset.dispose')");
  });

  it('custody READS ride itAsset.view — history shows nothing the asset does not', () => {
    for (const path of ['history', 'assignments']) {
      const route =
        new RegExp(`router\\.get\\(\\s*'/:id/${path}'[\\s\\S]*?\\);`).exec(ASSET_ROUTES)?.[0] ?? '';
      expect(route).toContain("authorize('itAsset.view')");
    }
  });

  it('label printing rides itAsset.view — a label shows nothing view cannot (§4.2)', () => {
    const labels = /router\.post\(\s*'\/labels'[\s\S]*?\);/.exec(ASSET_ROUTES)?.[0] ?? '';
    expect(labels).toContain("authorize('itAsset.view')");
  });

  // Catalogs split their gates, and the split is load-bearing in BOTH directions. Reading serves
  // two callers: the asset form's category dropdown (`itAsset.view`) and the catalogs screen
  // itself (`itCatalog.manage`, design §7) — gating the read on the first alone locked the catalog
  // administrator out of the very list they manage. Writing stays `itCatalog.manage`. Pinned here
  // so a later tightening fails this test instead of silently emptying every dropdown in the
  // module, or re-breaking the admin.
  it('catalogs: read takes EITHER grant, writes need itCatalog.manage', () => {
    const list = /router\.get\(\s*'\/'[\s\S]*?\);/.exec(CATALOG_ROUTES)?.[0] ?? '';
    expect(list).toContain("authorizeAny('itAsset.view', 'itCatalog.manage')");
    for (const verb of ['post', 'patch']) {
      const write = new RegExp(`router\\.${verb}\\([\\s\\S]*?\\);`).exec(CATALOG_ROUTES)?.[0] ?? '';
      expect(write).toContain("authorize('itCatalog.manage')");
    }
  });

  it('vendors', () => {
    expect(enforced(VENDOR_ROUTES)).toEqual(new Set(['itVendor.view', 'itVendor.manage']));
    // Resolve-by-id takes the SAME gate as the list — it returns one row of what the list already
    // returns, so it must not become a quieter way in.
    const byId = /router\.get\(\s*'\/:id'[\s\S]*?\);/.exec(VENDOR_ROUTES)?.[0] ?? '';
    expect(byId).toContain("authorize('itVendor.view')");
  });

  // §7's help-desk split, pinned in both directions. `view/create/edit` is the ordinary trio;
  // `assign` and `close` are SEPARATE because deciding who does the work — and deciding a ticket
  // is finished — are different authorities from doing the work.
  it('tickets: five gates, and each transition rides the one the design gives it', () => {
    expect(enforced(TICKET_ROUTES)).toEqual(
      new Set([
        'itTicket.view',
        'itTicket.create',
        'itTicket.edit',
        'itTicket.assign',
        'itTicket.close',
      ]),
    );
    const route = (verb: string, path: string): string =>
      new RegExp(`router\\.${verb}\\(\\s*'${path.replace(/[/:]/g, '\\$&')}'[\\s\\S]*?\\);`).exec(
        TICKET_ROUTES,
      )?.[0] ?? '';
    expect(route('post', '/:id/assign')).toContain("authorize('itTicket.assign')");
    for (const path of ['/:id/status', '/:id/resolve']) {
      expect(route('post', path), `${path} must ride itTicket.edit`).toContain(
        "authorize('itTicket.edit')",
      );
    }
    for (const path of ['/:id/close', '/:id/reopen']) {
      expect(route('post', path), `${path} must ride itTicket.close`).toContain(
        "authorize('itTicket.close')",
      );
    }
  });

  // FR-14, and it is the one rule a reviewer would most likely "fix" by mistake. Cancelling your
  // OWN open ticket and commenting on your OWN ticket are not privileges, so neither route mints a
  // work grant — both ride `itTicket.view` and the ownership check lives in the service, where the
  // ticket is actually in hand. Pinned so tightening either gate fails here rather than silently
  // taking a requester's own ticket away from them.
  it('the requester’s own cancel and own comment ride view, never a work grant (FR-14)', () => {
    const cancel = /router\.post\(\s*'\/:id\/cancel'[\s\S]*?\);/.exec(TICKET_ROUTES)?.[0] ?? '';
    expect(cancel).toContain("authorize('itTicket.view')");
    expect(cancel).not.toContain('itTicket.close');
    const comment = /router\.post\(\s*'\/:id\/comments'[\s\S]*?\);/.exec(TICKET_ROUTES)?.[0] ?? '';
    expect(comment).toContain("authorize('itTicket.view')");
    expect(comment).not.toContain('itTicket.edit');
  });

  // Same shape, same reason, as the catalog read gate: the ticket form's priority dropdown must
  // populate for anyone who can open a ticket, while the settings screen is the admin's.
  it('priorities: read takes EITHER grant, writes need itSlaPolicy.manage', () => {
    const list = /router\.get\(\s*'\/'[\s\S]*?\);/.exec(PRIORITY_ROUTES)?.[0] ?? '';
    expect(list).toContain("authorizeAny('itTicket.view', 'itSlaPolicy.manage')");
    for (const verb of ['post', 'patch']) {
      const write = new RegExp(`router\\.${verb}\\([\\s\\S]*?\\);`).exec(PRIORITY_ROUTES)?.[0] ?? '';
      expect(write).toContain("authorize('itSlaPolicy.manage')");
    }
  });

  // §7's maintenance split. `edit` covers the planning fields AND starting the work; `complete`
  // covers BOTH ways an order ends. Pinned because collapsing `complete` into `edit` would let
  // anyone who can schedule a repair also consume stock, which is the whole point of the split.
  it('maintenance orders: four gates, each transition on the one the design gives it', () => {
    expect(enforced(ORDER_ROUTES)).toEqual(
      new Set([
        'itMaintenance.view',
        'itMaintenance.create',
        'itMaintenance.edit',
        'itMaintenance.complete',
      ]),
    );
    const route = (verb: string, path: string): string =>
      new RegExp(`router\\.${verb}\\(\\s*'${path.replace(/[/:]/g, '\\$&')}'[\\s\\S]*?\\);`).exec(
        ORDER_ROUTES,
      )?.[0] ?? '';
    expect(route('post', '/:id/start')).toContain("authorize('itMaintenance.edit')");
    for (const path of ['/:id/complete', '/:id/cancel']) {
      expect(route('post', path), `${path} must ride itMaintenance.complete`).toContain(
        "authorize('itMaintenance.complete')",
      );
    }
    expect(route('get', '/:id/parts')).toContain("authorize('itMaintenance.view')");
  });

  // A plan GENERATES work orders, so editing one changes what the module does on its own — the
  // `itSlaPolicy.manage` argument, applied to the other clock in this module. Reading rides the
  // ordinary maintenance view, because a schedule nobody can see is a schedule nobody can plan by.
  it('maintenance plans: read on itMaintenance.view, writes on itMaintenancePlan.manage', () => {
    expect(enforced(PLAN_ROUTES)).toEqual(
      new Set(['itMaintenance.view', 'itMaintenancePlan.manage']),
    );
    for (const path of ['/', '/:id']) {
      const read =
        new RegExp(`router\\.get\\(\\s*'${path.replace(/[/:]/g, '\\$&')}'[\\s\\S]*?\\);`).exec(
          PLAN_ROUTES,
        )?.[0] ?? '';
      expect(read).toContain("authorize('itMaintenance.view')");
    }
    for (const path of ['/:id/activate', '/:id/deactivate']) {
      const action =
        new RegExp(`router\\.post\\(\\s*'${path.replace(/[/:]/g, '\\$&')}'[\\s\\S]*?\\);`).exec(
          PLAN_ROUTES,
        )?.[0] ?? '';
      expect(action).toContain("authorize('itMaintenancePlan.manage')");
    }
  });

  // §7: the store grant covers the catalogue AND receipts. It must NOT reach a maintenance order,
  // which is the only path stock leaves by — so the storekeeper cannot issue their own parts.
  it('spare parts: two gates, and neither one is a maintenance grant', () => {
    expect(enforced(PART_ROUTES)).toEqual(new Set(['itSparePart.view', 'itSparePart.manage']));
    const receipt = /router\.post\(\s*'\/:id\/receipts'[\s\S]*?\);/.exec(PART_ROUTES)?.[0] ?? '';
    expect(receipt).toContain("authorize('itSparePart.manage')");
    const movements = /router\.get\(\s*'\/:id\/movements'[\s\S]*?\);/.exec(PART_ROUTES)?.[0] ?? '';
    expect(movements).toContain("authorize('itSparePart.view')");
  });

  it('declares every gate the manifest knows about, and no invented one', () => {
    const used = new Set([
      ...enforced(ASSET_ROUTES),
      ...enforced(CATALOG_ROUTES),
      ...enforced(VENDOR_ROUTES),
      ...enforced(TICKET_ROUTES),
      ...enforced(PRIORITY_ROUTES),
      ...enforced(ORDER_ROUTES),
      ...enforced(PLAN_ROUTES),
      ...enforced(PART_ROUTES),
    ]);
    for (const permission of used) {
      const [resource, action] = permission.split('.');
      expect(MANIFEST, `${permission} is not declared`).toContain(`'${resource}'`);
      expect(action).toBeDefined();
    }
  });
});

describe('the sort fields the tables offer are the ones the API accepts', () => {
  const sortable = (service: string): string[] => {
    const raw = /sortableFields:\s*\[([^\]]*)\]/.exec(service)?.[1] ?? '';
    return [...raw.matchAll(/'([^']+)'/g)].flatMap((m) => (m[1] ? [m[1]] : []));
  };

  // A `sortBy` the API does not declare does NOT error — `BaseRepository.list` falls back to
  // `createdAt` — so an undeclared sort header is worse than a broken one: it looks like it
  // worked and sorted by something else. These are the sortable columns the IT screens offer.
  it('assets list', () => {
    const allowed = sortable(ASSET_SERVICE);
    for (const field of ['assetCode', 'name', 'status']) expect(allowed).toContain(field);
  });

  it('catalogs list', () => {
    expect(sortable(CATALOG_SERVICE)).toContain('sortOrder');
  });

  it('vendors list', () => {
    expect(sortable(VENDOR_SERVICE)).toContain('name');
  });

  // The ticket queue's sortable headers, and the settings table's. Both were trimmed to exactly
  // what the repositories allow — `title` and the two SLA targets are deliberately NOT sortable
  // headers, because the API would silently sort by `createdAt` instead.
  it('tickets queue', () => {
    const allowed = sortable(TICKET_REPOSITORY);
    for (const field of ['createdAt', 'ticketCode', 'status', 'sla.resolutionDueAt']) {
      expect(allowed).toContain(field);
    }
    expect(allowed).not.toContain('title');
  });

  // The IT-4 tables. Same trap, same guard: `summary` and `kind` are deliberately NOT sortable
  // headers on the maintenance board, because the API would silently sort by `createdAt` instead.
  it('maintenance board', () => {
    const allowed = sortable(ORDER_REPOSITORY);
    for (const field of ['createdAt', 'orderCode', 'status', 'scheduledFor']) {
      expect(allowed).toContain(field);
    }
    expect(allowed).not.toContain('summary');
  });

  it('maintenance plans table', () => {
    const allowed = sortable(PLAN_REPOSITORY);
    for (const field of ['nextDueAt', 'name']) expect(allowed).toContain(field);
    expect(allowed).not.toContain('lastCompletedAt');
  });

  it('spare parts table', () => {
    const allowed = sortable(PART_REPOSITORY);
    for (const field of ['partCode', 'name', 'onHandQty']) expect(allowed).toContain(field);
  });

  it('priorities table', () => {
    const allowed = sortable(PRIORITY_REPOSITORY);
    expect(allowed).toContain('rank');
    expect(allowed).not.toContain('responseMinutes');
  });
});

describe('the client sends only filters the API declares', () => {
  const CONTRACTS = readFileSync(
    resolve(HERE, '../../../../../packages/contracts/src/modules/it.ts'),
    'utf8',
  );
  const filters = (schemaName: string): string => {
    const found = new RegExp(
      `${schemaName} = PaginationQuerySchema.extend\\(\\{([\\s\\S]*?)\\}\\)`,
    ).exec(CONTRACTS)?.[1];
    expect(found, `${schemaName} not found`).toBeDefined();
    return found ?? '';
  };

  it('assets: search, categoryId, status, branchId', () => {
    const schema = filters('ListItAssetsQuerySchema');
    for (const field of ['search', 'categoryId', 'status', 'branchId']) {
      expect(schema, `${field} is not a declared asset filter`).toContain(`${field}:`);
    }
  });

  // Every filter the queue's FilterBar and its three saved views send. `mine` and `breached` are
  // the two that matter most: `mine` is what makes the requester view a server answer rather than
  // a client-side guess (FR-8), and `breached` reads the STAMPS rather than recomputing a clock.
  it('tickets: the queue filters and the two saved views', () => {
    const schema = filters('ListItTicketsQuerySchema');
    for (const field of [
      'search',
      'status',
      'categoryId',
      'priorityId',
      'mine',
      'breached',
      'active',
    ]) {
      expect(schema, `${field} is not a declared ticket filter`).toContain(`${field}:`);
    }
  });
});

// ADR-019 rule 5, pinned at the seam rather than left to reviewer attention. The failure this
// guards is silent: a picker that loads a page of a growth catalog works perfectly until the
// catalog passes MAX_PAGE_SIZE, then quietly stops showing some records.
describe('growth catalogs are searched, never loaded', () => {
  /**
   * Strip comments before scanning. A doc comment that MENTIONS the forbidden pattern — as
   * `SparePartPicker` does, explaining what it replaced — is not the forbidden pattern, and a
   * scan that cannot tell the difference fails on prose while missing nothing real.
   */
  const code = (file: string): string =>
    readFileSync(resolve(HERE, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  const CLIENT_FILES = ['components/SparePartPicker.tsx', 'components/AssetPicker.tsx'].map(code);

  it('the API offers `search` on every catalog a picker reads', () => {
    for (const [name, source] of [
      ['spare parts', PART_REPOSITORY],
      ['assets', ASSET_SERVICE],
    ] as const) {
      expect(source, `${name} must accept a server-side search`).toContain('query.search');
    }
  });

  it('the pickers send it, and hold no catalog of their own', () => {
    for (const source of CLIENT_FILES) {
      expect(source).toContain('pageSize: PAGE_SIZE');
      expect(source, 'a picker must not load a page of the catalog').not.toContain('pageSize: 100');
    }
  });

  // The parts dialog is where the regression would land: it needs each part's on-hand level, and
  // loading the catalog to get it is exactly the shortcut ADR-019 forbids.
  it('the completion dialog picks parts rather than listing them', () => {
    const dialog = code('components/MaintenanceOrderDialogs.tsx');
    expect(dialog).toContain('SparePartPicker');
    expect(dialog).not.toContain('pageSize: 100');
    expect(dialog, 'the dialog must not hold the catalog to name a part').not.toContain(
      'useItSpareParts',
    );
  });
});
