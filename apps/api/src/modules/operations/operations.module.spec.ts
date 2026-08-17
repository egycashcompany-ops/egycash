// The OP-1 manifest guards: the module registers cleanly, and its surfaces are exactly as empty
// as the slice claims. The second block is the pin-the-numbers precedent (pages.spec) — when
// OP-2+ adds a permission, route or collection, the assertion names it in the same PR.
import { describe, expect, it } from 'vitest';
import { platformSatisfies, validateManifest } from '../../platform/kernel/module-registry';
import { operationsModule } from './operations.module';

describe('operations module manifest (OP-1)', () => {
  it('passes kernel manifest validation', () => {
    expect(() => {
      validateManifest(operationsModule);
    }).not.toThrow();
  });

  it('targets a platform version this kernel satisfies', () => {
    expect(platformSatisfies(operationsModule.requiresPlatform)).toBe(true);
  });

  it('ships the foundation slice only — no surface exists that no slice serves yet', () => {
    expect(operationsModule.id).toBe('operations');
    expect(operationsModule.permissions).toEqual([]);
    expect(operationsModule.routes).toEqual([]);
    expect(operationsModule.collections).toEqual([]);
    expect(operationsModule.eventSubscriptions).toEqual([]);
    expect(operationsModule.pages).toBeUndefined();
    expect(operationsModule.scheduledTasks).toBeUndefined();
    expect(operationsModule.jobHandlers).toBeUndefined();
    expect(operationsModule.seed).toBeUndefined();
  });
});
