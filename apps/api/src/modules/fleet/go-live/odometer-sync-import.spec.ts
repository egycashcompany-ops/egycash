// The new odometer export, read against the one the import shipped with — on rows, with no
// database: what the two files say (875 new rows, 87 changed), that the chain the sync leaves is
// the chain a fresh import of the new book would write, and every decision the three-way rule
// makes about a reading somebody may have touched on ECMS since.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { resolveGoLiveDataDir } from './vehicles';
import { parseCars } from './vehicles-import';
import { CARS_LOG_FILE } from './odometer';
import { parseCarsLog, planOdometerImport, type ParsedLogRow } from './odometer-import';
import {
  decideCarSync,
  decideField,
  diffBooks,
  holdsDriver,
  planOdometerSync,
  type CarDecision,
  type EcmsRow,
  type OdometerSyncPlan,
} from './odometer-sync-import';
import {
  ODOMETER_SYNC_GO_LIVE_MARK,
  ODOMETER_SYNC_NEW_FILE,
  ODOMETER_SYNC_OLD_FILE,
} from './odometer-sync';

// ─── Rows, and a database of them in memory ──────────────────────────────────────────────────

/** Ids in the order rows were written — an ObjectId's first bytes are its second. */
let written = 0;
const nextId = (): Types.ObjectId => {
  written += 1;
  return new Types.ObjectId(`${(0x60000000 + written).toString(16)}${'0'.repeat(16)}`);
};

type Stored = EcmsRow & {
  vehicleCode?: string | null;
  km?: number | null;
  deletedAt?: Date | null;
  updatedBy?: unknown;
};

const V150 = 'aaaaaaaaaaaaaaaaaaaa0150';
const V151 = 'aaaaaaaaaaaaaaaaaaaa0151';
const REGISTRY = new Map([
  ['150', V150],
  ['151', V151],
]);
const AT = new Date('2026-09-29T12:00:00.000Z');
const d = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

const book = (over: Partial<ParsedLogRow> & { id: string }): ParsedLogRow => ({
  code: '150',
  date: d('2026-09-01'),
  out: 100,
  in: 150,
  driver: null,
  driver2: null,
  notes: null,
  deletion: { isDeleted: false, deletedAt: null },
  unreadable: false,
  ...over,
});

const ecms = (over: Partial<Stored>): Stored => ({
  _id: nextId(),
  __v: 0,
  vehicleId: new Types.ObjectId(V150),
  date: d('2026-09-01'),
  outReading: 100,
  inReading: null,
  driver1EmployeeId: null,
  driver2EmployeeId: null,
  driver1Name: null,
  driver2Name: null,
  notes: null,
  isDeleted: false,
  deletedBy: null,
  ...over,
});

/** What the import wrote for a book — every chain row, oldest id first, exactly as planned. */
const importOf = (
  rows: readonly ParsedLogRow[],
  registry: ReadonlyMap<string, string> = REGISTRY,
) => {
  const db = new Map<string, Stored[]>();
  for (const vehicle of planOdometerImport(rows, registry, new Map()).vehicles) {
    db.set(
      vehicle.code,
      vehicle.rows.map((row) =>
        ecms({
          vehicleId:
            vehicle.ref.vehicleId === null ? null : new Types.ObjectId(vehicle.ref.vehicleId),
          vehicleCode: vehicle.ref.vehicleId === null ? vehicle.code : null,
          date: row.date,
          outReading: row.out,
          inReading: row.in,
          km: row.in === null ? null : row.in - row.out,
          driver1Name: row.driver1.name,
          driver2Name: row.driver2.name,
          notes: row.notes,
          isDeleted: row.deleted,
          deletedAt: row.deleted ? row.deletion.deletedAt : null,
        }),
      ),
    );
  }
  return db;
};

/** Run a decision against the rows in memory, the way `applyOdometerSync` runs it on the database. */
const execute = (rows: Stored[], decision: CarDecision): void => {
  for (const update of decision.updates) {
    const row = rows.find((candidate) => String(candidate._id) === String(update.id));
    if (row === undefined || row.__v !== update.version) throw new Error('stale');
    Object.assign(row, update.set);
    row.__v += 1;
  }
  for (const doc of decision.inserts)
    rows.push({ ...ecms({}), ...(doc as Partial<Stored>), _id: nextId(), __v: 0 });
};

const sync = (
  oldRows: readonly ParsedLogRow[],
  newRows: readonly ParsedLogRow[],
  drivers: ReadonlyMap<string, string> = new Map(),
): OdometerSyncPlan => planOdometerSync(oldRows, newRows, REGISTRY, drivers);

