// A unit's rules (design §5.3): a retired unit is refused only to a new reference — an item that
// already names it keeps it — and nothing keeps a unit from retiring.
import { describe, expect, it } from 'vitest';
import { activeFor, deactivationProblem } from './catalog-item-rules';

const active = { isActive: true };
const retired = { isActive: false };

describe('activeFor', () => {
  it('offers an active unit to a new reference and to an existing one', () => {
    expect(activeFor(active, 'newReference')).toBe(true);
    expect(activeFor(active, 'existingReference')).toBe(true);
  });

  it('refuses a retired unit to a new reference', () => {
    expect(activeFor(retired, 'newReference')).toBe(false);
  });

  it('lets an item that already names a retired unit keep it', () => {
    expect(activeFor(retired, 'existingReference')).toBe(true);
  });
});

describe('deactivationProblem', () => {
  it('answers none, active or not — a unit deactivates freely', () => {
    expect(deactivationProblem(active)).toBeNull();
    expect(deactivationProblem(retired)).toBeNull();
  });
});
