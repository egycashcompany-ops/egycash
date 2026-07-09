import { Router } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearModules,
  platformSatisfies,
  registerModule,
  validateManifest,
  type ModuleManifest,
} from './module-registry';

const manifest = (overrides: Partial<ModuleManifest> = {}): ModuleManifest => ({
  id: 'hr',
  name: { en: 'Human Resources', ar: 'الموارد البشرية' },
  version: '1.0.0',
  requiresPlatform: '^2.1',
  permissions: [],
  routes: [{ prefix: '/hr', router: Router() }],
  collections: ['hr_applicants'],
  eventSubscriptions: [],
  ...overrides,
});

afterEach(() => clearModules());

describe('platformSatisfies (Review R25)', () => {
  it.each([
    ['^2.1', true],
    ['^2.0', true], // platform 2.1 satisfies ^2.0 (same major, newer minor)
    ['^2.2', false],
    ['^3.0', false],
    ['2.1.0', true],
    ['2.0.0', false],
    ['garbage', false],
  ])('range %s → %s', (range, expected) => {
    expect(platformSatisfies(range, '2.1.0')).toBe(expected);
  });
});

describe('manifest validation (fails the boot loudly)', () => {
  it('accepts a valid manifest', () => {
    expect(() => validateManifest(manifest())).not.toThrow();
  });

  it('rejects incompatible platform ranges', () => {
    expect(() => validateManifest(manifest({ requiresPlatform: '^3.0' }))).toThrow(
      /requiresPlatform/,
    );
  });

  it('rejects foreign permission moduleIds and bad keys', () => {
    const bad = manifest({
      permissions: [
        {
          key: 'applicant.create',
          resource: 'applicant',
          action: 'create',
          moduleId: 'fleet',
          name: { en: 'x', ar: 'x' },
        },
      ],
    });
    expect(() => validateManifest(bad)).toThrow(/foreign moduleId/);
  });

  it('rejects unprefixed collections', () => {
    expect(() => validateManifest(manifest({ collections: ['applicants'] }))).toThrow(
      /module prefix/,
    );
  });

  it('rejects routes outside the module prefix', () => {
    expect(() =>
      validateManifest(manifest({ routes: [{ prefix: '/fleet', router: Router() }] })),
    ).toThrow(/route prefix/);
  });

  it('rejects duplicate module ids', () => {
    registerModule(manifest());
    expect(() => registerModule(manifest())).toThrow(/duplicate module id/);
  });
});