const carOf = (plan: OdometerSyncPlan, code = '150') => {
  const car = plan.cars.find((candidate) => candidate.code === code);
  if (car === undefined) throw new Error(`no ${code} in the plan`);
  return car;
};

const live = (rows: readonly Stored[]) =>
  rows
    .filter((row) => !row.isDeleted)
    .sort(
      (a, b) => a.date.getTime() - b.date.getTime() || (a.outReading ?? 0) - (b.outReading ?? 0),
    )
    .map((row) => [row.outReading, row.inReading]);

// ─── The step, as the boot runs it ───────────────────────────────────────────────────────────

describe('the step refuses before its claim, and waits for the cars and the book', () => {
  // The source with its comments removed — naming a call in order to explain it must not be what
  // keeps this green (`go-live.spec.ts` says why).
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'odometer-sync.ts'),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const claim = source.indexOf('claimGoLiveRun(ODOMETER_SYNC_GO_LIVE_MARK');

  it.each([
    'dir === null',
    '!existsSync(oldFile) || !existsSync(newFile)',
    'waitForGoLiveRuns([VEHICLE_GO_LIVE_MARK, ODOMETER_GO_LIVE_MARK])',
    'rejected.length > 0',
    'admin === null',
  ])('%s is checked before the run is claimed', (refusal) => {
    expect(claim).toBeGreaterThan(-1);
    expect(source.indexOf(refusal), refusal).toBeGreaterThan(-1);
    expect(source.indexOf(refusal), refusal).toBeLessThan(claim);
  });

  it('is not awaited by the boot, and is skipped under test', () => {
    const start = source.slice(source.indexOf('export const startOdometerSyncGoLive'));
    expect(start).toContain('if (isTest) return;');
    expect(start).toContain('void runOdometerSyncGoLive().catch(');
  });
});

// ─── The two real files ──────────────────────────────────────────────────────────────────────

