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
          rowCount: 3,
          collectedCount: 1,
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
        rowCount: 3,
        collectedCount: 1,
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
          rowCount: 3,
          collectedCount: 0,
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
      // A grievance-only vehicle has no violation rows, so nothing about it can be «collected».
      rowCount: 0,
      collectedCount: 0,
    });
  });

  it('sorts by vehicle code and returns nothing for an empty year', () => {
    expect(assembleRollups([], [], codes)).toEqual([]);
    const rows = assembleRollups(
      [
        {
          vehicleId: 'v2',
          year: 2026,
          vehicleCount: 1,
          vehicleAmount: 10,
          driverCount: 0,
          driverAmount: 0,
          rowCount: 1,
          collectedCount: 0,
        },
        {
          vehicleId: 'v1',
          year: 2026,
          vehicleCount: 1,
          vehicleAmount: 10,
          driverCount: 0,
          driverAmount: 0,
          rowCount: 1,
          collectedCount: 0,
        },
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
        {
          vehicleId: 'v1',
          year: 2025,
          vehicleCount: 2,
          vehicleAmount: 200,
          driverCount: 0,
          driverAmount: 0,
          rowCount: 2,
          collectedCount: 2,
        },
        {
          vehicleId: 'v1',
          year: 2026,
          vehicleCount: 5,
          vehicleAmount: 500,
          driverCount: 1,
          driverAmount: 100,
          rowCount: 6,
          collectedCount: 0,
        },
      ],
      [{ vehicleId: 'v1', year: 2025, totalBeforeGrievance: 700 }],
      codes,
    );
    expect(
      rows.map((r) => r.year),
      'newest first',
    ).toEqual([2026, 2025]);
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

describe('a (vehicle, year) with nothing in it leaves the board', () => {
  // «لما مسحت كله فضلت موجوده». A grievance record is keyed by (vehicle, year) and outlives the
  // violations it was raised against, so deleting the last fine used to leave a row of four zeroes
  // with nothing behind it to open, tick or settle.
  const sums = (over: Partial<Parameters<typeof assembleRollups>[0][number]> = {}): Parameters<
    typeof assembleRollups
  >[0] => [
    {
      vehicleId: 'v1',
      year: 2025,
      vehicleCount: 0,
      vehicleAmount: 0,
      driverCount: 0,
      driverAmount: 0,
      rowCount: 0,
      collectedCount: 0,
      ...over,
    },
  ];

  it('drops a row whose grievance is the only thing holding it up, and that is zero', () => {
    expect(assembleRollups([], [{ vehicleId: 'v1', year: 2025, totalBeforeGrievance: 0 }], codes)).toEqual(
      [],
    );
  });

  it('KEEPS a car whose fines are all collected — zero money, but rows to untick', () => {
    // The distinction the fix turns on. Excluding collected rows from the sums makes every amount
    // 0; dropping on a zero total would take a settled car off the board with its history inside.
    const rows = assembleRollups(sums({ rowCount: 4, collectedCount: 4 }), [], codes);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.totalAmount).toBe(0);
    expect(rows[0]?.rowCount).toBe(4);
  });

  it('KEEPS a grievance-only car when the figure is real — the appeal wiped the statement', () => {
    const rows = assembleRollups([], [{ vehicleId: 'v2', year: 2025, totalBeforeGrievance: 900 }], codes);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.totalBeforeGrievance).toBe(900);
  });

  it('keeps a car that still owes money', () => {
    expect(assembleRollups(sums({ vehicleCount: 1, vehicleAmount: 50, rowCount: 1 }), [], codes)).toHaveLength(1);
  });

  it('drops the empty one and keeps the rest in the same answer', () => {
    const rows = assembleRollups(
      [
        {
          vehicleId: 'v1',
          year: 2026,
          vehicleCount: 2,
          vehicleAmount: 1000,
          driverCount: 0,
          driverAmount: 0,
          rowCount: 2,
          collectedCount: 0,
        },
      ],
      [
        { vehicleId: 'v1', year: 2026, totalBeforeGrievance: 0 },
        { vehicleId: 'v2', year: 2025, totalBeforeGrievance: 0 },
      ],
      codes,
    );
    expect(rows.map((row) => `${row.code}:${row.year}`)).toEqual(['V1:2026']);
  });

  it('answers with nothing at all when every row is empty', () => {
    expect(
      assembleRollups(
        [],
        [
          { vehicleId: 'v1', year: 2025, totalBeforeGrievance: 0 },
          { vehicleId: 'v2', year: 2024, totalBeforeGrievance: 0 },
        ],
        codes,
      ),
    ).toEqual([]);
  });
});
