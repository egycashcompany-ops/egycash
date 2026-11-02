// The workshop visits' CHECK-IN day index (fleet dashboard plan K-22, P1-05).
//
// The period tabs ask «which visits checked in during [from, to]» across the whole fleet, and the
// recent records ask «which were written for the last 30 days». Every other index on the collection
// leads with the car, its code or the work type, which answers those questions only by walking each
// car's history; this one leads with `inDate`. Pinned here: its shape, its name (the index step
// builds by name), that it constrains nothing, and that the index step plans it.
import { describe, expect, it } from 'vitest';
import { FleetMaintenanceVisitModel } from './maintenance.model';
import { fleetIndexedModels, indexBuildPlan } from '../fleet-indexes';

type IndexSpec = [Record<string, unknown>, Record<string, unknown> | undefined];

const declared = (): IndexSpec[] => FleetMaintenanceVisitModel.schema.indexes() as IndexSpec[];
const byName = (name: string): IndexSpec | undefined =>
  declared().find(([, options]) => options?.name === name);

describe('ix_in_date — the workshop visits by check-in day, newest first', () => {
  it('is declared on the check-in day alone, descending', () => {
    const [fields] = byName('ix_in_date') ?? [];
    expect(fields).toEqual({ inDate: -1 });
  });

  it('constrains nothing: not unique, not partial, not sparse — every visit is in it', () => {
    const [, options] = byName('ix_in_date') ?? [];
    expect(options?.unique).not.toBe(true);
    expect(options?.partialFilterExpression).toBeUndefined();
    expect(options?.sparse).not.toBe(true);
  });

  it('is the only index that leads with the check-in day', () => {
    const leading = declared().filter(([fields]) => Object.keys(fields)[0] === 'inDate');
    expect(leading.map(([, options]) => options?.name)).toEqual(['ix_in_date']);
  });

  it('keeps the indexes the register already relies on — FR-4’s one open visit included', () => {
    for (const name of ['ux_open_visit', 'ix_code_in', 'ix_vehicle_out', 'ix_worktype_out']) {
      expect(byName(name), name).toBeDefined();
    }
    const [, open] = byName('ux_open_visit') ?? [];
    expect(open?.unique).toBe(true);
  });

  it('is in the Fleet index step’s plan for fleet_maintenance_visits, by name', () => {
    const visits = fleetIndexedModels().find(
      (entry) => entry.collection === 'fleet_maintenance_visits',
    );
    expect(visits).toBeDefined();
    const plan = indexBuildPlan(visits?.model.schema.indexes() ?? []);
    const entry = plan.find((item) => item.options['name'] === 'ix_in_date');
    expect(entry?.keys).toEqual({ inDate: -1 });
    expect(entry?.unique).toBe(false);
  });
});

describe('the dashboard’s two other read indexes on the visits', () => {
  it('ix_vehicle_in — each car’s newest visit in one seek, in the `$sort` order newestVisits asks', () => {
    const [fields, options] = byName('ix_vehicle_in') ?? [];
    expect(fields).toEqual({ vehicleId: 1, inDate: -1, _id: -1 });
    expect(options?.unique).not.toBe(true);
    expect(options?.partialFilterExpression).toBeUndefined();
  });

  it('ix_out_date — the check-out day across the fleet (the recent records’ `$or`, the open count)', () => {
    const [fields, options] = byName('ix_out_date') ?? [];
    expect(fields).toEqual({ outDate: -1 });
    expect(options?.unique).not.toBe(true);
    expect(options?.partialFilterExpression).toBeUndefined();
    expect(options?.sparse).not.toBe(true); // a sparse index could not answer `outDate: null`
  });

  it('both are in the Fleet index step’s plan, by name', () => {
    const visits = fleetIndexedModels().find(
      (entry) => entry.collection === 'fleet_maintenance_visits',
    );
    const plan = indexBuildPlan(visits?.model.schema.indexes() ?? []);
    for (const name of ['ix_vehicle_in', 'ix_out_date']) {
      expect(plan.find((item) => item.options['name'] === name)?.unique, name).toBe(false);
    }
  });
});