describe('the owner’s two exports of the odometer book', () => {
  const dir = resolveGoLiveDataDir() as string;
  const oldRaw = JSON.parse(readFileSync(join(dir, ODOMETER_SYNC_OLD_FILE), 'utf8')) as unknown[];
  const newRaw = JSON.parse(readFileSync(join(dir, ODOMETER_SYNC_NEW_FILE), 'utf8')) as unknown[];

  it('ships both — the one the import read, untouched, and the new one beside it', () => {
    expect(ODOMETER_SYNC_OLD_FILE, 'the old side IS what `go-live:odometer` imported').toBe(
      CARS_LOG_FILE,
    );
    expect(ODOMETER_SYNC_NEW_FILE).toBe('cars-log-2026-09-29.json');
    expect(oldRaw.length).toBe(20_322);
    expect(newRaw.length).toBe(21_197);
    expect(ODOMETER_SYNC_GO_LIVE_MARK).toBe('go-live:odometer-sync:v1');
  });

  it('differ, by the old system’s own id, in 875 new rows and 87 changed ones — and none removed', () => {
    const diff = diffBooks(oldRaw, newRaw);
    expect(diff.unidentified, 'every row carries an id, once').toEqual([]);
    expect(diff.added.length).toBe(875);
    expect(diff.changed.length).toBe(87);
    expect(diff.removed, 'no row of the first export is missing from the second').toEqual([]);
    expect(diff.fieldCounts).toEqual({
      in_num: 75,
      km: 72,
      deleted: 17,
      deleted_date: 17,
      deleted_by: 17,
      driver: 4,
      notes: 1,
    });
    const newRows = parseCarsLog(newRaw).rows.filter((row) => diff.added.includes(row.id));
    const days = newRows.map((row) => row.date.toISOString().slice(0, 10)).sort();
    expect([days[0], days[days.length - 1]]).toEqual(['2026-08-27', '2026-10-07']);
    expect(newRows.filter((row) => row.deletion.isDeleted).length, 'ten already deleted').toBe(10);
  });

  const cars = parseCars(JSON.parse(readFileSync(join(dir, 'cars.json'), 'utf8')));
  const registry = new Map(
    cars.cars.map((car, index) => [car.code, index.toString(16).padStart(24, '0')]),
  );
  const parsedOld = parseCarsLog(oldRaw);
  const parsedNew = parseCarsLog(newRaw);
  const plan = planOdometerSync(parsedOld.rows, parsedNew.rows, registry, new Map());

  it('plans, on the chain, 74 closing readings, 17 deletions, four drivers and a note — and nothing that moves a row', () => {
    expect(plan.planned).toEqual({ inReading: 74, deleted: 17, driver1: 4, notes: 1 });
    expect(plan.movedCars).toEqual([]);
    expect(plan.addedRows).toBe(875);
    expect(plan.keptDeleted).toBe(10);
    expect(plan.unknownCars, 'every new row names a car the registry has').toEqual([]);
    // Every changed closing reading closes a car's LAST row — the one the import left open.
    const closings = plan.cars.flatMap((car) =>
      car.changes.filter((change) => change.fields.includes('inReading')),
    );
    expect(closings.every((change) => change.old.chain.in === null)).toBe(true);
    // 66 of them by the book's own reading; eight only because a new row now follows them.
    expect(closings.filter((change) => change.next.parsed.in === null).length).toBe(8);
  });

  it('fifteen new rows share a car, a day and an opening reading with an old one — thirteen of them re-typed after the old one was deleted', () => {
    const keyOf = (code: string, row: { chain: { date: Date; out: number } }) =>
      `${code}|${row.chain.date.toISOString()}|${row.chain.out}`;
    const oldKeys = new Map(
      plan.cars.flatMap((car) => car.old.map((row) => [keyOf(car.code, row), row] as const)),
    );
    const shared = plan.cars.flatMap((car) =>
      car.added.filter((row) => oldKeys.has(keyOf(car.code, row))),
    );
    expect(shared.length).toBe(15);
    const deletedSince = new Set(
      plan.cars.flatMap((car) =>
        car.changes.filter((c) => c.fields.includes('deleted')).map((c) => c.id),
      ),
    );
    expect(
      plan.cars.flatMap((car) =>
        car.added.filter((row) => deletedSince.has(oldKeys.get(keyOf(car.code, row))?.id ?? '')),
      ).length,
    ).toBe(13);
  });

  it('leaves EXACTLY the chain a fresh import of the new book writes — and a second run writes nothing', () => {
    const db = importOf(parsedOld.rows, registry);
    const totals = {
      updates: 0,
      inserts: 0,
      deletedByBook: 0,
      writtenDeleted: 0,
      changed: {} as Record<string, number>,
    };
    for (const car of plan.cars) {
      const rows = db.get(car.code) ?? [];
      const decision = decideCarSync(car, rows, new Map(), AT);
      expect(decision.keptEcmsEdits, 'nobody touched anything').toEqual([]);
      expect(decision.unapplied).toEqual([]);
      expect(decision.openConflicts).toEqual([]);
      execute(rows, decision);
      db.set(car.code, rows);
      totals.updates += decision.updates.length;
      totals.inserts += decision.inserts.length;
      totals.deletedByBook += decision.deletedByBook;
      totals.writtenDeleted += decision.writtenDeleted;
      for (const [field, count] of Object.entries(decision.changed))
        totals.changed[field] = (totals.changed[field] ?? 0) + count;
    }
    expect(totals).toEqual({
      updates: 93, // 96 field changes on 93 rows — two rows change a closing reading AND a driver
      inserts: 875,
      deletedByBook: 17,
      writtenDeleted: 10,
      changed: { inReading: 74, driver1: 4, notes: 1 },
    });

    const signature = (row: {
      date: Date;
      out: number | null;
      in: number | null;
      deleted: boolean;
      d1: string | null;
      d2: string | null;
      notes: string | null;
    }) =>
      [row.date.toISOString(), row.out, row.in, row.deleted, row.d1, row.d2, row.notes].join('|');
    for (const vehicle of planOdometerImport(parsedNew.rows, registry, new Map()).vehicles) {
      const fresh = vehicle.rows
        .map((row) =>
          signature({
            date: row.date,
            out: row.out,
            in: row.in,
            deleted: row.deleted,
            d1: row.driver1.name,
            d2: row.driver2.name,
            notes: row.notes,
          }),
        )
        .sort();
      const rows = db.get(vehicle.code) ?? [];
      const synced = rows
        .map((row) =>
          signature({
            date: row.date,
            out: row.outReading,
            in: row.inReading,
            deleted: row.isDeleted,
            d1: row.driver1Name,
            d2: row.driver2Name,
            notes: row.notes,
          }),
        )
        .sort();
      expect(synced, `${vehicle.code}: the chain a fresh import of the new book writes`).toEqual(
        fresh,
      );
      const open = rows.filter(
        (row) => row.vehicleId !== null && !row.isDeleted && row.inReading === null,
      );
      expect(open.length, `${vehicle.code}: one open period — ux_open_period`).toBeLessThanOrEqual(
        1,
      );
    }

    // The take-over: every row already written, every change already there.
    let again = 0;
    let alreadyThere = 0;
    let changesAlreadyThere = 0;
    for (const car of plan.cars) {
      const decision = decideCarSync(car, db.get(car.code) ?? [], new Map(), AT);
      again += decision.updates.length + decision.inserts.length;
      alreadyThere += decision.alreadyThere;
      changesAlreadyThere += decision.changesAlreadyThere;
    }
    expect(again, 'not one write the second time').toBe(0);
    expect(alreadyThere).toBe(875);
    expect(changesAlreadyThere).toBe(96);
  });
});

