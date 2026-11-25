// The manifest guards (the atm.module.spec and operations.module.spec precedent): the module
// registers cleanly, and its surface is exactly what the shipped slices claim. The pin-the-numbers
// block moves with every slice of design §19.1 — P1a.1: one key, one page, two routes, two
// collections, the units and the item categories; P1a.2: the items' three keys and page, their
// route, their collection and the counter's, their topic and the five bundles their key opens;
// P1a.3: the warehouses' three keys and page, their route and the people's, their collection,
// their topic, and the warehouse keys in the six bundles §6.5 gives them; P1b.1: the suppliers'
// three keys and page, their route and collection, their topic, their papers' authorizer, and the
// supplier keys each bundle gains; P2.2: the purchase requests' four keys and page, their route and
// collection, their topic, the department requester's bundle and the request keys four others gain
// (P2 plan §9), and the item reads opened to the request's create key.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { platformSatisfies, validateManifest } from '../../platform/kernel/module-registry';
import { REALTIME_TOPICS } from '../../platform/realtime';
import { supplierFileAuthorizer } from './procurement/suppliers';
import { ADMINISTRATION_ROLE_BUNDLES } from './administration-roles';
import {
  administrationModule,
  administrationPages,
  administrationPermissions,
} from './administration.module';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (relative: string): string => readFileSync(join(HERE, relative), 'utf8');

