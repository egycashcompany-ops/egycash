// The UI → API seam, checked against the API itself (IT's `it-api-contract.spec.ts` shape).
//
// The integration suites prove the API works and the screen specs prove the screens render; what
// neither proves is that the screens call the endpoints the API actually serves — a typo in a
// path, a wrong verb, or a sort field the API ignores all typecheck, lint and render perfectly, and
// fail only when a real reader clicks. So this reads the module's route files and services from
// `apps/api` and the module's client calls from here, and asserts they agree. Source-level on
// purpose: no database, no server, no network.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const API = resolve(HERE, '../../../../api/src/modules/administration');
const read = (path: string): string => readFileSync(resolve(API, path), 'utf8');
const client = (path: string): string => readFileSync(resolve(HERE, 'api', path), 'utf8');

const MANIFEST = read('administration.module.ts');
const CATALOG_CLIENT = client('catalog-api.ts');
const WAREHOUSE_CLIENT = client('warehouses-api.ts');
const PEOPLE_CLIENT = client('people-api.ts');

/** The verb + path pairs a router declares, e.g. `get /:id`. */
const declared = (routes: string): Set<string> => {
  const found = new Set<string>();
  for (const match of routes.matchAll(/router\.(get|post|patch|put|delete)\(\s*'([^']+)'/gu)) {
    found.add(`${match[1] as string} ${match[2] as string}`);
  }
  return found;
};

/** The fields a service's list sorts on (`sortableFields: [...]`). */
const sortable = (service: string): string[] => {
  const block = /sortableFields: \[([^\]]*)\]/u.exec(service)?.[1] ?? '';
  return [...block.matchAll(/'([^']+)'/gu)].map((m) => m[1] as string);
};