// ─── The book diff, on its own ───────────────────────────────────────────────────────────────

describe('reading the two exports against each other', () => {
  const raw = (id: string, over: Record<string, unknown> = {}) => ({
    _id: { $oid: id },
    car_code: '150',
    date: { $date: '2026-09-01T00:00:00.000Z' },
    out_num: '100',
    in_num: '',
    deleted: 0,
    ...over,
  });

  it('a field written empty, left out or null is one value — nothing; a trailing space is no change', () => {
    const diff = diffBooks(
      [raw('a', { notes: '' }), raw('b', { driver: 'سائق' })],
      [raw('a', { deleted_date: null }), raw('b', { driver: 'سائق ' })],
    );
    expect(diff.changed).toEqual([]);
  });

  it('names what changed in the book’s own words, and reports what one side alone has', () => {
    const diff = diffBooks(
      [raw('a'), raw('gone')],
      [raw('a', { in_num: '160', km: '60' }), raw('new')],
    );
    expect(diff.changed).toEqual([{ id: 'a', fields: ['in_num', 'km'] }]);
    expect(diff.added).toEqual(['new']);
    expect(diff.removed, 'reported — never deleted because an export left it out').toEqual([
      'gone',
    ]);
  });

  it('a row with no id, or an id twice, cannot be joined — and is named', () => {
    const diff = diffBooks([raw('a'), { car_code: '150' }], [raw('a'), raw('a')]);
    expect(diff.unidentified).toEqual([
      { file: 'old', row: 1, reason: 'no _id' },
      { file: 'new', row: 1, reason: '_id a twice' },
    ]);
  });
});

// ─── The three-way rule ──────────────────────────────────────────────────────────────────────

describe('the three-way rule', () => {
  it.each([
    [true, true, 'alreadyNew'],
    [true, false, 'alreadyNew'],
    [false, true, 'apply'],
    [false, false, 'keptEcmsEdit'],
  ] as const)('ECMS = new: %s, ECMS = old: %s → %s', (isNew, isOld, verdict) => {
    expect(decideField(isNew, isOld)).toBe(verdict);
  });

  it('knows a driver by HR’s employee for the spelling, by the spelling kept as text, or as nobody', () => {
    const employee = new Types.ObjectId();
    const ids = new Map([['مصطفى عثمان', String(employee)]]);
    const nobody = (name: string) => name === 'احتياطى';
    expect(holdsDriver({ id: employee, name: null }, 'مصطفى عثمان', ids, nobody)).toBe(true);
    expect(
      holdsDriver({ id: null, name: 'مصطفى عثمان' }, 'مصطفى عثمان', ids, nobody),
      'written as text before HR knew him',
    ).toBe(true);
    expect(holdsDriver({ id: null, name: 'سائق' }, 'سائق', ids, nobody)).toBe(true);
    expect(holdsDriver({ id: null, name: null }, 'احتياطى', ids, nobody)).toBe(true);
    expect(holdsDriver({ id: null, name: null }, null, ids, nobody)).toBe(true);
    expect(
      holdsDriver({ id: new Types.ObjectId(), name: null }, 'مصطفى عثمان', ids, nobody),
      'another employee',
    ).toBe(false);
    expect(holdsDriver({ id: null, name: 'سائق' }, null, ids, nobody)).toBe(false);
  });
});

