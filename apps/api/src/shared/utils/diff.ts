// Field-level diff for audit records (ADR-012): store what changed, not whole documents.
import { type AuditChange } from '@ecms/contracts';

const normalize = (value: unknown): unknown => {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === 'object') {
    return JSON.parse(JSON.stringify(value)) as unknown;
  }
  return value;
};

const isEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Diff two flat-ish snapshots over a whitelist of fields (dot paths supported one level deep
 * via the snapshot shape itself — pass pre-flattened objects for nested comparisons).
 */
export const diffChanges = (
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields?: readonly string[],
): AuditChange[] => {
  const keys = fields ?? [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const changes: AuditChange[] = [];
  for (const field of keys) {
    const oldValue = normalize(before[field]);
    const newValue = normalize(after[field]);
    if (!isEqual(oldValue, newValue)) {
      changes.push({ field, old: oldValue, new: newValue });
    }
  }
  return changes;
};