describe('administration module manifest (Administrative Affairs, P2.2)', () => {
  it('passes kernel manifest validation', () => {
    expect(() => {
      validateManifest(administrationModule);
    }).not.toThrow();
  });

  it('targets a platform version this kernel satisfies', () => {
    expect(platformSatisfies(administrationModule.requiresPlatform)).toBe(true);
  });

  it('pins the current surface', () => {
    expect(administrationModule.id).toBe('administration');
    expect(administrationModule.version).toBe('0.1.0');
    expect(administrationPermissions.map((p) => p.key).sort()).toEqual([
      'administrationCatalog.manage',
      'administrationItem.create',
      'administrationItem.edit',
      'administrationItem.view',
      'administrationPurchaseRequest.approve',
      'administrationPurchaseRequest.create',
      'administrationPurchaseRequest.edit',
      'administrationPurchaseRequest.view',
      'administrationSupplier.create',
      'administrationSupplier.edit',
      'administrationSupplier.view',
      'administrationWarehouse.create',
      'administrationWarehouse.edit',
      'administrationWarehouse.view',
    ]);
    // §6.3's order: the warehouses first (10), then the items (20), the catalogs (30), the
    // suppliers (40) and the purchase requests (50).
    expect(administrationPages.map((p) => p.id)).toEqual([
      'administration.warehouses',
      'administration.items',
      'administration.catalogs',
      'administration.suppliers',
      'administration.purchase-requests',
    ]);
    expect(administrationPages.map((p) => p.sortOrder)).toEqual([10, 20, 30, 40, 50]);
    expect(administrationModule.routes.map((r) => r.prefix).sort()).toEqual([
      '/administration/catalog-items',
      '/administration/item-categories',
      '/administration/items',
      '/administration/people',
      '/administration/purchase-requests',
      '/administration/suppliers',
      '/administration/warehouses',
    ]);
    expect([...administrationModule.collections].sort()).toEqual([
      'administration_catalog_items',
      'administration_counters',
      'administration_item_categories',
      'administration_items',
      'administration_purchase_requests',
      'administration_suppliers',
      'administration_warehouses',
    ]);
    expect(administrationModule.eventSubscriptions).toEqual([]);
    expect(administrationModule.scheduledTasks ?? []).toEqual([]);
    expect(administrationModule.jobHandlers ?? []).toEqual([]);
  });

  it('claims exactly one file entity, the supplier, for its papers (OD-11 A, §11.3)', () => {
    expect(administrationModule.fileEntityAuthorizers).toEqual([supplierFileAuthorizer]);
    expect(supplierFileAuthorizer.entityType).toBe('supplier');
    // Not opted into the separate delete intent: a removal is asked as a write (§11.3).
    expect(supplierFileAuthorizer.understandsDelete).toBeUndefined();
  });

  it('labels the supplier keys in formal Arabic, the resource genitive after its verbal noun', () => {
    const names = Object.fromEntries(
      administrationPermissions
        .filter((p) => p.resource === 'administrationSupplier')
        .map((p) => [p.key, p.name]),
    );
    expect(names).toEqual({
      'administrationSupplier.view': { en: 'View Suppliers', ar: 'عرض الموردين' },
      'administrationSupplier.create': { en: 'Create Suppliers', ar: 'إنشاء الموردين' },
      'administrationSupplier.edit': { en: 'Edit Suppliers', ar: 'تعديل الموردين' },
    });
  });

  it('names the supplier page as §6.3 does, after the catalogs', () => {
    expect(administrationPages.find((p) => p.id === 'administration.suppliers')).toEqual({
      id: 'administration.suppliers',
      moduleId: 'administration',
      name: { en: 'Suppliers', ar: 'الموردون' },
      route: '/administration/suppliers',
      sortOrder: 40,
    });
  });

  it('names the purchase-request keys and page as P2 plan §9.1 does, after the suppliers', () => {
    expect(administrationPages.find((p) => p.id === 'administration.purchase-requests')).toEqual({
      id: 'administration.purchase-requests',
      moduleId: 'administration',
      name: { en: 'Purchase requests', ar: 'طلبات الشراء' },
      route: '/administration/purchase-requests',
      sortOrder: 50,
    });
    const names = Object.fromEntries(
      administrationPermissions
        .filter((p) => p.resource === 'administrationPurchaseRequest')
        .map((p) => [p.key, p.name]),
    );
    expect(names).toEqual({
      'administrationPurchaseRequest.view': {
        en: 'View Purchase requests',
        ar: 'عرض طلبات الشراء',
      },
      'administrationPurchaseRequest.create': {
        en: 'Create Purchase requests',
        ar: 'إنشاء طلبات الشراء',
      },
      'administrationPurchaseRequest.edit': {
        en: 'Edit Purchase requests',
        ar: 'تعديل طلبات الشراء',
      },
      'administrationPurchaseRequest.approve': {
        en: 'Approve Purchase requests',
        ar: 'اعتماد طلبات الشراء',
      },
    });
  });

  it('is named as the owner names the department (OD-62 A) — never plain “Administration”', () => {
    // The navigation seed finds a category by its English name, and «إدارة النظام» already owns
    // "Administration" (design §19.5).
    expect(administrationModule.name).toEqual({
      en: 'Administrative Affairs',
      ar: 'الشئون الإدارية',
    });
  });

  it('puts every key on a page of its own module, and every page has a key', () => {
    const pages = new Set(administrationPages.map((page) => page.id));
    for (const permission of administrationPermissions) {
      expect(permission.moduleId, permission.key).toBe('administration');
      expect(pages.has(permission.pageId ?? ''), permission.key).toBe(true);
    }
    const used = new Set(administrationPermissions.map((p) => p.pageId));
    for (const page of administrationPages) expect(used.has(page.id), page.id).toBe(true);
  });

  it('names no permission with a parenthesis — the CI page-registry parser counts them', () => {
    for (const permission of administrationPermissions) {
      expect(`${permission.name.en}${permission.name.ar}`).not.toMatch(/[()]/);
    }
  });

  it('is registered with every other module, behind no environment gate (D-19)', () => {
    // Read as source: importing the registry would pull every other module into this one's specs.
    const index = read('../index.ts');
    expect(index).toContain(
      "import { administrationModule } from './administration/administration.module';",
    );
    expect(index).toMatch(/\n {2}administrationModule,\n/);
    expect(index).not.toMatch(/\?\s*\[administrationModule\]/);
  });
});