describe('bringing a change onto the row the import wrote', () => {
  // The first export: the car's last row open, as the import left it.
  const OLD = [
    book({ id: 'a', date: d('2026-09-01'), out: 100, in: 150 }),
    book({ id: 't', date: d('2026-09-02'), out: 150, in: null, driver: 'ايمن خليفه' }),
  ];
  // The second: the old tail closed by the book's own reading, and two new days after it.
  const NEW = [
    book({ id: 'a', date: d('2026-09-01'), out: 100, in: 150 }),
    book({
      id: 't',
      date: d('2026-09-02'),
      out: 150,
      in: 190,
      driver: 'ايمن حسن مصطفى عبد السلام',
      notes: 'اسوان',
    }),
    book({ id: 'n1', date: d('2026-09-03'), out: 190, in: 240 }),
    book({ id: 'n2', date: d('2026-09-04'), out: 240, in: null }),
  ];

  it('writes the new value where ECMS still has the old one — the tail closed, the new rows after it, the new tail open', () => {
    const rows = importOf(OLD).get('150') as Stored[];
    const decision = decideCarSync(carOf(sync(OLD, NEW)), rows, new Map(), AT);
    expect(decision.changed).toEqual({ inReading: 1, driver1: 1, notes: 1 });
    expect(decision.updates).toHaveLength(1);
    expect(decision.updates[0]?.set).toMatchObject({
      inReading: 190,
      km: 40,
      driver1EmployeeId: null,
      driver1Name: 'ايمن حسن مصطفى عبد السلام',
      notes: 'اسوان',
    });
    expect(decision.updates[0]?.version, 'decided against the version it read').toBe(rows[1]?.__v);
    execute(rows, decision);
    expect(live(rows)).toEqual([
      [100, 150],
      [150, 190],
      [190, 240],
      [240, null],
    ]);
  });

  it('writes the employee HR knows by the new spelling, where HR knows one', () => {
    const employee = String(new Types.ObjectId());
    const drivers = new Map([['ايمن حسن مصطفى عبد السلام', employee]]);
    const rows = importOf(OLD).get('150') as Stored[];
    const decision = decideCarSync(carOf(sync(OLD, NEW, drivers)), rows, drivers, AT);
    expect(String(decision.updates[0]?.set['driver1EmployeeId'])).toBe(employee);
    expect(decision.updates[0]?.set['driver1Name']).toBeNull();
  });

  it('counts, and does not write, what ECMS already has', () => {
    const rows = importOf(OLD).get('150') as Stored[];
    Object.assign(rows[1] as Stored, {
      inReading: 190,
      driver1Name: 'ايمن حسن مصطفى عبد السلام',
      notes: 'اسوان',
    });
    const decision = decideCarSync(carOf(sync(OLD, NEW)), rows, new Map(), AT);
    expect(decision.changesAlreadyThere).toBe(3);
    expect(decision.updates).toEqual([]);
    expect(decision.changed).toEqual({});
  });

  it('KEEPS what a person changed on ECMS since, and lists it with the car, the day and all three values', () => {
    const rows = importOf(OLD).get('150') as Stored[];
    Object.assign(rows[1] as Stored, { inReading: 185, __v: 1 });
    const decision = decideCarSync(carOf(sync(OLD, NEW)), rows, new Map(), AT);
    expect(decision.keptEcmsEdits).toEqual([
      { code: '150', date: '2026-09-02', field: 'inReading', ecms: '185', old: null, new: '190' },
    ]);
    expect(decision.updates[0]?.set, 'the driver and the note still land').not.toHaveProperty(
      'inReading',
    );
    expect(decision.changed).toEqual({ driver1: 1, notes: 1 });
  });

  it('lists a change to a row ECMS no longer has where the import put it', () => {
    const rows = importOf(OLD).get('150') as Stored[];
    Object.assign(rows[1] as Stored, { outReading: 151 }); // corrected on ECMS: a different key now
    const decision = decideCarSync(carOf(sync(OLD, NEW)), rows, new Map(), AT);
    expect(decision.unapplied).toEqual([
      '150 2026-09-02: inReading, driver1, notes — the reading is not where the import wrote it',
    ]);
  });

  it('a row the next new row closes — the book still gives it no closing reading — is closed by the chain', () => {
    const newBook = [
      OLD[0] as ParsedLogRow,
      OLD[1] as ParsedLogRow,
      book({ id: 'n1', date: d('2026-09-03'), out: 170, in: null }),
    ];
    const rows = importOf(OLD).get('150') as Stored[];
    const decision = decideCarSync(carOf(sync(OLD, newBook)), rows, new Map(), AT);
    expect(decision.updates[0]?.set).toMatchObject({ inReading: 170, km: 20 });
    execute(rows, decision);
    expect(live(rows)).toEqual([
      [100, 150],
      [150, 170],
      [170, null],
    ]);
  });
});

