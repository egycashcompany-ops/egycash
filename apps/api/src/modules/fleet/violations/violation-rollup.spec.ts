import { describe, expect, it } from 'vitest';
import { assembleRollups } from './violation-rollup';

const codes = new Map([
  ['v1', 'V1'],
  ['v2', 'V2'],
]);

describe('assembleRollups (§2.9 — derived, never stored)', () => {
  it('merges both shapes and the grievance into one row per vehicle', () => {
    const rows = assembleRollups(
      [
        {
          vehicleId: 'v1',
          year: 2026,
          vehicleCount: 5,
          vehicleAmount: 500,
          driverCount: 2,
          driverAmount: 150,
        },
      ],
      [{ vehicleId: 'v1', year: 2026, totalBeforeGrievance: 900 }],
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
      [
        {
          vehicleId: 'v1',
          year: 2026,
          vehicleCount: 3,
          vehicleAmount: 300,
          driverCount: 0,
          driverAmount: 0,
        },
      ],
      [{ vehicleId: 'v2', year: 2026, totalBeforeGrievance: 400 }],
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
    expect(assembleRollups([], [], codes)).toEqual([]);
    const rows = assembleRollups(
      [
        { vehicleId: 'v2', year: 2026, vehicleCount: 1, vehicleAmount: 10, driverCount: 0, driverAmount: 0 },
        { vehicleId: 'v1', year: 2026, vehicleCount: 1, vehicleAmount: 10, driverCount: 0, driverAmount: 0 },
      ],
      [],
      codes,
    );
    expect(rows.map((r) => r.code)).toEqual(['V1', 'V2']);
  });

  it('keeps a vehicle’s years apart, newest first', () => {
    // The board shows a car's 2025 beside its 2026. Folding them together would report the
    // whole history as one year's bill — and the grievance would land on the wrong one.
    const rows = assembleRollups(
      [
        { vehicleId: 'v1', year: 2025, vehicleCount: 2, vehicleAmount: 200, driverCount: 0, driverAmount: 0 },
        { vehicleId: 'v1', year: 2026, vehicleCount: 5, vehicleAmount: 500, driverCount: 1, driverAmount: 100 },
      ],
      [{ vehicleId: 'v1', year: 2025, totalBeforeGrievance: 700 }],
      codes,
    );
    expect(rows.map((r) => r.year), 'newest first').toEqual([2026, 2025]);
    expect(rows[0], 'this year stands alone').toMatchObject({
      year: 2026,
      totalAmount: 600,
      totalCount: 6,
      totalBeforeGrievance: 0,
    });
    expect(rows[1], 'and the appeal sits on the year it was filed for').toMatchObject({
      year: 2025,
      totalAmount: 200,
      totalBeforeGrievance: 700,
    });
  });
});
