import { describe, expect, it } from 'vitest';
import { entitledDays } from './leave-type.service';

// The seeded ANNUAL shape: 15 base → 21 after 1 service year → 30 after 10 years OR age 50.
const ANNUAL = {
  baseDays: 15,
  entitlementSteps: [
    { afterServiceYears: 1, days: 21 },
    { afterServiceYears: 10, days: 30 },
  ],
  ageStepAge: 50,
  ageStepDays: 30,
};

describe('entitledDays (frozen leave design §2/§4)', () => {
  it('grants the base in the first service year', () => {
    expect(entitledDays(ANNUAL, 0, 30)).toBe(15);
  });

  it('steps up after one service year and again after ten', () => {
    expect(entitledDays(ANNUAL, 1, 30)).toBe(21);
    expect(entitledDays(ANNUAL, 9, 30)).toBe(21);
    expect(entitledDays(ANNUAL, 10, 30)).toBe(30);
  });

  it('applies the age step independently of service (Egyptian law: 30 at age 50)', () => {
    expect(entitledDays(ANNUAL, 2, 50)).toBe(30);
    expect(entitledDays(ANNUAL, 2, null)).toBe(21);
  });

  it('returns 0 for untracked types (no baseDays)', () => {
    expect(entitledDays({ baseDays: null, entitlementSteps: [], ageStepAge: null, ageStepDays: null }, 5, 40)).toBe(0);
  });
});