describe('a row the old system has deleted since', () => {
  const OLD = [
    book({ id: 'a', date: d('2026-09-15'), out: 100, in: 150 }),
    book({ id: 't', date: d('2026-09-16'), out: 150, in: null }),
  ];
  const deletedAt = new Date('2026-09-20T07:46:26.203Z');
  // The old system deleted the 16th, went back for the days it had missed, and typed the 16th
  // again with the same reading — the shape of thirteen cars in the real export.
  const NEW = [
    book({ id: 'a', date: d('2026-09-15'), out: 100, in: 150 }),
    book({
      id: 't',
      date: d('2026-09-16'),
      out: 150,
      in: null,
      deletion: { isDeleted: true, deletedAt },
    }),
    book({ id: 'again', date: d('2026-09-16'), out: 150, in: 180 }),
    book({ id: 'n', date: d('2026-09-17'), out: 180, in: null }),
  ];

  it('is deleted SOFTLY — the old system’s day, no user — and its twin is WRITTEN, not taken for it', () => {
    const rows = importOf(OLD).get('150') as Stored[];
    const decision = decideCarSync(carOf(sync(OLD, NEW)), rows, new Map(), AT);
    expect(decision.deletedByBook).toBe(1);
    expect(decision.updates).toEqual([
      { id: rows[1]?._id, version: 0, set: { isDeleted: true, deletedAt, deletedBy: null } },
    ]);
    expect(
      decision.alreadyThere,
      'the re-typed row is new, whatever it shares with the old one',
    ).toBe(0);
    expect(decision.inserts.map((doc) => [doc.outReading, doc.inReading, doc.isDeleted])).toEqual([
      [150, 180, false],
      [180, null, false],
    ]);
    execute(rows, decision);
    expect(live(rows)).toEqual([
      [100, 150],
      [150, 180],
      [180, null],
    ]);
    expect(
      rows.filter((row) => row.isDeleted).map((row) => [row.outReading, row.deletedAt]),
      'still in the database',
    ).toEqual([[150, deletedAt]]);
  });

  it('a take-over finds the deleted one as the OLD row and its twin as already written — nothing twice', () => {
    const rows = importOf(OLD).get('150') as Stored[];
    const plan = sync(OLD, NEW);
    execute(rows, decideCarSync(carOf(plan), rows, new Map(), AT));
    const again = decideCarSync(carOf(plan), rows, new Map(), AT);
    expect(again.updates).toEqual([]);
    expect(again.inserts).toEqual([]);
    expect(again.alreadyThere).toBe(2);
    expect(again.changesAlreadyThere, 'the deletion is already there').toBe(1);
  });

  it('is NOT deleted where somebody changed it on ECMS — kept, and listed', () => {
    const rows = importOf(OLD).get('150') as Stored[];
    Object.assign(rows[1] as Stored, { driver1Name: 'سائق صححه أحد', __v: 1 });
    const decision = decideCarSync(carOf(sync(OLD, NEW)), rows, new Map(), AT);
    expect(decision.deletedByBook).toBe(0);
    expect(decision.keptEcmsEdits).toEqual([
      {
        code: '150',
        date: '2026-09-16',
        field: 'deleted',
        ecms: 'live — driver1 changed on ECMS',
        old: 'live',
        new: 'deleted',
      },
    ]);
    expect(decision.updates).toEqual([]);
    // It is still the car's open period, so the new tail cannot be one too: it is kept deleted,
    // and the car is named — the import's own rule.
    expect(decision.openConflicts).toEqual(['150 2026-09-17']);
    expect(decision.inserts.at(-1)).toMatchObject({
      outReading: 180,
      inReading: null,
      isDeleted: true,
      deletedAt: AT,
    });
  });

  it('a deletion ECMS already has is counted, not written', () => {
    const rows = importOf(OLD).get('150') as Stored[];
    Object.assign(rows[1] as Stored, { isDeleted: true, deletedBy: new Types.ObjectId() });
    const decision = decideCarSync(carOf(sync(OLD, NEW)), rows, new Map(), AT);
    expect(decision.changesAlreadyThere).toBe(1);
    expect(decision.updates).toEqual([]);
  });
});

