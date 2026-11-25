// The name copies a permanent delete rewrites — and the ways that list can go wrong silently.
//
// Three failure modes, and only the first is loud by itself:
//
//   A NEW NAME FIELD nobody classified. `nameCopiesToScrub()` throws, so this is loud already.
//   The spec below still pins the resolved list, because "it did not throw" is also true of a
//   table that has quietly stopped matching anything.
//
//   A TYPO IN THE PAIRED ID. `by.path` is how a rewrite finds ONE person's rows. Misspell it and
//   `updateMany` matches nothing, reports success, and the name stays on the receipt. Nothing else
//   in the system would notice, which is why the id is checked against the real schema here.
//
//   A SCRUB THAT RENAMES SOMETHING THAT IS NOT A PERSON. The same collections carry `fileName`,
//   `bankName` and `machineName`; scrubbing one of those would rename a bank on every receipt it
//   ever issued. The list is pinned whole so adding one is a decision somebody reads.
import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import '../../../../modules';
import { employeeTargets } from '../../../../workforce-reset/targets';
import { PURGED_EMPLOYEE_NAME, nameCopiesToScrub } from './employee-name-copies';

const schemaOf = (collection: string): mongoose.Schema | null => {
  for (const model of Object.values(mongoose.models)) {
    if (model.collection.name === collection) return model.schema;
  }
  return null;
};

describe('the names a permanent delete rewrites', () => {
  it('classifies every name field on a record the purge must keep', () => {
    // Throws, by name, on anything unclassified — the whole point of deriving rather than listing.
    expect(() => nameCopiesToScrub()).not.toThrow();
  });

  /**
   * The resolved list, whole. Seventeen copies across nine collections, and the shape of it is the
   * finding: an employee's name is written onto gold receipts, traffic violations, fuel receipts,
   * odometer readings, ATM maintenance tickets and purchase requests. Deleting the employee row
   * alone leaves every one of them still naming the person.
   */
  it('rewrites exactly these, each beside the id that says whose name it is', () => {
    const resolved = nameCopiesToScrub().map((c) => `${c.collection}.${c.path} <- ${c.by.path}`);
    expect(resolved).toEqual([
      'administration_purchase_requests.requesterName <- requesterEmployeeId',
      'atm_maintenances.closedByName <- closedById',
      'atm_maintenances.leaderName <- leaderEmployeeId',
      'atm_maintenances.openedByName <- openedById',
      'fleet_maintenance_visits.driverInName <- driverInEmployeeId',
      'fleet_maintenance_visits.driverOutName <- driverOutEmployeeId',
      'fleet_odometer_logs.driver1Name <- driver1EmployeeId',
      'fleet_odometer_logs.driver2Name <- driver2EmployeeId',
      'fleet_receipts.driverName <- driverEmployeeId',
      'fleet_violations.driverName <- driverEmployeeId',
      'gold_delivery_receipts.supervisor1Name <- supervisor1EmployeeId',
      'gold_delivery_receipts.supervisor2Name <- supervisor2EmployeeId',
      'gold_receiving_receipts.supervisor1Name <- supervisor1EmployeeId',
      'gold_receiving_receipts.supervisor2Name <- supervisor2EmployeeId',
      'gold_receiving_receipts.teamLeaderName <- teamLeaderEmployeeId',
      'gold_transfers.supervisor1Name <- supervisor1EmployeeId',
      'gold_transfers.supervisor2Name <- supervisor2EmployeeId',
    ]);
  });

  it('names a field that really exists, on both sides of the pair', () => {
    for (const copy of nameCopiesToScrub()) {
      const schema = schemaOf(copy.collection);
      expect(schema, copy.collection).not.toBeNull();
      // A missing name path writes nothing; a missing id path matches nothing and writes it to
      // NOBODY while reporting success. Both are silent, so both are checked.
      expect(schema?.path(copy.path), `${copy.collection}.${copy.path}`).toBeDefined();
      expect(schema?.path(copy.by.path), `${copy.collection}.${copy.by.path}`).toBeDefined();
    }
  });

  it('only ever rewrites a row the purge is keeping', () => {
    const kept = new Set(
      employeeTargets()
        .filter((t) => t.action === 'keep')
        .map((t) => t.collection),
    );
    for (const copy of nameCopiesToScrub()) {
      // A `purge` collection's rows are deleted outright, so rewriting a name on one first would
      // be work done to a row on its way out — and a sign the two tables disagree.
      expect(kept.has(copy.collection), copy.collection).toBe(true);
    }
  });

  it('never rewrites something that is not a person', () => {
    const forbidden = /fileName|bankName|machineName/i;
    for (const copy of nameCopiesToScrub()) {
      expect(forbidden.test(copy.path), `${copy.collection}.${copy.path}`).toBe(false);
    }
  });

  it('replaces a name rather than blanking it', () => {
    // A reader of an old receipt must still see that somebody stood there. An empty string reads
    // as "no supervisor", which is a different and false statement.
    expect(PURGED_EMPLOYEE_NAME.trim().length).toBeGreaterThan(0);
  });
});
