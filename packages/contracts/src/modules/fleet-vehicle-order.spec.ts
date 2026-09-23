// The order a fleet's cars are read in — «من اول 150 وانت طالع ... وبعدين الملاكى».
//
// One rule, in the contract, because both sides order by it: the server sorts the registers with
// the same three groups spelled as an aggregation expression, and the browser sorts the lists it
// already holds with the function below. A rule written twice is a rule that ends up written two
// ways, and the symptom would be two screens disagreeing about where car 61 belongs.
import { describe, expect, it } from 'vitest';
import { compareFleetVehicleCodes, fleetVehicleCodeOrderKey } from './fleet';

const sorted = (codes: string[]): string[] => [...codes].sort(compareFleetVehicleCodes);

describe('the working fleet comes first, counting up', () => {
  it('orders 150 upward NUMERICALLY, not as text', () => {
    // The whole reason the key is padded: as text «9» sorts after «150», and so does «1500».
    expect(sorted(['1500', '151', '150', '999'])).toEqual(['150', '151', '999', '1500']);
  });

  it('puts «الملاكى» — anything below 150 — at the END, counting up among themselves', () => {
    expect(sorted(['61', '150', '62', '151'])).toEqual(['150', '151', '61', '62']);
    expect(sorted(['9', '149', '150'])).toEqual(['150', '9', '149']);
  });

  it('puts the cars written in WORDS between the two — «العربيات اللى متسجله بالكلام»', () => {
    expect(sorted(['61', 'ميكروباص', '151', '150'])).toEqual(['150', '151', 'ميكروباص', '61']);
  });

  it('orders the worded ones among themselves', () => {
    const words = sorted(['ونش', 'اتوبيس', 'ميكروباص']);
    expect(words[0], 'and they keep a stable order of their own').toBe('اتوبيس');
    expect(new Set(words).size).toBe(3);
  });

  it('149 is «ملاكى» and 150 is not — the boundary itself', () => {
    expect(sorted(['149', '150'])).toEqual(['150', '149']);
  });
});

describe('a code that is missing', () => {
  it('sorts LAST, which is what every other missing value in Fleet does', () => {
    expect(sorted(['61', null as unknown as string, '150'])).toEqual(['150', '61', null]);
  });

  it('answers null rather than throwing, for a row kept from the old book', () => {
    expect(fleetVehicleCodeOrderKey(null)).toBeNull();
    expect(fleetVehicleCodeOrderKey(undefined)).toBeNull();
    expect(fleetVehicleCodeOrderKey('')).toBeNull();
    expect(fleetVehicleCodeOrderKey('   ')).toBeNull();
  });
});

describe('the key itself', () => {
  it('leads with the GROUP, so the three blocks cannot interleave', () => {
    expect(fleetVehicleCodeOrderKey('150')?.startsWith('0')).toBe(true);
    expect(fleetVehicleCodeOrderKey('ميكروباص')?.startsWith('1')).toBe(true);
    expect(fleetVehicleCodeOrderKey('61')?.startsWith('2')).toBe(true);
  });

  it('pads the digits so text order is numeric order', () => {
    const a = fleetVehicleCodeOrderKey('150') as string;
    const b = fleetVehicleCodeOrderKey('1500') as string;
    expect(a.length, 'every numeric key is the same width').toBe(b.length);
    expect(a < b).toBe(true);
  });

  it('ignores surrounding space — a stored code is data, not a decision', () => {
    expect(fleetVehicleCodeOrderKey(' 150 ')).toBe(fleetVehicleCodeOrderKey('150'));
  });
});
