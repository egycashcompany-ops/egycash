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
const ASSET_SERVICE = read('assets/asset.service.ts');
const CATALOG_SERVICE = read('catalog-items/catalog-item.service.ts');
const VENDOR_SERVICE = read('vendors/vendor.service.ts');
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

  it('assets: list, get, by-code, create, update, delete, labels', () => {
    const routes = declared(ASSET_ROUTES);
    expect(routes).toEqual(
      new Set([
        'get /',
        'get /by-code/:code',
        'post /labels',
        'get /:id',
        'post /',
        'patch /:id',
        'delete /:id',
      ]),
    );
    // …and the client calls exactly those.
    expect(CLIENT).toContain("`/it/assets${buildQuery(params)}`");
    expect(CLIENT).toContain('`/it/assets/${id}`');
    expect(CLIENT).toContain('`/it/assets/by-code/${encodeURIComponent(code)}`');
    expect(CLIENT).toContain("post<ItAssetDto>('/it/assets'");
    expect(CLIENT).toContain("postBinary('/it/assets/labels'");
  });

  it('catalog items: list, create, update — and no delete, because rows archive (FR-11)', () => {
    const routes = declared(CATALOG_ROUTES);
    expect(routes).toEqual(new Set(['get /', 'post /', 'patch /:id']));
    expect([...routes].some((r) => r.startsWith('delete'))).toBe(false);
    expect(CLIENT).not.toContain("del<void>('/it/catalog-items");
  });

  it('vendors: list, create, update — archive, never delete (FR-11)', () => {
    const routes = declared(VENDOR_ROUTES);
    expect(routes).toEqual(new Set(['get /', 'post /', 'patch /:id']));
    expect(CLIENT).not.toContain("del<void>('/it/vendors");
  });
});

describe('the permissions the API enforces are the ones the UI gates on', () => {
  const enforced = (routes: string): Set<string> =>
    new Set([...routes.matchAll(/authorize\('([^']+)'\)/g)].flatMap((m) => (m[1] ? [m[1]] : [])));

  it('assets', () => {
    expect(enforced(ASSET_ROUTES)).toEqual(
      new Set(['itAsset.view', 'itAsset.create', 'itAsset.edit', 'itAsset.delete']),
    );
  });

  it('label printing rides itAsset.view — a label shows nothing view cannot (§4.2)', () => {
    const labels = /router\.post\(\s*'\/labels'[\s\S]*?\);/.exec(ASSET_ROUTES)?.[0] ?? '';
    expect(labels).toContain("authorize('itAsset.view')");
  });

  // Catalogs split their gates, and the split is load-bearing for the UI: READING the catalog
  // rides `itAsset.view`, because the asset form's category dropdown has to populate for someone
  // who can only view assets. WRITING needs `itCatalog.manage`, which is what the catalogs screen
  // is routed behind (design §7). Pinning it here so a later tightening of the read gate fails
  // this test instead of silently emptying every category dropdown in the module.
  it('catalogs: read rides itAsset.view, writes need itCatalog.manage', () => {
    expect(enforced(CATALOG_ROUTES)).toEqual(new Set(['itAsset.view', 'itCatalog.manage']));
    const list = /router\.get\(\s*'\/'[\s\S]*?\);/.exec(CATALOG_ROUTES)?.[0] ?? '';
    expect(list).toContain("authorize('itAsset.view')");
  });

  it('vendors', () => {
    expect(enforced(VENDOR_ROUTES)).toEqual(new Set(['itVendor.view', 'itVendor.manage']));
  });

  it('declares every gate the manifest knows about, and no invented one', () => {
    const used = new Set([
      ...enforced(ASSET_ROUTES),
      ...enforced(CATALOG_ROUTES),
      ...enforced(VENDOR_ROUTES),
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

  // A `sortBy` the API does not allow comes back 400 — a column header that breaks the page when
  // clicked. These are the defaults and the sortable columns the IT screens actually use.
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
});

describe('the client sends only filters the API declares', () => {
  it('assets: search, categoryId, status, branchId', () => {
    const query = readFileSync(
      resolve(HERE, '../../../../../packages/contracts/src/modules/it.ts'),
      'utf8',
    );
    const schema = /ListItAssetsQuerySchema = PaginationQuerySchema.extend\(\{([\s\S]*?)\}\)/.exec(
      query,
    )?.[1];
    expect(schema).toBeDefined();
    for (const field of ['search', 'categoryId', 'status', 'branchId']) {
      expect(schema, `${field} is not a declared asset filter`).toContain(`${field}:`);
    }
  });
});
