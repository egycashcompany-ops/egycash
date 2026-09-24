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
          vehicleCode: null,
          year: 2026,
          vehicleCount: 5,
          vehicleAmount: 500,
          driverCount: 2,
          driverAmount: 150,
          outstandingVehicleAmount: 500,
          outstandingDriverAmount: 150,
          outstandingVehicleCount: 5,
          outstandingDriverCount: 2,
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
        outstandingVehicleAmount: 500,
        outstandingDriverAmount: 150,
        outstandingTotalAmount: 650,
        outstandingVehicleCount: 5,
        outstandingDriverCount: 2,
        outstandingTotalCount: 7,
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
          vehicleCode: null,
          year: 2026,
          vehicleCount: 3,
          vehicleAmount: 300,
          driverCount: 0,
          driverAmount: 0,
          outstandingVehicleAmount: 300,
          outstandingDriverAmount: 0,
          outstandingVehicleCount: 3,
          outstandingDriverCount: 0,
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
          vehicleCode: null,
          year: 2026,
          vehicleCount: 1,
          vehicleAmount: 10,
          driverCount: 0,
          driverAmount: 0,
          outstandingVehicleAmount: 10,
          outstandingDriverAmount: 0,
          outstandingVehicleCount: 1,
          outstandingDriverCount: 0,
          rowCount: 1,
          collectedCount: 0,
        },
        {
          vehicleId: 'v1',
          vehicleCode: null,
          year: 2026,
          vehicleCount: 1,
          vehicleAmount: 10,
          driverCount: 0,
          driverAmount: 0,
          outstandingVehicleAmount: 10,
          outstandingDriverAmount: 0,
          outstandingVehicleCount: 1,
          outstandingDriverCount: 0,
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
          vehicleCode: null,
          year: 2025,
          vehicleCount: 2,
          vehicleAmount: 200,
          driverCount: 0,
          driverAmount: 0,
          outstandingVehicleAmount: 200,
          outstandingDriverAmount: 0,
          outstandingVehicleCount: 2,
          outstandingDriverCount: 0,
          rowCount: 2,
          collectedCount: 2,
        },
        {
          vehicleId: 'v1',
          vehicleCode: null,
          year: 2026,
          vehicleCount: 5,
          vehicleAmount: 500,
          driverCount: 1,
          driverAmount: 100,
          outstandingVehicleAmount: 500,
          outstandingDriverAmount: 100,
          outstandingVehicleCount: 5,
          outstandingDriverCount: 1,
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
      vehicleCode: null,
      year: 2025,
      vehicleCount: 0,
      vehicleAmount: 0,
      driverCount: 0,
      driverAmount: 0,
      outstandingVehicleAmount: 0,
      outstandingDriverAmount: 0,
      outstandingVehicleCount: 0,
      outstandingDriverCount: 0,
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

  it('KEEPS a car whose fines are all collected — and keeps its FIGURES', () => {
    // «كل الارقام بتاعت العربيه تفضل موجوده متتحولش ل صفر». A tick is a statement about payment,
    // not a delete: the line goes on saying what the year came to, and only the outstanding
    // figures — the ones the footer adds up — fall to nothing.
    const rows = assembleRollups(
      sums({
        vehicleCount: 4,
        vehicleAmount: 400,
        rowCount: 4,
        collectedCount: 4,
        outstandingVehicleAmount: 0,
        outstandingDriverAmount: 0,
        outstandingVehicleCount: 0,
        outstandingDriverCount: 0,
      }),
      [],
      codes,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.totalAmount, 'the line still says what the year came to').toBe(400);
    expect(rows[0]?.outstandingTotalAmount, 'and nothing is still owed').toBe(0);
    expect(rows[0]?.rowCount).toBe(4);
  });

  it('counts what it owes, as well as adding it up — what the printed sheet reports', () => {
    // «لما باجى اطبع بيجيب اللى خلص واللى مخلصش ف الجدول لا انا عاوز الجدول يجيب اللى مخلصش بس
    // يعنى هيبقوا 3 كدا مش 8». The signed document reports what is still owed, so its table needs
    // the COUNT of it too — the money and the count sit in the same row, and «٠ مخالفات · ٥٢٣٫٧٠»
    // is a line that contradicts itself.
    const rows = assembleRollups(
      sums({
        vehicleCount: 4,
        vehicleAmount: 1046.77,
        driverCount: 4,
        driverAmount: 2300,
        rowCount: 8,
        collectedCount: 5,
        outstandingVehicleAmount: 523.7,
        outstandingDriverAmount: 700,
        outstandingVehicleCount: 2,
        outstandingDriverCount: 1,
      }),
      [],
      codes,
    );
    expect(rows[0]?.totalCount, 'the screen still says eight').toBe(8);
    expect(rows[0]?.outstandingTotalCount, 'and the sheet says three').toBe(3);
    expect(rows[0]?.outstandingTotalAmount).toBe(1223.7);
  });

  it('a HALF-settled car owes the half it has not paid — per row, not per car', () => {
    // The drivers' half's own arithmetic, which is where this rule comes from: ticking one fine
    // moves the total by that fine, not by the whole car.
    const rows = assembleRollups(
      sums({
        vehicleCount: 2,
        vehicleAmount: 300,
        driverCount: 1,
        driverAmount: 100,
        rowCount: 3,
        collectedCount: 1,
        outstandingVehicleAmount: 100,
        outstandingDriverAmount: 100,
        outstandingVehicleCount: 1,
        outstandingDriverCount: 1,
      }),
      [],
      codes,
    );
    expect(rows[0]?.totalAmount, 'the line is unmoved').toBe(400);
    expect(rows[0]?.outstandingTotalAmount, 'the footer sees only what is left').toBe(200);
  });

  it('KEEPS a year whose only fines are the DRIVERS’ — the board still reports their money', () => {
    // `rowCount` counts the whole group now, drivers' fines included, because that is what the
    // board's tick reaches. A driver-only year therefore has rows to tick and belongs on the board.
    const rows = assembleRollups(sums({ rowCount: 1, driverCount: 1, driverAmount: 120 }), [], codes);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rowCount, 'and the tick can settle them from here').toBe(1);
    expect(rows[0]?.driverAmount).toBe(120);
  });

  it('…and KEEPS it once they are settled too, because the tick can put them back', () => {
    // The money is still ON the line — that is the change — and what has gone to nothing is the
    // outstanding figure. The row is still there and still tickable, and a row a reader may act
    // on is a row that has something in it.
    const rows = assembleRollups(
      sums({ driverCount: 1, driverAmount: 120, rowCount: 1, collectedCount: 1 }),
      [],
      codes,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.driverAmount, 'the fine is still reported').toBe(120);
    expect(rows[0]?.outstandingDriverAmount, 'and it is no longer owed').toBe(0);
  });

  it('drops a (vehicle, year) with genuinely nothing behind it', () => {
    // No rows of any shape and no grievance figure: «لما مسحت كله فضلت موجوده» was this row.
    expect(assembleRollups(sums(), [], codes)).toEqual([]);
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
          vehicleCode: null,
          year: 2026,
          vehicleCount: 2,
          vehicleAmount: 1000,
          driverCount: 0,
          driverAmount: 0,
          outstandingVehicleAmount: 1000,
          outstandingDriverAmount: 0,
          outstandingVehicleCount: 2,
          outstandingDriverCount: 0,
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