describe('the ready-made roles (OD-78 A, D-20)', () => {
  const declared = new Set(administrationPermissions.map((p) => p.key));
  const bundle = (key: string) => ADMINISTRATION_ROLE_BUNDLES.find((b) => b.key === key);
  const viewKeys = administrationPermissions
    .filter((p) => p.key.endsWith('.view'))
    .map((p) => p.key);

  it('seeds every bundle that holds a key so far, in §6.5’s order, and nothing empty', () => {
    expect(ADMINISTRATION_ROLE_BUNDLES.map((b) => b.key)).toEqual([
      'administration-storekeeper',
      'administration-department-requester',
      'administration-procurement-officer',
      'administration-procurement-manager',
      'administration-affairs-manager',
      'administration-master-data',
      'administration-auditor',
    ]);
    for (const b of ADMINISTRATION_ROLE_BUNDLES) {
      expect(b.permissionKeys.length, b.key).toBeGreaterThan(0);
      for (const key of b.permissionKeys) expect(declared.has(key), key).toBe(true);
      expect(new Set(b.permissionKeys).size, `${b.key} names a key once`).toBe(
        b.permissionKeys.length,
      );
    }
  });

  it('gives each bundle §6.5’s P1a and P1b keys, as far as they have shipped', () => {
    expect(bundle('administration-storekeeper')?.permissionKeys).toEqual([
      'administrationWarehouse.view',
      'administrationItem.view',
      'administrationSupplier.view',
    ]);
    // OD-04 A keeps the supplier writes central: the officer reads the register, never writes it.
    expect(bundle('administration-procurement-officer')?.permissionKeys).toEqual([
      'administrationItem.view',
      'administrationWarehouse.view',
      'administrationSupplier.view',
      'administrationPurchaseRequest.view',
    ]);
    expect(bundle('administration-master-data')?.permissionKeys).toEqual([
      'administrationWarehouse.view',
      'administrationWarehouse.create',
      'administrationWarehouse.edit',
      'administrationItem.view',
      'administrationItem.create',
      'administrationItem.edit',
      'administrationCatalog.manage',
      'administrationSupplier.view',
      'administrationSupplier.create',
      'administrationSupplier.edit',
    ]);
  });

  it('gives a department’s focal point the request’s three draft keys, and nothing else (OD-16 A, P2.2)', () => {
    expect(bundle('administration-department-requester')?.permissionKeys).toEqual([
      'administrationPurchaseRequest.view',
      'administrationPurchaseRequest.create',
      'administrationPurchaseRequest.edit',
    ]);
  });

  it('raises a request in no other bundle, and approves one in the Administrative Affairs manager’s alone (§9.3)', () => {
    const holders = (key: string) =>
      ADMINISTRATION_ROLE_BUNDLES.filter((b) => b.permissionKeys.includes(key)).map((b) => b.key);
    expect(holders('administrationPurchaseRequest.create')).toEqual([
      'administration-department-requester',
    ]);
    expect(holders('administrationPurchaseRequest.edit')).toEqual([
      'administration-department-requester',
    ]);
    expect(holders('administrationPurchaseRequest.approve')).toEqual([
      'administration-affairs-manager',
    ]);
    expect(holders('administrationPurchaseRequest.view')).toEqual([
      'administration-department-requester',
      'administration-procurement-officer',
      'administration-procurement-manager',
      'administration-affairs-manager',
      'administration-auditor',
    ]);
  });

  it('gives the warehouse writes to the master-data administrator alone (§6.5)', () => {
    const writers = ADMINISTRATION_ROLE_BUNDLES.filter((b) =>
      b.permissionKeys.some(
        (key) => key === 'administrationWarehouse.create' || key === 'administrationWarehouse.edit',
      ),
    ).map((b) => b.key);
    expect(writers).toEqual(['administration-master-data']);
  });

  it('no bundle but the master-data desk writes a supplier (OD-04 A)', () => {
    const writers = ADMINISTRATION_ROLE_BUNDLES.filter((b) =>
      b.permissionKeys.some((k) => k.startsWith('administrationSupplier.') && !k.endsWith('.view')),
    ).map((b) => b.key);
    expect(writers).toEqual(['administration-master-data']);
  });

  it('the procurement manager holds every key of the officer’s', () => {
    const manager = new Set(bundle('administration-procurement-manager')?.permissionKeys);
    for (const key of bundle('administration-procurement-officer')?.permissionKeys ?? []) {
      expect(manager.has(key), key).toBe(true);
    }
  });

  it('the Administrative Affairs manager and the auditor hold every view key that has shipped', () => {
    // A view key shipped without them fails here — "every view key as it ships" (§6.5).
    for (const key of ['administration-affairs-manager', 'administration-auditor']) {
      expect([...(bundle(key)?.permissionKeys ?? [])].sort(), key).toEqual(
        expect.arrayContaining(viewKeys),
      );
    }
    expect(bundle('administration-auditor')?.permissionKeys.every((k) => k.endsWith('.view'))).toBe(
      true,
    );
  });

  it('the Administrative Affairs manager holds every approve key that has shipped (§6.5)', () => {
    const approveKeys = administrationPermissions
      .filter((p) => p.key.endsWith('.approve'))
      .map((p) => p.key);
    expect(approveKeys.length, 'an approve key has shipped').toBeGreaterThan(0);
    expect(bundle('administration-affairs-manager')?.permissionKeys).toEqual(
      expect.arrayContaining(approveKeys),
    );
  });

  it('titles each bundle in both languages, with §6.5’s candidate titles (OD-67 A)', () => {
    expect(Object.fromEntries(ADMINISTRATION_ROLE_BUNDLES.map((b) => [b.key, b.name]))).toEqual({
      'administration-storekeeper': { en: 'Storekeeper', ar: 'أمين المخزن' },
      'administration-department-requester': {
        en: 'Department requester',
        ar: 'منسق طلبات الإدارة',
      },
      'administration-procurement-officer': { en: 'Procurement officer', ar: 'موظف المشتريات' },
      'administration-procurement-manager': { en: 'Procurement manager', ar: 'مدير المشتريات' },
      'administration-affairs-manager': {
        en: 'Administrative Affairs manager',
        ar: 'مدير الشئون الإدارية',
      },
      'administration-master-data': {
        en: 'Master-data administrator',
        ar: 'مسؤول البيانات الأساسية',
      },
      'administration-auditor': { en: 'Internal auditor', ar: 'المراجع الداخلي' },
    });
  });

  it('seeds them as managed roles, never system roles — no second factor forced on holders', () => {
    const seed = read('administration.seed.ts');
    expect(seed).toContain('rbacService.ensureManagedRole(');
    expect(seed).not.toContain('ensureSystemRole');
  });
});

