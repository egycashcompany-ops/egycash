// The odometer log's DAY index (fleet dashboard plan K-22, P1-04).
//
// The period reads ask by day across the whole fleet — the rows of [from, to + 1] for the km tabs,
// and «which cars were read since today − N» for the no-reading alert (R-07). Every other index on
// the collection leads with the car, which answers those questions only by walking each car's whole
// history; this one leads with the date. Pinned here: its shape, its name (the index step builds by
// name), that it constrains nothing, and that the index step plans it.
import { describe, expect, it } from 'vitest';
import { FleetOdometerLogModel } from './odometer.model';
import { fleetIndexedModels, indexBuildPlan } from '../fleet-indexes';

type IndexSpec = [Record<string, unknown>, Record<string, unknown> | undefined];

const declared = (): IndexSpec[] => FleetOdometerLogModel.schema.indexes() as IndexSpec[];
const byName = (name: string): IndexSpec | undefined =>
  declared().find(([, options]) => options?.name === name);

describe('ix_date — the odometer log by day, newest first', () => {
  it('is declared on the date alone, descending', () => {
    const [fields] = byName('ix_date') ?? [];
    expect(fields).toEqual({ date: -1 });
  });

  it('constrains nothing: not unique, not partial, not sparse — every row is in it', () => {
    const [, options] = byName('ix_date') ?? [];
    expect(options?.unique).not.toBe(true);
    expect(options?.partialFilterExpression).toBeUndefined();
    expect(options?.sparse).not.toBe(true);
  });

  it('is the only index that leads with the date', () => {
    const leading = declared().filter(([fields]) => Object.keys(fields)[0] === 'date');
    expect(leading.map(([, options]) => options?.name)).toEqual(['ix_date']);
  });

  it('keeps the indexes the chain already relies on', () => {
    for (const name of [
      'ux_open_period',
      'ix_code_date',
      'ix_vehicle_reading',
      'ix_vehicle_date',
    ]) {
      expect(byName(name), name).toBeDefined();
    }
  });

  it('is in the Fleet index step’s plan for fleet_odometer_logs, by name', () => {
    const odometer = fleetIndexedModels().find(
      (entry) => entry.collection === 'fleet_odometer_logs',
    );
    expect(odometer).toBeDefined();
    const plan = indexBuildPlan(odometer?.model.schema.indexes() ?? []);
    const entry = plan.find((item) => item.options['name'] === 'ix_date');
    expect(entry?.keys).toEqual({ date: -1 });
    expect(entry?.unique).toBe(false);
  });
});
