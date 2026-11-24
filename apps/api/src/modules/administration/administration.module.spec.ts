// The manifest guards (the atm.module.spec and operations.module.spec precedent): the module
// registers cleanly, and its surface is exactly what the shipped slices claim. The pin-the-numbers
// block moves with every slice of design §19.1 — P1a.1: one key, one page, two routes, two
// collections; the units and the item categories.
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

describe('administration module manifest (Administrative Affairs, P1a.1)', () => {
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
    ]);
    expect(administrationPages.map((p) => p.id)).toEqual(['administration.catalogs']);
    expect(administrationModule.routes.map((r) => r.prefix).sort()).toEqual([
      '/administration/catalog-items',
      '/administration/item-categories',
    ]);
    expect([...administrationModule.collections].sort()).toEqual([
      'administration_catalog_items',
      'administration_item_categories',
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

  it('seeds the master-data administrator with the catalog key, and nothing empty', () => {
    expect(ADMINISTRATION_ROLE_BUNDLES.map((bundle) => bundle.key)).toEqual([
      'administration-master-data',
    ]);
    for (const bundle of ADMINISTRATION_ROLE_BUNDLES) {
      expect(bundle.permissionKeys.length, bundle.key).toBeGreaterThan(0);
      for (const key of bundle.permissionKeys) expect(declared.has(key), key).toBe(true);
    }
  });

  it('titles each bundle in both languages', () => {
    expect(ADMINISTRATION_ROLE_BUNDLES[0]?.name).toEqual({
      en: 'Master-data administrator',
      ar: 'مسؤول البيانات الأساسية',
    });
  });

  it('seeds them as managed roles, never system roles — no second factor forced on holders', () => {
    const seed = read('administration.seed.ts');
    expect(seed).toContain('rbacService.ensureManagedRole(');
    expect(seed).not.toContain('ensureSystemRole');
  });
});

describe('the realtime topics of P1a.1 (§19.6)', () => {
  it('classifies units and categories on the catalog key until the item keys ship', () => {
    expect(REALTIME_TOPICS['administration.catalogItem']).toEqual({
      permission: 'administrationCatalog.manage',
    });
    expect(REALTIME_TOPICS['administration.itemCategory']).toEqual({
      permission: 'administrationCatalog.manage',
    });
  });
});
