import { describe, expect, it } from 'vitest';
import { diffChanges } from './diff';

describe('diffChanges (field-level audit diffs, ADR-012)', () => {
  it('captures changed fields with old and new values', () => {
    const changes = diffChanges(
      { status: 'screening', score: 40 },
      { status: 'interview', score: 40 },
    );
    expect(changes).toEqual([{ field: 'status', old: 'screening', new: 'interview' }]);
  });

  it('treats undefined as null and reports additions/removals', () => {
    const changes = diffChanges({}, { branchId: 'abc' });
    expect(changes).toEqual([{ field: 'branchId', old: null, new: 'abc' }]);
  });

  it('compares nested objects structurally', () => {
    const changes = diffChanges(
      { name: { ar: 'أحمد', en: 'Ahmed' } },
      { name: { ar: 'أحمد', en: 'Ahmad' } },
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]?.field).toBe('name');
  });

  it('returns no changes for identical snapshots', () => {
    expect(diffChanges({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] })).toEqual([]);
  });

  it('respects an explicit field whitelist', () => {
    const changes = diffChanges({ a: 1, secret: 'x' }, { a: 2, secret: 'y' }, ['a']);
    expect(changes).toEqual([{ field: 'a', old: 1, new: 2 }]);
  });
});