describe('a row the old system had deleted, and has brought back since', () => {
  const OLD = [
    book({ id: 'a', date: d('2026-09-01'), out: 100, in: 150 }),
    book({
      id: 'g',
      date: d('2026-09-02'),
      out: 150,
      in: 170,
      deletion: { isDeleted: true, deletedAt: AT },
    }),
    book({ id: 'b', date: d('2026-09-03'), out: 170, in: null }),
  ];
  const NEW = [
    OLD[0] as ParsedLogRow,
    book({ ...OLD[1], id: 'g', deletion: { isDeleted: false, deletedAt: null } }),
    OLD[2] as ParsedLogRow,
  ];

  it('comes back where ECMS still has it as the import wrote it', () => {
    const rows = importOf(OLD).get('150') as Stored[];
    const decision = decideCarSync(carOf(sync(OLD, NEW)), rows, new Map(), AT);
    expect(decision.restoredByBook).toBe(1);
    expect(decision.updates).toEqual([
      { id: rows[1]?._id, version: 0, set: { isDeleted: false, deletedAt: null, deletedBy: null } },
    ]);
  });

  it('stays deleted where a PERSON deleted it — their id is on it — and is listed', () => {
    const rows = importOf(OLD).get('150') as Stored[];
    Object.assign(rows[1] as Stored, { deletedBy: new Types.ObjectId() });
    const decision = decideCarSync(carOf(sync(OLD, NEW)), rows, new Map(), AT);
    expect(decision.restoredByBook).toBe(0);
    expect(decision.updates).toEqual([]);
    expect(decision.keptEcmsEdits).toEqual([
      {
        code: '150',
        date: '2026-09-02',
        field: 'deleted',
        ecms: 'deleted on ECMS',
        old: 'deleted',
        new: 'live',
      },
    ]);
  });
});

