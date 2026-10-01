import { describe, expect, it } from 'vitest';
import { offersCompanyCars } from './company-cars';

describe('«عربيات الشركة» on the drivers’ car filter', () => {
  it('is not offered while the company half names no car', () => {
    expect(offersCompanyCars([], [])).toBe(false);
    expect(offersCompanyCars([], ['150'])).toBe(false);
  });

  it('is offered while the drivers’ half differs, and gone once it matches', () => {
    expect(offersCompanyCars(['150', '152'], [])).toBe(true);
    expect(offersCompanyCars(['150', '152'], ['150'])).toBe(true);
    // Pressed: the drivers' half now holds the same cars, in any order.
    expect(offersCompanyCars(['150', '152'], ['152', '150'])).toBe(false);
  });

  it('comes back when more cars are picked on the company half', () => {
    expect(offersCompanyCars(['150', '152', '156'], ['150', '152'])).toBe(true);
  });
});
