// A supply contract's figures as the screens read them and the writes enforce them — pure, over a
// stored document. The list's aggregation spells the same rules; the integration spec
// (`tests/integration/fleet-vehicle-contracts.spec.ts`) holds the two together.
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import {
  alarmOf,
  deliveryOver,
  figuresOf,
  fromPiastres,
  lineEditRefusal,
  liveDeliveries,
  unknownDeliveryLines,
  utcDay,
  utcTodayYmd,
} from './vehicle-contract.figures';
import { toVehicleContractDto } from './vehicle-contract.dto';
import {
  type FleetVehicleContractDeliveryDoc,
  type FleetVehicleContractDoc,
  type FleetVehicleContractFileLinkDoc,
  type FleetVehicleContractLineDoc,
} from './vehicle-contract.model';

const id = () => new Types.ObjectId();
const TYPE_A = id();
const TYPE_B = id();

const line = (
  count: number,
  unitPrice: number | null,
  typeId = TYPE_A,
): FleetVehicleContractLineDoc => ({
  _id: id(),
  typeId,
  count,
  unitPrice,
});

let clock = Date.UTC(2026, 9, 1);
const delivery = (
  day: string,
  counts: [FleetVehicleContractLineDoc, number][],
  isDeleted = false,
): FleetVehicleContractDeliveryDoc => {
  clock += 60_000;
  return {
    _id: id(),
    date: new Date(`${day}T00:00:00.000Z`),
    counts: counts.map(([of, count]) => ({ lineId: of._id, count })),
    isDeleted,
    deletedAt: isDeleted ? new Date(clock) : null,
    deletedBy: null,
    createdAt: new Date(clock),
    createdBy: null,
    updatedAt: new Date(clock),
    updatedBy: null,
  };
};

const contract = (
  lines: FleetVehicleContractLineDoc[],
  deliveries: FleetVehicleContractDeliveryDoc[] = [],
  deadline: string | null = null,
  files: FleetVehicleContractFileLinkDoc[] = [],
): FleetVehicleContractDoc => ({
  _id: id(),
  no: 1,
  name: '',
  date: new Date('2026-10-01T00:00:00.000Z'),
  deadline: deadline === null ? null : new Date(`${deadline}T00:00:00.000Z`),
  supplier: '',
  lines,
  deliveries,
  files,
  schemaVersion: 1,
  isDeleted: false,
  deletedAt: null,
  deletedBy: null,
  createdBy: null,
  updatedBy: null,
  createdAt: new Date('2026-10-01T08:00:00.000Z'),
  updatedAt: new Date('2026-10-01T08:00:00.000Z'),
  __v: 0,
});

describe('figuresOf — counted from the live deliveries only', () => {
  it('leaves a soft-deleted delivery out of «المستلم» and gives its cars back to «المتبقي»', () => {
    const a = line(22, 4_700_000);
    const b = line(11, 5_400_000, TYPE_B);
    const doc = contract(
      [a, b],
      [
        delivery('2026-10-05', [[a, 8]]),
        delivery(
          '2026-10-06',
          [
            [a, 3],
            [b, 4],
          ],
          true,
        ),
      ],
    );
    const figures = figuresOf(doc);
    expect(figures.contracted).toBe(33);
    expect(figures.received).toBe(8);
    expect(figures.remaining).toBe(25);
    expect(figures.perLine.get(String(a._id))).toEqual({ received: 8, remaining: 14 });
    expect(figures.perLine.get(String(b._id))).toEqual({ received: 0, remaining: 11 });
  });

  it('sums the money in piastres — 22 × 4,700,000 + 11 × 5,400,000 = 162,800,000', () => {
    const doc = contract([line(22, 4_700_000), line(11, 5_400_000, TYPE_B)]);
    expect(fromPiastres(figuresOf(doc).totalPiastres)).toBe(162_800_000);
  });

  it('is exact to the piastre, and a line without a price counts 0', () => {
    const doc = contract([line(3, 0.1), line(2, null, TYPE_B), line(7, 4_700_000.15)]);
    expect(fromPiastres(figuresOf(doc).totalPiastres)).toBe(32_900_001.35);
  });
});

