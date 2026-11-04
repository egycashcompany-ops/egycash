// The registers' OWN order, indexed — and the chain's total order beside it.
//
// `BaseRepository.list` sorts every page by the column asked for and then by `_id`, inside
// `isDeleted: false`. None of the odometer log, the workshop visits or the accident files had an
// index that hands rows over in that order, so each page of each register was a sort in memory and
// each total a read of every row to look at `isDeleted` — and the odometer log is a reading per car
// per day. Pinned here, for each index: its exact keys (the order IS the point), its name (the boot
// builder builds by name, and production builds nothing else — `autoIndex` is off and the deploy's
// index sync only reports), that it constrains nothing, and that the Fleet index step plans it.
//
// The screens' opening order is read from the screens themselves: an index serves the order the
// register is actually opened in, and a screen that changed its default would leave it serving none.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Model } from 'mongoose';
import { FleetOdometerLogModel } from './odometer/odometer.model';
import { FleetMaintenanceVisitModel } from './maintenance/maintenance.model';
import { FleetAccidentModel } from './accidents/accident.model';
import { fleetIndexedModels, indexBuildPlan } from './fleet-indexes';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGES = join(HERE, '../../../../web/src/modules/fleet/pages');

type IndexSpec = [Record<string, unknown>, Record<string, unknown> | undefined];

const declared = (model: Model<never>, name: string): IndexSpec | undefined =>
  (model.schema.indexes() as IndexSpec[]).find(([, options]) => options?.name === name);

const planned = (collection: string, name: string) => {
  const entry = fleetIndexedModels().find((row) => row.collection === collection);
  expect(entry, `${collection} is in the Fleet index step`).toBeDefined();
  return indexBuildPlan(entry?.model.schema.indexes() ?? []).find(
    (item) => item.options['name'] === name,
  );
};

/** The `DEFAULT_SORT` a register's page opens on, as the page spells it. */
const openingSort = (page: string): string | undefined =>
  /const DEFAULT_SORT = '([^']+)';/.exec(readFileSync(join(PAGES, page), 'utf8'))?.[1];

const REGISTERS = [
  {
    register: 'the odometer log',
    model: FleetOdometerLogModel as unknown as Model<never>,
    collection: 'fleet_odometer_logs',
    name: 'ix_list_date',
    keys: { isDeleted: 1, date: -1, _id: -1 },
    page: 'OdometerPage.tsx',
    opens: 'date:desc',
  },
  {
    register: 'the workshop visits',
    model: FleetMaintenanceVisitModel as unknown as Model<never>,
    collection: 'fleet_maintenance_visits',
    name: 'ix_list_in',
    keys: { isDeleted: 1, inDate: -1, _id: -1 },
    page: 'MaintenancePage.tsx',
    opens: 'inDate:desc',
  },
  {
    register: 'the accident files',
    model: FleetAccidentModel as unknown as Model<never>,
    collection: 'fleet_accidents',
    name: 'ix_list_occurred',
    keys: { isDeleted: 1, occurredAt: -1, _id: -1 },
    page: 'AccidentsPage.tsx',
    opens: 'occurredAt:desc',
  },
] as const;

describe.each(REGISTERS)('$register — $name', (row) => {
  it('is the soft delete, then the opening column, then the `_id` tie-break — in that order', () => {
    const [fields] = declared(row.model, row.name) ?? [];
    // `toEqual` ignores key order; the order of an index's keys is what makes it serve the sort.
    expect(Object.entries(fields ?? {})).toEqual(Object.entries(row.keys));
  });

  it('constrains nothing: not unique, not partial, not sparse — every row is in it', () => {
    const [, options] = declared(row.model, row.name) ?? [];
    expect(options?.unique).not.toBe(true);
    expect(options?.partialFilterExpression).toBeUndefined();
    expect(options?.sparse).not.toBe(true);
  });

  it('is in the Fleet index step’s plan, by name — the only way production gets it', () => {
    const entry = planned(row.collection, row.name);
    expect(entry?.keys).toEqual(row.keys);
    expect(entry?.unique).toBe(false);
  });

  it('serves the order the screen actually opens on', () => {
    expect(openingSort(row.page)).toBe(row.opens);
    const [column, dir] = row.opens.split(':');
    const [fields] = declared(row.model, row.name) ?? [];
    const keys = Object.entries(fields ?? {});
    // The column right after the soft delete, in the screen's direction — and `_id` the same way,
    // as `BaseRepository.list` appends it for a single-column order.
    expect(keys[1]).toEqual([column, dir === 'desc' ? -1 : 1]);
    expect(keys[2]).toEqual(['_id', dir === 'desc' ? -1 : 1]);
  });
});

describe('ix_vehicle_chain — each car’s chain in its TOTAL order', () => {
  const odometer = FleetOdometerLogModel as unknown as Model<never>;
  const repository = readFileSync(join(HERE, 'odometer/odometer.repository.ts'), 'utf8');

  it('is the car, then the opening reading, then the insert — `NEWEST_FIRST` behind the car', () => {
    const [fields, options] = declared(odometer, 'ix_vehicle_chain') ?? [];
    expect(Object.entries(fields ?? {})).toEqual([
      ['vehicleId', 1],
      ['outReading', -1],
      ['_id', -1],
    ]);
    expect(options?.unique).not.toBe(true);
    expect(options?.partialFilterExpression).toBeUndefined();
    // The order it serves is the repository's own constant, so the two cannot drift apart unseen.
    expect(repository).toContain('const NEWEST_FIRST = { outReading: -1, _id: -1 } as const;');
    expect(repository, 'the alarm’s bounds sort by it').toContain(
      '{ $sort: { vehicleId: 1, outReading: -1, _id: -1 } }',
    );
  });

  it('is a NEW name — `ix_vehicle_reading` keeps the keys it was built with', () => {
    // The builder skips a name that is present, so widening `ix_vehicle_reading` in place would
    // never reach production — and the deploy's index sync would report it as drift every time.
    const [fields] = declared(odometer, 'ix_vehicle_reading') ?? [];
    expect(Object.entries(fields ?? {})).toEqual([
      ['vehicleId', 1],
      ['outReading', -1],
    ]);
  });

  it('is in the Fleet index step’s plan, by name', () => {
    const entry = planned('fleet_odometer_logs', 'ix_vehicle_chain');
    expect(entry?.keys).toEqual({ vehicleId: 1, outReading: -1, _id: -1 });
    expect(entry?.unique).toBe(false);
  });
});

describe('no new name collides with one already declared', () => {
  it('every index of the three collections has a name of its own', () => {
    for (const { model } of REGISTERS) {
      const names = (model.schema.indexes() as IndexSpec[]).map(([, options]) => options?.name);
      expect(new Set(names).size, model.collection.name).toBe(names.length);
    }
  });
});