describe('the realtime topics (§19.6)', () => {
  it('classifies warehouses on their view key — a branch record, signalled with its branch', () => {
    expect(REALTIME_TOPICS['administration.warehouse']).toEqual({
      permission: 'administrationWarehouse.view',
    });
  });

  it('classifies suppliers on their own view key (P1b.1, §9.2)', () => {
    expect(REALTIME_TOPICS['administration.supplier']).toEqual({
      permission: 'administrationSupplier.view',
    });
  });

  it('classifies items, and moves units and categories to the item key — the wider of their reads', () => {
    for (const topic of [
      'administration.item',
      'administration.catalogItem',
      'administration.itemCategory',
    ]) {
      expect(REALTIME_TOPICS[topic], topic).toEqual({ permission: 'administrationItem.view' });
    }
  });

  it('classifies purchase requests on their view key — a branch record, signalled with its branch (P2.2)', () => {
    expect(REALTIME_TOPICS['administration.purchaseRequest']).toEqual({
      permission: 'administrationPurchaseRequest.view',
    });
  });

  it('names no other topic of this module yet', () => {
    expect(
      Object.keys(REALTIME_TOPICS)
        .filter((topic) => topic.startsWith('administration.'))
        .sort(),
    ).toEqual([
      'administration.catalogItem',
      'administration.item',
      'administration.itemCategory',
      'administration.purchaseRequest',
      'administration.supplier',
      'administration.warehouse',
    ]);
  });
});