describe('the deliveries in order — «الاستلام الأول» renumbers after a delete', () => {
  it('orders by day, then by when recorded, and skips the deleted ones', () => {
    const a = line(22, null);
    const late = delivery('2026-10-09', [[a, 2]]);
    const gone = delivery('2026-10-03', [[a, 5]], true);
    const first = delivery('2026-10-04', [[a, 4]]);
    const sameDay = delivery('2026-10-04', [[a, 1]]);
    const doc = contract([a], [late, gone, first, sameDay]);
    expect(liveDeliveries(doc).map((d) => d._id)).toEqual([first._id, sameDay._id, late._id]);

    const dto = toVehicleContractDto(doc, new Map(), '2026-10-19');
    expect(
      dto.deliveries.map((d) => [d.no, d.date, d.total, d.receivedAfter, d.remainingAfter]),
    ).toEqual([
      [1, '2026-10-04', 4, 4, 18],
      [2, '2026-10-04', 1, 5, 17],
      [3, '2026-10-09', 2, 7, 15],
    ]);
  });
});

describe('deliveryOver — «أكثر من المتبقي»', () => {
  const a = line(10, null);
  const b = line(5, null, TYPE_B);
  const earlier = delivery('2026-10-05', [
    [a, 6],
    [b, 5],
  ]);
  const doc = contract([a, b], [earlier]);

  it('refuses a count above what is still owed on its line, naming the index and the left', () => {
    expect(
      deliveryOver(doc, [
        { lineId: String(a._id), count: 4 },
        { lineId: String(b._id), count: 1 },
      ]),
    ).toEqual([{ index: 1, lineId: String(b._id), count: 1, left: 0 }]);
    expect(deliveryOver(doc, [{ lineId: String(a._id), count: 5 }])).toEqual([
      { index: 0, lineId: String(a._id), count: 5, left: 4 },
    ]);
  });

  it('gives an edited delivery its own cars back first', () => {
    const counts = [
      { lineId: String(a._id), count: 10 },
      { lineId: String(b._id), count: 5 },
    ];
    expect(deliveryOver(doc, counts, String(earlier._id))).toEqual([]);
    expect(
      deliveryOver(doc, [{ lineId: String(a._id), count: 11 }], String(earlier._id)),
    ).toHaveLength(1);
  });

  it('matches a line however its id is spelled', () => {
    expect(deliveryOver(doc, [{ lineId: String(a._id).toUpperCase(), count: 5 }])).toHaveLength(1);
    expect(unknownDeliveryLines(doc, [{ lineId: String(a._id).toUpperCase() }])).toEqual([]);
  });

  it('flags a line this contract does not hold', () => {
    expect(
      unknownDeliveryLines(doc, [{ lineId: String(a._id) }, { lineId: String(id()) }]),
    ).toEqual([expect.objectContaining({ field: 'counts.1.lineId', code: 'UNKNOWN_LINE' })]);
  });
});

describe('lineEditRefusal — what an edit of the lines may not do', () => {
  const a = line(10, null);
  const b = line(5, null, TYPE_B);
  const c = line(3, null);
  const doc = contract(
    [a, b, c],
    [
      delivery('2026-10-05', [
        [a, 6],
        [b, 2],
      ]),
    ],
  );

  it('accepts a raise, a new line, and dropping a line nothing arrived on', () => {
    expect(
      lineEditRefusal(doc, [
        { id: String(a._id), count: 12 },
        { id: String(b._id).toUpperCase(), count: 2 },
        { id: null, count: 4 },
      ]),
    ).toEqual([]);
  });

  it('refuses a count below the cars received on its line', () => {
    expect(
      lineEditRefusal(doc, [
        { id: String(a._id), count: 5 },
        { id: String(b._id), count: 5 },
      ]),
    ).toEqual([expect.objectContaining({ field: 'lines.0.count', code: 'BELOW_RECEIVED' })]);
  });

  it('refuses dropping a line cars arrived on', () => {
    expect(lineEditRefusal(doc, [{ id: String(a._id), count: 10 }])).toEqual([
      expect.objectContaining({ field: 'lines', code: 'LINE_RECEIVED' }),
    ]);
  });

  it('refuses a line id this contract does not hold', () => {
    expect(
      lineEditRefusal(doc, [
        { id: String(a._id), count: 10 },
        { id: String(b._id), count: 5 },
        { id: String(id()), count: 1 },
      ]),
    ).toEqual([expect.objectContaining({ field: 'lines.2.id', code: 'UNKNOWN_LINE' })]);
  });
});