describe('new rows, and the car’s one open period', () => {
  const OLD = [book({ id: 't', date: d('2026-09-16'), out: 150, in: null })];
  const NEW = [
    book({ id: 't', date: d('2026-09-16'), out: 150, in: 200 }),
    book({ id: 'n1', date: d('2026-09-17'), out: 200, in: null }),
  ];

  it('a reading a person already typed on ECMS is counted as there — not written twice', () => {
    const rows = importOf(OLD).get('150') as Stored[];
    rows.push(ecms({ date: d('2026-09-17'), outReading: 200, inReading: null }));
    const decision = decideCarSync(carOf(sync(OLD, NEW)), rows, new Map(), AT);
    expect(decision.alreadyThere).toBe(1);
    expect(decision.inserts).toEqual([]);
  });

  it('the book’s deleted row and its live twin each find their own — the live one is not written again', () => {
    const newBook = [
      ...NEW,
      book({
        id: 'n0',
        date: d('2026-09-17'),
        out: 200,
        in: 250,
        deletion: { isDeleted: true, deletedAt: AT },
      }),
    ];
    const rows = importOf(OLD).get('150') as Stored[];
    rows.push(ecms({ date: d('2026-09-17'), outReading: 200, inReading: null }));
    const decision = decideCarSync(carOf(sync(OLD, newBook)), rows, new Map(), AT);
    expect(decision.alreadyThere).toBe(1);
    expect(decision.inserts.map((doc) => [doc.outReading, doc.inReading, doc.isDeleted])).toEqual([
      [200, 250, true],
    ]);
  });

  it('closes the new tail against a reading typed on the new screen AFTER it — the import’s rule', () => {
    const rows = importOf(OLD).get('150') as Stored[];
    // What ECMS did when the reading of the 20th was recorded: it closed the book's tail with it.
    Object.assign(rows[0] as Stored, { inReading: 260, __v: 1 });
    rows.push(ecms({ date: d('2026-09-20'), outReading: 260, inReading: null }));
    const decision = decideCarSync(carOf(sync(OLD, NEW)), rows, new Map(), AT);
    expect(decision.keptEcmsEdits.map((edit) => [edit.field, edit.ecms, edit.new])).toEqual([
      ['inReading', '260', '200'],
    ]);
    expect(decision.closedByExisting).toBe(1);
    expect(decision.inserts).toMatchObject([
      { outReading: 200, inReading: 260, km: 60, isDeleted: false },
    ]);
  });

  it('writes the new tail DELETED, and names the car, when the reading typed on ECMS comes before it', () => {
    const rows = importOf(OLD).get('150') as Stored[];
    Object.assign(rows[0] as Stored, { inReading: 170, __v: 1 });
    rows.push(ecms({ date: d('2026-09-16'), outReading: 170, inReading: null }));
    const decision = decideCarSync(carOf(sync(OLD, NEW)), rows, new Map(), AT);
    expect(decision.openConflicts).toEqual(['150 2026-09-17']);
    expect(decision.writtenDeleted).toBe(1);
    expect(decision.inserts).toMatchObject([
      { outReading: 200, inReading: null, isDeleted: true, deletedAt: AT, deletedBy: null },
    ]);
  });

  it('brings back a tail an earlier run BURIED, once the new book closes it', () => {
    const rows = importOf(OLD).get('150') as Stored[];
    Object.assign(rows[0] as Stored, { isDeleted: true, deletedAt: AT });
    const decision = decideCarSync(carOf(sync(OLD, NEW)), rows, new Map(), AT);
    expect(decision.restored).toBe(1);
    expect(decision.restoredByBook, 'the book did not bring it back — it never deleted it').toBe(0);
    expect(decision.updates[0]?.set).toEqual({
      inReading: 200,
      km: 50,
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
    });
    execute(rows, decision);
    expect(live(rows)).toEqual([
      [150, 200],
      [200, null],
    ]);
  });

  it('never REOPENS a row while a reading typed on ECMS holds the car’s open period', () => {
    const oldBook = [
      book({ id: 'a', date: d('2026-09-15'), out: 100, in: null }),
      book({ id: 'b', date: d('2026-09-16'), out: 150, in: null }),
    ];
    // The old system deleted the last row since: the one before it is the book's last again.
    const newBook = [
      oldBook[0] as ParsedLogRow,
      book({ ...oldBook[1], id: 'b', deletion: { isDeleted: true, deletedAt: AT } }),
    ];
    const rows = importOf(oldBook).get('150') as Stored[];
    Object.assign(rows[1] as Stored, { inReading: 170, __v: 1 });
    rows.push(ecms({ date: d('2026-09-14'), outReading: 170, inReading: null }));
    const decision = decideCarSync(carOf(sync(oldBook, newBook)), rows, new Map(), AT);
    expect(
      decision.keptEcmsEdits.map((edit) => edit.field),
      'row b was closed by that reading',
    ).toEqual(['deleted']);
    expect(decision.openConflicts).toEqual(['150 2026-09-15']);
    expect(decision.updates, 'row a keeps its closing').toEqual([]);
  });

  it('a car the registry never had keeps its rows by code, on no chain', () => {
    const oldBook = [book({ id: 'x', code: 'تويوتا1', out: 1, in: null })];
    const newBook = [
      book({ id: 'x', code: 'تويوتا1', out: 1, in: 2 }),
      book({ id: 'y', code: 'تويوتا1', date: d('2026-09-02'), out: 2, in: null }),
    ];
    const plan = sync(oldBook, newBook);
    expect(plan.unknownCars).toEqual(['تويوتا1 (1)']);
    const rows = importOf(oldBook).get('تويوتا1') as Stored[];
    rows.push(
      ecms({
        vehicleId: null,
        vehicleCode: 'تويوتا1',
        date: d('2026-09-05'),
        outReading: 9,
        inReading: null,
      }),
    );
    const decision = decideCarSync(carOf(plan, 'تويوتا1'), rows, new Map(), AT);
    expect(decision.openConflicts).toEqual([]);
    expect(decision.inserts).toMatchObject([
      { vehicleId: null, vehicleCode: 'تويوتا1', outReading: 2, inReading: null, isDeleted: false },
    ]);
  });

  it('a car in both refs — its old rows under the book’s code — is still matched, not written twice', () => {
    const rows = importOf(OLD, new Map()).get('150') as Stored[];
    expect(rows[0]?.vehicleId, 'written when the registry did not have the car').toBeNull();
    const decision = decideCarSync(carOf(sync(OLD, NEW)), rows, new Map(), AT);
    expect(decision.unapplied).toEqual([]);
    expect(decision.updates).toHaveLength(1);
  });
});

describe('what the new rows needed from the chain, counted for them alone', () => {
  it('opened at the car’s last reading, closed by the next, a closing below its opening', () => {
    const oldBook = [book({ id: 'a', out: 100, in: 150 })];
    const newBook = [
      oldBook[0] as ParsedLogRow,
      book({ id: 'b', date: d('2026-09-02'), out: null, in: 170, driver: 'احتياطى' }),
      book({ id: 'c', date: d('2026-09-03'), out: 170, in: 5, driver: 'سائق جديد' }),
      book({
        id: 'e',
        date: d('2026-09-04'),
        out: 200,
        in: null,
        deletion: { isDeleted: true, deletedAt: AT },
      }),
      book({ id: 'f', date: d('2026-09-05'), out: 210, in: null }),
    ];
    const plan = sync(oldBook, newBook);
    expect(plan).toMatchObject({
      addedRows: 4,
      keptDeleted: 1,
      openedByPrevious: 1,
      badInReading: 1,
      closedByNext: 1,
      writtenSpellings: ['احتياطى', 'سائق جديد'],
    });
    expect([...plan.addedIds].sort()).toEqual(['b', 'c', 'e', 'f']);
  });
});
