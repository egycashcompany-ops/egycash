// The classification is the whole safety of the reset, so this is where its guarantees are pinned.
//
// Three things must hold, and each of them is a way the tool could destroy something irreplaceable:
//
//   • a collection the table does not cover must STOP the reset, not be quietly skipped or wiped;
//   • `users` must never be purged by the employee rule — that rule would delete the administrators
//     running the reset, on the first run, and nobody would be able to log in and undo it;
//   • the records that outlive an employee — gold receipts, traffic violations, ATM and vehicle
//     maintenance, job offers — must be classified `keep`, meaning NOTHING is written to them.
import mongoose from 'mongoose';
import { afterEach, describe, expect, it } from 'vitest';
import '../modules';
import { SURVIVING_ROLE_KEYS, employeeTargets } from './targets';

const TEMP_MODEL = 'SpecTempEmployeeScoped';

afterEach(() => {
  // The registry is module-global; a model left behind would fail every later test in this process.
  if (mongoose.models[TEMP_MODEL] !== undefined) mongoose.deleteModel(TEMP_MODEL);
});

describe('the reset refuses what it has not been told about', () => {
  /**
   * The anti-rot property, and the reason this is derived rather than hand-listed. A feature
   * shipped six months from now that files something against a person adds a collection; a
   * hand-written list would silently leave its rows behind, pointing at people who no longer exist,
   * and the next import would land on top of them.
   */
  it('stops, naming the collection, when a new employee-scoped collection appears', () => {
    mongoose.model(
      TEMP_MODEL,
      new mongoose.Schema({ employeeId: mongoose.Schema.Types.ObjectId }),
      'spec_temp_employee_scoped',
    );
    expect(() => employeeTargets()).toThrow(/spec_temp_employee_scoped/u);
    expect(() => employeeTargets()).toThrow(/employeeId/u);
  });

  it('finds a reference however it is named — plural, prefixed, or both', () => {
    mongoose.model(
      TEMP_MODEL,
      new mongoose.Schema({ captainEmployeeIds: [mongoose.Schema.Types.ObjectId] }),
      'spec_temp_employee_scoped',
    );
    // `captainEmployeeIds` is the shape the crew collections really use; matching only on a bare
    // `employeeId` missed four collections when this was first written.
    expect(() => employeeTargets()).toThrow(/spec_temp_employee_scoped/u);
  });

  it('is satisfied by the repository as it stands', () => {
    expect(() => employeeTargets()).not.toThrow();
  });
});

describe('what the classification decides', () => {
  const targets = employeeTargets();
  const find = (collection: string) => targets.find((t) => t.collection === collection);

  /**
   * THE CATASTROPHIC CASE. `users` carries `employeeId` — it is the Employee ← one User link — so a
   * rule that purged every collection naming an employee would empty the account table, including
   * the administrators, and leave nobody able to log in and put it back.
   */
  it('never lets the employee rule touch the accounts table', () => {
    expect(find('users')?.action).toBe('users');
    expect(targets.filter((t) => t.action === 'purge').map((t) => t.collection)).not.toContain(
      'users',
    );
  });

  /**
   * Records that are a thing that HAPPENED — filed against a vault, a vehicle, a machine or a
   * hiring decision — not a fact about a person. Deleting one to remove somebody destroys a company
   * record; even clearing its reference edits a record nobody asked to change.
   */
  it.each([
    ['gold_receiving_receipts', 'a printed financial record'],
    ['gold_delivery_receipts', 'a printed financial record'],
    ['gold_transfers', 'a financial record'],
    ['fleet_violations', 'a legal record'],
    ['fleet_odometer_logs', 'a fact about a vehicle'],
    ['fleet_maintenance_visits', 'a record about the vehicle'],
    ['atm_maintenances', 'a record about the machine'],
    ['hr_job_offers', 'recruitment history'],
  ])('leaves %s completely alone (%s)', (collection) => {
    expect(find(collection)?.action).toBe('keep');
  });

  it('purges the records that are facts about a person', () => {
    for (const collection of [
      'hr_payslips',
      'hr_leave_requests',
      'hr_attendance_days',
      'hr_contracts',
      'hr_employee_loans',
      'hr_medical_profiles',
      'hr_training_records',
      'hr_employee_actions',
      'hr_employee_files',
      'operations_crew_assignments',
      'fleet_driver_profiles',
      'it_asset_assignments',
    ]) {
      expect(find(collection)?.action, collection).toBe('purge');
    }
  });

  it('gives every target a reason a reviewer can weigh', () => {
    for (const t of targets) expect(t.why.length, t.collection).toBeGreaterThan(10);
  });

  it('names the employee paths it matched, so the report can show its working', () => {
    expect(find('operations_crew_assignments')?.paths).toEqual([
      'captainEmployeeIds',
      'specialist1EmployeeIds',
      'specialist2EmployeeIds',
    ]);
  });
});

describe('who survives', () => {
  /**
   * `employee-self-service` is an `isSystem` role held by EVERY employee with a login, so "keeps a
   * system role" would spare the entire workforce. Survival is named roles, and only these two.
   */
  it('is decided by two named roles, not by whether a role is a system one', () => {
    expect([...SURVIVING_ROLE_KEYS]).toEqual(['super-admin', 'platform-admin']);
    expect([...SURVIVING_ROLE_KEYS]).not.toContain('employee-self-service');
  });
});
