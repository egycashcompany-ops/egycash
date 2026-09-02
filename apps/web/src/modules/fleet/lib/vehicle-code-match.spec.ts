// What a vehicle-code box matches, in the browser — and, just as importantly, what it does not.
import { describe, expect, it } from 'vitest';
import { matchesVehicleCode } from './vehicle-code-match';

describe('matchesVehicleCode', () => {
  it('matches the code', () => {
    expect(matchesVehicleCode('150', '150')).toBe(true);
    expect(matchesVehicleCode('150', '15')).toBe(true);
  });

  it('does not match a code the car does not carry', () => {
    expect(matchesVehicleCode('150', '200')).toBe(false);
  });

  it('narrows nothing when the box holds no code', () => {
    // Empty, whitespace, and a lone dash the parser drops: all of them are "no question asked".
    for (const term of ['', '   ', '-', ' - ']) {
      expect(matchesVehicleCode('150', term), `«${term}» must not narrow`).toBe(true);
    }
  });

  it('reads `150 -` the way the filter bar reads it', () => {
    // The canonical parser's whole point: a trailing separator means the code before it is
    // FINISHED, not that the term is `150 -` — which names no car and would empty the board under
    // a half-typed box. `150 - ` is the same text one keystroke later and must not answer
    // differently.
    expect(matchesVehicleCode('150', '150 -')).toBe(true);
    expect(matchesVehicleCode('150', '150 - ')).toBe(true);
    expect(matchesVehicleCode('200', '150 -')).toBe(false);
  });

  it('keeps `A-15` one code, as the hyphen rule says', () => {
    // No spaces around the dash, so it is part of the code and not a separator.
    expect(matchesVehicleCode('A-15', 'A-15')).toBe(true);
    expect(matchesVehicleCode('A', 'A-15')).toBe(false);
  });

  it('takes several codes at once, OR-ed', () => {
    expect(matchesVehicleCode('150', '150 - 151')).toBe(true);
    expect(matchesVehicleCode('151', '150 - 151')).toBe(true);
    expect(matchesVehicleCode('152', '150 - 151')).toBe(false);
    expect(matchesVehicleCode('151', '150,151')).toBe(true);
  });

  it('ignores case, as the registry does', () => {
    expect(matchesVehicleCode('FLT-210', 'flt-210')).toBe(true);
  });
});
