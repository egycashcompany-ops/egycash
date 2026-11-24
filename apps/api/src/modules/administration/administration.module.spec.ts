// The manifest guards (the atm.module.spec and operations.module.spec precedent): the module
// registers cleanly, and its surface is exactly what the shipped slices claim. The pin-the-numbers
// block moves with every slice of design §19.1 — P1a.1: one key, one page, two routes, two
// collections, the units and the item categories; P1a.2: the items' three keys and page, their
// route, their collection and the counter's, their topic and the five bundles their key opens.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { platformSatisfies, validateManifest } from '../../platform/kernel/module-registry';
import { REALTIME_TOPICS } from '../../platform/realtime';
import { ADMINISTRATION_ROLE_BUNDLES } from './administration-roles';
import {
  administrationModule,
  administrationPages,
  administrationPermissions,
} from './administration.module';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (relative: string): string => readFileSync(join(HERE, relative), 'utf8');

describe('administration module manifest (Administrative Affairs, P1a.2)', () => {
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
    ]);
    expect(administrationPages.map((p) => p.id)).toEqual([
      'administration.items',
      'administration.catalogs',
    ]);
    expect(administrationModule.routes.map((r) => r.prefix).sort()).toEqual([
      '/administration/catalog-items',
      '/administration/item-categories',
      '/administration/items',
    ]);
    expect([...administrationModule.collections].sort()).toEqual([
      'administration_catalog_items',
      'administration_counters',
      'administration_item_categories',
      'administration_items',
    ]);
    expect(administrationModule.eventSubscriptions).toEqual([]);
    expect(administrationModule.scheduledTasks ?? []).toEqual([]);
    expect(administrationModule.jobHandlers ?? []).toEqual([]);
    expect(administrationModule.fileEntityAuthorizers ?? []).toEqual([]);
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

  it('gives each bundle §6.5’s P1a keys, as far as they have shipped', () => {
    expect(bundle('administration-storekeeper')?.permissionKeys).toEqual([
      'administrationItem.view',
    ]);
    expect(bundle('administration-procurement-officer')?.permissionKeys).toEqual([
      'administrationItem.view',
    ]);
    expect(bundle('administration-master-data')?.permissionKeys).toEqual([
      'administrationItem.view',
      'administrationItem.create',
      'administrationItem.edit',
      'administrationCatalog.manage',
    ]);
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

  it('titles each bundle in both languages, with §6.5’s candidate titles (OD-67 A)', () => {
    expect(Object.fromEntries(ADMINISTRATION_ROLE_BUNDLES.map((b) => [b.key, b.name]))).toEqual({
      'administration-storekeeper': { en: 'Storekeeper', ar: 'أمين المخزن' },
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
  it('classifies items, and moves units and categories to the item key — the wider of their reads', () => {
    for (const topic of [
      'administration.item',
      'administration.catalogItem',
      'administration.itemCategory',
    ]) {
      expect(REALTIME_TOPICS[topic], topic).toEqual({ permission: 'administrationItem.view' });
    }
  });

  it('names no other topic of this module yet', () => {
    expect(
      Object.keys(REALTIME_TOPICS)
        .filter((topic) => topic.startsWith('administration.'))
        .sort(),
    ).toEqual(['administration.catalogItem', 'administration.item', 'administration.itemCategory']);
  });
});

describe('the catalog reads (§19.3)', () => {
  it.each([
    'catalog/catalog-items/catalog-item.routes.ts',
    'catalog/item-categories/item-category.routes.ts',
  ])('%s reads under the item key or the catalog key, and writes under the catalog key', (file) => {
    const source = read(file);
    const [list, ...writes] = [
      ...source.matchAll(/router\.(get|post|patch)\([\s\S]*?\n {2}\);/g),
    ].map((m) => m[0]);
    expect(list).toContain(
      "authorizeAny('administrationItem.view', 'administrationCatalog.manage')",
    );
    expect(writes.length).toBe(2);
    for (const write of writes)
      expect(write).toContain("authorize('administrationCatalog.manage')");
  });
});