describe('the catalog reads (§19.3)', () => {
  const routesOf = (file: string): string[] =>
    [...read(file).matchAll(/router\.(get|post|patch)\([\s\S]*?\n {2}\);/g)].map((m) => m[0]);
  const gateOf = (route: string): string =>
    (/authorizeAny\(([\s\S]*?)\)/.exec(route)?.[1] ?? '').replace(/\s+/g, ' ').trim();

  it.each([
    [
      'catalog/catalog-items/catalog-item.routes.ts',
      "'administrationItem.view', 'administrationCatalog.manage'",
    ],
    [
      // A supplier editor picks the categories a supplier supplies (P1b.1); no supplier key reads
      // the units, which no supplier names.
      'catalog/item-categories/item-category.routes.ts',
      "'administrationItem.view', 'administrationCatalog.manage', 'administrationSupplier.create', 'administrationSupplier.edit',",
    ],
  ])('%s reads under its keys, and writes under the catalog key alone', (file, gate) => {
    const [list, ...writes] = routesOf(file);
    expect(gateOf(list ?? '')).toBe(gate);
    expect(writes.length).toBe(2);
    for (const write of writes)
      expect(write).toContain("authorize('administrationCatalog.manage')");
  });
});

describe('the item reads open to whoever picks a request’s items (P2.2; design §13.6 D)', () => {
  const source = read('catalog/items/item.routes.ts');

  it('reads the register and one item under the item key or the request’s create key', () => {
    expect(source).toMatch(
      /const ITEM_READ_KEYS = \['administrationItem\.view', 'administrationPurchaseRequest\.create'\] as const;/,
    );
    const reads = [...source.matchAll(/router\.get\(\s*'([^']+)',([\s\S]*?)\n {2}\);/g)];
    expect(reads.map((m) => m[1])).toEqual(['/', '/:id']);
    for (const read of reads) expect(read[2]).toContain('authorizeAny(...ITEM_READ_KEYS)');
  });

  it('writes under the item keys alone', () => {
    expect(source).toContain("authorize('administrationItem.create')");
    expect(source).toContain("authorize('administrationItem.edit')");
    expect(source.match(/ITEM_READ_KEYS/g)).toHaveLength(3);
  });
});

describe('the purchase-request routes (P2 plan §4.1)', () => {
  const source = read('procurement/purchase-requests/purchase-request.routes.ts');
  const routes = [
    ...source.matchAll(/router\.(get|post|patch|delete)\(\s*'([^']+)',[\s\S]*?\n {2}\);/g),
  ].map((m) => ({ method: m[1] ?? '', path: m[2] ?? '', body: m[0] }));
  const gate = (route: { body: string }): string =>
    (/authorize(?:Any)?\(([^)]*)\)/.exec(route.body)?.[1] ?? '').replace(/\s+/g, ' ').trim();

  it('serves P2.2’s four routes: the register, the record, the create and a draft’s edit', () => {
    expect(routes.map((r) => `${r.method.toUpperCase()} ${r.path} ${gate(r)}`)).toEqual([
      "GET / 'administrationPurchaseRequest.view'",
      "GET /:id 'administrationPurchaseRequest.view', 'administrationPurchaseRequest.approve'",
      "POST / 'administrationPurchaseRequest.create'",
      "PATCH /:id 'administrationPurchaseRequest.edit'",
    ]);
  });

  it('validates every :param route’s params, and deletes no request', () => {
    for (const route of routes.filter((r) => r.path.includes(':'))) {
      expect(route.body, `${route.method} ${route.path}`).toMatch(/params: \w+ParamSchema/);
    }
    expect(routes.some((r) => r.method === 'delete')).toBe(false);
  });

  it('registers the request’s line lock with the items as its index loads (§6.2)', () => {
    expect(read('procurement/purchase-requests/index.ts')).toContain(
      "import './purchase-request-item-lock';",
    );
    expect(read('procurement/purchase-requests/purchase-request-item-lock.ts')).toMatch(
      /registerItemReferenceChecker\(async \(itemId\) =>\s*\(await repository\.namesItem\(itemId\)\) \? 'purchaseRequestLine' : null,/,
    );
  });
});

describe('the warehouse routes (§19.3)', () => {
  const source = read('warehouses/warehouses/warehouse.routes.ts');
  const routes = [
    ...source.matchAll(/router\.(get|post|patch)\(\s*'([^']*)'([\s\S]*?)\n {2}\);/g),
  ].map((m) => ({ method: m[1], path: m[2], body: m[3] ?? '' }));

  it('reads under the view key, creates under the create key and edits under the edit key', () => {
    expect(routes.map((r) => `${r.method ?? ''} ${r.path ?? ''}`)).toEqual([
      'get /',
      'get /branch-options',
      'get /:id',
      'post /',
      'patch /:id',
    ]);
    const gate = (method: string, path: string) =>
      routes.find((r) => r.method === method && r.path === path)?.body ?? '';
    for (const path of ['/', '/branch-options', '/:id']) {
      expect(gate('get', path), path).toContain("authorize('administrationWarehouse.view')");
    }
    expect(gate('post', '/')).toContain("authorize('administrationWarehouse.create')");
    expect(gate('patch', '/:id')).toContain("authorize('administrationWarehouse.edit')");
  });

  it('declares the branch options before `/:id`, so the segment is never read as an id', () => {
    const at = (path: string) => routes.findIndex((r) => r.method === 'get' && r.path === path);
    expect(at('/branch-options')).toBeGreaterThanOrEqual(0);
    expect(at('/branch-options')).toBeLessThan(at('/:id'));
  });

  it('opens the keeper picker to the warehouse writers only (§7.8)', () => {
    const people = read('people/people.service.ts');
    expect(people).toMatch(
      /ADMINISTRATION_PEOPLE_GRANTS[^=]*=\s*\[\s*'administrationWarehouse\.create',\s*'administrationWarehouse\.edit',\s*\]/,
    );
    const peopleRoutes = read('people/people.routes.ts');
    expect(peopleRoutes.match(/authorizeAny\(\.\.\.ADMINISTRATION_PEOPLE_GRANTS\)/g)).toHaveLength(
      2,
    );
    expect(peopleRoutes).not.toMatch(/router\.(post|patch|put|delete)\(/);
  });

  it('keeps the warehouse keys off the organization-only list — a warehouse is a branch record (§6.7)', () => {
    expect(read('shared/org-authority.ts')).not.toContain('administrationWarehouse');
  });
});

describe('the supplier routes (§19.3)', () => {
  const source = read('procurement/suppliers/supplier.routes.ts');
  const routes = [
    ...source.matchAll(/router\.(get|post|patch|delete)\(\s*'([^']+)',[\s\S]*?\n {2}\);/g),
  ].map((m) => ({ method: m[1] ?? '', path: m[2] ?? '', body: m[0] }));
  const gate = (route: { body: string }): string =>
    /authorize\('([^']+)'\)/.exec(route.body)?.[1] ?? '';

  it('serves the seven routes §19.3 lists, papers included, and no supplier delete', () => {
    expect(routes.map((r) => `${r.method.toUpperCase()} ${r.path} ${gate(r)}`)).toEqual([
      'GET / administrationSupplier.view',
      'GET /:id administrationSupplier.view',
      'POST / administrationSupplier.create',
      'PATCH /:id administrationSupplier.edit',
      'POST /:id/attachments administrationSupplier.edit',
      'GET /:id/attachments/:attachmentId administrationSupplier.view',
      'DELETE /:id/attachments/:attachmentId administrationSupplier.edit',
    ]);
  });

  it('validates every :param route’s params', () => {
    for (const route of routes.filter((r) => r.path.includes(':'))) {
      expect(route.body, `${route.method} ${route.path}`).toMatch(/params: \w+ParamSchema/);
    }
  });
});
