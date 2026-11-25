import { describe, expect, it } from 'vitest';
import { validatePageRegistry } from '@ecms/contracts';
import { validateManifest } from '../../platform/kernel/module-registry';
import { complianceModule, compliancePages, compliancePermissions } from './compliance.module';
import { complianceModels } from './compliance-indexes';
import { COMPLIANCE_ROLE_BUNDLES } from './compliance-roles';

describe('the Compliance and Risks manifest', () => {
  it('passes the kernel’s checks', () => {
    expect(() => validateManifest(complianceModule)).not.toThrow();
  });

  it('declares the two keys of its one page', () => {
    expect(compliancePermissions.map((p) => [p.key, p.pageId])).toEqual([
      ['complianceFile.view', 'compliance.files'],
      ['complianceFile.manage', 'compliance.files'],
    ]);
    expect(compliancePages.map((page) => page.route)).toEqual(['/compliance/files']);
    expect(validatePageRegistry(compliancePages, compliancePermissions)).toEqual([]);
  });

  it('owns a collection for every model, and a model for every collection', () => {
    expect(complianceModels.map((model) => model.collection.collectionName).sort()).toEqual(
      [...complianceModule.collections].sort(),
    );
  });

  it('guards its files and seeds roles of its own keys only', () => {
    expect(complianceModule.fileEntityAuthorizers?.map((a) => a.entityType)).toEqual(['folder']);
    const keys = new Set(compliancePermissions.map((p) => p.key));
    for (const bundle of COMPLIANCE_ROLE_BUNDLES) {
      for (const key of bundle.permissionKeys) expect(keys.has(key), key).toBe(true);
    }
  });
});