describe('«اليوم» is the server’s UTC day', () => {
  it('reads 22:30Z as that same UTC day, and stores days at UTC midnight', () => {
    expect(utcTodayYmd(new Date('2026-10-19T22:30:00.000Z'))).toBe('2026-10-19');
    expect(utcDay(new Date('2026-10-19T22:30:00.000Z')).toISOString()).toBe(
      '2026-10-19T00:00:00.000Z',
    );
  });
});

describe('alarmOf — «إنذار التوريد»', () => {
  const today = '2026-10-19';
  const at = (deadline: string | null, owed = true) => {
    const a = line(4, null);
    const doc = contract(
      [a],
      owed ? [delivery('2026-10-05', [[a, 1]])] : [delivery('2026-10-05', [[a, 4]])],
      deadline,
    );
    return alarmOf(doc, today);
  };

  it.each([
    ['2026-11-19', null],
    ['2026-11-18', 'yellow'],
    ['2026-10-27', 'yellow'],
    ['2026-10-26', 'red'],
    ['2026-10-19', 'red'],
    ['2026-10-10', 'red'],
  ] as const)('deadline %s → %s', (deadline, level) => {
    expect(at(deadline)?.level ?? null).toBe(level);
  });

  it('counts the days from today — 0 today, negative once overdue', () => {
    expect(at('2026-10-24')?.days).toBe(5);
    expect(at('2026-10-10')?.days).toBe(-9);
  });

  it('raises nothing once every car arrived, or without a deadline', () => {
    expect(at('2026-10-20', false)).toBeNull();
    expect(at(null)).toBeNull();
  });

  it('names the cars still owed and the lines they are on', () => {
    const a = line(4, null);
    const b = line(2, null, TYPE_B);
    const doc = contract(
      [a, b],
      [
        delivery('2026-10-05', [
          [a, 4],
          [b, 1],
        ]),
      ],
      '2026-10-24',
    );
    expect(alarmOf(doc, today)).toEqual({
      level: 'red',
      days: 5,
      left: 1,
      lines: [{ lineId: String(b._id), left: 1 }],
    });
  });
});

describe('toVehicleContractDto', () => {
  it('names each make, keeps a price-less line total null, and shows only live attachments', () => {
    const a = line(2, 100.5);
    const b = line(1, null, TYPE_B);
    const link = (mime: string, isDeleted = false): FleetVehicleContractFileLinkDoc => ({
      fileId: id(),
      fileName: 'صفحة 1',
      mime,
      size: 10,
      addedAt: new Date('2026-10-02T09:00:00.000Z'),
      addedBy: null,
      isDeleted,
      deletedAt: null,
      deletedBy: null,
    });
    const pdf = link('application/pdf');
    const png = link('image/png');
    const doc = contract([a, b], [], null, [pdf, link('image/png', true), png]);
    const dto = toVehicleContractDto(
      doc,
      new Map([[String(TYPE_A), { ar: 'غزالة', en: 'Ghazala' }]]),
      '2026-10-19',
    );
    expect(dto.lines.map((l) => [l.typeName?.ar ?? null, l.total])).toEqual([
      ['غزالة', 201],
      [null, null],
    ]);
    expect(dto.total).toBe(201);
    expect(dto.files.map((f) => [f.fileId, f.kind])).toEqual([
      [String(pdf.fileId), 'pdf'],
      [String(png.fileId), 'image'],
    ]);
    expect(dto.alarm).toBeNull();
    expect(dto.deadline).toBeNull();
    expect(dto.date).toBe('2026-10-01');
  });
});
