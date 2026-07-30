// Trigger filter evaluation (A-5).
//
// A filter decides whether a real event fires a workflow. The cases that matter are the ones where
// a naive `===` gets it wrong: a form value arriving as a string against a numeric payload, a
// nested path, an absent field, a comparison against something non-numeric that must not throw on
// the dispatch path.
import { describe, expect, it } from 'vitest';
import { type AutomationFilter } from '@ecms/contracts';
import { matchesFilters } from './filter-eval';

const f = (field: string, op: AutomationFilter['op'], value?: unknown): AutomationFilter =>
  value === undefined ? { field, op } : { field, op, value };

describe('equality tolerates the wire', () => {
  it('matches a numeric payload against a string filter value', () => {
    // The common case: the filter was typed in a form (`'permanent'`, `'3'`), the payload carries
    // a typed value. `===` would silently never match.
    expect(matchesFilters([f('count', 'eq', '3')], { count: 3 })).toBe(true);
    expect(matchesFilters([f('count', 'eq', 3)], { count: 3 })).toBe(true);
  });

  it('distinguishes ne from eq', () => {
    expect(matchesFilters([f('origin', 'ne', 'direct')], { origin: 'recruitment' })).toBe(true);
    expect(matchesFilters([f('origin', 'ne', 'direct')], { origin: 'direct' })).toBe(false);
  });

  it('does not match an absent field on eq', () => {
    expect(matchesFilters([f('missing', 'eq', 'x')], { present: 1 })).toBe(false);
  });
});

describe('membership and containment', () => {
  it('in / nin test membership', () => {
    expect(matchesFilters([f('status', 'in', ['a', 'b'])], { status: 'b' })).toBe(true);
    expect(matchesFilters([f('status', 'nin', ['a', 'b'])], { status: 'c' })).toBe(true);
  });

  it('contains works on a string and on an array', () => {
    expect(matchesFilters([f('code', 'contains', 'EG')], { code: 'EG-2024' })).toBe(true);
    expect(matchesFilters([f('tags', 'contains', 'urgent')], { tags: ['urgent', 'hr'] })).toBe(true);
    expect(matchesFilters([f('code', 'contains', 'ZZ')], { code: 'EG-2024' })).toBe(false);
  });
});

describe('ordering', () => {
  it('compares numbers', () => {
    expect(matchesFilters([f('days', 'gt', 5)], { days: 10 })).toBe(true);
    expect(matchesFilters([f('days', 'lte', 5)], { days: 5 })).toBe(true);
  });

  it('compares dates carried as ISO strings', () => {
    expect(
      matchesFilters([f('startDate', 'gt', '2026-01-01')], { startDate: '2026-06-01' }),
    ).toBe(true);
  });

  it('does not throw or match on a non-numeric comparison', () => {
    // A `gt` against a word must be a quiet no-match: an exception here would drop the event for
    // every workflow on the dispatch path.
    expect(matchesFilters([f('name', 'gt', 5)], { name: 'alice' })).toBe(false);
  });
});

describe('presence', () => {
  it('exists is true only when the field is present', () => {
    expect(matchesFilters([f('email', 'exists')], { email: 'a@b.c' })).toBe(true);
    expect(matchesFilters([f('email', 'exists')], { other: 1 })).toBe(false);
  });

  it('reaches nested paths', () => {
    expect(
      matchesFilters([f('entityRef.moduleId', 'eq', 'hr')], { entityRef: { moduleId: 'hr' } }),
    ).toBe(true);
  });
});

describe('combination', () => {
  it('ANDs all filters', () => {
    const filters = [f('origin', 'eq', 'recruitment'), f('code', 'contains', 'EG')];
    expect(matchesFilters(filters, { origin: 'recruitment', code: 'EG-1' })).toBe(true);
    expect(matchesFilters(filters, { origin: 'recruitment', code: 'US-1' })).toBe(false);
  });

  it('an empty filter list matches everything', () => {
    // A trigger with no condition fires on every occurrence of its event.
    expect(matchesFilters([], { anything: true })).toBe(true);
  });
});
