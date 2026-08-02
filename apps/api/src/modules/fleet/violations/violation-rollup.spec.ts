import { describe, expect, it } from 'vitest';
import { assembleRollups } from './violation-rollup';

const codes = new Map([
  ['v1', 'V1'],
  ['v2', 'V2'],
]);

describe('assembleRollups (§2.9 — derived, never stored)', () => {
  it('merges both shapes and the grievance into one row per vehicle', () => {
    const rows = assembleRollups(
      2026,
      [{ vehicleId: 'v1', vehicleCount: 5, vehicleAmount: 500, driverCount: 2, driverAmount: 150 }],
      [{ vehicleId: 'v1', totalBeforeGrievance: 900 }],
      codes,
    );
    expect(rows).toEqual([
      {
        vehicleId: 'v1',
        code: 'V1',
        year: 2026,
        vehicleCount: 5,
        vehicleAmount: 500,
        driverCount: 2,
        driverAmount: 150,
        totalCount: 7,
        totalAmount: 650,
        totalBeforeGrievance: 900,
      },
    ]);
  });

  it('a vehicle without a grievance shows 0, and a grievance-only vehicle still appears', () => {
    const rows = assembleRollups(
      2026,
      [{ vehicleId: 'v1', vehicleCount: 3, vehicleAmount: 300, driverCount: 0, driverAmount: 0 }],
      [{ vehicleId: 'v2', totalBeforeGrievance: 400 }],
      codes,
    );
    expect(rows.find((r) => r.vehicleId === 'v1')?.totalBeforeGrievance).toBe(0);
    expect(rows.find((r) => r.vehicleId === 'v2')).toMatchObject({
      totalCount: 0,
      totalAmount: 0,
      totalBeforeGrievance: 400,
    });
  });

  it('sorts by vehicle code and returns nothing for an empty year', () => {
    expect(assembleRollups(2026, [], [], codes)).toEqual([]);
    const rows = assembleRollups(
      2026,
      [
        { vehicleId: 'v2', vehicleCount: 1, vehicleAmount: 10, driverCount: 0, driverAmount: 0 },
        { vehicleId: 'v1', vehicleCount: 1, vehicleAmount: 10, driverCount: 0, driverAmount: 0 },
      ],
      [],
      codes,
    );
    expect(rows.map((r) => r.code)).toEqual(['V1', 'V2']);
  });
});
