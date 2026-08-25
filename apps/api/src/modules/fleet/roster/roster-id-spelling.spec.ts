// The daily plan settles an id's SPELLING before anything compares one.
//
// An ObjectId is a number written in hex, and `objectId()` accepts either case. Every key the
// service builds from a document is `String(doc.field)`, which mongo renders lowercase — so an
// uppercase-hex payload id is the SAME row to the database and a DIFFERENT string to a `Map` key
// or a `Set`. Three guards read exactly those structures, and each of them fails open or fails
// closed for the wrong reason when the spelling differs:
//
//   • `byVehicle.get(row.vehicleId)`        — an edit takes the INSERT branch
//   • `inWorkshop.has(row.vehicleId)`       — FR-5 lets an in-workshop vehicle be assigned
//   • `payloadDrivers.has(String(slot))`    — FR-7 misses a driver another vehicle holds
//
// The schema normalizes at the HTTP boundary, and the service repeats it so a caller that never
// passes through the schema cannot reintroduce any of the three. The BEHAVIOUR of all of it is
// proved against a real database in tests/integration/fleet.spec.ts; what is proved here is that
// the service's own normalization exists and covers every id it later compares — which is the
// half a node test can reach, and the half a one-line edit would silently remove.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PlanFleetRosterSchema } from '@ecms/contracts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVICE = readFileSync(join(HERE, 'roster.service.ts'), 'utf8');
/** The service's CODE, comments removed — the claims below are about what it does. */
const CODE = SERVICE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const V = '64b1f0abcdefabcdefabcdef';
const D = '64b1f0abcdefabcdefabcd01';

describe('the daily plan and id spelling', () => {
  it('the SCHEMA answers with the canonical spelling', () => {
    const parsed = PlanFleetRosterSchema.parse({
      date: '2026-11-20',
      rows: [{ vehicleId: V.toUpperCase(), driver1EmployeeId: D.toUpperCase() }],
    });
    expect(parsed.rows[0]?.vehicleId).toBe(V);
    expect(parsed.rows[0]?.driver1EmployeeId).toBe(D);
  });

  it('the SERVICE settles the spelling itself, before any lookup', () => {
    // A caller that is not an HTTP request never meets the schema.
    expect(CODE, 'the service has its own normalizer').toMatch(
      /const canonical = [\s\S]{0,160}toLowerCase\(\)/,
    );
    const plan = CODE.slice(CODE.indexOf('async plan('));
    const normalizeAt = plan.indexOf('canonical(row.vehicleId)');
    expect(normalizeAt, 'the payload is normalized in plan()').toBeGreaterThan(-1);
    // Before the first thing that compares an id.
    for (const guard of ['vehicles.set(', 'inWorkshop', 'byVehicle', 'payloadDrivers']) {
      expect(normalizeAt, `normalized before ${guard}`).toBeLessThan(plan.indexOf(guard));
    }
  });

  it('covers EVERY id the row later compares — not just the vehicle', () => {
    // Bounded from `plan()` onward — `board()` above it has a `const day = utcDay` of its own.
    const from = CODE.indexOf('async plan(');
    const plan = CODE.slice(from, CODE.indexOf('const day = utcDay', from));
    for (const field of ['vehicleId', 'missionTypeId', 'driver1EmployeeId', 'driver2EmployeeId']) {
      expect(plan, `${field} is normalized`).toContain(`canonical(row.${field})`);
    }
  });

  it('normalizes the whole payload once, rather than at each call site', () => {
    // Per-site normalization is the version that rots: the next guard added forgets it.
    expect(CODE).toMatch(/const input: PlanFleetRoster = \{/);
    expect(CODE, 'and the original is not read again afterwards').not.toMatch(
      /original\.rows[\s\S]{0,40}(get|has)\(/,
    );
  });

  it('leaves the rest of the plan untouched — this is a spelling fix, not a rule change', () => {
    // The three guards, the transaction, the version check and the events are all still here.
    for (const marker of [
      'openVisitVehicleIds',
      'driverAvailabilityOn',
      'already holds this date',
      'unitOfWork',
      'version: current.__v',
      'FleetEvents.AssignmentChanged',
      'FleetEvents.RosterPlanned',
    ]) {
      expect(CODE, marker).toContain(marker);
    }
  });
});
