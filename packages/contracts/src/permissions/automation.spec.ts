// Automation permissions (A-2).
//
// The interesting failures for a permission catalog are structural, not semantic: a key that
// collides with another module's, a key the registry pattern rejects, or a grant that quietly
// means more than its name suggests. All three are silent in production and cheap to test here.
import { describe, expect, it } from 'vitest';
import { automationPermissions } from './automation.js';
import { PERMISSION_KEY_PATTERN } from './def.js';
import { platformPermissions } from './platform.js';

const keys = automationPermissions.map((p) => p.key);

describe('the catalog', () => {
  it('declares every resource the design specifies', () => {
    const byResource = new Map<string, string[]>();
    for (const permission of automationPermissions) {
      byResource.set(permission.resource, [
        ...(byResource.get(permission.resource) ?? []),
        permission.action,
      ]);
    }

    expect([...byResource.keys()].sort()).toEqual([
      'automation',
      'credential',
      'execution',
      'template',
      'variable',
      'workflow',
    ]);
    expect(byResource.get('workflow')?.sort()).toEqual([
      'create',
      'delete',
      'edit',
      'enable',
      'run',
      'transfer',
      'view',
    ]);
    expect(byResource.get('execution')?.sort()).toEqual(['cancel', 'retry', 'view']);
    expect(byResource.get('credential')?.sort()).toEqual(['create', 'delete', 'edit', 'view']);
    expect(byResource.get('variable')?.sort()).toEqual(['edit', 'view']);
    expect(byResource.get('template')?.sort()).toEqual(['install', 'view']);
    expect(byResource.get('automation')).toEqual(['admin']);
  });

  it('uses keys the registry will accept', () => {
    // `syncPermissionRegistry` writes these straight into the DB at boot; a key that does not
    // match the pattern fails there, at startup, rather than here.
    for (const key of keys) expect(key, key).toMatch(PERMISSION_KEY_PATTERN);
  });

  it('attributes every permission to the automation module', () => {
    for (const permission of automationPermissions) expect(permission.moduleId).toBe('automation');
  });

  it('gives every permission a bilingual name', () => {
    for (const permission of automationPermissions) {
      expect(permission.name.en.length, permission.key).toBeGreaterThan(0);
      expect(permission.name.ar.length, permission.key).toBeGreaterThan(0);
    }
  });
});

describe('coexistence with the rest of the platform', () => {
  it('collides with no platform permission key', () => {
    // `syncPermissionRegistry` throws on a duplicate key at boot, taking the whole API down. The
    // registry is keyed on `<resource>.<action>` with no module prefix, so this is a real hazard
    // rather than a theoretical one.
    const platformKeys = new Set(platformPermissions.map((p) => p.key));
    for (const key of keys) expect(platformKeys.has(key), `${key} collides`).toBe(false);
  });

  it('does not claim the Workflow Engine′s resources', () => {
    // ADR-011 owns entity state through `workflowDefinition` / `workflowInstance`; ADR-018 owns
    // side effects through `workflow`. Taking either of the first two here would blur the one
    // boundary the whole design rests on.
    const resources = new Set(automationPermissions.map((p) => p.resource));
    expect(resources.has('workflowDefinition')).toBe(false);
    expect(resources.has('workflowInstance')).toBe(false);
  });

  it('has no duplicate keys of its own', () => {
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('what the grants mean', () => {
  it('separates installing a template from viewing one', () => {
    // A template is an executable graph that runs with the installer's permissions and
    // credentials (§11.4); browsing the catalogue is not the same act as running one.
    expect(keys).toContain('template.view');
    expect(keys).toContain('template.install');
  });

  it('separates transferring ownership from editing', () => {
    // `workflow.transfer` changes the principal a workflow RUNS AS, so it can change what the
    // automation is able to do. `workflow.edit` cannot.
    expect(keys).toContain('workflow.transfer');
  });

  it('marks nothing break-glass — none of these is an emergency-only grant', () => {
    // Break-glass carries mandatory 2FA and paging (Permission Matrix §6). `automation.admin` is
    // a standing administrative grant, not an emergency one, and labelling it break-glass would
    // devalue the mechanism for the permissions that genuinely are.
    expect(automationPermissions.filter((p) => p.breakGlass === true)).toEqual([]);
  });

  it('offers no read path for a stored secret', () => {
    // There is no `credential.reveal`, and §7.3 is why: a stolen session can USE a credential,
    // never exfiltrate one. Adding such an action would need an ADR, not a line here.
    expect(keys.some((key) => /reveal|decrypt|export/i.test(key))).toBe(false);
  });
});