describe('every endpoint the module’s client calls exists on the API', () => {
  it('mounts the five routers the client targets', () => {
    for (const prefix of [
      '/administration/catalog-items',
      '/administration/item-categories',
      '/administration/items',
      '/administration/warehouses',
      '/administration/people',
    ]) {
      expect(MANIFEST, prefix).toContain(`prefix: '${prefix}'`);
    }
  });

  it('units: list, create, update — no delete — and the client calls exactly those', () => {
    expect(declared(read('catalog/catalog-items/catalog-item.routes.ts'))).toEqual(
      new Set(['get /', 'post /', 'patch /:id']),
    );
    expect(CATALOG_CLIENT).toContain(
      "`/administration/catalog-items${buildQuery({ ...params, kind: 'unit' })}`",
    );
    expect(CATALOG_CLIENT).toContain(
      "post<AdministrationCatalogItemDto>('/administration/catalog-items'",
    );
    expect(CATALOG_CLIENT).toContain(
      'patch<AdministrationCatalogItemDto>(`/administration/catalog-items/${id}`',
    );
  });

  it('item categories: list, create, update — no delete', () => {
    expect(declared(read('catalog/item-categories/item-category.routes.ts'))).toEqual(
      new Set(['get /', 'post /', 'patch /:id']),
    );
    expect(CATALOG_CLIENT).toContain('`/administration/item-categories${buildQuery(params)}`');
    expect(CATALOG_CLIENT).toContain(
      "post<AdministrationItemCategoryDto>('/administration/item-categories'",
    );
    expect(CATALOG_CLIENT).toContain(
      'patch<AdministrationItemCategoryDto>(`/administration/item-categories/${id}`',
    );
  });

  it('items: list, one, create, update — no delete', () => {
    expect(declared(read('catalog/items/item.routes.ts'))).toEqual(
      new Set(['get /', 'get /:id', 'post /', 'patch /:id']),
    );
    expect(CATALOG_CLIENT).toContain('`/administration/items${buildQuery(params)}`');
    expect(CATALOG_CLIENT).toContain('get<AdministrationItemDto>(`/administration/items/${id}`)');
    expect(CATALOG_CLIENT).toContain("post<AdministrationItemDto>('/administration/items'");
    expect(CATALOG_CLIENT).toContain('patch<AdministrationItemDto>(`/administration/items/${id}`');
  });

  it('warehouses: list, the branch options before `/:id`, one, create, update — no delete', () => {
    const routes = read('warehouses/warehouses/warehouse.routes.ts');
    expect(declared(routes)).toEqual(
      new Set(['get /', 'get /branch-options', 'get /:id', 'post /', 'patch /:id']),
    );
    // A literal segment registered after '/:id' would be swallowed by the id matcher — and 400.
    const registered = (path: string): number =>
      routes.search(new RegExp(`router\\.get\\(\\s*'${path}'`, 'u'));
    expect(registered('/branch-options')).toBeGreaterThan(-1);
    expect(registered('/branch-options')).toBeLessThan(registered('/:id'));
    expect(WAREHOUSE_CLIENT).toContain('`/administration/warehouses${buildQuery(params)}`');
    expect(WAREHOUSE_CLIENT).toContain("'/administration/warehouses/branch-options'");
    expect(WAREHOUSE_CLIENT).toContain(
      "post<AdministrationWarehouseDto>('/administration/warehouses'",
    );
    expect(WAREHOUSE_CLIENT).toContain(
      'patch<AdministrationWarehouseDto>(`/administration/warehouses/${id}`',
    );
    // One store, re-read after a stale save.
    expect(WAREHOUSE_CLIENT).toContain(
      'get<AdministrationWarehouseDto>(`/administration/warehouses/${id}`)',
    );
    // The department options are the platform's own reference read, not another module's — with
    // the retired units only to name the one a store already points at, as the platform's options
    // read takes it (`?includeInactive=true`).
    expect(WAREHOUSE_CLIENT).toContain(
      "`/platform/departments/options${includeInactive ? '?includeInactive=true' : ''}`",
    );
    const orgUnitHttp = readFileSync(
      resolve(HERE, '../../../../api/src/platform/organization/shared/org-unit.http.ts'),
      'utf8',
    );
    expect(orgUnitHttp).toContain("includeInactive: z.enum(['true', 'false']).optional()");
    expect(WAREHOUSE_CLIENT).not.toMatch(/modules\/(?!administration)/u);
  });

  it('people: the keeper picker’s search, read-only', () => {
    expect(declared(read('people/people.routes.ts'))).toEqual(
      new Set(['get /', 'get /:employeeId']),
    );
    expect(PEOPLE_CLIENT).toContain(
      '`/administration/people${buildQuery({ search, pageSize: PEOPLE_PICKER_ROWS })}`',
    );
  });

  it('calls no endpoint the API does not declare — no delete anywhere', () => {
    for (const source of [CATALOG_CLIENT, WAREHOUSE_CLIENT, PEOPLE_CLIENT]) {
      expect(source).not.toMatch(/\bdel</u);
    }
  });
});

describe('every sort a screen offers is one the API sorts on', () => {
  const page = (name: string): string => readFileSync(resolve(HERE, 'pages', name), 'utf8');

  it('items: the code and the Arabic name', () => {
    const fields = sortable(read('catalog/items/item.service.ts'));
    expect(fields).toEqual(expect.arrayContaining(['code', 'name.ar']));
    expect(page('ItemsPage.tsx')).toContain("sortKey: 'name.ar'");
  });

  it('warehouses: the code and the Arabic name', () => {
    expect(sortable(read('warehouses/warehouses/warehouse.service.ts'))).toEqual(
      expect.arrayContaining(['code', 'name.ar']),
    );
    expect(page('WarehousesPage.tsx')).toContain("sortKey: 'name.ar'");
  });

  it('units and categories: the sort order and the Arabic name — and the selects’ whole read too', () => {
    for (const service of [
      'catalog/catalog-items/catalog-item.service.ts',
      'catalog/item-categories/item-category.service.ts',
    ]) {
      expect(sortable(read(service)), service).toEqual(
        expect.arrayContaining(['sortOrder', 'name.ar']),
      );
    }
    const catalogs = page('CatalogsPage.tsx');
    expect(catalogs).toContain("key: 'sortOrder',");
    expect(catalogs).toContain("key: 'name.ar',");
    expect(CATALOG_CLIENT).toContain("sortBy: 'sortOrder'");
  });
});
